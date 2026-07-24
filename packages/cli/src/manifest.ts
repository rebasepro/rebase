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
import type {
    ManagedCompatibility,
    RebaseAppConfig,
    RebaseBackendAppConfig,
    RebaseProjectManifest
} from "@rebasepro/types";
import { MANIFEST_FILENAME } from "./utils/project";

/** Runtime range written into new manifests. */
export const CURRENT_RUNTIME_RANGE = "^1";

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

const APP_TYPES = ["backend", "static", "admin", "mobile", "custom"] as const;

/** Reserved because they name things in URLs and CLI output. */
const RESERVED_APP_NAMES = new Set(["api", "health", "metrics", "livez", "_rebase"]);

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
        if (required) issues.push({ path: fieldPath, message: "is required" });
        return undefined;
    }
    if (typeof value !== "string" || value.trim() === "") {
        issues.push({ path: fieldPath, message: "must be a non-empty string" });
        return undefined;
    }
    if (path.isAbsolute(value)) {
        issues.push({ path: fieldPath, message: "must be a relative path, not absolute" });
        return undefined;
    }
    const normalized = path.normalize(value);
    if (normalized === ".." || normalized.startsWith(`..${path.sep}`)) {
        issues.push({ path: fieldPath, message: "must stay inside the project directory" });
        return undefined;
    }
    return value;
}

