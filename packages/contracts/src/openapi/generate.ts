import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { buildOpenApiDocument } from './document';

/**
 * Writes the OpenAPI document to disk.
 *
 * Committed rather than served only at runtime, so the mobile clients can generate their
 * request models from a file in the repository without standing the API up, and so a
 * change to the API surface shows up as a reviewable diff in a pull request.
 *
 *   pnpm --filter @agricore/contracts openapi
 */
function main(): void {
  const document = buildOpenApiDocument(process.env['APP_VERSION'] ?? '0.1.0');
  const target = resolve(__dirname, '..', '..', 'generated', 'openapi.json');

  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`, 'utf8');

  const paths = Object.keys(document['paths'] as Record<string, unknown>).length;
  const schemas = Object.keys(
    (document['components'] as { schemas: Record<string, unknown> }).schemas,
  ).length;

  console.log(`wrote generated/openapi.json: ${paths} paths, ${schemas} schemas`);
}

main();
