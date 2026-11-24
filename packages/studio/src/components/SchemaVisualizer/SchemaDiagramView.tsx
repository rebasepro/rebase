import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { CircularProgress, cls, defaultBorderMixin, Typography } from "@rebasepro/ui";
import { useTableDescriptors, useTranslation } from "@rebasepro/app";
import { useAdminFetch } from "../../utils/adminFetch";
import { parseTablesResponse, tablesLink, type DbTableInfo } from "../TableEditor/tableModel";
import { schemaSourceProblem, SchemaSourceProblemView } from "../schema-source";
import { TablesDiagram } from "./TablesDiagram";

/**
 * The schema diagram as a page of its own: for a host without the Tables view
 * (the hosted console), and for links to the diagram's own route.
 *
 * The database's catalog is read from `/api/admin/db/tables` when the backend
 * serves it; a backend that does not still gets the diagram of the tables it
 * declares.
 */
export function SchemaDiagramView({ linksToTables }: { linksToTables: boolean }) {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const { requestJson } = useAdminFetch();
    const descriptors = useTableDescriptors();
    const [catalog, setCatalog] = useState<DbTableInfo[] | null>(null);

    useEffect(() => {
        let current = true;
        requestJson("/admin/db/tables")
            .then(raw => { if (current) setCatalog(parseTablesResponse(raw)); })
            // No catalog route on this backend: the declared tables are the diagram.
            .catch(() => { if (current) setCatalog([]); });
        return () => {
            current = false;
        };
    }, [requestJson]);

    const problem = schemaSourceProblem(descriptors);
    const hasDeclared = descriptors.tables.some(table => table.kind === "table");
    const hasCatalog = (catalog ?? []).some(table => table.kind === "table");

    if (problem && !hasDeclared && !hasCatalog && catalog !== null) {
        return <SchemaSourceProblemView problem={problem}/>;
    }
    // Still loading and nothing to draw are different answers.
    if (catalog === null || (descriptors.status === "loading" && !hasCatalog)) {
        return (
            <div className="flex items-center justify-center h-full w-full">
                <div className="text-center flex flex-col items-center gap-3">
                    <CircularProgress size="small"/>
                    <Typography variant="body2" color="secondary">{t("studio_schema_loading")}</Typography>
                </div>
            </div>
        );
    }
    if (!hasDeclared && !hasCatalog) {
        return (
            <div className="flex items-center justify-center h-full w-full p-6">
                <div className="max-w-md text-center flex flex-col gap-2">
                    <Typography variant="subtitle2">{t("studio_schema_no_tables_declared")}</Typography>
                    <Typography variant="body2" color="secondary">{t("studio_schema_no_tables_declared_body")}</Typography>
                    <Typography variant="body2" color="secondary">{t("studio_schema_introspect_hint")}</Typography>
                </div>
            </div>
        );
    }

    const schema = catalog[0]?.schema ?? "public";
    return (
        <div className="flex flex-col h-full w-full bg-surface-card overflow-hidden">
            <div className={cls("flex flex-col justify-center px-4 border-b bg-surface-sheet h-[42px] shrink-0", defaultBorderMixin)}>
                <Typography variant="subtitle2">{t("studio_tool_schema_visualizer")}</Typography>
                <Typography variant="caption" color="secondary" className="truncate">
                    {hasCatalog ? t("studio_tables_diagram_source_catalog") : t("studio_schema_visualizer_source")}
                </Typography>
            </div>
            <div className="flex-1 min-h-0">
                <TablesDiagram
                    catalog={catalog}
                    onOpenTable={linksToTables ? (name) => navigate(tablesLink(`${schema}.${name}`)) : undefined}
                />
            </div>
        </div>
    );
}
