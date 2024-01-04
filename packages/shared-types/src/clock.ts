/**
 * Every piece of time-dependent behaviour takes a Clock rather than calling Date.now().
 *
 * Countdown expiry, token lifetimes, escalation windows, retry backoff and retention
 * cutoffs are all driven through here, which is why the test suite contains no sleeps
 * and runs in a couple of seconds.
 */
export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

/** Test double. Time only moves when a test moves it. */
export class FixedClock implements Clock {
  private current: Date;

  constructor(start: Date | string = '2026-01-01T00:00:00.000Z') {
    this.current = typeof start === 'string' ? new Date(start) : new Date(start.getTime());
  }

  now(): Date {
    return new Date(this.current.getTime());
  }

  advanceBy(milliseconds: number): void {
    this.current = new Date(this.current.getTime() + milliseconds);
  }

  advanceBySeconds(seconds: number): void {
    this.advanceBy(seconds * 1000);
  }

  set(instant: Date | string): void {
    this.current = typeof instant === 'string' ? new Date(instant) : new Date(instant.getTime());
  }
}

export const seconds = (n: number): number => n * 1000;
export const minutes = (n: number): number => n * 60_000;
export const hours = (n: number): number => n * 3_600_000;
export const days = (n: number): number => n * 86_400_000;
