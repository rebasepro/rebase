import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import {
    BooleanSwitch,
    BooleanSwitchWithLabel,
    Button,
    Chip,
    cls,
    defaultBorderMixin,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    IconButton,
    iconSize,
    MultiSelect,
    MultiSelectItem,
    PencilIcon,
    PlusIcon,
    Select,
    SelectItem,
    Table,
    TableBody,
    TableCell,
    TableHeader,
    TableRow,
    TextField,
    Tooltip,
    Trash2Icon,
    Typography
} from "@rebasepro/ui";
import { useTranslation } from "@rebasepro/app";
import { useDdlConfirm } from "../DdlConfirm";
import {
    formatBytes,
    formatCount,
    sqlDraftLink,
    type CatalogColumn,
    type DbTableInfo,
    type TableDetails
} from "../tableModel";

export const SQL_TYPES = [
    "text",
    "varchar(255)",
    "integer",
    "bigint",
    "smallint",
    "numeric",
    "double precision",
    "real",
    "boolean",
    "uuid",
    "timestamptz",
    "timestamp",
    "date",
    "time",
    "jsonb",
    "json",
    "bytea",
    "text[]",
    "integer[]",
    "uuid[]"
] as const;

const FK_ACTIONS = ["NO ACTION", "RESTRICT", "CASCADE", "SET NULL", "SET DEFAULT"] as const;
const INDEX_METHODS = ["btree", "gin", "gist", "hash", "brin"] as const;

interface StructureTabProps {
    table: DbTableInfo;
    tables: readonly DbTableInfo[];
    details: TableDetails | null;
    onChanged: () => void;
}

function SectionHeader({ title, action }: { title: string; action?: React.ReactNode }) {
    return (
        <div className="flex items-center justify-between gap-3">
            <Typography variant="subtitle2">{title}</Typography>
            {action}
        </div>
    );
}

function Section({ children }: { children: React.ReactNode }) {
    return <div className={cls("overflow-x-auto rounded-lg border", defaultBorderMixin)}>{children}</div>;
}

