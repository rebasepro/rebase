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
import { defineCollection } from "@rebasepro/admin-types";

export const productsCollection = defineCollection({
    slug: "products",              // URL path and API endpoint
    name: "Products",              // Display name (plural)
    singularName: "Product",       // Display name (singular)
    table: "products",            // PostgreSQL table name

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
                { id: "electronics", label: "Electronics", color: "blue" },
                { id: "clothing", label: "Clothing", color: "pink" },
                { id: "books", label: "Books", color: "orange" }
            ]
        },
        description: {
            type: "string",
            name: "Description",
            admin: { multiline: true }
        },
        active: {
            type: "boolean",
            name: "Active",
            defaultValue: true
        },
        createdAt: {
            type: "date",
            name: "Created At",
            autoValue: "on_create",
            readOnly: true
        }
    },
    admin: {
        icon: "inventory_2"           // Material icon key
    }
});

```

## Declarando uma: `defineCollection`

Envolva o literal em `defineCollection`. Em tempo de execução é a função identidade — devolve o objeto inalterado — portanto não custa nada. O que ela traz é inferência: um parâmetro de tipo `const` captura as chaves de `properties` como tipos literais, que é o que as coloca no autocompletar do editor para `admin.display`, `admin.sort` e `admin.propertiesOrder`.

```typescript
import { defineCollection } from "@rebasepro/admin-types";

const products = defineCollection({
    name: "Products",
    slug: "products",
    table: "products",
    properties: {
        name: { name: "Name", type: "string" },
        price: { name: "Price", type: "number" }
    },
    admin: {
        display: { title: "name" },   // autocompletar: "name" | "price"
        sort: ["price", "asc"]   // autocompletar no primeiro elemento
    }
});
```

Importe-a de `@rebasepro/admin-types` num projeto com painel de administração — essa é a cópia que também verifica o bloco `admin`. Um projeto BaaS headless, sem bloco `admin` e sem React, importa a mesma função de `@rebasepro/common`.

Anotar o tipo diretamente continua funcionando e continua sendo verificado:

```typescript
import type { PostgresCollectionConfig } from "@rebasepro/types";

