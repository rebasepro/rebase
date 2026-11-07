---
sourceHash: a9c03468852b95e3
title: "Rezept: Benutzerdefiniertes Dashboard"
sidebar_label: Benutzerdefiniertes Dashboard
description: "Eine Dashboard-Seite mit KPI-Kacheln und Diagrammen erstellen — Zahlen in SQL berechnet, gezeichnet mit den Bausteinen aus @rebasepro/ui."
---

## Übersicht

Ein Dashboard besteht aus drei Teilen: einer Backend-Funktion, die die Zahlen in SQL berechnet, einer Komponente, die sie mit `useInsightData` lädt und mit den Bausteinen aus `@rebasepro/ui` zeichnet, und einem Ort, an dem es erscheint — hier eine eigene Seite in der Seitenleiste.

Zählen Sie auf dem Server. Zeilen in den Browser zu laden und dort zu addieren stimmt nur, solange die Tabelle in eine Ergebnisseite passt; danach ist die Summe stillschweigend falsch.

## Die Zahlen auf dem Server berechnen

Eine Route pro gezeichnetem Element, ausgeführt als angemeldeter Benutzer, damit Berechtigungen und Row-Level Security auch für die Kennzahlen gelten:

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

## Zeichnen

`useInsightData(key, load)` lädt einmal pro Schlüssel und angemeldetem Benutzer, und jede Komponente, die denselben Schlüssel liest, teilt sich das Ergebnis. Die Bausteine zeichnen ihre eigenen Lade-, Fehler- und Leerzustände:

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

Dieselben Komponenten können auch über einer Collection-Liste oder oben auf der Startseite stehen — über `<Rebase slots>` mit `collection.widgets` oder `home.children.start` — statt auf einer eigenen Seite.

## Als benutzerdefinierte Ansicht registrieren

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

Übergeben Sie sie an den Navigations-Controller:

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

Gruppen mit dem Namen `"Admin"` oder `"Settings"` sinken im Drawer unter die anderen, basierend auf einem String-Vergleich des Namens. Dies kann schnell verloren gehen – wird die Beschriftung übersetzt, funktioniert die Sortierung unbemerkt nicht mehr – geben Sie es daher stattdessen explizit an:

```tsx
{ slug: "dashboard", name: "Dashboard", view: <DashboardView />, group: "Ajustes", pinToBottom: true }
```

Das Setzen von `pinToBottom` bei einer beliebigen Ansicht in einer Gruppe heftet die gesamte Gruppe an, da der Drawer Gruppen statt einzelner Ansichten sortiert.

## Navigation aus einer benutzerdefinierten Ansicht

Eine View-Komponente erhält keine Props. Um irgendwohin zu navigieren – zu einer anderen benutzerdefinierten Ansicht, einer Collection, einer Entität – verwenden Sie `useUrlController`, das aus `@rebasepro/cms` exportiert wird:

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

Bauen Sie den Pfad dynamisch zusammen, anstatt ihn fest einzuprogrammieren: Collection-URLs haben ein Präfix (`orders` → `/c/orders`), und dieses Präfix ist nicht Teil des öffentlichen Vertrags.

`useSidePanel` öffnet eine Entität im Seitenbereich anstatt zu navigieren, was bei einer Zeile in einer Liste normalerweise das gewünschte Verhalten ist.

## Diagramme, die ihre Datensätze öffnen

`BarChart` zeichnet Kategorien als Balken mit ihren Werten daneben. Mit `onBarClick` wird jede Zeile zu einem Button: Öffnen Sie die Liste gefiltert auf das, was der Balken zählt, oder einen Datensatz im Seitenpanel.

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

Die Diagramme sind SVG in den eigenen Tokens des Admin-Panels, hell und dunkel, mit einer Anzeige bei Hover und Pfeiltasten und einer Tabelle für Screenreader; eine Diagrammbibliothek ist nicht nötig. Für eine Form, die sie nicht zeichnen, funktioniert jede React-Diagrammbibliothek innerhalb einer `ChartCard`.

## Nächste Schritte

- **[Benutzerdefinierte Ansichten](/docs/frontend)** — Frontend-Übersicht
- **[Hooks-Referenz](/docs/hooks)** — Verfügbare Hooks
- **[Slots](/docs/frontend/slots)** — Dieselben Komponenten auf der Startseite oder über einer Collection platzieren
