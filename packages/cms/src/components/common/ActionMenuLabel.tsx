import React from "react";
import { Typography } from "@rebasepro/ui";

/**
 * An action's name in a menu and, when it is unavailable and says why, the
 * reason on a line beneath it.
 *
 * In the text rather than a tooltip: a disabled menu item cannot be focused or
 * hovered into anything, and on a touch screen there is no hover at all — the
 * reason has to be readable where the item is. It is drawn in the label's own
 * ink, a size down, because the item dims everything it holds: a muted colour
 * under that dimming fell below legible.
 */
export function ActionMenuLabel({ name, disabledReason }: { name: string, disabledReason?: string }) {
    if (!disabledReason) return <>{name}</>;
    return (
        <div className={"flex flex-col min-w-0"}>
            {name}
            <Typography variant={"caption"} color={"inherit"} className={"font-normal"}>
                {disabledReason}
            </Typography>
        </div>
    );
}
