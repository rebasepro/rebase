---
title: Coleções
sidebar_label: Coleções
description: Coleções são o bloco de construção central do Rebase — cada coleção mapeia para uma tabela de banco de dados e define seu esquema, relações, segurança e comportamento da UI.
---

## O que é uma Coleção?

Uma **coleção** é um objeto TypeScript que descreve uma tabela de banco de dados e como ela deve aparecer na UI de administração. Ela define:

- **Esquema** — Propriedades (colunas), seus tipos e regras de validação
- **Relações** — Chaves estrangeiras, tabelas de junção e caminhos de junção
- **Segurança** — Políticas de Segurança em Nível de Linha
- **Comportamento da UI** — Modos de visualização, edição inline, visualizações de entidade, ações
- **Hooks de Ciclo de Vida** — Callbacks para operações de criação, atualização, exclusão

```typescript
import { EntityCollection } from "@rebasepro/types";

export const productsCollection: EntityCollection = {
    slug: "products",              // URL path and API endpoint
    name: "Products",              // Display name (plural)
    singularName: "Product",       // Display name (singular)
    table: "products",            // PostgreSQL table name
    icon: "inventory_2",           // Material icon key

    properties: {
        name: {
            type: "string",
            name: "Product Name",
            validation: { required: true }
        },
        price: {
            type: "number",
            name: "Price",
            validation: { required: true, min: 0 }
        },
        category: {
            type: "string",
            name: "Category",
            enum: [
                { id: "electronics", label: "Electronics", color: "blueDark" },
                { id: "clothing", label: "Clothing", color: "pinkLight" },
                { id: "books", label: "Books", color: "orangeDark" }
            ]
        },
        description: {
            type: "string",
            name: "Description",
            multiline: true
        },
        active: {
            type: "boolean",
            name: "Active",
            defaultValue: true
        },
        created_at: {
            type: "date",
            name: "Created At",
            autoValue: "on_create",
            readOnly: true
        }
    }
};
```

## Propriedades Chave

### Identificação

