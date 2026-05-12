---
title: "Ricetta: Dashboard Personalizzata"
sidebar_label: Dashboard Personalizzata
slug: it/docs/recipes/custom-dashboard
description: Costruisci una vista dashboard personalizzata con grafici, statistiche e visualizzazioni di dati utilizzando i hook di Rebase.
---

## Panoramica

Crea una vista dashboard personalizzata che visualizzi le analisi accanto al tuo pannello di amministrazione.

## Crea il Componente Dashboard

```tsx
import { useRebaseContext } from "@rebasepro/core";
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
            const orders = await context.dataSource.fetchCollection({
                path: "orders",
                collection: ordersCollection,
                limit: 1000
            });

            const products = await context.dataSource.fetchCollection({
                path: "products",
                collection: productsCollection,
                filter: { active: ["==", true] }
            });

            setStats({
                totalOrders: orders.length,
                totalRevenue: orders.reduce((sum, o) => sum + (o.values.total ?? 0), 0),
                activeProducts: products.length,
                recentOrders: orders.slice(0, 5)
            });
        }
        loadStats();
    }, []);

    return (
        <div className="p-8">
            <h1 className="text-2xl font-bold mb-6">Dashboard</h1>
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
            <p className="text-3xl font-bold">{value}</p>
        </div>
    );
}
```

## Registra come Vista Personalizzata

```typescript
const views: CMSView[] = [
    {
        slug: "dashboard",
        name: "Dashboard",
        icon: "dashboard",
        group: "Analytics",
        view: <DashboardView />
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
npm install recharts
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
