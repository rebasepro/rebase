/**
 * Creating and altering collections against a running backend.
 *
 * The existing schema editor rewrites collection source and is off in
 * production, for an honest reason: a deployed server's files are rebuilt from
 * the repository on every deploy, so an edit there would be discarded. These
 * routes are the answer to that — they commit the change to the repository the
 * server is running in, and *then* apply the DDL, so the edit survives the next
 * deploy because the deploy is built from it.
 *
 * Two routes, and the first one is the important one.
 *
 * ## Why `plan` exists separately from `apply`
 *
 * `POST /plan` has no side effects and answers what would happen. That is not a
 * convenience: a schema change has three possible verdicts and two of them are
 * refusals, so a UI that could only try-and-see would be asking people to
 * discover `needs-migration` by pressing a button on a live database.
 *
 * It also surfaces the `diverges` cases, which are the ones nothing else in the
 * system reports — a required property that will arrive nullable, an enum value
 * that will never land. Those apply "successfully" today and leave a database
 * that does not match its configuration.
 *
 * ## What these routes will not do
 *
 * Anything the boot-time ensure path cannot express. No drops, no type changes,
 * no primary keys. The planner refuses them and this refuses to route around it
 * — `applySchemaChange` re-checks rather than trusting the plan it is handed.
 */
import { Hono, type Context } from "hono";
import {
    TablePatchError,
    isSchemaEditingAdmin,
    isSQLAdmin,
    parseTablePatches,
    type AuthAdapter,
    type ClassifiedSchemaChanges,
    type CollectionConfig,
    type CompiledTable,
    type DatabaseAdmin,
    type SchemaChangeFile,
    type SchemaChangePlan,
    type SchemaCommitPaths,
    type SchemaEditingAdmin,
    type TableDescriptor,
    type TablePatch
} from "@rebasepro/types";
import { HonoEnv } from "./types";
import { ApiError, errorHandler } from "./errors";
import { logger } from "../utils/logger";
import { tsMorphInstallSentence } from "../utils/dev-dependency-command";
import {
    applySchemaChange,
    DirtyWorkingTreeError,
    StatementFailedError,
    UnapplicableChangeError,
    POLICIES_DEFERRED_MESSAGE,
    type SchemaEditPolicyOutcome,
    type SchemaEditRepository
} from "../schema-edit/apply-schema-change";
import {
    classifyPrincipal,
    machineCommitAuthor,
    schemaEditCapabilities,
    type SchemaEditPolicy
} from "../schema-edit/schema-edit-permissions";
import { requireScope } from "../auth/access";
import type { EditedSchema, TableSourceEditError } from "./table-source-editor";

/**
 * A schema edit applied to a copy of `backend/schema` and compiled: the files
 * it changes, by repository path, and what the schema compiles to with it.
 */
export interface PreviewedSource {
    /** Every file the edit changes, as repository-relative paths. */
    files: SchemaChangeFile[];
    /** The schema the edit leaves: the `after` side of the plan, and what the server is refreshed with. */
    schema: EditedSchema;
}

