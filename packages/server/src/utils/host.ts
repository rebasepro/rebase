/**
 * The host globals this package reads, behind functions that do not assume Node.
 *
 * `process` is not defined on workerd, on Deno Deploy without the compat flag,
 * or in a browser. That matters here for one specific reason: the portable
 * authoring surface (`@rebasepro/server/functions`) reaches the logger and the
 * error handler, and a bare `process.env.NODE_ENV` inside either of them turns
 * the first log line of a request into a `ReferenceError` on a runtime that has
 * no `process` — a failure that reads as "the framework crashed" rather than
 * "this runtime has no process object".
 *
 * Nothing here throws and nothing here is async. A runtime that cannot answer
 * gets the empty answer, because every caller in this file's blast radius is
 * choosing a log level or a format, and the safe default for both is the
 * development one.
 *
 * @module
 */

/**
 * Where an adapter with no `process` can publish the environment.
 *
 * Cloudflare Workers hand the environment to the *request*, not to the module,
 * so there is no global to read at import time. An edge adapter that has
 * already seen a request can stash the bag here and every contextless reader in
 * the framework — the logger, chiefly — starts answering correctly.
 *
 * `Symbol.for` rather than a module-local for the same reason the singleton
 * uses it: more than one copy of this module can be loaded into one process,
 * and a module-local would leave every copy but the writer's blind. See
 * `../singleton.ts`.
 *
 * Request-scoped code should NOT read this. Use `getEnv(c)` from
 * `@rebasepro/server/functions`, which reads the binding attached to the
 * request it is serving — the only correct source on a runtime where two
 * concurrent requests can carry different bindings.
 */
const ENV_SLOT = Symbol.for("@rebasepro/server:host-env");

type GlobalWithEnv = typeof globalThis & {
    [ENV_SLOT]?: Record<string, string | undefined>;
    process?: { env?: Record<string, string | undefined> };
};

/**
 * The process environment, or the closest thing this runtime has to one.
 *
 * Order: a bag published by {@link setHostEnv} first, because an adapter that
 * set one knows more than the ambient globals do; then `process.env`; then
 * nothing.
 */
export function hostEnv(): Record<string, string | undefined> {
    const global = globalThis as GlobalWithEnv;
    return global[ENV_SLOT] ?? global.process?.env ?? {};
}

/**
 * Read one environment variable without touching `process` directly.
 *
 * Trimmed, and blank is treated as absent — a variable declared with no value
 * is the ordinary way to write a compose file or a `.env` line, and every
 * caller in this package means "unset" by it. See `resolveFunctionsTimeoutMs`,
 * which learned that the hard way.
 */
export function hostEnvVar(name: string): string | undefined {
    const raw = hostEnv()[name];
    if (typeof raw !== "string") return undefined;
    const trimmed = raw.trim();
    return trimmed === "" ? undefined : trimmed;
}

/**
 * Publish an environment bag for contextless readers.
 *
 * Called by an adapter for a runtime whose environment is not ambient. Merges
 * rather than replaces, so two adapters (or an adapter plus a test) do not
 * silently erase each other's variables.
 */
export function setHostEnv(env: Record<string, string | undefined>): void {
    const global = globalThis as GlobalWithEnv;
    global[ENV_SLOT] = {
        ...(global[ENV_SLOT] ?? {}),
        ...env
    };
}

/** @internal Test seam — drops anything {@link setHostEnv} published. */
export function _clearHostEnv(): void {
    delete (globalThis as GlobalWithEnv)[ENV_SLOT];
}

type GlobalWithStdio = typeof globalThis & {
    process?: {
        stdout?: { write?: (chunk: string) => unknown };
        stderr?: { write?: (chunk: string) => unknown };
    };
};

/**
 * Write one already-formatted line to the process's output.
 *
 * `process.stdout.write` is preferred where it exists because it is the only
 * one of the two that does not append its own formatting to a line that is
 * already a complete JSON document — `console.log` on Node is
 * `process.stdout.write` plus `util.format`, and `util.format` will happily
 * reinterpret a `%s` that appeared inside a user's log message.
 *
 * Where it does not exist, `console` is the runtime's log sink and is what its
 * platform collects.
 */
export function writeLine(stream: "out" | "err", line: string): void {
    const proc = (globalThis as GlobalWithStdio).process;
    const sink = stream === "err" ? proc?.stderr : proc?.stdout;
    if (typeof sink?.write === "function") {
        sink.write(line + "\n");
        return;
    }
    if (stream === "err") console.error(line);
    else console.log(line);
}
