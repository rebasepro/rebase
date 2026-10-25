/**
 * Preview deployments: `rebase cloud deploy --preview`, and `rebase cloud
 * previews` to list and delete them.
 *
 * A preview is a build served on an address of its own —
 * `https://<project>--<name>.rebase.website` — while production keeps serving
 * whatever it served before. It exists because the only way to see a change on
 * the real platform was to ship it to the people using the app.
 *
 * ## Why previews have their own function
 *
 * A preview is triggered through `previews`, never through `deploy` with a flag
 * on it. The point of a preview is that production is untouched, and a flag is
 * something an older control plane does not know about: `deploy` would ignore
 * it and ship the build to production — the one outcome this command exists to
 * prevent. A control plane without previews answers an unknown function with a
 * 404 instead, and nothing deploys anywhere. So the refusal is a property of the
 * route, not of every control plane remembering to check a field.
 *
 * The bundle still goes up through the deploy function's bundle upload. Storing
 * an archive deploys nothing; the trigger is what decides where it runs.
 *
 * The control plane's half — the workload, the host, the database a preview
 * backend gets, expiry — is described in `docs/preview-deployments.md`.
 */
import chalk from "chalk";
import {
    requireClient,
    requireProject,
    displayProjectRef,
    parseCloudArgs,
    emit,
    fail,
    reportError,
    requireKnownAction,
    confirmDestructive,
    success,
    type CloudClient
} from "./context";
import { isMissingRoute } from "./cron";
import { cliUserAgent } from "../../utils/version";

/** The control-plane function that creates, lists and deletes previews. */
export const PREVIEWS_FUNCTION = "previews";

/**
 * The collection a preview's deployment row lives in.
 *
 * Not `deployments`. Every reader of that collection — `cloud status`, `cloud
 * logs`, rollback, the console's history, and every CLI already installed —
 * takes its newest row to be what production runs. A preview row there would be
 * reported as production by all of them, including the versions nobody can
 * update any more.
 */
export const PREVIEW_DEPLOYMENTS_COLLECTION = "preview-deployments";

/** Longest preview name: what leaves the host inside one 63-character DNS label. */
export const MAX_PREVIEW_NAME_LENGTH = 24;

/**
 * A preview name as typed, checked and lowercased — or a refusal.
 *
 * It becomes part of a hostname, `<project>--<name>`, so it is held to a DNS
 * label's alphabet. A double hyphen is refused because the host is split on
 * it: a name holding one could never be told apart from the project's own.
 */
export function normalizePreviewName(raw: string): string {
    const name = raw.trim().toLowerCase();
    const usage = (why: string): never => fail(
        `"${raw}" cannot name a preview: ${why}.`,
        `Use lowercase letters, digits and single hyphens, up to ${MAX_PREVIEW_NAME_LENGTH} characters — a branch name such as \`new-quiz\`.`,
        "usage"
    );
    if (name === "") usage("it is empty");
    if (name.length > MAX_PREVIEW_NAME_LENGTH) usage(`it is longer than ${MAX_PREVIEW_NAME_LENGTH} characters`);
    if (!/^[a-z0-9-]+$/.test(name)) usage("it holds a character a hostname cannot");
    if (name.startsWith("-") || name.endsWith("-")) usage("it starts or ends with a hyphen");
    if (name.includes("--")) usage("`--` is what separates it from the project's name in the address");
    return name;
}

/** Which backend a preview's pages talk to. */
export type PreviewBackend = "preview" | "production";

