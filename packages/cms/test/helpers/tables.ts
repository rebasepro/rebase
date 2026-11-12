import type { TableDescriptor } from "@rebasepro/types";

/**
 * No served tables: for a test that hands a panel scope ready collections
 * (`externalCollections`) and is about the view model itself, so the scope
 * neither asks the server for tables nor projects any.
 */
export const NO_TABLES: readonly TableDescriptor[] = [];
