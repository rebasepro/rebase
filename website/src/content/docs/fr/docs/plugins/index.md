---
title: Système de Plugins
sidebar_label: Plugins
description: Étendez Rebase avec des plugins — injectez des composants d'interface utilisateur, modifiez des collections, ajoutez des actions de barre d'outils et créez des constructeurs de champs personnalisés.
---

## Vue d'ensemble

Les plugins sont le mécanisme d'extension principal dans Rebase. Ils peuvent :

- Envelopper l'application entière avec un **fournisseur** (contexte, gestion d'état)
- Ajouter des **actions de page d'accueil** et des widgets
- Injecter des composants de **vue de collection** (barre d'outils, constructeurs de colonnes)
- Ajouter des composants de **formulaire** (constructeurs de champs, panneaux supplémentaires)
- **Injecter ou modifier des collections** dynamiquement

## Interface de Plugin

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

## Utilisation des Plugins

Passez les instances de plugin au contrôleur de navigation :

```typescript
const dataEnhancementPlugin = useDataEnhancementPlugin();

const plugins = [dataEnhancementPlugin];

const navigationStateController = useBuildNavigationStateController({
    plugins,
    collections: () => collections,
    // ...
});
```

## Création d'un Plugin

Voici un plugin minimal qui ajoute une action à la barre d'outils à chaque collection :

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

## Plugins intégrés

### Plugin d'amélioration des données

Autocomplétion de champ alimentée par l'IA :

```typescript
import { useDataEnhancementPlugin } from "@rebasepro/plugin-ai";

const enhancementPlugin = useDataEnhancementPlugin();
```

![Amélioration des données](/img/data_enhancement.png)

## Injection de Collection

Les plugins peuvent ajouter dynamiquement de nouvelles collections :

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

## Modification de Collection

Les plugins peuvent modifier les collections existantes :

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

## Prochaines étapes

- **[Outils du Studio](/docs/studio)** — Console SQL, console JS, éditeur RLS
- **[Champs Personnalisés](/docs/frontend/custom-fields)** — Création de champs de formulaire personnalisés
