---
sourceHash: 608b8f9f3290a362
title: Modos de Visualização
sidebar_label: Modos de Visualização
description: Configure visualizações em tabela, cards e quadro Kanban para suas coleções.
---

## Visão Geral

Cada coleção pode ser exibida em quatro modos de visualização:

- **List** — Visualização em lista simples e limpa (o padrão clássico de CMS)
- **Table** — Grade em estilo planilha com edição inline, ordenação e filtragem
- **Cards** — Grade de cards para conteúdo visual (imagens, pré-visualizações)
- **Kanban** — Quadro com arrastar e soltar (drag-and-drop) agrupado por uma propriedade enum

Esses são os modos integrados. Uma coleção também pode oferecer modos de visualização desenvolvidos por você — um calendário, um mapa, uma galeria — no mesmo seletor, acionados pela mesma barra de ferramentas: consulte [Modos de visualização personalizados](/docs/frontend/extending#custom-view-modes) e o exemplo de calendário em [Personalizando o Admin](/docs/frontend/customizing).

## Configuração

```typescript
import { defineCollection } from "@rebasepro/cms-types";
const productsCollection = defineCollection({
    slug: "products",
    // `orderProperty` and `kanban.columnProperty` are checked against these
    // keys — with an empty `properties` block they narrow to `never`.
    properties: {
        id: { name: "ID", type: "string", isId: "uuid" },
        status: { name: "Status", type: "string" },
        // The order key. A *string*, never a number — see "Ordering" below.
        __order: {
            name: "Order",
            type: "string",
            admin: { disabled: true, hideFromCollection: true }
        }
    },
    name: "Products",
    table: "products",
    admin: {
        defaultViewMode: "table",            // Default view
        enabledViews: ["list", "table", "kanban"],    // Available views
        orderProperty: "__order",           // Property for drag-and-drop ordering
        kanban: {
            columnProperty: "status"         // Enum property for columns
        }
    }
});

```

## Visualização em Lista

A visualização em lista é o modo de visualização padrão clássico e limpo do CMS, exibindo entidades em um formato de lista direto, sem a densidade de uma planilha.

## Visualização em Tabela

A visualização em tabela é uma planilha virtualizada de alto desempenho com:

- **Edição inline** — Clique em qualquer célula para editar diretamente
- **Redimensionamento de colunas** — Arraste os cabeçalhos das colunas
- **Reordenação de colunas** — Arraste para reorganizar
- **Ordenação** — Clique nos cabeçalhos das colunas
- **Busca de texto** — Busca textual completa em campos de texto (string)
- **Filtragem** — Filtros por coluna
- **Seleção múltipla** — Selecione entidades para ações em massa

### Altura da Linha

Controle a altura da linha com `defaultSize`:

| Tamanho | Pixels | Ideal para |
|---------|--------|------------|
| `"xs"` | 36 | Tabelas de dados densas |
| `"s"` | 42 | Linhas de texto compactas |
| `"m"` | 48 | Padrão |
| `"l"` | 96 | Miniaturas de imagem médias |
| `"xl"` | 160 | Miniaturas de imagem grandes |

## Visualização Kanban

Configure um quadro Kanban especificando qual propriedade enum deve ser usada como colunas:

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

O recurso de arrastar e soltar (drag-and-drop) entre colunas atualiza automaticamente o campo enum e a ordem de classificação.

### Ordenação

`kanban` e `orderProperty` são duas metades do mesmo recurso. Declare ambos, sempre — três erros cometidos aqui geram um quadro que parece configurado, mas não está.

**`orderProperty` não é opcional.** Sem ela, um card ainda pode ser arrastado entre colunas, pois isso grava a `columnProperty`. Porém, sua posição *dentro* de uma coluna não tem onde ser armazenada, sendo redefinida na próxima leitura, e o quadro exibirá uma barra âmbar informando que a ordenação não está configurada.

**A propriedade deve ser uma `string`.** A reordenação grava uma chave de [fractional-indexing](https://github.com/rocicorp/fractional-indexing) — `"i0"`, `"i1"`, `"i0i"` — e não um índice. Uma propriedade do tipo `number` nunca poderá armazená-la, portanto um `sortOrder` numérico deixará o quadro solicitando inicialização indefinidamente, e a própria inicialização falhará em uma coluna numérica. Declare-a como oculta; trata-se de um mecanismo interno, não de conteúdo:

```typescript
__order: {
    type: "string",
    name: "Order",
    admin: { disabled: true, hideFromCollection: true }
}
```

**Linhas criadas fora do painel administrativo chegam sem chave.** Nada atribui uma chave na inserção. Uma linha gravada por um cron job, um script de seed, uma migração ou pela API REST chega com `__order` nulo, e o quadro exibe *\"Some items don't have order values\"* com um botão **Initialize** — um clique preenche retroativamente a primeira página, mas a próxima execução do cron trará a barra de volta. Se um backend cria linhas para um quadro, ele próprio deve anexar a chave. Use o mesmo alfabeto utilizado pelo painel administrativo:

```typescript
import { generateKeyBetween } from "fractional-indexing";

// Base36, lower case. Postgres does the sorting and its default collation is
// not byte ordering, so the library's default base62 alphabet — which mixes
// cases — sorts differently in the database than in the key. Omitting this
// third argument produces keys like "a0" that the board rejects.
const ORDER_KEY_DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz";

const tasks = client.data.collection("tasks");

// The last key currently in use. `is-not-null` is not optional: a descending
// sort is NULLS FIRST, so without it this reads back one of the very rows that
// has no key and every insert lands on the same "i0".
const { data: last } = await tasks.find({
    where: { __order: ["is-not-null", null] },
    orderBy: ["__order", "desc"],
    limit: 1
});

await tasks.create({
    title,
    status,
    __order: generateKeyBetween(
        (last[0]?.__order as string | undefined) ?? null,
        null,
        ORDER_KEY_DIGITS
    )
});
```

Linhas criadas através do formulário do painel administrativo também chegam sem chave — a única diferença é que você vê a barra no momento em que adiciona uma. **Initialize** é a solução nesse caso; em um quadro alimentado por um backend, é uma solução que se desfaz a cada execução.

## Visualização em Cards

Cards exibem entidades como cartões visuais — muito útil para conteúdos com foco em imagens:

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

- **[Personalizando o Admin](/docs/frontend/customizing)** — Seus próprios modos de visualização, páginas e ações
- **[Visualizações de Entidade](/docs/frontend/entity-views)** — Abas personalizadas em formulários de entidade
- **[Ações de Entidade](/docs/frontend/entity-actions)** — Ações personalizadas de entidade
