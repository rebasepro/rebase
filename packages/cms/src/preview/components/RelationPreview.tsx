
import * as React from "react";

import { Entity, EntityRelation } from "@rebasepro/types";
import type { PreviewSize } from "../../types/components/PropertyPreviewProps";
import { useCustomizationController, useFetch, ErrorView, useComponentOverride, CollectionScopeProvider } from "@rebasepro/app";
import { Skeleton } from "@rebasepro/ui";
import { EntityPreviewBinding, EntityPreviewContainer } from "../../components/EntityPreviewBinding";
import {
    InlineEntityPreview,
    InlineEntityPreviewMissing,
    InlineEntityPreviewSkeleton
} from "../../components/InlineEntityPreview";
import { useIsNestedEntityPreview } from "../../components/EntityPreviewNesting";
import { useCollectionRegistryController } from "../../hooks/navigation/contexts/CollectionRegistryContext";
import type { AdminCollection } from "@rebasepro/cms-types";

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
    const nested = useIsNestedEntityPreview();
    if (!(typeof relation === "object" && "isEntityRelation" in relation && relation.isEntityRelation())) {
        console.warn("Relation preview received value of type", typeof relation);
        if (props.textOnly || nested) {
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
    const nested = useIsNestedEntityPreview();

    if (!collection) {
        if (ResolvedMissingReference !== DefaultMissingReference) {
            return <ResolvedMissingReference path={relation.path}/>;
        } else {
            if (textOnly) {
                return <span>{relation.path}</span>;
            }
            if (nested) {
                return <InlineEntityPreviewMissing label={String(relation.id)}
                    tooltip={`Collection not found: ${relation.path}`}/>;
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
    const nested = useIsNestedEntityPreview();

    // Nested inside another preview, or filling a title slot: one line of text,
    // not a second card. See {@link InlineEntityPreview}.
    const inline = nested || Boolean(textOnly);

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

    // Only what the fetch currently reports. There used to be a module-level
    // Map behind this, written on every successful fetch and never invalidated:
    // when the target row was deleted `useFetch` correctly reported it gone and
    // the card carried on rendering the copy in the Map, so the "missing"
    // branches below were unreachable for anything previewed this session — and
    // the Map outlived a sign-out. `useFetch` keeps its own cache, seeds the
    // first render from it, and clears the entry when the row disappears.
    const usedEntity = passedEntity ?? entity;

    let body: React.ReactNode;

    if (!relation) {
        body = <ErrorView error={"Relation not set"}/>;
    } else if (usedEntity && !usedEntity.values) {
        body = <ErrorView error={"Relation does not exist"}
            tooltip={relation.path}/>;
    }

    if (body) {
        if (inline) {
            return <InlineEntityPreviewMissing label={String(relation.id)}
                tooltip={relation.pathWithId}/>;
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
        if (inline) {
            return <InlineEntityPreviewSkeleton/>;
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
        if (inline) {
            return <InlineEntityPreviewMissing label={String(relation.id)}
                tooltip={"Entity not found"}/>;
        }
        return (
            <EntityPreviewContainer onClick={disabled ? undefined : onClick}
                hover={disabled ? undefined : hover}
                size={size}>
                <ErrorView error={"Entity not found"}/>
            </EntityPreviewContainer>
        );
    }

    if (inline) {
        return <InlineEntityPreview entity={usedEntity}
            collection={collection}
            disabled={disabled}
            onClick={onClick}
            // In a title slot the row itself is the click target; only a
            // preview nested inside a card opens its own side panel.
            includeEntityLink={!textOnly && includeEntityLink !== false}/>;
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
