import { col, defineTable, isTableDef, rel } from "../../src/schema";
import type { InferRow, RelationKeyOf } from "../../src/schema";
import { authors } from "./cycle/authors";
import { books } from "./cycle/books";
import { shelves } from "./cycle/shelves";

/**
 * Tables that point at each other compile with plain `() => other` thunks:
 * `rel.*` take a `TableThunk` (`() => void`), whose return type TypeScript
 * never resolves while it infers the table being defined. Before, one side of
 * every cycle had to be annotated or the file failed with TS7022/TS7024.
 *
 * Checked by `tsc` (ts-jest type-checks this file; `pnpm typecheck` runs the
 * tests' tsconfig): if a cycle stopped compiling, so would this file.
 */

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
/** Compiles only when its argument is `true`. */
function assertType<T extends true>(_proof?: T): void {
    void _proof;
}

// ── In one file: A ↔ B, B ↔ C, C → A, and A → A ─────────────────────────────

const alpha = defineTable("alpha", {
    columns: { id: col.uuid().primaryKey() },
    relations: {
        betas: rel.hasMany(() => beta),
        parent: rel.belongsTo(() => alpha, { localKey: "parent_ref" })
    },
    rls: "admin-only"
});

const beta = defineTable("beta", {
    columns: { id: col.uuid().primaryKey() },
    relations: {
        alpha: rel.belongsTo(() => alpha),
        gammas: rel.hasMany(() => gamma)
    },
    rls: "admin-only"
});

const gamma = defineTable("gamma", {
    columns: { id: col.uuid().primaryKey(), betaId: col.uuid().notNull() },
    relations: {
        beta: rel.belongsTo(() => beta, { localKey: "beta_id" }),
        alpha: rel.belongsTo(() => alpha),
        reach: rel.via(() => alpha, { steps: [{ table: "beta", on: { from: "beta_id", to: "id" } }], cardinality: "one" })
    },
    rls: "admin-only"
});

function oneFile(): void {
    // Relation names survive the cycle.
    assertType<Equal<RelationKeyOf<typeof alpha>, "betas" | "parent">>();
    assertType<Equal<RelationKeyOf<typeof beta>, "alpha" | "gammas">>();
    assertType<Equal<RelationKeyOf<typeof gamma>, "beta" | "alpha" | "reach">>();
    // So does the `localKey` literal, captured by the const options generic:
    // the derived foreign key is `parentRef`, not `parentId`.
    assertType<Equal<InferRow<typeof alpha>["parentRef"], string | number | null | undefined>>();
    assertType<Equal<"parentId" extends keyof InferRow<typeof alpha> ? true : false, false>>();
    assertType<Equal<InferRow<typeof beta>["alphaId"], string | number | null | undefined>>();
    // A bound foreign key is the declared column, not a second key.
    assertType<Equal<InferRow<typeof gamma>["betaId"], string>>();
    assertType<Equal<NonNullable<typeof alpha.config.relations>["parent"]["localKey"], "parent_ref">>();
}

// ── Across files: the same shape, each table in its own module ───────────────

function acrossFiles(): void {
    assertType<Equal<RelationKeyOf<typeof authors>, "books" | "mentor">>();
    assertType<Equal<RelationKeyOf<typeof books>, "author" | "shelf" | "sequels">>();
    assertType<Equal<RelationKeyOf<typeof shelves>, "books" | "curator">>();
    assertType<Equal<InferRow<typeof authors>["mentorRef"], string | number | null | undefined>>();
    assertType<Equal<InferRow<typeof books>["authorId"], string | number | null | undefined>>();
    assertType<Equal<InferRow<typeof books>["shelfId"], string | number | null | undefined>>();
    assertType<Equal<InferRow<typeof shelves>["curatorId"], string | number | null | undefined>>();
    assertType<Equal<NonNullable<typeof books.config.relations>["author"]["notNull"], true>>();
}

describe("tables that point at each other", () => {
    it("compile without annotations, and their thunks return the tables", () => {
        void oneFile;
        void acrossFiles;
        expect(beta.config.relations?.alpha.target()).toBe(alpha);
        expect(alpha.config.relations?.parent.target()).toBe(alpha);
        expect(gamma.config.relations?.alpha.target()).toBe(alpha);
        expect(authors.config.relations?.books.target()).toBe(books);
        expect(books.config.relations?.shelf.target()).toBe(shelves);
        expect(shelves.config.relations?.curator.target()).toBe(authors);
        expect(isTableDef(books.config.relations?.sequels.target())).toBe(true);
    });
});
