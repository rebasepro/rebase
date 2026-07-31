"use client";
import React from "react";
import { cls } from "../util";
import { type ButtonSize, controlHeightMixin, controlPaddingMixin } from "../styles";

export type ButtonProps<C extends React.ElementType = "button"> = {
    children?: React.ReactNode;
    variant?: "filled" | "outlined" | "text";
    disabled?: boolean;
    color?: "primary" | "secondary" | "text" | "error" | "neutral";
    size?: ButtonSize;
    startIcon?: React.ReactNode;
    fullWidth?: boolean;
    className?: string;
    component?: C;
    onClick?: React.MouseEventHandler<HTMLElement>;
} & React.ComponentPropsWithoutRef<C>;

const ButtonInner = React.memo(React.forwardRef<
    HTMLButtonElement,
    ButtonProps<React.ElementType>
>(({
       children,
       className,
       variant = "filled",
       disabled = false,
       size = "medium",
       startIcon = null,
       fullWidth = false,
       component: Component,
       color = "neutral",
       ...props
   }: ButtonProps<React.ElementType>, ref) => {

    const baseClasses =
        "typography-button h-fit rounded-lg whitespace-nowrap inline-flex items-center justify-center p-2 px-4 focus:outline-none transition-colors ease-in-out duration-150 gap-2";

    const buttonClasses = cls({
        "w-full": fullWidth,
        "w-fit": !fullWidth,

        // Filled Variants
        "border border-primary bg-primary focus:ring-primary text-white hover:text-white hover:brightness-105": variant === "filled" && color === "primary" && !disabled,
        "border border-secondary bg-secondary focus:ring-secondary text-white hover:text-white hover:brightness-105": variant === "filled" && color === "secondary" && !disabled,
        "border border-red-600 bg-red-600 hover:bg-red-700 focus:ring-red-600 text-white hover:text-white": variant === "filled" && color === "error" && !disabled,
        "border border-surface-accent-200 bg-surface-accent-200 hover:bg-surface-accent-300 focus:ring-surface-accent-400 text-text-primary hover:text-text-primary dark:border-surface-accent-700 dark:bg-surface-accent-700 dark:hover:bg-surface-accent-600 dark:text-text-primary-dark hover:dark:text-text-primary-dark": variant === "filled" && color === "text" && !disabled,
        "border border-transparent bg-surface-100 hover:bg-surface-accent-200 text-text-primary dark:bg-surface-700 dark:hover:bg-surface-accent-700 dark:text-text-primary-dark hover:text-text-primary dark:text-text-primary-dark hover:dark:text-text-primary-dark": variant === "filled" && color === "neutral" && !disabled,

        // Text Variants
        "border border-transparent text-primary hover:text-primary hover:bg-surface-accent-200 hover:bg-opacity-75 hover:bg-surface-accent-200/75 dark:hover:bg-surface-accent-800": variant === "text" && color === "primary" && !disabled,
        "border border-transparent text-secondary hover:text-secondary hover:bg-surface-accent-200 hover:bg-opacity-75 hover:bg-surface-accent-200/75 dark:hover:bg-surface-accent-800": variant === "text" && color === "secondary" && !disabled,
        "border border-transparent text-red-600 hover:text-red-600 hover:bg-red-600 hover:bg-opacity-10 hover:bg-red-600/10": variant === "text" && color === "error" && !disabled,
        "border border-transparent text-text-primary hover:text-text-primary dark:text-text-primary-dark hover:dark:text-text-primary-dark hover:bg-surface-accent-200 hover:bg-opacity-75 hover:bg-surface-accent-200/75 dark:hover:bg-surface-accent-800": variant === "text" && color === "text" && !disabled,
        "border border-transparent text-text-primary hover:text-text-primary hover:bg-surface-accent-200 hover:bg-opacity-75 hover:bg-surface-accent-200/75 dark:text-text-primary-dark dark:hover:text-text-primary-dark dark:hover:bg-surface-accent-800": variant === "text" && color === "neutral" && !disabled,

        // Outlined Variants
        "border border-primary text-primary hover:text-primary hover:bg-primary-bg hover:bg-primary/10": variant === "outlined" && color === "primary" && !disabled,
        "border border-secondary text-secondary hover:text-secondary hover:bg-secondary-bg": variant === "outlined" && color === "secondary" && !disabled,
        "border border-red-500 text-red-600 hover:text-white hover:bg-red-600": variant === "outlined" && color === "error" && !disabled,
        "border border-surface-accent-400 text-text-primary hover:text-text-primary dark:text-text-primary-dark dark:border-surface-accent-600 hover:bg-surface-accent-200 hover:bg-opacity-75 hover:bg-surface-accent-200/75 dark:hover:bg-surface-accent-800": variant === "outlined" && color === "text" && !disabled,
        "border border-surface-300 text-text-primary hover:bg-surface-accent-200 hover:bg-opacity-75 hover:bg-surface-accent-200/75 dark:border-surface-600 dark:text-text-primary-dark dark:hover:bg-surface-accent-800": variant === "outlined" && color === "neutral" && !disabled,

        // Disabled states for all variants
        "text-text-disabled dark:text-text-disabled-dark": disabled,
        "border border-transparent opacity-50": variant === "text" && disabled,
        "border border-surface-500 opacity-50": variant === "outlined" && disabled,
        "border border-transparent bg-surface-300 dark:bg-surface-500 opacity-40 bg-surface-300/40 dark:bg-surface-500/40": variant === "filled" && disabled
    });

    // Height comes from the shared control scale (see styles.ts) so a Button
    // and a TextField at the same `size` line up. Vertical padding is dropped:
    // the button is an inline-flex box centring its content inside min-height.
    const sizeClasses = cls("py-0", controlHeightMixin[size], controlPaddingMixin[size]);

    const iconColorClass = (color === "neutral" || color === "text") && !disabled
        ? "[&>svg]:text-surface-accent-500 dark:[&>svg]:text-surface-accent-300"
        : "";

    if (Component) {
        return (
            <Component
                ref={ref}
                onClick={props.onClick}
                className={cls(startIcon ? "pl-3" : "", baseClasses, buttonClasses, sizeClasses, iconColorClass, className)}
                {...props}>
                {startIcon}
                {children}
            </Component>
        );
    }

    return (
        <button ref={ref as React.Ref<HTMLButtonElement>}
                type={props.type ?? "button"}
                onClick={props.onClick}
                className={cls(startIcon ? "pl-3" : "", baseClasses, buttonClasses, sizeClasses, iconColorClass, className)}
                disabled={disabled}
                data-variant={variant}
                data-size={size}
                {...props as React.ButtonHTMLAttributes<HTMLButtonElement>}>
            {startIcon}
            {children}
        </button>
    );

}));

ButtonInner.displayName = "Button"

export const Button = ButtonInner as React.FC<ButtonProps<React.ElementType>>;