/** A preview as the control plane describes it. */
export interface Preview {
    name: string;
    /** `https://shop--new-quiz.rebase.website`. */
    url: string;
    /** The app it serves: a static app's name, or the backend. */
    app: string | null;
    /**
     * `preview` when the preview runs a backend of its own, with its own
     * database; `production` when it is only files, calling the production API.
     */
    backend: PreviewBackend | null;
    status: string | null;
    /** The deployment that built it, in {@link PREVIEW_DEPLOYMENTS_COLLECTION}. */
    deploymentId: string | null;
    createdAt: string | null;
    updatedAt: string | null;
    /** When the control plane deletes it on its own, unless it is deployed again. */
    expiresAt: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(row: Record<string, unknown>, ...keys: string[]): string | null {
    for (const key of keys) {
        const value = row[key];
        if (typeof value === "string" && value.trim() !== "") return value.trim();
        if (typeof value === "number") return String(value);
    }
    return null;
}

/**
 * One preview out of an answer, read defensively — or null when it names no
 * address, which is the one field a preview cannot be reported without.
 */
export function previewFrom(value: unknown): Preview | null {
    if (!isRecord(value)) return null;
    const name = text(value, "name");
    const url = text(value, "url");
    if (!name || !url) return null;
    const backend = text(value, "backend");
    return {
        name,
        url: /^https?:\/\//.test(url) ? url : `https://${url}`,
        app: text(value, "app"),
        backend: backend === "preview" || backend === "production" ? backend : null,
        status: text(value, "status"),
        deploymentId: text(value, "deploymentId", "deployment_id"),
        createdAt: text(value, "createdAt", "created_at"),
        updatedAt: text(value, "updatedAt", "updated_at"),
        expiresAt: text(value, "expiresAt", "expires_at")
    };
}

/**
 * Whether a refusal means "this control plane has no previews" — and not, say,
 * "no such preview".
 *
 * A control plane answers a function it does not serve with a 404 coded
 * `FUNCTION_NOT_FOUND`; one from before that envelope, with a bare `Not Found`
 * or `No route for …`. Either is a missing route.
 */
export function isPreviewsUnavailable(e: unknown): boolean {
    const err = e as { status?: number; message?: string; code?: string };
    return err?.status === 404 && (err.code === "FUNCTION_NOT_FOUND" || isMissingRoute(err.message));
}

/** Turn "this control plane has no previews" into a refusal that says so. */
function previewsUnavailable(e: unknown): void {
    if (isPreviewsUnavailable(e)) {
        fail(
            "This control plane does not serve preview deployments yet. Nothing was deployed.",
            "Production is untouched. Deploy without --preview to ship to production.",
            "previews_unavailable"
        );
    }
}

/**
 * The intake code a control plane refuses a static app's own preview with when
 * nothing on it serves static sites by themselves (no front door). Rebase Cloud
 * is one, today: every host is served by the project's own pod.
 */
export const PREVIEW_STATIC_UNSERVED = "PREVIEW_STATIC_UNSERVED";

function intakeCodeOf(e: unknown): string | undefined {
    if (!isRecord(e) || !isRecord(e.details)) return undefined;
    return typeof e.details.intakeCode === "string" ? e.details.intakeCode : undefined;
}

/**
 * Turn "this cloud cannot serve a static app on its own" into a refusal that
 * says what to do instead — which depends on whether the project has a
 * backend to fold the app into, so both ways are named.
 */
function staticPreviewUnserved(e: unknown): void {
    if (intakeCodeOf(e) !== PREVIEW_STATIC_UNSERVED) return;
    fail(
        "Previews of a static app on its own are not available on this cloud yet: nothing here serves a static site by itself. "
            + "Nothing was published, and production is untouched.",
        "With a managed backend in rebase.json, `rebase cloud deploy --preview` previews it with its static apps folded in, "
            + "this one included. Without one, deploy the app to production with `rebase cloud deploy <app>`.",
        PREVIEW_STATIC_UNSERVED
    );
}

/** What the `previews` trigger answers. */
export interface PreviewTrigger {
    deploymentId: string;
    preview: Preview;
}

/**
 * Ask the control plane to build a preview from an uploaded bundle.
 *
 * The body is a bundle deploy's, plus `preview`; see `bundleDeployBody`. An
 * answer without a preview address is refused rather than followed: whatever
 * it built, this command cannot say where, and "it is somewhere" is not a
 * result.
 */
export async function triggerPreview(
    client: CloudClient,
    projectId: string,
    body: Record<string, unknown>,
    refusal: (e: unknown) => void
): Promise<PreviewTrigger> {
    let res: unknown;
    try {
        res = await client.functions.invoke<unknown>(PREVIEWS_FUNCTION, body, { method: "POST", path: projectId });
    } catch (e) {
        previewsUnavailable(e);
        staticPreviewUnserved(e);
        refusal(e);
        reportError(e, "Preview deploy failed to start");
    }
    const deployment = isRecord(res) && isRecord(res.deployment) ? res.deployment : undefined;
    const deploymentId = deployment ? text(deployment, "id") : null;
    const preview = isRecord(res) ? previewFrom(res.preview) : null;
    if (!deploymentId || !preview) {
        fail(
            "The control plane started a preview but did not say where it will be served.",
            "Run `rebase cloud previews` to find it.",
            "invalid_response"
        );
    }
    return { deploymentId, preview: { ...preview, deploymentId: preview.deploymentId ?? deploymentId } };
}

/** The lines a finished preview deploy prints under its verdict. */
export function previewLines(preview: Preview): string[] {
    const lines = [`Preview ${chalk.bold(preview.name)}: ${chalk.cyan(preview.url)}`];
    if (preview.backend === "production") {
        lines.push(chalk.gray("Its pages call the production backend; only the files are a preview."));
    } else if (preview.backend === "preview") {
        lines.push(chalk.gray("It runs its own backend, on a database of its own — not production's data."));
    }
    lines.push(chalk.gray("Production is unchanged."));
    if (preview.expiresAt) lines.push(chalk.gray(`Expires ${preview.expiresAt} unless deployed again.`));
    return lines;
}

/** Where the docs state what a backend preview costs. */
export const PREVIEW_PRICING_DOCS = "https://rebase.pro/docs/deployment/cloud/#preview-a-change";

/** The billing rule in words: what is printed when the control plane cannot put a number on it. */
export const PREVIEW_PRICING_RULE =
    "A backend preview is billed like one app unit at the default size, at your app's rate for its region and capacity, "
    + "prorated for as long as it exists.";

/** What a backend preview costs, as the control plane quotes it. */
export interface PreviewCost {
    /** €/month one backend preview adds to the project's quote; null when it could not be priced. */
    perPreviewMonthlyEur: number | null;
    /** Backend previews the project runs, this one included; null when unknown. */
    backendPreviews: number | null;
    /** €/month all of them add together; null when unknown. */
    previewsMonthlyEur: number | null;
    /** The rule the numbers come from, in words. */
    rule: string;
    docs: string;
}

interface QuoteAnswer {
    totalEur: number;
    backendPreviews?: number;
}

function quoteAnswerFrom(value: unknown): QuoteAnswer | null {
    if (!isRecord(value) || typeof value.totalEur !== "number" || !Number.isFinite(value.totalEur)) return null;
    return {
        totalEur: value.totalEur,
        backendPreviews: typeof value.backendPreviews === "number" ? value.backendPreviews : undefined
    };
}

const cents = (eur: number) => Math.round(eur * 100) / 100;

/**
 * What a backend preview costs, in the control plane's own numbers.
 *
 * No price is written down here: the control plane quotes the project's dials
 * with and without backend previews (`pricing/quote` with `backendPreviews`,
 * the call the console's quote makes) and the difference is what they add —
 * which follows the rate card, the app's region and its capacity class as
 * they change. One batched call, best-effort: a control plane that does not
 * price previews (its answer does not echo the count it was sent) or cannot be
 * asked leaves the numbers null, and the rule and the docs carry the answer.
 *
 * The quote is asked with no credential. The route is public — it prices a
 * hypothetical and reads nobody's data — and an access token would be refused
 * on it, holding no `functions:invoke:pricing`: no token capability names it,
 * and none needs to.
 */
export async function previewCost(client: CloudClient, url: string, projectId: string): Promise<PreviewCost> {
    const cost: PreviewCost = {
        perPreviewMonthlyEur: null,
        backendPreviews: null,
        previewsMonthlyEur: null,
        rule: PREVIEW_PRICING_RULE,
        docs: PREVIEW_PRICING_DOCS
    };
    let project: Record<string, unknown> | undefined;
    try {
        project = (await client.data.collection("projects").findById(projectId)) as Record<string, unknown> | undefined;
    } catch {
        return cost;
    }
    if (!isRecord(project)) return cost;

    try {
        const res = await client.functions.invoke<unknown>(PREVIEWS_FUNCTION, undefined, { method: "GET", path: projectId });
        const rows = isRecord(res) && Array.isArray(res.previews) ? res.previews : undefined;
        if (rows) {
            // At least this one, should the list trail the trigger.
            cost.backendPreviews = Math.max(1, rows.map(previewFrom).filter(p => p !== null && p.backend !== "production").length);
        }
    } catch {
        // The count is a detail; the price of one preview does not need it.
    }

    const counts = [0, 1];
    if (cost.backendPreviews !== null && cost.backendPreviews > 1) counts.push(cost.backendPreviews);
    let quotes: Array<QuoteAnswer | null>;
    try {
        const res = await fetch(`${url}/api/functions/pricing/quote`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "User-Agent": cliUserAgent() },
            body: JSON.stringify(counts.map(backendPreviews => ({ ...project, backendPreviews })))
        });
        if (!res.ok) return cost;
        const body: unknown = await res.json();
        quotes = isRecord(body) && Array.isArray(body.quotes) ? body.quotes.map(quoteAnswerFrom) : [];
    } catch {
        return cost;
    }
    const [none, one, all] = quotes;
    // A control plane that prices no previews answers the same total for both
    // and echoes no count: a €0.00 from it would be a guess, not a quote.
    if (!none || !one || one.backendPreviews !== 1) return cost;
    cost.perPreviewMonthlyEur = cents(one.totalEur - none.totalEur);
    if (cost.backendPreviews !== null && cost.backendPreviews <= 1) {
        cost.previewsMonthlyEur = cost.backendPreviews === 1 ? cost.perPreviewMonthlyEur : 0;
    } else if (all && all.backendPreviews !== undefined) {
        cost.backendPreviews = all.backendPreviews;
        cost.previewsMonthlyEur = cents(all.totalEur - none.totalEur);
    }
    return cost;
}

