---
sourceHash: 973d76b134971c29
title: Sobrescritura de componentes (Swizzling)
sidebar_label: Sobrescritura de componentes
description: Sobrescribe componentes de interfaz de usuario predeterminados con implementaciones personalizadas a nivel de aplicación o colección.
---

## Visión general

Rebase te permite sobrescribir los componentes de interfaz de usuario predeterminados con tus propias implementaciones personalizadas. Esto implementa un modelo de "component swizzling" al estilo de Docusaurus que admite dos patrones de personalización:
- **Modo eject** (predeterminado): Tu componente reemplaza por completo al componente integrado.
- **Modo wrap** (`wrap: true`): Tu componente envuelve al original. El componente integrado se pasa como la prop `OriginalComponent` para que puedas renderizarlo dentro de tu estructura/lógica personalizada.

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
                // Modo Eject: Reemplaza por completo el AppBar predeterminado
                "Shell.AppBar": { Component: MyAppBar },

                // Modo Wrap: Envuelve la vista de inicio de sesión para insertar branding
                "Auth.LoginView": {
                    // `OriginalComponent` se inyecta en tiempo de ejecución cuando `wrap: true`; el tipo
                    // del slot de sobrescritura no lo modela, de ahí la anotación.
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

Para sobrescribir componentes únicamente para una colección específica, añade un objeto `components` bajo su bloque `admin`. Esto es útil para personalizar estados vacíos, tarjetas o vistas de detalle para modelos particulares.

<span class="since-badge" data-since="0.22">Desde 0.22</span> En el scaffold predeterminado, `config/collections/` es cargado **tanto** por el panel de administración como por el backend, el cual lee los mismos archivos para derivar el esquema y la API. Por lo tanto, apunta a cada componente mediante una **ruta de módulo** en lugar de importarlo. `Component` admite las mismas formas que `admin.Field` y `entityViews[].Builder`: una ruta, un `import()` perezoso (lazy) o el componente en sí.

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
            // Modo Eject: Reemplaza la vista de formulario de entidad predeterminada
            "Entity.Form": { Component: "../../frontend/src/ProductCustomForm" },

            // Modo Wrap: Envuelve el estado vacío para añadir enlaces rápidos
            "Collection.EmptyState": {
                Component: "../../frontend/src/ProductsEmptyState",
                wrap: true
            }
        }
    }
});
```

El componente contenedor reside con el resto de tu código de frontend, y recibe el componente integrado como `OriginalComponent`:

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

Cada módulo necesita una **exportación por defecto** (default export). El plugin de Vite para colecciones reescribe una ruta convirtiéndola en una importación perezosa (lazy import), de modo que el componente forme su propio chunk y se cargue la primera vez que la sobrescritura se renderice. Dicha reescritura cubre los archivos dentro del `collectionsDir` configurado. Una ruta en un archivo fuera de este llega al admin como una cadena simple: la consola lo advertirá, y el componente integrado se renderizará en su lugar. Fuera de `collectionsDir`, escribe la importación perezosa tú mismo: `Component: () => import("../../frontend/src/ProductCustomForm")`.

Una referencia directa (`Component: ProductCustomForm`) también funciona, pero solo en un archivo de colección que nada en el servidor cargue, ya que importar el componente también importa React y todo lo que este arrastre consigo.

---

## Alcance de los componentes sobrescribibles

### Componentes con alcance de aplicación (`AppComponentName`)

Estos componentes solo pueden sobrescribirse a nivel del proveedor raíz `<Rebase>`, ya que representan la estructura base del shell.

| Clave del componente | Descripción |
|---|---|
| `"Shell.AppBar"` | La barra de cabecera en la parte superior de la página |
| `"Shell.Drawer"` | El menú lateral principal desplegable de navegación |
| `"Shell.DrawerNavigationItem"` | Enlaces individuales dentro de la barra lateral |
| `"Shell.DrawerNavigationGroup"` | Encabezados de grupos de navegación desplegables en la barra lateral |
| `"HomePage"` | La página de inicio predeterminada en modo contenido |
| `"HomePage.CollectionCard"` | Tarjetas de colecciones individuales en la página de inicio |
| `"Auth.LoginView"` | La superposición (overlay) mostrada cuando se solicita autenticación |

### Componentes con alcance de colección (`CollectionComponentName`)

Estos componentes pueden sobrescribirse globalmente (actuando como valores predeterminados para todas las colecciones) o en colecciones individuales.

| Clave del componente | Descripción |
|---|---|
| `"Collection.View"` | La página principal completa de la colección |
| `"Collection.Table"` | La vista tabular predeterminada tipo hoja de cálculo |
| `"Collection.Card"` | El contenedor del elemento en vista de tarjeta |
| `"Collection.EmptyState"` | Vista mostrada cuando una colección está vacía |
| `"Collection.Actions"` | Botones de la barra de herramientas sobre la tabla/tarjetas |
| `"Collection.FilterField"` | Campo de filtro personalizado para una columna |
| `"Entity.Form"` | El formulario de detalle para creación/actualización |
| `"EditView.FormActions"` | Barra de botones para envío/cancelación del formulario |
| `"DetailView"` | Vista de detalle de solo lectura |
| `"Entity.SidePanel"` | El panel lateral contenedor para formulario/detalle |
| `"EntityPreview"` | Vista previa incrustada de referencia/relación en formato chip |
| `"Entity.MissingReference"` | Renderizado cuando falta una entidad referenciada |

:::note[Tres claves rompen el patrón `Entity.`]
`"DetailView"`, `"EntityPreview"` y `"EditView.FormActions"` no llevan el prefijo
`Entity.`. `"Entity.DetailView"`, `"Entity.Preview"` y `"Entity.FormActions"` no
están en la unión: generan un error de tipo, y en JavaScript puro la sobrescritura
simplemente nunca se aplica.
:::

Tu reemplazo recibe las mismas props que se le pasaron al componente integrado. El
mapa de sobrescrituras no define un tipo de props por clave (`ComponentOverride<P>`
asigna por defecto `P` a `Record<string, unknown>`), por lo que debes tipar el
parámetro tú mismo, o pasar un argumento de tipo, cuando desees que las props sean
verificadas. Algunos de los componentes integrados exportan un tipo de props que
puedes importar y reutilizar: `CollectionViewProps` (`@rebasepro/ui`);
`CollectionEmptyStateProps`, `CollectionActionsProps` y
`FilterFieldBindingProps` (`@rebasepro/cms-types`); `EntityFormProps` y
`EntityFormActionsProps` (`@rebasepro/cms`). El resto no tiene un tipo de props
exportado; define la estructura que realmente utilices.

## Relacionado

- [Extender Rebase](/docs/frontend/extending/) — los puntos de extensión que no necesitan una sobrescritura
- [Campos personalizados](/docs/frontend/custom-fields/) — reemplazar el editor de una propiedad en lugar de un componente
- [Slots](/docs/frontend/slots/) — añadir elementos a un componente en lugar de reemplazarlo
