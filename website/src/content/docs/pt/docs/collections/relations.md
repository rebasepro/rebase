---
sourceHash: b8fb2609d1a27893
title: Relações
sidebar_label: Relações
description: Defina relações SQL um-para-um, um-para-muitos e muitos-para-muitos entre coleções com chaves estrangeiras, tabelas de junção e junções multi-salto.
---

## Visão Geral

Relações definem como as coleções são conectadas no nível do banco de dados. Elas permitem que o Rebase:

- Renderizar **campos de seleção de relação** em formulários de entidade
- Resolver **entidades relacionadas** ao exibir pré-visualizações
- Gerar **restrições de chave estrangeira** no esquema Drizzle
- Suportar comportamentos de **exclusão/atualização em cascata**

As relações podem ser definidas inline dentro da propriedade, ou explicitamente no array `relations` de uma coleção:

### 1. Relações Inline (Recomendado)

Declare o vínculo na propriedade, aninhado sob `relation`. Escolha o `kind` e o
tipo oferece exatamente os campos de que aquele kind precisa.

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

### 2. Array de Relações Explícitas

Para um vínculo sem propriedade própria — nada por que nomeá-lo no formulário
nem numa coluna de tabela — declare-o em `relations`:

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

## Os cinco kinds

Uma relação é de um dos cinco kinds. O kind decide onde a chave vive, se volta
uma linha ou muitas, e o que uma escrita através dela pode tocar.

| Kind | A chave vive | Retorna | Notas |
|---|---|---|---|
| `belongsTo` | **nesta** tabela | uma | `localKey`, padrão `<relationName>_id` |
| `hasOne` | na tabela do **destino** | uma | `foreignKeyOnTarget`, padrão `<thisCollection>_id` |
| `hasMany` | na tabela do **destino** | muitas | os filhos pertencem só a este pai |
| `manyToMany` | numa **tabela de junção** | muitas | as linhas são compartilhadas; o vínculo é seu |
| `via` | um `joinPath` explícito | qualquer | somente leitura; declare você mesmo a `cardinality` |

Todo campo é opcional exceto `kind` e `target` — o resto é derivado.

### belongsTo — a chave está nesta tabela

```typescript
author: {
    type: "relation",
    name: "Author",
    relation: { kind: "belongsTo", target: () => usersCollection }
}
// → posts.author_id
```

### hasMany / hasOne — a chave está na deles

```typescript
relations: [
    { kind: "hasMany", relationName: "posts", target: () => postsCollection }
]
// → reads posts.user_id
```

`hasOne` é o mesmo vínculo com no máximo uma linha do outro lado.

#### Juntar por uma chave natural

Por padrão a chave estrangeira do destino guarda o **id** da linha de origem.
Quando os dois lados são unidos por outra coisa — um id de identidade externa,
um SKU, um slug de inquilino — nomeie essa coluna com `sourceKey`:

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

