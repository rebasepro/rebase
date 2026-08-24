import React from "react";
import { ExpandablePanel, Typography, CheckSquareIcon, FilterIcon } from "@rebasepro/ui";

// Ported from ValidationPanel: asField title with a leading icon, initially
// expanded so the card shows the panel content rather than a bare header.
export const Expanded = () => (
    <div className="p-4 w-80">
        <ExpandablePanel
            asField
            initiallyExpanded
            innerClassName="p-4"
            title={
                <div className="flex flex-row items-center text-text-secondary dark:text-text-secondary-dark">
                    <CheckSquareIcon size={18}/>
                    <Typography variant="subtitle2" className="ml-4">Validation</Typography>
                </div>
            }>
            <Typography variant="body2" color="secondary">Required, must be a valid email address, max 254 characters.</Typography>
        </ExpandablePanel>
    </div>
);

export const Collapsed = () => (
    <div className="p-4 w-80">
        <ExpandablePanel
            asField
            initiallyExpanded={false}
            innerClassName="p-4"
            title={
                <div className="flex flex-row items-center text-text-secondary dark:text-text-secondary-dark">
                    <FilterIcon size={18}/>
                    <Typography variant="subtitle2" className="ml-4">Conditions</Typography>
                </div>
            }>
            <Typography variant="body2" color="secondary">Show this field only when Status equals Published.</Typography>
        </ExpandablePanel>
    </div>
);

export const InvisibleVariant = () => (
    <div className="p-4 w-80">
        <ExpandablePanel
            invisible
            initiallyExpanded
            title={<Typography variant="subtitle2" className="font-medium">Advanced options</Typography>}>
            <div className="flex flex-col gap-1 pb-2">
                <Typography variant="body2" color="secondary">Cache responses for 5 minutes</Typography>
                <Typography variant="body2" color="secondary">Retry failed requests up to 3 times</Typography>
            </div>
        </ExpandablePanel>
    </div>
);
