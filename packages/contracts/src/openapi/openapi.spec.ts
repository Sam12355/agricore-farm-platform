import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { registerRequestSchema } from '../auth';
import { activateAlertSchema, alertSchema } from '../alerts';
import { buildOpenApiDocument } from './document';
import { toOpenApiSchema } from './zod-to-openapi';

describe('zod to OpenAPI conversion', () => {
  it('converts a string with its constraints rather than losing them', () => {
    const schema = toOpenApiSchema(z.string().min(3).max(80));
    expect(schema).toMatchObject({ type: 'string', minLength: 3, maxLength: 80 });
  });

  it('carries formats through, so a client generator can use them', () => {
    expect(toOpenApiSchema(z.string().uuid()).format).toBe('uuid');
    expect(toOpenApiSchema(z.string().email()).format).toBe('email');
    expect(toOpenApiSchema(z.string().datetime({ offset: true })).format).toBe('date-time');
  });

  it('converts an integer with bounds', () => {
    expect(toOpenApiSchema(z.number().int().min(1).max(100))).toMatchObject({
      type: 'integer',
      minimum: 1,
      maximum: 100,
    });
  });

  it('converts an enum to its options', () => {
    expect(toOpenApiSchema(z.enum(['low', 'high'])).enum).toEqual(['low', 'high']);
  });

  it('expresses nullability as an OpenAPI 3.1 type union, not the 3.0 nullable flag', () => {
    const schema = toOpenApiSchema(z.string().nullable());
    expect(schema.type).toEqual(['string', 'null']);
    expect(schema.nullable).toBeUndefined();
  });

  it('does not mark a field with a default as required of the caller', () => {
    const schema = toOpenApiSchema(z.object({ a: z.string(), b: z.string().default('x') }));
    expect(schema.required).toEqual(['a']);
    expect(schema.properties?.['b']?.default).toBe('x');
  });

  it('does not mark an optional field as required', () => {
    const schema = toOpenApiSchema(z.object({ a: z.string(), b: z.string().optional() }));
    expect(schema.required).toEqual(['a']);
  });

  it('closes objects, so an unexpected field is visibly not part of the contract', () => {
    expect(toOpenApiSchema(z.object({ a: z.string() })).additionalProperties).toBe(false);
  });

  it('carries array bounds', () => {
    expect(toOpenApiSchema(z.array(z.string()).min(1).max(50))).toMatchObject({
      type: 'array',
      minItems: 1,
      maxItems: 50,
    });
  });

  it('unwraps a refine so the underlying shape still reaches the document', () => {
    const schema = toOpenApiSchema(z.object({ a: z.string() }).refine(() => true));
    expect(schema.type).toBe('object');
    expect(schema.properties?.['a']).toBeDefined();
  });

  it('throws on a type it cannot express rather than emitting an empty schema', () => {
    // A document that silently describes a field as "anything" is worse than one that
    // fails to build, because nobody finds out until a client is written against it.
    expect(() => toOpenApiSchema(z.map(z.string(), z.string()))).toThrow(/Cannot convert/);
  });

  it('keeps descriptions written on the schema', () => {
    expect(toOpenApiSchema(z.string().describe('a note')).description).toBe('a note');
  });
});

describe('the generated document', () => {
  const document = buildOpenApiDocument('1.2.3');
  const paths = document['paths'] as Record<string, Record<string, unknown>>;
  const components = document['components'] as { schemas: Record<string, unknown> };

  it('is OpenAPI 3.1', () => {
    expect(document['openapi']).toBe('3.1.0');
  });

  it('takes its version from the caller', () => {
    expect((document['info'] as { version: string }).version).toBe('1.2.3');
  });

  it('states in the description that it is a demonstration', () => {
    expect((document['info'] as { description: string }).description).toContain(
      'not a working farm operations service',
    );
  });

  it('documents every application route under the version prefix', () => {
    const applicationPaths = Object.keys(paths).filter((path) => path.startsWith('/api/'));
    expect(applicationPaths.length).toBeGreaterThan(20);
    for (const path of applicationPaths) expect(path.startsWith('/api/v1/')).toBe(true);
  });

  it('leaves the operational probes unversioned', () => {
    expect(paths['/health']).toBeDefined();
    expect(paths['/ready']).toBeDefined();
  });

  it('says readiness can return 503, because that is what a load balancer reads', () => {
    const ready = paths['/ready']?.['get'] as { responses: Record<string, unknown> };
    expect(ready.responses['503']).toBeDefined();
  });

  it('requires a bearer token on every authenticated route', () => {
    const activate = paths['/api/v1/alerts/activate']?.['post'] as {
      security?: Array<Record<string, string[]>>;
    };
    expect(activate.security?.[0]?.['bearerAuth']).toBeDefined();
  });

  it('leaves the worker-view routes unauthenticated, because the token is the credential', () => {
    const view = paths['/api/v1/worker-view/{token}']?.['get'] as { security?: unknown };
    expect(view.security).toBeUndefined();
  });

  it('documents the mandatory Idempotency-Key on activation', () => {
    const activate = paths['/api/v1/alerts/activate']?.['post'] as {
      parameters: Array<{ name: string; required: boolean }>;
    };
    const header = activate.parameters.find((p) => p.name === 'Idempotency-Key');
    expect(header?.required).toBe(true);
  });

  it('documents the 409 for a reused key with a different body', () => {
    const activate = paths['/api/v1/alerts/activate']?.['post'] as {
      responses: Record<string, { description: string }>;
    };
    expect(activate.responses['409']?.description).toContain('different body');
  });

  it('references generated components rather than inlining any body shape', () => {
    const register = paths['/api/v1/auth/register']?.['post'] as {
      requestBody: { content: Record<string, { schema: { $ref: string } }> };
    };
    expect(register.requestBody.content['application/json']?.schema.$ref).toBe(
      '#/components/schemas/RegisterRequest',
    );
  });

  it('derives components from the same schemas the server validates with', () => {
    // If this drifts, the document is describing something the API does not accept.
    expect(components.schemas['RegisterRequest']).toEqual(
      toOpenApiSchema(registerRequestSchema, 'RegisterRequest'),
    );
    expect(components.schemas['Alert']).toEqual(toOpenApiSchema(alertSchema, 'Alert'));
    expect(components.schemas['ActivateAlert']).toEqual(
      toOpenApiSchema(activateAlertSchema, 'ActivateAlert'),
    );
  });

  it('describes the bearer scheme without implying it carries personal data', () => {
    const schemes = (
      document['components'] as { securitySchemes: Record<string, { description: string }> }
    ).securitySchemes;
    expect(schemes['bearerAuth']?.description).toContain('nothing that identifies a person');
  });

  it('gives every operation a summary and at least one response', () => {
    for (const [path, operations] of Object.entries(paths)) {
      for (const [method, operation] of Object.entries(operations)) {
        const typed = operation as { summary?: string; responses?: Record<string, unknown> };
        expect(typed.summary, `${method.toUpperCase()} ${path}`).toBeTruthy();
        expect(Object.keys(typed.responses ?? {}).length, `${method.toUpperCase()} ${path}`)
          .toBeGreaterThan(0);
      }
    }
  });

  it('serialises to JSON without circular references', () => {
    expect(() => JSON.stringify(document)).not.toThrow();
  });
});
