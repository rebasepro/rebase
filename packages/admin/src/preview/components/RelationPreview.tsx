import type { CollectionConfig } from "@rebasepro/types";
import * as React from "react";

import { Snapshot, SnapshotRelation } from "@rebasepro/types";
import type { PreviewSize } from "../../types/components/PropertyPreviewProps";
import { useCustomizationController, useFetch, ErrorView, useComponentOverride, CollectionComponentOverrideProvider } from "@rebasepro/core";
import { Skeleton } from "@rebasepro/ui";
import { RecordPreviewBinding, SnapshotPreviewContainer } from "../../components";
import { useCollectionRegistryController } from "../../index";
import { getSnapshotTitlePropertyKey } from "../../util/previews";
import { getValueInPath } from "@rebasepro/utils";

export type RelationPreviewProps = {
    disabled?: boolean;
    relation: SnapshotRelation,
    size?: PreviewSize;
    previewProperties?: string[];
    onClick?: (e: React.SyntheticEvent) => void;
    hover?: boolean;
    includeSnapshotLink?: boolean;
    includeId?: boolean;
    textOnly?: boolean;
};

/**
 * Extract a display name from a plain relation-shaped object that isn't
 * a proper SnapshotRelation instance. Tries common name fields in the
 * snapshot's values, then falls back to the id.
 */
function extractDisplayFromPlainObject(obj: unknown): string {
    if (!obj || typeof obj !== "object") return "—";
    const record = obj as Record<string, unknown>;

    // Try data.values.{name,title,...} (SnapshotRelation.data is a Snapshot with .values)
    const data = record.data;
    if (data && typeof data === "object") {
        const dataRecord = data as Record<string, unknown>;
        const values = (dataRecord.values && typeof dataRecord.values === "object")
            ? dataRecord.values as Record<string, unknown>
            : dataRecord;
        const nameFields = ["name", "title", "label", "display_name", "displayName", "email", "username"];
        for (const field of nameFields) {
            const v = values[field];
            if (v && typeof v === "string") return v;
        }
    }

    // Try direct fields on the object itself (some serialization paths flatten the data)
    const directFields = ["name", "title", "label", "display_name", "displayName", "email"];
    for (const field of directFields) {
        const v = record[field];
        if (v && typeof v === "string") return v;
    }

    // Last resort: show the id
    if ("id" in record && record.id != null) return String(record.id);

    return "—";
}

/**
 * @group Preview components
 */
export const RelationPreview = function RelationPreview(props: RelationPreviewProps) {
    const relation = props.relation;
    if (!(typeof relation === "object" && "isSnapshotRelation" in relation && relation.isSnapshotRelation())) {
        console.warn("Relation preview received value of type", typeof relation);
        if (props.textOnly) {
            const display = extractDisplayFromPlainObject(relation);
            return <span className="truncate">{display}</span>;
        }
        return <SnapshotPreviewContainer
            onClick={props.onClick}
            size={props.size}>
            <ErrorView error={"Unexpected value. Click to edit"}
                tooltip={JSON.stringify(relation)}/>
        </SnapshotPreviewContainer>;
    }
    return <RelationPreviewInternal {...props}/>;
};

const DefaultMissingReference: React.FC<{ path: string }> = () => null;

function RelationPreviewInternalInner({
    disabled,
    relation,
    previewProperties,
    size,
    hover,
    onClick,
    includeSnapshotLink = true,
    includeId = true,
    textOnly,
    collection
}: RelationPreviewProps & { collection?: CollectionConfig }) {
    const ResolvedMissingReference = useComponentOverride("Snapshot.MissingReference", DefaultMissingReference);

    if (!collection) {
        if (ResolvedMissingReference !== DefaultMissingReference) {
            return <ResolvedMissingReference path={relation.path}/>;
        } else {
            if (textOnly) {
                return <span>{relation.path}</span>;
            }
            return <SnapshotPreviewContainer size={size}>
                <ErrorView error={`Collection not found: ${relation.path}`}/>
            </SnapshotPreviewContainer>;
        }
    }

    return <RelationPreviewExisting
        relation={relation}
        collection={collection}
        previewProperties={previewProperties}
        size={size}
        disabled={disabled}
        includeSnapshotLink={includeSnapshotLink}
        includeId={includeId}
        onClick={onClick}
        textOnly={textOnly}
        hover={hover}/>
}

