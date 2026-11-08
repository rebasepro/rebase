---
sourceHash: 71362fa8c8eb7f20
title: Sobrescrituras de componentes (Swizzling)
sidebar_label: Sobrescrituras de componentes
description: Sobrescribe componentes de interfaz de usuario predeterminados con implementaciones personalizadas a nivel de aplicación o de colección.
---

## Descripción general

Rebase permite sobrescribir los componentes de interfaz de usuario predeterminados con tus propias implementaciones personalizadas. Esto implementa un modelo de swizzling de componentes al estilo de Docusaurus que admite dos patrones de personalización:
- **Modo Eject** (predeterminado): Tu componente reemplaza por completo al incorporado.
- **Modo Wrap** (`wrap: true`): Tu componente envuelve al original. Lo que envuelve (generalmente el componente incorporado) se pasa como la prop `OriginalComponent` para que puedas renderizarlo dentro de tu diseño/lógica personalizada.

Las sobrescrituras de componentes se pueden aplicar de forma **global** a nivel de aplicación (en el proveedor `<Rebase>`) o de forma **local** a nivel de colección (dentro de las definiciones de colecciones individuales).

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

Para sobrescribir componentes solo para una colección específica, agrega un objeto `components` bajo su bloque `admin`. Esto resulta útil para personalizar estados vacíos, tarjetas o vistas de detalle para modelos particulares.

En el scaffold predeterminado, `config/collections/` es cargado **tanto** por el panel de administración como por el backend, el cual lee los mismos archivos para derivar el esquema y la API. Por lo tanto, apunta a cada componente mediante una **ruta de módulo** en lugar de importarlo. `Component` admite los mismos formatos que `admin.Field` y `entityViews[].Builder`: una ruta, un `import()` perezoso (lazy) o el componente en sí.

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

