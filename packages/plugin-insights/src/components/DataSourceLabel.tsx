import { cls, Label } from "@rebasepro/ui";
import { Check as CheckIcon, CheckSquare as CheckBoxIcon, Database as StorageIcon, Plus, Square as CheckBoxOutlineBlankIcon } from "lucide-react";
import { DataSource } from "../types";
;
import { formatDataSource } from "../utils/datasource";
import PostgresLogo from "./images/postgresql-icon.svg";
import MySQLLogo from "./images/mysql-logo.svg";
import GoogleSheetsLogo from "./images/google_sheets_logo.svg";
import BQLogo from "./images/bq_icon.svg";
import CSVIcon from "./images/csv-icon.svg";
import ExcelIcon from "./images/excel-icon.svg";
import React from "react";

export function DataSourceLabel({
                                    dataSource,
                                    selected,
                                    className,
                                    onClick
                                }: {
    dataSource: DataSource, selected?: boolean,
    className?: string,
    onClick?: () => void
}) {

    const icon = getDataSourceIcon(dataSource);
    const selectedIcon = selected !== undefined ? (selected ? <CheckBoxIcon size="small" color="primary"/> :
        <CheckBoxOutlineBlankIcon size="small" color="primary"/>) : null;

    return <Label
        onClick={onClick}
        className={cls("shrink-0 border  rounded-md p-1 px-3 flex items-center gap-3 font-normal flex-wrap w-fit",
            selected ? "bg-surface-50 dark:bg-surface-900" : "bg-transparent",
            onClick ? "cursor-pointer hover:bg-surface-100 dark:hover:bg-surface-800" : "",
            className)}>

        {selectedIcon}

        {icon && <img
            src={icon}
            alt="Datasource icon"
            className={`inline w-5 h-5`}
        />}

        {!icon && <StorageIcon size={"smallest"}/>}

        <span className={cls("font-semibold text-sm", selected ? "text-primary" : "")}>  {formatDataSource(dataSource)}</span>

    </Label>;
}

export function getDataSourceIcon(dataSource: DataSource): string | null {
    switch (dataSource.type) {
        case "bigquery":
            return BQLogo;
        case "postgresql":
            return PostgresLogo;
        case "mysql":
            return MySQLLogo;
        case "google_sheets":
            return GoogleSheetsLogo;
        case "file":
            // Determine icon based on file mimeType or name
            const mimeType = dataSource.mimeType?.toLowerCase() || "";
            const fileName = dataSource.originalName?.toLowerCase() || "";

            // CSV files
            if (mimeType.includes("csv") || fileName.endsWith(".csv")) {
                return CSVIcon;
            }

            // Excel files
            if (mimeType.includes("spreadsheet") ||
                mimeType.includes("excel") ||
                fileName.endsWith(".xlsx") ||
                fileName.endsWith(".xls") ||
                mimeType.includes("vnd.ms-excel") ||
                mimeType.includes("vnd.openxmlformats-officedocument.spreadsheetml")) {
                return ExcelIcon;
            }

            // Default for other files
            return null;
        default:
            return null;
    }
}
