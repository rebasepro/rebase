/**
 * `rebase cloud init --claim` — a live backend for this project, with no
 * account, and a link that hands it to a person.
 *
 * The command an agent runs when it has built an app and needs somewhere to
 * put it. The control plane provisions an ordinary project on Rebase Cloud in
 * an organization nobody owns yet, this command pushes the local collections to
 * it with a normal managed deploy, and what comes back is the live URL and a
 * claim link. The person the agent works for opens the link, signs in, and the
 * project is theirs; nobody claims it within 72 hours and it is deleted.
 *
 * What it writes:
 *
 * - `.env`: `REBASE_BASE_URL`, the project's live address — where the app, the
 *   SDK and the MCP server should reach the backend now — and, once the deploy
 *   has built the app, `REBASE_API_TOKEN`: a key the APP accepts, minted on it
 *   by the control plane (`POST /api/functions/ephemeral/app-key`). It reads and
 *   writes data through the app's row-level security, holds nothing of the
 *   admin plane, and expires with the claim window; see {@link requestAppKey}.
 *   With `--no-deploy`, or a deploy that failed, the next `rebase cloud deploy`
 *   that succeeds asks for it instead; see {@link mintMissingAppKey}.
 * - `.rebase/cloud.json`: the link, so every `rebase cloud` command in this
 *   directory acts on the project.
 * - `~/.rebase/credentials.json`: the project's token and claim link. Not the
 *   repository: see `EphemeralGrant` in `context.ts` for why neither may go in
 *   `.env` or the link file. `rebase cloud` commands in a directory linked to
 *   the project pick the token up from there by themselves.
 *
 * @module
 */
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import chalk from "chalk";
import {
    appKeyExpiryNote,
    dotenvSets,
    emit,
    ephemeralGrantFor,
    fail,
    grantForLink,
    isJsonMode,
    keyValues,
    note,
    noteBlank,
    parseCloudArgs,
    readLink,
    resolveCloudUrl,
    saveEphemeralGrant,
    success,
    TOKEN_ENV,
    warn,
    writeLink
} from "./context";
import { dotenvLine } from "./env";
import { findProjectRoot } from "../../utils/project";
import { cmsMountOf, loadManifest } from "../../manifest";
import { cliUserAgent } from "../../utils/version";

/** What `rebase cloud init` parses, beside the global flags. Exported so its help page cannot drift. */
export const INIT_FLAGS = {
    "--claim": Boolean,
    "--name": String,
    "-n": "--name",
    "--no-deploy": Boolean
} as const;

/** The variable the app, the SDK and the MCP server read the backend's address from. */
export const BASE_URL_ENV = "REBASE_BASE_URL";

/** The variable the MCP server and the SDK read the app's key from. */
export const API_TOKEN_ENV = "REBASE_API_TOKEN";

/** What `POST /api/functions/ephemeral/provision` answers. */
export interface ProvisionedProject {
    projectId: string;
    slug: string;
    name: string;
    projectUrl: string;
    apiKey: string;
    claimUrl: string;
    expiresAt: string;
}

function isProvisionedProject(value: unknown): value is ProvisionedProject {
    return typeof value === "object" && value !== null
        && "projectId" in value && typeof value.projectId === "string"
        && "slug" in value && typeof value.slug === "string"
        && "name" in value && typeof value.name === "string"
        && "projectUrl" in value && typeof value.projectUrl === "string"
        && "apiKey" in value && typeof value.apiKey === "string"
        && "claimUrl" in value && typeof value.claimUrl === "string"
        && "expiresAt" in value && typeof value.expiresAt === "string";
}

/** The control plane's refusal envelope, `{ error: { code, message } }`, when that is what arrived. */
function refusalOf(value: unknown): { code: string; message: string } | undefined {
    if (typeof value !== "object" || value === null || !("error" in value)) return undefined;
    const error = value.error;
    if (typeof error !== "object" || error === null) return undefined;
    const message = "message" in error && typeof error.message === "string" ? error.message : undefined;
    const code = "code" in error && typeof error.code === "string" ? error.code : "error";
    return message ? { code, message } : undefined;
}

/**
 * Ask the control plane for a project. No credential: this is the one call in
 * the family that is made by nobody.
 */
