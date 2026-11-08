---
sourceHash: f17c7d88a5f91dd1
title: Sobrescritura de componentes (Swizzling)
sidebar_label: Sobrescritura de componentes
description: Sobrescribe componentes de la UI por defecto con implementaciones personalizadas a nivel de aplicación o de colección.
---

## Descripción general

Rebase te permite sobrescribir los componentes de la interfaz de usuario (UI) por defecto con tus propias implementaciones personalizadas. Esto implementa un modelo de swizzling de componentes al estilo de Docusaurus que admite dos patrones de personalización:
- **Modo eject** (por defecto): Tu componente reemplaza por completo al componente integrado.
- **Modo wrap** (`wrap: true`): Tu componente envuelve al original. Lo que envuelve (generalmente el componente integrado) se pasa como la prop `OriginalComponent` para que puedas renderizarlo dentro de tu diseño/lógica personalizada.

Las sobrescrituras de componentes se pueden aplicar **globalmente** a nivel de aplicación (en el proveedor `<Rebase>`) o **localmente** a nivel de colección (dentro de las definiciones de colecciones individuales).

---

## Sobrescrituras globales de componentes

Para sobrescribir componentes globalmente en toda tu aplicación, pasa un objeto `components` al proveedor raíz `<Rebase>`.

```tsx
import { Rebase } from "@rebasepro/app";
import { MyAppBar } from "./components/MyAppBar";

function App() {
    return (
        <Rebase
            client={rebaseClient}
            components={{
                // Eject Mode: Replace the default AppBar entirely
                "Shell.AppBar": { Component: MyAppBar },

                // Wrap Mode: Wrap the login view to insert branding
                "Auth.LoginView": {
                    // `OriginalComponent` is injected at runtime when `wrap: true`; the override
                    // slot's type does not model it, hence the annotation.
                    Component: (({ OriginalComponent, ...props }: {
                        OriginalComponent: React.ComponentType<Record<string, unknown>>
                    }) => (
                        <div className="login-branding-container">
                            <header className="branding-header">My Custom Brand</header>
                            <OriginalComponent {...props} />
                        </div>
                    )) as unknown as React.ComponentType<Record<string, unknown>>,
                    wrap: true
                }
            }}
        >
            {/* your app */}
            …
        </Rebase>
    );
}
```

---

## Sobrescrituras de componentes a nivel de colección

Para sobrescribir componentes únicamente en una colección específica, añade un objeto `components` dentro de su bloque `admin`. Esto es útil para personalizar estados vacíos (empty states), tarjetas o vistas de detalle para modelos particulares.

En el scaffold por defecto, `config/collections/` es cargado **tanto** por el panel de administración como por el backend, el cual lee los mismos archivos para derivar el esquema y la API. Por lo tanto, apunta a cada componente mediante una **ruta de módulo** en lugar de importarlo. `Component` adopta las mismas formas que `admin.Field` y `entityViews[].Builder`: una ruta, un `import()` perezoso (lazy), o el componente en sí.

```ts
// config/collections/products.ts
import { defineCollection } from "@rebasepro/cms-types";

export const productsCollection = defineCollection({
    name: "Products",
    slug: "products",
    table: "products",
    properties: { /* ... */ },
    admin: {
        components: {
            // Eject Mode: Replace the default entity form view
            "Entity.Form": { Component: "../../frontend/src/ProductCustomForm" },

            // Wrap Mode: Wrap the empty state to add quick links
            "Collection.EmptyState": {
                Component: "../../frontend/src/ProductsEmptyState",
                wrap: true
            }
        }
    }
});
```

