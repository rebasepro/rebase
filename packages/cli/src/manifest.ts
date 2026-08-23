/**
 * Loading, validating and synthesizing `rebase.json`.
 *
 * The manifest declares *topology*: which runtime major a project targets and
 * which apps this repository contributes. It is deliberately small — schema,
 * security rules, hooks and functions stay in TypeScript, where a type system
 * can check them.
 *
 * Two properties matter more than the file format itself:
 *
 * - **A missing manifest is never an error.** Every project that exists today
 *   predates this file. One is synthesized from the conventions the template
 *   already follows, so nothing breaks and nobody is forced to migrate.
 * - **Validation reports every problem at once**, with the path to each. A
 *   config file that surfaces its mistakes one run at a time is a bad config
 *   file.
 */
import fs from "fs";
import path from "path";
import {
    findStorageSuffixCollision,
    reservedPrefixFor,
    type DeclaredStorageSources,
    type ManagedCompatibility,
    type RebaseAppConfig,
    type RebaseBackendAppConfig,
    type RebaseProjectManifest
} from "@rebasepro/types";
import { MANIFEST_FILENAME } from "./utils/project";

/** Runtime range written into new manifests. */
export const CURRENT_RUNTIME_RANGE = "^2";

/** Conventional locations, matching what `rebase init` scaffolds. */
export const DEFAULT_CONFIG_DIR = "config";
export const DEFAULT_FUNCTIONS_DIR = "backend/functions";
export const DEFAULT_CRONS_DIR = "backend/crons";
export const DEFAULT_SCHEMA_FILE = "backend/src/schema.generated.ts";

export interface ManifestValidationIssue {
    /** Dotted path to the offending value, e.g. `apps.web.output`. */
    path: string;
    message: string;
}

export interface LoadedManifest {
    manifest: RebaseProjectManifest;
    /** Where it came from — a real file, or inferred from the directory layout. */
    source: "file" | "synthesized";
    /** Absolute path to `rebase.json`, when one exists. */
    filePath?: string;
}

export class ManifestError extends Error {
    constructor(message: string, readonly issues: ManifestValidationIssue[] = []) {
        super(message);
        this.name = "ManifestError";
    }
}

const APP_TYPES = ["backend", "static"] as const;

/**
 * App types that used to exist, and what replaced each one.
 *
 * Kept so a manifest written against the old vocabulary fails with the fix in
 * hand rather than with `must be one of: backend, static`, which tells a reader
 * what is wrong but not what to write instead.
 */
const REMOVED_APP_TYPES: Record<string, string> = {
    admin:
        "the admin panel is an ordinary static app now — declare it as " +
        '{ "type": "static", "root": "frontend", "output": "frontend/dist", "path": "/admin" }',
    custom:
        "who owns the server is a property of the backend now — declare " +
        '{ "type": "backend", "runtime": "custom" } instead of a separate app',
    mobile:
        "mobile apps are no longer declared in the manifest — nothing consumed this type. " +
        "Remove the entry"
};

/** Reserved because they name things in URLs and CLI output. */
const RESERVED_APP_NAMES = new Set(["api", "health", "metrics", "livez", "_rebase"]);

/**
 * Validate a static app's public base path.
 *
 * Normalizes to "no trailing slash, except for the root" so that mounting and
 * the `REBASE_APP_BASE` build variable have one shape to reason about.
 */