function RelationPreviewInternal(props: RelationPreviewProps) {
    const collectionRegistryController = useCollectionRegistryController();
    const collection = collectionRegistryController.getCollection(props.relation.path);

    const content = (
        <RelationPreviewInternalInner
            {...props}
            collection={collection}
        />
    );

    if (collection?.components) {
        return (
            <CollectionComponentOverrideProvider overrides={collection.components}>
                {content}
            </CollectionComponentOverrideProvider>
        );
    }
    return content;
}

function RelationPreviewExisting<M extends Record<string, unknown> = Record<string, unknown>>({
    relation,
    collection,
    previewProperties,
    size,
    disabled,
    includeSnapshotLink,
    includeId,
    onClick,
    hover,
    textOnly
}: RelationPreviewProps & {
    collection: CollectionConfig<M>
}) {

    // CMS wire format embeds relation data as { id, path, values }
    const passedSnapshot = relation.data as Snapshot<M> | undefined;
    const ResolvedRecordPreview = useComponentOverride("RecordPreview", RecordPreviewBinding);
    const customizationController = useCustomizationController();

    const {
        snapshot,
        dataLoading,
        dataLoadingError
    } = useFetch({
        path: relation.path,
        snapshotId: passedSnapshot ? undefined : relation.id,
        collection,
        useCache: true
    });

    if (snapshot) {
        relationsCache.set(relation.pathWithId, snapshot);
    }

    const usedSnapshot = passedSnapshot ?? snapshot ?? relationsCache.get(relation.pathWithId);

    let body: React.ReactNode;

    if (!relation) {
        body = <ErrorView error={"Relation not set"}/>;
    } else if (usedSnapshot && !usedSnapshot.values) {
        body = <ErrorView error={"Relation does not exist"}
            tooltip={relation.path}/>;
    }

    if (body) {
        if (textOnly) {
            return <span>{relation.id}</span>;
        }
        return (
            <SnapshotPreviewContainer onClick={disabled ? undefined : onClick}
                hover={disabled ? undefined : hover}
                size={size}>
                {body}
            </SnapshotPreviewContainer>
        );
    }

    if (dataLoading && !usedSnapshot) {
        if (textOnly) {
            return <Skeleton className="inline-block w-20 h-4" />;
        }
        return (
            <SnapshotPreviewContainer onClick={disabled ? undefined : onClick}
                hover={disabled ? undefined : hover}
                size={size}>
                <Skeleton/>
            </SnapshotPreviewContainer>
        );
    }

    if (!usedSnapshot) {
        if (textOnly) {
            return <span>{relation.id}</span>;
        }
        return (
            <SnapshotPreviewContainer onClick={disabled ? undefined : onClick}
                hover={disabled ? undefined : hover}
                size={size}>
                <ErrorView error={"Snapshot not found"}/>
            </SnapshotPreviewContainer>
        );
    }

    if (textOnly) {
        const titleProperty = getSnapshotTitlePropertyKey(collection, customizationController.propertyConfigs);
        const titleValue = titleProperty ? getValueInPath(usedSnapshot.values, titleProperty) : undefined;
        const displayValue = titleValue !== undefined && titleValue !== null ? String(titleValue) : String(relation.id);
        return <span className="truncate">{displayValue}</span>;
    }

    return <ResolvedRecordPreview size={size}
        previewKeys={previewProperties}
        disabled={disabled}
        snapshot={usedSnapshot}
        collection={collection}
        onClick={onClick}
        includeSnapshotLink={includeSnapshotLink}
        includeId={false}
        hover={hover}/>;

}

const relationsCache = new Map<string, Snapshot<any>>();
