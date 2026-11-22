---
sourceHash: d60e60304904c8c2
title: "Receita: Dashboard Personalizado"
sidebar_label: Dashboard Personalizado
description: "Crie uma página de dashboard com blocos de KPI e gráficos — números calculados em SQL, renderizados com os blocos de @rebasepro/ui."
---

## Visão Geral

Um dashboard é composto por três partes: uma função de backend que calcula os números em
SQL, um componente que os carrega com `useInsightData` e os renderiza com os
blocos de `@rebasepro/ui`, e um local para exibi-lo — aqui, uma página
própria no drawer.

Faça a contagem no servidor. Buscar linhas no navegador e somá-las só funciona
corretamente enquanto a tabela couber em uma única página de resultados; além disso, o total
estará silenciosamente errado.

## Calcule os números no servidor

Uma rota para cada elemento que a página renderiza, executada como o usuário autenticado, para que
permissões e segurança em nível de linha (row-level security) também se apliquem aos valores:

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

## Renderize-os

`useInsightData(key, load)` carrega uma vez por chave e usuário autenticado, e cada
componente lendo a mesma chave compartilha o resultado. Os blocos renderizam seus próprios
estados de carregamento, erro e vazio:

```tsx
import { useRebaseClient } from "@rebasepro/app";
import type { createRebaseClient } from "@rebasepro/client";
import { ChartCard, KpiGrid, KpiTile, TimeSeriesChart } from "@rebasepro/ui";
import { useInsightData } from "@rebasepro/plugin-insights";

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

Os mesmos componentes podem ser posicionados acima da lista de uma coleção ou no topo da página
inicial por meio de `<Rebase slots>` — `collection.widgets`, `home.children.start` —
em vez de em uma página própria.

## Registre como uma Custom View

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

O dashboard agora aparece na barra lateral sob "Analytics" e pode ser acessado em `/dashboard`.

### Fixando o grupo na parte inferior

Grupos chamados `"Admin"` ou `"Settings"` ficam abaixo dos outros no drawer, por
comparação de strings no nome. Isso é fácil de se perder — traduza o rótulo e
a ordenação deixará de acontecer silenciosamente — portanto, defina isso explicitamente:

```tsx
{ slug: "dashboard", name: "Dashboard", view: <DashboardView />, group: "Ajustes", pinToBottom: true }
```

Definir `pinToBottom` em qualquer visualização de um grupo fixa todo o grupo, já que
o drawer ordena grupos em vez de visualizações individuais.

## Navegando a partir de uma custom view

Um componente de view não recebe props. Para navegar para algum lugar — outra custom view, uma
coleção, uma entidade —, utilize o `useUrlController`, exportado de
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

Construa o caminho em vez de defini-lo de forma estática (hard-code): as URLs de coleções possuem prefixo
(`orders` → `/c/orders`) e o prefixo não faz parte do contrato público.

O `useSidePanel` abre uma entidade no painel lateral em vez de navegar, o que
geralmente é o que você deseja para uma linha em uma lista.

## Gráficos e números que abrem seus registros

O `BarChart` renderiza categorias como barras com seus valores ao lado. Ao fornecer
`onBarClick`, cada linha se torna um botão: abra a lista filtrada pelo que a barra
contabiliza, ou um único registro no painel lateral.

```tsx
import { useUrlController } from "@rebasepro/cms";
import { BarChart, ChartCard } from "@rebasepro/ui";

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

Um `KpiTile` abre seus registros da mesma maneira. Com `onClick`, o bloco inteiro
é um botão; com `href`, ele é um link, no qual um clique com tecla modificadora abre em uma nova
aba e um clique simples é repassado ao `onClick`, permitindo que o roteador do admin navegue
sem recarregar a página:

```tsx
const pending = `${urls.buildUrlCollectionPath("orders")}?status_op=${encodeURIComponent("==")}&status_value=pending`;

<KpiTile
    label="Pending orders"
    icon="Inbox"
    value={counts?.pending}
    loading={loading}
    href={pending}
    onClick={() => urls.navigate(pending)}
/>
```

Sem nenhum dos dois, o bloco é um cartão simples. Não envolva um bloco em um `<button>`
ou `<a>` próprio: o controle do bloco é identificado por seu rótulo, valor e
variação, e assume o anel de foco (focus ring).

Os gráficos são SVG usando os próprios tokens do admin, em temas claro e escuro, com leitura
ao passar o cursor (hover) e navegação por teclas de seta, além de uma tabela para leitores de tela; nenhuma biblioteca externa de gráficos
é necessária. Para formatos que eles não desenham, qualquer biblioteca de gráficos do React funciona dentro de um
`ChartCard`.

## Próximos Passos

- **[Custom Views](/docs/frontend)** — Visão geral do frontend
- **[Referência de Hooks](/docs/hooks)** — Hooks disponíveis
- **[Slots](/docs/frontend/slots)** — Posicionando os mesmos componentes na página inicial ou acima de uma coleção
