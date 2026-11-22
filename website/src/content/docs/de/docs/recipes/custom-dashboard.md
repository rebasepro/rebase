---
sourceHash: d60e60304904c8c2
title: "Rezept: Benutzerdefiniertes Dashboard"
sidebar_label: Benutzerdefiniertes Dashboard
description: "Erstellen Sie eine Dashboard-Seite mit KPI-Kacheln und Diagrammen – Zahlen in SQL berechnet, dargestellt mit den Bausteinen von @rebasepro/ui."
---

## Übersicht

Ein Dashboard besteht aus drei Teilen: einer Backend-Funktion, die die Zahlen in
SQL berechnet, einer Komponente, die sie mit `useInsightData` lädt und mit den
Bausteinen von `@rebasepro/ui` darstellt, sowie einem Ort, an dem sie angezeigt werden – hier eine
eigene Seite im Drawer.

Zählen Sie auf dem Server. Das Abrufen von Zeilen im Browser und deren Summierung funktioniert
nur, solange die Tabelle auf eine einzige Ergebnisseite passt; darüber hinaus ist die Gesamtsumme
stillschweigend falsch.

## Die Zahlen auf dem Server berechnen

Eine Route pro Element, das die Seite darstellt, ausgeführt als der angemeldete Benutzer, sodass
Berechtigungen und Row-Level Security auch für die Zahlen gelten:

```ts
// functions/dashboard.ts
import { defineFunction, requireAuth } from "@rebasepro/server/functions";

export default defineFunction((app, { rebase }) => {
    app.use("/*", requireAuth);

    // GET /api/functions/dashboard/summary
    app.get("/summary", async (c) => {
        if (!rebase.sql) return c.json({ error: "SQL not available" }, 501);
        const [row] = await rebase.sql(`
            SELECT
                COUNT(*) FILTER (WHERE order_date >= now() - interval '30 days')                       AS orders,
                COUNT(*) FILTER (WHERE order_date >= now() - interval '60 days'
                                   AND order_date <  now() - interval '30 days')                       AS previous_orders,
                COALESCE(SUM(total) FILTER (WHERE order_date >= now() - interval '30 days'), 0)        AS revenue
            FROM orders
        `);
        return c.json({
            orders: Number(row.orders),
            previousOrders: Number(row.previous_orders),
            revenue: Number(row.revenue)
        });
    });

    // GET /api/functions/dashboard/daily — every day present, an empty one is zero
    app.get("/daily", async (c) => {
        if (!rebase.sql) return c.json({ error: "SQL not available" }, 501);
        const rows = await rebase.sql(`
            SELECT to_char(days.day, 'YYYY-MM-DD') AS day, COALESCE(SUM(o.total), 0) AS revenue
            FROM generate_series(current_date - 29, current_date, interval '1 day') AS days(day)
            LEFT JOIN orders o ON o.order_date >= days.day AND o.order_date < days.day + interval '1 day'
            GROUP BY days.day
            ORDER BY days.day
        `);
        return c.json(rows.map((row) => ({ day: String(row.day), revenue: Number(row.revenue) })));
    });
});
```

## Darstellung der Daten

`useInsightData(key, load)` lädt einmal pro Schlüssel und angemeldetem Benutzer, und jede
Komponente, die denselben Schlüssel liest, teilt sich das Ergebnis. Die Bausteine zeichnen ihre eigenen
Lade-, Fehler- und Leerzustände:

```tsx
import { useRebaseClient } from "@rebasepro/app";
import type { createRebaseClient } from "@rebasepro/client";
import { ChartCard, KpiGrid, KpiTile, TimeSeriesChart } from "@rebasepro/ui";
import { useInsightData } from "@rebasepro/plugin-insights";

type RebaseClient = ReturnType<typeof createRebaseClient>;
type Summary = { orders: number; previousOrders: number; revenue: number };
type Day = { day: string; revenue: number };

function DashboardView() {
    const client = useRebaseClient<RebaseClient>();
    const read = <T,>(path: string) => () => {
        if (!client) throw new Error("No Rebase client");
        return client.functions.invoke<T>("dashboard", undefined, { method: "GET", path });
    };
    const summary = useInsightData("dashboard/summary", read<Summary>("summary"));
    const daily = useInsightData("dashboard/daily", read<Day[]>("daily"));

    return (
        <div className="max-w-6xl mx-auto px-6 py-8">
            <KpiGrid periodDays={30}>
                <KpiTile
                    label="Orders"
                    icon="ShoppingCart"
                    value={summary.data?.orders}
                    previous={summary.data?.previousOrders}
                    loading={summary.loading}
                    error={summary.error}
                />
                <KpiTile
                    label="Revenue"
                    icon="DollarSign"
                    value={summary.data?.revenue}
                    format={{ style: "currency", currency: "USD", notation: "compact" }}
                    loading={summary.loading}
                    error={summary.error}
                />
            </KpiGrid>
            <ChartCard title="Revenue per day" className="mt-4">
                <TimeSeriesChart
                    series={[{ id: "revenue", label: "Revenue", points: (daily.data ?? []).map((d) => ({ at: d.day, value: d.revenue })) }]}
                    format={{ style: "currency", currency: "USD" }}
                    loading={daily.loading}
                    error={daily.error}
                />
            </ChartCard>
        </div>
    );
}
```

Dieselben Komponenten können anstelle einer eigenen Seite auch über der Liste einer
Collection oder oben auf der Startseite über `<Rebase slots>` platziert werden –
`collection.widgets`, `home.children.start`.

