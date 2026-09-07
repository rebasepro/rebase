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
    //
    // Anything else stored under this key falls back to "cms" for the same
    // reason, rather than being cast to a mode: the union used to carry a third
    // value, `"settings"`, that nothing set and nothing read, and a cast is how
    // a value outside the union reaches state in the first place.
    const stored = readStoredString("rebase-admin-mode");
    const migrated = stored === "content" ? "cms" : stored;
    const savedMode = migrated === "cms" || migrated === "studio" ? migrated : null;
    const [mode, setMode] = useState<"cms" | "studio">(savedMode ?? "cms");

    const setModeInternal = useCallback((newMode: "cms" | "studio") => {
        writeStoredString("rebase-admin-mode", newMode);
        setMode(newMode);
    }, []);

    return useMemo(() => ({
        mode,
        setMode: setModeInternal
    }), [mode, setModeInternal]);
}
