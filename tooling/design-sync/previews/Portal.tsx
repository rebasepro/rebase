import React from "react";
import { Portal, Typography } from "@rebasepro/ui";

// Portal.Root teleports its children into another DOM node. To keep the
// teleported content visible inside the preview card (instead of jumping to
// document.body) we point it at a local container element, which mirrors how
// consumers scope portals with an explicit `container`.
export const TeleportedContent = () => {
    const [container, setContainer] = React.useState<HTMLDivElement | null>(null);
    return (
        <div className="p-4 w-72">
            <Typography variant="caption" color="secondary" className="block mb-2">Panel (rendered elsewhere in the tree)</Typography>
            <div
                ref={setContainer}
                className="relative min-h-[64px] border border-dashed border-surface-300 dark:border-surface-700 rounded-lg p-3"
            >
                {container && (
                    <Portal.Root container={container}>
                        <div className="rounded-md bg-primary/10 text-primary dark:bg-primary/20 px-3 py-2 text-sm font-medium">
                            Portaled node — mounted here via `container`
                        </div>
                    </Portal.Root>
                )}
            </div>
        </div>
    );
};
