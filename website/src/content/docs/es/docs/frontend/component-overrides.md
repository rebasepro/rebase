---
sourceHash: bad5fe6e295033b6
title: Sobrescritura de componentes (Swizzling)
sidebar_label: Sobrescritura de componentes
description: Sobrescribe componentes de interfaz de usuario predeterminados con implementaciones personalizadas a nivel de aplicación o colección.
---

## Descripción general

Rebase le permite sobrescribir los componentes de interfaz de usuario (UI) predeterminados con sus propias implementaciones personalizadas. Esto implementa un modelo de swizzling de componentes al estilo de Docusaurus que admite dos patrones de personalización:
- **Modo Eject** (predeterminado): Su componente reemplaza por completo al componente integrado.
- **Modo Wrap** (`wrap: true`): Su componente envuelve al original. Lo que envuelve (generalmente el componente integrado) se pasa como la prop `OriginalComponent` para que pueda renderizarlo dentro de su diseño/lógica personalizada.

Para cambiar únicamente la *apariencia* del panel de administración (color, fuentes, esquinas redondeadas, logotipo), no necesita una sobrescritura: consulte [Temas y personalización de marca](/docs/frontend/theming).

Las sobrescrituras de componentes se pueden aplicar **globalmente** a nivel de aplicación (en el proveedor `<Rebase>`) o **localmente** a nivel de colección (dentro de las definiciones de colecciones individuales).

---

## Sobrescrituras globales de componentes

Para sobrescribir componentes globalmente en toda su aplicación, pase un objeto `components` al proveedor raíz `<Rebase>`.

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

Para sobrescribir componentes solo para una tabla, pase `components` en su
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

