/**
 * Plan, then confirm: a tool that changes something takes two calls.
 *
 * A tool that declares `confirm` (see {@link McpToolDefinition.confirm}) does
 * nothing on its first call. It validates the arguments, checks what the
 * real call would check, and answers a plan — what will happen, to what, and
 * whether it can be undone — with a token. Only a second call carrying the
 * same arguments and that token runs it.
 *
 * The token is bound to everything that decides what the call does:
 *
 *  - the account (`uid`) and the connection (`clientId`) it was planned for,
 *  - the tool,
 *  - the arguments, as a hash of their canonical JSON — a call that changes
 *    one field between plan and confirm is refused, never run as the new one,
 *  - this endpoint (`aud`), so a plan made on one backend confirms nothing on
 *    another,
 *  - five minutes,
 *
 * and it is spent once: its `jti` is recorded on use, and a second use is
 * refused ({@link McpConfirmationStore}).
 *
 * What this does and does not prove. It makes a destructive action
 * impossible in one call, so an instruction injected into a row or a log line
 * cannot trigger one outright; it pins exactly what was shown; and it puts the
 * plan in the transcript, where the person sees it. It cannot prove a person
 * said yes — a model can call twice. That check is the host's: a tool marked
 * `destructiveHint` is one a host such as Claude asks the person about before
 * it runs.
 *
 * The second call runs the tool from the top, so every permission it checks
 * is checked again, as it is then: a demotion between the two calls refuses.
 *
 * @module
 */
import type { JwtService } from "../auth/jwt.js";
import { randomHex, sha256Hex } from "../utils/portable-crypto.js";
import { logger } from "../utils/logger.js";
import { McpToolError, type McpToolContext, type McpToolDefinition } from "./mcp-tools.js";

/** The argument the second call carries the token in. */
export const CONFIRM_ARGUMENT = "confirm";

/** The `purpose` of a confirmation token: never a session, never an MCP access token. */
export const MCP_CONFIRMATION_PURPOSE = "mcp-confirmation";

/** How long a plan can be confirmed for. Long enough to read it and say yes; not long enough to forget it. */
export const MCP_CONFIRMATION_TTL_SECONDS = 300;

/** What a tool's first call answers: what the second will do. */
export interface McpConfirmationPlan {
    /** One sentence: the action, its target, and where (which project, which collection). */
    summary: string;
    /** What follows from it, one consequence per line. */
    effects?: string[];
    /** Whether and how it can be undone. */
    reversible?: string;
    /** Anything the person should see to decide — the row as it is, the change, a deployment's commit. */
    details?: Record<string, unknown>;
}

/**
 * Where a spent confirmation is recorded, so it is spent once across every
 * replica. `consume` answers whether this was the first use.
 */
export interface McpConfirmationStore {
    consumeConfirmation(jti: string, expiresAt: Date): Promise<boolean>;
}

/**
 * One process's memory of spent confirmations: what serves when no database
 * does (tests, a store-less harness). A backend with replicas uses the
 * database's, so a token spent on one replica is spent on all.
 */
export function memoryConfirmationStore(): McpConfirmationStore {
    const spent = new Map<string, number>();
    return {
        async consumeConfirmation(jti, expiresAt) {
            const now = Date.now();
            for (const [key, until] of spent) if (until < now) spent.delete(key);
            if (spent.has(jti)) return false;
            spent.set(jti, expiresAt.getTime());
            return true;
        }
    };
}

/** The claims a confirmation token carries. */
interface ConfirmationClaims {
    jti: string;
    uid: string;
    clientId: string;
    tool: string;
    args: string;
    aud: string;
    exp?: number;
}

/**
 * The arguments as one string, independent of key order: objects with their
 * keys sorted, at every depth. Two calls that mean the same thing hash the
 * same; two that differ in any value do not.
 */
export function canonicalArguments(value: unknown): string {
    return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(sortKeys);
    if (typeof value === "object" && value !== null) {
        const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
        return Object.fromEntries(entries.map(([key, inner]) => [key, sortKeys(inner)]));
    }
    return value;
}

export interface ConfirmationDeps {
    jwt: JwtService;
    store: McpConfirmationStore;
    /** This endpoint's canonical resource URI: a plan confirms on the endpoint that made it. */
    audience: string;
}

