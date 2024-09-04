import { DomainErrors, type DomainError } from './errors';
import { err, ok, type Result } from './result';

export interface Coordinates {
  readonly latitude: number;
  readonly longitude: number;
}

export interface GeoPoint extends Coordinates {
  /** Horizontal accuracy in metres, as reported by the device. */
  readonly accuracyMetres: number;
  /** When the device captured the fix, not when the server received it. */
  readonly capturedAt: Date;
}

const MIN_LATITUDE = -90;
const MAX_LATITUDE = 90;
const MIN_LONGITUDE = -180;
const MAX_LONGITUDE = 180;

/**
 * Accuracy worse than this is kept but flagged. We do not drop it, because during an
 * alert a coarse fix is still better than nothing, and the manager needs to know
 * the difference between "somewhere in this building" and "somewhere in this city".
 */
export const COARSE_ACCURACY_THRESHOLD_METRES = 500;

export function createGeoPoint(input: {
  latitude: number;
  longitude: number;
  accuracyMetres: number;
  capturedAt: Date;
}): Result<GeoPoint, DomainError> {
  if (!Number.isFinite(input.latitude) || !Number.isFinite(input.longitude)) {
    return err(DomainErrors.validation('Coordinates must be finite numbers.'));
  }
  if (input.latitude < MIN_LATITUDE || input.latitude > MAX_LATITUDE) {
    return err(DomainErrors.validation('Latitude must be between -90 and 90.'));
  }
  if (input.longitude < MIN_LONGITUDE || input.longitude > MAX_LONGITUDE) {
    return err(DomainErrors.validation('Longitude must be between -180 and 180.'));
  }
  if (!Number.isFinite(input.accuracyMetres) || input.accuracyMetres < 0) {
    return err(DomainErrors.validation('Accuracy must be a non-negative number of metres.'));
  }
  if (Number.isNaN(input.capturedAt.getTime())) {
    return err(DomainErrors.validation('Capture time is not a valid date.'));
  }
  return ok({
    latitude: input.latitude,
    longitude: input.longitude,
    accuracyMetres: input.accuracyMetres,
    capturedAt: input.capturedAt,
  });
}

export function isCoarse(point: GeoPoint): boolean {
  return point.accuracyMetres > COARSE_ACCURACY_THRESHOLD_METRES;
}

const EARTH_RADIUS_METRES = 6_371_008.8;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/** Great-circle distance. Used for movement thresholds and point thinning. */
export function distanceMetres(a: Coordinates, b: Coordinates): number {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_METRES * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Rounds coordinates down to a coarse grid, for logs and analytics.
 *
 * Three decimal places is roughly 110 metres at the equator. Precise enough to say
 * "the alert was in this district", nowhere near precise enough to identify a home.
 */
export function coarsen(point: Coordinates, decimals = 3): Coordinates {
  const factor = 10 ** decimals;
  return {
    latitude: Math.round(point.latitude * factor) / factor,
    longitude: Math.round(point.longitude * factor) / factor,
  };
}
