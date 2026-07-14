/**
 * Storage-generic backup helpers and admin routes for the Backups panel.
 * The `pg_dump`/`pg_restore` machinery lives in `@rebasepro/server-postgresql`.
 */
export * from "./backup-common";
export { createBackupRoutes } from "./backup-routes";
export type { BackupRoutesConfig } from "./backup-routes";
