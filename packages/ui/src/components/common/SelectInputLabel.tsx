import React from "react";
import { cls } from "../../util";

export function SelectInputLabel({ children, error }: { children: React.ReactNode, error?: boolean }) {
    return <div className={cls("text-sm font-medium ml-3.5 mb-1",
        error ? "text-red-600 dark:text-red-500" : "text-surface-accent-500 dark:text-surface-accent-300")}>
        {children}
    </div>;
}
