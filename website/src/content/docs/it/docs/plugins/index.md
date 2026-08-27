---
title: Sistema di Plugin
sidebar_label: Plugin
description: Estendi Rebase con i plugin — inietta componenti dell'interfaccia utente, modifica collezioni, aggiungi azioni della barra degli strumenti e crea builder di campi personalizzati.
---

## Panoramica

I plugin sono il principale meccanismo di estensione in Rebase. Possono:

- Avvolgere l'intera app con un **provider** (contesto, gestione dello stato)
- Aggiungere **azioni e widget della home page**
- Iniettare componenti della **vista collezione** (barra degli strumenti, builder di colonne)
- Aggiungere componenti del **modulo** (builder di campi, pannelli aggiuntivi)
- **Iniettare o modificare collezioni** dinamicamente

## Interfaccia Plugin

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

## Utilizzo dei Plugin

Passa le istanze dei plugin al controller di navigazione:

```typescript
const dataEnhancementPlugin = useDataEnhancementPlugin();

const plugins = [dataEnhancementPlugin];

const navigationStateController = useBuildNavigationStateController({
    plugins,
    collections: () => collections,
    // ...
});
```

## Creazione di un Plugin

Ecco un plugin minimo che aggiunge un'azione alla barra degli strumenti a ogni collezione:

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

## Plugin Integrati

### Plugin di Miglioramento dei Dati

Autocompletamento dei campi basato sull'IA:

```typescript
import { useDataEnhancementPlugin } from "@rebasepro/plugin-ai";

const enhancementPlugin = useDataEnhancementPlugin();
```

![Miglioramento dei dati](/img/data_enhancement.png)

## Iniezione di Collezioni

I plugin possono aggiungere dinamicamente nuove collezioni:

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

## Modifica di Collezioni

I plugin possono modificare collezioni esistenti:

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

## Prossimi Passi

- **[Strumenti dello Studio](/docs/studio)** — console SQL, console JS, editor RLS
- **[Campi Personalizzati](/docs/frontend/custom-fields)** — Creazione di campi modulo personalizzati
---
