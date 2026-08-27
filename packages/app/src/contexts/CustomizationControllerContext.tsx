import type { CustomizationController } from "@rebasepro/cms-types";
import React from "react";

export const CustomizationControllerContext = React.createContext<CustomizationController>({} as CustomizationController);
