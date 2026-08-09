import { CollectionConfig } from "@rebasepro/types";
import { generateSchema } from "../src/schema/generate-drizzle-schema-logic";

describe("generateDrizzleSchema", () => {

    // Helper to remove comments and excessive whitespace for easier comparison
    const cleanSchema = (schema: string) => {
        return schema
            .replace(/\/\/.*$/gm, "") // Remove single-line comments
            .replace(/\/\*[\s\S]*?\*\//g, "") // Remove multi-line comments
            .replace(/\n{2,}/g, "\n") // Collapse multiple newlines
            .replace(/\s+/g, " ") // Collapse whitespace
            .trim();
    };

    it("should generate a simple table with basic types", async () => {
        const collections: CollectionConfig[] = [
            {
                slug: "products",
                table: "products",
                name: "Products",
                properties: {
                    name: { type: "string",
validation: { required: true } },
                    price: { type: "number" },
                    available: { type: "boolean" }
                }
            }
        ];

        const result = await generateSchema(collections);
        const cleanResult = cleanSchema(result);

        expect(cleanResult).toContain("export const products = pgTable(\"products\", {");
        expect(cleanResult).toContain("id: text(\"id\").primaryKey()");
        expect(cleanResult).toContain("name: text(\"name\").notNull(),");
        expect(cleanResult).toContain("price: numeric(\"price\"),");
        expect(cleanResult).toContain("available: boolean(\"available\")");
    });

    it("should generate a one-to-many relation correctly", async () => {
        const usersCollection: CollectionConfig = {
            slug: "users",
            table: "users",
            name: "Users",
            properties: {
                name: { type: "string" }
            }
        };
        const postsCollection: CollectionConfig = {
            slug: "posts",
            table: "posts",
            name: "Posts",
            properties: {
                title: { type: "string" },
                author: { type: "relation",
relationName: "author" }
            },
            relations: [
                {
                    kind: "belongsTo",
                    relationName: "author",
                    target: () => usersCollection,
                    localKey: "author_id",
                    onDelete: "set null"
                }
            ]
        };

        const result = await generateSchema([usersCollection, postsCollection]);
        const cleanResult = cleanSchema(result);

        expect(cleanResult).toContain("authorId: text(\"author_id\").references(() => users.id, { onDelete: \"set null\" })");
        const expectedRelation = "export const postsRelations = drizzleRelations(posts, ({ one, many }) => ({ \"author\": one(users, { fields: [posts.authorId], references: [users.id], relationName: \"posts_authorId\" }) }));";
        expect(cleanResult).toContain(cleanSchema(expectedRelation));
    });

    it("uses the PROPERTY key, not the column name, in a belongsTo's fields", async () => {
        // The generated Drizzle object is keyed by property; `localKey` is a
        // column. They differ the moment a property is camelCase — `userId` is
        // stored in `user_id` — and emitting the column produces a schema that
        // does not compile:
        //
        //   Property 'user_id' does not exist ... Did you mean 'userId'?
        //
        // Three of the four relation-emission sites normalised via
        // `resolvePropertyKeyForColumn`; the belongsTo branch did not, and it
        // only shows up for a collection that actually declares the FK property.
        const users: CollectionConfig = {
            slug: "users", table: "users", name: "Users",
            properties: { name: { type: "string" } }
        };
        const teamMembers: CollectionConfig = {
            slug: "team_members", table: "team_members", name: "Team Members",
            properties: {
                userId: { type: "relation",
relationName: "user" }
            },
            relations: [
                { kind: "belongsTo",
relationName: "user",
target: () => users,
localKey: "user_id" }
            ]
        };

        const result = cleanSchema(await generateSchema([users, teamMembers]));

        expect(result).toContain("fields: [teamMembers.userId]");
        expect(result).not.toContain("fields: [teamMembers.user_id]");
    });

    it("should generate a many-to-many relation with a junction table", async () => {
        const postsCollection: CollectionConfig = {
            slug: "posts",
            table: "posts",
            name: "Posts",
            properties: {
                title: { type: "string" },
                tags: { type: "relation",
relationName: "tags" }
            },
            relations: [
                {
                    kind: "manyToMany",
                    relationName: "tags",
                    target: () => tagsCollection,
                    through: {
                        table: "posts_to_tags",
                        sourceColumn: "post_id",
                        targetColumn: "tag_id"
                    }
                }
            ]
        };
        const tagsCollection: CollectionConfig = {
            slug: "tags",
            table: "tags",
            name: "Tags",
            properties: {
                name: { type: "string" }
            }
        };

        const result = await generateSchema([postsCollection, tagsCollection]);
        const cleanResult = cleanSchema(result);

        expect(cleanResult).toContain("export const postsToTags = pgTable(\"posts_to_tags\",");
        expect(cleanResult).toContain("post_id: text(\"post_id\").notNull().references(() => posts.id, { onDelete: \"cascade\" })");
        expect(cleanResult).toContain("tag_id: text(\"tag_id\").notNull().references(() => tags.id, { onDelete: \"cascade\" })");
        // The junction is a generated table like any other: locked by default.
        // It gets its composite key AND the derived policy set — it used to be
        // the one generated table with no RLS at all.
        expect(cleanResult).toContain("primaryKey({ columns: [table.post_id, table.tag_id] })");
        expect(cleanResult).toContain("pgPolicy(\"posts_to_tags_default_admin_read\"");
        expect(cleanResult).toContain("pgPolicy(\"posts_to_tags_default_edge_read\"");
        // Reads delegate to the endpoints' own RLS via correlated EXISTS.
        expect(cleanResult).toContain("EXISTS (SELECT 1 FROM \"public\".\"posts\"");
        expect(cleanResult).toContain("EXISTS (SELECT 1 FROM \"public\".\"tags\"");
        // And the junction table itself enables RLS.
        expect(cleanResult).toMatch(/posts_to_tags[\s\S]*?\]\)\)\.enableRLS\(\);/);
        expect(cleanResult).toContain("export const postsRelations = drizzleRelations(posts, ({ one, many }) => ({ \"tags\": many(postsToTags, { relationName: \"tags\" }) }));");
        const expectedJunctionRelations = "export const postsToTagsRelations = drizzleRelations(postsToTags, ({ one, many }) => ({ \"post_id\": one(posts, { fields: [postsToTags.post_id], references: [posts.id], relationName: \"tags\" }), \"tag_id\": one(tags, { fields: [postsToTags.tag_id], references: [tags.id], relationName: \"posts_to_tags_tag_id\" }) }));";
        expect(cleanResult).toContain(cleanSchema(expectedJunctionRelations));
    });

    it("keeps a junction in public even when an endpoint lives in another schema", async () => {
        // The users collection is scaffolded with `schema: "rebase"`, so every
        // m2m onto it used to emit `rebaseSchema.table("post_editors", …)` here
        // — while `resolveJunctionSpecs` (and therefore the CREATE TABLE and the
        // derived policies) hardcodes `public`. RLS was enabled and policies
        // created on `public.post_editors`; the rows went to `rebase`. The three
        // generators have to agree, and public is what the other two say.
        const usersCollection: CollectionConfig = {
            slug: "users",
            table: "users",
            schema: "rebase",
            name: "Users",
            properties: { email: { type: "string" } }
        };
        const postsCollection: CollectionConfig = {
            slug: "posts",
            table: "posts",
            name: "Posts",
            properties: {
                title: { type: "string" },
                editors: { type: "relation",
relationName: "editors" }
            },
            relations: [
                {
                    kind: "manyToMany",
                    relationName: "editors",
                    target: () => usersCollection,
                    through: {
                        table: "post_editors",
                        sourceColumn: "post_id",
                        targetColumn: "user_id"
                    }
                }
            ]
        };

        const cleanResult = cleanSchema(await generateSchema([postsCollection, usersCollection]));

        expect(cleanResult).toContain("export const postEditors = pgTable(\"post_editors\",");
        expect(cleanResult).not.toContain("rebaseSchema.table(\"post_editors\"");
        // The endpoint itself still lives where it says it does.
        expect(cleanResult).toContain("export const users = rebaseSchema.table(\"users\",");
    });

    describe("generateDrizzleSchema Column Types", () => {

        describe("String Property", () => {
            // The name used to say "varchar", which is the opposite guarantee:
            // `varchar` is the bounded choice you have to ask for by name, and
            // `text` is what a property that says nothing actually compiles to.
            it("should default to text if no columnType or isId is specified", async () => {
                const collections: CollectionConfig[] = [{
                    slug: "texts",
table: "texts",
name: "Texts",
properties: { t_default: { type: "string" } }
                }];
                const result = await generateSchema(collections);
                expect(cleanSchema(result)).toContain("t_default: text(\"t_default\")");
            });

            it("should respect explicit columnType overrides", async () => {
                const collections: CollectionConfig[] = [{
                    slug: "texts",
                    table: "texts",
                    name: "Texts",
                    properties: {
                        t_text: { type: "string",
columnType: "text" },
                        t_char: { type: "string",
columnType: "char" },
                        t_varchar: { type: "string",
columnType: "varchar" }
                    }
                }];
                const result = await generateSchema(collections);
                const cleanResult = cleanSchema(result);

                expect(cleanResult).toContain("t_text: text(\"t_text\"),");
                // Bounded types carry their length. A bare `varchar("col")` is
                // an UNBOUNDED varchar in Postgres, so emitting one for a
                // property whose whole point is `columnType: "varchar"` gave a
                // column with no limit — while the DDL generator gave the same
                // property a VARCHAR(255). Asserted as full definitions: the
                // old `toContain("varchar(\"t_varchar\")")` is a prefix of the
                // correct output too, so it could not tell the two apart.
                expect(cleanResult).toContain("t_char: char(\"t_char\", { length: 255 }),");
                expect(cleanResult).toContain("t_varchar: varchar(\"t_varchar\", { length: 255 })");
            });

            it("takes the column width from validation.max", async () => {
                const collections: CollectionConfig[] = [{
                    slug: "texts",
                    table: "texts",
                    name: "Texts",
                    properties: {
                        t_varchar: { type: "string",
columnType: "varchar",
validation: { max: 40 } }
                    }
                }];
                const result = await generateSchema(collections);
                expect(cleanSchema(result)).toContain("t_varchar: varchar(\"t_varchar\", { length: 40 })");
            });

            it("does not let a presentation flag choose the column type", async () => {
                // `admin.markdown` / `admin.multiline` used to compile to `text`,
                // which meant a field describing how the editor renders was
                // choosing the shape of the column. Both are now `text` because
                // `text` is the default, not because the generator read them — so
                // a property that says nothing and a property that says "render me
                // as markdown" produce the identical column.
                const build = (extra: Record<string, unknown>) => ([{
                    slug: "notes",
                    name: "Notes",
                    table: "notes",
                    properties: {
                        id: { name: "ID", type: "string", isId: true },
                        body: { name: "Body", type: "string", ...extra }
                    }
                }] as unknown as CollectionConfig[]);

                const plain = cleanSchema(await generateSchema(build({})));
                const markdown = cleanSchema(await generateSchema(build({ admin: { markdown: true } })));
                const multiline = cleanSchema(await generateSchema(build({ admin: { multiline: true } })));

                expect(plain).toContain("body: text(\"body\")");
                expect(markdown).toBe(plain);
                expect(multiline).toBe(plain);
            });

            it("gives a string primary key the same type as any other string", async () => {
                // The two generators disagreed here: the DDL path emitted
                // VARCHAR(255) for a string id while the drizzle path emitted a
                // bare `varchar()`, which Postgres treats as unbounded. So the same
                // property produced a capped column down one path and an uncapped
                // one down the other. FK and junction column types follow the key
                // they reference — relations.test.ts covers those.
                const collections = [{
                    slug: "authors", name: "Authors", table: "authors",
                    properties: {
                        id: { name: "ID", type: "string", isId: true },
                        name: { name: "Name", type: "string" }
                    }
                }] as unknown as CollectionConfig[];

                const result = cleanSchema(await generateSchema(collections));
                expect(result).toContain("id: text(\"id\").primaryKey()");
                expect(result).toContain("name: text(\"name\")");
                expect(result).not.toMatch(/varchar\("/);
            });

            it("should prioritize isId='uuid' over the default text", async () => {
                const collections: CollectionConfig[] = [{
                    slug: "texts",
table: "texts",
name: "Texts",
properties: { t_uuid: { type: "string",
isId: "uuid" } }
                }];
                const result = await generateSchema(collections);
                expect(cleanSchema(result)).toContain("t_uuid: uuid(\"t_uuid\").primaryKey().defaultRandom()");
            });

            it("should combine isId=true with columnType overrides", async () => {
                const collections: CollectionConfig[] = [{
                    slug: "texts",
table: "texts",
name: "Texts",
properties: { t_id: { type: "string",
isId: true,
columnType: "text" } }
                }];
                const result = await generateSchema(collections);
                expect(cleanSchema(result)).toContain("t_id: text(\"t_id\").primaryKey()");
            });

            it("should respect validation.unique along with columnType", async () => {
                const collections: CollectionConfig[] = [{
                    slug: "texts",
table: "texts",
name: "Texts",
properties: { t_unique: { type: "string",
columnType: "char",
validation: { unique: true } } }
                }];
                const result = await generateSchema(collections);
                expect(cleanSchema(result)).toContain("t_unique: char(\"t_unique\", { length: 255 }).unique()");
            });
        });

        describe("Number Property", () => {
            it("should default to numeric for normal numbers", async () => {
                const collections: CollectionConfig[] = [{
                    slug: "nums",
table: "nums",
name: "Nums",
properties: { n_def: { type: "number" } }
                }];
                const result = await generateSchema(collections);
                expect(cleanSchema(result)).toContain("n_def: numeric(\"n_def\")");
            });

            it("should default to integer if validation.integer is true", async () => {
                const collections: CollectionConfig[] = [{
                    slug: "nums",
table: "nums",
name: "Nums",
properties: { n_int: { type: "number",
validation: { integer: true } } }
                }];
                const result = await generateSchema(collections);
                expect(cleanSchema(result)).toContain("n_int: integer(\"n_int\")");
            });

            it("should default to integer if isId is true", async () => {
                const collections: CollectionConfig[] = [{
                    slug: "nums",
table: "nums",
name: "Nums",
properties: { n_id: { type: "number",
isId: true } }
                }];
                const result = await generateSchema(collections);
                expect(cleanSchema(result)).toContain("n_id: integer(\"n_id\").primaryKey()");
            });

            it("should respect exact columnType overrides and replace baseType", async () => {
                const collections: CollectionConfig[] = [{
                    slug: "numbers",
                    table: "numbers",
                    name: "Numbers",
                    properties: {
                        n_int: { type: "number",
columnType: "integer" },
                        n_real: { type: "number",
columnType: "real" },
                        n_dp: { type: "number",
columnType: "double precision" },
                        n_num: { type: "number",
columnType: "numeric" },
                        n_bigint: { type: "number",
columnType: "bigint" },
                        n_serial: { type: "number",
columnType: "serial" },
                        n_bigserial: { type: "number",
columnType: "bigserial" }
                    }
                }];
                const result = await generateSchema(collections);
                const cleanResult = cleanSchema(result);

                expect(cleanResult).toContain("n_int: integer(\"n_int\"),");
                expect(cleanResult).toContain("n_real: real(\"n_real\"),");
                expect(cleanResult).toContain("n_dp: doublePrecision(\"n_dp\"),");
                expect(cleanResult).toContain("n_num: numeric(\"n_num\"),");
                expect(cleanResult).toContain("n_serial: serial(\"n_serial\"),");
                // `bigint` and `bigserial` are the only pg-core builders that
                // require a config argument — without `mode`, drizzle cannot
                // know whether to return a `number` or a `bigint`, and the
                // emitted call does not typecheck.
                //
                // These two assertions previously pinned the output *without*
                // it, so the generator produced a `schema.generated.ts` that
                // would not compile. The file was hand-patched instead, and
                // every regeneration after that looked like an alarming diff
                // nobody wanted to ship — which is how a security fix to two
                // RLS policies sat unshipped in the repository.
                expect(cleanResult).toContain("n_bigint: bigint(\"n_bigint\", { mode: \"number\" }),");
                expect(cleanResult).toContain("n_bigserial: bigserial(\"n_bigserial\", { mode: \"number\" }),");
            });

            it("emits bigint columns that actually compile", async () => {
                // The property the two assertions above are really about, stated
                // directly: a generated bigint column must carry a `mode`. A
                // bare `bigint("x")` is a type error at the call site, so a
                // generated schema containing one cannot be built.
                const collections: CollectionConfig[] = [{
                    slug: "counters",
                    table: "counters",
                    name: "Counters",
                    properties: { hits: { type: "number", columnType: "bigint" } }
                }];
                const result = cleanSchema(await generateSchema(collections));

                expect(result).toMatch(/bigint\("hits", \{ mode: "number" \}\)/);
                expect(result).not.toMatch(/bigint\("hits"\)/);
            });

            it("should combine isId='increment' with columnType overrides safely", async () => {
                const collections: CollectionConfig[] = [{
                    slug: "nums",
table: "nums",
name: "Nums",
properties: { n_inc: { type: "number",
isId: "increment",
columnType: "bigint" } }
                }];
                const result = await generateSchema(collections);
                // The `mode` config survives the identity/primary-key chaining —
                // it is part of the builder call, not an afterthought appended
                // to it.
                expect(cleanSchema(result)).toContain("n_inc: bigint(\"n_inc\", { mode: \"number\" }).generatedByDefaultAsIdentity().primaryKey()");
            });

            it("should combine validation.unique with columnType override", async () => {
                const collections: CollectionConfig[] = [{
                    slug: "nums",
table: "nums",
name: "Nums",
properties: { n_uniq: { type: "number",
columnType: "real",
validation: { unique: true } } }
                }];
                const result = await generateSchema(collections);
                expect(cleanSchema(result)).toContain("n_uniq: real(\"n_uniq\").unique()");
            });
        });

        describe("Date Property", () => {
            it("should default to timestamp with timezone", async () => {
                const collections: CollectionConfig[] = [{
                    slug: "dates",
table: "dates",
name: "Dates",
properties: { d_def: { type: "date" } }
                }];
                const result = await generateSchema(collections);
                expect(cleanSchema(result)).toContain("d_def: timestamp(\"d_def\", { withTimezone: true, mode: 'string' })");
            });

            it("should respect date and time columnType overrides", async () => {
                const collections: CollectionConfig[] = [{
                    slug: "dates",
                    table: "dates",
                    name: "Dates",
                    properties: {
                        d_date: { type: "date",
columnType: "date" },
                        d_time: { type: "date",
columnType: "time" },
                        d_ts: { type: "date",
columnType: "timestamp" }
                    }
                }];
                const result = await generateSchema(collections);
                const cleanResult = cleanSchema(result);

                expect(cleanResult).toContain("d_date: date(\"d_date\", { mode: 'string' }),");
                expect(cleanResult).toContain("d_time: time(\"d_time\"),");
                expect(cleanResult).toContain("d_ts: timestamp(\"d_ts\", { withTimezone: true, mode: 'string' }),");
            });
        });

        describe("Map & Array Properties", () => {
            it("should default to jsonb", async () => {
                const collections: CollectionConfig[] = [{
                    slug: "json_data",
table: "json_data",
name: "JSON Data",
properties: {
                        arr_def: { type: "array" },
                        map_def: { type: "map" }
                    }
                }];
                const result = await generateSchema(collections);
                expect(cleanSchema(result)).toContain("arr_def: jsonb(\"arr_def\"),");
                expect(cleanSchema(result)).toContain("map_def: jsonb(\"map_def\")");
            });

            it("should respect json columnType overrides", async () => {
                const collections: CollectionConfig[] = [{
                    slug: "json_data",
                    table: "json_data",
                    name: "JSON Data",
                    properties: {
                        a_json: { type: "array",
columnType: "json" },
                        a_jsonb: { type: "array",
columnType: "jsonb" },
                        m_json: { type: "map",
columnType: "json" },
                        m_jsonb: { type: "map",
columnType: "jsonb" }
                    }
                }];
                const result = await generateSchema(collections);
                const cleanResult = cleanSchema(result);

                expect(cleanResult).toContain("a_json: json(\"a_json\"),");
                expect(cleanResult).toContain("a_jsonb: jsonb(\"a_jsonb\"),");
                expect(cleanResult).toContain("m_json: json(\"m_json\"),");
                expect(cleanResult).toContain("m_jsonb: jsonb(\"m_jsonb\")");
            });
        });
    });

    // ── RLS Policy Tests ────────────────────────────────────────────────

    describe("RLS policy generation", () => {
        it("should generate ownerField policy with USING and WITH CHECK for 'all'", async () => {
            // Scoped to the authored policy on purpose: every table also gets the
            // injected `default_admin_*` policies, and between them they always
            // emit a `using:` and a `withCheck:` somewhere in the file. Searching
            // the whole output for either clause therefore passes even if the
            // `for: "all"` policy emitted neither.
            const collections: CollectionConfig[] = [{
                slug: "notes",
                table: "notes",
                name: "Notes",
                properties: {
                    title: { type: "string" },
                    user_id: { type: "string",
validation: { required: true } }
                },
                securityRules: [
                    { operation: "all",
ownerField: "user_id" }
                ]
            }];

            const result = await generateSchema(collections);
            const allPolicy = result.split("pgPolicy(").find(p => p.includes('for: "all"'));
            expect(allPolicy).toBeDefined();
            expect(allPolicy).toContain('as: "permissive"');
            // 'all' needs both, and both must carry the owner predicate — a
            // `withCheck: sql\`false\`` fallback would still contain "withCheck:".
            expect(allPolicy).toContain("using: sql`(user_id)::text = rebase.uid()`");
            expect(allPolicy).toContain("withCheck: sql`(user_id)::text = rebase.uid()`");
        });

        it("should generate SELECT policy with only USING clause", async () => {
            const collections: CollectionConfig[] = [{
                slug: "notes",
                table: "notes",
                name: "Notes",
                properties: {
                    title: { type: "string" },
                    user_id: { type: "string" }
                },
                securityRules: [
                    { operation: "select",
ownerField: "user_id" }
                ]
            }];

            const result = await generateSchema(collections);
            expect(result).toContain('for: "select"');
            // Every SELECT policy (author + injected default read) has using and
            // no withCheck; the injected default WRITE policies do have withCheck.
            const selectBlocks = result.split("pgPolicy(").filter(b => b.includes('for: "select"'));
            expect(selectBlocks.length).toBeGreaterThan(0);
            for (const b of selectBlocks) {
                expect(b).toContain("using:");
                expect(b.split("})")[0]).not.toContain("withCheck:");
            }
        });

        it("should generate INSERT policy with only WITH CHECK clause", async () => {
            const collections: CollectionConfig[] = [{
                slug: "notes",
                table: "notes",
                name: "Notes",
                properties: {
                    title: { type: "string" },
                    user_id: { type: "string" }
                },
                securityRules: [
                    { operation: "insert",
ownerField: "user_id" }
                ]
            }];

            const result = await generateSchema(collections);
            expect(result).toContain('for: "insert"');
            expect(result).toContain("withCheck:");
            // The INSERT policy itself has no `using:` (the injected default
            // read policy legitimately does).
            const insertPolicy = result.split("pgPolicy(").find(p => p.includes('for: "insert"'));
            expect(insertPolicy).toBeDefined();
            expect(insertPolicy).not.toContain("using:");
        });

        it("should generate public access policy", async () => {
            const collections: CollectionConfig[] = [{
                slug: "articles",
                table: "articles",
                name: "Articles",
                properties: { title: { type: "string" } },
                securityRules: [
                    { operation: "select",
access: "public" }
                ]
            }];

            const result = await generateSchema(collections);
            expect(result).toContain("sql`true`");
            expect(result).toContain('for: "select"');
        });

        it("should generate roles-only policy", async () => {
            const collections: CollectionConfig[] = [{
                slug: "admin_data",
                table: "admin_data",
                name: "Admin Data",
                properties: { data: { type: "string" } },
                securityRules: [
                    { operation: "select",
roles: ["admin"] }
                ]
            }];

            const result = await generateSchema(collections);
            expect(result).toContain("string_to_array(rebase.roles(), ',') && ARRAY['admin']");
        });

        it("should safely handle complex sub-string roles overlapping like 'view' and 'viewer'", async () => {
            const collections: CollectionConfig[] = [{
                slug: "finance_data",
                table: "finance_data",
                name: "Finance Data",
                properties: { amount: { type: "number" } },
                securityRules: [
                    { operation: "select",
roles: ["view"] } // Should not match 'viewer'
                ]
            }];

            const result = await generateSchema(collections);
            // Before array change: rebase.roles() ~ 'view' would match 'viewer'
            // Now: array intersection prevents this
            expect(result).toContain("string_to_array(rebase.roles(), ',') && ARRAY['view']");
        });

        it("should securely handle multiple allowed roles", async () => {
            const collections: CollectionConfig[] = [{
                slug: "multi_role",
                table: "multi_role",
                name: "Multi Role",
                properties: { data: { type: "string" } },
                securityRules: [
                    { operation: "select",
roles: ["admin", "editor", "super-admin"] }
                ]
            }];

            const result = await generateSchema(collections);
            expect(result).toContain("string_to_array(rebase.roles(), ',') && ARRAY['admin','editor','super-admin']");
        });

        it("should combine roles with access: public", async () => {
            const collections: CollectionConfig[] = [{
                slug: "reports",
                table: "reports",
                name: "Reports",
                properties: { title: { type: "string" } },
                securityRules: [
                    { operation: "select",
roles: ["admin", "manager"],
access: "public" }
                ]
            }];

            const result = await generateSchema(collections);
            // Should be (true) AND (role check)
            expect(result).toContain("(true) AND (string_to_array(rebase.roles(), ',') && ARRAY['admin','manager'])");
        });

        it("should combine roles with ownerField", async () => {
            const collections: CollectionConfig[] = [{
                slug: "docs",
                table: "docs",
                name: "Docs",
                properties: {
                    title: { type: "string" },
                    user_id: { type: "string" }
                },
                securityRules: [
                    { operation: "select",
roles: ["editor"],
ownerField: "user_id" }
                ]
            }];

            const result = await generateSchema(collections);
            // Should combine owner check AND role check
            expect(result).toContain("rebase.uid()");
            expect(result).toContain("string_to_array(rebase.roles(), ',') && ARRAY['editor']");
            expect(result).toContain("AND");
        });

        it("should generate restrictive policy", async () => {
            const collections: CollectionConfig[] = [{
                slug: "orders",
                table: "orders",
                name: "Orders",
                properties: {
                    amount: { type: "number" },
                    is_locked: { type: "boolean" }
                },
                securityRules: [
                    { operation: "update",
mode: "restrictive",
using: "{is_locked} = false" }
                ]
            }];

            const result = await generateSchema(collections);
            expect(result).toContain('as: "restrictive"');
            expect(result).toContain("is_locked = false");
        });

        it("should generate raw SQL using clause with column references", async () => {
            const collections: CollectionConfig[] = [{
                slug: "posts",
                table: "posts",
                name: "Posts",
                properties: {
                    title: { type: "string" },
                    published_at: { type: "date" }
                },
                securityRules: [
                    { operation: "select",
using: "{published_at} > now() - interval '30 days'" }
                ]
            }];

            const result = await generateSchema(collections);
            expect(result).toContain("published_at > now() - interval '30 days'");
        });

        it("should generate raw SQL withCheck clause", async () => {
            const collections: CollectionConfig[] = [{
                slug: "items",
                table: "items",
                name: "Items",
                properties: {
                    name: { type: "string" },
                    user_id: { type: "string" },
                    status: { type: "string" }
                },
                securityRules: [
                    {
                        operation: "update",
                        using: "{user_id} = rebase.uid()",
                        withCheck: "{status} != 'archived' OR rebase.roles() ~ 'admin'"
                    }
                ]
            }];

            const result = await generateSchema(collections);
            expect(result).toContain("using:");
            expect(result).toContain("withCheck:");
            expect(result).toContain("user_id = rebase.uid()");
            expect(result).toContain("status != 'archived'");
        });

        it("should use custom policy names when provided", async () => {
            const collections: CollectionConfig[] = [{
                slug: "data",
                table: "data",
                name: "Data",
                properties: { value: { type: "string" } },
                securityRules: [
                    { name: "my_custom_policy",
operation: "select",
access: "public" }
                ]
            }];

            const result = await generateSchema(collections);
            expect(result).toContain('pgPolicy("my_custom_policy"');
        });

        it("should generate multiple policies for the same table", async () => {
            const collections: CollectionConfig[] = [{
                slug: "notes",
                table: "notes",
                name: "Notes",
                properties: {
                    title: { type: "string" },
                    user_id: { type: "string" },
                    is_locked: { type: "boolean" }
                },
                securityRules: [
                    { name: "admin_read",
operation: "select",
roles: ["admin"],
access: "public" },
                    { name: "owner_read",
operation: "select",
ownerField: "user_id" },
                    { name: "owner_write",
operation: "insert",
ownerField: "user_id" },
                    { name: "no_locked_update",
operation: "update",
mode: "restrictive",
using: "{is_locked} = false" }
                ]
            }];

            const result = await generateSchema(collections);
            expect(result).toContain('pgPolicy("admin_read"');
            expect(result).toContain('pgPolicy("owner_read"');
            expect(result).toContain('pgPolicy("owner_write"');
            expect(result).toContain('pgPolicy("no_locked_update"');
            expect(result).toContain('as: "restrictive"');
        });

        it("should enable RLS on every table even without any security rules", async () => {
            const collections: CollectionConfig[] = [{
                slug: "public_data",
                table: "public_data",
                name: "Public Data",
                properties: { title: { type: "string" } }
                // No securityRules defined — table should still have .enableRLS()
            }];

            const result = await generateSchema(collections);
            expect(result).toContain(".enableRLS()");
            // Locked by default: server-or-admin read + write baselines are
            // injected (user requests run under the restricted rebase_user role,
            // so RLS default-denies).
            expect(result).toContain('pgPolicy("public_data_default_admin_read"');
            expect(result).toContain('pgPolicy("public_data_default_admin_write_insert"');
            expect(result).toContain('pgPolicy("public_data_default_admin_write_update"');
            expect(result).toContain('pgPolicy("public_data_default_admin_write_delete"');
        });

        it("should enable RLS on tables that do have security rules", async () => {
            const collections: CollectionConfig[] = [{
                slug: "secure_data",
                table: "secure_data",
                name: "Secure Data",
                properties: { title: { type: "string" } },
                securityRules: [
                    { operation: "select",
access: "public" }
                ]
            }];

            const result = await generateSchema(collections);
            expect(result).toContain(".enableRLS()");
            expect(result).toContain("pgPolicy(");
        });

        it("should fall back to deny-all (sql`false`) when no USING clause can be generated", async () => {
            const collections: CollectionConfig[] = [{
                slug: "deny_test",
                table: "deny_test",
                name: "Deny Test",
                properties: { title: { type: "string" } },
                securityRules: [
                    { operation: "select" }
                    // No access, ownerField, or using — should produce sql`false`
                ]
            }];

            const result = await generateSchema(collections);
            expect(result).toContain("sql`false`");
        });

    });
});
// V2 improvements tests
describe("generateDrizzleSchema V2 improvements", () => {
    it("should generate role-based security rule", async () => {
        const collections: CollectionConfig[] = [{
            slug: "admin_data",
            table: "admin_data",
            name: "Admin Data",
            properties: { data: { type: "string" } },
            securityRules: [
                { operation: "select",
roles: ["admin"] }
            ]
        }];
        const result = await generateSchema(collections);
        expect(result).toContain("string_to_array(rebase.roles(), ',') && ARRAY['admin']");
    });
    it("should generate multiple policies from operations array", async () => {
        const collections: CollectionConfig[] = [{
            slug: "notes",
            table: "notes",
            name: "Notes",
            properties: {
                title: { type: "string" },
                user_id: { type: "string" }
            },
            securityRules: [
                { name: "owner_rw",
operations: ["select", "update"],
ownerField: "user_id" }
            ]
        }];
        const result = await generateSchema(collections);
        // Should generate two separate policies
        expect(result).toContain('pgPolicy("owner_rw_select"');
        expect(result).toContain('pgPolicy("owner_rw_update"');
        expect(result).toContain('for: "select"');
        expect(result).toContain('for: "update"');
    });
    it("should auto-generate names with operation suffix for operations array", async () => {
        const collections: CollectionConfig[] = [{
            slug: "items",
            table: "items",
            name: "Items",
            properties: { data: { type: "string" } },
            securityRules: [
                { operations: ["select", "delete"],
access: "public" }
            ]
        }];
        const result = await generateSchema(collections);
        expect(result).toContain('for: "select"');
        expect(result).toContain('for: "delete"');
    });
    it("should not append operation suffix when operations array has single element", async () => {
        const collections: CollectionConfig[] = [{
            slug: "items",
            table: "items",
            name: "Items",
            properties: { data: { type: "string" } },
            securityRules: [
                { name: "my_policy",
operations: ["select"],
access: "public" }
            ]
        }];
        const result = await generateSchema(collections);
        expect(result).toContain('pgPolicy("my_policy"');
        // Should NOT have _select suffix since only one operation
        expect(result).not.toContain('pgPolicy("my_policy_select"');
    });
    it("should generate correct clauses per operation in operations array", async () => {
        const collections: CollectionConfig[] = [{
            slug: "notes",
            table: "notes",
            name: "Notes",
            properties: {
                title: { type: "string" },
                user_id: { type: "string" }
            },
            securityRules: [
                { name: "owner",
operations: ["select", "insert"],
ownerField: "user_id" }
            ]
        }];
        const result = await generateSchema(collections);
        // SELECT should have USING only
        const selectPolicy = result.split("\n").find(l => l.includes("owner_select"));
        expect(selectPolicy).toContain("using:");
        expect(selectPolicy).not.toContain("withCheck:");
        // INSERT should have WITH CHECK only
        const insertPolicy = result.split("\n").find(l => l.includes("owner_insert"));
        expect(insertPolicy).toContain("withCheck:");
        expect(insertPolicy).not.toContain("using:");
    });
    it("operations array takes precedence over singular operation", async () => {
        const collections: CollectionConfig[] = [{
            slug: "items",
            table: "items",
            name: "Items",
            properties: { data: { type: "string" } },
            securityRules: [
                { name: "test",
operation: "delete",
operations: ["select", "insert"],
access: "public" }
            ]
        }];
        const result = await generateSchema(collections);
        // operations[] should win for the author rule — select+insert, no delete.
        // (A default_admin_write delete policy exists separately.)
        expect(result).toContain('pgPolicy("test_select"');
        expect(result).toContain('pgPolicy("test_insert"');
        expect(result).not.toContain('pgPolicy("test_delete"');
    });
    it("should handle roles combined with using true for unfiltered access", async () => {
        const collections: CollectionConfig[] = [{
            slug: "reports",
            table: "reports",
            name: "Reports",
            properties: { title: { type: "string" } },
            securityRules: [
                { operation: "select",
roles: ["admin"],
using: "true" }
            ]
        }];
        const result = await generateSchema(collections);
        // Should be (true) AND (role check) — same effect as access: "public" + roles
        expect(result).toContain("(true) AND (string_to_array(rebase.roles(), ',') && ARRAY['admin'])");
    });
    it("should use pgRoles instead of default 'public' when specified", async () => {
        const collections: CollectionConfig[] = [{
            slug: "tenant_data",
            table: "tenant_data",
            name: "Tenant Data",
            properties: { data: { type: "string" } },
            securityRules: [
                { operation: "select",
access: "public",
pgRoles: ["app_role", "service_role"] }
            ]
        }];
        const result = await generateSchema(collections);
        expect(result).toContain('to: ["app_role", "service_role"]');
        // Only the injected default read policy targets public.
        const authorPolicy = result.split("pgPolicy(").find(p => p.includes("tenant_data_select"));
        expect(authorPolicy).toBeDefined();
        expect(authorPolicy).not.toContain('to: ["public"]');
    });
    it("should default to 'public' pgRole when pgRoles is not specified", async () => {
        const collections: CollectionConfig[] = [{
            slug: "default_data",
            table: "default_data",
            name: "Default Data",
            properties: { data: { type: "string" } },
            securityRules: [
                { operation: "select",
access: "public" }
            ]
        }];
        const result = await generateSchema(collections);
        expect(result).toContain('to: ["public"]');
    });
});

