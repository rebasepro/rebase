/**
 * `POST /admin/users/import`: accounts from another system, keeping their ids.
 *
 * Moving an app from another backend (Supabase, Firebase, Auth0) means moving
 * its users first, under the ids every other row points at: an `owner_id` that
 * named a Supabase uuid has to name the same account here. One account at a
 * time through `POST /admin/users` cannot do that — it generates the id — and
 * it emails each account an invitation to set a password, which is the wrong
 * mail for an app that signs in by magic link.
 *
 * So an import:
 * - keeps `id` when given (checked by `importedUserIdProblem`), and the
 *   `createdAt` the source system recorded;
 * - carries no password and no hash, and sends nothing: an imported account
 *   signs in by magic link, an email code, a provider, or a password reset;
 * - never updates an account. A row whose id or email is already taken is
 *   reported `skipped` and left alone, so running the same file twice is safe;
 * - answers one outcome per account, so one bad row does not stop the rest.
 *
 * It holds to what `POST /admin/users` holds to: `users:write`, no role above
 * the caller's own, and `beforeUserCreate`, which may refuse an account.
 */
import type { Context } from "hono";
import { normalizeEmail } from "@rebasepro/common";
import {
    importedUserIdProblem,
    MAX_USERS_PER_IMPORT,
    type ImportUserOutcome,
    type ImportUsersResult
} from "@rebasepro/types";
import { ApiError, declaredErrorAnswer } from "../api/errors";
import type { HonoEnv } from "../api/types";
import type { AuthRepository, CreateUserData } from "./interfaces";
import type { ResolvedAuthHooks } from "./auth-hooks";
import { assertMayGrantRoles, readRoleNames } from "./access";
import { logger } from "../utils/logger";
import { getUserId } from "../functions/context";

/** The fields an imported account takes, in the order a refusal lists them. */
const IMPORT_FIELDS = ["id", "email", "displayName", "photoUrl", "createdAt", "emailVerified", "roles"] as const;

/** Spellings of a password or its hash, which an import refuses rather than drops. */
const PASSWORD_FIELDS = new Set(["password", "passwordHash", "password_hash", "encryptedPassword", "encrypted_password"]);

/** RFC 5321's bound on an address, the one the users table's CHECK holds to. */
const MAX_EMAIL_LENGTH = 320;

/** One account, checked: what the row will be written as. */
interface ImportRow {
    id?: string;
    email: string;
    displayName?: string;
    photoUrl?: string;
    createdAt?: Date;
    emailVerified: boolean;
    roles?: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(message: string, code = "INVALID_INPUT"): ApiError {
    return ApiError.badRequest(message, code);
}

/** An optional text field: absent, `null` and `""` all mean "not given". */
function optionalText(row: Record<string, unknown>, field: "displayName" | "photoUrl"): string | undefined {
    const value = row[field];
    if (value === undefined || value === null || value === "") return undefined;
    if (typeof value !== "string") throw invalid(`\`${field}\` is a string.`);
    return value;
}

/**
 * The body of `POST /admin/users/import`, or a 400 saying what is wrong with
 * it as a whole. The accounts in it are checked one at a time, later.
 */
export function readImportRequest(body: unknown): { users: unknown[]; dryRun: boolean } {
    if (!isRecord(body) || !Array.isArray(body.users)) {
        throw invalid("The body is `{ \"users\": [ { \"email\": … }, … ] }`.");
    }
    if (body.users.length === 0) throw invalid("`users` is empty: there is nothing to import.");
    if (body.users.length > MAX_USERS_PER_IMPORT) {
        throw new ApiError(400, "TOO_MANY_USERS",
            `One import takes at most ${MAX_USERS_PER_IMPORT} accounts (got ${body.users.length}). Send the rest in further requests; \`rebase users import\` does.`,
            { max: MAX_USERS_PER_IMPORT });
    }
    if (body.dryRun !== undefined && typeof body.dryRun !== "boolean") throw invalid("`dryRun` is true or false.");
    return { users: body.users, dryRun: body.dryRun === true };
}

/**
 * One account out of the request, checked, or the refusal that says why not.
 * Roles are judged against the caller here, before anything is written.
 */
function readImportRow(c: Context<HonoEnv>, value: unknown): ImportRow {
    if (!isRecord(value)) throw invalid("An account is an object: `{ \"email\": … }`.");
    const keys = Object.keys(value);
    const password = keys.find(key => PASSWORD_FIELDS.has(key));
    if (password) {
        throw invalid(`\`${password}\` is not imported: an imported account has no password. It signs in by magic link, an email code, a provider, or a password reset.`);
    }
    const unknown = keys.filter(key => !(IMPORT_FIELDS as readonly string[]).includes(key));
    if (unknown.length > 0) {
        throw invalid(`Unknown field${unknown.length > 1 ? "s" : ""} ${unknown.map(key => `\`${key}\``).join(", ")}. An imported account takes ${IMPORT_FIELDS.join(", ")}.`);
    }

    const rawEmail = value.email;
    if (typeof rawEmail !== "string" || rawEmail.trim() === "") throw invalid("`email` is required.");
    const email = normalizeEmail(rawEmail);
    if (email.length > MAX_EMAIL_LENGTH || !/^[^\s@]+@[^\s@]+$/.test(email)) throw invalid(`\`${rawEmail}\` is not an email address.`);

    let id: string | undefined;
    const rawId = value.id;
    if (rawId !== undefined && rawId !== null) {
        const problem = typeof rawId === "string" ? importedUserIdProblem(rawId) : "is not a string";
        if (problem || typeof rawId !== "string") throw invalid(`The id ${JSON.stringify(rawId)} ${problem}.`, "INVALID_ID");
        id = rawId;
    }

