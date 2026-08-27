import { DefaultDrawer } from "../DefaultDrawer";

/**
 * This component is in charge of rendering the drawer.
 * If you add this component under your {@link Scaffold}, it will be rendered
 * as a drawer, and the open and close functionality will be handled automatically.
 * If you want to customise the drawer, you can create your own component and pass it as a child.
 * For custom drawers, you can use the {@link useApp} to open and close the drawer.
 *
 */
export function Drawer({
                           children,
                           title,
                           logo,
                           logoDestination,
                           footerActions,
                           className,
                           style
                       }: {
    children?: React.ReactNode,
    title?: React.ReactNode,
    logo?: string,
    logoDestination?: string,
    /**
     * Custom content for the drawer footer actions area (language, theme, user menu).
     * - `undefined` — renders the default `DrawerFooterActions`.
     * - `null` — renders nothing (hides the footer actions).
     * - `ReactNode` — renders the provided custom content.
     */
    footerActions?: React.ReactNode | null,
    className?: string,
    style?: React.CSSProperties
}) {
    const usedChildren = children ?? <DefaultDrawer title={title} logo={logo} logoDestination={logoDestination} footerActions={footerActions} className={className} style={style}/>;
    return <>{usedChildren}</>;
}

Drawer.componentType = "Drawer";
