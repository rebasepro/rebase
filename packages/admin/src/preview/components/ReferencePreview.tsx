import type { SnapshotCollection } from "@rebasepro/types";
import * as React from "react";

import { Snapshot, SnapshotReference } from "@rebasepro/types";
import type { PreviewSize } from "../../types/components/PropertyPreviewProps";
import { useCustomizationController, useSnapshotFetch, useComponentOverride, CollectionComponentOverrideProvider } from "@rebasepro/core";
import { Skeleton } from "@rebasepro/ui";
import { ErrorBoundary } from "@rebasepro/ui";
import { ErrorView } from "@rebasepro/core";
import { SnapshotPreview, SnapshotPreviewContainer } from "../../components/SnapshotPreview";
import { useCollectionRegistryController } from "../../index";
import { getSnapshotTitlePropertyKey } from "../../util/previews";
import { getValueInPath } from "@rebasepro/utils";

export type ReferencePreviewProps = {
    disabled?: boolean;
    reference: SnapshotReference,
    size?: PreviewSize;
    previewProperties?: string[];
    onClick?: (e: React.SyntheticEvent) => void;
    hover?: boolean;
    includeSnapshotLink?: boolean;
    includeId?: boolean;
    textOnly?: boolean;
};

/**
 * @group Preview components
 */
export const ReferencePreview = function ReferencePreview(props: ReferencePreviewProps) {
    const reference = props.reference;
    if (!(typeof reference === "object" && "isSnapshotReference" in reference && reference.isSnapshotReference())) {
        console.warn("Reference preview received value of type", typeof reference);
        if (props.textOnly) {
            return <span>{String(reference)}</span>;
        }
        return <SnapshotPreviewContainer
            onClick={props.onClick}
            size={props.size ?? "medium"}>
            <ErrorView error={"Unexpected value. Click to edit"}
                tooltip={JSON.stringify(reference)}/>
        </SnapshotPreviewContainer>;
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
    includeSnapshotLink = true,
    includeId = true,
    textOnly,
    collection
}: ReferencePreviewProps & { collection?: SnapshotCollection }) {
    const ResolvedMissingReference = useComponentOverride("Snapshot.MissingReference", DefaultMissingReference);

    if (!collection) {
        if (ResolvedMissingReference !== DefaultMissingReference) {
            return <ResolvedMissingReference path={reference.path}/>;
        } else {
            if (textOnly) {
                return <span>{reference.path}</span>;
            }
            return <SnapshotPreviewContainer
                onClick={onClick}
                size={size ?? "medium"}>
                <ErrorView error={"Unexpected reference value. Click to edit"}
                    tooltip={reference.pathWithId}/>
            </SnapshotPreviewContainer>;
        }
    }

    return <ReferencePreviewExisting
        reference={reference}
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

function ReferencePreviewInternal(props: ReferencePreviewProps) {
    const collectionRegistryController = useCollectionRegistryController();
    const collection = collectionRegistryController.getCollection(props.reference.path);

    const content = (
        <ReferencePreviewInternalInner
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

function ReferencePreviewExisting<M extends Record<string, unknown> = Record<string, unknown>>({
    reference,
    collection,
    previewProperties,
    size,
    disabled,
    includeSnapshotLink,
    includeId,
    onClick,
    hover,
    textOnly
}: ReferencePreviewProps & {
    collection: SnapshotCollection<M>
}) {

    const ResolvedSnapshotPreview = useComponentOverride("Snapshot.Preview", SnapshotPreview);
    const customizationController = useCustomizationController();

    const {
        snapshot,
        dataLoading,
        dataLoadingError
    } = useSnapshotFetch({
        path: reference.path,
        snapshotId: reference.id,
        collection,
        useCache: true
    });

    if (snapshot) {
        referencesCache.set(reference.pathWithId, snapshot);
    }

    const usedSnapshot = snapshot ?? referencesCache.get(reference.pathWithId);

    let body: React.ReactNode;

    if (!reference) {
        body = <ErrorView error={"Reference not set"}/>;
    } else if (usedSnapshot && !usedSnapshot.values) {
        body = <ErrorView error={"Reference does not exist"}
            tooltip={reference.path}/>;
    }
    if (body) {
        if (textOnly) {
            return <span>{reference.id}</span>;
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
            return <span>{reference.id}</span>;
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
        const displayValue = titleValue !== undefined && titleValue !== null ? String(titleValue) : String(reference.id);
        return <span className="truncate">{displayValue}</span>;
    }

    return <ResolvedSnapshotPreview size={size}
        previewKeys={previewProperties}
        disabled={disabled}
        snapshot={usedSnapshot}
        collection={collection}
        onClick={onClick}
        includeSnapshotLink={includeSnapshotLink}
        includeId={includeId}
        hover={hover}/>;

}

const referencesCache = new Map<string, Snapshot<any>>();
