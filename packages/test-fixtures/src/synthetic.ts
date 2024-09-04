import { SeededRandom } from './random';

/**
 * Every value here is invented.
 *
 * - Email addresses use example.com and example.org, reserved by RFC 2606 and
 *   guaranteed never to belong to anyone.
 * - Phone numbers use +1 555 01xx, the North American range set aside for fiction, and
 *   +44 7700 900xxx, the UK Ofcom drama range.
 * - Coordinates are scattered around an invented origin in the North Sea, so no fixture
 *   ever points at a real farm, holding or landmark. Open water is an odd place for a
 *   tractor, and that is the point: nobody can mistake demo data for a real business.
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

const JOB_ROLES = [
  'Tractor operator', 'Agronomist', 'Irrigation technician', 'Harvest lead',
  'Machinery mechanic', 'Sprayer operator', 'Stockperson',
] as const;

const DESTINATIONS = [
  'North Field', 'Block 4 orchard', 'River Paddock', 'Home Block',
  'West Terrace', 'Pump house', 'Grain store', 'South Headland',
] as const;

const MANAGER_NOTES = [
  'Tried the radio, no answer. Still watching the machine position.',
  'Machine moving steadily along the planned pass.',
  'Primary worker acknowledged and is driving out to the block.',
  'Position has not updated for four minutes. Raising priority.',
  'Second worker reached the block and reports the job is finished. Preparing to resolve.',
] as const;

export interface SyntheticPerson {
  readonly displayName: string;
  readonly email: string;
  readonly phone: string;
}

export interface SyntheticWorker extends SyntheticPerson {
  readonly jobRole: string;
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

export function syntheticWorker(
  random: SeededRandom,
  index: number,
  priority: number,
): SyntheticWorker {
  return {
    ...syntheticPerson(random, index),
    jobRole: random.pick(JOB_ROLES),
    priority,
  };
}

export function syntheticDestination(random: SeededRandom): string {
  return random.pick(DESTINATIONS);
}

export function syntheticManagerNote(random: SeededRandom): string {
  return random.pick(MANAGER_NOTES);
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
 * A plausible movement track: a machine working across a block, not teleporting. Used by
 * the demo scenarios so the manager map shows a line rather than a scatter of unrelated
 * dots.
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
export const DEMO_PASSWORD = 'agricore-demo-passphrase';
