import { Typography } from "@rebasepro/ui";
import React from "react";

export function FieldLabel({
                               children,
                               disabled,
                               error

                           }: {
    children: React.ReactNode;
    disabled?: boolean;
    error?: boolean;
}) {
    return <div className={"flex ml-3.5 mt-1"}>
        <Typography variant={"caption"}
                    color={error ? "error" : (disabled ? "disabled" : "secondary")}
                    className={"flex-grow"}>
            <>{children}</>
        </Typography>
    </div>
}