export async function requestEphemeralProject(url: string, name: string | undefined): Promise<ProvisionedProject> {
    let res: Response;
    try {
        res = await fetch(`${url}/api/functions/ephemeral/provision`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "User-Agent": cliUserAgent() },
            body: JSON.stringify(name ? { name } : {})
        });
    } catch (err) {
        fail(
            `Could not reach ${url}: ${err instanceof Error ? err.message : String(err)}`,
            "Check your connection, or pass --url for another control plane.",
            "unreachable"
        );
    }
    const body: unknown = await res.json().catch(() => undefined);
    if (!res.ok) {
        const refusal = refusalOf(body);
        if (res.status === 429) {
            fail(
                refusal?.message ?? "Too many projects were provisioned from this address recently.",
                "Claim one of them, wait, or create a project with an account: `rebase cloud login`, then `rebase cloud projects create --link`.",
                "rate_limited"
            );
        }
        if (res.status === 404) {
            fail(
                `${url} does not provision projects without an account.`,
                "Sign in with `rebase cloud login` and run `rebase cloud projects create --link`.",
                "not_supported"
            );
        }
        fail(
            refusal?.message ?? `The control plane refused the provision (${res.status}).`,
            "Sign in with `rebase cloud login` and run `rebase cloud projects create --link` instead.",
            refusal?.code ?? "provision_refused"
        );
    }
    if (!isProvisionedProject(body)) {
        fail("The control plane's answer did not describe a project.", undefined, "bad_response");
    }
    return body;
}

/** What `POST /api/functions/ephemeral/app-key` answers: a key minted on the app itself. */
export interface AppKey {
    apiKey: string;
    keyId: string;
    scopes: string[];
    expiresAt: string;
}

function isAppKey(value: unknown): value is AppKey {
    return typeof value === "object" && value !== null
        && "apiKey" in value && typeof value.apiKey === "string" && value.apiKey.startsWith("rk_")
        && "keyId" in value && typeof value.keyId === "string"
        && "scopes" in value && Array.isArray(value.scopes) && value.scopes.every((s: unknown) => typeof s === "string")
        && "expiresAt" in value && typeof value.expiresAt === "string";
}

export type AppKeyOutcome = { ok: true; key: AppKey } | { ok: false; code: string; message: string };

export interface AppKeyRetry {
    /** How many times to ask while the app is still coming up. */
    attempts: number;
    sleep: (ms: number) => Promise<void>;
}

const APP_KEY_RETRY: AppKeyRetry = {
    attempts: 4,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms))
};

/** Between asks while the app is not answering yet. */
const APP_KEY_RETRY_DELAY_MS = 5_000;

/**
 * Ask the control plane for a key the deployed app accepts, with the project's
 * own token.
 *
 * The control plane mints it on the app through the app's admin key route: a
 * service key holding `data:read` and `data:write` and nothing else, running
 * through the app's row-level security as a caller who is neither a person nor
 * an admin, expiring with the claim window. Never fatal: the project and its
 * claim link stand without it, so a refusal comes back as an outcome to report.
 *
 * Asks again only while the app is not answering yet (503), the state a
 * rollout that has just finished can still be in.
 */
