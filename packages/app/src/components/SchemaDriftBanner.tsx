import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import { Alert, Typography } from "@rebasepro/ui";

// ── Schema Drift Context ────────────────────────────────────────────────

interface SchemaDriftContextValue {
    /** Report a schema drift error (call from any data-loading hook). */
    reportSchemaDrift: (message: string) => void;
    /** The most recent schema drift message, or null. */
    schemaDriftMessage: string | null;
    /** Dismiss the banner for this session. */
    dismiss: () => void;
}

const SchemaDriftContext = createContext<SchemaDriftContextValue>({
    reportSchemaDrift: () => {},
    schemaDriftMessage: null,
    dismiss: () => {}
});

export function useSchemaDriftContext(): SchemaDriftContextValue {
    return useContext(SchemaDriftContext);
}

/**
 * Detects schema drift from an error object.
 * Checks both the error code (from `RebaseApiError`) and the message
 * for schema drift indicators.
 */
export function isSchemaDriftError(error: unknown): boolean {
    if (!error || typeof error !== "object") return false;
    // RebaseApiError from the SDK has a `code` property
    if ("code" in error && (error as { code?: string }).code === "SCHEMA_DRIFT") {
        return true;
    }
    // Fallback: check the message for the telltale phrase
    if (error instanceof Error && error.message.includes("Schema drift:")) {
        return true;
    }
    return false;
}

// ── Provider ─────────────────────────────────────────────────────────────

export function SchemaDriftProvider({ children }: { children: React.ReactNode }) {
    const [schemaDriftMessage, setSchemaDriftMessage] = useState<string | null>(null);
    const [dismissed, setDismissed] = useState(false);

    const reportSchemaDrift = useCallback((message: string) => {
        setSchemaDriftMessage(prev => prev ?? message);
    }, []);

    const dismiss = useCallback(() => {
        setDismissed(true);
    }, []);

    const value = useMemo<SchemaDriftContextValue>(() => ({
        reportSchemaDrift,
        schemaDriftMessage: dismissed ? null : schemaDriftMessage,
        dismiss
    }), [reportSchemaDrift, schemaDriftMessage, dismissed, dismiss]);

    return (
        <SchemaDriftContext.Provider value={value}>
            {children}
        </SchemaDriftContext.Provider>
    );
}

// ── Banner Component ─────────────────────────────────────────────────────

export interface SchemaDriftBannerProps {
    className?: string;
}

/**
 * Persistent banner shown when a schema drift error is detected.
 */
export function SchemaDriftBanner({ className }: SchemaDriftBannerProps) {
    const { schemaDriftMessage, dismiss } = useSchemaDriftContext();

    if (!schemaDriftMessage) return null;

    return (
        <Alert
            color="warning"
            size="small"
            onDismiss={dismiss}
            className={className}
        >
            <div className="flex flex-col gap-1">
                <Typography variant="label" className="text-amber-800 dark:text-amber-200">
                    Schema drift detected
                </Typography>
                <Typography variant="body2" className="text-amber-700 dark:text-amber-300">
                    {schemaDriftMessage}
                </Typography>
            </div>
        </Alert>
    );
}
