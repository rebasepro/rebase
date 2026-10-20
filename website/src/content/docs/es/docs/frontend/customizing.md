---
sourceHash: cfdbc982479ba3b1
title: Personalizar el panel de administración
sidebar_label: Personalizar el panel de administración
description: "Cómo personalizar el panel de administración de Rebase: bloques de construcción, hooks y ubicaciones, con recetas probadas para singletons, configuraciones por usuario, acciones en lote, vistas de calendario, paneles de control y pantallas de inicio de sesión personalizadas."
---

El panel de administración está construido a partir de partes que puedes usar tú mismo. Para personalizarlo, escribes un componente ordinario de React y lo colocas en una ubicación. Ese es todo el modelo:

- **Bloques de construcción** que renderizas: la tabla de una colección, el formulario de un registro, el kit de UI.
- **Hooks** para datos, el usuario autenticado, notificaciones toast y navegación.
- **Ubicaciones** donde colocar un componente: una página, un modo de vista de colección, un botón de barra de herramientas, una pestaña de registro, un campo, un slot junto a una parte integrada o un reemplazo que sustituye a una.

Si un bloque de construcción no hace lo que necesitas, copia su código fuente en tu proyecto y modifícalo. Nada aquí requiere que exista previamente una opción de configuración.

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
