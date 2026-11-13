---
sourceHash: b16bc057fd9a76c0
title: Reemplazos de componentes (Swizzling)
sidebar_label: Reemplazos de componentes
description: Sobrescribe componentes de interfaz predeterminados con implementaciones personalizadas a nivel de aplicación o colección.
---

## Descripción general

Rebase te permite sobrescribir los componentes de interfaz de usuario predeterminados con tus propias implementaciones personalizadas. Esto implementa un modelo de swizzling de componentes al estilo de Docusaurus que admite dos patrones de personalización:
- **Modo eject** (predeterminado): Tu componente reemplaza por completo al componente integrado.
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

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Para sobrescribir componentes solo para una tabla, pasa `components` en su
`customizeTable`. Esto es útil para el estado vacío, las tarjetas o el formulario de una
tabla en particular. Cada `Component` es el componente en sí, importado por valor:
el archivo solo se ejecuta en el navegador.

```tsx
// frontend/src/cms/products.tsx
import { customizeTable } from "@rebasepro/cms";
import type { products } from "../../../backend/schema/products";
import { ProductCustomForm } from "../../../../../components/ProductCustomForm";
import { ProductsEmptyState } from "../../../../../components/ProductsEmptyState";

export const productsCms = customizeTable<typeof products>("products", {
    components: {
        // Replace: the product form is drawn by your component alone.
        "Entity.Form": { Component: ProductCustomForm },
        // Wrap: your component receives the original as `OriginalComponent`.
        "Collection.EmptyState": { Component: ProductsEmptyState, wrap: true },
    },
});
```

