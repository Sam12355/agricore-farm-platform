export const UserRole = {
  User: 'user',
  Manager: 'manager',
  Admin: 'admin',
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export const FieldOperationStatus = {
  Active: 'active',
  Completed: 'completed',
  Expired: 'expired',
  Escalated: 'escalated',
} as const;
export type FieldOperationStatus = (typeof FieldOperationStatus)[keyof typeof FieldOperationStatus];

export const CountdownStatus = {
  Pending: 'pending',
  Cancelled: 'cancelled',
  Activated: 'activated',
} as const;
export type CountdownStatus = (typeof CountdownStatus)[keyof typeof CountdownStatus];

export const AlertStatus = {
  Active: 'active',
  Acknowledged: 'acknowledged',
  Resolved: 'resolved',
  Cancelled: 'cancelled',
} as const;
export type AlertStatus = (typeof AlertStatus)[keyof typeof AlertStatus];

export const AlertPriority = {
  Low: 'low',
  Standard: 'standard',
  High: 'high',
  Critical: 'critical',
} as const;
export type AlertPriority = (typeof AlertPriority)[keyof typeof AlertPriority];

export const AlertTrigger = {
  FieldCountdown: 'field_countdown',
  ManualReport: 'manual_report',
  OperationOverdue: 'operation_overdue',
  ManagerCreated: 'manager_created',
} as const;
export type AlertTrigger = (typeof AlertTrigger)[keyof typeof AlertTrigger];

/**
 * Timeline event types. Adding one here forces the client renderers to handle it,
 * because the union is exhaustive on both sides.
 */
export const AlertEventType = {
  Activated: 'alert.activated',
  LocationRecorded: 'alert.location_recorded',
  WorkerNotified: 'alert.worker_notified',
  WorkerAcknowledged: 'alert.worker_acknowledged',
  NotificationFailed: 'alert.notification_failed',
  ManagerClaimed: 'alert.manager_claimed',
  ManagerReleased: 'alert.manager_released',
  ManagerNoteAdded: 'alert.manager_note_added',
  PriorityChanged: 'alert.priority_changed',
  StatusChanged: 'alert.status_changed',
  Resolved: 'alert.resolved',
  Cancelled: 'alert.cancelled',
} as const;
export type AlertEventType = (typeof AlertEventType)[keyof typeof AlertEventType];

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
  Team: 'team',
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
