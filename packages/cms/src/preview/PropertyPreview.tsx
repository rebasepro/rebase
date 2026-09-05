import type { ArrayProperty, MapProperty, NumberProperty, Property, StringProperty } from "@rebasepro/types";
import React, { createElement, Suspense } from "react";
import { deepEqual as equal } from "fast-equals"

import { resourceKeyOf } from "@rebasepro/types";
import { EntityReference, EntityRelation } from "@rebasepro/types";
import type { PropertyPreviewProps } from "../types/components/PropertyPreviewProps";
import { resolveProperty, normalizeToEntityRelation, getRelationTargetPath } from "@rebasepro/common";
import { useAuthController, useCustomizationController, resolveComponentRef } from "@rebasepro/app";
import { EmptyValue } from "./components/EmptyValue";
import { UrlComponentPreview } from "./components/UrlComponentPreview";
import { StorageThumbnail } from "./components/StorageThumbnail";
import { Markdown } from "@rebasepro/ui";
import { StringPropertyPreview } from "./property_previews/StringPropertyPreview";
import { ArrayPropertyPreview } from "./property_previews/ArrayPropertyPreview";
import { ArrayOfReferencesPreview } from "./property_previews/ArrayOfReferencesPreview";
import { ArrayOfRelationsPreview } from "./property_previews/ArrayOfRelationsPreview";
import { ArrayOfStorageComponentsPreview } from "./property_previews/ArrayOfStorageComponentsPreview";
import { ArrayPropertyEnumPreview } from "./property_previews/ArrayPropertyEnumPreview";
import { ArrayOfStringsPreview } from "./property_previews/ArrayOfStringsPreview";
import { ArrayOneOfPreview } from "./property_previews/ArrayOneOfPreview";
import { MapPropertyPreview } from "./property_previews/MapPropertyPreview";
import { ReferencePreview } from "./components/ReferencePreview";
import { DatePreview } from "./components/DatePreview";
import { BooleanPreview } from "./components/BooleanPreview";
import { NumberPropertyPreview } from "./property_previews/NumberPropertyPreview";
import { ErrorView } from "@rebasepro/app";
import { RelationPreview } from "./components/RelationPreview";
import { InlineEntityListPreview } from "./components/InlineEntityListPreview";
import { useIsNestedEntityPreview } from "../components/EntityPreviewNesting";
import { markdownToPlainText } from "./compact_text";
import { UserPreview } from "./components/UserPreview";

/**
 * @group Preview components
 */
