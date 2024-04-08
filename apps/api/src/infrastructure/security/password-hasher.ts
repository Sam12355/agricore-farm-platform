import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

import type { PasswordHasher } from '../../application/ports';

/**
 * promisify(scrypt) loses the options overload in its types, so this is written out by
 * hand. The options are not optional here: the memory-hard parameters are the entire
 * reason for using scrypt rather than a fast hash.
 */
function scryptAsync(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, options, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

/**
 * scrypt from the Node standard library.
 *
 * Argon2id would be the first choice on a greenfield service. I did not use it here
 * because every maintained Argon2 binding for Node needs a native build, and this
 * portfolio has to clone and run on a Windows machine with no toolchain. A dependency
 * that fails to install is worse than a slightly older KDF that ships with the runtime.
 *
 * scrypt is memory-hard, it is in the standard library, and OWASP still lists it as an
 * acceptable choice. The parameters below are the OWASP minimum (N=2^17, r=8, p=1), and
 * the format carries them so the cost can be raised later without invalidating anyone's
 * password: needsRehash() spots the older parameters and login upgrades the stored hash
 * in place while the plaintext happens to be in hand.
 *
 * Stored format: scrypt$N$r$p$saltBase64$hashBase64
 */

const CURRENT = { N: 2 ** 17, r: 8, p: 1, keyLength: 64 } as const;
const SALT_BYTES = 16;

function encode(params: { N: number; r: number; p: number }, salt: Buffer, hash: Buffer): string {
  return [
    'scrypt',
    params.N,
    params.r,
    params.p,
    salt.toString('base64'),
    hash.toString('base64'),
  ].join('$');
}

interface ParsedHash {
  readonly N: number;
  readonly r: number;
  readonly p: number;
  readonly salt: Buffer;
  readonly hash: Buffer;
}

function parse(encoded: string): ParsedHash | null {
  const parts = encoded.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null;

  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return null;

  try {
    return {
      N,
      r,
      p,
      salt: Buffer.from(parts[4] ?? '', 'base64'),
      hash: Buffer.from(parts[5] ?? '', 'base64'),
    };
  } catch {
    return null;
  }
}

export class ScryptPasswordHasher implements PasswordHasher {
  async hash(plaintext: string): Promise<string> {
    const salt = randomBytes(SALT_BYTES);
    const derived = (await scryptAsync(plaintext.normalize('NFKC'), salt, CURRENT.keyLength, {
      N: CURRENT.N,
      r: CURRENT.r,
      p: CURRENT.p,
      // Node's default maxmem is 32 MB, which N=2^17 exceeds. Without this the call
      // throws rather than being slow, which is a confusing way to find out.
      maxmem: 256 * 1024 * 1024,
    }));

    return encode(CURRENT, salt, derived);
  }

  async verify(plaintext: string, encoded: string): Promise<boolean> {
    const parsed = parse(encoded);
    if (parsed === null) return false;

    const derived = (await scryptAsync(plaintext.normalize('NFKC'), parsed.salt, parsed.hash.length, {
      N: parsed.N,
      r: parsed.r,
      p: parsed.p,
      maxmem: 256 * 1024 * 1024,
    }));

    if (derived.length !== parsed.hash.length) return false;
    // Constant-time compare. A byte-by-byte comparison leaks how much of the hash
    // matched, which is enough to reconstruct it one byte at a time.
    return timingSafeEqual(derived, parsed.hash);
  }

  needsRehash(encoded: string): boolean {
    const parsed = parse(encoded);
    if (parsed === null) return true;
    return parsed.N < CURRENT.N || parsed.r < CURRENT.r || parsed.p < CURRENT.p;
  }
}

/**
 * A deliberately cheap hasher for tests.
 *
 * The real one takes roughly 100 ms per call by design, and an end-to-end suite that
 * registers a dozen accounts should not spend two seconds on key derivation. This is
 * bound only in the test module and never reachable from a running server.
 */
export class FastTestPasswordHasher implements PasswordHasher {
  private static readonly PARAMS = { N: 2 ** 12, r: 8, p: 1 };

  async hash(plaintext: string): Promise<string> {
    const salt = randomBytes(SALT_BYTES);
    const derived = (await scryptAsync(plaintext.normalize('NFKC'), salt, 32, {
      ...FastTestPasswordHasher.PARAMS,
      maxmem: 64 * 1024 * 1024,
    }));
    return encode(FastTestPasswordHasher.PARAMS, salt, derived);
  }

  async verify(plaintext: string, encoded: string): Promise<boolean> {
    const parsed = parse(encoded);
    if (parsed === null) return false;
    const derived = (await scryptAsync(plaintext.normalize('NFKC'), parsed.salt, parsed.hash.length, {
      N: parsed.N,
      r: parsed.r,
      p: parsed.p,
      maxmem: 64 * 1024 * 1024,
    }));
    if (derived.length !== parsed.hash.length) return false;
    return timingSafeEqual(derived, parsed.hash);
  }

  needsRehash(): boolean {
    return false;
  }
}
