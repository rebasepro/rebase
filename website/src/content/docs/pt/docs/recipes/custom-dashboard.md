---
sourceHash: 62363af9dfc94b45
title: "Receita: Dashboard Personalizado"
sidebar_label: Dashboard Personalizado
description: Crie uma visualização de dashboard personalizada com gráficos, estatísticas e visualizações de dados usando os hooks do Rebase.
---

## Visão Geral

Crie uma visualização de dashboard personalizada que exibe análises ao lado do seu painel de administração.

## Criar o Componente de Dashboard

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

## Registrar como uma Visualização Personalizada

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

Passe-o para o controlador de navegação:

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

O dashboard agora aparece na barra lateral sob "Analytics" e fica acessível em `/dashboard`.

### Fixando o grupo na parte inferior

Grupos chamados `"Admin"` ou `"Settings"` vão para baixo dos outros no drawer, por
comparação de strings no nome. Isso é fácil de perder — traduza o rótulo e a
ordenação silenciosamente deixa de acontecer — então defina isso explicitamente:

```tsx
{ slug: "dashboard", name: "Dashboard", view: <DashboardView />, group: "Ajustes", pinToBottom: true }
```

Definir `pinToBottom` em qualquer visualização de um grupo fixa todo o grupo, já
que o drawer ordena grupos em vez de visualizações individuais.

## Navegando a partir de uma visualização personalizada

Um componente de visualização não recebe props. Para navegar para algum lugar — outra visualização personalizada, uma
coleção, uma entidade — utilize o `useUrlController`, que é exportado de
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

Construa o caminho em vez de codificá-lo diretamente (hard-coding): as URLs de coleções possuem prefixo
(`orders` → `/c/orders`) e o prefixo não faz parte do contrato público.

`useSidePanel` abre uma entidade no painel lateral em vez de navegar, o que
geralmente é o desejado para uma linha em uma lista.

## Adicionando Gráficos

Instale uma biblioteca de gráficos:

```bash
pnpm add recharts
```

Em seguida, use-a em seu dashboard:

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

## Próximos Passos

- **[Custom Views](/docs/frontend)** — Visão geral do frontend
- **[Hooks Reference](/docs/hooks)** — Hooks disponíveis
