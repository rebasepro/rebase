---
sourceHash: 62363af9dfc94b45
title: "Rezept: Benutzerdefiniertes Dashboard"
sidebar_label: Benutzerdefiniertes Dashboard
description: Erstellen Sie eine benutzerdefinierte Dashboard-Ansicht mit Diagrammen, Statistiken und Datenvisualisierungen mithilfe von Rebase-Hooks.
---

## Übersicht

Erstellen Sie eine benutzerdefinierte Dashboard-Ansicht, die Analysen neben Ihrem Admin-Panel anzeigt.

## Dashboard-Komponente erstellen

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

## Diagramme hinzufügen

Installieren Sie eine Diagramm-Bibliothek:

```bash
pnpm add recharts
```

Verwenden Sie sie anschließend in Ihrem Dashboard:

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
