import { PGlite } from "@electric-sql/pglite";
import {
    UNDECLARABLE_CONSTRAINTS_SQL,
    atlasExcludeSegment,
    declaredConstraintNames,
    undeclaredConstraintExcludes,
    type ExistingConstraint
} from "../src/schema/undeclarable-constraints";
import { ExcludeIntrospectionError, getUndeclaredConstraintExcludes } from "../src/cli-helpers";
import { detectDestructiveStatements } from "../src/schema/destructive-sql";

/**
 * A collection cannot declare a CHECK or an EXCLUDE constraint, so the desired
 * state never has one, and `db push` handed Atlas every such constraint on a
 * managed table to drop — the first push after `schema introspect` dropped
 * `orders_total_check` without a prompt. The push now excludes them; the gate
 * refuses a plan that drops one anyway.
 */

const ORDERS_CHECK: ExistingConstraint = { schema: "public", table: "orders", name: "orders_total_check", kind: "check" };
const ORDERS_EXCL: ExistingConstraint = { schema: "public", table: "orders", name: "orders_no_overlap", kind: "exclude" };

describe("undeclaredConstraintExcludes", () => {
    it("keeps every CHECK and EXCLUDE out of the plan, three-part", () => {
        expect(undeclaredConstraintExcludes([ORDERS_CHECK, ORDERS_EXCL], "CREATE TABLE \"public\".\"orders\" (\"id\" serial);"))
            .toEqual(["public.orders.orders_total_check", "public.orders.orders_no_overlap"]);
    });

    it("leaves a constraint the desired state declares to Atlas", () => {
        const desired = `CREATE TABLE "public"."orders" ("total" numeric, CONSTRAINT "orders_total_check" CHECK ("total" >= 0));`;
        expect(undeclaredConstraintExcludes([ORDERS_CHECK, ORDERS_EXCL], desired)).toEqual(["public.orders.orders_no_overlap"]);
    });

    it("keeps everything when there is no desired state to read", () => {
        expect(undeclaredConstraintExcludes([ORDERS_CHECK], "")).toEqual(["public.orders.orders_total_check"]);
    });
});

describe("declaredConstraintNames", () => {
    it("reads CHECK and EXCLUDE names, inline or added, with quotes undoubled", () => {
        const desired = [
            `CREATE TABLE "s"."t" ("a" int, CONSTRAINT "t_a_check" CHECK ("a" > 0));`,
            `ALTER TABLE "s"."t" ADD CONSTRAINT "say ""hi""" EXCLUDE USING gist ("r" WITH &&);`,
            // A foreign key is not one of them.
            `ALTER TABLE "s"."t" ADD CONSTRAINT "t_b_fkey" FOREIGN KEY ("b") REFERENCES "s"."u" ("id");`
        ].join("\n");
        expect([...declaredConstraintNames(desired)].sort()).toEqual(["say \"hi\"", "t_a_check"]);
    });
});

describe("atlasExcludeSegment", () => {
    it("leaves an ordinary name as it is", () => {
        expect(atlasExcludeSegment("orders_total_check")).toBe("orders_total_check");
    });

    // Measured against atlas 1.2.3: a raw dot refuses the whole command with
    // `too many parts in pattern`; escaped glob syntax matches the literal.
    it("turns a dot into a one-character wildcard, so the pattern keeps three parts", () => {
        expect(atlasExcludeSegment("dot.ted")).toBe("dot?ted");
        expect(undeclaredConstraintExcludes([{ ...ORDERS_CHECK, name: "v1.total" }], "")[0].split(".")).toHaveLength(3);
    });

    it("escapes glob syntax", () => {
        expect(atlasExcludeSegment("weird[1]*?")).toBe("weird\\[1\\]\\*\\?");
        expect(atlasExcludeSegment("back\\slash")).toBe("back\\\\slash");
    });
});

