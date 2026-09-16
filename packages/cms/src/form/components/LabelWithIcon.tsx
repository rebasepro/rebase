import React, { forwardRef } from "react";
import { cls } from "@rebasepro/ui";
import { PropertyKeyHint } from "../../components/PropertyKeyHint";

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
    /**
     * The property's key, revealed beside the label on hover and copied on
     * click — see {@link PropertyKeyHint}. Leave it out where the label is drawn
     * inside the control it names (a switch, a date field), where a second
     * clickable thing would sit inside the first.
     */
    propertyKey?: string;
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
        labelId,
        propertyKey
    }, ref) => {
        return (
            <div
                ref={ref}
                className={cls("group/label align-middle inline-flex items-center min-w-0 my-0.5",
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
                {propertyKey && <PropertyKeyHint propertyKey={propertyKey}/>}
            </div>
        );
    }
);

LabelWithIcon.displayName = "LabelWithIcon";
