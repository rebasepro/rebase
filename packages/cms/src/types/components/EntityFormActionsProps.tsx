import { Entity } from "@rebasepro/types";

import { FormContext } from "../fields";
import { FormexController } from "./formex";
import type { AdminCollection } from "@rebasepro/cms-types";

export interface EntityFormActionsProps {
    path: string;
    collection: AdminCollection;
    entity?: Entity;
    savingError?: Error;
    formex: FormexController<Record<string, unknown>>;
    disabled: boolean;
    status: "new" | "existing" | "copy";
    pluginActions: React.ReactNode[];
    openEntityMode?: "side_panel" | "full_screen" | "split" | "dialog";
    showDefaultActions?: boolean;
    navigateBack: () => void;
    formContext: FormContext
}