## Als Custom View registrieren

```tsx
const views: AppView[] = [
    {
        slug: "dashboard",
        name: "Dashboard",
        view: <DashboardView />,
        icon: "LayoutDashboard",
        group: "Analytics"
    }
];

```

Übergeben Sie es an den Navigation Controller:

```typescript
const navigationStateController = useBuildNavigationStateController({
    views,
    collections: () => collections,
    // These four are required — the controller resolves navigation against them.
    authController,
    data,
    collectionRegistryController,
    urlController
});
```

Das Dashboard erscheint nun in der Seitenleiste unter "Analytics" und ist unter `/dashboard` erreichbar.

### Die Gruppe unten anheften

Gruppen mit dem Namen `"Admin"` oder `"Settings"` rutschen im Drawer durch einen
String-Vergleich des Namens unter die anderen. Dies geht leicht verloren – übersetzt man das
Label, funktioniert die Sortierung unbemerkt nicht mehr – geben Sie es daher stattdessen explizit an:

```tsx
{ slug: "dashboard", name: "Dashboard", view: <DashboardView />, group: "Ajustes", pinToBottom: true }
```

Das Setzen von `pinToBottom` bei einer beliebigen View innerhalb einer Gruppe heftet die gesamte Gruppe an,
da der Drawer Gruppen statt einzelner Views ordnet.

## Aus einer Custom View navigieren

Eine View-Komponente erhält keine Props. Um irgendwohin zu routen – eine andere Custom View, eine
Collection, eine Entity –, greifen Sie auf `useUrlController` zurück, der aus
`@rebasepro/cms` exportiert wird:

```tsx
import { useUrlController } from "@rebasepro/cms";

function DashboardView() {
    const urlController = useUrlController();

    return (
        <>
            <button onClick={() => urlController.navigate(urlController.buildAppUrlPath("reports"))}>
                Reports
            </button>
            <button onClick={() => urlController.navigate(urlController.buildUrlCollectionPath("orders"))}>
                All orders
            </button>
            <button onClick={() => urlController.navigate(urlController.buildUrlCollectionPath("orders/B34SAP8Z"))}>
                Order B34SAP8Z
            </button>
        </>
    );
}
```

Bauen Sie den Pfad dynamisch zusammen, anstatt ihn fest zu codieren: Collection-URLs haben ein Präfix
(`orders` → `/c/orders`) und das Präfix ist nicht Teil des öffentlichen Vertrags.

`useSidePanel` öffnet eine Entity im Seitenpanel statt zu navigieren, was bei einer Zeile
in einer Liste meist das gewünschte Verhalten ist.

## Diagramme und Kennzahlen, die ihre Datensätze öffnen

`BarChart` stellt Kategorien als Balken mit den dazugehörigen Werten dar. Mit
`onBarClick` wird jede Zeile zu einem Button: Öffnen Sie die Liste gefiltert nach dem, was der Balken
zählt, oder einen einzelnen Datensatz im Seitenpanel.

```tsx
import { useUrlController } from "@rebasepro/cms";
import { BarChart, ChartCard } from "@rebasepro/ui";

function OrdersByStatus({ counts, loading }: { counts?: Record<string, number>; loading: boolean }) {
    const urls = useUrlController();
    const statuses = [{ id: "pending", label: "Pending" }, { id: "shipped", label: "Shipped" }, { id: "delivered", label: "Delivered" }];
    return (
        <ChartCard title="Orders by status">
            <BarChart
                bars={statuses.map((s) => ({ key: s.id, label: s.label, value: counts?.[s.id] ?? 0 }))}
                loading={loading}
                onBarClick={(bar) => urls.navigate(
                    `${urls.buildUrlCollectionPath("orders")}?status_op=${encodeURIComponent("==")}&status_value=${bar.key}`
                )}
            />
        </ChartCard>
    );
}
```

Eine `KpiTile` öffnet ihre Datensätze auf dieselbe Weise. Mit `onClick` ist die gesamte
Kachel ein Button; mit `href` ist sie ein Link, den ein modifizierter Klick in einem neuen
Tab öffnet und ein normaler Klick an `onClick` übergibt, sodass der Router des Admins
ohne Neuladen der Seite navigiert:

```tsx
const pending = `${urls.buildUrlCollectionPath("orders")}?status_op=${encodeURIComponent("==")}&status_value=pending`;

<KpiTile
    label="Pending orders"
    icon="Inbox"
    value={counts?.pending}
    loading={loading}
    href={pending}
    onClick={() => urls.navigate(pending)}
/>
```

Ohne beides ist die Kachel eine einfache Card. Umschließen Sie eine Kachel nicht mit einem
eigenen `<button>` oder `<a>`: Das Steuerelement der Kachel wird durch ihr Label, ihren Wert
und ihre Veränderung benannt und erhält den Fokus-Ring.

Die Diagramme sind SVGs in den Design-Tokens des Admins, in Hell und Dunkel, mit Hover-
und Pfeiltasten-Werten sowie einer Tabelle für Screenreader; eine Chart-Bibliothek ist
nicht erforderlich. Für Darstellungsformen, die sie nicht abdecken, funktioniert jede React-Chart-Bibliothek
innerhalb einer `ChartCard`.

## Nächste Schritte

- **[Custom Views](/docs/frontend)** — Frontend-Übersicht
- **[Hooks Reference](/docs/hooks)** — Hooks-Referenz
- **[Slots](/docs/frontend/slots)** — Platzieren derselben Komponenten auf der Startseite oder über einer Collection
