import React from "react";

import { colorClassesMapping, IconProps, iconSize } from "./Icon";
import { cls } from "../util";

export function HandleIcon({ size = 24, color, className, onClick, style }: IconProps) {
    const px = typeof size === "number" ? size : iconSize[size];
    return <svg xmlns="http://www.w3.org/2000/svg"
                className={cls(color ? colorClassesMapping[color] : "", className)}
                onClick={onClick}
                style={style}
                width={px}
                height={px}
                viewBox="0 0 100 100"
                fill="none">
        <circle cx="28" cy="50" r="9" fill={"currentColor"}/>
        <circle cx="28" cy="21" r="9" fill={"currentColor"}/>
        <circle cx="71" cy="21" r="9" fill={"currentColor"}/>
        <circle cx="71" cy="50" r="9" fill={"currentColor"}/>
        <circle cx="71" cy="78" r="9" fill={"currentColor"}/>
        <circle cx="28" cy="78" r="9" fill={"currentColor"}/>
    </svg>;
}
