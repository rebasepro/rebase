import { EnumValueConfig } from "@rebasepro/types";

export function getLabelOrConfigFrom(enumValues: EnumValueConfig[], key?: string | number): EnumValueConfig | undefined {
    if (key === null || key === undefined) return undefined;
    return enumValues.find((entry) => String(entry.id) === String(key));
}