function validateApp(
    name: string,
    raw: unknown,
    issues: ManifestValidationIssue[]
): RebaseAppConfig | undefined {
    const base = `apps.${name}`;

    if (!isRecord(raw)) {
        issues.push({ path: base, message: "must be an object" });
        return undefined;
    }

    const type = raw.type;
    if (typeof type !== "string" || !(APP_TYPES as readonly string[]).includes(type)) {
        issues.push({
            path: `${base}.type`,
            message: `must be one of: ${APP_TYPES.join(", ")}`
        });
        return undefined;
    }

    switch (type) {
        case "backend": {
            checkRelativePath(raw.config, `${base}.config`, issues, { required: false });
            checkRelativePath(raw.functions, `${base}.functions`, issues, { required: false });
            checkRelativePath(raw.crons, `${base}.crons`, issues, { required: false });
            checkRelativePath(raw.schema, `${base}.schema`, issues, { required: false });
            if (raw.mode !== undefined && raw.mode !== "cms" && raw.mode !== "baas") {
                issues.push({ path: `${base}.mode`, message: 'must be "cms" or "baas"' });
            }
            return raw as unknown as RebaseAppConfig;
        }
        case "static": {
            checkRelativePath(raw.root, `${base}.root`, issues, { required: true });
            checkRelativePath(raw.output, `${base}.output`, issues, { required: true });
            if (raw.build !== undefined && typeof raw.build !== "string") {
                issues.push({ path: `${base}.build`, message: "must be a string command" });
            }
            if (raw.spa !== undefined && typeof raw.spa !== "boolean") {
                issues.push({ path: `${base}.spa`, message: "must be a boolean" });
            }
            return raw as unknown as RebaseAppConfig;
        }
        case "admin": {
            const mode = raw.mode ?? "hosted";
            if (mode !== "hosted" && mode !== "bundled") {
                issues.push({ path: `${base}.mode`, message: 'must be "hosted" or "bundled"' });
                return undefined;
            }
            if (mode === "bundled") {
                // A bundled admin panel is built here, so it needs somewhere to
                // build from and somewhere to put the result. Hosted needs
                // neither, which is the entire point of it being the default.
                checkRelativePath(raw.root, `${base}.root`, issues, { required: true });
                checkRelativePath(raw.output, `${base}.output`, issues, { required: true });
            }
            return raw as unknown as RebaseAppConfig;
        }
        case "mobile": {
            const platform = raw.platform;
            if (platform !== "ios" && platform !== "android" && platform !== "other") {
                issues.push({
                    path: `${base}.platform`,
                    message: 'must be "ios", "android" or "other"'
                });
            }
            return raw as unknown as RebaseAppConfig;
        }
        case "custom": {
            checkRelativePath(raw.dockerfile, `${base}.dockerfile`, issues, { required: false });
            checkRelativePath(raw.context, `${base}.context`, issues, { required: false });
            if (raw.port !== undefined && (typeof raw.port !== "number" || !Number.isInteger(raw.port))) {
                issues.push({ path: `${base}.port`, message: "must be an integer" });
            }
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
        return { issues: [{ path: "", message: `${MANIFEST_FILENAME} must contain a JSON object` }] };
    }

    if (typeof raw.runtime !== "string" || raw.runtime.trim() === "") {
        issues.push({
            path: "runtime",
            message: `is required, e.g. "${CURRENT_RUNTIME_RANGE}"`
        });
    }

    if (!isRecord(raw.apps)) {
        issues.push({ path: "apps", message: "is required and must be an object" });
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
            issues.push({ path: `apps.${name}`, message: "name is reserved" });
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

    if (issues.length > 0) return { issues };

    return {
        manifest: {
            $schema: typeof raw.$schema === "string" ? raw.$schema : undefined,
            runtime: raw.runtime as string,
            apps
        },
        issues
    };
}

/**
 * Infer a manifest from a directory that does not have one.
 *
 * This mirrors exactly what the template scaffolds, which is what makes adopting
 * the manifest a no-op for existing projects: the synthesized result is what
 * they would have written by hand.
 *
 * An ejected backend — one with its own `src/index.ts` entrypoint — is reported
 * as a `custom` app rather than a `backend` app. That is not a downgrade; it is
 * an accurate description, and it is what keeps such a project deploying exactly
 * as it does today.
 */
export function synthesizeManifest(projectRoot: string): RebaseProjectManifest {
    const exists = (relative: string): boolean => fs.existsSync(path.join(projectRoot, relative));
    const apps: Record<string, RebaseAppConfig> = {};

    const hasConfig = exists(DEFAULT_CONFIG_DIR);
    const hasBackend = exists("backend");
    const backendEntry = exists("backend/src/index.ts");

    if (hasBackend && backendEntry) {
        apps.backend = {
            type: "custom",
            dockerfile: exists("backend/Dockerfile") ? "backend/Dockerfile" : undefined,
            context: "."
        } as RebaseAppConfig;
    } else if (hasBackend || hasConfig) {
        const backend: RebaseBackendAppConfig = { type: "backend" };
        if (!hasConfig) backend.mode = "baas";
        if (exists(DEFAULT_FUNCTIONS_DIR)) backend.functions = DEFAULT_FUNCTIONS_DIR;
        if (exists(DEFAULT_CRONS_DIR)) backend.crons = DEFAULT_CRONS_DIR;
        apps.backend = backend;
    }

    if (exists("frontend")) {
        apps.web = {
            type: "static",
            root: "frontend",
            build: "npm run build --workspace frontend",
            output: "frontend/dist",
            spa: true
        };
    }

    return { runtime: CURRENT_RUNTIME_RANGE, apps };
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
        return { manifest: synthesizeManifest(projectRoot), source: "synthesized" };
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

    return { manifest, source: "file", filePath };
}

/** Write a manifest, with a trailing newline so it plays well with other tools. */
export function writeManifest(projectRoot: string, manifest: RebaseProjectManifest): string {
    const filePath = manifestPath(projectRoot);
    const ordered = {
        $schema: manifest.$schema ?? "https://rebase.pro/schemas/rebase.json",
        runtime: manifest.runtime,
        apps: manifest.apps
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
        if (app.type === "backend") return { name, app: app as RebaseBackendAppConfig };
    }
    return undefined;
}

/** Apps that produce build output, in the order they should be built. */
export function buildableApps(
    manifest: RebaseProjectManifest
): { name: string; app: RebaseAppConfig }[] {
    // Backend first: a static app's build may consume an SDK generated from the
    // backend's collections, so building it second is the order that works.
    const entries = Object.entries(manifest.apps).map(([name, app]) => ({ name, app }));
    const rank = (app: RebaseAppConfig): number => {
        if (app.type === "backend") return 0;
        if (app.type === "admin") return 1;
        if (app.type === "static") return 2;
        return 3;
    };
    return entries
        .filter(({ app }) => app.type !== "mobile")
        .sort((a, b) => rank(a.app) - rank(b.app));
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
    const reasons: string[] = [];

    const backend = findBackendApp(manifest);
    if (!backend) {
        const custom = Object.entries(manifest.apps).find(([, app]) => app.type === "custom");
        if (custom) {
            reasons.push(
                `App "${custom[0]}" is a custom container. The managed runtime runs the ` +
                "platform image with your bundle, so a project that builds its own image " +
                "uses the custom runtime instead."
            );
        } else {
            reasons.push(
                "No backend app is declared in this repository. Only the repository that " +
                "declares the backend selects the runtime."
            );
        }
    }

    for (const [name, app] of Object.entries(manifest.apps)) {
        if (app.type === "custom") {
            reasons.push(`App "${name}" is a custom container image.`);
        }
    }

    return { eligible: reasons.length === 0 && Boolean(backend), reasons };
}

/** Resolve a backend app's directories against the conventions it omits. */
export function resolveBackendPaths(app: RebaseBackendAppConfig): {
    config: string;
    functions: string;
    crons: string;
    schema: string;
    usersCollection: string;
    mode: "cms" | "baas";
} {
    return {
        config: app.config ?? DEFAULT_CONFIG_DIR,
        functions: app.functions ?? DEFAULT_FUNCTIONS_DIR,
        crons: app.crons ?? DEFAULT_CRONS_DIR,
        schema: app.schema ?? DEFAULT_SCHEMA_FILE,
        usersCollection: app.usersCollection ?? "collections/users",
        mode: app.mode ?? "cms"
    };
}
