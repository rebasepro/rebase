
import React from "react";

import { Link, useNavigate } from "react-router";
import { RebaseLogo, LanguageToggle } from "@rebasepro/app";
import { ErrorBoundary, iconSize } from "@rebasepro/ui";
import {
    Avatar,
    cls,
    IconButton,
    LogOutIcon,
    Menu,
    MenuItem,
    MoonIcon,
    SettingsIcon,
    Skeleton,
    SunIcon,
    SunMoonIcon,
    Typography
} from "@rebasepro/ui";
import { useAuthController, useLargeLayout, useModeController, useAdminModeController, useTranslation } from "@rebasepro/app";
import { useUrlController } from "../hooks/navigation/contexts/UrlContext";
import { User } from "@rebasepro/types";
import { useApp } from "./app/useApp";
import { useBreadcrumbsController } from "../hooks/useBreadcrumbsController";
import { UserSettingsView } from "@rebasepro/app";

export type DefaultAppBarProps<ADDITIONAL_PROPS = object> = {

    /**
     * The content of the app bar, usually a title or logo. This includes a link to the home page.
     */
    title?: React.ReactNode;

    /**
     * A component that gets rendered on the upper side to the end of the main toolbar
     */
    endAdornment?: React.ReactNode;

    /**
     * A component that gets rendered on the upper side to the start of the main toolbar
     */
    startAdornment?: React.ReactNode;

    dropDownActions?: React.ReactNode;

    /**
     * Whether to render the dark/light/system mode toggle in the app bar.
     * Set to `false` when the drawer owns this action.
     * @default true
     */
    includeModeToggle?: boolean;

    /**
     * Whether to render the language switcher in the app bar.
     * Set to `false` when the drawer owns this action.
     * @default true
     */
    includeLanguageToggle?: boolean;

    /**
     * Whether to render the user avatar / menu in the app bar.
     * Set to `false` when the drawer owns this action.
     * @default true
     */
    includeUserMenu?: boolean;

    className?: string;

    style?: React.CSSProperties;

    logo?: string;

    user?: User;
} & ADDITIONAL_PROPS;

/**
 * This component renders the main app bar of Rebase.
 * You will likely not need to use this component directly.
 *

 */
