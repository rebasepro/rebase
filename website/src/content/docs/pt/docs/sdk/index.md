---
title: SDK do Cliente
sidebar_label: SDK do Cliente
description: Use o SDK do Cliente Rebase para interagir com o seu backend a partir de qualquer aplicação JavaScript — operações de dados, autenticação, armazenamento e subscrições em tempo real.
---

## Visão Geral

O pacote `@rebasepro/client` oferece um SDK JavaScript com segurança de tipo para interagir com o seu backend Rebase. Ele lida com:

- **Operações de dados** — CRUD com filtragem, ordenação e paginação
- **Obtenção de relações** — Inclua entidades relacionadas com `.include()`
- **Subscrições em tempo real** — Atualizações em tempo real baseadas em WebSocket
- **Autenticação** — Gestão de tokens, login, registo
- **Armazenamento** — Carregamento e download de ficheiros

## Instalação

```bash
pnpm add @rebasepro/client
```

## Configuração

```typescript
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({
    baseUrl: "http://localhost:3001",
    websocketUrl: "ws://localhost:3001"
});
```

O cliente gere automaticamente os tokens de autenticação — uma vez que um utilizador inicia sessão, todos os pedidos subsequentes incluem o JWT.

## Operações de Dados

Aceda a qualquer coleção através de `client.data.<collectionName>` (camelCase) ou `client.data.collection<Record<string, unknown>>("slug")` (kebab-case):

```typescript
// Property-style access (auto-converts to kebab-case)
client.data.blogPosts    // → "blog-posts"
client.data.users        // → "users"

// Dynamic access by slug
client.data.collection("blog-posts")
```

### Encontrar (Listar)

```typescript
// All products (default limit: 20)
const { data, meta } = await client.data.products.find();

// With pagination, filtering, and sorting
const { data, meta } = await client.data.products.find({
    where: { active: ["==", true], price: [">=", 100] },
    orderBy: ["createdAt", "desc"],
    limit: 25,
    offset: 0
});

// data é Entity<M>[]  — cada item tem { id, values, path }
// meta tem { total, limit, offset, hasMore }
```

### Encontrar por ID

```typescript
const product = await client.data.products.findById(42);
// Entity<M> | undefined
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

### Apagar

```typescript
await client.data.products.delete(42);
```

## Construtor de Query Fluente

Encadeie métodos para queries mais expressivas:

```typescript
const { data } = await client.data.products
    .where("price", ">=", 100)
    .where("active", "==", true)
    .orderBy("createdAt", "desc")
    .limit(10)
    .find();
```

### Métodos Disponíveis

| Método | Descrição | Exemplo |
|--------|-------------|---------|
| `.where(field, op, value)` | Adiciona uma condição de filtro | `.where("age", ">=", 18)` |
| `.orderBy(field, dir)` | Ordena os resultados | `.orderBy("name", "asc")` |
| `.limit(n)` | Limita a contagem de resultados | `.limit(25)` |
| `.offset(n)` | Ignora os primeiros N resultados | `.offset(50)` |
| `.search(text)` | Pesquisa de texto completo | `.search("laptop")` |
| `.include(...relations)` | Inclui entidades relacionadas | `.include("author", "tags")` |
| `.find()` | Executa a query | Retorna `FindResponse<M>` |
| `.listen(onUpdate)` | Subscreve atualizações em tempo real | Retorna `unsubscribe()` |

### Operadores de Filtro

| Operador | Alias | Descrição |
|----------|-------|-------------|
| `"=="` | `"eq"` | Igual |
| `"!="` | `"neq"` | Não igual |
| `">"` | `"gt"` | Maior que |
| `">="` | `"gte"` | Maior ou igual a |
| `"<"` | `"lt"` | Menor que |
| `"<="` | `"lte"` | Menor ou igual a |
| `"in"` | | Valor no array |
| `"not-in"` | `"nin"` | Valor não no array |
| `"array-contains"` | `"cs"` | Campo do array contém valor |
| `"array-contains-any"` | `"csa"` | Campo do array contém qualquer dos valores |

## Obtenção de Relações

As relações podem ser incluídas nos resultados da query para que as entidades relacionadas sejam devolvidas juntamente com os dados primários, em vez de apenas os seus IDs de chave estrangeira.

### Usando `include()` (Fluente)

```typescript
// Incluir relações específicas
const { data } = await client.data.posts
    .include("author", "categories")
    .find();

