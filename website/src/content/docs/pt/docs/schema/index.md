---
sourceHash: 59fc3060e8bce0e2
title: Tabelas
sidebar_label: Tabelas
description: "Declare tabelas Postgres em backend/schema com defineTable: colunas, relações e uma postura obrigatória de row-level security. Cada tabela se torna SQL, políticas, rotas REST, realtime e MCP, e tipos do SDK."
---

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Uma tabela é declarada uma única vez, em TypeScript, no diretório `backend/schema/`.
Essa declaração é a única coisa que o backend sabe sobre os seus dados. A partir dela,
o Rebase gera a tabela e suas políticas de row-level security no Postgres,
disponibiliza a tabela via REST, realtime e MCP, e faz a tipagem do SDK.

```ts
// backend/schema/posts.ts
import { defineTable, col, rel } from "@rebasepro/server/schema";
import { users } from "./users";

export const posts = defineTable("posts", {
    columns: {
        id:          col.uuid().primaryKey().defaultRandom(),
        title:       col.text().notNull().validate({ min: 3, max: 200 }),
        status:      col.enum(["draft", "published", "archived"]).notNull().default("draft"),
        publishDate: col.timestamp({ withTimezone: true }),
        createdAt:   col.timestamp({ withTimezone: true }).notNull().onCreateNow(),
    },
    relations: {
        author: rel.belongsTo(() => users, { notNull: true }),
    },
    rls: [
        { operation: "select", access: "public", condition: { status: "published" } },
        { operations: ["select", "insert", "update"], roles: ["editor"] },
        { operation: "delete", roles: ["admin"] },
    ],
});
```

Vale a pena notar três coisas neste exemplo antes de qualquer outra coisa:

- **As colunas são anuláveis a menos que você especifique o contrário**, como no SQL. O `.notNull()`
  torna uma coluna `NOT NULL` e obrigatória na criação. Consulte [Colunas](/docs/schema/columns/).
- **A chave estrangeira é declarada pela relação.** `author` deriva uma
  coluna `author_id`, sua constraint e seu índice. Consulte
  [Relações](/docs/collections/relations/).
- **`rls` é obrigatório.** Uma tabela sem uma postura de row-level security gera um erro
  de tipo e é recusada quando o schema é compilado. Consulte
  [Row-level security](/docs/collections/security-rules/).

:::note[Vindo de collections?]
As tabelas substituem os arquivos de `config/collections` das versões anteriores. O CMS
lê seus padrões a partir das tabelas; suas próprias personalizações ficam no
frontend. O guia de atualização para esta versão cobre essa migração.
:::

## O diretório `backend/schema`

<span class="since-badge" data-since="0.31">Desde 0.31</span>

```text
backend/
├── schema/
│   ├── index.ts      # exports every table and view, and optionally defaultRls
│   ├── users.ts      # defineAuthTable("users", …)
│   ├── posts.ts      # defineTable("posts", …)
│   └── tags.ts       # defineTable("tags", …)
├── functions/
└── crons/
```

Um arquivo por tabela é uma convenção, não uma regra. O que conta é o
`backend/schema/index.ts`: o backend lê as tabelas e views que ele exporta,
e nada mais.

```ts
// backend/schema/index.ts
import type { DefaultRls } from "@rebasepro/server/schema";

export { users } from "./users";
export { posts } from "./posts";
export { tags } from "./tags";

// What every table declared with `rls: "inherit"` takes.
export const defaultRls: DefaultRls = [
    { operation: "select", access: "authenticated" },
];
```

`defaultRls` é opcional. Ele só é lido por tabelas que especificam
`rls: "inherit"`; um projeto que nunca usa `"inherit"` não precisa dele.

O diretório é `backend/schema`, a menos que o `rebase.json` especifique outro com
a chave `tables`. A chave `schema` mantém seu significado antigo: o módulo
gerado do Drizzle.

```json
{
    "apps": {
        "backend": {
            "type": "backend",
            "runtime": "managed",
            "tables": "backend/schema"
        }
    }
}
```

Um projeto sem `backend/schema/index.ts` não declara tabelas. O backend
então lê as tabelas diretamente do banco de dados em execução na inicialização e disponibiliza apenas aquelas
com row-level security habilitado. Consulte [Backend only](/docs/getting-started/headless/).

Os arquivos de schema são TypeScript puro, sem dependências de servidor:
`@rebasepro/server/schema` não carrega nada do servidor. Um frontend pode fazer
`import type { posts } from "../../backend/schema/posts"` para tipar seu próprio código
em relação a uma tabela, sem incluir código de backend no bundle do navegador.

## No que uma tabela se torna

<span class="since-badge" data-since="0.31">Desde 0.31</span>

