---
sourceHash: 6ad8431f3a96e286
title: Personalizar el panel de administración
sidebar_label: Personalizar el panel de administración
description: "Cómo personalizar el panel de administración de Rebase: bloques de construcción, hooks y ubicaciones, con recetas probadas para singletons, configuraciones por usuario, acciones en lote, vistas de calendario, paneles de control y pantallas de inicio de sesión personalizadas."
---

El panel de administración está construido con partes que usted mismo puede usar. Para personalizarlo, escriba un componente de React común y colóquelo en una ubicación. Ese es todo el modelo:

- **Bloques de construcción** que renderiza: la tabla de una colección, el formulario de un registro, el kit de interfaz de usuario (UI kit).
- **Hooks** para datos, el usuario que ha iniciado sesión, notificaciones (toasts) y navegación.
- **Ubicaciones** donde colocar un componente: una página, un modo de vista de colección, un botón de barra de herramientas, una pestaña de registro, un campo, un slot junto a una parte integrada, o una anulación (override) que reemplaza a una.

Si un bloque de construcción no hace lo que necesita, copie su código fuente en su proyecto y modifíquelo; consulte [Copiar una parte integrada](#copiar-una-parte-integrada). Nada aquí requiere que exista previamente una opción de configuración.

## Recetas

En `@rebasepro/cms` se incluyen ejemplos funcionales y probados, por lo que los que están en `node_modules/@rebasepro/cms/recipes` siempre coinciden con su versión instalada. Solo importan paquetes públicos: copie uno en su proyecto tal cual.

| Receta | Qué muestra |
|---|---|
| `site-settings.tsx` | Un singleton: un único registro de configuración en su propia página, creado en el primer guardado. |
| `my-preferences.tsx` | Configuración por usuario: cada usuario edita el registro indexado por su uid. |
| `bulk-set-status.tsx` | Un botón de barra de herramientas que actualiza cada fila seleccionada. |
| `calendar-view.tsx` | Un nuevo modo de vista: las filas de una colección en una cuadrícula mensual. |
| `orders-dashboard.tsx` | Una página que lee datos, dibuja un gráfico y enlaza al panel de administración. |
| `custom-login.tsx` | Reemplazar la pantalla de inicio de sesión. |

El archivo `README.md` junto a ellos es la referencia completa de bloques de construcción, hooks y ubicaciones.

## Ejemplo: un singleton

Un singleton no es un tipo de colección especial. Es una tabla ordinaria cuya página siempre abre la misma fila. Al pasarle un id a `EntityFormPanel`, este edita ese registro y lo crea bajo ese id la primera vez, por lo que no es necesario realizar ningún seeding.

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

La misma estructura con `id={user.uid}` (de `useAuthController()`) funciona como una página de configuración por usuario.

<span class="since-badge" data-since="0.29">Desde 0.29</span> Para mostrar algunos de los campos, pase `fields={["siteName"]}`. Para organizarlos usted mismo, pase `layout` con `<FormField name="…"/>` en su propio JSX. De cualquier manera, el formulario solo valida lo que muestra; consulte [Paneles en una página propia](/docs/frontend/panels).

## Ubicaciones

| Para añadir… | Coloque un componente en |
|---|---|
| Una página | `<RebaseCMS views={[{ slug, name, icon, view }]}>` |
| Un modo de vista para una colección | `collectionViews={[{ key, name, Builder }]}` y `admin.customViews: ["key"]` — consulte [Modos de vista](/docs/frontend/view-modes) |
| Un botón en la barra de herramientas de una colección | `admin.Actions: [Component]` |
| Un botón en un registro | `admin.entityActions` — consulte [Acciones de entidad](/docs/frontend/entity-actions) |
| Una pestaña en un registro | `admin.entityViews` — consulte [Vistas de entidad](/docs/frontend/entity-views) |
| Cómo se edita o se muestra un campo | `admin.Field` / `admin.Preview` — consulte [Campos personalizados](/docs/frontend/custom-fields) |
| Algo junto a una parte integrada | `<Rebase slots>` — consulte [Slots](/docs/frontend/slots) |
| Un reemplazo para una parte integrada | `<Rebase components>` — consulte [Reemplazos de componentes](/docs/frontend/component-overrides) |

## Qué le entrega cada ubicación a su componente

| Ubicación | Su componente recibe |
|---|---|
| Una página (`views`) | Nada: lea lo que necesite con los hooks. Se renderiza dentro del router del panel de administración, por lo que `useUrlController().navigate(…)` (o `react-router`) funciona. |
| Un `Builder` de modo de vista | `CollectionCustomViewParams`: `collection`, `path`, `tableController` (sus `rows` son las filas que la búsqueda y los filtros de la barra de herramientas seleccionan, tal como las envía el servidor; `loading`, `error`, …), `onRowClick(row)` para abrir una fila del modo en que la colección abre las filas, `selectionController`, `highlightedIds` (ids como strings), `emptyComponent`. |
| `admin.Actions` | `CollectionActionsProps`: `path`, `collection`, `selectionController` (`hasSelection`, `selection`, `isSelected(id)`, `clearSelection()`), `tableController` (`rows` y sus `ids`), `openNewDocument(defaults?)`, `context`. Convierta `selection` en filas y sus ids con `const { rows, ids } = await resolveSelection({ selection, data: context.data, collection })`; puede representar "todas las filas que coinciden con el filtro", no solo las marcadas. |
| `admin.entityViews` `Builder` | `EntityCustomViewParams`: `collection`, el registro guardado (`row`) y su id (`id`), ambos ausentes mientras se está creando, sus valores no guardados (`modifiedValues`) y el formulario (`formContext`). |
| `"Auth.LoginView"` | `{ authController }`. Inicie sesión con `authController.emailPasswordLogin?.(email, password)` (opcional: presente cuando el inicio de sesión por correo electrónico está habilitado); un fallo lanza un error y también está disponible en `authController.authProviderError`. Una vez que `authController.user` está establecido, el panel de administración reemplaza su pantalla automáticamente. |
| Cualquier otro override | Las props de la parte que reemplaza; con `wrap: true`, esas más `OriginalComponent`. |

## Hooks

| Hook | Paquete | Le proporciona |
|---|---|---|
| `useRows` / `useRow` | `@rebasepro/app` | Una lista de filas en tiempo real / una fila en tiempo real, tal como las envía el servidor. |
| `useRowWrites` | `@rebasepro/app` | `create / update / remove`, a través del servidor, por lo que se aplican los callbacks y las reglas de seguridad. |
| `useRebaseContext` | `@rebasepro/app` | `context.data.collection("orders").find / findById / create / update / delete`, para código fuera del estado de React; las mismas filas y operaciones de escritura que ejecutan los mismos callbacks. |
| `useAuthController` | `@rebasepro/app` | El `user` que ha iniciado sesión (uid, roles), inicio y cierre de sesión. |
| `useSnackbarController` | `@rebasepro/app` | `open({ type, message })` para una notificación (toast). |
| `useSidePanel` | `@rebasepro/cms` | Abre cualquier registro en el panel lateral. |
| `useUrlController` | `@rebasepro/cms` | URLs y navegación del panel de administración. |
| `resolveSelection` | `@rebasepro/cms` | Una selección de tabla (filas marcadas o "todas las coincidentes") como filas y sus ids: `const { rows, ids } = await resolveSelection({ selection, data: context.data, collection })`. |

## Copiar una parte integrada

Cuando una parte integrada se acerca a lo que desea, copie su código fuente desde el repositorio de `@rebasepro/cms` (o `@rebasepro/app`) en su proyecto, apunte sus importaciones relativas a los paquetes, modifíquela y regístrela con su nombre en `<Rebase components>`. Todo lo que importa una parte es una exportación pública, por lo que la copia compila, para todas las partes excepto tres, y esas tres son deliberadas:

- **`Collection.View`** es la composición de cada modo de vista (lista, tabla, tarjetas, tablero, dividido) con edición en línea, el editor de campos emergente, el cuadro de diálogo de eliminación y el estado de URL del modo de vista. Lo que importa son los aspectos internos de esos modos. En su lugar, reemplace una parte (`Collection.Table`, `Collection.Card`, `Collection.Actions`, `Collection.EmptyState`, todas las cuales se pueden copiar), añada un [modo de vista](/docs/frontend/view-modes) propio o envuélvalo con `wrap: true`.
- **`DetailView`** es la composición de la vista de registro: barra de identidad, pestañas, inspector y los botones de la lista dividida, en torno a IDs de pestañas que son valores de URL. Personalice un registro con [vistas de entidad](/docs/frontend/entity-views), [acciones de entidad](/docs/frontend/entity-actions), los [slots](/docs/frontend/slots) `form.*` o los reemplazos `Entity.Form` y `EditView.FormActions`, que se pueden copiar.
- **`HomePage`** se puede copiar excepto por su reordenamiento de tarjetas y grupos mediante arrastrar y soltar (drag-and-drop), el cual no tiene una API propia para exportar. Una página de inicio propia compone `NavigationGroup`, `NavigationCardBinding` y `FavouritesView` sobre `useNavigationStateController().topLevelNavigation`; para añadir contenido a la página predeterminada, use el slot `home.cards`.
