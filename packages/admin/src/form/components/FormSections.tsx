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
    /**
     * Which rendering this is. `"read"` opens the gaps up rather than closing
     * them: a control is a bordered 40px box that separates itself from the next
     * one, and a value is bare text that does not. The form can also afford
     * tighter rows because a description usually sits between them; with that
     * gone, the same numbers ran a record's values together into one block.
     */
    mode?: "edit" | "read";
    /**
     * Renders one field as a summary row, for a section that asked for
     * `readVariant: "summary"`. Only the read view supplies it; without it such
     * a section falls back to the grid rather than to nothing.
     */
    renderSummaryField?: (field: ResolvedFormField, index: number, total: number) => React.ReactNode;
}

export function FormSections({
    sections,
    collapsed,
    onToggle,
    errorKeys,
    renderField,
    mode = "edit",
    renderSummaryField
}: FormSectionsProps) {

    const reading = mode === "read";

    return (
        <div className={cls("flex flex-col", reading ? "gap-10" : "gap-8")}>
            {sections.map((section) => {

                const hasError = section.fields.some(f => errorKeys.has(f.key));
                const isCollapsed = section.collapsible && collapsed.has(section.key) && !hasError;
                const summary = reading
                    && section.readVariant === "summary"
                    && Boolean(renderSummaryField);

                return (
                    <section key={section.key} className={"min-w-0"}>

                        {section.title && (
                            <Header
                                title={section.title}
                                collapsible={section.collapsible}
                                collapsed={isCollapsed}
                                controls={`form_section_${section.key}`}
                                onToggle={() => onToggle(section.key)}/>
                        )}

                        {!isCollapsed && (summary
                            ? <div id={`form_section_${section.key}`}
                                className={"flex flex-col min-w-0 @2xl:max-w-md @2xl:ml-auto"}>
                                {section.fields.map((field, index) =>
                                    renderSummaryField!(field, index, section.fields.length))}
                            </div>
                            // A container query, not a media query: the form is
                            // rendered at four very different widths (full
                            // screen, side panel, split pane, dialog) inside the
                            // same viewport, so spans have to answer to the
                            // column they are in, not to the window.
                            : <div id={`form_section_${section.key}`}
                                className={cls(
                                    "grid min-w-0",
                                    reading ? "gap-x-8 gap-y-7" : "gap-x-4 gap-y-5",
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
    controls,
    onToggle
}: {
    title: string;
    collapsible: boolean;
    collapsed: boolean;
    /**
     * Id of the region this header shows and hides. Only referenced while that
     * region exists — a collapsed section unmounts its fields, and pointing
     * `aria-controls` at an id that is not in the document is its own defect.
     */
    controls: string;
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
            aria-controls={collapsed ? undefined : controls}
            className={cls(className, "text-left hover:opacity-80 transition-opacity")}>
            {content}
        </button>
    );
}
