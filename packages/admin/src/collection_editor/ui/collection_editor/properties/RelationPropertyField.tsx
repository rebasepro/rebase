import { FieldCaption, useCollectionRegistryController } from "../../../_cms_internals";
import React, { useCallback, useEffect } from "react";
import { useFormex } from "@rebasepro/formex";
;
import {
    Select,
    SelectItem,
    TextField,
    Typography
} from "@rebasepro/ui";
import { SnapshotCollection, OnAction, RelationProperty } from "@rebasepro/types";

import { CollectionsSelect } from "./ReferencePropertyField";

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

    const relationName = values.relationName ?? "";
    const targetSlug = getTargetSlug(values.target);
    const cardinality = values.cardinality ?? "one";
    const direction = values.direction ?? "owning";
    const localKey = values.localKey ?? "";
    const foreignKeyOnTarget = values.foreignKeyOnTarget ?? "";
    const through = values.through;
    const throughTable = through?.table ?? "";
    const throughSourceColumn = through?.sourceColumn ?? "";
    const throughTargetColumn = through?.targetColumn ?? "";
    const onUpdate = values.onUpdate ?? "no action";
    const onDelete = values.onDelete ?? "no action";

    // Whether to show the junction table section
    const showThrough = cardinality === "many" && direction === "owning";
    // Whether to show the local key field
    const showLocalKey = direction === "owning" && cardinality === "one";
    // Whether to show the foreign key on target field
    const showForeignKey = direction === "inverse";

    const updateThrough = useCallback(
        (patch: Record<string, unknown>) => {
            const currentThrough = values.through ?? { table: "",
sourceColumn: "",
targetColumn: "" };
            setFieldValue("through", { ...currentThrough,
...patch });
        },
        [values.through, setFieldValue]
    );

    // Auto-generate relationName from target collection slug
    useEffect(() => {
        if (targetSlug && !relationName) {
            setFieldValue("relationName", targetSlug);
        }
    }, [targetSlug, relationName, setFieldValue]);

    const collections: SnapshotCollection[] = collectionRegistry?.collections ?? [];

    return (
        <>
            {/* ─── Target Collection ─── */}
            <div className={"col-span-12"}>
                <CollectionsSelect
                    disabled={disabled}
                    pathPath={"target"}
                    value={targetSlug}
                    setFieldValue={(_, value) => {
                        setFieldValue("target", value);
                        // Auto-generate relation name from target
                        if (!relationName || relationName === targetSlug) {
                            setFieldValue("relationName", value);
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
                        setFieldValue("relationName", e.target.value)
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

            {/* ─── Cardinality ─── */}
            <div className={"col-span-12 sm:col-span-6"}>
                <Select
                    value={cardinality}
                    onValueChange={(v) => setFieldValue("cardinality", v as "one" | "many")}
                    label={"Cardinality"}
                    disabled={disabled}
                    fullWidth
                    renderValue={(v) => v === "one" ? "One (has-one)" : "Many (has-many)"}
                >
                    <SelectItem value={"one"}>
                        <div>
                            <Typography variant={"body2"}>One (has-one)</Typography>
                            <Typography variant={"caption"} color={"secondary"}>
                                This property references a single record
                            </Typography>
                        </div>
                    </SelectItem>
                    <SelectItem value={"many"}>
                        <div>
                            <Typography variant={"body2"}>Many (has-many)</Typography>
                            <Typography variant={"caption"} color={"secondary"}>
                                This property references multiple records
                            </Typography>
                        </div>
                    </SelectItem>
                </Select>
                <FieldCaption>
                    Whether the relation returns one or multiple records
                </FieldCaption>
            </div>

            {/* ─── Direction ─── */}
            <div className={"col-span-12 sm:col-span-6"}>
                <Select
                    value={direction}
                    onValueChange={(v) => setFieldValue("direction", v as "owning" | "inverse")}
                    label={"Direction"}
                    disabled={disabled}
                    fullWidth
                    renderValue={(v) => v === "owning" ? "Owning" : "Inverse"}
                >
                    <SelectItem value={"owning"}>
                        <div>
                            <Typography variant={"body2"}>Owning</Typography>
                            <Typography variant={"caption"} color={"secondary"}>
                                This table stores the foreign key (or owns the junction table)
                            </Typography>
                        </div>
                    </SelectItem>
                    <SelectItem value={"inverse"}>
                        <div>
                            <Typography variant={"body2"}>Inverse</Typography>
                            <Typography variant={"caption"} color={"secondary"}>
                                The target table stores the foreign key pointing back here
                            </Typography>
                        </div>
                    </SelectItem>
                </Select>
                <FieldCaption>
                    Which side of the relation owns the persistence
                </FieldCaption>
            </div>

            {/* ─── Local Key (owning + one) ─── */}
            {showLocalKey && (
                <div className={"col-span-12"}>
                    <TextField
                        value={localKey}
                        onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
                            setFieldValue("localKey", e.target.value)
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
                            setFieldValue("foreignKeyOnTarget", e.target.value)
                        }
                        label={"Foreign key on target table"}
                        disabled={disabled}
                        placeholder={"e.g. post_id"}
                    />
                    <FieldCaption>
                        Column on the target table that references this table&apos;s primary key
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
                    onValueChange={(v) => setFieldValue("onUpdate", v as OnAction)}
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
                    onValueChange={(v) => setFieldValue("onDelete", v as OnAction)}
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
