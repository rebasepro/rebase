import React from "react";
import { useNavigate } from "react-router";
import {
    ArrowRightIcon,
    Button,
    cls,
    defaultBorderMixin,
    iconSize,
    Table,
    TableBody,
    TableCell,
    TableHeader,
    TableRow,
    Typography
} from "@rebasepro/ui";
import { useTranslation } from "@rebasepro/app";
import { TablesDiagram } from "../../SchemaVisualizer/TablesDiagram";
import { TABLES_VIEW_PARAM, TABLE_PARAM, tablesLink, type DbForeignKey, type DbTableInfo, type TableDetails } from "../tableModel";

function ForeignKeyTable({ title, foreignKeys, direction, empty }: {
    title: string;
    foreignKeys: readonly DbForeignKey[];
    direction: "outgoing" | "incoming";
    empty: string;
}) {
    const { t } = useTranslation();
    const navigate = useNavigate();
    return (
        <div className="flex flex-col gap-2">
            <Typography variant="subtitle2">{title}</Typography>
            {foreignKeys.length === 0 ? (
                <Typography variant="body2" color="secondary">{empty}</Typography>
            ) : (
                <div className={cls("overflow-x-auto rounded-lg border", defaultBorderMixin)}>
                    <Table className="w-full">
                        <TableHeader>
                            <TableCell header>{direction === "outgoing" ? t("studio_columns") : t("studio_tables_relations_from")}</TableCell>
                            <TableCell header>{direction === "outgoing" ? t("studio_tables_relations_references") : t("studio_columns")}</TableCell>
                            <TableCell header>{t("studio_tables_on_delete")}</TableCell>
                            <TableCell header>{t("name")}</TableCell>
                        </TableHeader>
                        <TableBody>
                            {foreignKeys.map(fk => {
                                const otherKey = direction === "outgoing" ? `${fk.toSchema}.${fk.toTable}` : `${fk.fromSchema}.${fk.fromTable}`;
                                const otherLabel = direction === "outgoing"
                                    ? `${fk.toTable}(${fk.toColumns.join(", ")})`
                                    : `${fk.fromTable}(${fk.fromColumns.join(", ")})`;
                                return (
                                    <TableRow key={`${fk.fromTable}.${fk.name}`}>
                                        <TableCell>
                                            {direction === "outgoing"
                                                ? <Typography variant="mono" className="text-xs">{fk.fromColumns.join(", ")}</Typography>
                                                : <Button size="small" variant="text" onClick={() => navigate(tablesLink(otherKey, "relations"))}>
                                                    <Typography variant="mono" className="text-xs">{otherLabel}</Typography>
                                                </Button>}
                                        </TableCell>
                                        <TableCell>
                                            {direction === "outgoing"
                                                ? <Button size="small" variant="text" onClick={() => navigate(tablesLink(otherKey, "relations"))}>
                                                    <ArrowRightIcon size={iconSize.smallest}/>
                                                    <Typography variant="mono" className="text-xs">{otherLabel}</Typography>
                                                </Button>
                                                : <Typography variant="mono" className="text-xs">{fk.toColumns.join(", ")}</Typography>}
                                        </TableCell>
                                        <TableCell><Typography variant="mono" className="text-xs" color="secondary">{fk.onDelete}</Typography></TableCell>
                                        <TableCell><Typography variant="mono" className="text-xs" color="secondary">{fk.name}</Typography></TableCell>
                                    </TableRow>
                                );
                            })}
                        </TableBody>
                    </Table>
                </div>
            )}
        </div>
    );
}

/** What the table points at and what points at it: the foreign keys both ways, and its neighbourhood drawn. */
export function RelationsTab({ table, tables, details }: { table: DbTableInfo; tables: readonly DbTableInfo[]; details: TableDetails | null }) {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const outgoing = details?.foreignKeys.outgoing ?? table.foreignKeys;
    const incoming = details?.foreignKeys.incoming
        ?? tables.flatMap(other => other.foreignKeys.filter(fk => fk.toTable === table.name && fk.toSchema === table.schema));

    return (
        <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-3">
                    <Typography variant="subtitle2">{t("studio_tables_relations_diagram")}</Typography>
                    <Button size="small" variant="text"
                        onClick={() => navigate(`/tables?${new URLSearchParams({ [TABLES_VIEW_PARAM]: "diagram", [TABLE_PARAM]: table.key }).toString()}`)}>
                        {t("studio_tables_relations_open_diagram")}
                    </Button>
                </div>
                <div className={cls("h-[420px] rounded-lg border overflow-hidden", defaultBorderMixin)}>
                    <TablesDiagram
                        catalog={tables}
                        focusTable={table.name}
                        alwaysFocus
                        compact
                        onOpenTable={(name) => {
                            if (name !== table.name) navigate(tablesLink(`${table.schema}.${name}`, "relations"));
                        }}
                    />
                </div>
            </div>
            <ForeignKeyTable
                title={t("studio_tables_relations_outgoing", { count: outgoing.length })}
                foreignKeys={outgoing}
                direction="outgoing"
                empty={t("studio_tables_relations_outgoing_none")}
            />
            <ForeignKeyTable
                title={t("studio_tables_relations_incoming", { count: incoming.length })}
                foreignKeys={incoming}
                direction="incoming"
                empty={t("studio_tables_relations_incoming_none")}
            />
        </div>
    );
}
