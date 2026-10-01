import React from "react";
import { Alert, Typography } from "@rebasepro/ui";
import { useTranslation } from "@rebasepro/app";
import { ImportConversionProblem } from "../utils/data";

/** How many failing cells each column shows as examples. */
const EXAMPLES_PER_COLUMN = 3;

type ColumnProblems = {
    column: string;
    property: string;
    expected: string;
    problems: ImportConversionProblem[];
};

function groupByColumn(problems: ImportConversionProblem[]): ColumnProblems[] {
    const groups = new Map<string, ColumnProblems>();
    for (const problem of problems) {
        const group = groups.get(problem.column)
            ?? { column: problem.column, property: problem.property, expected: problem.expected, problems: [] };
        group.problems.push(problem);
        groups.set(problem.column, group);
    }
    return Array.from(groups.values());
}

function cellText(value: unknown): string {
    if (typeof value === "string") return value;
    if (value instanceof Date) return value.toISOString();
    return JSON.stringify(value) ?? String(value);
}

/**
 * The cells of an import that do not convert to the type of the field they
 * map to — per column, how many, and the first few with their row — shown in
 * the preview, before anything is written. Those cells are left out of the
 * rows; nothing is turned into `null`, `0` or `false` without saying so.
 */
export function ImportConversionProblems({ problems }: { problems: ImportConversionProblem[] }) {
    const { t } = useTranslation();
    if (problems.length === 0) return null;
    return <Alert color="warning" outerClassName="mx-4 mt-2">
        <Typography variant="body2" className="font-medium">
            {t("import_problems_title", { count: problems.length })}
        </Typography>
        <Typography variant="caption" component="p" className="mb-2">
            {t("import_problems_description")}
        </Typography>
        <ul className="flex flex-col gap-1">
            {groupByColumn(problems).map(group => <li key={group.column}>
                <Typography variant="caption" component="p" className="font-medium">
                    {t("import_problems_column", {
                        column: group.column,
                        property: group.property,
                        type: group.expected,
                        count: group.problems.length
                    })}
                </Typography>
                {group.problems.slice(0, EXAMPLES_PER_COLUMN).map(problem =>
                    <Typography key={problem.row} variant="caption" component="p" className="pl-4">
                        {t("import_problems_example", {
                            row: problem.row + 1,
                            value: cellText(problem.value),
                            reason: t(`import_problem_${problem.reason}`)
                        })}
                    </Typography>)}
                {group.problems.length > EXAMPLES_PER_COLUMN &&
                    <Typography variant="caption" component="p" className="pl-4">
                        {t("import_problems_more", { count: group.problems.length - EXAMPLES_PER_COLUMN })}
                    </Typography>}
            </li>)}
        </ul>
    </Alert>;
}
