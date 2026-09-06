---
sourceHash: 62363af9dfc94b45
title: "Ricetta: Dashboard Personalizzata"
sidebar_label: Dashboard Personalizzata
description: Costruisci una vista dashboard personalizzata con grafici, statistiche e visualizzazioni di dati utilizzando i hook di Rebase.
---

## Panoramica

Crea una vista dashboard personalizzata che visualizzi le analisi accanto al tuo pannello di amministrazione.

## Crea il Componente Dashboard

```tsx
import { useRebaseContext } from "@rebasepro/app";
import { useEffect, useState } from "react";

function DashboardView() {
    const context = useRebaseContext();
    const [stats, setStats] = useState({
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
                .collection<{ total: number }>("orders")
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
            <h1 className="text-2xl font-semibold mb-6">Dashboard</h1>
            <div className="grid grid-cols-3 gap-4 mb-8">
                <StatCard title="Ordini Totali" value={stats.totalOrders} />
                <StatCard title="Entrate" value={`$${stats.totalRevenue.toFixed(2)}`} />
                <StatCard title="Prodotti Attivi" value={stats.activeProducts} />
            </div>
            <h2 className="text-lg font-semibold mb-4">Ordini Recenti</h2>
            <ul>
                {stats.recentOrders.map(order => (
                    <li key={order.id}>
                        Ordine #{order.id} — ${order.values.total}
                    </li>
                ))}
            </ul>
        </div>
    );
}

function StatCard({ title, value }: { title: string; value: string | number }) {
    return (
        <div className="bg-surface-100 dark:bg-surface-800 rounded-lg p-6">
            <p className="text-sm text-surface-500">{title}</p>
            <p className="text-3xl font-semibold">{value}</p>
        </div>
    );
}
```

## Registra come Vista Personalizzata

```tsx
const views: AppView[] = [
    {
        slug: "dashboard",
        name: "Dashboard",
        view: <DashboardView />,
        admin: {
            icon: "dashboard",
            group: "Analytics"
        }
    }
];

```

Passalo al controller di navigazione:

```typescript
const navigationStateController = useBuildNavigationStateController({
    views,
    collections: () => collections,
    // ...
});
```

La dashboard appare ora nella barra laterale sotto "Analisi" ed è accessibile a `/dashboard`.

## Aggiungere Grafici

Installa una libreria di grafici:

```bash
pnpm add recharts
```

Poi usala nella tua dashboard:

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

## Prossimi Passi

-   **[Viste Personalizzate](/docs/frontend)** — Panoramica del frontend
-   **[Riferimento agli Hook](/docs/hooks)** — Hook disponibili
---
