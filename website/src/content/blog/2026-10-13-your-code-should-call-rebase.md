---
title: "Your code should call Rebase, not the other way round"
description: "We held Rebase up against an essay on libraries versus frameworks. The edges passed and the core did not. Here is what we found, what we are changing, and how we are doing it without breaking your app."
pubDate: 2026-10-13
authors: francesco
draft: true
---

In 2015 Tomas Petricek wrote [Library patterns: Why frameworks are evil](https://tomasp.net/blog/2015/library-frameworks/). Its distinction is simple enough to apply to any codebase. With a **library**, you are in charge: you call its functions, in the order you choose, from code you structure. With a **framework**, it is in charge: it defines holes, and you fill them with the code it will call.

The essay argues the framework shape costs you three things.

- **Frameworks don't compose.** Two of them each want to be on the outside.
- **You can't explore them.** You can't load one into a REPL and poke at it, because it only does anything once it has taken over.
- **They shape your code.** Its hooks decide your structure, often as several callbacks that quietly share state.

The cure it proposes is not "never take a callback". It is layering. A convenience is fine as long as a simple, explicit alternative sits one shallow step beneath it, built from public pieces you could assemble yourself.

Petricek ends with a line we have been repeating to each other all week: "in software development, there is no excuse for building frameworks!"

Rebase is a backend, an SDK and an admin panel, and those invite the framework shape more than most things do. So we did the exercise properly. We went through every entry point and asked the same questions each time:

- Who calls whom?
- Can it run beside something else?
- Can you use it from a script?
- When you take one step under the convenience, what do you find?

## The edges passed

Most of what you touch first was already library-shaped, and we want to keep it that way.

**You own the server.** You create the Hono app and the `http.Server`, and you call `listen`. Rebase never listens and never installs signal handlers; `installShutdownHandlers` is something you choose to call.

**You own the router.** `<Rebase>` stacks context providers but creates no router, so the admin mounts inside whatever React Router setup your app already has. It also takes any `AuthController`, so your existing Clerk, Firebase or homegrown session can drive it.

**The client is just a client.** `@rebasepro/client` runs in plain Node with a URL and a token. It works without generated types and takes your own `fetch`. `@rebasepro/forms` has one dependency.

**Collections are values.** `defineCollection` is the identity function plus reference resolution. You can generate collections, spread them and filter them, and the server accepts an array.

**Callbacks are already the good kind.** Each collection hook takes one props object and returns a value rather than mutating one. Because `afterSave` receives `previousValues`, you never need to stash state in `beforeSave` for it to pick up later. That is exactly the multi-callback-shared-state smell the essay warns about, and we don't have it. Cron jobs go further: everything a job needs arrives as an argument.

## The core did not

Then we opened `initializeRebaseBackend`, and that one call is a framework in miniature.

Its body is about 2,900 lines. It takes your app and your server, then does all of this:

- installs a stack of middleware on everything under `/api`;
- mounts around two dozen route groups at fixed sub-paths;
- runs DDL for your collection tables, RLS policies and its own bookkeeping tables;
- starts a metrics sampler, two cleanup sweeps, a cron scheduler and job workers;
- adds a process-wide `unhandledRejection` listener;
- writes a handful of process globals.

You could switch nine coarse surfaces off and move the prefix, and that was all the control you had.

Apply the essay's test and take one step under it. What you found was private code. Most of the pieces it assembles were never exported: the data API router, the middleware that puts the user and the request-scoped driver on the context, the admin gate. One piece that *was* exported shows the problem neatly. Mount `createFunctionRoutes` on your own app and every function's `getDriver(c)` comes back undefined, because the middleware that sets it is private.

The rest of the audit read the same way.

**One backend per process.** The JWT configuration, the access model, the API-key store, the rate-limit store and the `rebase` singleton are module-level state, and the last writer wins. One file even says "exactly one JWT configuration per process" in its comments. Two Rebase backends in one Node process was not something you could do, and tests had to reset globals between cases.

**Folders, not values.** Collections could be an array, but functions and cron jobs could only come from a directory, and a function's filename became its URL. You could not generate a function, wrap one, or pick which to load.

**No way to poke at it.** Opening the data layer from a script meant constructing an adapter by hand and passing `collectionRegistry: undefined as never` to satisfy the types. Even then, opening a driver ran DDL and read environment variables. The CLI had no console.

**The admin pieces only worked as a whole.** `CollectionPanel` and `EntityForm` are exported, but outside the full `<Rebase>` → `<RebaseCMS>` → navigation tree, under a data router, the panel renders "Collection not found". `<Rebase>` also always took over dark mode by toggling a class on `<html>`, with no way to hand it your app's theme.

**Plugins that fill holes.** When two plugins wrapped the same form field, the last one silently won. Two plugin hooks, `modifyCollectionAsync` and `lifecycle.onCollectionChange`, were declared in the types and never called by anything.

## "Doesn't compose" turned out to mean real bugs

The composition question is not academic. Asking "does this still work beside something else?" found three bugs.

**The realtime socket took every WebSocket upgrade on your server.** It attached to your `http.Server` with no path. A host app running its own WebSocket on the same server would collide with it. We knew this in practice before we knew it in principle: our own cloud control plane carries code whose only job is to lift Rebase's upgrade listener off the server and put it back behind its own routing. When your own product needs a workaround for your library, the library is a framework.

**Bringing your own auth left realtime unauthenticated.** `client.setAuthTokenGetter` fed HTTP requests only. The socket kept asking Rebase's built-in session, which a Clerk or Firebase app doesn't have.

**Turning auth off didn't turn all of it off.** `GET /api/auth/config` was mounted whenever auth was configured, regardless of the switch that is supposed to remove the auth surface.

## What we're changing

**The backend becomes public pieces plus a shortcut.** `createRebaseBackend` builds everything and does nothing else: it mounts nothing, starts no timer and touches no process state. Each route group is a sub-app that carries its own auth context, rate limits and admin gate, so you can put it on any path. Starting background work is a call you make.

```ts
const backend = await createRebaseBackend({ database, auth, collections, provision: true });

app.route("/api/data", backend.routes.data());   // only the parts you want,
app.route("/api/auth", backend.routes.auth());   // at the paths you want
backend.attachRealtime(server);
backend.start();                                 // crons, job workers, sweeps
```

`initializeRebaseBackend` stays, and its body is now six calls to public functions and methods, readable in one screen. That is the essay's "one shallow step": when the shortcut stops fitting, you open it, copy it and change one line.

The DDL that used to run as a side effect is now a required `provision` option. It is an option rather than a later step because the Postgres driver reads your tables while it opens, so they have to exist first. `provision: false` creates nothing, which leaves the schema to your own migration step.

**State moves onto the instance.** Each backend carries its own signing keys, access model, API keys and rate limits, and its own `rebase` client. Inside a function, both `ctx.rebase` and the imported `rebase` mean the backend serving the request, so two backends in one process stay out of each other's way. A test that builds its own backend no longer resets globals. The module-level helpers (`verifyAccessToken`, the `rebase` import outside a request) keep working against a process default, which `initializeRebaseBackend` installs for you and `setDefaultBackend` installs by hand.

**Functions and cron jobs become values.** `functions: { hello }` and `crons: { "nightly-report": job }` sit beside `collections: [...]`. The directory loaders return exactly those values, so the folder convention is a convenience over the value form rather than the only door.

**You can open Rebase from a script, or from a console.**

```ts
const rebase = await openRebase({ databaseUrl, collections }); // no HTTP, no DDL, no env reads
await rebase.dataAsAdmin.posts.find({ limit: 10 });

const ada = await rebase.withAuth({ uid: "ada", roles: ["user"] });
await ada.data.posts.find();                                    // only what Ada's RLS lets her see
await rebase.close();
```

It uses the same vocabulary as the server-side client inside a function, so a snippet moves between a function and a script unchanged. `rebase console` gives you that object in a Node REPL with your project's collections loaded. `rebase console -e "<code>"` runs a one-off script and prints the result as JSON.

**Admin pieces work on their own.** `CollectionPanel` now takes the collection as a value, and a new `EntityFormPanel` shows one record's form. Inside `<Rebase>` and a small `CollectionsProvider`, both work under any React Router setup, at any path. Your app can show one table on one page without adopting the whole shell. With `<Rebase modeController>`, your app can also own the theme.

**Callbacks get the two primitives they were missing.**

- `composeCallbacks(a, b)` combines hook sets with the same semantics the driver already uses between its global, collection and property tiers.
- `createCallContext()` builds the `context` a hook receives, so you can unit-test a `beforeSave` by calling it like the plain function it is.

Plugin field wrappers now compose in order instead of the last one winning.

**And the three bugs are fixed.** The realtime socket claims only its own path and leaves every other upgrade to whoever owns it. One `setAuthTokenGetter` call authenticates both HTTP and the socket. The auth switch removes `/auth/config` too.

## Without breaking you

Before the public beta we deleted old names outright, because a clean API was worth more than a smooth upgrade when nobody had built on it yet. That is no longer true, so the rule has changed.

Anything public that this work removes or renames keeps working as a deprecated alias:

- The alias is a thin delegate to the new name, never a second implementation.
- It is marked `@deprecated` so your editor strikes it through.
- It logs one warning per process, naming the replacement.

The dead plugin hooks stay in the types, marked as never called, so plugins that set them keep compiling. Where behaviour changes, such as field wrappers composing instead of overwriting, the changelog says so under **Changed** rather than letting it happen silently. Migrations of data already on disk or in your database are kept, as they always were.

## What we're deliberately leaving alone

**The managed `rebase-server` runtime stays a framework.** You give it files and it runs them, which is the point of a managed runtime. The essay's objection is to a framework with nothing beneath it, and after this change there is a library beneath it that you can drop down to.

**`auth.hooks` stays.** We first listed it as the fill-the-base-class smell, because it has fourteen members. On a closer read, every member is optional and independent, and none of them shares state with another. That is a list of single callbacks, not a base class, and changing it would have been churn for its own sake.

## The test we're keeping

We are taking one habit out of this and applying it to every new API: **open the convenience and look one step down.** If what you find is public pieces you could have called yourself, the convenience earns its place. If what you find is private code, we have built a framework, and it is a bug.