export async function requestAppKey(
    url: string,
    token: string,
    projectId: string,
    retry: AppKeyRetry = APP_KEY_RETRY
): Promise<AppKeyOutcome> {
    let last: AppKeyOutcome = { ok: false, code: "unreachable", message: "The control plane was not asked." };
    for (let attempt = 1; attempt <= Math.max(1, retry.attempts); attempt++) {
        if (attempt > 1) await retry.sleep(APP_KEY_RETRY_DELAY_MS);
        let res: Response;
        try {
            res = await fetch(`${url}/api/functions/ephemeral/app-key`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${token}`,
                    "User-Agent": cliUserAgent()
                },
                body: JSON.stringify({ projectId })
            });
        } catch (err) {
            return { ok: false, code: "unreachable", message: `Could not reach ${url}: ${err instanceof Error ? err.message : String(err)}` };
        }
        const body: unknown = await res.json().catch(() => undefined);
        if (res.ok) {
            return isAppKey(body)
                ? { ok: true, key: body }
                : { ok: false, code: "bad_response", message: "The control plane's answer did not carry a key." };
        }
        const refusal = refusalOf(body);
        last = {
            ok: false,
            code: refusal?.code ?? "app_key_refused",
            message: refusal?.message ?? `The control plane did not mint a key for the app (${res.status}).`
        };
        if (res.status === 404 && !refusal) {
            return { ok: false, code: "not_supported", message: `${url} does not mint keys for an unclaimed project's app.` };
        }
        if (res.status !== 503) return last;
    }
    return last;
}

/**
 * Set one variable in a `.env`, keeping every other line as it was: replaced
 * where it is already set, appended where it is not.
 */
export function upsertDotenv(file: string, key: string, value: string): void {
    const line = dotenvLine(key, value);
    if (!line) throw new Error(`${key} cannot be written to a .env file as it is.`);
    const existing = fs.existsSync(file) ? fs.readFileSync(file, "utf-8") : "";
    const lines = existing.length > 0 ? existing.replace(/\n$/, "").split("\n") : [];
    const at = lines.findIndex((l) => new RegExp(`^\\s*(export\\s+)?${key}\\s*=`).test(l));
    if (at >= 0) lines[at] = line;
    else lines.push(line);
    fs.writeFileSync(file, `${lines.join("\n")}\n`);
}

export { dotenvSets };

/**
 * Set on the deploy `init` runs as a child. `init` asks for the app's key
 * itself once that deploy is done, and reports it in its own result, so the
 * child leaves it alone: asked twice, the second key revokes the first.
 */
export const INIT_CHILD_DEPLOY_ENV = "REBASE_CLOUD_INIT_DEPLOY";

/** The key's outcome as a result reports it. Never the key: this output reaches an agent's transcript. */
export function appKeyPayload(outcome: AppKeyOutcome): Record<string, unknown> {
    return outcome.ok
        ? {
            ok: true,
            env: API_TOKEN_ENV,
            scopes: outcome.key.scopes,
            expiresAt: outcome.key.expiresAt,
            // A claim does not extend it: say so where an agent reads it.
            note: appKeyExpiryNote(outcome.key.expiresAt)
        }
        : { ok: false, error: { code: outcome.code, message: outcome.message } };
}

/**
 * After `rebase cloud deploy` succeeded: the app's key, when this directory is
 * linked to an unclaimed project and its `.env` has none yet.
 *
 * `init` asks for the key right after its own deploy, so a project provisioned
 * with `--no-deploy`, or whose first deploy failed, had no way to get one, and
 * `init` does not run again in a linked directory. The next deploy that builds
 * the app is that way.
 *
 * Asks nothing when the project is claimed or its grant has expired (there is
 * no grant then), when the deploy was for a project other than the linked one,
 * or when `.env` already sets `REBASE_API_TOKEN`: that may be a key someone
 * made by hand, and a new one revokes the last one minted. Never throws, since
 * the deploy succeeded either way, and answers `undefined` when it asked nothing.
 */
export async function mintMissingAppKey(opts: {
    url: string;
    projectId: string;
    /** The directory holding the link and `.env`: the project root, or the working directory. */
    root?: string;
    appKey?: InitDeps["appKey"];
}): Promise<AppKeyOutcome | undefined> {
    try {
        if (process.env[INIT_CHILD_DEPLOY_ENV]) return undefined;
        const root = opts.root ?? findProjectRoot() ?? process.cwd();
        if (readLink(root)?.projectId !== opts.projectId) return undefined;
        const grant = ephemeralGrantFor(opts.url, opts.projectId);
        if (!grant) return undefined;
        const dotenv = path.join(root, ".env");
        if (dotenvSets(dotenv, API_TOKEN_ENV)) return undefined;

        const outcome = await (opts.appKey ?? DEFAULT_DEPS.appKey)(opts.url, grant.token, opts.projectId);
        if (outcome.ok) upsertDotenv(dotenv, API_TOKEN_ENV, outcome.key.apiKey);
        return outcome;
    } catch (err) {
        return { ok: false, code: "app_key_failed", message: err instanceof Error ? err.message : String(err) };
    }
}

/**
 * Say how {@link mintMissingAppKey} went, under a deploy's verdict and before
 * its result. A refusal is a warning, in every output mode: the deploy
 * succeeded regardless. JSON carries the same through {@link appKeyPayload}.
 */
export function reportMintedAppKey(outcome: AppKeyOutcome | undefined): void {
    if (!outcome) return;
    if (!outcome.ok) {
        warn(
            `${API_TOKEN_ENV} was not written: ${outcome.message}`,
            "The deploy succeeded without it. The next `rebase cloud deploy` asks again, until the project is claimed."
        );
        return;
    }
    if (isJsonMode()) return;
    console.log(chalk.gray(`  ${API_TOKEN_ENV} set in .env (${outcome.key.scopes.join(", ")}): the app's own key, for this unclaimed project.`));
    console.log(chalk.gray("  It reads and writes data as the app's rules allow."));
    console.log(chalk.gray(`  ${appKeyExpiryNote(outcome.key.expiresAt)}`));
    console.log("");
}

/**
 * Where the project's CMS is served once deployed: the mount `rebase.json`
 * declares, on the project's own host unless that app names its own.
 */
export function adminPanelUrl(projectRoot: string | null, projectUrl: string): string | undefined {
    if (!projectRoot) return undefined;
    try {
        const mount = cmsMountOf(loadManifest(projectRoot).manifest);
        if (!mount) return undefined;
        const origin = mount.host ? `https://${mount.host}` : projectUrl.replace(/\/+$/, "");
        return `${origin}${mount.path === "/" ? "/" : mount.path}`;
    } catch {
        return undefined;
    }
}

/** How a deploy went, as `rebase cloud deploy --json` reported it. */
export interface DeployOutcome {
    ok: boolean;
    /** The deploy's own JSON result or error, when it printed one. */
    result?: unknown;
}

/**
 * The environment of {@link runBundleDeploy}'s child: this one, marked as
 * init's own deploy, and without `REBASE_TOKEN`.
 *
 * `REBASE_TOKEN` outranks the stored grant (see `requireClient`), and a shell
 * or an MCP server that has one holds it for the person's other projects — it
 * has no scope on the project just provisioned, so the deploy was refused and
 * the project never got its collections. The project is deployed with its own
 * token.
 */
export function bundleDeployEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    const child: NodeJS.ProcessEnv = { ...env, [INIT_CHILD_DEPLOY_ENV]: "1" };
    delete child[TOKEN_ENV];
    return child;
}

