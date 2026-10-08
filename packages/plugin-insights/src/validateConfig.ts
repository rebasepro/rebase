import type { InsightsPluginConfig } from "./types";
import { DEFAULT_PERIOD_DAYS } from "./engine/InsightsEngine";

/**
 * Refuses a config whose insights read a source it does not declare, or whose
 * period is not a whole number of days. Both would otherwise surface as an
 * error tile per insight, on whichever screen a user opened first.
 */
export function assertValidConfig(config: InsightsPluginConfig): void {
    const days = config.period?.days ?? DEFAULT_PERIOD_DAYS;
    if (!Number.isInteger(days) || days < 1) {
        throw new Error(`Insights period.days must be a whole number of days, at least 1; got ${days}.`);
    }
    const declared = Object.keys(config.sources);
    const definitions = [
        ...(config.insights.home ?? []),
        ...Object.values(config.insights.collections ?? {}).flat()
    ];
    for (const definition of definitions) {
        if (!Object.hasOwn(config.sources, definition.source)) {
            throw new Error(
                `Insight "${definition.id}" reads source "${definition.source}", which is not in \`sources\`` +
                ` (declared: ${declared.length > 0 ? declared.join(", ") : "none"}).`
            );
        }
    }
}
