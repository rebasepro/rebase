/**
 * Table Classification Utility
 *
 * Re-exports shared classification logic from @rebasepro/common.
 * This module exists for backward compatibility — prefer importing directly
 * from @rebasepro/common in new code.
 */
export {
  type TableCategory,
  REBASE_INTERNAL_SCHEMAS,
  REBASE_INTERNAL_PREFIXES,
  classifyTable,
  isRebaseInternalTable,
  detectJunctionTables,
  JUNCTION_TABLES_SQL,
} from "@rebasepro/common";
