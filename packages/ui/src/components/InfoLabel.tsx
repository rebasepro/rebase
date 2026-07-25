import React from "react";
import { cls } from "../util";

const colorClasses = {
    info: "bg-blue-500/8 dark:bg-blue-500/12 text-blue-800 dark:text-blue-200 border border-blue-500/20 dark:border-blue-500/25",
    warn: "bg-amber-500/8 dark:bg-amber-500/12 text-amber-800 dark:text-amber-200 border border-amber-500/20 dark:border-amber-500/25"
}

export function InfoLabel({
                              children,
                              mode = "info"
                          }: {
    children: React.ReactNode,
    mode?: "info" | "warn"
}) {

    return (
        <div
            className={cls("my-3 py-2 px-4 rounded-lg text-sm font-medium leading-snug", colorClasses[mode])}>
            {children}
        </div>
    )
}
