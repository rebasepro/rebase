---
sourceHash: 57ee5c3ecdf49419
title: Modos de visualização
sidebar_label: Modos de visualização
description: "Exiba as linhas de uma tabela como uma lista, uma planilha, cards ou um quadro kanban; escolha o que preenche o título, a imagem, o status e a data de cada registro; e defina a ordenação padrão, filtros e predefinições de filtro de um clique."
---

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Toda coleção pode ser exibida de quatro maneiras, a partir do seletor em sua barra de ferramentas:

- **Tabela**: uma planilha virtualizada com edição inline, ordenação, filtragem
  e seleção múltipla. Onde uma coleção é aberta a menos que indicado o contrário.
- **Lista**: uma linha por registro, com sua imagem, título, subtítulo, status e
  data.
- **Cards**: uma grade de cards, para conteúdo rico em imagens.
- **Kanban**: um quadro agrupado por uma coluna com um conjunto fechado de valores.

Uma coleção também pode oferecer modos de visualização criados por você (um calendário, um mapa, uma
galeria) no mesmo seletor, acionados pela mesma barra de ferramentas: consulte
[Modos de visualização personalizados](/docs/frontend/extending#custom-view-modes).

## Escolhendo as visualizações

<span class="since-badge" data-since="0.31">Desde 0.31</span>

```ts
// backend/schema/tasks.ts
import { defineTable, col } from "@rebasepro/server/schema";

export const tasks = defineTable("tasks", {
    columns: {
        id:      col.uuid().primaryKey().defaultRandom(),
        title:   col.text().notNull(),
        status:  col.enum(["backlog", "in_progress", "review", "done"]).notNull().default("backlog"),
        dueDate: col.date(),
        // The board's order key: text, never a number.
        __order: col.text(),
    },
    rls: "admin-only",
});
```

```tsx
// frontend/src/cms/tasks.tsx
import { customizeTable } from "@rebasepro/cms";
import type { tasks } from "../../../backend/schema/tasks";

export const tasksCms = customizeTable<typeof tasks>("tasks", {
    defaultViewMode: "kanban",
    enabledViews: ["table", "kanban"],
    kanban: { columnField: "status", orderField: "__order" },
    fields: {
        status: {
            enumLabels: {
                backlog:     { label: "Backlog", color: "gray" },
                in_progress: { label: "In Progress", color: "blue" },
                review:      { label: "Review", color: "orange" },
                done:        { label: "Done", color: "green" },
            },
        },
        __order: { hidden: true, hiddenInForm: true },
    },
});
```

| Opção | Efeito |
|---|---|
| `defaultViewMode` | Onde o visitante acessa inicialmente: `"table"`, `"list"`, `"cards"`, `"kanban"` ou a chave de uma visualização personalizada. |
| `enabledViews` | As visualizações oferecidas pelo seletor. |
| `kanban` | `{ columnField, orderField }`: o quadro. |
| `defaultSize` | A altura da linha, abaixo. |
| `customViews` | Suas próprias visualizações, por valor ou por chave. |

### Altura da linha

| `defaultSize` | Pixels | Ideal para |
|------|--------|----------|
| `"xs"` | 36 | Tabelas de dados densas |
| `"s"` | 42 | Linhas de texto compactas |
| `"m"` | 48 | Padrão |
| `"l"` | 96 | Miniaturas de imagem médias |
| `"xl"` | 160 | Miniaturas de imagem grandes |

## Kanban

<span class="since-badge" data-since="0.31">Desde 0.31</span>

`kanban.columnField` define o nome da coluna pela qual o quadro faz o agrupamento. Ela deve conter um
conjunto fechado de strings, um `col.enum([...])` ou uma coluna de texto com
`.oneOf([...])`; qualquer outra coisa é um erro de tipo. As colunas são renderizadas na
própria ordem da coluna ou em `enumOrder`, com os rótulos e cores de
`enumLabels`. Arrastar um card para outra coluna grava em `columnField`.

`kanban.orderField` define onde a posição de um card **dentro** de uma coluna é armazenada.
Declare-o sempre: três erros aqui produzem um quadro que parece
configurado, mas não está.

**`orderField` não é opcional.** Sem ele, um card ainda pode ser arrastado entre colunas,
porque isso grava em `columnField`. No entanto, sua posição dentro de uma coluna não tem onde
ser armazenada, portanto ela é redefinida na próxima leitura, e o quadro exibe uma barra âmbar
informando que a ordenação não está configurada.

**A coluna deve ser do tipo texto.** A reordenação grava uma chave de
[indexação fracionária](https://github.com/rocicorp/fractional-indexing)
(`"i0"`, `"i1"`, `"i0i"`), e não um índice numérico. Uma coluna numérica nunca pode conter esse valor, portanto
`orderField` aceita apenas uma coluna de texto. Trata-se de um mecanismo interno, não de conteúdo: oculte-o,
como mostrado acima.

**Linhas criadas fora do CMS chegam sem uma chave.** Nada atribui uma durante a
inserção. Uma linha gravada por um cron, um script de seed, uma migração ou pela API REST
chega com `__order` nulo, e o quadro exibe *"Some items don't have order
values"* com um botão **Initialize**. Um clique preenche retroativamente a primeira página, e
a próxima execução do cron trará a barra imediatamente de volta. Se um backend cria linhas para um
quadro, ele próprio deve adicionar a chave, utilizando o alfabeto que o CMS usa:

```typescript
import { generateKeyBetween } from "fractional-indexing";

// Base36, lower case. Postgres does the sorting and its default collation is
// not byte ordering, so the library's default base62 alphabet — which mixes
// cases — sorts differently in the database than in the key. Omitting this
// third argument produces keys like "a0" that the board rejects.
const ORDER_KEY_DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz";

// The last key currently in use. `is-not-null` is not optional: a descending
// sort is NULLS FIRST, so without it this reads back one of the very rows that
// has no key and every insert lands on the same "i0".
const { data: last } = await client.data.tasks.find({
    where: { __order: ["is-not-null", null] },
    orderBy: ["__order", "desc"],
    limit: 1
});

await client.data.tasks.create({
    title,
    status,
    __order: generateKeyBetween(
        (last[0]?.__order as string | undefined) ?? null,
        null,
        ORDER_KEY_DIGITS
    )
});
```

As linhas criadas por meio do formulário também chegam sem chave; a diferença é apenas que
você vê a barra no momento em que adiciona uma. **Initialize** é a solução nesse caso; em um
quadro alimentado por um backend, é uma correção que se desfaz a cada execução.

## Slots de exibição

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Toda superfície que renderiza um registro usa alguns de seis slots: **title**,
**subtitle**, **image**, **status**, **date** e **tags**. Uma linha de lista é image +
title + subtitle + status + date, um card é o mesmo com a imagem no topo, um
seletor de referência é title + subtitle e o cabeçalho de uma página é apenas o title.

O CMS preenche alguns slots a partir das colunas da tabela (consulte
[slots de exibição padrão](/docs/collections/#display-slots)). `display` define qualquer
um deles, como um caminho de campo ou como uma função:

```tsx
import { customizeTable } from "@rebasepro/cms";
import type { tasks } from "../../../backend/schema/tasks";

export const tasksCms = customizeTable<typeof tasks>("tasks", {
    display: {
        title: "title",
        status: "status",
        date: "dueDate",
        subtitle: ({ row }) => row.dueDate ? `Due ${row.dueDate}` : undefined,
    },
});
```

Um slot que você omitir mantém seu valor derivado.

Um resolver recebe `{ row, id, context }`. `row` é o registro conforme o servidor
o envia, tipado como a linha da tabela: datas como strings ISO, uma relação belongsTo como sua
coluna de chave estrangeira. `id` é sua chave primária como string, com as partes de uma chave composta
unidas por `:::`. Uma relação carregada pelo CMS chega aninhada sob seu nome, da mesma forma que o
`include` da REST retorna, permitindo que um resolver leia o campo de um registro relacionado sem
fazer uma requisição própria.

Um resolver pode ser `async`, para ler algo que o registro não possui. Enquanto
a promise está em andamento, a superfície exibe o valor derivado e o substitui pelo
resolvido assim que concluído: um título nunca é um indicador de carregamento (spinner). Os resultados são armazenados em cache por
registro e slot, e requisições simultâneas compartilham a mesma chamada.

Retorne `undefined` quando um registro não tiver nada para o slot; a superfície recorrerá
ao que ela conhece (um cabeçalho usa o nome da coleção no singular, um link usa
o id). Um resolver que lançar um erro é tratado como `undefined` e registrado no log uma vez.

Dê preferência a um caminho sempre que o valor estiver no registro: um caminho preserva a
renderização nativa do campo, portanto um status enum permanece como um chip colorido e uma data permanece formatada,
o que um resolver que retorna uma string não consegue fazer.

Quando nenhum slot especifica o título, o CMS escolhe um. Com `fieldOrder`, o primeiro
campo nessa ordem que puder ser um título: texto, uma relação de cardinalidade única ou
uma referência. Caso contrário, os candidatos são ranqueados: texto cuja chave indica um rótulo
(`name`, `title`, `label`…) primeiro, seguido por texto curto, um e-mail, um enum, texto longo,
uma relação e uma referência. Chaves, colunas uuid, campos de arquivo e campos ocultos
nunca se qualificam. O que quer que o título contenha é renderizado como texto: uma data formatada, um
array unido e uma relação como o primeiro entre `name`, `title`, `label` ou
`displayName` na linha relacionada, recorrendo ao seu id se nenhum estiver presente.

## Filtros, predefinições e ordenação

<span class="since-badge" data-since="0.31">Desde 0.31</span>

```tsx
import { customizeTable } from "@rebasepro/cms";
import type { tasks } from "../../../backend/schema/tasks";

export const tasksCms = customizeTable<typeof tasks>("tasks", {
    sort: ["dueDate", "asc"],
    defaultFilter: { status: ["!=", "done"] },
    filterPresets: [
        { label: "In review", filterValues: { status: ["==", "review"] } },
        { label: "Overdue", filterValues: { dueDate: ["<", new Date().toISOString().slice(0, 10)] }, sort: ["dueDate", "asc"] },
    ],
});
```

| Opção | Efeito |
|---|---|
| `sort` | A ordenação padrão: uma chave e direção, ou várias em sequência. |
| `defaultFilter` | O filtro a partir do qual o visitante começa, e que pode ser alterado. |
| `fixedFilter` | Um filtro que o visitante não pode alterar. Filtros aplicados em outros campos são combinados com ele. |
| `filterPresets` | Filtros de um clique na barra de ferramentas: `{ label?, filterValues, sort? }`. Sem um rótulo, um é gerado a partir do filtro. |
| `pagination` | Carrega em páginas (`true` ou o tamanho da página), ou tudo de uma vez (`false`). |

Cada chave é verificada em relação aos campos da tabela. O próprio `filterOperators` de um campo
restringe o que pode ser filtrado nele, e `[]` desativa a filtragem nesse campo.

Um `fixedFilter` restringe o que o CMS *solicita*. Não se trata de uma barreira de segurança: o que um
solicitante pode ler é decidido pelo [row-level security](/docs/collections/security-rules/)
da tabela, para cada chamador.

## Próximos passos

<span class="since-badge" data-since="0.31">Desde 0.31</span>

- [customizeTable](/docs/frontend/customize-table/): todas as opções
- [Personalizando o admin](/docs/frontend/customizing/): seus próprios modos de visualização, páginas e ações
- [Entity views](/docs/frontend/entity-views/): abas em um registro
- [Entity actions](/docs/frontend/entity-actions/): botões em um registro
