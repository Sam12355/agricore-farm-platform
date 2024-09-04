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
  resumeAlertSchema,
  subscribeAlertSchema,
} from '@agricore/contracts';
import { UserRole } from '@agricore/shared-types';

import type { AlertState } from '../../domain/alert/alert';
import type { StoredAlertEvent } from '../../domain/alert/alert-events';
import type {
  AlertRepository,
  RealtimePublisher,
  StructuredLogger,
  TokenService,
} from '../../application/ports';
import { PORTS } from '../../application/tokens';
import { toAlertDto, toAlertEventDto } from '../http/dto-mappers';

interface SocketAuth {
  userId: string;
  role: UserRole;
}

const QUEUE_ROOM = 'queue';
const alertRoom = (alertId: string) => `alert:${alertId}`;

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
 *   2. **Authorisation per subscription.** Joining an alert room is checked against
 *      the same ownership rule the HTTP layer uses. Without that, a logged-in user could
 *      subscribe to a stranger's alert and watch their location move, which is about
 *      the worst thing this product could do.
 *
 *   3. **Gaps.** Sockets drop. Every event carries a per-alert sequence number, and
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
    @Inject(PORTS.AlertRepository) private readonly alerts: AlertRepository,
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

    // The manager queue is the whole alert firehose. Only staff get it.
    if (auth.role !== UserRole.Manager && auth.role !== UserRole.Admin) {
      socket.emit(ServerEvent.SubscriptionRejected, {
        event: ClientEvent.SubscribeQueue,
        code: 'FORBIDDEN',
        message: 'The alert queue is available to managers only.',
      });
      return;
    }

    await socket.join(QUEUE_ROOM);
  }

  @SubscribeMessage(ClientEvent.SubscribeAlert)
  async subscribeAlert(socket: Socket, payload: unknown): Promise<void> {
    const auth = this.identities.get(socket);
    if (auth === undefined) return;

    const parsed = subscribeAlertSchema.safeParse(payload);
    if (!parsed.success) {
      socket.emit(ServerEvent.SubscriptionRejected, {
        event: ClientEvent.SubscribeAlert,
        code: 'VALIDATION_FAILED',
        message: 'An alert id is required.',
      });
      return;
    }

    const allowed = await this.mayViewAlert(parsed.data.alertId, auth);
    if (!allowed) {
      socket.emit(ServerEvent.SubscriptionRejected, {
        event: ClientEvent.SubscribeAlert,
        code: 'NOT_FOUND',
        message: 'Alert was not found.',
      });
      return;
    }

    await socket.join(alertRoom(parsed.data.alertId));
  }

  @SubscribeMessage(ClientEvent.UnsubscribeAlert)
  async unsubscribeAlert(socket: Socket, payload: unknown): Promise<void> {
    const parsed = subscribeAlertSchema.safeParse(payload);
    if (parsed.success) await socket.leave(alertRoom(parsed.data.alertId));
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

    const parsed = resumeAlertSchema.safeParse(payload);
    if (!parsed.success) return;

    const allowed = await this.mayViewAlert(parsed.data.alertId, auth);
    if (!allowed) {
      socket.emit(ServerEvent.SubscriptionRejected, {
        event: ClientEvent.Resume,
        code: 'NOT_FOUND',
        message: 'Alert was not found.',
      });
      return;
    }

    const latestSequence = await this.alerts.latestSequence(parsed.data.alertId);
    const gap = latestSequence - parsed.data.lastSequence;
    const truncated = gap > MAX_REPLAY_EVENTS;

    const events = truncated
      ? []
      : await this.alerts.listEvents(
          parsed.data.alertId,
          parsed.data.lastSequence,
          MAX_REPLAY_EVENTS,
        );

    await socket.join(alertRoom(parsed.data.alertId));
    socket.emit(ServerEvent.Resumed, {
      alertId: parsed.data.alertId,
      events: events.map(toAlertEventDto),
      latestSequence,
      truncated,
    });
  }

  private async mayViewAlert(alertId: string, auth: SocketAuth): Promise<boolean> {
    if (auth.role === UserRole.Manager || auth.role === UserRole.Admin) return true;
    const alert = await this.alerts.findById(alertId);
    return alert !== null && alert.userId === auth.userId;
  }

  // RealtimePublisher --------------------------------------------------------

  alertCreated(state: AlertState): void {
    this.server?.to(QUEUE_ROOM).emit(ServerEvent.AlertCreated, {
      alert: toAlertDto(state),
      emittedAt: new Date().toISOString(),
    });
  }

  alertUpdated(state: AlertState, changedFields: readonly string[]): void {
    const payload = {
      alert: toAlertDto(state),
      changedFields: [...changedFields],
      emittedAt: new Date().toISOString(),
    };
    this.server?.to(alertRoom(state.id)).emit(ServerEvent.AlertUpdated, payload);
    this.server?.to(QUEUE_ROOM).emit(ServerEvent.AlertUpdated, payload);
  }

  alertEventAppended(event: StoredAlertEvent): void {
    this.server?.to(alertRoom(event.alertId)).emit(ServerEvent.AlertEventAppended, {
      event: toAlertEventDto(event),
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
  readonly created: AlertState[] = [];
  readonly updated: Array<{ state: AlertState; changedFields: readonly string[] }> = [];
  readonly events: StoredAlertEvent[] = [];
  readonly queueUpdates: Array<{ activeCount: number; unclaimedCount: number }> = [];

  alertCreated(state: AlertState): void {
    this.created.push(state);
  }

  alertUpdated(state: AlertState, changedFields: readonly string[]): void {
    this.updated.push({ state, changedFields });
  }

  alertEventAppended(event: StoredAlertEvent): void {
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