// Incluir todas as relações definidas
const { data } = await client.data.posts
    .include("*")
    .find();
```

### Usando `find({ include })` (Parâmetros)

```typescript
const { data } = await client.data.posts.find({
    include: ["author", "categories"]
});
```

### Combinando com Filtros

```typescript
const { data } = await client.data.posts
    .where("status", "==", "published")
    .include("author")
    .orderBy("publishedAt", "desc")
    .limit(10)
    .find();
```

### Lendo Dados de Relação

Quando as relações são incluídas, a resposta contém **tanto** a chave estrangeira escalar como o objeto de relação hidratado:

```typescript
const { data } = await client.data.posts
    .include("author")
    .find();

for (const post of data) {
    // Chave estrangeira escalar — sempre presente
    console.log(post.values.authorId);    // "uuid-1234"

    // Relação hidratada — presente quando incluída
    console.log(post.values.author?.name); // "Jane Doe"
}
```

> **Nota:** Sem `.include("author")`, apenas o campo escalar `authorId` é retornado. O objeto `author` hidratado será `undefined`.

### Nomes de Relação

Os nomes das relações que passa para `include()` devem corresponder ao `relationName` definido no array `relations` da coleção. Por exemplo:

```typescript
// Collection definition
relations: [
    { relationName: "author", target: () => usersCollection, ... },
    { relationName: "categories", target: () => categoriesCollection, ... }
]

// SDK usage — names must match
client.data.articles.include("author", "categories").find()
```

## Subscrições em Tempo Real

Subscreva as alterações da coleção via WebSocket:

```typescript
// Subscrever todos os produtos ativos
const unsubscribe = client.data.products.listen(
    { where: { active: ["==", true] }, limit: 50 },
    (response) => {
        console.log("Products updated:", response.data);
    }
);

// Desinscrever quando terminar
unsubscribe();
```

Subscrever uma única entidade:

```typescript
const unsubscribe = client.data.products.listenById(
    42,
    (entity) => {
        console.log("Product changed:", entity);
    }
);
```

Também pode subscrever através do construtor de query fluente:

```typescript
const unsubscribe = client.data.products
    .where("active", "==", true)
    .orderBy("createdAt", "desc")
    .limit(20)
    .listen(
        (response) => console.log("Updated:", response.data),
        (error) => console.error("Error:", error)
    );
```

O cliente WebSocket lida com a reconexão automaticamente.

## Autenticação

```typescript
// Login
const session = await client.auth.signIn("user@example.com", "password");

// Registar
const session = await client.auth.signUp("user@example.com", "password");

// Google OAuth
const session = await client.auth.signInWithGoogle(googleIdToken);

// Atualizar token
await client.auth.refreshToken();

// Logout
await client.auth.signOut();

// Obter utilizador atual
const user = client.auth.getUser();
```

## Armazenamento

```typescript
// Carregar
const result = await client.storage.uploadFile(file, "products/image.jpg");

// Obter URL
const url = await client.storage.getDownloadURL("products/image.jpg");

// Apagar
await client.storage.deleteFile("products/image.jpg");
```

## Endpoints Personalizados

Chame endpoints de servidor personalizados (Cloud Functions, rotas personalizadas, etc.):

```typescript
const result = await client.call<{ summary: string }>("functions/generate-summary", {
    articleId: 42
});
```

## Usando com React

Num frontend Rebase, o cliente é tipicamente criado uma vez e partilhado via contexto:

```tsx
const client = createRebaseClient({ baseUrl: API_URL, websocketUrl: WS_URL });

// Passar para o provedor Rebase
<Rebase client={client} ...>
```

Aceda a partir de qualquer componente:

```tsx
import { useRebaseClient } from "@rebasepro/app";

function MyComponent() {
    const client = useRebaseClient();
    // Usar client.data, client.auth, client.storage
}
```

## Gerador de SDK

Gere um SDK de cliente totalmente tipado a partir das suas definições de coleção:

```bash
rebase generate-sdk
```

Isto cria tipos TypeScript para todas as suas entidades, para que obtenha autocompletar e verificação de tipo ao usar o cliente. Tanto as chaves estrangeiras escalares como os objetos de relação são incluídos nos tipos `Database` gerados.

## Próximos Passos

- **[Relações](/docs/collections/relations)** — Defina relações entre coleções
- **[Visão Geral do Frontend](/docs/frontend)** — Estrutura e componentes React
- **[Visão Geral do Backend](/docs/backend)** — Configuração do servidor

---
