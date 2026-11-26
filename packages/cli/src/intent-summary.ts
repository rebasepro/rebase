/**
 * Deterministic SQL & schema intent summarizer (Linear "Guides" pattern).
 *
 * Groups raw DDL statements into human-meaningful impact buckets so humans and
 * agents review destructive risk and access/RLS changes BEFORE reading raw SQL,
 * and separates mechanical index/trigger noise from meaningful schema intent.
 */

export interface SqlIntentBuckets {
    destructive: string[];
    access: string[];
    additive: string[];
    mechanical: string[];
    meaningfulCount: number;
    headline: string;
}

function normalizeStatement(stmt: string): string {
    return stmt
        .replace(/--[^\n]*/g, " ")
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function splitStatements(sql: string): string[] {
    return sql
        .split(/;\s*(?:\n|$)/)
        .map(normalizeStatement)
        .filter((s) => s.length > 0);
}

function shorten(stmt: string, maxLen = 88): string {
    return stmt.length <= maxLen ? stmt : `${stmt.slice(0, maxLen - 1)}…`;
}

/**
 * Classify raw SQL DDL statements into Destructive, Access/RLS, Additive, and
 * Mechanical (index/trigger) buckets.
 */
export function summarizeSqlIntent(sql: string): SqlIntentBuckets {
    const destructive: string[] = [];
    const access: string[] = [];
    const additive: string[] = [];
    const mechanical: string[] = [];

    for (const stmt of splitStatements(sql)) {
        const upper = stmt.toUpperCase();

        if (
            /\b(CREATE|ALTER|DROP)\s+POLICY\b/.test(upper)
            || /\b(ENABLE|DISABLE|FORCE|NO FORCE)\s+ROW\s+LEVEL\s+SECURITY\b/.test(upper)
            || /^(GRANT|REVOKE)\b/.test(upper)
        ) {
            access.push(shorten(stmt));
            continue;
        }

        if (
            /\b(CREATE|DROP)\s+(UNIQUE\s+)?INDEX\b/.test(upper)
            || /\b(CREATE|DROP)\s+(OR\s+REPLACE\s+)?TRIGGER\b/.test(upper)
            || /^COMMENT\s+ON\b/.test(upper)
        ) {
            mechanical.push(shorten(stmt));
            continue;
        }

        if (
            /\bDROP\s+(TABLE|COLUMN|CONSTRAINT|TYPE|VIEW|FUNCTION|SCHEMA)\b/.test(upper)
            || /\bALTER\s+COLUMN\b[\s\S]*\b(TYPE|SET\s+NOT\s+NULL)\b/.test(upper)
            || /^TRUNCATE\b/.test(upper)
        ) {
            destructive.push(shorten(stmt));
            continue;
        }

        additive.push(shorten(stmt));
    }

    const meaningfulCount = destructive.length + access.length + additive.length;
    const parts: string[] = [];
    if (destructive.length > 0) parts.push(`${destructive.length} destructive/breaking`);
    if (access.length > 0) parts.push(`${access.length} access/RLS`);
    if (additive.length > 0) parts.push(`${additive.length} additive`);
    if (mechanical.length > 0) parts.push(`${mechanical.length} index/trigger`);

    return {
        destructive,
        access,
        additive,
        mechanical,
        meaningfulCount,
        headline: parts.length > 0 ? parts.join(" · ") : "No SQL changes"
    };
}

/**
 * Render a `-- Intent Summary` header comment suitable for prepending to
 * generated migration SQL files.
 */
export function formatMigrationIntentHeader(sql: string): string {
    const summary = summarizeSqlIntent(sql);
    const lines = [
        `-- Intent Summary: ${summary.headline}`,
        `-- Meaningful statements: ${summary.meaningfulCount} (filtered mechanical: ${summary.mechanical.length})`
    ];
    if (summary.destructive.length > 0) {
        lines.push(`-- [DESTRUCTIVE] ${summary.destructive.join(" | ")}`);
    }
    if (summary.access.length > 0) {
        lines.push(`-- [ACCESS/RLS] ${summary.access.join(" | ")}`);
    }
    return lines.join("\n");
}

/**
 * Format a concise, human-first CLI summary block to print before raw SQL.
 */
export function formatCliIntentSummary(sql: string): string {
    const summary = summarizeSqlIntent(sql);
    const lines = [`Change Guide: ${summary.headline}`];
    if (summary.destructive.length > 0) {
        lines.push(`  ! Destructive (${summary.destructive.length}):`);
        for (const item of summary.destructive.slice(0, 5)) lines.push(`      ${item}`);
    }
    if (summary.access.length > 0) {
        lines.push(`  ~ Access / RLS (${summary.access.length}):`);
        for (const item of summary.access.slice(0, 5)) lines.push(`      ${item}`);
    }
    if (summary.additive.length > 0) {
        lines.push(`  + Additive (${summary.additive.length}):`);
        for (const item of summary.additive.slice(0, 5)) lines.push(`      ${item}`);
    }
    if (summary.mechanical.length > 0) {
        lines.push(`  · Mechanical (${summary.mechanical.length} index/trigger statements filtered)`);
    }
    return lines.join("\n");
}
