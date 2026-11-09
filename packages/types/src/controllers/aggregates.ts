import type { AggregateGroup, AggregateGroupTransform, AggregateSelect } from "./data";
import type { DriverAggregate, DriverAggregateGroup } from "./data_driver";

/** Every aggregate function, by its SDK name: what `?select=` accepts too. */
export const AGGREGATE_FUNCTIONS: readonly DriverAggregate["fn"][] = [
    "count", "sum", "avg", "min", "max", "countDistinct", "mode", "percentile", "distinct", "fingerprint"
];

/** The functions that take no field. */
export const FIELDLESS_AGGREGATES: ReadonlySet<DriverAggregate["fn"]> = new Set(["count", "fingerprint"]);

/** Every `groupBy` transform. */
export const AGGREGATE_GROUP_TRANSFORMS: readonly AggregateGroupTransform[] = ["lower", "upper", "unnest", "year", "month", "day"];

/** A function's name in its result key: the SDK's camelCase in SQL's spelling. */
const ALIAS_NAMES: Partial<Record<DriverAggregate["fn"], string>> = { countDistinct: "count_distinct" };

/**
 * `percentile`'s `p` as it reads in a key: `0.95` → `95`, `0.5` → `50`,
 * `0.995` → `99_5`.
 */
function percentileLabel(p: number): string {
    return String(Math.round(p * 1000) / 10).replace(".", "_");
}

/**
 * The key an aggregate comes back under.
 *
 * `sum(total)` → `sum_total`, `count()` → `count`, `countDistinct(sid)` →
 * `count_distinct_sid`, `percentile(fame, 0.95)` → `p95_fame`. One function,
 * because the SDK, the REST parser and the HTTP client all derive it and have
 * to agree — a caller reading `row.sum_total` off an SDK result and off an HTTP
 * response is reading the same key or the SDK is broken.
 */
export function aggregateAlias(fn: string, field?: string, p?: number): string {
    if (fn === "percentile") return `p${percentileLabel(p ?? 0)}_${field ?? ""}`;
    const name = ALIAS_NAMES[fn as DriverAggregate["fn"]] ?? fn;
    return field ? `${name}_${field}` : name;
}

/** `percentile`'s `p`, refused unless it is a fraction a key can name (0–1, at most three decimals). */
export function isPercentileFraction(p: unknown): p is number {
    return typeof p === "number" && Number.isFinite(p) && p >= 0 && p <= 1 && Math.abs(Math.round(p * 1000) - p * 1000) < 1e-9;
}

/**
 * An `AggregateSelect` as a driver is handed it — but for its `where`, which
 * the caller decodes into the driver's `filter` (this package has no filter
 * codec).
 */
export function toDriverAggregate(select: AggregateSelect<Record<string, unknown>>): DriverAggregate {
    const field = "field" in select ? select.field as string | undefined : undefined;
    const p = select.fn === "percentile" ? select.p : undefined;
    return {
        fn: select.fn,
        ...(field !== undefined ? { field } : {}),
        ...(p !== undefined ? { p } : {}),
        alias: select.as ?? aggregateAlias(select.fn, field, p)
    };
}

/** Whether `timeZone` names a time zone this runtime knows: an IANA name such as `Europe/Madrid`, or `UTC`. */
export function isTimeZoneName(timeZone: unknown): timeZone is string {
    if (typeof timeZone !== "string" || !/^[A-Za-z][A-Za-z0-9_+\-/]*$/.test(timeZone)) return false;
    try {
        new Intl.DateTimeFormat("en-US", { timeZone });
        return true;
    } catch {
        return false;
    }
}

/** The key a group comes back under: the column's name, or `<transform>_<field>`. */
export function aggregateGroupKey(group: string | AggregateGroup | DriverAggregateGroup): string {
    return typeof group === "string" ? group : `${group.transform}_${group.field}`;
}

/** A `groupBy` entry as a driver is handed it. */
export function toDriverAggregateGroup(group: string | AggregateGroup): string | DriverAggregateGroup {
    return typeof group === "string"
        ? group
        : { field: group.field, transform: group.transform, ...(group.timeZone ? { timeZone: group.timeZone } : {}), key: aggregateGroupKey(group) };
}
