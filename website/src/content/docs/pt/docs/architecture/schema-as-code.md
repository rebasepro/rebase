---
sourceHash: 0824e3198007abfc
title: Schema como Código
sidebar_label: Schema como Código
description: Como o Rebase usa coleções TypeScript como a única fonte de verdade para o seu schema de banco de dados, UI e API.
---

## A Ideia Central

No Rebase, suas **definições de coleção TypeScript são a única fonte de verdade**. A partir de um conjunto de objetos TypeScript, o Rebase gera:

- **Tabelas PostgreSQL** via geração de schema Drizzle ORM
- **UI CRUD** — formulários, tabelas, validação, tipos de campo
- **Endpoints da API REST** com filtragem, ordenação e paginação
- **SDK Cliente** — operações de dados com segurança de tipo
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

```
TypeScript Collections
        │
        ▼
  rebase schema generate
        │
        ▼
  Drizzle Schema (schema.generated.ts)
        │
        ▼
  rebase db generate
        │
        ▼
  SQL Migration Files
        │
        ▼
  rebase db migrate
        │
        ▼
  PostgreSQL Tables
```

### Exemplo

Dada esta coleção:

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

```typescript
// schema.generated.ts
import { pgTable, varchar, numeric, boolean, timestamp } from "drizzle-orm/pg-core";

export const products = pgTable("products", {
    id: serial("id").primaryKey(),
    name: varchar("name").notNull(),
    price: numeric("price"),
    active: boolean("active").default(true),
    created_at: timestamp("created_at").defaultNow()
});
```

O que produz este SQL:

```sql
CREATE TABLE products (
    id SERIAL PRIMARY KEY,
    name VARCHAR NOT NULL,
    price NUMERIC,
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW()
);
```

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
