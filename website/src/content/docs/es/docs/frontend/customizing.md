---
sourceHash: 31ccfe9d60f8eafe
title: Personalización del Panel de Administración
sidebar_label: Personalización del Panel de Administración
description: Cómo personalizar el panel de administración de Rebase — bloques de construcción, hooks y ubicaciones, con recetas probadas para singletons, configuraciones por usuario, acciones en lote, vistas de calendario, paneles de control y pantallas de inicio de sesión personalizadas.
---

El panel de administración está construido a partir de piezas que tú mismo puedes utilizar. Para personalizarlo, simplemente escribe
un componente común de React y colócalo en una ubicación. Ese es todo el modelo:

- **Bloques de construcción** que renderizas — la tabla de una colección, el formulario de un registro, el kit de interfaz de usuario (UI kit).
- **Hooks** para datos, el usuario autenticado, notificaciones toast y navegación.
- **Ubicaciones** donde colocar un componente — una página, un modo de vista de colección, un botón de barra de herramientas, una pestaña de registro, un campo, un slot junto a una parte integrada, o una anulación (override) que reemplaza a una existente.

Si un bloque de construcción no hace lo que necesitas, copia su código fuente en tu proyecto
y modifícalo — consulta [Copiar una parte integrada](#copiar-una-parte-integrada). Nada
de lo que está aquí necesita que exista previamente una opción de configuración.

## Recetas

Dentro de `@rebasepro/cms` se incluyen ejemplos funcionales y probados, por lo que los que están en
`node_modules/@rebasepro/cms/recipes` siempre coinciden con tu versión instalada. Solo
importan paquetes públicos: copia uno en tu proyecto tal cual.

| Receta | Qué muestra |
|---|---|
| `site-settings.tsx` | Un singleton: un único registro de configuración en su propia página, creado al guardar por primera vez. |
| `my-preferences.tsx` | Configuraciones por usuario: cada usuario edita el registro indexado por su uid. |
| `bulk-set-status.tsx` | Un botón de barra de herramientas que actualiza cada fila seleccionada. |
| `calendar-view.tsx` | Un nuevo modo de vista: las filas de una colección en una cuadrícula mensual. |
| `orders-dashboard.tsx` | Una página que lee datos, dibuja un gráfico y enlaza al panel de administración. |
| `custom-login.tsx` | Reemplazo de la pantalla de inicio de sesión. |

El archivo `README.md` junto a ellos contiene la referencia completa de bloques de construcción, hooks y ubicaciones.

## Ejemplo: un singleton

Un singleton no es un tipo de colección especial. Es una tabla ordinaria cuya página
siempre abre la misma fila. Al pasarle un id, `EntityFormPanel` edita ese registro y
lo crea con ese id la primera vez, por lo que no es necesario sembrar datos iniciales (seeding).

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

La misma estructura con `entityId={user.uid}` (obtenido de `useAuthController()`) se convierte en una
página de configuración por usuario.

<span class="since-badge" data-since="0.29">Desde 0.29</span> Para mostrar solo algunos
de los campos, pasa `fields={["siteName"]}`. Para organizarlos tú mismo, pasa
`layout` con `<FormField name="…"/>` en tu propio JSX. En cualquiera de los casos, el formulario
valida únicamente lo que muestra — consulta
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
| Un reemplazo para una parte integrada | `<Rebase components>` — consulta [Anulaciones de componentes](/docs/frontend/component-overrides) |

## Qué entrega cada ubicación a tu componente

| Ubicación | Tu componente recibe |
|---|---|
| Una página (`views`) | Nada: lee lo que necesites con los hooks. Se renderiza dentro del enrutador del panel de administración, por lo que `useUrlController().navigate(…)` (o `react-router`) funciona. |
| Un `Builder` de modo de vista | `CollectionCustomViewParams`: `collection`, `path`, `tableController` (su propiedad `data` contiene las filas que seleccionan la búsqueda y los filtros de la barra de herramientas, `dataLoading`, …), `onEntityClick(entity)` para abrir una fila de la forma en que la colección abre filas, `selectionController`, `emptyComponent`. |
| `admin.Actions` | `CollectionActionsProps`: `path`, `collection`, `selectionController` (`hasSelection`, `selection`, `clearSelection()`), `tableController`, `openNewDocument(defaults?)`. Convierte `selection` en filas con `resolveSelection({ selection, accessor: useData().collection(path) })` — puede representar "todas las filas que coinciden con el filtro", no solo las marcadas. |
| Un `Builder` de `admin.entityViews` | `EntityCustomViewParams`: `collection`, el registro (`entity`, ausente mientras se está creando), sus valores no guardados (`modifiedValues`) y el formulario (`formContext`). |
| `"Auth.LoginView"` | `{ authController }`. Inicia sesión con `authController.emailPasswordLogin?.(email, password)` (opcional: presente cuando el inicio de sesión por correo electrónico está habilitado); si ocurre un error lanza una excepción y también está disponible en `authController.authProviderError`. Una vez que se establece `authController.user`, el panel de administración reemplaza tu pantalla automáticamente. |
| Cualquier otra anulación | Las props de la parte que reemplaza; con `wrap: true`, esas props más `OriginalComponent`. |

## Hooks

| Hook | Paquete | Te proporciona |
|---|---|---|
| `useData` | `@rebasepro/app` | `useData().collection("orders").find / findById / create / update / delete`, a través del servidor, aplicando callbacks y reglas de seguridad. |
| `useCollection` / `useFetch` | `@rebasepro/app` | Una lista reactiva de filas / un registro reactivo. |
| `useAuthController` | `@rebasepro/app` | El `user` autenticado (uid, roles), inicio y cierre de sesión. |
| `useSnackbarController` | `@rebasepro/app` | `open({ type, message })` para mostrar un toast. |
| `useSidePanel` | `@rebasepro/cms` | Abre cualquier registro en el panel lateral. |
| `useUrlController` | `@rebasepro/cms` | URLs y navegación del panel de administración. |
| `resolveSelection` | `@rebasepro/cms` | Una selección de tabla — filas marcadas o "todas las coincidentes" — en forma de filas. |

## Copiar una parte integrada

Cuando una parte integrada se aproxima a lo que deseas, copia su código fuente desde el
repositorio de `@rebasepro/cms` (o `@rebasepro/app`) a tu proyecto, apunta sus
importaciones relativas a los paquetes, modifícala y regístrala con su nombre en
`<Rebase components>`. Todo lo que importa una parte es una exportación pública, por lo que la copia
compila — para todas las partes excepto tres, y estas tres son deliberadas:

- **`Collection.View`** es la composición de cada modo de vista — lista, tabla,
  tarjetas, tablero, vista dividida — con edición en línea, el editor emergente de campos, el diálogo
  de eliminación y el estado de la URL del modo de vista. Lo que importa son los componentes internos
  de esos modos. En su lugar, reemplaza una de sus partes (`Collection.Table`,
  `Collection.Card`, `Collection.Actions`, `Collection.EmptyState`, las cuales se pueden
  copiar todas), añade un [modo de vista](/docs/frontend/view-modes) propio, o envuélvela
  con `wrap: true`.
- **`DetailView`** es la composición de la vista de registro: barra de identidad, pestañas,
  inspector y los botones de la lista dividida, alrededor de identificadores de pestañas que son valores de la URL.
  Personaliza un registro mediante [vistas de entidad](/docs/frontend/entity-views),
  [acciones de entidad](/docs/frontend/entity-actions), los
  [slots](/docs/frontend/slots) `form.*`, o las anulaciones `Entity.Form` y
  `EditView.FormActions`, las cuales se pueden copiar.
- **`HomePage`** se puede copiar excepto por su reordenamiento de tarjetas y
  grupos mediante arrastrar y soltar (drag-and-drop), el cual no tiene una API propia para exportar. Una página de inicio
  propia compone `NavigationGroup`, `NavigationCardBinding` y `FavouritesView` sobre
  `useNavigationStateController().topLevelNavigation`; para añadir elementos a la estándar,
  utiliza el slot `home.cards`.
