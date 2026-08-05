import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FieldHelperText } from "../components/FieldHelperText";
import { LabelWithIconAndTooltip } from "../components/LabelWithIconAndTooltip";
import { useAuthController, useStorageSource } from "@rebasepro/app";
import { useStorageSources } from "@rebasepro/app";
import { resolveStorageSource } from "@rebasepro/common";
import { getIconForProperty } from "../../util/property_utils";
import type { FieldProps } from "../../types/fields";
import type { ArrayProperty, StringProperty } from "@rebasepro/types";
import {
    cls,
    fieldBackgroundDisabledMixin,
    fieldBackgroundHoverMixin,
    fieldBackgroundMixin,
    IconButton,
    Skeleton,
    XIcon
} from "@rebasepro/ui";
import type { RichTextEditorProps } from "../../editor";
import { resolveStorageFilenameString, resolveStoragePathString } from "@rebasepro/common";
import { randomString } from "@rebasepro/utils";

// Lazy-load ProseMirror editor + markdown parser/serializer (~300KB)
// Only fetched when a markdown field is actually rendered.
const RichTextEditor = lazy(() => import("../../editor").then(m => ({ default: m.RichTextEditor })));
const loadMarkdownUtils = () => import("../../editor/markdown");
let _markdownUtils: Awaited<ReturnType<typeof loadMarkdownUtils>> | null = null;
const getMarkdownUtils = async () => {
    if (!_markdownUtils) _markdownUtils = await loadMarkdownUtils();
    return _markdownUtils;
};

interface MarkdownEditorFieldProps {
    highlight?: { from: number, to: number };
    editorProps?: Partial<RichTextEditorProps>
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
 *
 * Falls back to normalizeMarkdown if the ProseMirror module hasn't loaded yet.
 */
function canonicalizeMarkdown(md: string | null | undefined): string {
    if (!md) return "";
    if (!_markdownUtils) return normalizeMarkdown(md);
    try {
        const doc = _markdownUtils.parser.parse(md);
        if (!doc) return normalizeMarkdown(md);
        return normalizeMarkdown(_markdownUtils.serializer.serialize(doc));
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
    hideLabel,
    showError,
    error,
    minimalistView,
    disabled: disabledProp,
    isSubmitting,
    context,
    customProps
}: FieldProps<StringProperty, MarkdownEditorFieldProps>) {

    const authController = useAuthController();
    const disabled = disabledProp || isSubmitting;
    const highlight = customProps?.highlight;
    const editorProps = customProps?.editorProps;
    const defaultStorageSource = useStorageSource();
    const storage = property.storage;
    const storageSources = useStorageSources();

    // Resolve the correct storage source for this property.
    // Mirrors the resolution in useStorageUploadController.
    const storageSource = useMemo(() => resolveStorageSource({
        sourceKey: storage?.storageSource,
        sources: storageSources.sources,
        defaultSource: defaultStorageSource
    }), [storage?.storageSource, storageSources.sources, defaultStorageSource]);

    const entityValues = context.values;
    const entityId = context.entityId;
    const path = context.path;

    const [fieldVersion, setFieldVersion] = useState(0);
    const internalValue = useRef<string | null>(value);

    // Eagerly load ProseMirror markdown utils when the field first mounts
    useEffect(() => {
        getMarkdownUtils().then(() => {
            // Update canonical ref with the proper round-tripped value now that ProseMirror is loaded
            canonicalRef.current = canonicalizeMarkdown(value);
        });
    }, []);

    // Compute the canonical (round-tripped) form of the initial value ONCE.
    // This is what ProseMirror will produce after parse → serialize, so any
    // future serialization that matches this canonical form is NOT a real change.
    const canonicalInitialValue = useMemo(
        () => canonicalizeMarkdown(value),

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
            canonicalRef.current = canonicalizeMarkdown(value);
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

    const editor = <Suspense fallback={<Skeleton height={200} className="w-full rounded-md"/>}>
        <RichTextEditor
        content={value}
        onMarkdownContentChange={onContentChange}
        version={context.formex.version + fieldVersion}
        highlight={highlight}
        disabled={disabled}
        handleImageUpload={async (file: File) => {
            const storagePath = storagePathBuilder(file);
            const fileName = await fileNameBuilder(file);
            const key = `${storagePath}/${fileName}`.replace(/^\/+/, "").replace(/\/+/g, "/");
            const result = await storageSource.putObject({
                file,
                key
            });
            const downloadConfig = await storageSource.getSignedUrl(result.key);
            const url = downloadConfig.url;
            if (!url) {
                throw new Error("Error uploading image");
            }
            return url;
        }}
        {...editorProps}
    />
    </Suspense>;

    if (minimalistView)
        return editor;

    return (
        <>
            {!hideLabel && <div className="flex items-center w-full">
                <LabelWithIconAndTooltip
                    propertyKey={propertyKey}
                    icon={getIconForProperty(property, "small")}
                    required={property.validation?.required}
                    title={property.name ?? propertyKey}
                    className={"h-8 text-text-secondary dark:text-text-secondary-dark ml-3.5"}/>
            </div>}
            {/* `relative` so Clear can float inside the box. It used to sit in
                the label row, which meant a clearable field with its label
                lifted out by the form still drew a row of chrome above the box
                and started lower than the field beside it.
                Bottom-right, not top: the editor puts its own mode toggle at
                `top-2 right-2` and the two would sit on each other. */}
            <div
                className={cls("relative rounded-md", fieldBackgroundMixin, disabled ? fieldBackgroundDisabledMixin : fieldBackgroundHoverMixin)}>
                {property.admin?.clearable && !disabled && (
                    <IconButton
                        size="small"
                        className="absolute bottom-1 right-1 z-10"
                        onClick={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            setValue(null);
                        }}
                    >
                        <XIcon/>
                    </IconButton>
                )}
                {editor}
            </div>
            <FieldHelperText includeDescription={includeDescription}
                showError={showError}
                error={error}
                property={property}/>
        </>

    );

}
