import { Inject, Injectable } from '@nestjs/common';

import { DEMO_NOTICE_FULL, type ContactIncidentView } from '@guardianlink/contracts';
import {
  type Clock,
  DomainErrors,
  type DomainError,
  type Result,
  err,
  ok,
} from '@guardianlink/shared-types';

import { acknowledge } from '../../domain/incident/incident';
import { PORTS } from '../tokens';
import type {
  IncidentRepository,
  NotificationRepository,
  PrivacySettingsRepository,
  RealtimePublisher,
  StructuredLogger,
  TokenService,
  TrustedContactRepository,
  UserRepository,
} from '../ports';

/**
 * What a trusted contact sees, and what they can do.
 *
 * There is no account here. A contact gets a link in a message and taps it, possibly at
 * two in the morning, possibly on someone else's phone. Asking them to register first
 * would make the feature useless.
 *
 * The trade-off is that the link is the credential, so it is scoped as tightly as I can
 * make it: signed, one incident, one contact, time-boxed, and it grants a read of a
 * trimmed projection plus exactly one write (acknowledge). It cannot list incidents, it
 * cannot read the subject's profile, and it stops working when the incident closes.
 */
@Injectable()
export class ContactViewService {
  constructor(
    @Inject(PORTS.IncidentRepository) private readonly incidents: IncidentRepository,
    @Inject(PORTS.TrustedContactRepository) private readonly contacts: TrustedContactRepository,
    @Inject(PORTS.NotificationRepository) private readonly notifications: NotificationRepository,
    @Inject(PORTS.PrivacySettingsRepository) private readonly privacy: PrivacySettingsRepository,
    @Inject(PORTS.UserRepository) private readonly users: UserRepository,
    @Inject(PORTS.TokenService) private readonly tokens: TokenService,
    @Inject(PORTS.RealtimePublisher) private readonly realtime: RealtimePublisher,
    @Inject(PORTS.Clock) private readonly clock: Clock,
    @Inject(PORTS.Logger) private readonly logger: StructuredLogger,
  ) {}

  async view(token: string): Promise<Result<ContactIncidentView, DomainError>> {
    const claims = this.tokens.verifyContactViewToken(token);
    if (!claims.ok) return claims;

    const incident = await this.incidents.findById(claims.value.incidentId);
    if (incident === null) return err(DomainErrors.notFound('Incident'));

    const contact = await this.contacts.findById(claims.value.contactId);
    if (contact === null || contact.userId !== incident.userId) {
      return err(DomainErrors.notFound('Incident'));
    }

    const subject = await this.users.findById(incident.userId);
    const settings = await this.privacy.findForUser(incident.userId);

    // Location is shown only if the subject allows contact sharing and this particular
    // contact is permitted to see it. Two independent switches, both must be on.
    const maySeeLocation =
      (settings?.shareLocationWithContacts ?? true) && contact.canViewLiveLocation;

    const location =
      maySeeLocation && incident.lastKnownLocation !== null
        ? {
            latitude: incident.lastKnownLocation.latitude,
            longitude: incident.lastKnownLocation.longitude,
            accuracyMetres: incident.lastKnownLocation.accuracyMetres,
            capturedAt: incident.lastKnownLocation.capturedAt.toISOString(),
          }
        : null;

    return ok({
      incidentId: incident.id,
      status: incident.status,
      // First name only. The contact already knows who this is, and the full record
      // does not need to travel in a link that might be forwarded.
      subjectDisplayName: subject?.displayName.split(' ')[0] ?? 'A GuardianLink user',
      activatedAt: incident.activatedAt.toISOString(),
      lastKnownLocation: location,
      acknowledgedAt: incident.acknowledgedAt?.toISOString() ?? null,
      demoNotice: DEMO_NOTICE_FULL,
    });
  }

  async acknowledge(token: string, note: string | null): Promise<Result<ContactIncidentView, DomainError>> {
    const claims = this.tokens.verifyContactViewToken(token);
    if (!claims.ok) return claims;

    const incident = await this.incidents.findById(claims.value.incidentId);
    if (incident === null) return err(DomainErrors.notFound('Incident'));

    const contact = await this.contacts.findById(claims.value.contactId);
    if (contact === null || contact.userId !== incident.userId) {
      return err(DomainErrors.notFound('Incident'));
    }

    const now = this.clock.now();
    const transition = acknowledge({
      state: incident,
      contactId: contact.id,
      note,
      now,
    });
    if (!transition.ok) return transition;

    if (transition.value.events.length > 0) {
      const saved = await this.incidents.save({
        state: transition.value.state,
        events: transition.value.events,
        expectedVersion: incident.version,
      });
      if (!saved.ok) return saved;

      // Mark the delivery acknowledged so the escalation chain stops chasing this
      // contact. Without this the secondary would still be notified on schedule.
      const deliveries = await this.notifications.listForIncident(incident.id);
      for (const delivery of deliveries) {
        if (delivery.contactId === contact.id && delivery.acknowledgedAt === null) {
          await this.notifications.update({ ...delivery, acknowledgedAt: now, updatedAt: now });
        }
      }

      this.realtime.incidentUpdated(saved.value.state, ['status', 'acknowledgedAt']);
      for (const event of saved.value.events) this.realtime.incidentEventAppended(event);

      this.logger.info('contact acknowledged incident', {
        incidentId: incident.id,
        contactId: contact.id,
      });
    }

    return this.view(token);
  }
}
