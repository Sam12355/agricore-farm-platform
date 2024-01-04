export const UserRole = {
  User: 'user',
  Operator: 'operator',
  Admin: 'admin',
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export const SafetySessionStatus = {
  Active: 'active',
  Completed: 'completed',
  Expired: 'expired',
  Escalated: 'escalated',
} as const;
export type SafetySessionStatus = (typeof SafetySessionStatus)[keyof typeof SafetySessionStatus];

export const CountdownStatus = {
  Pending: 'pending',
  Cancelled: 'cancelled',
  Activated: 'activated',
} as const;
export type CountdownStatus = (typeof CountdownStatus)[keyof typeof CountdownStatus];

export const IncidentStatus = {
  Active: 'active',
  Acknowledged: 'acknowledged',
  Resolved: 'resolved',
  Cancelled: 'cancelled',
} as const;
export type IncidentStatus = (typeof IncidentStatus)[keyof typeof IncidentStatus];

export const IncidentPriority = {
  Low: 'low',
  Standard: 'standard',
  High: 'high',
  Critical: 'critical',
} as const;
export type IncidentPriority = (typeof IncidentPriority)[keyof typeof IncidentPriority];

export const IncidentTrigger = {
  SosCountdown: 'sos_countdown',
  ManualPanic: 'manual_panic',
  SessionOverdue: 'session_overdue',
  OperatorCreated: 'operator_created',
} as const;
export type IncidentTrigger = (typeof IncidentTrigger)[keyof typeof IncidentTrigger];

/**
 * Timeline event types. Adding one here forces the client renderers to handle it,
 * because the union is exhaustive on both sides.
 */
export const IncidentEventType = {
  Activated: 'incident.activated',
  LocationRecorded: 'incident.location_recorded',
  ContactNotified: 'incident.contact_notified',
  ContactAcknowledged: 'incident.contact_acknowledged',
  NotificationFailed: 'incident.notification_failed',
  OperatorClaimed: 'incident.operator_claimed',
  OperatorReleased: 'incident.operator_released',
  OperatorNoteAdded: 'incident.operator_note_added',
  PriorityChanged: 'incident.priority_changed',
  StatusChanged: 'incident.status_changed',
  Resolved: 'incident.resolved',
  Cancelled: 'incident.cancelled',
} as const;
export type IncidentEventType = (typeof IncidentEventType)[keyof typeof IncidentEventType];

export const NotificationChannel = {
  Email: 'email',
  Sms: 'sms',
  Push: 'push',
  Webhook: 'webhook',
  InApp: 'in_app',
} as const;
export type NotificationChannel = (typeof NotificationChannel)[keyof typeof NotificationChannel];

export const DeliveryStatus = {
  Pending: 'pending',
  Sent: 'sent',
  Delivered: 'delivered',
  Failed: 'failed',
  DeadLettered: 'dead_lettered',
  Suppressed: 'suppressed',
} as const;
export type DeliveryStatus = (typeof DeliveryStatus)[keyof typeof DeliveryStatus];

export const SubscriptionTier = {
  Free: 'free',
  Plus: 'plus',
  Family: 'family',
} as const;
export type SubscriptionTier = (typeof SubscriptionTier)[keyof typeof SubscriptionTier];

export const SubscriptionStatus = {
  None: 'none',
  Active: 'active',
  InGracePeriod: 'in_grace_period',
  Expired: 'expired',
  Cancelled: 'cancelled',
} as const;
export type SubscriptionStatus = (typeof SubscriptionStatus)[keyof typeof SubscriptionStatus];

export const StorePlatform = {
  Apple: 'apple',
  Google: 'google',
  None: 'none',
} as const;
export type StorePlatform = (typeof StorePlatform)[keyof typeof StorePlatform];

export const AuditOutcome = {
  Allowed: 'allowed',
  Denied: 'denied',
  Failed: 'failed',
} as const;
export type AuditOutcome = (typeof AuditOutcome)[keyof typeof AuditOutcome];