describe("generateDrizzleSchema Deterministic Policies", () => {
    it("should generate the same policy name hash for identically configured rules", async () => {
        const collections1: CollectionConfig[] = [{
            slug: "test1",
            table: "test_hash",
            name: "Test",
            properties: { data: { type: "string" } },
            securityRules: [
                { operation: "select",
roles: ["admin", "user"] }
            ]
        }];

        const collections2: CollectionConfig[] = [{
            slug: "test2",
            table: "test_hash", // Same table name
            name: "Test",
            properties: { data: { type: "string" } },
            securityRules: [
                { operation: "select",
roles: ["admin", "user"] }
            ]
        }];

        const result1 = await generateSchema(collections1);
        const result2 = await generateSchema(collections2);

        // Extract the generated policy name, which should look like pgPolicy("test_hash_select_<hash>"
        const match1 = result1.match(/pgPolicy\("test_hash_select_([a-f0-9]{7})"/);
        const match2 = result2.match(/pgPolicy\("test_hash_select_([a-f0-9]{7})"/);

        expect(match1).not.toBeNull();
        expect(match2).not.toBeNull();
        expect(match1![1]).toEqual(match2![1]);
    });

    it("should generate the exact same SQL output regardless of array order in configuration", async () => {
        const collectionsUnsorted: CollectionConfig[] = [{
            slug: "test_order",
            table: "test_order",
            name: "Test",
            properties: { data: { type: "string" } },
            securityRules: [
                {
                    operation: "select",
                    roles: ["user", "admin", "manager"], // Unsorted roles
                    pgRoles: ["service_role", "app_role"] // Unsorted pgRoles
                }
            ]
        }];

        const collectionsSorted: CollectionConfig[] = [{
            slug: "test_order",
            table: "test_order",
            name: "Test",
            properties: { data: { type: "string" } },
            securityRules: [
                {
                    operation: "select",
                    roles: ["admin", "manager", "user"], // Sorted roles
                    pgRoles: ["app_role", "service_role"] // Sorted pgRoles
                }
            ]
        }];

        const resultUnsorted = await generateSchema(collectionsUnsorted);
        const resultSorted = await generateSchema(collectionsSorted);

        // The policy names should match because the configuration arrays should be sorted before hashing
        const matchUnsorted = resultUnsorted.match(/pgPolicy\("test_order_select_([a-f0-9]{7})"/);
        const matchSorted = resultSorted.match(/pgPolicy\("test_order_select_([a-f0-9]{7})"/);

        expect(matchUnsorted).not.toBeNull();
        expect(matchSorted).not.toBeNull();
        expect(matchUnsorted![1]).toEqual(matchSorted![1]);

        // The whole file, not just the policy name: the name hash is sorted
        // independently of the SQL body and the `to:` list, so matching hashes
        // prove nothing about whether the emitted policy is order-stable.
        // Two configs differing only in array order must generate byte-identical
        // schemas, or a `db push` would see spurious drift on every reorder.
        expect(resultUnsorted).toEqual(resultSorted);
        expect(resultUnsorted).toContain("string_to_array(rebase.roles(), ',') && ARRAY['admin','manager','user']");
        expect(resultUnsorted).toContain('to: ["app_role", "service_role"]');
    });

    // The writer sorts by slug before generating; `rebase doctor` regenerates
    // from whatever order the loader's `readdirSync` returned and diffs the
    // result against the file. While the sort lived only in the writer, a
    // project whose filename order differed from its slug order was reported
    // stale forever, and the fix it printed rewrote the file unchanged.
    it("should generate the exact same schema regardless of the order of the collections", async () => {
        const articles: CollectionConfig = {
            slug: "articles",
            table: "articles",
            name: "Articles",
            properties: { title: { type: "string" } }
        };
        const authors: CollectionConfig = {
            slug: "authors",
            table: "authors",
            name: "Authors",
            properties: { name: { type: "string" } }
        };

        expect(await generateSchema([authors, articles])).toEqual(await generateSchema([articles, authors]));
    });
});

describe("generateDrizzleSchema ID Generation", () => {
    const cleanSchema = (schema: string) => {
        return schema
            .replace(/\/\/.*$/gm, "")
            .replace(/\/\*[\s\S]*?\*\//g, "")
            .replace(/\n{2,}/g, "\n")
            .replace(/\s+/g, " ")
            .trim();
    };

    it("should generate a UUID primary key when isId is 'uuid'", async () => {
        const collections: CollectionConfig[] = [{
            slug: "items",
            table: "items",
            name: "Items",
            properties: {
                custom_id: { type: "string",
isId: "uuid" }
            }
        }];
        const result = await generateSchema(collections);
        const cleanResult = cleanSchema(result);

        expect(cleanResult).toContain("custom_id: uuid(\"custom_id\").primaryKey().defaultRandom()");
    });

    // Not `serial`, despite the old name: the generator emits an IDENTITY
    // column. The two are different DDL — `serial` creates an owned sequence
    // with a column default, identity is a column property — so a name
    // promising `serial` would send a reader looking for the wrong thing.
    it("should generate an identity primary key when isId is 'increment'", async () => {
        const collections: CollectionConfig[] = [{
            slug: "tickets",
            table: "tickets",
            name: "Tickets",
            properties: {
                ticket_id: { type: "number",
isId: "increment" }
            }
        }];
        const result = await generateSchema(collections);
        const cleanResult = cleanSchema(result);

        expect(cleanResult).toContain("ticket_id: integer(\"ticket_id\").generatedByDefaultAsIdentity().primaryKey()");
    });

    it("should generate a custom SQL primary key when isId is a sql string", async () => {
        const collections: CollectionConfig[] = [{
            slug: "events",
            table: "events",
            name: "Events",
            properties: {
                event_id: { type: "string",
isId: "sql`gen_random_uuid()`" }
            }
        }];
        const result = await generateSchema(collections);
        const cleanResult = cleanSchema(result);

        expect(cleanResult).toContain("event_id: text(\"event_id\").primaryKey().default(sql`gen_random_uuid()`)");
    });

    it("should generate a normal text primary key when isId is simply true", async () => {
        const collections: CollectionConfig[] = [{
            slug: "users",
            table: "users",
            name: "Users",
            properties: {
                user_name: { type: "string",
isId: true }
            }
        }];
        const result = await generateSchema(collections);
        const cleanResult = cleanSchema(result);

        expect(cleanResult).toContain("user_name: text(\"user_name\").primaryKey()");
    });
});

// ── columnName tests ────────────────────────────────────────────────────
describe("generateDrizzleSchema columnName support", () => {
    const cleanSchema = (schema: string) => {
        return schema
            .replace(/\/\/.*$/gm, "")
            .replace(/\/\*[\s\S]*?\*\//g, "")
            .replace(/\n{2,}/g, "\n")
            .replace(/\s+/g, " ")
            .trim();
    };

    it("should use explicit columnName as the SQL column name instead of deriving from the property key", async () => {
        const collections: CollectionConfig[] = [{
            slug: "billing",
            table: "company_billing_config",
            name: "Billing",
            properties: {
                employee_number_140a: {
                    type: "string",
                    name: "Employee Number 140a",
                    columnName: "employee_number_140a"
                },
                contract_number_140a: {
                    type: "string",
                    name: "Contract Number 140a",
                    columnName: "contract_number_140a"
                }
            }
        }];

        const result = await generateSchema(collections);
        const cleanResult = cleanSchema(result);

        // Must use the exact columnName, NOT toSnakeCase(propKey) which would produce "employee_number_140_a"
        expect(cleanResult).toContain('employee_number_140a: text("employee_number_140a")');
        expect(cleanResult).toContain('contract_number_140a: text("contract_number_140a")');

        // Must NOT contain the broken snake_case version
        expect(cleanResult).not.toContain("employee_number_140_a");
        expect(cleanResult).not.toContain("contract_number_140_a");
    });

    it("should fall back to toSnakeCase when columnName is not set (manually-authored collections)", async () => {
        const collections: CollectionConfig[] = [{
            slug: "products",
            table: "products",
            name: "Products",
            properties: {
                productName: {
                    type: "string",
                    name: "Product Name"
                    // No columnName — should derive from key
                }
            }
        }];

        const result = await generateSchema(collections);
        const cleanResult = cleanSchema(result);

        // JS key stays camelCase, SQL column name gets snake_cased
        expect(cleanResult).toContain('productName: text("product_name")');
    });

    it("should handle mixed properties — some with columnName, some without", async () => {
        const collections: CollectionConfig[] = [{
            slug: "config",
            table: "app_config",
            name: "Config",
            properties: {
                // Introspected: has explicit columnName
                fee_number_140a: {
                    type: "string",
                    name: "Fee Number",
                    columnName: "fee_number_140a"
                },
                // Manually added: no columnName
                displayName: {
                    type: "string",
                    name: "Display Name"
                }
            }
        }];

        const result = await generateSchema(collections);
        const cleanResult = cleanSchema(result);

        // Introspected prop uses exact columnName
        expect(cleanResult).toContain('fee_number_140a: text("fee_number_140a")');
        // Manual prop: JS key stays camelCase, SQL column gets snake_cased
        expect(cleanResult).toContain('displayName: text("display_name")');
    });

    it("should use columnName for all property types, not just strings", async () => {
        const collections: CollectionConfig[] = [{
            slug: "metrics",
            table: "metrics",
            name: "Metrics",
            properties: {
                count_v2: {
                    type: "number",
                    name: "Count V2",
                    columnName: "count_v2"
                },
                is_active_v2: {
                    type: "boolean",
                    name: "Is Active V2",
                    columnName: "is_active_v2"
                },
                created_at_v2: {
                    type: "date",
                    name: "Created At V2",
                    columnName: "created_at_v2"
                },
                metadata_v2: {
                    type: "map",
                    name: "Metadata V2",
                    columnName: "metadata_v2"
                }
            }
        }];

        const result = await generateSchema(collections);
        const cleanResult = cleanSchema(result);

        expect(cleanResult).toContain('count_v2: numeric("count_v2")');
        expect(cleanResult).toContain('is_active_v2: boolean("is_active_v2")');
        expect(cleanResult).toContain('created_at_v2: timestamp("created_at_v2"');
        expect(cleanResult).toContain('metadata_v2: jsonb("metadata_v2")');
    });

    it("should reproduce and prevent the medmot bug: digit+letter column names", async () => {
        // This is the exact scenario from the medmot project that caused the production failure
        const collections: CollectionConfig[] = [{
            slug: "company_billing_config",
            table: "company_billing_config",
            name: "Company Billing Config",
            properties: {
                employee_number_140a: { type: "string",
name: "Employee Number",
columnName: "employee_number_140a" },
                contract_number_140a: { type: "string",
name: "Contract Number",
columnName: "contract_number_140a" },
                amount: { type: "number",
name: "Amount" },
                id: { type: "number",
name: "ID",
isId: "increment" },
                service_provider_140a: { type: "string",
name: "Service Provider",
columnName: "service_provider_140a" },
                internal_area_code_140a: { type: "string",
name: "Internal Area Code",
columnName: "internal_area_code_140a" },
                fee_number_140a: { type: "string",
name: "Fee Number",
columnName: "fee_number_140a" },
                receiver_market_participant_140a: { type: "string",
name: "Receiver Market Participant",
columnName: "receiver_market_participant_140a" },
                employee_value_number_140a: { type: "string",
name: "Employee Value Number",
columnName: "employee_value_number_140a" },
                sender_market_participant_140a: { type: "string",
name: "Sender Market Participant",
columnName: "sender_market_participant_140a" },
                processing_indicator_140a: { type: "string",
name: "Processing Indicator",
columnName: "processing_indicator_140a" },
                insurance_id_140a: { type: "string",
name: "Insurance ID",
columnName: "insurance_id_140a" },
                company_id: { type: "number",
name: "Company ID" }
            }
        }];

        const result = await generateSchema(collections);

        // Every _140a column must stay _140a, not become _140_a
        const brokenPattern = /_140_a/;
        expect(result).not.toMatch(brokenPattern);

        // Spot-check a few exact columns
        expect(result).toContain('"employee_number_140a"');
        expect(result).toContain('"contract_number_140a"');
        expect(result).toContain('"service_provider_140a"');
        expect(result).toContain('"insurance_id_140a"');
    });

    describe("generateDrizzleSchema autoValue date properties", () => {

        it("should add .default(sql`now()`) for on_create autoValue", async () => {
            const collections: CollectionConfig[] = [
                {
                    slug: "articles",
                    table: "articles",
                    name: "Articles",
                    properties: {
                        title: { type: "string" },
                        created_at: {
                            type: "date",
                            autoValue: "on_create"
                        }
                    }
                }
            ];

            const result = await generateSchema(collections, true);

            // on_create should produce .default(sql`now()`)
            expect(result).toContain(".default(sql`now()`)");
            // No $onUpdate or triggers — on_update logic lives in the backend driver
            expect(result).not.toContain(".$onUpdate");
            expect(result).not.toContain("CREATE OR REPLACE TRIGGER");
            expect(result).not.toContain("CREATE OR REPLACE FUNCTION");
        });

        it("should add .default(sql`now()`) for on_update autoValue (INSERT default only)", async () => {
            const collections: CollectionConfig[] = [
                {
                    slug: "articles",
                    table: "articles",
                    name: "Articles",
                    properties: {
                        title: { type: "string" },
                        updated_at: {
                            type: "date",
                            autoValue: "on_update"
                        }
                    }
                }
            ];

            const result = await generateSchema(collections, true);

            // on_update should produce .default(sql`now()`) for initial INSERT value
            expect(result).toContain(".default(sql`now()`)");
            // No $onUpdate or triggers — update logic is handled by the backend driver
            expect(result).not.toContain(".$onUpdate");
            expect(result).not.toContain("CREATE OR REPLACE TRIGGER");
        });

        it("should not modify date columns without autoValue", async () => {
            const collections: CollectionConfig[] = [
                {
                    slug: "events",
                    table: "events",
                    name: "Events",
                    properties: {
                        name: { type: "string" },
                        event_date: { type: "date" }
                    }
                }
            ];

            const result = await generateSchema(collections, true);

            // A plain date should NOT have any autoValue-related modifiers
            expect(result).not.toContain(".default(sql`now()`)");
            expect(result).not.toContain(".$onUpdate");
        });

        it("should handle both on_create and on_update in the same collection", async () => {
            const collections: CollectionConfig[] = [
                {
                    slug: "posts",
                    table: "posts",
                    name: "Posts",
                    properties: {
                        title: { type: "string" },
                        created_at: {
                            type: "date",
                            autoValue: "on_create"
                        },
                        updated_at: {
                            type: "date",
                            autoValue: "on_update"
                        }
                    }
                }
            ];

            const result = await generateSchema(collections, true);

            // Both should get .default(sql`now()`) for INSERT defaults
            expect(result).toMatch(/created_at:.*\.default\(sql`now\(\)`\)/);
            expect(result).toMatch(/updated_at:.*\.default\(sql`now\(\)`\)/);
            // No $onUpdate or triggers
            expect(result).not.toContain(".$onUpdate");
            expect(result).not.toContain("CREATE OR REPLACE TRIGGER");
        });

        it("should handle on_create with date columnType", async () => {
            const collections: CollectionConfig[] = [
                {
                    slug: "logs",
                    table: "logs",
                    name: "Logs",
                    properties: {
                        message: { type: "string" },
                        log_date: {
                            type: "date",
                            columnType: "date",
                            autoValue: "on_create"
                        }
                    }
                }
            ];

            const result = await generateSchema(collections, true);

            // Should use date() column with the default
            expect(result).toContain("date(\"log_date\"");
            expect(result).toContain(".default(sql`now()`)");
        });
    });
});

/**
 * The generated schema file is TypeScript, assembled by concatenation, from
 * names and values nobody promised would be identifier-shaped.
 *
 * A Postgres identifier only has to be quoted, so `order` and `full name` are
 * ordinary column names; in a `baas` project the property keys *are* the
 * database's column names. And an enum value went into the file between single
 * quotes, where an apostrophe — `O'Brien`, `Women's` — is not an edge case but
 * a Tuesday.
 *
 * Parsing is the assertion. Every substring the other tests look for was
 * present in the broken output too.
 */
describe("the generated schema parses for names Postgres allows", () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ts = require("typescript");

    function syntaxErrors(source: string): string[] {
        const file = ts.createSourceFile("schema.generated.ts", source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
        return (file as unknown as { parseDiagnostics: Array<{ code: number; messageText: unknown }> })
            .parseDiagnostics
            .map(d => `TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`);
    }

    it("for an enum value containing an apostrophe", async () => {
        const collections: CollectionConfig[] = [{
            slug: "people",
            table: "people",
            name: "People",
            properties: {
                id: { type: "string", isId: "uuid" },
                surname: { type: "string", enum: ["O'Brien", "D'Angelo", "Smith"] }
            }
        } as unknown as CollectionConfig];

        const schema = await generateSchema(collections);
        expect(syntaxErrors(schema)).toEqual([]);
        expect(schema).toContain('"O\'Brien"');
    });

    it("for column names that are not JavaScript identifiers", async () => {
        const collections: CollectionConfig[] = [{
            slug: "things",
            table: "things",
            name: "Things",
            properties: {
                id: { type: "string", isId: "uuid" },
                "full name": { type: "string" },
                "order": { type: "number" },
                "2fa_enabled": { type: "boolean" }
            }
        } as unknown as CollectionConfig];

        const schema = await generateSchema(collections);
        expect(syntaxErrors(schema)).toEqual([]);
        // The column keeps its real name — it is what the database is asked for.
        expect(schema).toContain('"full name"');
    });

    it("for a relation whose foreign key is not a JavaScript identifier", async () => {
        const authors: CollectionConfig = {
            slug: "authors",
            table: "authors",
            name: "Authors",
            properties: { id: { type: "string", isId: "uuid" } }
        } as unknown as CollectionConfig;

        const posts: CollectionConfig = {
            slug: "posts",
            table: "posts",
            name: "Posts",
            properties: {
                id: { type: "string", isId: "uuid" },
                author: {
                    type: "relation",
                    relation: { kind: "belongsTo", target: () => authors, localKey: "author id" }
                }
            }
        } as unknown as CollectionConfig;

        const schema = await generateSchema([posts, authors]);
        expect(syntaxErrors(schema)).toEqual([]);
    });
});