Un componente envoltorio recibe lo que envuelve como `OriginalComponent`: el
componente integrado, a menos que su aplicación también lo sobrescriba (consulte
[Cuando ambos ámbitos sobrescriben un componente](#cuando-ambos-ámbitos-sobrescriben-un-componente)):

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

Una ruta en cadena de texto o un thunk diferido `() => import(…)` en `Component` generará un error al cargar el módulo, indicando qué escribir en su lugar.

### Cuando ambos ámbitos sobrescriben un componente

Los dos ámbitos se componen. La sobrescritura a nivel de aplicación (`<Rebase components>`) se aplica primero al componente integrado, y la de la tabla (`components` en `customizeTable`) se aplica al resultado:

| Nivel de aplicación | Nivel de colección | Qué se renderiza dentro de esa colección |
|---|---|---|
| cualquiera | ninguno | lo que se renderiza en cualquier otro lugar: la sobrescritura a nivel de aplicación o el componente integrado |
| ninguno | wrap | el envoltorio de la colección alrededor del componente integrado |
| replace o wrap | wrap | el envoltorio de la colección alrededor de la sobrescritura a nivel de aplicación, pasada como `OriginalComponent` |
| cualquiera | replace | solo el componente de la colección; reemplaza a ambos |

De este modo, una colección puede agregar algo alrededor de un componente que su aplicación ya personaliza sin perder esa personalización. Para descartar la versión a nivel de aplicación en una colección específica, use reemplazo (replace) en lugar de envolver (wrap).

---

## Ámbitos de componentes sobrescribibles

### Componentes con ámbito de aplicación (`AppComponentName`)

Estos componentes solo se pueden sobrescribir a nivel del proveedor raíz `<Rebase>`, ya que representan la estructura a nivel de shell.

| Clave del componente | Descripción |
|---|---|
| `"Shell.AppBar"` | La barra de encabezado en la parte superior de la página |
| `"Shell.Drawer"` | El menú lateral desplegable principal de navegación |
| `"Shell.DrawerNavigationItem"` | Enlaces individuales dentro de la barra lateral |
| `"Shell.DrawerNavigationGroup"` | Encabezados de grupos de navegación plegables en la barra lateral |
| `"HomePage"` | La página de inicio predeterminada en modo de contenido |
| `"HomePage.CollectionCard"` | Tarjetas de colección individuales en la página de inicio |
| `"Auth.LoginView"` | La superposición (overlay) mostrada cuando se solicita autenticación |

### Componentes con ámbito de colección (`CollectionComponentName`)

Estos componentes se pueden sobrescribir globalmente (actuando como valores predeterminados para todas las colecciones) o en colecciones individuales.

| Clave del componente | Descripción |
|---|---|
| `"Collection.View"` | La página de inicio completa de la colección |
| `"Collection.Table"` | La vista tabular predeterminada estilo hoja de cálculo |
| `"Collection.Card"` | El contenedor (wrapper) de elementos en la vista de tarjetas |
| `"Collection.EmptyState"` | Vista mostrada cuando una colección está vacía |
| `"Collection.Actions"` | Botones de la barra de herramientas sobre la tabla/tarjetas |
| `"Collection.FilterField"` | Entrada de filtro personalizada para una columna |
| `"Entity.Form"` | El formulario de detalle para creación/actualización |
| `"EditView.FormActions"` | Barra de botones para enviar/cancelar el formulario |
| `"DetailView"` | Vista de detalle de solo lectura |
| `"Entity.SidePanel"` | El contenedor del panel lateral para formulario/detalle |
| `"EntityPreview"` | Vista previa integrada (chip) de referencia/relación |
| `"Entity.MissingReference"` | Se renderiza cuando falta una entidad referenciada |

:::note[Tres claves rompen el patrón `Entity.`]
`"DetailView"`, `"EntityPreview"` y `"EditView.FormActions"` no llevan el prefijo
`Entity.`. `"Entity.DetailView"`, `"Entity.Preview"` y `"Entity.FormActions"` no
forman parte de la unión: generarán un error de tipo en TypeScript, y en JavaScript simple la sobrescritura
simplemente nunca se aplicará.
:::

Su reemplazo recibe las mismas props que se le entregaron al componente integrado. El
mapa de sobrescritura no define un tipo de props por clave (`ComponentOverride<P>` establece
`P` por defecto como `Record<string, unknown>`), por lo que deberá tipar el parámetro usted mismo, o pasar un argumento
de tipo, cuando desee validar las props. Algunos de los componentes integrados sí exportan un
tipo de props que puede importar y reutilizar: `CollectionViewProps` (`@rebasepro/ui`);
`CollectionEmptyStateProps`, `CollectionActionsProps`, `SidePanelBindingProps`
y `FilterFieldBindingProps` (`@rebasepro/cms-types`); `EntityFormProps`,
`EntityFormBindingProps`, `EntityFormActionsProps`, `CollectionTableBindingProps`,
`DetailViewBindingProps`, `DrawerNavigationItemProps` y
`DrawerNavigationGroupProps` (`@rebasepro/cms`); `LoginViewProps`
(`@rebasepro/app`). El resto no tiene un tipo de props exportado: escriba la forma que
realmente lea.

### Lo que debe respetar una sobrescritura de `Collection.View`

`Collection.View` es lo que dibuja un `CollectionPanel`, por lo que las props del panel llegan
a su sobrescritura como `CollectionViewBindingProps` (`@rebasepro/cms`), propagadas sobre las
propias de la colección. Un reemplazo que las ignore romperá cada página que inserte
la colección. Respete al menos estas:

| Prop | Lo que el llamador espera |
|---|---|
| `collectionOverrides` | Lo que el llamador cambia acerca de la colección (un filtro fijo, un ordenamiento, el modo de vista), aplicado sobre la colección registrada |
| `fields` | Solo estas propiedades, en este orden: las columnas y los datos con los que se llenan las filas de listas y tarjetas |
| `highlightedIds` | Los IDs de las filas representadas como seleccionadas; `[]` para ninguno |
| `onRowClick` | Se llama con la fila clickeada, tal como la envía el servidor, y su ID, en lugar de abrirla. Es el propio `onRowClick` del panel |

El panel también pasa `viewMode` (el modo en el que abrir), `toolbar` (la barra de herramientas
a dibujar, `null` para ninguna) y `title` (`false` para no dibujar título), cuando quien
lo invoca los ha definido. El `CollectionViewBinding` integrado maneja todos ellos; una
sobrescritura que lo envuelve en lugar de reemplazarlo puede pasarlos directamente.

Para comenzar desde la parte integrada en lugar de hacerlo desde cero, copie su código fuente en
su proyecto y registre la copia aquí: cada parte, excepto `Collection.View`,
`DetailView` y el arrastrar y soltar (drag-and-drop) de la página de inicio, compila con importaciones de paquetes.
Consulte [Copia de una parte integrada](/docs/frontend/customizing#copying-a-built-in-part).

## Relacionado

- [Temas y personalización de marca](/docs/frontend/theming/) — rediseño del panel de administración con tokens en lugar de componentes
- [Extensión de Rebase](/docs/frontend/extending/) — puntos de extensión que no requieren una sobrescritura
- [Campos personalizados](/docs/frontend/custom-fields/) — reemplazo del editor de una sola propiedad en lugar de un componente
- [Slots](/docs/frontend/slots/) — agregar elementos a un componente en lugar de reemplazarlo
