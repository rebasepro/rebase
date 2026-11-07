---
sourceHash: f10362389108766c
title: "Ricetta: Dashboard personalizzata"
sidebar_label: Dashboard personalizzata
description: "Crea una pagina dashboard con KPI e grafici: numeri calcolati in SQL e disegnati con i blocchi di @rebasepro/plugin-insights."
---

## Panoramica

Una dashboard è fatta di tre pezzi: una funzione backend che calcola i numeri in SQL, un componente che li carica con `useInsightData` e li disegna con i blocchi di `@rebasepro/plugin-insights`, e un posto dove mostrarla — qui, una pagina a sé nel menu laterale.

Conta sul server. Portare le righe nel browser e sommarle è corretto solo finché la tabella sta in una pagina di risultati; oltre, il totale è sbagliato senza avvisare.

## Calcolare i numeri sul server

Una route per ogni elemento che la pagina disegna, eseguita come l'utente autenticato, così permessi e sicurezza a livello di riga valgono anche per le cifre:

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

## Disegnarli

`useInsightData(key, load)` carica una volta per chiave e per utente, e ogni componente che legge la stessa chiave condivide il risultato. I blocchi disegnano da soli gli stati di caricamento, errore e vuoto:

```tsx
import { useRebaseClient } from "@rebasepro/app";
import type { createRebaseClient } from "@rebasepro/client";
import { ChartCard, KpiGrid, KpiTile, TimeSeriesChart, useInsightData } from "@rebasepro/plugin-insights";

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

Gli stessi componenti possono stare sopra la lista di una collection o in cima alla home tramite `<Rebase slots>` — `collection.widgets`, `home.children.start` — invece che in una pagina a sé.

## Registrare come vista personalizzata

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

Passalo al navigation controller:

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

La dashboard ora appare nella barra laterale sotto "Analytics" ed è accessibile all'indirizzo `/dashboard`.

### Fissare il gruppo in basso

I gruppi denominati `"Admin"` o `"Settings"` scivolano sotto gli altri nel drawer, in base al confronto delle stringhe sul nome. Questo comportamento si può perdere facilmente — traducendo l'etichetta l'ordinamento cessa silenziosamente di funzionare — quindi è preferibile specificarlo in modo esplicito:

```tsx
{ slug: "dashboard", name: "Dashboard", view: <DashboardView />, group: "Ajustes", pinToBottom: true }
```

L'impostazione di `pinToBottom` su una qualsiasi vista di un gruppo fissa l'intero gruppo, poiché il drawer ordina i gruppi piuttosto che le singole viste.

## Navigare da una vista personalizzata

Un componente di vista non riceve props. Per instradare altrove — un'altra vista personalizzata, una collezione, un'entità — utilizza `useUrlController`, esportato da `@rebasepro/cms`:

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

Costruisci il percorso anziché codificarlo manualmente (hard-coding): gli URL delle collezioni sono preceduti da un prefisso (`orders` → `/c/orders`) e tale prefisso non fa parte del contratto pubblico.

`useSidePanel` apre un'entità nel pannello laterale invece di effettuare la navigazione, il che di solito è ciò che si desidera per una riga di un elenco.

## Grafici che aprono i loro record

`BarChart` disegna le categorie come barre con il valore accanto. Con `onBarClick` ogni riga diventa un pulsante: apri la lista filtrata su ciò che la barra conta, oppure un record nel pannello laterale.

```tsx
import { useUrlController } from "@rebasepro/cms";
import { BarChart, ChartCard } from "@rebasepro/plugin-insights";

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

I grafici sono SVG con i token dell'admin, in chiaro e in scuro, con una lettura al passaggio del mouse e con i tasti freccia, e una tabella per gli screen reader; non serve alcuna libreria di grafici. Per una forma che non disegnano, qualsiasi libreria di grafici React funziona dentro una `ChartCard`.

## Passaggi successivi

- **[Viste personalizzate](/docs/frontend)** — Panoramica del frontend
- **[Riferimento degli hook](/docs/hooks)** — Hook disponibili
- **[Slots](/docs/frontend/slots)** — Mettere gli stessi componenti nella home o sopra una collection