function checkAppPath(
    value: unknown,
    fieldPath: string,
    issues: ManifestValidationIssue[]
): string | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== "string" || !value.startsWith("/") || value.includes("..")) {
        issues.push({
            path: fieldPath,
            message: 'must be an absolute path like "/admin"'
        });
        return undefined;
    }
    if (value !== "/" && value.endsWith("/")) {
        issues.push({
            path: fieldPath,
            message: 'must not end with a slash — write "/admin", not "/admin/"'
        });
        return undefined;
    }
    // Mounting is longest-path-first, so an app at `/api` outranks the API and
    // every request to it is answered with that app's index.html — a 200 of HTML
    // where the caller wanted JSON, from a deployment that looks healthy.
    const reserved = reservedPrefixFor(value);
    if (reserved) {
        issues.push({
            path: fieldPath,
            message: `cannot be "${reserved}" or nest under it — the backend serves that path, ` +
                "and an app mounted there would answer the API's requests with its own index.html"
        });
        return undefined;
    }
    return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reject paths that escape the repository.
 *
 * A manifest is committed and reviewed, so this is not a security boundary so
 * much as a guard against `../../` typos that would otherwise have `rebase build`
 * writing outside the project.
 */
function checkRelativePath(
    value: unknown,
    fieldPath: string,
    issues: ManifestValidationIssue[],
    { required }: { required: boolean }
): string | undefined {
    if (value === undefined) {
        if (required) issues.push({ path: fieldPath,
message: "is required" });
        return undefined;
    }
    if (typeof value !== "string" || value.trim() === "") {
        issues.push({ path: fieldPath,
message: "must be a non-empty string" });
        return undefined;
    }
    if (path.isAbsolute(value)) {
        issues.push({ path: fieldPath,
message: "must be a relative path, not absolute" });
        return undefined;
    }
    const normalized = path.normalize(value);
    if (normalized === ".." || normalized.startsWith(`..${path.sep}`)) {
        issues.push({ path: fieldPath,
message: "must stay inside the project directory" });
        return undefined;
    }
    return value;
}

/** Fields each app type understands. Anything else is a typo or a newer CLI. */
const KNOWN_APP_FIELDS: Record<string, readonly string[]> = {
    backend: ["type", "runtime", "config", "functions", "crons", "schema",
        "usersCollection", "dockerfile", "context", "port"],
    static: ["type", "root", "build", "output", "path", "spa"]
};

/**
 * Report a field this CLI does not recognise.
 *
 * A warning rather than an error, and the distinction matters in both
 * directions. `"pathh": "/admin"` is a typo that would otherwise be silently
 * dropped — the app builds for `/`, mounts at `/`, and the only symptom is that
 * it is not where you put it. But an unknown field is also what an *older* CLI
 * sees when it opens a manifest written for a newer one, and refusing to build
 * over a field that is simply from the future would make every manifest addition
 * a breaking change.
 *
 * So: name it, suggest the near-miss, and carry on.
 */
function warnUnknownFields(name: string, raw: Record<string, unknown>, type: string): void {
    const known = KNOWN_APP_FIELDS[type];
    if (!known) return;

    for (const field of Object.keys(raw)) {
        if (known.includes(field)) continue;
        const suggestion = known.find(candidate => isNearMiss(candidate, field));
        console.warn(
            `⚠ rebase.json: apps.${name}.${field} is not a field this CLI knows.` +
            (suggestion ? ` Did you mean "${suggestion}"?` : " It is ignored — your CLI may be older than this manifest.")
        );
    }
}

/** One edit apart, ignoring case: enough for a typo, tight enough to stay quiet. */
function isNearMiss(a: string, b: string): boolean {
    const x = a.toLowerCase();
    const y = b.toLowerCase();
    if (x === y) return true;
    if (Math.abs(x.length - y.length) > 1) return false;

    const [shorter, longer] = x.length <= y.length ? [x, y] : [y, x];
    let i = 0;
    let j = 0;
    let edits = 0;
    while (i < shorter.length && j < longer.length) {
        if (shorter[i] === longer[j]) { i++; j++; continue; }
        if (++edits > 1) return false;
        if (shorter.length === longer.length) i++;
        j++;
    }
    return edits + (longer.length - j) + (shorter.length - i) <= 1;
}

