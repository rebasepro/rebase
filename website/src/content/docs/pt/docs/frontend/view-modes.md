---
sourceHash: 68aa6b76fbe1dd6b
title: Modos de Visualização
sidebar_label: Modos de Visualização
description: "Mostre as linhas de uma tabela como lista, planilha, cards ou quadro kanban; escolha o que preenche o título, imagem, status e data de cada registro; e defina a ordenação padrão, filtros e predefinições de filtro com um clique."
---

Cada coleção pode ser exibida de quatro maneiras, a partir do seletor em sua barra de ferramentas:

- **Table**: uma planilha virtualizada com edição inline, ordenação, filtragem
  e seleção múltipla. Onde uma coleção é aberta por padrão, a menos que configurado de outra forma.
- **List**: uma linha por registro, com sua imagem, título, subtítulo, status e
  data.
- **Cards**: uma grade de cards, ideal para conteúdo rico em imagens.
- **Kanban**: um quadro agrupado por uma coluna com um conjunto fechado de valores.

Uma coleção também pode oferecer modos de visualização criados por você (um calendário, um mapa, uma
galeria) no mesmo seletor, controlados pela mesma barra de ferramentas: consulte
[Modos de visualização personalizados](/docs/frontend/extending#custom-view-modes).

## Escolhendo as visualizações

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
    },
});
```

| Opção | Efeito |
|---|---|
| `defaultViewMode` | Onde o visitante aterrissa: `"table"`, `"list"`, `"cards"`, `"kanban"` ou a chave de uma visualização personalizada. |
| `enabledViews` | As visualizações que o seletor oferece. |
| `kanban` | `{ columnField, orderField }`: o quadro. |
| `defaultSize` | A altura da linha, abaixo. |
| `customViews` | Visualizações próprias, por valor ou por chave. |

### Altura da linha

| `defaultSize` | Pixels | Melhor para |
|------|--------|----------|
| `"xs"` | 36 | Tabelas de dados densas |
| `"s"` | 42 | Linhas de texto compactas |
| `"m"` | 48 | Padrão |
| `"l"` | 96 | Miniaturas de imagem médias |
| `"xl"` | 160 | Miniaturas de imagem grandes |

## Kanban

`kanban.columnField` indica a coluna pela qual o quadro é agrupado. Ela deve conter
um conjunto fechado de strings, um `col.enum([...])` ou uma coluna de texto com
`.oneOf([...])`; qualquer outra coisa resulta em erro de tipo. As colunas são renderizadas na
ordem própria da coluna ou em `enumOrder`, com os rótulos e cores de
`enumLabels`. Arrastar um card para outra coluna atualiza o `columnField`.

`kanban.orderField` indica onde a posição de um card **dentro** de uma coluna é armazenada.
Declare-o sempre que essa ordem importar: três erros comuns aqui produzem um quadro
que parece configurado, mas não está.

**Sem `orderField`, apenas a coluna é mantida.** Um card ainda pode ser arrastado entre
colunas, porque isso atualiza `columnField`, que é tudo o que um quadro de status precisa.
Sua posição dentro de uma coluna não tem onde ser armazenada, portanto, ela é redefinida na
próxima leitura. O quadro avisa sobre isso na primeira vez em que um card é solto em uma nova
posição na sua própria coluna, em uma barra que pode ser dispensada; um quadro cujos cards só
se movem entre colunas não exibe nada.

**A coluna deve ser de texto.** A reordenação grava uma chave de
[fractional-indexing](https://github.com/rocicorp/fractional-indexing)
(`"i0"`, `"i1"`, `"i0i"`), e não um índice. Uma coluna numérica nunca pode conter esse valor, então
`orderField` aceita apenas uma coluna de texto. Trata-se de um mecanismo interno, não de conteúdo, então
defini-la em `orderField` a oculta da tabela e a desativa no formulário.
Uma entrada em `fields.__order` ainda pode sobrescrever qualquer um dos dois: `hidden: false` a torna visível.

**Linhas criadas fora do CMS chegam sem uma chave.** Nada atribui uma durante
a inserção. Uma linha gravada por um cron, um script de seed, uma migração ou pela API REST
chega com `__order` nulo, e o quadro exibe *"Some items don't have order
values"* acompanhado de um botão **Initialize**. Um clique preenche a primeira página, e
a próxima execução do cron traz a barra de volta imediatamente. Se um backend cria linhas para
um quadro, ele próprio deve anexar a chave, usando o alfabeto adotado pelo CMS:

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

Linhas criadas por meio do formulário também chegam sem chave; a única diferença é que
você vê a barra no momento em que adiciona uma. **Initialize** é a solução nesse caso; em um
quadro alimentado por um backend, é uma solução que se desfaz a cada execução.

## Slots de exibição

Toda superfície que renderiza um registro utiliza alguns de seis slots: **title**,
**subtitle**, **image**, **status**, **date** e **tags**. Uma linha de lista é imagem +
título + subtítulo + status + data; um card é a mesma coisa com a imagem no topo; um
seletor de referência é título + subtítulo; e o cabeçalho de uma página é apenas o título.

O CMS preenche alguns slots a partir das colunas da tabela (consulte
[slots de exibição padrão](/docs/collections/#display-slots)). A propriedade `display` define qualquer
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

Um slot não especificado mantém seu valor derivado.

Um resolver recebe `{ row, id, context }`. `row` é o registro exatamente como enviado pelo servidor,
tipado de acordo com a linha da tabela: datas como strings ISO, um belongsTo como sua
coluna de chave estrangeira. `id` é sua chave primária como string, com as partes de uma chave composta
unidas por `:::`. Uma relação carregada pelo CMS chega aninhada sob seu nome, da mesma forma que o
`include` do REST a retorna, permitindo que um resolver leia o campo de um registro relacionado sem
fazer uma requisição adicional.

Um resolver pode ser `async`, para buscar algo que o registro não contenha. Enquanto
a promise estiver pendente, a interface exibe o valor derivado e o substitui pelo valor
resolvido assim que este estiver disponível: um título nunca exibe um indicador de carregamento (spinner). Os resultados
são armazenados em cache por registro e slot, e requisições concorrentes compartilham a mesma chamada.

Retorne `undefined` quando um registro não tiver nada para o slot; a interface recorrerá
ao valor de fallback padrão (um cabeçalho usa o nome da coleção no singular, um link usa o id). Um resolver
que lança um erro é tratado como `undefined` e registrado em log uma única vez.

Prefira usar um caminho sempre que o valor estiver no registro: um caminho preserva a renderização nativa
do campo, de modo que um status do tipo enum continua sendo um chip colorido e uma data permanece formatada,
algo que um resolver que retorna uma string não consegue fazer.

Quando nenhum slot define o título, o CMS escolhe um a partir dos campos de texto da própria tabela.
Com `fieldOrder`, será o primeiro campo nessa ordem apto a ser um título.
Caso contrário, os candidatos são classificados por prioridade: textos cuja chave dê nome a um rótulo (`name`,
`title`, `label`…) primeiro, seguidos por texto curto, e-mail, enum, texto longo e
seletor de usuário. Chaves, colunas uuid, chaves estrangeiras, relações, referências, documentos JSON,
campos de arquivo e campos ocultos nunca se qualificam: uma relação nomeia outro
registro, portanto um cliente pertencente a uma agência nunca terá o nome da agência como título.
Uma tabela sem nenhum desses campos terá seu id como título. Um nome que resida
dentro de uma coluna JSON, ou uma relação que realmente represente o nome da linha (uma linha de
junção), pode ser configurada com `display.title`: `title: "data.name"`,
`title: "agency"`. Qualquer que seja o valor contido no título, ele é renderizado como texto: uma data formatada,
um array concatenado, e uma relação com o título de sua linha correspondente, recorrendo
ao seu id como fallback.

## Filtros, predefinições e ordenação

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
| `defaultFilter` | O filtro inicial para o visitante, que pode ser alterado. |
| `fixedFilter` | Um filtro que o visitante não pode alterar. Filtros aplicados em outros campos são combinados com ele. |
| `filterPresets` | Filtros de um clique na barra de ferramentas: `{ label?, filterValues, sort? }`. Sem um rótulo, um será gerado a partir do filtro. |
| `pagination` | Carregar em páginas (`true`, ou o tamanho da página), ou tudo de uma vez (`false`). |

Cada chave é verificada em relação aos campos da tabela. A propriedade `filterOperators` do próprio
campo restringe o que pode ser filtrado nele, e `[]` desativa a filtragem para esse campo.

Um `fixedFilter` restringe o que o CMS *solicita*. Ele não é uma barreira de segurança: o que um
chamador pode ler é determinado pelas
[regras de segurança em nível de linha (row-level security)](/docs/collections/security-rules/) da tabela, para qualquer chamador.

## Próximos passos

- [customizeTable](/docs/frontend/customize-table/): todas as opções
- [Personalizando o admin](/docs/frontend/customizing/): seus próprios modos de visualização, páginas e ações
- [Entity views](/docs/frontend/entity-views/): abas em um registro
- [Entity actions](/docs/frontend/entity-actions/): botões em um registro