`sourceKey` é o espelho de `localKey` em `belongsTo`: aquele nomeia a coluna de
que este lado lê, este nomeia a coluna para a qual o outro lado aponta. Sem ele,
um vínculo como o acima não é expressável como `hasMany` de forma alguma e tem de
recorrer a [`via`](#via--uma-cadeia-de-junções-explícita), que é somente
leitura.

A coluna precisa ser única. Um vínculo que endereça mais de uma linha de origem
não consegue dizer a qual uma linha relacionada pertence, e o Postgres também não
aceita uma chave estrangeira contra uma coluna não única. O Rebase verifica isso
no momento da leitura e recusa em vez de escolher uma.

Um pai cujo `sourceKey` é `NULL` não alcança nenhuma linha, e escrever através da
relação é um erro — não há nada para onde as linhas relacionadas apontarem.

### manyToMany — através de uma junção

```typescript
tags: {
    type: "relation",
    name: "Tags",
    relation: { kind: "manyToMany", target: () => tagsCollection }
}
// → junction `posts_tags` (both table names, sorted), columns post_id / tag_id
```

Os dois lados declaram o seu, e cada um escreve `through` **do seu próprio ponto
de vista** — `sourceColumn` sempre nomeia *esta* coleção:

```typescript
// on posts
{ kind: "manyToMany", relationName: "tags", target: () => tagsCollection,
  through: { table: "posts_tags", sourceColumn: "post_id", targetColumn: "tag_id" } }

// on tags
{ kind: "manyToMany", relationName: "posts", target: () => postsCollection,
  through: { table: "posts_tags", sourceColumn: "tag_id", targetColumn: "post_id" } }
```

### via — uma cadeia de junções explícita

Para vínculos que as quatro formas acima não conseguem expressar: caminhos de
vários saltos, chaves compostas, ou uma junção cuja condição não é uma chave
estrangeira simples. Somente leitura — o Rebase não vai inferir como escrever
através de uma cadeia arbitrária.

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

## Propriedades da Relação

Para renderizar um campo de relação em um formulário, adicione uma propriedade com `type: "relation"`:

```typescript
properties: {
    author: {
        type: "relation",
        name: "Author",
        relation: { kind: "belongsTo", target: () => usersCollection },
        widget: "select"           // "select" (dropdown) or "dialog" (full picker)
    }
}
```

Ao renderizar uma pré-visualização (como em uma célula de tabela ou um chip de referência), o Rebase lida com a hidratação automaticamente.

### Para-um ganha um seletor, muitos ganham uma aba

A cardinalidade decide a superfície, e só uma é usada:

- **`belongsTo` / `hasOne`** — uma linha, então a propriedade é uma chave
  estrangeira que o autor edita. Ela é renderizada como o seletor acima.
- **`hasMany` / `manyToMany`** — muitas linhas, então a visão da entidade as
  lista numa **aba** própria. A propriedade não é renderizada no formulário: os
  filhos de uma coleção são uma lista, não um valor que o registro guarda, e
  escolhê-los num menu suspenso não é algo que o formulário possa oferecer com
  sentido.

Declarar uma relação para-muitos como propriedade continua valendo a pena: é ela
que nomeia a aba, e que dá à relação uma coluna na tabela da coleção, que a busca
da lista hidrata para que as linhas filhas apareçam como chips na linha. Só o
campo de formulário é descartado.

Na tabela, uma relação com propriedade própria ganha **uma** coluna: a sua. Toda
aba tem também uma coluna com um botão de salto para a aba, mas numa relação
declarada por propriedade esse botão repetia o mesmo cabeçalho ao lado de uma
coluna que já mostrava os filhos, então ele é descartado. Oculte a coluna da
relação (`admin: { hideFromCollection: true }`) e o botão volta, de modo que a
relação nunca some de vez da tabela.

Se você quiser o seletor inline mesmo assim, peça por ele:

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

## Junções Multi-Salto

Para relações que atravessam várias tabelas, use `kind: "via"` com um
`joinPath`. Elas são somente leitura: o Rebase não vai inferir como escrever
através de uma cadeia arbitrária.

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

### Junções de Chave Composta

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
| `"cascade"` | Propaga a mudança para linhas relacionadas |
| `"restrict"` | Impede a operação se existirem linhas relacionadas |
| `"no action"` | O mesmo que restringir (adiar para verificação de restrição) |
| `"set null"` | Define a coluna FK como NULL |
| `"set default"` | Define a coluna FK para seu valor padrão |

### O que você obtém se não disser nada

<span class="since-badge" data-since="0.18">Since 0.18</span>

O padrão para um `belongsTo` **obrigatório** mudou. Em 0.17.3 é
`ON DELETE CASCADE` — eliminar um pai elimina os seus filhos — e a partir de 0.18
é `RESTRICT`: a eliminação falha e nomeia a restrição. Todo o resto desta secção
não muda, e `db push` planeia a reescrita da restrição na atualização.

`onDelete` é opcional, então a maioria das relações nunca nomeia um. O padrão
depende de a relação ser obrigatória:

| Relação | `onDelete` padrão |
|--------|----------|
| `belongsTo`, opcional | `"set null"` — o ponteiro é esvaziado |
| `belongsTo`, `validation: { required: true }` | `"restrict"` — a exclusão do pai falha |
| `manyToMany` (linhas de junção) | `"cascade"` — o vínculo vai, a linha de destino fica |

Uma relação obrigatória **não** é uma cascata. `required` diz que um filho não
pode existir sem um pai; não diz que excluir o pai deva destruir o filho. São
afirmações diferentes, e apenas uma delas remove linhas que você não nomeou. Por
isso o padrão faz a exclusão falhar e nomeia a restrição, e `"cascade"` é algo
que você pede de propósito:

```typescript
{
    kind: "belongsTo",
    relationName: "order",
    target: () => ordersCollection,
    // Um item de pedido não faz sentido sem o seu pedido — diga isso.
    onDelete: "cascade"
}
```

`onUpdate` não tem padrão: sem nada definido, o Postgres aplica `NO ACTION`.
Defina `"cascade"` quando a chave do destino for algo que uma pessoa pode editar
— um slug, um SKU — para que os ponteiros a acompanhem.

## Buscando Relações no SDK

Ao consultar dados através do Rebase Client SDK, as relações **não** são incluídas por padrão. Use o método `include()` para solicitar entidades relacionadas juntamente com os dados primários.

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

### Usando sintaxe de parâmetros

```typescript
const { data } = await client.data.articles.find({
    include: ["author", "categories"]
});
```

### Estrutura da resposta

Quando incluída, a resposta contém tanto a **chave estrangeira escalar** quanto o **objeto de relação hidratado**:

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

> Os nomes das relações passados para `include()` devem corresponder ao `relationName` definido no array `relations` da coleção.

Para a referência completa do construtor de consultas (filtragem, classificação, paginação, tempo real), consulte a [documentação do Client SDK](/docs/sdk).

## Relações no painel de administração

Toda relação para-muitos — `hasMany`, `manyToMany` ou um `via` para-muitos —
vira uma **aba** sob um registro no painel de administração, listando as linhas
que aquele registro alcança.

### O segmento de caminho é o nome da relação

Uma lista de filhos é endereçada como `parent/parentId/relationName`:

```
/c/authors/a-1/posts          the posts of author a-1
/c/posts/p-1/tags             the tags of post p-1
```

O último segmento é o **nome da relação**, não o slug da coleção de destino.
Muitas vezes são iguais, porque uma relação sem nome assume o slug do seu destino
— mas uma propriedade de relação inline assume a *chave da propriedade*:

```typescript
properties: {
    featuredTags: {
        type: "relation",
        relation: { kind: "manyToMany", target: () => tagsCollection }
    }
}
// tab and path segment: featuredTags   (not "tags")
```

É isso também que faz duas relações para a mesma coleção funcionarem: cada uma
tem o seu nome, então cada uma tem a sua aba e o seu caminho.

### Linhas próprias versus linhas compartilhadas

O que uma aba deixa você fazer depende de como a relação é armazenada, porque os
dois casos significam coisas diferentes:

| | Um-para-muitos (`foreignKeyOnTarget`) | Muitos-para-muitos (`through`) |
|---|---|---|
| O filho pertence a | só a este pai | a todo pai que o vincula |
| Criar | cria a linha sob este pai | cria a linha e a vincula |
| Adicionar existente | — | vincula uma linha existente |
| Remover | **exclui** a linha | **desvincula**; a linha fica intacta |

O painel de administração renderiza cada caso de acordo: uma aba
muitos-para-muitos oferece **Adicionar existente** e **Remover deste registro**,
e nunca uma exclusão que tiraria a linha dos outros pais.

### As mesmas regras via REST

Listas de filhos são consultas de coleção comuns restritas a um pai, então
aceitam tudo o que uma lista raiz aceita — filtros, `orderBy`, `limit`, `offset`,
`include` — e `meta.total` conta as linhas filtradas. Filtre por campo
(`?field=op.value`) ou com um objeto inteiro `?where={"field":["op","value"]}`;
os dois chegam à mesma consulta:

```
GET    /api/data/authors/a-1/posts?status=eq.published&orderBy=title&limit=20
GET    /api/data/authors/a-1/posts?where={"status":["==","published"]}&orderBy=title
GET    /api/data/authors/a-1/posts/p-1
POST   /api/data/authors/a-1/posts          create under this parent
PATCH  /api/data/authors/a-1/posts/p-1      update; will not reparent
DELETE /api/data/authors/a-1/posts/p-1      delete (one-to-many) / unlink (many-to-many)
```

O segmento do pai é imposto, não decorativo. Endereçar uma linha que não está sob
aquele pai retorna `404`, e `PATCH` nunca move uma linha de um pai para outro —
defina a chave estrangeira explicitamente se for isso que você quer.

Num muitos-para-muitos, `PATCH parent/id/child/childId` é *pertinência ao
conjunto*: vincula a linha se ela ainda não estiver vinculada, e é idempotente. É
assim que você anexa uma linha que já existe.

### O que não vira aba

- **Relações para-um** — elas são um campo do registro, não uma lista. Escrever
  através de um caminho para-um é rejeitado: a chave estrangeira vive na tabela
  do pai.
- **Relações declaradas dentro de um `map`** — elas são um campo daquele map.

## Interface Completa de Relação

`Relation` é uma união fechada — um membro por kind, cada um carregando só os
campos que aquele kind tem. Não há combinação de campos que descreva dois
vínculos diferentes, nem campo que você possa definir e que o kind não use.

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
    through?: { table?: string; sourceColumn?: string; targetColumn?: string };
}

interface ViaRelation extends RelationBase {
    kind: "via";
    cardinality: "one" | "many";    // a join chain cannot imply it
    joinPath: JoinStep[];
}
```

### A forma resolvida

O que você escreve acima é a forma de *autoria*. Internamente o Rebase trabalha
com `ResolvedRelation`: o mesmo vínculo com todos os padrões preenchidos e nada
opcional, mais `cardinality`, `targetSlug` e duas flags — `writable` (falsa
apenas para `via`) e `shared` (verdadeira quando as linhas de destino pertencem
também a outros pais, de modo que remover desvincula em vez de excluir).

`sourceKey` é a única exceção a "nada opcional": o seu padrão é a chave primária
da origem, e resolver isso precisa do esquema do driver, que a resolução não tem.
Ali `undefined` significa "a chave primária" e nada mais.

Você nunca escreve uma `ResolvedRelation`. Numa propriedade de relação,
`relation` é sua e `resolvedRelation` é a preenchida, carimbada durante a
normalização.

## Próximos Passos

- **[Regras de Segurança](/docs/collections/security-rules)** — Segurança em Nível de Linha
- **[Propriedades](/docs/collections/properties)** — Referência de tipos de propriedade

---
