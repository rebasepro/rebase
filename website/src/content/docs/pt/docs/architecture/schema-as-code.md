---
sourceHash: c6ba76446950def7
title: Schema como Código
sidebar_label: Schema como Código
description: Como o Rebase usa coleções TypeScript como a única fonte de verdade para o seu schema de banco de dados, UI e API.
---

## A Ideia Central

No Rebase, suas **definições de coleção TypeScript são a única fonte de verdade**. A partir de um conjunto de objetos TypeScript, o Rebase gera:

- **Tabelas PostgreSQL** via geração de schema Drizzle ORM
- **UI CRUD** — formulários, tabelas, validação, tipos de campo
- **Endpoints da API REST** com filtragem, ordenação e paginação
- **SDK tipado** — operações de dados com segurança de tipo
- **Políticas RLS** — Segurança em Nível de Linha no Postgres

Isso significa que seu schema é:
- **Controlado por versão** — cada alteração é um commit git
- **Com segurança de tipo** — TypeScript detecta erros em tempo de compilação
- **Revisável** — as alterações de schema passam por pull requests
- **Portátil** — a mesma definição funciona no frontend, backend e CLI

## Edição Visual com Manipulação de AST

O Rebase também oferece um **editor visual de coleções** no modo Studio. Quando um não-desenvolvedor usa o editor visual para adicionar um campo:

