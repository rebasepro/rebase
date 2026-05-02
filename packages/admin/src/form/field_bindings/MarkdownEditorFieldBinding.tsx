import React, { useCallback, useEffect, useRef, useState } from "react";
import { FieldHelperText, LabelWithIconAndTooltip } from "../components";
import { useAuthController, useStorageSource } from "@rebasepro/core";
import { getIconForProperty } from "../../util/property_utils";
import type { FieldProps } from "../../types/fields";
import type { ArrayProperty, StringProperty } from "@rebasepro/types";
import { cls, fieldBackgroundDisabledMixin, fieldBackgroundHoverMixin, fieldBackgroundMixin, IconButton, CloseIcon } from "@rebasepro/ui";
import { RebaseEditor, RebaseEditorProps } from "../../editor";
import { resolveStorageFilenameString, resolveStoragePathString } from "@rebasepro/common";
import { randomString } from "@rebasepro/utils";

interface MarkdownEditorFieldProps {
    highlight?: { from: number, to: number };
    editorProps?: Partial<RebaseEditorProps>
}

export function MarkdownEditorFieldBinding({
    property,
    propertyKey,
    value,
    setValue,
    includeDescription,
    showError,
    error,
    minimalistView,
    disabled: disabledProp,
    isSubmitting,
    context,
    customProps,
}: FieldProps<StringProperty, MarkdownEditorFieldProps>) {

    const authController = useAuthController();
    const disabled = disabledProp || isSubmitting;
    const highlight = customProps?.highlight;
    const editorProps = customProps?.editorProps;
    const storageSource = useStorageSource();
    const storage = property.storage;

    const entityValues = context.values;
    const entityId = context.entityId;
    const path = context.path;

    const [fieldVersion, setFieldVersion] = useState(0);
    const internalValue = useRef<string | null>(value);

    const onContentChange = useCallback((content: string) => {
        // Guard against markdown roundtrip normalization producing slightly different output
        // (e.g., trailing newlines added by trailingNodePlugin, whitespace normalization).
        const normalizedContent = content?.trimEnd() ?? "";
        const normalizedValue = (value ?? "").trimEnd();
        if (normalizedContent === normalizedValue) {
            return;
        }
        internalValue.current = content;
        setValue(content);
    }, [setValue, value]);

    useEffect(() => {
        if (internalValue.current !== value) {
            internalValue.current = value;
            setFieldVersion(v => v + 1);
        }
    }, [value]);

    const fileNameBuilder = useCallback(async (file: File) => {
        if (storage?.fileName) {
            const fileName = await resolveStorageFilenameString({
                input: storage.fileName,
                storage,
                values: entityValues,
                entityId,
                path,
                property: property,
                file,
                propertyKey
            });
            if (!fileName || fileName.length === 0) {
                throw Error("You need to return a valid filename");
            }
            return fileName;
        }
        return randomString() + "_" + file.name;
    }, [entityId, entityValues, path, property, propertyKey, storage]);

    const storagePathBuilder = useCallback((file: File) => {
        if (!storage) return "/";
        return resolveStoragePathString({
            input: storage.storagePath,
            storage,
            values: entityValues,
            entityId,
            path,
            property,
            file,
            propertyKey
        }) ?? "/";
    }, [entityId, entityValues, path, property, propertyKey, storage]);

    const editor = <RebaseEditor
        content={value}
        onMarkdownContentChange={onContentChange}
        version={context.formex.version + fieldVersion}
        highlight={highlight}
        disabled={disabled}
        handleImageUpload={async (file: File) => {
            const storagePath = storagePathBuilder(file);
            const fileName = await fileNameBuilder(file);
            const key = `${storagePath}/${fileName}`.replace(/^\/+/, '').replace(/\/+/g, '/');
            const result = await storageSource.putObject({
                file,
                key,
            });
            const downloadConfig = await storageSource.getSignedUrl(result.key);
            const url = downloadConfig.url;
            if (!url) {
                throw new Error("Error uploading image");
            }
            return url;
        }}
        {...editorProps}
    />;

    if (minimalistView)
        return editor;

    return (
        <>
            <div className="flex items-center w-full">
                <LabelWithIconAndTooltip
                    propertyKey={propertyKey}
                    icon={getIconForProperty(property, "small")}
                    required={property.validation?.required}
                    title={property.name ?? propertyKey}
                    className={"h-8 text-text-secondary dark:text-text-secondary-dark ml-3.5"} />
                <div className="flex-grow"/>
                {property.clearable && !disabled && (
                    <IconButton
                        size="small"
                        onClick={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            setValue(null);
                        }}
                    >
                        <CloseIcon size={"small"}/>
                    </IconButton>
                )}
            </div>
            <div
                className={cls("rounded-md", fieldBackgroundMixin, disabled ? fieldBackgroundDisabledMixin : fieldBackgroundHoverMixin)}>
                {editor}
            </div>
            <FieldHelperText includeDescription={includeDescription}
                showError={showError}
                error={error}
                property={property} />
        </>

    );

}
