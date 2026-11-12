/**
 * A show_app app as a Claude artifact: a page that keeps, that its owner can
 * share inside their organization, and that reads the project as whoever
 * opens it, through their own Rebase connector.
 *
 * The page carries the app and loads this script:
 *
 * ```html
 * <script type="application/json" id="rebase-app">
 *   {"connector": "Rebase", "project": "shop", "title": "Order desk", "tables": ["orders"]}
 * </script>
 * <script type="text/plain" id="rebase-app-code">
 *   export default function OrderDesk() { … }   // the same TSX show_app takes
 * </script>
 * <div id="root"></div>
 * <script type="module" src="…/rebase-artifact.js"></script>
 * ```
 *
 * It calls show_app with that code through the connector, and draws the
 * answer with the inline view's own runtime: the server compiles the app and
 * sends the tables, the viewer and the tools to use, exactly as for the
 * view in the conversation. Writes go through the same plan the person
 * confirms there.
 *
 * `project` is for the hosted connector, which reaches many projects; a
 * self-hosted server's own connector takes none.
 */
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { Alert, CircularProgress } from "@rebasepro/ui";
import { startGenericView } from "../app/main";
import { ArtifactBridge, documentTheme, type ArtifactMcp } from "./artifact_bridge";

export interface ArtifactAppConfig {
    /** The connector's display name in claude.ai. "Rebase" by default. */
    connector?: string;
    /** The project, by id or name, on the hosted connector. */
    project?: string;
    title?: string;
    /** The tables the app reads, as show_app takes them. */
    tables: string[];
    /** One TSX module, default-exporting a React component, as show_app takes it. */
    code: string;
}

/** The runtime's `window.claude`, where the page runs in a viewer. */
interface ArtifactRuntime {
    use(name: "mcp"): Promise<ArtifactMcp | null>;
}

export async function startArtifactApp(config: ArtifactAppConfig): Promise<void> {
    const status = statusLine();
    status.show(<span className="flex items-center gap-2 text-sm text-text-secondary"><CircularProgress size="small"/>Opening {config.title ?? "the app"}…</span>);

    const runtime = claudeRuntime();
    const mcp = runtime ? await runtime.use("mcp") : null;
    if (!mcp) {
        status.show(<Alert color="warning" size="small">Open this page in Claude, signed in, to load the app. It reads the project through your own Rebase connector.</Alert>);
        return;
    }

    const connector = config.connector ?? "Rebase";
    const bridge = new ArtifactBridge(mcp, connector);
    followTheme(bridge);
    startGenericView(bridge);
    try {
        const result = await bridge.callTool("show_app", {
            ...(config.project && { project: config.project }),
            ...(config.title && { title: config.title }),
            tables: config.tables,
            code: config.code
        });
        status.clear();
        bridge.deliver(result);
    } catch (error) {
        status.show(<Alert color="error" size="small">{error instanceof Error ? error.message : String(error)}</Alert>);
    }
}

/** The app the page carries, from its two script blocks; why not, if it cannot be read. */
export function readPageApp(doc: Document = document): ArtifactAppConfig | string {
    const configText = doc.getElementById("rebase-app")?.textContent;
    const code = doc.getElementById("rebase-app-code")?.textContent;
    if (!configText) return "This page has no #rebase-app block naming the app's tables.";
    if (!code || code.trim() === "") return "This page has no #rebase-app-code block with the app's code.";
    let parsed: unknown;
    try {
        parsed = JSON.parse(configText);
    } catch {
        return "The #rebase-app block is not valid JSON.";
    }
    if (typeof parsed !== "object" || parsed === null) return "The #rebase-app block must be an object.";
    const record: Record<string, unknown> = { ...parsed };
    const tables = Array.isArray(record.tables) ? record.tables.filter((name): name is string => typeof name === "string") : [];
    if (tables.length === 0) return "The #rebase-app block names no tables (\"tables\": [\"orders\"]).";
    const text = (value: unknown) => typeof value === "string" && value !== "" ? value : undefined;
    return {
        tables,
        code,
        ...(text(record.connector) && { connector: text(record.connector) }),
        ...(text(record.project) && { project: text(record.project) }),
        ...(text(record.title) && { title: text(record.title) })
    };
}

function claudeRuntime(): ArtifactRuntime | undefined {
    const candidate: unknown = Reflect.get(window, "claude");
    if (typeof candidate !== "object" || candidate === null) return undefined;
    const use: unknown = Reflect.get(candidate, "use");
    if (typeof use !== "function") return undefined;
    return { use: name => Promise.resolve(Reflect.apply(use, candidate, [name])) };
}

/** The viewer's theme, as they change it: their explicit choice or their system's. */
function followTheme(bridge: ArtifactBridge): void {
    const update = () => bridge.setTheme(documentTheme());
    new MutationObserver(update).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    if (typeof matchMedia === "function") matchMedia("(prefers-color-scheme: dark)").addEventListener("change", update);
}

/** A line above the app for what happens before it can draw. */
export function statusLine() {
    let root: Root | undefined;
    let container: HTMLElement | undefined;
    return {
        show(node: React.ReactNode) {
            if (!container) {
                container = document.createElement("div");
                container.className = "p-4";
                const appRoot = document.getElementById("root");
                if (appRoot) appRoot.before(container);
                else document.body.append(container);
                root = createRoot(container);
            }
            root?.render(node);
        },
        clear() {
            root?.unmount();
            container?.remove();
            root = undefined;
            container = undefined;
        }
    };
}

