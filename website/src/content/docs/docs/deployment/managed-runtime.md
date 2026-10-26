---
title: Managed backend runtime
sidebar_label: Managed Runtime
description: What a backend with runtime "managed" can and cannot do on Rebase Cloud — packages and binaries, memory and CPU, timeouts and body sizes, the filesystem, in-memory state, secrets, storage for generated files, and outbound network.
---

A backend app declared like this in `rebase.json` runs on the **managed
runtime**:

```json title="rebase.json"
{
    "apps": {
        "backend": { "type": "backend", "runtime": "managed" }
    }
}
```

Managed means you ship a bundle, not an image. `rebase cloud deploy` builds your
collections, `backend/functions/` and crons into `dist-bundle`, uploads it, and
Rebase Cloud boots it on the published `rebasepro/server` image. You never write
a Dockerfile, and you also cannot change what is in the image. This page lists
what that allows, so you can plan a feature before you build it.

The numbers here come from the runtime and the platform as they are today. Some
are dials you can change, and the page says which ones. The few things that are
not promised yet are collected [at the end](#not-promised-yet).

## At a glance

| Question | Answer |
|---|---|
| Node version | Node 22, on Debian slim, `linux`/`x64` |
| npm packages | Yes, from the public registry or a private one. Installed when each instance starts |
| Native modules (`.node`, node-gyp) | No. `rebase cloud deploy` refuses the bundle |
| WebAssembly | Yes |
| Spawn a child process | Yes, for a `linux`/`x64` binary an npm package ships. See [Binaries](#binaries-and-child-processes) |
| Memory and CPU | Set per project with `rebase cloud compute`. See [Compute](#compute-and-instances) |
| Instances | 1 by default, always on. You can pin up to 5, or let the autoscaler go up to 16 |
| Function timeout | 30 seconds, then `504 FUNCTION_TIMEOUT`. Configurable up to 10 minutes |
| Request body | 10 MiB, then `413`. Configurable, up to the 64 MiB the edge accepts |
| Writable filesystem | Yes, but it is temporary and belongs to one instance |
| Module-level state (a `Map` cache) | Survives between requests on one instance. Lost on every deploy and restart, and not shared between instances |
| Environment variables and secrets | `rebase cloud env set`, applied at the next deploy |
| File storage | A bucket per project, served by your backend at `/api/storage/file/…` |
| Outbound HTTP | Yes, on ports 80 and 443 (and 465, 587, 993 for mail). Other ports are blocked. No fixed outbound IP |

## Code and packages

**Node and the image.** The runtime image is built on `node:22-slim`
(Debian), and your bundle runs on `linux`/`x64` as a non-root user. Your
`tsconfig` and the Node version on your machine do not change this.

**Dependencies.** The bundle lists the dependencies your `package.json` files
declare. The upload does not include `node_modules`. Each instance installs the
dependencies when it starts, with `npm ci` (or `npm install` without a
lockfile). Four things follow from that:

- **Install scripts never run.** The install uses `--ignore-scripts`. A package
  that downloads a binary or builds something in `postinstall` installs without
  it.
- **Only registry versions install.** A `file:`, `link:`, `git+…` or `github:`
  dependency fails the build, because the runtime has nothing to resolve it
  against.
- **Some packages come from the image, not from you.** `@rebasepro/server`,
  `@rebasepro/types`, `@rebasepro/client`, `@rebasepro/common`,
  `@rebasepro/utils`, `hono`, `@hono/node-server` and `zod` are removed from the
  bundle's dependencies and the image's own copies are linked in, so your
  version of them does not apply. Other `@rebasepro/*` packages, such as the
  database driver, install from your `package.json` like any dependency.
  `typescript` and `tsx` are removed too; they are build tools.
- **Private packages need an `.npmrc`.** `rebase build` copies the project's
  `.npmrc` (and `backend/.npmrc`) into the bundle, so the install uses the same
  registry settings as your machine. Every credential in it must be an
  environment reference, never the token itself; a literal token fails the
  build, because the bundle is uploaded with your code:

  ```ini title=".npmrc"
  @acme:registry=https://npm.pkg.github.com
  //npm.pkg.github.com/:_authToken=${NPM_TOKEN}
  ```

  ```bash
  rebase cloud env set NPM_TOKEN=ghp_… --secret
  ```

The bundle upload is capped at 100 MB, compressed, without dependencies.

**Native modules are refused.** A package that ships a compiled `.node` binary
cannot load on the managed runtime. `rebase build` warns about it, and
`rebase cloud deploy` stops before uploading:

```text no-verify
This bundle depends on native modules (sharp), which the managed runtime cannot run
```

The check looks for well-known native packages (`sharp`, `canvas`, `bcrypt`,
`argon2`, `sqlite3`, `better-sqlite3`, `re2`, `sodium-native`, `pg-native`, …),
for `binding.gyp` or `gypfile`, for install scripts that call `node-gyp` or
`prebuild`, and for `.node` files. The
[deployment guide](/docs/getting-started/deployment/#native-modules-on-the-managed-runtime)
lists the usual ways around it. The short version: do the work at build time,
call a service, or deploy with `runtime: "custom"`.

**WebAssembly works.** A package that ships a `.wasm` file and loads it from
JavaScript is not a native module, and Node 22 runs it. Checked in the
runtime's base image with the pod's security settings, using `esbuild-wasm`.
Remember the [memory limit](#compute-and-instances) if the module is large,
such as a speech or ML model.

### Binaries and child processes

`child_process` works. The image itself has very little to run: `node`, `npm`,
`sh`, `tar`, and the PostgreSQL client tools (`pg_dump`, `pg_restore`). There is
no `ffmpeg`, no ImageMagick, no Python and no compiler, and you cannot add
system packages, because there is no Dockerfile and the process is not root.

A binary that an npm package carries **inside its own tarball** installs with
the package and runs. It must be built for `linux`/`x64` against glibc
(Debian), and it runs as an unprivileged user with no Linux capabilities.
Checked with `@esbuild/linux-x64` in the runtime's base image. A binary that a
package *downloads* in `postinstall` never arrives, because install scripts do
not run; packages like `ffmpeg-static` work that way.

If a feature needs a binary, use a hosted API for that work, or move the
backend to `runtime: "custom"`, where you build your own image.

## Compute and instances

Each project runs in its own pods. Memory and CPU are per instance, and you set
them with the [compute dials](/docs/deployment/cloud/#compute-and-what-it-costs):

```bash
rebase cloud compute                              # what the project reserves now
rebase cloud compute set --cpu 500m --memory 1Gi
```

A project that never set a dial runs as a burstable pod: it reserves `100m` CPU
and `384Mi` memory, and can burst to 2 CPU and 2 GiB. A dialled request keeps
that ratio between request and limit. Run `rebase cloud compute` to see what
your project has.

Instances:

- **One by default, always running.** `--replicas` pins between 1 and 5.
  Nothing scales a backend to zero.
- **Autoscaling is opt-in.** `--autoscale-max` sets a ceiling of up to 16, and
  `--autoscale-cpu-target` (default 70) the CPU use the autoscaler aims for.
- **Deploys roll.** A new instance starts and becomes ready before the old one
  stops, so for a short time two versions serve traffic.

`--spot` is off by default; spot instances are cheaper and restarted without
notice.

## Memory and module-level state

A module-level value, like `const cache = new Map()` at the top of a function
file, lives in the Node process. It survives from one request to the next on
the same instance. It is lost whenever that process ends:

- on **every deploy**, because each deploy starts new instances;
- when an **environment variable** changes and is deployed;
- when an instance is restarted, rescheduled or (with `--spot`) reclaimed.

With more than one instance, each one has its own copy, so two requests can see
different caches.

Use a module-level `Map` as a cache you can afford to lose: one that makes the
next request faster but is not the only copy of anything. Keep anything you
paid to produce, like generated audio or an expensive API answer, in the
database or in [storage](#storage-for-generated-files). For clients you build
once, such as an API SDK, use `lazyResource` so the client is built on first
use from the request's environment. See
[Configuration and Secrets](/docs/backend/custom-functions/#configuration-and-secrets).

[Running more than one instance](/docs/deployment/multiple-instances/) lists
the state Rebase itself keeps per process, such as rate-limit counters and
realtime channels.

## The filesystem

The container's filesystem is writable, and `/tmp` works. But everything
written there:

- belongs to one instance, and other instances do not see it;
- is deleted when the instance stops, so at the latest on the next deploy;
- shares a 6 GiB ephemeral-storage limit with the bundle and its installed
  `node_modules`. An instance that goes over is evicted.

Use it for scratch files during one request. Do not use it as a cache across
deploys or as storage for uploads. That is also why
[`STORAGE_TYPE=local` is turned off in production](/docs/backend/storage/#environment-variables).

## Requests

| Limit | Default | Change it with |
|---|---|---|
| Function timeout | 30 s, then `504` with code `FUNCTION_TIMEOUT` | `REBASE_FUNCTIONS_TIMEOUT_MS` (`0` turns it off) |
| Waiting on your instance, at the edge | 10 minutes between reads or writes | Fixed |
| Request body, `/api/*` routes without a limit of their own | 10 MiB, then `413 PAYLOAD_TOO_LARGE` | `REBASE_MAX_BODY_SIZE`, in bytes |
| Request body at the edge | 64 MiB | Fixed |
| One file through `POST /api/storage/upload` | 50 MB | `STORAGE_MAX_FILE_SIZE` |
| Anonymous calls to `/api/functions/*` | 3000 per IP per 15 minutes | `rateLimit.anonymousFunctions` |

Some details:

- **The timeout frees the caller, not the work.** At 30 seconds the caller gets
  a `504`, and `getSignal(c)` is aborted. Pass that signal to `fetch` and
  anything else that accepts one, so the work stops too. See
  [Timeouts and Rate Limits](/docs/backend/custom-functions/#timeouts-and-rate-limits).
- **The edge waits longer than the runtime.** The ingress in front of your
  instances waits up to 10 minutes, so the limit a request hits is the runtime's,
  which answers JSON and aborts the signal. Raise `REBASE_FUNCTIONS_TIMEOUT_MS`
  up to that. For work that takes longer, or that must survive a deploy (an
  instance drains for 15 seconds), answer at once and do the work in a
  [job](/docs/backend/jobs/).
- **Uploads larger than 64 MiB** need the resumable (TUS) upload, which sends
  the file in chunks. `client.storage.putObject()` switches to it on its own
  above 8 MiB.
- **Response size.** Neither the runtime nor the edge sets a limit on response
  size. A large response is still held in memory if your handler builds it in
  one piece, so stream it or serve it from storage.

## Environment variables and secrets

Set them with the CLI or in the console. There is no field for them in
`rebase.json`.

```bash
rebase cloud env set TTS_API_URL=https://api.example.com/v1/speech
rebase cloud env set TTS_API_KEY=sk-… --secret   # write-only: never shown again
rebase cloud env list                            # names only, never values
rebase cloud deploy                              # applies the change
```

- **A change applies at the next deploy.** Running instances keep the values
  they started with. `set` and `unset` remind you of this
  (`Pending redeploy`).
- **Limits:** up to 100 variables per project, 32 KiB per value and 256 KiB in
  total. Names follow `[A-Za-z_][A-Za-z0-9_]*`.
- **Some names are reserved.** The platform sets `DATABASE_URL`,
  `DATABASE_DIRECT_URL`, `DATABASE_READ_URL`, `JWT_SECRET`,
  `REBASE_SERVICE_KEY`, `PORT` and `NODE_ENV` itself, and pins how the process
  runs (`REBASE_ROLE`, `TRUSTED_PROXY_HOPS`, …). Setting one of those is
  refused, and the error lists them all.
- **`CORS_ORIGINS` starts from your domains.** The platform sets it to the
  project's host and its verified [custom domains](/docs/deployment/cloud/#the-rest-of-the-surface).
  A `CORS_ORIGINS` you set is added to that list, for a frontend served from
  somewhere else: `rebase cloud env set CORS_ORIGINS=https://app.example.org`.
- **The storage variables are defaults.** The platform writes the `STORAGE_*`
  and `S3_*` variables for its bucket, and a value you set wins.
- **Build-time names are refused.** `VITE_`, `NEXT_PUBLIC_`, `PUBLIC_` and
  `REACT_APP_` variables are for frontends at build time, and the backend
  never sees them in time. `--force` stores one anyway.

In a function, read them inside the handler, never at the top of the file:

```typescript
import { defineFunction, requireEnv } from "@rebasepro/server/functions";

export default defineFunction((app) => {
    app.get("/status", async (c) => {
        const endpoint = requireEnv(c, "TTS_API_URL");   // throws a clear error if unset
        return c.json({ configured: Boolean(endpoint) });
    });
});
```

A module-scope `process.env` read that comes back empty makes the whole file
fail to load, and its routes answer `404`. See
[Configuration and Secrets](/docs/backend/custom-functions/#configuration-and-secrets).

## Storage for generated files

A Cloud project gets file storage once you create it:

```bash
rebase cloud storage create   # a managed bucket and its credentials
rebase cloud deploy           # the running backend gets the credentials at deploy
```

Or point the project at a bucket you already own with
`rebase cloud storage attach` (S3, R2, MinIO, any S3-compatible bucket).
Without either, uploads answer `501 STORAGE_NOT_CONFIGURED`. More buckets are
declared in `config/resources.ts`; see
[Several Buckets](/docs/backend/storage/#several-buckets).

A deploy with storage is refused until the project says who may read and write
files. The scaffold's `config/storage.ts` exports a `storageAuthorize` hook for
this. See [Per-Object Authorization](/docs/backend/storage-authorization/).

**How files are served.** Your backend serves every file at
`GET /api/storage/file/<key>`. It reads the object from the bucket and streams
it, with `Content-Type`, range requests and caching headers. There is no direct
bucket URL to hand out.

- A key under **`public/`** is served to anyone, without a token, at a URL
  that never changes. Use it for files any visitor may load, such as generated
  audio for a public game.
- Any other key is private. A client asks `/api/storage/metadata/<key>` for a
  download URL that holds a token, valid for 300 seconds by default
  (`STORAGE_DOWNLOAD_TOKEN_TTL`, up to a week).

From a function, write with `rebase.storage` (the default bucket) or
`rebase.bucket(…)` (a named one). Your `storageAuthorize` hook still decides
whether the write is allowed.

Image transforms (`?width=`, `?format=`) need `sharp`, which is a native module
and is not in the managed image. On the managed runtime, a transform request
gets the original image.

### Example: cache generated audio

A function that turns text into speech with a hosted API, stores each result
once, and serves it from storage afterwards. The `Map` only saves a storage
lookup on a warm instance; the bucket is the real cache, so a deploy loses
nothing.

```typescript
import { defineFunction, getSignal, requireEnv } from "@rebasepro/server/functions";

const known = new Map<string, true>(); // per instance, lost on deploy: that is fine

export default defineFunction((app, { rebase }) => {
    app.get("/voice/:id", async (c) => {
        const id = c.req.param("id").replace(/[^a-z0-9-]/gi, "");
        const key = `public/voices/${id}.mp3`;
        const url = `/api/storage/file/${key}`;

        if (known.has(key)) return c.redirect(url);
        const storage = rebase.storage;
        if (!storage) return c.json({ error: "Storage is not configured" }, 501);

        const listed = await storage.listObjects(key, { maxResults: 1 });
        if (listed.items.some(item => item.fullPath === key)) {
            known.set(key, true);
            return c.redirect(url);
        }

        const text = c.req.query("text") ?? "";
        const response = await fetch(requireEnv(c, "TTS_API_URL"), {
            method: "POST",
            headers: {
                authorization: `Bearer ${requireEnv(c, "TTS_API_KEY")}`,
                "content-type": "application/json"
            },
            body: JSON.stringify({ text }),
            signal: getSignal(c)
        });
        if (!response.ok) return c.json({ error: "Speech service failed" }, 502);

        const file = new File([await response.arrayBuffer()], `${id}.mp3`, { type: "audio/mpeg" });
        await storage.putObject({ file, key });
        known.set(key, true);
        return c.redirect(url);
    });
});
```

The route is public, like every route in `backend/functions/` until you guard
it. A real one would check who may create new audio, so that a stranger cannot
spend your speech-API budget.

## Outbound network

Functions can call external services. Outbound connections from your instances
are allowed to any internet address on these TCP ports only:

| Port | For |
|---|---|
| 80, 443 | HTTP and HTTPS |
| 465, 587 | Sending mail over SMTP with TLS or STARTTLS |
| 993 | IMAP over TLS |

Everything else is blocked. That includes port 25, plain IMAP, and databases or
caches on their own ports: Redis on 6379 or MongoDB on 27017 outside Rebase
Cloud cannot be reached. The cloud metadata address (`169.254.169.254`) is
blocked too.

The one exception is your own database. If the project brings its own
PostgreSQL (BYODB), each deploy also allows connections to that database's
host on the port in its connection string, and to nothing else on that port.
The host is resolved to its IP addresses when you deploy, so if your provider
moves the database to another address, deploy again. The database must accept
connections from the internet: the app connects to the connection string
directly. The SSH bastion settings are used only by the connection test, not
by the deployed app.

The platform adds no proxy and no outbound rate limit; the services you call
have their own. Pass `getSignal(c)` to `fetch` so a call stops when its request
times out.

There is **no fixed outbound IP address**. Traffic leaves through an address
shared by every project, which the cloud provider assigns and can change, so do
not add it to a third-party allowlist. Authenticate to such a service with a
key instead.

## Startup and shutdown

- **Cold start.** A new instance downloads the bundle and installs its
  dependencies before it serves. That install is most of a cold start, which
  is typically 40 to 60 seconds. The platform waits up to 300 seconds for an
  instance to come up. A large dependency tree makes every deploy and every
  scale-up slower.
- **Health.** The platform checks `/livez` (the process is running) and
  `/health` (it can reach the database). Both are served by the runtime, so you
  do not write them.
- **Shutdown.** On a deploy or restart, the instance stops taking new requests,
  waits 5 seconds for traffic to move, and then gets `SIGTERM`. Requests in
  flight have up to 15 seconds to finish. Promises passed to `waitUntil` get up
  to 5 seconds of that. A promise you did not hand to `waitUntil` is dropped.
  See [Background Work](/docs/backend/custom-functions/#background-work).

## When managed is the wrong fit

Move the backend to `"runtime": "custom"` when it needs:

- a native module, or a system binary no npm package ships, such as `sharp`,
  ImageMagick or a local speech engine;
- system packages or a different base image;
- a long-lived connection to something outside the allowed ports.

A custom runtime builds your own Dockerfile, and you own the image from then
on. `rebase cloud deploy --eject` makes the switch. See
[Rebase Cloud](/docs/deployment/cloud/#deploy).

## Not promised yet

- **Log history.** `rebase cloud logs --runtime` reads from the instances that
  are running, and `rebase cloud debug logs --previous` from the last run of
  one that restarted. Output from an instance a deploy replaced is gone. Write
  anything you need to keep to the database or to a log service of your own.
- **Scale to zero** is not offered. Every backend runs at least one instance at
  all times.

## Related pages

- [Rebase Cloud](/docs/deployment/cloud/): linking, deploying, the compute
  dials, and what the beta does not include
- [Custom Functions](/docs/backend/custom-functions/): writing the routes in
  `backend/functions/`
- [Runtime and Bundles](/docs/architecture/runtime-and-bundles/): what a bundle
  is and how the runtime boots it
- [Storage](/docs/backend/storage/): buckets, endpoints, size limits and access
  rules
- [Running more than one instance](/docs/deployment/multiple-instances/): the
  state Rebase keeps per process
