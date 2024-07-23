import { Inject, UseGuards } from '@nestjs/common';
import { Args, Int, Parent, Query, ResolveField, Resolver, Subscription } from '@nestjs/graphql';
import { PubSub } from 'graphql-subscriptions';

import { UserRole, normaliseLimit } from '@guardianlink/shared-types';

import { IncidentService } from '../../application/services/incident.service';
import { PORTS } from '../../application/tokens';
import type { IncidentRepository, NotificationRepository } from '../../application/ports';
import type { IncidentState } from '../../domain/incident/incident';
import { toIncidentDto, toIncidentEventDto } from '../http/dto-mappers';
import { AuthGuard, CurrentUser, Roles, type AuthenticatedRequest } from '../http/http-plumbing';

export const PUB_SUB = Symbol('PubSub');

export const GraphQlTopics = {
  IncidentUpdated: 'incidentUpdated',
  QueueChanged: 'queueChanged',
} as const;

/**
 * The operator read model.
 *
 * Two things worth noticing.
 *
 * **Authorisation runs here as well as in the guard.** The guard establishes that you are
 * an operator; `IncidentService` decides whether this particular incident is yours to see.
 * GraphQL makes it especially easy to forget the second, because a resolver looks like a
 * pure data accessor, and every field resolver is another place an unchecked read can
 * appear.
 *
 * **`events` is a field resolver, not an eager join.** The queue asks for fifty incidents
 * and no events; the detail panel asks for one incident and its timeline. Resolving events
 * eagerly would make the queue query fetch thousands of rows nobody rendered.
 */
@Resolver('Incident')
@UseGuards(AuthGuard)
@Roles(UserRole.Operator, UserRole.Admin)
export class IncidentResolver {
  constructor(
    private readonly incidents: IncidentService,
    @Inject(PORTS.IncidentRepository) private readonly incidentRepository: IncidentRepository,
    @Inject(PORTS.NotificationRepository) private readonly notifications: NotificationRepository,
    @Inject(PUB_SUB) private readonly pubSub: PubSub,
  ) {}

  @Query('incidents')
  async incidentQueue(
    @CurrentUser() user: NonNullable<AuthenticatedRequest['auth']>,
    @Args('status') status?: string,
    @Args('priority') priority?: string,
    @Args('claimed') claimed?: 'any' | 'mine' | 'unclaimed',
    @Args('limit', { type: () => Int }) limit?: number,
    @Args('cursor') cursor?: string,
  ) {
    const page = await this.incidents.list(
      { userId: user.userId, role: user.role },
      {
        ...(status === undefined ? {} : { status: status as never }),
        ...(priority === undefined ? {} : { priority: priority as never }),
        ...(claimed === undefined ? {} : { claimed }),
        limit: normaliseLimit(limit),
        ...(cursor === undefined ? {} : { cursor }),
      },
    );

    return {
      items: page.items.map(toIncidentDto),
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
    };
  }

  @Query('incident')
  async incidentById(
    @CurrentUser() user: NonNullable<AuthenticatedRequest['auth']>,
    @Args('id') id: string,
  ) {
    // Goes through the service, so the ownership rule is the same one the REST layer uses
    // rather than a second implementation that can drift.
    const result = await this.incidents.get(id, { userId: user.userId, role: user.role });
    return result.ok ? toIncidentDto(result.value) : null;
  }

  @Query('queueCounts')
  async queueCounts() {
    const activeCount = await this.incidentRepository.countByStatus('active');
    const unclaimedCount = await this.incidentRepository.countUnclaimed(new Date());
    return { activeCount, unclaimedCount };
  }

  /**
   * Timeline events, resolved only when asked for.
   *
   * `after` is how the console fetches a delta rather than the whole timeline. It matches
   * the REST endpoint and the socket resume payload, so all three use one concept.
   */
  @ResolveField('events')
  async events(
    @Parent() incident: { id: string },
    @Args('after', { type: () => Int }) after = 0,
    @Args('limit', { type: () => Int }) limit = 200,
  ) {
    const events = await this.incidentRepository.listEvents(
      incident.id,
      after,
      Math.min(limit, 500),
    );
    return events.map(toIncidentEventDto);
  }

  /**
   * A count, never the contacts.
   *
   * An operator needs to know whether anybody was reached. They do not need the names,
   * addresses or numbers of the subject's family, and exposing them through a field
   * resolver would be an easy thing to add and a hard thing to notice.
   */
  @ResolveField('notifiedContactCount')
  async notifiedContactCount(@Parent() incident: { id: string }): Promise<number> {
    const deliveries = await this.notifications.listForIncident(incident.id);
    return deliveries.filter((delivery) => delivery.status !== 'pending').length;
  }

  @Subscription('incidentUpdated', {
    filter: (payload: { incidentUpdated: { id: string } }, variables: { incidentId?: string }) =>
      // No incidentId means the whole queue feed. With one, only that incident.
      variables.incidentId === undefined || payload.incidentUpdated.id === variables.incidentId,
  })
  incidentUpdated() {
    return this.pubSub.asyncIterableIterator(GraphQlTopics.IncidentUpdated);
  }

  @Subscription('queueChanged')
  queueChanged() {
    return this.pubSub.asyncIterableIterator(GraphQlTopics.QueueChanged);
  }
}

/**
 * Bridges the domain publisher to GraphQL subscriptions.
 *
 * The Socket.IO gateway and this are two transports over the same events. Both exist
 * because they suit different clients: the mobile apps use Socket.IO, and the console uses
 * GraphQL subscriptions alongside its GraphQL reads rather than holding two connections.
 */
export class GraphQlEventBridge {
  constructor(private readonly pubSub: PubSub) {}

  async incidentUpdated(state: IncidentState): Promise<void> {
    await this.pubSub.publish(GraphQlTopics.IncidentUpdated, {
      incidentUpdated: toIncidentDto(state),
    });
  }

  async queueChanged(counts: { activeCount: number; unclaimedCount: number }): Promise<void> {
    await this.pubSub.publish(GraphQlTopics.QueueChanged, { queueChanged: counts });
  }
}
