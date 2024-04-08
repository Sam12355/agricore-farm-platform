import { Inject, Injectable } from '@nestjs/common';
import {
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';

import {
  ClientEvent,
  MAX_REPLAY_EVENTS,
  SOCKET_NAMESPACE,
  ServerEvent,
  resumeIncidentSchema,
  subscribeIncidentSchema,
} from '@guardianlink/contracts';
import { UserRole } from '@guardianlink/shared-types';

import type { IncidentState } from '../../domain/incident/incident';
import type { StoredIncidentEvent } from '../../domain/incident/incident-events';
import type {
  IncidentRepository,
  RealtimePublisher,
  StructuredLogger,
  TokenService,
} from '../../application/ports';
import { PORTS } from '../../application/tokens';
import { toIncidentDto, toIncidentEventDto } from '../http/dto-mappers';

interface SocketAuth {
  userId: string;
  role: UserRole;
}

const QUEUE_ROOM = 'queue';
const incidentRoom = (incidentId: string) => `incident:${incidentId}`;

/**
 * The real-time layer.
 *
 * Three problems had to be solved here, and each one shaped the design:
 *
 *   1. **Authentication.** A socket is a long-lived connection established once. The
 *      access token is verified at handshake and the resulting identity is pinned to the
 *      socket. There is no path that trusts a userId sent in a message payload, because
 *      a client can put anything in a payload.
 *
 *   2. **Authorisation per subscription.** Joining an incident room is checked against
 *      the same ownership rule the HTTP layer uses. Without that, a logged-in user could
 *      subscribe to a stranger's incident and watch their location move, which is about
 *      the worst thing this product could do.
 *
 *   3. **Gaps.** Sockets drop. Every event carries a per-incident sequence number, and
 *      a reconnecting client sends the last sequence it applied so the server can replay
 *      exactly what it missed. Beyond a replay window the client is told to refetch
 *      instead, because streaming ten thousand events to catch up is slower than a
 *      single read.
 */
@Injectable()
@WebSocketGateway({ namespace: SOCKET_NAMESPACE, cors: { origin: true, credentials: true } })
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect, RealtimePublisher {
  @WebSocketServer()
  private server!: Server;

  private readonly identities = new WeakMap<Socket, SocketAuth>();

  constructor(
    @Inject(PORTS.TokenService) private readonly tokens: TokenService,
    @Inject(PORTS.IncidentRepository) private readonly incidents: IncidentRepository,
    @Inject(PORTS.Logger) private readonly logger: StructuredLogger,
  ) {}

  handleConnection(socket: Socket): void {
    const raw =
      (typeof socket.handshake.auth?.['token'] === 'string'
        ? (socket.handshake.auth['token'] as string)
        : undefined) ?? socket.handshake.headers.authorization?.replace(/^Bearer /, '');

    if (raw === undefined) {
      socket.emit(ServerEvent.SubscriptionRejected, {
        event: 'connection',
        code: 'FORBIDDEN',
        message: 'A valid access token is required.',
      });
      socket.disconnect(true);
      return;
    }

    const verified = this.tokens.verifyAccessToken(raw);
    if (!verified.ok) {
      socket.emit(ServerEvent.SubscriptionRejected, {
        event: 'connection',
        code: 'FORBIDDEN',
        message: verified.error.message,
      });
      socket.disconnect(true);
      return;
    }

    this.identities.set(socket, { userId: verified.value.userId, role: verified.value.role });
    this.logger.debug('socket connected', { userId: verified.value.userId });
  }

  handleDisconnect(socket: Socket): void {
    this.identities.delete(socket);
  }

  @SubscribeMessage(ClientEvent.SubscribeQueue)
  async subscribeQueue(socket: Socket): Promise<void> {
    const auth = this.identities.get(socket);
    if (auth === undefined) return;

    // The operator queue is the whole incident firehose. Only staff get it.
    if (auth.role !== UserRole.Operator && auth.role !== UserRole.Admin) {
      socket.emit(ServerEvent.SubscriptionRejected, {
        event: ClientEvent.SubscribeQueue,
        code: 'FORBIDDEN',
        message: 'The incident queue is available to operators only.',
      });
      return;
    }

    await socket.join(QUEUE_ROOM);
  }

  @SubscribeMessage(ClientEvent.SubscribeIncident)
  async subscribeIncident(socket: Socket, payload: unknown): Promise<void> {
    const auth = this.identities.get(socket);
    if (auth === undefined) return;

    const parsed = subscribeIncidentSchema.safeParse(payload);
    if (!parsed.success) {
      socket.emit(ServerEvent.SubscriptionRejected, {
        event: ClientEvent.SubscribeIncident,
        code: 'VALIDATION_FAILED',
        message: 'An incident id is required.',
      });
      return;
    }

    const allowed = await this.mayViewIncident(parsed.data.incidentId, auth);
    if (!allowed) {
      socket.emit(ServerEvent.SubscriptionRejected, {
        event: ClientEvent.SubscribeIncident,
        code: 'NOT_FOUND',
        message: 'Incident was not found.',
      });
      return;
    }

    await socket.join(incidentRoom(parsed.data.incidentId));
  }

  @SubscribeMessage(ClientEvent.UnsubscribeIncident)
  async unsubscribeIncident(socket: Socket, payload: unknown): Promise<void> {
    const parsed = subscribeIncidentSchema.safeParse(payload);
    if (parsed.success) await socket.leave(incidentRoom(parsed.data.incidentId));
  }

  /**
   * Gap recovery after a reconnect.
   *
   * The client says what it has; the server sends what it missed. Nothing is lost and
   * nothing needs to be reconciled by hand. If the gap is larger than the replay window
   * the response says so, and the client refetches the timeline instead of trying to
   * stitch a partial stream together.
   */
  @SubscribeMessage(ClientEvent.Resume)
  async resume(socket: Socket, payload: unknown): Promise<void> {
    const auth = this.identities.get(socket);
    if (auth === undefined) return;

    const parsed = resumeIncidentSchema.safeParse(payload);
    if (!parsed.success) return;

    const allowed = await this.mayViewIncident(parsed.data.incidentId, auth);
    if (!allowed) {
      socket.emit(ServerEvent.SubscriptionRejected, {
        event: ClientEvent.Resume,
        code: 'NOT_FOUND',
        message: 'Incident was not found.',
      });
      return;
    }

    const latestSequence = await this.incidents.latestSequence(parsed.data.incidentId);
    const gap = latestSequence - parsed.data.lastSequence;
    const truncated = gap > MAX_REPLAY_EVENTS;

    const events = truncated
      ? []
      : await this.incidents.listEvents(
          parsed.data.incidentId,
          parsed.data.lastSequence,
          MAX_REPLAY_EVENTS,
        );

    await socket.join(incidentRoom(parsed.data.incidentId));
    socket.emit(ServerEvent.Resumed, {
      incidentId: parsed.data.incidentId,
      events: events.map(toIncidentEventDto),
      latestSequence,
      truncated,
    });
  }

  private async mayViewIncident(incidentId: string, auth: SocketAuth): Promise<boolean> {
    if (auth.role === UserRole.Operator || auth.role === UserRole.Admin) return true;
    const incident = await this.incidents.findById(incidentId);
    return incident !== null && incident.userId === auth.userId;
  }

  // RealtimePublisher --------------------------------------------------------

  incidentCreated(state: IncidentState): void {
    this.server?.to(QUEUE_ROOM).emit(ServerEvent.IncidentCreated, {
      incident: toIncidentDto(state),
      emittedAt: new Date().toISOString(),
    });
  }

  incidentUpdated(state: IncidentState, changedFields: readonly string[]): void {
    const payload = {
      incident: toIncidentDto(state),
      changedFields: [...changedFields],
      emittedAt: new Date().toISOString(),
    };
    this.server?.to(incidentRoom(state.id)).emit(ServerEvent.IncidentUpdated, payload);
    this.server?.to(QUEUE_ROOM).emit(ServerEvent.IncidentUpdated, payload);
  }

  incidentEventAppended(event: StoredIncidentEvent): void {
    this.server?.to(incidentRoom(event.incidentId)).emit(ServerEvent.IncidentEventAppended, {
      event: toIncidentEventDto(event),
      emittedAt: new Date().toISOString(),
    });
  }

  queueChanged(counts: { activeCount: number; unclaimedCount: number }): void {
    this.server?.to(QUEUE_ROOM).emit(ServerEvent.QueueChanged, {
      ...counts,
      emittedAt: new Date().toISOString(),
    });
  }
}

/** Used by unit and integration tests that assert what would have been published. */
export class RecordingRealtimePublisher implements RealtimePublisher {
  readonly created: IncidentState[] = [];
  readonly updated: Array<{ state: IncidentState; changedFields: readonly string[] }> = [];
  readonly events: StoredIncidentEvent[] = [];
  readonly queueUpdates: Array<{ activeCount: number; unclaimedCount: number }> = [];

  incidentCreated(state: IncidentState): void {
    this.created.push(state);
  }

  incidentUpdated(state: IncidentState, changedFields: readonly string[]): void {
    this.updated.push({ state, changedFields });
  }

  incidentEventAppended(event: StoredIncidentEvent): void {
    this.events.push(event);
  }

  queueChanged(counts: { activeCount: number; unclaimedCount: number }): void {
    this.queueUpdates.push(counts);
  }

  reset(): void {
    this.created.length = 0;
    this.updated.length = 0;
    this.events.length = 0;
    this.queueUpdates.length = 0;
  }
}
