import { useCallback } from "react";
import { useTranslation } from "./useTranslation";

/**
 * The display label for a navigation group.
 *
 * A group *name* is an identifier: `StudioHomePage` orders the built-in groups
 * by comparing against `["Database", "Compute", …]`, `navigationGroupMappings`
 * keys its icons off it, and `AppView.group` sorts views into one by string
 * equality. Translating the name at the point it is declared therefore breaks
 * the ordering and drops the icons in every locale but English — which is
 * exactly what happened the first time the Studio tool list was translated.
 *
 * So the name stays English and the *label* is translated here, at the one
 * place it is drawn. A group Rebase does not ship — anything an app declares
 * itself — has no key and is rendered as written.
 *
 * @group Hooks and utilities
 */
export function useNavigationGroupLabel(): (group: string) => string {
    const { t } = useTranslation();
    return useCallback((group: string) => {
        const key = `studio_group_${group.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
        // i18next answers a miss with the key itself.
        const label = t(key);
        return label === key ? group : label;
    }, [t]);
}
