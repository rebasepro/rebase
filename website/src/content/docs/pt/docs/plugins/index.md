---
sourceHash: 91344f4bf4cb8889
title: Sistema de Plugins
sidebar_label: Plugins
description: Estenda o Rebase com plugins — injete componentes de UI, modifique coleções, adicione ações à barra de ferramentas e crie construtores de campos personalizados.
---

## Visão Geral

Plugins são o principal mecanismo de extensão no Rebase. Eles podem:

- Envolver todo o aplicativo com um **provedor** (contexto, gerenciamento de estado)
- Adicionar **ações e widgets à página inicial**
- Injetar componentes da **visualização de coleção** (barra de ferramentas, construtores de colunas)
- Adicionar componentes de **formulário** (construtores de campos, painéis adicionais)
- **Injetar ou modificar coleções** dinamicamente

## Interface do Plugin

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

## Usando Plugins

Passe as instâncias do plugin para o controlador de navegação:

```typescript
const dataEnhancementPlugin = useDataEnhancementPlugin();

const plugins = [dataEnhancementPlugin];

const navigationStateController = useBuildNavigationStateController({
    plugins,
    collections: () => collections,
    // ...
});
```

## Construindo um Plugin

Aqui está um plugin mínimo que adiciona uma ação à barra de ferramentas para cada coleção:

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

### Plugin de Aprimoramento de Dados

Autocompletar campo com IA:

```typescript
import { useDataEnhancementPlugin } from "@rebasepro/plugin-ai";

const enhancementPlugin = useDataEnhancementPlugin();
```

![Aprimoramento de dados](/img/data_enhancement.png)

## Injeção de Coleção

Plugins podem adicionar novas coleções dinamicamente:

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

## Modificação de Coleção

Plugins podem modificar coleções existentes:

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

## Próximos Passos

- **[Ferramentas do Estúdio](/docs/studio)** — console SQL, console JS, editor RLS
- **[Campos Personalizados](/docs/frontend/custom-fields)** — Construindo campos de formulário personalizados
---
