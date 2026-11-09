/**
 * EXPERIMENTAL. A saved app in the admin panel, run as Claude runs it: the
 * MCP App view in a frame, with this page as its host.
 *
 * The frame is sandboxed without `allow-same-origin`, so it has an opaque
 * origin: no cookies, no storage of the admin panel's, no reach into this
 * page. Its policy allows no network at all. Every read and write the app
 * makes is a message to this page, which relays it to the admin panel's MCP
 * endpoint as the person signed in, where it runs under their RLS — so stored
 * code someone else wrote can do nothing the viewer could not, and cannot
 * send their session anywhere.
 */
import React, { useEffect, useRef, useState } from "react";
import { Alert, CircularProgress, Typography } from "@rebasepro/ui";
import { isRecord, toolText, type AdminAppsClient, type AdminToolResult } from "./admin_apps_client";

/** The view document's address (`MCP_APP_URI` in `@rebasepro/server`). */
const VIEW_URI = "ui://rebase/app.html";

/** No network, no frames, no forms posted anywhere: only the document's own inline code and data. */
const FRAME_POLICY = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; "
    + "font-src data:; media-src data: blob:; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'";

/** The view document with the frame's policy at the top of its head. */
export function sandboxedViewDocument(html: string): string {
    const meta = `<meta http-equiv="Content-Security-Policy" content="${FRAME_POLICY}">`;
    return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, match => `${match}${meta}`) : `${meta}${html}`;
}

export function SavedAppFrame({ client, appId }: { client: AdminAppsClient; appId: string }) {
    const frame = useRef<HTMLIFrameElement>(null);
    const [document, setDocument] = useState<string>();
    const [opened, setOpened] = useState<AdminToolResult>();
    const [error, setError] = useState<string>();
    const [height, setHeight] = useState(640);

    // The view, and the app as open_app answers it.
    useEffect(() => {
        let cancelled = false;
        setError(undefined);
        Promise.all([
            client.request("resources/read", { uri: VIEW_URI }),
            client.callTool("open_app", { id: appId })
        ]).then(([read, result]) => {
            if (cancelled) return;
            const contents = isRecord(read) && Array.isArray(read.contents) ? read.contents : [];
            const html = contents.find(isRecord)?.text;
            if (typeof html !== "string") throw new Error("This backend serves no app view.");
            if (result.isError) throw new Error(toolText(result) ?? "The app could not be opened.");
            setOpened(result);
            setDocument(sandboxedViewDocument(html));
        }).catch((reason: unknown) => {
            if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
        });
        return () => {
            cancelled = true;
        };
    }, [client, appId]);

    // The host's half of the MCP Apps protocol, for the one frame.
    useEffect(() => {
        if (!opened) return;
        const target = () => frame.current?.contentWindow ?? null;
        const send = (message: Record<string, unknown>) => target()?.postMessage({ jsonrpc: "2.0", ...message }, "*");
        const theme = () => window.document.documentElement.classList.contains("dark") ? "dark" : "light";

        const receive = (event: MessageEvent) => {
            // Only the frame speaks to this host; its origin is opaque, so the window is the check.
            if (event.source === null || event.source !== target()) return;
            const message: unknown = event.data;
            if (!isRecord(message) || message.jsonrpc !== "2.0" || typeof message.method !== "string") return;
            const id = typeof message.id === "string" || typeof message.id === "number" ? message.id : undefined;
            const params = isRecord(message.params) ? message.params : {};
            const answer = (result: unknown) => id !== undefined && send({ id, result });
            const refuse = (text: string) => id !== undefined && send({ id, error: { code: -32000, message: text } });

            switch (message.method) {
                case "ui/initialize":
                    answer({
                        protocolVersion: params.protocolVersion,
                        hostInfo: { name: "rebase-admin", version: "0.1.0" },
                        hostCapabilities: {},
                        hostContext: { theme: theme(), displayMode: "inline", availableDisplayModes: ["inline"] }
                    });
                    return;
                case "ui/notifications/initialized":
                    send({ method: "ui/notifications/tool-result", params: opened });
                    return;
                case "tools/call": {
                    const name = typeof params.name === "string" ? params.name : "";
                    const args = isRecord(params.arguments) ? params.arguments : {};
                    client.callTool(name, args).then(answer, (reason: unknown) => refuse(reason instanceof Error ? reason.message : String(reason)));
                    return;
                }
                case "ui/notifications/size-changed":
                    if (typeof params.height === "number" && params.height > 0) setHeight(Math.ceil(params.height));
                    return;
                case "ui/request-display-mode":
                    answer({ mode: "inline" });
                    return;
                case "ui/update-model-context":
                    // No conversation to tell here.
                    answer({});
                    return;
                default:
                    refuse(`The admin panel does not answer ${message.method}.`);
            }
        };
        window.addEventListener("message", receive);
        return () => window.removeEventListener("message", receive);
    }, [opened, client]);

    if (error) return <Alert color="error" size="small">{error}</Alert>;
    if (!document) {
        return (
            <div className="flex items-center gap-2 p-4">
                <CircularProgress size="small"/>
                <Typography variant="body2" color="secondary">Opening the app…</Typography>
            </div>
        );
    }
    return (
        <iframe
            ref={frame}
            title="Saved app"
            sandbox="allow-scripts allow-forms"
            srcDoc={document}
            className="w-full rounded-xl border-0"
            style={{ height }}
        />
    );
}
