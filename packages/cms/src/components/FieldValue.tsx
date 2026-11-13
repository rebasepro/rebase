import React, { useContext, useMemo } from "react";
import type { Property } from "@rebasepro/types";
import { resolveCollectionRelations } from "@rebasepro/common";
import { rowToViewModel } from "@rebasepro/cms-types";
import { toWireKey } from "@rebasepro/utils";
import type { AdminCollection } from "@rebasepro/cms-types";

import type { PreviewSize } from "../types/components/PropertyPreviewProps";
import { PropertyPreview } from "../preview/PropertyPreview";
import { useCollectionRegistryController } from "../hooks/navigation/contexts/CollectionRegistryContext";
import { useNavigationStateController } from "../hooks/navigation/contexts/NavigationStateContext";
import { CollectionsScopeContext, isRegistered } from "./CollectionsScopeContext";

/**
 * Props for {@link FieldValue}.
 *
 * @group Preview components
 */
export type FieldValueProps = {
    /** The collection's name (`"orders"`), or a subcollection's full path. */
    collection: string;
    /**
     * The property to draw, by its key in the collection. A belongsTo's
     * foreign key (`"customerId"`, or its column `"customer_id"`) names its
     * relation too.
     */
    field: string;
    /**
     * The value, as the server sends it: `order.status`, an ISO date string,
     * a belongsTo's foreign key (`order.customerId`). A value in the admin's view model
     * — a `Date`, an `EntityRelation` — is drawn the same.
     */
    value: unknown;
    /** Defaults to `"medium"`. */
    size?: PreviewSize;
};

/**
 * One value of a row, drawn exactly as the admin draws it: an enum as its
 * chip, a date in the property's timezone, a relation as its target's title,
 * an image as its thumbnail, and a property with its own `admin.Preview`
 * through that.
 *
 * A belongsTo arrives as its foreign key: `field="customer"
 * value={order.customerId}` draws the customer's title.
 *
 * Needs the collection registered above it — `<RebaseCMS>`, or a
 * `<CollectionsProvider>` around your page. An unknown collection or field
 * throws, naming it.
 *
 * @example
 * ```tsx
 * const { rows } = useRows("orders", { limit: 20 });
 * return rows.map(order => <div key={String(order.id)}>
 *     <FieldValue collection="orders" field="status" value={order.status}/>
 *     <FieldValue collection="orders" field="customer" value={order.customerId}/>
 * </div>);
 * ```
 *
 * @group Preview components
 */
export function FieldValue({ collection: path, field: fieldProp, value: rawValue, size = "medium" }: FieldValueProps) {
    const inScope = useContext(CollectionsScopeContext);
    const collectionRegistry = useCollectionRegistryController();
    const navigationState = useNavigationStateController();

    const settled = !navigationState.loading;
    const registered = inScope && (collectionRegistry.initialised || settled)
        && isRegistered(collectionRegistry.collections, path);
    // One lookup per registry: each builds a new object.
    const collection = useMemo(
        () => registered ? collectionRegistry.getCollection(path) : undefined,
        [registered, collectionRegistry, path]);

    // A foreign-key column names the relation that reads it.
    const field = collection && !collection.properties?.[fieldProp]
        ? relationOfColumn(collection, fieldProp) ?? fieldProp
        : fieldProp;
    const property = collection?.properties?.[field] as Property | undefined;
    // The value in the admin's view model, what `PropertyPreview` reads: a
    // foreign key as the relation, a date as a `Date`, a reference as an
    // `EntityReference`. Read as a one-column row, under the name it was
    // handed by, which is where the conversion looks for it.
    const value = useMemo(
        () => collection && property
            ? rowToViewModel({ [fieldProp]: rawValue }, path, slug => slug === path ? collection : collectionRegistry.getCollection(slug))[field]
            : undefined,
        [rawValue, fieldProp, field, path, property, collection, collectionRegistry]);

    if (!inScope) {
        throw new Error(`<FieldValue collection="${path}">: no collections are registered above it. Render it inside <RebaseCMS>, or wrap your page in a <CollectionsProvider>.`);
    }
    if (!collection) {
        if (!settled) return null;
        throw new Error(`<FieldValue collection="${path}">: no collection is registered at "${path}".`);
    }
    if (!property) {
        const known = Object.keys(collection.properties ?? {}).join(", ");
        throw new Error(`<FieldValue collection="${path}" field="${fieldProp}">: the collection has no property or foreign key "${fieldProp}". Its properties: ${known}.`);
    }

    return <PropertyPreview propertyKey={field}
        property={property}
        value={value}
        size={size}/>;
}

/** The relation property whose foreign key is `column`, by the column's name or its wire key. */
function relationOfColumn(collection: AdminCollection, column: string): string | undefined {
    for (const [key, relation] of Object.entries(resolveCollectionRelations(collection))) {
        const localKey = "localKey" in relation ? relation.localKey : undefined;
        if (localKey && (localKey === column || toWireKey(localKey) === column) && collection.properties?.[key]) return key;
    }
    return undefined;
}
