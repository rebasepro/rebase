---
sourceHash: a919caafccd81923
title: Colunas
sidebar_label: Colunas
description: "Cada construtor e modificador col.*: o tipo Postgres que cada um cria, o tipo que um cliente lê e grava, e o que a API impõe — nulabilidade, padrões, marcações (stamps), validação, conjuntos fechados de valores, acesso e armazenamento."
---

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Uma coluna é um construtor `col.*`, refinado por modificadores. O construtor decide o
tipo Postgres; os modificadores definem todo o resto: se a coluna pode ser
nula, seu valor padrão, sua validação, quem pode lê-la e gravá-la.

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const products = defineTable("products", {
    columns: {
        id:        col.uuid().primaryKey().defaultRandom(),
        sku:       col.varchar({ length: 32 }).notNull().unique(),
        name:      col.text().notNull().validate({ min: 2, max: 120, trim: true }),
        price:     col.numeric({ precision: 10, scale: 2 }).notNull().validate({ min: 0 }),
        status:    col.enum(["draft", "active", "retired"]).notNull().default("draft"),
        tags:      col.text().array().validate({ maxItems: 10 }),
        photo:     col.storage({ path: "products/", accept: ["image/*"], maxBytes: "5MB" }),
        createdBy: col.uuid().onCreateUser().readOnly(),
        createdAt: col.timestamp({ withTimezone: true }).notNull().onCreateNow(),
        updatedAt: col.timestamp({ withTimezone: true }).notNull().onUpdateNow(),
    },
    rls: "admin-only",
});
```

Os construtores são imutáveis: cada modificador retorna um novo construtor, de forma que uma coluna pode ser
declarada uma vez e compartilhada entre tabelas.

Após o ponto, uma coluna é lida como o `pg-core` do [Drizzle](https://orm.drizzle.team/docs/column-types/pg):
os mesmos nomes de construtores, um nome de coluna SQL opcional primeiro, depois
o objeto de configuração do Drizzle, e então o encadeamento — `col.varchar({ length: 32 })`,
`col.timestamp({ withTimezone: true })`, `col.text().array()`,
`` .default(sql`now()`) ``. Uma grafia do Drizzle que significaria outra coisa aqui
não compila, e o erro informa o que escrever em seu lugar. Duas diferenças para
manter em mente:

- **Uma chave estrangeira é uma relação.** Declare-a sob `relations`:
  `author: rel.belongsTo(() => users, { localKey: "author_id" })`. A
  chave da relação é o que o `include` nomeia. `.references()` não existe, e
  informa isso. Consulte [Relações](/docs/collections/relations/).
- **`.defaultNow()` é apenas um padrão de banco de dados**: `DEFAULT now()`, o qual um cliente
  ainda pode substituir. `.onCreateNow()` é uma [marcação (stamp)](#marcações-stamps) do servidor: o servidor
  grava o horário na criação, independentemente do que o cliente enviou.

## Construtores

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Um construtor por tipo Postgres. O tipo transmitido (wire type) é o que um cliente lê em uma linha e
envia em uma gravação, e como o SDK e o [`InferRow`](/docs/schema/types/) tipam
a coluna. Cada construtor aceita um nome de coluna SQL opcional como seu primeiro
argumento (`col.text("legacy_title")`); sem ele, o nome SQL é o
snake_case da chave.

| Construtor | Tipo Postgres | Tipo transmitido | Notas |
|---|---|---|---|
| `col.uuid()` | `UUID` | `string` | `.defaultRandom()` para `gen_random_uuid()` |
| `col.text()` | `TEXT` | `string` | `col.text({ enum: [...] })` aceita apenas esses valores; consulte [Conjuntos fechados de valores](#conjuntos-fechados-de-valores) |
| `col.varchar({ length })` | `VARCHAR(n)` | `string` | o comprimento é obrigatório; também aceita `enum` |
| `col.char({ length })` | `CHAR(n)` | `string` | o comprimento é obrigatório; também aceita `enum` |
| `col.enum(values)` | um tipo enum do Postgres, `<table>_<column>` | a união de `values` | consulte [Conjuntos fechados de valores](#conjuntos-fechados-de-valores) |
| `pgEnum(name, values)`, depois `status()` | um tipo enum nomeado do Postgres | a união de `values` | cada coluna dele compartilha o mesmo tipo |
| `col.smallint()` | `SMALLINT` | `number` | |
| `col.integer()` | `INTEGER` | `number` | |
| `col.bigint({ mode: "number" })` | `BIGINT` | `number` | lido e gravado como um número JavaScript |
| `col.smallserial()` | `SMALLSERIAL` | `number` | possui um padrão; prefira `col.smallint().generatedByDefaultAsIdentity()` em um novo esquema |
| `col.serial()` | `SERIAL` | `number` | possui um padrão; prefira `col.integer().generatedByDefaultAsIdentity()` |
| `col.bigserial({ mode: "number" })` | `BIGSERIAL` | `number` | possui um padrão; prefira `col.bigint({ mode: "number" }).generatedByDefaultAsIdentity()` |
| `col.real()` | `REAL` | `number` | |
| `col.doublePrecision()` | `DOUBLE PRECISION` | `number` | |
| `col.numeric({ precision?, scale? })` | `NUMERIC`, `NUMERIC(p)`, `NUMERIC(p, s)` | `number` | uma escala precisa de uma precisão; `col.decimal()` é o mesmo construtor |
| `col.boolean()` | `BOOLEAN` | `boolean` | |
| `col.timestamp({ withTimezone: true })` | `TIMESTAMPTZ` | `string` (ISO 8601) | uma gravação também aceita um `Date`; um timestamp sem fuso horário é `col.custom({ dataType: "timestamp" })` |
| `col.date()` | `DATE` | `string` (`YYYY-MM-DD`) | uma gravação também aceita um `Date` |
| `col.time()` | `TIME` | `string` (`HH:MM:SS`) | uma gravação também aceita um `Date` |
| `col.jsonb()` / `col.jsonb(shape)` | `JSONB` | `unknown` (`.$type<T>()` o tipa), ou o tipo do formato (shape) | consulte [Documentos JSON](/docs/schema/json/) |
| `col.json()` / `col.json(shape)` | `JSON` | como `jsonb` | mantém o texto fornecido; prefira `jsonb` |
| `<builder>.array()` | `<inner>[]` | um array do tipo transmitido interno | `col.text().array()`; sem arrays de arrays; consulte [Arrays](#arrays) |
| `col.vector({ dimensions, index? })` | `vector(dimensions)` (pgvector) | `number[]` | um índice cosseno HNSW, a menos que `index` determine o contrário; consulte [Busca vetorial](/docs/backend/vector-search/) |
| `col.bytea()` | `BYTEA` | `string` (base64) | |
| `col.geopoint()` | `JSONB` | `{ latitude: number; longitude: number }` | |
| `col.storage(options)` | `TEXT` | `string` (o caminho do arquivo) | `.multiple()` o torna `TEXT[]`; consulte [Colunas de armazenamento](#colunas-de-armazenamento) |
| `col.custom({ dataType })` | qualquer outro tipo Postgres, literal (`"inet"`, `"citext"`) | `string` (`.$type<T>()` o tipa) | O Rebase nomeia o tipo no DDL e repassa os valores |

## Modificadores

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Todo construtor tem o primeiro grupo. O restante existe apenas nos construtores onde fazem
sentido; chamar um deles em outro lugar gera um erro de tipo.

| Modificador | Em | Banco de dados | API e tipos |
|---|---|---|---|
| `.notNull()` | qualquer coluna | `NOT NULL` | nunca `null` em uma linha; obrigatório na criação, a menos que possua um padrão |
| `.primaryKey()` | qualquer coluna | parte da chave primária, `NOT NULL` | ausente do tipo `Update` |
| `.unique()` | qualquer coluna | `UNIQUE` de coluna única | um duplicado resulta em `409` |
| `.default(value)` | qualquer coluna | `DEFAULT <value>` | aplicado pelo driver na criação também; opcional na criação |
| `` .default(sql`expr`) `` | qualquer coluna | `DEFAULT <expr>` | opcional na criação; `sql` é importado junto com `col` |
| `.dbDefault()` | qualquer coluna | mantém o padrão existente do banco de dados intacto | opcional na criação |
| `` .generatedAlwaysAs(sql`expr`) `` | qualquer coluna | `GENERATED ALWAYS AS (<expr>) STORED` | nunca gravável, por ninguém |
| `.$type<T>()` | qualquer coluna | nenhum | tipa o valor apenas para o TypeScript, como no Drizzle |
| `.array()` | qualquer coluna | `<type>[]` | consulte [Arrays](#arrays) |
| `.readOnly()` | qualquer coluna | nenhum | gravações de clientes recusadas; ausente de `Insert` e `Update` |
| `.private()` | qualquer coluna | nenhum | nunca trafegado, nem no SDK ou no OpenAPI |
| `.access({ read?, write? })` | qualquer coluna | nenhum | leitura e gravação por perfil (role); consulte [Acesso a campos](/docs/collections/field-access/) |
| `.describe(text)` | qualquer coluna | nenhum | a descrição no OpenAPI e MCP |
| `.validate(rules)` | qualquer coluna | nenhum | verificado antes de cada gravação; as regras dependem do tipo, consulte [Validação](#validação) |
| `.transform({ beforeSave?, afterRead? })` | qualquer coluna | nenhum | hooks a nível de campo; `value` é `T \| null` a menos que `.notNull()` venha primeiro; consulte [Hooks de tabela](/docs/collections/callbacks/#field-hooks-transform) |
| `.oneOf(values)` | colunas numéricas | nenhum | apenas estes valores são aceitos; tipado como a união deles (uma coluna de texto aceita `{ enum: [...] }`) |
| `.defaultRandom()` | `col.uuid()` | `DEFAULT gen_random_uuid()` | opcional na criação |
| `.generatedByDefaultAsIdentity()` | `col.smallint()`, `col.integer()`, `col.bigint({ mode: "number" })` | `GENERATED BY DEFAULT AS IDENTITY` | opcional na criação |
| `.defaultNow()` | `timestamptz`, `date`, `time` | `DEFAULT now()` | opcional na criação; um cliente ainda pode enviar um valor |
| `.onCreateNow()` | `timestamptz`, `date`, `time` | `DEFAULT now()` | o servidor marca o horário na criação |
| `.onUpdateNow()` | `timestamptz`, `date`, `time` | `DEFAULT now()` e um trigger `BEFORE UPDATE` | o servidor marca o horário na criação e a cada atualização |
| `.onCreateUser()` | colunas de texto, `col.uuid()` | nenhum | o servidor grava o id do chamador na criação |
| `.onUpdateUser()` | colunas de texto, `col.uuid()` | nenhum | o servidor grava o id do chamador a cada gravação |
| `.userId()` | colunas de texto, `col.uuid()` | nenhum | a coluna armazena o id de um usuário; o painel oferece um seletor de usuários; consulte [Colunas de usuário](#colunas-de-usuário) |
| `.multiple()` | `col.storage()` | `TEXT[]` | a coluna armazena vários caminhos de arquivo |

## Nulo, obrigatório e padrões

<span class="since-badge" data-since="0.31">Desde 0.31</span>

As colunas são anuláveis por padrão. `.notNull()` e `.primaryKey()` tornam uma coluna
`NOT NULL`, e a API passa a exigi-la na criação, a menos que tenha um valor padrão. Uma
coluna `NOT NULL` é `T` em uma linha; qualquer outra coluna é `T | null`.

Um valor padrão pode ser qualquer um de `.default()`, `` .default(sql`…`) ``, `.defaultNow()`,
`.dbDefault()`, `.defaultRandom()`, `.generatedByDefaultAsIdentity()`, uma marcação (stamp)
ou um construtor serial. Uma coluna com um valor
padrão pode ser omitida na criação:

```ts
import { defineTable, col, sql } from "@rebasepro/server/schema";

