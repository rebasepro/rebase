import { Snapshot } from "@rebasepro/types";
import { CollectionConfig } from "@rebasepro/types";
import { FormContext } from "../fields";
import { FormexController } from "./formex";

export interface SnapshotFormActionsProps {
    path: string;
    collection: CollectionConfig;
    snapshot?: Snapshot;
    layout: "bottom" | "side" | "responsive";
    savingError?: Error;
    formex: FormexController<Record<string, unknown>>;
    disabled: boolean;
    status: "new" | "existing" | "copy";
    pluginActions: React.ReactNode[];
    openSnapshotMode?: "side_panel" | "full_screen" | "split" | "dialog";
    showDefaultActions?: boolean;
    navigateBack: () => void;
    formContext: FormContext
}
