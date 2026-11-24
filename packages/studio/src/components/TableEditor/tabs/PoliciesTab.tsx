import React from "react";
import { cls, defaultBorderMixin, Table, TableBody, TableCell, TableHeader, TableRow, Typography } from "@rebasepro/ui";
import { useTranslation } from "@rebasepro/app";
import { TablePolicies } from "../../RLSEditor/TablePolicies";
import { asPostgresPolicies, type DbTableInfo, type TableDetails } from "../tableModel";

/** Row level security for the table — the same editor as the RLS view — and who holds which privilege on it. */
export function PoliciesTab({ table, details, onChanged }: { table: DbTableInfo; details: TableDetails | null; onChanged: () => void }) {
    const { t } = useTranslation();
    const grantsByRole = new Map<string, { privileges: string[]; grantable: string[] }>();
    for (const grant of details?.grants ?? []) {
        const entry = grantsByRole.get(grant.grantee) ?? { privileges: [], grantable: [] };
        entry.privileges.push(grant.privilege);
        if (grant.grantable) entry.grantable.push(grant.privilege);
        grantsByRole.set(grant.grantee, entry);
    }

    return (
        <div className="flex flex-col gap-8 max-w-5xl">
            <TablePolicies
                key={table.key}
                schemaName={table.schema}
                tableName={table.name}
                rlsEnabled={table.rlsEnabled}
                policies={asPostgresPolicies(table)}
                onChanged={onChanged}
            />

            {details && (
                <div className="flex flex-col gap-2">
                    <Typography variant="subtitle2">{t("studio_tables_privileges_heading")}</Typography>
                    <Typography variant="body2" color="secondary">
                        {details.relation.defaultPrivileges
                            ? t("studio_tables_privileges_default", { owner: details.relation.owner })
                            : t("studio_tables_privileges_owner", { owner: details.relation.owner })}
                    </Typography>
                    {grantsByRole.size > 0 && (
                        <div className={cls("overflow-x-auto rounded-lg border", defaultBorderMixin)}>
                            <Table className="w-full">
                                <TableHeader>
                                    <TableCell header>{t("studio_tables_privileges_role")}</TableCell>
                                    <TableCell header>{t("studio_tables_privileges_granted")}</TableCell>
                                </TableHeader>
                                <TableBody>
                                    {[...grantsByRole.entries()].map(([role, entry]) => (
                                        <TableRow key={role}>
                                            <TableCell><Typography variant="mono" className="text-xs">{role}</Typography></TableCell>
                                            <TableCell>
                                                <Typography variant="mono" className="text-xs" color="secondary">
                                                    {entry.privileges.map(privilege => (entry.grantable.includes(privilege) ? `${privilege}*` : privilege)).join(", ")}
                                                </Typography>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                    {grantsByRole.size > 0 && <Typography variant="caption" color="secondary">{t("studio_tables_privileges_grantable_note")}</Typography>}
                </div>
            )}
        </div>
    );
}
