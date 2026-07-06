import type { ArrayProperty, ReferenceProperty, EntityReference } from "@rebasepro/types";
import type { PropertyPreviewProps, PreviewSize } from "../../types/components/PropertyPreviewProps";
import { ReferencePreview } from "../components/ReferencePreview";

/**
 * @group Preview components
 */
export function ArrayOfReferencesPreview({
    propertyKey,
    value,
    property: property,
    size
}: PropertyPreviewProps<ArrayProperty>) {

    if (Array.isArray(property?.of)) {
        throw Error("Using array properties instead of single one in `of` in ArrayProperty");
    }

    if (property?.type !== "array" || !property.of || property.of.type !== "reference")
        throw Error("Picked wrong preview component ArrayOfReferencesPreview");

    const childSize: PreviewSize = size === "medium" ? "medium" : "small";

    return (
        <div className="flex flex-col w-full">
            {value ?
                (value as EntityReference[]).map((reference, index: number) => {
                    const ofProperty = property.of as ReferenceProperty;
                    return <div className="mt-1 mb-1 w-full"
                        key={`preview_array_ref_${propertyKey}_${index}`}>
                        <ReferencePreview
                            disabled={!ofProperty.path}
                            previewProperties={ofProperty.ui?.previewProperties}
                            size={childSize}
                            reference={reference}
                            includeId={ofProperty.includeId}
                            includeEntityLink={ofProperty.includeEntityLink}
                        />
                    </div>;
                }
                ) : null}
        </div>
    );
}
