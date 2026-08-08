---
title: Consultar Dados
sidebar_label: Consultar Dados
description: Operações CRUD, construtor de consultas fluente, operadores de filtro, paginação, ordenação e carregamento de relações com o SDK Cliente da Rebase.
---

## Acessar Coleções

Acesse qualquer coleção através de `client.data.<collectionName>` (camelCase, convertido automaticamente para snake_case) ou `client.data.collection<Record<string, unknown>>("slug")` (slug explícito):

```typescript
// Property-style access (camelCase → snake_case slug)
client.data.blogPosts       // → slug "blog_posts"
client.data.users           // → slug "users"

// Dynamic access by slug
client.data.collection<Record<string, unknown>>("blog_posts")
```

> **Modo estrito (SDK gerado):** Ao passar o `collectionsDictionary` gerado para `createRebaseClient`, o proxy de dados valida os acessos a propriedades no momento do acesso. Um erro de digitação como `client.data.prodcuts` lançará imediatamente um erro com uma mensagem útil e uma sugestão da correspondência mais próxima, em vez de produzir um confuso 404 mais tarde. Use `client.data.collection<Record<string, unknown>>("slug")` para ignorar a validação com slugs dinâmicos ou determinados em tempo de execução.

## Operações CRUD

### Find (Listar)

```typescript
// All products (default limit: 50)
const { data, meta } = await client.data.products.find();

// With pagination, filtering, and sorting
const { data, meta } = await client.data.products.find({
    where: { active: ["==", true], price: [">=", 100] },
    orderBy: ["created_at", "desc"],
    limit: 25,
    offset: 0
});

// data is Entity<M>[]  — each item has { id, values, path }
// meta has { total, limit, offset, hasMore }
```

### Buscar por ID

```typescript
const product = await client.data.products.findById(42);
// Returns Entity<M> | undefined
```

### Criar

```typescript
const newProduct = await client.data.products.create({
    name: "New Product",
    price: 29.99,
    active: true
});

// With a specific ID
const newProduct = await client.data.products.create(
    { name: "Custom ID Product" },
    "my-custom-id"
);
```

### Atualizar

```typescript
const updated = await client.data.products.update(42, {
    name: "Updated Name",
    price: 39.99
});
```

### Excluir

```typescript
await client.data.products.delete(42);
```

### Contar

```typescript
const total = await client.data.products.count();

// With filters
const activeCount = await client.data.products.count({
    where: { active: ["==", true] }
});
```

## Construtor de Consultas Fluente

Encadeie métodos para consultas mais expressivas:

```typescript
const { data } = await client.data.products
    .where("price", ">=", 100)
    .where("active", "==", true)
    .orderBy("created_at", "desc")
    .limit(10)
    .find();
```

### Métodos Disponíveis

| Método | Descrição | Exemplo |
|--------|-------------|---------|
| `.where(field, op, value)` | Adiciona uma condição de filtro | `.where("age", ">=", 18)` |
| `.orderBy(field, dir)` | Ordena os resultados | `.orderBy("name", "asc")` |
| `.limit(n)` | Limita o número de resultados | `.limit(25)` |
| `.offset(n)` | Ignora os primeiros N resultados | `.offset(50)` |
| `.search(text)` | Busca de texto completo | `.search("laptop")` |
| `.include(...relations)` | Inclui entidades relacionadas | `.include("author", "tags")` |
| `.find()` | Executa a consulta | Retorna `FindResponse<M>` |
| `.listen(onUpdate, onError?)` | Assina atualizações em tempo real | Retorna `unsubscribe()` |

### Operadores de Filtro

| Operador | Alias | Descrição |
|----------|-------|-------------|
| `"=="` | `"eq"` | Igual |
| `"!="` | `"neq"` | Diferente |
| `">"` | `"gt"` | Maior que |
| `">="` | `"gte"` | Maior ou igual a |
| `"<"` | `"lt"` | Menor que |
| `"<="` | `"lte"` | Menor ou igual a |
| `"in"` | | Valor em um array |
| `"not-in"` | `"nin"` | Valor fora de um array |
| `"array-contains"` | `"cs"` | O campo array contém o valor |
| `"array-contains-any"` | `"csa"` | O campo array contém algum dos valores |

### Sintaxes da Cláusula Where

O parâmetro `where` de `find()` suporta dois formatos:

