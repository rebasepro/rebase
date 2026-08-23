/**
 * Binding: how a declared resource is reached *here*.
 *
 * A declaration says a resource exists. It never says where it lives, because
 * that differs between a laptop, a self-hosted box and a tenant in the cloud,
 * and baking it into the repository is how a project ends up with its staging
 * credentials in git.
 *
 * Three binders, tried in this order. The order is the contract:
 *
 * 1. **An infrastructure config file** (`rebase.infra.json`, or wherever
 *    `REBASE_INFRA_CONFIG` points). Explicit, per environment, and the thing a
 *    self-hoster edits. Secrets are indirected — `{"$env": "DB_PASSWORD"}` —
 *    so the file itself can sit in a config repo.
 * 2. **Environment variables**, on the existing `<BASE>__<KEY>` convention.
 *    `DATABASE_URL__ANALYTICS` binds the database keyed `analytics`; the
 *    default-keyed one reads plain `DATABASE_URL`, so a single-database project
 *    configured the obvious way binds without declaring anything.
 * 3. **Local development**, which provisions rather than looks up.
 *
 * The cloud is not a fourth mechanism. The control plane writes an
 * infrastructure config and injects it, so a managed tenant runs the same code
 * path a self-hoster does — which is the OSS-interface rule this project holds
 * itself to: the cloud is a better implementation behind the same interface,
 * never a different one.
 *
 * ## What this file deliberately does not do
 *
 * It resolves *addresses*, not clients. Turning a binding into a pool, an S3
 * client or a queue belongs to the subsystem that owns that kind. Keeping the
 * two apart is what lets a new kind arrive without touching boot.
 */
import fs from "fs";
import path from "path";
import {
    DEFAULT_RESOURCE_KEY,
    resourceEnvSuffix,
    resourceKind,
    type ResourceDeclaration,
    type ResourceGraph
} from "@rebasepro/types";

/** Where a binding came from. Reported by `rebase doctor` and in boot logs. */
export type BindingSource = "infra-file" | "environment" | "local-dev" | "unbound";

/** One resolved resource: its declaration, plus how to reach it. */
export interface ResourceBinding {
    declaration: ResourceDeclaration;
    source: BindingSource;
    /**
     * Address and credentials, flattened. Kind-specific: a database carries
     * `url`, a bucket carries `bucket`/`region`/`endpoint`. Values are strings
     * because everything here ultimately comes from a config file or the
     * environment.
     */
    values: Record<string, string>;
}

/** A value in an infra file: a literal, or a pointer at an environment variable. */
export type InfraValue = string | number | boolean | { $env: string };

/** The infrastructure config file's shape. */
export interface InfraConfig {
    version: 1;
    /**
     * Keyed `<kind>:<key>` — the same identity the graph uses, so a reader can
     * line the two up without knowing anything about either.
     */
    resources?: Record<string, Record<string, InfraValue>>;
}

/** The conventional filename, alongside `rebase.json`. */
export const INFRA_CONFIG_FILENAME = "rebase.infra.json";

/** Environment variable naming an infra config elsewhere — what the cloud sets. */
export const INFRA_CONFIG_ENV = "REBASE_INFRA_CONFIG";

/** `kind:key`, the identity shared by the graph and the infra file. */
export function bindingId(kind: string, key: string): string {
    return `${kind}:${key}`;
}

/**
 * Resolve one infra value.
 *
 * A `$env` pointer whose variable is unset is an error rather than an empty
 * string. An empty connection string produces a failure much further away — a
 * pool that cannot connect, at first request — and nothing along the way would
 * mention the variable that was supposed to hold it.
 */
export function resolveInfraValue(value: InfraValue, env: NodeJS.ProcessEnv, where: string): string {
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    if (value && typeof value === "object" && "$env" in value) {
        const name = value.$env;
        const found = env[name];
        if (found === undefined || found === "") {
            throw new Error(
                `${where} points at environment variable ${name}, which is not set. ` +
                "An infra config indirects secrets on purpose, so the variable has to exist " +
                "wherever the config is used."
            );
        }
        return found;
    }
    throw new Error(`${where} is not a string or an {"$env": "..."} pointer.`);
}