1. O Studio **não** modifica diretamente o banco de dados
2. Em vez disso, ele usa [ts-morph](https://ts-morph.com/) para analisar seu arquivo fonte TypeScript como uma AST
3. Ele insere a nova definição de propriedade precisamente no bloco `properties`
4. **Todo o código existente, callbacks e lógica personalizada são preservados intocados**
5. O arquivo é salvo, acionando o hot reload

Essa abordagem de "UI como Gerador de Código" significa que as edições visuais produzem o mesmo TypeScript limpo que um desenvolvedor escreveria manualmente.

## Pipeline de Geração de Schema

Your collections are read once and emitted twice — as a Drizzle schema the
running server queries through, and as SQL that describes the database you meant
to have. It is the SQL that the database is brought into line with, by
[Atlas](https://atlasgo.io), which diffs your desired schema against the live one
and plans the change:

```
                        Collections (TypeScript)
                                  │
            ┌─────────────────────┴─────────────────────┐
            ▼                                           ▼
   rebase schema generate                   (db push and db generate write
            │                               the SQL below on every run, into
            ▼                               .rebase/sql/, which is not committed)
  backend/src/schema.generated.ts                       │
  the Drizzle schema the runtime                        ▼
  reads and writes rows through             schema.sql              ← Atlas's desired state
                                            policies.sql            ← RLS, applied separately
                                            search.sql, vector.sql, ← Atlas cannot manage these
                                            triggers.sql
                                                        │
                                          ┌─────────────┴─────────────┐
                                          ▼                           ▼
                                   rebase db push              rebase db generate
                                   Atlas plans the diff        Atlas writes the diff
                                   and applies it now          to drizzle/migrations/
                                          │                           │
                                          │                           ▼
                                          │                    rebase db migrate
                                          │                    applies them in order
                                          └─────────────┬─────────────┘
                                                        ▼
                                                  PostgreSQL
```

`db push` is the development loop; `db generate` + `db migrate` is the
reviewable one, and the one to use in production. Both go through the same
generated SQL, so they cannot disagree about what your collections mean, and
both write it afresh from the collections before reading it, so there is no copy
in your repository to fall behind. The migrations are what you commit. See
[Schema Generation](/docs/cli/schema) for every flag.

### Exemplo

Dada esta coleção:

<!-- schema-sample: collection -->
```typescript
import { defineCollection } from "@rebasepro/cms-types";
const productsCollection = defineCollection({
    slug: "products",
    name: "Products",
    table: "products",
    properties: {
        name: { type: "string", name: "Name", validation: { required: true } },
        price: { type: "number", name: "Price", columnType: "numeric" },
        active: { type: "boolean", name: "Active", defaultValue: true },
        createdAt: { type: "date", name: "Created", autoValue: "on_create" }
    }
});
```

O Rebase gera este schema Drizzle:

<!-- schema-sample: drizzle -->
```typescript
// schema.generated.ts
// This file is auto-generated by the Rebase Drizzle generator. Do not edit manually.

import { boolean, numeric, pgPolicy, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { relations as drizzleRelations, sql } from 'drizzle-orm';


export const products = pgTable("products", {
    name: text("name").notNull(),
    price: numeric("price"),
    active: boolean("active").default(sql`TRUE`),
    createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).default(sql`now()`),
    id: text("id").primaryKey().default(sql`gen_random_uuid()::text`)
}, (table) => ([
    pgPolicy("products_default_admin_read", { as: "permissive", for: "select", to: ["public"], using: sql`(rebase.uid() IS NULL) OR (string_to_array(rebase.roles(), ',') && ARRAY['admin'])` }),
    pgPolicy("products_default_admin_write_insert", { as: "permissive", for: "insert", to: ["public"], withCheck: sql`(rebase.uid() IS NULL) OR (string_to_array(rebase.roles(), ',') && ARRAY['admin'])` }),
    pgPolicy("products_default_admin_write_update", { as: "permissive", for: "update", to: ["public"], using: sql`(rebase.uid() IS NULL) OR (string_to_array(rebase.roles(), ',') && ARRAY['admin'])`, withCheck: sql`(rebase.uid() IS NULL) OR (string_to_array(rebase.roles(), ',') && ARRAY['admin'])` }),
    pgPolicy("products_default_admin_write_delete", { as: "permissive", for: "delete", to: ["public"], using: sql`(rebase.uid() IS NULL) OR (string_to_array(rebase.roles(), ',') && ARRAY['admin'])` }),
])).enableRLS();

export const tables = { products };
export const enums = {  };
export const relations = {  };
```

Três coisas ali merecem uma segunda leitura. A coluna `id` que você não
declarou: toda coleção recebe uma chave primária `text`, a menos que uma
propriedade reivindique `isId`, e <span class="since-badge" data-since="0.24">Since 0.24</span> o banco de dados a preenche com um uuid
(`gen_random_uuid()::text`), de modo que uma linha criada pelo painel admin,
pela API REST ou pelo SDK não precisa de chave própria. Uma chave que você
envia é usada como está. Na 0.23 a coluna não tem default, e uma criação que
não envia chave falha. O bloco `pgPolicy`: row level security está habilitado
em todas as tabelas, e essas políticas de base são o que mantém o contexto
confiável do servidor e a role `admin` capazes de lê-la — veja
[Regras de Segurança](/docs/collections/security-rules). E `active`, que carrega
o `defaultValue` que você escreveu como um default de **coluna**: um
`defaultValue` literal se transforma em um `DEFAULT` real, então uma linha
inserida pela API REST, um script de seed ou o `psql` também o recebe, não só
uma digitada no painel admin. Um default de `reference` ou `vector` não é um
literal de coluna e permanece um valor da camada de aplicação.

O que produz este SQL:

<!-- schema-sample: sql -->
```sql
-- This file is auto-generated by the Rebase DDL generator. Do not edit manually.

CREATE SCHEMA IF NOT EXISTS "rebase";

CREATE TABLE "public"."products" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "name" TEXT NOT NULL,
  "price" NUMERIC,
  "active" BOOLEAN DEFAULT TRUE,
  "created_at" TIMESTAMP WITH TIME ZONE DEFAULT now()
);
```

Policies, search columns, vector indexes and `updated_at` triggers are written to
files of their own and applied by the CLI in their own right — Atlas manages
none of the four.

## Segurança e Objetos de Banco de Dados Não Mapeados

Quando o Rebase atualiza o schema do banco de dados, ele mapeia as definições de coleção TypeScript para as tabelas do banco de dados. Para garantir que **os objetos do banco de dados não mapeados (por exemplo, tabelas, views, enums) nunca sejam descartados ou modificados**, o Rebase implementa várias camadas de segurança:

1. **Filtragem Estrita de Tabelas (`tablesFilter`)**: A configuração Drizzle gerada restringe dinamicamente a sincronização apenas às tabelas exportadas no schema gerado. Quaisquer tabelas não reconhecidas ou tabelas de sistemas legados existentes no banco de dados são ignoradas pelo mecanismo de sincronização.
2. **Restrições de Schema (`schemaFilter`)**: A sincronização do banco de dados é restrita exclusivamente ao schema `public`. Tabelas de banco de dados internas, schemas personalizados e tabelas específicas de extensões não são tocadas.
3. **Proteção de Funções e Extensões**: O Drizzle é configurado para não gerenciar funções de banco de dados (`entities.roles: false`) ou tabelas auxiliares de extensões como PostGIS.
4. **Confirmação Interativa no Modo de Desenvolvimento**: Ao executar `rebase db push` em desenvolvimento, a CLI é executada com as flags `--strict` e `--verbose`, o que garante que os desenvolvedores devem revisar e aprovar explicitamente quaisquer ações SQL destrutivas antes de serem executadas.
5. **Propriedade dos Índices pelo Nome**: Índices são o único objeto que vive *sobre* uma tabela mapeada, portanto a filtragem de tabelas não consegue protegê-los — e um push planejava `DROP INDEX` para qualquer índice ausente do estado desejado, ou seja, para todos os escritos à mão. O Rebase agora nomeia os índices que gera como `<table>_<columns>_ix_<7 hex>` (`_ux_` quando únicos), uma forma que nenhum outro nomeador aqui produz, e exclui todo o resto do diff pelo nome. Um índice que você escreveu à mão, ou que veio por introspecção, nunca é tocado; uma declaração que você apaga continua removendo seu índice, que é a intenção. Veja **[Índices](/docs/backend/indexes)**.

## Próximos Passos

- **[Coleções](/docs/collections)** — Referência completa de configuração de coleção
- **[Propriedades](/docs/collections/properties)** — Mapeamentos detalhados de tipos de coluna
- **[Índices](/docs/backend/indexes)** — Declarar os índices de que suas consultas precisam