export const DefaultAppBar = function DefaultAppBar({
    title,
    endAdornment,
    startAdornment,
    dropDownActions,
    includeModeToggle = true,
    includeLanguageToggle = true,
    includeUserMenu = true,
    className,
    style,
    user: userProp,
    logo: logoProp
}: DefaultAppBarProps) {

    const {
        hasDrawer,
        drawerOpen,
        logo: appLogo
    } = useApp();

    const logo = logoProp ?? appLogo;

    const navigation = useUrlController();

    const breadcrumbs = useBreadcrumbsController();

    const authController = useAuthController();
    const adminModeController = useAdminModeController();
    const {
        mode,
        setMode
    } = useModeController();

    const navigate = useNavigate();

    const largeLayout = useLargeLayout();

    const user = userProp ?? authController.user;
    const { t } = useTranslation();

    let avatarComponent: React.ReactElement | null;

    if (user) {
        const initial = user?.displayName
            ? user.displayName[0].toUpperCase()
            : (user?.email ? user.email[0].toUpperCase() : "A");
        avatarComponent = <Avatar src={user.photoURL ?? undefined}>
            {initial}
        </Avatar>;
    } else if (user === undefined || authController.initialLoading) {
        avatarComponent = <div className={"p-1 flex justify-center"}>
            <Skeleton className={"w-10 h-10 rounded-full"}/>
        </div>;
    } else {
        avatarComponent = null;
    }


    return (
        <div
            style={style}
            role="banner"
            className={cls("w-full h-14 transition-all ease-in duration-75 absolute top-0 max-w-full overflow-x-auto no-scrollbar",
                "flex flex-row gap-2 px-4 items-center",
                "backdrop-blur-sm bg-surface-50/95 dark:bg-surface-900/80",
                {
                    "pl-[19rem]": drawerOpen && largeLayout,
                    "pl-24": hasDrawer && !(drawerOpen && largeLayout),
                    "z-10": largeLayout,
                    "duration-100": drawerOpen && largeLayout
                },
                className)}>

            {navigation && (!hasDrawer || title) && <div className="mr-2 hidden lg:block">
                <Link
                    className="visited:text-inherit dark:visited:text-inherit block"
                    to={navigation?.basePath ?? "/"}
                >
                    <div className={"flex flex-row gap-4"}>
                        {!hasDrawer && (logo
                            ? <img src={logo}
                                alt="Logo"
                                className={cls("w-[32px] h-[32px] object-contain")}/>
                            : <RebaseLogo width={"32px"} height={"32px"}/>)}

                        {typeof title === "string"
                            ? <Typography variant="subtitle1"
                                noWrap>
                                {title}
                            </Typography>
                            : title}
                    </div>
                </Link>
            </div>}

            <div className="mr-8 hidden lg:block">
                <nav aria-label="Breadcrumb">
                <div className={"flex flex-row gap-2 items-center"}>
                    {breadcrumbs.breadcrumbs.map((breadcrumb, index) => {
                        return <React.Fragment key={breadcrumb.url + "_" + index}>
                            {index > 0 && (
                                <Typography variant={"caption"} color={"secondary"}>
                                    /
                                </Typography>
                            )}
                            <Link
                                key={index}
                                className="visited:text-inherit dark:visited:text-inherit block"
                                to={breadcrumb.url}
                            >
                                <div className="flex flex-row items-center gap-2 whitespace-nowrap">
                                    <Typography variant={"body2"}>
                                        {breadcrumb.title}
                                    </Typography>
                                </div>
                            </Link>
                        </React.Fragment>;
                    })}
                </div>
                </nav>
            </div>
            {startAdornment}

            <div className={"grow"}/>

            {endAdornment &&
                <ErrorBoundary>
                    {endAdornment}
                </ErrorBoundary>}

            {includeLanguageToggle && <LanguageToggle/>}

            {includeModeToggle &&
                <Menu
                    trigger={<IconButton
                        color="inherit"
                        aria-label="Toggle theme"
>
                        {mode === "dark"
                            ? <MoonIcon size={iconSize.small}/>
                            : <SunIcon size={iconSize.small}/>}
                    </IconButton>}>
                    <MenuItem onClick={() => setMode("dark")}><MoonIcon size={iconSize.smallest}/> {t("dark_mode")}</MenuItem>
                    <MenuItem onClick={() => setMode("light")}><SunIcon size={iconSize.smallest}/> {t("light_mode")} </MenuItem>
                    <MenuItem onClick={() => setMode("system")}> <SunMoonIcon
                        size={iconSize.smallest}/>{t("system_mode")}</MenuItem>
                </Menu>}


            {includeUserMenu &&
                <Menu trigger={<div aria-label="User menu" role="button">{avatarComponent}</div>}>
                    {user && <div className={"px-4 py-2 mb-2"}>
                        {user.displayName && <Typography variant={"body1"} color={"secondary"}>
                            {user.displayName}
                        </Typography>}
                        {user.email && <Typography variant={"body2"} color={"secondary"}>
                            {user.email}
                        </Typography>}
                    </div>}

                    {dropDownActions}

                    {!dropDownActions && <>
                        <MenuItem onClick={() => navigate("/settings")}>
                            <SettingsIcon/>
                            {t("account_settings")}
                        </MenuItem>
                        <MenuItem onClick={async () => {
                            await authController.signOut();
                            // replace current route with home
                            navigate("/");
                        }}>
                            <LogOutIcon/>
                            {t("log_out")}
                        </MenuItem>
                    </>}

                </Menu>}

        </div>
    );
}
