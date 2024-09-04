import { Inject, UseGuards } from '@nestjs/common';
import { Args, Int, Parent, Query, ResolveField, Resolver, Subscription } from '@nestjs/graphql';
import { PubSub } from 'graphql-subscriptions';

import { UserRole, normaliseLimit } from '@agricore/shared-types';

import { AlertService } from '../../application/services/alert.service';
import { PORTS } from '../../application/tokens';
import type { AlertRepository, NotificationRepository } from '../../application/ports';
import type { AlertState } from '../../domain/alert/alert';
import { toAlertDto, toAlertEventDto } from '../http/dto-mappers';
import { AuthGuard, CurrentUser, Roles, type AuthenticatedRequest } from '../http/http-plumbing';

export const PUB_SUB = Symbol('PubSub');

export const GraphQlTopics = {
  AlertUpdated: 'alertUpdated',
  QueueChanged: 'queueChanged',
} as const;

/**
 * The manager read model.
 *
 * Two things worth noticing.
 *
 * **Authorisation runs here as well as in the guard.** The guard establishes that you are
 * a manager; `AlertService` decides whether this particular alert is yours to see.
 * GraphQL makes it especially easy to forget the second, because a resolver looks like a
 * pure data accessor, and every field resolver is another place an unchecked read can
 * appear.
 *
 * **`events` is a field resolver, not an eager join.** The queue asks for fifty alerts
 * and no events; the detail panel asks for one alert and its timeline. Resolving events
 * eagerly would make the queue query fetch thousands of rows nobody rendered.
 */
@Resolver('Alert')
@UseGuards(AuthGuard)
@Roles(UserRole.Manager, UserRole.Admin)
export class AlertResolver {
  constructor(
    private readonly alerts: AlertService,
    @Inject(PORTS.AlertRepository) private readonly alertRepository: AlertRepository,
    @Inject(PORTS.NotificationRepository) private readonly notifications: NotificationRepository,
    @Inject(PUB_SUB) private readonly pubSub: PubSub,
  ) {}

  @Query('alerts')
  async alertQueue(
    @CurrentUser() user: NonNullable<AuthenticatedRequest['auth']>,
    @Args('status') status?: string,
    @Args('priority') priority?: string,
    @Args('claimed') claimed?: 'any' | 'mine' | 'unclaimed',
    @Args('limit', { type: () => Int }) limit?: number,
    @Args('cursor') cursor?: string,
  ) {
    const page = await this.alerts.list(
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
      items: page.items.map(toAlertDto),
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
    };
  }

  @Query('alert')
  async alertById(
    @CurrentUser() user: NonNullable<AuthenticatedRequest['auth']>,
    @Args('id') id: string,
  ) {
    // Goes through the service, so the ownership rule is the same one the REST layer uses
    // rather than a second implementation that can drift.
    const result = await this.alerts.get(id, { userId: user.userId, role: user.role });
    return result.ok ? toAlertDto(result.value) : null;
  }

  @Query('queueCounts')
  async queueCounts() {
    const activeCount = await this.alertRepository.countByStatus('active');
    const unclaimedCount = await this.alertRepository.countUnclaimed(new Date());
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
    @Parent() alert: { id: string },
    @Args('after', { type: () => Int }) after = 0,
    @Args('limit', { type: () => Int }) limit = 200,
  ) {
    const events = await this.alertRepository.listEvents(
      alert.id,
      after,
      Math.min(limit, 500),
    );
    return events.map(toAlertEventDto);
  }

  /**
   * A count, never the workers.
   *
   * A manager needs to know whether anybody was reached. They do not need the names,
   * addresses or numbers of the workers assigned to the farm, and exposing them through a field
   * resolver would be an easy thing to add and a hard thing to notice.
   */
  @ResolveField('notifiedWorkerCount')
  async notifiedWorkerCount(@Parent() alert: { id: string }): Promise<number> {
    const deliveries = await this.notifications.listForAlert(alert.id);
    return deliveries.filter((delivery) => delivery.status !== 'pending').length;
  }

  @Subscription('alertUpdated', {
    filter: (payload: { alertUpdated: { id: string } }, variables: { alertId?: string }) =>
      // No alertId means the whole queue feed. With one, only that alert.
      variables.alertId === undefined || payload.alertUpdated.id === variables.alertId,
  })
  alertUpdated() {
    return this.pubSub.asyncIterableIterator(GraphQlTopics.AlertUpdated);
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

  async alertUpdated(state: AlertState): Promise<void> {
    await this.pubSub.publish(GraphQlTopics.AlertUpdated, {
      alertUpdated: toAlertDto(state),
    });
  }

  async queueChanged(counts: { activeCount: number; unclaimedCount: number }): Promise<void> {
    await this.pubSub.publish(GraphQlTopics.QueueChanged, { queueChanged: counts });
  }
}
