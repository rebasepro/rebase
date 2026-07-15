/**
 * Regression tests for the entity naming conventions in server-postgres.
 *
 * These tests guard against:
 * 1. The SQL keyword IDENTITY must never be corrupted (e.g., to IDSNAPSHOT or IDENTITY).
 * 2. Database table/column names (entity_history, entity_id) must be preserved.
 * 3. The word "identity" must never be partially replaced.
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

    it("should use entity_history as the DB table name", () => {
        const src = readFile("src/history/ensure-history-table.ts");
        expect(src).toContain("entity_history");
    });

    it("should use entity_id as the DB column name in HistoryService", () => {
        const src = readFile("src/history/HistoryService.ts");
        expect(src).toContain("entity_id");
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

    it("should preserve 'identity' words in introspect-db-logic.ts", () => {
        const src = readFile("src/schema/introspect-db-logic.ts");
        // Must contain the word Identity or IDENTITY (from the scoring vars)
        expect(src).toMatch(/Identity|IDENTITY|identity/);
    });
});

// ── 4. No Snapshot-noun types in server-postgres ─────────────────────────

describe("No Snapshot as record noun", () => {

    it("should not contain SnapshotValues type", () => {
        const violations = findViolations(SRC_ROOT, /\bSnapshotValues\b/);
        expect(violations).toEqual([]);
    });

    it("should not contain SnapshotStatus type", () => {
        const violations = findViolations(SRC_ROOT, /\bSnapshotStatus\b/);
        expect(violations).toEqual([]);
    });
});
