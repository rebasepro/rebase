
import React, { ErrorInfo, PropsWithChildren } from "react";

import { AlertCircleIcon, ShieldAlertIcon, RefreshCwIcon, ArrowLeftIcon, ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { iconSize } from "../icons/Icon";
import { Typography } from "./Typography";
import { Button } from "./Button";
import { cls } from "../util";
import { isChunkLoadError } from "../util/lazy_chunk";

/**
 * The one error a user can fix themselves. A deploy replaces the hashed chunk
 * files, so a tab opened before it cannot load any lazy view it has not already
 * fetched — with the browser's raw message ("Failed to fetch dynamically
 * imported module: …") this reads as a broken build rather than a stale tab.
 */
const CHUNK_ERROR_DESCRIPTION =
    "This app was updated while the tab was open, so part of it could not be loaded. Reload to continue.";

/**
 * Checks whether the error message relates to missing permissions or
 * authorization failures. Used to show a friendlier message in fullPage mode.
 */
function isPermissionError(error: Error | null): boolean {
    if (!error) return false;
    const msg = error.message?.toLowerCase() ?? "";
    const code = (error as { code?: string }).code?.toLowerCase() ?? "";
    return msg.includes("permission")
        || msg.includes("insufficient")
        || msg.includes("unauthorized")
        || msg.includes("forbidden")
        || msg.includes("access denied")
        || code === "permission_denied"
        || code === "insufficient_permissions"
        || (error as { status?: number }).status === 403;
}

export interface ErrorBoundaryProps {
    /**
     * When true, renders a full-page centered error screen instead of the
     * compact inline error. Intended for wrapping top-level app roots or
     * major route sections.
     */
    fullPage?: boolean;
    /**
     * Optional callback invoked when the user clicks "Try again". If provided,
     * the boundary resets its error state and calls this handler. If omitted,
     * the "Try again" button resets the boundary state, re-mounting children.
     */
    onReset?: () => void;
}

interface ErrorBoundaryState {
    error: Error | null;
    showDetails: boolean;
}

export class ErrorBoundary extends React.Component<PropsWithChildren<ErrorBoundaryProps>, ErrorBoundaryState> {
    constructor(props: PropsWithChildren<ErrorBoundaryProps>) {
        super(props);
        this.state = { error: null,
showDetails: false };
    }

    static getDerivedStateFromError(error: Error) {
        return { error };
    }

    componentDidCatch(error: Error, _errorInfo: ErrorInfo) {
        console.error(error);
    }

    private handleReset = () => {
        this.setState({ error: null,
showDetails: false });
        this.props.onReset?.();
    };

    private handleReload = () => {
        window.location.reload();
    };

    private toggleDetails = () => {
        this.setState(prev => ({ showDetails: !prev.showDetails }));
    };

    render() {
        if (this.state.error) {
            if (this.props.fullPage) {
                return this.renderFullPage();
            }
            return this.renderInline();
        }

        return this.props.children;
    }

    private renderInline() {
        const isStaleChunk = isChunkLoadError(this.state.error);
        return (
            <div className="flex flex-col m-2 items-start">
                <div className="flex items-center m-2">
                    {isStaleChunk
                        ? <RefreshCwIcon className={"text-text-secondary dark:text-text-secondary-dark"}
                                         size={iconSize.small}/>
                        : <AlertCircleIcon className={"text-red-500 dark:text-red-400"} size={iconSize.small}/>}
                    <div className="ml-4">{isStaleChunk ? "New version available" : "Error"}</div>
                </div>
                <Typography variant={"caption"}>
                    {isStaleChunk
                        ? CHUNK_ERROR_DESCRIPTION
                        : this.state.error?.message ?? "See the error in the console"}
                </Typography>
                {isStaleChunk && <Button variant="outlined"
                                         color="neutral"
                                         size="small"
                                         className="mt-3 ml-2"
                                         onClick={this.handleReload}>
                    <RefreshCwIcon size={16}/>
                    Reload
                </Button>}
            </div>
        );
    }

    private renderFullPage() {
        const { error, showDetails } = this.state;
        const isPermission = isPermissionError(error);
        // Neither a fault nor a denial: the app is fine, this tab is behind it.
        const isStaleChunk = !isPermission && isChunkLoadError(error);

        const Icon = isPermission ? ShieldAlertIcon : isStaleChunk ? RefreshCwIcon : AlertCircleIcon;
        const title = isPermission
            ? "Access denied"
            : isStaleChunk
                ? "New version available"
                : "Something went wrong";
        const description = isPermission
            ? "You don't have permission to access this resource. Please check your account permissions or contact your administrator."
            : isStaleChunk
                ? CHUNK_ERROR_DESCRIPTION
                : "An unexpected error occurred. You can try reloading the page or going back.";

        return (
            <div className={cls(
                "flex items-center justify-center min-h-[400px] h-full w-full",
                "bg-surface-50 dark:bg-surface-950"
            )}>
                <div className="flex flex-col items-center max-w-md px-6 py-10 text-center">
                    <div className={cls(
                        "flex items-center justify-center w-14 h-14 rounded-xl mb-6",
                        isPermission
                            ? "bg-amber-100 dark:bg-amber-900/30"
                            : isStaleChunk
                                ? "bg-surface-100 dark:bg-surface-800"
                                : "bg-red-100 dark:bg-red-900/30"
                    )}>
                        <Icon
                            size={28}
                            className={isPermission
                                ? "text-amber-600 dark:text-amber-400"
                                : isStaleChunk
                                    ? "text-text-secondary dark:text-text-secondary-dark"
                                    : "text-red-500 dark:text-red-400"}
                        />
                    </div>

                    <Typography variant={"h6"}
                                className="text-text-primary dark:text-text-primary-dark mb-2">
                        {title}
                    </Typography>

                    <Typography variant={"body2"}
                                className="text-text-secondary dark:text-text-secondary-dark mb-8">
                        {description}
                    </Typography>

                    <div className="flex gap-3">
                        {/* React caches a `lazy()` rejection: re-mounting the
                            children re-throws without re-running the import, so
                            "Try again" cannot recover a missing chunk. */}
                        {!isStaleChunk && <Button
                            variant="outlined"
                            color="neutral"
                            size="medium"
                            onClick={this.handleReset}
                        >
                            <ArrowLeftIcon size={16}/>
                            Try again
                        </Button>}
                        <Button
                            variant="filled"
                            color="primary"
                            size="medium"
                            onClick={this.handleReload}
                        >
                            <RefreshCwIcon size={16}/>
                            Reload page
                        </Button>
                    </div>

                    {/* For a stale chunk the message *is* the description
                        above; repeating it under a disclosure adds nothing. */}
                    {!isStaleChunk && error?.message && (
                        <div className="mt-8 w-full">
                            <button
                                onClick={this.toggleDetails}
                                className={cls(
                                    "flex items-center gap-1 mx-auto text-xs",
                                    "text-text-disabled dark:text-text-disabled-dark",
                                    "hover:text-text-secondary dark:hover:text-text-secondary-dark",
                                    "transition-colors cursor-pointer bg-transparent border-none p-0"
                                )}
                            >
                                Technical details
                                {showDetails
                                    ? <ChevronUpIcon size={14}/>
                                    : <ChevronDownIcon size={14}/>}
                            </button>
                            {showDetails && (
                                <div className={cls(
                                    "mt-3 p-3 rounded-lg text-left text-xs",
                                    "bg-surface-100 dark:bg-surface-800/50",
                                    "text-text-secondary dark:text-text-secondary-dark",
                                    "font-mono break-all"
                                )}>
                                    {error.message}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        );
    }
}
