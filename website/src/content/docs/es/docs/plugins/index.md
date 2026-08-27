---
title: Sistema de Plugins
sidebar_label: Plugins
description: Extiende Rebase con plugins — inyecta componentes de UI, modifica colecciones, añade acciones a la barra de herramientas y crea constructores de campos personalizados.
---

## Resumen

Los plugins son el mecanismo de extensión principal en Rebase. Pueden:

- Envolver toda la aplicación con un **proveedor** (contexto, gestión de estado)
- Añadir **acciones y widgets a la página de inicio**
- Inyectar componentes de la **vista de colección** (barra de herramientas, constructores de columnas)
- Añadir componentes de **formulario** (constructores de campos, paneles adicionales)
- **Inyectar o modificar colecciones** dinámicamente

## Interfaz del Plugin

```typescript
interface RebasePlugin {
    key: string;                    // Unique identifier
    loading?: boolean;              // Show loading state while initializing

    // Wrap the app with a provider
    provider?: {
        Component: React.ComponentType;
    };

    // Home page customization
    homePage?: {
        additionalActions?: React.ReactNode;
        additionalChildrenStart?: React.ReactNode;
        additionalChildrenEnd?: React.ReactNode;
    };

    // Collection view customization
    collectionView?: {
        showTextSearchBar?: boolean;
        CollectionActions?: React.ComponentType[];
        AddColumnComponent?: React.ComponentType;
        onCellValueChange?: (params) => void;
    };

    // Entity form customization
    form?: {
        Actions?: React.ComponentType;
        provider?: { Component: React.ComponentType };
        fieldBuilder?: (params) => React.ReactNode | null;
    };

    // Collection injection/modification
    collection?: {
        injectCollections?: (params) => CollectionConfig[];
        modifyCollection?: (params) => CollectionConfig;
    };
}
```

## Uso de Plugins

Pasa las instancias de los plugins al controlador de navegación:

```typescript
const dataEnhancementPlugin = useDataEnhancementPlugin();

const plugins = [dataEnhancementPlugin];

const navigationStateController = useBuildNavigationStateController({
    plugins,
    collections: () => collections,
    // ...
});
```

## Construyendo un Plugin

Aquí tienes un plugin mínimo que añade una acción a la barra de herramientas de cada colección:

```tsx
import type { RebasePlugin } from "@rebasepro/cms-types";

function useMyPlugin(): RebasePlugin {
    return {
        key: "my_plugin",

        slots: {
            CollectionActions: [MyToolbarAction]
        },

        form: {
            fieldBuilder: ({ property, ...rest }) => {
                // Return a custom field for specific property configs
                if (property.propertyConfig === "my_custom_field") {
                    return <MyCustomField {...rest} />;
                }
                return null; // Use default field
            }
        }
    };
}
```

## Plugins Integrados

### Plugin de Mejora de Datos

Autocompletado de campos impulsado por IA:

```typescript
import { useDataEnhancementPlugin } from "@rebasepro/plugin-ai";

const enhancementPlugin = useDataEnhancementPlugin();
```

![Mejora de datos](/img/data_enhancement.png)

## Inyección de Colecciones

Los plugins pueden añadir nuevas colecciones dinámicamente:

```typescript
collection: {
    injectCollections: ({ collections, user }) => {
        // Add an audit log collection for admins
        if (user?.roles?.includes("admin")) {
            return [auditLogCollection];
        }
        return [];
    }
}
```

## Modificación de Colecciones

Los plugins pueden modificar colecciones existentes:

```typescript
collection: {
    modifyCollection: ({ collection }) => {
        // Add a "last_modified_by" field to every collection
        return {
            ...collection,
            properties: {
                ...collection.properties,
                last_modified_by: {
                    type: "string",
                    name: "Modified By",
                    readOnly: true
                }
            }
        };
    }
}
```

## Próximos Pasos

- **[Herramientas del Estudio](/docs/studio)** — consola SQL, consola JS, editor RLS
- **[Campos Personalizados](/docs/frontend/custom-fields)** — Construcción de campos de formulario personalizados

---
