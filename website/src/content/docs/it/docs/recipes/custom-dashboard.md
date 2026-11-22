---
sourceHash: d60e60304904c8c2
title: "Ricetta: Dashboard personalizzata"
sidebar_label: Dashboard personalizzata
description: "Crea una pagina dashboard con riquadri KPI e grafici — numeri calcolati in SQL, renderizzati con i blocchi di @rebasepro/ui."
---

## Panoramica

Una dashboard è composta da tre elementi: una funzione backend che calcola i numeri in
SQL, un componente che li carica con `useInsightData` e li renderizza con i
blocchi di `@rebasepro/ui`, e un punto in cui mostrarla — in questo caso, una pagina
dedicata nel drawer.

Esegui i conteggi sul server. Recuperare le righe nel browser e sommarle funziona
solo finché la tabella rientra in una singola pagina di risultati; oltre questo limite il totale risulterà
silenziosamente errato.

## Calcolare i numeri sul server

Una route per ogni elemento renderizzato dalla pagina, eseguita come utente autenticato,
in modo che i permessi e la sicurezza a livello di riga (row-level security) si applichino anche alle cifre:

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

## Renderizzarli

`useInsightData(key, load)` effettua il caricamento una volta sola per chiave e utente autenticato, e ogni
componente che legge la stessa chiave condivide il risultato. I blocchi gestiscono autonomamente
i propri stati di caricamento, errore e assenza di dati:

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

Gli stessi componenti possono essere posizionati sopra l'elenco di una collection o in cima alla home
page tramite `<Rebase slots>` — `collection.widgets`, `home.children.start` —
invece di avere una pagina dedicata.

## Registrare come Custom View

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

Passalo al controller di navigazione:

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

La dashboard compare ora nella barra laterale sotto "Analytics" ed è accessibile all'indirizzo `/dashboard`.

### Fissare il gruppo in basso

I gruppi denominati `"Admin"` o `"Settings"` vengono posizionati sotto gli altri nel drawer, tramite
confronto di stringhe sul nome. Questo comportamento si può perdere facilmente — traducendo l'etichetta,
l'ordinamento smette silenziosamente di funzionare — quindi è preferibile specificarlo esplicitamente:

```tsx
{ slug: "dashboard", name: "Dashboard", view: <DashboardView />, group: "Ajustes", pinToBottom: true }
```

L'impostazione di `pinToBottom` su una qualsiasi vista di un gruppo fissa l'intero gruppo in basso, poiché
il drawer ordina i gruppi piuttosto che le singole viste.

## Navigazione da una vista personalizzata

Un componente di visualizzazione non riceve props. Per reindirizzare altrove — un'altra vista personalizzata, una
collection, un'entità — utilizza `useUrlController`, esportato da
`@rebasepro/cms`:

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

Costruisci il percorso invece di codificarlo staticamente: gli URL delle collection hanno un prefisso
(`orders` → `/c/orders`) e tale prefisso non fa parte del contratto pubblico.

`useSidePanel` apre un'entità nel pannello laterale invece di navigare, il che è
generalmente ciò che si desidera per una riga all'interno di un elenco.

## Grafici e valori numerici che aprono i relativi record

`BarChart` mostra le categorie sotto forma di barre con i rispettivi valori accanto. Fornendo
`onBarClick`, ogni riga diventa un pulsante: apre l'elenco filtrato in base a ciò che la barra
conteggia, oppure un singolo record nel pannello laterale.

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

Un `KpiTile` apre i relativi record nello stesso modo. Fornendo `onClick`, l'intero riquadro
è un pulsante; fornendo `href`, diventa un link, che un clic con tasti di modifica apre in una nuova
scheda e un normale clic passa a `onClick`, consentendo al router di amministrazione di navigare
senza ricaricare la pagina:

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

Senza nessuna delle due opzioni, il riquadro è una semplice scheda. Non racchiudere un riquadro in un tag `<button>`
o `<a>` personalizzato: il controllo del riquadro è denominato in base alla sua etichetta, al valore numerico e
alla variazione, e gestisce l'anello di focus (focus ring).

I grafici sono SVG stilizzati con i token di design dell'admin, in tema chiaro e scuro, con lettura
al passaggio del mouse e tramite tasti freccia, e una tabella per gli screen reader; non è necessaria
alcuna libreria grafica esterna. Per una rappresentazione non supportata nativamente, qualsiasi libreria grafica React funziona all'interno di un
`ChartCard`.

## Prossimi passi

- **[Viste personalizzate](/docs/frontend)** — Panoramica del frontend
- **[Riferimento degli Hook](/docs/hooks)** — Hook disponibili
- **[Slot](/docs/frontend/slots)** — Posizionamento degli stessi componenti nella home page o sopra una collection
