/**
 * Branded identifier types.
 *
 * These are strings at runtime with no wrapper cost, but the compiler will not let you
 * pass a UserId where an AlertId is expected. That has caught real mistakes in the
 * authorisation code, where two identifiers of the same shape sit next to each other in
 * an argument list.
 */

declare const brand: unique symbol;

type Branded<T, B extends string> = T & { readonly [brand]: B };

export type UserId = Branded<string, 'UserId'>;
export type WorkerId = Branded<string, 'WorkerId'>;
export type FieldOperationId = Branded<string, 'FieldOperationId'>;
export type CountdownId = Branded<string, 'CountdownId'>;
export type AlertId = Branded<string, 'AlertId'>;
export type AlertEventId = Branded<string, 'AlertEventId'>;
export type NotificationId = Branded<string, 'NotificationId'>;
export type DeliveryId = Branded<string, 'DeliveryId'>;
export type AuditRecordId = Branded<string, 'AuditRecordId'>;
export type SubscriptionId = Branded<string, 'SubscriptionId'>;
export type RefreshTokenId = Branded<string, 'RefreshTokenId'>;
export type CorrelationId = Branded<string, 'CorrelationId'>;

export const asUserId = (value: string): UserId => value as UserId;
export const asWorkerId = (value: string): WorkerId => value as WorkerId;
export const asFieldOperationId = (value: string): FieldOperationId => value as FieldOperationId;
export const asCountdownId = (value: string): CountdownId => value as CountdownId;
export const asAlertId = (value: string): AlertId => value as AlertId;
export const asAlertEventId = (value: string): AlertEventId => value as AlertEventId;
export const asNotificationId = (value: string): NotificationId => value as NotificationId;
export const asDeliveryId = (value: string): DeliveryId => value as DeliveryId;
export const asAuditRecordId = (value: string): AuditRecordId => value as AuditRecordId;
export const asSubscriptionId = (value: string): SubscriptionId => value as SubscriptionId;
export const asRefreshTokenId = (value: string): RefreshTokenId => value as RefreshTokenId;
export const asCorrelationId = (value: string): CorrelationId => value as CorrelationId;
