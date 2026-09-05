import type { CustomizationController } from "@rebasepro/cms-types";
import React from "react";

/** `null` outside `<Rebase>` — see {@link RebaseDataContext}. */
export const CustomizationControllerContext = React.createContext<CustomizationController | null>(null);
