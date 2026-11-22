---
sourceHash: 94cc15a104ed93ec
title: Modos de Visualização
sidebar_label: Modos de Visualização
description: "Exiba as linhas de uma tabela como lista, planilha, cards ou quadro kanban; escolha o que preenche o título, imagem, status e data de cada registro; e defina ordenação padrão, filtros e predefinições de filtro com um clique."
---

Cada coleção pode ser exibida de quatro formas, a partir do seletor em sua barra de ferramentas:

- **Tabela**: uma planilha virtualizada com edição inline, ordenação, filtragem
  e seleção múltipla. Onde uma coleção abre, a menos que instruído de outra forma.
- **Lista**: uma linha por registro, com sua imagem, título, subtítulo, status e
  data.
- **Cards**: uma grade de cards, para conteúdo rico em imagens.
- **Kanban**: um quadro agrupado por uma coluna com um conjunto fechado de valores.

Uma coleção também pode oferecer modos de visualização criados por você (um calendário, um mapa,
uma galeria) no mesmo seletor, controlados pela mesma barra de ferramentas: consulte
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
        __order: { hidden: true },
    },
});
```

| Opção | Efeito |
|---|---|
| `defaultViewMode` | Onde o visitante aterrissa: `"table"`, `"list"`, `"cards"`, `"kanban"` ou a chave de uma visualização personalizada. |
| `enabledViews` | As visualizações que o seletor oferece. |
| `kanban` | `{ columnField, orderField }`: o quadro. |
| `defaultSize` | A altura da linha, veja abaixo. |
| `customViews` | Visualizações personalizadas criadas por você, por valor ou por chave. |

### Altura da linha

| `defaultSize` | Pixels | Recomendado para |
|------|--------|------------------|
| `"xs"` | 36 | Tabelas de dados densas |
| `"s"` | 42 | Linhas de texto compactas |
| `"m"` | 48 | Padrão |
| `"l"` | 96 | Miniaturas de imagem médias |
| `"xl"` | 160 | Miniaturas de imagem grandes |

## Kanban

`kanban.columnField` define o nome da coluna pela qual o quadro é agrupado. Ela deve conter
um conjunto fechado de strings, um `col.enum([...])` ou uma coluna de texto com
`.oneOf([...])`; qualquer outra coisa gerará um erro de tipo. As colunas são renderizadas
na ordem própria da coluna, ou em `enumOrder`, com os rótulos e cores de
`enumLabels`. Arrastar um card para outra coluna atualiza o `columnField`.

`kanban.orderField` define onde a posição de um card **dentro** de uma coluna é armazenada.
Declare-o sempre que essa ordem importar: três erros comuns aqui produzem um quadro
que parece configurado, mas não está.

**Sem `orderField`, apenas a coluna é mantida.** Um card ainda pode ser arrastado entre
colunas, porque isso atualiza o `columnField`, que é tudo o que um quadro de status precisa.
Sua posição dentro de uma coluna não tem onde ser armazenada, portanto, é redefinida na
próxima leitura. O quadro avisa sobre isso na primeira vez em que um card é solto em um novo
local em sua própria coluna, em uma barra que pode ser dispensada; um quadro cujos cards
se movem apenas entre colunas não exibe nada.

**A coluna deve ser do tipo texto.** A reordenação grava uma chave de
[fractional-indexing](https://github.com/rocicorp/fractional-indexing)
(`"i0"`, `"i1"`, `"i0i"`), e não um índice numérico. Uma coluna numérica nunca pode armazenar isso,
portanto `orderField` aceita apenas colunas de texto. Trata-se de uma engrenagem interna, não de
conteúdo: oculte-a, como mostrado acima.

**Linhas criadas fora do CMS chegam sem uma chave.** Nada atribui uma durante
a inserção. Uma linha gravada por um cron, um script de seed, uma migração ou pela API REST
chega com `__order` nulo, e o quadro exibe *"Some items don't have order
values"* acompanhado de um botão **Initialize**. Um único clique preenche a primeira página
retroativamente, mas a próxima execução do cron trará a barra de volta. Se um backend cria
linhas para um quadro, ele mesmo deve anexar a chave, usando o alfabeto utilizado pelo CMS:

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
quadro alimentado por um backend, é uma solução temporária que se desfaz a cada execução.

## Slots de exibição

Toda superfície que renderiza um registro utiliza alguns dos seis slots: **title**,
**subtitle**, **image**, **status**, **date** e **tags**. Uma linha de lista é image +
title + subtitle + status + date, um card é o mesmo com a imagem no topo, um
seletor de referência é title + subtitle e o cabeçalho de uma página é apenas o title.

O CMS preenche alguns slots a partir das colunas da tabela (consulte
[slots de exibição padrão](/docs/collections/#display-slots)). A propriedade `display` define qualquer
um deles, seja como o caminho de um campo ou como uma função:

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

Um slot omitido mantém seu valor derivado.

Um resolver recebe `{ row, id, context }`. `row` é o registro conforme o servidor
o envia, tipado como a linha da tabela: datas como strings ISO, um belongsTo como sua
coluna de chave estrangeira. `id` é sua chave primária como string, com as partes de uma
chave composta unidas por `:::`. Uma relação carregada pelo CMS chega aninhada sob seu nome,
assim como o `include` do REST retorna, permitindo que um resolver leia o campo de um
registro relacionado sem fazer uma requisição própria.

Um resolver pode ser `async`, para ler algo que o registro não contém diretamente. Enquanto
a promise estiver pendente, a superfície exibe o valor derivado e o substitui pelo valor
resolvido quando ele chegar: um título nunca exibe um indicador de carregamento (spinner). Os resultados
são armazenados em cache por registro e slot, e requisições concorrentes compartilham a mesma chamada.

Retorne `undefined` quando um registro não tiver nada para o slot; a superfície recorrerá
ao que ela conhece como fallback (um cabeçalho usa o nome da coleção no singular, um link usa
o id). Um resolver que lança um erro é tratado como `undefined` e registrado no log uma única vez.

Dê preferência a um caminho sempre que o valor estiver no registro: um caminho mantém a
renderização própria do campo, de modo que um status enum permaneça como uma tag colorida (chip)
e uma data permaneça formatada, o que um resolver retornando uma string não consegue fazer.

Quando nenhum slot define o title, o CMS escolhe um a partir do próprio texto da tabela.
Com `fieldOrder`, é escolhido o primeiro campo nessa ordem que possa ser um título.
Caso contrário, os candidatos são classificados: textos cuja chave contenha um rótulo (`name`,
`title`, `label`…) primeiro, seguidos por texto curto, email, enum, texto longo e um
seletor de usuário. Chaves primárias, colunas uuid, chaves estrangeiras, relações, referências,
documentos JSON, campos de arquivo e campos ocultos nunca se qualificam: uma relação referencia
outro registro, portanto um cliente que pertence a uma agência nunca terá como título o nome da
agência. Uma tabela que não possua nenhum desses campos terá como título o seu id. Um nome que resida
dentro de uma coluna JSON, ou uma relação que realmente represente o nome da linha (uma
linha de junção), é configurado com `display.title`: `title: "data.name"`,
`title: "agency"`. Seja o que for que o título contenha, ele será renderizado como texto: uma data formatada,
um array concatenado e uma relação exibida como o título da linha relacionada, recorrendo
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
| `defaultFilter` | O filtro inicial do visitante, que pode ser alterado por ele. |
| `fixedFilter` | Um filtro que o visitante não pode alterar. Filtros aplicados em outros campos são combinados com ele. |
| `filterPresets` | Filtros de um clique na barra de ferramentas: `{ label?, filterValues, sort? }`. Sem um rótulo, um será gerado a partir do filtro. |
| `pagination` | Carregar em páginas (`true`, ou o tamanho da página) ou tudo de uma vez (`false`). |

Cada chave é validada contra os campos da tabela. A propriedade `filterOperators` do próprio
campo restringe o que pode ser filtrado nele, e `[]` desativa a filtragem para esse campo.

Um `fixedFilter` restringe o que o CMS *solicita*. Ele não é uma barreira de segurança: o que um
chamador pode ler é decidido pelo [row-level security](/docs/collections/security-rules/)
da tabela, para cada chamador.

## Próximos passos

- [customizeTable](/docs/frontend/customize-table/): todas as opções
- [Personalizando o admin](/docs/frontend/customizing/): seus próprios modos de visualização, páginas e ações
- [Visualizações de entidade](/docs/frontend/entity-views/): abas em um registro
- [Ações de entidade](/docs/frontend/entity-actions/): botões em um registro
