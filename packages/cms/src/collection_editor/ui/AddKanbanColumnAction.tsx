
import React, { useCallback, useMemo, useState } from "react";
import {
    useSnackbarController,
    useTranslation
} from "@rebasepro/app";
import { getPropertyInPath } from "../_cms_internals";
import { EnumValueConfig, StringProperty } from "@rebasepro/types";
import { resolveEnumValues } from "@rebasepro/common";
import {
    Button,
    cls,
    defaultBorderMixin,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    IconButton,
    PlusIcon,
    TextField,
    Typography
} from "@rebasepro/ui";
import { useCollectionsConfigController } from "../useCollectionsConfigController";
import { toSnakeCase } from "@rebasepro/utils";
import type { AdminCollection } from "@rebasepro/cms-types";
import { isSchemaChangeCancelled } from "../liveSchemaClient";

/**
 * Component rendered at the end of the Kanban board to add new columns (enum values).
 * Opens a dialog to input a new enum value for the column property.
 */
export function AddKanbanColumnAction({
    collection,
    fullPath,
    parentCollectionSlugs, parentEntityIds,
    columnProperty
}: {
    collection: AdminCollection;
    fullPath: string;
    parentCollectionSlugs: string[], parentEntityIds: string[];
    columnProperty: string;
}) {
    const [dialogOpen, setDialogOpen] = useState(false);
    const [newValueLabel, setNewValueLabel] = useState("");
    const [saving, setSaving] = useState(false);

    const configController = useCollectionsConfigController();
    const snackbarController = useSnackbarController();
    const { t } = useTranslation();

    // Get current enum values
    const currentEnumValues = useMemo(() => {
        const property = getPropertyInPath(collection.properties, columnProperty);
        if (!property || !("type" in property) || property.type !== "string") {
            return [];
        }
        const stringProperty = property as StringProperty;
        if (!stringProperty.enum) {
            return [];
        }
        return resolveEnumValues(stringProperty.enum) ?? [];
    }, [collection, columnProperty]);

    const newId = toSnakeCase(newValueLabel.trim());
    /** A column whose id is already on the board: saving it would write a second value with that id. */
    const duplicate = newId ? currentEnumValues.find(ev => String(ev.id) === newId) : undefined;

    const handleAddColumn = useCallback(async () => {
        if (!newValueLabel.trim() || !configController || duplicate) return;

        const property = collection?.properties?.[columnProperty];
        if (!property || typeof property === "function" || !("type" in property) || property.type !== "string") {
            snackbarController.open({
                type: "error",
                message: t("studio_add_kanban_column_not_enum", { property: columnProperty })
            });
            return;
        }

        setSaving(true);
        try {
            // The values as they are, each kept whole — its colour and every
            // other field — and the new one after them.
            const updatedEnumValues: EnumValueConfig[] = [
                ...currentEnumValues.map(ev => ({ ...ev })),
                { id: newId, label: newValueLabel.trim() }
            ];

            await configController.saveProperty({
                path: fullPath,
                propertyKey: columnProperty,
                property: { ...property, enum: updatedEnumValues } as StringProperty,
                parentCollectionSlugs
            });

            setNewValueLabel("");
            setDialogOpen(false);
        } catch (error) {
            // Closing the review is the person's answer, not a failure.
            if (!isSchemaChangeCancelled(error)) {
                console.error("Error adding new column:", error);
                snackbarController.open({
                    type: "error",
                    message: error instanceof Error ? error.message : String(error)
                });
            }
        } finally {
            setSaving(false);
        }
    }, [newValueLabel, newId, duplicate, configController, collection, columnProperty, currentEnumValues, fullPath, parentCollectionSlugs, snackbarController, t]);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && newValueLabel.trim() && !duplicate) {
            handleAddColumn();
        }
    };

    return (
        <>
            <div
                className={cls(
                    "border h-full w-80 min-w-80 mx-2 flex flex-col items-center justify-center rounded-md",
                    "bg-surface-field hover:bg-surface-field-hover",
                    "cursor-pointer transition-colors duration-200 ease-in-out",
                    defaultBorderMixin
                )}
                onClick={() => setDialogOpen(true)}
            >
                <IconButton aria-label={t("studio_add_kanban_column")} className="opacity-60 hover:opacity-100">
                    <PlusIcon/>
                </IconButton>
                <Typography variant="caption" color="secondary" className="mt-2">
                    {t("studio_add_kanban_column")}
                </Typography>
            </div>

            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogTitle hidden>{t("studio_add_kanban_column_title")}</DialogTitle>
                <DialogContent className="max-w-md">
                    <Typography variant="h6" className="mb-4">
                        {t("studio_add_kanban_column_title")}
                    </Typography>
                    <Typography variant="body2" color="secondary" className="mb-4">
                        {t("studio_add_kanban_column_desc", { property: columnProperty })}
                    </Typography>
                    <TextField
                        label={t("studio_add_kanban_column_name")}
                        value={newValueLabel}
                        onChange={(e) => setNewValueLabel(e.target.value)}
                        onKeyDown={handleKeyDown}
                        autoFocus
                        disabled={saving}
                        error={Boolean(duplicate)}
                    />
                    {duplicate && <Typography variant="caption" color="error" className="mt-2 block">
                        {t("studio_add_kanban_column_exists", { label: duplicate.label ?? String(duplicate.id) })}
                    </Typography>}
                </DialogContent>
                <DialogActions>
                    <Button
                        variant="text"
                        onClick={() => setDialogOpen(false)}
                        disabled={saving}
                    >
                        {t("studio_add_kanban_column_cancel")}
                    </Button>
                    <Button
                        onClick={handleAddColumn}
                        disabled={saving || !newValueLabel.trim() || Boolean(duplicate)}
                    >
                        {saving ? t("studio_add_kanban_column_adding") : t("studio_add_kanban_column_add")}
                    </Button>
                </DialogActions>
            </Dialog>
        </>
    );
}
