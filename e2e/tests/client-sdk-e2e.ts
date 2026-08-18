/**
 * E2E: `@rebasepro/client`, driven the way a browser application drives it.
 *
 * ## The gap this closes
 *
 * Every piece of this path was already covered, and the composition of them was
 * not:
 *
 *   * `packages/client/**` unit tests drive the SDK against a **mocked
 *     transport** — they prove the client's own logic and can prove nothing
 *     about the server agreeing with it.
 *   * `rls-enforcement.test.ts` proves RLS at the **database** tier, by setting
 *     the role on a connection directly. No HTTP, no tokens.
 *   * `cli-init-baas-e2e.ts` drives the real SDK against a real server, but
 *     authenticates with a **service key** — the server-to-server path, which
 *     bypasses user identity entirely and therefore never exercises RLS.
 *
 * So the one path a real application actually takes — register, sign in, get a
 * token, have the server derive `rebase.uid()` from it, have Postgres scope rows
 * to that uid, refresh the token, upload a file, receive a realtime event —
 * existed nowhere. That is the composition where the interesting failures live,
 * because each tier can be individually correct and still disagree at the seam.
 *
 * ## Shape
 *
 * A real Postgres, a real `rebase db push`, the reference backend booted as its
 * own process on a real socket, and the SDK talking to it over the network.
 * Deliberately NOT `app.fetch()` against an in-process Hono instance: a token
 * that never crosses a socket proves nothing about headers, and realtime is a
 * WebSocket upgrade, which an in-process fetch cannot perform at all.
 *
 * Run: npx tsx e2e/tests/client-sdk-e2e.ts
 */
import * as path from "path";

import {
    execa,
    killTree,
    getCleanEnv,
    assertPortFree,
    startPgContainer,
    stopPgContainer,
    rootDir,
    cliBin,
    type PgContainer
} from "./cli-init-e2e";

/**
 * Imported by PATH, not by package name — and from `dist`, not from `src`.
 *
 * By name, `@rebasepro/client` resolves out of pnpm's hoisted
 * `.pnpm/node_modules`, because nothing at the repo root declares a dependency
 * on it. That copy is a phantom: it has no `exports` main, so the import fails
 * outright here — and in a git worktree the same resolution silently reaches
 * into the PRIMARY checkout, which is the quieter version of the same bug.
 * `verify-selfhost.mts` and `verify-bundle-corpus.mts` import by path for this
 * reason; this follows them.
 *
 * From `dist` because that is the artifact a user installs. The source would
 * typecheck identically and could still differ in what the bundler emits.
 * CI builds `./packages/*` before the e2e job, so it is present.
 *
 * Loaded inside `run()` rather than at module scope: these e2e scripts are
 * transpiled to CJS, where top-level await is not available.
 */
import type { createRebaseClient as CreateRebaseClient } from "../../packages/client/src/index.js";

let createRebaseClient: typeof CreateRebaseClient;

async function loadSdk(): Promise<void> {
    ({ createRebaseClient } = await import(
        `${rootDir}/packages/client/dist/index.es.js`
    ) as { createRebaseClient: typeof CreateRebaseClient });
}

const appDir = path.join(rootDir, "app");
const backendDir = path.join(appDir, "backend");
const cleanEnv = getCleanEnv();

/**
 * Pinned, and asserted free before use.
 *
 * The reference backend runs `listenWithPortRetry` in development, so a busy
 * port silently becomes a different port — and then every assertion below would
 * target a socket nothing is listening on, or worse, somebody else's server.
 * Checking the port is free first means the retry never engages and the port we
 * asked for is the port we got.
 */
const backendPort = Number(process.env.E2E_SDK_BACKEND_PORT || 3097);
const base = `http://localhost:${backendPort}`;

const JWT_SECRET = "client-sdk-e2e-jwt-secret-at-least-32-chars";

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
    console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
    if (!ok) failures++;
}

/** Atlas negotiates SSL first and fails outright rather than falling back. */
const withSslDisabled = (url: string) =>
    url.includes("sslmode=") ? url : `${url}${url.includes("?") ? "&" : "?"}sslmode=disable`;

async function waitForApi(url: string, timeoutMs = 90_000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            if ((await fetch(url)).ok) return true;
        } catch {
            // not up yet
        }
        await new Promise((r) => setTimeout(r, 1000));
    }
    return false;
}

/**
 * A distinct client per identity, exactly as two browsers would be.
 *
 * Sharing one client between two users would let a stale in-memory session
 * answer for the wrong person, which is precisely the bug an isolation test
 * exists to catch — the test would then pass by construction.
 */
const clients: ReturnType<typeof CreateRebaseClient>[] = [];