export interface LiveSchemaRoutesConfig {
    /**
     * The collections the running server was built from — the `before` side.
     * Read at request time, because the registry is assembled after the routes
     * are mounted.
     */
    getCollections: () => CollectionConfig[];
    /**
     * The tables the running server serves, compiled — the `before` side of
     * every plan and what a reconcile is planned against. Read at request time,
     * like {@link getCollections}.
     */
    getCompiledTables: () => readonly CompiledTable[];
    /** The driver's admin, for planning and for running the DDL. */
    getAdmin: () => DatabaseAdmin | undefined;
    /**
     * The working tree to commit into, or undefined when there is none — a
     * bundle deployment has compiled output and no source, and this stays off
     * there rather than inventing somewhere to write.
     */
    getRepository: (author?: { name: string; email: string }) => SchemaEditRepository | undefined;
    /**
     * Apply the edits to a copy of `backend/schema` and compile the result,
     * writing nothing — the `after` side of every plan. Supplied by the caller
     * because it is the schema editor's job, and that needs `ts-morph`, an
     * optional dependency. Refuses (a `TableSourceEditError`) an edit it cannot
     * make or whose result does not compile.
     */
    previewSource?: (patches: readonly TablePatch[]) => Promise<PreviewedSource>;
    /**
     * Hand back a previewed edit's files for the commit, once it is safe to:
     * refuses when a file changed since the preview read it. Absent where the
     * source may be read but not written — then `/apply` is refused with
     * {@link sourceEditingOff}.
     */
    writeSource?: (edit: PreviewedSource) => Promise<SchemaChangeFile[]>;
    /**
     * Called after an apply that ran against the database, with the schema it
     * left: the running server swaps its tables for these, so the change is
     * served without a restart. Not called for a source-only commit — the
     * database does not have the change.
     */
    onApplied?: (schema: EditedSchema) => void | Promise<void>;
    /**
     * The descriptors the running server serves — the `before` side of a
     * table's `rls`, kept on the served tables when an apply's policies could
     * not be written. Read at request time, like {@link getCollections}.
     */
    getTables?: () => readonly TableDescriptor[];
    /**
     * Write the RLS policies of these collections to the database: the boot
     * policy applier (the driver's `ensureTablePolicies`), called after
     * an apply that changed some table's `rls`, with every collection the
     * default database stores (unchanged ones are no-ops: their policies are
     * stamped). Absent when this backend may not or cannot write policies
     * (`provision.tables` off, a driver without the capability): the apply
     * then reports `policies: { status: "deferred" }` and the served tables
     * keep the `rls` the database enforces.
     */
    applyPolicies?: (tables: readonly CompiledTable[]) => Promise<{ applied: number }>;
    /**
     * Why {@link writeSource} is absent, when the caller knows.
     *
     * `writeSource` being undefined has several causes — the editor turned off,
     * `baas` mode, no `schemaDir`, `NODE_ENV=production`, `ts-morph` not
     * installed — and this route could see only that the field was unset, so it
     * reported the last of them for all of them. The admin panel calls this
     * *and* `/api/schema-editor/status` on every page load and got two
     * different answers, one of which named a dependency that was installed.
     */
    sourceEditingOff?: { code: string; message: string };
    /**
     * Set when this backend changes nothing in its database (provisioning is
     * off): an apply that would run the change against the database is
     * refused with this, while a source-only commit — which touches no
     * database and goes wherever the project's own changes go — still works.
     */
    databaseChangesOff?: { code: string; message: string };
    /**
     * Where this project's generated artifacts belong, relative to the
     * repository.
     *
     * Absent for a project that *is* the repository, which is what the defaults
     * describe. Present for one in a subdirectory, where the defaults would
     * write `backend/` beside `.git` and leave the project's real generated
     * file untouched — committing a source change alongside a stale
     * schema, which is the failure committing the whole change exists to avoid.
     */
    commitPaths?: Partial<SchemaCommitPaths>;
    /**
     * Whether this project replays versioned migrations to build an
     * environment.
     *
     * If it does, applying here is not the whole job: the DDL runs against
     * *this* database and the collection is committed, but no migration is
     * written — a server cannot mint one, since that needs Atlas and a
     * throwaway database. The next environment built by replaying migrations
     * would not have this change, and nothing would have said so.
     */
    usesVersionedMigrations?: () => boolean;
    /**
     * Who may apply a change, as opposed to preview one.
     *
     * See `schema-edit-permissions.ts`. The short version: applying writes a
     * commit, a commit needs an author, and a credential is not an author.
     */
    policy?: SchemaEditPolicy;
    /**
     * The account behind a uid, for the commit's author line.
     *
     * The request's user is what its access token carries, and the built-in
     * token carries a uid and roles — no name, no address — so without this a
     * commit is authored by the uid. Absent, or answering nothing, the commit
     * falls back to what the request carries.
     */
    resolveAuthorIdentity?: (uid: string) => Promise<AccountIdentity | null>;
}

/** What a commit's author line is made of. */
export interface AccountIdentity {
    displayName?: string | null;
    email?: string | null;
}

/**
 * The account behind a uid, read through the auth in use: its user-management
 * lookup when it has one — a plain read — else `resolveUser`. `null` when the
 * auth has neither, or knows no such account.
 */
export async function readAccountIdentity(
    adapter: Pick<AuthAdapter, "userManagement" | "resolveUser"> | undefined,
    uid: string
): Promise<AccountIdentity | null> {
    if (adapter?.userManagement) return adapter.userManagement.getUserById(uid);
    if (adapter?.resolveUser) return adapter.resolveUser(uid);
    return null;
}

/**
 * The git identity for the caller.
 *
 * `undefined` when the request carries no user — a service key, say — which
 * lets the repository fall back to its own git config rather than inventing a
 * name for somebody.
 *
 * The name and address the request carries win; what it lacks is read from
 * the account through `resolveAccount`. A lookup that fails costs the commit
 * its name, never the commit: the author falls back to the uid.
 */
