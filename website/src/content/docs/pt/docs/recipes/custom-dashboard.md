---
sourceHash: f10362389108766c
title: "Receita: Dashboard Personalizado"
sidebar_label: Dashboard Personalizado
description: "Crie uma página de dashboard com KPIs e gráficos — números calculados em SQL e desenhados com os blocos de @rebasepro/plugin-insights."
---

## Visão Geral

Um dashboard tem três peças: uma função de backend que calcula os números em SQL, um componente que os carrega com `useInsightData` e os desenha com os blocos de `@rebasepro/plugin-insights`, e um lugar para mostrá-lo — aqui, uma página própria no menu lateral.

Conte no servidor. Trazer linhas para o navegador e somá-las só está certo enquanto a tabela cabe numa página de resultados; depois disso o total fica errado sem aviso.

## Calcular os números no servidor

Uma rota para cada coisa que a página desenha, executada como o usuário conectado, para que as permissões e a segurança em nível de linha valham também para os números:

```ts
// functions/dashboard.ts
import { defineFunction, requireAuth } from "@rebasepro/server/functions";

export default defineFunction((app, { rebase }) => {
    app.use("/*", requireAuth);

    // GET /api/functions/dashboard/summary
    app.get("/summary", async (c) => {
        if (!rebase.sql) return c.json({ error: "SQL not available" }, 501);
        const [row] = await rebase.sql(`
            SELECT
                COUNT(*) FILTER (WHERE order_date >= now() - interval '30 days')                       AS orders,
                COUNT(*) FILTER (WHERE order_date >= now() - interval '60 days'
                                   AND order_date <  now() - interval '30 days')                       AS previous_orders,
                COALESCE(SUM(total) FILTER (WHERE order_date >= now() - interval '30 days'), 0)        AS revenue
            FROM orders
        `);
        return c.json({
            orders: Number(row.orders),
            previousOrders: Number(row.previous_orders),
            revenue: Number(row.revenue)
        });
    });

    // GET /api/functions/dashboard/daily — every day present, an empty one is zero
    app.get("/daily", async (c) => {
        if (!rebase.sql) return c.json({ error: "SQL not available" }, 501);
        const rows = await rebase.sql(`
            SELECT to_char(days.day, 'YYYY-MM-DD') AS day, COALESCE(SUM(o.total), 0) AS revenue
            FROM generate_series(current_date - 29, current_date, interval '1 day') AS days(day)
            LEFT JOIN orders o ON o.order_date >= days.day AND o.order_date < days.day + interval '1 day'
            GROUP BY days.day
            ORDER BY days.day
        `);
        return c.json(rows.map((row) => ({ day: String(row.day), revenue: Number(row.revenue) })));
    });
});
```

## Desenhá-los

`useInsightData(key, load)` carrega uma vez por chave e por usuário, e todo componente que lê a mesma chave compartilha o resultado. Os blocos desenham seus próprios estados de carregamento, erro e vazio:

```tsx
import { useRebaseClient } from "@rebasepro/app";
import type { createRebaseClient } from "@rebasepro/client";
import { ChartCard, KpiGrid, KpiTile, TimeSeriesChart, useInsightData } from "@rebasepro/plugin-insights";

type RebaseClient = ReturnType<typeof createRebaseClient>;
type Summary = { orders: number; previousOrders: number; revenue: number };
type Day = { day: string; revenue: number };

function DashboardView() {
    const client = useRebaseClient<RebaseClient>();
    const read = <T,>(path: string) => () => {
        if (!client) throw new Error("No Rebase client");
        return client.functions.invoke<T>("dashboard", undefined, { method: "GET", path });
    };
    const summary = useInsightData("dashboard/summary", read<Summary>("summary"));
    const daily = useInsightData("dashboard/daily", read<Day[]>("daily"));

    return (
        <div className="max-w-6xl mx-auto px-6 py-8">
            <KpiGrid periodDays={30}>
                <KpiTile
                    label="Orders"
                    icon="ShoppingCart"
                    value={summary.data?.orders}
                    previous={summary.data?.previousOrders}
                    loading={summary.loading}
                    error={summary.error}
                />
                <KpiTile
                    label="Revenue"
                    icon="DollarSign"
                    value={summary.data?.revenue}
                    format={{ style: "currency", currency: "USD", notation: "compact" }}
                    loading={summary.loading}
                    error={summary.error}
                />
            </KpiGrid>
            <ChartCard title="Revenue per day" className="mt-4">
                <TimeSeriesChart
                    series={[{ id: "revenue", label: "Revenue", points: (daily.data ?? []).map((d) => ({ at: d.day, value: d.revenue })) }]}
                    format={{ style: "currency", currency: "USD" }}
                    loading={daily.loading}
                    error={daily.error}
                />
            </ChartCard>
        </div>
    );
}
```

Os mesmos componentes podem ficar acima da lista de uma coleção ou no topo da página inicial via `<Rebase slots>` — `collection.widgets`, `home.children.start` — em vez de numa página própria.

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

## Gráficos que abrem seus registros

`BarChart` desenha categorias como barras com o valor ao lado. Com `onBarClick`, cada linha vira um botão: abra a lista filtrada pelo que a barra conta, ou um registro no painel lateral.

```tsx
import { useUrlController } from "@rebasepro/cms";
import { BarChart, ChartCard } from "@rebasepro/plugin-insights";

function OrdersByStatus({ counts, loading }: { counts?: Record<string, number>; loading: boolean }) {
    const urls = useUrlController();
    const statuses = [{ id: "pending", label: "Pending" }, { id: "shipped", label: "Shipped" }, { id: "delivered", label: "Delivered" }];
    return (
        <ChartCard title="Orders by status">
            <BarChart
                bars={statuses.map((s) => ({ key: s.id, label: s.label, value: counts?.[s.id] ?? 0 }))}
                loading={loading}
                onBarClick={(bar) => urls.navigate(
                    `${urls.buildUrlCollectionPath("orders")}?status_op=${encodeURIComponent("==")}&status_value=${bar.key}`
                )}
            />
        </ChartCard>
    );
}
```

Os gráficos são SVG com os tokens do próprio admin, no claro e no escuro, com leitura ao passar o mouse e pelas setas do teclado, e uma tabela para leitores de tela; nenhuma biblioteca de gráficos é necessária. Para uma forma que eles não desenham, qualquer biblioteca de gráficos React funciona dentro de um `ChartCard`.

## Próximos Passos

- **[Custom Views](/docs/frontend)** — Visão geral do frontend
- **[Hooks Reference](/docs/hooks)** — Hooks disponíveis
- **[Slots](/docs/frontend/slots)** — Colocar os mesmos componentes na página inicial ou acima de uma coleção
