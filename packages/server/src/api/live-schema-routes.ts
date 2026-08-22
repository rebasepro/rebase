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
    type DatabaseAdmin
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

const parseProposed = (body: unknown): ProposedChange => {
    const candidate = body as Partial<ProposedChange> | undefined;
    if (!candidate?.collectionId || typeof candidate.collectionId !== "string") {
        throw ApiError.badRequest("`collectionId` is required.", "INVALID_CHANGE");
    }
    if (!candidate.collection || typeof candidate.collection !== "object") {
        throw ApiError.badRequest("`collection` is required.", "INVALID_CHANGE");
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
    router.get("/status", (c) => {
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
            return c.json({
                enabled: false,
                canPlan: true,
                code: "SCHEMA_EDITOR_MISSING_DEPENDENCY",
                reason: "Rewriting collection source needs `ts-morph`, which is not installed " +
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
        return c.json({ enabled: true, canPlan: true, repository: repository.root });
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
        const before = config.getCollections();
        const after = proposedCollections(before, change);

        const plan = await admin.planSchemaChange(before, after);
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
            withheldConstraints: plan.withheldConstraints ?? []
        });
    });

    router.post("/apply", async (c) => {
        const change = parseProposed(await c.req.json());
        const admin = requirePlanner();
        // Attributed to whoever pressed the button. A schema change with an
        // author and a diff in the project's history is the thing neither
        // competitor gives you; an anonymous one is just a commit.
        const repository = requireRepository(commitAuthor(c.get("user")));

        const before = config.getCollections();
        const after = proposedCollections(before, change);

        // Planned before the source is touched. `writeSource` writes to disk
        // through the AST editor, outside the repository's dirty-tree check, so
        // a change that turns out to be unapplicable must be refused *first* —
        // otherwise a rejected edit still leaves a rewritten collection file
        // behind, and the refusal reads as "nothing happened" when something did.
        const plan = await admin.planSchemaChange(before, after);
        if (!plan.classified.applicable) {
            const blocking = plan.classified.changes.filter(c => c.verdict !== "safe");
            throw ApiError.badRequest(
                "This change cannot be applied to a running database:\n" +
                blocking.map(c => `  • ${c.detail}${c.remedy ? `\n    ${c.remedy}` : ""}`).join("\n"),
                "SCHEMA_CHANGE_UNAPPLICABLE",
                { changes: plan.classified.changes }
            );
        }

        const sourceFiles = config.writeSource ? await config.writeSource(change) : [];
        const withSource = { ...plan, files: [...sourceFiles, ...plan.files] };

        try {
            const result = await applySchemaChange({
                plan: withSource,
                repository,
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
            return c.json({ ...result, withheldConstraints: plan.withheldConstraints ?? [] });
        } catch (err) {
            if (err instanceof UnapplicableChangeError) {
                throw ApiError.badRequest(err.message, "SCHEMA_CHANGE_UNAPPLICABLE", {
                    changes: err.classified.changes
                });
            }
            if (err instanceof DirtyWorkingTreeError) {
                throw ApiError.conflict(err.message, "SCHEMA_EDIT_DIRTY_TREE");
            }
            throw err;
        }
    });

    return router;
}
