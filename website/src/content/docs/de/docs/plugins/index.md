---
sourceHash: 91344f4bf4cb8889
title: Pluginsystem
sidebar_label: Plugins
description: Erweitern Sie Rebase mit Plugins – injizieren Sie UI-Komponenten, modifizieren Sie Sammlungen, fügen Sie Toolbar-Aktionen hinzu und erstellen Sie benutzerdefinierte Feld-Builder.
---

## Überblick

Plugins sind der primäre Erweiterungsmechanismus in Rebase. Sie können:

- Die gesamte App mit einem **Provider** (Kontext, Zustandsverwaltung) umschließen
- **Homepage-Aktionen** und Widgets hinzufügen
- **Sammlungsansichts**-Komponenten injizieren (Toolbar, Spalten-Builder)
- **Formular**-Komponenten hinzufügen (Feld-Builder, zusätzliche Panels)
- Sammlungen dynamisch **injizieren oder modifizieren**

## Plugin-Schnittstelle

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

## Verwendung von Plugins

Übergeben Sie Plugin-Instanzen an den Navigations-Controller:

```typescript
const dataEnhancementPlugin = useDataEnhancementPlugin();

const plugins = [dataEnhancementPlugin];

const navigationStateController = useBuildNavigationStateController({
    plugins,
    collections: () => collections,
    // ...
});
```

## Erstellen eines Plugins

Hier ist ein minimales Plugin, das jeder Sammlung eine Toolbar-Aktion hinzufügt:

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

## Integrierte Plugins

### Daten-Enhancement-Plugin

KI-gestützte Feld-Autovervollständigung:

```typescript
import { useDataEnhancementPlugin } from "@rebasepro/plugin-ai";

const enhancementPlugin = useDataEnhancementPlugin();
```

![Datenverbesserung](/img/data_enhancement.png)

## Sammlungs-Injektion

Plugins können dynamisch neue Sammlungen hinzufügen:

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

## Sammlungs-Modifikation

Plugins können bestehende Sammlungen modifizieren:

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

## Nächste Schritte

- **[Studio-Tools](/docs/studio)** — SQL-Konsole, JS-Konsole, RLS-Editor
- **[Benutzerdefinierte Felder](/docs/frontend/custom-fields)** — Erstellen von benutzerdefinierten Formularfeldern
---
