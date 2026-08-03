import type { ArrayProperty, RelationProperty } from "@rebasepro/types";
import { EntityRelation } from "@rebasepro/types";
import type { PropertyPreviewProps } from "../../types/components/PropertyPreviewProps";
import { normalizeToEntityRelation } from "@rebasepro/common";
import { RelationPreview } from "../components/RelationPreview";
import { useIsNestedEntityPreview } from "../../components/EntityPreviewNesting";
import { InlineEntityListPreview } from "../components/InlineEntityListPreview";

/**
 * @group Preview components
 */
export function ArrayOfRelationsPreview({
    propertyKey,
    value,
    property,
    size,
    textOnly
}: PropertyPreviewProps<ArrayProperty>) {

    const nested = useIsNestedEntityPreview();

    if (Array.isArray(property?.of)) {
        throw Error("Using array properties instead of single one in `of` in ArrayProperty");
    }

    if (property?.type !== "array" || !property.of || property.of.type !== "relation")
        throw Error("Picked wrong preview component ArrayOfRelationsPreview");

    const ofProperty = property.of as RelationProperty;

    // See ArrayOfReferencesPreview: nested lists stay on one wrapping line.
    if (nested || textOnly) {
        const relations = ((value ?? []) as unknown[])
            .map(relation => normalizeToEntityRelation(relation))
            .filter((relation): relation is EntityRelation => Boolean(relation));
        return <InlineEntityListPreview
            items={relations}
            renderItem={(relation, index) => <RelationPreview
                key={`preview_array_rel_${propertyKey}_${index}`}
                disabled={!ofProperty.relation}
                previewProperties={ofProperty.admin?.previewProperties}
                size={"small"}
                relation={relation}
                textOnly={textOnly}
                includeId={ofProperty.admin?.includeId}
                includeEntityLink={ofProperty.admin?.includeEntityLink}
            />}/>;
    }

    return (
        <div className="flex flex-col w-full gap-0.5">
            {value ?
                (value as unknown[]).map((relation: unknown, index: number) => {
                    const entityRelation = normalizeToEntityRelation(relation);

                    if (!entityRelation) return null;

                    return (
                        <div className="w-full"
                            key={`preview_array_rel_${propertyKey}_${index}`}>
                            <RelationPreview
                                disabled={!ofProperty.relation}
                                previewProperties={ofProperty.admin?.previewProperties}
                                size={"small"}
                                relation={entityRelation}
                                includeId={ofProperty.admin?.includeId}
                                includeEntityLink={ofProperty.admin?.includeEntityLink}
                            />
                        </div>
                    );
                }) : null}
        </div>
    );
}
