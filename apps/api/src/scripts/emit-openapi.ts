import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { buildOpenApiDocument } from '@agricore/contracts';

import { AppModule } from '../app.module';
import { developmentConfig } from '../config/configuration';

/**
 * Emits the OpenAPI document and checks it against the routes the application actually
 * registers.
 *
 * The document itself is generated in packages/contracts, from the Zod schemas. This
 * script exists for the second half: booting the real Nest application, asking the router
 * what it exposes, and failing if the two disagree.
 *
 * That check is the point. A document generated from schemas is always internally
 * consistent and can still describe an endpoint that was renamed, or miss one that was
 * added. Comparing it against the live router is the only way to know.
 *
 *   pnpm --filter @agricore/api openapi:emit
 */

interface RouteLayer {
  route?: { path: string; methods: Record<string, boolean> };
}

async function registeredRoutes(): Promise<Set<string>> {
  const { NestFactory } = await import('@nestjs/core');
  const app = await NestFactory.create(AppModule.forConfig(developmentConfig()), {
    logger: false,
  });
  await app.init();

  const server = app.getHttpAdapter().getInstance() as {
    _router?: { stack: RouteLayer[] };
    router?: { stack: RouteLayer[] };
  };
  const stack = server._router?.stack ?? server.router?.stack ?? [];

  const routes = new Set<string>();
  for (const layer of stack) {
    if (layer.route === undefined) continue;
    for (const method of Object.keys(layer.route.methods)) {
      routes.add(`${method.toUpperCase()} ${layer.route.path}`);
    }
  }

  await app.close();
  return routes;
}

function documentedRoutes(document: Record<string, unknown>): Set<string> {
  const paths = document['paths'] as Record<string, Record<string, unknown>>;
  const routes = new Set<string>();

  for (const [path, operations] of Object.entries(paths)) {
    // OpenAPI writes {id}; Express writes :id. Normalise before comparing.
    const expressPath = path.replace(/\{([^}]+)\}/g, ':$1');
    for (const method of Object.keys(operations)) {
      routes.add(`${method.toUpperCase()} ${expressPath}`);
    }
  }

  return routes;
}

async function main(): Promise<void> {
  const document = buildOpenApiDocument(process.env['APP_VERSION'] ?? '0.1.0');

  const target = resolve(__dirname, '..', '..', 'generated', 'openapi.json');
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  console.log(`wrote ${target}`);

  const actual = await registeredRoutes();
  const documented = documentedRoutes(document);

  const undocumented = [...actual].filter((route) => !documented.has(route)).sort();
  const phantom = [...documented].filter((route) => !actual.has(route)).sort();

  if (undocumented.length > 0) {
    console.error('\nRoutes the application serves but the document does not describe:');
    for (const route of undocumented) console.error(`  ${route}`);
  }

  if (phantom.length > 0) {
    console.error('\nRoutes the document describes but the application does not serve:');
    for (const route of phantom) console.error(`  ${route}`);
  }

  if (undocumented.length > 0 || phantom.length > 0) {
    console.error(
      '\nThe document and the router disagree. Fix packages/contracts/src/openapi/document.ts\n' +
        'or the controller, rather than ignoring this: a published document that lies about the\n' +
        'API is worse than no document.',
    );
    process.exit(1);
  }

  console.log(`document and router agree on all ${actual.size} routes`);
}

main().catch((error: unknown) => {
  console.error('Failed to emit the OpenAPI document:', error);
  process.exit(1);
});
