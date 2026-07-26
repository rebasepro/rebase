import * as ts from "typescript";
import { RelationKind } from "@rebasepro/types";

import { generateCollectionFile } from "../src/schema/introspect-db-logic";
import { ForeignKeyRow, TableColumn, TableMeta } from "../src/schema/introspect-db-logic";

/**
 * Introspection writes collection *source code*, as template strings.
 *
 * That put it outside every check the relation refactor relied on. The codemod
 * rewrote real declarations, so it never saw these; `tsc` typechecks the
 * generator, not the code the generator prints; and the existing tests assert
 * with `toContain`, which happily passes on a field the type no longer has.
 * Introspection went on emitting `cardinality` / `direction` / a top-level
 * `target` long after `Relation` stopped accepting them — so `rebase db pull`
 * produced files that would not compile.
 *
 * This parses the emitted file and checks the shape of what it wrote. The
 * allowed-field table below is typed `Record<RelationKind, ...>`, so adding a
 * sixth kind to the union breaks this test at compile time rather than letting
 * codegen quietly fall behind the types again.
 */

/** Mirrors the union in `@rebasepro/types`: which fields each kind may carry. */
const FIELDS_BY_KIND: Record<RelationKind, string[]> = {
    belongsTo: ["localKey"],
    hasOne: ["foreignKeyOnTarget"],
    hasMany: ["foreignKeyOnTarget"],
    manyToMany: ["through"],
    via: ["cardinality", "joinPath"]
};

/** Fields any kind may carry, from `RelationBase`. */
const SHARED = ["kind", "relationName", "target", "onDelete", "onUpdate", "overrides", "validation"];

/** Fields that existed before the union and must never be emitted again. */
const RETIRED = ["direction", "inverseRelationName"];

interface EmittedRelation {
    kind: string;
    fields: string[];
    where: string;
}

/** Every relation literal in the generated source, via the TypeScript parser. */
function parseRelations(source: string): EmittedRelation[] {
    const sf = ts.createSourceFile("generated.ts", source, ts.ScriptTarget.Latest, true);
    const found: EmittedRelation[] = [];

    const readLiteral = (node: ts.ObjectLiteralExpression, where: string) => {
        const fields = node.properties
            .map(p => (p.name && ts.isIdentifier(p.name) ? p.name.text : undefined))
            .filter((n): n is string => !!n);
        if (!fields.includes("kind")) {
            found.push({ kind: "(missing)",
fields,
where });
            return;
        }
        const kindProp = node.properties.find(
            p => p.name && ts.isIdentifier(p.name) && p.name.text === "kind"
        );
        const kind = kindProp && ts.isPropertyAssignment(kindProp) && ts.isStringLiteral(kindProp.initializer)
            ? kindProp.initializer.text
            : "(not a literal)";
        found.push({ kind,
fields,
where });
    };

    const visit = (node: ts.Node) => {
        // `relations: [ {...}, {...} ]`
        if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && node.name.text === "relations"
            && ts.isArrayLiteralExpression(node.initializer)) {
            for (const el of node.initializer.elements) {
                if (ts.isObjectLiteralExpression(el)) readLiteral(el, "relations[]");
            }
        }
        // `someProp: { type: "relation", relation: { ... } }`
        if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && node.name.text === "relation"
            && ts.isObjectLiteralExpression(node.initializer)) {
            readLiteral(node.initializer, "property.relation");
        }
        ts.forEachChild(node, visit);
    };

    visit(sf);
    return found;
}

// ── Fixtures ─────────────────────────────────────────────────────────────

const col = (table: string, name: string, opts: Partial<TableColumn> = {}): TableColumn => ({
    table_name: table,
    column_name: name,
    data_type: "character varying",
    udt_name: "varchar",
    is_nullable: "YES",
    column_default: null,
    ...opts
});

const fk = (table: string, column: string, target: string, targetCol = "id"): ForeignKeyRow => ({
    table_name: table,
    column_name: column,
    foreign_table_name: target,
    foreign_column_name: targetCol
});

