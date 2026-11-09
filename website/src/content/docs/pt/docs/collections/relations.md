---
sourceHash: 86856f16dce196a2
title: Relações
sidebar_label: Relações
description: Defina relações SQL um-para-um, um-para-muitos e muitos-para-muitos entre collections com chaves estrangeiras, tabelas de junção e junções multi-hop.
---

## Visão Geral

As relações definem como as collections são conectadas no nível do banco de dados. Elas permitem que o Rebase:

- Renderize **campos seletores de relação** em formulários de entidade
- Resolva **entidades relacionadas** ao exibir pré-visualizações
- Gere **restrições de chave estrangeira** no schema do Drizzle
- Suporte comportamentos de **exclusão/atualização em cascata**

As relações podem ser definidas de forma inline dentro da propriedade, ou explicitamente no array `relations` de uma collection:

### 1. Relações Inline (Recomendado)

Declare o vínculo na propriedade, aninhado sob `relation`. Escolha o `kind` e o tipo oferece exatamente os campos de que esse tipo precisa.

```typescript
import { defineCollection } from "@rebasepro/cms-types";
const postsCollection = defineCollection({
    slug: "posts",
    name: "Posts",
    table: "posts",
    properties: {
        title: { type: "string", name: "Title" },
        content: { type: "string", name: "Content", admin: { multiline: true } },
        author: {
            type: "relation",
            name: "Author",
            relation: {
                kind: "belongsTo",
                target: () => usersCollection
            }
        }
    }
});
```

### 2. Array Explícito de Relações

Para um vínculo sem uma propriedade própria — sem nada para nomeá-lo no formulário ou em uma coluna da tabela — declare-o em `relations`:

```typescript
import { defineCollection } from "@rebasepro/cms-types";
const usersCollection = defineCollection({
    slug: "users",
    name: "Users",
    table: "users",
    properties: {
        name: { type: "string", name: "Name" }
    },
    relations: [
        {
            kind: "hasMany",
            relationName: "posts",
            target: () => postsCollection
        }
    ]
});
```

## Os cinco tipos

Uma relação é de um de cinco tipos (`kind`). O tipo decide onde a chave reside, se retorna uma ou muitas linhas, e o que uma escrita através dela pode afetar.

| Tipo | A chave reside | Retorna | Notas |
|---|---|---|---|
| `belongsTo` | **nesta** tabela | uma | `localKey`, o padrão é `<relationName>_id` |
| `hasOne` | na tabela do **alvo** | uma | `foreignKeyOnTarget`, o padrão é o singular desta collection seguido de `_id` (`users` → `user_id`) |
| `hasMany` | na tabela do **alvo** | muitas | os filhos pertencem apenas a este pai |
| `manyToMany` | em uma **tabela de junção** | muitas | as linhas são compartilhadas; você possui o vínculo |
| `via` | um `joinPath` explícito | qualquer um | gravável quando single-hop, somente leitura caso contrário; defina a `cardinality` você mesmo |

Cada campo é opcional, exceto `kind` e `target` (e, em `via`, `cardinality` e `joinPath`) — o restante é derivado.

### belongsTo — a chave está nesta tabela

```typescript
author: {
    type: "relation",
    name: "Author",
    relation: { kind: "belongsTo", target: () => usersCollection }
}
// → posts.author_id
```

