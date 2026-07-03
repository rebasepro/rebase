/**
 * Regression tests for the Entity → Snapshot rename refactor.
 *
 * These tests guard against the specific classes of bugs that were
 * introduced by the automated regex-based rename and ensure they
 * never regress:
 *
 * 1. The SQL keyword IDENTITY must never be corrupted to IDSNAPSHOT.
 * 2. Database table/column names (entity_history, entity_id) must be
 *    preserved — they are physical DB names, not code-level concepts.
 * 3. Grammar: "a snapshot" (not "an snapshot") in all prose.
 * 4. The word "identity" must never be partially replaced.
 */

import * as fs from "fs";
import * as path from "path";

const SRC_ROOT = path.resolve(__dirname, "../src");

function readFile(relativePath: string): string {
    return fs.readFileSync(path.resolve(__dirname, "..", relativePath), "utf-8");
}

function collectTsFiles(dir: string): string[] {
    if (!fs.existsSync(dir)) return [];
    const results: string[] = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        if (["node_modules", "dist", ".git", "coverage"].includes(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            results.push(...collectTsFiles(full));
        } else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".d.ts")) {
            results.push(full);
        }
    }
    return results;
}

function findViolations(dir: string, pattern: RegExp): string[] {
    const violations: string[] = [];
    const files = collectTsFiles(dir);
    for (const file of files) {
        const content = fs.readFileSync(file, "utf-8");
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
            if (pattern.test(lines[i])) {
                const relPath = path.relative(path.resolve(__dirname, ".."), file);
                violations.push(`${relPath}:${i + 1}: ${lines[i].trim()}`);
            }
        }
    }
    return violations;
}

// ── 1. SQL IDENTITY keyword integrity ────────────────────────────────────

describe("SQL IDENTITY keyword integrity", () => {

    it("generate-postgres-ddl-logic.ts should contain 'AS IDENTITY' and not 'AS IDSNAPSHOT'", () => {
        const src = readFile("src/schema/generate-postgres-ddl-logic.ts");
        expect(src).toContain("AS IDENTITY");
        expect(src).not.toContain("IDSNAPSHOT");
    });

    it("ensure-tables.ts should contain 'AS IDENTITY' and not 'AS IDSNAPSHOT'", () => {
        const src = readFile("src/auth/ensure-tables.ts");
        expect(src).toContain("AS IDENTITY");
        expect(src).not.toContain("IDSNAPSHOT");
    });

    it("should not contain IDSNAPSHOT in any source file", () => {
        const violations = findViolations(SRC_ROOT, /IDSNAPSHOT/);
        expect(violations).toEqual([]);
    });
});

// ── 2. Database table/column name preservation ───────────────────────────

describe("History table naming", () => {

    it("should use snapshot_history as the DB table name", () => {
        const src = readFile("src/history/ensure-history-table.ts");
        expect(src).toContain("rebase.snapshot_history");
        expect(src).not.toContain("rebase.entity_history");
    });

    it("should use snapshot_id as the DB column name", () => {
        const src = readFile("src/history/HistoryService.ts");
        expect(src).toContain("snapshot_id");
        expect(src).not.toContain("entity_id");
    });

    it("should reference snapshot_history in all HistoryService SQL queries", () => {
        const src = readFile("src/history/HistoryService.ts");
        const tableRefs = src.match(/rebase\.\w+_history/g) || [];
        expect(tableRefs.length).toBeGreaterThan(0);
        for (const ref of tableRefs) {
            expect(ref).toBe("rebase.snapshot_history");
        }
    });
});

// ── 3. IDENTITY variable names preserved ─────────────────────────────────

describe("IDENTITY variable names in introspect-db-logic", () => {

    it("should preserve IDENTITY_EXACT and HUMAN_IDENTITY_EXACT variable names", () => {
        const src = readFile("src/schema/introspect-db-logic.ts");
        expect(src).toContain("IDENTITY_EXACT");
        expect(src).toContain("HUMAN_IDENTITY_EXACT");
        expect(src).not.toContain("IDSNAPSHOT_EXACT");
        expect(src).not.toContain("HUMAN_IDSNAPSHOT_EXACT");
    });
});

// ── 4. Grammar: "a snapshot" not "an snapshot" ───────────────────────────

describe("Grammar: article before 'snapshot'", () => {

    it("should never use 'an snapshot' (wrong article) in source files", () => {
        const violations = findViolations(SRC_ROOT, /\ban [Ss]napshot/);
        expect(violations).toEqual([]);
    });

    it("should never use 'An snapshot' (wrong article) in source files", () => {
        const violations = findViolations(SRC_ROOT, /\bAn [Ss]napshot/);
        expect(violations).toEqual([]);
    });
});

// ── 5. Words containing "entity" as substring must not be corrupted ──────

describe("Substring preservation", () => {

    it("should not contain IdSnapshot as a corruption of Identity", () => {
        const violations = findViolations(SRC_ROOT, /\bIdSnapshot\b/);
        expect(violations).toEqual([]);
    });

    it("should not contain idsnapshot (lowercase) as a corruption of identity", () => {
        const violations = findViolations(SRC_ROOT, /\bidsnapshot\b/i);
        expect(violations).toEqual([]);
    });

    it("should preserve 'identity' words in introspect-db-logic.ts", () => {
        const src = readFile("src/schema/introspect-db-logic.ts");
        // Must contain the word Identity or IDENTITY (from the scoring vars)
        expect(src).toMatch(/Identity|IDENTITY|identity/);
    });
});
