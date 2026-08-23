import { useCallback, useMemo, useState } from "react";
import type { AdminModeController } from "./useAdminModeController";
import { readStoredString, writeStoredString } from "../util/local_storage";

/**
 * Use this hook to build an admin mode controller that determines
 * whether the UI shows Developer or Editor tools.
 */
export function useBuildAdminModeController(): AdminModeController {

    const savedMode = readStoredString("rebase-admin-mode") as "content" | "studio" | "settings" | null;
    const [mode, setMode] = useState<"content" | "studio" | "settings">(savedMode ?? "content");

    const setModeInternal = useCallback((newMode: "content" | "studio" | "settings") => {
        writeStoredString("rebase-admin-mode", newMode);
        setMode(newMode);
    }, []);

    return useMemo(() => ({
        mode,
        setMode: setModeInternal
    }), [mode, setModeInternal]);
}
