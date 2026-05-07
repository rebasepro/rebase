import { Card, cls, Typography } from "@rebasepro/ui";
import GoogleSheetsLogo from "../images/google_sheets_logo.svg";

export function ConnectGoogleSheetsButton({
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
            src={GoogleSheetsLogo}
            alt="Google Sheets"
            className="w-4 h-4"
        />
        <Typography variant="caption" className="font-medium">
            Add Google Sheet
        </Typography>
    </Card>;
}
