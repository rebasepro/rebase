
import * as React from "react";

import { Entity, EntityRelation } from "@rebasepro/types";
import type { PreviewSize } from "../../types/components/PropertyPreviewProps";
import { useCustomizationController, useFetch, ErrorView, useComponentOverride, CollectionScopeProvider } from "@rebasepro/app";
import { Skeleton } from "@rebasepro/ui";
import { EntityPreviewBinding, EntityPreviewContainer } from "../../components/EntityPreviewBinding";
import { useCollectionRegistryController } from "../../hooks/navigation/contexts/CollectionRegistryContext";
import { getEntityTitlePropertyKeyForEntity } from "../../util/previews";
import { getValueInPath } from "@rebasepro/utils";
import type { AdminCollection } from "@rebasepro/admin-types";

export type RelationPreviewProps = {
    disabled?: boolean;
    relation: EntityRelation,
    size?: PreviewSize;
    previewProperties?: string[];
    onClick?: (e: React.SyntheticEvent) => void;
    hover?: boolean;
    includeEntityLink?: boolean;
    includeId?: boolean;
    textOnly?: boolean;
};

/**
 * Extract a display name from a plain relation-shaped object that isn't
 * a proper EntityRelation instance. Tries common name fields in the
 * entity's values, then falls back to the id.
 */
function extractDisplayFromPlainObject(obj: unknown): string {
    if (!obj || typeof obj !== "object") return "—";
    const record = obj as Record<string, unknown>;

    // Try data.values.{name,title,...} (EntityRelation.data is a Entity with .values)
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
    if (!(typeof relation === "object" && "isEntityRelation" in relation && relation.isEntityRelation())) {
        console.warn("Relation preview received value of type", typeof relation);
        if (props.textOnly) {
            const display = extractDisplayFromPlainObject(relation);
            return <span className="truncate">{display}</span>;
        }
        return <EntityPreviewContainer
            onClick={props.onClick}
            size={props.size}>
            <ErrorView error={"Unexpected value. Click to edit"}
                tooltip={JSON.stringify(relation)}/>
        </EntityPreviewContainer>;
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
    includeEntityLink = true,
    includeId = true,
    textOnly,
    collection
}: RelationPreviewProps & { collection?: AdminCollection }) {
    const ResolvedMissingReference = useComponentOverride("Entity.MissingReference", DefaultMissingReference);

    if (!collection) {
        if (ResolvedMissingReference !== DefaultMissingReference) {
            return <ResolvedMissingReference path={relation.path}/>;
        } else {
            if (textOnly) {
                return <span>{relation.path}</span>;
            }
            return <EntityPreviewContainer size={size}>
                <ErrorView error={`Collection not found: ${relation.path}`}/>
            </EntityPreviewContainer>;
        }
    }

    return <RelationPreviewExisting
        relation={relation}
        collection={collection}
        previewProperties={previewProperties}
        size={size}
        disabled={disabled}
        includeEntityLink={includeEntityLink}
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

    if (collection) {
        return (
            <CollectionScopeProvider collection={collection}>
                {content}
            </CollectionScopeProvider>
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
    includeEntityLink,
    includeId,
    onClick,
    hover,
    textOnly
}: RelationPreviewProps & {
    collection: AdminCollection<M>
}) {

    // admin wire format embeds relation data as { id, path, values }
    const passedEntity = relation.data as Entity<M> | undefined;
    const ResolvedEntityPreview = useComponentOverride("EntityPreview", EntityPreviewBinding);
    const customizationController = useCustomizationController();

    const {
        entity,
        dataLoading,
        dataLoadingError
    } = useFetch({
        path: relation.path,
        entityId: passedEntity ? undefined : relation.id,
        collection,
        useCache: true
    });

    if (entity) {
        relationsCache.set(relation.pathWithId, entity);
    }

    const usedEntity = passedEntity ?? entity ?? relationsCache.get(relation.pathWithId);

    let body: React.ReactNode;

    if (!relation) {
        body = <ErrorView error={"Relation not set"}/>;
    } else if (usedEntity && !usedEntity.values) {
        body = <ErrorView error={"Relation does not exist"}
            tooltip={relation.path}/>;
    }

    if (body) {
        if (textOnly) {
            return <span>{relation.id}</span>;
        }
        return (
            <EntityPreviewContainer onClick={disabled ? undefined : onClick}
                hover={disabled ? undefined : hover}
                size={size}>
                {body}
            </EntityPreviewContainer>
        );
    }

    if (dataLoading && !usedEntity) {
        if (textOnly) {
            return <Skeleton className="inline-block w-20 h-4" />;
        }
        return (
            <EntityPreviewContainer onClick={disabled ? undefined : onClick}
                hover={disabled ? undefined : hover}
                size={size}>
                <Skeleton/>
            </EntityPreviewContainer>
        );
    }

    if (!usedEntity) {
        if (textOnly) {
            return <span>{relation.id}</span>;
        }
        return (
            <EntityPreviewContainer onClick={disabled ? undefined : onClick}
                hover={disabled ? undefined : hover}
                size={size}>
                <ErrorView error={"Entity not found"}/>
            </EntityPreviewContainer>
        );
    }

    if (textOnly) {
        const titleProperty = getEntityTitlePropertyKeyForEntity(collection, usedEntity.values, usedEntity.id);
        const titleValue = titleProperty ? getValueInPath(usedEntity.values, titleProperty) : undefined;
        const displayValue = titleValue !== undefined && titleValue !== null ? String(titleValue) : String(relation.id);
        return <span className="truncate">{displayValue}</span>;
    }

    return <ResolvedEntityPreview size={size}
        previewKeys={previewProperties}
        disabled={disabled}
        entity={usedEntity}
        collection={collection}
        onClick={onClick}
        includeEntityLink={includeEntityLink}
        includeId={false}
        hover={hover}/>;

}

const relationsCache = new Map<string, Entity<any>>();