export const tickets = defineTable("tickets", {
    columns: {
        id:       col.integer().primaryKey().generatedByDefaultAsIdentity(),
        code:     col.text().notNull().default(sql`gen_short_id()`),
        priority: col.smallint().notNull().default(3),
        legacy:   col.text().dbDefault(),
    },
    rls: "admin-only",
});
```

- **`.default(value)`** é gravado como o `DEFAULT` da coluna e também aplicado
  pelo driver na criação, para que uma linha seja retornada da mesma forma, independentemente de quem a insira. Uma
  coluna temporal também aceita um `Date`, armazenado como sua string ISO. O padrão de uma
  coluna enum deve ser um dos seus valores.
- **`` .default(sql`expression`) ``** é avaliado pelo Postgres. A expressão é
  gravada no DDL como está, portanto a tag `sql` não aceita `${…}`.
  `.defaultNow()` equivale a `` .default(sql`now()`) ``.
- **`.dbDefault()`** indica que o banco de dados já possui um padrão que o esquema
  não declara. Uma criação pode omitir a coluna, e um push de esquema não remove
  o padrão.

`.generatedAlwaysAs()` não pode ter um valor padrão nem uma marcação (stamp): o Postgres computa a coluna
a cada gravação. Uma coluna de chave primária não pode ser `.private()`.

## Marcações (Stamps)

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Uma marcação (stamp) é um valor que o servidor grava em uma coluna por conta própria. Ela substitui
o que quer que o cliente envie para essa coluna.

| Marcação | Grava | Quando |
|---|---|---|
| `.onCreateNow()` | a hora atual | na criação |
| `.onUpdateNow()` | a hora atual | na criação e a cada atualização |
| `.onCreateUser()` | o id de usuário do chamador | na criação |
| `.onUpdateUser()` | o id de usuário do chamador | na criação e a cada atualização |

Uma coluna aceita apenas uma marcação. Chamar uma segunda marcação diferente lança um erro quando o
módulo carrega; `.onUpdateNow()` por si só já preenche a linha quando ela é criada.
Colunas com marcação permanecem anuláveis a menos que você adicione `.notNull()`.

`.onCreateUser()` é a forma como uma coluna que uma regra de segurança a nível de linha compara com
o chamador (`ownerField`) obtém seu valor. Uma coluna preenchida pelo chamador é uma coluna
sobre a qual o chamador pode mentir.

## Colunas de usuário

<span class="since-badge" data-since="0.31">Desde 0.31</span>

`.userId()` indica que uma coluna armazena o id de um usuário. É um significado semântico, não um
tipo: a coluna continua sendo `text` (ou `varchar`, `char`, `uuid`), e o
descritor fornecido pelo servidor passa a conter `semantic: "user"`.

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const tickets = defineTable("tickets", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        subject: col.text().notNull(),
        assignedTo: col.text().userId().describe("Team member assigned to this ticket"),
        watchers: col.text().userId().array()
    },
    rls: "admin-only"
});
```