/** Read the infra config, or null when a deployment supplies none. */
export function loadInfraConfig(projectRoot: string, env: NodeJS.ProcessEnv = process.env): InfraConfig | null {
    const explicit = env[INFRA_CONFIG_ENV];
    const file = explicit
        ? path.resolve(explicit)
        : path.join(projectRoot, INFRA_CONFIG_FILENAME);

    if (!fs.existsSync(file)) {
        // An explicitly named file that is absent is a mistake worth reporting;
        // the conventional one being absent is the common case.
        if (explicit) {
            throw new Error(
                `${INFRA_CONFIG_ENV} points at ${file}, which does not exist. ` +
                "Unset it to fall back to environment variables."
            );
        }
        return null;
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
    } catch (err) {
        throw new Error(`${file} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
    }

    const config = parsed as InfraConfig;
    if (config.version !== 1) {
        throw new Error(
            `${file} declares version ${String(config.version)}, which this runtime does not understand. ` +
            "Refusing rather than binding the half of it that happens to parse."
        );
    }
    return config;
}

/** What a local binder does for a resource nothing else bound. */
export interface LocalProvisioner {
    /** Values for this resource, or null to leave it unbound. */
    provision(declaration: ResourceDeclaration): Record<string, string> | null;
}

export interface BindOptions {
    graph: ResourceGraph;
    env?: NodeJS.ProcessEnv;
    infra?: InfraConfig | null;
    /** Used only when nothing else binds a resource, and only in development. */
    local?: LocalProvisioner | null;
}

/**
 * Read a resource's values from the environment, on the `<BASE>__<KEY>` convention.
 *
 * The kind's `envBases` decide which variables are looked at, which is what
 * lets a kind registered by a plugin bind from the environment without this
 * file knowing it exists.
 */
function fromEnvironment(declaration: ResourceDeclaration, env: NodeJS.ProcessEnv): Record<string, string> | null {
    const spec = resourceKind(declaration.kind);
    if (!spec) return null;
    const suffix = resourceEnvSuffix(declaration.key);
    const values: Record<string, string> = {};
    for (const base of spec.envBases) {
        const value = env[`${base}${suffix}`];
        if (value !== undefined && value !== "") values[base] = value;
    }
    return Object.keys(values).length > 0 ? values : null;
}

/**
 * Bind every resource in a graph.
 *
 * Never throws for an unbound resource. Whether one matters is the caller's
 * question — a bucket nobody has configured yet is a warning on a console, and
 * a database nobody has configured is a boot failure — and answering it here
 * would force both to be the same.
 */
export function bindResources(options: BindOptions): ResourceBinding[] {
    const { graph, env = process.env, infra = null, local = null } = options;
    const bindings: ResourceBinding[] = [];

    for (const declaration of graph.resources) {
        const id = bindingId(declaration.kind, declaration.key);

        const fromFile = infra?.resources?.[id];
        if (fromFile) {
            const values: Record<string, string> = {};
            for (const [k, v] of Object.entries(fromFile)) {
                values[k] = resolveInfraValue(v, env, `${INFRA_CONFIG_FILENAME} → resources["${id}"].${k}`);
            }
            bindings.push({ declaration, source: "infra-file", values });
            continue;
        }

        const fromEnv = fromEnvironment(declaration, env);
        if (fromEnv) {
            bindings.push({ declaration, source: "environment", values: fromEnv });
            continue;
        }

        const provisioned = local?.provision(declaration) ?? null;
        if (provisioned) {
            bindings.push({ declaration, source: "local-dev", values: provisioned });
            continue;
        }

        bindings.push({ declaration, source: "unbound", values: {} });
    }

    return bindings;
}

/**
 * The resources a graph declares that nothing bound.
 *
 * This is the list a console renders as "wants, does not have", and the one a
 * production boot refuses over for kinds that cannot be absent.
 */
export function unboundResources(bindings: ResourceBinding[]): ResourceBinding[] {
    return bindings.filter(b => b.source === "unbound");
}

/**
 * A message naming exactly what to set, for a resource nothing bound.
 *
 * Written for whoever hits it at 3am: the resource, the variable, and the file
 * that could also carry it. "Data source X has no connection string" without
 * the variable name has sent people reading the driver's source.
 */
export function describeUnbound(binding: ResourceBinding): string {
    const { kind, key } = binding.declaration;
    const spec = resourceKind(kind);
    const suffix = resourceEnvSuffix(key);
    const named = key === DEFAULT_RESOURCE_KEY ? `the default ${kind}` : `${kind} "${key}"`;
    const vars = (spec?.envBases ?? []).map(b => `${b}${suffix}`);
    return (
        `Nothing binds ${named}. ` +
        (vars.length > 0 ? `Set ${vars[0]}, ` : "") +
        `or add "${bindingId(kind, key)}" to ${INFRA_CONFIG_FILENAME}.`
    );
}