/**
 * The tool, taking two calls. Its schema gains the {@link CONFIRM_ARGUMENT}
 * argument; its first call answers the plan, its second runs it.
 */
export function withConfirmation(tool: McpToolDefinition, deps: ConfirmationDeps): McpToolDefinition {
    const plan = tool.confirm;
    if (!plan) return tool;
    const properties = (tool.inputSchema.properties ?? {}) as Record<string, unknown>;

    return {
        ...tool,
        description: `${tool.description} This tool takes two calls: the first changes nothing and answers a plan and a `
            + `\`${CONFIRM_ARGUMENT}\` token. Show the plan to the person and call again with the same arguments `
            + `and the token only once they agree.`,
        inputSchema: {
            ...tool.inputSchema,
            properties: {
                ...properties,
                [CONFIRM_ARGUMENT]: {
                    type: "string",
                    description: "Leave this out on the first call. After the person agrees to the plan the first call "
                        + "answered, call again with exactly the same arguments and the token it gave."
                }
            }
        },
        async run(args, ctx) {
            const { [CONFIRM_ARGUMENT]: token, ...rest } = args;
            const argsHash = await sha256Hex(canonicalArguments(rest));

            if (token === undefined) {
                const answer = await plan(rest, ctx);
                const jti = randomHex(16);
                const confirm = await deps.jwt.signPurposeToken(MCP_CONFIRMATION_PURPOSE, {
                    jti,
                    uid: ctx.caller.uid,
                    clientId: ctx.caller.clientId,
                    tool: tool.name,
                    args: argsHash,
                    aud: deps.audience
                } satisfies ConfirmationClaims, MCP_CONFIRMATION_TTL_SECONDS);
                return {
                    status: "confirmation_required",
                    plan: answer,
                    [CONFIRM_ARGUMENT]: confirm,
                    expiresAt: new Date(Date.now() + MCP_CONFIRMATION_TTL_SECONDS * 1000).toISOString(),
                    next: `Nothing has changed yet. Show this plan to the person. Only if they agree, call ${tool.name} `
                        + `again with the same arguments and "${CONFIRM_ARGUMENT}" set to this token. `
                        + "It is valid for five minutes, for these arguments only, and once."
                };
            }

            const jti = await verifiedConfirmation(token, { tool: tool.name, argsHash, ctx, deps });
            const result = await tool.run(rest, ctx);
            logger.info("[mcp] Confirmed tool call ran", {
                tool: tool.name, uid: ctx.caller.uid, clientId: ctx.caller.clientId, confirmation: jti
            });
            return result;
        }
    };
}

/**
 * The confirmation's `jti`, once it is checked and spent — or a refusal
 * saying which check failed, so the model can plan again rather than retry.
 */
async function verifiedConfirmation(
    token: unknown,
    { tool, argsHash, ctx, deps }: { tool: string; argsHash: string; ctx: McpToolContext; deps: ConfirmationDeps }
): Promise<string> {
    const again = `Call ${tool} without "${CONFIRM_ARGUMENT}" to get a new plan, and show it to the person.`;
    if (typeof token !== "string" || token === "") {
        throw new McpToolError(`"${CONFIRM_ARGUMENT}" must be the token a plan answered. ${again}`);
    }
    const claims = await deps.jwt.verifyPurposeToken<ConfirmationClaims>(MCP_CONFIRMATION_PURPOSE, token);
    if (!claims) {
        throw new McpToolError(`This confirmation is not valid or has expired. ${again}`);
    }
    if (claims.aud !== deps.audience || claims.tool !== tool
        || claims.uid !== ctx.caller.uid || claims.clientId !== ctx.caller.clientId) {
        throw new McpToolError(`This confirmation was given for another action. ${again}`);
    }
    if (claims.args !== argsHash) {
        throw new McpToolError(
            `These arguments are not the ones the plan was made for. Nothing was changed. ${again}`);
    }
    const expiresAt = new Date((claims.exp ?? Math.floor(Date.now() / 1000) + MCP_CONFIRMATION_TTL_SECONDS) * 1000);
    if (!await deps.store.consumeConfirmation(claims.jti, expiresAt)) {
        throw new McpToolError(`This confirmation has already been used. ${again}`);
    }
    return claims.jti;
}
