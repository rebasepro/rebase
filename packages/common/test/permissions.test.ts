import {
    canReadCollection,
    canEditSnapshot,
    canCreateSnapshot,
    canDeleteSnapshot
} from "../src/util/permissions";
import { AuthController, Snapshot, SnapshotCollection, SecurityRule, User } from "@rebasepro/types";

// ── Helpers ──────────────────────────────────────────────────

function makeAuthController(overrides: Partial<{ uid: string; roles: string[] }> = {}): AuthController<User> {
    const user: User = {
        uid: overrides.uid ?? "user-1",
        email: "test@example.com",
        displayName: "Test",
        photoURL: null,
        roles: overrides.roles ?? []
    };
    return { user } as AuthController<User>;
}

function noUser(): AuthController<User> {
    return { user: null } as AuthController<User>;
}

function makeCollection(securityRules?: SecurityRule[]): SnapshotCollection {
    return {
        name: "Products",
        slug: "products",
        table: "products",
        properties: {},
        securityRules
    };
}

function makeSnapshot(values: Record<string, unknown> = {}): Snapshot<any> {
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
            expect(canCreateSnapshot(col, auth, "products", null)).toBe(true);
            expect(canEditSnapshot(col, auth, "products", makeSnapshot())).toBe(true);
            expect(canDeleteSnapshot(col, auth, "products", makeSnapshot())).toBe(true);
        });

        it("allows all operations when securityRules is empty array", () => {
            const col = makeCollection([]);
            const auth = makeAuthController();
            expect(canReadCollection(col, auth)).toBe(true);
            expect(canCreateSnapshot(col, auth, "products", null)).toBe(true);
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
            expect(canCreateSnapshot(col, noUser(), "products", null)).toBe(true);
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
            expect(canCreateSnapshot(col, admin, "products", null)).toBe(true);
            expect(canEditSnapshot(col, admin, "products", makeSnapshot())).toBe(true);
            expect(canDeleteSnapshot(col, admin, "products", makeSnapshot())).toBe(true);
        });

        it("denies access when user lacks matching role", () => {
            const col = makeCollection([
                { roles: ["admin"],
operation: "all",
mode: "permissive" } as SecurityRule
            ]);
            const viewer = makeAuthController({ roles: ["viewer"] });
            expect(canReadCollection(col, viewer)).toBe(false);
            expect(canCreateSnapshot(col, viewer, "products", null)).toBe(false);
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
            expect(canEditSnapshot(col, editor, "products", makeSnapshot())).toBe(true);
            expect(canDeleteSnapshot(col, editor, "products", makeSnapshot())).toBe(false);
        });
    });

    // ── Owner-based rules ───────────────────────────────────
    describe("owner-based rules", () => {
        it("allows when snapshot owner matches user", () => {
            const col = makeCollection([
                { ownerField: "created_by",
operation: "update",
mode: "permissive" } as SecurityRule
            ]);
            const auth = makeAuthController({ uid: "user-42" });
            const snapshot = makeSnapshot({ created_by: "user-42" });
            expect(canEditSnapshot(col, auth, "products", snapshot)).toBe(true);
        });

        it("denies when snapshot owner does not match user", () => {
            const col = makeCollection([
                { ownerField: "created_by",
operation: "update",
mode: "permissive" } as SecurityRule
            ]);
            const auth = makeAuthController({ uid: "user-42" });
            const snapshot = makeSnapshot({ created_by: "other-user" });
            expect(canEditSnapshot(col, auth, "products", snapshot)).toBe(false);
        });

        it("optimistically allows when snapshot is null (new snapshot)", () => {
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
            const snapshot = makeSnapshot({ created_by: "someone-else" });
            expect(canEditSnapshot(col, admin, "products", snapshot)).toBe(false);
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
            const snapshot = makeSnapshot({ created_by: "admin-1" });
            expect(canEditSnapshot(col, admin, "products", snapshot)).toBe(true);
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
            const snapshot = makeSnapshot({ user_id: "user-99" });
            expect(canEditSnapshot(col, auth, "products", snapshot)).toBe(true);
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
            const snapshot = makeSnapshot({ user_id: "someone-else" });
            expect(canEditSnapshot(col, auth, "products", snapshot)).toBe(false);
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
            const snapshot = makeSnapshot({ owner_id: "usr-123" });
            expect(canEditSnapshot(col, auth, "products", snapshot)).toBe(true);
        });

        it("evaluates role intersection (&&)", () => {
            const col = makeCollection([
                {
                    operation: "update",
                    mode: "permissive",
                    using: "string_to_array(auth.roles(), ',') && ARRAY['admin', 'editor']"
                } as SecurityRule
            ]);
            const snapshot = makeSnapshot({ some: "data" });
            const editor = makeAuthController({ roles: ["editor"] });
            expect(canEditSnapshot(col, editor, "products", snapshot)).toBe(true);

            const viewer = makeAuthController({ roles: ["viewer"] });
            expect(canEditSnapshot(col, viewer, "products", snapshot)).toBe(false);
        });

        it("evaluates role containment (@>)", () => {
            const col = makeCollection([
                {
                    operation: "update",
                    mode: "permissive",
                    using: "string_to_array(auth.roles(), ',') @> ARRAY['admin']"
                } as SecurityRule
            ]);
            const snapshot = makeSnapshot({ some: "data" });
            const admin = makeAuthController({ roles: ["admin", "editor"] });
            expect(canEditSnapshot(col, admin, "products", snapshot)).toBe(true);

            const editor = makeAuthController({ roles: ["editor"] });
            expect(canEditSnapshot(col, editor, "products", snapshot)).toBe(false);
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
            const draftSnapshot = makeSnapshot({ user_id: "u1",
status: "draft" });
            expect(canEditSnapshot(col, auth, "products", draftSnapshot)).toBe(true);

            const publishedSnapshot = makeSnapshot({ user_id: "u1",
status: "published" });
            expect(canEditSnapshot(col, auth, "products", publishedSnapshot)).toBe(false);
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
            const pub = makeSnapshot({ status: "published",
user_id: "other" });
            expect(canEditSnapshot(col, auth, "products", pub)).toBe(true);
            // Draft owned by user
            const own = makeSnapshot({ status: "draft",
user_id: "u1" });
            expect(canEditSnapshot(col, auth, "products", own)).toBe(true);
            // Draft not owned
            const other = makeSnapshot({ status: "draft",
user_id: "x" });
            expect(canEditSnapshot(col, auth, "products", other)).toBe(false);
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
            const snapshot = makeSnapshot({ user_id: "u1" });
            expect(canCreateSnapshot(col, auth, "products", snapshot)).toBe(true);

            const badSnapshot = makeSnapshot({ user_id: "other" });
            expect(canCreateSnapshot(col, auth, "products", badSnapshot)).toBe(false);
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
            expect(canCreateSnapshot(col, auth, "products", null)).toBe(false);
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
                    operation: "select",
                    mode: "permissive",
                    using: "((status = 'published'))"
                } as SecurityRule
            ]);
            const auth = makeAuthController();
            const snapshot = makeSnapshot({ status: "published" });
            expect(canReadCollection(col, auth)).toBe(true);
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
                    operation: "select",
                    mode: "permissive",
                    using: "status != 'deleted'"
                } as SecurityRule
            ]);
            const auth = makeAuthController();
            const snapshot = makeSnapshot({ status: "active" });
            expect(canReadCollection(col, auth)).toBe(true);
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
            const snapshot = makeSnapshot({ status: "deleted" });
            expect(canEditSnapshot(col, auth, "products", snapshot)).toBe(false);
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
            const snapshot = makeSnapshot({ user_id: "u1",
status: "published" });
            expect(canEditSnapshot(col, auth, "products", snapshot)).toBe(false);
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
            const snapshot = makeSnapshot({ user_id: "u1",
status: "draft" });
            expect(canEditSnapshot(col, auth, "products", snapshot)).toBe(true);
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
            const snapshot = makeSnapshot({ owner_id: "user-42" });
            expect(canEditSnapshot(col, auth, "products", snapshot)).toBe(true);
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
            const snapshot = makeSnapshot({ owner_id: "other-user" });
            expect(canEditSnapshot(col, auth, "products", snapshot)).toBe(false);
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
            const snapshot = makeSnapshot({ status: "draft" });
            // Restrictive passes, but there's no permissive to grant access
            expect(canEditSnapshot(col, auth, "products", snapshot)).toBe(false);
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
            const snapshot = makeSnapshot({ user_id: "other",
status: "published" });
            expect(canEditSnapshot(col, auth, "products", snapshot)).toBe(true);
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
            const snapshot = makeSnapshot({ user_id: "other",
status: "draft" });
            expect(canEditSnapshot(col, auth, "products", snapshot)).toBe(false);
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
            const snapshot = makeSnapshot({});
            // User has both roles
            const superAdmin = makeAuthController({ roles: ["admin", "superadmin", "viewer"] });
            expect(canReadCollection(col, superAdmin)).toBe(true);

            // User has only one
            const justAdmin = makeAuthController({ roles: ["admin"] });
            expect(canReadCollection(col, justAdmin)).toBe(false);
            // ^ Note: This now returns false because rolesContain is accurately evaluated even without a snapshot.
        });
    });
});

