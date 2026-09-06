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
import { Hono } from "hono";
import {
    isSchemaEditingAdmin,
    isSQLAdmin,
    type CollectionConfig,
    type DatabaseAdmin,
    type SchemaCommitPaths
} from "@rebasepro/types";
import { HonoEnv } from "./types";
import { ApiError, errorHandler } from "./errors";
import { logger } from "../utils/logger";
import {
    applySchemaChange,
    DirtyWorkingTreeError,
    UnapplicableChangeError,
    type SchemaEditRepository
} from "../schema-edit/apply-schema-change";
import {
    classifyPrincipal,
    machineCommitAuthor,
    schemaEditCapabilities,
    type SchemaEditPolicy
} from "../schema-edit/schema-edit-permissions";

export interface LiveSchemaRoutesConfig {
    /**
     * The collections the running server was built from — the `before` side.
     * Read at request time, because the registry is assembled after the routes
     * are mounted.
     */
    getCollections: () => CollectionConfig[];
    /** The driver's admin, for planning and for running the DDL. */
    getAdmin: () => DatabaseAdmin | undefined;
    /**
     * The working tree to commit into, or undefined when there is none — a
     * bundle deployment has compiled output and no source, and this stays off
     * there rather than inventing somewhere to write.
     */
    getRepository: (author?: { name: string; email: string }) => SchemaEditRepository | undefined;
    /**
     * Rewrite the collection source for a proposed change, returning the files
     * that changed. Supplied by the caller because it is the AST editor's job,
     * and that needs `ts-morph`, which is an optional dependency.
     */
    writeSource?: (change: ProposedChange) => Promise<{ path: string; contents: string }[]>;
    /**
     * Why {@link writeSource} is absent, when the caller knows.
     *
     * `writeSource` being undefined has several causes — the editor turned off,
     * `baas` mode, no `collectionsDir`, `NODE_ENV=production`, `ts-morph` not
     * installed — and this route could see only that the field was unset, so it
     * reported the last of them for all of them. The admin panel calls this
     * *and* `/api/schema-editor/status` on every page load and got two
     * different answers, one of which named a dependency that was installed.
     */
    sourceEditingOff?: { code: string; message: string };
    /**
     * Which paths {@link writeSource} will touch, without touching them.
     *
     * The dirty-tree check needs them *before* the write, or it reads the
     * change's own edit as somebody else's work in progress and refuses.
     */
    sourcePathsFor?: (change: ProposedChange) => string[];
    /**
     * Where this project's generated artifacts belong, relative to the
     * repository.
     *
     * Absent for a project that *is* the repository, which is what the defaults
     * describe. Present for one in a subdirectory, where the defaults would
     * write `backend/` and `drizzle/` beside `.git` and leave the project's real
     * generated files untouched — committing a source change alongside a stale
     * schema, which is the failure committing the whole change exists to avoid.
     */
    commitPaths?: Partial<SchemaCommitPaths>;
    /**
     * Whether this project replays versioned migrations to build an
     * environment.
     *
     * If it does, applying here is not the whole job: the DDL runs against
     * *this* database and `drizzle/schema.sql` is committed, but no migration
     * is written — a server cannot mint one, since that needs Atlas and a
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
}

/** What the panel posts: one collection, in the shape it should end up. */
export interface ProposedChange {
    collectionId: string;
    /** The whole collection as it should be after the edit. */
    collection: Record<string, unknown>;
}

/**
 * The git identity for the caller.
 *
 * `undefined` when the request carries no user — a service key, say — which
 * lets the repository fall back to its own git config rather than inventing a
 * name for somebody.
 */
export function commitAuthor(user: unknown): { name: string; email: string } | undefined {
    // `unknown` rather than the auth union: `AuthResult` admits `false` and
    // `null` as well as a user, and narrowing here keeps that shape from
    // leaking into every caller.
    if (!user || typeof user !== "object") return undefined;
    const { uid, email, displayName } = user as {
        uid?: string; email?: string; displayName?: string;
    };
    if (!uid) return undefined;
    return {
        name: displayName || email || uid,
        // A real address when there is one; otherwise a routable-looking local
        // identity, because git requires the field and a blank one is rejected.
        email: email || `${uid}@users.noreply.rebase.pro`
    };
}

/**
 * What a collection id may contain.
 *
 * The same alphabet the AST editor sanitises to, stated at the boundary
 * instead. The id becomes a *filename* — `<collectionsDir>/<id>.ts` — in two
 * places, and only one of them checked it: the editor refuses a traversal when
 * it writes, but the caller derives the same path first, to hand the dirty
 * check the paths it is about to touch. A refusal that arrives one layer in is
 * a refusal that the layer above already acted on.
 */
const SAFE_COLLECTION_ID = /^[A-Za-z0-9_-]+$/;

/**
 * What may become a Postgres identifier.
 *
 * Narrower than {@link SAFE_COLLECTION_ID}: a hyphen is fine in a filename and
 * has to be quoted in SQL, and the builders downstream interpolate rather than
 * escape. Deliberately the same alphabet
 * `server-postgres/src/schema/ensure-collection-tables.ts` enforces, so a name
 * this accepts is one that module will also accept — the two disagreeing would
 * mean a change that validates here and throws from inside a planner.
 */
const SAFE_SQL_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_$]*$/;

