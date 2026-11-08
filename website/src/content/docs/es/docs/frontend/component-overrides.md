---
sourceHash: 5ceaf45e05dbf2b8
title: Sobrescritura de componentes (Swizzling)
sidebar_label: Sobrescritura de componentes
description: Sobrescriba los componentes de interfaz de usuario predeterminados con implementaciones personalizadas a nivel de aplicación o de colección.
---

## Descripción general

Rebase le permite sobrescribir los componentes de interfaz de usuario predeterminados con sus propias implementaciones personalizadas. Esto implementa un modelo de *swizzling* de componentes al estilo de Docusaurus que admite dos patrones de personalización:
- **Modo Eject** (predeterminado): Su componente reemplaza por completo al incorporado.
- **Modo Wrap** (`wrap: true`): Su componente envuelve al original. Lo que envuelve (generalmente el componente incorporado) se pasa como la prop `OriginalComponent` para que pueda renderizarlo dentro de su diseño o lógica personalizada.

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

Para sobrescribir componentes solo para una colección específica, agregue un objeto `components` bajo su bloque `admin`. Esto es útil para personalizar estados vacíos, tarjetas o vistas de detalle para modelos particulares.

En el andamiaje predeterminado, `config/collections/` es cargado **tanto** por el panel de administración como por el backend, el cual lee los mismos archivos para derivar el esquema y la API. Por lo tanto, apunte a cada componente mediante la **ruta del módulo** en lugar de importarlo directamente. `Component` admite las mismas formas que `admin.Field` y `entityViews[].Builder`: una ruta, un `import()` dinámico/perezoso (*lazy*), o el componente en sí.

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

