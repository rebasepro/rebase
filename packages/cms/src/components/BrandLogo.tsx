import React from "react";
import { cls } from "@rebasepro/ui";

/**
 * The project's logo, in the variant that suits the active theme.
 *
 * With `logoDark` set, both images are in the DOM and the `dark` class on
 * `<html>` picks one, so the swap follows the theme toggle with no React
 * state and no flash. A dark-ink logo on the dark theme was otherwise
 * invisible, and the only way out was replacing the drawer.
 *
 * Internal: the drawer and the app bar share it. Not exported.
 */
export function BrandLogo({
    logo,
    logoDark,
    className
}: {
    logo: string;
    logoDark?: string;
    className?: string;
}) {
    if (!logoDark) {
        return <img src={logo} alt="Logo" className={className}/>;
    }
    return (
        <>
            <img src={logo} alt="Logo" className={cls(className, "dark:hidden")}/>
            <img src={logoDark} alt="Logo" className={cls(className, "hidden dark:block")}/>
        </>
    );
}
