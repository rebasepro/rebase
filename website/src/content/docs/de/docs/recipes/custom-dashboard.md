---
sourceHash: 62363af9dfc94b45
title: "Rezept: Benutzerdefiniertes Dashboard"
sidebar_label: Benutzerdefiniertes Dashboard
description: Erstellen Sie eine benutzerdefinierte Dashboard-Ansicht mit Diagrammen, Statistiken und Datenvisualisierungen mithilfe von Rebase-Hooks.
---

## Übersicht

Erstellen Sie eine benutzerdefinierte Dashboard-Ansicht, die Analysen neben Ihrem Admin-Panel anzeigt.

## Die Dashboard-Komponente erstellen

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
                <StatCard title="Total Orders" value={stats.totalOrders} />
                <StatCard title="Revenue" value={`$${stats.totalRevenue.toFixed(2)}`} />
                <StatCard title="Active Products" value={stats.activeProducts} />
            </div>
            <h2 className="text-lg font-semibold mb-4">Recent Orders</h2>
            <ul>
                {stats.recentOrders.map(order => (
                    <li key={order.id}>
                        Order #{order.id} — ${order.values.total}
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

## Als benutzerdefinierte Ansicht registrieren

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

Übergeben Sie es dem Navigationscontroller:

```typescript
const navigationStateController = useBuildNavigationStateController({
    views,
    collections: () => collections,
    // ...
});
```

Das Dashboard erscheint nun in der Seitenleiste unter „Analytics“ und ist unter `/dashboard` zugänglich.

## Diagramme hinzufügen

Installieren Sie eine Diagrammbibliothek:

```bash
pnpm add recharts
```

Verwenden Sie es dann in Ihrem Dashboard:

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

## Nächste Schritte

- **[Benutzerdefinierte Ansichten](/docs/frontend)** — Frontend-Übersicht
- **[Hooks-Referenz](/docs/hooks)** — Verfügbare Hooks
---