| A partir da declaração | O Rebase gera |
|---|---|
| `columns`, `relations`, `indexes` | o `CREATE TABLE`, chaves estrangeiras, tabelas de junção e índices, gravados em `schema.sql` por `rebase db push` e `rebase db generate` |
| `rls`, `tenant`, a tabela de autenticação | `ENABLE ROW LEVEL SECURITY` e um `CREATE POLICY` por regra e operação, em `policies.sql` |
| `search`, colunas de vetor | a coluna `tsvector` gerada e os índices GIN e ANN |
| o slug | as rotas REST em `/api/data/<slug>`, assinaturas realtime, as ferramentas MCP e o documento OpenAPI |
| os tipos e modificadores das colunas | os tipos `Row`, `Insert` e `Update` do SDK, e os [tipos inferidos](/docs/schema/types/) que você pode usar no seu próprio código |

Todas as superfícies leem a mesma forma compilada da tabela, chamada de seu
descritor: colunas com seus tipos Postgres, nulabilidade, regras de validação e
armazenamento, relações resolvidas para slugs e a postura de row-level security.
O código de hooks nunca sai do servidor; o descritor apenas indica quais
hooks existem. O backend disponibiliza os descritores em `GET /api/schema/tables`,
que é a partir de onde o CMS, o Studio e os apps MCP realizam a renderização.

O pipeline da declaração até o banco de dados é descrito em
[Schema as code](/docs/architecture/schema-as-code/).

## Opções de `defineTable`

<span class="since-badge" data-since="0.31">Desde 0.31</span>

`defineTable(name, config)` recebe o nome da tabela e as seguintes chaves:

| Chave | O que faz |
|---|---|
| `columns` | **Obrigatório.** Construtores `col.*` por chave, na ordem física. Pelo menos um deve ser `.primaryKey()`. Consulte [Colunas](/docs/schema/columns/). |
| `rls` | **Obrigatório.** `"admin-only"`, `"inherit"` ou uma lista não vazia de regras. Consulte [Row-level security](/docs/collections/security-rules/). |
| `relations` | Construtores `rel.*` por nome de relação. Consulte [Relações](/docs/collections/relations/). |
| `slug` | O nome na API, no SDK e em escopos. O nome da tabela quando omitido. |
| `table` | O nome da tabela SQL, quando for diferente do nome. |
| `schema` | O schema Postgres. `public` quando omitido. |
| `database` | Um banco de dados Postgres não padrão, declarado em `backend/resources.ts`. Consulte [Múltiplas fontes](/docs/backend/multiple-sources/). |
| `description` | O que a tabela contém. Exibido no OpenAPI e nas descrições de ferramentas MCP. |
| `defaultPolicies` | `false` gera apenas suas regras, sem as políticas padrão de admin. Recusado com `rls: "admin-only"`. <span class="since-badge" data-since="0.31">Desde 0.31</span> `true` mantém o padrão quando o banco de dados da tabela o desativa para todas as tabelas (`database({ rls: { defaultPolicies: false } })`). Se omitido, a configuração do banco de dados decide. |
| `tenant` | Escopa cada linha para um tenant. Consulte [Tenancy](/docs/collections/tenancy/). |
| `softDelete` | `true` ou `{ field }`: uma exclusão grava um timestamp em vez de remover a linha. Consulte [Soft delete](/docs/collections/soft-delete/). |
| `history` | `true` registra cada escrita na tabela de histórico. Consulte [Histórico de entidades](/docs/backend/history/). |
| `search` | Busca full-text ranqueada sobre as colunas especificadas. Consulte [Busca](/docs/backend/search/). |
| `indexes` | Índices, cada um com a consulta que atende. Consulte [Índices](/docs/backend/indexes/). |
| `hooks` | Lifecycle hooks no lado do servidor. Consulte [Hooks de tabela](/docs/collections/callbacks/). |
| `strictWrites` | Uma escrita que mencione uma coluna não declarada pela tabela resulta em 400. `false` a aceita, para uma coluna que existe no banco de dados sem estar declarada (preenchida por uma trigger, por exemplo). A coluna ainda precisa existir. |
| `metadata` | Quaisquer dados que você queira disponibilizar com o descritor da tabela. O Rebase não faz a leitura deles. |

Mais duas definições compartilham a maioria dessas chaves:
[`defineAuthTable`](/docs/schema/auth-table/) para a tabela onde os usuários são
armazenados, e [`defineView`](/docs/collections/views/) para views SQL.

## Nomes

<span class="since-badge" data-since="0.31">Desde 0.31</span>

O primeiro argumento de `defineTable` é o nome da tabela, e ele é o padrão
para todo o restante:

| Nome | Padrão | Sobrescrita |
|---|---|---|
| Tabela SQL | o nome | `table: "blog_posts"` |
| Slug da API, acessor do SDK, alvo de escopo | o nome | `slug: "articles"` |
| Schema Postgres | `public` | `schema: "content"` |
| Coluna SQL de uma coluna | o snake_case de sua chave | o primeiro argumento do construtor: `col.text("legacy_name")` |

