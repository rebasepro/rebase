/**
 * Development secrets that survive a restart.
 *
 * `loadEnv` generates `JWT_SECRET` and `REBASE_SERVICE_KEY` when they are unset
 * outside production, so a developer can start without setting anything up. It
 * generated them **freshly on every boot**, which meant every restart of the dev
 * server silently invalidated the previous run's tokens: you were logged out of
 * your own app because you edited a file, and the API key you had just made
 * stopped working.
 *
 * The CLI already worked around it for scaffolded projects by writing a stable
 * `JWT_SECRET` into `.env` at `rebase init` — the comment there says exactly
 * why. That leaves anyone who did not scaffold, and anyone running from a
 * container with no `.env`, with the logout-on-restart behaviour.
 *
 * So the generated values are cached in a file beside the other dev-state
 * files — `.rebase-dev-port` and `.rebase-dev-url` follow the same convention
 * and are gitignored in the same place.
 *
 * ## What this does not change
 *
 * Production. `loadEnv` refuses to start when a secret was auto-generated and
 * `NODE_ENV=production`, and that is untouched: this only makes the
 * already-generated development values stable. There is no path by which a
 * cached secret becomes a production one.
 *
 * ## Failing soft
 *
 * A read-only filesystem, a container without a writable working directory, a
 * permissions problem — none of these should stop a development server from
 * starting. Every failure here falls back to the previous behaviour, an
 * ephemeral secret, and says so once at debug level.
 */
import * as fs from "fs";
import * as path from "path";
import { logger } from "./utils/logger";

/** Beside `.rebase-dev-port` and `.rebase-dev-url`, and gitignored with them. */
export const DEV_SECRETS_FILENAME = ".rebase-dev-secrets.json";

/** Owner read/write only. These are secrets, even development ones. */
const FILE_MODE = 0o600;

export interface DevSecretStore {
    /** The cached value for `name`, or undefined. */
    get(name: string): string | undefined;
    /** Cache `value` under `name`. Failures are swallowed by design. */
    set(name: string, value: string): void;
    /** Where this store reads and writes, for logging. */
    readonly file: string;
    /** False when the file could not be read *or* written. */
    readonly usable: boolean;
}

/** Whether these environment variables describe a test runner. */
export function detectTestRunner(env: NodeJS.ProcessEnv): boolean {
    return Boolean(
        env.JEST_WORKER_ID || env.VITEST || env.VITEST_WORKER_ID || env.NODE_ENV === "test"
    );
}

/**
 * Whether a test runner started this process, decided **once at import**.
 *
 * Read at call time it would be wrong, and provably so: `env.test.ts` does
 * `process.env = {}` in its `beforeEach`, which erases `NODE_ENV` and
 * `JEST_WORKER_ID` alike. A predicate consulting the live environment therefore
 * sees a bare object and concludes "development", which is how the first version
 * of this dropped a `.rebase-dev-secrets.json` into `packages/server` on every
 * test run.
 *
 * Whether a test runner is hosting the process is a fact about the process, not
 * about whatever a test has since done to `process.env`, so it is captured
 * before any test can rewrite it.
 */
export const TEST_RUNNER_DETECTED = detectTestRunner(process.env);

/**
 * Whether generated secrets should be cached at all.
 *
 * Not in production — `loadEnv` refuses to boot there on a generated secret, so
 * there is nothing to cache and no path by which a cached one becomes a
 * production one.
 *
 * Not under a test runner: a test must not inherit a secret a previous run left
 * behind, and a library call has no business writing into a suite's working
 * directory. `inTestRunner` is a parameter only so this predicate can be tested
 * on its own; callers pass nothing.
 */
export function shouldCacheDevSecrets(
    env: NodeJS.ProcessEnv = process.env,
    inTestRunner: boolean = TEST_RUNNER_DETECTED
): boolean {
    if (inTestRunner) return false;
    return env.NODE_ENV !== "production";
}

/** `REBASE_DEV_SECRETS_FILE`, or the conventional name in the working directory. */
export function resolveDevSecretsFile(env: NodeJS.ProcessEnv = process.env): string {
    const override = env.REBASE_DEV_SECRETS_FILE?.trim();
    if (override) return path.resolve(override);
    return path.join(process.cwd(), DEV_SECRETS_FILENAME);
}

/**
 * Open the cache.
 *
 * Reading a malformed file is treated as an empty cache rather than an error:
 * the file is ours, it holds regenerable values, and refusing to boot over a
 * corrupted convenience cache would be worse than rewriting it.
 */
export function openDevSecretStore(file = resolveDevSecretsFile()): DevSecretStore {
    let cache: Record<string, string> = {};
    let usable = true;

    try {
        if (fs.existsSync(file)) {
            const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf-8"));
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
                    if (typeof value === "string" && value.length > 0) cache[key] = value;
                }
            }
        }
    } catch {
        // Unreadable or malformed: start empty and try to rewrite on first set.
        cache = {};
    }

    const flush = (): void => {
        try {
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file, `${JSON.stringify(cache, null, 2)}\n`, { mode: FILE_MODE });
            // Existing files keep their old mode through `writeFileSync`, so set
            // it explicitly — a file created before this ran, or by a different
            // umask, would otherwise stay group-readable.
            fs.chmodSync(file, FILE_MODE);
        } catch (err) {
            if (usable) {
                usable = false;
                logger.debug(
                    `[dev-secrets] Could not write ${file}, so generated development secrets will not ` +
                    `survive a restart: ${err instanceof Error ? err.message : String(err)}`
                );
            }
        }
    };

    return {
        file,
        get usable() { return usable; },
        get: (name) => cache[name],
        set: (name, value) => {
            cache[name] = value;
            flush();
        }
    };
}
