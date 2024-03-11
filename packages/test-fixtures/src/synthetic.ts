import { SeededRandom } from './random';

/**
 * Every value here is invented.
 *
 * - Email addresses use example.com and example.org, reserved by RFC 2606 and
 *   guaranteed never to belong to anyone.
 * - Phone numbers use +1 555 01xx, the North American range set aside for fiction, and
 *   +44 7700 900xxx, the UK Ofcom drama range.
 * - Coordinates are scattered around an invented origin in the North Sea, so no fixture
 *   ever points at a real home, office or landmark.
 *
 * That is a deliberate constraint, not a formality: seed data has a habit of ending up in
 * screenshots, and screenshots end up in a portfolio that strangers read.
 */

export const SYNTHETIC_ORIGIN = {
  latitude: 53.5,
  longitude: 3.2,
  label: 'North Sea, invented location for demonstration data',
} as const;

const GIVEN_NAMES = [
  'Ada', 'Bram', 'Cleo', 'Dara', 'Emil', 'Fenna', 'Gus', 'Hana',
  'Ivo', 'Juno', 'Kai', 'Lore', 'Mika', 'Nele', 'Otto', 'Pia',
  'Quin', 'Roos', 'Sem', 'Tess', 'Uma', 'Vik', 'Wren', 'Yara',
] as const;

const FAMILY_NAMES = [
  'Aalders', 'Bakker', 'Cordova', 'Duarte', 'Ekland', 'Ferreira', 'Gundersen',
  'Halvorsen', 'Ilves', 'Janssen', 'Kovac', 'Lindqvist', 'Moretti', 'Nyland',
  'Oduya', 'Petrov', 'Quist', 'Rasmussen', 'Sorensen', 'Tavares',
] as const;

const RELATIONSHIPS = [
  'Partner', 'Parent', 'Sibling', 'Housemate', 'Friend', 'Colleague', 'Neighbour',
] as const;

const DESTINATIONS = [
  'Evening class', 'Late shift', 'Running route', 'Station walk', 'Cycle home',
  'Client visit', 'Dog walk', 'Airport transfer',
] as const;

const OPERATOR_NOTES = [
  'Attempted voice contact, no answer. Continuing to monitor position.',
  'Subject moving steadily along the expected route.',
  'Primary contact acknowledged and is calling the subject directly.',
  'Position has not updated for four minutes. Escalating priority.',
  'Subject confirmed safe by secondary contact. Preparing to resolve.',
] as const;

export interface SyntheticPerson {
  readonly displayName: string;
  readonly email: string;
  readonly phone: string;
}

export interface SyntheticContact extends SyntheticPerson {
  readonly relationship: string;
  readonly priority: number;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '.');
}

export function syntheticPerson(random: SeededRandom, index: number): SyntheticPerson {
  const given = random.pick(GIVEN_NAMES);
  const family = random.pick(FAMILY_NAMES);
  const displayName = `${given} ${family}`;
  return {
    displayName,
    // The index keeps addresses unique even when the name pool repeats.
    email: `${slug(given)}.${slug(family)}${index}@example.com`,
    phone: random.bool()
      ? `+1 555 01${String(random.int(0, 99)).padStart(2, '0')}`
      : `+44 7700 900${String(random.int(0, 999)).padStart(3, '0')}`,
  };
}

export function syntheticContact(
  random: SeededRandom,
  index: number,
  priority: number,
): SyntheticContact {
  return {
    ...syntheticPerson(random, index),
    relationship: random.pick(RELATIONSHIPS),
    priority,
  };
}

export function syntheticDestination(random: SeededRandom): string {
  return random.pick(DESTINATIONS);
}

export function syntheticOperatorNote(random: SeededRandom): string {
  return random.pick(OPERATOR_NOTES);
}

/** A point within roughly `spreadMetres` of the invented origin. */
export function syntheticCoordinates(
  random: SeededRandom,
  spreadMetres = 2000,
): { latitude: number; longitude: number } {
  const metresPerDegreeLatitude = 111_320;
  const metresPerDegreeLongitude =
    metresPerDegreeLatitude * Math.cos((SYNTHETIC_ORIGIN.latitude * Math.PI) / 180);

  return {
    latitude:
      SYNTHETIC_ORIGIN.latitude + random.float(-spreadMetres, spreadMetres) / metresPerDegreeLatitude,
    longitude:
      SYNTHETIC_ORIGIN.longitude +
      random.float(-spreadMetres, spreadMetres) / metresPerDegreeLongitude,
  };
}

/**
 * A plausible movement track: someone walking, not teleporting. Used by the demo
 * scenarios so the operator map shows a line rather than a scatter of unrelated dots.
 */
export function syntheticTrack(
  random: SeededRandom,
  pointCount: number,
  startedAt: Date,
  intervalSeconds = 20,
): Array<{ latitude: number; longitude: number; accuracyMetres: number; capturedAt: Date }> {
  const start = syntheticCoordinates(random, 1500);
  const bearing = random.float(0, Math.PI * 2);
  const metresPerStep = random.float(15, 40);
  const metresPerDegreeLatitude = 111_320;
  const metresPerDegreeLongitude =
    metresPerDegreeLatitude * Math.cos((SYNTHETIC_ORIGIN.latitude * Math.PI) / 180);

  const points = [];
  let { latitude, longitude } = start;
  let heading = bearing;

  for (let i = 0; i < pointCount; i += 1) {
    // A small random turn each step keeps the path from being a perfectly straight line.
    heading += random.float(-0.25, 0.25);
    latitude += (Math.cos(heading) * metresPerStep) / metresPerDegreeLatitude;
    longitude += (Math.sin(heading) * metresPerStep) / metresPerDegreeLongitude;
    points.push({
      latitude,
      longitude,
      accuracyMetres: random.float(5, 45),
      capturedAt: new Date(startedAt.getTime() + i * intervalSeconds * 1000),
    });
  }

  return points;
}

/** Passwords used by the demo accounts. Documented publicly; they guard nothing real. */
export const DEMO_PASSWORD = 'guardianlink-demo-passphrase';
