---
sourceHash: f10362389108766c
title: "Recette : Tableau de bord personnalisé"
sidebar_label: Tableau de bord personnalisé
description: "Créer une page de tableau de bord avec des KPI et des graphiques — chiffres calculés en SQL, dessinés avec les briques de @rebasepro/plugin-insights."
---

## Aperçu

Un tableau de bord tient en trois pièces : une fonction backend qui calcule les chiffres en SQL, un composant qui les charge avec `useInsightData` et les dessine avec les briques de `@rebasepro/plugin-insights`, et un endroit où l'afficher — ici, une page à part dans le menu latéral.

Comptez sur le serveur. Charger les lignes dans le navigateur pour les additionner n'est juste que tant que la table tient dans une page de résultats ; au-delà, le total est faux sans prévenir.

## Calculer les chiffres sur le serveur

Une route par élément dessiné, exécutée en tant qu'utilisateur connecté, pour que les permissions et la sécurité au niveau des lignes s'appliquent aussi aux chiffres :

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

## Les dessiner

`useInsightData(key, load)` charge une fois par clé et par utilisateur, et chaque composant qui lit la même clé partage le résultat. Les briques dessinent elles-mêmes leurs états de chargement, d'erreur et vide :

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

Les mêmes composants peuvent aussi se placer au-dessus de la liste d'une collection ou en haut de la page d'accueil via `<Rebase slots>` — `collection.widgets`, `home.children.start` — plutôt que sur une page à part.

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

## Des graphiques qui ouvrent leurs enregistrements

`BarChart` dessine des catégories en barres, avec leur valeur à côté. Avec `onBarClick`, chaque ligne devient un bouton : ouvrez la liste filtrée sur ce que compte la barre, ou un enregistrement dans le panneau latéral.

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

Les graphiques sont en SVG, avec les tokens de l'admin, en clair et en sombre, avec une lecture au survol et aux flèches du clavier, et un tableau pour les lecteurs d'écran ; aucune bibliothèque de graphiques n'est nécessaire. Pour une forme qu'ils ne dessinent pas, n'importe quelle bibliothèque de graphiques React fonctionne dans une `ChartCard`.

## Prochaines étapes

- **[Vues personnalisées](/docs/frontend)** — Aperçu du frontend
- **[Référence des hooks](/docs/hooks)** — Hooks disponibles
- **[Slots](/docs/frontend/slots)** — Placer les mêmes composants sur la page d'accueil ou au-dessus d'une collection
