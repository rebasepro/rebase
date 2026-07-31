import React from "react";
import { defaultBorderMixin } from "../styles";
import { cls } from "../util";

export function DialogActions({
                                  children,
                                  position = "sticky",
                                  translucent = true,
                                  className
                              }: {
    children: React.ReactNode,
    position?: "sticky" | "absolute",
    translucent?: boolean,
    className?: string
}) {

    return <div
        className={cls(
            defaultBorderMixin,
            // `shrink-0`: as a flex child at the foot of a column this bar must
            // keep its height instead of being squeezed by the content above it.
            "pt-2 pb-4 px-4 border-t flex flex-row items-center justify-end shrink-0 bottom-0 right-0 left-0 text-right z-2 gap-2",
            position,
            "bg-white bg-opacity-60 bg-white/60 dark:bg-surface-800 dark:bg-opacity-60 dark:bg-surface-800/60",
            translucent ? "backdrop-blur-sm" : "",
            className)}>
        {children}
    </div>;
}