export const PropertyPreview = React.memo(function PropertyPreview<P extends Property>(props: PropertyPreviewProps<P>) {

    const authController = useAuthController();
    const customizationController = useCustomizationController();
    const nested = useIsNestedEntityPreview();

    let content: React.ReactNode | any;
    const {
        property: inputProperty,
        propertyKey,
        value,
        size,
        height,
        width,
        interactive,
        fill
    } = props;

    // A preview rendered inside an entity preview fills one line of a card and
    // has no room to grow — see {@link PropertyPreviewProps.compact}. The card
    // is the thing that knows this, and it says so by opening a nesting
    // boundary, so the depth is the signal rather than a prop every caller
    // between here and there would have to forward.
    const compact = props.compact ?? (nested || Boolean(props.textOnly));

    const property = resolveProperty({
        propertyKey,
        property: inputProperty,
        propertyConfigs: customizationController.propertyConfigs,
        authController
    }) as Property | null;

    if (property === null) {
        content = <EmptyValue/>;
    } else if (property.admin?.Preview) {
        const ResolvedPreview = resolveComponentRef(property.admin.Preview) as React.ComponentType<PropertyPreviewProps<Property>> | undefined;
        if (ResolvedPreview) {
            content = <Suspense fallback={null}>
                {createElement(ResolvedPreview,
                    {
                        propertyKey,
                        value,
                        property,
                        size,
                        height,
                        width,
                        customProps: property.admin?.customProps
                    })}
            </Suspense>;
        }
    } else if (value === undefined || value === null) {
        content = <EmptyValue/>;
    } else if (property.type === "string") {
        const stringProperty = property as StringProperty;
        if (typeof value === "string") {
            if (stringProperty.storage) {
                const filePath = stringProperty.storage.previewUrl ? stringProperty.storage.previewUrl(value) : value;
                content = <StorageThumbnail
                    interactive={interactive}
                    storeUrl={property.storage?.storeUrl ?? false}
                    storageSourceKey={stringProperty.storage.storageSource === undefined ? undefined : resourceKeyOf(stringProperty.storage.storageSource)}
                    size={props.size}
                    fill={fill}
                    storagePathOrDownloadUrl={filePath}/>;
            } else if (stringProperty.admin?.urlPreview) {
                if (typeof stringProperty.admin?.urlPreview === "boolean")
                    content =
                        <UrlComponentPreview size={props.size}
                            url={value}
                            fill={fill}/>;
                else if (typeof stringProperty.admin?.urlPreview === "string")
                    content =
                        <UrlComponentPreview size={props.size}
                            url={value}
                            interactive={interactive}
                            fill={fill}
                            previewType={stringProperty.admin?.urlPreview}/>;
            } else if (stringProperty.admin?.markdown) {
                content = compact
                    ? <span className={"text-sm"}>{markdownToPlainText(value)}</span>
                    : <Markdown source={value} size={"small"}/>;
            } else if (stringProperty.userSelect) {
                content = <UserPreview
                    value={value}
                    property={stringProperty}
                    propertyKey={propertyKey}
                    size={props.size}
                />;
            } else {
                content = <StringPropertyPreview {...props}
                    compact={compact}
                    property={stringProperty}
                    value={value}/>;
            }
        } else {
            content = buildWrongValueType(propertyKey, property.type, value);
        }
    } else if (property.type === "array") {
        if (Array.isArray(value)) {
            const arrayProperty = property as ArrayProperty;
            if (!arrayProperty.of && !arrayProperty.oneOf) {
                throw Error(`You need to specify an 'of' or 'oneOf' prop (or specify a custom field) in your array property ${propertyKey}`);
            }

            if (arrayProperty.of) {
                if (Array.isArray(arrayProperty.of)) {
                    content = <ArrayPropertyPreview {...props}
                        compact={compact}
                        value={value}
                        property={arrayProperty}/>;
                } else if (arrayProperty.of.type === "reference") {
                    content = <ArrayOfReferencesPreview {...props}
                        value={value}
                        property={property}/>;
                } else if (arrayProperty.of.type === "relation") {
                    content = <ArrayOfRelationsPreview {...props}
                        value={value}
                        property={property}/>;
                } else if (arrayProperty.of.type === "string") {
                    if (arrayProperty.of.enum) {
                        content = <ArrayPropertyEnumPreview
                            {...props}
                            value={value}
                            property={property}/>;
                    } else if (arrayProperty.of.storage) {
                        content = <ArrayOfStorageComponentsPreview
                            {...props}
                            value={value}
                            property={property as ArrayProperty}/>;
                    } else {
                        content = <ArrayOfStringsPreview
                            {...props}
                            compact={compact}
                            property={property as ArrayProperty}
                            value={value as string[]}/>;
                    }
                } else if (arrayProperty.of.type === "number" && arrayProperty.of.enum) {
                    content = <ArrayPropertyEnumPreview
                        {...props}
                        value={value as number[]}
                        property={property as ArrayProperty}/>;
                } else {
                    content = <ArrayPropertyPreview {...props}
                        compact={compact}
                        value={value}
                        property={property as ArrayProperty}/>;
                }
            } else if (arrayProperty.oneOf) {
                content = <ArrayOneOfPreview {...props}
                    compact={compact}
                    value={value}
                    property={property as ArrayProperty}/>;
            }
        } else {
            content = buildWrongValueType(propertyKey, property.type, value);
        }
    } else if (property.type === "map") {
        if (typeof value === "object") {
            content =
                <MapPropertyPreview {...props}
                    compact={compact}
                    value={value as Record<string, any>}
                    property={property as MapProperty}/>;
        } else {
            content = buildWrongValueType(propertyKey, property.type, value);
        }
    } else if (property.type === "date") {
        // Not every caller comes through the data layer's Date coercion: the
        // revision history renders raw API payloads, where a timestamp is still
        // the string Postgres sent (`2026-06-19 17:20:33.032+02`). Requiring a
        // `Date` instance turned every audit column in every history entry into
        // a red "Unexpected value" box.
        const date = asDate(value);
        if (date) {
            content = <DatePreview
                date={date}
                mode={property.mode}
            />;
        } else {
            content = buildWrongValueType(propertyKey, property.type, value);
        }
    } else if (property.type === "reference") {
        if (typeof property.path === "string") {
            if (typeof value === "object" && value !== null && "isEntityReference" in value && (value as EntityReference).isEntityReference()) {
                content = <ReferencePreview
                    disabled={!property.path}
                    previewProperties={property.admin?.previewProperties}
                    includeId={property.admin?.includeId}
                    includeEntityLink={property.admin?.includeEntityLink}
                    size={props.size}
                    reference={value as EntityReference}
                    textOnly={props.textOnly}
                />;
            } else {
                content = buildWrongValueType(propertyKey, property.type, value);
            }
        } else {
            content = <EmptyValue/>;
        }

    } else if (property.type === "relation") {
        // A relation column arrives either hydrated or as the bare foreign key,
        // depending on the fetch path. The declared target resolves the latter;
        // see `normalizeToEntityRelation`.
        const relationTargetPath = getRelationTargetPath(property);
        if (!value) {
            content = <EmptyValue/>;
        } else if (Array.isArray(value)) {
            // Many-cardinality relation: value is an array of EntityRelation (or plain objects)
            const relations = (value as unknown[])
                .map(item => normalizeToEntityRelation(item, "relation", relationTargetPath))
                .filter(Boolean) as EntityRelation[];
            const renderRelation = (entityRelation: EntityRelation, index: number) => <RelationPreview
                key={`preview_rel_${propertyKey}_${index}`}
                disabled={!property.relation}
                previewProperties={property.admin?.previewProperties}
                includeId={property.admin?.includeId}
                includeEntityLink={property.admin?.includeEntityLink}
                size={"small"}
                relation={entityRelation}
                textOnly={props.textOnly}
            />;

            content = nested || props.textOnly
                // See ArrayOfReferencesPreview: nested lists stay on one line.
                ? <InlineEntityListPreview items={relations}
                    renderItem={renderRelation}/>
                : (
                    <div className="flex flex-col w-full gap-0.5">
                        {relations.map((entityRelation, index) => (
                            <div className="w-full"
                                key={`preview_rel_wrapper_${propertyKey}_${index}`}>
                                {renderRelation(entityRelation, index)}
                            </div>
                        ))}
                    </div>
                );
        } else {
            // Single-cardinality relation
            const relationValue = normalizeToEntityRelation(value, "relation", relationTargetPath);
            if (relationValue) {
                content = <RelationPreview
                    disabled={!property.relation}
                    previewProperties={property.admin?.previewProperties}
                    includeId={property.admin?.includeId}
                    includeEntityLink={property.admin?.includeEntityLink}
                    size={props.size}
                    relation={relationValue}
                    textOnly={props.textOnly}
                />;
            } else {
                content = buildWrongValueType(propertyKey, property.type, value);
            }
        }

    } else if (property.type === "boolean") {
        if (typeof value === "boolean") {
            content = <BooleanPreview value={value} size={size} property={property} hideLabel={props.hideLabel}/>;
        } else {
            content = buildWrongValueType(propertyKey, property.type, value);
        }
    } else if (property.type === "number") {
        if (typeof value === "number") {
            content = <NumberPropertyPreview {...props}
                value={value}
                property={property as NumberProperty}/>;
        } else {
            content = buildWrongValueType(propertyKey, property.type, value);
        }
    } else {
        content = JSON.stringify(value);
    }

    return content === undefined || content === null || (Array.isArray(content) && content.length === 0)
        ? <EmptyValue/>
        : content;
}, equal);

/**
 * A `Date`, or a string/number that unambiguously names one. Returns null for
 * anything else, so an actual type mismatch still reports as one.
 */
function asDate(value: unknown): Date | null {
    if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
    if (typeof value !== "string" && typeof value !== "number") return null;
    const parsed = new Date(value);
    return isNaN(parsed.getTime()) ? null : parsed;
}

function buildWrongValueType(name: string | undefined, type: string, value: any) {
    console.warn(`Unexpected value for property ${name}, of type ${type}`, value);
    return (
        <ErrorView title={"Unexpected value"}
            error={`${JSON.stringify(value)}`}/>
    );
}
