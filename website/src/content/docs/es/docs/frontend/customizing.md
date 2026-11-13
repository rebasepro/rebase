---
sourceHash: 362c7b70fede8ad5
title: Personalizar el Admin
sidebar_label: Personalizar el Admin
description: Cómo personalizar el panel de administración de Rebase — bloques de construcción, hooks y ubicaciones, con recetas probadas para singletons, configuraciones por usuario, acciones en lote, vistas de calendario, paneles de control y pantallas de inicio de sesión personalizadas.
---

<span class="since-badge" data-since="0.31">Desde 0.31</span>

El admin está construido a partir de partes que tú mismo puedes utilizar. Para personalizarlo,
escribes un componente ordinario de React y lo colocas en una ubicación determinada. Ese es todo el modelo:

- **Bloques de construcción** que renderizas: la tabla de una colección, el formulario de un registro, el kit de interfaz de usuario (UI kit).
- **Hooks** para datos, el usuario autenticado, notificaciones toast y navegación.
- **Ubicaciones** donde colocar un componente: una página, un modo de vista, un botón de barra de herramientas, una pestaña de registro, un campo, un slot junto a una parte integrada, o una sustitución (override) que reemplaza a una existente.

Si un bloque de construcción no hace lo que necesitas, copia su código fuente en tu proyecto
y modifícalo; consulta [Copiar una parte integrada](#copiar-una-parte-integrada). Nada
de lo que se muestra aquí requiere que exista previamente una opción de configuración. Las ubicaciones por tabla son
opciones de [`customizeTable`](/docs/frontend/customize-table/).

## Recetas

Se incluyen ejemplos funcionales y probados dentro de `@rebasepro/cms`, por lo que los que están en
`node_modules/@rebasepro/cms/recipes` siempre coinciden con tu versión instalada. Solo
importan paquetes públicos: copia uno en tu proyecto tal cual.

| Receta | Qué muestra |
|---|---|
| `site-settings.tsx` | Un singleton: un único registro de configuración en su propia página, creado en el primer guardado. |
| `my-preferences.tsx` | Configuraciones por usuario: cada usuario edita el registro identificado por su uid. |
| `bulk-set-status.tsx` | Un botón de barra de herramientas que actualiza cada fila seleccionada. |
| `calendar-view.tsx` | Un nuevo modo de vista: las filas de una colección en una cuadrícula mensual. |
| `orders-dashboard.tsx` | Una página que lee datos, dibuja un gráfico y enlaza con el admin. |
| `custom-login.tsx` | Reemplazo de la pantalla de inicio de sesión. |

El archivo `README.md` junto a ellos es la referencia completa de bloques de construcción, hooks y ubicaciones.

## Ejemplo: un singleton

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Un singleton no es un tipo especial de tabla. Es una tabla ordinaria cuya página
siempre abre la misma fila. Al pasarle un id, `RecordForm` edita ese registro y
lo crea bajo ese id la primera vez, por lo que no es necesario inicializar datos (seeding).

```ts
// backend/schema/site_settings.ts: `rebase db push` creates the table.
import { defineTable, col } from "@rebasepro/server/schema";

export const siteSettings = defineTable("site_settings", {
    columns: {
        id:              col.text().primaryKey(),
        siteName:        col.text().notNull(),
        maintenanceMode: col.boolean().notNull().default(false),
    },
    rls: "admin-only",
});
```

```tsx
// frontend/src/cms/site_settings.tsx
import React from "react";
import { customizeTable, RecordForm } from "@rebasepro/cms";
import type { AppView } from "@rebasepro/cms-types";
import { Container, Typography } from "@rebasepro/ui";
import type { siteSettings } from "../../../backend/schema/site_settings";

// Reachable only through the page below, not from the drawer.
export const siteSettingsCms = customizeTable<typeof siteSettings>("site_settings", {
    name: "Site settings",
    hideFromNavigation: true,
    hideIdFromForm: true,
});

// Add to <RebaseCMS views={[siteSettingsView]}>.
export const siteSettingsView: AppView = {
    slug: "settings/site",
    name: "Site settings",
    icon: "Settings",
    view: (
        <Container maxWidth={"3xl"} className={"py-8"}>
            <Typography variant={"h4"} gutterBottom>Site settings</Typography>
            <RecordForm collection={"site_settings"} id={"site"}/>
        </Container>
    )
};
```

La misma estructura con `id={user.uid}` (proveniente de `useAuthController()`) sirve como
página de configuración por usuario.

Para mostrar solo algunos de los
campos, pasa `fields={["siteName"]}`. Para organizarlos tú mismo, pasa
`layout` con elementos `<FormField name="…"/>` en tu propio JSX. De cualquier manera, el formulario
valida únicamente lo que muestra; consulta
[Paneles en tu propia página](/docs/frontend/panels).

## Ubicaciones

<span class="since-badge" data-since="0.31">Desde 0.31</span>

| Para añadir… | Coloca un componente en |
|---|---|
| Una página | `<RebaseCMS views={[{ slug, name, icon, view }]}>` |
| Un modo de vista para una tabla | `customViews` en su `customizeTable`, o `<RebaseCMS collectionViews>` y la clave; consulta [Modos de vista personalizados](/docs/frontend/extending#custom-view-modes) |
| Un botón en la barra de herramientas de una colección | `Actions: [Component]` en `customizeTable` |
| Un botón en un registro | `entityActions` en `customizeTable` — consulta [Acciones de entidad](/docs/frontend/entity-actions) |
| Una pestaña en un registro | `entityViews` en `customizeTable` — consulta [Vistas de entidad](/docs/frontend/entity-views) |
| Cómo se edita o muestra un campo | `Field` / `Preview` en el campo dentro de `customizeTable` — consulta [Campos personalizados](/docs/frontend/custom-fields) |
| Algo junto a una parte integrada | `<Rebase slots>` — consulta [Slots](/docs/frontend/slots) |
| Un reemplazo para una parte integrada | `<Rebase components>` — consulta [Sustituciones de componentes](/docs/frontend/component-overrides) |

## Qué proporciona cada ubicación a tu componente

| Ubicación | Tu componente recibe |
|---|---|
| Una página (`views`) | Nada: lee lo que necesites con los hooks. Se renderiza dentro del router del admin, por lo que `useUrlController().navigate(…)` (o `react-router`) funciona. |
| Un `Builder` de modo de vista | `CollectionCustomViewParams`: `collection`, `path`, `tableController` (sus `rows` son las filas que la búsqueda y los filtros de la barra de herramientas seleccionan, tal como las envía el servidor; `loading`, `error`, …), `onRowClick(row)` para abrir una fila del modo en que la colección abre filas, `selectionController`, `highlightedIds` (ids como strings), `emptyComponent`. |
| `Actions` | `CollectionActionsProps`: `path`, `collection`, `selectionController` (`hasSelection`, `selection`, `isSelected(id)`, `clearSelection()`), `tableController` (`rows`, y sus `ids`), `openNewDocument(defaults?)`, `context`. Convierte `selection` en filas y sus identificadores con `const { rows, ids } = await resolveSelection({ selection, data: context.data, collection })`: puede representar "todas las filas que coinciden con el filtro", no solo las marcadas. |
| `Builder` de `entityViews` | `EntityCustomViewParams`: `collection`, el registro guardado (`row`) y su id (`id`), ambos ausentes mientras se está creando, sus valores no guardados (`modifiedValues`) y el formulario (`formContext`). |
| `"Auth.LoginView"` | `{ authController }`. Inicia sesión con `authController.emailPasswordLogin?.(email, password)` (opcional: presente cuando el inicio de sesión por correo electrónico está habilitado); si falla, lanza un error y también está disponible en `authController.authProviderError`. Una vez establecido `authController.user`, el admin reemplaza tu pantalla automáticamente. |
| Cualquier otro override | Las props de la parte que reemplaza; con `wrap: true`, estas más `OriginalComponent`. |

## Hooks

| Hook | Paquete | Te proporciona |
|---|---|---|
| `useRows` / `useRow` | `@rebasepro/app` | Una lista reactiva de filas / una sola fila reactiva, tal como las envía el servidor. |
| `useRowWrites` | `@rebasepro/app` | `create / update / remove`, a través del servidor, aplicando así los hooks de tabla y la seguridad a nivel de fila (RLS). |
| `useRebaseContext` | `@rebasepro/app` | `context.data.orders.find / findById / create / update / delete`, para código fuera del estado de React; las mismas filas y operaciones de escritura que ejecutan los mismos hooks. |
| `useAuthController` | `@rebasepro/app` | El `user` autenticado (uid, roles), inicio de sesión y cierre de sesión. |
| `useSnackbarController` | `@rebasepro/app` | `open({ type, message })` para una notificación toast. |
| `useSidePanel` | `@rebasepro/cms` | Abre cualquier registro en el panel lateral. |
| `useUrlController` | `@rebasepro/cms` | URLs y navegación del admin. |
| `resolveSelection` | `@rebasepro/cms` | Una selección de tabla (filas marcadas o "todas las coincidentes") como filas y sus identificadores: `const { rows, ids } = await resolveSelection({ selection, data: context.data, collection })`. |

## Copiar una parte integrada

Cuando una parte integrada se aproxima a lo que necesitas, copia su código fuente desde el
repositorio `@rebasepro/cms` (o `@rebasepro/app`) en tu proyecto, redirige sus importaciones
relativas hacia los paquetes, modifícala y regístrala con su nombre en
`<Rebase components>`. Todo lo que importa una parte es una exportación pública, por lo que la copia
compila, para todas las partes excepto tres, y estas tres excepciones son deliberadas:

- **`Collection.View`** es la composición de cada modo de vista (lista, tabla,
  tarjetas, tablero, dividido) con edición en línea, el editor de campos emergente, el cuadro
  de diálogo de eliminación y el estado de URL del modo de vista. Lo que importa son los aspectos
  internos de esos modos. En su lugar, reemplaza una parte de ella (`Collection.Table`,
  `Collection.Card`, `Collection.Actions`, `Collection.EmptyState`, las cuales se pueden copiar),
  añade un [modo de vista](/docs/frontend/view-modes) propio o envuélvela
  con `wrap: true`.
- **`DetailView`** es la composición de la vista de registro: barra de identidad, pestañas,
  inspector y los botones de la lista dividida, alrededor de identificadores de pestañas que son valores de URL.
  Personaliza un registro con [vistas de entidad](/docs/frontend/entity-views),
  [acciones de entidad](/docs/frontend/entity-actions), los
  [slots](/docs/frontend/slots) de `form.*`, o las sustituciones de `Entity.Form` y
  `EditView.FormActions`, las cuales se pueden copiar.
- **`HomePage`** se puede copiar excepto por su reordenamiento de tarjetas y
  grupos mediante arrastrar y soltar (drag-and-drop), el cual no dispone de una API propia para exportar. Una página de inicio propia
  compone `NavigationGroup`, `NavigationCardBinding` y `FavouritesView` sobre
  `useNavigationStateController().topLevelNavigation`; para añadir contenido a la página predeterminada,
  utiliza el slot `home.cards`.
