---
sourceHash: d60e60304904c8c2
title: "Receta: Dashboard personalizado"
sidebar_label: Dashboard personalizado
description: "Cree una página de dashboard con mosaicos de KPI y gráficos: números calculados en SQL, dibujados con los bloques de @rebasepro/ui."
---

## Visión general

Un dashboard consta de tres partes: una función de backend que calcula los números en
SQL, un componente que los carga con `useInsightData` y los dibuja con los
bloques de `@rebasepro/ui`, y un lugar donde mostrarlo —aquí, una página
propia en el menú lateral (drawer)—.

Calcule en el servidor. Obtener filas en el navegador y sumarlas solo es correcto
mientras la tabla quepa en una sola página de resultados; a partir de ahí, el total
será silenciosamente erróneo.

## Calcular los números en el servidor

Una ruta por cada elemento que dibuja la página, ejecutada como el usuario con sesión
iniciada, para que los permisos y la seguridad a nivel de fila también se apliquen a las cifras:

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

## Dibujarlos

`useInsightData(key, load)` carga una vez por clave y usuario autenticado, y cada
componente que lee la misma clave comparte el resultado. Los bloques dibujan sus
propios estados de carga, error y vacío:

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

Los mismos componentes pueden ubicarse encima de la lista de una colección o en la parte
superior de la página de inicio mediante `<Rebase slots>` —`collection.widgets`,
`home.children.start`— en lugar de tener su propia página.

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

Páselo al controlador de navegación:

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

El dashboard ahora aparece en la barra lateral bajo "Analytics" y es accesible en `/dashboard`.

### Fijar el grupo en la parte inferior

Los grupos llamados `"Admin"` o `"Settings"` se sitúan por debajo de los demás en el menú lateral,
mediante una comparación de cadenas sobre el nombre. Esto es fácil de perder —si traduce la etiqueta,
el ordenamiento dejará de aplicarse silenciosamente—, por lo que es preferible indicarlo de forma explícita:

```tsx
{ slug: "dashboard", name: "Dashboard", view: <DashboardView />, group: "Ajustes", pinToBottom: true }
```

Establecer `pinToBottom` en cualquiera de las vistas de un grupo fija a todo el grupo,
ya que el menú lateral ordena grupos en lugar de vistas individuales.

## Navegar desde una vista personalizada

Un componente de vista no recibe props. Para enrutar a algún lugar —otra vista personalizada, una
colección, una entidad—, utilice `useUrlController`, que se exporta desde
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

Construya la ruta en lugar de escribirla de forma fija (hard-code): las URL de las colecciones
tienen prefijo (`orders` → `/c/orders`) y el prefijo no forma parte del contrato público.

`useSidePanel` abre una entidad en el panel lateral en lugar de navegar, lo que normalmente
es lo que se busca para una fila en una lista.

## Gráficos y cifras que abren sus registros

`BarChart` dibuja categorías en forma de barras con sus valores al lado. Al proporcionar
`onBarClick`, cada fila se convierte en un botón: abra la lista filtrada según lo que
cuenta la barra, o un único registro en el panel lateral.

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

Un `KpiTile` abre sus registros de la misma manera. Al proporcionarle `onClick`, todo el mosaico
es un botón; con `href`, es un enlace, el cual un clic con teclas modificadoras abre en una nueva
pestaña y un clic simple transfiere a `onClick`, de modo que el enrutador del panel de administración
navega sin recargar la página:

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

Sin ninguno de los dos, el mosaico es una simple tarjeta. No envuelva un mosaico en su propio
`<button>` o `<a>`: el control del mosaico se nombra por su etiqueta, cifra y variación,
y toma el anillo de foco.

Los gráficos son SVG basados en los propios tokens del administrador, en modo claro y oscuro,
con lectura al pasar el cursor y mediante teclas de dirección, además de una tabla para lectores
de pantalla; no se requiere ninguna biblioteca de gráficos externa. Para un formato que no dibujen,
cualquier biblioteca de gráficos de React funciona dentro de un `ChartCard`.

## Próximos pasos

- **[Vistas personalizadas](/docs/frontend)** — Información general del frontend
- **[Referencia de hooks](/docs/hooks)** — Hooks disponibles
- **[Slots](/docs/frontend/slots)** — Ubicación de los mismos componentes en la página de inicio o encima de una colección
