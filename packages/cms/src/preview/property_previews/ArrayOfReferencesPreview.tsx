import type { ArrayProperty, ReferenceProperty, EntityReference } from "@rebasepro/types";
import type { PropertyPreviewProps, PreviewSize } from "../../types/components/PropertyPreviewProps";
import { ReferencePreview } from "../components/ReferencePreview";
import { useIsNestedEntityPreview } from "../../components/EntityPreviewNesting";
import { InlineEntityListPreview } from "../components/InlineEntityListPreview";

/**
 * @group Preview components
 */
export function ArrayOfReferencesPreview({
    propertyKey,
    value,
    property: property,
    size,
    textOnly
}: PropertyPreviewProps<ArrayProperty>) {

    const nested = useIsNestedEntityPreview();

    if (Array.isArray(property?.of)) {
        throw Error("Using array properties instead of single one in `of` in ArrayProperty");
    }

    if (property?.type !== "array" || !property.of || property.of.type !== "reference")
        throw Error("Picked wrong preview component ArrayOfReferencesPreview");

    const childSize: PreviewSize = size === "medium" ? "medium" : "small";
    const ofProperty = property.of as ReferenceProperty;

    // Stacked cards inside another preview (or a title slot) turn a list into a
    // wall of boxes: keep it to one wrapping line of links.
    if (nested || textOnly) {
        return <InlineEntityListPreview
            items={(value ?? []) as EntityReference[]}
            renderItem={(reference, index) => <ReferencePreview
                key={`preview_array_ref_${propertyKey}_${index}`}
                disabled={!ofProperty.path}
                previewProperties={ofProperty.admin?.previewProperties}
                size={childSize}
                reference={reference}
                textOnly={textOnly}
                includeId={ofProperty.admin?.includeId}
                includeEntityLink={ofProperty.admin?.includeEntityLink}
            />}/>;
    }

    return (
        <div className="flex flex-col w-full">
            {value ?
                (value as EntityReference[]).map((reference, index: number) => {
                    const ofProperty = property.of as ReferenceProperty;
                    return <div className="mt-1 mb-1 w-full"
                        key={`preview_array_ref_${propertyKey}_${index}`}>
                        <ReferencePreview
                            disabled={!ofProperty.path}
                            previewProperties={ofProperty.admin?.previewProperties}
                            size={childSize}
                            reference={reference}
                            includeId={ofProperty.admin?.includeId}
                            includeEntityLink={ofProperty.admin?.includeEntityLink}
                        />
                    </div>;
                }
                ) : null}
        </div>
    );
}
