import type { Entity } from "@rebasepro/types";
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
 * @group Models
 */
export interface ExportMappingFunction<USER extends User = User> {
    key: string;
    builder: ({
        entity,
        context
    }: {
        entity: Entity,
        context: RebaseContext<USER>
    }) => Promise<string> | string;
}
