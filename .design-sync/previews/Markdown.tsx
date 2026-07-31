import React from "react";
import { Markdown } from "@rebasepro/ui";

const readme = `## Getting started

Install the client and connect to your project:

\`\`\`bash
npm install @rebasepro/client
\`\`\`

- Works with **Postgres** and *SQLite*
- Realtime subscriptions out of the box
- [Read the docs](https://rebase.pro/docs)
`;

export const Basic = () => (
    <div className="p-4 w-96">
        <Markdown source={readme}/>
    </div>
);

export const SmallSize = () => (
    <div className="p-4 w-80">
        <Markdown size="small" source={"**Note:** changes to this field require a schema migration before they take effect."}/>
    </div>
);

export const LargeSize = () => (
    <div className="p-4 w-96">
        <Markdown size="large" source={"# Release 0.12\n\nAdds row-level security policies and a redesigned collection editor."}/>
    </div>
);
