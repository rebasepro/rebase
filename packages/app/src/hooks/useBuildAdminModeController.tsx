import { useCallback, useMemo, useState } from "react";
import type { AdminModeController } from "./useAdminModeController";
import { readStoredString, writeStoredString } from "../util/local_storage";

/**
 * Use this hook to build an admin mode controller that determines
 * whether the UI shows Developer or Editor tools.
 */
export function useBuildAdminModeController(): AdminModeController {

    // The content mode was renamed to "cms" when the panel's CMS half became a
    // product name. The value is persisted, so a browser that used the panel
    // before the rename still has "content" in local storage — read as-is it
    // casts to a mode nothing matches, and the drawer renders neither half.
    // Migrating on read is the exception the no-shims rule allows for stored data.
    const stored = readStoredString("rebase-admin-mode");
    const savedMode = (stored === "content" ? "cms" : stored) as "cms" | "studio" | "settings" | null;
    const [mode, setMode] = useState<"cms" | "studio" | "settings">(savedMode ?? "cms");

    const setModeInternal = useCallback((newMode: "cms" | "studio" | "settings") => {
        writeStoredString("rebase-admin-mode", newMode);
        setMode(newMode);
    }, []);

    return useMemo(() => ({
        mode,
        setMode: setModeInternal
    }), [mode, setModeInternal]);
}
