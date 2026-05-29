import { PropsWithChildren } from "react";

import { CheckSquareIcon, ExpandablePanel, Typography } from "@rebasepro/ui";

export function ValidationPanel({
    children
}: { children?: React.ReactNode }) {

    return (
        <ExpandablePanel
            initiallyExpanded={false}
            asField={true}
            innerClassName="p-4"
            title={
                <div className="flex flex-row text-surface-500 text-text-secondary dark:text-text-secondary-dark">
                    <CheckSquareIcon/>
                    <Typography variant={"subtitle2"}
                        className="ml-4">
                        Validation
                    </Typography>
                </div>
            }>

            {children}

        </ExpandablePanel>
    )
}
