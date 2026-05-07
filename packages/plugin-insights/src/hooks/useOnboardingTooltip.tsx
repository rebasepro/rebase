import React from "react";

export function useOnboardingTooltip(id: string): {
    defaultOpen: boolean;
    close: () => void;
} {

    const dismissed = getTooltipDismissed(id);
    const [open, setOpen] = React.useState(!dismissed);

    return {
        defaultOpen: open,
        close: () => {
            setOpen(false);
            saveTooltipDismissed(id);
        }
    };
}

function saveTooltipDismissed(id: string) {
    localStorage.setItem(`onboarding-tooltip-${id}`, "dismissed");
}

function getTooltipDismissed(id: string) {
    return localStorage.getItem(`onboarding-tooltip-${id}`) === "dismissed";
}

export function resetAllTooltips() {
    for (const key in localStorage) {
        if (key.startsWith("onboarding-tooltip-")) {
            localStorage.removeItem(key);
        }
    }
}
