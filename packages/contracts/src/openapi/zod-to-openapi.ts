import { z, type ZodTypeAny } from 'zod';

/**
 * Converts the Zod schemas in this package into OpenAPI 3.1 schema objects.
 *
 * Written here rather than pulled from a library because the whole argument for
 * single-sourcing the contracts is that the published document is derived from the same
 * definition the server validates against. A separate decorator-driven document, which is
 * what @nestjs/swagger produces, can drift from the validator without anything failing.
 * This cannot: if a field is added to a schema, it appears in the document.
 *
 * It handles the subset of Zod this API actually uses, and throws on anything else rather
 * than silently emitting `{}`. An OpenAPI document that quietly describes a field as
 * "anything" is worse than one that fails to build.
 */

export interface OpenApiSchema {
  type?: string | string[];
  format?: string;
  description?: string;
  enum?: unknown[];
  const?: unknown;
  items?: OpenApiSchema;
  properties?: Record<string, OpenApiSchema>;
  required?: string[];
  additionalProperties?: boolean | OpenApiSchema;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  pattern?: string;
  default?: unknown;
  nullable?: boolean;
  oneOf?: OpenApiSchema[];
  allOf?: OpenApiSchema[];
}

class UnsupportedSchemaError extends Error {
  constructor(typeName: string, path: string) {
    super(
      `Cannot convert ${typeName} at ${path || '(root)'} to OpenAPI. ` +
        'Add a case to zod-to-openapi.ts rather than letting the document describe it as "anything".',
    );
    this.name = 'UnsupportedSchemaError';
  }
}

function checksOf(schema: ZodTypeAny): Array<{ kind: string; value?: unknown; regex?: RegExp }> {
  const definition = schema._def as { checks?: Array<{ kind: string; value?: unknown; regex?: RegExp }> };
  return definition.checks ?? [];
}

function applyStringChecks(schema: z.ZodString, output: OpenApiSchema): OpenApiSchema {
  for (const check of checksOf(schema)) {
    switch (check.kind) {
      case 'min':
        output.minLength = check.value as number;
        break;
      case 'max':
        output.maxLength = check.value as number;
        break;
      case 'email':
        output.format = 'email';
        break;
      case 'uuid':
        output.format = 'uuid';
        break;
      case 'url':
        output.format = 'uri';
        break;
      case 'datetime':
        output.format = 'date-time';
        break;
      case 'regex':
        if (check.regex instanceof RegExp) output.pattern = check.regex.source;
        break;
      default:
        break;
    }
  }
  return output;
}

function applyNumberChecks(schema: z.ZodNumber, output: OpenApiSchema): OpenApiSchema {
  for (const check of checksOf(schema)) {
    switch (check.kind) {
      case 'min':
        output.minimum = check.value as number;
        break;
      case 'max':
        output.maximum = check.value as number;
        break;
      case 'int':
        output.type = 'integer';
        break;
      default:
        break;
    }
  }
  return output;
}

export function toOpenApiSchema(schema: ZodTypeAny, path = ''): OpenApiSchema {
  const description = schema.description;
  const withDescription = (output: OpenApiSchema): OpenApiSchema =>
    description === undefined ? output : { ...output, description };

  if (schema instanceof z.ZodString) {
    return withDescription(applyStringChecks(schema, { type: 'string' }));
  }

  if (schema instanceof z.ZodNumber) {
    return withDescription(applyNumberChecks(schema, { type: 'number' }));
  }

  if (schema instanceof z.ZodBoolean) return withDescription({ type: 'boolean' });

  if (schema instanceof z.ZodLiteral) {
    // A literal is how the contracts express "you must acknowledge the demo notice" and
    // "tokenType is always Bearer". Both belong in the document as a const.
    return withDescription({ const: schema.value });
  }

  if (schema instanceof z.ZodEnum) {
    return withDescription({ type: 'string', enum: [...schema.options] });
  }

  if (schema instanceof z.ZodArray) {
    const output: OpenApiSchema = {
      type: 'array',
      items: toOpenApiSchema(schema.element as ZodTypeAny, `${path}[]`),
    };
    const definition = schema._def as {
      minLength?: { value: number } | null;
      maxLength?: { value: number } | null;
    };
    if (definition.minLength) output.minItems = definition.minLength.value;
    if (definition.maxLength) output.maxItems = definition.maxLength.value;
    return withDescription(output);
  }

  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, ZodTypeAny>;
    const properties: Record<string, OpenApiSchema> = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(shape)) {
      properties[key] = toOpenApiSchema(value, path ? `${path}.${key}` : key);
      // A field with a default is not required of the caller: the server fills it in.
      if (!value.isOptional() && !(value instanceof z.ZodDefault)) required.push(key);
    }

    return withDescription({
      type: 'object',
      properties,
      ...(required.length > 0 ? { required } : {}),
      additionalProperties: false,
    });
  }

  if (schema instanceof z.ZodOptional) {
    return toOpenApiSchema(schema.unwrap() as ZodTypeAny, path);
  }

  if (schema instanceof z.ZodNullable) {
    const inner = toOpenApiSchema(schema.unwrap() as ZodTypeAny, path);
    // OpenAPI 3.1 expresses nullability as a type union, not the 3.0 `nullable: true`.
    return {
      ...inner,
      type: inner.type === undefined ? 'null' : [inner.type as string, 'null'],
    };
  }

  if (schema instanceof z.ZodDefault) {
    const definition = schema._def as { innerType: ZodTypeAny; defaultValue: () => unknown };
    return { ...toOpenApiSchema(definition.innerType, path), default: definition.defaultValue() };
  }

  if (schema instanceof z.ZodEffects) {
    // A refine or transform wrapper. The cross-field rule it carries cannot be expressed
    // in JSON Schema, so the underlying shape is emitted and the rule is documented in
    // the endpoint description instead of being silently dropped.
    return toOpenApiSchema((schema._def as { schema: ZodTypeAny }).schema, path);
  }

  if (schema instanceof z.ZodRecord) {
    return withDescription({
      type: 'object',
      additionalProperties: toOpenApiSchema(schema.valueSchema as ZodTypeAny, `${path}.*`),
    });
  }

  if (schema instanceof z.ZodUnion) {
    const options = (schema._def as { options: ZodTypeAny[] }).options;
    return withDescription({
      oneOf: options.map((option, index) => toOpenApiSchema(option, `${path}|${index}`)),
    });
  }

  if (schema instanceof z.ZodUnknown || schema instanceof z.ZodAny) {
    return withDescription({});
  }

  throw new UnsupportedSchemaError(schema.constructor.name, path);
}
