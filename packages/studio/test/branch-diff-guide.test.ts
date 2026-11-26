import type { BranchSchemaChange } from "@rebasepro/types";
import { summarizeBranchSchemaDiff } from "../src/components/Branches/summarizeBranchDiff";
import { isNoisyLogEntry } from "../src/components/LogsExplorer/logEntryView";

describe("Studio intent summaries & noise filtering", () => {
    it("groups branch schema changes into breaking/altered, access/RLS, additive, and mechanical buckets", () => {
        const changes: BranchSchemaChange[] = [
            { object: "column", change: "dropped", schema: "public", table: "posts", name: "legacy" },
            { object: "policy", change: "added", schema: "public", table: "posts", name: "posts_owner" },
            { object: "table", change: "added", schema: "public", table: "invoices" },
            { object: "index", change: "added", schema: "public", table: "invoices", name: "idx_invoices_id" }
        ];

        const guide = summarizeBranchSchemaDiff(changes);
        expect(guide.destructive).toHaveLength(1);
        expect(guide.access).toHaveLength(1);
        expect(guide.additive).toHaveLength(1);
        expect(guide.mechanical).toHaveLength(1);
        expect(guide.meaningfulCount).toBe(3);
        expect(guide.headline).toContain("1 breaking/altered");
        expect(guide.headline).toContain("1 access/RLS");
        expect(guide.headline).toContain("1 additive");
    });

    it("filters 2xx healthcheck/polling log entries while preserving errors and API traffic", () => {
        expect(isNoisyLogEntry({ level: "info", metadata: { method: "GET", path: "/api/health", status: 200 } })).toBe(true);
        expect(isNoisyLogEntry({ level: "info", metadata: { method: "GET", path: "/favicon.ico", status: 200 } })).toBe(true);
        expect(isNoisyLogEntry({ level: "error", metadata: { method: "GET", path: "/api/health", status: 500 } })).toBe(false);
        expect(isNoisyLogEntry({ level: "info", metadata: { method: "POST", path: "/api/data/posts", status: 201 } })).toBe(false);
    });
});