El componente envoltorio reside con el resto de su código frontend y recibe lo que envuelve como `OriginalComponent`: el componente incorporado, a menos que su aplicación también lo sobrescriba (consulte [Cuando ambos ámbitos sobrescriben un componente](#when-both-scopes-override-a-component)):

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

Cada módulo necesita una **exportación predeterminada** (*default export*). El plugin de Vite para colecciones reescribe una ruta en una importación perezosa, de modo que el componente forma su propio fragmento (*chunk*) y se carga la primera vez que se renderiza la sobrescritura. Esa reescritura cubre los archivos dentro del `collectionsDir` configurado. Una ruta en un archivo fuera de él llega a la administración como una cadena sin procesar: la consola lo advertirá y el componente incorporado se renderizará en su lugar. Fuera de `collectionsDir`, escriba la importación perezosa usted mismo: `Component: () => import("../../frontend/src/ProductCustomForm")`.

Una referencia directa (`Component: ProductCustomForm`) también funciona, pero solo en un archivo de colección que nada en el servidor cargue, ya que importar el componente también importa React y todo lo que este arrastra consigo.

### Cuando ambos ámbitos sobrescriben un componente {#when-both-scopes-override-a-component}

En 0.24, el envoltorio de una colección siempre recibe el componente incorporado, y la sobrescritura a nivel de aplicación se omite dentro de esa colección.

Los dos ámbitos se componen. La sobrescritura a nivel de aplicación (`<Rebase components>`) se aplica primero al componente incorporado, y la de la colección (`admin.components`) se aplica al resultado:

| Nivel de aplicación | Nivel de colección | Qué se renderiza dentro de esa colección |
|---|---|---|
| cualquiera | ninguno | lo que se renderiza en cualquier otro lugar: la sobrescritura a nivel de aplicación o el componente incorporado |
| ninguno | wrap | el envoltorio de la colección alrededor del componente incorporado |
| replace o wrap | wrap | el envoltorio de la colección alrededor de la sobrescritura a nivel de aplicación, pasado como `OriginalComponent` |
| cualquiera | replace | solo el componente de la colección; reemplaza a ambos |

De este modo, una colección puede agregar algo alrededor de un componente que su aplicación ya personaliza sin perder esa personalización. Para descartar la versión a nivel de aplicación en una colección, utilice replace en lugar de envolver (wrap).

---

## Ámbitos de componentes sobrescribibles

### Componentes de ámbito de aplicación (`AppComponentName`)

Estos componentes solo se pueden sobrescribir a nivel del proveedor raíz `<Rebase>`, ya que representan la estructura a nivel de shell.

| Clave del componente | Descripción |
|---|---|
| `"Shell.AppBar"` | La barra de encabezado en la parte superior de la página |
| `"Shell.Drawer"` | El panel lateral de navegación principal colapsable |
| `"Shell.DrawerNavigationItem"` | Enlaces individuales dentro de la barra lateral |
| `"Shell.DrawerNavigationGroup"` | Encabezados de grupos de navegación colapsables en la barra lateral |
| `"HomePage"` | La página de inicio predeterminada en modo contenido |
| `"HomePage.CollectionCard"` | Tarjetas de colección individuales en la página de inicio |
| `"Auth.LoginView"` | La superposición mostrada al solicitar autenticación |

### Componentes de ámbito de colección (`CollectionComponentName`)

Estos componentes se pueden sobrescribir globalmente (actuando como valores predeterminados para todas las colecciones) o en colecciones individuales.

| Clave del componente | Descripción |
|---|---|
| `"Collection.View"` | La página de inicio completa de la colección |
| `"Collection.Table"` | La vista tabular de hoja de cálculo predeterminada |
| `"Collection.Card"` | El contenedor de elementos de la vista de tarjetas |
| `"Collection.EmptyState"` | Vista mostrada cuando una colección está vacía |
| `"Collection.Actions"` | Botones de la barra de herramientas sobre la tabla/tarjetas |
| `"Collection.FilterField"` | Entrada de filtro personalizada para una columna |
| `"Entity.Form"` | El formulario de detalle para creación/actualización |
| `"EditView.FormActions"` | Barra de botones de envío/cancelación del formulario |
| `"DetailView"` | Vista de detalle de solo lectura |
| `"Entity.SidePanel"` | El contenedor del panel lateral para formulario/detalle |
| `"EntityPreview"` | Vista previa integrada tipo chip de referencia/relación |
| `"Entity.MissingReference"` | Se renderiza cuando falta una entidad referenciada |

:::note[Tres claves rompen el patrón `Entity.`]
`"DetailView"`, `"EntityPreview"` y `"EditView.FormActions"` no llevan el prefijo `Entity.`. `"Entity.DetailView"`, `"Entity.Preview"` y `"Entity.FormActions"` no forman parte de la unión: generan un error de tipos, y en JavaScript puro la sobrescritura simplemente nunca se aplica.
:::

Su reemplazo recibe las mismas props que se le proporcionaron al componente incorporado. El mapa de sobrescrituras no especifica un tipo de props por clave —`ComponentOverride<P>` establece por defecto `P` como `Record<string, unknown>`— por lo que debe tipar el parámetro usted mismo, o pasar un argumento de tipo, cuando desee verificar las props. Algunos de los componentes incorporados exportan un tipo de props que puede importar y reutilizar: `CollectionViewProps` (`@rebasepro/ui`); `CollectionEmptyStateProps`, `CollectionActionsProps`, `SidePanelBindingProps` y `FilterFieldBindingProps` (`@rebasepro/cms-types`); `EntityFormProps`, `EntityFormBindingProps`, `EntityFormActionsProps`, `CollectionTableBindingProps`, `DetailViewBindingProps`, `DrawerNavigationItemProps` y `DrawerNavigationGroupProps` (`@rebasepro/cms`); `LoginViewProps` (`@rebasepro/app`). El resto no tiene un tipo de props exportado; escriba la estructura que realmente utiliza.

### Lo que debe respetar una sobrescritura de `Collection.View`

`Collection.View` es lo que dibuja un `CollectionPanel`, por lo que las props del panel llegan a su sobrescritura como `CollectionViewBindingProps` (`@rebasepro/cms`), combinadas con las propias de la colección. Un reemplazo que las ignore romperá cada página que inserte la colección. Respete al menos estas:

| Prop | Lo que el llamador espera |
|---|---|
| `collectionOverrides` | Lo que el llamador modifica sobre la colección (un filtro fijo, un ordenamiento, el modo de vista), aplicado sobre la colección registrada |
| `fields` | Solo estas propiedades, en este orden: las columnas y aquello con lo que se completan las filas y tarjetas de la lista |
| `highlightedEntityId` | La fila dibujada como seleccionada; `null` si no hay ninguna |
| `onEntityClick` | Se invoca con la fila pulsada (una `Entity`) en lugar de abrirla. El `onRowClick` del panel llega como esto |

El panel también pasa `viewMode` (el modo en el que abrir), `toolbar` (la barra de herramientas a dibujar, `null` si no hay ninguna) y `title` (`false` para no dibujar título), en caso de que su llamador los haya configurado. El componente incorporado `CollectionViewBinding` maneja todos ellos; una sobrescritura que lo envuelva en lugar de reemplazarlo puede pasarlos directamente.

Para comenzar a partir de la parte incorporada en lugar de empezar desde cero, copie su código fuente en su proyecto y registre la copia aquí: todas las partes, excepto `Collection.View`, `DetailView` y el drag-and-drop de la página de inicio, compilan con importaciones de paquetes. Consulte [Copiar una parte incorporada](/docs/frontend/customizing#copying-a-built-in-part).

## Relacionado

- [Extender Rebase](/docs/frontend/extending/) — los puntos de extensión que no necesitan una sobrescritura
- [Campos personalizados](/docs/frontend/custom-fields/) — cómo reemplazar el editor de una propiedad en lugar de un componente
- [Slots](/docs/frontend/slots/) — cómo agregar contenido a un componente en lugar de reemplazarlo
