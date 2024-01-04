/**
 * Result carries expected failures as values instead of exceptions.
 *
 * The rule in this codebase: anything a caller can reasonably be expected to handle
 * (not found, forbidden, conflict, invalid input) comes back as a Result. Anything that
 * means the process is in a bad state (lost database connection, bug) still throws.
 *
 * Without this split, every use case ends up with a try/catch that cannot tell the two
 * apart, and expected failures start turning into 500s.
 */

export type Ok<T> = { readonly ok: true; readonly value: T };
export type Err<E> = { readonly ok: false; readonly error: E };
export type Result<T, E> = Ok<T> | Err<E>;

export function ok(): Ok<void>;
export function ok<T>(value: T): Ok<T>;
export function ok<T>(value?: T): Ok<T | undefined> {
  return { ok: true, value };
}

export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}

export function isOk<T, E>(result: Result<T, E>): result is Ok<T> {
  return result.ok;
}

export function isErr<T, E>(result: Result<T, E>): result is Err<E> {
  return !result.ok;
}

/** Applies fn to the success value, leaving a failure untouched. */
export function mapResult<T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> {
  return result.ok ? ok(fn(result.value)) : result;
}

/** Chains another fallible step. Short-circuits on the first failure. */
export function andThen<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => Result<U, E>,
): Result<U, E> {
  return result.ok ? fn(result.value) : result;
}

/**
 * Pulls the value out or throws. Only for places where a failure genuinely is a bug,
 * such as test setup or a value the caller has already checked.
 */
export function unwrap<T, E>(result: Result<T, E>): T {
  if (result.ok) return result.value;
  throw new Error(`unwrap called on a failed Result: ${JSON.stringify(result.error)}`);
}

/** Collects an array of Results into a Result of array, failing on the first error. */
export function collect<T, E>(results: ReadonlyArray<Result<T, E>>): Result<T[], E> {
  const values: T[] = [];
  for (const result of results) {
    if (!result.ok) return result;
    values.push(result.value);
  }
  return ok(values);
}
