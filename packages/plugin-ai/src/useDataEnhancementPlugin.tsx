import React from "react";

import { CollectionConfig, User } from "@rebasepro/types";
import { RebasePlugin } from "@rebasepro/admin-types";
import { DataEnhancementControllerProvider } from "./components/DataEnhancementControllerProvider";
import { FormEnhanceAction } from "./components/FormEnhanceAction";

export interface DataEnhancementPluginProps {

    /**
     * Use this function to determine if the data enhancement plugin should be enabled for a given path.
     * If this function is not provided, the plugin will be enabled for all paths.
     * If the function returns false, the plugin will be disabled for the given path.
     *
     * @param path
     * @param collection
     */
    getConfigForPath?: (props: {
        path: string,
        collection: CollectionConfig,
        user: User | null
    }) => boolean;

    /**
     * Base URL of the AI service.
     *
     * Defaults to the one Rebase hosts, which is free to use and needs no
     * configuration. Point it at your own deployment to keep generation inside
     * your infrastructure — the wire format is documented in `src/api.ts`, and
     * the reference implementation is `saas/backend/functions/ai.ts`.
     *
     * Whatever it points at, the plugin renders nothing until that host's
     * `GET /status` reports itself available.
     */
    endpoint?: string;
}

/**
 * Use this hook to initialise the data enhancement plugin.
 * This is likely the only hook you will need to use.
 * @param props
 */
export function useDataEnhancementPlugin(props?: DataEnhancementPluginProps): RebasePlugin {

    const getConfigForPath = props?.getConfigForPath;
    const endpoint = props?.endpoint;

    return React.useMemo(() => ({
        key: "data_enhancement",
        slots: [
            {
                slot: "form.actions",
                Component: FormEnhanceAction,
                order: 40
            }
        ],
        providers: [
            {
                scope: "form" as const,
                Component: DataEnhancementControllerProvider as React.ComponentType<any>,
                props: {
                    getConfigForPath,
                    endpoint
                }
            }
        ]
    }), [getConfigForPath, endpoint]);
}
