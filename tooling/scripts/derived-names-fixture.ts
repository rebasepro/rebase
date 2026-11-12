/**
 * The reference project behind `contracts/derived-names.txt`.
 *
 * `tooling/scripts/derived-names.mts` renders every identifier these collections
 * make the two schema producers (`db push` and the boot) write, and
 * `pnpm check:derived-names` holds that surface frozen. The same collections
 * are provisioned once per release by
 * `packages/server-postgres/scripts/record-project-snapshot.mts` to build the
 * aged-project corpus, and they are one of the corpus sets
 * `packages/server-postgres/test/plan-golden.test.ts` records every rendered
 * schema output for — which is why they live in a module of their own rather
 * than inside the gate script: jest cannot import an ESM script that awaits at
 * the top level, and three consumers must read the very same objects.
 *
 * Append-only, in the same sense the baseline is: removing a collection from
 * here removes whatever it was the only thing exercising, and the baseline
 * shrinks by exactly as much without anything failing. Add cases; do not prune.
 */
/**
 * Loose on purpose — this is a fixture, not a consumer of the config types. It
 * carries shapes the types no longer admit (`access: "authenticated"`, bare
 * string `enum` arrays) because projects in the field still hold them and the
 * planner still names what they produce.
 */
type Fixture = Record<string, unknown>;

/**
 * What the fixture project's database gives Rebase leave to install.
 *
 * `vector` is here so the extension stays *rendered*. It is opt-in
 * (`DatabaseOptions.extensions`), and a fixture that declined it would emit no
 * `CREATE EXTENSION` from either producer — quietly dropping a frozen
 * identifier from the baseline, which is the one thing this file exists to
 * prevent. The fixture opts into everything, for the same reason it declares
 * every naming rule at once.
 */
export const FIXTURE_DATABASE_EXTENSIONS = ["vector"] as const;

const uuidId = { id: { name: "ID", type: "string", isId: "uuid" } };
const serialId = { id: { name: "ID", type: "number", isId: "increment" } };

/** Every operation, so the hashed policy name of each is pinned. */
const allOperations = [
    { operation: "select", access: "public" },
    { operation: "insert", access: "authenticated" },
    { operation: "update", access: "authenticated" },
    { operation: "delete", access: "authenticated" }
];

/** Irregular plural: `categories` → `category_id`, and `categorie_id` before 0.13. */
const categories: Fixture = {
    slug: "categories",
    table: "categories",
    name: "Categories",
    securityRules: allOperations,
    properties: { ...uuidId, name: { type: "string" } }
};

/** The `ss` guard: a trailing double-s is never a plural marker. */
const addresses: Fixture = {
    slug: "addresses",
    table: "addresses",
    name: "Addresses",
    properties: { ...uuidId, street: { type: "string" } }
};

/** An irregular that `singular()` handles and a trailing-s chop never could. */
const children: Fixture = {
    slug: "children",
    table: "children",
    name: "Children",
    properties: { ...uuidId, nickname: { type: "string" } }
};

/** The acronym case: snake-casing before singularizing produced `ur_l_id`. */
const urls: Fixture = {
    slug: "URLs",
    table: "urls",
    name: "URLs",
    properties: { ...uuidId, href: { type: "string" } }
};

/** `-es` plural, and a numeric key, so junction column types are pinned too. */
const statuses: Fixture = {
    slug: "statuses",
    table: "statuses",
    name: "Statuses",
    properties: { ...serialId, label: { type: "string" } }
};

/** A regular plural — the common case, and the one that must never move. */
const tags: Fixture = {
    slug: "tags",
    table: "tags",
    name: "Tags",
    properties: { ...serialId, label: { type: "string" } }
};

/**
 * The centre of the fixture: one collection carrying every relation kind, an
 * enum, a camelCase property, and a name long enough to truncate.
 */
