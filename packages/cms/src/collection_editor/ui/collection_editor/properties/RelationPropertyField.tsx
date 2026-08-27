import { FieldCaption, useCollectionRegistryController } from "../../../_cms_internals";
import React, { useCallback, useEffect } from "react";
import { useFormex } from "@rebasepro/forms";
;
import {
    Select,
    SelectItem,
    TextField,
    Typography
} from "@rebasepro/ui";
import { OnAction, RelationProperty, RelationKind, JoinStep } from "@rebasepro/types";
import {
    RELATION_KINDS,
    RELATION_KIND_ORDER,
    kindUsesForeignKeyOnTarget,
    kindUsesJoinPath,
    kindUsesLocalKey,
    kindUsesThrough
} from "../../../relation_kinds";

import { CollectionsSelect } from "./ReferencePropertyField";
import type { AdminCollection } from "@rebasepro/cms-types";

const ON_ACTION_OPTIONS: OnAction[] = ["cascade", "restrict", "no action", "set null", "set default"];

function getTargetSlug(target?: string | (() => string | { slug: string } | Record<string, unknown>)): string {
    if (!target) return "";
    if (typeof target === "string") return target;
    try {
        const resolved = target();
        if (typeof resolved === "string") return resolved;
        if (resolved && typeof resolved === "object" && "slug" in resolved && typeof resolved.slug === "string") {
            return resolved.slug;
        }
        return "";
    } catch {
        return "";
    }
}

/**
 * Property editor form for `type: "relation"` properties.
 *
 * This component edits the `RelationProperty` fields on the property itself (target, relationName, etc.)
 */
