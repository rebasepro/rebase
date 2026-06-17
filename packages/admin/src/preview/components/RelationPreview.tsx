import type { EntityCollection } from "@rebasepro/types";
import * as React from "react";

import { Entity, EntityRelation } from "@rebasepro/types";
import type { PreviewSize } from "../../types/components/PropertyPreviewProps";
import { useCustomizationController, useEntityFetch, ErrorView } from "@rebasepro/core";
import { Skeleton } from "@rebasepro/ui";
import { EntityPreview, EntityPreviewContainer } from "../../components";
import { useCollectionRegistryController } from "../../index";
import { getEntityTitlePropertyKey } from "../../util/previews";
import { getValueInPath } from "@rebasepro/utils";

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
 * @group Preview components
 */
export const RelationPreview = function RelationPreview(props: RelationPreviewProps) {
    const relation = props.relation;
    if (!(typeof relation === "object" && "isEntityRelation" in relation && relation.isEntityRelation())) {
        console.warn("Relation preview received value of type", typeof relation);
        if (props.textOnly) {
            return <span>{String(relation)}</span>;
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

function RelationPreviewInternal({
    disabled,
    relation,
    previewProperties,
    size,
    hover,
    onClick,
    includeEntityLink = true,
    includeId = true,
    textOnly
}: RelationPreviewProps) {

    const customizationController = useCustomizationController();

    const collectionRegistryController = useCollectionRegistryController();

    const collection = collectionRegistryController.getCollection(relation.path);
    if (!collection) {
        if (customizationController.components?.missingReference) {
            return <customizationController.components.missingReference path={relation.path}/>;
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
    collection: EntityCollection<M>
}) {

    const passedEntity = relation.data;
    const customizationController = useCustomizationController();

    const {
        entity,
        dataLoading,
        dataLoadingError
    } = useEntityFetch({
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
        const titleProperty = getEntityTitlePropertyKey(collection, customizationController.propertyConfigs);
        const titleValue = titleProperty ? getValueInPath(usedEntity.values, titleProperty) : undefined;
        const displayValue = titleValue !== undefined && titleValue !== null ? String(titleValue) : String(relation.id);
        return <span className="truncate">{displayValue}</span>;
    }

    return <EntityPreview size={size}
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
