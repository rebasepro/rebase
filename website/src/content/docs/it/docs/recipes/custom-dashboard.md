---
sourceHash: 62363af9dfc94b45
title: "Ricetta: Dashboard personalizzata"
sidebar_label: Dashboard personalizzata
description: Crea una vista dashboard personalizzata con grafici, statistiche e visualizzazioni di dati utilizzando gli hook di Rebase.
---

## Panoramica

Crea una vista dashboard personalizzata che mostri i dati analitici accanto al tuo pannello di amministrazione.

## Creare il componente Dashboard

```tsx
import { useRebaseContext } from "@rebasepro/app";
import { useEffect, useState } from "react";

type OrderRow = { id: string; total: number };

function DashboardView() {
    const context = useRebaseContext();
    const [stats, setStats] = useState<{
        totalOrders: number;
        totalRevenue: number;
        activeProducts: number;
        recentOrders: OrderRow[];
    }>({
        totalOrders: 0,
        totalRevenue: 0,
        activeProducts: 0,
        recentOrders: []
    });

    useEffect(() => {
        async function loadStats() {
            // Use the data source to fetch aggregate data
            // `find` resolves to { data, meta } — the rows are on `data`, and they are
            // flat, so it is `o.total` rather than `o.values.total`.
            const { data: orders } = await context.data
                .collection<OrderRow>("orders")
                .find({ limit: 1000 });

            const { data: products } = await context.data
                .collection<Record<string, unknown>>("products")
                .find({ where: { active: ["==", true] } });

            setStats({
                totalOrders: orders.length,
                totalRevenue: orders.reduce((sum, o) => sum + (o.total ?? 0), 0),
                activeProducts: products.length,
                recentOrders: orders.slice(0, 5)
            });
        }
        loadStats();
    }, []);

    return (
        <div className="p-8">
            <h1 className="text-xl font-semibold tracking-[-0.01em] mb-6">Dashboard</h1>
            <div className="grid grid-cols-3 gap-4 mb-8">
                <StatCard title="Total Orders" value={stats.totalOrders} />
                <StatCard title="Revenue" value={`$${stats.totalRevenue.toFixed(2)}`} />
                <StatCard title="Active Products" value={stats.activeProducts} />
            </div>
            <h2 className="text-sm font-semibold tracking-[-0.01em] mb-4">Recent Orders</h2>
            <ul>
                {stats.recentOrders.map(order => (
                    <li key={order.id}>
                        Order #{order.id} — ${order.total}
                    </li>
                ))}
            </ul>
        </div>
    );
}

function StatCard({ title, value }: { title: string; value: string | number }) {
    return (
        <div className="bg-surface-100 dark:bg-surface-800 rounded-lg p-6">
            <p className="text-xs text-surface-500">{title}</p>
            <p className="text-xl font-semibold">{value}</p>
        </div>
    );
}
```

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

## Aggiungere grafici

Installa una libreria per grafici:

```bash
pnpm add recharts
```

Quindi utilizzala nella tua dashboard:

```tsx
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";

function RevenueChart({ data }) {
    return (
        <LineChart width={600} height={300} data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" />
            <YAxis />
            <Tooltip />
            <Line type="monotone" dataKey="revenue" stroke="#8884d8" />
        </LineChart>
    );
}
```

## Passaggi successivi

- **[Viste personalizzate](/docs/frontend)** — Panoramica del frontend
- **[Riferimento degli hook](/docs/hooks)** — Hook disponibili