A chave de uma coluna é o seu nome na linha JSON, no SDK e em filtros e
ordenações. Seu nome SQL é o snake_case da chave: `publishDate` é a coluna
`publish_date`, e `photoURL` é `photo_url`. O primeiro argumento de um construtor mapeia
uma chave para qualquer outro nome SQL, como no Drizzle (`col.text("legacy_name")`), que
é como uma tabela adota os nomes de um banco de dados existente sem alterar o que
os clientes veem.

`table` e `schema` devem ser identificadores SQL simples. Duas definições não podem
compartilhar um nome, um slug ou uma tabela SQL. O slug importa além da URL: nomes
de chaves estrangeiras e de colunas de junção são derivados dele, portanto, alterar o slug de uma
tabela que já foi implantada pode renomear colunas. Defina `slug` explicitamente quando ele
precisar ser diferente do nome da tabela e não o altere depois.

## Chaves primárias

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Não existe uma coluna `id` implícita. Cada tabela marca pelo menos uma coluna como
`.primaryKey()`:

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const invoices = defineTable("invoices", {
    columns: {
        id:     col.uuid().primaryKey().defaultRandom(),
        number: col.integer().notNull().unique(),
    },
    rls: "admin-only",
});

// Several key columns form a composite key, in declaration order.
export const dailyStats = defineTable("daily_stats", {
    columns: {
        siteId: col.uuid().primaryKey(),
        day:    col.date().primaryKey(),
        views:  col.integer().notNull().default(0),
    },
    rls: "admin-only",
});
```

Uma coluna de chave é `NOT NULL` por definição. Uma chave `uuid` geralmente recebe
`.defaultRandom()`; uma chave inteira recebe `.generatedByDefaultAsIdentity()`. Uma chave sem um
valor padrão é fornecida por quem chama na criação. Uma coluna de chave não pode ser
`.private()` e não pode ser `timestamptz` ou `time`.

## Quando uma definição é recusada

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Um schema que deixaria uma tabela desprotegida ou indisponibilizável nunca chega ao
banco de dados. Ele é recusado em três momentos:

1. **No editor.** `rls` e `columns` são exigidos pelos tipos, e
   `rls: []` não é uma postura válida. Um campo `tenant` ou `softDelete`, ou uma
   coluna de índice escrita como uma chave simples, que não aponte para nenhuma coluna é um erro de tipo.
2. **Quando o módulo é carregado.** `defineTable` lança um erro em uma tabela sem colunas,
   uma coluna que não seja um construtor `col.*`, uma relação que não seja o resultado
   de um `rel.*`, uma relação com a mesma chave de uma coluna, ou nenhum `rls` utilizável. Isso
   também detecta código JavaScript e conversões de tipo (casts) que os tipos não conseguem ver.
3. **Quando o schema é compilado.** `rebase db generate`, `rebase db push`,
   `rebase doctor` e a inicialização do servidor compilam todas as tabelas juntas e interrompem a execução com
   um `SchemaDefinitionError` que lista cada problema, cada um com a tabela, a
   coluna ou relação, e o que escrever no lugar:

```text
The schema cannot be used (2 problems):
  - posts: the table has no primary key. Mark a column `.primaryKey()` — e.g. `id: col.uuid().primaryKey().defaultRandom()`; several make a composite key in declaration order.
  - comments: `rls: "inherit"` takes the project's `defaultRls`, and none was given. Export `defaultRls` from backend/schema/index.ts (`"admin-only"` or a list of rules), or write this table's own `rls`.
```

A etapa de compilação verifica o que precisa de todas as tabelas de uma vez: alvos de relações e
seus tipos de chave, tabelas de junção reivindicadas por duas relações ao mesmo tempo, slugs e nomes SQL
que colidem (incluindo nomes que colidem quando o Postgres os trunca para 63
bytes), regras que citam uma coluna que a tabela não possui, e `"inherit"`
sem um `defaultRls`. Uma tabela exportada de um arquivo ao lado de `index.ts`, mas não
a partir do próprio `index.ts`, também é recusada: o index é a lista de tabelas.

## Próximos passos

<span class="since-badge" data-since="0.31">Desde 0.31</span>

- [Colunas](/docs/schema/columns/): todos os construtores e modificadores `col.*`
- [Documentos JSON](/docs/schema/json/): `jsonb` tipado e validado com `json.*`
- [Relações](/docs/collections/relations/): os cinco tipos de `rel.*`
- [Row-level security](/docs/collections/security-rules/): a postura de `rls` e suas regras
- [Hooks de tabela](/docs/collections/callbacks/): lifecycle hooks no lado do servidor
- [Inferência de tipos](/docs/schema/types/): `InferRow`, `InferInsert` e `InferUpdate`
