import type { RebasePlugin } from "@rebasepro/cms-types";
import { warnDeprecated } from "@rebasepro/common";

/**
 * Warn, once per plugin and key, about plugin keys that are declared on
 * `RebasePlugin` but that nothing has ever called.
 *
 * A plugin that set one of these did nothing and said nothing about it. The
 * types mark them deprecated; this names them at runtime too, which also
 * reaches a plugin written in JavaScript.
 */
export function warnDeprecatedPluginKeys(plugins: readonly RebasePlugin[]): void {
    for (const plugin of plugins) {
        if (plugin.hooks?.modifyCollectionAsync !== undefined) {
            warnDeprecated(
                `plugin:${plugin.key}:hooks.modifyCollectionAsync`,
                `Plugin "${plugin.key}" sets \`hooks.modifyCollectionAsync\`, which is deprecated: ` +
                "nothing has ever called it. Remove it and use `hooks.modifyCollection` instead — fetch what " +
                "the change needs before rendering `<Rebase>` (keep the plugin `loading: true` until it arrives) " +
                "and apply it there synchronously."
            );
        }
        if (plugin.lifecycle?.onCollectionChange !== undefined) {
            warnDeprecated(
                `plugin:${plugin.key}:lifecycle.onCollectionChange`,
                `Plugin "${plugin.key}" sets \`lifecycle.onCollectionChange\`, which is deprecated: ` +
                "nothing has ever called it. Remove it and subscribe to the rows yourself instead — " +
                "`context.data.collection(slug).listen(...)` from `lifecycle.onMount`, unsubscribing in " +
                "`lifecycle.onUnmount`."
            );
        }
    }
}
