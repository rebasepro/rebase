---
title: Schema como Código
sidebar_label: Schema como Código
slug: pt/docs/architecture/schema-as-code
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
const productsCollection: EntityCollection = {
    slug: "products",
    table: "products",
    properties: {
        name: { type: "string", name: "Name", validation: { required: true } },
        price: { type: "number", name: "Price", columnType: "numeric" },
        active: { type: "boolean", name: "Active", defaultValue: true },
        created_at: { type: "date", name: "Created", autoValue: "on_create" }
    }
};
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

## Próximos Passos

- **[Coleções](/docs/collections)** — Referência completa de configuração de coleção
- **[Propriedades](/docs/collections/properties)** — Mapeamentos detalhados de tipos de coluna
