---
sourceHash: 1c4ef039b2fe0f8a
title: Schema as Code
sidebar_label: Schema as Code
description: Como o Rebase usa as tabelas TypeScript em backend/schema como a única fonte da verdade para o esquema do seu banco de dados, API, SDK e painel administrativo.
---

## A Ideia Central

No Rebase, as **tabelas que você declara com `defineTable` em `backend/schema/` são a única fonte da verdade**. A partir delas, o Rebase gera:

- **Tabelas PostgreSQL** via geração de esquema do Drizzle ORM
- **Políticas RLS** — Row Level Security no Postgres, a partir do `rls` obrigatório de cada tabela
- **Endpoints de API REST** com filtragem, ordenação e paginação, além de realtime e MCP
- **SDK Tipado** — operações de dados com segurança de tipos (type-safe)
- **Os padrões do painel administrativo** — formulários, listas, validação e tipos de campo, renderizados a partir dos descritores de tabela que o backend disponibiliza em `GET /api/schema/tables`; o que o painel exibe além disso fica em `frontend/src/cms/`

Isso significa que seu esquema é:
- **Controlado por versão** — cada alteração é um commit no git
- **Type-safe** — o TypeScript detecta erros em tempo de compilação
- **Revisável** — alterações no esquema passam por pull requests
- **Portátil** — a mesma definição é lida pelo backend, pela CLI, pelo gerador de SDK e, na forma de tipos, pelo frontend

## Edição Visual com Manipulação de AST

O Rebase também fornece um **editor visual de esquemas** no Studio. Quando alguém o utiliza para adicionar uma coluna:

1. O Studio **não** modifica diretamente o banco de dados
2. Em vez disso, ele envia a edição como um `TablePatch`, e o servidor usa o [ts-morph](https://ts-morph.com/) para analisar o arquivo da tabela em `backend/schema/` como uma AST
3. Ele insere o novo construtor `col.*` precisamente dentro do bloco `columns`
4. **Todo o código existente, hooks e lógica customizada são preservados intocados**; uma edição que interferiria em código que não deve ser reescrito é recusada
5. O arquivo é salvo, disparando o hot reload

A *aparência* de uma tabela no painel não faz parte disso: rótulos, ícones e visualizações
são salvos como preferências do painel ou escritos em `frontend/src/cms/`. Veja
[Edição de esquema ao vivo](/docs/backend/live-schema-editing/) para entender as edições e
o que o editor recusa.

Essa abordagem de "UI como Gerador de Código" significa que as edições visuais produzem o mesmo TypeScript limpo que um desenvolvedor escreveria manualmente.

## Pipeline de Geração de Esquema

As tabelas são lidas uma vez e emitidas em dois formatos: um schema Drizzle para o
servidor e SQL que descreve o banco de dados desejado. O Ptah Compat planeja alterações
a partir desse SQL. `db push` o compara com o banco ativo, enquanto `db generate` o
compara com o histórico de migrations:

```
                      Tables (backend/schema)
                                  │
            ┌─────────────────────┴─────────────────────┐
            ▼                                           ▼
   rebase schema generate                   (db push and db generate write
            │                               the SQL below on every run, into
            ▼                               .rebase/sql/, which is not committed)
  backend/src/schema.generated.ts                       │
  the Drizzle schema the runtime                        ▼
  reads and writes rows through             schema.sql              ← full desired state
                                            ptah-managed.json       ← owned objects
                                            policies.sql, search.sql,
                                            vector.sql, triggers.sql,
                                            views.sql               ← boot and recovery
                                                        │
                                          ┌─────────────┴─────────────┐
                                          ▼                           ▼
                                   rebase db push              rebase db generate
                                   Ptah plans the diff         Ptah writes the diff
                                   and applies it now          to drizzle/migrations/
                                          │                           │
                                          │                           ▼
                                          │                    rebase db migrate
                                          │                    applies them in order
                                          └─────────────┬─────────────┘
                                                        ▼
                                                  PostgreSQL
```

O `db push` é o ciclo de desenvolvimento; `db generate` + `db migrate` é o ciclo
revisável, e o que deve ser usado em produção. Ambos passam pelo mesmo
SQL gerado, portanto não podem discordar sobre o que suas tabelas significam, e
ambos o reescrevem do zero a partir das tabelas antes da leitura, não havendo cópia
em seu repositório que possa ficar desatualizada. As migrações são o que você comita. Veja
[Geração de Esquema](/docs/cli/schema) para todas as opções de flags.

### Exemplo

Dada esta tabela:

<!-- schema-sample: table -->
```ts
import { defineTable, col, sql } from "@rebasepro/server/schema";

export const products = defineTable("products", {
    columns: {
        id: col.text().primaryKey().default(sql`gen_random_uuid()::text`),
        name: col.text().notNull(),
        price: col.numeric(),
        active: col.boolean().default(true),
        createdAt: col.timestamp({ withTimezone: true }).onCreateNow()
    },
    rls: "admin-only"
});
```

O Rebase gera este esquema Drizzle — o arquivo completo, com políticas padrão e
tudo mais:

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
    pgPolicy("products_default_admin_read", { as: "permissive", for: "select", to: ["rebase_admin"], using: sql`(SELECT (rebase.uid() IS NULL) OR (string_to_array(rebase.roles(), ',') && ARRAY['admin']))` }),
    pgPolicy("products_default_admin_write_insert", { as: "permissive", for: "insert", to: ["rebase_admin"], withCheck: sql`(SELECT (rebase.uid() IS NULL) OR (string_to_array(rebase.roles(), ',') && ARRAY['admin']))` }),
    pgPolicy("products_default_admin_write_update", { as: "permissive", for: "update", to: ["rebase_admin"], using: sql`(SELECT (rebase.uid() IS NULL) OR (string_to_array(rebase.roles(), ',') && ARRAY['admin']))`, withCheck: sql`(SELECT (rebase.uid() IS NULL) OR (string_to_array(rebase.roles(), ',') && ARRAY['admin']))` }),
    pgPolicy("products_default_admin_write_delete", { as: "permissive", for: "delete", to: ["rebase_admin"], using: sql`(SELECT (rebase.uid() IS NULL) OR (string_to_array(rebase.roles(), ',') && ARRAY['admin']))` }),
])).enableRLS();

