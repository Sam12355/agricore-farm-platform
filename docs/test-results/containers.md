# Recorded container verification

Host: Windows 11, Docker 29.2.1. Re-run at 2026-07-31T09:29Z, after the domain rename, for
the reason given in [api.md](api.md).

## The API image builds

```console
$ docker build -f infrastructure/docker/api.Dockerfile -t agricore-api .
...
#28 naming to docker.io/library/agricore-api:latest done
#28 unpacking to docker.io/library/agricore-api:latest 10.4s done
#28 DONE 22.3s
```

An earlier attempt, before the `.dockerignore` existed, failed like this:

```
packages/design-tokens build: Error: Cannot find module
  '/repo/packages/design-tokens/node_modules/typescript/bin/tsc'
```

`COPY packages/ packages/` had copied the host's `node_modules` over the ones pnpm installed
in the image. The host's are a tree of symlinks into the host `.pnpm` store, which does not
exist in the container, so the build failed with "cannot find module typescript" from a
directory that visibly contained typescript.

Adding a `.dockerignore` fixed it. The file carries a comment explaining why, because the
symptom points nowhere near the cause.

## The image serves

```console
$ docker run -d -p 13001:3001 -e NODE_ENV=development \
    -e JWT_ACCESS_SECRET=... -e JWT_REFRESH_SECRET=... \
    -e JWT_WORKER_VIEW_SECRET=... agricore-api

$ curl localhost:13001/health
{"status":"ok","version":"0.1.0","uptimeSeconds":0}

$ curl localhost:13001/ready
{"status":"ready","checks":[
  {"name":"users","status":"up","latencyMs":0},
  {"name":"alerts","status":"up","latencyMs":0},
  {"name":"outbox","status":"up","latencyMs":0}]}

$ curl localhost:13001/notice
{"notice":"AgriCore is a portfolio demonstration built to show engineering work. It is not
 a working farm operations service, no real sensor, machine or field is connected to it, and
 nobody is monitoring the alerts it raises. Do not use it to run an actual farm."}
```

`NODE_ENV=development` is not decoration. The image sets `NODE_ENV=production`, and
configuration validation refuses to boot a production process on in-memory adapters:

```
Configuration is not valid:
  PERSISTENCE: Production must not run on the in-memory adapters.
```

The previous version of this file recorded the run without that variable, which would not
actually have started. Re-running caught it, which is the argument for re-running rather than
editing a transcript.

## A real registration through the container

```console
$ curl -X POST localhost:13001/api/v1/auth/register \
    -H 'Content-Type: application/json' \
    -d '{"email":"smoke@example.com","password":"agricore-demo-passphrase",
         "displayName":"Smoke Test","acceptedDemoNotice":true}'

{"user":{"id":"defef61f-81b3-4c35-ba54-450b12e7fd54","email":"smoke@example.com",
  "displayName":"Smoke Test","role":"user","createdAt":"2026-07-31T09:29:34.131Z"},
 "tokens":{"accessToken":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...","expiresIn":900,
  "refreshToken":"...","refreshExpiresIn":2592000,"tokenType":"Bearer"}}
```

The password was hashed with the production scrypt parameters, the account was created, and a
token pair was issued. The process runs as a non-root user:

```console
$ docker exec <container> id
uid=1000(node) gid=1000(node) groups=1000(node)
```

Read-only root filesystem, tini as PID 1.

## Not verified

Compose with real Postgres, Redis, MongoDB and LocalStack was not brought up. The API image
was run on its in-memory adapters, which is what the smoke test above exercises.
