/**
 * `@rebasepro/rls-check` — a read-only Row-Level Security audit for any
 * PostgreSQL database.
 *
 *   npx @rebasepro/rls-check "postgresql://user:pass@host:5432/database"
 *
 * Two entry points:
 *
 *   - {@link runCli}, which `bin/rls-check.js` calls and which returns an exit
 *     code instead of throwing or exiting;
 *   - {@link scan}, for programmatic use — connect, introspect, run the checks,
 *     hand back a {@link ScanResult}. Everything else here is the vocabulary
 *     needed to consume that result.
 *
 * The package depends on `pg` and nothing else, deliberately: it gets pointed
 * at production databases by people who have never heard of us, and the install
 * has to be something they can read in full before they run it.
 */

export { runCli, scan, selectCheckIds, EXIT_OK, EXIT_FINDINGS, EXIT_ERROR } from "./cli";
export type { ScanOptions, CliIo, CliOptions } from "./cli";

export { introspect } from "./introspect";
export type { ConnectOptions } from "./introspect";

export { CHECKS, runChecks } from "./checks";

export {
    renderReport,
    renderJson,
    renderCheckCatalog,
    severityRank,
    maxSeverity,
    exceedsThreshold,
    formatTarget
} from "./report";
export type { RenderOptions } from "./report";

export { renderHtml, escapeHtml } from "./report-html";
export type { HtmlRenderOptions } from "./report-html";

export { redactConnectionString, redactSecrets, parseConnectionString, formatEndpoint } from "./redact";
export type { ConnectionTarget } from "./redact";

export { SEVERITIES } from "./types";
export type {
    Check,
    DbColumn,
    DbForeignKey,
    DbGrant,
    DbPolicy,
    DbRelation,
    DbRole,
    DbRoutine,
    DbSnapshot,
    DbView,
    Finding,
    FindingTarget,
    PolicyCommand,
    PgRelationKind,
    ScanResult,
    Severity
} from "./types";
