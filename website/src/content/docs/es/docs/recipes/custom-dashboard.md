---
title: "Receta: Panel de Control Personalizado"
sidebar_label: Panel de Control Personalizado
slug: es/docs/recipes/custom-dashboard
description: Construya una vista de panel de control personalizada con gráficos, estadísticas y visualizaciones de datos utilizando los hooks de Rebase.
---

## Overview

Construya una vista de panel de control personalizada que muestre análisis junto a su panel de administración.

## Create the Dashboard Component

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
            <p className="text-3xl font-bold">{value}</p>
        </div>
    );
}
```

## Register as a Custom View

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

Páselo al controlador de navegación:

```typescript
const navigationStateController = useBuildNavigationStateController({
    views,
    collections: () => collections,
    // ...
});
```

El panel de control ahora aparece en la barra lateral bajo "Análisis" y es accesible en `/dashboard`.

## Adding Charts

Instale una librería de gráficos:

```bash
pnpm add recharts
```

Luego úsela en su panel de control:

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

## Next Steps

- **[Vistas Personalizadas](/docs/frontend)** — Resumen del frontend
- **[Referencia de Hooks](/docs/hooks)** — Hooks disponibles

---
