import React from "react";
import { cls } from "../util";
import { useInjectStyles } from "../hooks";

export type SkeletonProps = {
    width?: number;
    height?: number;
    className?: string;
}

const styles = `
@keyframes shimmer {
  0% {
    transform: translateX(-150%);
  }
  100% {
    transform: translateX(150%);
  }
}
`;

export function Skeleton({
                             width,
                             height,
                             className
                         }: SkeletonProps) {

    useInjectStyles("Skeleton", styles);

    return <span
        style={{
            width: width === undefined ? undefined : `${width}px`,
            height: height === undefined ? undefined : `${height}px`
        }}
        className={
        cls(
            "block relative overflow-hidden",
            "bg-surface-accent-50 dark:bg-surface-accent-800 rounded-md",
            "max-w-full max-h-full",
            // The defaults are classes, not inline styles, so that a caller can
            // override them: an inline style beats every utility, which is why
            // `<Skeleton className="w-full h-full"/>` inside a 40px thumbnail
            // box used to render a 12px bar. The `width`/`height` props still
            // win over any class, since those do land inline.
            width === undefined ? "w-full" : undefined,
            height === undefined ? "h-3" : undefined,
            className)
    }>
        <span
            className="absolute inset-0 bg-gradient-to-r from-transparent via-white/50 dark:via-white/8 to-transparent"
            style={{ animation: "shimmer 1.8s ease-in-out infinite" }}
        />
    </span>;
}