export const tables = { products };
export const enums = {  };
export const relations = {  };
```

Três coisas aí merecem uma segunda leitura. A coluna `id`: o banco de dados
a preenche com um uuid (`gen_random_uuid()::text`), de modo que um registro criado a partir do
painel administrativo, da API REST ou do SDK não precisa de uma chave própria, e qualquer chave que você
enviar será usada como fornecida. O bloco `pgPolicy`: `rls: "admin-only"` ativa a segurança
em nível de linha (row level security) e gera apenas as políticas de base, que mantêm o contexto confiável
do servidor e a role `admin` capazes de fazer a leitura — e mais ninguém; veja
[Segurança em nível de linha](/docs/collections/security-rules). E `active`, que
carrega o `.default(true)` definido por você como um valor padrão de **coluna**: um padrão
literal compila para um `DEFAULT` real, de modo que uma linha inserida pela API REST, por um script de seed
ou pelo `psql` também o recebe, não apenas as inseridas pelo painel administrativo.

Um trecho do SQL que o Ptah recebe como estado desejado:

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

O arquivo completo do estado desejado também contém políticas, funções, índices de busca
e vetoriais, triggers `updated_at` e views declarados. Os arquivos SQL separados
permanecem para inicialização e recuperação. `db push` e `db generate` planejam esses
objetos juntos.

## Segurança e Objetos de Banco de Dados Não Mapeados

O Rebase limita o plano do Ptah aos objetos declarados. Seus nomes ficam em
`drizzle/ptah-managed.json`, inclusive após a remoção de uma declaração. Por isso,
remover uma declaração pode produzir um `DROP`. Tabelas, views, funções e extensões
externas ficam fora do plano.

O provisionamento de autenticação e as revisões de migrations são excluídos. As funções
auxiliares que o Rebase declara no schema `rebase` são incluídas. Nas tabelas
selecionadas, a CLI também protege por nome políticas, triggers, índices e restrições
CHECK e EXCLUDE personalizados. Ela lê o banco e o histórico de migrations para
identificá-los. Se uma leitura necessária falhar, o planejamento é interrompido.

Antes de aplicar uma alteração, `db push` mostra o plano e verifica instruções
destrutivas, incluindo `DROP EXTENSION`. Use `--dry-run` para inspecionar o plano sem
aplicá-lo. Veja [Índices](/docs/backend/indexes) para saber como o Rebase distingue
índices declarados dos personalizados.

## Próximos Passos

- **[Tabelas](/docs/schema/)** — Todas as opções do `defineTable`
- **[Colunas](/docs/schema/columns/)** — Mapeamentos detalhados de tipos de coluna
- **[Índices](/docs/backend/indexes)** — Como declarar os índices de que suas consultas precisam
