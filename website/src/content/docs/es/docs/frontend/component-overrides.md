---
title: Sustitución de Componentes (Swizzling)
sidebar_label: Sustitución de Componentes
description: Sustituya los componentes de UI predeterminados con implementaciones personalizadas a nivel de aplicación o de colección.
---

## Resumen

Rebase le permite sustituir los componentes de UI predeterminados con sus propias implementaciones personalizadas. Esto implementa un modelo de swizzling de componentes al estilo de Docusaurus que admite dos patrones de personalización:
- **Modo eject** (predeterminado): Su componente reemplaza por completo al integrado.
- **Modo wrap** (`wrap: true`): Su componente envuelve al original. El componente integrado se pasa como la prop `OriginalComponent` para que pueda renderizarlo dentro de su layout/lógica personalizada.

Las sustituciones de componentes pueden aplicarse **globalmente** a nivel de aplicación (en el proveedor `<Rebase>`) o **localmente** a nivel de colección (dentro de las definiciones de colecciones individuales).

---

## Sustituciones Globales de Componentes

Para sustituir componentes globalmente en toda su aplicación, pase un objeto `components` al proveedor raíz `<Rebase>`.

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
                    Component: ({ OriginalComponent, ...props }) => (
                        <div className="login-branding-container">
                            <header className="branding-header">My Custom Brand</header>
                            <OriginalComponent {...props} />
                        </div>
                    ),
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

## Sustituciones de Componentes a Nivel de Colección

Para sustituir componentes solo para una colección específica, añada un objeto `components` a su definición. Esto es útil para personalizar estados vacíos, tarjetas o vistas de detalle para modelos concretos.

```tsx
import { defineCollection } from "@rebasepro/admin-types";
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
                Component: ({ OriginalComponent, ...props }) => (
                    <div className="empty-state-wrapper">
                        <OriginalComponent {...props} />
                        <button onClick={() => importDemoProducts()}>
                            Load Demo Products
                        </button>
                    </div>
                ),
                wrap: true
            }
        }
    }
});

```

---

## Ámbitos de Componentes Sustituibles

### Componentes de Ámbito de App (`AppComponentName`)

Estos componentes solo pueden sustituirse a nivel del proveedor raíz `<Rebase>`, ya que representan la estructura a nivel de shell.

| Clave del Componente | Descripción |
|---|---|
| `"Shell.AppBar"` | La barra de cabecera en la parte superior de la página |
| `"Shell.Drawer"` | El cajón de navegación lateral principal colapsable |
| `"Shell.DrawerNavigationItem"` | Enlaces individuales dentro de la barra lateral |
| `"Shell.DrawerNavigationGroup"` | Cabeceras de grupos de navegación colapsables en la barra lateral |
| `"HomePage"` | La página de inicio predeterminada en modo contenido |
| `"HomePage.CollectionCard"` | Tarjetas de colección individuales en la página de inicio |
| `"Auth.LoginView"` | La superposición mostrada al solicitar autenticación |

### Componentes de Ámbito de Colección (`CollectionComponentName`)

Estos componentes pueden sustituirse globalmente (actuando como valores predeterminados para todas las colecciones) o en colecciones individuales.

| Clave del Componente | Props Originales | Descripción |
|---|---|---|
| `"Collection.View"` | `CollectionViewProps` | La página de inicio completa de la colección |
| `"Collection.Table"` | `CollectionTableProps` | La vista tabular tipo hoja de cálculo predeterminada |
| `"Collection.Card"` | `CollectionCardProps` | El envoltorio del elemento de la vista de tarjeta |
| `"Collection.EmptyState"` | `CollectionEmptyStateProps` | Vista mostrada cuando una colección está vacía |
| `"Collection.Actions"` | `CollectionActionsProps` | Botones de la barra de herramientas sobre la tabla/tarjetas |
| `"Collection.FilterField"` | `FilterFieldBindingProps` | Campo de filtro personalizado para una columna |
| `"Entity.Form"` | `EntityFormProps` | El formulario de detalle para crear/actualizar |
| `"EditView.FormActions"` | `EntityFormActionsProps` | Barra de botones de envío/cancelación del formulario |
| `"DetailView"` | `EntityDetailViewProps` | Vista de detalle de solo lectura |
| `"Entity.SidePanel"` | `EntitySidePanelProps` | El contenedor del panel lateral para formulario/detalle |
| `"EntityPreview"` | `EntityPreviewProps` | Vista previa en línea de chip de referencia/relación |
| `"Entity.MissingReference"` | `MissingReferenceProps` | Se renderiza cuando falta una entidad referenciada |
