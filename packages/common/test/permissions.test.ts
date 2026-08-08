import {
    canReadCollection,
    canEditEntity,
    canCreateEntity,
    canDeleteEntity,
    checkOperation
} from "../src/util/permissions";
import { Entity, CollectionConfig, SecurityRule, User } from "@rebasepro/types";
import { AuthController } from "@rebasepro/admin-types";

// ── Helpers ──────────────────────────────────────────────────

function makeAuthController(overrides: Partial<{ uid: string; roles: string[] }> = {}): AuthController<User> {
    const user: User = {
        uid: overrides.uid ?? "user-1",
        email: "test@example.com",
        displayName: "Test",
        photoURL: null,
        providerId: "password",
        isAnonymous: false,
        roles: overrides.roles ?? []
    };
    return { user } as AuthController<User>;
}

function noUser(): AuthController<User> {
    return { user: null } as AuthController<User>;
}

function makeCollection(securityRules?: SecurityRule[]): CollectionConfig {
    return {
        name: "Products",
        slug: "products",
        table: "products",
        properties: {},
        securityRules
    };
}

function makeEntity(values: Record<string, unknown> = {}): Entity<any> {
    return { id: "ent-1",
path: "products",
values };
}

// ═══════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════

describe("Permissions — Security Rule Evaluation", () => {

    // ── No rules (default) ──────────────────────────────────
    describe("no security rules", () => {
        it("allows all operations when securityRules is undefined", () => {
            const col = makeCollection(undefined);
            const auth = makeAuthController();
            expect(canReadCollection(col, auth)).toBe(true);
            expect(canCreateEntity(col, auth, "products", null)).toBe(true);
            expect(canEditEntity(col, auth, "products", makeEntity())).toBe(true);
            expect(canDeleteEntity(col, auth, "products", makeEntity())).toBe(true);
        });

        it("allows all operations when securityRules is empty array", () => {
            const col = makeCollection([]);
            const auth = makeAuthController();
            expect(canReadCollection(col, auth)).toBe(true);
            expect(canCreateEntity(col, auth, "products", null)).toBe(true);
        });
    });

    // ── Public access ───────────────────────────────────────
    describe("public access rules", () => {
        it("allows reads for public access rule", () => {
            const col = makeCollection([
                { access: "public",
operation: "select" } as SecurityRule
            ]);
            expect(canReadCollection(col, noUser())).toBe(true);
        });

        it("allows writes for public access rule", () => {
            const col = makeCollection([
                { access: "public",
operation: "all" } as SecurityRule
            ]);
            expect(canCreateEntity(col, noUser(), "products", null)).toBe(true);
        });
    });

    // ── Role-based rules ────────────────────────────────────
    describe("role-based rules", () => {
        it("grants access when user has a matching role", () => {
            const col = makeCollection([
                { roles: ["admin"],
operation: "all",
mode: "permissive" } as SecurityRule
            ]);
            const admin = makeAuthController({ roles: ["admin"] });
            expect(canReadCollection(col, admin)).toBe(true);
            expect(canCreateEntity(col, admin, "products", null)).toBe(true);
            expect(canEditEntity(col, admin, "products", makeEntity())).toBe(true);
            expect(canDeleteEntity(col, admin, "products", makeEntity())).toBe(true);
        });

        it("denies access when user lacks matching role", () => {
            const col = makeCollection([
                { roles: ["admin"],
operation: "all",
mode: "permissive" } as SecurityRule
            ]);
            const viewer = makeAuthController({ roles: ["viewer"] });
            expect(canReadCollection(col, viewer)).toBe(false);
            expect(canCreateEntity(col, viewer, "products", null)).toBe(false);
        });

        it("handles multiple roles — grants if user matches any", () => {
            const col = makeCollection([
                { roles: ["admin", "editor"],
operation: "all",
mode: "permissive" } as SecurityRule
            ]);
            const editor = makeAuthController({ roles: ["editor"] });
            expect(canReadCollection(col, editor)).toBe(true);
        });

        it("handles multi-operation rules via operations array", () => {
            const col = makeCollection([
                { roles: ["editor"],
operations: ["select", "update"],
mode: "permissive" } as SecurityRule
            ]);
            const editor = makeAuthController({ roles: ["editor"] });
            expect(canReadCollection(col, editor)).toBe(true);
            expect(canEditEntity(col, editor, "products", makeEntity())).toBe(true);
            expect(canDeleteEntity(col, editor, "products", makeEntity())).toBe(false);
        });
    });

    // ── Owner-based rules ───────────────────────────────────
    describe("owner-based rules", () => {
        it("allows when entity owner matches user", () => {
            const col = makeCollection([
                { ownerField: "created_by",
operation: "update",
mode: "permissive" } as SecurityRule
            ]);
            const auth = makeAuthController({ uid: "user-42" });
            const entity = makeEntity({ created_by: "user-42" });
            expect(canEditEntity(col, auth, "products", entity)).toBe(true);
        });

        it("denies when entity owner does not match user", () => {
            const col = makeCollection([
                { ownerField: "created_by",
operation: "update",
mode: "permissive" } as SecurityRule
            ]);
            const auth = makeAuthController({ uid: "user-42" });
            const entity = makeEntity({ created_by: "other-user" });
            expect(canEditEntity(col, auth, "products", entity)).toBe(false);
        });

        it("optimistically allows when entity is null (new entity)", () => {
            const col = makeCollection([
                { ownerField: "created_by",
operation: "select",
mode: "permissive" } as SecurityRule
            ]);
            const auth = makeAuthController({ uid: "user-42" });
            expect(canReadCollection(col, auth)).toBe(true);
        });
    });

    // ── Restrictive mode ────────────────────────────────────
    describe("restrictive mode", () => {
        it("denies when restrictive rule fails even if permissive passes", () => {
            const col = makeCollection([
                // Permissive: admin can do anything
                { roles: ["admin"],
operation: "update",
mode: "permissive" } as SecurityRule,
                // Restrictive: but only owner can update
                { ownerField: "created_by",
operation: "update",
mode: "restrictive" } as SecurityRule
            ]);
            const admin = makeAuthController({ uid: "admin-1",
roles: ["admin"] });
            const entity = makeEntity({ created_by: "someone-else" });
            expect(canEditEntity(col, admin, "products", entity)).toBe(false);
        });

        it("allows when both permissive AND restrictive pass", () => {
            const col = makeCollection([
                { roles: ["admin"],
operation: "update",
mode: "permissive" } as SecurityRule,
                { ownerField: "created_by",
operation: "update",
mode: "restrictive" } as SecurityRule
            ]);
            const admin = makeAuthController({ uid: "admin-1",
roles: ["admin"] });
            const entity = makeEntity({ created_by: "admin-1" });
            expect(canEditEntity(col, admin, "products", entity)).toBe(true);
        });
    });

    // ── RLS SQL AST evaluation ──────────────────────────────
    describe("RLS SQL USING/WITH CHECK evaluation", () => {
        it("evaluates simple auth.uid() comparison", () => {
            const col = makeCollection([
                {
                    operation: "update",
                    mode: "permissive",
                    using: "user_id = auth.uid()"
                } as SecurityRule
            ]);
            const auth = makeAuthController({ uid: "user-99" });
            const entity = makeEntity({ user_id: "user-99" });
            expect(canEditEntity(col, auth, "products", entity)).toBe(true);
        });

        it("denies when auth.uid() does not match", () => {
            const col = makeCollection([
                {
                    operation: "update",
                    mode: "permissive",
                    using: "user_id = auth.uid()"
                } as SecurityRule
            ]);
            const auth = makeAuthController({ uid: "user-99" });
            const entity = makeEntity({ user_id: "someone-else" });
            expect(canEditEntity(col, auth, "products", entity)).toBe(false);
        });

        it("evaluates current_setting('app.user_id') pattern", () => {
            const col = makeCollection([
                {
                    operation: "update",
                    mode: "permissive",
                    using: "owner_id = current_setting('app.user_id')"
                } as SecurityRule
            ]);
            const auth = makeAuthController({ uid: "usr-123" });
            const entity = makeEntity({ owner_id: "usr-123" });
            expect(canEditEntity(col, auth, "products", entity)).toBe(true);
        });

        it("evaluates role intersection (&&)", () => {
            const col = makeCollection([
                {
                    operation: "update",
                    mode: "permissive",
                    using: "string_to_array(auth.roles(), ',') && ARRAY['admin', 'editor']"
                } as SecurityRule
            ]);
            const entity = makeEntity({ some: "data" });
            const editor = makeAuthController({ roles: ["editor"] });
            expect(canEditEntity(col, editor, "products", entity)).toBe(true);

            const viewer = makeAuthController({ roles: ["viewer"] });
            expect(canEditEntity(col, viewer, "products", entity)).toBe(false);
        });

        it("evaluates role containment (@>)", () => {
            const col = makeCollection([
                {
                    operation: "update",
                    mode: "permissive",
                    using: "string_to_array(auth.roles(), ',') @> ARRAY['admin']"
                } as SecurityRule
            ]);
            const entity = makeEntity({ some: "data" });
            const admin = makeAuthController({ roles: ["admin", "editor"] });
            expect(canEditEntity(col, admin, "products", entity)).toBe(true);

            const editor = makeAuthController({ roles: ["editor"] });
            expect(canEditEntity(col, editor, "products", entity)).toBe(false);
        });

        it("evaluates AND in SQL using", () => {
            const col = makeCollection([
                {
                    operation: "update",
                    mode: "permissive",
                    using: "user_id = auth.uid() AND status = 'draft'"
                } as SecurityRule
            ]);
            const auth = makeAuthController({ uid: "u1" });
            const draftEntity = makeEntity({ user_id: "u1",
status: "draft" });
            expect(canEditEntity(col, auth, "products", draftEntity)).toBe(true);

            const publishedEntity = makeEntity({ user_id: "u1",
status: "published" });
            expect(canEditEntity(col, auth, "products", publishedEntity)).toBe(false);
        });

        it("evaluates OR in SQL using", () => {
            const col = makeCollection([
                {
                    operation: "update",
                    mode: "permissive",
                    using: "status = 'published' OR user_id = auth.uid()"
                } as SecurityRule
            ]);
            const auth = makeAuthController({ uid: "u1" });
            // Published — anyone can edit
            const pub = makeEntity({ status: "published",
user_id: "other" });
            expect(canEditEntity(col, auth, "products", pub)).toBe(true);
            // Draft owned by user
            const own = makeEntity({ status: "draft",
user_id: "u1" });
            expect(canEditEntity(col, auth, "products", own)).toBe(true);
            // Draft not owned
            const other = makeEntity({ status: "draft",
user_id: "x" });
            expect(canEditEntity(col, auth, "products", other)).toBe(false);
        });

        it("evaluates withCheck for insert operations", () => {
            const col = makeCollection([
                {
                    operation: "insert",
                    mode: "permissive",
                    withCheck: "user_id = auth.uid()"
                } as SecurityRule
            ]);
            const auth = makeAuthController({ uid: "u1" });
            const entity = makeEntity({ user_id: "u1" });
            expect(canCreateEntity(col, auth, "products", entity)).toBe(true);

            const badEntity = makeEntity({ user_id: "other" });
            expect(canCreateEntity(col, auth, "products", badEntity)).toBe(false);
        });
    });

    // ── Edge cases ──────────────────────────────────────────
    describe("edge cases", () => {
        it("denies when rules exist for different operations", () => {
            const col = makeCollection([
                { operation: "select",
access: "public",
mode: "permissive" } as SecurityRule
            ]);
            const auth = makeAuthController();
            // select should pass
            expect(canReadCollection(col, auth)).toBe(true);
            // insert should fail (no applicable rule)
            expect(canCreateEntity(col, auth, "products", null)).toBe(false);
        });

        it("handles user with no roles (falls back to 'public')", () => {
            const col = makeCollection([
                { roles: ["public"],
operation: "select",
mode: "permissive" } as SecurityRule
            ]);
            const auth = makeAuthController({ roles: [] });
            expect(canReadCollection(col, auth)).toBe(true);
        });

        it("handles complex nested parentheses in SQL", () => {
            const col = makeCollection([
                {
                    operation: "update",
                    mode: "permissive",
                    using: "((status = 'published'))"
                } as SecurityRule
            ]);
            const auth = makeAuthController();
            // `canReadCollection` passes `entity: null`, so a row predicate is
            // undecidable and the optimistic unknown->allow path answers instead
            // of the parser. Go through an entity-aware check so the predicate is
            // the thing under test, and pin both outcomes.
            expect(canEditEntity(col, auth, "products", makeEntity({ status: "published" }))).toBe(true);
            expect(canEditEntity(col, auth, "products", makeEntity({ status: "draft" }))).toBe(false);
        });

        it("optimistically allows IN / EXISTS queries (fallback)", () => {
            const col = makeCollection([
                {
                    operation: "select",
                    mode: "permissive",
                    using: "id IN (SELECT product_id FROM featured_products)"
                } as SecurityRule
            ]);
            const auth = makeAuthController();
            // Should optimistically return true since we can't evaluate IN
            expect(canReadCollection(col, auth)).toBe(true);
        });
    });

    // ── SQL != operator ─────────────────────────────────────
    describe("SQL != (not equal) operator", () => {
        it("evaluates != to true when values differ", () => {
            const col = makeCollection([
                {
                    operation: "update",
                    mode: "permissive",
                    using: "status != 'deleted'"
                } as SecurityRule
            ]);
            const auth = makeAuthController();
            // Same trap as the parentheses case: with `entity: null` the answer
            // came from unknown->allow, not from `!=`. Re-checking under
            // `onUnknown: "deny"` is what proves the `true` was decided by the
            // operator rather than handed over by the fallback.
            const entity = makeEntity({ status: "active" });
            expect(canEditEntity(col, auth, "products", entity)).toBe(true);
            expect(checkOperation(col, auth, entity, "update", { onUnknown: "deny" })).toBe(true);
        });

        it("evaluates != to false when values match", () => {
            const col = makeCollection([
                {
                    operation: "update",
                    mode: "permissive",
                    using: "status != 'deleted'"
                } as SecurityRule
            ]);
            const auth = makeAuthController();
            const entity = makeEntity({ status: "deleted" });
            expect(canEditEntity(col, auth, "products", entity)).toBe(false);
        });
    });

    // ── Combined USING + WITH CHECK ─────────────────────────
    describe("combined USING and withCheck", () => {
        it("denies when USING passes but withCheck fails", () => {
            const col = makeCollection([
                {
                    operation: "update",
                    mode: "permissive",
                    using: "user_id = auth.uid()",
                    withCheck: "status = 'draft'"
                } as SecurityRule
            ]);
            const auth = makeAuthController({ uid: "u1" });
            // USING passes (user_id matches), withCheck fails (status isn't 'draft')
            const entity = makeEntity({ user_id: "u1",
status: "published" });
            expect(canEditEntity(col, auth, "products", entity)).toBe(false);
        });

        it("allows when both USING and withCheck pass", () => {
            const col = makeCollection([
                {
                    operation: "update",
                    mode: "permissive",
                    using: "user_id = auth.uid()",
                    withCheck: "status = 'draft'"
                } as SecurityRule
            ]);
            const auth = makeAuthController({ uid: "u1" });
            const entity = makeEntity({ user_id: "u1",
status: "draft" });
            expect(canEditEntity(col, auth, "products", entity)).toBe(true);
        });
    });

    // ── Reversed auth.uid() = field pattern ──────────────────
    describe("reversed auth.uid() = field pattern", () => {
        it("evaluates auth.uid() = field_name pattern", () => {
            const col = makeCollection([
                {
                    operation: "update",
                    mode: "permissive",
                    using: "auth.uid() = owner_id"
                } as SecurityRule
            ]);
            const auth = makeAuthController({ uid: "user-42" });
            const entity = makeEntity({ owner_id: "user-42" });
            expect(canEditEntity(col, auth, "products", entity)).toBe(true);
        });

        it("denies when reversed auth.uid() doesn't match", () => {
            const col = makeCollection([
                {
                    operation: "update",
                    mode: "permissive",
                    using: "auth.uid() = owner_id"
                } as SecurityRule
            ]);
            const auth = makeAuthController({ uid: "user-42" });
            const entity = makeEntity({ owner_id: "other-user" });
            expect(canEditEntity(col, auth, "products", entity)).toBe(false);
        });
    });

    // ── Only restrictive rules (no permissive) ───────────────
    describe("only restrictive rules", () => {
        it("denies when no permissive rules exist (even if restrictive passes)", () => {
            const col = makeCollection([
                {
                    operation: "update",
                    mode: "restrictive",
                    using: "status = 'draft'"
                } as SecurityRule
            ]);
            const auth = makeAuthController();
            const entity = makeEntity({ status: "draft" });
            // Restrictive passes, but there's no permissive to grant access
            expect(canEditEntity(col, auth, "products", entity)).toBe(false);
        });
    });

    // ── Multiple permissive rules (OR semantics) ─────────────
    describe("multiple permissive rules", () => {
        it("allows if at least one permissive rule passes", () => {
            const col = makeCollection([
                {
                    operation: "update",
                    mode: "permissive",
                    using: "user_id = auth.uid()"
                } as SecurityRule,
                {
                    operation: "update",
                    mode: "permissive",
                    using: "status = 'published'"
                } as SecurityRule
            ]);
            const auth = makeAuthController({ uid: "u1" });
            // First rule fails (wrong user_id), but second passes (status is published)
            const entity = makeEntity({ user_id: "other",
status: "published" });
            expect(canEditEntity(col, auth, "products", entity)).toBe(true);
        });

        it("denies if all permissive rules fail", () => {
            const col = makeCollection([
                {
                    operation: "update",
                    mode: "permissive",
                    using: "user_id = auth.uid()"
                } as SecurityRule,
                {
                    operation: "update",
                    mode: "permissive",
                    using: "status = 'published'"
                } as SecurityRule
            ]);
            const auth = makeAuthController({ uid: "u1" });
            const entity = makeEntity({ user_id: "other",
status: "draft" });
            expect(canEditEntity(col, auth, "products", entity)).toBe(false);
        });
    });

    // ── Role containment (@>) with multiple required roles ────
    describe("role containment with multiple required roles", () => {
        it("requires ALL roles to be present for @> operator", () => {
            const col = makeCollection([
                {
                    operation: "select",
                    mode: "permissive",
                    using: "string_to_array(auth.roles(), ',') @> ARRAY['admin', 'superadmin']"
                } as SecurityRule
            ]);
            const entity = makeEntity({});
            // User has both roles
            const superAdmin = makeAuthController({ roles: ["admin", "superadmin", "viewer"] });
            expect(canReadCollection(col, superAdmin)).toBe(true);

            // User has only one
            const justAdmin = makeAuthController({ roles: ["admin"] });
            expect(canReadCollection(col, justAdmin)).toBe(false);
            // ^ Note: This now returns false because rolesContain is accurately evaluated even without a entity.
        });
    });
    // ── Engine independence ──────────────────────────────────
    describe("engines without database-enforced RLS", () => {
        /**
         * `supportsRLS` says *who* enforces a rule, not *whether* it holds. The
         * capability gate that used to sit at the top of `checkOperation`
         * discarded the rules for any collection carrying an engine whose
         * capabilities report `supportsRLS: false` — which is every call site in
         * the MongoDB driver, all of which pass `onUnknown: "deny"` and were
         * never reached.
         */
        // Cast through `unknown` on purpose. `makeCollection` builds the
        // Postgres shape, and tagging it `engine: "mongodb"` selects the Mongo
        // arm of the union, whose `properties` are a different type. That
        // mismatch is irrelevant here — `checkOperation` reads `securityRules`
        // and the engine tag and nothing else — and reusing the shared builder
        // is what keeps this test comparable with the ones above it.
        function mongoCollection(securityRules: SecurityRule[]): CollectionConfig {
            return { ...makeCollection(securityRules),
engine: "mongodb" } as unknown as CollectionConfig;
        }

        const ownerRule: SecurityRule[] = [
            { operations: ["all"],
ownerField: "owner_id" } as SecurityRule
        ];

        it("evaluates the rules of a `engine: \"mongodb\"` collection", () => {
            const col = mongoCollection(ownerRule);
            const auth = makeAuthController({ uid: "u1" });
            expect(canEditEntity(col, auth, "products", makeEntity({ owner_id: "someone-else" }))).toBe(false);
            expect(canDeleteEntity(col, auth, "products", makeEntity({ owner_id: "someone-else" }))).toBe(false);
        });

        it("still grants the owner — the rule has to discriminate", () => {
            const col = mongoCollection(ownerRule);
            const auth = makeAuthController({ uid: "u1" });
            expect(canEditEntity(col, auth, "products", makeEntity({ owner_id: "u1" }))).toBe(true);
        });

        /**
         * The behaviour used to flip on spelling: `driver: "mongodb"` leaves
         * `engine` undefined, which resolved to the Postgres capabilities and
         * *did* evaluate the rules. Configuring the collection the documented
         * way was what removed the enforcement.
         */
        it("answers the same for `engine: \"mongodb\"` and the legacy `driver` spelling", () => {
            const auth = makeAuthController({ uid: "u1" });
            const entity = makeEntity({ owner_id: "someone-else" });
            const byEngine = mongoCollection(ownerRule);
            // `driver` is the deprecated spelling and is not on the Mongo
            // config type at all — which is precisely why it used to leave
            // `engine` undefined and pick up Postgres capabilities. Casting
            // through `unknown` is the only way to express the shape a real
            // 0.12-era config still has on disk.
            const byDriver = { ...makeCollection(ownerRule),
driver: "mongodb" } as unknown as CollectionConfig;
            expect(canEditEntity(byEngine, auth, "products", entity))
                .toBe(canEditEntity(byDriver, auth, "products", entity));
        });
    });

    // ── USING / WITH CHECK, asked separately ─────────────────
    describe("clause selection", () => {
        /**
         * Postgres checks `USING` against the stored row and `WITH CHECK`
         * against the row that will replace it. A driver enforcing an update
         * in-process holds two different rows and must be able to ask the two
         * questions separately.
         */
        const rule: SecurityRule[] = [
            {
                operation: "update",
                using: "owner_id = auth.uid()",
                withCheck: "status = 'draft'"
            } as SecurityRule
        ];

        it("`using` ignores the WITH CHECK clause", () => {
            const col = makeCollection(rule);
            const auth = makeAuthController({ uid: "u1" });
            const stored = makeEntity({ owner_id: "u1",
status: "published" });
            expect(checkOperation(col, auth, stored, "update", { clauses: "using" })).toBe(true);
            expect(checkOperation(col, auth, stored, "update")).toBe(false);
        });

        it("`withCheck` ignores the USING clause", () => {
            const col = makeCollection(rule);
            const auth = makeAuthController({ uid: "u1" });
            const incoming = makeEntity({ owner_id: "someone-else",
status: "draft" });
            expect(checkOperation(col, auth, incoming, "update", { clauses: "withCheck" })).toBe(true);
            expect(checkOperation(col, auth, incoming, "update", { clauses: "using" })).toBe(false);
        });
    });
});
