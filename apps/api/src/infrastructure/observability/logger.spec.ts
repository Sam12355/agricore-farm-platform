import { JsonLogger, redact } from './logger';

function capture(): { lines: string[]; sink: (line: string) => void } {
  const lines: string[] = [];
  return { lines, sink: (line: string) => lines.push(line) };
}

function makeLogger(sink: (line: string) => void) {
  return new JsonLogger({ level: 'debug', service: 'api', environment: 'test', sink });
}

describe('redact', () => {
  it('removes a password at the top level', () => {
    expect(redact({ password: 'hunter2' })).toEqual({ password: '[redacted]' });
  });

  it('removes coordinates, which is the whole reason this exists', () => {
    expect(redact({ latitude: 53.5, longitude: 3.2, accuracyMetres: 10 })).toEqual({
      latitude: '[redacted]',
      longitude: '[redacted]',
      accuracyMetres: 10,
    });
  });

  it('reaches into nested objects', () => {
    const output = redact({
      alert: { id: 'alert-1', lastKnownLocation: { latitude: 1, longitude: 2 } },
    }) as Record<string, Record<string, Record<string, unknown>>>;

    expect(output['alert']?.['id']).toBe('alert-1');
    expect(output['alert']?.['lastKnownLocation']?.['latitude']).toBe('[redacted]');
  });

  it('reaches into arrays', () => {
    const output = redact({ points: [{ latitude: 1 }, { latitude: 2 }] }) as {
      points: Array<Record<string, unknown>>;
    };
    expect(output.points.every((point) => point['latitude'] === '[redacted]')).toBe(true);
  });

  it('matches suffixes, so refreshToken and accessToken both go', () => {
    expect(redact({ refreshToken: 'x', accessToken: 'y', workerViewToken: 'z' })).toEqual({
      refreshToken: '[redacted]',
      accessToken: '[redacted]',
      workerViewToken: '[redacted]',
    });
  });

  it('matches case-insensitively', () => {
    expect(redact({ PassWord: 'x', EMAIL: 'y' })).toEqual({
      PassWord: '[redacted]',
      EMAIL: '[redacted]',
    });
  });

  it('keeps identifiers, which are what makes a log useful', () => {
    expect(redact({ userId: 'u1', alertId: 'i1', correlationId: 'c1' })).toEqual({
      userId: 'u1',
      alertId: 'i1',
      correlationId: 'c1',
    });
  });

  it('formats dates rather than dropping them', () => {
    expect(redact({ at: new Date('2026-03-14T19:45:00.000Z') })).toEqual({
      at: '2026-03-14T19:45:00.000Z',
    });
  });

  it('reduces an Error to name and message, leaving the stack out of the log body', () => {
    expect(redact({ cause: new TypeError('bad input') })).toEqual({
      cause: { name: 'TypeError', message: 'bad input' },
    });
  });

  it('stops at a depth limit so a cyclic-ish structure cannot spin', () => {
    let deep: Record<string, unknown> = { value: 1 };
    for (let i = 0; i < 20; i += 1) deep = { nested: deep };
    expect(JSON.stringify(redact(deep))).toContain('[truncated]');
  });
});

describe('JsonLogger', () => {
  it('writes one JSON object per line', () => {
    const { lines, sink } = capture();
    makeLogger(sink).info('something happened', { userId: 'u1' });

    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0] ?? '{}');
    expect(parsed).toMatchObject({
      level: 'info',
      service: 'api',
      env: 'test',
      msg: 'something happened',
      userId: 'u1',
    });
  });

  it('redacts context on the way out, even when the caller passes a whole request body', () => {
    const { lines, sink } = capture();
    makeLogger(sink).info('registration attempt', {
      body: { email: 'ada@example.com', password: 'hunter2' },
    });

    expect(lines[0]).not.toContain('hunter2');
    expect(lines[0]).not.toContain('ada@example.com');
  });

  it('carries child bindings into every line', () => {
    const { lines, sink } = capture();
    const child = makeLogger(sink).child({ correlationId: 'abc123' });
    child.warn('slow query');

    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({ correlationId: 'abc123' });
  });

  it('redacts bindings too, not just per-call context', () => {
    const { lines, sink } = capture();
    makeLogger(sink).child({ email: 'ada@example.com' }).info('hello');
    expect(lines[0]).not.toContain('ada@example.com');
  });

  it('honours the level threshold', () => {
    const { lines, sink } = capture();
    const logger = new JsonLogger({ level: 'warn', service: 'api', environment: 'test', sink });

    logger.debug('not this');
    logger.info('nor this');
    logger.warn('this one');
    logger.error('and this one');

    expect(lines).toHaveLength(2);
  });

  it('produces a timestamp that parses', () => {
    const { lines, sink } = capture();
    makeLogger(sink).info('x');
    const parsed = JSON.parse(lines[0] ?? '{}');
    expect(Number.isNaN(Date.parse(parsed.time))).toBe(false);
  });
});
