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
import { defineCollection } from "@rebasepro/cms-types";
const productsCollection = defineCollection({
    slug: "products",
    properties: { /* … */ },
    name: "Products",
    table: "products",
    // ...
    admin: {
        defaultViewMode: "table",            // Default view
        enabledViews: ["list", "table", "kanban"],    // Available views
        orderProperty: "__order",           // Propriedade para reordenação por arrastar e soltar
        kanban: {
            columnProperty: "status"         // Enum property for columns
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
import { defineCollection } from "@rebasepro/cms-types";
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
        __order: {
            type: "string",
            name: "Order",
            admin: { disabled: true, hideFromCollection: true }
        }
    },
    admin: {
        defaultViewMode: "kanban",
        orderProperty: "__order",
        kanban: {
            columnProperty: "status"
        }
    }
});

```

Arrastar e soltar entre colunas atualiza automaticamente o campo enum e a ordem de classificação.

### Ordenação

`kanban` e `orderProperty` são duas metades do mesmo recurso. Declare as duas,
sempre — três enganos aqui produzem um quadro que *parece* configurado e não
está.

**`orderProperty` não é opcional.** Sem ela um cartão ainda arrasta entre
colunas, porque isso grava `columnProperty`. A posição *dentro* da coluna não tem
onde ser guardada: volta ao normal na leitura seguinte, e o quadro exibe uma
barra âmbar dizendo que a ordenação não está configurada.

**A propriedade tem de ser uma `string`.** A reordenação grava uma chave
[fractional-indexing](https://github.com/rocicorp/fractional-indexing) — `"i0"`,
`"i1"`, `"i0i"` — não um índice. Uma propriedade `number` nunca consegue
guardá-la: um `sortOrder` numérico deixa o quadro pedindo inicialização para
sempre, e a própria inicialização falha contra uma coluna numérica. Declare-a
oculta: é maquinaria, não conteúdo.

```typescript
__order: {
    type: "string",
    name: "Order",
    admin: { disabled: true, hideFromCollection: true }
}
```

**Linhas criadas fora do admin chegam sem chave.** Nada a atribui na inserção.
Uma linha escrita por um cron, um script de seed, uma migração ou a API REST
chega com `__order` nulo, e o quadro mostra *"Some items don't have order
values"* com um botão **Initialize** — um clique preenche a primeira página, e a
execução seguinte do cron traz a barra de volta. Se um backend cria linhas para
um quadro, ele mesmo deve atribuir a chave, com o mesmo alfabeto do admin:

```typescript
import { generateKeyBetween } from "fractional-indexing";

// Base36, minúsculas. Quem ordena é o Postgres, cuja collation padrão não é a
// ordenação por bytes: omitir este terceiro argumento produz chaves base62 como
// "a0" que o quadro rejeita.
const ORDER_KEY_DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz";

const tasks = client.data.collection("tasks");

// A última chave em uso. `is-not-null` não é opcional: uma ordenação
// descendente é NULLS FIRST, então sem ela isto relê uma das próprias linhas
// sem chave e cada inserção cai no mesmo "i0".
const { data: last } = await tasks.find({
    where: { __order: ["is-not-null", null] },
    orderBy: ["__order", "desc"],
    limit: 1
});

await tasks.create({
    title,
    status,
    __order: generateKeyBetween(last[0]?.__order ?? null, null, ORDER_KEY_DIGITS)
});
```

## Visualização em Cartões

![Espaço reservado para captura de tela de visualização em cartões](/img/features/cards-view.png)

Os cartões exibem entidades como cartões visuais — úteis para conteúdo com muitas imagens:

```typescript
import { defineCollection } from "@rebasepro/cms-types";
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
