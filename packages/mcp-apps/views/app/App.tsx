import React, { useEffect, useState } from "react";
import { Alert, CircularProgress, Typography } from "@rebasepro/ui";
import type { HostContext, McpAppBridge } from "../bridge";
import { CollectionTable } from "../collection-table/CollectionTable";
import { parseResult, type Parsed } from "./payload";
import { RebaseScreen } from "./RebaseScreen";

/**
 * The view every show_* tool opens: the screen its result describes, drawn
 * with the admin panel's own components — or, for a result from a server that
 * predates them, the table that server's show_collection drew.
 */
export function App({ bridge }: { bridge: McpAppBridge }) {
    const [parsed, setParsed] = useState<Parsed>();
    const [context, setContext] = useState<HostContext>({});

    useEffect(() => bridge.watchHostContext(setContext), [bridge]);
    useEffect(() => {
        bridge.ontoolresult = result => setParsed(parseResult(result));
    }, [bridge]);

    if (!parsed) {
        return (
            <div className="flex items-center gap-2 p-4">
                <CircularProgress size="smallest"/>
                <Typography variant="body2" color="secondary">Loading…</Typography>
            </div>
        );
    }
    if (parsed.kind === "table") return <CollectionTable bridge={bridge}/>;
    if (parsed.kind === "error") {
        return <div className="p-4"><Alert color="error" size="small">{parsed.message}</Alert></div>;
    }
    return <RebaseScreen bridge={bridge} screen={parsed.screen} context={context}/>;
}
