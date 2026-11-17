---
sourceHash: 1090d0be0be163a6
title: Tabelas
sidebar_label: Tabelas
description: "Declare tabelas Postgres em backend/schema com defineTable: colunas, relações e uma postura obrigatória de row-level security. Cada tabela se torna SQL, políticas, rotas REST, realtime e MCP, e tipos de SDK."
---

Uma tabela é declarada uma única vez, em TypeScript, no diretório `backend/schema/`.
Essa declaração é a única coisa que o backend sabe sobre os seus dados. A partir
dela, o Rebase gera a tabela e suas políticas de row-level security no Postgres,
disponibiliza a tabela via REST, realtime e MCP, e tipa o SDK.

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

Três coisas valem a pena notar neste exemplo antes de qualquer outra coisa:

- **As colunas são anuláveis (nullable), a menos que você defina o contrário**, como no SQL. `.notNull()`
  torna a coluna `NOT NULL` e obrigatória na criação. Consulte [Columns](/docs/schema/columns/).
- **A chave estrangeira é declarada pela relação.** `author` deriva uma
  coluna `author_id`, sua restrição e seu índice. Consulte
  [Relations](/docs/collections/relations/).
- **`rls` é obrigatório.** Uma tabela sem uma postura de row-level security resulta
  em um erro de tipo e é recusada quando o schema é compilado. Consulte
  [Row-level security](/docs/collections/security-rules/).

:::note[Vindo de collections?]
As tabelas substituem os arquivos de `config/collections` de versões anteriores. O CMS
lê seus padrões a partir das tabelas; suas próprias personalizações ficam no
frontend. O guia de atualização desta versão aborda essa migração.
:::

## O diretório `backend/schema`

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

Um arquivo por tabela é uma convenção, não uma regra. O que importa é
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

`defaultRls` é opcional. Ele só é lido por tabelas que usam
`rls: "inherit"`; um projeto que nunca usa `"inherit"` não precisa dele.

O diretório é `backend/schema`, a menos que o `rebase.json` especifique outro com
a chave `tables`. A chave `schema` mantém seu significado anterior: o módulo Drizzle
gerado.

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

Um projeto sem `backend/schema/index.ts` não declara nenhuma tabela. O backend
então lê as tabelas do banco de dados ativo durante a inicialização e disponibiliza apenas
aquelas com row-level security habilitado. Consulte [Backend only](/docs/getting-started/headless/).

Os arquivos de schema são TypeScript puro, sem dependências de servidor:
`@rebasepro/server/schema` não carrega nada do servidor. Um frontend pode fazer
`import type { posts } from "../../backend/schema/posts"` para tipar seu próprio código
com base em uma tabela, sem incluir código de backend no bundle do navegador.

## O que uma tabela se torna

| A partir da declaração | O Rebase gera |
|---|---|
| `columns`, `relations`, `indexes` | o `CREATE TABLE`, chaves estrangeiras, tabelas de junção e índices, gravados em `schema.sql` por `rebase db push` e `rebase db generate` |
| `rls`, `tenant`, a tabela de autenticação | `ENABLE ROW LEVEL SECURITY` e um `CREATE POLICY` por regra e operação, em `policies.sql` |
| `search`, colunas vetoriais | a coluna `tsvector` gerada e os índices GIN e ANN |
| o slug | as rotas REST em `/api/data/<slug>`, subscrições em tempo real (realtime), as ferramentas MCP e o documento OpenAPI |
| os tipos e modificadores das colunas | os tipos `Row`, `Insert` e `Update` do SDK, e os [tipos inferidos](/docs/schema/types/) que você pode usar em seu próprio código |

Cada interface lê a mesma forma compilada da tabela, chamada de
descritor: colunas com seus tipos Postgres, nulabilidade, regras de validação
e armazenamento, relações resolvidas para slugs e a postura de row-level security.
O código de hooks nunca sai do servidor; o descritor apenas indica quais
hooks existem. O backend serve os descritores em `GET /api/schema/tables`,
que é o que o CMS, o Studio e os apps MCP utilizam para renderização.

O pipeline da declaração ao banco de dados está descrito em
[Schema as code](/docs/architecture/schema-as-code/).