const newClient = () => {
    const client = createRebaseClient({ baseUrl: base });
    clients.push(client);
    return client;
};

interface Identity {
    email: string;
    password: string;
}

async function run(): Promise<void> {
    let container: PgContainer | undefined;
    let backend: { pid?: number; kill(signal?: string): void } | undefined;
    /** Settles when the backend process is actually gone. See the `finally`. */
    let backendExit: Promise<unknown> = Promise.resolve();

    try {
        await loadSdk();

        console.log("\n🐘 Step 1: Postgres");
        container = await startPgContainer();
        const databaseUrl = withSslDisabled(container.connectionString);

        console.log("\n📐 Step 2: rebase db push (tables, auth tables, RLS policies)");
        await execa(process.execPath, [cliBin, "db", "push", "--yes"], {
            cwd: appDir,
            env: { ...cleanEnv,
DATABASE_URL: databaseUrl },
            stdio: "inherit"
        });

        console.log("\n🚀 Step 3: boot the reference backend on a real socket");
        await assertPortFree(backendPort);
        const backendProcess = execa("npx", ["tsx", "src/index.ts"], {
            cwd: backendDir,
            env: {
                ...cleanEnv,
                DATABASE_URL: databaseUrl,
                JWT_SECRET,
                PORT: String(backendPort),
                NODE_ENV: "development",
                // The bootstrap exception admits the first user into an empty
                // table regardless; every user after it needs this. Without it
                // the isolation check below cannot get its second identity.
                ALLOW_REGISTRATION: "true"
            },
            stdio: "inherit",
            detached: true // so killTree reaps anything it spawns
        });

        backend = backendProcess as unknown as { pid?: number; kill(signal?: string): void };

        // `execa` here is this suite's own helper, and it REJECTS on a non-zero
        // exit. We are going to terminate this process on purpose, and a server
        // killed mid-flight does not reliably exit 0 — so without owning that
        // rejection at the point the decision is made, it surfaces later as an
        // unhandled rejection that kills the script with status 1 *after* the
        // report has already printed. A green suite would read as a red run.
        backendExit = (backendProcess as unknown as Promise<unknown>).catch(() => undefined);

        const up = await waitForApi(`${base}/health`);
        check("backend boots and /health round-trips the database", up);
        if (!up) throw new Error("API never became healthy");

        // ── 4. The boundary ──────────────────────────────────────────────────
        //
        // First, because it is the assertion most likely to rot silently. RLS
        // policies on this project are written `rebase.uid() IS NULL OR …` — the
        // owner/service connection leaves uid null and is meant to bypass. Read
        // as a *policy* that clause is permissive, so if an anonymous HTTP
        // request ever reached the data layer it would match everything. What
        // stops it is the API refusing before Postgres is consulted at all.
        // That refusal is load-bearing and invisible from the database tier.
        console.log("\n🔒 Step 4: the anonymous boundary");
        const anon = newClient();
        let anonStatus = 0;
        try {
            await anon.data.collection("posts").find({ limit: 1 });
        } catch (err) {
            anonStatus = (err as { status?: number }).status ?? -1;
        }
        check("anonymous read is refused", anonStatus === 401, `status ${anonStatus}`);

        // ── 5. Register, sign in ─────────────────────────────────────────────
        //
        // Three identities, and the order matters. `register` admits the first
        // account into an empty users table as an ADMIN — the bootstrap
        // exception that exists so a fresh install has somebody who can log in.
        // An admin satisfies the `admin` arm of every policy here and would see
        // every row, so burning the first slot deliberately is what makes the
        // two that follow ordinary users, and the isolation check meaningful.
        console.log("\n👤 Step 5: register and sign in");
        const stamp = Date.now();
        const bootstrapAdmin: Identity = { email: `admin-${stamp}@e2e.test`,
password: "BootstrapAdmin1!" };
        const alice: Identity = { email: `alice-${stamp}@e2e.test`,
password: "AliceSecret1!" };
        const bob: Identity = { email: `bob-${stamp}@e2e.test`,
password: "BobSecret1!" };

        const adminClient = newClient();
        await adminClient.auth.signUp(bootstrapAdmin.email, bootstrapAdmin.password, "Bootstrap Admin");

        const aliceClient = newClient();
        const aliceSignUp = await aliceClient.auth.signUp(alice.email, alice.password, "Alice");
        check("signUp returns a user", Boolean(aliceSignUp.user?.uid), aliceSignUp.user?.email ?? "no user");
        check("the second account is NOT an admin",
            !(aliceSignUp.user?.roles ?? []).includes("admin"),
            JSON.stringify(aliceSignUp.user?.roles ?? []));

        const bobClient = newClient();
        const bobSignUp = await bobClient.auth.signUp(bob.email, bob.password, "Bob");

        // Sign in as a separate act from registering: they are different
        // endpoints and a project can have one working while the other does not.
        const fresh = newClient();
        const signedIn = await fresh.auth.signInWithEmail(alice.email, alice.password);
        check("signInWithEmail returns the same identity", signedIn.user?.uid === aliceSignUp.user?.uid);

        const me = await fresh.auth.getUser();
        check("getUser round-trips the token to the server", me?.email === alice.email, me?.email ?? "null");

        // ── 6. RLS, through the whole stack ──────────────────────────────────
        //
        // The `users` collection is scoped `id = rebase.uid()::uuid OR admin`. For
        // this to return one row, four independent things must agree: the SDK
        // sends the token, the server verifies it and derives a uid, it opens
        // the connection as `rebase_user` with that uid bound, and Postgres
        // applies the policy. Any one of them failing shows up here as a row
        // count — the number is the whole assertion.
        console.log("\n🛡️  Step 6: RLS scopes rows to the signed-in user");
        const aliceRows = await fresh.data.collection("users").find({ limit: 50 });
        const aliceList = (aliceRows as { data?: Record<string, unknown>[] }).data ?? [];
        check("a signed-in user sees exactly their own row", aliceList.length === 1, `${aliceList.length} row(s)`);

        // Identity is checked on `id`, NOT on email.
        //
        // The reference project masks PII in `afterRead`, which runs on every
        // read path — REST, realtime and server-side alike — so `email` comes
        // back as `a***@e2e.test` and comparing it to the address we registered
        // fails against a server that is behaving perfectly. (It did: that is
        // how this comment came to exist.) `id` is the uid the token carries,
        // which is the thing RLS actually scoped on, so it is both the more
        // honest assertion and the one masking policy cannot invalidate.
        check("and it is their row", aliceList[0]?.id === aliceSignUp.user?.uid,
            `${String(aliceList[0]?.id)} vs ${String(aliceSignUp.user?.uid)}`);

        const bobRows = await bobClient.data.collection("users").find({ limit: 50 });
        const bobList = (bobRows as { data?: Record<string, unknown>[] }).data ?? [];
        check("a different user sees a different single row",
            bobList.length === 1 && bobList[0]?.id === bobSignUp.user?.uid,
            `${bobList.length} row(s)`);
        check("and the two users' rows are genuinely different",
            Boolean(aliceList[0]?.id) && aliceList[0]?.id !== bobList[0]?.id);

        // Free, and worth having: masking is a per-collection `afterRead`
        // callback, and this is the only test anywhere that observes one
        // running on a real SDK read rather than unit-testing the function.
        check("afterRead masking is applied on the SDK read path",
            typeof aliceList[0]?.email === "string" && /^\w\*\*\*@/.test(aliceList[0].email as string),
            String(aliceList[0]?.email));

        // The admin arm of the same policy. Without this, a policy that denied
        // everyone would pass every check above.
        const adminRows = await adminClient.data.collection("users").find({ limit: 50 });
        const adminList = (adminRows as { data?: Record<string, unknown>[] }).data ?? [];
        check("an admin sees all three", adminList.length >= 3, `${adminList.length} row(s)`);

        // ── 7. Refresh ───────────────────────────────────────────────────────
        //
        // The failure mode this catches is specific and has happened here
        // before: refresh appears to succeed, the client stores a token the
        // server will not accept, and the next request 401s. So the assertion
        // is a *request after the refresh*, never the refresh's own return.
        console.log("\n🔄 Step 7: token refresh");
        await fresh.auth.refreshSession();
        const afterRefresh = await fresh.data.collection("users").find({ limit: 50 });
        const afterList = (afterRefresh as { data?: Record<string, unknown>[] }).data ?? [];
        check("a read still succeeds after refreshing", afterList.length === 1, `${afterList.length} row(s)`);

        // ── 8. Storage ───────────────────────────────────────────────────────
        console.log("\n📦 Step 8: storage round-trip");
        const body = `client-sdk-e2e ${stamp}`;
        const key = `e2e/client-sdk-${stamp}.txt`;
        let storageOk = false;
        let storageDetail = "";
        try {
            await fresh.storage.putObject({
                file: new File([body], "client-sdk.txt", { type: "text/plain" }),
                key
            });
            const got = await fresh.storage.getObject(key);
            storageOk = got !== null && (await got.text()) === body;
            storageDetail = got === null ? "getObject returned null" : "";
        } catch (err) {
            storageDetail = (err as Error).message.slice(0, 120);
        }
        check("upload then download returns the same bytes", storageOk, storageDetail);

        // ── 9. Realtime ──────────────────────────────────────────────────────
        //
        // A WebSocket upgrade on the same origin, then a write made by somebody
        // else — the admin — so the event has to travel server→client rather
        // than being echoed back to the writer. `listen` delivers an initial
        // snapshot, so "an event arrived" is not the assertion: the assertion is
        // that a row written AFTER subscribing shows up.
        console.log("\n📡 Step 9: realtime");
        const title = `realtime-${stamp}`;

        // `listen` is OPTIONAL on the collection client: it is only assigned
        // when the realtime socket is wired up, so its absence means realtime
        // is not available at all. Worth an assertion of its own rather than a
        // non-null assertion — "realtime never connected" and "the event did
        // not arrive" are different failures and should not read the same.
        //
        // Held in a local because the implementation is an arrow function
        // closed over the socket, so detaching it from the collection is safe,
        // and it lets the type narrow for the call below.
        const postsCollection = adminClient.data.collection("posts");
        const listen = postsCollection.listen;
        check("the collection exposes a realtime listener", typeof listen === "function");

        // Nothing inside the promise refers to the unsubscribe handle, which is
        // what lets it be a `const` declared after the callbacks that would
        // otherwise close over it: `listen` may deliver its first snapshot
        // synchronously, and a callback reaching a `const` that has not been
        // initialised yet is a ReferenceError, not an undefined. Tearing down
        // once, after the promise settles, also covers all three exits —
        // matched, errored, timed out — with one line instead of three.
        let stopListening: (() => void) | undefined;

        const seen = typeof listen !== "function" ? false : await new Promise<boolean>((resolve) => {
            const timer = setTimeout(() => resolve(false), 25_000);

            stopListening = listen(
                { limit: 50 },
                (rows: unknown) => {
                    const list = ((rows as { data?: Record<string, unknown>[] }).data
                        ?? (rows as Record<string, unknown>[])) ?? [];
                    if (Array.isArray(list) && list.some((r) => r?.title === title)) {
                        clearTimeout(timer);
                        resolve(true);
                    }
                },
                () => {
                    clearTimeout(timer);
                    resolve(false);
                }
            );

            // Written after the subscription is established, by a different
            // client, so arrival proves propagation and not an echo.
            setTimeout(() => {
                void adminClient.data.collection("posts")
                    .create({ title, status: "draft" })
                    .catch(() => undefined);
            }, 2000);
        });

        stopListening?.();
        check("a row written after subscribing is delivered", seen);

        // ── 10. Sign out ─────────────────────────────────────────────────────
        //
        // Closing the loop on step 4: the same client that just read one row
        // must be refused once its session is gone. A sign-out that clears
        // client state but leaves the server accepting the token would pass
        // every other check in this file.
        console.log("\n🚪 Step 10: sign out");
        await fresh.auth.signOut();
        let afterSignOut = 0;
        try {
            await fresh.data.collection("users").find({ limit: 1 });
            afterSignOut = 200;
        } catch (err) {
            afterSignOut = (err as { status?: number }).status ?? -1;
        }
        check("reads are refused after signing out", afterSignOut === 401, `status ${afterSignOut}`);

        console.log(failures === 0
            ? "\n✅ Client SDK e2e passed"
            : `\n❌ ${failures} check(s) failed`);
    } finally {
        // Before anything else: every client that opened a realtime socket
        // holds the Node event loop open, along with a reconnect timer that
        // keeps redialling once the server goes away. `close()` exists for
        // exactly this and says so in its docblock — omit it and this script
        // prints every check, reports success, and then hangs forever instead
        // of exiting. Closing first also lets the server see the sockets go,
        // so its own graceful shutdown is not waiting on them.
        for (const client of clients) client.close();

        // Order is load-bearing. The backend holds a connection pool against
        // this container and `installShutdownHandlers` drains crons, realtime
        // and that pool on SIGTERM. Removing the database first turns the
        // graceful path into "terminating connection due to unexpected
        // postmaster exit", a 15s shutdown timeout, and a forced non-zero exit.
        //
        // So: stop the server, wait for it to actually be gone, and only then
        // take the database away. Waiting also means a shutdown regression
        // shows up here as a hang rather than being masked by the container
        // disappearing underneath it.
        if (backend) {
            killTree(backend, "SIGTERM");
            await backendExit;
        }
        if (container) await stopPgContainer(container.containerName);
    }

    if (failures > 0) process.exit(1);
}

run().catch((err) => {
    console.error("\n❌ Client SDK e2e crashed:", err);
    process.exit(1);
});
