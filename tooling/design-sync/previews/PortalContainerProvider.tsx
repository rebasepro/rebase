import React from "react";
import { PortalContainerProvider, usePortalContainer, Portal, Typography } from "@rebasepro/ui";

// A descendant that reads the container from context (exactly what Sheet and
// Dialog do internally) and portals into it, instead of the default
// document.body — this is the whole reason the provider exists: scoping
// overlays to a specific DOM region (e.g. a modal's own content element).
function ScopedBadge() {
    const container = usePortalContainer();
    if (!container) return null;
    return (
        <Portal.Root container={container}>
            <div className="rounded-md bg-primary/10 text-primary dark:bg-primary/20 px-3 py-2 text-sm font-medium">
                Rendered inside the provided container
            </div>
        </Portal.Root>
    );
}

export const ScopedContainer = () => {
    const [container, setContainer] = React.useState<HTMLDivElement | null>(null);
    return (
        <div className="p-4 w-80">
            <Typography variant="caption" color="secondary" className="block mb-2">Modal content area</Typography>
            <div
                ref={setContainer}
                className="relative min-h-[72px] border border-dashed border-surface-300 dark:border-surface-700 rounded-lg p-3"
            >
                {container && (
                    <PortalContainerProvider container={container}>
                        <ScopedBadge/>
                    </PortalContainerProvider>
                )}
            </div>
        </div>
    );
};
