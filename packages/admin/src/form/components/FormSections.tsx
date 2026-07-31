import type { ResolvedFormField, ResolvedFormSection } from "@rebasepro/app";
import React from "react";
import { ChevronDownIcon, cls, defaultBorderMixin, iconSize } from "@rebasepro/ui";

export interface FormSectionsProps {
    sections: ResolvedFormSection[];
    /** Section keys the user has collapsed. */
    collapsed: ReadonlySet<string>;
    onToggle: (key: string) => void;
    /**
     * Field keys currently showing a validation error. A section holding one is
     * forced open — an error that hides inside a collapsed group is a form the
     * user cannot submit and cannot debug.
     */
    errorKeys: ReadonlySet<string>;
    renderField: (field: ResolvedFormField) => React.ReactNode;
}

export function FormSections({
    sections,
    collapsed,
    onToggle,
    errorKeys,
    renderField
}: FormSectionsProps) {

    return (
        <div className={"flex flex-col gap-8"}>
            {sections.map((section) => {

                const hasError = section.fields.some(f => errorKeys.has(f.key));
                const isCollapsed = section.collapsible && collapsed.has(section.key) && !hasError;

                return (
                    <section key={section.key} className={"min-w-0"}>

                        {section.title && (
                            <Header
                                title={section.title}
                                collapsible={section.collapsible}
                                collapsed={isCollapsed}
                                onToggle={() => onToggle(section.key)}/>
                        )}

                        {!isCollapsed && (
                            // A container query, not a media query: the form is
                            // rendered at four very different widths (full
                            // screen, side panel, split pane, dialog) inside the
                            // same viewport, so spans have to answer to the
                            // column they are in, not to the window.
                            <div className={cls(
                                "grid gap-x-4 gap-y-5 min-w-0",
                                "grid-cols-1 @2xl:grid-cols-4"
                            )}>
                                {section.fields.map(renderField)}
                            </div>
                        )}
                    </section>
                );
            })}
        </div>
    );
}

function Header({
    title,
    collapsible,
    collapsed,
    onToggle
}: {
    title: string;
    collapsible: boolean;
    collapsed: boolean;
    onToggle: () => void;
}) {

    const content = (
        <>
            {collapsible && (
                <ChevronDownIcon
                    size={iconSize.smallest}
                    className={cls(
                        "text-text-disabled dark:text-text-disabled-dark transition-transform duration-150",
                        collapsed && "-rotate-90"
                    )}/>
            )}
            <span className={"text-xs font-semibold uppercase tracking-wider text-text-disabled dark:text-text-disabled-dark whitespace-nowrap"}>
                {title}
            </span>
            <span className={cls("flex-1 border-t", defaultBorderMixin)}/>
        </>
    );

    const className = "flex items-center gap-2.5 w-full mb-3.5";

    if (!collapsible) {
        return <div className={className}>{content}</div>;
    }

    return (
        <button type={"button"}
            onClick={onToggle}
            aria-expanded={!collapsed}
            className={cls(className, "text-left hover:opacity-80 transition-opacity")}>
            {content}
        </button>
    );
}
