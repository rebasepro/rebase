import React, { useMemo } from "react";
import { Typography } from "../../components";
import { cls, getColorSchemeForKey } from "../../util";

export interface BoardColumnTitleProps {
    children: React.ReactNode;
    className?: string;
    "aria-label"?: string;
    color?: any;
}

export function BoardColumnTitle({
    children,
    className,
    color,
    ...props
}: BoardColumnTitleProps) {
    const colorScheme = useMemo(() => {
        if (!color) return undefined;
        if (typeof color === "string") {
            return getColorSchemeForKey(color);
        }
        return color;
    }, [color]);

    return (
        <Typography
            variant="subtitle2"
            component="h4"
            className={
                cls("py-2.5 px-2.5 transition-colors duration-150 flex-grow select-none relative outline-none focus:outline focus:outline-2 focus:outline-offset-2 flex items-center gap-2",
                    className)
            }
            {...props}
        >
            {colorScheme && (
                <div
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{
                        backgroundColor: colorScheme.darkColor ?? colorScheme.color
                    }}
                />
            )}
            {children}
        </Typography>
    );
}