/** Columns, indexes, constraints and triggers: everything the table is made of. */
export function StructureTab({ table, tables, details, onChanged }: StructureTabProps) {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const { confirm, dialog } = useDdlConfirm();
    const [columnDialog, setColumnDialog] = useState<{ mode: "add" } | { mode: "edit"; column: CatalogColumn } | null>(null);
    const [indexOpen, setIndexOpen] = useState(false);
    const [constraintOpen, setConstraintOpen] = useState(false);
    const base = `/admin/db/tables/${encodeURIComponent(table.name)}`;
    const isView = table.kind === "view";

    const columns: CatalogColumn[] = details?.columns ?? table.columns.map(column => ({
        name: column.name,
        type: column.dataType,
        udt: column.udtName,
        category: "S",
        notNull: !column.nullable,
        default: column.defaultExpr,
        identity: null,
        generated: null,
        primaryKey: column.primaryKey,
        comment: null
    }));
    const uniqueColumns = new Set(table.columns.filter(column => column.unique).map(column => column.name));
    const constraints = (details?.constraints ?? []).filter(constraint => constraint.kind !== "primary_key");
    const triggerTemplate = `CREATE OR REPLACE FUNCTION ${table.schema}.${table.name}_before_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    -- NEW.updated_at := now();
    RETURN NEW;
END $$;

CREATE TRIGGER ${table.name}_before_update
    BEFORE UPDATE ON ${table.schema}.${table.name}
    FOR EACH ROW EXECUTE FUNCTION ${table.schema}.${table.name}_before_update();`;

    return (
        <div className="flex flex-col gap-7">
            <div className="flex flex-col gap-2">
                <SectionHeader
                    title={t("studio_tables_columns_heading", { count: columns.length })}
                    action={!isView && (
                        <Button size="small" variant="outlined" onClick={() => setColumnDialog({ mode: "add" })}>
                            <PlusIcon size={iconSize.smallest}/>
                            {t("studio_tables_add_column")}
                        </Button>
                    )}
                />
                <Section>
                    <Table className="w-full">
                        <TableHeader>
                            <TableCell header>{t("studio_branch_diff_object_column")}</TableCell>
                            <TableCell header>{t("type")}</TableCell>
                            <TableCell header>{t("studio_tables_constraints")}</TableCell>
                            <TableCell header>{t("studio_tables_default")}</TableCell>
                            <TableCell header className="text-right">{t("actions")}</TableCell>
                        </TableHeader>
                        <TableBody>
                            {columns.map(column => (
                                <TableRow key={column.name}>
                                    <TableCell>
                                        <Typography variant="mono" className="text-sm font-medium">{column.name}</Typography>
                                        {column.comment && <Typography variant="caption" color="secondary" className="block">{column.comment}</Typography>}
                                    </TableCell>
                                    <TableCell><Typography variant="mono" className="text-xs" color="secondary">{column.type}</Typography></TableCell>
                                    <TableCell>
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                            {column.primaryKey && <Chip size="smallest" colorScheme="blueLight">PK</Chip>}
                                            {column.notNull && !column.primaryKey && <Chip size="smallest">NOT NULL</Chip>}
                                            {uniqueColumns.has(column.name) && !column.primaryKey && <Chip size="smallest" colorScheme="purpleLight">UNIQUE</Chip>}
                                            {column.identity && <Chip size="smallest">IDENTITY</Chip>}
                                            {column.generated && <Chip size="smallest">GENERATED</Chip>}
                                            {table.foreignKeys.some(fk => fk.fromColumns.includes(column.name)) && <Chip size="smallest" colorScheme="tealLight">FK</Chip>}
                                        </div>
                                    </TableCell>
                                    <TableCell><Typography variant="mono" className="text-xs" color="secondary">{column.default ?? "—"}</Typography></TableCell>
                                    <TableCell className="text-right whitespace-nowrap">
                                        {!isView && (
                                            <>
                                                <Tooltip title={t("studio_tables_edit_column", { name: column.name })}>
                                                    <IconButton size="small" aria-label={t("studio_tables_edit_column", { name: column.name })}
                                                        onClick={() => setColumnDialog({ mode: "edit", column })}>
                                                        <PencilIcon size={iconSize.smallest}/>
                                                    </IconButton>
                                                </Tooltip>
                                                {!column.primaryKey && (
                                                    <Tooltip title={t("studio_tables_drop_column", { name: column.name })}>
                                                        <IconButton size="small" aria-label={t("studio_tables_drop_column", { name: column.name })}
                                                            onClick={() => void confirm({
                                                                title: t("studio_tables_drop_column", { name: column.name }),
                                                                path: `${base}/columns/${encodeURIComponent(column.name)}`,
                                                                method: "DELETE",
                                                                body: { schema: table.schema, confirm: column.name },
                                                                destructive: true,
                                                                done: t("studio_tables_column_dropped", { name: column.name }),
                                                                onDone: onChanged
                                                            })}>
                                                            <Trash2Icon size={iconSize.smallest}/>
                                                        </IconButton>
                                                    </Tooltip>
                                                )}
                                            </>
                                        )}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </Section>
            </div>

            <div className="flex flex-col gap-2">
                <SectionHeader
                    title={t("studio_tables_indexes_heading", { count: details?.indexes.length ?? table.indexes.length })}
                    action={table.kind === "table" && (
                        <Button size="small" variant="outlined" onClick={() => setIndexOpen(true)}>
                            <PlusIcon size={iconSize.smallest}/>
                            {t("studio_tables_add_index")}
                        </Button>
                    )}
                />
                <Section>
                    <Table className="w-full">
                        <TableHeader>
                            <TableCell header>{t("name")}</TableCell>
                            <TableCell header>{t("studio_tables_definition")}</TableCell>
                            <TableCell header className="text-right">{t("studio_tables_index_size")}</TableCell>
                            <TableCell header className="text-right">{t("studio_tables_index_scans")}</TableCell>
                            <TableCell header className="text-right">{t("actions")}</TableCell>
                        </TableHeader>
                        <TableBody>
                            {(details?.indexes ?? table.indexes.map(index => ({ ...index, method: "", valid: true, backsConstraint: index.primary, bytes: null, scans: null, tuplesRead: null, tuplesFetched: null }))).map(index => (
                                <TableRow key={index.name}>
                                    <TableCell className="whitespace-nowrap">
                                        <div className="flex items-center gap-1.5">
                                            <Typography variant="mono" className="text-xs">{index.name}</Typography>
                                            {index.primary && <Chip size="smallest" colorScheme="blueLight">PK</Chip>}
                                            {index.unique && !index.primary && <Chip size="smallest" colorScheme="purpleLight">UNIQUE</Chip>}
                                            {!index.valid && <Chip size="smallest" colorScheme="redLight">{t("studio_tables_index_invalid")}</Chip>}
                                        </div>
                                    </TableCell>
                                    <TableCell><Typography variant="mono" className="text-xs" color="secondary">{index.definition}</Typography></TableCell>
                                    <TableCell className="text-right"><Typography variant="body2" className="tabular-nums">{formatBytes(index.bytes)}</Typography></TableCell>
                                    <TableCell className="text-right"><Typography variant="body2" className="tabular-nums">{formatCount(index.scans)}</Typography></TableCell>
                                    <TableCell className="text-right">
                                        {!index.backsConstraint && (
                                            <IconButton size="small" aria-label={t("studio_tables_drop_index", { name: index.name })}
                                                onClick={() => void confirm({
                                                    title: t("studio_tables_drop_index", { name: index.name }),
                                                    path: `${base}/indexes/${encodeURIComponent(index.name)}`,
                                                    method: "DELETE",
                                                    body: { schema: table.schema },
                                                    destructive: true,
                                                    done: t("studio_tables_index_dropped", { name: index.name }),
                                                    onDone: onChanged
                                                })}>
                                                <Trash2Icon size={iconSize.smallest}/>
                                            </IconButton>
                                        )}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </Section>
            </div>

            {details && table.kind === "table" && (
                <div className="flex flex-col gap-2">
                    <SectionHeader
                        title={t("studio_tables_constraints_heading", { count: constraints.length })}
                        action={
                            <Button size="small" variant="outlined" onClick={() => setConstraintOpen(true)}>
                                <PlusIcon size={iconSize.smallest}/>
                                {t("studio_tables_add_constraint")}
                            </Button>
                        }
                    />
                    {constraints.length === 0 ? (
                        <div className="rounded-lg bg-surface-field/50 px-4 py-3">
                            <Typography variant="body2" color="secondary">{t("studio_tables_no_constraints")}</Typography>
                        </div>
                    ) : (
                        <Section>
                            <Table className="w-full">
                                <TableHeader>
                                    <TableCell header>{t("name")}</TableCell>
                                    <TableCell header>{t("type")}</TableCell>
                                    <TableCell header>{t("studio_tables_definition")}</TableCell>
                                    <TableCell header className="text-right">{t("actions")}</TableCell>
                                </TableHeader>
                                <TableBody>
                                    {constraints.map(constraint => (
                                        <TableRow key={constraint.name} className="group">
                                            <TableCell><Typography variant="mono" className="text-xs">{constraint.name}</Typography></TableCell>
                                            <TableCell><Typography variant="body2">{t(`studio_tables_constraint_${constraint.kind}`)}</Typography></TableCell>
                                            <TableCell><Typography variant="mono" className="text-xs" color="secondary">{constraint.definition}</Typography></TableCell>
                                            <TableCell className="text-right">
                                                <IconButton
                                                    size="small"
                                                    className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity hover:text-red-500"
                                                    aria-label={t("studio_tables_drop_constraint", { name: constraint.name })}
                                                    onClick={() => void confirm({
                                                        title: t("studio_tables_drop_constraint", { name: constraint.name }),
                                                        path: `${base}/constraints/${encodeURIComponent(constraint.name)}`,
                                                        method: "DELETE",
                                                        body: { schema: table.schema },
                                                        destructive: true,
                                                        done: t("studio_tables_constraint_dropped", { name: constraint.name }),
                                                        onDone: onChanged
                                                    })}>
                                                    <Trash2Icon size={iconSize.smallest}/>
                                                </IconButton>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </Section>
                    )}
                </div>
            )}

            {details && table.kind === "table" && (
                <div className="flex flex-col gap-2">
                    <SectionHeader
                        title={t("studio_tables_triggers_heading", { count: details.triggers.length })}
                        action={
                            <Button size="small" variant="outlined" onClick={() => navigate(sqlDraftLink(triggerTemplate))}>
                                <PlusIcon size={iconSize.smallest}/>
                                {t("studio_tables_new_trigger")}
                            </Button>
                        }
                    />
                    {details.triggers.length === 0 ? (
                        <div className="rounded-lg bg-surface-field/50 px-4 py-3">
                            <Typography variant="body2" color="secondary">{t("studio_tables_no_triggers")}</Typography>
                        </div>
                    ) : (
                        <Section>
                            <Table className="w-full">
                                <TableHeader>
                                    <TableCell header>{t("name")}</TableCell>
                                    <TableCell header>{t("studio_tables_definition")}</TableCell>
                                    <TableCell header>{t("studio_tables_trigger_enabled")}</TableCell>
                                    <TableCell header className="text-right">{t("actions")}</TableCell>
                                </TableHeader>
                                <TableBody>
                                    {details.triggers.map(trigger => (
                                        <TableRow key={trigger.name}>
                                            <TableCell><Typography variant="mono" className="text-xs">{trigger.name}</Typography></TableCell>
                                            <TableCell><Typography variant="mono" className="text-xs" color="secondary">{trigger.definition}</Typography></TableCell>
                                            <TableCell>
                                                <BooleanSwitch
                                                    size="small"
                                                    value={trigger.enabled}
                                                    onValueChange={(enabled) => void confirm({
                                                        title: t(enabled ? "studio_tables_enable_trigger" : "studio_tables_disable_trigger", { name: trigger.name }),
                                                        path: `${base}/triggers/${encodeURIComponent(trigger.name)}`,
                                                        method: "PATCH",
                                                        body: { schema: table.schema, enabled },
                                                        done: t(enabled ? "studio_tables_trigger_enabled_done" : "studio_tables_trigger_disabled_done", { name: trigger.name }),
                                                        onDone: onChanged
                                                    })}
                                                />
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <IconButton size="small" aria-label={t("studio_tables_drop_trigger", { name: trigger.name })}
                                                    onClick={() => void confirm({
                                                        title: t("studio_tables_drop_trigger", { name: trigger.name }),
                                                        path: `${base}/triggers/${encodeURIComponent(trigger.name)}`,
                                                        method: "DELETE",
                                                        body: { schema: table.schema },
                                                        destructive: true,
                                                        done: t("studio_tables_trigger_dropped", { name: trigger.name }),
                                                        onDone: onChanged
                                                    })}>
                                                    <Trash2Icon size={iconSize.smallest}/>
                                                </IconButton>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </Section>
                    )}
                </div>
            )}

            {columnDialog && (
                <ColumnDialog
                    table={table}
                    tables={tables}
                    column={columnDialog.mode === "edit" ? columnDialog.column : null}
                    onClose={() => setColumnDialog(null)}
                    onSubmit={(change) => {
                        setColumnDialog(null);
                        void confirm({ ...change, onDone: onChanged });
                    }}
                />
            )}
            {indexOpen && (
                <IndexDialog
                    table={table}
                    columns={columns}
                    onClose={() => setIndexOpen(false)}
                    onSubmit={(change) => {
                        setIndexOpen(false);
                        void confirm({ ...change, onDone: onChanged });
                    }}
                />
            )}
            {constraintOpen && (
                <ConstraintDialog
                    table={table}
                    tables={tables}
                    columns={columns}
                    onClose={() => setConstraintOpen(false)}
                    onSubmit={(change) => {
                        setConstraintOpen(false);
                        void confirm({ ...change, onDone: onChanged });
                    }}
                />
            )}
            {dialog}
        </div>
    );
}

type Submission = { title: string; path: string; method: "POST" | "PATCH"; body: Record<string, unknown>; done: string };

function ColumnDialog({ table, tables, column, onClose, onSubmit }: {
    table: DbTableInfo;
    tables: readonly DbTableInfo[];
    column: CatalogColumn | null;
    onClose: () => void;
    onSubmit: (change: Submission) => void;
}) {
    const { t } = useTranslation();
    const [name, setName] = useState(column?.name ?? "");
    const [type, setType] = useState(column?.type ?? "text");
    const [nullable, setNullable] = useState(column ? !column.notNull : true);
    const [unique, setUnique] = useState(false);
    const [defaultExpr, setDefaultExpr] = useState(column?.default ?? "");
    const [using, setUsing] = useState("");
    const [refTable, setRefTable] = useState("");
    const [refColumn, setRefColumn] = useState("");
    const [onDelete, setOnDelete] = useState<string>("NO ACTION");
    const types = useMemo(() => (column && !SQL_TYPES.some(candidate => candidate === column.type) ? [column.type, ...SQL_TYPES] : [...SQL_TYPES]), [column]);
    const target = tables.find(candidate => candidate.key === refTable);
    const typeChanged = column !== null && type !== column.type;
    const base = `/admin/db/tables/${encodeURIComponent(table.name)}`;

    const submit = () => {
        if (column) {
            const body: Record<string, unknown> = { schema: table.schema };
            if (name.trim() && name.trim() !== column.name) body.renameTo = name.trim();
            if (typeChanged) {
                body.type = type;
                if (using.trim()) body.using = using.trim();
            }
            if (nullable !== !column.notNull) body.nullable = nullable;
            if ((defaultExpr.trim() || null) !== (column.default ?? null)) body.default = defaultExpr.trim() || null;
            if (Object.keys(body).length === 1) {
                onClose();
                return;
            }
            onSubmit({
                title: t("studio_tables_edit_column", { name: column.name }),
                path: `${base}/columns/${encodeURIComponent(column.name)}`,
                method: "PATCH",
                body,
                done: t("studio_tables_column_updated", { name: name.trim() || column.name })
            });
            return;
        }
        onSubmit({
            title: t("studio_tables_add_column_to", { name: table.name }),
            path: `${base}/columns`,
            method: "POST",
            body: {
                schema: table.schema,
                name: name.trim(),
                type,
                nullable,
                unique,
                ...(defaultExpr.trim() ? { default: defaultExpr.trim() } : {}),
                ...(target && refColumn ? { references: { schema: target.schema, table: target.name, column: refColumn, onDelete } } : {})
            },
            done: t("studio_tables_column_added", { name: name.trim() })
        });
    };

    return (
        <Dialog open onOpenChange={(open) => { if (!open) onClose(); }} maxWidth="md" fullWidth>
            <DialogTitle>{column ? t("studio_tables_edit_column", { name: column.name }) : t("studio_tables_add_column_to", { name: table.name })}</DialogTitle>
            <DialogContent className="flex flex-col gap-3">
                <TextField label={t("studio_tables_column_name")} value={name} onChange={(event) => setName(event.target.value)} placeholder="status"/>
                <Select label={t("studio_tables_sql_type")} value={type} onValueChange={(value) => setType(String(value))}>
                    {types.map(candidate => <SelectItem key={candidate} value={candidate}>{candidate}</SelectItem>)}
                </Select>
                {typeChanged && (
                    <TextField
                        label={t("studio_tables_type_using")}
                        value={using}
                        onChange={(event) => setUsing(event.target.value)}
                        placeholder={`${column?.name ?? "column"}::${type}`}
                    />
                )}
                <TextField label={t("studio_tables_default_expr")} value={defaultExpr} onChange={(event) => setDefaultExpr(event.target.value)} placeholder="'draft'"/>
                <BooleanSwitchWithLabel label={t("studio_tables_nullable")} value={nullable} onValueChange={setNullable}/>
                {!column && <BooleanSwitchWithLabel label={t("unique")} value={unique} onValueChange={setUnique}/>}
                {!column && (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <Select label={t("studio_tables_references_table")} value={refTable} onValueChange={(value) => { setRefTable(String(value)); setRefColumn(""); }}>
                            {tables.filter(candidate => candidate.kind === "table").map(candidate => (
                                <SelectItem key={candidate.key} value={candidate.key}>{candidate.name}</SelectItem>
                            ))}
                        </Select>
                        <Select label={t("studio_tables_references_column")} value={refColumn} disabled={!target} onValueChange={(value) => setRefColumn(String(value))}>
                            {(target?.columns ?? []).map(candidate => <SelectItem key={candidate.name} value={candidate.name}>{candidate.name}</SelectItem>)}
                        </Select>
                        <Select label={t("studio_tables_on_delete")} value={onDelete} disabled={!target} onValueChange={(value) => setOnDelete(String(value))}>
                            {FK_ACTIONS.map(action => <SelectItem key={action} value={action}>{action}</SelectItem>)}
                        </Select>
                    </div>
                )}
            </DialogContent>
            <DialogActions>
                <Button variant="text" onClick={onClose}>{t("cancel")}</Button>
                <Button variant="filled" color="primary" disabled={!name.trim()} onClick={submit}>{t("studio_tables_review_sql")}</Button>
            </DialogActions>
        </Dialog>
    );
}

function IndexDialog({ table, columns, onClose, onSubmit }: {
    table: DbTableInfo;
    columns: readonly CatalogColumn[];
    onClose: () => void;
    onSubmit: (change: Submission) => void;
}) {
    const { t } = useTranslation();
    const [selected, setSelected] = useState<string[]>([]);
    const [unique, setUnique] = useState(false);
    const [method, setMethod] = useState<string>("btree");
    const [name, setName] = useState("");
    return (
        <Dialog open onOpenChange={(open) => { if (!open) onClose(); }} maxWidth="md" fullWidth>
            <DialogTitle>{t("studio_tables_create_index_on", { name: table.name })}</DialogTitle>
            <DialogContent className="flex flex-col gap-3">
                <MultiSelect label={t("studio_tables_index_columns")} value={selected} onValueChange={setSelected}>
                    {columns.map(column => <MultiSelectItem key={column.name} value={column.name}>{column.name}</MultiSelectItem>)}
                </MultiSelect>
                <Select label={t("studio_tables_index_method")} value={method} onValueChange={(value) => setMethod(String(value))}>
                    {INDEX_METHODS.map(candidate => <SelectItem key={candidate} value={candidate}>{candidate}</SelectItem>)}
                </Select>
                <TextField label={t("studio_tables_index_name_optional")} value={name} onChange={(event) => setName(event.target.value)}/>
                <BooleanSwitchWithLabel label={t("studio_tables_unique_index")} value={unique} onValueChange={setUnique}/>
            </DialogContent>
            <DialogActions>
                <Button variant="text" onClick={onClose}>{t("cancel")}</Button>
                <Button variant="filled" color="primary" disabled={selected.length === 0}
                    onClick={() => onSubmit({
                        title: t("studio_tables_create_index_on", { name: table.name }),
                        path: `/admin/db/tables/${encodeURIComponent(table.name)}/indexes`,
                        method: "POST",
                        body: { schema: table.schema, columns: selected, unique, method, ...(name.trim() ? { name: name.trim() } : {}) },
                        done: t("studio_tables_index_created")
                    })}>
                    {t("studio_tables_review_sql")}
                </Button>
            </DialogActions>
        </Dialog>
    );
}

function ConstraintDialog({ table, tables, columns, onClose, onSubmit }: {
    table: DbTableInfo;
    tables: readonly DbTableInfo[];
    columns: readonly CatalogColumn[];
    onClose: () => void;
    onSubmit: (change: Submission) => void;
}) {
    const { t } = useTranslation();
    const [kind, setKind] = useState<"foreign_key" | "unique" | "check">("foreign_key");
    const [selected, setSelected] = useState<string[]>([]);
    const [refTable, setRefTable] = useState("");
    const [refColumns, setRefColumns] = useState<string[]>([]);
    const [onDelete, setOnDelete] = useState<string>("NO ACTION");
    const [expression, setExpression] = useState("");
    const [name, setName] = useState("");
    const target = tables.find(candidate => candidate.key === refTable);
    const ready = kind === "check" ? expression.trim() !== "" : selected.length > 0 && (kind !== "foreign_key" || (target !== undefined && refColumns.length === selected.length));

    const submit = () => {
        const body: Record<string, unknown> = { schema: table.schema, kind, ...(name.trim() ? { name: name.trim() } : {}) };
        if (kind === "check") body.expression = expression.trim();
        else body.columns = selected;
        if (kind === "foreign_key" && target) body.references = { schema: target.schema, table: target.name, columns: refColumns, onDelete };
        onSubmit({
            title: t("studio_tables_add_constraint"),
            path: `/admin/db/tables/${encodeURIComponent(table.name)}/constraints`,
            method: "POST",
            body,
            done: t("studio_tables_constraint_added")
        });
    };

    return (
        <Dialog open onOpenChange={(open) => { if (!open) onClose(); }} maxWidth="md" fullWidth>
            <DialogTitle>{t("studio_tables_add_constraint")}</DialogTitle>
            <DialogContent className="flex flex-col gap-3">
                <Select label={t("type")} value={kind} onValueChange={(value) => {
                    if (value === "foreign_key" || value === "unique" || value === "check") setKind(value);
                }}>
                    <SelectItem value="foreign_key">{t("studio_tables_constraint_foreign_key")}</SelectItem>
                    <SelectItem value="unique">{t("studio_tables_constraint_unique")}</SelectItem>
                    <SelectItem value="check">{t("studio_tables_constraint_check")}</SelectItem>
                </Select>
                {kind !== "check" && (
                    <MultiSelect label={t("studio_columns")} value={selected} onValueChange={setSelected}>
                        {columns.map(column => <MultiSelectItem key={column.name} value={column.name}>{column.name}</MultiSelectItem>)}
                    </MultiSelect>
                )}
                {kind === "foreign_key" && (
                    <>
                        <Select label={t("studio_tables_references_table")} value={refTable} onValueChange={(value) => { setRefTable(String(value)); setRefColumns([]); }}>
                            {tables.filter(candidate => candidate.kind === "table").map(candidate => (
                                <SelectItem key={candidate.key} value={candidate.key}>{candidate.name}</SelectItem>
                            ))}
                        </Select>
                        <MultiSelect label={t("studio_tables_references_columns")} value={refColumns} onValueChange={setRefColumns} disabled={!target}>
                            {(target?.columns ?? []).map(column => <MultiSelectItem key={column.name} value={column.name}>{column.name}</MultiSelectItem>)}
                        </MultiSelect>
                        <Select label={t("studio_tables_on_delete")} value={onDelete} onValueChange={(value) => setOnDelete(String(value))}>
                            {FK_ACTIONS.map(action => <SelectItem key={action} value={action}>{action}</SelectItem>)}
                        </Select>
                    </>
                )}
                {kind === "check" && (
                    <TextField label={t("studio_tables_check_expression")} value={expression} onChange={(event) => setExpression(event.target.value)} placeholder="price >= 0"/>
                )}
                <TextField label={t("studio_tables_constraint_name_optional")} value={name} onChange={(event) => setName(event.target.value)}/>
            </DialogContent>
            <DialogActions>
                <Button variant="text" onClick={onClose}>{t("cancel")}</Button>
                <Button variant="filled" color="primary" disabled={!ready} onClick={submit}>{t("studio_tables_review_sql")}</Button>
            </DialogActions>
        </Dialog>
    );
}
