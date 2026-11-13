---
sourceHash: e0fcc045382336df
title: Relations
sidebar_label: Relations
description: "Vincule tabelas com rel.belongsTo, hasOne, hasMany, manyToMany e via: chaves estrangeiras vinculadas ou derivadas, tabelas de junção com colunas _pivot, regras de exclusão, regras de nomenclatura e joins multi-hop."
---

<span class="since-badge" data-since="0.31">Since 0.31</span>

As `relations` de uma tabela nomeiam os vínculos que ela possui com outras tabelas. Cada uma é uma
chamada `rel.*`, e sua chave é o nome da relação: o que o `include` solicita, o que
um caminho aninhado como `/api/data/users/1/posts` lê e o que uma escrita nomeia para
definir o vínculo.

```ts
// backend/schema/posts.ts
import { defineTable, col, rel } from "@rebasepro/server/schema";
import { users } from "./users";
import { tags } from "./tags";

export const posts = defineTable("posts", {
    columns: {
        id:    col.uuid().primaryKey().defaultRandom(),
        title: col.text().notNull(),
    },
    relations: {
        author: rel.belongsTo(() => users, { notNull: true, onDelete: "restrict" }),
        tags:   rel.manyToMany(() => tags, { pivot: { sortOrder: col.integer().default(0) } }),
    },
    rls: "admin-only",
});
```

O destino é um thunk, `() => users`, de modo que duas tabelas possam apontar uma para a outra
independentemente da ordem em que seus módulos são carregados. Nenhuma delas precisa de uma anotação de tipo: o que o
thunk retorna é verificado quando o schema é compilado, e uma relação cujo
destino não seja uma tabela ou view do schema é recusada nesse momento.

:::note[Vindo de collections?]
Relações não são mais propriedades. A coluna de chave estrangeira de um `belongsTo` é
derivada da relação ou vinculada a uma coluna que você declara. O guia de atualização
desta versão mostra o mapeamento.
:::

## Os cinco tipos

<span class="since-badge" data-since="0.31">Since 0.31</span>

| Tipo | Onde a chave reside | Retorna | Opções |
|---|---|---|---|
| `rel.belongsTo` | **nesta** tabela | uma linha | `localKey`, `notNull`, `unique`, `onDelete`, `onUpdate`, `index`, `constraint` |
| `rel.hasOne` | na tabela de **destino**, única | uma linha | `foreignKey`, `sourceKey` |
| `rel.hasMany` | na tabela de **destino** | muitas linhas | `foreignKey`, `sourceKey`, `orderBy` |
| `rel.manyToMany` | em uma **tabela de junção** | muitas linhas | `through`, `sourceKey`, `targetKey`, `pivot`, `onDelete` |
| `rel.via` | onde os `steps` indicarem | uma ou muitas | `steps` (obrigatório), `cardinality` |