function validateApp(
    name: string,
    raw: unknown,
    issues: ManifestValidationIssue[]
): RebaseAppConfig | undefined {
    const base = `apps.${name}`;

    if (!isRecord(raw)) {
        issues.push({ path: base,
message: "must be an object" });
        return undefined;
    }

    const type = raw.type;
    if (typeof type === "string" && REMOVED_APP_TYPES[type]) {
        issues.push({ path: `${base}.type`,
message: `"${type}" is no longer an app type — ${REMOVED_APP_TYPES[type]}` });
        return undefined;
    }
    if (typeof type !== "string" || !(APP_TYPES as readonly string[]).includes(type)) {
        issues.push({
            path: `${base}.type`,
            message: `must be one of: ${APP_TYPES.join(", ")}`
        });
        return undefined;
    }

    warnUnknownFields(name, raw, type);

    switch (type) {
        case "backend": {
            checkRelativePath(raw.config, `${base}.config`, issues, { required: false });
            checkRelativePath(raw.functions, `${base}.functions`, issues, { required: false });
            checkRelativePath(raw.crons, `${base}.crons`, issues, { required: false });
            checkRelativePath(raw.schema, `${base}.schema`, issues, { required: false });
            checkRelativePath(raw.usersCollection, `${base}.usersCollection`, issues, { required: false });

            if (raw.mode !== undefined) {
                issues.push({
                    path: `${base}.mode`,
                    message:
                        "is no longer a field — collections come from the config directory when " +
                        "it exists, and are introspected from the database when it does not"
                });
            }

            const custom = raw.runtime === "custom";
            if (raw.runtime !== "managed" && !custom) {
                issues.push({
                    path: `${base}.runtime`,
                    message: 'is required, and must be "managed" or "custom"'
                });
            }

            // The image fields describe an image this repository builds. Under a
            // managed backend there is no such image, so accepting them silently
            // would be accepting a Dockerfile that never gets built.
            for (const field of ["dockerfile", "context", "port"] as const) {
                if (raw[field] !== undefined && !custom) {
                    issues.push({
                        path: `${base}.${field}`,
                        message: 'only applies to a custom runtime — set "runtime": "custom" to build your own image'
                    });
                }
            }
            checkRelativePath(raw.dockerfile, `${base}.dockerfile`, issues, { required: false });
            checkRelativePath(raw.context, `${base}.context`, issues, { required: false });
            if (raw.port !== undefined && (typeof raw.port !== "number" || !Number.isInteger(raw.port))) {
                issues.push({ path: `${base}.port`,
message: "must be an integer" });
            }
            return raw as unknown as RebaseAppConfig;
        }
        case "static": {
            checkRelativePath(raw.root, `${base}.root`, issues, { required: true });
            checkRelativePath(raw.output, `${base}.output`, issues, { required: true });
            if (raw.build !== undefined && typeof raw.build !== "string") {
                issues.push({ path: `${base}.build`,
message: "must be a string command" });
            }
            if (raw.spa !== undefined && typeof raw.spa !== "boolean") {
                issues.push({ path: `${base}.spa`,
message: "must be a boolean" });
            }
            checkAppPath(raw.path, `${base}.path`, issues);
            return raw as unknown as RebaseAppConfig;
        }
        default:
            return undefined;
    }
}

/**
 * Validate a parsed manifest, collecting every problem.
 */
