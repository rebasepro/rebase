/**
 * What a backend says while it is built, held until it serves.
 *
 * `createRebaseBackend` builds everything and mounts nothing, and its build
 * logs the boot: the connection's posture, change capture, the per-boot key,
 * which process owns the schema. Those lines are the server's to print — a
 * server mounts the backend a moment later and they are its boot log. A
 * script builds a backend to call `backend.rebase` or `backend.fetch` and
 * never mounts it, and there the same lines were the first thing on its
 * stdout, ahead of the JSON it exists to print (`tsx script.ts > out.json`).
 *
 * So the info lines said inside the build — by this package or a driver, in
 * the build's async context — are held, and written when the backend first
 * serves: `mount()`, a route group, `attachRealtime()` or `start()`. They come
 * out in the order they were said, with the time they were said, before
 * anything the mount says itself; a server's boot reads as it did. A backend
 * that never serves never writes them, and what it logs at info afterwards —
 * the request log of `backend.fetch`, its shutdown — is not written either:
 * that is a library talking to itself.
 *
 * Not held, ever:
 * - warnings and errors, which say something is wrong and are written at once;
 * - anything at `LOG_LEVEL=debug`, which asks for every line as it happens;
 * - a line from anywhere outside the build — the application's own, another
 *   backend's, a request a served backend answers.
 *
 * A build that throws writes what it held: the lines before a failure are the
 * failure's context.
 *
 * Host-side: the build's context is an `AsyncLocalStorage`, so this module is
 * never reachable from `@rebasepro/server/functions`. The logger asks it
 * through `LogLineHook`, which needs nothing from Node.
 *
 * @module
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { _setLogLineHook, logLevelEnabled, type LogLevel } from "../utils/logger";

/**
 * The most lines one build holds. A build says a few dozen; past this they are
 * written as they come rather than kept, so a pathological build cannot grow
 * the buffer without bound.
 */
const MAX_HELD_LINES = 500;

/**
 * - `building`: inside `createRebaseBackend`; info lines are held.
 * - `built`: returned and not serving — a library. Info lines are not written.
 * - `serving`: mounted or started. Every line is written as it comes.
 */
type Phase = "building" | "built" | "serving";

/** One backend's announcements. See the module documentation. */
export interface BootAnnouncements {
    /** Run `fn` as this backend: info lines logged inside it, and in everything it awaits, are this backend's. */
    run<T>(fn: () => T): T;
    /** The build returned. Until {@link serve}, this backend is a library. */
    built(): void;
    /** The build threw: write what it held. */
    failed(): void;
    /** The backend serves: write what the build held, and hold nothing from now on. Idempotent. */
    serve(): void;
}

const context = new AsyncLocalStorage<Announcements>();

let installed = false;

/**
 * Point the logger at the build contexts. Once per copy of this module; a hook
 * another copy installed first is asked about every line that is not ours.
 */
function installHook(): void {
    if (installed) return;
    installed = true;
    const previous = _setLogLineHook((level, write) => {
        const own = context.getStore();
        if (own) return own.offer(level, write);
        return previous ? previous(level, write) : false;
    });
}

class Announcements implements BootAnnouncements {
    private phase: Phase = "building";
    private held: Array<() => void> = [];

    run<T>(fn: () => T): T {
        installHook();
        return context.run(this, fn);
    }

    /** Whether this backend takes the line: holds it, or does not write it. */
    offer(level: LogLevel, write: () => void): boolean {
        if (this.phase === "serving") return false;
        if (level === "warn" || level === "error") return false;
        if (logLevelEnabled("debug")) return false;
        if (this.phase === "built") return true;
        if (this.held.length >= MAX_HELD_LINES) return false;
        this.held.push(write);
        return true;
    }

    built(): void {
        if (this.phase === "building") this.phase = "built";
    }

    failed(): void {
        this.serve();
    }

    serve(): void {
        if (this.phase === "serving") return;
        this.phase = "serving";
        const held = this.held;
        this.held = [];
        for (const write of held) write();
    }
}

/** Announcements for one backend about to be built. */
export function createBootAnnouncements(): BootAnnouncements {
    return new Announcements();
}
