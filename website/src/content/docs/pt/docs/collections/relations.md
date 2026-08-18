---
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

Você pode definir a relação diretamente na propriedade. O framework extrai automaticamente estas para o `relations[]` da coleção no momento da normalização, então você não precisa mais de uma entrada `relations[]` separada para as propriedades.

```typescript
import { defineCollection } from "@rebasepro/admin-types";
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
                target: () => usersCollection,
                localKey: "author_id"
            }
        }
    }
});
```

### 2. Array de Relações Explícitas

Para casos de uso avançados ou quando uma relação não mapeia diretamente para um campo de formulário, você pode defini-la no array `relations`:

```typescript
import { defineCollection } from "@rebasepro/admin-types";
const postsCollection = defineCollection({
    slug: "posts",
    name: "Posts",
    table: "posts",
    properties: {
        title: { type: "string", name: "Title" },
        content: { type: "string", name: "Content", admin: { multiline: true } },
        author: { type: "relation", name: "Author", relationName: "author" }
    },
    relations: [
        {
            kind: "belongsTo",
            relationName: "author",
            target: () => usersCollection,
            localKey: "author_id"
        }
    ]
});
```

## Tipos de Relação

### Um-para-Um / Muitos-para-Um

Uma chave estrangeira nesta tabela aponta para a chave primária de outra tabela.

```typescript
relations: [
    {
        kind: "belongsTo",           // The FK is on THIS table
        relationName: "author",
        target: () => usersCollection,
        localKey: "author_id"        // Column on the posts table
    }
]
```

Isso cria: `posts.authorId → users.id`

### Um-para-Muitos (Inverso)

A chave estrangeira está na tabela **de destino**, apontando de volta para esta entidade.

```typescript
// On the Users collection:
relations: [
    {
        kind: "hasMany",                 // The FK is on the TARGET table
        relationName: "posts",
        target: () => postsCollection,
        foreignKeyOnTarget: "authorId"  // Column on the posts table
    }
]
```

### Muitos-para-Muitos (Tabela de Junção)

Duas coleções conectadas através de uma tabela de junção intermediária.

```typescript
// On the Users collection:
relations: [
    {
        kind: "manyToMany",
        relationName: "roles",
        target: () => rolesCollection,
        through: {
            table: "user_roles",         // Junction table name
            sourceColumn: "userId",     // FK to this collection
            targetColumn: "role_id"      // FK to target collection
        }
    }
]
```

Isso cria:
```sql
CREATE TABLE user_roles (
    userId INTEGER REFERENCES users(id),
    role_id INTEGER REFERENCES roles(id),
    PRIMARY KEY (userId, role_id)
);
```

## Propriedades da Relação

Para renderizar um campo de relação em um formulário, adicione uma propriedade com `type: "relation"`:

```typescript
properties: {
    author: {
        type: "relation",
        name: "Author",
        target: () => usersCollection, // Target collection
        widget: "select"           // "select" (dropdown) or "dialog" (full picker)
    }
}
```

![Campo de relação no formulário](/img/features/relation-form-field.png)

Ao renderizar uma pré-visualização (como em uma célula de tabela ou um chip de referência), o Rebase lida com a hidratação automaticamente:

![Pré-visualização de relação na tabela](/img/features/relation-table-preview.png)

## Junções Multi-Salto

Para relacionamentos complexos que atravessam várias tabelas, use `joinPath`:

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
                on: { from: "id", to: "userId" }
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
const { data } = await client.data.articles
    .include("author")
    .find();

for (const article of data) {
    // Scalar FK — always present
    article.values.authorId;     // "uuid-1234"

    // Hydrated relation — only present when included
    article.values.author?.name;  // "Jane Doe"
}
```

> Os nomes das relações passados para `include()` devem corresponder ao `relationName` definido no array `relations` da coleção.

Para a referência completa do construtor de consultas (filtragem, classificação, paginação, tempo real), consulte a [documentação do Client SDK](/docs/sdk).

## Interface Completa de Relação

```typescript
type Relation =
    | BelongsToRelation
    | HasOneRelation
    | HasManyRelation
    | ManyToManyRelation
    | ViaRelation;

// Every kind carries these:
interface RelationBase {
    relationName?: string;
    target: () => CollectionConfig;
    inverseRelationName?: string;
    onUpdate?: "cascade" | "restrict" | "no action" | "set null" | "set default";
    onDelete?: "cascade" | "restrict" | "no action" | "set null" | "set default";
    overrides?: Partial<CollectionConfig>;
    validation?: { required?: boolean };
}

// ...and only the fields its own kind uses:
interface BelongsToRelation extends RelationBase {
    kind: "belongsTo";
    localKey?: string;              // column on THIS table
}

interface HasOneRelation extends RelationBase {
    kind: "hasOne";
    foreignKeyOnTarget?: string;    // column on the TARGET table
}

interface HasManyRelation extends RelationBase {
    kind: "hasMany";
    foreignKeyOnTarget?: string;    // column on the TARGET table
}

interface ManyToManyRelation extends RelationBase {
    kind: "manyToMany";
    through?: {
        table?: string;
        sourceColumn?: string;      // FK naming THIS collection
        targetColumn?: string;
    };
}

interface ViaRelation extends RelationBase {
    kind: "via";
    cardinality: "one" | "many";    // a join chain cannot imply it
    joinPath: JoinStep[];           // read-only
}
```

## Próximos Passos

- **[Regras de Segurança](/docs/collections/security-rules)** — Segurança em Nível de Linha
- **[Propriedades](/docs/collections/properties)** — Referência de tipos de propriedade
---
