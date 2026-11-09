---
sourceHash: f28407f4fb9eb7a2
title: Personalizar el admin
sidebar_label: Personalizar el admin
description: Cómo personalizar el admin de Rebase — bloques de construcción, hooks y ubicaciones, con recetas probadas para singletons, configuraciones por usuario, acciones en lote, vistas de calendario, dashboards y pantallas de inicio de sesión personalizadas.
---

El admin está construido a partir de componentes que puedes usar tú mismo. Para
personalizarlo, solo tienes que escribir un componente de React ordinario y colocarlo
en una ubicación. Ese es todo el modelo:

- **Bloques de construcción** que renderizas — la tabla de una colección, el formulario de un registro, el kit de UI.
- **Hooks** para datos, el usuario autenticado, toasts y navegación.
- **Ubicaciones** donde colocar un componente — una página, un modo de vista de colección, un botón de barra de herramientas, una pestaña de registro, un campo, un slot junto a una parte integrada, o una sobrescritura que reemplaza a una existente.

Si un bloque de construcción no hace lo que necesitas, copia su código fuente en tu
proyecto y modifícalo — consulta [Copiar una parte integrada](#copiar-una-parte-integrada).
Nada de lo que se describe aquí necesita que exista previamente una opción de configuración.

## Recetas

Se incluyen ejemplos funcionales y probados dentro de `@rebasepro/cms`, por lo
que los que se encuentran en `node_modules/@rebasepro/cms/recipes` siempre
coinciden con tu versión instalada. Solo importan paquetes públicos: copia uno en
tu proyecto tal cual.

| Receta | Lo que muestra |
|---|---|
| `site-settings.tsx` | Un singleton: un registro de configuración en su propia página, creado en el primer guardado. |
| `my-preferences.tsx` | Configuraciones por usuario: cada usuario edita el registro identificado por su uid. |
| `bulk-set-status.tsx` | Un botón de barra de herramientas que actualiza cada fila seleccionada. |
| `calendar-view.tsx` | Un nuevo modo de vista: las filas de una colección en una cuadrícula mensual. |
| `orders-dashboard.tsx` | Una página que lee datos, dibuja un gráfico y enlaza al admin. |
| `custom-login.tsx` | Reemplazo de la pantalla de inicio de sesión. |

El archivo `README.md` junto a ellos es la referencia completa de bloques de construcción, hooks y ubicaciones.

## Ejemplo: un singleton

Un singleton no es un tipo especial de colección. Es una tabla ordinaria cuya página
siempre abre la misma fila. Al pasarle un id a `RecordForm`, este edita ese registro, y
lo crea con ese id la primera vez, por lo que no es necesario ningún seeding.

```tsx
import React from "react";
import { defineCollection } from "@rebasepro/cms-types";
import type { AppView } from "@rebasepro/cms-types";
import { RecordForm } from "@rebasepro/cms";
import { Container, Typography } from "@rebasepro/ui";

// config/collections/site_settings.ts — `rebase db push` creates the table.
export const siteSettingsCollection = defineCollection({
    name: "Site settings",
    slug: "site_settings",
    table: "site_settings",
    properties: {
        id: { name: "ID", type: "string", isId: true },
        siteName: { name: "Site name", type: "string", validation: { required: true } },
        maintenanceMode: { name: "Maintenance mode", type: "boolean" }
    },
    admin: { hideFromNavigation: true, hideIdFromForm: true }
});

// Add to <RebaseCMS views={[siteSettingsView]}>.
export const siteSettingsView: AppView = {
    slug: "settings/site",
    name: "Site settings",
    icon: "Settings",
    view: (
        <Container maxWidth={"3xl"} className={"py-8"}>
            <Typography variant={"h4"} gutterBottom>Site settings</Typography>
            <RecordForm collection={siteSettingsCollection} id={"site"}/>
        </Container>
    )
};
```

La misma estructura con `id={user.uid}` (obtenido de `useAuthController()`) es una
página de configuración por usuario.

Para mostrar solo algunos de
los campos, pasa `fields={["siteName"]}`. Para organizarlos tú mismo, pasa
`layout` con elementos `<FormField name="…"/>` en tu propio JSX. En cualquiera de los casos,
el formulario valida únicamente lo que muestra — consulta
[Paneles en una página propia](/docs/frontend/panels).

## Ubicaciones

| Para añadir… | Coloca un componente en |
|---|---|
| Una página | `<RebaseCMS views={[{ slug, name, icon, view }]}>` |
| Un modo de vista para una colección | `collectionViews={[{ key, name, Builder }]}` y `admin.customViews: ["key"]` — consulta [Modos de vista](/docs/frontend/view-modes) |
| Un botón en la barra de herramientas de una colección | `admin.Actions: [Component]` |
| Un botón en un registro | `admin.entityActions` — consulta [Acciones de entidad](/docs/frontend/entity-actions) |
| Una pestaña en un registro | `admin.entityViews` — consulta [Vistas de entidad](/docs/frontend/entity-views) |
| Cómo se edita o muestra un campo | `admin.Field` / `admin.Preview` — consulta [Campos personalizados](/docs/frontend/custom-fields) |
| Algo junto a una parte integrada | `<Rebase slots>` — consulta [Slots](/docs/frontend/slots) |
| Un reemplazo para una parte integrada | `<Rebase components>` — consulta [Sobrescritura de componentes](/docs/frontend/component-overrides) |

## Qué le entrega cada ubicación a tu componente

| Ubicación | Tu componente recibe |
|---|---|
| Una página (`views`) | Nada: lee lo que necesites con los hooks. Se renderiza dentro del enrutador del admin, por lo que `useUrlController().navigate(…)` (o `react-router`) funciona. |
| Un `Builder` de modo de vista | `CollectionCustomViewParams`: `collection`, `path`, `tableController` (sus `rows` son las filas que seleccionan la búsqueda y los filtros de la barra de herramientas, tal como las envía el servidor; `loading`, `error`, …), `onRowClick(row)` para abrir una fila del mismo modo en que la colección abre filas, `selectionController`, `highlightedIds` (los id como strings), `emptyComponent`. |
| `admin.Actions` | `CollectionActionsProps`: `path`, `collection`, `selectionController` (`hasSelection`, `selection`, `isSelected(id)`, `clearSelection()`), `tableController` (`rows`, y sus `ids`), `openNewDocument(defaults?)`, `context`. Convierte `selection` en filas y sus ids con `const { rows, ids } = await resolveSelection({ selection, data: context.data, collection })` — puede representar "todas las filas que coinciden con el filtro", no solo las marcadas. |
| `Builder` de `admin.entityViews` | `EntityCustomViewParams`: `collection`, el registro guardado (`row`) y su id (`id`), ambos ausentes mientras se está creando, sus valores no guardados (`modifiedValues`) y el formulario (`formContext`). |
| `"Auth.LoginView"` | `{ authController }`. Inicia sesión con `authController.emailPasswordLogin?.(email, password)` (opcional: presente cuando el inicio de sesión por correo electrónico está habilitado); si ocurre un error, se lanza y también se encuentra en `authController.authProviderError`. Una vez que se define `authController.user`, el admin reemplaza tu pantalla automáticamente. |
| Cualquier otra sobrescritura | Las props de la parte que reemplaza; con `wrap: true`, esas más `OriginalComponent`. |

## Hooks

| Hook | Paquete | Te proporciona |
|---|---|---|
| `useRows` / `useRow` | `@rebasepro/app` | Una lista reactiva de filas / una fila reactiva, tal como las envía el servidor. |
| `useRowWrites` | `@rebasepro/app` | `create / update / remove`, a través del servidor, para que se apliquen los callbacks y las reglas de seguridad. |
| `useRebaseContext` | `@rebasepro/app` | `context.data.collection("orders").find / findById / create / update / delete`, para código fuera del estado de React; las mismas filas y escrituras que ejecutan los mismos callbacks. |
| `useAuthController` | `@rebasepro/app` | El `user` autenticado (uid, roles), inicio y cierre de sesión. |
| `useSnackbarController` | `@rebasepro/app` | `open({ type, message })` para una notificación toast. |
| `useSidePanel` | `@rebasepro/cms` | Abre cualquier registro en el panel lateral. |
| `useUrlController` | `@rebasepro/cms` | URLs del admin y navegación. |
| `resolveSelection` | `@rebasepro/cms` | Una selección de tabla — filas marcadas o "todas las coincidentes" — como filas y sus ids: `const { rows, ids } = await resolveSelection({ selection, data: context.data, collection })`. |

## Copiar una parte integrada

Cuando una parte integrada se aproxima a lo que deseas, copia su código fuente desde
el repositorio de `@rebasepro/cms` (o `@rebasepro/app`) a tu proyecto, redirige sus
importaciones relativas hacia los paquetes, modifícala y regístrala bajo su nombre en
`<Rebase components>`. Todo lo que importa una parte es una exportación pública, por lo
que la copia compila — para todas las partes excepto tres, y las tres excepciones son
intencionales:

- **`Collection.View`** es la composición de cada modo de vista — lista, tabla,
  tarjetas, tablero, dividido — con edición en línea, el editor de campos emergente,
  el diálogo de eliminación y el estado de la URL del modo de vista. Lo que importa
  son los elementos internos de dichos modos. En su lugar, reemplaza una de sus partes
  (`Collection.Table`, `Collection.Card`, `Collection.Actions`, `Collection.EmptyState`,
  las cuales se pueden copiar), añade un [modo de vista](/docs/frontend/view-modes)
  propio o envuélvelo con `wrap: true`.
- **`DetailView`** es la composición de la vista de registro: barra de identidad,
  pestañas, inspector y los botones de la lista dividida, en torno a identificadores de
  pestañas que son valores de URL. Personaliza un registro con
  [vistas de entidad](/docs/frontend/entity-views),
  [acciones de entidad](/docs/frontend/entity-actions), los
  [slots](/docs/frontend/slots) `form.*`, o las sobrescrituras `Entity.Form` y
  `EditView.FormActions`, las cuales se pueden copiar.
- **`HomePage`** se puede copiar excepto por su reordenamiento de tarjetas y
  grupos mediante arrastrar y soltar (drag-and-drop), el cual no cuenta con una API propia
  que exportar. Una página de inicio propia compone `NavigationGroup`,
  `NavigationCardBinding` y `FavouritesView` sobre
  `useNavigationStateController().topLevelNavigation`; para añadir elementos a la
  predeterminada, usa el slot `home.cards`.