export async function commitAuthor(
    user: unknown,
    resolveAccount?: (uid: string) => Promise<AccountIdentity | null>
): Promise<{ name: string; email: string } | undefined> {
    // `unknown` rather than the auth union: `AuthResult` admits `false` and
    // `null` as well as a user, and narrowing here keeps that shape from
    // leaking into every caller.
    if (!isRecord(user)) return undefined;
    const uid = nonEmptyString(user.uid);
    if (!uid) return undefined;
    let email = nonEmptyString(user.email);
    let displayName = nonEmptyString(user.displayName);

    if ((!email || !displayName) && resolveAccount) {
        try {
            const account = await resolveAccount(uid);
            email ??= nonEmptyString(account?.email);
            displayName ??= nonEmptyString(account?.displayName);
        } catch (error: unknown) {
            logger.warn("[live-schema] Could not read the account behind a schema commit; authoring it by uid", {
                uid,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    return {
        name: displayName || email || uid,
        // A real address when there is one; otherwise a routable-looking local
        // identity, because git requires the field and a blank one is rejected.
        email: email || `${uid}@users.noreply.rebase.pro`
    };
}

const nonEmptyString = (value: unknown): string | undefined =>
    typeof value === "string" && value.trim() !== "" ? value : undefined;

/**
 * The edits a request carries: `{ patches: TablePatch[] }`, checked — or a 400
 * naming every problem, each with its index in the list.
 */
function parsePatches(body: unknown): TablePatch[] {
    if (!isRecord(body)) throw ApiError.badRequest("Expected a JSON object: `{ patches: [...] }`.", "INVALID_CHANGE");
    try {
        return parseTablePatches(body.patches);
    } catch (error) {
        if (error instanceof TablePatchError) {
            throw ApiError.badRequest(error.message, "INVALID_CHANGE", { problems: error.problems });
        }
        throw error;
    }
}

/**
 * The request body, or a 400 that says it is not JSON.
 *
 * `c.req.json()` throws a `SyntaxError` on a malformed body, and the error
 * handler cannot tell that from a fault of the server's, so the caller's typo
 * went back as a 500.
 */
async function readBody(c: Context<HonoEnv>): Promise<unknown> {
    try {
        return await c.req.json();
    } catch {
        throw ApiError.badRequest("The request body is not valid JSON.", "INVALID_CHANGE");
    }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

/** Whether an error is the schema editor's refusal (from this copy of the module or another). */
function isEditRefusal(error: unknown): error is TableSourceEditError {
    return error instanceof Error && error.name === "TableSourceEditError" && "code" in error && "problems" in error;
}

/** An edit the schema editor refused, as the answer that says why: 409 for a file changed on disk since the preview, 400 otherwise. */
function refusedEdit(error: TableSourceEditError): ApiError {
    return new ApiError(error.code === "SCHEMA_EDIT_STALE_FILE" ? 409 : 400, error.code, error.message, { problems: error.problems });
}

const isClassification = (value: unknown): value is ClassifiedSchemaChanges =>
    isRecord(value) &&
    Array.isArray(value.changes) &&
    typeof value.verdict === "string" &&
    typeof value.applicable === "boolean";

/**
 * The plan — or, when the planner refuses the change, the refusal as a plan.
 *
 * `SchemaEditingAdmin.planSchemaChange` *rejects* an unapplicable change,
 * carrying its classification, and the Postgres planner does exactly that.
 * Both routes read `plan.classified.applicable` instead, so every blocked
 * change — a removed property, a table moved from under its rows — reached the
 * error handler unclassified and went back as a 500: the panel could offer a
 * retry, and never the source-only save a blocked change is meant to lead to.
 * Anything thrown without a classification is still a fault, and still a 500.
 */
async function planOrRefusal(
    admin: SchemaEditingAdmin,
    before: readonly CompiledTable[],
    after: readonly CompiledTable[],
    paths: Partial<SchemaCommitPaths> | undefined
): Promise<SchemaChangePlan> {
    try {
        return await admin.planSchemaChange(before, after, { paths });
    } catch (err) {
        const classified = isRecord(err) ? err.classified : undefined;
        if (!isClassification(classified)) throw err;
        return { files: [], statements: [], classified, message: "" };
    }
}

/**
 * The commit message, naming what changed when the schema did not.
 *
 * The planner describes schema changes, and for an edit that has none — a
 * description, a reordered column — it said `chore(schema): no change` over a
 * commit that changed a table file. The edits know what changed, so the
 * subject says it.
 */
function messageFor(patches: readonly TablePatch[], plan: SchemaChangePlan): string {
    if (plan.classified.changes.length > 0) return plan.message;
    const described = patches.map(describePatch);
    const tables = [...new Set(patches.map(patch => (patch.op === "createTable" || patch.op === "adoptTable" ? patch.table.name : patch.table)))];
    const shown = described.length > 5 ? [...described.slice(0, 5), `and ${described.length - 5} more`] : described;
    return `chore(schema): edit ${tables.join(", ")} — ${shown.join(", ")}\n`;
}

/** One edit in a few words, for a commit subject: `add column subtitle`. */
function describePatch(patch: TablePatch): string {
    switch (patch.op) {
        case "createTable": return `create ${patch.table.name}`;
        case "adoptTable": return `adopt ${patch.table.name}`;
        case "deleteTable": return `delete ${patch.table}`;
        case "addColumn": return `add column ${patch.key}`;
        case "changeColumn": return `change column ${patch.key}`;
        case "renameColumn": return `rename column ${patch.key} to ${patch.to}`;
        case "removeColumn": return `remove column ${patch.key}`;
        case "moveColumn": return `move column ${patch.key}`;
        case "addRelation": return `add relation ${patch.name}`;
        case "changeRelation": return `change relation ${patch.name}`;
        case "removeRelation": return `remove relation ${patch.name}`;
        case "setRls": return "set rls";
        case "addRule": return "add a rule";
        case "replaceRule": return `change rule ${patch.index}`;
        case "removeRule": return `remove rule ${patch.index}`;
        case "setOption": return `${patch.value === null ? "remove" : "set"} ${patch.option}`;
    }
}

/**
 * The plan of an "Edit source only", or a refusal of one.
 *
 * Every change the database cannot take has to say what it leaves behind
 * (`sourceOnly`). One that does not is one that may not be written to the
 * source alone — a primary key moved, a relation reading a column nothing
 * creates, a proposal the planner refuses — because the project it leaves
 * does not start, or reads its data as the wrong type.
 */
async function planSourceOnly(
    admin: SchemaEditingAdmin,
    before: readonly CompiledTable[],
    after: readonly CompiledTable[],
    paths: Partial<SchemaCommitPaths> | undefined
): Promise<SchemaChangePlan> {
    let plan: SchemaChangePlan;
    try {
        plan = await admin.planSchemaChange(before, after, { paths, sourceOnly: true });
    } catch (err) {
        const classified = isRecord(err) ? err.classified : undefined;
        if (!isClassification(classified)) throw err;
        plan = { files: [], statements: [], classified, message: "" };
    }
    const unoffered = plan.classified.changes.filter(change => change.verdict !== "safe" && !change.sourceOnly);
    if (unoffered.length > 0 || plan.files.length === 0) {
        throw ApiError.badRequest(
            "This change cannot be written to the table source alone:\n" +
            unoffered.map(c => `  • ${c.detail}${c.remedy ? `\n    ${c.remedy}` : ""}`).join("\n"),
            "SCHEMA_CHANGE_UNAPPLICABLE",
            { changes: plan.classified.changes }
        );
    }
    return plan;
}

/**
 * The files an apply of `plan` commits: the collection source `writeSource`
 * rewrites, then the planner's generated files — the order `/apply` commits
 * them in.
 *
 * The review a person agrees to lists these, so it is the same list. It listed
 * the planner's files alone, and the commit also carried the person's own
 * collection file. Nothing for a change the apply refuses, which commits
 * nothing; no source when there is no `writeSource`, which writes none.
 */
function filesCommittedBy(config: LiveSchemaRoutesConfig, source: PreviewedSource, plan: SchemaChangePlan): string[] {
    const generated = plan.files.map(file => file.path);
    if (!plan.classified.applicable) return generated;
    const written = config.writeSource ? source.files.map(file => file.path) : [];
    return [...new Set([...written, ...generated])];
}

/**
 * What still has to happen after this change lands, if anything.
 *
 * Only one thing so far, and it is the one that would otherwise be silent: a
 * project that replays migrations needs this change recorded as one, or its
 * next environment is built without it.
 */
/** Whether a lowered collection turns the injected admin baseline off (a Postgres collection's `disableDefaultPolicies`). */
function disablesDefaultPolicies(collection: CollectionConfig): boolean {
    const off: unknown = Reflect.get(collection, "disableDefaultPolicies");
    return off === true;
}

/** What decides a table's policies, on a lowered collection. */
function rlsIdentity(collection: CollectionConfig): string {
    return JSON.stringify({ rules: collection.securityRules ?? [], off: disablesDefaultPolicies(collection) });
}

/**
 * The slugs of the tables whose policies an edit changes: a table it adds,
 * or one whose rules or `defaultPolicies` differ.
 */
export function rlsChangedSlugs(before: readonly CollectionConfig[], after: readonly CollectionConfig[]): string[] {
    const previous = new Map(before.map(collection => [collection.slug, rlsIdentity(collection)]));
    return after.filter(collection => previous.get(collection.slug) !== rlsIdentity(collection)).map(collection => collection.slug);
}

/** Whether the default database stores a table: the one the apply's DDL ran on. */
function onDefaultDatabase(table: CompiledTable): boolean {
    return table.descriptor.database === undefined || table.descriptor.database === "(default)";
}

/**
 * Write the changed tables' policies through `applyPolicies` (call site of
 * the boot policy applier for a live apply), or say why they were not.
 */
async function applyChangedPolicies(
    config: LiveSchemaRoutesConfig,
    after: EditedSchema,
    changed: string[]
): Promise<SchemaEditPolicyOutcome> {
    if (!config.applyPolicies) return { status: "deferred", tables: changed, message: POLICIES_DEFERRED_MESSAGE };
    try {
        // The edited definitions compiled, as boot compiles its own: the
        // policy applier plans from the compiled tables.
        const { applied } = await config.applyPolicies(after.tables.filter(onDefaultDatabase));
        return { status: "applied", tables: changed, statements: applied };
    } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        logger.warn("[schema-edit] The applied change's RLS policies could not be written; serving the previous rules.", { tables: changed, error });
        return { status: "failed", tables: changed, message: POLICIES_DEFERRED_MESSAGE, error };
    }
}

function policySummary(policies: SchemaEditPolicyOutcome): string {
    if (policies.status === "applied") return `Applied the RLS policies of ${policies.tables.join(", ")}.`;
    return policies.status === "failed"
        ? `The RLS policies of ${policies.tables.join(", ")} could not be written (${policies.error}). ${policies.message}`
        : policies.message;
}

/**
 * The edited schema with the changed tables' `rls` as the database still
 * enforces it: the previous descriptor's `rls` and collection's rules, or,
 * for a table the edit created, closed (RLS is on, no policy grants a row).
 */
export function keepEnforcedRls(
    schema: EditedSchema,
    changed: readonly string[],
    before: readonly CollectionConfig[],
    beforeTables: readonly TableDescriptor[]
): EditedSchema {
    const changedSet = new Set(changed);
    const previousCollection = new Map(before.map(collection => [collection.slug, collection]));
    const previousTable = new Map(beforeTables.map(table => [table.slug, table]));
    const enforced = (descriptor: TableDescriptor): TableDescriptor => {
        if (!changedSet.has(descriptor.slug)) return descriptor;
        const previous = previousTable.get(descriptor.slug);
        return { ...descriptor, rls: previous ? previous.rls : { posture: "rules", rules: [], defaultPolicies: false } };
    };
    return {
        ...schema,
        tables: schema.tables.map(table => (changedSet.has(table.descriptor.slug) ? { ...table, descriptor: enforced(table.descriptor) } : table)),
        descriptors: schema.descriptors.map(enforced),
        collections: schema.collections.map(collection => {
            if (!changedSet.has(collection.slug)) return collection;
            const previous = previousCollection.get(collection.slug);
            return {
                ...collection,
                securityRules: previous?.securityRules ?? [],
                disableDefaultPolicies: previous ? disablesDefaultPolicies(previous) : true
            };
        })
    };
}

function followUpFor(config: LiveSchemaRoutesConfig, statements: string[]): string[] {
    if (statements.length === 0) return [];
    if (!config.usesVersionedMigrations?.()) return [];
    return [
        "This project keeps versioned migrations, and applying here does not write one — " +
        "a migration needs Atlas and a throwaway database, which a running server does not " +
        "have. The collection has been committed, and `rebase db generate` writes the migration " +
        "from it, so run that to record this change. Without it, the next environment " +
        "built by replaying migrations will not have it."
    ];
}

export function createLiveSchemaRoutes(config: LiveSchemaRoutesConfig): Hono<HonoEnv> {
    const router = new Hono<HonoEnv>();
    router.onError(errorHandler);

    /** The apply running now, which the next one waits for. */
    let applyInFlight: Promise<void> = Promise.resolve();
    const oneApplyAtATime = async <T>(work: () => Promise<T>): Promise<T> => {
        const previous = applyInFlight;
        let done: () => void = () => undefined;
        applyInFlight = new Promise<void>(resolve => { done = resolve; });
        await previous;
        try {
            return await work();
        } finally {
            done();
        }
    };

    /**
     * Whether this backend can edit its schema, and what is missing when it
     * cannot.
     *
     * Every optional surface in this API answers `GET …/status` — see
     * `docs/api-conventions.md`. The panel asks before it offers the control,
     * because the alternative is a button that looks available and fails on
     * press with a refusal the person could have been told about up front.
     *
     * Ordered by how fundamental the obstacle is: a driver that cannot plan is
     * a different conversation from a missing dependency, which is a different
     * conversation from a deployment with no source. Reporting the first one
     * that applies is what keeps the message actionable.
     */
    router.get("/status", async (c) => {
        const admin = config.getAdmin();
        const repository = config.getRepository();

        if (!isSchemaEditingAdmin(admin)) {
            return c.json({
                enabled: false,
                canPlan: false,
                code: "SCHEMA_EDITING_UNSUPPORTED",
                reason: "This backend's driver cannot plan schema changes. Live editing is " +
                    "available on Postgres."
            });
        }
        if (!config.writeSource) {
            // The caller's reason wins, because it is the one that is true.
            // The dependency message is the fallback for a caller that supplies
            // `writeSource` conditionally and says nothing about why.
            const off = config.sourceEditingOff;
            return c.json({
                enabled: false,
                // Planning reads the source and writes nothing, so it is
                // possible wherever the source can be read.
                canPlan: Boolean(config.previewSource),
                code: off?.code ?? "SCHEMA_EDITOR_MISSING_DEPENDENCY",
                reason: off?.message
                    ?? "Rewriting collection source needs `ts-morph`, which is not installed " +
                    `on this server. ${tsMorphInstallSentence()}`
            });
        }
        if (!repository) {
            return c.json({
                enabled: false,
                // `plan` needs no repository, and saying so is the difference
                // between a panel that greys out the preview and one that can
                // still show somebody exactly what their change would do.
                canPlan: Boolean(config.previewSource),
                code: "SCHEMA_EDITING_NO_REPOSITORY",
                reason: "There is no repository to commit to. Live schema editing writes the " +
                    "change to your project's source before applying it, so it needs the project " +
                    "mounted — a deployment running from a built bundle has compiled output and " +
                    "no source to edit."
            });
        }
        // The caller's own capabilities, not just the server's. A person who
        // may preview but not apply should see that before they read a plan and
        // decide — being refused at the moment of pressing the button is the
        // worst time to learn it.
        const capabilities = schemaEditCapabilities(
            classifyPrincipal(c.get("user")),
            config.policy
        );

        // The branch belongs here rather than on the plan, which is asked again
        // for every change the panel reviews and every retry: locally this is a
        // git call, a process spawned each time, for an answer that does not
        // change between them. It is also the
        // thing somebody most needs *before* confirming — a commit is landing
        // somewhere, and "somewhere" should be on screen rather than in the
        // receipt afterwards.
        let branch: string | undefined;
        try {
            branch = await repository.currentBranch();
        } catch {
            // A repository that cannot name its branch can still commit to it.
            // Not knowing is worth less than refusing over.
            branch = undefined;
        }

        const databaseOff = config.databaseChangesOff;
        return c.json({
            enabled: true,
            canPlan: capabilities.plan,
            canApply: capabilities.apply && !databaseOff,
            applyRefusedBecause: databaseOff?.message ?? capabilities.reason,
            applyRefusedCode: databaseOff?.code ?? capabilities.code,
            repository: repository.root,
            branch
        });
    });

    /** The admin, or a refusal naming what is missing rather than a 500. */
    const requirePlanner = () => {
        const admin = config.getAdmin();
        if (!isSchemaEditingAdmin(admin)) {
            throw ApiError.serviceUnavailable(
                "This backend's driver cannot plan schema changes. Live editing is available on " +
                "Postgres.",
                "SCHEMA_EDITING_UNSUPPORTED"
            );
        }
        return admin;
    };

    const requireRepository = (author?: { name: string; email: string }): SchemaEditRepository => {
        const repository = config.getRepository(author);
        if (!repository) {
            throw ApiError.serviceUnavailable(
                "There is no repository to commit to. Live schema editing writes the change to your " +
                "project's source before applying it, so it needs the project mounted — a deployment " +
                "running from a built bundle has compiled output and no source to edit.",
                "SCHEMA_EDITING_NO_REPOSITORY"
            );
        }
        return repository;
    };

    /**
     * The edit applied to a copy of the source and compiled, or the refusal
     * that says why it cannot be — what every plan's `after` side is.
     */
    const preview = async (patches: readonly TablePatch[]): Promise<PreviewedSource> => {
        if (!config.previewSource) {
            const off = config.sourceEditingOff;
            throw new ApiError(
                501,
                off?.code ?? "SCHEMA_EDITOR_MISSING_DEPENDENCY",
                off?.message ?? `Reading backend/schema needs \`ts-morph\`, which is not installed on this server. ${tsMorphInstallSentence()}`
            );
        }
        try {
            return await config.previewSource(patches);
        } catch (error) {
            if (isEditRefusal(error)) throw refusedEdit(error);
            throw error;
        }
    };

    /**
     * What would happen. No side effects, and deliberately reachable even when
     * there is no repository — knowing a change is blocked is useful before
     * knowing where it would be committed.
     */
    router.post("/plan", async (c) => {
        const patches = parsePatches(await readBody(c));
        const admin = requirePlanner();

        // Checked even though planning has no side effects, and even though the
        // admin gate has already run. A capability function that trusts its
        // caller to have checked is one refactor away from granting everything,
        // and this is the cheap half of making that impossible.
        const capabilities = schemaEditCapabilities(
            classifyPrincipal(c.get("user")),
            config.policy
        );
        if (!capabilities.plan) {
            throw ApiError.forbidden(
                capabilities.reason ?? "This caller may not plan schema changes.",
                capabilities.code ?? "FORBIDDEN"
            );
        }

        const source = await preview(patches);
        const plan = await planOrRefusal(admin, config.getCompiledTables(), source.schema.tables, config.commitPaths);
        return c.json({
            applicable: plan.classified.applicable,
            verdict: plan.classified.verdict,
            changes: plan.classified.changes,
            statements: plan.statements,
            files: filesCommittedBy(config, source, plan),
            message: messageFor(patches, plan),
            // A change can be applicable and still leave something the config
            // asks for unenforced. That is not a refusal, so it does not belong
            // in `changes` — but it is the one thing on this response somebody
            // might want to stop and read.
            withheldConstraints: plan.withheldConstraints ?? [],
            followUp: followUpFor(config, plan.statements)
        });
    });

    // Planning is `schema:read`, which the router's gate already checked;
    // applying alters the database and the project's source.
    router.post("/apply", requireScope("schema:write"), async (c) => {
        const body = await readBody(c);
        const patches = parsePatches(body);
        // "Edit source only": commit the table source and the generated schema
        // for a change the database cannot take, and run nothing.
        const sourceOnly = isRecord(body) && body.sourceOnly === true;
        if (config.databaseChangesOff && !sourceOnly) {
            throw ApiError.conflict(config.databaseChangesOff.message, config.databaseChangesOff.code);
        }
        const admin = requirePlanner();

        // Applying is the second privilege, and the admin gate in front of this
        // route only answered the first. See `schema-edit-permissions.ts`:
        // a commit needs an author, and a credential is not one.
        const principal = classifyPrincipal(c.get("user"));
        const capabilities = schemaEditCapabilities(principal, config.policy);
        if (!capabilities.apply) {
            throw ApiError.forbidden(
                capabilities.reason ?? "This caller may not apply schema changes.",
                capabilities.code ?? "FORBIDDEN"
            );
        }
        const writeSource = config.writeSource;
        if (!writeSource) {
            const off = config.sourceEditingOff;
            throw new ApiError(
                501,
                off?.code ?? "SCHEMA_EDITOR_MISSING_DEPENDENCY",
                off?.message ?? `Rewriting backend/schema needs \`ts-morph\`, which is not installed on this server. ${tsMorphInstallSentence()}`
            );
        }

        // Attributed to whoever pressed the button. A machine that has been
        // allowed to apply is named as a machine, so that reading `git log` a
        // month from now still distinguishes the two.
        const author = principal.kind === "machine"
            ? machineCommitAuthor(principal)
            : await commitAuthor(c.get("user"), config.resolveAuthorIdentity);
        const repository = requireRepository(author);

        // One apply at a time, from the preview to the last statement: two at
        // once (a double confirm, two tabs) both passed the dirty-tree check,
        // then wrote and committed in whatever order their awaits fell.
        return oneApplyAtATime(async () => {
            // The edit is made on a copy and compiled first, and planned
            // against what it compiles to, before anything is written: a change
            // that turns out to be unapplicable is refused having touched
            // nothing.
            const source = await preview(patches);
            const before = config.getCollections();
            const after = source.schema.collections;
            const compiledBefore = config.getCompiledTables();
            const compiledAfter = source.schema.tables;
            const plan = sourceOnly
                ? await planSourceOnly(admin, compiledBefore, compiledAfter, config.commitPaths)
                : await planOrRefusal(admin, compiledBefore, compiledAfter, config.commitPaths);
            if (!plan.classified.applicable && !sourceOnly) {
                const blocking = plan.classified.changes.filter(c => c.verdict !== "safe");
                throw ApiError.badRequest(
                    "This change cannot be applied to a running database:\n" +
                    blocking.map(c => `  • ${c.detail}${c.remedy ? `\n    ${c.remedy}` : ""}`).join("\n"),
                    "SCHEMA_CHANGE_UNAPPLICABLE",
                    { changes: plan.classified.changes }
                );
            }

            let result: Awaited<ReturnType<typeof applySchemaChange>>;
            try {
                result = await applySchemaChange({
                    plan: sourceOnly
                        ? { ...plan, statements: [] }
                        : { ...plan, message: messageFor(patches, plan) },
                    sourceOnly,
                    repository,
                    // The paths the edit changes, known from the preview, so the
                    // dirty-tree check sees them before anything is written and
                    // does not mistake this change's own edit for someone else's.
                    sourcePaths: source.files.map(file => file.path),
                    writeSource: () => writeSource(source),
                    apply: async (statements) => {
                        const sql = config.getAdmin();
                        if (!isSQLAdmin(sql)) {
                            throw new Error("The driver cannot run SQL, so the change cannot be applied here.");
                        }
                        // One statement at a time: several of these are
                        // `CREATE INDEX CONCURRENTLY`, which may not run inside a
                        // transaction, and a single batched call would open one.
                        // Which also means a failure part-way leaves the earlier
                        // ones applied, so the count travels with the error.
                        for (const [index, statement] of statements.entries()) {
                            try {
                                await sql.executeSql(statement);
                            } catch (err) {
                                throw new StatementFailedError(index, statement, err);
                            }
                        }
                    }
                });
            } catch (err) {
                if (err instanceof UnapplicableChangeError) {
                    throw ApiError.badRequest(err.message, "SCHEMA_CHANGE_UNAPPLICABLE", {
                        changes: err.classified.changes
                    });
                }
                if (err instanceof DirtyWorkingTreeError) {
                    throw ApiError.conflict(err.message, "SCHEMA_EDIT_DIRTY_TREE");
                }
                if (isEditRefusal(err)) throw refusedEdit(err);
                // Anything else that goes wrong between the check and the commit —
                // a file changed since the preview, git refusing the commit, a
                // path outside the repository — is a refusal of *this change*,
                // not a broken server. Deliberately below the specific cases
                // above, so neither is flattened into this one.
                throw ApiError.badRequest(
                    err instanceof Error ? err.message : String(err),
                    "SCHEMA_CHANGE_FAILED"
                );
            }

            logger.info(`[schema-edit] ${result.summary}`);
            // The database has the change: serve it now, rather than after the
            // next restart. A source-only commit, or an apply whose statements
            // failed, leaves the database behind the source — the tables served
            // stay those the database holds.
            //
            // A change to some table's `rls` is enforced in the same apply —
            // the planner's DDL carries no policies — or, where it cannot be,
            // the served tables keep the `rls` the database still enforces:
            // the panel, the Studio and MCP never report a posture Postgres
            // does not hold.
            let policies: SchemaEditPolicyOutcome | undefined;
            if (!sourceOnly && result.applied) {
                const changed = rlsChangedSlugs(before, after);
                let served = source.schema;
                if (changed.length > 0) {
                    policies = await applyChangedPolicies(config, source.schema, changed);
                    if (policies.status !== "applied") served = keepEnforcedRls(source.schema, changed, before, config.getTables?.() ?? []);
                }
                await config.onApplied?.(served);
            }
            const policyFollowUp = policies && policies.status !== "applied" ? [policies.message] : [];
            // Carried onto the result as well as the plan: whoever reads the
            // outcome may not be whoever read the preview.
            return c.json({
                ...result,
                ...(policies ? { policies, summary: `${result.summary} ${policySummary(policies)}` } : {}),
                withheldConstraints: plan.withheldConstraints ?? [],
                followUp: [...policyFollowUp, ...followUpFor(config, plan.statements)]
            });
        });
    });

    /**
     * The reviewed counterpart to boot's additive ensure.
     *
     * Boot never relaxes a constraint or drops a column, because nobody reads
     * its plan. These two routes are the place somebody does: `plan` lists every
     * column the collections made optional that the database still requires,
     * and every column no collection declares; it drops only the columns named
     * in `drop`. `apply` runs a plan only on the `digest` it was shown, so what
     * runs is what was read, and a database that changed in between is refused
     * with the new plan rather than altered on the old one.
     *
     * No repository is involved, unlike `/apply` above. The collections the
     * server runs are already the source of truth; this brings the database to
     * them. That is also what makes it reachable on a deployment running from a
     * built bundle, where the runtime is the only thing that can reach the
     * database at all.
     */
    const requireReconciler = () => {
        const admin = config.getAdmin();
        if (!isSchemaEditingAdmin(admin) || typeof admin.planSchemaReconcile !== "function") {
            throw ApiError.serviceUnavailable(
                "This backend's driver cannot plan a schema reconcile. It is available on Postgres.",
                "SCHEMA_RECONCILE_UNSUPPORTED"
            );
        }
        return { plan: admin.planSchemaReconcile.bind(admin) };
    };

    const readReconcileRequest = async (c: Context<HonoEnv>): Promise<{ drop: string[]; confirm?: string }> => {
        const body = await readBody(c);
        if (!isRecord(body)) throw ApiError.badRequest("Expected a JSON object.", "INVALID_RECONCILE");
        const drop = body.drop ?? [];
        if (!Array.isArray(drop) || !drop.every((d): d is string => typeof d === "string")) {
            throw ApiError.badRequest("`drop` is a list of \"<collection>.<column>\" strings.", "INVALID_RECONCILE");
        }
        const confirm = typeof body.confirm === "string" ? body.confirm : undefined;
        return { drop, confirm };
    };

    router.post("/reconcile/plan", async (c) => {
        const { drop } = await readReconcileRequest(c);
        const plan = await requireReconciler().plan(config.getCompiledTables(), { drop });
        return c.json(plan);
    });

    router.post("/reconcile/apply", requireScope("schema:write"), async (c) => {
        const { drop, confirm } = await readReconcileRequest(c);
        if (!confirm) {
            throw ApiError.badRequest(
                "Applying needs `confirm`: the digest of the plan you reviewed, from /reconcile/plan.",
                "SCHEMA_RECONCILE_UNCONFIRMED"
            );
        }
        if (config.databaseChangesOff) {
            throw ApiError.conflict(config.databaseChangesOff.message, config.databaseChangesOff.code);
        }
        const reconciler = requireReconciler();

        return oneApplyAtATime(async () => {
            const plan = await reconciler.plan(config.getCompiledTables(), { drop });
            if (plan.problems.length > 0) {
                throw ApiError.badRequest(
                    "This reconcile cannot be applied:\n" + plan.problems.map(p => `  • ${p}`).join("\n"),
                    "SCHEMA_RECONCILE_INVALID",
                    { plan }
                );
            }
            if (plan.digest !== confirm) {
                throw ApiError.conflict(
                    "The database or the collections changed since that plan was made, so it was not " +
                    "applied. Review the new plan and confirm it.",
                    "SCHEMA_RECONCILE_STALE",
                    { plan }
                );
            }

            const sql = config.getAdmin();
            if (!isSQLAdmin(sql)) {
                throw ApiError.serviceUnavailable("The driver cannot run SQL.", "SCHEMA_RECONCILE_UNSUPPORTED");
            }
            // One at a time, and the count travels with a failure: a relaxed
            // constraint that landed before a failed drop is still relaxed.
            const applied: string[] = [];
            for (const statement of plan.statements) {
                try {
                    await sql.executeSql(statement);
                } catch (err) {
                    throw ApiError.badRequest(
                        `Applied ${applied.length} of ${plan.statements.length} statements, then ` +
                        `${statement} failed: ${err instanceof Error ? err.message : String(err)}`,
                        "SCHEMA_RECONCILE_FAILED",
                        { applied }
                    );
                }
                applied.push(statement);
            }
            logger.warn(`[schema] Reconciled the database: ${applied.length} statement(s).`, { applied });
            return c.json({ applied, plan });
        });
    });

    return router;
}