| Propriedade | Tipo | Descrição |
|----------|------|-------------|
| `slug` | `string` | **Obrigatório.** Identificador seguro para URL. Usado no URL da UI de administração e no caminho da API REST (`/api/data/{slug}`). |
| `name` | `string` | **Obrigatório.** Nome de exibição (plural). Mostrado na navegação e nos cabeçalhos das páginas. |
| `singularName` | `string` | Nome de exibição para uma única entidade. Usado em "Novo Produto", "Editar Produto", etc. |
| `table` | `string` | **Obrigatório.** Nome da tabela PostgreSQL. Se diferente de `slug`, permite desacoplar URLs dos nomes das tabelas. |
| `icon` | `string` | Chave do ícone Material. Veja [Google Fonts Icons](https://fonts.google.com/icons). |

### Esquema

| Propriedade | Tipo | Descrição |
|----------|------|-------------|
| `properties` | `Properties` | **Obrigatório.** Mapa de chave de propriedade → definição de propriedade. Cada chave se torna uma coluna de banco de dados. |
| `relations` | `Relation[]` | Relações SQL — chaves estrangeiras, tabelas de junção. Veja [Relações](/docs/collections/relations). |
| `securityRules` | `SecurityRule[]` | Políticas de Segurança em Nível de Linha. Veja [Regras de Segurança](/docs/collections/security-rules). |

### Configuração da UI

| Propriedade | Tipo | Padrão | Descrição |
|----------|------|---------|-------------|
| `defaultViewMode` | `"list" \| "table" \| "cards" \| "kanban"` | `"table"` | Modo de visualização padrão |
| `enabledViews` | `ViewMode[]` | Todos os quatro | Quais modos de visualização estão disponíveis |
| `kanban` | `KanbanConfig` | — | Configuração Kanban (propriedade da coluna) |
| `openEntityMode` | `"side_panel" \| "full_screen" \| "split"` | `"full_screen"` | Como as entidades são abertas para edição |
| `sideDialogWidth` | `number \| string` | — | Largura do diálogo lateral |
| `inlineEditing` | `boolean` | `true` | Habilita a edição inline na visualização de planilha |
| `defaultSize` | `"xs" \| "s" \| "m" \| "l" \| "xl"` | `"m"` | Altura padrão da linha na tabela |
| `pagination` | `boolean \| number` | `true` (50) | Habilita a paginação e/ou define o tamanho da página |
| `listProperties` | `string[]` | — | Propriedades a serem exibidas na visualização de lista |
| `propertiesOrder` | `string[]` | — | Ordem das colunas na visualização de tabela |
| `selectionEnabled` | `boolean` | `true` | Habilita a seleção de linha |
| `hideFromNavigation` | `boolean` | `false` | Ocultar da navegação da barra lateral |
| `defaultSelectedView` | `string \| function` | — | Visualização padrão ou subcoleção a ser aberta |

### Opções de Entidade

| Propriedade | Tipo | Padrão | Descrição |
|----------|------|---------|-------------|
| `formAutoSave` | `boolean` | `false` | Auto-salvar na mudança de campo |
| `localChangesBackup` | `"manual_apply" \| "auto_apply" \| false` | `"manual_apply"` | Fazer backup de mudanças não salvas |
| `hideIdFromForm` | `boolean` | `false` | Ocultar o ID da entidade do formulário |
| `hideIdFromCollection` | `boolean` | `false` | Ocultar a coluna de ID da tabela |
| `includeJsonView` | `boolean` | `false` | Mostrar uma aba JSON na visualização de entidade |
| `history` | `boolean` | `false` | Rastrear mudanças no histórico da entidade |
| `alwaysApplyDefaultValues` | `boolean` | `false` | Aplicar valores padrão em cada salvamento |
| `previewProperties` | `string[]` | — | Propriedades a serem exibidas nas pré-visualizações de referência |
| `titleProperty` | `string` | — | Propriedade a ser usada como título da entidade |

### Avançado

| Propriedade | Tipo | Descrição |
|----------|------|-------------|
| `callbacks` | `EntityCallbacks` | Hooks de ciclo de vida (`beforeSave`, `afterSave`, `beforeDelete`, etc.) |
| `entityActions` | `EntityAction[]` | Ações personalizadas em entidades (arquivar, publicar, etc.) |
| `Actions` | `React.ComponentType` | Componente de ações personalizadas da barra de ferramentas |
| `entityViews` | `EntityCustomView[]` | Abas personalizadas na visualização de detalhes da entidade |
| `additionalFields` | `AdditionalFieldDelegate[]` | Colunas calculadas/virtuais |
| `childCollections` | `() => EntityCollection[]` | Coleções filhas aninhadas |
| `subcollections` | `() => EntityCollection[]` | Coleções aninhadas (por exemplo, pedido → itens de linha) |
| `exportable` | `boolean \| ExportConfig` | Habilita a exportação de dados |
| `ownerId` | `string` | ID do usuário proprietário (usado por plugins/código personalizado) |
| `overrides` | `EntityOverrides` | Sobrescritas para a visualização da entidade |
| `driver` | `string` | Driver de banco de dados a ser usado (padrão: `"(default)"`) |
| `databaseId` | `string` | ID do banco de dados/esquema dentro do driver |

## Construtor de Coleções

Para coleções dinâmicas que mudam com base no usuário ou dados externos, use uma função construtora:

```typescript
const collectionsBuilder: EntityCollectionsBuilder = ({ user, authController }) => {
    const collections = [productsCollection];

    if (authController.extra?.role === "admin") {
        collections.push(adminSettingsCollection);
    }

    return collections;
};
```

## Filtragem e Ordenação

Você pode definir filtros padrão ou forçados:

```typescript
{
    // Default filter — users can change it
    filter: { active: ["==", true] },

    // Forced filter — cannot be changed
    forceFilter: { tenant_id: ["==", currentTenantId] },

    // Default sort
    sort: ["created_at", "desc"]
}
```

## Próximos Passos

- **[Callbacks de Entidade](/docs/collections/callbacks)** — Hooks de ciclo de vida para sincronizar dados entre coleções, validação, efeitos colaterais
- **[Propriedades](/docs/collections/properties)** — Todos os tipos e opções de propriedade
- **[Relações](/docs/collections/relations)** — Chaves estrangeiras, tabelas de junção, junções
- **[Regras de Segurança](/docs/collections/security-rules)** — Segurança em Nível de Linha
- **[Modos de Visualização](/docs/frontend/view-modes)** — Lista, Tabela, Cartões, Kanban
---
