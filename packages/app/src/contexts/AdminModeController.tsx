import React from "react";
import type { AdminModeController } from "../hooks/useAdminModeController";

const DEFAULT_ADMIN_MODE_STATE: AdminModeController = {
    mode: "cms",
    setMode: (mode: "cms" | "studio" | "settings") => {
    }
};
export const AdminModeControllerContext = React.createContext<AdminModeController>(DEFAULT_ADMIN_MODE_STATE);

export const AdminModeControllerProvider = AdminModeControllerContext.Provider;
