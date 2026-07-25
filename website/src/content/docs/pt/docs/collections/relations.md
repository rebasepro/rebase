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
const postsCollection: CollectionConfig = {
    slug: "posts",
    name: "Posts",
    table: "posts",
    properties: {
        title: { type: "string", name: "Title" },
        content: { type: "string", name: "Content", admin: { multiline: true } },
        author: { 
            type: "relation", 
            name: "Author", 
            target: () => usersCollection,
            cardinality: "one",
            direction: "owning",
            localKey: "author_id"
        }
    }
};
```

### 2. Array de Relações Explícitas

Para casos de uso avançados ou quando uma relação não mapeia diretamente para um campo de formulário, você pode defini-la no array `relations`:

```typescript
const postsCollection: CollectionConfig = {
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
            relationName: "author",
            target: () => usersCollection,
            cardinality: "one",
            localKey: "author_id"
        }
    ]
};
```

## Tipos de Relação

### Um-para-Um / Muitos-para-Um

Uma chave estrangeira nesta tabela aponta para a chave primária de outra tabela.

```typescript
relations: [
    {
        relationName: "author",
        target: () => usersCollection,
        cardinality: "one",          // This entity has ONE author
        direction: "owning",         // The FK is on THIS table
        localKey: "author_id"        // Column on the posts table
    }
]
```

Isso cria: `posts.author_id → users.id`

### Um-para-Muitos (Inverso)

A chave estrangeira está na tabela **de destino**, apontando de volta para esta entidade.

```typescript
// On the Users collection:
relations: [
    {
        relationName: "posts",
        target: () => postsCollection,
        cardinality: "many",          // This user has MANY posts
        direction: "inverse",         // The FK is on the TARGET table
        foreignKeyOnTarget: "author_id"  // Column on the posts table
    }
]
```

### Muitos-para-Muitos (Tabela de Junção)

Duas coleções conectadas através de uma tabela de junção intermediária.

```typescript
// On the Users collection:
relations: [
    {
        relationName: "roles",
        target: () => rolesCollection,
        cardinality: "many",
        direction: "owning",
        through: {
            table: "user_roles",         // Junction table name
            sourceColumn: "user_id",     // FK to this collection
            targetColumn: "role_id"      // FK to target collection
        }
    }
]
```

Isso cria:
```sql
CREATE TABLE user_roles (
    user_id INTEGER REFERENCES users(id),
    role_id INTEGER REFERENCES roles(id),
    PRIMARY KEY (user_id, role_id)
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
        relationName: "permissions",
        target: () => permissionsCollection,
        cardinality: "many",
        joinPath: [
            {
                table: "user_roles",
                on: { from: "id", to: "user_id" }
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
        relationName: "author",
        target: () => usersCollection,
        cardinality: "one",
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
    article.values.author_id;     // "uuid-1234"

    // Hydrated relation — only present when included
    article.values.author?.name;  // "Jane Doe"
}
```

> Os nomes das relações passados para `include()` devem corresponder ao `relationName` definido no array `relations` da coleção.

Para a referência completa do construtor de consultas (filtragem, classificação, paginação, tempo real), consulte a [documentação do Client SDK](/docs/sdk).

## Interface Completa de Relação

```typescript
interface Relation {
    relationName?: string;
    target: () => CollectionConfig;
    cardinality: "one" | "many";
    direction?: "owning" | "inverse";
    inverseRelationName?: string;
    localKey?: string;
    foreignKeyOnTarget?: string;
    through?: {
        table: string;
        sourceColumn: string;
        targetColumn: string;
    };
    joinPath?: JoinStep[];
    onUpdate?: "cascade" | "restrict" | "no action" | "set null" | "set default";
    onDelete?: "cascade" | "restrict" | "no action" | "set null" | "set default";
    overrides?: Partial<CollectionConfig>;
    validation?: { required?: boolean };
}
```

## Próximos Passos

- **[Regras de Segurança](/docs/collections/security-rules)** — Segurança em Nível de Linha
- **[Propriedades](/docs/collections/properties)** — Referência de tipos de propriedade
---
