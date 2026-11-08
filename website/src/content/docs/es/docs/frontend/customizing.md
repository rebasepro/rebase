---
sourceHash: db22b88374775aed
title: Personalización del Admin
sidebar_label: Personalización del Admin
description: Cómo personalizar el admin de Rebase — bloques de construcción, hooks y ubicaciones, con recetas probadas para singletons, configuraciones por usuario, acciones en lote, vistas de calendario, paneles y pantallas de inicio de sesión personalizadas.
---

El admin está construido a partir de partes que usted mismo puede utilizar. Para personalizarlo, escribe un componente de React común y corriente y lo coloca en una ubicación. Ese es todo el modelo:

- **Bloques de construcción** que usted renderiza — la tabla de una colección, el formulario de un registro, el kit de UI.
- **Hooks** para datos, el usuario autenticado, toasts y navegación.
- **Ubicaciones** donde colocar un componente — una página, un modo de vista de colección, un botón de barra de herramientas, una pestaña de registro, un campo, un slot junto a una parte integrada, o una sustitución (override) que reemplaza a una.

Si un bloque de construcción no hace lo que necesita, copie su código fuente en su proyecto y modifíquelo — consulte [Copiar una parte integrada](#copiar-una-parte-integrada). Nada de lo que se encuentra aquí necesita que exista previamente una opción de configuración.

## Recetas

En `@rebasepro/cms` se incluyen ejemplos funcionales y probados, por lo que los que están en `node_modules/@rebasepro/cms/recipes` siempre coinciden con su versión instalada. Solo importan paquetes públicos: copie uno en su proyecto tal cual.

| Receta | Lo que muestra |
|---|---|
| `site-settings.tsx` | Un singleton: un registro de configuración en su propia página, creado en el primer guardado. |
| `my-preferences.tsx` | Configuraciones por usuario: cada usuario edita el registro identificado por su uid. |
| `bulk-set-status.tsx` | Un botón de barra de herramientas que actualiza cada fila seleccionada. |
| `calendar-view.tsx` | Un nuevo modo de vista: las filas de una colección en una cuadrícula mensual. |
| `orders-dashboard.tsx` | Una página que lee datos, dibuja un gráfico y enlaza al admin. |
| `custom-login.tsx` | Reemplazar la pantalla de inicio de sesión. |

El archivo `README.md` junto a ellos es la referencia completa de bloques de construcción, hooks y ubicaciones.

## Ejemplo: un singleton

Un singleton no es un tipo de colección especial. Es una tabla ordinaria cuya página siempre abre la misma fila. `EntityFormPanel`, al recibir un id, edita ese registro y lo crea bajo ese id la primera vez, por lo que no es necesario inicializar datos (seeding).

```tsx
import React from "react";
import { defineCollection } from "@rebasepro/cms-types";
import type { AppView } from "@rebasepro/cms-types";
import { EntityFormPanel } from "@rebasepro/cms";
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
            <EntityFormPanel collection={siteSettingsCollection} id={"site"}/>
        </Container>
    )
};
```

La misma estructura con `id={user.uid}` (obtenido de `useAuthController()`) es una página de configuración por usuario.

<span class="since-badge" data-since="0.29">Desde 0.29</span> Para mostrar solo algunos de los campos, pase `fields={["siteName"]}`. Para organizarlos usted mismo, pase `layout` con `<FormField name="…"/>` en su propio JSX. En cualquiera de los casos, el formulario solo valida lo que muestra — consulte [Paneles en una página propia](/docs/frontend/panels).

## Ubicaciones

| Para agregar… | Coloque un componente en |
|---|---|
| Una página | `<RebaseCMS views={[{ slug, name, icon, view }]}>` |
| Un modo de vista para una colección | `collectionViews={[{ key, name, Builder }]}` y `admin.customViews: ["key"]` — consulte [Modos de vista](/docs/frontend/view-modes) |
| Un botón en la barra de herramientas de una colección | `admin.Actions: [Component]` |
| Un botón en un registro | `admin.entityActions` — consulte [Acciones de entidad](/docs/frontend/entity-actions) |
| Una pestaña en un registro | `admin.entityViews` — consulte [Vistas de entidad](/docs/frontend/entity-views) |
| Cómo se edita o se muestra un campo | `admin.Field` / `admin.Preview` — consulte [Campos personalizados](/docs/frontend/custom-fields) |
| Algo junto a una parte integrada | `<Rebase slots>` — consulte [Slots](/docs/frontend/slots) |
| Un reemplazo para una parte integrada | `<Rebase components>` — consulte [Sustituciones de componentes](/docs/frontend/component-overrides) |

## Lo que cada ubicación entrega a su componente

| Ubicación | Su componente recibe |
|---|---|
| Una página (`views`) | Nada: lea lo que necesite con los hooks. Se renderiza dentro del router del admin, por lo que `useUrlController().navigate(…)` (o `react-router`) funciona. |
| Un `Builder` de modo de vista | `CollectionCustomViewParams`: `collection`, `path`, `tableController` (sus `rows` son las filas que la búsqueda y los filtros de la barra de herramientas seleccionan, tal como las envía el servidor; `loading`, `error`, …), `onRowClick(row)` para abrir una fila de la forma en que la colección abre filas, `selectionController`, `highlightedIds`, `emptyComponent`. |
| `admin.Actions` | `CollectionActionsProps`: `path`, `collection`, `selectionController` (`hasSelection`, `selection`, `isSelected(id)`, `clearSelection()`), `tableController` (`rows`), `openNewDocument(defaults?)`, `context`. Convierta `selection` en filas con `resolveSelection({ selection, data: context.data, collection })` — puede representar "todas las filas que coinciden con el filtro", no solo las marcadas. |
| Un `Builder` de `admin.entityViews` | `EntityCustomViewParams`: `collection`, el registro (`entity`, ausente mientras se está creando), sus valores no guardados (`modifiedValues`) y el formulario (`formContext`). |
| `"Auth.LoginView"` | `{ authController }`. Inicie sesión con `authController.emailPasswordLogin?.(email, password)` (opcional: presente cuando el inicio de sesión por correo electrónico está habilitado); un fallo lanza un error y también está disponible en `authController.authProviderError`. Una vez que se establece `authController.user`, el admin reemplaza su pantalla automáticamente. |
| Cualquier otra sustitución (override) | Las props de la parte que reemplaza; con `wrap: true`, esas más `OriginalComponent`. |

## Hooks

| Hook | Paquete | Le proporciona |
|---|---|---|
| `useRows` / `useRow` | `@rebasepro/app` | Una lista en vivo de filas / una fila en vivo, tal como las envía el servidor. |
| `useRowWrites` | `@rebasepro/app` | `create / update / remove`, a través del servidor, por lo que se aplican los callbacks y las reglas de seguridad. |
| `useRebaseContext` | `@rebasepro/app` | `context.data.collection("orders").find / findById / create / update / delete`, para código fuera del estado de React; las mismas filas y escrituras que ejecutan los mismos callbacks. |
| `useAuthController` | `@rebasepro/app` | El `user` que ha iniciado sesión (uid, roles), inicio y cierre de sesión. |
| `useSnackbarController` | `@rebasepro/app` | `open({ type, message })` para un toast. |
| `useSidePanel` | `@rebasepro/cms` | Abre cualquier registro en el panel lateral. |
| `useUrlController` | `@rebasepro/cms` | URLs del admin y navegación. |
| `resolveSelection` | `@rebasepro/cms` | Una selección de tabla — filas marcadas o "todas las que coinciden" — como filas: `resolveSelection({ selection, data: context.data, collection })`. |

## Copiar una parte integrada

Cuando una parte integrada se aproxima a lo que necesita, copie su código fuente desde el repositorio `@rebasepro/cms` (o `@rebasepro/app`) en su proyecto, apunte sus importaciones relativas hacia los paquetes, modifíquela y regístrela con su nombre en `<Rebase components>`. Todo lo que importa una parte es una exportación pública, por lo que la copia compila — para cada parte excepto tres, y estas tres son deliberadas:

- **`Collection.View`** es la composición de cada modo de vista — list, table, cards, board, split — con edición en línea, el editor emergente de campos, el cuadro de diálogo de eliminación y el estado de URL del modo de vista. Lo que importa son los componentes internos de esos modos. En su lugar, reemplace una parte de ella (`Collection.Table`, `Collection.Card`, `Collection.Actions`, `Collection.EmptyState`, las cuales se pueden copiar), agregue un [modo de vista](/docs/frontend/view-modes) propio o envuélvala con `wrap: true`.
- **`DetailView`** es la composición de la vista de registro: barra de identidad, pestañas, inspector y los botones de la lista dividida, alrededor de ids de pestañas que son valores de URL. Personalice un registro con [vistas de entidad](/docs/frontend/entity-views), [acciones de entidad](/docs/frontend/entity-actions), los [slots](/docs/frontend/slots) `form.*`, o las sustituciones de `Entity.Form` y `EditView.FormActions`, las cuales se pueden copiar.
- **`HomePage`** se puede copiar excepto por su reordenamiento de tarjetas y grupos mediante arrastrar y soltar (drag-and-drop), que no cuenta con una API propia para exportar. Una página de inicio propia compone `NavigationGroup`, `NavigationCardBinding` y `FavouritesView` sobre `useNavigationStateController().topLevelNavigation`; para agregar elementos a la predeterminada, utilice el slot `home.cards`.
