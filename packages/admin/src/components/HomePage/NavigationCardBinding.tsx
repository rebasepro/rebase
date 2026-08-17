
import type { NavigationEntry, AdminCollection } from "@rebasepro/admin-types";
import { useNavigate } from "react-router";
;
import { IconButton, StarIcon, Tooltip } from "@rebasepro/ui";
import { NavigationCard } from "./NavigationCard";
import { SmallNavigationCard } from "./SmallNavigationCard";
import React from "react";
import { useRebaseContext, useSlot } from "@rebasepro/app";
import { IconForView } from "@rebasepro/app";
import { useUserConfigurationPersistence } from "@rebasepro/app";

/**
 * This is the component used in the home page to render a card for each
 * collection or view.
 * @group Components
 * @param view
 * @param path
 * @param collection
 * @param url
 * @param name
 * @param description
 * @param onClick

 */
export function NavigationCardBinding({
    slug,
    collection,
    view,
    url,
    name,
    description,
    onClick,
    type,
    shrink
}: NavigationEntry & {
    onClick?: () => void,
    shrink?: boolean // <-- add shrink prop type
}) {

    const userConfigurationPersistence = useUserConfigurationPersistence();
    const collectionIcon = <IconForView collectionOrView={collection ?? view} size={"small"}/>;

    const navigate = useNavigate();
    const context = useRebaseContext();

    const favourite = (userConfigurationPersistence?.favouritePaths ?? []).includes(slug);

    const actionsArray: React.ReactNode[] = userConfigurationPersistence
        ? [
            <IconButton
                key={"favourite"}
                size={"small"}
                onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (favourite) {
                        userConfigurationPersistence.setFavouritePaths(
                            userConfigurationPersistence.favouritePaths.filter(p => p !== slug)
                        );
                    } else {
                        userConfigurationPersistence.setFavouritePaths(
                            [...userConfigurationPersistence.favouritePaths, slug]
                        );
                    }
                }}>
                <StarIcon
                    className={favourite ? "text-secondary" : "text-surface-400 dark:text-surface-500"}/>
            </IconButton>
        ]
        : [];

    const pluginCardActions = useSlot("home.collection.actions", {
        slug: slug,
        collection: collection!,
        context
    });

    const pluginCardWidgets = useSlot("home.card.widget", {
        slug: slug,
        collection: collection!,
        context
    });

    const actions: React.ReactNode | undefined = <>
        {actionsArray}
        {pluginCardActions}
    </>

    return <NavigationCard
        icon={collectionIcon}
        name={name}
        description={description}
        actions={actions}
        additionalContent={pluginCardWidgets.length > 0 ? <>{pluginCardWidgets}</> : undefined}
        onClick={() => {
            onClick?.();
            navigate(url);
            if (userConfigurationPersistence) {
                userConfigurationPersistence.setRecentlyVisitedPaths(
                    [slug, ...(userConfigurationPersistence.recentlyVisitedPaths ?? []).filter(p => p !== slug)]
                );
            }
        }}
        shrink={shrink}
    />;
}
