# Recorded container verification

Host: Windows 11, Docker 29.2.1. Run at the end of the build.

## The API image builds

```console
$ docker build -f infrastructure/docker/api.Dockerfile -t gl-api .
...
#28 naming to docker.io/library/gl-api:latest 0.0s done
#28 DONE 24.0s
```

The first attempt failed:

```
packages/design-tokens build: Error: Cannot find module
  '/repo/packages/design-tokens/node_modules/typescript/bin/tsc'
```

There was no `.dockerignore`, so `COPY packages/ packages/` copied the host's `node_modules`
over the ones pnpm had installed in the image. The host's are a tree of symlinks into the
host `.pnpm` store, which does not exist in the container, so the build failed with "cannot
find module typescript" from a directory that visibly contained typescript.

Adding a `.dockerignore` fixed it. The file carries a comment explaining why, because the
symptom points nowhere near the cause.

## The image serves

```console
$ docker run -d -p 13001:3001 -e JWT_ACCESS_SECRET=... -e JWT_REFRESH_SECRET=... \
    -e JWT_CONTACT_VIEW_SECRET=... gl-api

$ curl localhost:13001/health
{"status":"ok","version":"0.1.0","uptimeSeconds":7}

$ curl localhost:13001/ready
{"status":"ready","checks":[
  {"name":"users","status":"up","latencyMs":0},
  {"name":"incidents","status":"up","latencyMs":0},
  {"name":"outbox","status":"up","latencyMs":0}]}

$ curl localhost:13001/notice
{"notice":"GuardianLink is a portfolio demonstration built to show engineering work. It is..."}
```

## A real registration through the container

```console
$ curl -X POST localhost:13001/api/v1/auth/register \
    -H 'Content-Type: application/json' \
    -d '{"email":"smoke@example.com","password":"guardianlink-demo-passphrase",
         "displayName":"Smoke Test","acceptedDemoNotice":true}'

{"user":{"id":"9b974861-d2f8-49a9-add9-2683641bd07f","email":"smoke@example.com",
  "displayName":"Smoke Test","role":"user","createdAt":"2026-07-31T08:36:49.455Z"},
 "tokens":{"accessToken":"eyJhbGciOiJIU..."}}
```

The password was hashed with the production scrypt parameters, the account was created, and
a token pair was issued. Non-root, read-only root filesystem, tini as PID 1.

## Not verified

Compose with real Postgres, Redis, MongoDB and LocalStack was not brought up. The API image
was run on its in-memory adapters, which is what the smoke test above exercises.