const products: PostgresCollectionConfig = {
    name: "Products",
    slug: "products",
    table: "products",
    properties: {
        name: { name: "Name", type: "string" }
    }
};
```

Mas uma anotação apenas *valida* o objeto — ela não enxerga os nomes das suas propriedades, então você não recebe autocompletar. Prefira `defineCollection`, a menos que precise nomear o tipo.

:::note
`buildCollection` e `buildProperty` já não existem. `buildCollection` é `defineCollection` sem a inferência; `buildProperty` envolvia uma propriedade num tipo que ela já tinha. Veja o [changelog](/docs/changelog) para a migração de uma linha.
:::

## Propriedades Chave

### Identificação

| Propriedade | Tipo | Descrição |
|----------|------|-------------|
| `slug` | `string` | **Obrigatório.** Identificador seguro para URL. Usado no URL da UI de administração e no caminho da API REST (`/api/data/{slug}`). |
| `name` | `string` | **Obrigatório.** Nome de exibição (plural). Mostrado na navegação e nos cabeçalhos das páginas. |
| `singularName` | `string` | Nome de exibição para uma única entidade. Usado em "Novo Produto", "Editar Produto", etc. |
| `table` | `string` | **Obrigatório.** Nome da tabela PostgreSQL. Se diferente de `slug`, permite desacoplar URLs dos nomes das tabelas. |
| `admin.icon` | `string` | Chave do ícone Material. Veja [Google Fonts Icons](https://fonts.google.com/icons). |

### Esquema

| Propriedade | Tipo | Descrição |
|----------|------|-------------|
| `properties` | `Properties` | **Obrigatório.** Mapa de chave de propriedade → definição de propriedade. Cada chave se torna uma coluna de banco de dados. |
| `relations` | `Relation[]` | Relações SQL — chaves estrangeiras, tabelas de junção. Veja [Relações](/docs/collections/relations). |
| `securityRules` | `SecurityRule[]` | Políticas de Segurança em Nível de Linha. Veja [Regras de Segurança](/docs/collections/security-rules). |
| `indexes` | `CollectionIndex[]` | Índices do Postgres de que esta tabela precisa. Veja [Índices](/docs/backend/indexes). |
| `search` | `SearchConfig` | Busca textual (full-text) ranqueada sobre os campos que você especificar, incluindo conteúdo de JSONB e arrays. Apenas Postgres. Veja [Busca](/docs/backend/search). |

### Configuração da UI

Todos os campos seguintes ficam dentro de `admin`.

| Propriedade | Tipo | Padrão | Descrição |
|----------|------|---------|-------------|
| `defaultViewMode` | `"list" \| "table" \| "cards" \| "kanban"` | `"table"` | Modo de visualização padrão |
| `enabledViews` | `ViewMode[]` | Todos os quatro | Quais modos de visualização estão disponíveis |
| `kanban` | `KanbanConfig` | — | Configuração Kanban (propriedade da coluna). Combine sempre com `orderProperty` — veja [Modos de Visualização](/docs/frontend/view-modes) |
| `orderProperty` | `string` | — | Chave da propriedade **string** que guarda a chave de ordenação por arrastar e soltar. Necessária para um quadro Kanban funcional |
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

Dentro de `admin`, exceto `history`, que é um recurso do backend e permanece no nível superior.

| Propriedade | Tipo | Padrão | Descrição |
|----------|------|---------|-------------|
| `formAutoSave` | `boolean` | `false` | Auto-salvar na mudança de campo |
| `localChangesBackup` | `"manual_apply" \| "auto_apply" \| false` | `"manual_apply"` | Fazer backup de mudanças não salvas |
| `hideIdFromForm` | `boolean` | `false` | Ocultar o ID da entidade do formulário |
| `hideIdFromCollection` | `boolean` | `false` | Ocultar a coluna de ID da tabela |
| `includeJsonView` | `boolean` | `true` | Oferecer os valores em bruto no inspetor do registo |
| `history` | `boolean` | `false` | Rastrear mudanças no histórico da entidade |
| `alwaysApplyDefaultValues` | `boolean` | `false` | Aplicar valores padrão em cada salvamento |
| `previewProperties` | `string[]` | — | Propriedades a serem exibidas nas pré-visualizações de referência |
| `display` | `EntityDisplay` | — | O que preenche cada função de exibição — `title`, `subtitle`, `image`, `status`, `date`, `tags` |

### Avançado

| Propriedade | Tipo | Descrição |
|----------|------|-------------|
| `callbacks` | `CollectionCallbacks` | Hooks de ciclo de vida (`beforeSave`, `afterSave`, `beforeDelete`, etc.) |
| `entityActions` | `EntityAction[]` | Ações personalizadas em entidades (arquivar, publicar, etc.) |
| `Actions` | `React.ComponentType` | Componente de ações personalizadas da barra de ferramentas |
| `entityViews` | `EntityCustomView[]` | Abas personalizadas na visualização de detalhes da entidade |
| `additionalFields` | `AdditionalFieldDelegate[]` | Colunas calculadas/virtuais |
| `childCollections` | `() => CollectionConfig[]` | Coleções filhas aninhadas |
| `subcollections` | `() => CollectionConfig[]` | Coleções aninhadas (por exemplo, pedido → itens de linha) |
| `exportable` | `boolean \| ExportConfig` | Habilita a exportação de dados |
| `ownerId` | `string` | ID do usuário proprietário (usado por plugins/código personalizado) |
| `overrides` | `EntityOverrides` | Sobrescritas para a visualização da entidade |
| `driver` | `string` | Driver de banco de dados a ser usado (padrão: `"(default)"`) |
| `databaseId` | `string` | ID do banco de dados/esquema dentro do driver |

## Construtor de Coleções

Para coleções dinâmicas que mudam com base no usuário ou dados externos, use uma função construtora:

```typescript
const collectionsBuilder: CollectionConfigsBuilder = ({ user, authController }) => {
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
    sort: ["createdAt", "desc"]
}
```

## Próximos Passos

- **[Callbacks de Entidade](/docs/collections/callbacks)** — Hooks de ciclo de vida para sincronizar dados entre coleções, validação, efeitos colaterais
- **[Propriedades](/docs/collections/properties)** — Todos os tipos e opções de propriedade
- **[Relações](/docs/collections/relations)** — Chaves estrangeiras, tabelas de junção, junções
- **[Regras de Segurança](/docs/collections/security-rules)** — Segurança em Nível de Linha
- **[Modos de Visualização](/docs/frontend/view-modes)** — Lista, Tabela, Cartões, Kanban
---
