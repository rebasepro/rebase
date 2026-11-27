"use client";
import React, { useCallback } from "react";
import { cardClickableMixin, cardMixin } from "../styles";
import { cls } from "../util";

type CardProps = {
    children: React.ReactNode;
    style?: React.CSSProperties;
    onClick?: (e?: React.MouseEvent) => void;
    className?: string;
} & React.HTMLAttributes<HTMLDivElement>;

const Card = React.forwardRef<HTMLDivElement, CardProps>(({
    children,
    className,
    onClick,
    style,
    ...props
}, ref) => {
    const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
        if (onClick && e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
            if (e.key === " ") e.preventDefault();
            onClick();
        }
    }, [onClick]);

    return (
        <div
            ref={ref}
            onKeyDown={onKeyDown}
            role={onClick ? "button" : undefined}
            tabIndex={onClick ? 0 : undefined}
            onClick={onClick}
            className={cls(cardMixin, onClick && cardClickableMixin, className)}
            style={style}
            {...props}>
            {children}
        </div>
    );
});

Card.displayName = "Card";

export { Card };