export function validateManifest(raw: unknown): {
    manifest?: RebaseProjectManifest;
    issues: ManifestValidationIssue[];
} {
    const issues: ManifestValidationIssue[] = [];

    if (!isRecord(raw)) {
        return { issues: [{ path: "",
message: `${MANIFEST_FILENAME} must contain a JSON object` }] };
    }

    if (typeof raw.rebase !== "string" || raw.rebase.trim() === "") {
        // `runtime` used to be this key. It now means who owns the backend
        // process, so a manifest still using it at the top level is naming the
        // wrong thing rather than merely missing a field.
        const message = typeof raw.runtime === "string"
            ? `is required, e.g. "${CURRENT_RUNTIME_RANGE}" — this is the top-level "runtime" key renamed, ` +
              'because "runtime" now means "managed" or "custom" on the backend app'
            : `is required, e.g. "${CURRENT_RUNTIME_RANGE}"`;
        issues.push({ path: "rebase",
message });
    }

    if (!isRecord(raw.apps)) {
        issues.push({ path: "apps",
message: "is required and must be an object" });
        return { issues };
    }

    const apps: Record<string, RebaseAppConfig> = {};
    let backendCount = 0;

    for (const [name, value] of Object.entries(raw.apps)) {
        if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
            issues.push({
                path: `apps.${name}`,
                message: "name must be lowercase alphanumeric with dashes (it appears in URLs)"
            });
            continue;
        }
        if (RESERVED_APP_NAMES.has(name)) {
            issues.push({ path: `apps.${name}`,
message: "name is reserved" });
            continue;
        }

        const app = validateApp(name, value, issues);
        if (!app) continue;
        if (app.type === "backend") backendCount++;
        apps[name] = app;
    }

    // One backend per *project*. A repository declaring two would have two sets
    // of collections claiming the same database and the same API surface.
    if (backendCount > 1) {
        issues.push({
            path: "apps",
            message: "a project may declare at most one backend app"
        });
    }

    // Two apps at one path is not a preference conflict — the first one mounted
    // swallows the other's URLs, and the loser looks like it deployed fine.
    const byPath = new Map<string, string>();
    for (const [name, app] of Object.entries(apps)) {
        if (app.type !== "static") continue;
        const at = app.path ?? "/";
        const owner = byPath.get(at);
        if (owner) {
            issues.push({
                path: `apps.${name}.path`,
                message: `two apps cannot serve the same path — "${owner}" is already at "${at}"`
            });
            continue;
        }
        byPath.set(at, name);
    }

    refuseStorageBlock(raw.storage, issues);

    // Carried rather than dropped. This key is the only repository-wide privacy
    // control the CLI honours, and a key that does not survive a parse does not
    // survive a rewrite either: `writeManifest` builds its output from what this
    // returned, so `rebase eject` deleted a committed `"telemetry": false` and
    // every developer who had ever opted in silently resumed sending events.
    //
    // Only a boolean is a value here — `true` is ignored elsewhere, loudly, but
    // it is still valid. A string `"false"` is the mistake that would leave
    // sharing on while looking like it was off, so it is named rather than
    // quietly discarded.
    let telemetry: boolean | undefined;
    if (raw.telemetry !== undefined) {
        if (typeof raw.telemetry === "boolean") {
            telemetry = raw.telemetry;
        } else {
            issues.push({
                path: "telemetry",
                message: "must be a boolean — only `false` does anything, and it opts this repository out of usage sharing"
            });
        }
    }

    if (issues.length > 0) return { issues };

    return {
        manifest: {
            $schema: typeof raw.$schema === "string" ? raw.$schema : undefined,
            rebase: raw.rebase as string,
            apps,
            ...(telemetry !== undefined ? { telemetry } : {})
        },
        issues
    };
}

/**
 * Refuse a hand-written `storage` block.
 *
 * Buckets are declared in config code now — `bucket("media")` — and the graph
 * is generated from those declarations into `rebase.resources.json`. Two homes
 * for one concept is what this replaced, and the reason it had to go is that
 * the runtime *merged* them: a bucket declared in both had one engine kept and
 * the other silently discarded.
 *
 * Refused rather than ignored. A key that still parses and no longer does
 * anything is the same failure wearing a nicer hat — the author sees valid
 * JSON, the platform sees a bucket, and the runtime has neither.
 */
function refuseStorageBlock(raw: unknown, issues: ManifestValidationIssue[]): undefined {
    if (raw === undefined) return undefined;
    issues.push({
        path: "storage",
        message:
            "is no longer read. Declare each bucket in your config's resources.ts — " +
            'bucket("media", { engine: "s3" }) — then run `rebase resources --write`, ' +
            "which generates rebase.resources.json. Refused rather than ignored: this " +
            "block used to be merged with the code's declarations and silently win."
    });
    return undefined;
}