El componente envoltorio vive junto al resto de tu código de frontend y recibe lo que envuelve como `OriginalComponent` —el componente integrado, a menos que tu aplicación también lo sobrescriba (consulta [Cuándo ambos ámbitos sobrescriben un componente](#cuándo-ambos-ámbitos-sobrescriben-un-componente)):

```tsx
// frontend/src/ProductsEmptyState.tsx
import type React from "react";

export default function ProductsEmptyState({ OriginalComponent, ...props }: {
    OriginalComponent: React.ComponentType<Record<string, unknown>>
}) {
    return (
        <div className="empty-state-wrapper">
            <OriginalComponent {...props} />
            <button onClick={() => importDemoProducts()}>
                Load Demo Products
            </button>
        </div>
    );
}
```

Cada módulo necesita un **export por defecto** (`default export`). El plugin de Vite para colecciones reescribe una ruta en una importación perezosa (lazy import), de modo que el componente forme su propio chunk y se cargue la primera vez que se renderice la sobrescritura. Esa reescritura cubre los archivos dentro del `collectionsDir` configurado. Una ruta en un archivo fuera de este llega al administrador como un string literal: la consola lo indicará y el componente integrado se renderizará en su lugar. Fuera de `collectionsDir`, escribe la importación perezosa tú mismo: `Component: () => import("../../frontend/src/ProductCustomForm")`.

Una referencia directa (`Component: ProductCustomForm`) también funciona, pero solo en un archivo de colección que nada en el servidor cargue, ya que importar el componente también importa React y todo lo que este arrastra consigo.

### Cuándo ambos ámbitos sobrescriben un componente

En la versión 0.24, el wrapper de una colección siempre recibe el componente integrado, y la sobrescritura a nivel de aplicación se omite dentro de esa colección.

Los dos ámbitos se componen. La sobrescritura a nivel de aplicación (`<Rebase components>`) se aplica primero al componente integrado, y la de la colección (`admin.components`) se aplica al resultado:

| Nivel de aplicación | Nivel de colección | Lo que se renderiza dentro de esa colección |
|---|---|---|
| cualquiera | ninguno | lo que se renderiza en cualquier otro lugar: la sobrescritura a nivel de aplicación o el componente integrado |
| ninguno | wrap | el wrapper de la colección envolviendo al componente integrado |
| replace o wrap | wrap | el wrapper de la colección envolviendo a la sobrescritura a nivel de aplicación, pasada como `OriginalComponent` |
| cualquiera | replace | el componente de la colección únicamente; reemplaza a ambos |

Por lo tanto, una colección puede añadir algo alrededor de un componente que tu aplicación ya personaliza sin perder esa personalización. Para descartar la versión a nivel de aplicación en una colección específica, reemplaza (replace) en lugar de envolver (wrap).

---

## Ámbitos de los componentes sobrescribibles

### Componentes de ámbito de aplicación (`AppComponentName`)

Estos componentes solo pueden sobrescribirse a nivel del proveedor raíz `<Rebase>`, ya que representan la estructura a nivel de shell.

| Clave del componente | Descripción |
|---|---|
| `"Shell.AppBar"` | La barra de encabezado en la parte superior de la página |
| `"Shell.Drawer"` | El menú lateral desplegable principal de navegación |
| `"Shell.DrawerNavigationItem"` | Enlaces individuales dentro de la barra lateral |
| `"Shell.DrawerNavigationGroup"` | Encabezados de grupos de navegación desplegables en la barra lateral |
| `"HomePage"` | La página de inicio predeterminada en modo contenido |
| `"HomePage.CollectionCard"` | Tarjetas individuales de colección en la página de inicio |
| `"Auth.LoginView"` | La superposición (overlay) mostrada al solicitar autenticación |

### Componentes de ámbito de colección (`CollectionComponentName`)

Estos componentes se pueden sobrescribir globalmente (actuando como predeterminados para todas las colecciones) o en colecciones individuales.

| Clave del componente | Descripción |
|---|---|
| `"Collection.View"` | La página principal completa de la colección |
| `"Collection.Table"` | La vista tabular tipo hoja de cálculo predeterminada |
| `"Collection.Card"` | El contenedor de elemento en vista de tarjeta |
| `"Collection.EmptyState"` | Vista mostrada cuando una colección está vacía |
| `"Collection.Actions"` | Botones de la barra de herramientas sobre la tabla/tarjetas |
| `"Collection.FilterField"` | Entrada de filtro personalizada para una columna |
| `"Entity.Form"` | El formulario de detalle para creación/actualización |
| `"EditView.FormActions"` | Barra de botones para enviar/cancelar el formulario |
| `"DetailView"` | Vista de detalle de solo lectura |
| `"Entity.SidePanel"` | El contenedor del panel lateral para formulario/detalle |
| `"EntityPreview"` | Vista previa tipo chip de referencia/relación en línea |
| `"Entity.MissingReference"` | Se renderiza cuando falta una entidad referenciada |

:::note[Tres claves rompen el patrón `Entity.`]
`"DetailView"`, `"EntityPreview"` y `"EditView.FormActions"` no llevan el prefijo
`Entity.`. `"Entity.DetailView"`, `"Entity.Preview"` y `"Entity.FormActions"` no están
en la unión —provocan un error de tipo y, en JavaScript puro, la sobrescritura simplemente
nunca se aplica.
:::

Tu reemplazo recibe las mismas props que se le entregaron al componente integrado. El
mapa de sobrescrituras no define un tipo de props por clave —`ComponentOverride<P>` asigna a
`P` el valor por defecto `Record<string, unknown>`—, por lo que debes tipar el parámetro tú
mismo o pasar un argumento de tipo cuando desees comprobar las props. Algunos de los componentes
integrados sí exportan un tipo de props que puedes importar y reutilizar: `CollectionViewProps`
(`@rebasepro/ui`); `CollectionEmptyStateProps`, `CollectionActionsProps`, `SidePanelBindingProps`
y `FilterFieldBindingProps` (`@rebasepro/cms-types`); `EntityFormProps`, `EntityFormBindingProps`,
`EntityFormActionsProps`, `CollectionTableBindingProps`, `DetailViewBindingProps`,
`DrawerNavigationItemProps` y `DrawerNavigationGroupProps` (`@rebasepro/cms`); `LoginViewProps`
(`@rebasepro/app`). El resto no tiene un tipo de props exportado: escribe la estructura que
realmente leas.

### Qué debe respetar una sobrescritura de `Collection.View`

`Collection.View` es lo que dibuja un `CollectionPanel`, por lo que las props del panel llegan a
tu sobrescritura como `CollectionViewBindingProps` (`@rebasepro/cms`), propagadas sobre las propias
de la colección. Un reemplazo que las ignore romperá cada página que inserte la colección.
Respeta al menos las siguientes:

| Prop | Lo que el llamador espera |
|---|---|
| `collectionOverrides` | Lo que el llamador modifica sobre la colección (un filtro fijo, un ordenamiento, el modo de visualización), aplicado sobre la colección registrada |
| `fields` | Solo estas propiedades, en este orden: las columnas y aquello con lo que se rellenan las filas de lista y tarjetas |
| `highlightedIds` | Los IDs de las filas dibujadas como seleccionadas; `[]` para ninguna |
| `onRowClick` | Se invoca con la fila pulsada, tal como la envía el servidor, en lugar de abrirla. El propio `onRowClick` del panel |

El panel también pasa `viewMode` (el modo en el que abrir), `toolbar` (la barra de herramientas
a dibujar, `null` para ninguna) y `title` (`false` para no dibujar título), cuando el llamador
los haya configurado. El `CollectionViewBinding` integrado maneja todos ellos; una sobrescritura
que lo envuelva en lugar de reemplazarlo puede pasarlos directamente.

Para comenzar a partir de la parte integrada en lugar de empezar desde cero, copia su código
fuente en tu proyecto y registra la copia aquí: todas las partes, excepto `Collection.View`,
`DetailView` y el drag-and-drop de la página de inicio, compilan con importaciones de paquetes.
Consulta [Copiar una parte integrada](/docs/frontend/customizing#copying-a-built-in-part).

## Relacionado

- [Extender Rebase](/docs/frontend/extending/) — los puntos de extensión que no necesitan una sobrescritura
- [Campos personalizados](/docs/frontend/custom-fields/) — reemplazar el editor de una propiedad en lugar de un componente
- [Slots](/docs/frontend/slots/) — añadir elementos a un componente en lugar de reemplazarlo