/**
 * Push the local collections: `rebase cloud deploy --bundle`, as a child.
 *
 * A child rather than a call, so this command still prints exactly one
 * result — a JSON caller gets the deploy's outcome folded into it — and still
 * prints the claim link when the deploy fails. The child finds the project
 * through the link just written, and its token through the credentials file.
 * It asks for no app key: this command does, after it (see {@link INIT_CHILD_DEPLOY_ENV}).
 */
export function runBundleDeploy(cwd: string, json: boolean): Promise<DeployOutcome> {
    const bin = process.argv[1];
    const args = [bin, "cloud", "deploy", "--bundle", ...(json ? ["--json"] : [])];
    return new Promise((resolve) => {
        const child = spawn(process.execPath, args, {
            cwd,
            stdio: json ? ["ignore", "pipe", "inherit"] : "inherit",
            env: bundleDeployEnv(process.env)
        });
        let stdout = "";
        child.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf-8"); });
        child.on("error", () => resolve({ ok: false }));
        child.on("close", (code) => {
            let result: unknown;
            try {
                result = stdout.trim() ? JSON.parse(stdout) : undefined;
            } catch {
                result = stdout.trim() || undefined;
            }
            resolve({ ok: code === 0, result });
        });
    });
}

export interface InitDeps {
    provision: typeof requestEphemeralProject;
    deploy: typeof runBundleDeploy;
    appKey: (url: string, token: string, projectId: string) => Promise<AppKeyOutcome>;
}

const DEFAULT_DEPS: InitDeps = {
    provision: requestEphemeralProject,
    deploy: runBundleDeploy,
    appKey: (url, token, projectId) => requestAppKey(url, token, projectId)
};