```typescript no-verify
// 1. Tuple syntax — [operator, value] (recommended)
await client.data.products.find({
    where: {
        status: ["==", "active"],
        featured: ["==", true],
        price: [">=", 100],
        category: ["in", ["electronics", "gadgets"]],
        deleted_at: ["!=", null]
    }
});

// 2. Pre-serialized PostgREST string syntax (advanced)
await client.data.products.find({
    where: { status: "eq.published", price: "gte.100" }
});
```

> **Nota:** As strings PostgREST pré-serializadas (formato 2) são uma saída de emergência para passar valores de filtro que já estão no formato de transmissão. Prefira a sintaxe de tuplas pela segurança de tipos e legibilidade.

## Paginação

```typescript
// Offset-based pagination
const page1 = await client.data.products.find({ limit: 20, offset: 0 });
const page2 = await client.data.products.find({ limit: 20, offset: 20 });

// Check if more pages exist
if (page1.meta.hasMore) {
    // fetch next page
}

// Page-number pagination (1-indexed)
const page = await client.data.products.find({ page: 2, limit: 20 });
```

`limit` deve ser um número inteiro entre 1 e 1000. Um valor maior — ou um zero,
um negativo ou um fracionário — é recusado com um 400 `INVALID_LIMIT` em vez de
ser reduzido, porque uma página silenciosamente menor não se distingue da
última. Para ler além desse teto, percorra as páginas com `iterate()` ou
`findAll()`.

## Ordenação

```typescript
// Sort by field (format: ["field", "direction"])
const { data } = await client.data.products.find({
    orderBy: ["created_at", "desc"]
});

// Fluent style
const { data } = await client.data.products
    .orderBy("price", "asc")
    .find();
```

## Busca de Texto Completo

```typescript
// Via find params
const { data } = await client.data.products.find({
    searchString: "wireless headphones"
});

// Fluent style
const { data } = await client.data.products
    .search("wireless headphones")
    .limit(10)
    .find();
```

## Carregamento de Relações

As relações podem ser incluídas para que as entidades relacionadas sejam retornadas junto com os dados principais, em vez de apenas seus IDs de chave estrangeira.

### Uso de `include()` (Fluente)

```typescript
// Include specific relations
const { data } = await client.data.posts
    .include("author", "categories")
    .find();

// Include all defined relations
const { data } = await client.data.posts
    .include("*")
    .find();
```

### Uso de `find({ include })` (Parâmetros)

```typescript
const { data } = await client.data.posts.find({
    include: ["author", "categories"]
});
```

### Combinação com Filtros

```typescript
const { data } = await client.data.posts
    .where("status", "==", "published")
    .include("author")
    .orderBy("published_at", "desc")
    .limit(10)
    .find();
```

### Leitura dos Dados das Relações

Quando as relações são incluídas, a resposta contém **tanto** a chave estrangeira escalar quanto o objeto de relação hidratado:

```typescript
const { data } = await client.data
    .collection<{ author_id: string; author?: { name: string } }>("posts")
    .include("author")
    .find();

for (const post of data) {
    // Scalar foreign key — always present
    console.log(post.author_id);    // "uuid-1234"

    // Hydrated relation — present when included
    console.log(post.author?.name); // "Jane Doe"
}
```

> **Nota:** Sem `.include("author")`, apenas o campo escalar `author_id` é retornado. O objeto `author` hidratado será `undefined`.

### Nomes das Relações

Os nomes de relação que você passa para `include()` devem corresponder ao `relationName` definido no array `relations` da coleção:

```typescript
// Collection definition
relations: [
    { relationName: "author", target: () => usersCollection, ... },
    { relationName: "categories", target: () => categoriesCollection, ... }
]

// SDK usage — names must match
client.data.articles.include("author", "categories").find()
```

## Endpoints Personalizados

Chame endpoints personalizados do servidor registrados através do sistema de funções:

```typescript
// Using client.functions.invoke()
const result = await client.functions.invoke<{ summary: string }>(
    "generate-summary",
    { articleId: 42 }
);

// With options
const result = await client.functions.invoke<{ status: string }>(
    "process-order",
    { orderId: 123 },
    { method: "POST", path: "status/check" }
);

// Shorthand via client.call()
const result = await client.call<{ summary: string }>(
    "functions/generate-summary",
    { articleId: 42 }
);
```

## Próximos Passos

- **[Autenticação](/docs/sdk/authentication)** — Entrar, cadastrar-se, OAuth, sessões
- **[Assinaturas em Tempo Real](/docs/sdk/realtime)** — Dados ao vivo com WebSockets
- **[Armazenamento e Arquivos](/docs/sdk/storage)** — Enviar, baixar e gerenciar arquivos
- **[Relações](/docs/collections/relations)** — Definir relações entre coleções