    let createdAt: Date | undefined;
    if (value.createdAt !== undefined && value.createdAt !== null && value.createdAt !== "") {
        if (typeof value.createdAt !== "string") throw invalid("`createdAt` is an ISO 8601 date, as a string.");
        createdAt = new Date(value.createdAt);
        if (Number.isNaN(createdAt.getTime())) throw invalid(`\`createdAt\` ${JSON.stringify(value.createdAt)} is not a date.`);
    }

    if (value.emailVerified !== undefined && typeof value.emailVerified !== "boolean") {
        throw invalid("`emailVerified` is true or false.");
    }

    let roles: string[] | undefined;
    if (value.roles !== undefined && value.roles !== null) {
        roles = readRoleNames(value.roles);
        assertMayGrantRoles(c, roles);
    }

    return {
        ...(id !== undefined ? { id } : {}),
        email,
        displayName: optionalText(value, "displayName"),
        photoUrl: optionalText(value, "photoUrl"),
        ...(createdAt ? { createdAt } : {}),
        emailVerified: value.emailVerified === true,
        ...(roles ? { roles } : {})
    };
}

/** What a refusal says in an outcome: its own code and words, or a pointer to the log. */
function refusalOf(error: unknown): { code: string; message: string } {
    const answer = declaredErrorAnswer(error);
    if (answer) return { code: answer.code, message: answer.message };
    logger.error("Could not import an account", { error: error instanceof Error ? error.message : error });
    return { code: "INTERNAL_ERROR", message: "Could not import this account. See the server log." };
}

/**
 * Import the accounts of one request, in order, and say what happened to each.
 * With `dryRun`, every check runs and nothing is written.
 */
export async function importUsers(
    c: Context<HonoEnv>,
    rows: readonly unknown[],
    options: { dryRun: boolean; authRepo: AuthRepository; hooks: Pick<ResolvedAuthHooks, "beforeUserCreate"> }
): Promise<ImportUsersResult> {
    const { dryRun, authRepo, hooks } = options;
    const results: ImportUserOutcome[] = [];
    // The accounts this request has already created (or, dry, would have), so
    // a file that names one twice reports the second as taken in both modes.
    const takenIds = new Set<string>();
    const takenEmails = new Set<string>();

    for (const [index, value] of rows.entries()) {
        const sentEmail = isRecord(value) && typeof value.email === "string" ? value.email.trim() : undefined;
        const sentId = isRecord(value) && typeof value.id === "string" ? value.id : undefined;
        let row: ImportRow | undefined;
        try {
            row = readImportRow(c, value);
            const { id, email } = row;
            if (id !== undefined && (takenIds.has(id) || await authRepo.getUserById(id))) {
                results.push({ index, status: "skipped", uid: id, email, code: "ID_EXISTS", message: "An account already has this id. It is left as it is." });
                continue;
            }
            if (takenEmails.has(email) || await authRepo.getUserByEmail(email)) {
                results.push({ index, status: "skipped", ...(id !== undefined ? { uid: id } : {}), email, code: "EMAIL_EXISTS", message: "An account already has this email. It is left as it is." });
                continue;
            }
            if (dryRun) {
                if (id !== undefined) takenIds.add(id);
                takenEmails.add(email);
                results.push({ index, status: "created", ...(id !== undefined ? { uid: id } : {}), email });
                continue;
            }

            let data: CreateUserData = {
                ...(id !== undefined ? { id } : {}),
                email,
                emailVerified: row.emailVerified,
                ...(row.displayName !== undefined ? { displayName: row.displayName } : {}),
                ...(row.photoUrl !== undefined ? { photoUrl: row.photoUrl } : {}),
                ...(row.createdAt ? { createdAt: row.createdAt } : {})
            };
            if (hooks.beforeUserCreate) {
                const hooked = await hooks.beforeUserCreate(data);
                // The id is what the import is for: a hook written before
                // accounts could keep one rebuilds the object without it.
                data = id !== undefined ? { ...hooked, id } : hooked;
            }
            const user = await authRepo.createUser(data);
            if (row.roles) {
                try {
                    await authRepo.setUserRoles(user.id, row.roles);
                } catch (error) {
                    // `failed` means "not created": the account goes with its roles.
                    await authRepo.deleteUser(user.id).catch((cleanup: unknown) => logger.error("Could not remove an imported account whose roles failed", {
                        uid: user.id,
                        error: cleanup instanceof Error ? cleanup.message : cleanup
                    }));
                    throw error;
                }
            }
            takenIds.add(user.id);
            takenEmails.add(email);
            results.push({ index, status: "created", uid: user.id, email });
        } catch (error) {
            const { code, message } = refusalOf(error);
            const email = row?.email ?? sentEmail;
            const uid = row?.id ?? sentId;
            // Taken between the check and the write: the same answer as taken before it.
            if ((code === "EMAIL_EXISTS" || code === "ID_EXISTS") && email !== undefined) {
                results.push({ index, status: "skipped", ...(uid !== undefined ? { uid } : {}), email, code, message });
            } else {
                results.push({ index, status: "failed", ...(uid !== undefined ? { uid } : {}), ...(email !== undefined ? { email } : {}), code, message });
            }
        }
    }

    const count = (status: ImportUserOutcome["status"]) => results.filter(result => result.status === status).length;
    const result: ImportUsersResult = { dryRun, created: count("created"), skipped: count("skipped"), failed: count("failed"), results };
    if (!dryRun) {
        logger.info("[Security Audit] Accounts imported by an administrator", {
            eventType: "auth.users.imported",
            by: getUserId(c),
            created: result.created,
            skipped: result.skipped,
            failed: result.failed
        });
    }
    return result;
}
