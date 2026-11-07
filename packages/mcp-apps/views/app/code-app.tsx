/**
 * Running an app the model wrote (show_app): its compiled module, the
 * modules it may import, and what happens when it fails.
 *
 * The server compiled it to CommonJS with the source's line numbers
 * (`src/compile.ts`), refusing any import but `APP_MODULES`. Here it is
 * evaluated with a `require` that hands out those modules — the view's own
 * copies, so the app's components live in the same React tree as the admin
 * panel's — each one refusing, by name, an export it does not have.
 *
 * The code runs in this frame, as the view does: it reaches the project
 * through the same tools, as the same person, and the SDK has them confirm
 * every change it makes. A failure — at load or while drawing — is shown in
 * place of the app and told to the model, with the line it wrote.
 */
import React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import * as UI from "@rebasepro/ui";
import {
    BarChart,
    ChartCard,
    ChartStatus,
    KpiChange,
    KpiGrid,
    KpiReadout,
    KpiTile,
    SERIES_COLORS,
    TimeSeriesChart,
    compactFormat,
    describeChange,
    formatNumber,
    niceTicks
} from "@rebasepro/plugin-insights";
import { APP_MODULES, type AppModule } from "../../src/app-modules";
import { SDK_MODULE } from "./sdk";

/** The KPI tiles and charts: the building blocks of the insights plugin, not its engine. */
const INSIGHTS_MODULE = {
    BarChart, ChartCard, ChartStatus, KpiChange, KpiGrid, KpiReadout, KpiTile, SERIES_COLORS, TimeSeriesChart,
    compactFormat, describeChange, formatNumber, niceTicks
};

const MODULES: Record<AppModule, object> = {
    "react": React,
    "react/jsx-runtime": jsxRuntime,
    "@rebasepro/ui": UI,
    "@rebasepro/plugin-insights": INSIGHTS_MODULE,
    "@rebasepro/mcp-apps": SDK_MODULE
};

/** A module as the app sees it: a missing export is an error that names it, not `undefined` three calls later. */
function strict(name: string, exports: object): object {
    return new Proxy(exports, {
        get(target, property, receiver) {
            if (typeof property === "symbol" || property === "then") return Reflect.get(target, property, receiver);
            if (property === "__esModule") return true;
            if (property in target) return Reflect.get(target, property, receiver);
            // `import React from "react"`: the module is its own default.
            if (property === "default") return target;
            throw new Error(`"${property}" is not exported by "${name}".`);
        }
    });
}

const STRICT_MODULES = new Map(APP_MODULES.map(name => [name, strict(name, MODULES[name])]));

function requireModule(name: string): object {
    const found = STRICT_MODULES.get(name as AppModule);
    if (!found) throw new Error(`The app imports "${name}", which the view does not provide.`);
    return found;
}

type AppFactory = (require: (name: string) => object, module: { exports: Record<string, unknown> }, exports: Record<string, unknown>) => void;

declare global {
    interface Window {
        /** Where an app's module lands when it is evaluated as a script. */
        __rebaseApps?: Record<string, AppFactory>;
    }
}

/** The name a stack trace gives the app's code. */
const APP_SOURCE_URL = "rebase-app.js";

let loads = 0;

/**
 * The app's module as a function, and how many lines its code sits below
 * the line the model wrote.
 *
 * As a script element first: a sandbox that runs the view's own inline
 * scripts runs this one, and it keeps the source's line numbers. A host
 * whose policy refuses an inserted script may still allow `Function`, which
 * puts the code two lines down.
 */
function evaluate(code: string): { factory: AppFactory; lineOffset: number } {
    const id = `app${++loads}`;
    const registry = window.__rebaseApps ??= {};
    const script = document.createElement("script");
    script.textContent = `(window.__rebaseApps = window.__rebaseApps || {})[${JSON.stringify(id)}] = function (require, module, exports) {${code}\n};\n//# sourceURL=${APP_SOURCE_URL}`;
    document.head.appendChild(script);
    script.remove();
    const loaded = registry[id];
    delete registry[id];
    if (loaded) return { factory: loaded, lineOffset: 0 };
    try {
        // A script the policy refused leaves nothing behind; this is the other way in.
        const compiled = new Function("require", "module", "exports", `${code}\n//# sourceURL=${APP_SOURCE_URL}`);
        const factory: AppFactory = (require, module, exports) => compiled(require, module, exports);
        return { factory, lineOffset: 2 };
    } catch {
        throw new Error("This client's sandbox does not let the view run an app's code.");
    }
}

export interface LoadedApp {
    Component?: React.ComponentType;
    error?: AppError;
    lineOffset: number;
}

export interface AppError {
    message: string;
    /** The line of the model's source, where the trace names one. */
    line?: number;
}

/** Evaluate the app's module and take its default export. */
export function loadApp(code: string): LoadedApp {
    let lineOffset = 0;
    try {
        const evaluated = evaluate(code);
        lineOffset = evaluated.lineOffset;
        const module: { exports: Record<string, unknown> } = { exports: {} };
        evaluated.factory(requireModule, module, module.exports);
        const Component = module.exports.default;
        if (!isComponent(Component)) {
            return { error: { message: "The app's default export is not a component." }, lineOffset };
        }
        return { Component, lineOffset };
    } catch (error) {
        return { error: appErrorOf(error, lineOffset), lineOffset };
    }
}

/** A function component, or what `memo` and `forwardRef` make of one. */
function isComponent(value: unknown): value is React.ComponentType {
    return typeof value === "function" || (typeof value === "object" && value !== null && "$$typeof" in value);
}

/** An error's message, and the line of the app's code its trace points at. */
export function appErrorOf(error: unknown, lineOffset: number): AppError {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack ?? "" : "";
    const match = new RegExp(`${APP_SOURCE_URL.replace(".", "\\.")}:(\\d+)`).exec(stack);
    const line = match ? Number(match[1]) - lineOffset : undefined;
    return { message, ...(line !== undefined && line > 0 && { line }) };
}

/** What the model is told when the app fails, so the person's next message reaches it with the fix to make. */
export function describeAppError(error: AppError): string {
    return `The app opened with show_app failed: ${error.message}${error.line ? ` (line ${error.line} of its code)` : ""}. `
        + "Fix the code and call show_app again.";
}

interface BoundaryProps {
    lineOffset: number;
    onError: (error: AppError) => void;
    fallback: (error: AppError) => React.ReactNode;
    children: React.ReactNode;
}

/** Catches what the app throws while it draws. */
export class AppErrorBoundary extends React.Component<BoundaryProps, { error?: AppError }> {
    state: { error?: AppError } = {};

    static getDerivedStateFromError(): { error: AppError } {
        return { error: { message: "" } };
    }

    componentDidCatch(error: unknown): void {
        const described = appErrorOf(error, this.props.lineOffset);
        this.setState({ error: described });
        this.props.onError(described);
    }

    render(): React.ReactNode {
        return this.state.error ? this.props.fallback(this.state.error) : this.props.children;
    }
}
