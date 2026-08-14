/**
 * A policy clause written into a TypeScript file has to read back as itself.
 *
 * The Drizzle generator emits each compiled clause inside `` sql`…` ``, and
 * Drizzle's `sql` tag reads the *cooked* template strings — so a backslash in
 * the clause is consumed as a JavaScript escape and never reaches Postgres. The
 * DDL generator writes the same clause into a `.sql` file, where a backslash is
 * just a backslash. The two paths therefore produced different policies from
 * one rule, and the difference was always in the permissive direction: every
 * `\.` in a regex became `.`, which matches anything.
 *
 * The equivalence asserted here is the point — not the escaping mechanics but
 * the invariant that both generators carry the same SQL, whatever is in it.
 */
import { CollectionConfig } from "@rebasepro/types";
import { generateSchema } from "../src/schema/generate-drizzle-schema-logic";
import { generatePolicyStatements } from "../src/schema/generate-postgres-ddl-logic";

/** The clause a `` sql`…` `` call in the generated file actually receives. */
const evaluateTemplate = (source: string): string => {
    const tag = (strings: TemplateStringsArray, ...values: unknown[]): string =>
        strings.reduce((acc, s, i) => acc + s + (i < values.length ? String(values[i]) : ""), "");
    // eslint-disable-next-line no-new-func
    return new Function("sql", `return ${source};`)(tag);
};

/** Every `` sql`…` `` literal in the generated schema, as its runtime value. */
const emittedClauses = (schema: string): string[] => {
    const out: string[] = [];
    const re = /sql`(?:[^`\\]|\\.)*`/g;
    for (const match of schema.match(re) ?? []) out.push(evaluateTemplate(match));
    return out;
};

const collectionWith = (using: string): CollectionConfig => ({
    slug: "docs",
    table: "docs",
    name: "Docs",
    properties: { email: { type: "string" } },
    securityRules: [{ operation: "select", using }]
} as unknown as CollectionConfig);

describe("drizzle policy clauses survive the TypeScript file", () => {

    it("keeps the backslashes in a regex clause", async () => {
        const using = "email ~ '^admin\\.user@corp\\.com$'";
        const schema = await generateSchema([collectionWith(using)]);

        const clauses = emittedClauses(schema);
        expect(clauses).toContain(using);
        // The failing shape: the escape eaten, the dot now matching anything.
        expect(clauses).not.toContain("email ~ '^admin.user@corp.com$'");
    });

    it("emits the same clause the SQL generator writes", async () => {
        const using = "email ~ '^[a-z]+\\.[a-z]+@corp\\.com$'";
        const collection = collectionWith(using);

        const schema = await generateSchema([collection]);
        const ddl = generatePolicyStatements(collection, collection.securityRules![0], () => undefined)
            .find(s => /^CREATE POLICY/i.test(s))!;

        const drizzleClause = emittedClauses(schema).find(c => c.includes("email ~"))!;
        expect(ddl).toContain(drizzleClause);
    });

    it("does not let a backtick close the template early", async () => {
        const using = "tag = 'a`b'";
        const schema = await generateSchema([collectionWith(using)]);

        expect(schema).toContain("\\`");
        expect(emittedClauses(schema)).toContain(using);
    });

    it("does not let ${ open an interpolation", async () => {
        const using = "note = '${table}'";
        const schema = await generateSchema([collectionWith(using)]);

        // Unescaped, this is a reference to whatever `table` is in scope — the
        // generated file compiles and means something else entirely.
        expect(schema).toContain("\\${");
        expect(emittedClauses(schema)).toContain(using);
    });

    it("leaves an ordinary clause untouched", async () => {
        // Recognised by the parser, so it comes back with the uid cast the
        // compiler adds — but with no escaping applied to any of it.
        const schema = await generateSchema([collectionWith("owner_id = rebase.uid()")]);

        expect(schema).toContain("sql`(owner_id)::text = rebase.uid()`");
        expect(schema).not.toContain("\\");
    });
});
