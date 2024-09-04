import type {
  CountdownDto,
  AlertDto,
  AlertEventDto,
  FieldOperationDto,
  WorkerDto,
} from '@agricore/contracts';

import type { CountdownState } from '../../domain/alert/countdown';
import type { AlertState } from '../../domain/alert/alert';
import type { StoredAlertEvent } from '../../domain/alert/alert-events';
import type {
  PrivacySettingsRecord,
  FieldOperationRecord,
  WorkerRecord,
} from '../../application/ports';

/**
 * Domain state to wire shape.
 *
 * These exist so the persisted record and the public representation can move
 * independently. Returning the aggregate directly is how internal fields leak: the day
 * someone adds a column for an internal flag, it appears in the API and in two mobile
 * clients before anyone notices.
 */

export function toAlertDto(state: AlertState): AlertDto {
  return {
    id: state.id,
    userId: state.userId,
    sessionId: state.sessionId,
    status: state.status,
    priority: state.priority,
    trigger: state.trigger,
    activatedAt: state.activatedAt.toISOString(),
    resolvedAt: state.resolvedAt?.toISOString() ?? null,
    resolvedBy: state.resolvedBy,
    claimedByManagerId: state.claimedByManagerId,
    claimedAt: state.claimedAt?.toISOString() ?? null,
    lastKnownLocation:
      state.lastKnownLocation === null
        ? null
        : {
            latitude: state.lastKnownLocation.latitude,
            longitude: state.lastKnownLocation.longitude,
            accuracyMetres: state.lastKnownLocation.accuracyMetres,
            capturedAt: state.lastKnownLocation.capturedAt.toISOString(),
          },
    version: state.version,
    createdAt: state.createdAt.toISOString(),
    updatedAt: state.updatedAt.toISOString(),
  };
}

export function toAlertEventDto(event: StoredAlertEvent): AlertEventDto {
  return {
    id: event.id,
    alertId: event.alertId,
    sequence: event.sequence,
    type: event.type,
    actorType: event.actorType,
    actorId: event.actorId,
    occurredAt: event.occurredAt.toISOString(),
    recordedAt: event.recordedAt.toISOString(),
    payload: { ...event.payload },
  };
}

export function toCountdownDto(state: CountdownState): CountdownDto {
  return {
    id: state.id,
    status: state.status,
    startedAt: state.startedAt.toISOString(),
    expiresAt: state.expiresAt.toISOString(),
    cancelledAt: state.cancelledAt?.toISOString() ?? null,
    alertId: state.alertId,
  };
}

export function toWorkerDto(record: WorkerRecord): WorkerDto {
  return {
    id: record.id,
    name: record.name,
    email: record.email,
    phone: record.phone,
    jobRole: record.jobRole,
    priority: record.priority,
    preferredChannel: record.preferredChannel,
    canViewLiveLocation: record.canViewLiveLocation,
    verifiedAt: record.verifiedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export function toFieldOperationDto(record: FieldOperationRecord): FieldOperationDto {
  return {
    id: record.id,
    status: record.status,
    startedAt: record.startedAt.toISOString(),
    expectedEndAt: record.expectedEndAt.toISOString(),
    endedAt: record.endedAt?.toISOString() ?? null,
    note: record.note,
    destinationLabel: record.destinationLabel,
    shareLiveLocation: record.shareLiveLocation,
  };
}

export function toPrivacySettingsDto(record: PrivacySettingsRecord) {
  return {
    shareLocationWithWorkers: record.shareLocationWithWorkers,
    shareLocationWithManagers: record.shareLocationWithManagers,
    storePreciseLocationHistory: record.storePreciseLocationHistory,
    alertRetentionDays: record.alertRetentionDays,
    locationRetentionDays: record.locationRetentionDays,
    notificationLogRetentionDays: record.notificationLogRetentionDays,
    allowAnonymisedProductAnalytics: record.allowAnonymisedProductAnalytics,
    updatedAt: record.updatedAt.toISOString(),
  };
}
