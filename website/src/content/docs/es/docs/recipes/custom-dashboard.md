---
sourceHash: 62363af9dfc94b45
title: "Receta: Dashboard personalizado"
sidebar_label: Dashboard personalizado
description: Crea una vista de dashboard personalizada con gráficos, estadísticas y visualizaciones de datos utilizando los hooks de Rebase.
---

## Descripción general

Crea una vista de dashboard personalizada que muestre análisis junto a tu panel de administración.

## Crear el componente de Dashboard

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

## Registrar como una vista personalizada

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

Pásalo al controlador de navegación:

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

El dashboard ahora aparece en la barra lateral debajo de "Analytics" y es accesible en `/dashboard`.

### Fijar el grupo en la parte inferior

Los grupos llamados `"Admin"` o `"Settings"` se ubican por debajo de los demás en el menú lateral (drawer), mediante una comparación de cadenas sobre el nombre. Esto es fácil de perder —si traduces la etiqueta, el ordenamiento deja de aplicarse silenciosamente—, así que indícalo explícitamente en su lugar:

```tsx
{ slug: "dashboard", name: "Dashboard", view: <DashboardView />, group: "Ajustes", pinToBottom: true }
```

Establecer `pinToBottom` en cualquiera de las vistas de un grupo fija todo el grupo, ya que el drawer ordena grupos en lugar de vistas individuales.

## Navegar desde una vista personalizada

Un componente de vista no recibe props. Para navegar a algún lugar —otra vista personalizada, una colección, una entidad—, recurre a `useUrlController`, que se exporta desde `@rebasepro/cms`:

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

Construye la ruta en lugar de escribirla manualmente (hard-code): las URLs de las colecciones tienen prefijo (`orders` → `/c/orders`) y el prefijo no forma parte del contrato público.

`useSidePanel` abre una entidad en el panel lateral en lugar de navegar, que suele ser lo que se desea para una fila de una lista.

## Añadir gráficos

Instala una biblioteca de gráficos:

```bash
pnpm add recharts
```

Luego úsala en tu dashboard:

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

## Próximos pasos

- **[Vistas personalizadas](/docs/frontend)** — Descripción general del frontend
- **[Referencia de hooks](/docs/hooks)** — Hooks disponibles
