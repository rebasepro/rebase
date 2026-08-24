import React from "react";
import { Container, Typography } from "@rebasepro/ui";

export const MaxWidths = () => (
    <div className="flex flex-col gap-3 p-4 bg-surface-50 dark:bg-surface-900">
        {(["sm", "md", "xl"] as const).map(w => (
            <Container key={w} maxWidth={w} className="bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-lg py-2">
                <Typography variant="caption" color="secondary" className="font-mono">maxWidth=&quot;{w}&quot;</Typography>
            </Container>
        ))}
    </div>
);

export const PageContent = () => (
    <div className="p-4 bg-surface-50 dark:bg-surface-900">
        <Container maxWidth="md" className="bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-lg py-6">
            <Typography variant="h6">Team settings</Typography>
            <Typography variant="body2" color="secondary" className="mt-1">Manage members, roles, and billing for your workspace.</Typography>
        </Container>
    </div>
);