const parseProposed = (body: unknown): ProposedChange => {
    const candidate = body as Partial<ProposedChange> | undefined;
    if (!candidate?.collectionId || typeof candidate.collectionId !== "string") {
        throw ApiError.badRequest("`collectionId` is required.", "INVALID_CHANGE");
    }
    if (!SAFE_COLLECTION_ID.test(candidate.collectionId)) {
        throw ApiError.badRequest(
            `"${candidate.collectionId}" is not a usable collection id. It becomes a filename, so ` +
            "it may contain only letters, numbers, underscores and hyphens.",
            "INVALID_CHANGE"
        );
    }
    if (!candidate.collection || typeof candidate.collection !== "object") {
        throw ApiError.badRequest("`collection` is required.", "INVALID_CHANGE");
    }

    // The names inside the collection reach SQL as identifiers, and only the id
    // above was checked. `table`, `schema` and every property's `columnName` are
    // interpolated into CREATE TABLE and ALTER TABLE — quoted, which is not the
    // same as escaped — and those statements run on the owner connection, the
    // one connection exempt from every RLS policy. The DDL builders refuse an
    // unsafe identifier now too, but a 500 from the middle of a planner is not
    // an answer a caller can act on, and the boundary is where a bad request
    // belongs.
    const collection = candidate.collection as {
        table?: unknown;
        schema?: unknown;
        properties?: Record<string, { columnName?: unknown } | undefined>;
    };
    const named: Array<[string, unknown]> = [
        ["table", collection.table],
        ["schema", collection.schema],
        ...Object.entries(collection.properties ?? {}).map(
            ([property, spec]) => [`properties.${property}.columnName`, spec?.columnName] as [string, unknown]
        )
    ];
    for (const [field, value] of named) {
        if (value === undefined || value === null) continue;
        if (typeof value !== "string" || !SAFE_SQL_IDENTIFIER.test(value)) {
            // `typeof value` rather than the value itself: a body can carry an
            // object whose `toString` is not callable, and formatting it would
            // turn a 400 into a 500 from inside the validator.
            const shown = typeof value === "string" ? `"${value}"` : `a ${typeof value}`;
            throw ApiError.badRequest(
                `${shown} is not a usable value for \`${field}\`. It becomes a Postgres ` +
                "identifier, so it may contain only letters, numbers, underscores and dollar signs, " +
                "and may not start with a digit.",
                "INVALID_CHANGE"
            );
        }
    }

    return { collectionId: candidate.collectionId, collection: candidate.collection };
};

/**
 * The proposed collection set: everything as it is, with one collection
 * replaced or added.
 */
export function proposedCollections(
    current: CollectionConfig[],
    change: ProposedChange
): CollectionConfig[] {
    const next = { ...change.collection, slug: change.collectionId } as unknown as CollectionConfig;
    const replaced = current.map(collection =>
        collection.slug === change.collectionId ? next : collection
    );
    return replaced.some(collection => collection.slug === change.collectionId)
        ? replaced
        : [...replaced, next];
}

/**
 * What still has to happen after this change lands, if anything.
 *
 * Only one thing so far, and it is the one that would otherwise be silent: a
 * project that replays migrations needs this change recorded as one, or its
 * next environment is built without it.
 */
function followUpFor(config: LiveSchemaRoutesConfig, statements: string[]): string[] {
    if (statements.length === 0) return [];
    if (!config.usesVersionedMigrations?.()) return [];
    return [
        "This project keeps versioned migrations, and applying here does not write one — " +
        "a migration needs Atlas and a throwaway database, which a running server does not " +
        "have. `drizzle/schema.sql` has been committed and is what Atlas diffs against, so " +
        "run `rebase db generate` to record this change. Without it, the next environment " +
        "built by replaying migrations will not have it."
    ];
}

