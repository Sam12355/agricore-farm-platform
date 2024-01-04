/**
 * Branded identifier types.
 *
 * These are strings at runtime with no wrapper cost, but the compiler will not let you
 * pass a UserId where an IncidentId is expected. That has caught real mistakes in the
 * authorisation code, where two identifiers of the same shape sit next to each other in
 * an argument list.
 */

declare const brand: unique symbol;

type Branded<T, B extends string> = T & { readonly [brand]: B };

export type UserId = Branded<string, 'UserId'>;
export type TrustedContactId = Branded<string, 'TrustedContactId'>;
export type SafetySessionId = Branded<string, 'SafetySessionId'>;
export type CountdownId = Branded<string, 'CountdownId'>;
export type IncidentId = Branded<string, 'IncidentId'>;
export type IncidentEventId = Branded<string, 'IncidentEventId'>;
export type NotificationId = Branded<string, 'NotificationId'>;
export type DeliveryId = Branded<string, 'DeliveryId'>;
export type AuditRecordId = Branded<string, 'AuditRecordId'>;
export type SubscriptionId = Branded<string, 'SubscriptionId'>;
export type RefreshTokenId = Branded<string, 'RefreshTokenId'>;
export type CorrelationId = Branded<string, 'CorrelationId'>;

export const asUserId = (value: string): UserId => value as UserId;
export const asTrustedContactId = (value: string): TrustedContactId => value as TrustedContactId;
export const asSafetySessionId = (value: string): SafetySessionId => value as SafetySessionId;
export const asCountdownId = (value: string): CountdownId => value as CountdownId;
export const asIncidentId = (value: string): IncidentId => value as IncidentId;
export const asIncidentEventId = (value: string): IncidentEventId => value as IncidentEventId;
export const asNotificationId = (value: string): NotificationId => value as NotificationId;
export const asDeliveryId = (value: string): DeliveryId => value as DeliveryId;
export const asAuditRecordId = (value: string): AuditRecordId => value as AuditRecordId;
export const asSubscriptionId = (value: string): SubscriptionId => value as SubscriptionId;
export const asRefreshTokenId = (value: string): RefreshTokenId => value as RefreshTokenId;
export const asCorrelationId = (value: string): CorrelationId => value as CorrelationId;