const products: Fixture = {
    slug: "products",
    table: "products",
    name: "Products",
    securityRules: allOperations,
    properties: {
        ...uuidId,
        title: { type: "string" },
        // camelCase → snake_case is a derivation like any other.
        createdBy: { type: "string" },
        // Enum type names are derived from table + column.
        status: { type: "string", enum: ["draft", "published", "archived"] },
        // belongsTo derives from the RELATION name (usually singular already).
        primaryCategory: {
            type: "relation",
            relation: { kind: "belongsTo", target: () => categories, relationName: "primaryCategory" }
        },
        // manyToMany derives from the endpoint SLUG, which is plural — this is
        // the shape the 0.13 singularization actually moved.
        categories: {
            type: "relation",
            relation: { kind: "manyToMany", target: () => categories, relationName: "categories" }
        },
        tags: {
            type: "relation",
            relation: { kind: "manyToMany", target: () => tags, relationName: "tags" }
        },
        // A numeric-keyed endpoint, so the junction column's TYPE is pinned as
        // well as its name.
        statuses: {
            type: "relation",
            relation: { kind: "manyToMany", target: () => statuses, relationName: "statuses" }
        },
        // A plain reference, which names a column the same way and is a
        // different code path to get there.
        supplier: { type: "reference", path: "suppliers" },
        // A vector column, so the ANN index name is frozen like any other
        // derived identifier. 1536 is within what pgvector can index; a wider
        // one creates no index and would therefore name nothing to freeze.
        embedding: { type: "vector", dimensions: 1536 },
        // A date and an array, carried so the `indexes` block below can fire a
        // DESC key, a BRIN and a GIN. Neither derives a name on its own.
        createdAt: { type: "date" },
        keywords: { type: "array", columnType: "text[]" }
    },
    /**
     * Declared indexes, chosen so every part of the fingerprint moves at least
     * one name.
     *
     * The two `created_at` entries are the point of the exercise: same table,
     * same column, same readable head, two different indexes — one partial,
     * one BRIN. Under a readable naming scheme they would collide, and because
     * `CREATE INDEX IF NOT EXISTS` matches on the name, the second would
     * silently never be created. Here they differ in the hash alone.
     */
    indexes: [
        { on: ["status"], reason: "admin list filters by status" },
        { on: ["status", { prop: "createdAt", direction: "desc" }], reason: "status feed, newest first" },
        { on: ["createdAt"], where: { prop: "status", op: "=", value: "published" }, reason: "public feed is published-only" },
        { on: ["createdAt"], using: "brin", reason: "append-only scan over the whole table" },
        { on: ["title"], include: ["status"], reason: "index-only scan for the status column" },
        { on: ["keywords"], using: "gin", reason: "keyword containment search" },
        // A belongsTo resolves to its foreign key column, so this freezes
        // `primary_category_id` — not `primary_category`.
        { on: ["primaryCategory", "status"], unique: true, reason: "one product per category and status" }
    ]
};

/**
 * Overrides. Nothing in this collection may EVER move: every name here was
 * written by the author, and a naming change that reaches these is a bug in the
 * override plumbing, not a derivation change.
 */
const pinned: Fixture = {
    slug: "pinned_names",
    table: "pinned_names",
    name: "Pinned",
    properties: {
        ...uuidId,
        renamedColumn: { type: "string", columnName: "explicit_column_name" },
        category: {
            type: "relation",
            relation: {
                kind: "belongsTo",
                target: () => categories,
                relationName: "category",
                localKey: "explicit_category_key"
            }
        }
    }
};

/** A non-public schema, because the schema qualifies every name downstream. */
const inventory: Fixture = {
    slug: "inventory_items",
    table: "inventory_items",
    name: "Inventory",
    schema: "shop",
    securityRules: allOperations,
    properties: { ...uuidId, sku: { type: "string" } },
    // The schema is in the fingerprint, so the identical declaration on a
    // `public` table hashes differently. Nothing else in the fixture proves it.
    indexes: [{ on: ["sku"], reason: "warehouse lookup by SKU" }]
};

/**
 * 63 bytes is where Postgres truncates an identifier, silently. A constraint
 * name is `<table>_<column>_fkey`, so a long table plus a long column is how you
 * reach it — and two names that truncate to the same string collide in the
 * catalogue while looking distinct in the code.
 */
const longName: Fixture = {
    slug: "extremely_long_collection_slug_for_identifier_truncation",
    table: "extremely_long_collection_slug_for_identifier_truncation",
    name: "Long",
    properties: {
        ...uuidId,
        correspondingOrganizationalUnit: {
            type: "relation",
            relation: {
                kind: "belongsTo",
                target: () => categories,
                relationName: "correspondingOrganizationalUnit"
            }
        }
    },
    /**
     * The truncation case. A 56-byte table plus a 36-byte column is far over
     * 63, so the readable head is cut — and the `_ix_` tag and the hash, which
     * are what make the name recognisable and unique, must both survive.
     *
     * The baseline records the answer. Compare it against the `_fkey` line for
     * this same collection, which is frozen with its suffix truncated away.
     */
    indexes: [{ on: ["correspondingOrganizationalUnit"], reason: "join back to the owning unit" }]
};

const suppliers: Fixture = {
    slug: "suppliers",
    table: "suppliers",
    name: "Suppliers",
    properties: { ...uuidId, name: { type: "string" } }
};

// ── The derivations the first fixture never fired ────────────────────────────
//
// Added before the Postgres-first refactor touched the planner, so that every
// name below was recorded from the code as it was, and the refactor can never
// "freeze" a moved one. Each collection fires one family of derived names and
// stands alone: none of them relates to a collection above, so adding them
// added lines to the baseline and changed none.

/** `autoValue: "on_update"` → the `<table>_<column>_touch` trigger and `rebase.set_updated_at()`. */
const touchedRows: Fixture = {
    slug: "touched_rows",
    table: "touched_rows",
    name: "Touched rows",
    properties: {
        ...uuidId,
        label: { type: "string" },
        updatedAt: { type: "date", autoValue: "on_update" }
    }
};

/**
 * Multi-tenancy, claim form: the restrictive `<table>_tenant_scope` policy, the
 * `<table>_keep_tenant` trigger and `rebase.keep_tenant()`, and the tenant
 * column's fingerprinted index.
 */
