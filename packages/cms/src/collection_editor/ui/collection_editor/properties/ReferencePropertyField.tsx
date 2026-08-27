import { IconForView, useTranslation } from "@rebasepro/app";
import { FieldCaption, useCollectionRegistryController } from "../../../_cms_internals";
import React from "react";
import { Field, getIn, useFormex } from "@rebasepro/forms";
;
import { NumberProperty, StringProperty } from "@rebasepro/types";
import { CircularProgress, Select, SelectItem, Typography } from "@rebasepro/ui";

export function ReferencePropertyField({
    existing,
    multiple,
    disabled,
    showErrors,
    asString
}: {
    existing: boolean,
    multiple: boolean,
    disabled: boolean,
    showErrors: boolean,
    asString?: boolean
}) {

    const {
        values,
        errors,
        setFieldValue
    } = useFormex<StringProperty | NumberProperty>();

    const collectionRegistry = useCollectionRegistryController();

    if (!collectionRegistry.initialised)
        return <div className={"col-span-12"}>
            <CircularProgress/>
        </div>;

    const pathPath = asString ? "reference.slug" : (multiple ? "of.slug" : "path");
    const pathValue: string | undefined = getIn(values, pathPath) as string | undefined;
    const pathError: string | undefined = (showErrors && getIn(errors, pathPath)) as string | undefined;

    return (
        <>
            <div className={"col-span-12"}>

                <Field name={pathPath}
                    pathPath={pathPath}
                    type="select"
                    disabled={disabled}
                    value={pathValue}
                    error={pathError}
                    setFieldValue={setFieldValue}
                    as={CollectionsSelect}/>

            </div>

        </>
    );
}

export function CollectionsSelect({
    disabled,
    pathPath,
    value,
    setFieldValue,
    error,
    ...props
}: {
    disabled: boolean,
    pathPath: string,
    value?: string,
    setFieldValue: (field: string, value: string) => void,
    error?: string
}) {

    const collectionRegistry = useCollectionRegistryController();
    const { t } = useTranslation();

    if (!collectionRegistry.initialised)
        return <div className={"col-span-12"}>
            <CircularProgress/>
        </div>;

    const collections = collectionRegistry.collections ?? [];

    return (
        <>
            <Select
                error={Boolean(error)}
                disabled={disabled}
                value={value ?? ""}
                position={"item-aligned"}
                name={pathPath}
                fullWidth={true}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setFieldValue(pathPath, e.target.value)}
                label={t("target_collection")}
                renderValue={(selected: string) => {
                    const selectedCollection = collections.find(collection => collection.slug === selected);
                    if (!selectedCollection) return null;
                    return (
                        <div className="flex flex-row">
                            <IconForView collectionOrView={selectedCollection}/>
                            <Typography
                                variant={"subtitle2"}
                                className="ml-4">
                                {selectedCollection?.name.toUpperCase()}
                            </Typography>
                        </div>)
                }}
                {...props}>

                {collections.map((collection) => {
                    return <SelectItem
                        key={collection.slug}
                        value={collection.slug}>
                        <div className="flex flex-row">
                            <IconForView collectionOrView={collection}/>
                            <Typography
                                variant={"subtitle2"}
                                className="ml-4">
                                {collection?.name.toUpperCase()}
                            </Typography>
                        </div>
                    </SelectItem>;
                })}

            </Select>

        </>
    );
}