Todas as opções são opcionais, exceto `steps` em `rel.via`. O restante é derivado, de
acordo com as regras em [Nomes](#nomes).

Cada tipo também aceita `access` e `private`, que decidem quem recebe as
linhas da relação, da mesma forma que fazem para uma coluna:

- `access: { read?, write? }` lista as roles que podem incluir ou filtrar pela
  relação e as roles que podem definir o vínculo. Uma lista omitida delega essa
  direção para a linha; uma lista vazia a bloqueia.
- `private: true` mantém a relação no servidor: ela não aparece na API, no
  SDK ou no OpenAPI.

Consulte [Acesso a campos](/docs/collections/field-access/) para saber o que um chamador sem
acesso visualiza.

## belongsTo — a chave está nesta tabela

<span class="since-badge" data-since="0.31">Since 0.31</span>

O `belongsTo` coloca a chave estrangeira na tabela que o declara. A coluna SQL da chave é
`localKey`, e `<nome da relação no singular>_id` quando esta for omitida:
`author` resulta em `author_id`.

A relação pode ser **vinculada (bound)** a uma coluna declarada por você, ou **derivada (derived)**:

- **Vinculada (Bound).** Quando `columns` possui uma coluna cujo nome SQL é `localKey`, a
  relação a utiliza. Seu tipo deve ser o mesmo tipo da chave do destino, e seus
  modificadores (`.notNull()`, `.unique()`) definem as características do vínculo.
- **Derivada (Derived).** Caso contrário, a relação adiciona a coluna após as colunas declaradas,
  com o tipo da chave do destino. Sua chave na API (wire key) é o camelCase da sua coluna:
  `author_id` é servido como `authorId`. `notNull: true` e `unique: true` na
  relação são aplicados a essa coluna derivada.

```ts
import { defineTable, col, rel } from "@rebasepro/server/schema";
import { users } from "./users";

// Derivada: uma coluna `author_id`, servida como `authorId`.
export const notes = defineTable("notes", {
    columns: { id: col.uuid().primaryKey().defaultRandom() },
    relations: { author: rel.belongsTo(() => users, { notNull: true }) },
    rls: "admin-only",
});

// Vinculada: `authorId` é a coluna `author_id`, portanto a relação a utiliza.
export const drafts = defineTable("drafts", {
    columns: {
        id:       col.uuid().primaryKey().defaultRandom(),
        authorId: col.uuid().notNull(),
    },
    relations: { author: rel.belongsTo(() => users) },
    rls: "admin-only",
});
```

A vinculação mantém todas as colunas físicas visíveis em `columns`, na posição que
você escolher. A derivação é mais concisa. Ambas produzem a mesma tabela.

Uma relação e uma coluna não podem compartilhar a mesma chave: a chave da relação é o que o
`include` nomeia, portanto a coluna de chave estrangeira precisa de uma chave própria (`authorId`,
e não `author`). Duas relações não podem usar a mesma coluna.

| Opção | Padrão | O que faz |
|---|---|---|
| `localKey` | `<nome no singular>_id` | A coluna SQL que armazena a chave. |
| `notNull` | `false` | A coluna derivada é `NOT NULL`. Em uma coluna vinculada, utilize `.notNull()` na própria coluna. |
| `unique` | `false` | A coluna derivada é `UNIQUE`, o que torna o vínculo um-para-um. Em uma coluna vinculada, utilize `.unique()`. |
| `onDelete` | `restrict` quando a coluna for `NOT NULL`, caso contrário `set null` | O que acontece com esta linha quando a linha de destino é excluída. Consulte [Regras de exclusão e atualização](#regras-de-exclusão-e-atualização). |
| `onUpdate` | nenhum (o Postgres aplica `NO ACTION`) | O que acontece quando a chave do destino é alterada. |
| `index` | `true` | `false` ignora a criação do índice na coluna de chave estrangeira. |
| `constraint` | `true` | `false` armazena a chave sem uma constraint de `FOREIGN KEY`. |

A coluna de chave estrangeira é indexada a menos que `index: false`: o Postgres indexa a
chave para a qual a chave estrangeira aponta, nunca a coluna que a armazena; portanto, sem um índice, toda
leitura a partir do outro lado fará uma varredura (scan) nesta tabela. Consulte
[Chaves estrangeiras são indexadas para você](/docs/backend/indexes#foreign-keys-are-indexed-for-you).

## hasOne e hasMany — a chave está no destino

<span class="since-badge" data-since="0.31">Since 0.31</span>

O `hasMany` lê linhas do destino que apontam de volta para esta tabela. O `hasOne` é o
mesmo tipo de vínculo, mas com no máximo uma linha do outro lado. Nenhum dos dois adiciona uma coluna aqui: o
destino declara o `belongsTo` que armazena a chave.

```ts
import { defineTable, col, rel } from "@rebasepro/server/schema";
import { posts } from "./posts";
import { profiles } from "./profiles";

export const authors = defineTable("authors", {
    columns: { id: col.uuid().primaryKey().defaultRandom(), name: col.text().notNull() },
    relations: {
        // lê posts.author_id
        posts:   rel.hasMany(() => posts, { foreignKey: "author_id" }),
        // lê profiles.author_id, que é único
        profile: rel.hasOne(() => profiles, { foreignKey: "author_id" }),
    },
    rls: "admin-only",
});
```

`foreignKey` é a coluna SQL no destino, e o padrão é
`<slug desta tabela no singular>_id`: em `authors`, torna-se `author_id`.

O `hasMany` aceita um `orderBy`: a ordenação na qual as linhas relacionadas retornam quando o
chamador não especifica nenhuma. Trata-se de uma chave de ordenação ou várias, cada uma
no formato `[column, "asc" | "desc", nulls?]`, indicando as colunas do destino:

```ts
posts: rel.hasMany(() => posts, { foreignKey: "author_id", orderBy: [["published_at", "desc"]] }),
```

A ordenação declarada se aplica a um include, a uma leitura de relação com pai único e a uma
listagem aninhada (`/api/data/authors/1/posts`) sempre que o chamador não especificar uma
ordenação. Um `orderBy` fornecido pelo chamador a substitui em vez de estendê-la. A chave
do destino em ordem ascendente sempre finaliza a ordenação, garantindo a estabilidade das páginas. Um
`limit` de include por registro pai mantém as primeiras linhas dessa ordenação, e uma listagem aninhada pagina sobre ela,
utilizando um offset ou um cursor.

### Fazendo join com uma chave natural

<span class="since-badge" data-since="0.31">Since 0.31</span>

Por padrão, a chave do destino armazena a chave primária desta linha. Quando os dois lados são
unidos por outro identificador (um ID de identidade externa, um SKU), `sourceKey` indica
a coluna nesta tabela:

```ts
import { defineTable, col, rel } from "@rebasepro/server/schema";
import { applications } from "./applications";

export const talents = defineTable("talents", {
    columns: {
        id:         col.uuid().primaryKey().defaultRandom(),
        authUserId: col.text().notNull().unique(),
    },
    relations: {
        // applications.auth_user_id = talents.auth_user_id
        applications: rel.hasMany(() => applications, { sourceKey: "auth_user_id", foreignKey: "auth_user_id" }),
    },
    rls: "admin-only",
});
```

A coluna `sourceKey` deve ser única: um vínculo que faça referência a várias linhas de
origem não pode determinar a qual delas uma linha relacionada pertence. Uma linha cujo `sourceKey` seja
`NULL` não alcança nenhuma linha relacionada, e tentar escrever através da relação gerará um erro.

## manyToMany — através de uma junção

<span class="since-badge" data-since="0.31">Since 0.31</span>

O `manyToMany` vincula linhas por meio de uma tabela de junção criada pelo Rebase, com
segurança em nível de linha (RLS) própria. A remoção de um vínculo exclui a linha da junção, nunca
o destino.

```ts
import { defineTable, col, rel } from "@rebasepro/server/schema";
import { users } from "./users";

export const projects = defineTable("projects", {
    columns: { id: col.uuid().primaryKey().defaultRandom(), name: col.text().notNull() },
    relations: {
        members: rel.manyToMany(() => users, {
            through: "project_members",
            pivot: {
                role:    col.enum(["owner", "editor", "viewer"]).notNull().default("viewer"),
                addedAt: col.timestamp({ withTimezone: true }).onCreateNow(),
            },
        }),
    },
    rls: "admin-only",
});
```

| Opção | Padrão | O que faz |
|---|---|---|
| `through` | os nomes SQL de ambas as tabelas, ordenados, unidos por `_` | A tabela de junção. Sempre no schema `public`. |
| `sourceKey` | `<slug desta tabela no singular>_id` | A coluna da junção que aponta para esta tabela. |
| `targetKey` | `<nome da relação no singular>_id` | A coluna da junção que aponta para o destino. |
| `pivot` | nenhum | Colunas extras na junção, construídas com `col.*`. |
| `onDelete` | `cascade` | O que acontece com o vínculo quando qualquer uma das linhas é excluída. |

Ambos os lados de um mesmo vínculo podem declará-lo, cada um a partir do seu próprio ponto de vista:
`sourceKey` sempre aponta para a coluna da tabela declarante. Duas relações que
resolvam para a mesma tabela de junção com colunas de chave diferentes serão recusadas.

O destino pode ser a própria tabela — por exemplo, faixas musicais semelhantes a outras faixas. Suas duas
colunas de junção teriam por padrão o nome `track_id`, portanto diferencie a do destino
utilizando `targetKey`; um auto-vínculo cujas duas colunas resolvam para o mesmo nome será
recusado na compilação do schema:

```ts
import { defineTable, col, rel } from "@rebasepro/server/schema";

export const tracks = defineTable("tracks", {
    columns: { id: col.uuid().primaryKey().defaultRandom(), title: col.text().notNull() },
    relations: {
        similar: rel.manyToMany(() => tracks, {
            through: "tracks_similar",
            targetKey: "similar_track_id",
        }),
    },
    rls: "admin-only",
});
```

O destino também pode ser uma view (`defineView`): `db push`, inicialização e `schema
generate` criam a tabela de junção para ela, e o comando `rebase doctor` contabiliza essa
junção como gerenciada. Uma view não declara `manyToMany` próprios.

### `_pivot`: as colunas próprias da junção

<span class="since-badge" data-since="0.31">Since 0.31</span>

As colunas de `pivot` são lidas e escritas sob a chave `_pivot`. Uma leitura que inclui a
relação retorna cada linha relacionada acompanhada das colunas do seu vínculo:

```json
{ "id": "p1", "name": "Website", "members": [
    { "id": "u7", "email": "ada@example.com", "_pivot": { "role": "owner", "addedAt": "2026-11-02T09:14:00Z" } }
] }
```

Uma escrita define os vínculos como uma lista, e um elemento pode conter o `_pivot` que o
vínculo deve armazenar:

```json
{ "members": [{ "id": "u7", "_pivot": { "role": "owner" } }, "u9"] }
```

Colunas pivot aceitam todos os modificadores de coluna, exceto `.primaryKey()`: a chave
da junção é composta por suas duas colunas de vínculo.

### `_count`: quantas linhas relacionadas existem

<span class="since-badge" data-since="0.31">Since 0.31</span>

A inclusão de uma relação to-many (`hasMany`, `manyToMany`, um `via` to-many) pode
solicitar o total em conjunto com uma página limitada de linhas, retornado sob a propriedade
`_count` da linha. A contagem é feita na mesma instrução, sob os mesmos filtros e
regras de segurança em nível de linha (RLS). Consulte
[Contando o que um limit deixa de fora](/docs/sdk/relations#counting-what-a-limit-leaves-out).

## via — uma cadeia explícita de joins

<span class="since-badge" data-since="0.31">Since 0.31</span>

`via` realiza a leitura por meio de joins que você define explicitamente: múltiplos saltos (hops), chaves compostas ou uma
condição que não seja uma chave estrangeira simples.

```ts
import { defineTable, col, rel } from "@rebasepro/server/schema";
import { permissions } from "./permissions";

export const members = defineTable("members", {
    columns: { id: col.uuid().primaryKey().defaultRandom() },
    relations: {
        permissions: rel.via(() => permissions, {
            steps: [
                { table: "member_roles",     on: { from: "id",            to: "member_id" } },
                { table: "role_permissions", on: { from: "role_id",       to: "role_id" } },
                { table: "permissions",      on: { from: "permission_id", to: "id" } },
            ],
        }),
    },
    rls: "admin-only",
});
```

Cada etapa faz o join com `table`, onde `from` nomeia uma coluna da tabela anterior (esta
tabela, no caso do primeiro passo) e `to` uma coluna de `table`. Uma lista de colunas em ambos
os lados faz o join sobre uma chave composta: `on: { from: ["company_code", "region_id"], to:
["code", "region_id"] }`. Uma lista de condições em `on` faz o join de uma linha que atenda a qualquer
uma delas e opera em modo somente leitura.

`cardinality` é `"many"`, a menos que você defina `"one"`. Duas cadeias podem receber
operações de escrita, da mesma forma que o tipo correspondente aceita:

- uma cadeia **to-one** de **uma etapa**: a linha de destino contém a chave, como em
  `hasOne`;
- uma cadeia **to-many** de **duas etapas através de uma tabela** intermediária: essa
  tabela armazena os vínculos, como em `manyToMany` (sem `_pivot`).

Qualquer outra cadeia opera em modo somente leitura. Uma criação ou atualização que a nomeie será recusada com
`400 RELATION_NOT_WRITABLE`, assim como qualquer escrita aninhada através de um `via`.

Uma cadeia pode passar por uma tabela que a leitura já contém — um `via` de uma tabela
para si mesma, ou registros netos alcançados passando pela mesma tabela duas vezes: cada etapa é
unida sob seu próprio alias. Um filtro de relação ou uma ordenação por contagem de relacionados
não aceita um `via` e indicará isso explicitamente.

## Regras de exclusão e atualização

<span class="since-badge" data-since="0.31">Since 0.31</span>

| Ação | Comportamento |
|---|---|
| `"cascade"` | Exclui ou atualiza também as linhas relacionadas |
| `"restrict"` | Recusa a exclusão enquanto existirem linhas relacionadas |
| `"no action"` | Como o `restrict`, verificado no final da instrução |
| `"set null"` | Esvazia a coluna de chave estrangeira |
| `"set default"` | Define a coluna de chave estrangeira com seu valor padrão |

Quando `onDelete` não for definido, um `belongsTo` anulável (nullable) esvazia o ponteiro
(`set null`), um `NOT NULL` recusa a exclusão (`restrict`), e um
vínculo `manyToMany` é excluído junto com qualquer uma das linhas (`cascade`). `NOT NULL` significa que uma linha
não pode existir sem seu registro pai; não significa que a exclusão do pai deve
excluir a linha. Especifique `"cascade"` quando for esse o objetivo: é o único
valor que remove linhas que você não nomeou explicitamente.

## Nomes

<span class="since-badge" data-since="0.31">Since 0.31</span>

Todos os nomes utilizados por uma relação são derivados quando você não os define explicitamente. As regras seguem
o padrão já presente em um banco de dados implantado, garantindo que não mudem entre versões.

| Nome | Regra | `posts` com relação `author` → `users` |
|---|---|---|
| Coluna `belongsTo` | `localKey`, senão `<nome da relação no singular>_id` | `author_id` |
| Chave da API (wire key) do `belongsTo` | o camelCase da coluna | `authorId` |
| Coluna de `hasOne` / `hasMany` no destino | `foreignKey`, senão `<slug desta tabela no singular>_id` | `post_id` no destino |
| Tabela de junção | `through`, senão ambos os nomes SQL das tabelas ordenados e unidos por `_` | `posts_tags` para `posts` ↔ `tags` |
| Coluna de junção para esta tabela | `sourceKey`, senão `<slug desta tabela no singular>_id` | `post_id` |
| Coluna de junção para o destino | `targetKey`, senão `<nome da relação no singular>_id` | `tag_id` para a relação `tags` |

Uma chave estrangeira derivada herda o tipo da chave para a qual aponta. Uma chave do tipo
`serial` é referenciada por um `integer` simples de mesma largura, e uma chave enum
pelo seu próprio tipo enum.

O nome de uma relação `belongsTo` representa sua coluna de chave estrangeira sempre que uma tabela
nomear uma coluna: em `indexes`, em `tenant` e no `ownerField` ou
condição de uma regra.

## Lendo e escrevendo relações

<span class="since-badge" data-since="0.31">Since 0.31</span>

Relações não são incluídas em uma leitura a menos que o chamador solicite:

```typescript
const { data } = await client.data.posts
    .include("author", "tags")
    .find();
```

A linha então carrega tanto a chave estrangeira quanto a linha relacionada:
`post.authorId` sempre está presente, enquanto `post.author` aparece apenas quando incluído. O
[SDK tipado](/docs/sdk/relations/) cobre a utilização de includes em detalhes: limites por relação,
filtros, ordenação e aninhamento.

Uma operação de escrita define um vínculo to-one pela sua chave (`{ author: "u7" }` ou
`{ authorId: "u7" }`), ou `null` para desvincular, e um vínculo to-many como uma lista de
IDs de destino ou objetos `{ id, _pivot? }` (`{ tags: ["t1", "t2"] }`). Um vínculo to-one
escrito como um objeto (`{ author: { id: "u7" } }`) retorna um erro
`400 VALIDATION_INVALID_VALUE` indicando a relação: envie a chave. Um filtro em uma
relação compara sua chave. Consulte [Escrevendo dados](/docs/sdk/writing/).

No CMS, cada relação to-many torna-se uma aba sob o registro. Consulte
[Relações no painel administrativo](/docs/collections/relations-in-the-admin-panel/).

## O que é recusado

<span class="since-badge" data-since="0.31">Since 0.31</span>

Um `rel.via()` sem steps lança um erro no carregamento do módulo. Durante a compilação
do schema, uma tabela será recusada nos seguintes casos:

- uma relação cujo destino não seja uma tabela ou view do schema;
- uma relação e uma coluna compartilhando a mesma chave;
- uma coluna vinculada (bound) cujo tipo não corresponda ao tipo da chave de destino, ou um `notNull` ou
  `unique` na relação que a coluna vinculada não possua;
- duas relações utilizando a mesma coluna de chave estrangeira, ou uma coluna derivada cuja chave ou
  nome SQL já pertença a outra coluna;
- um `belongsTo` apontando para uma tabela com chave composta, um `hasOne` ou
  `hasMany` originado de uma tabela sem `sourceKey`, ou um `manyToMany` com qualquer um dos lados
  sendo composto: uma coluna não pode referenciar várias, portanto represente isso com
  `rel.via()`;
- duas relações `manyToMany` resolvendo para a mesma tabela de junção com colunas de chave
  diferentes;
- um `manyToMany` cujas duas colunas de junção resolvam para o mesmo nome (um
  auto-vínculo sem `targetKey`);
- uma coluna pivot marcada com `.primaryKey()` (a chave da junção é composta pelas duas
  colunas de vínculo) ou declarando `.transform()` (os hooks de uma coluna pivot nunca são executados; o
  `afterRead` do destino tem acesso a `_pivot`).

## Próximos passos

<span class="since-badge" data-since="0.31">Since 0.31</span>

- [Row-level security](/docs/collections/security-rules/): quem acessa as linhas em cada ponta
- [Índices](/docs/backend/indexes/): o índice de chave estrangeira e índices compostos sobre relações
- [Relações no SDK tipado](/docs/sdk/relations/): `include`, limites por relação, `_count`
