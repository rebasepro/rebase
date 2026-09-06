import React, { forwardRef } from "react";
import { cls } from "@rebasepro/ui";

interface LabelWithIconProps {
    icon: React.ReactNode;
    title?: string;
    small?: boolean;
    className?: string;
    required?: boolean;
    /**
     * `id` for the text of the label, so a control can point at it with
     * `aria-labelledby`.
     *
     * On the *text*, not on the wrapper: the wrapper also holds the property's
     * type icon, and an accessible name assembled from a decorative `<svg>` is
     * a name nobody chose. Deliberately absent by default — an unused `id` is
     * one more thing that can collide.
     */
    labelId?: string;
}

/**
 * Render the label of with an icon and the title of a property
 * @group Form custom fields
 */
export const LabelWithIcon = forwardRef<HTMLDivElement, LabelWithIconProps>(
    ({
        icon,
        title,
        small,
        className,
        required,
        labelId
    }, ref) => {
        return (
            <div
                ref={ref}
                className={cls("align-middle inline-flex items-center my-0.5",
                    small ? "gap-1" : "gap-2",
                    className)}
            >
                {icon}
                <span
                    id={labelId}
                    className={`text-start font-medium text-${small ? "base" : "sm"} origin-top-left transform ${small ? "translate-x-2 scale-75" : ""
                        }`}
                >
                    {(title ?? "") + (required ? " *" : "")}
                </span>
            </div>
        );
    }
);

LabelWithIcon.displayName = "LabelWithIcon";
