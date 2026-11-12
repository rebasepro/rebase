import type { DatabaseOf } from "../schema/infer";

/**
 * The project-wide registry of a project's data types, filled by module augmentation.
 *
 * Empty by default, and every server-side data surface is untyped while it is:
 * `context.data`, `rebase.dataAsAdmin`, a cron's `ctx.rebase` and a function's
 * `ctx.rebase` accept any collection by any name and hand back open records.
 *
 * A project that generated its types with `rebase generate-sdk` registers its
 * `Database` once, in any file the TypeScript program includes:
 *
 * ```ts
 * // src/rebase-env.d.ts — or the top of any module file
 * import type { Database } from "./generated/database.types";
 *
 * declare module "@rebasepro/types" {
 *     interface Register {
 *         database: Database;
 *     }
 * }
 * ```
 *
 * From then on every one of those surfaces is typed from it: rows, filters,
 * sorts, `include`, and the inputs `create` and `update` accept. Nothing about
 * the runtime changes; the registration is a declaration.
 *
 * A project that has not generated anything registers its schema module
 * instead, and is typed straight from its `defineTable`s (see
 * {@link DatabaseOf} for what that can and cannot know):
 *
 * ```ts
 * declare module "@rebasepro/types" {
 *     interface Register {
 *         tables: typeof import("./backend/schema");
 *     }
 * }
 * ```
 *
 * A generated `database` wins over `tables` when both are registered: it is
 * the exact one.
 *
 * A single function or cron can still name its own type instead —
 * `defineFunction<Database>(…)`, `defineCron<Database>({…})` — which wins over
 * the registration.
 *
 * @group Data
 */
// Declared empty on purpose: it exists to be augmented by the project.
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface Register {}

/**
 * The generated `Database` a project registered on {@link Register}
 * (`Register.database`), or `unknown`. What a table's own hooks are typed
 * from: typing them from `Register.tables` would type a schema from itself.
 *
 * @group Data
 */
export type GeneratedDatabase = Register extends { database: infer DB } ? DB : unknown;

/**
 * The `Database` a project registered on {@link Register} — its generated
 * `database`, or else {@link DatabaseOf} its registered schema module
 * (`tables`) — or `unknown` when it registered neither, which is what keeps an
 * unregistered project's server-side data untyped, exactly as it was before
 * the registry existed.
 *
 * @group Data
 */
export type RegisteredDatabase = Register extends { database: infer DB }
    ? DB
    : Register extends { tables: infer M } ? DatabaseOf<M> : unknown;
