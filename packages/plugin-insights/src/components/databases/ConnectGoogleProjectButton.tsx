import { Card, cls, Typography } from "@rebasepro/ui";
import { Link as LinkIcon } from "lucide-react";
import BQLogo from "../images/bq_icon.svg";

export function ConnectGoogleProjectButton({
    onClick,
    selected,
    className
}: {
    selected?: boolean,
    className?: string,
    onClick: () => void
}) {
    return <Card
        className={cls("bg-transparent dark:bg-transparent flex flex-row gap-2 items-center justify-center px-3 py-1.5 cursor-pointer hover:bg-surface-50 dark:hover:bg-gray-800",
            selected ? "border-primary dark:border-primary" : "hover:ring-transparent", className)}
        onClick={onClick}
    >
        <img
            src={BQLogo}
            alt="Google BigQuery"
            className="w-4 h-4"
        />
        <Typography variant="caption" className="font-medium">
            Link New Google Project
        </Typography>
    </Card>;
}