Duas coisas decorrem disso:

- O painel administrativo renderiza um seletor de usuários para a coluna em vez de um campo
  de texto, e exibe o usuário em vez do id puro.
- Um chamador com permissão para gravar na tabela pode consultar usuários para preenchê-la. A leitura
  do seletor responde a eles mesmo quando a segurança a nível de linha oculta linhas de outros usuários.

Funciona em `col.text()`, `col.varchar()`, `col.char()` e `col.uuid()`,
nos itens de um array (`col.text().userId().array()`) e em
`json.string()` dentro de um [documento JSON](/docs/schema/json/). Em qualquer outro lugar,
lança um erro quando o módulo carrega. Ele não declara chave estrangeira: use
`rel.belongsTo(() => users)` caso o banco de dados deva impor uma restrição. Para fazer com que o
servidor preencha a coluna com o id do chamador, use uma [marcação (stamp)](#marcações-stamps) em vez disso.

## Validação

<span class="since-badge" data-since="0.31">Desde 0.31</span>

`.validate(rules)` aceita as regras para o tipo da coluna. A API as verifica
antes de uma criação ou atualização e recusa a gravação com um status `400` indicando a
coluna. Chamar `.validate()` duas vezes mescla as regras.

| Regra | Colunas de texto e `col.storage()` | Colunas numéricas | `timestamptz`, `date`, `time` | Arrays |
|---|---|---|---|---|
| `min`, `max` | comprimento | limites inclusivos | valor mais antigo e mais recente (string ISO ou `Date`) | |
| `length` | comprimento exato | | | |
| `matches`, `matchesFlags`, `matchesMessage` | um padrão (string ou `RegExp`) e o erro | | | |
| `email`, `url` | o valor é um e-mail ou uma URL | | | |
| `trim`, `lowercase`, `uppercase` | o valor é normalizado antes de ser armazenado | | | |
| `lessThan`, `moreThan` | | limites exclusivos | | |
| `positive`, `negative`, `integer` | | sinal, número inteiro | | |
| `minItems`, `maxItems`, `uniqueItems` | | | | quantidade de itens, sem duplicatas |
| `requiredMessage` | ✓ | ✓ | ✓ | ✓ |

`requiredMessage` é o erro que uma criação recebe ao omitir uma coluna `.notNull()`
sem valor padrão. Todos os outros tipos de coluna (`uuid`, `enum`, `boolean`,
JSON, `vector`, `bytea`, `geopoint`) aceitam apenas `requiredMessage`.

Um `RegExp` é armazenado como seu código-fonte e flags, e um limite `Date` como sua
string ISO, de modo que as regras expostas na conexão são exatamente as que o servidor verifica.

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const signups = defineTable("signups", {
    columns: {
        id:       col.uuid().primaryKey().defaultRandom(),
        email:    col.text().notNull().validate({ email: true, lowercase: true, trim: true, requiredMessage: "Enter your e-mail address." }),
        handle:   col.varchar({ length: 32 }).validate({ matches: /^[a-z0-9_]+$/, matchesMessage: "Lower-case letters, digits and _ only." }),
        age:      col.smallint().validate({ integer: true, min: 13 }),
        birthday: col.date().validate({ max: "2013-01-01" }),
    },
    rls: "admin-only",
});
```

Em `col.varchar({ length })` e `col.char({ length })`, o comprimento é imposto
pelo Postgres e pela API. Um `max` diferente entra em contradição com ele; declare
o comprimento apenas uma vez.

## Conjuntos fechados de valores

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Duas formas de aceitar apenas determinados valores:

- **Um tipo enum do Postgres**, para que o banco de dados também imponha o conjunto.
  `col.enum(values)` cria um tipo nomeado como `<table>_<column>`. Um tipo com um nome
  de sua escolha, compartilhado por várias colunas, é declarado uma única vez com
  `pgEnum(name, values)` — como no Drizzle — e chamado em cada coluna:
  `postStatus()`. Duas declarações com o mesmo nome devem listar os mesmos valores
  na mesma ordem.
- **Um conjunto validado pela API**, sem um tipo no Postgres: `{ enum: [...] }` em
  `col.text()`, `col.varchar()` ou `col.char()`, e `.oneOf(values)` em uma
  coluna numérica. Também é o formato para um array de strings conhecidas:
  `col.text({ enum: ["a", "b"] }).array()`.

Todas essas abordagens tipam a coluna como a união dos seus valores: `status` abaixo é
`"draft" | "published"` na linha, `kind` é `"news" | "guide"`, e `rating`
é `1 | 2 | 3 | 4 | 5`.

```ts
import { defineTable, col, pgEnum } from "@rebasepro/server/schema";

const reviewStatus = pgEnum("review_status", ["draft", "published"]);

export const reviews = defineTable("reviews", {
    columns: {
        id:     col.uuid().primaryKey().defaultRandom(),
        status: reviewStatus().notNull().default("draft"),
        kind:   col.text({ enum: ["news", "guide"] }),
        rating: col.smallint().notNull().oneOf([1, 2, 3, 4, 5]),
        labels: col.text({ enum: ["bug", "praise", "question"] }).array(),
    },
    rls: "admin-only",
});
```

Rótulos e cores para os valores são questões de apresentação. Eles pertencem ao CMS, não
à tabela.

## Arrays

<span class="since-badge" data-since="0.31">Desde 0.31</span>

`.array()` cria um array Postgres do tipo da coluna, como no Drizzle:
`col.text().array()` é `TEXT[]`, `col.integer().array()` é `INTEGER[]`. O que
for encadeado antes de `.array()` descreve cada item: seu `{ enum }`, `.validate()`,
`.oneOf()`, opções de armazenamento e `.transform()`. O que vem depois dele descreve
a coluna de array em si: seu próprio `.validate()` aceita `minItems`, `maxItems` e
`uniqueItems`.

Modificadores que descrevem a coluna (`.notNull()`, um padrão, `.unique()`,
`.access()`) vão após `.array()` — `col.text().array().notNull().default([])`;
antes dele, não compilam. Um array de arrays é recusado; use
`col.jsonb()` para listas aninhadas. Um array contém escalares — texto, `uuid`, números,
booleanos, datas, enums: um `.array()` de `jsonb`, `json`, `vector`, `bytea`,
geopoints ou `col.custom()` é recusado, e uma lista de documentos, pontos ou
vetores deve ser `col.jsonb(json.array(…))`. Um tipo de lista customizado é declarado com seu próprio nome:
`col.custom({ dataType: "inet[]" })`.

Cada item é retornado da mesma forma que seu tipo é retornado em uma coluna escalar: um
item de `timestamptz[]` como uma string RFC 3339, um item de `numeric[]` como um número, e
um item nulo como `null`.

## Chaves, identidade e seriais

<span class="since-badge" data-since="0.31">Desde 0.31</span>

`.generatedByDefaultAsIdentity()` torna uma coluna de inteiros `GENERATED BY DEFAULT
AS IDENTITY`. É o formato recomendado para chaves inteiras em um novo esquema
(`.generatedAlwaysAsIdentity()` não compila: o Rebase cria identidades apenas por
padrão). Os construtores seriais (`col.smallserial()`, `col.serial()`,
`col.bigserial({ mode: "number" })`) existem para esquemas que
já os utilizam; uma coluna apontando para uma chave serial deve ser o inteiro comum
de mesma largura. Consulte [Chaves primárias](/docs/schema/#primary-keys) para chaves compostas.

`col.bigint({ mode: "number" })` é lido e gravado como um `number` do JavaScript
(o `mode: "bigint"` do Drizzle não compila), sendo exato até
2⁵³ − 1. `col.numeric()` também é um `number`, portanto carrega a precisão de um
double na conexão, independentemente da precisão armazenada pelo Postgres.

## Quem pode ler e gravar uma coluna

<span class="since-badge" data-since="0.31">Desde 0.31</span>

A segurança a nível de linha decide quais linhas um chamador pode acessar. Três modificadores restringem
o que ele pode visualizar de uma linha e o que pode alterar:

- **`.readOnly()`** recusa qualquer gravação de cliente na coluna, tanto na criação quanto na
  atualização, independentemente do perfil do chamador. O banco de dados (um padrão, um trigger) e
  o código do servidor ainda a preenchem. A coluna fica ausente dos tipos `Insert` e `Update`.
- **`.private()`** mantém a coluna restrita ao servidor: ausente de cada linha transmitida,
  do SDK e do OpenAPI, além de ser rejeitada em filtros e ordenações. Hooks e
  o código do servidor ainda têm acesso a ela. Uma coluna privada não pode declarar `.access()`.
- **`.access({ read, write })`** lista os perfis que recebem a coluna e os
  perfis que podem gravá-la. Omitir uma lista delega essa direção à linha; uma
  lista vazia a bloqueia para todos os chamadores.

O artigo [Acesso a campos](/docs/collections/field-access/) detalha o que um chamador visualiza quando
uma coluna é ocultada, bem como todas as portas de entrada às quais a regra se aplica.

## Colunas de armazenamento

<span class="since-badge" data-since="0.31">Desde 0.31</span>

`col.storage(options)` armazena o caminho de um arquivo em um bucket de armazenamento. A rota
de upload impõe `accept` e `maxBytes`, e a varredura de órfãos considera o arquivo como
referenciado enquanto uma linha contiver seu caminho. `.multiple()` faz com que a coluna armazene
múltiplos caminhos (`TEXT[]`).

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const listings = defineTable("listings", {
    columns: {
        id:     col.uuid().primaryKey().defaultRandom(),
        cover:  col.storage({ path: "listings/{id}/", accept: ["image/*"], maxBytes: "10MB",
                              imageResize: { maxWidth: 1600, format: "webp", quality: 80 } }),
        photos: col.storage({ path: "listings/{id}/gallery/", accept: ["image/*"] }).multiple(),
        terms:  col.storage({ path: "listings/terms/", accept: ["application/pdf"], public: true }),
    },
    rls: "admin-only",
});
```

| Opção | O que faz |
|---|---|
| `path` | **Obrigatório.** O destino dos arquivos, como um modelo de caminho (path template): `"posts/heroes/"`, `"users/{id}/"`. |
| `source` | O bucket, declarado em `backend/resources.ts`. O bucket padrão quando omitido. |
| `accept` | Tipos MIME aceitos, com caracteres curinga: `["image/*", "application/pdf"]`. |
| `maxBytes` | O maior arquivo aceito: um número de bytes ou um tamanho legível como `"10MB"`, `"512 kb"`, `"1.5GB"`. Múltiplos binários: 1 MB são 1.048.576 bytes. Um tamanho ilegível lança um erro. |
| `imageResize` | Redimensiona imagens antes de armazená-las: `maxWidth`, `maxHeight`, `mode` (`"contain"` ou `"cover"`), `format` (`"original"`, `"jpeg"`, `"png"`, `"webp"`), `quality`. |
| `public` | Os arquivos são legíveis sem uma URL assinada. |
| `fileName` | O nome do arquivo armazenado, como um modelo. O nome original do upload quando omitido. |
| `metadata` | Metadados armazenados com cada arquivo. |
| `includeBucketUrl` | Armazena a URL do bucket antes do caminho. |
| `storeUrl` | Armazena a URL de download em vez do caminho. |

Uma coluna de armazenamento aceita as regras de validação de colunas de texto. Um arquivo dentro de um
documento JSON é `json.storage()`, com as mesmas opções; consulte
[Documentos JSON](/docs/schema/json/). Quem pode fazer upload e download de determinados caminhos é definido em
[Autorização de armazenamento](/docs/backend/storage-authorization/); a entrega e
o cache de arquivos são abordados em [Armazenamento](/docs/backend/storage/).

## O que é recusado

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Ao carregar o módulo, um construtor lança um erro para:

- `col.varchar()` ou `col.char()` sem um comprimento definido; um `length` ou `dimensions`
  que não seja um número inteiro positivo, e `col.numeric({ scale })` sem precisão;
- `col.enum([])`, `pgEnum(name, { … })` e `.array()` de um array;
- um valor padrão ou expressão gerada `sql` que contenha interpolação;
- uma segunda marcação (stamp) diferente na mesma coluna, e `.oneOf()` com um valor que
  não seja string ou número;
- `.access()` cujo `read` ou `write` não seja uma lista de nomes de perfis não vazios;
- `col.storage()` sem um `path`, ou com um `maxBytes` que não corresponda a um tamanho válido.

Ao compilar o esquema, a tabela é recusada por:

- um valor padrão em conjunto com `.generatedAlwaysAs()`, ou uma marcação (stamp) combinada a ele;
- `.generatedByDefaultAsIdentity()` em uma coluna não inteira, `.defaultRandom()` em uma coluna que
  não seja `uuid`, uma marcação de tempo em uma coluna não temporal, uma marcação de usuário em uma coluna
  que não seja texto nem `uuid`;
- uma chave primária `.private()`, ou uma chave primária de tipo `timestamptz` ou `time`;
- uma chave primária em uma coluna `jsonb`, `json`, geopoint, `vector`, `bytea`, array ou
  lista customizada: uma chave deve ser um escalar (texto, `varchar`, `char`, `uuid`, um
  enum, um número, um booleano ou uma data). O `schema introspect` ignora tabelas que tenham
  chaves desse tipo e relata o motivo;
- um `.array()` de `jsonb`, `json`, `vector`, `bytea`, geopoints ou
  `col.custom()` (consulte [Arrays](#arrays));
- uma regra de `.validate()` não suportada pelo tipo da coluna, por seus itens ou por um nó JSON
  (`integer` em uma coluna de texto, `trim` em um número, `minItems` em um escalar);
- uma coluna que seja ao mesmo tempo `.private()` e declare `.access()`;
- um `.transform()` na coluna e outro em sua estrutura JSON;
- um `col.custom({ dataType })` cujo nome de tipo não siga a estrutura de um
  nome de tipo Postgres;
- `.oneOf([])` e `.oneOf()` em uma coluna que não seja texto nem número;
- um enum com valor em branco ou repetido, ou um padrão que não esteja entre os seus
  valores;
- duas chaves que resolvam para a mesma coluna SQL, inclusive após o Postgres
  truncar os nomes para 63 bytes;
- um tipo enum nomeado que receba duas listas de valores diferentes.

Cada recusa informa a tabela, a coluna e o que escrever para corrigir.

Grafias do Drizzle que teriam outro significado aqui não compilam, e o
compilador exibe o que escrever: `col.timestamp()` sem `withTimezone: true`,
`.references()`, `.$defaultFn()`, `.$onUpdate()`, `.generatedAlwaysAsIdentity()`,
`.unique("name")`, `mode: "string"` de `numeric`, além de `col.inet()`, `col.interval()`
e outros tipos que o Rebase referencia apenas por meio de `col.custom({ dataType })`.

## Próximos passos

<span class="since-badge" data-since="0.31">Desde 0.31</span>

- [Documentos JSON](/docs/schema/json/): a estrutura de uma coluna `jsonb`
- [Relações](/docs/collections/relations/): chaves estrangeiras vêm de `rel.*`, não de colunas
- [Acesso a campos](/docs/collections/field-access/): detalhes sobre `.access()`, `.private()` e `.readOnly()`
- [Inferência de tipos](/docs/schema/types/): o impacto de cada modificador em `InferRow` e `InferInsert`
