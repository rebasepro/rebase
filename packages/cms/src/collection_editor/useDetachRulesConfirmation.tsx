import React, { useCallback, useRef, useState } from "react";
import { ConfirmationDialog, useTranslation } from "@rebasepro/app";

import { SchemaChangeCancelled } from "./liveSchemaClient";

/**
 * Asking before a table's inherited rules are replaced by rules of its own.
 *
 * A table whose `rls` is `"inherit"` follows `defaultRls`: a change there
 * reaches it. Saving edited rules writes them into the table's own `rls`, and
 * from then on `defaultRls` no longer applies to it. That is a decision, not a
 * side effect of pressing Save, so the save waits for it — and keeping
 * `"inherit"` (cancelling) writes nothing.
 */
export function useDetachRulesConfirmation(): {
    /** Resolves when the person agrees to detach `slug`; rejects with {@link SchemaChangeCancelled} when they keep `"inherit"`. */
    confirm: (slug: string) => Promise<void>;
    /** Render once beside the editor. */
    dialog: React.ReactNode;
} {
    const { t } = useTranslation();
    const [pending, setPending] = useState<string | undefined>();
    const settle = useRef<{ resolve: () => void; reject: (error: Error) => void } | undefined>(undefined);

    const confirm = useCallback((slug: string) => new Promise<void>((resolve, reject) => {
        settle.current?.reject(new SchemaChangeCancelled());
        settle.current = { resolve, reject };
        setPending(slug);
    }), []);

    const close = (accepted: boolean): void => {
        const current = settle.current;
        settle.current = undefined;
        setPending(undefined);
        if (accepted) current?.resolve();
        else current?.reject(new SchemaChangeCancelled());
    };

    const dialog = pending === undefined ? null : (
        <ConfirmationDialog
            open
            title={t("schema_rules_detach_title")}
            body={t("schema_rules_detach_body", { table: pending })}
            onAccept={() => close(true)}
            onCancel={() => close(false)}
        />
    );

    return { confirm, dialog };
}