/**
 * Infer a manifest from a directory that does not have one.
 *
 * This mirrors exactly what the template scaffolds, which is what makes adopting
 * the manifest a no-op for existing projects: the synthesized result is what
 * they would have written by hand.
 *
 * The backend's `runtime` is inferred from whether the repository declares a
 * **Dockerfile** — the thing that actually builds an image — and from nothing
 * else. It used to be inferred from the presence of `backend/src/index.ts`,
 * which every scaffolded project had whether or not it wanted its own server, so
 * projects predating the manifest silently landed on the custom runtime and paid
 * for it (see `docs/cloud-deploy-workspace-vendoring.md`).
 */
export function synthesizeManifest(projectRoot: string): RebaseProjectManifest {
    const exists = (relative: string): boolean => fs.existsSync(path.join(projectRoot, relative));
    const apps: Record<string, RebaseAppConfig> = {};

    const hasConfig = exists(DEFAULT_CONFIG_DIR);
    const hasBackend = exists("backend");
    const dockerfile = ["Dockerfile", "backend/Dockerfile"].find(exists);

    if (hasBackend || hasConfig) {
        const backend: RebaseBackendAppConfig = dockerfile
            ? { type: "backend",
runtime: "custom",
dockerfile,
context: "." }
            : { type: "backend",
runtime: "managed" };
        if (exists(DEFAULT_FUNCTIONS_DIR)) backend.functions = DEFAULT_FUNCTIONS_DIR;
        if (exists(DEFAULT_CRONS_DIR)) backend.crons = DEFAULT_CRONS_DIR;
        apps.backend = backend;

        // Say it out loud. The file looks exactly like the server and is never
        // loaded, which used to be discovered only after a deploy answered 404
        // on every route defined in it.
        if (!dockerfile && exists("backend/src/index.ts")) {
            console.warn(
                "⚠ backend/src/index.ts exists but this project's backend is managed — it is\n" +
                "    never loaded. Delete it, or move it aside and run `rebase eject`, which\n" +
                "    writes an entrypoint of its own and owns the image. Eject does not adopt\n" +
                "    this file: it refuses to replace it unless you pass --force."
            );
        }
    }

    if (exists("frontend")) {
        apps.web = {
            type: "static",
            root: "frontend",
            build: "npm run build --workspace frontend",
            output: "frontend/dist",
            path: "/",
            spa: true
        };
    }

    return { rebase: CURRENT_RUNTIME_RANGE,
apps };
}

export function manifestPath(projectRoot: string): string {
    return path.join(projectRoot, MANIFEST_FILENAME);
}

export function manifestExists(projectRoot: string): boolean {
    return fs.existsSync(manifestPath(projectRoot));
}

/**
 * Read the manifest, falling back to a synthesized one.
 *
 * A malformed manifest throws — unlike a missing one. Silently ignoring a file
 * the developer wrote, and building something else instead, is the worst
 * available behaviour.
 */
