import React from "react";
import type { ModeController } from "../hooks/useModeController";

const DEFAULT_MODE_STATE: ModeController = {
    mode: "light",
    setMode: (mode: "light" | "dark" | "system") => {
    }
};
export const ModeControllerContext = React.createContext<ModeController>(DEFAULT_MODE_STATE);

export const ModeControllerProvider = ModeControllerContext.Provider;
