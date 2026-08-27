import { useCustomizationController } from "@rebasepro/app";
import { getFieldConfig } from "../../../components/field_configs";
import { PropertyConfigBadge } from "../../../components/PropertyConfigBadge";
import { ErrorBoundary } from "@rebasepro/ui";
import { Property } from "@rebasepro/types";
import { isPropertyBuilder } from "@rebasepro/common";
import { cls, Paper, Typography } from "@rebasepro/ui";
import { FunctionSquareIcon, iconSize, MinusCircleIcon } from "@rebasepro/ui";


export function PropertyFieldPreview({
    property,
    propertyKey,
    onClick,
    hasError,
    includeName,
    includeEditButton,
    selected
}: {
    property: Property,
    propertyKey?: string,
    hasError?: boolean,
    selected?: boolean,
    includeName?: boolean,
    includeEditButton?: boolean;
    onClick?: () => void
}) {

    const { propertyConfigs } = useCustomizationController();
    const propertyConfig = getFieldConfig(property, propertyConfigs);


    const borderColorClass = hasError
        ? "border-red-500 dark:border-red-500 border-red-500/100 dark:border-red-500/100 ring-0 dark:ring-0"
        : (selected ? "border-primary" : "");

    return <ErrorBoundary>
        <div onClick={onClick} className={onClick ? "cursor-pointer" : ""}>
        <div
            className={cls(
                "w-full flex flex-row gap-3 items-center px-3 py-2 rounded-lg transition-all duration-200 border bg-white dark:bg-surface-900 shadow-xs",
                borderColorClass || "border-surface-200 dark:border-surface-700",
                selected
                    ? "bg-primary/10 text-primary dark:bg-primary/20 dark:text-primary-light ring-1 ring-inset ring-primary border-primary/30"
                    : "hover:bg-surface-50 dark:hover:bg-surface-700"
            )}
        >
            <PropertyConfigBadge propertyConfig={propertyConfig} size="small"/>

            <div className="flex-1 flex flex-col min-w-0 mr-16">
                {includeName &&
                    <ErrorBoundary>
                        <div className="flex items-center gap-2 min-w-0">
                            <Typography variant="body2" component="span" className="truncate font-medium">
                                {property.name || propertyKey || "\u00a0"}
                            </Typography>
                            {propertyConfig?.name && (
                                <Typography
                                    variant={"caption"}
                                    component="span"
                                    className="text-text-secondary dark:text-text-secondary-dark shrink-0">
                                    {propertyConfig.name}
                                </Typography>
                            )}
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
                            {propertyKey && (
                                <Typography variant="caption" component="span" color="secondary" className="font-mono truncate">
                                    {propertyKey}
                                </Typography>
                            )}
                            <ErrorBoundary>
                                <Typography variant="caption" component="span" className="shrink-0 text-text-disabled dark:text-text-disabled-dark font-mono">
                                    · {"columnType" in property ? (property as { columnType?: string }).columnType ?? property.type : property.type}
                                </Typography>
                            </ErrorBoundary>
                        </div>
                    </ErrorBoundary>}

                {!includeName &&
                    <div className="flex flex-row items-center gap-2">
                        <ErrorBoundary>
                            <Typography
                                variant={"caption"}
                                component="span"
                                className="text-text-secondary dark:text-text-secondary-dark font-medium">
                                {propertyConfig?.name}
                            </Typography>
                        </ErrorBoundary>
                    </div>}
            </div>

            {includeEditButton && <Typography variant={"button"}>EDIT</Typography>}
        </div>
        </div>
    </ErrorBoundary>
}

export function NonEditablePropertyPreview({
    name,
    selected,
    onClick,
    property
}: {
    name: string,
    selected: boolean,
    onClick?: () => void,
    property?: Property
}) {

    const { propertyConfigs } = useCustomizationController();
    const propertyConfig = !isPropertyBuilder(property) && property ? getFieldConfig(property, propertyConfigs) : undefined;

    return (
        <div onClick={onClick} className={onClick ? "cursor-pointer" : ""}>
        <div
            className={cls(
                "w-full flex flex-row gap-3 items-center px-3 py-2 rounded-lg transition-all duration-200 border bg-white dark:bg-surface-900 border-surface-200 dark:border-surface-700 shadow-xs",
                selected
                    ? "bg-primary/10 text-primary dark:bg-primary/20 dark:text-primary-light ring-1 ring-inset ring-primary border-primary/30"
                    : "hover:bg-surface-50 dark:hover:bg-surface-700"
            )}
        >
            <div className={"relative shrink-0"}>
                {propertyConfig && <PropertyConfigBadge propertyConfig={propertyConfig} size="small"/>}
                {!propertyConfig && <div
                    className={"h-8 w-8 flex items-center justify-center rounded-full shadow-2xs text-white bg-surface-500"}>
                    <FunctionSquareIcon className={"text-inherit"} size={iconSize.small}/>
                </div>}
                <MinusCircleIcon className={"text-surface-accent-400 absolute -right-2 -top-2 bg-surface-50 dark:bg-surface-900 rounded-full"} size={iconSize.small}/>
            </div>

            <div className="flex-1 flex flex-col min-w-0 mr-16">
                <div className="flex items-center gap-2 min-w-0">
                    <Typography variant="label" component="span" className="truncate">
                        {property?.name ? property.name : name}
                    </Typography>
                    {propertyConfig && <Typography variant={"caption"} component="span" className="text-text-secondary dark:text-text-secondary-dark shrink-0">
                        {propertyConfig?.name}
                    </Typography>}
                </div>

                <div className="flex flex-row items-center gap-1.5 mt-0.5 min-w-0">
                    <Typography variant="caption" component="span" color="secondary" className="font-mono truncate">
                        {name}
                    </Typography>

                    {property && isPropertyBuilder(property) && <ErrorBoundary>
                        <Typography variant="caption" component="span" className="text-text-disabled dark:text-text-disabled-dark">
                            · Defined in code
                        </Typography>
                    </ErrorBoundary>}

                    {!property && <ErrorBoundary>
                        <Typography variant="caption" component="span" className="text-text-disabled dark:text-text-disabled-dark">
                            · Additional field
                        </Typography>
                    </ErrorBoundary>}
                </div>
            </div>
        </div>
        </div>
    )
}
