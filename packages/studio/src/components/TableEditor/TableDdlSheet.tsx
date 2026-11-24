import React from "react";
import { useNavigate } from "react-router";
import { Button, IconButton, iconSize, Sheet, TerminalIcon, Typography, XIcon } from "@rebasepro/ui";
import { useTranslation } from "@rebasepro/app";
import { SqlBlock } from "./SqlBlock";
import { sqlDraftLink } from "./tableModel";

/** The table's definition as one SQL script, to read, copy, or take to the SQL editor. */
export function TableDdlSheet({ open, onOpenChange, title, ddl, loading }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title: string;
    ddl: string | null;
    loading: boolean;
}) {
    const { t } = useTranslation();
    const navigate = useNavigate();
    return (
        <Sheet open={open} onOpenChange={onOpenChange} title={t("studio_tables_ddl_title", { name: title })}>
            <div className="w-[min(720px,100vw)] h-full flex flex-col gap-4 p-5 bg-surface-card">
                <div className="flex items-center justify-between gap-2">
                    <Typography variant="subtitle1" className="font-mono truncate">{t("studio_tables_ddl_title", { name: title })}</Typography>
                    <IconButton size="small" aria-label={t("close")} onClick={() => onOpenChange(false)}>
                        <XIcon size={iconSize.smallest}/>
                    </IconButton>
                </div>
                <Typography variant="body2" color="secondary">{t("studio_tables_ddl_body")}</Typography>
                {loading || ddl === null
                    ? <Typography variant="body2" color="secondary">{t("loading")}</Typography>
                    : <SqlBlock sql={ddl} className="flex-1 min-h-0" maxHeight="max-h-full h-full"/>}
                <div className="flex justify-end">
                    <Button variant="outlined" disabled={!ddl} onClick={() => ddl && navigate(sqlDraftLink(ddl))}>
                        <TerminalIcon size={iconSize.smallest}/>
                        {t("studio_tables_ddl_open_in_sql")}
                    </Button>
                </div>
            </div>
        </Sheet>
    );
}
