import { Entity } from "@rebasepro/types";
import { EntityCollection } from "@rebasepro/types";
import { FormContext } from "../fields";
import { FormexController } from "./formex";

export interface EntityFormActionsProps {
    path: string;
    collection: EntityCollection;
    entity?: Entity;
    layout: "bottom" | "side" | "responsive";
    savingError?: Error;
    formex: FormexController<any>;
    disabled: boolean;
    status: "new" | "existing" | "copy";
    pluginActions: React.ReactNode[];
    openEntityMode: "side_panel" | "full_screen" | "split" | "dialog";
    showDefaultActions?: boolean;
    navigateBack: () => void;
    formContext: FormContext
}