export function createLiveSchemaRoutes(config: LiveSchemaRoutesConfig): Hono<HonoEnv> {
    const router = new Hono<HonoEnv>();
    router.onError(errorHandler);

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
                canPlan: true,
                code: off?.code ?? "SCHEMA_EDITOR_MISSING_DEPENDENCY",
                reason: off?.message
                    ?? "Rewriting collection source needs `ts-morph`, which is not installed " +
                    "on this server. Run `pnpm add -D ts-morph@28.0.0` to enable it."
            });
        }
        if (!repository) {
            return c.json({
                enabled: false,
                // `plan` needs no repository, and saying so is the difference
                // between a panel that greys out the preview and one that can
                // still show somebody exactly what their change would do.
                canPlan: true,
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

        // The branch belongs here rather than on the plan, which is recomputed
        // on every keystroke: locally this is a git call, and a panel that asked
        // per keystroke would spawn a process per keystroke. It is also the
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

        return c.json({
            enabled: true,
            canPlan: capabilities.plan,
            canApply: capabilities.apply,
            applyRefusedBecause: capabilities.reason,
            applyRefusedCode: capabilities.code,
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
     * What would happen. No side effects, and deliberately reachable even when
     * there is no repository — knowing a change is blocked is useful before
     * knowing where it would be committed.
     */
    router.post("/plan", async (c) => {
        const change = parseProposed(await c.req.json());
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

        const before = config.getCollections();
        const after = proposedCollections(before, change);

        const plan = await admin.planSchemaChange(before, after, { paths: config.commitPaths });
        return c.json({
            applicable: plan.classified.applicable,
            verdict: plan.classified.verdict,
            changes: plan.classified.changes,
            statements: plan.statements,
            files: plan.files.map(file => file.path),
            message: plan.message,
            // A change can be applicable and still leave something the config
            // asks for unenforced. That is not a refusal, so it does not belong
            // in `changes` — but it is the one thing on this response somebody
            // might want to stop and read.
            withheldConstraints: plan.withheldConstraints ?? [],
            followUp: followUpFor(config, plan.statements)
        });
    });

    router.post("/apply", async (c) => {
        const change = parseProposed(await c.req.json());
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

        // Attributed to whoever pressed the button. A schema change with an
        // author and a diff in the project's history is the thing neither
        // competitor gives you; an anonymous one is just a commit. A machine
        // that has been allowed to apply is named as a machine, so that reading
        // `git log` a month from now still distinguishes the two.
        const author = principal.kind === "machine"
            ? machineCommitAuthor(principal)
            : commitAuthor(c.get("user"));
        const repository = requireRepository(author);

        const before = config.getCollections();
        const after = proposedCollections(before, change);

        // Planned before the source is touched. `writeSource` writes to disk
        // through the AST editor, outside the repository's dirty-tree check, so
        // a change that turns out to be unapplicable must be refused *first* —
        // otherwise a rejected edit still leaves a rewritten collection file
        // behind, and the refusal reads as "nothing happened" when something did.
        const plan = await admin.planSchemaChange(before, after, { paths: config.commitPaths });
        if (!plan.classified.applicable) {
            const blocking = plan.classified.changes.filter(c => c.verdict !== "safe");
            throw ApiError.badRequest(
                "This change cannot be applied to a running database:\n" +
                blocking.map(c => `  • ${c.detail}${c.remedy ? `\n    ${c.remedy}` : ""}`).join("\n"),
                "SCHEMA_CHANGE_UNAPPLICABLE",
                { changes: plan.classified.changes }
            );
        }

        try {
            const result = await applySchemaChange({
                plan,
                repository,
                // Handed down rather than called here. Writing the source first
                // and passing the files over is what made every change fail:
                // the AST editor writes through the filesystem, so by the time
                // the dirty-tree check ran, the tree was dirty *because of this
                // change*, and it refused on the evidence of its own edit.
                sourcePaths: config.sourcePathsFor?.(change) ?? [],
                writeSource: config.writeSource
                    ? () => config.writeSource!(change)
                    : undefined,
                apply: async (statements) => {
                    const sql = config.getAdmin();
                    if (!isSQLAdmin(sql)) {
                        throw new Error("The driver cannot run SQL, so the change cannot be applied here.");
                    }
                    // One statement at a time: several of these are
                    // `CREATE INDEX CONCURRENTLY`, which may not run inside a
                    // transaction, and a single batched call would open one.
                    for (const statement of statements) await sql.executeSql(statement);
                }
            });

            logger.info(`[schema-edit] ${result.summary}`);
            // Carried onto the result as well as the plan: whoever reads the
            // outcome may not be whoever read the preview, and "applied" with a
            // constraint quietly missing is exactly the state this feature
            // exists to stop being invisible.
            return c.json({
                ...result,
                withheldConstraints: plan.withheldConstraints ?? [],
                followUp: followUpFor(config, plan.statements)
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
            // Anything else that goes wrong between the check and the commit —
            // the AST editor refusing a file it cannot parse, git refusing the
            // commit, a path outside the repository — is a refusal of *this
            // change*, not a broken server. A 500 tells the person nothing and
            // reads as an outage; the message is the useful part and it is
            // already on the error.
            //
            // Deliberately below the two specific cases above, so neither is
            // flattened into this one.
            throw ApiError.badRequest(
                err instanceof Error ? err.message : String(err),
                "SCHEMA_CHANGE_FAILED"
            );
        }
    });

    return router;
}