const table = (name: string, columns: TableColumn[], pks: string[] = ["id"], fks: ForeignKeyRow[] = []): TableMeta =>
    ({ name,
columns,
pks,
fks });

const ID = { data_type: "uuid",
udt_name: "uuid",
is_nullable: "NO" };

describe("introspection emits relations the union accepts", () => {
    const cases: Array<{ name: string; generate: () => string }> = [
        {
            name: "belongsTo — an FK on this table",
            generate: () => {
                const fks = [fk("posts", "author_id", "users")];
                const meta = table("posts", [col("posts", "id", ID), col("posts", "author_id")], ["id"], fks);
                return generateCollectionFile("posts", meta, fks, new Set(), new Map([["posts", meta]]), new Map());
            }
        },
        {
            name: "hasMany — an FK on another table pointing back",
            generate: () => {
                const fks = [fk("comments", "post_id", "posts")];
                const meta = table("posts", [col("posts", "id", ID)]);
                return generateCollectionFile("posts", meta, fks, new Set(), new Map([["posts", meta]]), new Map());
            }
        },
        {
            name: "manyToMany — a junction table, from both ends",
            generate: () => {
                const fks = [fk("articles_tags", "article_id", "articles"), fk("articles_tags", "tag_id", "tags")];
                const jt = table("articles_tags", [col("articles_tags", "article_id"), col("articles_tags", "tag_id")], ["article_id", "tag_id"], fks);
                const articles = table("articles", [col("articles", "id", ID)]);
                const tagsMeta = table("tags", [col("tags", "id", ID)]);
                const all = new Map([["articles", articles], ["tags", tagsMeta], ["articles_tags", jt]]);
                // Generated from the alphabetically *later* side — the one that
                // used to be handed a relation with no `through` and a comment
                // telling the reader to finish it themselves.
                return generateCollectionFile("tags", tagsMeta, fks, new Set(["articles_tags"]), all, new Map());
            }
        }
    ];

    for (const c of cases) {
        describe(c.name, () => {
            it("gives every relation a kind the union declares", () => {
                const relations = parseRelations(c.generate());
                expect(relations.length).toBeGreaterThan(0);
                for (const r of relations) {
                    expect(Object.keys(FIELDS_BY_KIND)).toContain(r.kind);
                }
            });

            it("emits no field the relation's kind does not own", () => {
                for (const r of parseRelations(c.generate())) {
                    const allowed = new Set([...SHARED, ...(FIELDS_BY_KIND[r.kind as RelationKind] ?? [])]);
                    const stray = r.fields.filter(f => !allowed.has(f));
                    expect({ where: r.where,
kind: r.kind,
stray }).toEqual({ where: r.where,
kind: r.kind,
stray: [] });
                }
            });

            it("never brings back a retired field", () => {
                const source = c.generate();
                for (const dead of RETIRED) {
                    expect(source).not.toContain(`${dead}:`);
                }
            });
        });
    }

    it("configures the junction from both ends, not just the alphabetically-first one", () => {
        const fks = [fk("articles_tags", "article_id", "articles"), fk("articles_tags", "tag_id", "tags")];
        const jt = table("articles_tags", [col("articles_tags", "article_id"), col("articles_tags", "tag_id")], ["article_id", "tag_id"], fks);
        const articles = table("articles", [col("articles", "id", ID)]);
        const tagsMeta = table("tags", [col("tags", "id", ID)]);
        const all = new Map([["articles", articles], ["tags", tagsMeta], ["articles_tags", jt]]);

        const fromTags = generateCollectionFile("tags", tagsMeta, fks, new Set(["articles_tags"]), all, new Map());

        // `sourceColumn` names the collection the file belongs to.
        expect(fromTags).toContain('table: "articles_tags"');
        expect(fromTags).toContain('sourceColumn: "tag_id"');
        expect(fromTags).toContain('targetColumn: "article_id"');
        expect(fromTags).not.toContain("Make sure the target collection");
    });
});