/** The line a preview deploy prints about its cost. */
export function previewCostLines(cost: PreviewCost, previewName: string): string[] {
    const stop = `\`rebase cloud previews delete ${previewName}\` stops it.`;
    if (cost.perPreviewMonthlyEur === null) {
        return [`${cost.rule} ${stop}`, `See ${cost.docs}`];
    }
    const lines = [
        `Billed while it exists: €${cost.perPreviewMonthlyEur.toFixed(2)}/month, prorated — the control plane's quote for one backend preview of this project. ${stop}`
    ];
    if (cost.backendPreviews !== null && cost.backendPreviews > 1 && cost.previewsMonthlyEur !== null) {
        lines.push(`The project runs ${cost.backendPreviews} backend previews: €${cost.previewsMonthlyEur.toFixed(2)}/month together.`);
    }
    return lines;
}

/* ═══════════════════════════════════════════════════════════════
   previews list
   ═══════════════════════════════════════════════════════════════ */

/** The flags `previews list` parses — the help page lists exactly these. */
export const PREVIEWS_LIST_FLAGS = {};

async function listCommand(rawArgs: string[]): Promise<void> {
    parseCloudArgs({
        spec: PREVIEWS_LIST_FLAGS,
        rawArgs,
        commandWords: 2, // cloud previews
        command: "cloud previews list",
        maxPositionals: 1 // the `list` action word, when written out
    });
    const { client } = await requireClient(rawArgs);
    const projectId = await requireProject(rawArgs, client);

    let res: unknown;
    try {
        res = await client.functions.invoke<unknown>(PREVIEWS_FUNCTION, undefined, { method: "GET", path: projectId });
    } catch (e) {
        previewsUnavailable(e);
        reportError(e, "Failed to list previews");
    }
    const rows = isRecord(res) && Array.isArray(res.previews) ? res.previews : [];
    const previews = rows.map(previewFrom).filter((p): p is Preview => p !== null);

    emit(
        () => {
            console.log("");
            console.log(chalk.bold(`  🔍 Previews — project ${displayProjectRef(rawArgs)}`));
            console.log("");
            if (previews.length === 0) {
                console.log(chalk.gray("  No previews. Make one with `rebase cloud deploy --preview`."));
                console.log("");
                return;
            }
            const nameWidth = Math.max(4, ...previews.map(p => p.name.length));
            for (const p of previews) {
                const tags = [p.app, p.backend ? `${p.backend} backend` : null, p.status, p.expiresAt ? `expires ${p.expiresAt}` : null]
                    .filter(Boolean)
                    .join("  ·  ");
                console.log(`  ${chalk.bold(p.name.padEnd(nameWidth))}  ${chalk.cyan(p.url)}`);
                if (tags) console.log(`  ${" ".repeat(nameWidth)}  ${chalk.gray(tags)}`);
            }
            console.log("");
        },
        { previews }
    );
}