## Opções do `defineTable`

`defineTable(name, config)` recebe o nome da tabela e as seguintes chaves:

| Chave | O que faz |
|---|---|
| `columns` | **Obrigatório.** Construtores `col.*` por chave, na ordem física. Pelo menos um deve ser `.primaryKey()`. Consulte [Columns](/docs/schema/columns/). |
| `rls` | **Obrigatório.** `"admin-only"`, `"inherit"` ou uma lista não vazia de regras. Consulte [Row-level security](/docs/collections/security-rules/). |
| `relations` | Construtores `rel.*` por nome da relação. Consulte [Relations](/docs/collections/relations/). |
| `slug` | O nome na API, no SDK e nos escopos. Usa o nome da tabela quando omitido. |
| `table` | O nome da tabela SQL, quando for diferente do nome. |
| `schema` | O schema do Postgres. `public` quando omitido. |
| `database` | Um banco de dados Postgres não padrão, declarado em `backend/resources.ts`. Consulte [Multiple sources](/docs/backend/multiple-sources/). |
| `description` | O que a tabela armazena. Exibido no OpenAPI e nas descrições de ferramentas MCP. |
| `defaultPolicies` | `false` gera apenas as suas regras, sem as políticas de baseline de admin. Recusado com `rls: "admin-only"`. `true` mantém a baseline quando o banco de dados da tabela a desativa para todas as tabelas (`database({ rls: { defaultPolicies: false } })`). Quando omitido, a configuração do banco de dados prevalece. |
| `rlsRequired` | `false` disponibiliza a tabela mesmo quando o banco de dados não impõe o seu `rls` (row-level security desativado, políticas declaradas ausentes), para casos em que outra ferramenta gerencia o schema e o próprio app aplica o controle de acesso. `true` o exige sob um banco de dados configurado com `database({ rls: { required: false } })`. Quando omitido, a configuração do banco de dados decide, e uma tabela não protegida pelo banco de dados não é disponibilizada em uma inicialização que não provisiona nada. Consulte [Another tool owns the schema](/docs/deployment/existing-database/#another-tool-owns-the-schema-and-the-app-enforces-access). |
| `tenant` | Restringe o escopo de cada linha a um tenant. Consulte [Tenancy](/docs/collections/tenancy/). |
| `softDelete` | `true` ou `{ field }`: uma exclusão grava um timestamp em vez de remover a linha. Consulte [Soft delete](/docs/collections/soft-delete/). |
| `history` | `true` registra cada escrita na tabela de histórico. Consulte [Entity history](/docs/backend/history/). |
| `search` | Busca textual (full-text search) ranqueada nas colunas especificadas. Consulte [Search](/docs/backend/search/). |
| `indexes` | Índices, cada um com a consulta que atende. Consulte [Indexes](/docs/backend/indexes/). |
| `hooks` | Hooks de ciclo de vida no servidor. Consulte [Table hooks](/docs/collections/callbacks/). |
| `strictWrites` | Uma escrita que especifique uma coluna não declarada na tabela retorna 400. `false` aceita isso, para colunas que existem no banco de dados sem estarem declaradas (preenchidas por uma trigger, por exemplo). A coluna ainda deve existir. |
| `metadata` | Quaisquer dados que você queira disponibilizar junto ao descritor da tabela. O Rebase não faz a leitura desses dados. |

Mais duas definições compartilham a maior parte dessas chaves:
[`defineAuthTable`](/docs/schema/auth-table/) para a tabela onde os usuários são armazenados
e [`defineView`](/docs/collections/views/) para views SQL.

## Nomes

O primeiro argumento de `defineTable` é o nome da tabela, e ele serve de padrão
para todo o restante:

| Nome | Padrão | Substituição |
|---|---|---|
| Tabela SQL | o nome | `table: "blog_posts"` |
| Slug da API, acessor do SDK, alvo de escopo | o nome | `slug: "articles"` |
| Schema do Postgres | `public` | `schema: "content"` |
| Coluna SQL de uma coluna | o snake_case da sua chave | o primeiro argumento do construtor: `col.text("legacy_name")` |

A chave de uma coluna é o seu nome na linha JSON, no SDK e em filtros e
ordenações. Seu nome SQL é o snake_case da chave: `publishDate` é a coluna
`publish_date`, e `photoURL` é `photo_url`. O primeiro argumento de um construtor mapeia
uma chave para qualquer outro nome SQL, assim como no Drizzle (`col.text("legacy_name")`),
permitindo que uma tabela adote os nomes de um banco de dados existente sem alterar o que
os clientes veem.

`table` e `schema` devem ser identificadores SQL simples. Duas definições não podem
compartilhar um mesmo nome, slug ou tabela SQL. O slug é importante além da URL:
nomes de chaves estrangeiras e de colunas de junção são derivados dele, portanto alterar o
slug de uma tabela já implantada pode renomear colunas. Defina `slug` explicitamente
quando ele precisar ser diferente do nome da tabela e não o altere depois.

## Chaves primárias

Não existe uma coluna `id` implícita. Toda tabela deve marcar pelo menos uma coluna
com `.primaryKey()`:

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

Uma coluna de chave é `NOT NULL` por definição. Uma chave `uuid` normalmente usa
`.defaultRandom()`; uma chave inteira usa `.generatedByDefaultAsIdentity()`. Uma chave sem
valor padrão deve ser fornecida pelo cliente na criação. Uma coluna de chave não pode ser
`.private()` e não pode ser `timestamptz` ou `time`.

## Quando uma definição é recusada

Um schema que deixaria uma tabela desprotegida ou indisponível nunca chega ao
banco de dados. Ele é recusado em três momentos:

1. **No editor.** `rls` e `columns` são exigidos pelos tipos, e
   `rls: []` não é uma postura válida. Um campo `tenant` ou `softDelete`, ou uma
   coluna de índice escrita como uma chave simples que não aponte para nenhuma coluna, resulta em erro de tipo.
2. **Quando o módulo é carregado.** `defineTable` lança um erro para tabelas sem colunas,
   uma coluna que não seja um construtor `col.*`, uma relação que não seja o
   resultado de `rel.*`, uma relação com a mesma chave de uma coluna ou nenhum `rls` utilizável. Isso
   também detecta códigos JavaScript e casts que os tipos não conseguem verificar.
3. **Quando o schema é compilado.** `rebase db generate`, `rebase db push`,
   `rebase doctor` e a inicialização do servidor compilam todas as tabelas juntas e são interrompidos com
   um `SchemaDefinitionError` que lista cada problema, identificando a tabela, a
   coluna ou relação, e o que deve ser escrito no lugar:

```text
The schema cannot be used (2 problems):
  - posts: the table has no primary key. Mark a column `.primaryKey()` — e.g. `id: col.uuid().primaryKey().defaultRandom()`; several make a composite key in declaration order.
  - comments: `rls: "inherit"` takes the project's `defaultRls`, and none was given. Export `defaultRls` from backend/schema/index.ts (`"admin-only"` or a list of rules), or write this table's own `rls`.
```

A etapa de compilação verifica o que requer a análise de todas as tabelas simultaneamente:
alvos de relações e seus tipos de chave, tabelas de junção reivindicadas por duas relações ao mesmo
tempo, slugs e nomes SQL que colidem (incluindo nomes que colidem quando o Postgres os trunca para 63
bytes), regras que referenciam colunas inexistentes na tabela e `"inherit"`
sem um `defaultRls`. Uma tabela exportada de um arquivo ao lado de `index.ts`, mas não
do próprio `index.ts`, também é recusada: o arquivo index é a lista oficial de tabelas.

## Próximos passos

- [Columns](/docs/schema/columns/): todos os construtores e modificadores `col.*`
- [JSON documents](/docs/schema/json/): `jsonb` tipado e validado com `json.*`
- [Relations](/docs/collections/relations/): os cinco tipos de `rel.*`
- [Row-level security](/docs/collections/security-rules/): a postura de `rls` e suas regras
- [Table hooks](/docs/collections/callbacks/): hooks de ciclo de vida no servidor
- [Type inference](/docs/schema/types/): `InferRow`, `InferInsert` e `InferUpdate`