Un componente contenedor recibe lo que envuelve como `OriginalComponent`: el
componente integrado, a menos que tu aplicación también lo sobrescriba (consulta
[Cuándo ambos alcances sobrescriben un componente](#cuándo-ambos-alcances-sobrescriben-un-componente)):

```tsx
// frontend/src/components/ProductsEmptyState.tsx
import React from "react";

export function ProductsEmptyState({ OriginalComponent, ...props }: {
    OriginalComponent: React.ComponentType<Record<string, unknown>>
}) {
    return (
        <div className="empty-state-wrapper">
            <OriginalComponent {...props} />
            <a href="/docs/import">Import your first products</a>
        </div>
    );
}
```

Una ruta en formato string o un thunk diferido `() => import(…)` en `Component` lanzará un error cuando el
módulo se cargue, indicando qué escribir en su lugar.

### Cuándo ambos alcances sobrescriben un componente

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Los dos alcances se componen. La sobrescritura a nivel de aplicación (`<Rebase components>`) se aplica primero al componente integrado, y la de la tabla (`components` en `customizeTable`) se aplica al resultado:

| Nivel de aplicación | Nivel de colección | Qué se renderiza dentro de esa colección |
|---|---|---|
| cualquiera | ninguno | lo que se renderiza en cualquier otro lugar: la sobrescritura a nivel de aplicación o el componente integrado |
| ninguno | wrap | el wrapper de la colección alrededor del componente integrado |
| replace o wrap | wrap | el wrapper de la colección alrededor de la sobrescritura a nivel de aplicación, pasada como `OriginalComponent` |
| cualquiera | replace | solo el componente de la colección; reemplaza a ambos |

De este modo, una colección puede añadir algo alrededor de un componente que tu aplicación ya personaliza sin perder esa personalización. Para descartar la versión a nivel de aplicación para una sola colección, utiliza replace en lugar de wrap.

---

## Alcances de componentes sobrescribibles

### Componentes con alcance de aplicación (`AppComponentName`)

Estos componentes solo se pueden sobrescribir al nivel del proveedor raíz `<Rebase>`, ya que representan la estructura a nivel de shell.

| Clave del componente | Descripción |
|---|---|
| `"Shell.AppBar"` | La barra de encabezado en la parte superior de la página |
| `"Shell.Drawer"` | El panel lateral de navegación principal colapsable |
| `"Shell.DrawerNavigationItem"` | Enlaces individuales dentro de la barra lateral |
| `"Shell.DrawerNavigationGroup"` | Encabezados colapsables de grupos de navegación en la barra lateral |
| `"HomePage"` | La página de inicio predeterminada en modo contenido |
| `"HomePage.CollectionCard"` | Tarjetas individuales de colección en la página de inicio |
| `"Auth.LoginView"` | La superposición (overlay) mostrada al solicitar autenticación |

### Componentes con alcance de colección (`CollectionComponentName`)

Estos componentes se pueden sobrescribir globalmente (actuando como valores predeterminados para todas las colecciones) o en colecciones individuales.

| Clave del componente | Descripción |
|---|---|
| `"Collection.View"` | La página de destino completa de la colección |
| `"Collection.Table"` | La vista tabular en hoja de cálculo predeterminada |
| `"Collection.Card"` | El contenedor del elemento en la vista de tarjetas |
| `"Collection.EmptyState"` | Vista mostrada cuando una colección está vacía |
| `"Collection.Actions"` | Botones de la barra de herramientas sobre la tabla/tarjetas |
| `"Collection.FilterField"` | Campo de entrada de filtro personalizado para una columna |
| `"Entity.Form"` | El formulario de detalle para creación/actualización |
| `"EditView.FormActions"` | Barra de botones de envío/cancelación del formulario |
| `"DetailView"` | Vista de detalle de solo lectura |
| `"Entity.SidePanel"` | El contenedor del panel lateral para formulario/detalle |
| `"EntityPreview"` | Vista previa en chip de referencia/relación en línea |
| `"Entity.MissingReference"` | Se renderiza cuando falta una entidad referenciada |

:::note[Tres claves no siguen el patrón `Entity.`]
`"DetailView"`, `"EntityPreview"` y `"EditView.FormActions"` no llevan el prefijo
`Entity.`. `"Entity.DetailView"`, `"Entity.Preview"` y `"Entity.FormActions"` no
forman parte de la unión: generarán un error de tipos y, en JavaScript puro, la sobrescritura simplemente
nunca se aplicará.
:::

Tu reemplazo recibe las mismas props que se le pasaron al componente integrado. El
mapa de sobrescritura no define un tipo de props por clave — `ComponentOverride<P>` establece
`P` por defecto como `Record<string, unknown>` — por lo que debes tipar el parámetro tú mismo, o pasar un
argumento de tipo, cuando desees comprobar las props. Algunos de los componentes integrados sí exportan un
tipo de props que puedes importar y reutilizar: `CollectionViewProps` (`@rebasepro/ui`);
`CollectionEmptyStateProps`, `CollectionActionsProps`, `SidePanelBindingProps`
y `FilterFieldBindingProps` (`@rebasepro/cms-types`); `EntityFormProps`,
`EntityFormBindingProps`, `EntityFormActionsProps`, `CollectionTableBindingProps`,
`DetailViewBindingProps`, `DrawerNavigationItemProps` y
`DrawerNavigationGroupProps` (`@rebasepro/cms`); `LoginViewProps`
(`@rebasepro/app`). El resto no tiene un tipo de props exportado: escribe la estructura que
realmente utilizas.

### Lo que debe respetar una sobrescritura de `Collection.View`

`Collection.View` es lo que dibuja un `CollectionPanel`, por lo que las props del panel llegan a
tu sobrescritura como `CollectionViewBindingProps` (`@rebasepro/cms`), propagadas sobre las
propias de la colección. Un reemplazo que las ignore romperá cada página que inserte
la colección. Respeta al menos estas:

| Prop | Lo que espera quien lo llama |
|---|---|
| `collectionOverrides` | Lo que quien lo llama modifica sobre la colección (un filtro fijo, un ordenamiento, el modo de vista), aplicado sobre la colección registrada |
| `fields` | Solo estas propiedades, en este orden: las columnas y los datos con los que se rellenan las filas de lista y tarjetas |
| `highlightedIds` | Los IDs de las filas mostradas como seleccionadas; `[]` para ninguna |
| `onRowClick` | Se llama con la fila cliqueada, tal como la envía el servidor, y su ID, en lugar de abrirla. El propio `onRowClick` del panel |

El panel también pasa `viewMode` (el modo en el que se abrirá), `toolbar` (la barra de herramientas
a renderizar, `null` para ninguna) y `title` (`false` para no renderizar título), según los
haya definido quien lo llama. El componente integrado `CollectionViewBinding` maneja todos ellos; una
sobrescritura que lo envuelva en lugar de reemplazarlo puede pasarlos directamente.

Para comenzar a partir de la parte integrada en lugar de hacerlo desde cero, copia su código fuente en
tu proyecto y registra la copia aquí: todas las partes, excepto `Collection.View`,
`DetailView` y el drag-and-drop de la página de inicio, compilan con las importaciones del paquete.
Consulta [Copiar una parte integrada](/docs/frontend/customizing#copying-a-built-in-part).

## Relacionado

- [Extender Rebase](/docs/frontend/extending/) — los puntos de extensión que no necesitan una sobrescritura
- [Campos personalizados](/docs/frontend/custom-fields/) — reemplazar el editor de una propiedad en lugar de un componente
- [Slots](/docs/frontend/slots/) — añadir elementos a un componente en lugar de reemplazarlo
