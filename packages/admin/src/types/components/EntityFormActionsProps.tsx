import { Entity } from "@rebasepro/types";

import { FormContext } from "../fields";
import { FormexController } from "./formex";
import type { AdminCollection } from "@rebasepro/admin-types";

export interface EntityFormActionsProps {
    path: string;
    collection: AdminCollection;
    entity?: Entity;
    /**
     * @deprecated Ignored. The actions render as a footer in every layout now;
     * the sticky side rail they used to have is gone, and the container's
     * identity bar carries Save. Kept so an override component's props still
     * typecheck.
     */
    layout?: "bottom" | "side" | "responsive";
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
