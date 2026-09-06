---
sourceHash: 5de2aebf9af99221
title: Extender Rebase
sidebar_label: Extender Rebase
description: Una guía de decisión para elegir el mecanismo de extensión adecuado — plugins, slots, sustituciones de componentes, vistas de entidad, acciones y más.
---

## Resumen

Rebase ofrece aproximadamente una docena de mecanismos de extensión — plugins, slots, sustituciones de componentes, vistas de entidad, acciones, campos personalizados y más. Cada uno apunta a un ámbito diferente (toda la app, por colección, por entidad, por propiedad) y a una parte diferente de la UI.

Esta guía le ayuda a elegir el mecanismo adecuado para su caso de uso y luego enlaza a la referencia detallada de cada uno.

## Tabla de Decisión

| Quiero… | Mecanismo | Ámbito | Referencia |
|---|---|---|---|
| Reemplazar la barra de app | `components` (`Shell.AppBar`) | app | [Sustitución de Componentes](/docs/frontend/component-overrides) |
| Reemplazar la página de inicio de sesión | `components` (`Auth.LoginView`) | app | [Sustitución de Componentes](/docs/frontend/component-overrides) |
| Reemplazar la página de inicio | `components` (`HomePage`) | app | [Sustitución de Componentes](/docs/frontend/component-overrides) |
| Cambiar por completo cómo se ve el formulario de una colección | `formView` | colección | [abajo](#formview) |
| Intercambiar un componente dentro de una colección | `collection.components` | colección | [Sustitución de Componentes](/docs/frontend/component-overrides) |
| Establecer sustituciones de componentes predeterminadas para todas las colecciones | `components` (nombres de ámbito de colección) | app | [Sustitución de Componentes](/docs/frontend/component-overrides) |
| Añadir un botón a la barra de herramientas de la colección | `Actions` de colección | colección | [Acciones de Entidad](/docs/frontend/entity-actions#collection-actions) |
| Inyectar UI en un slot de la barra de herramientas de la colección | slot `collection.actions` | app/plugin | [Slots](/docs/frontend/slots) |
| Añadir una columna calculada a una tabla | `additionalFields` | colección | [Columnas Adicionales](/docs/frontend/additional-columns) |
| Añadir un widget de campo personalizado para un tipo de propiedad | `propertyConfigs` | tipo de propiedad | [Campos Personalizados](/docs/frontend/custom-fields) |
| Añadir una pestaña de entidad | `entityViews` | entidad | [Vistas de Entidad](/docs/frontend/entity-views) |
| Añadir una acción de fila/contexto o un botón de entidad | `entityActions` | entidad | [Acciones de Entidad](/docs/frontend/entity-actions) |
| Inyectar UI en una ubicación específica del chrome | `slots` | app/plugin | [Slots](/docs/frontend/slots) |
| Distribuir varias extensiones como una unidad instalable | `plugins` | app | [Plugins](/docs/plugins) |

## Mecanismos en Detalle

### Plugins

**Ámbito:** app.

Un plugin agrupa colecciones, vistas, sustituciones de componentes, contribuciones de slots, autenticación, fuentes de datos, proveedores, hooks y callbacks del ciclo de vida en una única unidad instalable. Todos los demás mecanismos enumerados aquí pueden contribuirse a través de la interfaz de un plugin.

→ [Referencia de Plugins](/docs/plugins)

### Slots

**Ámbito:** app (contribuido por slot).

Los slots son puntos de extensión de UI con nombre distribuidos por todo el chrome del CMS. Registra un componente de React apuntando al nombre de un slot, y este se renderiza en esa ubicación. Hay 29 slots que cubren la página de inicio, la navegación, las vistas de colección, los formularios, las filas de entidad, los dashboards y más.

→ [Referencia de Slots](/docs/frontend/slots)

### Sustitución de Componentes (Swizzling)

**Ámbito:** valores predeterminados a nivel de app o por colección.

Dos modos: **Eject** (reemplazo completo) o **Wrap** (aumentar el original).

19 nombres de componentes sustituibles en dos niveles:

**Solo app (7):**
- `Shell.AppBar`
- `Shell.Drawer`
- `Shell.DrawerNavigationItem`
- `Shell.DrawerNavigationGroup`
- `HomePage`
- `HomePage.CollectionCard`
- `Auth.LoginView`

**Ámbito de colección (12):**
- `Collection.View`
- `Collection.Table`
- `Collection.Card`
- `Collection.EmptyState`
- `Collection.Actions`
- `Collection.FilterField`
- `Entity.Form`
- `EditView.FormActions`
- `DetailView`
- `Entity.SidePanel`
- `EntityPreview`
- `Entity.MissingReference`

**Precedencia:** Los `components` a nivel de colección sustituyen a los valores predeterminados a nivel de app para el mismo nombre de componente (spread de objeto simple — los valores de la colección sobrescriben los valores globales). Los nombres de componentes solo de app (`Shell.*`, `HomePage`, `Auth.*`) solo pueden sustituirse a nivel de `<Rebase>`.

→ [Sustitución de Componentes](/docs/frontend/component-overrides)

### Vistas de Entidad

**Ámbito:** entidad (añade pestañas).

Vistas personalizadas que aparecen como pestañas en la página de detalle de la entidad. Pueden definirse globalmente en `<Rebase>` o por colección.

→ [Vistas de Entidad](/docs/frontend/entity-views)

### Acciones de Entidad

**Ámbito:** entidad.

Botones de acción personalizados en entidades individuales (publicar, archivar, clonar, etc.). Pueden definirse globalmente o por colección.

→ [Acciones de Entidad](/docs/frontend/entity-actions)

### `Actions` de Colección

**Ámbito:** colección.

Componentes de React a nivel de barra de herramientas que reciben `CollectionActionsProps` (entidades seleccionadas, controlador de la tabla, contexto de la colección). Se renderizan en la barra de herramientas de la colección junto a las acciones integradas.

**Relación con el slot `collection.actions`:** Ambos son aditivos — los componentes `Actions` se renderizan primero en la barra de herramientas, luego las contribuciones de slot de `collection.actions`. No se reemplazan entre sí.

→ [Acciones de Entidad — Acciones de Colección](/docs/frontend/entity-actions#collection-actions)

### `formView` {#formview}

**Ámbito:** colección.

Reemplaza todo el formulario de entidad predeterminado con un componente personalizado. Se establece en una definición de colección:

```typescript
const collection = {
    slug: "products",
    admin: {
        formView: {
            Builder: MyCustomProductForm,
            includeActions: true  // show save/delete bar (default: true)
        }
    }
};

```

Úselo cuando necesite un layout completamente personalizado para la experiencia de edición de entidades de una colección. Para ajustes menores, prefiera `collection.components` con la sustitución `Entity.Form` en su lugar.

### `additionalFields`

**Ámbito:** colección.

Columnas calculadas/virtuales mostradas en la tabla de la colección. Estas no corresponden a propiedades almacenadas — se calculan en el momento del renderizado.

→ [Columnas Adicionales](/docs/frontend/additional-columns)

### `propertyConfigs`

**Ámbito:** tipo de propiedad.

Widgets de campo personalizados para tipos de propiedad específicos, que proporcionan campos de formulario y componentes de vista previa personalizados.

→ [Campos Personalizados](/docs/frontend/custom-fields)

## Resumen de Precedencia

- **`collection.components` prevalece sobre `components` global** dentro de esa colección (fusión de spread simple en `DataCollectionView`).
- **`Actions` de colección y el slot `collection.actions` son aditivos** — `Actions` se renderizan primero, luego las contribuciones de slot.
- **Los `entityActions` y `entityViews` a nivel de colección extienden (no reemplazan) los globales.**
- **Las contribuciones de plugin se fusionan en orden de `key`.**
