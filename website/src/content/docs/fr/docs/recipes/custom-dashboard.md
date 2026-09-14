---
sourceHash: 62363af9dfc94b45
title: "Recette : Tableau de bord personnalisé"
sidebar_label: Tableau de bord personnalisé
description: Créez une vue de tableau de bord personnalisée avec des graphiques, des statistiques et des visualisations de données à l'aide des hooks Rebase.
---

## Aperçu

Créez une vue de tableau de bord personnalisée qui affiche des analyses aux côtés de votre panneau d'administration.

## Créer le composant Dashboard

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

## Enregistrer en tant que vue personnalisée

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

Transmettez-le au contrôleur de navigation :

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

Le tableau de bord apparaît désormais dans la barre latérale sous « Analytics » et est accessible à l'adresse `/dashboard`.

### Épingler le groupe en bas

Les groupes nommés `"Admin"` ou `"Settings"` se placent sous les autres dans le volet latéral, par comparaison de chaînes sur le nom. Cela peut facilement être perdu — traduisez le libellé et l'agencement cesse silencieusement de s'appliquer — indiquez-le donc plutôt explicitement :

```tsx
{ slug: "dashboard", name: "Dashboard", view: <DashboardView />, group: "Ajustes", pinToBottom: true }
```

Définir `pinToBottom` sur n'importe quelle vue d'un groupe épingle l'ensemble du groupe, puisque le volet ordonne les groupes plutôt que les vues individuelles.

## Naviguer depuis une vue personnalisée

Un composant de vue ne reçoit aucune prop. Pour naviguer vers un autre emplacement — une autre vue personnalisée, une collection, une entité — faites appel à `useUrlController`, qui est exporté depuis `@rebasepro/cms` :

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

Construisez le chemin plutôt que de le coder en dur : les URL de collection sont préfixées (`orders` → `/c/orders`) et le préfixe ne fait pas partie du contrat public.

`useSidePanel` ouvre une entité dans le panneau latéral au lieu de naviguer, ce qui correspond généralement au comportement souhaité pour une ligne dans une liste.

## Ajouter des graphiques

Installez une bibliothèque de graphiques :

```bash
pnpm add recharts
```

Utilisez-la ensuite dans votre tableau de bord :

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
