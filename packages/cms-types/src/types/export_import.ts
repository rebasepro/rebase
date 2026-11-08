import type { User } from "@rebasepro/types";
import type { RebaseContext } from "../rebase_context";

/**
 * You can use this configuration to add additional fields to the data
 * exports
 * @group Models
 */
export interface ExportConfig<USER extends User = User> {
    additionalFields: ExportMappingFunction<USER>[];
}

/**
 * An extra column of an export: its `builder` is handed each exported record
 * as the server sends the row — dates as ISO strings, a belongsTo as its
 * foreign-key column, `id` included.
 * @group Models
 */
export interface ExportMappingFunction<USER extends User = User> {
    key: string;
    builder: ({
        row,
        context
    }: {
        row: Record<string, unknown>,
        context: RebaseContext<USER>
    }) => Promise<string> | string;
}
