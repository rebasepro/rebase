/**
 * Let a closed PGlite's WebAssembly heap be collected, even when the test file
 * that made it never is. Loaded for every file through `setupFiles` in
 * jest.config.cjs.
 *
 * Two things combine. Jest runs this package with `--experimental-vm-modules`
 * (PGlite needs it for its `await import("fs")`), and under that flag a test
 * file's sandbox — its module registry and every module-scope variable — is
 * never freed: it lives as long as the worker. So a file's `let db: PGlite`
 * keeps that file's last database alive for the rest of the run. And
 * PGlite 0.5's `close()` means to let go of its Emscripten module
 * (`this.mod = void 0`), but the assignment comes after
 * `_emscripten_force_exit(0)`, which throws first, so it never runs. A closed
 * instance therefore still holds its ~250 MB WebAssembly memory.
 *
 * Together, each PGlite-backed file left a quarter of a gigabyte behind in its
 * worker. Jest's `workerIdleMemoryLimit` cannot see it — it measures the JS heap
 * (`heapUsed`), and WebAssembly memory lives outside it — so the workers were
 * never recycled: on Linux they grew past 4 GB each until the kernel's OOM
 * killer fired. On CI that took the runner down with them — "The runner has
 * received a shutdown signal", or a job that went silent until its 30-minute
 * timeout with no log to show (verify / unit-postgres, shard 2, which holds the
 * most PGlite files; six times between 2026-11-17 and 11-19).
 *
 * Dropping the module reference once `close()` has finished is what PGlite
 * itself intended, and touches nothing a closed instance can still do.
 */
import { PGlite } from "@electric-sql/pglite";

const close = PGlite.prototype.close;

PGlite.prototype.close = async function closeAndRelease(this: PGlite): Promise<void> {
    try {
        await close.call(this);
    } finally {
        this.mod = undefined;
    }
};
