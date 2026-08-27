
import { IconForView, useTranslation } from "@rebasepro/app";
import { FieldCaption } from "../../_cms_internals";
import React, { useState } from "react";

import { SearchIconsView } from "../../_cms_internals";

import {
    BooleanSwitchWithLabel,
    Chip,
    cls,
    Container,
    DebouncedTextField,
    Dialog,
    ExpandablePanel,
    HistoryIcon,
    IconButton,
    iconSize,
    SearchIcon,
    Select,
    SelectItem,
    TextField,
    Tooltip,
    Typography
} from "@rebasepro/ui";
import { Field, getIn, useFormex } from "@rebasepro/forms";
import { useCollectionsConfigController } from "../../useCollectionsConfigController";
import { singular, toSnakeCase } from "@rebasepro/utils";
import type { ExtraCollectionFieldsParams } from "../../extensibility_types";
import { toSerializableCollectionConfig } from "../../serializable_utils";
import type { AdminCollection, AdminPostgresCollection } from "@rebasepro/cms-types";

export function GeneralSettingsForm({
    isNewCollection,
    existingPaths,
    existingIds,
    parentCollection,
    renderExtraCollectionFields,
    standalone,
}: {
    isNewCollection: boolean;
    existingPaths?: string[];
    existingIds?: string[];
    parentCollection?: AdminCollection;
    renderExtraCollectionFields?: (params: ExtraCollectionFieldsParams) => React.ReactNode;
    standalone?: boolean;
}) {

    const {
        values,
        setFieldValue,
        handleChange,
        touched,
        errors,
        setFieldTouched,
        submitCount
    } = useFormex<AdminPostgresCollection>();

    const [iconDialogOpen, setIconDialogOpen] = useState(false);

    const configControllerFromContext = useCollectionsConfigController();
    const configController = standalone ? { readOnly: false } : configControllerFromContext;

    const updateDatabaseId = (databaseId: string) => {
        setFieldValue("databaseId", databaseId ?? undefined);
    }

    const updateName = (name: string) => {
        setFieldValue("name", name);

        const pathTouched = getIn(touched, "table");
        if (!pathTouched && isNewCollection && name) {
            setFieldValue("table", toSnakeCase(name));
        }

        const idTouched = getIn(touched, "slug");
        if (!idTouched && isNewCollection && name) {
            setFieldValue("slug", toSnakeCase(name));
        }

        const singularNameTouched = getIn(touched, "singularName");
        if (!singularNameTouched && isNewCollection && name) {
            setFieldValue("singularName", singular(name));
        }
    };

    const collectionIcon = <IconForView collectionOrView={values}/>;
    const isSubcollection = !!parentCollection;
    const showErrors = submitCount > 0;

    return (
        <div className={"overflow-auto my-auto"}>
            <Container maxWidth={"4xl"} className={"flex flex-col gap-4 p-8 m-auto"}>

                <div>
                    <div className="flex flex-row gap-2 items-center">
                        <Typography variant={!isNewCollection ? "h5" : "h4"} className={"flex-grow"}>
                            {isNewCollection ? "New collection" : `${values?.name} collection`}
                        </Typography>
                        <DefaultDatabaseField databaseId={values.databaseId}
                            disabled={configController?.readOnly}
                            onDatabaseIdUpdate={updateDatabaseId}/>

                        <Tooltip title={"Change icon"}
                            asChild={true}>
                            <IconButton
                                shape={"square"}
                                disabled={configController?.readOnly}
                                onClick={() => setIconDialogOpen(true)}>
                                {collectionIcon}
                            </IconButton>
                        </Tooltip>
                    </div>

                    {parentCollection && <Chip colorScheme={"teal"}>
                        <Typography variant={"caption"}>
                            This is a subcollection of <b>{parentCollection.name}</b>
                        </Typography>
                    </Chip>}

                </div>

                <fieldset disabled={configController?.readOnly} className="contents">
                    <div className={"grid grid-cols-12 gap-4"}>

                        {/* Name */}
                        <div className={"col-span-12"}>
                            <TextField
                                value={values.name ?? ""}
                                onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => updateName(e.target.value)}
                                label={"Name"}
                                autoFocus={true}
                                required
                                error={showErrors && Boolean(errors.name)}/>
                            <FieldCaption error={touched.name && Boolean(errors.name)}>
                                {touched.name && Boolean(errors.name) ? errors.name : "Name of this collection, usually a plural name (e.g. Products)"}
                            </FieldCaption>
                        </div>

                        {/* Table name */}
                        <div className={cls("col-span-12")}>
                            <Field name={"table"}
                                as={DebouncedTextField}
                                label={"Table name"}
                                required
                                error={showErrors && Boolean(errors.table)}/>

                            <FieldCaption error={touched.table && Boolean(errors.table)}>
                                {touched.table && Boolean(errors.table)
                                    ? errors.table
                                    : isSubcollection ? "Relative path to the parent (no need to include the parent path)" : "PostgreSQL table name for this collection"}
                            </FieldCaption>
                        </div>

                        {/* Singular Name */}
                        <div className={"col-span-12"}>
                            <TextField
                                error={showErrors && Boolean(errors.singularName)}
                                name={"singularName"}
                                aria-describedby={"singularName-helper"}
                                onChange={(e) => {
                                    setFieldTouched("singularName", true);
                                    return handleChange(e);
                                }}
                                value={values.singularName ?? ""}
                                label={"Singular name"}/>
                            <FieldCaption error={showErrors && Boolean(errors.singularName)}>
                                {showErrors && Boolean(errors.singularName) ? errors.singularName : "Optionally define a singular name for your entities"}
                            </FieldCaption>
                        </div>

                        {/* Description */}
                        <div className={"col-span-12"}>
                            <TextField
                                error={showErrors && Boolean(errors.description)}
                                name="description"
                                value={values.description ?? ""}
                                onChange={handleChange}
                                multiline
                                minRows={2}
                                aria-describedby="description-helper-text"
                                label="Description"
                            />
                            <FieldCaption error={showErrors && Boolean(errors.description)}>
                                {showErrors && Boolean(errors.description) ? errors.description : "Description of the collection, you can use markdown"}
                            </FieldCaption>
                        </div>

                        {/* Collection ID */}
                        <div className={"col-span-12"}>
                            <DebouncedTextField
                                name={"slug"}
                                value={values.slug ?? ""}
                                onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setFieldValue("slug", e.target.value)}
                                disabled={!isNewCollection}
                                label={"Collection ID"}
                                error={showErrors && Boolean(errors.slug)}/>
                            <FieldCaption error={touched.slug && Boolean(errors.slug)}>
                                {touched.slug && Boolean(errors.slug) ? errors.slug : "This ID identifies this collection. Typically the same as the path."}
                            </FieldCaption>
                        </div>

                    </div>

                    {/* Advanced Settings */}
                    {/* eslint-disable-next-line no-constant-condition */}
                    {false ? <ExpandablePanel
                        title={<Typography variant="subtitle2">Advanced settings</Typography>}
                        initiallyExpanded={false}
                        className="mt-4"
                        innerClassName="p-4 flex flex-col gap-4"
                    >
                        {/* HistoryIcon revisions */}
                        <div>
                            <BooleanSwitchWithLabel
                                position={"start"}
                                allowIndeterminate={true}
                                label={<span className="flex items-center gap-2"><HistoryIcon size={iconSize.smallest}/>{values.history === null || values.history === undefined ? "Document history revisions enabled if enabled globally" : (
                                    values.history ? "Document history revisions ENABLED" : "Document history revisions NOT enabled"
                                )}</span>}
                                onValueChange={(v) => setFieldValue("history", v)}
                                value={values.history ?? null}
                            />
                            <FieldCaption>
                                When enabled, each document in this collection will have a history of changes.
                                This is useful for auditing purposes. The data is stored in a subcollection of the document
                                in your database, called <b>__history</b>.
                            </FieldCaption>
                        </div>

                    </ExpandablePanel> : null}
                </fieldset>

                <div style={{ height: "52px" }}/>

                <Dialog
                    open={iconDialogOpen}
                    onOpenChange={setIconDialogOpen}
                    maxWidth={"xl"}
                    fullWidth
                >
                    <div className={"p-4 overflow-auto min-h-[200px]"}>
                        <SearchIconsView selectedIcon={typeof values.icon === "string" ? values.icon : undefined}
                            onIconSelected={(icon: string) => {
                                setIconDialogOpen(false);
                                setFieldValue("icon", icon);
                            }}/>
                    </div>
                </Dialog>

                {renderExtraCollectionFields && (
                    <div className="mt-4">
                        {renderExtraCollectionFields({
                            metadata: (values.metadata ?? {}) as Record<string, unknown>,
                            onMetadataChange: (key: string, value: unknown) => {
                                setFieldValue(`metadata.${key}`, value);
                            },
                            collection: toSerializableCollectionConfig(values),
                        })}
                    </div>
                )}

            </Container>
        </div>
    );
}

function DefaultDatabaseField({
    databaseId,
    disabled = false,
    onDatabaseIdUpdate
}: { databaseId?: string, disabled?: boolean, onDatabaseIdUpdate: (databaseId: string) => void }) {

    const { t } = useTranslation();

    return <Tooltip title={t("database_id")}
        side={"top"}
        align={"start"}>
        <TextField size={"small"}
            aria-label={t("database_id")}
            invisible={true}
            inputClassName={"text-end"}
            disabled={disabled}
            value={databaseId ?? ""}
            onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onDatabaseIdUpdate(e.target.value)}
            placeholder={"(default)"}></TextField>
    </Tooltip>
}
