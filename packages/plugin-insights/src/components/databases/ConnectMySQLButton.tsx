import { Card, cls, Typography } from "@rebasepro/ui";
import MySQLLogo from "../images/mysql-logo.svg";

export function ConnectMySQLButton({
    onClick,
    selected,
    className
}: {
    selected?: boolean,
    className?: string,
    onClick: () => void
}) {
    return <Card
        className={cls("bg-transparent dark:bg-transparent flex flex-row gap-2 items-center justify-center px-3 py-1 cursor-pointer hover:bg-surface-50 dark:hover:bg-gray-800",
            selected ? "border-primary dark:border-primary" : "hover:ring-transparent",
            className)}
        onClick={onClick}
    >
        <img
            src={MySQLLogo}
            alt="MySQL icon"
            className={`w-6 h-6`}
        />
        <Typography variant="caption" className="font-medium">
            Connect MySQL
        </Typography>
    </Card>;
}

