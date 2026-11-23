---
sourceHash: b2705ba2e3901257
title: Colunas
sidebar_label: Colunas
description: "Cada construtor e modificador col.*: o tipo do Postgres que cada um cria, o tipo que um cliente lê e grava, e o que a API impõe — nulidade, padrões, carimbos, validação, conjuntos fechados de valores, acesso e armazenamento."
---

Uma coluna é um construtor `col.*`, refinado por modificadores. O construtor define o
tipo do Postgres; os modificadores definem todo o resto: se a coluna pode ser
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

Os construtores são imutáveis: cada modificador retorna um novo construtor, de modo que uma coluna pode ser
declarada uma única vez e compartilhada entre tabelas.

Após o ponto, a sintaxe de uma coluna se assemelha ao `pg-core` do [Drizzle](https://orm.drizzle.team/docs/column-types/pg):
os mesmos nomes de construtores, um nome opcional de coluna SQL primeiro, depois
o objeto de configuração do Drizzle e, em seguida, a cadeia — `col.varchar({ length: 32 })`,
`col.timestamp({ withTimezone: true })`, `col.text().array()`,
`` .default(sql`now()`) ``. Uma sintaxe do Drizzle que significaria outra coisa aqui
não compila, e o erro informa o que deve ser escrito em seu lugar. Duas diferenças a
ter em mente:

- **Uma chave estrangeira é uma relação.** Declare-a sob `relations`:
  `author: rel.belongsTo(() => users, { localKey: "author_id" })`. A
  chave da relação é o que o `include` referencia. `.references()` não existe, e
  informa isso explicitamente. Consulte [Relações](/docs/collections/relations/).
- **`.defaultNow()` é apenas um valor padrão de banco de dados**: `DEFAULT now()`, que um cliente
  ainda pode sobrescrever. `.onCreateNow()` é um [carimbo](#carimbos) do servidor: o servidor
  grava a hora na criação, independentemente do que o cliente enviou.

## Construtores

Um construtor por tipo do Postgres. O tipo transmitido (wire type) é o que um cliente lê em uma linha e
envia em uma gravação, e como o SDK e o [`InferRow`](/docs/schema/types/) tipam
a coluna. Cada construtor aceita um nome opcional de coluna SQL como seu primeiro
argumento (`col.text("legacy_title")`); sem ele, o nome SQL será a conversão da chave para snake_case.

| Construtor | Tipo do Postgres | Tipo transmitido (Wire type) | Notas |
|---|---|---|---|
| `col.uuid()` | `UUID` | `string` | `.defaultRandom()` para `gen_random_uuid()` |
| `col.text()` | `TEXT` | `string` | `col.text({ enum: [...] })` aceita apenas esses valores; consulte [Conjuntos fechados de valores](#conjuntos-fechados-de-valores) |
| `col.varchar({ length })` | `VARCHAR(n)` | `string` | o tamanho é obrigatório; também aceita `enum` |
| `col.char({ length })` | `CHAR(n)` | `string` | o tamanho é obrigatório; também aceita `enum` |
| `col.enum(values)` | um tipo enum do Postgres, `<table>_<column>` | a união de `values` | consulte [Conjuntos fechados de valores](#conjuntos-fechados-de-valores) |
| `pgEnum(name, values)`, depois `status()` | um tipo enum nomeado do Postgres | a união de `values` | cada coluna que o utiliza compartilha o mesmo tipo |
| `col.smallint()` | `SMALLINT` | `number` | |
| `col.integer()` | `INTEGER` | `number` | |
| `col.bigint({ mode: "number" })` | `BIGINT` | `number` | lido e gravado como um número JavaScript |
| `col.smallserial()` | `SMALLSERIAL` | `number` | possui um valor padrão; prefira `col.smallint().generatedByDefaultAsIdentity()` em um novo schema |
| `col.serial()` | `SERIAL` | `number` | possui um valor padrão; prefira `col.integer().generatedByDefaultAsIdentity()` |
| `col.bigserial({ mode: "number" })` | `BIGSERIAL` | `number` | possui um valor padrão; prefira `col.bigint({ mode: "number" }).generatedByDefaultAsIdentity()` |
| `col.real()` | `REAL` | `number` | |
| `col.doublePrecision()` | `DOUBLE PRECISION` | `number` | |
| `col.numeric({ precision?, scale? })` | `NUMERIC`, `NUMERIC(p)`, `NUMERIC(p, s)` | `number` | uma escala requer uma precisão; `col.decimal()` é o mesmo construtor |
| `col.boolean()` | `BOOLEAN` | `boolean` | |
| `col.timestamp({ withTimezone: true })` | `TIMESTAMPTZ` | `string` (ISO 8601) | uma gravação também aceita um `Date`; um timestamp sem fuso horário é `col.custom({ dataType: "timestamp" })` |
| `col.date()` | `DATE` | `string` (`YYYY-MM-DD`) | uma gravação também aceita um `Date` |
| `col.time()` | `TIME` | `string` (`HH:MM:SS`) | uma gravação também aceita um `Date` |
| `col.jsonb()` / `col.jsonb(shape)` | `JSONB` | `unknown` (`.$type<T>()` o tipa), ou o tipo do shape | consulte [Documentos JSON](/docs/schema/json/) |
| `col.json()` / `col.json(shape)` | `JSON` | igual a `jsonb` | mantém o texto exatamente como recebido; prefira `jsonb` |
| `<builder>.array()` | `<inner>[]` | um array do tipo transmitido interno | `col.text().array()`; sem arrays de arrays; consulte [Arrays](#arrays) |
| `col.vector({ dimensions, index? })` | `vector(dimensions)` (pgvector) | `number[]` | um índice cosseno HNSW, a menos que `index` especifique o contrário; consulte [Busca vetorial](/docs/backend/vector-search/) |
| `col.bytea()` | `BYTEA` | `string` (base64) | |
| `col.geopoint()` | `JSONB` | `{ latitude: number; longitude: number }` | |
| `col.storage(options)` | `TEXT` | `string` (o caminho do arquivo) | `.multiple()` o transforma em `TEXT[]`; consulte [Colunas de armazenamento](#colunas-de-armazenamento) |
| `col.custom({ dataType })` | qualquer outro tipo do Postgres, verbatim (`"inet"`, `"citext"`) | `string` (`.$type<T>()` o tipa) | O Rebase nomeia o tipo no DDL e repassa os valores |

## Modificadores

Todos os construtores contam com o primeiro grupo. Os demais existem apenas nos construtores onde
fazem sentido; chamar um modificador incompatível gera um erro de tipo.

| Modificador | Em | Banco de Dados | API e tipos |
|---|---|---|---|
| `.notNull()` | qualquer coluna | `NOT NULL` | nunca `null` em uma linha; obrigatório na criação a menos que tenha um padrão |
| `.primaryKey()` | qualquer coluna | parte da chave primária, `NOT NULL` | ausente do tipo `Update` |
| `.unique()` | qualquer coluna | `UNIQUE` em coluna única | uma duplicata resulta em `409` |
| `.default(value)` | qualquer coluna | `DEFAULT <value>` | aplicado também pelo driver na criação; opcional na criação |
| `` .default(sql`expr`) `` | qualquer coluna | `DEFAULT <expr>` | opcional na criação; `sql` é importado junto com `col` |
| `.dbDefault()` | qualquer coluna | mantém o padrão existente no banco de dados inalterado | opcional na criação |
| `.serverDefault()` | qualquer coluna | nenhum | preenchido por um hook; opcional na criação, e o formulário do painel não o exige |
| `` .generatedAlwaysAs(sql`expr`) `` | qualquer coluna | `GENERATED ALWAYS AS (<expr>) STORED` | nunca gravável, por ninguém |
| `.$type<T>()` | qualquer coluna | nenhum | apenas tipa o valor para o TypeScript, como no Drizzle |
| `.array()` | qualquer coluna | `<type>[]` | consulte [Arrays](#arrays) |
| `.readOnly()` | qualquer coluna | nenhum | gravações de clientes recusadas; ausente de `Insert` e `Update` |
| `.private()` | qualquer coluna | nenhum | nunca exposto via rede, no SDK ou no OpenAPI |
| `.access({ read?, write? })` | qualquer coluna | nenhum | leitura e gravação por papel (role); consulte [Acesso a campos](/docs/collections/field-access/) |
| `.describe(text)` | qualquer coluna | nenhum | a descrição no OpenAPI e no MCP |
| `.validate(rules)` | qualquer coluna | nenhum | validado antes de cada gravação; as regras dependem do tipo, consulte [Validação](#validação) |
| `.transform({ beforeSave?, afterRead? })` | qualquer coluna | nenhum | hooks a nível de campo; `value` é `T \| null` a menos que `.notNull()` venha primeiro; consulte [Hooks de tabela](/docs/collections/callbacks/#field-hooks-transform) |
| `.oneOf(values)` | colunas numéricas | nenhum | somente esses valores são aceitos; tipado como a união deles (uma coluna de texto aceita `{ enum: [...] }`) |
| `.defaultRandom()` | `col.uuid()` | `DEFAULT gen_random_uuid()` | opcional na criação |
| `.generatedByDefaultAsIdentity()` | `col.smallint()`, `col.integer()`, `col.bigint({ mode: "number" })` | `GENERATED BY DEFAULT AS IDENTITY` | opcional na criação |
| `.defaultNow()` | `timestamptz`, `date`, `time` | `DEFAULT now()` | opcional na criação; um cliente ainda pode enviar um valor |
| `.onCreateNow()` | `timestamptz`, `date`, `time` | `DEFAULT now()` | o servidor carimba a hora na criação |
| `.onUpdateNow()` | `timestamptz`, `date`, `time` | `DEFAULT now()` e um gatilho `BEFORE UPDATE` | o servidor carimba a hora na criação e em cada atualização |
| `.onCreateUser()` | colunas de texto, `col.uuid()` | nenhum | o servidor grava o id do chamador na criação |
| `.onUpdateUser()` | colunas de texto, `col.uuid()` | nenhum | o servidor grava o id do chamador a cada gravação |
| `.userId()` | colunas de texto, `col.uuid()` | nenhum | a coluna armazena o id de um usuário; o painel oferece um seletor de usuários; consulte [Colunas de usuário](#colunas-de-usuário) |
| `.multiple()` | `col.storage()` | `TEXT[]` | a coluna armazena múltiplos caminhos de arquivo |

## Nulo, obrigatório e padrões

As colunas aceitam valores nulos por padrão. `.notNull()` e `.primaryKey()` tornam uma coluna
`NOT NULL`, e a API passa a exigi-la na criação, a menos que possua um valor padrão. Uma
coluna `NOT NULL` é tipada como `T` em uma linha; qualquer outra coluna é `T | null`.

Um valor padrão pode ser definido por `.default()`, `` .default(sql`…`) ``, `.defaultNow()`,
`.dbDefault()`, `.serverDefault()`, `.defaultRandom()`,
`.generatedByDefaultAsIdentity()`, um carimbo, ou um construtor serial. Uma coluna com um
valor padrão pode ser omitida na criação:

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
  pelo driver na criação, garantindo que o resultado da linha seja o mesmo, independentemente de quem a insira. Uma
  coluna temporal também aceita um `Date`, armazenado como sua string ISO. O padrão de uma
  coluna enum deve ser um de seus valores.
- **`` .default(sql`expression`) ``** é avaliado pelo Postgres. A expressão é
  escrita no DDL como está, portanto a tag `sql` não aceita `${…}`.
  `.defaultNow()` equivale a `` .default(sql`now()`) ``.
- **`.dbDefault()`** indica que o banco de dados já possui um padrão que o schema
  não declara. Uma criação pode omitir a coluna, e um schema push não remove
  o padrão.
- **`.serverDefault()`** indica que o próprio código de servidor da tabela preenche a coluna quando
  uma criação a omite: um `hooks.beforeSave` que deriva um slug a partir do
  título, ou o `.transform()` da própria coluna. Como um hook é um código que clientes externos não podem inspecionar, a
  coluna explicita o que faz. Nenhum default de DDL é gravado; uma criação pode omitir a
  coluna, o OpenAPI não a lista como obrigatória, e o formulário do painel permite que um
  registro seja criado sem ela (nenhum `filledByServer` na customização).

`.generatedAlwaysAs()` não pode ter um padrão nem um carimbo: o Postgres calcula a coluna
a cada gravação. Uma coluna de chave primária não pode ser `.private()`.

## Carimbos

Um carimbo (stamp) é um valor que o servidor grava em uma coluna por conta própria. Ele sobrescreve
qualquer valor que um cliente envie para essa coluna.

| Carimbo | Gravações | Quando |
|---|---|---|
| `.onCreateNow()` | a hora atual | na criação |
| `.onUpdateNow()` | a hora atual | na criação e a cada atualização |
| `.onCreateUser()` | o id de usuário do chamador | na criação |
| `.onUpdateUser()` | o id de usuário do chamador | na criação e a cada atualização |

Uma coluna comporta apenas um carimbo. Chamar um segundo carimbo diferente lança um erro quando o
módulo carrega; `.onUpdateNow()` por si só já carimba a linha no momento em que ela é criada.
Colunas de carimbo permanecem anuláveis a menos que você defina `.notNull()`.

`.onCreateUser()` é a forma como uma coluna comparada com o chamador por uma regra de segurança a nível de linha
(`ownerField`) obtém seu valor. Uma coluna preenchida pelo próprio chamador é uma coluna
sobre a qual ele pode mentir.

## Colunas de usuário

`.userId()` declara que uma coluna armazena o id de um usuário. Trata-se de um significado semântico, não de um
tipo: a coluna continua sendo `text` (ou `varchar`, `char`, `uuid`), e o
descritor que o servidor fornece inclui `semantic: "user"`.

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

- O painel administrativo renderiza um seletor de usuários para a coluna em vez de um
  campo de texto simples, e exibe o usuário em vez do id bruto.
- Um chamador com permissão para gravar na tabela pode buscar usuários para preenchê-la. A leitura
  do seletor responde a essa busca mesmo quando a segurança a nível de linha oculta as linhas de outros usuários
  para ele.

Funciona com `col.text()`, `col.varchar()`, `col.char()` e `col.uuid()`,
nos itens de um array (`col.text().userId().array()`), e em
`json.string()` dentro de um [documento JSON](/docs/schema/json/). Em qualquer outro lugar,
uma exceção é lançada quando o módulo carrega. Ele não declara chave estrangeira: use
`rel.belongsTo(() => users)` quando o banco de dados precisar impor essa restrição. Para fazer com que o
servidor preencha a coluna com o id do chamador, use um [carimbo](#carimbos) em seu lugar.

## Validação

`.validate(rules)` recebe as regras correspondentes ao tipo da coluna. A API as verifica
antes de uma criação ou atualização e recusa a gravação com um código `400` indicando
a coluna. Chamar `.validate()` duas vezes mescla as regras.

| Regra | Colunas de texto e `col.storage()` | Colunas numéricas | `timestamptz`, `date`, `time` | Arrays |
|---|---|---|---|---|
| `min`, `max` | tamanho | limites inclusivos | valor mínimo e máximo (string ISO ou `Date`) | |
| `length` | tamanho exato | | | |
| `matches`, `matchesFlags`, `matchesMessage` | um padrão (string ou `RegExp`) e a mensagem de erro | | | |
| `email`, `url` | o valor deve ser um endereço de e-mail ou uma URL | | | |
| `trim`, `lowercase`, `uppercase` | o valor é normalizado antes de ser armazenado | | | |
| `lessThan`, `moreThan` | | limites exclusivos | | |
| `positive`, `negative`, `integer` | | sinal, número inteiro | | |
| `minItems`, `maxItems`, `uniqueItems` | | | | contagem de itens, sem duplicatas |
| `requiredMessage` | ✓ | ✓ | ✓ | ✓ |

`requiredMessage` é o erro que uma criação recebe ao omitir uma coluna `.notNull()`
sem um padrão. Todos os outros tipos de coluna (`uuid`, `enum`, `boolean`,
JSON, `vector`, `bytea`, `geopoint`) aceitam apenas `requiredMessage`.

Um `RegExp` é armazenado como sua expressão de origem e sinalizadores (flags), e um limite de `Date` como sua
string ISO, garantindo que as regras servidas pela rede correspondam exatamente às regras validadas pelo servidor.

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

Em `col.varchar({ length })` e `col.char({ length })`, o tamanho é imposto
pelo Postgres e pela API. Um `max` que divirja dele cria uma contradição; declare
o tamanho apenas uma vez.

## Conjuntos fechados de valores

Existem duas formas de restringir a aceitação a valores específicos:

- **Um tipo enum do Postgres**, para que o banco de dados também aplique a restrição.
  `col.enum(values)` cria um tipo com o nome `<table>_<column>`. Um tipo com um nome
  à sua escolha, compartilhado por várias colunas, é declarado uma única vez com
  `pgEnum(name, values)` — como no Drizzle — e invocado em cada coluna:
  `postStatus()`. Duas declarações com o mesmo nome devem listar exatamente os mesmos valores
  na mesma ordem.
- **Um conjunto validado pela API**, sem um tipo no Postgres: `{ enum: [...] }` em
  `col.text()`, `col.varchar()` ou `col.char()`, e `.oneOf(values)` em uma
  coluna numérica. Essa é também a sintaxe para um array de strings conhecidas:
  `col.text({ enum: ["a", "b"] }).array()`.

Todas essas opções tipam a coluna como a união de seus valores: `status` abaixo é
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

Rótulos e cores para os valores dizem respeito à apresentação. Pertencem ao CMS, não
à tabela.

## Arrays

`.array()` gera um array do Postgres com o tipo correspondente da coluna, como no Drizzle:
`col.text().array()` resulta em `TEXT[]`, `col.integer().array()` em `INTEGER[]`. O que
for encadeado antes de `.array()` descreve cada item individual: seu `{ enum }`, `.validate()`,
`.oneOf()`, opções de armazenamento e `.transform()`. O que vem depois descreve
a coluna do array em si: seu próprio `.validate()` aceita `minItems`, `maxItems` e
`uniqueItems`.

Modificadores que descrevem uma coluna (`.notNull()`, um padrão, `.unique()`,
`.access()`) devem vir após `.array()` — `col.text().array().notNull().default([])`;
antes dele, eles não compilam. Arrays de arrays não são permitidos; use
`col.jsonb()` para listas aninhadas. Um array armazena escalares — texto, `uuid`, números,
booleanos, datas, enums: um `.array()` de `jsonb`, `json`, `vector`, `bytea`,
geopoints ou `col.custom()` é recusado, e uma lista de documentos, pontos ou
vetores deve ser definida como `col.jsonb(json.array(…))`. Um tipo de lista customizado é declarado pelo seu próprio nome:
`col.custom({ dataType: "inet[]" })`.

Cada item é servido conforme o seu tipo é servido em uma coluna escalar: um
item de `timestamptz[]` como uma string RFC 3339, um item de `numeric[]` como um número, e
um item nulo como `null`.

## Chaves, identidade e serials

`.generatedByDefaultAsIdentity()` define uma coluna de inteiros como `GENERATED BY DEFAULT
AS IDENTITY`. Essa é a forma recomendada para chaves primárias inteiras em novos schemas
(`.generatedAlwaysAsIdentity()` não compila: o Rebase cria identidades apenas por
padrão). Os construtores seriais (`col.smallserial()`, `col.serial()`,
`col.bigserial({ mode: "number" })`) existem para schemas que
já os utilizam; uma coluna que referencia uma chave serial deve ser o inteiro simples da
mesma largura. Consulte [Chaves primárias](/docs/schema/#primary-keys) para chaves compostas.

`col.bigint({ mode: "number" })` é lido e gravado como um `number` do JavaScript
(a opção `mode: "bigint"` do Drizzle não compila), sendo exato até
2⁵³ − 1. `col.numeric()` também é um `number`, portanto carrega a precisão de um
double pela rede, independentemente da precisão armazenada pelo Postgres.

## Quem pode ler e gravar uma coluna

A segurança a nível de linha decide quais linhas um chamador pode acessar. Três modificadores restringem
o que ele pode visualizar de uma linha e o que pode definir:

- **`.readOnly()`** recusa qualquer gravação feita pelo cliente na coluna, tanto na criação quanto na
  atualização, independentemente do papel do chamador. O banco de dados (um default, um gatilho) e
  o código do servidor ainda podem preenchê-la. A coluna não estará presente nos tipos `Insert` e `Update`.
- **`.private()`** mantém a coluna restrita ao servidor: oculta de todas as linhas expostas via
  rede, do SDK e do OpenAPI, e proibida em filtros e ordenações. Hooks e o
  código do servidor ainda podem acessá-la. Uma coluna privada não pode declarar `.access()`.
- **`.access({ read, write })`** especifica os papéis que podem receber a coluna e os
  papéis que podem gravá-la. Omitir uma lista deixa essa operação condicionada à linha; fornecer
  uma lista vazia bloqueia o acesso para qualquer chamador.

O artigo [Acesso a campos](/docs/collections/field-access/) detalha o que o chamador recebe quando
uma coluna é ocultada e todas as interfaces às quais essa regra se aplica.

## Colunas de armazenamento

`col.storage(options)` armazena o caminho de um arquivo em um bucket de armazenamento. A rota
de upload impõe `accept` e `maxBytes`, e a limpeza de arquivos órfãos considera o arquivo como
referenciado enquanto uma linha contiver o seu caminho. `.multiple()` permite que a coluna contenha
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
| `path` | **Obrigatório.** Destino dos arquivos, em forma de template de caminho: `"posts/heroes/"`, `"users/{id}/"`. |
| `source` | O bucket, declarado em `backend/resources.ts`. O bucket padrão quando omitido. |
| `accept` | Tipos MIME aceitos, com caracteres curinga: `["image/*", "application/pdf"]`. |
| `maxBytes` | O tamanho máximo de arquivo aceito: um número em bytes ou uma string de tamanho como `"10MB"`, `"512 kb"`, `"1.5GB"`. Múltiplos binários: 1 MB equivale a 1.048.576 bytes. Um tamanho ilegível lança erro. |
| `imageResize` | Redimensiona imagens antes de armazená-las: `maxWidth`, `maxHeight`, `mode` (`"contain"` ou `"cover"`), `format` (`"original"`, `"jpeg"`, `"png"`, `"webp"`), `quality`. |
| `public` | Os arquivos podem ser lidos sem a necessidade de uma URL assinada. |
| `fileName` | O nome do arquivo armazenado, em forma de template. Usa o nome original enviado quando omitido. |
| `metadata` | Metadados armazenados junto com cada arquivo. |
| `includeBucketUrl` | Armazena a URL do bucket como prefixo do caminho. |
| `storeUrl` | Armazena a URL de download em vez do caminho. |

Uma coluna de armazenamento aceita as mesmas regras de validação de colunas de texto. Um arquivo dentro de um documento
JSON é definido como `json.storage()`, com as mesmas opções; consulte
[Documentos JSON](/docs/schema/json/). Para configurar quem pode fazer upload e download em determinados caminhos, consulte
[Autorização de armazenamento](/docs/backend/storage-authorization/); para o envio e
cache dos arquivos, consulte [Armazenamento](/docs/backend/storage/).

## O que é recusado

Ao carregar o módulo, um construtor lança um erro nos seguintes casos:

- `col.varchar()` ou `col.char()` sem definição de tamanho; um `length` ou `dimensions`
  que não seja um número inteiro positivo, e `col.numeric({ scale })` sem precisão;
- `col.enum([])`, `pgEnum(name, { … })`, e `.array()` de um array;
- um padrão `sql` ou expressão gerada contendo interpolação;
- um segundo carimbo diferente na mesma coluna, e `.oneOf()` com um valor que
  não seja uma string ou um número;
- `.access()` cujo `read` ou `write` não seja uma lista de nomes de papéis não vazios;
- `col.storage()` sem a propriedade `path`, ou com um `maxBytes` que não corresponda a um tamanho válido.

Ao compilar o schema, a tabela é recusada se contiver:

- um padrão em conjunto com `.generatedAlwaysAs()`, ou um carimbo junto a ele;
- `.generatedByDefaultAsIdentity()` em uma coluna não inteira, `.defaultRandom()` em uma coluna que
  não seja `uuid`, um carimbo de tempo em uma coluna não temporal, ou um carimbo de usuário em uma coluna que
  não seja texto nem `uuid`;
- uma chave primária `.private()`, ou uma chave primária dos tipos `timestamptz` ou `time`;
- uma chave primária em uma coluna `jsonb`, `json`, geopoint, `vector`, `bytea`, array ou
  lista customizada: uma chave deve ser um escalar (texto, `varchar`, `char`, `uuid`,
  enum, número, booleano ou data). O comando `schema introspect` ignora tabelas com chaves
  desse formato e explica o motivo;
- um `.array()` de `jsonb`, `json`, `vector`, `bytea`, geopoints ou
  `col.custom()` (consulte [Arrays](#arrays));
- uma regra de `.validate()` que o tipo de coluna, seus itens ou um nó JSON não
  suportem (`integer` em coluna de texto, `trim` em número, `minItems` em um escalar);
- uma coluna que possua tanto `.private()` quanto `.access()`;
- um `.transform()` aplicado na coluna e outro no seu formato (shape) JSON;
- um `col.custom({ dataType })` cujo nome de tipo não siga a estrutura de um
  nome de tipo válido do Postgres;
- `.oneOf([])`, e `.oneOf()` em uma coluna que não seja de texto nem numérica;
- um enum com valor em branco ou repetido, ou com um padrão que não pertença aos seus valores válidos;
- duas chaves que resultem no mesmo nome de coluna SQL, inclusive após o truncamento
  do Postgres para 63 bytes;
- um tipo enum nomeado que receba duas listas de valores divergentes.

Cada recusa especifica a tabela, a coluna e a sintaxe correta a ser utilizada.

Sintaxes do Drizzle que teriam outro significado aqui não compilam, e o
compilador exibe o que escrever: `col.timestamp()` sem `withTimezone: true`,
`.references()`, `.$defaultFn()`, `.$onUpdate()`, `.generatedAlwaysAsIdentity()`,
`.unique("name")`, `mode: "string"` do `numeric`, além de `col.inet()`, `col.interval()`
e demais tipos que o Rebase expõe exclusivamente via `col.custom({ dataType })`.

## Próximos passos

- [Documentos JSON](/docs/schema/json/): a estrutura de uma coluna `jsonb`
- [Relações](/docs/collections/relations/): chaves estrangeiras são definidas via `rel.*`, não nas colunas
- [Acesso a campos](/docs/collections/field-access/): `.access()`, `.private()` e `.readOnly()` em detalhes
- [Inferência de tipos](/docs/schema/types/): o impacto de cada modificador no `InferRow` e `InferInsert`
