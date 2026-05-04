import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FieldHelperText, LabelWithIconAndTooltip } from "../components";
import { useAuthController, useStorageSource } from "@rebasepro/core";
import { getIconForProperty } from "../../util/property_utils";
import type { FieldProps } from "../../types/fields";
import type { ArrayProperty, StringProperty } from "@rebasepro/types";
import { cls, fieldBackgroundDisabledMixin, fieldBackgroundHoverMixin, fieldBackgroundMixin, IconButton, CloseIcon } from "@rebasepro/ui";
import { RebaseEditor, RebaseEditorProps } from "../../editor";
import { resolveStorageFilenameString, resolveStoragePathString } from "@rebasepro/common";
import { randomString } from "@rebasepro/utils";
import { parser, serializer } from "../../editor/markdown";

interface MarkdownEditorFieldProps {
    highlight?: { from: number, to: number };
    editorProps?: Partial<RebaseEditorProps>
}

/**
 * Normalize markdown for comparison purposes: collapse whitespace,
 * normalize line endings, trim lines. This is NOT for display.
 */
function normalizeMarkdown(md: string | null | undefined): string {
    if (!md) return "";
    return md
        .replace(/\r\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .replace(/[ \t]+$/gm, "")
        .trim();
}

/**
 * Compute the canonical form of a markdown string by doing a full
 * parse → serialize roundtrip through ProseMirror. This gives us
 * the exact output the editor will produce for a given input,
 * so we can compare against it to avoid false dirty states.
 */
function canonicalizeMarkdown(md: string | null | undefined): string {
    if (!md) return "";
    try {
        const doc = parser.parse(md);
        if (!doc) return normalizeMarkdown(md);
        return normalizeMarkdown(serializer.serialize(doc));
    } catch {
        return normalizeMarkdown(md);
    }
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

    // Compute the canonical (round-tripped) form of the initial value ONCE.
    // This is what ProseMirror will produce after parse → serialize, so any
    // future serialization that matches this canonical form is NOT a real change.
    const canonicalInitialValue = useMemo(
        () => canonicalizeMarkdown(value),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [] // intentionally only on mount
    );
    // Track it in a ref so the callback always has the latest
    const canonicalRef = useRef(canonicalInitialValue);

    const onContentChange = useCallback((content: string) => {
        const normalizedContent = normalizeMarkdown(content);

        // Compare against the canonical roundtripped form of the initial value.
        // This eliminates ALL false positives from parse→serialize normalization
        // differences (trailing nodes, bullet chars, whitespace, etc.).
        if (normalizedContent === canonicalRef.current) {
            return;
        }
        // Also compare against the current form value to avoid redundant updates
        if (normalizedContent === normalizeMarkdown(value)) {
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
