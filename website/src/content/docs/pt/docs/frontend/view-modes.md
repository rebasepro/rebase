---
title: Modos de Visualização
sidebar_label: Modos de Visualização
description: Configure as visualizações de tabela, cartões e quadro Kanban para suas coleções.
---

## Visão Geral

Cada coleção pode ser exibida em quatro modos de visualização:

- **Lista** — Visualização de lista simples e limpa (o padrão clássico do CMS)
- **Tabela** — Grade estilo planilha com edição inline, ordenação, filtragem
- **Cartões** — Grade de cartões para conteúdo visual (imagens, pré-visualizações)
- **Kanban** — Quadro de arrastar e soltar agrupado por uma propriedade enum

## Configuração

```typescript
import { defineCollection } from "@rebasepro/admin-types";
const productsCollection = defineCollection({
    slug: "products",
    properties: { /* … */ },
    name: "Products",
    table: "products",
    // ...
    admin: {
        defaultViewMode: "table",            // Default view
        enabledViews: ["list", "table", "kanban"],    // Available views
        kanban: {
            columnProperty: "status",        // Enum property for columns
            orderProperty: "sortOrder"      // Property for drag-and-drop ordering
        }
    }
});

```

## Visualização em Lista

![Espaço reservado para captura de tela de visualização em lista](/img/features/list-view.png)

A visualização em lista é o modo de visualização padrão clássico e limpo do CMS, mostrando entidades em um formato de lista direta, sem a densidade de uma planilha.

## Visualização em Tabela

![Espaço reservado para captura de tela de visualização em tabela](/img/features/table-view.png)

A visualização padrão é uma planilha virtualizada de alto desempenho com:

- **Edição inline** — Clique em qualquer célula para editar no local
- **Redimensionamento de colunas** — Arraste os cabeçalhos das colunas
- **Reordenação de colunas** — Arraste para reorganizar
- **Ordenação** — Clique nos cabeçalhos das colunas
- **Pesquisa de texto** — Pesquisa de texto completo em campos de string
- **Filtragem** — Filtros por coluna
- **Seleção múltipla** — Selecione entidades para ações em massa

### Altura da Linha

Controle a altura da linha com `defaultSize`:

| Tamanho | Pixels | Melhor para |
|---------|--------|-------------|
| `"xs"`  | 40     | Tabelas de dados densos |
| `"s"`   | 54     | Padrão      |
| `"m"`   | 80     | Com miniaturas de imagem |
| `"l"`   | 120    | Cartões com pré-visualizações |
| `"xl"`  | 260    | Pré-visualizações de conteúdo rico |

## Visualização Kanban

![Espaço reservado para captura de tela de visualização Kanban](/img/features/kanban-view.png)

Configure um quadro Kanban especificando qual propriedade enum usar como colunas:

```typescript
import { defineCollection } from "@rebasepro/admin-types";
const tasksCollection = defineCollection({
    slug: "tasks",
    name: "Tasks",
    table: "tasks",
    properties: {
        title: { type: "string", name: "Title" },
        status: {
            type: "string",
            name: "Status",
            enum: [
                { id: "backlog", label: "Backlog", color: "gray" },
                { id: "in_progress", label: "In Progress", color: "blue" },
                { id: "review", label: "Review", color: "orange" },
                { id: "done", label: "Done", color: "green" }
            ]
        },
        sortOrder: { type: "number", name: "Sort Order" }
    },
    admin: {
        defaultViewMode: "kanban",
        kanban: {
            columnProperty: "status",
            orderProperty: "sortOrder"
        }
    }
});

```

Arrastar e soltar entre colunas atualiza automaticamente o campo enum e a ordem de classificação.

## Visualização em Cartões

![Espaço reservado para captura de tela de visualização em cartões](/img/features/cards-view.png)

Os cartões exibem entidades como cartões visuais — úteis para conteúdo com muitas imagens:

```typescript
import { defineCollection } from "@rebasepro/admin-types";
const articlesCollection = defineCollection({
    slug: "articles",
    name: "Articles",
    table: "articles",
    properties: {
        title: { type: "string", name: "Title" },
        cover: {
            type: "string",
            name: "Cover Image",
            storage: { storagePath: "covers", acceptedFiles: ["image/*"] }
        }
    },
    admin: {
        defaultViewMode: "cards"
    }
});

```

## Próximos Passos

- **[Visualizações de Entidade](/docs/frontend/entity-views)** — Abas personalizadas em formulários de entidade
- **[Ações de Entidade](/docs/frontend/entity-actions)** — Ações de entidade personalizadas
---
