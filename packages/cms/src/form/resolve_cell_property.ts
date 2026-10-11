import type { AuthController, PropertyConfig } from "@rebasepro/cms-types";
import type { Entity, Properties, Property } from "@rebasepro/types";
import { isPropertyBuilder } from "@rebasepro/common";
import { resolveFormProperty, resolvePropertiesForValidation } from "./resolve_form_properties";

/**
 * The table's two editors — the inline cell and the popup — judged a value
 * against the raw declaration, as the record form once did: a `dynamicProps`
 * validation or a `conditions` rule (`disabled`, `min`, `required`…) applied
 * in the form and nowhere in the table. These resolve a cell's property
 * against its own row, with the record form's {@link resolveFormProperty}.
 */
export interface CellResolutionContext {
    path: string;
    authController: AuthController;
    propertyConfigs?: Record<string, PropertyConfig>;
}

/**
 * Resolved per row, and held as long as the row object is: a column of plain
 * properties keeps its property object (and so its cached schema and its
 * memoised cells); only a builder or a property with `conditions` is resolved,
 * once per row value.
 */
const resolvedByRow = new WeakMap<object, Map<string, { raw: Property; resolved: Property | null }>>();

export function resolveCellProperty(
    property: Property,
    propertyKey: string,
    entity: Entity<Record<string, unknown>>,
    context: CellResolutionContext
): Property | null {
    if (!isPropertyBuilder(property) && !property.conditions) return property;
    const rowKey: object = entity.values ?? entity;
    let byKey = resolvedByRow.get(rowKey);
    if (!byKey) {
        byKey = new Map();
        resolvedByRow.set(rowKey, byKey);
    }
    const cached = byKey.get(propertyKey);
    if (cached && cached.raw === property) return cached.resolved;
    const resolved = resolveFormProperty({
        property,
        propertyKey,
        values: entity.values,
        previousValues: entity.values,
        path: context.path,
        entityId: entity.id,
        propertyConfigs: context.propertyConfigs,
        authController: context.authController,
        ignoreMissingFields: true
    });
    byKey.set(propertyKey, { raw: property, resolved });
    return resolved;
}

/**
 * The properties that judge one cell: the property at `propertyKey`, under the
 * maps its key goes through, and nothing beside it.
 *
 * A spread map's child is `address.street`, a path into `properties` rather
 * than a key of it; looked up as a key it found nothing, and the popup
 * validated nothing. The maps on the way carry only the edited child and none
 * of their own rules: the popup shows one field, and an error anywhere else
 * would block the save where no one could see it.
 */
export function propertiesOfCell(properties: Properties, propertyKey: string): Properties {
    if (propertyKey in properties) return { [propertyKey]: properties[propertyKey] };
    const dot = propertyKey.indexOf(".");
    if (dot === -1) return {};
    const mapKey = propertyKey.slice(0, dot);
    const map = properties[mapKey];
    if (map?.type !== "map" || !map.properties) return {};
    const children = propertiesOfCell(map.properties, propertyKey.slice(dot + 1));
    return Object.keys(children).length > 0
        ? { [mapKey]: { type: "map", properties: children } }
        : {};
}

/**
 * What the popup judges a cell by, given the values it holds now: the
 * collection's properties resolved as the record form resolves them on submit
 * (so a field a rule hides or disables is not judged), cut to the cell.
 */
export function cellValidationProperties<M extends Record<string, unknown>>(
    properties: Properties,
    propertyKey: string,
    values: Partial<M>,
    previousValues: Partial<M> | undefined,
    entityId: string | number | undefined,
    context: CellResolutionContext
): Properties {
    const resolved = resolvePropertiesForValidation<M>({
        properties,
        values,
        previousValues,
        path: context.path,
        entityId,
        propertyConfigs: context.propertyConfigs,
        authController: context.authController
    });
    return propertiesOfCell(resolved, propertyKey);
}
