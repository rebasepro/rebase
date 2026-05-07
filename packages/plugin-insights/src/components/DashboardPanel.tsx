import { IconButton, cls } from "@rebasepro/ui";
import { X } from "lucide-react";
import React from "react";
export function DashboardPanel({
    title,
    endComponent,
    onClose,
    className,
    contentClassName,
    onContentScroll,
    contentRef,
    children
}: {
    title: React.ReactNode;
    endComponent?: React.ReactNode;
    onClose?: () => void;
    className?: string;
    contentClassName?: string;
    onContentScroll?: (e: React.UIEvent<HTMLDivElement>) => void;
    contentRef?: React.Ref<HTMLDivElement>;
    children?: React.ReactNode;
}) {
    return (
        <div className={cls("flex flex-col h-full bg-surface-100 dark:bg-surface-900", className)}>
            <div className="flex items-center p-2 border-b border-surface-200 dark:border-surface-800">
                <div className="flex-grow flex items-center">{title}</div>
                <div className="flex items-center gap-1">
                    {endComponent}
                    {onClose && (
                        <IconButton size="small" onClick={onClose}>
                            <X size={16} />
                        </IconButton>
                    )}
                </div>
            </div>
            <div
                className={cls("flex-grow overflow-auto", contentClassName)}
                onScroll={onContentScroll}
                ref={contentRef}
            >
                {children}
            </div>
        </div>
    );
}
