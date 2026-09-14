---
sourceHash: 3e8accd144f401d4
title: Sobrescritura de componentes (Swizzling)
sidebar_label: Sobrescritura de componentes
description: Sobrescriba los componentes de interfaz de usuario predeterminados con implementaciones personalizadas a nivel de aplicación o de colección.
---

## Descripción general

Rebase le permite sobrescribir los componentes de interfaz de usuario predeterminados con sus propias implementaciones personalizadas. Esto implementa un modelo de swizzling de componentes al estilo de Docusaurus que admite dos patrones de personalización:
- **Modo eject** (predeterminado): su componente reemplaza por completo al componente integrado.
- **Modo wrap** (`wrap: true`): su componente envuelve al original. El componente integrado se pasa como la prop `OriginalComponent` para que pueda renderizarlo dentro de su diseño o lógica personalizada.

Las sobrescrituras de componentes se pueden aplicar **globalmente** a nivel de aplicación (en el proveedor `<Rebase>`) o **localmente** a nivel de colección (dentro de las definiciones de colección individuales).

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

Para sobrescribir componentes solo para una colección específica, agregue un objeto `components` a su definición. Esto es útil para personalizar estados vacíos, tarjetas o vistas de detalle para modelos particulares.

```tsx
import { defineCollection } from "@rebasepro/cms-types";
import { ProductCustomForm } from "./components/ProductCustomForm";

const productsCollection = defineCollection({
    name: "Products",
    slug: "products",
    table: "products",
    properties: { /* ... */ },
    admin: {
        components: {
            // Eject Mode: Replace the default entity form view
            "Entity.Form": { Component: ProductCustomForm },

            // Wrap Mode: Wrap the empty state to add quick links
            "Collection.EmptyState": {
                // `OriginalComponent` is injected at runtime when `wrap: true`; the override
                    // slot's type does not model it, hence the annotation.
                    Component: (({ OriginalComponent, ...props }: {
                        OriginalComponent: React.ComponentType<Record<string, unknown>>
                    }) => (
                    <div className="empty-state-wrapper">
                        <OriginalComponent {...props} />
                        <button onClick={() => importDemoProducts()}>
                            Load Demo Products
                        </button>
                    </div>
                )) as unknown as React.ComponentType<Record<string, unknown>>,
                wrap: true
            }
        }
    }
});

```

---

## Ámbitos de componentes sobrescribibles

### Componentes de ámbito de aplicación (`AppComponentName`)

Estos componentes solo se pueden sobrescribir a nivel del proveedor raíz `<Rebase>`, ya que representan la estructura a nivel de shell.

| Component Key | Description |
|---|---|
| `"Shell.AppBar"` | La barra de encabezado en la parte superior de la página |
| `"Shell.Drawer"` | El panel de navegación lateral principal plegable |
| `"Shell.DrawerNavigationItem"` | Enlaces individuales dentro de la barra lateral |
| `"Shell.DrawerNavigationGroup"` | Encabezados de grupos de navegación plegables en la barra lateral |
| `"HomePage"` | La página de inicio predeterminada en modo contenido |
| `"HomePage.CollectionCard"` | Tarjetas de colección individuales en la página de inicio |
| `"Auth.LoginView"` | La superposición mostrada al solicitar autenticación |

### Componentes de ámbito de colección (`CollectionComponentName`)

Estos componentes se pueden sobrescribir globalmente (actuando como valores predeterminados para todas las colecciones) o en colecciones individuales.

| Component Key | Description |
|---|---|
| `"Collection.View"` | La página de inicio completa de la colección |
| `"Collection.Table"` | La vista tabular de hoja de cálculo predeterminada |
| `"Collection.Card"` | El contenedor del elemento de vista en tarjeta |
| `"Collection.EmptyState"` | Vista mostrada cuando una colección está vacía |
| `"Collection.Actions"` | Botones de la barra de herramientas sobre la tabla/tarjetas |
| `"Collection.FilterField"` | Entrada de filtro personalizada para una columna |
| `"Entity.Form"` | El formulario de detalle para crear/actualizar |
| `"EditView.FormActions"` | Barra de botones de envío/cancelación de formulario |
| `"DetailView"` | Vista de detalle de solo lectura |
| `"Entity.SidePanel"` | El contenedor del panel lateral para formulario/detalle |
| `"EntityPreview"` | Vista previa en chip de referencia/relación en línea |
| `"Entity.MissingReference"` | Renderizado cuando falta una entidad referenciada |

:::note[Tres claves rompen el patrón `Entity.`]
`"DetailView"`, `"EntityPreview"` y `"EditView.FormActions"` no llevan el prefijo `Entity.`.
`"Entity.DetailView"`, `"Entity.Preview"` y `"Entity.FormActions"` no forman parte de la unión;
producen un error de tipos y, en JavaScript puro, la sobrescritura simplemente nunca se aplica.
:::

Su reemplazo recibe las mismas props que se le proporcionaron al componente integrado. El mapa de sobrescrituras no define un tipo de props por clave (`ComponentOverride<P>` establece `P` de forma predeterminada en `Record<string, unknown>`), por lo que deberá tipar el parámetro usted mismo o pasar un argumento de tipo cuando desee que se verifiquen las props. Algunos de los componentes integrados exportan un tipo de props que puede importar y reutilizar: `CollectionViewProps` (`@rebasepro/ui`); `CollectionEmptyStateProps`, `CollectionActionsProps` y `FilterFieldBindingProps` (`@rebasepro/cms-types`); `EntityFormProps` y `EntityFormActionsProps` (`@rebasepro/cms`). El resto no tiene un tipo de props exportado; escriba la estructura que realmente utilice.

## Relacionado

- [Extender Rebase](/docs/frontend/extending/) — los puntos de extensión que no necesitan una sobrescritura
- [Campos personalizados](/docs/frontend/custom-fields/) — reemplazar el editor de una propiedad en lugar de un componente
- [Slots](/docs/frontend/slots/) — agregar elementos a un componente en lugar de reemplazarlo