export function loadManifest(projectRoot: string): LoadedManifest {
    const filePath = manifestPath(projectRoot);

    if (!fs.existsSync(filePath)) {
        return { manifest: synthesizeManifest(projectRoot),
source: "synthesized" };
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (err) {
        throw new ManifestError(
            `${MANIFEST_FILENAME} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`
        );
    }

    const { manifest, issues } = validateManifest(parsed);
    if (!manifest) {
        throw new ManifestError(`${MANIFEST_FILENAME} is invalid`, issues);
    }

    return { manifest,
source: "file",
filePath };
}

/** The keys `writeManifest` knows how to write. Everything else is carried through. */
const MODELLED_MANIFEST_KEYS = ["$schema", "rebase", "apps", "storage", "telemetry"];

/**
 * What is on disk right now, or `{}` — this is a *rewrite*, so the file that is
 * about to be replaced is the only record of the keys the caller did not model.
 * Unparseable is treated as absent: `loadManifest` refuses malformed JSON long
 * before anything gets here, and a writer is not the place to fail on it.
 */
function readManifestObject(filePath: string): Record<string, unknown> {
    try {
        const parsed: unknown = JSON.parse(fs.readFileSync(filePath, "utf8"));
        return isRecord(parsed) ? parsed : {};
    } catch {
        return {};
    }
}

/**
 * Write a manifest, with a trailing newline so it plays well with other tools.
 *
 * **Every key on disk survives.** This used to emit exactly `$schema`, `rebase`
 * and `apps`, so a rewrite deleted the rest of the file — and two commands with
 * no visible relationship to either key rewrite it: `rebase eject` and
 * `rebase apps init --force`. A repository that had committed
 * `"telemetry": false` lost its opt-out, and a multi-bucket project lost its
 * whole `storage` block, in a commit whose stated change was `runtime: custom`.
 *
 * So: the caller's manifest wins for what it models, the file supplies the rest.
 * `storage` and `telemetry` fall back to the file because the callers that
 * synthesize a manifest (`apps init --force`) cannot know them — they are
 * authored, not inferred — and unknown top-level keys are copied verbatim
 * rather than listed, since a hand-listed set loses the next key too.
 */
export function writeManifest(projectRoot: string, manifest: RebaseProjectManifest): string {
    const filePath = manifestPath(projectRoot);
    const existing = readManifestObject(filePath);

    const carried: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(existing)) {
        if (!MODELLED_MANIFEST_KEYS.includes(key)) carried[key] = value;
    }

    const schema = manifest.$schema
        ?? (typeof existing.$schema === "string" ? existing.$schema : undefined)
        ?? "https://rebase.pro/schemas/rebase.json";
    const telemetry = manifest.telemetry ?? (typeof existing.telemetry === "boolean" ? existing.telemetry : undefined);

    const ordered = {
        $schema: schema,
        rebase: manifest.rebase,
        apps: manifest.apps,
        ...(telemetry !== undefined ? { telemetry } : {}),
        ...carried
    };
    fs.writeFileSync(filePath, `${JSON.stringify(ordered, null, 4)}\n`, "utf8");
    return filePath;
}

// ─────────────────────────────────────────────────────────────────────────────
// Queries
// ─────────────────────────────────────────────────────────────────────────────

/** Find the single backend app, if this repository declares one. */
export function findBackendApp(
    manifest: RebaseProjectManifest
): { name: string; app: RebaseBackendAppConfig } | undefined {
    for (const [name, app] of Object.entries(manifest.apps)) {
        if (app.type === "backend") return { name,
app: app as RebaseBackendAppConfig };
    }
    return undefined;
}

/**
 * The app a deploy targets: the one named, or the obvious one.
 *
 * A repository declares apps; a project owns them. So "which app" is a question
 * a multi-repo setup asks routinely and a single-app repository should never
 * have to answer — hence the fallbacks, in the order that makes each of them
 * unambiguous:
 *
 * - A name, when one is given. Wrong names fail loudly, listing what is there;
 *   guessing past a typo would deploy the wrong app to a live project.
 * - The backend, when this repository declares one. It is the app whose deploy
 *   people mean when they do not say, and it is what every existing invocation
 *   already did.
 * - The only app, when there is exactly one. This is what makes a static-only
 *   repository — an admin panel, a marketing site — deploy with no argument.
 * - Otherwise a refusal that lists the choices. A repository with two static
 *   apps and no backend has no obvious default, and picking one would publish
 *   somebody's admin panel at their marketing domain.
 */
