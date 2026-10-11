"use client";
import React, { useState } from "react";
import { cls } from "../util";

export interface AvatarProps {
    src?: string;
    alt?: string;
    children?: React.ReactNode;
    className?: string;
    outerClassName?: string;
    hover?: boolean;
    style?: React.CSSProperties;
    /** Makes the avatar a button. Without it (or a menu trigger's handlers) it is a plain image. */
    onClick?: React.MouseEventHandler<HTMLElement>;
}

const AvatarInner: React.ForwardRefRenderFunction<HTMLElement, AvatarProps> = (
    {
        src,
        alt,
        children,
        className,
        style,
        outerClassName,
        hover = true,
        ...props
    },
    ref
) => {
    // The source that failed, not a flag: a flag outlived it, so once one URL
    // failed every later one showed the initials too.
    const [failedSrc, setFailedSrc] = useState<string | undefined>(undefined);
    const isImageError = src !== undefined && failedSrc === src;

    const handleImageError = () => {
        setFailedSrc(src);
    };

    // A button only when something handles it: an `onClick`, or the handlers a
    // Radix trigger (`Menu trigger={<Avatar/>}`) slots in. A bare avatar inside
    // a caller's own button was a second, unnamed tab stop that did nothing.
    const interactive = Object.keys(props).some((key) => /^on[A-Z]/.test(key));
    const Root = interactive ? "button" : "span";
    // One ref for either element, without asserting which one it is.
    const setRef = React.useCallback((element: HTMLElement | null) => {
        if (typeof ref === "function") ref(element);
        else if (ref) ref.current = element;
    }, [ref]);

    return (
        <Root
            ref={setRef}
            style={style}
            {...(interactive ? { type: "button" as const } : {})}
            {...props}
            className={cls(
                "rounded-full flex items-center justify-center overflow-hidden",
                "p-1 w-12 h-12 min-w-12 min-h-12",
                hover && "transition-colors duration-150 hover:bg-surface-raised-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
                outerClassName
            )}
        >
            {src && !isImageError ? (
                <img
                    className={cls(
                        "bg-surface-raised",
                        "w-full h-full object-cover rounded-full",
                        className
                    )}
                    src={src}
                    alt={alt}
                    onError={handleImageError}
                />
            ) : (
                <span
                    className={cls(
                        "bg-surface-raised",
                        "flex items-center justify-center",
                        "w-full h-full py-1.5 text-lg font-medium text-surface-accent-900 dark:text-text-primary-dark rounded-full",
                        className
                    )}
                >
          {children}
        </span>
            )}
        </Root>
    );
};

export const Avatar = React.forwardRef(AvatarInner);
