import React from "react";
import { cls } from "../util";

export type CircularProgressProps = {
    size?: "smallest" | "small" | "medium" | "large",
    className?: string
}

export function CircularProgress({
                                     size = "medium",
                                     className
                                 }: CircularProgressProps) {

    let sizeClasses = "";
    if (size === "smallest") {
        sizeClasses = "w-4 h-4";
    } else if (size === "small") {
        sizeClasses = "w-6 h-6";
    } else if (size === "medium") {
        sizeClasses = "w-8 h-8 m-1";
    } else {
        sizeClasses = "w-10 h-10 m-1";
    }

    let borderClasses = "";
    if (size === "smallest") {
        borderClasses = "border-2";
    } else if (size === "small") {
        borderClasses = "border-2";
    } else if (size === "medium") {
        borderClasses = "border-[3px]";
    } else {
        borderClasses = "border-4";
    }

    return (
        <div
            className={cls(
                sizeClasses,
                borderClasses,
                "inline-block shrink-0 rounded-full border-solid align-[-0.125em]",
                "animate-[spin_0.7s_linear_infinite] motion-reduce:animate-[spin_1.5s_linear_infinite]",
                "border-surface-200 dark:border-surface-700 border-t-primary dark:border-t-primary",
                className)}
            role="status">
              <span
                  className="absolute! -m-px! h-px! w-px! overflow-hidden! whitespace-nowrap! border-0! p-0! [clip:rect(0,0,0,0)]!"
              >
                  Loading...
              </span>
        </div>
    );
}