/* ═══════════════════════════════════════════════════════════════
   previews delete <name>
   ═══════════════════════════════════════════════════════════════ */

/** The flags `previews delete` parses, beyond the global `--yes`. */
export const PREVIEWS_DELETE_FLAGS = {};

async function deleteCommand(rawArgs: string[]): Promise<void> {
    const { flags, positionals } = parseCloudArgs({
        spec: PREVIEWS_DELETE_FLAGS,
        rawArgs,
        commandWords: 3, // cloud previews delete
        command: "cloud previews delete",
        maxPositionals: 1
    });
    if (!positionals[0]) {
        fail("Name the preview: `rebase cloud previews delete <name>`.", "`rebase cloud previews` lists them.", "usage");
    }
    const name = normalizePreviewName(positionals[0]);
    const { client } = await requireClient(rawArgs);
    const projectId = await requireProject(rawArgs, client);

    await confirmDestructive({
        yes: flags["--yes"] === true,
        prompt: `Delete preview "${name}"? Its address stops answering, and a preview backend's database is dropped.`
    });

    try {
        await client.functions.invoke<unknown>(PREVIEWS_FUNCTION, undefined, {
            method: "DELETE",
            path: `${projectId}/${encodeURIComponent(name)}`
        });
    } catch (e) {
        previewsUnavailable(e);
        const err = e as { status?: number };
        if (err?.status === 404) {
            fail(`No preview named "${name}" on this project.`, "`rebase cloud previews` lists them.", "not_found");
        }
        reportError(e, "Failed to delete the preview");
    }
    success(`Deleted preview ${chalk.bold(name)}. Production is unchanged.`);
    emit(() => console.log(""), { success: true, deleted: name });
}

/* ═══════════════════════════════════════════════════════════════
   Dispatch
   ═══════════════════════════════════════════════════════════════ */

const PREVIEWS_ACTIONS = ["list", "delete", "rm"] as const;

export async function previewsCommand(action: string | undefined, rawArgs: string[]): Promise<void> {
    requireKnownAction("previews", action, PREVIEWS_ACTIONS);
    if (action === "delete" || action === "rm") {
        await deleteCommand(rawArgs);
        return;
    }
    await listCommand(rawArgs);
}