export function selectDeployApp(
    manifest: RebaseProjectManifest,
    requested?: string
): { name: string; app: RebaseAppConfig } {
    const entries = Object.entries(manifest.apps).map(([name, app]) => ({ name,
app }));

    if (requested) {
        const match = entries.find(entry => entry.name === requested);
        if (!match) {
            const known = entries.map(e => e.name).join(", ") || "none";
            throw new ManifestError(
                `This repository declares no app named "${requested}". It declares: ${known}.`
            );
        }
        return match;
    }

    const backend = findBackendApp(manifest);
    if (backend) return { name: backend.name,
app: backend.app };

    if (entries.length === 1) return entries[0];

    if (entries.length === 0) {
        throw new ManifestError(
            `${MANIFEST_FILENAME} declares no apps, so there is nothing to deploy.`
        );
    }

    throw new ManifestError(
        "This repository declares several apps and no backend, so there is no obvious one to deploy. " +
        `Name one: ${entries.map(e => e.name).join(", ")}.`
    );
}

/** Apps that produce build output, in the order they should be built. */
export function buildableApps(
    manifest: RebaseProjectManifest
): { name: string; app: RebaseAppConfig }[] {
    // Backend first: a static app's build may consume an SDK generated from the
    // backend's collections, so building it second is the order that works.
    const entries = Object.entries(manifest.apps).map(([name, app]) => ({ name,
app }));
    const rank = (app: RebaseAppConfig): number => (app.type === "backend" ? 0 : 1);
    return entries.sort((a, b) => rank(a.app) - rank(b.app));
}

/**
 * Decide whether a project can run on the managed runtime, and say why not.
 *
 * "Not eligible" is never a dead end — it selects the custom-runtime path, which
 * still deploys. The reasons exist so the answer is actionable rather than a
 * verdict.
 */
export function assessManagedCompatibility(
    manifest: RebaseProjectManifest
): ManagedCompatibility {
    const backend = findBackendApp(manifest);

    if (!backend) {
        return {
            eligible: false,
            reasons: [
                "No backend app is declared in this repository. Only the repository that " +
                "declares the backend selects the runtime."
            ]
        };
    }

    // Declared, not deduced. A project on the custom runtime is there because
    // somebody wrote it down, which is the whole point of the field.
    if (backend.app.runtime === "custom") {
        return {
            eligible: false,
            reasons: [
                `App "${backend.name}" declares runtime: "custom", so it builds and runs its ` +
                "own image. The managed runtime boots the platform image with your bundle; " +
                "the custom runtime deploys exactly the same way, from your Dockerfile."
            ]
        };
    }

    return { eligible: true,
reasons: [] };
}

/**
 * Resolve a backend app's directories against the conventions it omits.
 *
 * `hasCollections` replaces the old `mode: "cms" | "baas"` field. Where the
 * collections come from was never an independent choice: either they are
 * declared in code and the bundle ships them, or they are not and the runtime
 * introspects the live database at boot. Declaring it separately only created
 * the contradictory state — code-first declared, no collections anywhere.
 *
 * `hasConfig` is deliberately a **separate** question. A headless project has no
 * `config/collections`, but it may still ship a config package — that is where
 * the `storageAuthorize` hook lives, and storage is not under row-level
 * security, so without one the server refuses to boot with storage enabled.
 * Collapsing the two would leave a headless project nowhere to put it.
 */
export function resolveBackendPaths(
    app: RebaseBackendAppConfig,
    projectRoot: string
): {
    config: string;
    functions: string;
    crons: string;
    schema: string;
    usersCollection: string;
    /** Whether a config package exists — hooks, storage authorization. */
    hasConfig: boolean;
    /** Whether collections are declared in code, under `<config>/collections`. */
    hasCollections: boolean;
} {
    const config = app.config ?? DEFAULT_CONFIG_DIR;
    return {
        config,
        functions: app.functions ?? DEFAULT_FUNCTIONS_DIR,
        crons: app.crons ?? DEFAULT_CRONS_DIR,
        schema: app.schema ?? DEFAULT_SCHEMA_FILE,
        usersCollection: app.usersCollection ?? "collections/users",
        hasConfig: fs.existsSync(path.join(projectRoot, config)),
        hasCollections: fs.existsSync(path.join(projectRoot, config, "collections"))
    };
}
