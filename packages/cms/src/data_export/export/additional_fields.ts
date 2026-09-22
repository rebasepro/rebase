import { Entity } from "@rebasepro/types";
import { AdditionalFieldDelegate, ExportMappingFunction, RebaseContext } from "@rebasepro/cms-types";

/**
 * Additional-field builders run per row and may do I/O, so a `Promise.all` over
 * the whole export is one request per row all at once. That was bounded only by
 * the 50-row cap the export used to have; now that the read is paginated, it is
 * bounded here instead.
 */
const ADDITIONAL_FIELDS_CONCURRENCY = 50;

async function mapInChunks<T, R>(items: T[], fn: (item: T) => Promise<R>, chunkSize = ADDITIONAL_FIELDS_CONCURRENCY): Promise<R[]> {
    const results: R[] = [];
    for (let i = 0; i < items.length; i += chunkSize) {
        results.push(...await Promise.all(items.slice(i, i + chunkSize).map(fn)));
    }
    return results;
}

/**
 * The values of the export's extra columns, one record per entity: the
 * collection's `exportable.additionalFields` and its `additionalFields` that
 * declare a `value`, both in the same record.
 */
export async function resolveAdditionalExportValues<M extends Record<string, unknown>>({
    entities,
    exportFields,
    additionalFields,
    context
}: {
    entities: Entity<M>[];
    exportFields: ExportMappingFunction[] | undefined;
    additionalFields: AdditionalFieldDelegate<M>[] | undefined;
    context: RebaseContext;
}): Promise<Record<string, unknown>[]> {

    const resolvedExportColumnsValues: Record<string, unknown>[] = exportFields
        ? await mapInChunks(entities, async (entity) => {
            return (await Promise.all(exportFields.map(async (column) => {
                return {
                    [column.key]: await column.builder({
                        entity,
                        context
                    })
                };
            }))).reduce((a, b) => ({ ...a,
...b }), {});
        })
        : [];

    const resolvedColumnsValues: Record<string, unknown>[] = additionalFields
        ? await mapInChunks(entities, async (entity) => {
            return (await Promise.all(additionalFields
                .map(async (field) => {
                    if (!field.value)
                        return {};
                    return {
                        [field.key]: await field.value({
                            entity,
                            context
                        })
                    };
                }))).reduce((a, b) => ({ ...a,
...b }), {});
        })
        : [];
    // One record per entity, index for index — the export merges
    // `additionalData[i]` into row `i`.
    return entities.map((_, i) => ({
        ...resolvedExportColumnsValues[i],
        ...resolvedColumnsValues[i]
    }));
}
