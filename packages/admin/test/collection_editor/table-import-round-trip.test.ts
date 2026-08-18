import type { AdminCollection } from "@rebasepro/admin-types";
import type { TableMetadata } from "@rebasepro/types";
import { buildCollectionFromTableMetadata } from "@rebasepro/common";

import {
    toSerializableCollectionConfig,
    fromSerializableCollectionConfigs
} from "../../src/collection_editor/serializable_utils";

/**
 * The whole "import an existing table" path, end to end.
 *
 * `CollectionEditorDialog` calls `buildCollectionFromTableMetadata` with what
 * the schema-browser endpoint returned, spreads the result into the form, and
 * saves — which serializes it and writes a collection file. So the producer and
 * the serializer have to agree about relation shape, and nothing was checking
 * that they did.
 *
 * They did not. There were two copies of the producer: the one the editor
 * called emitted the pre-union flat relation (`cardinality`/`direction`) and
 * CRUD verbs where `SecurityOperation` takes SQL ones, both typed `any[]` so
 * neither showed up; the correct one had the tests and was called from nowhere.
 * And the serializer had no `relations` field at all, so every foreign key the
 * import detected was dropped on save while the form still showed it.
 *
 * This exercises real `information_schema` / `pg_policies` row shapes rather
 * than a fixture of the output, because the shapes are the contract.
 */
const metadata: TableMetadata = {
    columns: [
        {
            column_name: "id",
            data_type: "uuid",
            udt_name: "uuid",
            is_nullable: "NO",
            column_default: "gen_random_uuid()",
            character_maximum_length: null
        },
        {
            column_name: "title",
            data_type: "character varying",
            udt_name: "varchar",
            is_nullable: "NO",
            column_default: null,
            character_maximum_length: 255
        },
        {
            column_name: "author_id",
            data_type: "uuid",
            udt_name: "uuid",
            is_nullable: "YES",
            column_default: null,
            character_maximum_length: null
        },
        {
            column_name: "published_at",
            data_type: "timestamp with time zone",
            udt_name: "timestamptz",
            is_nullable: "YES",
            column_default: null,
            character_maximum_length: null
        }
    ],
    foreignKeys: [
        { column_name: "author_id", foreign_table_name: "authors", foreign_column_name: "id" }
    ],
    junctions: [
        {
            junction_table_name: "posts_tags",
            source_column_name: "post_id",
            target_table_name: "tags",
            target_column_name: "tag_id"
        }
    ],
    policies: [
        {
            policy_name: "posts_owner_select",
            roles: ["authenticated"],
            cmd: "SELECT",
            qual: "author_id = auth.uid()"
        }
    ]
};

describe("importing a table and saving the collection", () => {

    const imported = buildCollectionFromTableMetadata("posts", metadata);

    it("names the relations by kind, not by the shape the union replaced", () => {
        expect(imported.relations).toHaveLength(2);
        const kinds = imported.relations?.map(r => (r as { kind: string }).kind);
        expect(kinds).toEqual(["belongsTo", "manyToMany"]);
        // The flat pair the tagged union replaced. Emitting these produced a
        // relation the resolver cannot read, and `any[]` hid it.
        for (const r of imported.relations ?? []) {
            expect(r).not.toHaveProperty("cardinality");
            expect(r).not.toHaveProperty("direction");
        }
    });

    it("names policy operations in SQL, which is what SecurityOperation takes", () => {
        expect(imported.securityRules?.[0]).toMatchObject({
            name: "posts_owner_select",
            operations: ["select"],
            // The fixture's `qual` is the pre-1.0 spelling, because that is what
            // a database provisioned before the move actually holds. It is
            // normalised on import: copying it through would write a call to a
            // function 1.0 no longer creates into the project's own config.
            using: "author_id = rebase.uid()"
        });
        // Not the CRUD verbs the discarded copy emitted, which compile to nothing.
        expect(imported.securityRules?.[0]?.operations).not.toContain("read");
    });

    it("survives the save the editor performs on it", () => {
        const serialized = toSerializableCollectionConfig(imported as unknown as AdminCollection);

        expect(serialized.table).toBe("posts");
        expect(serialized.securityRules).toHaveLength(1);
        // The regression this file exists for: relations had no serializer, so
        // the import detected both and the save wrote neither.
        expect(serialized.relations).toHaveLength(2);
        expect(serialized.relations?.[0]).toMatchObject({ kind: "belongsTo", target: "authors" });
        expect(serialized.relations?.[1]).toMatchObject({
            kind: "manyToMany",
            target: "tags",
            through: { table: "posts_tags", sourceColumn: "post_id", targetColumn: "tag_id" }
        });
    });

    it("comes back off disk with the relation targets callable again", () => {
        const authors = { slug: "authors", name: "Authors", table: "authors", properties: {} };
        const tags = { slug: "tags", name: "Tags", table: "tags", properties: {} };

        const [posts] = fromSerializableCollectionConfigs([
            toSerializableCollectionConfig(imported as unknown as AdminCollection),
            toSerializableCollectionConfig(authors as unknown as AdminCollection),
            toSerializableCollectionConfig(tags as unknown as AdminCollection)
        ]);

        const relations = (posts as { relations?: { target: unknown }[] }).relations ?? [];
        expect(relations).toHaveLength(2);
        // The point of the round trip: `target` is a thunk in memory and a slug
        // on the wire, and every consumer calls it. A relation that comes back
        // still holding the string typechecks — the serializable shape erases
        // the difference — and fails at the first `target()`.
        for (const relation of relations) {
            expect(typeof relation.target).toBe("function");
        }
        expect((relations as { target: () => { slug: string } }[]).map(r => r.target().slug))
            .toEqual(["authors", "tags"]);
    });

    it("throws a pointed error when a relation target was not deserialized with it", () => {
        // `authors` and `tags` deliberately left out of the set.
        const [posts] = fromSerializableCollectionConfigs([
            toSerializableCollectionConfig(imported as unknown as AdminCollection)
        ]);

        const relations = (posts as { relations?: { target: () => unknown }[] }).relations ?? [];
        expect(() => relations[0].target()).toThrow(/authors/);
    });

    it("maps the columns to properties, id included", () => {
        // camelCase keys carrying the real column, not the column verbatim: a
        // property key is the wire name, and the API is camelCase throughout.
        // `columnName` is the only thing that names the column, and it still
        // does — importing a table must produce the same shape `rebase schema
        // introspect` does, or the panel and the CLI describe one database two
        // ways.
        expect(Object.keys(imported.properties)).toEqual(
            expect.arrayContaining(["id", "title", "authorId", "publishedAt"])
        );
        expect(imported.properties.authorId).toMatchObject({ columnName: "author_id" });
        expect(imported.properties.publishedAt).toMatchObject({ columnName: "published_at" });
        // `uuid`, not `true`: the generation strategy is read off the column default.
        expect(imported.properties.id).toMatchObject({ type: "string", isId: "uuid" });
        expect(imported.properties.publishedAt).toMatchObject({ type: "date" });
        expect(imported.propertiesOrder.length).toBeGreaterThan(0);
    });
});
