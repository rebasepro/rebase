import { CopyIcon, IconButton, Tooltip, Typography } from "@rebasepro/ui";
import { useCallback, useState } from "react";

export function PropertyIdCopyTooltip({
    propertyKey,
    className,
    children
}: {
    propertyKey: string,
    className?: string,
    children: React.ReactNode
}) {
    return <Tooltip title={<PropertyIdCopyTooltipContent propertyKey={propertyKey}/>}
        delayDuration={800}
        side={"top"}
        align={"start"}
        sideOffset={8}
        className={className}>
        {children}
    </Tooltip>

}

export function PropertyIdCopyTooltipContent({ propertyKey }: { propertyKey: string }) {

    const [copied, setCopied] = useState(false);

    return (
        <div className={"flex flex-row gap-2 items-center justify-center text-on-surface"}>
            <div>
                <Typography variant={"caption"} className={"min-w-20 text-on-surface-variant opacity-80"}
                    color={"inherit"}>{copied ? "Copied" : "Property ID"}</Typography>
                <Typography variant={"caption"} className={"text-on-surface"}><code>{propertyKey}</code></Typography>
            </div>
            <IconButton size={"small"}>
                <CopyIcon
                    className={"text-on-surface"}
                    onClick={useCallback(() => {
                        navigator.clipboard.writeText(propertyKey);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2000);
                    }, [propertyKey])}
                />
            </IconButton>
        </div>
    );
}