El componente envoltorio reside junto con el resto de tu código frontend y recibe lo que envuelve como `OriginalComponent`, es decir, el componente incorporado, a menos que tu aplicación también lo sobrescriba (consulta [Cuándo ambos ámbitos sobrescriben un componente](#cuándo-ambos-ámbitos-sobrescriben-un-componente)):

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

Cada módulo necesita una **exportación por defecto** (default export). El plugin de Vite de colecciones reescribe una ruta en una importación perezosa (lazy import), de modo que el componente constituya su propio chunk y se cargue la primera vez que se renderice la sobrescritura. Esa reescritura cubre los archivos dentro del `collectionsDir` configurado. Una ruta en un archivo fuera de él llega al admin como un string simple: la consola lo advierte y el componente incorporado se renderiza en su lugar. Fuera de `collectionsDir`, escribe la importación perezosa tú mismo: `Component: () => import("../../frontend/src/ProductCustomForm")`.

Una referencia directa (`Component: ProductCustomForm`) también funciona, pero solo en un archivo de colección que nada en el servidor cargue, ya que importar el componente también importa React y todo lo que este arrastra.

### Cuándo ambos ámbitos sobrescriben un componente

En 0.24, el contenedor (wrapper) de una colección siempre recibe el componente incorporado, y la sobrescritura a nivel de aplicación se omite dentro de esa colección.

Los dos ámbitos se componen. La sobrescritura a nivel de aplicación (`<Rebase components>`) se aplica primero al componente incorporado, y la de la colección (`admin.components`) se aplica al resultado:

| Nivel de aplicación | Nivel de colección | Qué se renderiza dentro de esa colección |
|---|---|---|
| cualquiera | ninguno | lo que se renderiza en cualquier otro lugar: la sobrescritura a nivel de aplicación o el componente incorporado |
| ninguno | wrap | el wrapper de la colección alrededor del componente incorporado |
| replace o wrap | wrap | el wrapper de la colección alrededor de la sobrescritura a nivel de aplicación, pasado como `OriginalComponent` |
| cualquiera | replace | solo el componente de la colección; reemplaza a ambos |

De este modo, una colección puede añadir algo alrededor de un componente que tu aplicación ya personaliza sin perder esa personalización. Para descartar la versión a nivel de aplicación en una colección, reemplázala en lugar de envolverla.

---

## Ámbitos de los componentes sobrescribibles

### Componentes con ámbito de aplicación (`AppComponentName`)

Estos componentes solo se pueden sobrescribir a nivel del proveedor raíz `<Rebase>`, ya que representan la estructura a nivel de shell.

| Component Key | Descripción |
|---|---|
| `"Shell.AppBar"` | La barra de encabezado en la parte superior de la página |
| `"Shell.Drawer"` | El menú lateral principal desplegable de navegación |
| `"Shell.DrawerNavigationItem"` | Enlaces individuales dentro de la barra lateral |
| `"Shell.DrawerNavigationGroup"` | Encabezados de grupos de navegación desplegables en la barra lateral |
| `"HomePage"` | La página de inicio predeterminada en modo de contenido |
| `"HomePage.CollectionCard"` | Tarjetas de colección individuales en la página de inicio |
| `"Auth.LoginView"` | La superposición que se muestra al solicitar autenticación |

### Componentes con ámbito de colección (`CollectionComponentName`)

Estos componentes se pueden sobrescribir globalmente (actuando como valores predeterminados para todas las colecciones) o en colecciones individuales.

| Component Key | Descripción |
|---|---|
| `"Collection.View"` | La página principal completa de la colección |
| `"Collection.Table"` | La vista tabular predeterminada estilo hoja de cálculo |
| `"Collection.Card"` | El contenedor de elementos de la vista en tarjetas |
| `"Collection.EmptyState"` | Vista mostrada cuando una colección está vacía |
| `"Collection.Actions"` | Botones de la barra de herramientas sobre la tabla/tarjetas |
| `"Collection.FilterField"` | Campo de entrada de filtro personalizado para una columna |
| `"Entity.Form"` | El formulario de detalle para creación/actualización |
| `"EditView.FormActions"` | Barra de botones para enviar/cancelar del formulario |
| `"DetailView"` | Vista de detalle de solo lectura |
| `"Entity.SidePanel"` | El contenedor del panel lateral para formulario/detalle |
| `"EntityPreview"` | Vista previa en chip para referencias/relaciones en línea |
| `"Entity.MissingReference"` | Se renderiza cuando falta una entidad referenciada |

:::note[Tres claves rompen el patrón `Entity.`]
`"DetailView"`, `"EntityPreview"` y `"EditView.FormActions"` no llevan el prefijo `Entity.`. `"Entity.DetailView"`, `"Entity.Preview"` y `"Entity.FormActions"` no forman parte de la unión: generan un error de tipos y, en JavaScript puro, la sobrescritura simplemente nunca se aplica.
:::

Tu reemplazo recibe las mismas props que se le entregaron al componente incorporado. El mapa de sobrescrituras no define un tipo de props por clave —`ComponentOverride<P>` establece por defecto `P` como `Record<string, unknown>`—, así que tipa el parámetro tú mismo o pasa un argumento de tipo cuando desees comprobar las props. Algunos de los componentes incorporados sí exportan un tipo de props que puedes importar y reutilizar: `CollectionViewProps` (`@rebasepro/ui`); `CollectionEmptyStateProps`, `CollectionActionsProps`, `SidePanelBindingProps` y `FilterFieldBindingProps` (`@rebasepro/cms-types`); `EntityFormProps`, `EntityFormBindingProps`, `EntityFormActionsProps`, `CollectionTableBindingProps`, `DetailViewBindingProps`, `DrawerNavigationItemProps` y `DrawerNavigationGroupProps` (`@rebasepro/cms`); `LoginViewProps` (`@rebasepro/app`). El resto no tiene un tipo de props exportado: escribe la estructura que realmente vayas a leer.

### Lo que debe respetar una sobrescritura de `Collection.View`

`Collection.View` es lo que dibuja un `CollectionPanel`, por lo que las props del panel llegan a tu sobrescritura como `CollectionViewBindingProps` (`@rebasepro/cms`), propagadas sobre las propias de la colección. Un reemplazo que las ignore romperá cada página que incruste la colección. Respeta al menos las siguientes:

| Prop | Lo que el invocador espera |
|---|---|
| `collectionOverrides` | Lo que el invocador modifica sobre la colección (un filtro fijo, un ordenamiento, el modo de vista), aplicado sobre la colección registrada |
| `fields` | Solo estas propiedades, en este orden: las columnas y aquello con lo que se completan las filas y tarjetas de la lista |
| `highlightedIds` | Los IDs de las filas dibujadas como seleccionadas; `[]` si no hay ninguna |
| `onRowClick` | Se invoca con la fila pulsada, tal como la envía el servidor, y su ID, en lugar de abrirla. Es el propio `onRowClick` del panel |

El panel también pasa `viewMode` (el modo en el que se abre), `toolbar` (la barra de herramientas a dibujar, `null` si no hay ninguna) y `title` (`false` para no dibujar título), cuando el invocador los haya definido. El `CollectionViewBinding` incorporado los gestiona todos; una sobrescritura que lo envuelva en lugar de reemplazarlo puede pasarlos directamente.

Para comenzar a partir de la parte incorporada en lugar de empezar desde cero, copia su código fuente en tu proyecto y registra la copia aquí: todas las partes, excepto `Collection.View`, `DetailView` y el drag-and-drop de la página de inicio, compilan con importaciones de paquetes. Consulta [Copiar una parte incorporada](/docs/frontend/customizing#copying-a-built-in-part).

## Relacionado

- [Extender Rebase](/docs/frontend/extending/) — los puntos de extensión que no necesitan una sobrescritura
- [Campos personalizados](/docs/frontend/custom-fields/) — reemplazar el editor de una propiedad en lugar de un componente
- [Slots](/docs/frontend/slots/) — agregar contenido a un componente en lugar de reemplazarlo
