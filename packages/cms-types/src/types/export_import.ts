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
 * foreign-key column, `id` only where the table has that column — and the
 * record's id beside it, its primary key as a string (a composite one's parts
 * joined by `:::`).
 * @group Models
 */
export interface ExportMappingFunction<USER extends User = User> {
    key: string;
    builder: ({
        row,
        id,
        context
    }: {
        row: Record<string, unknown>,
        id: string,
        context: RebaseContext<USER>
    }) => Promise<string> | string;
}
