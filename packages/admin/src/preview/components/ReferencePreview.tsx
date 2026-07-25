
import * as React from "react";

import { Entity, EntityReference } from "@rebasepro/types";
import type { PreviewSize } from "../../types/components/PropertyPreviewProps";
import { useCustomizationController, useFetch, useComponentOverride, CollectionScopeProvider } from "@rebasepro/app";
import { Skeleton } from "@rebasepro/ui";
import { ErrorBoundary } from "@rebasepro/ui";
import { ErrorView } from "@rebasepro/app";
import { EntityPreviewBinding, EntityPreviewContainer } from "../../components/EntityPreviewBinding";
import { useCollectionRegistryController } from "../../hooks/navigation/contexts/CollectionRegistryContext";
import { getEntityTitlePropertyKeyForEntity } from "../../util/previews";
import { getValueInPath } from "@rebasepro/utils";
import type { AdminCollection } from "@rebasepro/admin-types";

export type ReferencePreviewProps = {
    disabled?: boolean;
    reference: EntityReference,
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
export const ReferencePreview = function ReferencePreview(props: ReferencePreviewProps) {
    const reference = props.reference;
    if (!(typeof reference === "object" && "isEntityReference" in reference && reference.isEntityReference())) {
        console.warn("Reference preview received value of type", typeof reference);
        if (props.textOnly) {
            return <span>{String(reference)}</span>;
        }
        return <EntityPreviewContainer
            onClick={props.onClick}
            size={props.size ?? "medium"}>
            <ErrorView error={"Unexpected value. Click to edit"}
                tooltip={JSON.stringify(reference)}/>
        </EntityPreviewContainer>;
    }
    return <ErrorBoundary>
        <ReferencePreviewInternal {...props}/>
    </ErrorBoundary>;
};

const DefaultMissingReference: React.FC<{ path: string }> = () => null;

function ReferencePreviewInternalInner({
    disabled,
    reference,
    previewProperties,
    size,
    hover,
    onClick,
    includeEntityLink = true,
    includeId = true,
    textOnly,
    collection
}: ReferencePreviewProps & { collection?: AdminCollection }) {
    const ResolvedMissingReference = useComponentOverride("Entity.MissingReference", DefaultMissingReference);

    if (!collection) {
        if (ResolvedMissingReference !== DefaultMissingReference) {
            return <ResolvedMissingReference path={reference.path}/>;
        } else {
            if (textOnly) {
                return <span>{reference.path}</span>;
            }
            return <EntityPreviewContainer
                onClick={onClick}
                size={size ?? "medium"}>
                <ErrorView error={"Unexpected reference value. Click to edit"}
                    tooltip={reference.pathWithId}/>
            </EntityPreviewContainer>;
        }
    }

    return <ReferencePreviewExisting
        reference={reference}
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

function ReferencePreviewInternal(props: ReferencePreviewProps) {
    const collectionRegistryController = useCollectionRegistryController();
    const collection = collectionRegistryController.getCollection(props.reference.path);

    const content = (
        <ReferencePreviewInternalInner
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

function ReferencePreviewExisting<M extends Record<string, unknown> = Record<string, unknown>>({
    reference,
    collection,
    previewProperties,
    size,
    disabled,
    includeEntityLink,
    includeId,
    onClick,
    hover,
    textOnly
}: ReferencePreviewProps & {
    collection: AdminCollection<M>
}) {

    const ResolvedEntityPreview = useComponentOverride("EntityPreview", EntityPreviewBinding);
    const customizationController = useCustomizationController();

    const {
        entity,
        dataLoading,
        dataLoadingError
    } = useFetch({
        path: reference.path,
        entityId: reference.id,
        collection,
        useCache: true
    });

    if (entity) {
        referencesCache.set(reference.pathWithId, entity);
    }

    const usedEntity = entity ?? referencesCache.get(reference.pathWithId);

    let body: React.ReactNode;

    if (!reference) {
        body = <ErrorView error={"Reference not set"}/>;
    } else if (usedEntity && !usedEntity.values) {
        body = <ErrorView error={"Reference does not exist"}
            tooltip={reference.path}/>;
    }
    if (body) {
        if (textOnly) {
            return <span>{reference.id}</span>;
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
            return <span>{reference.id}</span>;
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
        const displayValue = titleValue !== undefined && titleValue !== null ? String(titleValue) : String(reference.id);
        return <span className="truncate">{displayValue}</span>;
    }

    return <ResolvedEntityPreview size={size}
        previewKeys={previewProperties}
        disabled={disabled}
        entity={usedEntity}
        collection={collection}
        onClick={onClick}
        includeEntityLink={includeEntityLink}
        includeId={includeId}
        hover={hover}/>;

}

const referencesCache = new Map<string, Entity<any>>();