A coluna é indexada para você: o Postgres indexa a chave para a qual uma chave estrangeira aponta, nunca a coluna que a contém, portanto, sem isso, cada inclusão `hasMany` e listagem aninhada do outro lado faz uma varredura nesta tabela. `index: false` mantém a restrição e remove o índice — consulte [Foreign keys are indexed for you](/docs/backend/indexes#foreign-keys-are-indexed-for-you) para saber quando isso vale a pena e quando o Rebase o ignora por conta própria porque outro índice já atende à coluna.

### hasMany / hasOne — a chave está na tabela deles

```typescript
relations: [
    { kind: "hasMany", relationName: "posts", target: () => postsCollection }
]
// → reads posts.user_id
```

`hasOne` é o mesmo vínculo com no máximo uma linha do outro lado.

#### Fazendo junção em uma chave natural

Por padrão, a chave estrangeira do alvo contém o **id** da linha de origem. Quando os dois lados são unidos por algo diferente — um ID de identidade externa, um SKU, um slug de tenant — nomeie essa coluna com `sourceKey`:

```typescript
relations: [
    {
        kind: "hasMany",
        relationName: "applications",
        target: () => applicationsCollection,
        sourceKey: "auth_user_id",          // column on THIS table
        foreignKeyOnTarget: "auth_user_id"  // column on the TARGET's table
    }
]
// → reads applications.auth_user_id = talents.auth_user_id
```

`sourceKey` é o espelho de `localKey` em `belongsTo`: aquele nomeia a coluna de onde este lado lê (*from*), este nomeia a coluna para a qual o outro lado aponta (*at*). Sem ele, um vínculo como o acima não pode ser expresso como `hasMany` e precisa recorrer a [`via`](#via--uma-cadeia-explícita-de-junção), que é somente leitura para uma cadeia como esta.

A coluna deve ser única. Um vínculo que aborda mais de uma linha de origem não pode indicar a qual delas uma linha relacionada pertence, e o Postgres também não aceitará uma chave estrangeira contra uma coluna não única. O Rebase verifica isso no momento da leitura e recusa a operação em vez de escolher uma.

Um pai cujo `sourceKey` seja `NULL` não alcança nenhuma linha, e escrever através da relação resulta em erro — não há nada para o qual as linhas relacionadas possam apontar.

### manyToMany — através de uma junção

```typescript
tags: {
    type: "relation",
    name: "Tags",
    relation: { kind: "manyToMany", target: () => tagsCollection }
}
// → junction `posts_tags` (both table names, sorted), columns post_id / tag_id
```

Ambos os lados declaram o seu próprio, e cada um escreve `through` **do seu próprio ponto de vista** — `sourceColumn` sempre nomeia *esta* collection:

```typescript
// on posts
{ kind: "manyToMany", relationName: "tags", target: () => tagsCollection,
  through: { table: "posts_tags", sourceColumn: "post_id", targetColumn: "tag_id" } }

// on tags
{ kind: "manyToMany", relationName: "posts", target: () => postsCollection,
  through: { table: "posts_tags", sourceColumn: "tag_id", targetColumn: "post_id" } }
```

### via — uma cadeia explícita de junção

Para vínculos que as quatro formas acima não conseguem expressar: caminhos multi-hop, chaves compostas ou uma junção cuja condição não seja uma simples chave estrangeira.

Uma cadeia **single-hop** (de salto único) é gravável por meio de uma criação ou atualização, da mesma forma que o tipo que ela substitui é gravado:

- uma cadeia **para-um** de **uma etapa** — a linha de destino contém a chave, portanto `{ badge: "b-1" }` aponta a coluna daquela linha para esta, e `null` remove o vínculo, como faz uma gravação de `hasOne`;
- uma cadeia **para-muitos** de **duas etapas através de uma tabela** intermediária — essa tabela contém os vínculos, portanto `{ tags: ["t-1", "t-2"] }` define-os como suas linhas, como faz uma gravação de `manyToMany` (um `via` não carrega `_pivot`).

Qualquer coisa mais longa é **somente leitura**: o Rebase não deduzirá como escrever através de uma cadeia arbitrária. Uma criação ou atualização que mencione uma será recusada com `400 RELATION_NOT_WRITABLE`, e o formulário de administração exibirá o campo sem um seletor. Uma gravação aninhada (`PATCH users/1/permissions/3`) através de qualquer `via` é recusada da mesma forma.

```typescript
{
    kind: "via",
    relationName: "permissions",
    target: () => permissionsCollection,
    cardinality: "many",
    joinPath: [
        { table: "user_roles",       on: { from: "id",            to: "user_id" } },
        { table: "role_permissions", on: { from: "role_id",       to: "role_id" } },
        { table: "permissions",      on: { from: "permission_id", to: "id" } }
    ]
}
```

## Propriedades de Relação

Para renderizar um campo de relação em um formulário, adicione uma propriedade com `type: "relation"`:

```typescript
properties: {
    author: {
        type: "relation",
        name: "Author",
        relation: { kind: "belongsTo", target: () => usersCollection },
        // Which control draws it is presentation, so it goes in the admin block:
        // "select" (dropdown) or "dialog" (full picker).
        admin: { widget: "select" }
    }
}
```

Ao renderizar uma pré-visualização (como em uma célula de tabela ou chip de referência), o Rebase lida com a hidratação automaticamente.

### Para-um ganha um seletor, muitos ganha uma aba

A cardinalidade decide a superfície, e apenas uma superfície é utilizada:

- **`belongsTo` / `hasOne`** — uma linha, portanto a propriedade é uma chave estrangeira que o autor edita. Ela é renderizada como o seletor acima.
- **`hasMany` / `manyToMany`** — muitas linhas, portanto a visualização da entidade as lista como uma **aba** própria. A propriedade não é renderizada no formulário: os filhos de uma collection são uma lista, não um valor que o registro contém, e selecioná-los a partir de um dropdown não é algo que o formulário possa oferecer de maneira significativa.

Declarar uma relação muitos como propriedade ainda vale a pena — é o que dá nome à aba e o que dá à relação uma coluna na tabela da collection, a qual a busca de lista hidrata para que as linhas filhas apareçam como chips na linha. Apenas o campo do formulário é omitido.

Na tabela, uma relação com uma propriedade própria ganha **uma** coluna: a sua própria. Toda aba também tem uma coluna com botão de atalho para a aba, mas para uma relação declarada como propriedade esse botão repetiria o mesmo cabeçalho ao lado de uma coluna que já exibe os filhos, portanto ele é omitido. Oculte a coluna da relação (`admin: { hideFromCollection: true }`) e o botão reaparece, para que a relação nunca fique de fora da tabela por completo.

Ocultar a coluna não interrompe a busca. A leitura de lista da collection embute cada relação que uma propriedade declara, oculta ou não, de modo que o código que lê as linhas da lista — `additionalFields`, resolvedores de exibição, ações de entidade, ações de collection através de `tableController.rows`, slots de plugin — encontra as linhas relacionadas ali, aninhadas sob o nome da relação conforme retornado pelo `include` do REST, ao lado da coluna da chave estrangeira. Uma função `browserCallbacks.afterRead` recebe a mesma linha. Uma relação declarada apenas no array `relations` da collection, sem nenhuma propriedade, não é embutida na lista; suas linhas são carregadas quando sua aba é aberta.

Se quiser o seletor inline mesmo assim, solicite-o:

```typescript
properties: {
    tags: {
        type: "relation",
        name: "Tags",
        relation: { kind: "manyToMany", target: () => tagsCollection },
        admin: { renderInForm: true }   // off by default; the tab is the default treatment
    }
}
```

## Junções Multi-Hop

Para relacionamentos que percorrem várias tabelas, use `kind: "via"` com um `joinPath`. Uma cadeia mais longa do que um link é somente leitura: o Rebase não deduzirá como escrever através de uma cadeia arbitrária (consulte [via](#via--uma-cadeia-explícita-de-junção) para as cadeias single-hop em que ele grava).

```typescript
// Users → Permissions through Roles
relations: [
    {
        kind: "via",
        relationName: "permissions",
        target: () => permissionsCollection,
        cardinality: "many",
        joinPath: [
            {
                table: "user_roles",
                on: { from: "id", to: "user_id" }
            },
            {
                table: "roles",
                on: { from: "role_id", to: "id" }
            },
            {
                table: "role_permissions",
                on: { from: "id", to: "role_id" }
            },
            {
                table: "permissions",
                on: { from: "permission_id", to: "id" }
            }
        ]
    }
]
```

### Junções com Chaves Compostas

```typescript
joinPath: [
    {
        table: "customers",
        on: {
            from: ["company_code", "region_id"],  // Multiple columns
            to: ["code", "region_id"]
        }
    }
]
```

### Correspondendo a qualquer uma de duas colunas

Uma lista em `on` une uma linha que atende a **qualquer uma** das condições — um vínculo mantido em `a` ou `b`. É **somente leitura**.

```typescript
joinPath: [{ table: "friendships", on: [{ from: "id", to: "a" }, { from: "id", to: "b" }] }]
```

Adicionar uma segunda etapa para `people` (`on: [{ from: "a", to: "id" }, { from: "b", to: "id" }]`) também faz a correspondência com a própria coluna do pai, de modo que cada pessoa retorna como sua própria amiga: liste as linhas de amizade ou filtre a pessoa.

## Regras de Cascata

Controle o que acontece quando entidades relacionadas são atualizadas ou excluídas:

```typescript
relations: [
    {
        kind: "belongsTo",
        relationName: "author",
        target: () => usersCollection,
        localKey: "author_id",
        onDelete: "cascade",    // Delete posts when user is deleted
        onUpdate: "cascade"     // Update FK when user ID changes
    }
]
```

| Ação | Comportamento |
|--------|----------|
| `"cascade"` | Propaga a alteração para as linhas relacionadas |
| `"restrict"` | Impede a operação se existirem linhas relacionadas |
| `"no action"` | O mesmo que restrict (posterga para a verificação de restrição) |
| `"set null"` | Define a coluna de FK como NULL |
| `"set default"` | Define a coluna de FK para o seu valor padrão |

### O que você obtém quando não especifica nada

`onDelete` é opcional, portanto a maioria das relações nunca define um. O padrão depende de a relação ser obrigatória ou não:

| Relação | `onDelete` padrão |
|--------|----------|
| `belongsTo`, opcional | `"set null"` — o ponteiro é esvaziado |
| `belongsTo`, `validation: { required: true }` | `"restrict"` — a exclusão do pai falha |
| `manyToMany` (linhas de junção) | `"cascade"` — o vínculo é removido, o destino permanece |

Uma relação obrigatória **não** é uma cascata. `required` diz que um filho não pode existir sem um pai; não diz que excluir o pai deve destruir o filho. Essas são afirmações diferentes, e apenas uma delas remove linhas que você não especificou. Portanto, o padrão falha a exclusão e indica a restrição, e `"cascade"` é algo que você solicita explicitamente:

```typescript
{
    kind: "belongsTo",
    relationName: "order",
    target: () => ordersCollection,
    // A line item is meaningless without its order — say so.
    onDelete: "cascade"
}
```

`onUpdate` não tem valor padrão: sem nada definido, o Postgres aplica `NO ACTION`. Defina `"cascade"` quando a chave do destino for algo que uma pessoa pode editar — um slug, um SKU — para que os ponteiros a acompanhem.

## Buscando Relações no SDK

Ao consultar dados através do SDK tipado do Rebase, as relações **não** são incluídas por padrão. Use o método `include()` para solicitar entidades relacionadas junto com os dados principais.

### Incluir relações específicas

```typescript
const { data } = await client.data.articles
    .include("author", "categories")
    .find();
```

### Incluir todas as relações

```typescript
const { data } = await client.data.articles
    .include("*")
    .find();
```

### Usando a sintaxe de parâmetros

```typescript
const { data } = await client.data.articles.find({
    include: ["author", "categories"]
});
```

### Estrutura da resposta

Quando incluída, a resposta contém tanto a **chave estrangeira escalar** quanto o **objeto da relação hidratado**:

```typescript
const { data } = await client.data
    .collection<{ id: string; authorId: string; author?: { name: string } }>("articles")
    .include("author")
    .find();

// The SDK returns flat rows — there is no `.values` wrapper. (`Entity`, with
// `id`/`path`/`values`, is an admin-UI view model, not what the client hands back.)
for (const article of data) {
    // Scalar FK — always present
    article.authorId;     // "uuid-1234"

    // Hydrated relation — only present when included
    article.author?.name;  // "Jane Doe"
}
```

> Os nomes das relações passados para `include()` devem corresponder ao nome da relação: o `relationName` de uma entrada no array `relations` da collection, ou a chave da propriedade que a declara inline.

Para a referência completa do construtor de consultas (filtragem, ordenação, paginação, tempo real), consulte a [documentação do SDK tipado](/docs/sdk).

## Relações no painel de administração

Toda relação para-muitos (`hasMany`, `manyToMany` ou um `via` para-muitos) torna-se uma aba sob um registro no painel de administração, endereçada pelo nome da relação. [Relações no painel de administração](/docs/collections/relations-in-the-admin-panel/) aborda os caminhos, o que uma aba cria, vincula, desvincula ou exclui, as mesmas regras sobre REST, e o que não se torna uma aba.

## Interface Completa de Relação

`Relation` é uma união fechada — um membro por tipo, cada um carregando apenas os campos que esse tipo possui. Não há combinação de campos que descreva dois vínculos diferentes, e nenhum campo que você possa definir que o tipo não utilize.

```typescript
type Relation =
    | BelongsToRelation
    | HasOneRelation
    | HasManyRelation
    | ManyToManyRelation
    | ViaRelation;

interface RelationBase {
    relationName?: string;          // defaults to the property key, then the target's slug
    target: () => CollectionConfig;
    onUpdate?: OnAction;
    onDelete?: OnAction;
    overrides?: Partial<CollectionConfig>;   // applied when rendered as a tab
}
// `required` is not here. It is `validation: { required: true }` on the
// property that declares the relation, the same key every other field uses.

interface BelongsToRelation extends RelationBase {
    kind: "belongsTo";
    localKey?: string;              // column on THIS table
    index?: boolean;                // btree on localKey; defaults to true
}

interface HasOneRelation extends RelationBase {
    kind: "hasOne";
    foreignKeyOnTarget?: string;    // column on the TARGET's table
    sourceKey?: string;             // column on THIS table; defaults to the primary key
}

interface HasManyRelation extends RelationBase {
    kind: "hasMany";
    foreignKeyOnTarget?: string;    // column on the TARGET's table
    sourceKey?: string;             // column on THIS table; defaults to the primary key
}

interface ManyToManyRelation extends RelationBase {
    kind: "manyToMany";
    through?: {
        table?: string;
        sourceColumn?: string;
        targetColumn?: string;
        properties?: Properties;    // extra columns on the junction row, served under `_pivot`
    };
}

interface ViaRelation extends RelationBase {
    kind: "via";
    cardinality: "one" | "many";    // a join chain cannot imply it
    joinPath: JoinStep[];
}
```

### A forma resolvida

O que você escreve acima é o formato de *autoria*. Internamente, o Rebase trabalha com `ResolvedRelation`: o mesmo vínculo com todos os padrões preenchidos e nada opcional, além de `cardinality`, `targetSlug` e duas flags — `writable` (false apenas para um `via` multi-hop ou com uma etapa correspondendo a qualquer uma de várias condições) e `shared` (true quando as linhas de destino pertencem também a outros pais, de modo que uma remoção apenas desvincula em vez de excluir).

`sourceKey` é a única exceção para "nada opcional": seu padrão é a chave primária da origem, e resolver isso precisa do schema do driver, o qual a resolução não possui. `undefined` ali significa "a chave primária" e nada mais.

Você nunca escreve um `ResolvedRelation`. Em uma propriedade de relação, `relation` é sua e `resolvedRelation` é a preenchida, carimbada durante a normalização.

## Próximos Passos

- **[Regras de Segurança](/docs/collections/security-rules)** — Row Level Security
- **[Propriedades](/docs/collections/properties)** — Referência de tipos de propriedades
