---
title: Modos de Visualização
sidebar_label: Modos de Visualização
slug: pt/docs/frontend/view-modes
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
const productsCollection: EntityCollection = {
    slug: "products",
    defaultViewMode: "table",            // Default view
    enabledViews: ["list", "table", "kanban"],    // Available views
    kanban: {
        columnProperty: "status",        // Enum property for columns
        orderProperty: "sort_order"      // Property for drag-and-drop ordering
    },
    // ...
};
```

## Visualização em Lista

![List View screenshot placeholder](/img/features/list-view.png)

A visualização em lista é o modo de visualização padrão clássico e limpo do CMS, mostrando entidades em um formato de lista direta, sem a densidade de uma planilha.

## Visualização em Tabela

![Table View screenshot placeholder](/img/features/table-view.png)

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

![Kanban View screenshot placeholder](/img/features/kanban-view.png)

Configure um quadro Kanban especificando qual propriedade enum usar como colunas:

```typescript
const tasksCollection: EntityCollection = {
    slug: "tasks",
    defaultViewMode: "kanban",
    kanban: {
        columnProperty: "status",
        orderProperty: "sort_order"
    },
    properties: {
        title: { type: "string", name: "Title" },
        status: {
            type: "string",
            name: "Status",
            enum: [
                { id: "backlog", label: "Backlog", color: "grayDark" },
                { id: "in_progress", label: "In Progress", color: "blueDark" },
                { id: "review", label: "Review", color: "orangeDark" },
                { id: "done", label: "Done", color: "greenDark" }
            ]
        },
        sort_order: { type: "number", name: "Sort Order" }
    }
};
```

Arrastar e soltar entre colunas atualiza automaticamente o campo enum e a ordem de classificação.

## Visualização em Cartões

![Cards View screenshot placeholder](/img/features/cards-view.png)

Os cartões exibem entidades como cartões visuais — úteis para conteúdo com muitas imagens:

```typescript
const articlesCollection: EntityCollection = {
    slug: "articles",
    defaultViewMode: "cards",
    properties: {
        title: { type: "string", name: "Title" },
        cover: {
            type: "string",
            name: "Cover Image",
            storage: { storagePath: "covers", acceptedFiles: ["image/*"] }
        }
    }
};
```

## Próximos Passos

- **[Visualizações de Entidade](/docs/frontend/entity-views)** — Abas personalizadas em formulários de entidade
- **[Ações de Entidade](/docs/frontend/entity-actions)** — Ações de entidade personalizadas
---
