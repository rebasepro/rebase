import React from "react";

import { SnapshotCollection, RebasePlugin, User } from "@rebasepro/types";
import { DataEnhancementControllerProvider } from "./components/DataEnhancementControllerProvider";
import { FormEnhanceAction } from "./components/FormEnhanceAction";

const DEFAULT_API_KEY = "fcms-U9jdDii0xXWSDC34asfrf54lbkFJBfKfRWcEDEwdc4V5wDWEDF";

export interface DataEnhancementPluginProps {

    apiKey?: string;

    /**
     * Use this function to determine if the data enhancement plugin should be enabled for a given path.
     * If this function is not provided, the plugin will be enabled for all paths.
     * If the function returns false, the plugin will be disabled for the given path.
     * You can also return a configuration object to override the default configuration.
     *
     * @param path
     * @param collection
     */
    getConfigForPath?: (props: {
        path: string,
        collection: SnapshotCollection,
        user: User | null
    }) => boolean;

    /**
     * Host to use for the data enhancement API.
     * This prop is only use in development mode.
     */
    host?: string;
}

/**
 * Use this hook to initialise the data enhancement plugin.
 * This is likely the only hook you will need to use.
 * @param props
 */
export function useDataEnhancementPlugin(props?: DataEnhancementPluginProps): RebasePlugin {

    const apiKey = props?.apiKey ?? DEFAULT_API_KEY;
    const getConfigForPath = props?.getConfigForPath;

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
                    apiKey,
                    getConfigForPath,
                    host: props?.host
                }
            }
        ]
    }), [apiKey, getConfigForPath, props?.host]);
}
