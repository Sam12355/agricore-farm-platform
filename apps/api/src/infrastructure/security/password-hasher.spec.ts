import { FastTestPasswordHasher, ScryptPasswordHasher } from './password-hasher';

describe('ScryptPasswordHasher', () => {
  const hasher = new ScryptPasswordHasher();

  it('verifies a password it hashed', async () => {
    const hash = await hasher.hash('correct horse battery staple');
    await expect(hasher.verify('correct horse battery staple', hash)).resolves.toBe(true);
  });

  it('rejects the wrong password', async () => {
    const hash = await hasher.hash('correct horse battery staple');
    await expect(hasher.verify('Correct horse battery staple', hash)).resolves.toBe(false);
  });

  it('never stores the plaintext', async () => {
    const hash = await hasher.hash('hunter2-and-then-some-more');
    expect(hash).not.toContain('hunter2');
  });

  it('salts, so the same password hashes differently every time', async () => {
    const a = await hasher.hash('the same passphrase twice');
    const b = await hasher.hash('the same passphrase twice');
    expect(a).not.toBe(b);
    await expect(hasher.verify('the same passphrase twice', a)).resolves.toBe(true);
    await expect(hasher.verify('the same passphrase twice', b)).resolves.toBe(true);
  });

  it('records its parameters in the stored format so cost can be raised later', async () => {
    const hash = await hasher.hash('a reasonable length passphrase');
    const [algorithm, n, r, p] = hash.split('$');
    expect(algorithm).toBe('scrypt');
    expect(Number(n)).toBe(2 ** 17);
    expect(Number(r)).toBe(8);
    expect(Number(p)).toBe(1);
  });

  it('does not need a rehash at the current parameters', async () => {
    const hash = await hasher.hash('a reasonable length passphrase');
    expect(hasher.needsRehash(hash)).toBe(false);
  });

  it('asks for a rehash when the stored cost is below the current one', () => {
    // What a hash written by an older deployment would look like.
    const older = ['scrypt', 2 ** 14, 8, 1, 'c2FsdA==', 'aGFzaA=='].join('$');
    expect(hasher.needsRehash(older)).toBe(true);
  });

  it('treats an unparseable hash as needing a rehash rather than crashing', () => {
    expect(hasher.needsRehash('not-a-hash')).toBe(true);
  });

  it('returns false rather than throwing when the stored hash is corrupt', async () => {
    await expect(hasher.verify('anything', 'garbage$$$')).resolves.toBe(false);
  });

  it('normalises unicode so the same passphrase typed on two keyboards still matches', async () => {
    // Precomposed e-acute against e plus a combining acute accent. They render
    // identically and are different byte sequences, which is what bites someone who
    // sets a password on one device and types it on another.
    const composed = 'passphrase-café-longer';
    const decomposed = 'passphrase-café-longer';
    expect(composed).not.toBe(decomposed);

    const hash = await hasher.hash(composed);
    await expect(hasher.verify(decomposed, hash)).resolves.toBe(true);
  });
});

describe('FastTestPasswordHasher', () => {
  it('behaves the same way, only cheaper', async () => {
    const hasher = new FastTestPasswordHasher();
    const hash = await hasher.hash('a test passphrase');
    await expect(hasher.verify('a test passphrase', hash)).resolves.toBe(true);
    await expect(hasher.verify('another passphrase', hash)).resolves.toBe(false);
  });
});
