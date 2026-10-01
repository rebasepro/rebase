import React from "react";
import { Button, ButtonProps } from "./Button";
import { CircularProgress } from "./CircularProgress";

export type LoadingButtonProps<P extends React.ElementType = "button"> = ButtonProps<P> & {
    startIcon?: React.ReactNode;
    loading?: boolean;
}

export function LoadingButton<P extends React.ElementType = "button">({
                                                                          children,
                                                                          loading,
                                                                          startIcon,
                                                                          ...props
                                                                      }: LoadingButtonProps<P>) {
    // What is left is exactly the Button's props for the same element. The
    // compiler cannot see through `Omit` over a generic element type, so it is
    // told once, here, rather than every caller being typed as `any`.
    const buttonProps = props as ButtonProps<P>;
    return (
        <Button<P>
            {...buttonProps}
            disabled={loading || buttonProps.disabled}
        >
            {loading && (
                <CircularProgress size={"smallest"}/>
            )}
            {!loading && startIcon}
            {children}
        </Button>
    );
};
