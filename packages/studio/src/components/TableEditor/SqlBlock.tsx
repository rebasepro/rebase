import React from "react";
import { cls, CopyIcon, IconButton, iconSize, Tooltip, Typography } from "@rebasepro/ui";
import { useSnackbarController, useTranslation } from "@rebasepro/app";

/** SQL to read and copy: a well with the statements in the mono face and a copy button. */
export function SqlBlock({ sql, className, maxHeight = "max-h-80" }: { sql: string; className?: string; maxHeight?: string }) {
    const { t } = useTranslation();
    const snackbar = useSnackbarController();
    return (
        <div className={cls("relative rounded-lg bg-surface-field", className)}>
            <div className="absolute right-1.5 top-1.5">
                <Tooltip title={t("copy")}>
                    <IconButton
                        size="small"
                        aria-label={t("copy")}
                        onClick={() => {
                            void navigator.clipboard.writeText(sql).then(() => snackbar.open({ type: "success", message: t("copied") }));
                        }}
                    >
                        <CopyIcon size={iconSize.smallest}/>
                    </IconButton>
                </Tooltip>
            </div>
            <Typography variant="mono" component="div" className={cls("p-3 pr-10 text-xs whitespace-pre-wrap break-words overflow-auto", maxHeight)}>
                {sql}
            </Typography>
        </div>
    );
}
