import {
  CountdownStatus,
  DomainErrors,
  type DomainError,
  err,
  ok,
  type Result,
} from '@agricore/shared-types';

/**
 * The alert countdown.
 *
 * This is the small window where a user can take it back. Getting it wrong in either
 * direction is bad: too eager and every pocket trigger becomes an alert that wakes
 * up the whole crew, too forgiving and a real alert is delayed.
 *
 * The rule that matters: expiry is evaluated against the server clock at the moment
 * activation is attempted, never against a duration the client counted down itself. A
 * device that was asleep, throttled, or simply lying about the time cannot talk its way
 * past a cancellation.
 */

export interface CountdownState {
  readonly id: string;
  readonly userId: string;
  readonly sessionId: string | null;
  readonly status: CountdownStatus;
  readonly startedAt: Date;
  readonly expiresAt: Date;
  readonly cancelledAt: Date | null;
  readonly cancelReason: string | null;
  readonly alertId: string | null;
  /** Minted with the countdown, so a crash mid-countdown still deduplicates on retry. */
  readonly activationIdempotencyKey: string;
}

export interface StartCountdownInput {
  readonly id: string;
  readonly userId: string;
  readonly sessionId: string | null;
  readonly durationSeconds: number;
  readonly activationIdempotencyKey: string;
  readonly now: Date;
}

export function startCountdown(input: StartCountdownInput): CountdownState {
  return {
    id: input.id,
    userId: input.userId,
    sessionId: input.sessionId,
    status: CountdownStatus.Pending,
    startedAt: input.now,
    expiresAt: new Date(input.now.getTime() + input.durationSeconds * 1000),
    cancelledAt: null,
    cancelReason: null,
    alertId: null,
    activationIdempotencyKey: input.activationIdempotencyKey,
  };
}

export function hasExpired(state: CountdownState, now: Date): boolean {
  return now.getTime() >= state.expiresAt.getTime();
}

export function remainingMs(state: CountdownState, now: Date): number {
  return Math.max(0, state.expiresAt.getTime() - now.getTime());
}

export function cancel(
  state: CountdownState,
  reason: string,
  now: Date,
): Result<CountdownState, DomainError> {
  if (state.status === CountdownStatus.Cancelled) {
    // Cancelling twice is what happens when someone taps the button and the first
    // request is slow. Treating it as success avoids showing an error for something
    // that already went the way the user wanted.
    return ok(state);
  }

  if (state.status === CountdownStatus.Activated) {
    return err(
      DomainErrors.invalidState('This countdown already triggered an alert.', {
        alertId: state.alertId,
      }),
    );
  }

  if (hasExpired(state, now)) {
    // The window closed before the cancellation arrived. We do not pretend otherwise:
    // the alert is going out and the user is told so, rather than being shown a
    // "cancelled" screen while their workers get a message.
    return err(
      DomainErrors.preconditionFailed(
        'The countdown already finished. Resolve the alert instead of cancelling it.',
      ),
    );
  }

  return ok({
    ...state,
    status: CountdownStatus.Cancelled,
    cancelledAt: now,
    cancelReason: reason,
  });
}

export function markActivated(
  state: CountdownState,
  alertId: string,
): Result<CountdownState, DomainError> {
  if (state.status === CountdownStatus.Cancelled) {
    return err(DomainErrors.invalidState('This countdown was cancelled.'));
  }
  if (state.status === CountdownStatus.Activated) {
    return ok(state);
  }
  return ok({ ...state, status: CountdownStatus.Activated, alertId });
}

/**
 * Whether an activation request against this countdown should be honoured.
 *
 * Deliberately permissive about lateness. A client that was offline when the countdown
 * expired and flushes the activation ten minutes later is still reporting a real event,
 * so we accept it and use the original expiry as the occurrence time. Only cancellation
 * stops an activation, never the passage of time.
 */
export function canActivate(state: CountdownState): Result<void, DomainError> {
  if (state.status === CountdownStatus.Cancelled) {
    return err(DomainErrors.invalidState('This countdown was cancelled before it finished.'));
  }
  return ok();
}