export async function cloudInitCommand(rawArgs: string[], deps: InitDeps = DEFAULT_DEPS): Promise<void> {
    const { flags } = parseCloudArgs({
        spec: INIT_FLAGS,
        rawArgs,
        commandWords: 2, // cloud init
        command: "cloud init",
        maxPositionals: 0
    });

    if (!flags["--claim"]) {
        fail(
            "`rebase cloud init` provisions a project with no account, and needs --claim to say so.",
            "`rebase cloud init --claim` gives this directory a live backend and a link to claim it within 72 hours. "
                + "With an account: `rebase cloud login`, then `rebase cloud projects create --link`.",
            "usage"
        );
    }

    const existing = readLink();
    if (existing?.projectId) {
        // An unclaimed project here is the one to hand over, not to replace:
        // unlinking it leaves it running, and orphaned, until it expires.
        const grant = grantForLink(existing);
        fail(
            `This directory is already linked to project ${existing.slug ?? existing.projectId}.`,
            grant
                ? `It is unclaimed: open ${grant.claimUrl} and sign in to keep it (it is deleted ${new Date(grant.expiresAt).toLocaleString()} otherwise). `
                    + "Deploy to it with `rebase cloud deploy`."
                : "Run `rebase cloud unlink` first to provision a new one here.",
            "already_linked"
        );
    }

    const url = resolveCloudUrl(rawArgs);
    const projectRoot = findProjectRoot();
    const root = projectRoot ?? process.cwd();

    note(`Provisioning a project on ${chalk.cyan(url)}…`);
    const project = await deps.provision(url, flags["--name"]?.trim() || undefined);

    // The token and the claim link first, before anything that can fail: they
    // are the only copy, and the link is how a person ever gets the project.
    saveEphemeralGrant(url, project.projectId, {
        token: project.apiKey,
        claimUrl: project.claimUrl,
        expiresAt: project.expiresAt
    });
    writeLink({ url, projectId: project.projectId, slug: project.slug, projectName: project.name, apiUrl: project.projectUrl }, root);
    upsertDotenv(path.join(root, ".env"), BASE_URL_ENV, project.projectUrl);

    let deployed: DeployOutcome | undefined;
    if (!flags["--no-deploy"]) {
        if (!projectRoot) {
            warn("No rebase.json here, so there is nothing to deploy yet.", "Run `rebase cloud deploy` from the project once it has one.");
        } else {
            note("Pushing the local collections (rebase cloud deploy --bundle)…");
            noteBlank();
            deployed = await deps.deploy(root, isJsonMode());
            if (!deployed.ok) {
                warn(
                    "The deploy did not finish. The project and its claim link are kept.",
                    "Fix what the deploy reported and run `rebase cloud deploy` again."
                );
            }
        }
    }

    // Only once the deploy has built the app: before that there is nothing to
    // mint the key on. A missing key is reported, never fatal.
    let appKey: AppKeyOutcome | undefined;
    if (deployed?.ok) {
        appKey = await deps.appKey(url, project.apiKey, project.projectId);
        if (appKey.ok) {
            upsertDotenv(path.join(root, ".env"), API_TOKEN_ENV, appKey.key.apiKey);
        } else {
            warn(
                `${API_TOKEN_ENV} was not written: ${appKey.message}`,
                "The project is live without it. The next `rebase cloud deploy` here asks again, until the project is claimed."
            );
        }
    }

    const adminUrl = deployed?.ok ? adminPanelUrl(projectRoot, project.projectUrl) : undefined;
    const expires = new Date(project.expiresAt);

    success(`Provisioned ${chalk.bold(project.name)}${deployed?.ok ? " and deployed it" : ""}`);
    emit(
        () => {
            keyValues([
                ["Project", project.slug],
                ["Live URL", project.projectUrl],
                ["Admin panel", adminUrl],
                ["App key", appKey?.ok ? `${API_TOKEN_ENV} in .env (${appKey.key.scopes.join(", ")})` : undefined],
                ["Claim URL", chalk.bold(project.claimUrl)],
                ["Expires", `${expires.toLocaleString()} (72 hours) unless claimed`]
            ]);
            console.log("");
            const written = appKey?.ok ? `${BASE_URL_ENV} and ${API_TOKEN_ENV} are` : `${BASE_URL_ENV} is`;
            console.log(chalk.gray(`  ${written} set in .env. Open the claim URL, sign in, and the project is yours;`));
            console.log(chalk.gray("  until then `rebase cloud` commands here use the project's own token."));
            if (appKey?.ok) {
                console.log(chalk.gray(`  ${API_TOKEN_ENV} reads and writes data as the app's rules allow.`));
                console.log(chalk.gray(`  ${appKeyExpiryNote(appKey.key.expiresAt)}`));
            }
            console.log("");
        },
        {
            projectId: project.projectId,
            slug: project.slug,
            name: project.name,
            projectUrl: project.projectUrl,
            adminUrl: adminUrl ?? null,
            claimUrl: project.claimUrl,
            expiresAt: project.expiresAt,
            env: { [BASE_URL_ENV]: project.projectUrl },
            // The key itself stays in .env: this output reaches an agent's transcript.
            appKey: appKey ? appKeyPayload(appKey) : null,
            deploy: deployed ? { ok: deployed.ok, result: deployed.result ?? null } : null
        }
    );
    if (deployed && !deployed.ok) process.exitCode = 1;
}