const tenantDocuments: Fixture = {
    slug: "tenant_documents",
    table: "tenant_documents",
    name: "Tenant documents",
    properties: {
        ...uuidId,
        orgId: { type: "string", columnName: "org_id" },
        title: { type: "string" }
    },
    tenant: { field: "orgId", from: { claim: "org_id" } }
};

/**
 * A `search` block with fuzzy matching: the generated `search_vector` and
 * `search_vector_text` columns, the `<table>_search_vector_gin` and
 * `<table>_search_vector_text_trgm` indexes, the extensions and the helpers.
 */
const searchedArticles: Fixture = {
    slug: "searched_articles",
    table: "searched_articles",
    name: "Searched articles",
    properties: {
        ...uuidId,
        headline: { type: "string" },
        body: { type: "string" }
    },
    search: { fields: ["headline", "body"], fuzzy: true }
};

/**
 * An auth table: the appended auth columns, the injected
 * `<table>_default_self_read` and the restrictive `<table>_require_admin_write_<op>`.
 */
const accounts: Fixture = {
    slug: "accounts",
    table: "accounts",
    name: "Accounts",
    auth: true,
    properties: {
        ...uuidId,
        email: { type: "string", validation: { required: true, unique: true } }
    }
};

/**
 * A materialized view: its rows under `<view>_rebase_rows`, the unique
 * `<view>_rebase_id` index (not cut to 63 bytes — see `render-ddl.ts`), and the
 * gate view under the collection's own name.
 */
const productRollups: Fixture = {
    slug: "product_rollups",
    table: "product_rollups",
    name: "Product rollups",
    view: { query: "SELECT id, title FROM public.products", materialized: true },
    properties: {
        id: { type: "string", isId: true },
        title: { type: "string" }
    }
};

/** A plain view: named as its table, created `security_invoker`. */
const productTitles: Fixture = {
    slug: "product_titles",
    table: "product_titles",
    name: "Product titles",
    view: { query: "SELECT id, title FROM public.products" },
    properties: {
        id: { type: "string", isId: true },
        title: { type: "string" }
    }
};

/**
 * A junction carrying a payload: the pivot enum is `<junction>_<column>`, and a
 * pivot `on_update` date puts a touch trigger on a table no collection declares.
 */
const players: Fixture = {
    slug: "players",
    table: "players",
    name: "Players",
    properties: { ...serialId, handle: { type: "string" } }
};
const teams: Fixture = {
    slug: "teams",
    table: "teams",
    name: "Teams",
    properties: {
        ...uuidId,
        name: { type: "string" },
        players: {
            type: "relation",
            relation: {
                kind: "manyToMany",
                target: () => players,
                relationName: "players",
                through: {
                    properties: {
                        position: { type: "string", enum: ["keeper", "defender", "forward"] },
                        changedAt: { type: "date", autoValue: "on_update" }
                    }
                }
            }
        }
    }
};

/**
 * A `reference` into an integer-keyed table, required and renamed: the column
 * is the property's own (no `_id`), the constraint `<table>_<column>_fkey`, and
 * no index is derived for it. (`products.supplier` above is the plain case.)
 */
const shelves: Fixture = {
    slug: "shelves",
    table: "shelves",
    name: "Shelves",
    properties: { ...serialId, label: { type: "string" } }
};
const books: Fixture = {
    slug: "books",
    table: "books",
    name: "Books",
    properties: {
        ...uuidId,
        title: { type: "string" },
        shelf: { type: "reference", path: "shelves", columnName: "shelf_ref", validation: { required: true } }
    }
};

/** Several `isId` properties are one key: one unnamed `PRIMARY KEY (locale, key)`. */
const translations: Fixture = {
    slug: "translations",
    table: "translations",
    name: "Translations",
    properties: {
        locale: { type: "string", isId: true },
        key: { type: "string", isId: true },
        value: { type: "string" }
    }
};

/** No `isId` and no `id`: the implicit `id TEXT` key, planned at position 0. */
const looseRows: Fixture = {
    slug: "loose_rows",
    table: "loose_rows",
    name: "Loose rows",
    properties: { note: { type: "string" } }
};

/**
 * Admin-only rules, so the boot's `TO rebase_admin_request` companions —
 * `<cut>_ar_<sha8>` — are named for rules of every shape: one operation, several,
 * and a named rule.
 */
const adminLedger: Fixture = {
    slug: "admin_ledger",
    table: "admin_ledger",
    name: "Admin ledger",
    securityRules: [
        { operation: "select", roles: ["admin"] },
        { operations: ["insert", "update", "delete"], roles: ["admin"] },
        { name: "ledger_admin_purge", operation: "delete", roles: ["admin"] }
    ],
    properties: { ...uuidId, entry: { type: "string" } }
};

/**
 * The reference project.
 *
 * The first eleven are the fixture as it stood when the baseline was first
 * written; everything after them was appended. Append, never reorder or prune.
 */
export const FIXTURE: Fixture[] = [
    products, categories, addresses, children, urls, statuses, tags,
    pinned, inventory, longName, suppliers,
    touchedRows, tenantDocuments, searchedArticles, accounts, productRollups, productTitles,
    players, teams, shelves, books, translations, looseRows, adminLedger
];
