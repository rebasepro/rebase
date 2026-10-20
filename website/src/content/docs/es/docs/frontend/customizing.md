---
sourceHash: fb65c481c6cbc87a
title: Personalizar el panel de administración
sidebar_label: Personalizar el panel de administración
description: "Cómo personalizar el panel de administración de Rebase: bloques de construcción, hooks y ubicaciones, con recetas probadas para singletons, configuraciones por usuario, acciones en lote, vistas de calendario, paneles de control y pantallas de inicio de sesión personalizadas."
---

El panel de administración está construido a partir de partes que puedes usar tú mismo. Para personalizarlo, escribes un componente ordinario de React y lo colocas en una ubicación. Ese es todo el modelo:

- **Bloques de construcción** que renderizas: la tabla de una colección, el formulario de un registro, el kit de UI.
- **Hooks** para datos, el usuario autenticado, notificaciones toast y navegación.
- **Ubicaciones** donde colocar un componente: una página, un modo de vista de colección, un botón de barra de herramientas, una pestaña de registro, un campo, un slot junto a una parte integrada o un reemplazo que sustituye a una.

Si un bloque de construcción no hace lo que necesitas, copia su código fuente en tu proyecto y modifícalo. Nada aquí requiere que exista previamente una opción de configuración. Consulta [Copiar una parte integrada](#copiar-una-parte-integrada).

## Recetas

Se incluyen ejemplos funcionales y probados dentro de `@rebasepro/cms`, por lo que los que están en `node_modules/@rebasepro/cms/recipes` siempre coinciden con tu versión instalada. Solo importan paquetes públicos: copia uno en tu proyecto tal cual.

| Receta | Lo que muestra |
|---|---|
| `site-settings.tsx` | Un singleton: un único registro de configuración en su propia página, creado en el primer guardado. |
| `my-preferences.tsx` | Configuración por usuario: cada usuario edita el registro identificado por su uid. |
| `bulk-set-status.tsx` | Un botón de barra de herramientas que actualiza cada fila seleccionada. |
| `calendar-view.tsx` | Un nuevo modo de vista: las filas de una colección en una cuadrícula mensual. |
| `orders-dashboard.tsx` | Una página que lee datos, dibuja un gráfico y enlaza al panel de administración. |
| `custom-login.tsx` | Reemplazo de la pantalla de inicio de sesión. |

El archivo `README.md` junto a ellos es la referencia completa de bloques de construcción, hooks y ubicaciones.

## Ejemplo: un singleton

Un singleton no es un tipo de colección especial. Es una tabla ordinaria cuya página siempre abre la misma fila. Al proporcionarle un id a `EntityFormPanel`, este edita ese registro y lo crea bajo ese id la primera vez, por lo que no es necesario inicializar datos (seeding).

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
            <EntityFormPanel collection={siteSettingsCollection} entityId={"site"}/>
        </Container>
    )
};
```

La misma estructura con `entityId={user.uid}` (de `useAuthController()`) es una página de configuración por usuario.

## Ubicaciones

| Para agregar… | Coloca un componente en |
|---|---|
| Una página | `<RebaseCMS views={[{ slug, name, icon, view }]}>` |
| Un modo de vista para una colección | `collectionViews={[{ key, name, Builder }]}` y `admin.customViews: ["key"]` — consulta [Modos de vista](/docs/frontend/view-modes) |
| Un botón en la barra de herramientas de una colección | `admin.Actions: [Component]` |
| Un botón en un registro | `admin.entityActions` — consulta [Acciones de entidad](/docs/frontend/entity-actions) |
| Una pestaña en un registro | `admin.entityViews` — consulta [Vistas de entidad](/docs/frontend/entity-views) |
| Cómo se edita o muestra un campo | `admin.Field` / `admin.Preview` — consulta [Campos personalizados](/docs/frontend/custom-fields) |
| Algo junto a una parte integrada | `<Rebase slots>` — consulta [Slots](/docs/frontend/slots) |
| Un reemplazo para una parte integrada | `<Rebase components>` — consulta [Reemplazos de componentes](/docs/frontend/component-overrides) |

## Qué recibe tu componente en cada ubicación

| Ubicación | Tu componente recibe |
|---|---|
| Una página (`views`) | Nada: lee lo que necesites con los hooks. Se renderiza dentro del router del panel, así que `useUrlController().navigate(…)` (o `react-router`) funciona. |
| Un `Builder` de modo de vista | `CollectionCustomViewParams`: `collection`, `path`, `tableController` (su `data` son las filas que seleccionan la búsqueda y los filtros de la barra de herramientas, `dataLoading`, …), `onEntityClick(entity)` para abrir una fila como la colección abre las filas, `selectionController`, `emptyComponent`. |
| `admin.Actions` | `CollectionActionsProps`: `path`, `collection`, `selectionController` (`hasSelection`, `selection`, `clearSelection()`), `tableController`, `openNewDocument(defaults?)`. Convierte `selection` en filas con `resolveSelection({ selection, accessor: useData().collection(path) })`: puede representar "todas las filas que coinciden con el filtro", no solo las marcadas. |
| `Builder` de `admin.entityViews` | `EntityCustomViewParams`: `collection`, el registro (`entity`, ausente mientras se crea), sus valores sin guardar (`modifiedValues`) y el formulario (`formContext`). |
| `"Auth.LoginView"` | `{ authController }`. Inicia sesión con `authController.emailPasswordLogin?.(email, password)` (opcional: presente cuando el inicio de sesión por correo está activado); un fallo lanza una excepción y también queda en `authController.authProviderError`. En cuanto `authController.user` tiene valor, el panel sustituye tu pantalla por sí solo. |
| Cualquier otro reemplazo | Las props de la parte que sustituye; con `wrap: true`, esas más `OriginalComponent`. |

## Hooks

| Hook | Paquete | Te proporciona |
|---|---|---|
| `useData` | `@rebasepro/app` | `useData().collection("orders").find / findById / create / update / delete`, a través del servidor, por lo que se aplican callbacks y reglas de seguridad. |
| `useCollection` / `useFetch` | `@rebasepro/app` | Una lista en tiempo real de filas / un registro individual en tiempo real. |
| `useAuthController` | `@rebasepro/app` | El `user` autenticado (uid, roles), inicio de sesión y cierre de sesión. |
| `useSnackbarController` | `@rebasepro/app` | `open({ type, message })` para una notificación toast. |
| `useSidePanel` | `@rebasepro/cms` | Abre cualquier registro en el panel lateral. |
| `useUrlController` | `@rebasepro/cms` | URLs y navegación del panel de administración. |
| `resolveSelection` | `@rebasepro/cms` | Una selección de tabla (filas marcadas o "todas las coincidentes") como filas. |

## Copiar una parte integrada

Cuando una parte integrada se acerca a lo que quieres, copia su código fuente del repositorio de `@rebasepro/cms` (o `@rebasepro/app`) en tu proyecto, apunta sus imports relativos a los paquetes, modifícala y regístrala con su nombre en `<Rebase components>`. Todo lo que importa una parte es una exportación pública, así que la copia compila, en todas las partes salvo tres, y esas tres son deliberadas:

- **`Collection.View`** es la composición de todos los modos de vista (lista, tabla, tarjetas, tablero, dividida) con edición en línea, el editor de campos emergente, el diálogo de borrado y el estado del modo de vista en la URL. Lo que importa son los detalles internos de esos modos. Sustituye en su lugar una de sus partes (`Collection.Table`, `Collection.Card`, `Collection.Actions`, `Collection.EmptyState`, que se pueden copiar), añade un [modo de vista](/docs/frontend/view-modes) propio o envuélvela con `wrap: true`.
- **`DetailView`** es la composición de la vista de un registro: barra de identidad, pestañas, inspector y los botones de la lista dividida, en torno a identificadores de pestaña que son valores de la URL. Personaliza un registro con [vistas de entidad](/docs/frontend/entity-views), [acciones de entidad](/docs/frontend/entity-actions), los [slots](/docs/frontend/slots) `form.*` o los reemplazos `Entity.Form` y `EditView.FormActions`, que se pueden copiar.
- **`HomePage`** se puede copiar salvo por la reordenación de tarjetas y grupos con arrastrar y soltar, que no tiene una API propia que exportar. Una página de inicio propia compone `NavigationGroup`, `NavigationCardBinding` y `FavouritesView` sobre `useNavigationStateController().topLevelNavigation`; para añadir algo a la página estándar, usa el slot `home.cards`.
