---
sourceHash: 62363af9dfc94b45
title: "Recette : Tableau de bord personnalisé"
sidebar_label: Tableau de bord personnalisé
description: Créez une vue de tableau de bord personnalisée avec des graphiques, des statistiques et des visualisations de données à l'aide des hooks Rebase.
---

## Aperçu

Créez une vue de tableau de bord personnalisée qui affiche les analyses à côté de votre panneau d'administration.

## Créer le composant de tableau de bord

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

## Enregistrer en tant que vue personnalisée

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

Transmettez-le au contrôleur de navigation :

```typescript
const navigationStateController = useBuildNavigationStateController({
    views,
    collections: () => collections,
    // ...
});
```

Le tableau de bord apparaît maintenant dans la barre latérale sous "Analytics" et est accessible à `/dashboard`.

## Ajouter des graphiques

Installez une bibliothèque de graphiques :

```bash
pnpm add recharts
```

Utilisez-le ensuite dans votre tableau de bord :

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

## Prochaines étapes

- **[Vues personnalisées](/docs/frontend)** — Aperçu du frontend
- **[Référence des hooks](/docs/hooks)** — Hooks disponibles

---
