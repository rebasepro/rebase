/**
 * Reading configuration from inside a custom function.
 *
 * `process.env.STRIPE_SECRET_KEY` at the top of a function file is the second
 * of the two places the contract silently depends on Node, and it is the one
 * people write without thinking, because on Node it is correct.
 *
 * On an isolate-based host it is wrong twice over:
 *
 * 1. **There is no `process` during module evaluation.** Bindings are attached
 *    to the *request*, so at import time — which is when a module-scope
 *    `new Stripe(process.env.KEY!)` runs — there is nothing to read. The module
 *    throws before a single request is served.
 * 2. **Two concurrent requests in one isolate can carry different bindings.**
 *    A value captured once at module scope is then the wrong value for
 *    somebody, silently, and only under concurrency.
 *
 * Both disappear if configuration is read from the request. {@link getEnv}
 * does that on every host: `c.env` where the host puts bindings there,
 * `process.env` where it does not. {@link lazyResource} covers the reason the
 * module-scope version was attractive in the first place — building an
 * expensive client exactly once.
 *
 * @module
 */
import type { Context } from "hono";
import { env as hostBindings, getRuntimeKey } from "hono/adapter";

/**
 * Every environment variable visible to this request.
 *
 * `c.env` on workerd, `Deno.env` on Deno, `process.env` on Node, Bun and
 * Vercel's edge runtime. Reading it through here rather than through `process`
 * is the whole of what makes a function's configuration portable.
 */
export function getEnv(c: Context): Record<string, string | undefined> {
    return hostBindings<Record<string, string | undefined>>(c);
}

/**
 * One environment variable, or `undefined`.
 *
 * Trimmed, and a blank value counts as absent — declaring a variable and
 * leaving it empty is the ordinary way to write a compose file or a `.env`
 * line, and nobody has ever meant `""` by it.
 */
export function env(c: Context, name: string): string | undefined {
    const raw = getEnv(c)[name];
    if (typeof raw !== "string") return undefined;
    const trimmed = raw.trim();
    return trimmed === "" ? undefined : trimmed;
}

/**
 * One environment variable, or a thrown error naming it.
 *
 * For configuration a handler cannot run without. Throwing here — inside the
 * request — is deliberately better than the module-scope `process.env.KEY!`
 * it replaces: that one takes the whole *file* down at load time, and the
 * loader reports it as "this function could not be imported", which names the
 * file but not the variable. This fails one request, with the name in the
 * message, while every other route in the file keeps serving.
 */
export function requireEnv(c: Context, name: string): string {
    const value = env(c, name);
    if (value === undefined) {
        throw new Error(
            `Missing required environment variable ${name}. Set it on the process ` +
            "(or as a binding, on a host that has them) — and read it inside the " +
            "handler, not at module scope, so the same file works on both."
        );
    }
    return value;
}

/**
 * Which host this is: `"node"`, `"workerd"`, `"deno"`, `"bun"`, `"edge-light"`,
 * `"fastly"` or `"other"`.
 *
 * Use it to *degrade*, not to branch a whole implementation — a function that
 * needs two implementations is two functions. It is honest about one thing in
 * particular: a Node-only capability, such as `rebase.sql()`, can check this
 * and say so, instead of failing at the call.
 */
export function runtimeKey(): string {
    return getRuntimeKey();
}

/** Whether this is a Node-like host — Node itself, or Bun's Node compatibility. */
export function isNodeRuntime(): boolean {
    const key = getRuntimeKey();
    return key === "node" || key === "bun";
}

/**
 * Build something expensive once per environment, on first use, from inside a
 * request.
 *
 * This is the sanctioned replacement for the module-scope client:
 *
 * ```ts
 * // Don't: runs at import time, before bindings exist on some hosts.
 * const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
 *
 * // Do: runs on first request, reads that request's configuration.
 * const stripe = lazyResource(env => new Stripe(env.STRIPE_SECRET_KEY!));
 * app.post("/", async (c) => { await stripe(c).charges.list(); });
 * ```
 *
 * The factory runs once per distinct environment object and the result is
 * cached against it. On Node that is once per process, because `process.env` is
 * one object for the life of the process — identical to the module-scope
 * version in cost, and unlike it, deferred until configuration exists. On a
 * host that hands each request a fresh binding object it is once per object,
 * which is the only correct answer there: caching across bindings would serve
 * one tenant's client to another.
 *
 * A {@link WeakMap} holds the cache, so an environment object the host has
 * finished with takes the resource with it.
 */
export function lazyResource<T>(
    factory: (env: Record<string, string | undefined>) => T
): (c: Context) => T {
    const cache = new WeakMap<object, T>();

    return (c: Context): T => {
        const bindings = getEnv(c);
        // A host that returns a primitive-ish or null bag (Fastly returns `{}`
        // freshly each call) still works — it just rebuilds, which is correct
        // and rare.
        if (!bindings || typeof bindings !== "object") return factory(bindings ?? {});

        const existing = cache.get(bindings);
        if (existing !== undefined) return existing;

        const created = factory(bindings);
        cache.set(bindings, created);
        return created;
    };
}