describe("getUndeclaredConstraintExcludes", () => {
    it("fails closed when the catalogue cannot be read", async () => {
        const cause = new Error("connect ECONNREFUSED 127.0.0.1:5432");
        await expect(getUndeclaredConstraintExcludes("postgres://x/db", "", {
            queryConstraints: async () => { throw cause; }
        })).rejects.toBeInstanceOf(ExcludeIntrospectionError);
        await expect(getUndeclaredConstraintExcludes("postgres://x/db", "", {
            queryConstraints: async () => { throw cause; }
        })).rejects.toMatchObject({ cause, message: expect.stringContaining("ECONNREFUSED") });
    });

    it("excludes what the catalogue lists", async () => {
        await expect(getUndeclaredConstraintExcludes("postgres://x/db", "", {
            queryConstraints: async () => [ORDERS_CHECK]
        })).resolves.toEqual(["public.orders.orders_total_check"]);
    });
});

describe("the gate, when a CHECK or EXCLUDE drop reaches the plan anyway", () => {
    const plan = `ALTER TABLE "public"."orders" DROP CONSTRAINT "orders_total_check", DROP CONSTRAINT "orders_no_overlap", ADD COLUMN "note" text NULL;`;

    it("flags the drop and names each constraint", () => {
        const found = detectDestructiveStatements(plan, [], [ORDERS_CHECK, ORDERS_EXCL]);
        expect(found.map(d => d.kind)).toEqual(["DROP CONSTRAINT"]);
        expect(found[0].detail).toBe(
            "public.orders loses CHECK \"orders_total_check\", EXCLUDE \"orders_no_overlap\": no row is lost, " +
            "and the database accepts every row they refuse today"
        );
    });

    it("names it beside a DROP COLUMN in the same statement", () => {
        const found = detectDestructiveStatements(
            `ALTER TABLE "public"."orders" DROP CONSTRAINT "orders_total_check", DROP COLUMN "note";`, [], [ORDERS_CHECK]
        );
        expect(found.map(d => d.kind)).toEqual(["DROP COLUMN"]);
        expect(found[0].detail).toMatch(/loses CHECK "orders_total_check"/);
    });

    it("does not read a foreign key's or a UNIQUE's drop as one, nor a namesake on another table", () => {
        const others = [
            `ALTER TABLE "public"."orders" DROP CONSTRAINT "orders_customer_id_fkey";`,
            `ALTER TABLE "public"."orders" DROP CONSTRAINT "orders_code_key";`,
            `ALTER TABLE "crm"."orders" DROP CONSTRAINT "orders_total_check";`,
            `ALTER TABLE "public"."invoices" DROP CONSTRAINT "orders_total_check";`
        ].join("\n");
        expect(detectDestructiveStatements(others, [], [ORDERS_CHECK])).toEqual([]);
    });

    it("says nothing without the catalogue, as before", () => {
        expect(detectDestructiveStatements(plan)).toEqual([]);
    });
});

describe("the catalogue read the excludes come from", () => {
    let db: PGlite;

    beforeAll(async () => {
        db = new PGlite();
        await db.waitReady;
    });

    afterAll(async () => {
        await db.close();
    });

    it("lists CHECK and EXCLUDE constraints, and none a collection declares", async () => {
        await db.exec(`
            CREATE SCHEMA shop;
            CREATE TABLE shop.customers (id serial PRIMARY KEY);
            CREATE TABLE shop.orders (
                id serial PRIMARY KEY,
                code text UNIQUE,
                customer_id integer NOT NULL REFERENCES shop.customers (id),
                total numeric NOT NULL CONSTRAINT orders_total_check CHECK (total >= 0),
                starts_at integer,
                ends_at integer,
                CONSTRAINT orders_no_overlap EXCLUDE USING gist (int4range(starts_at, ends_at) WITH &&)
            );
        `);
        const { rows } = await db.query<ExistingConstraint>(UNDECLARABLE_CONSTRAINTS_SQL);
        expect(rows.filter(row => row.schema === "shop")
            .sort((a, b) => a.name.localeCompare(b.name)))
            .toEqual([
                { schema: "shop", table: "orders", name: "orders_no_overlap", kind: "exclude" },
                { schema: "shop", table: "orders", name: "orders_total_check", kind: "check" }
            ]);
    });
});