export function RelationPropertyField({
    disabled,
    showErrors
}: {
    disabled: boolean;
    showErrors: boolean;
}) {
    const {
        values,
        errors,
        setFieldValue
    } = useFormex<RelationProperty & { id?: string }>();

    const collectionRegistry = useCollectionRegistryController();

    // The link lives under `relation` now, and its `kind` decides which of the
    // fields below even exist — which is what drives the conditional sections.
    const link = (values.relation ?? {}) as Record<string, any>;
    const kind = (link.kind ?? "belongsTo") as RelationKind;

    const relationName = link.relationName ?? "";
    const targetSlug = getTargetSlug(link.target);
    const localKey = link.localKey ?? "";
    const foreignKeyOnTarget = link.foreignKeyOnTarget ?? "";
    const sourceKey = link.sourceKey ?? "";
    const through = link.through;
    const throughTable = through?.table ?? "";
    const throughSourceColumn = through?.sourceColumn ?? "";
    const throughTargetColumn = through?.targetColumn ?? "";
    const onUpdate = link.onUpdate ?? "no action";
    const onDelete = link.onDelete ?? "no action";

    const showThrough = kindUsesThrough(kind);
    const showLocalKey = kindUsesLocalKey(kind);
    const showForeignKey = kindUsesForeignKeyOnTarget(kind);
    const showJoinPath = kindUsesJoinPath(kind);

    const updateThrough = useCallback(
        (patch: Record<string, unknown>) => {
            const currentThrough = link.through ?? { table: "",
sourceColumn: "",
targetColumn: "" };
            setFieldValue("relation.through", { ...currentThrough,
...patch });
        },
        [link.through, setFieldValue]
    );

    // Auto-generate relationName from target collection slug
    useEffect(() => {
        if (targetSlug && !relationName) {
            setFieldValue("relation.relationName", targetSlug);
        }
    }, [targetSlug, relationName, setFieldValue]);

    const collections: AdminCollection[] = collectionRegistry?.collections ?? [];

    return (
        <>
            {/* ─── Target Collection ─── */}
            <div className={"col-span-12"}>
                <CollectionsSelect
                    disabled={disabled}
                    pathPath={"target"}
                    value={targetSlug}
                    setFieldValue={(_, value) => {
                        setFieldValue("relation.target", value);
                        // Auto-generate relation name from target
                        if (!relationName || relationName === targetSlug) {
                            setFieldValue("relation.relationName", value);
                        }
                    }}
                    error={showErrors && !targetSlug ? "You must select a target collection" : undefined}
                />
                <FieldCaption error={showErrors && !targetSlug}>
                    {showErrors && !targetSlug
                        ? "You must select a target collection"
                        : "The collection this relation points to"}
                </FieldCaption>
            </div>

            {/* ─── Relation Name ─── */}
            <div className={"col-span-12"}>
                <TextField
                    value={relationName}
                    onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
                        setFieldValue("relation.relationName", e.target.value)
                    }
                    label={"Relation name"}
                    disabled={disabled}
                    error={showErrors && !relationName}
                />
                <FieldCaption error={showErrors && !relationName}>
                    {showErrors && !relationName
                        ? "Required"
                        : "Identifier for this relation (used to link the property to the relation config)"}
                </FieldCaption>
            </div>

            {/* ─── Kind ─── */}
            <div className={"col-span-12"}>
                <Select
                    value={kind}
                    onValueChange={(v) => setFieldValue("relation.kind", v as RelationKind)}
                    label={"Kind"}
                    disabled={disabled}
                    fullWidth
                    renderValue={(v) => RELATION_KINDS[v as RelationKind]?.label ?? v}
                >
                    {RELATION_KIND_ORDER.map((k) => (
                        <SelectItem key={k} value={k}>
                            <div>
                                <Typography variant={"body2"}>{RELATION_KINDS[k].label}</Typography>
                                <Typography variant={"caption"} color={"secondary"}>
                                    {RELATION_KINDS[k].description}
                                </Typography>
                            </div>
                        </SelectItem>
                    ))}
                </Select>
                <FieldCaption>
                    Which side holds the key, and whether this yields one row or many
                </FieldCaption>
            </div>

            {/* ─── Local Key (owning + one) ─── */}
            {showLocalKey && (
                <div className={"col-span-12"}>
                    <TextField
                        value={localKey}
                        onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
                            setFieldValue("relation.localKey", e.target.value)
                        }
                        label={"Local key (foreign key column on this table)"}
                        disabled={disabled}
                        placeholder={"e.g. author_id"}
                    />
                    <FieldCaption>
                        Column on this table that references the target&apos;s primary key
                    </FieldCaption>
                </div>
            )}

            {/* ─── Foreign Key on Target (inverse) ─── */}
            {showForeignKey && (
                <div className={"col-span-12"}>
                    <TextField
                        value={foreignKeyOnTarget}
                        onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
                            setFieldValue("relation.foreignKeyOnTarget", e.target.value)
                        }
                        label={"Foreign key on target table"}
                        disabled={disabled}
                        placeholder={"e.g. post_id"}
                    />
                    <FieldCaption>
                        Column on the target table that references this table&apos;s primary key
                    </FieldCaption>
                    <TextField
                        className={"mt-4"}
                        value={sourceKey}
                        onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
                            setFieldValue("relation.sourceKey", e.target.value)
                        }
                        label={"Source key (optional)"}
                        disabled={disabled}
                        placeholder={"defaults to this table's primary key"}
                    />
                    <FieldCaption>
                        Column on <em>this</em> table that the foreign key above points at. Leave empty
                        unless the two sides are joined on a natural key — an external identity id, a
                        SKU — rather than on the row id. It must be unique.
                    </FieldCaption>
                </div>
            )}

            {/* ─── Join path (via) ─── */}
            {showJoinPath && (
                <div className={"col-span-12"}>
                    <Typography variant={"label"} className={"mb-2"}>
                        Join path
                    </Typography>
                    <FieldCaption>
                        A <code>via</code> relation is reached by joining across several tables, and is
                        read-only — Rebase will not guess which hop to write to. Its <code>joinPath</code>
                        {" "}is edited in the collection&apos;s Relations tab, or in code, where the whole
                        chain is visible at once.
                        {(link.joinPath as JoinStep[] | undefined)?.length
                            ? ` Currently ${(link.joinPath as JoinStep[]).length} step(s).`
                            : " No steps are configured yet, so this relation will return nothing."}
                    </FieldCaption>
                </div>
            )}

            {/* ─── Junction Table (many + owning) ─── */}
            {showThrough && (
                <div className={"col-span-12"}>
                    <Typography variant={"label"} className={"mb-2"}>
                        Junction table (many-to-many)
                    </Typography>
                    <div className={"grid grid-cols-12 gap-4"}>
                        <div className={"col-span-12"}>
                            <TextField
                                value={throughTable}
                                onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
                                    updateThrough({ table: e.target.value })
                                }
                                label={"Junction table name"}
                                disabled={disabled}
                                placeholder={"e.g. user_roles"}
                            />
                            <FieldCaption>
                                Name of the intermediate table that connects both collections
                            </FieldCaption>
                        </div>
                        <div className={"col-span-12 sm:col-span-6"}>
                            <TextField
                                value={throughSourceColumn}
                                onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
                                    updateThrough({ sourceColumn: e.target.value })
                                }
                                label={"Source column"}
                                disabled={disabled}
                                placeholder={"e.g. user_id"}
                            />
                            <FieldCaption>
                                Column in the junction table referencing this table
                            </FieldCaption>
                        </div>
                        <div className={"col-span-12 sm:col-span-6"}>
                            <TextField
                                value={throughTargetColumn}
                                onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
                                    updateThrough({ targetColumn: e.target.value })
                                }
                                label={"Target column"}
                                disabled={disabled}
                                placeholder={"e.g. role_id"}
                            />
                            <FieldCaption>
                                Column in the junction table referencing the target table
                            </FieldCaption>
                        </div>
                    </div>
                </div>
            )}

            {/* ─── Cascade Actions ─── */}
            <div className={"col-span-12 sm:col-span-6"}>
                <Select
                    value={onUpdate}
                    onValueChange={(v) => setFieldValue("relation.onUpdate", v as OnAction)}
                    label={"On update"}
                    disabled={disabled}
                    fullWidth
                    renderValue={(v) => String(v)}
                >
                    {ON_ACTION_OPTIONS.map((action) => (
                        <SelectItem key={action} value={action}>
                            {action}
                        </SelectItem>
                    ))}
                </Select>
                <FieldCaption>
                    Action when the referenced record is updated
                </FieldCaption>
            </div>

            <div className={"col-span-12 sm:col-span-6"}>
                <Select
                    value={onDelete}
                    onValueChange={(v) => setFieldValue("relation.onDelete", v as OnAction)}
                    label={"On delete"}
                    disabled={disabled}
                    fullWidth
                    renderValue={(v) => String(v)}
                >
                    {ON_ACTION_OPTIONS.map((action) => (
                        <SelectItem key={action} value={action}>
                            {action}
                        </SelectItem>
                    ))}
                </Select>
                <FieldCaption>
                    Action when the referenced record is deleted
                </FieldCaption>
            </div>
        </>
    );
}
