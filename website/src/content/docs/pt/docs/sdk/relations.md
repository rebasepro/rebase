---
sourceHash: c7ecc940df2e4680
title: Consultando relações
sidebar_label: Relações
description: "Inclua entidades relacionadas em uma consulta e leia uma coleção filha por meio de seu pai com os acessadores de relação do SDK."
---

## Carregando linhas relacionadas

As relações podem ser incluídas para que as entidades relacionadas sejam retornadas juntamente com os dados primários, em vez de apenas os IDs de suas chaves estrangeiras.

### Usando `include()` (Fluent)

```typescript
// Include specific relations
const { data } = await client.data.posts
    .include("author", "categories")
    .find();

// Include all defined relations, one hop deep
const { data } = await client.data.posts
    .include("*")
    .find();
```

Chamadas repetidas se **adicionam** umas às outras em vez de substituir, portanto `.include("author").include("categories")` solicita ambos.

### Usando `find({ include })` (Params)

```typescript
const { data } = await client.data.posts.find({
    include: ["author", "categories"]
});
```

### Aninhamento: relações de relações

Um caminho com pontos carrega uma relação de uma relação, em até **três saltos**:

```typescript
// Each post's comments, and each comment's author.
const { data } = await client.data
    .collection<{ id: string; comments?: { author?: { name: string } }[] }>("posts")
    .include("comments.author")
    .find();

console.log(data[0].comments?.[0].author?.name);
```

Nomear o salto intermediário é opcional — `comments.author` já implica `comments` — e enviar ambos resulta na mesma requisição duas vezes.

Cada salto é uma consulta em lote para a página inteira, não uma por linha: uma página de 50 posts com `comments.author` são três consultas, qualquer que seja o número de comentários. O limite de profundidade é o que impede uma relação auto-referencial de navegar indefinidamente; além dele, a requisição resulta em um erro 400 `INCLUDE_TOO_DEEP`.

### Limitando o que uma relação carrega

O formato de lista não tem onde colocar um `limit` por relação, portanto, uma relação que precisa de restrições aceita um objeto de opções:

```typescript
const { data } = await client.data.posts.include({
    comments: {
        limit: 5,
        where: { published: ["==", true] },
        orderBy: ["createdAt", "desc"],
        fields: ["id", "body"],
        include: { author: true }
    }
}).find();
```

| Opção | O que faz |
|--------|--------------|
| `limit` | Linhas **por pai**, não na página inteira — cinco comentários em cada post, não cinco no total. |
| `where` | O mesmo dialeto de filtro que o `where` de nível superior usa. Enviado para dentro da consulta, de modo que o `limit` se aplica às linhas correspondentes. |
| `logical` | Um grupo `or`/`and`/`not` sobre as linhas relacionadas. |
| `orderBy` | A mesma sintaxe de ordenação, incluindo o [posicionamento de NULL](/docs/sdk/querying#where-nulls-sort). |
| `fields` | Colunas da linha *relacionada*. Sua chave sempre é mantida, garantindo que a linha permaneça endereçável. |
| `include` | Relações da linha relacionada, por sua vez — é assim que a árvore se aninha. |

`true` é a forma abreviada para "carregar por completo": `{ author: true }` e `["author"]` são a mesma requisição.

### Nomes de relações desconhecidos são recusados

Um nome que não seja uma relação da coleção resulta em um erro **400 `UNKNOWN_RELATION`**, em todos os níveis da árvore — inclusive dentro de um `include` aninhado. Anteriormente isso era ignorado, retornando 200 com o campo simplesmente ausente, e um campo de relação ausente é indistinguível de uma linha que genuinamente não possui uma linha relacionada. Portanto, um erro de digitação parecia exatamente com dados vazios.

Com um tipo `Database` gerado, isso nem chega a acontecer: as chaves de `include` são verificadas recursivamente contra as relações reais da coleção em tempo de compilação. Consulte [Includes tipados](#typed-includes).

### Na rede

`include` é um parâmetro de consulta com duas sintaxes, diferenciadas por uma chave de abertura inicial:

```
GET /api/data/posts?include=author,comments.author
GET /api/data/posts?include={"comments":{"limit":5,"include":{"author":true}}}
```

O formato simples (flat) é o que um humano digita e o que a maioria das requisições precisa; o formato JSON existe porque o simples não pode transportar opções por relação, e inventar uma pontuação para elas (`comments(limit:5)`) seria uma terceira gramática para aprender além das duas que esta API já possui. Ambos são aceitos em todas as rotas de listagem e busca por ID (get-by-id), e o SDK escolhe o que for necessário para a consulta.

### Combinando com filtros

```typescript
const { data } = await client.data.posts
    .where("status", "==", "published")
    .include("author")
    .orderBy("publishedAt", "desc")
    .limit(10)
    .find();
```

### Lendo dados de relações

Quando relações são incluídas, a resposta contém **tanto** a chave estrangeira escalar quanto o objeto de relação hidratado:

```typescript
const { data } = await client.data
    .collection<{ authorId: string; author?: { name: string } }>("posts")
    .include("author")
    .find();

for (const post of data) {
    // Scalar foreign key — always present
    console.log(post.authorId);    // "uuid-1234"

    // Hydrated relation — present when included
    console.log(post.author?.name); // "Jane Doe"
}
```

> **Nota:** Sem o `.include("author")`, apenas o campo escalar `authorId` é retornado. O objeto `author` hidratado será `undefined`.

### Um `belongsTo` tem três formas

Uma relação, três lugares onde ela aparece — e a transmissão intencionalmente não é simétrica quanto a isso, então vale a pena conhecer as três:

| Onde | Formato | Por quê |
|-------|-------|-----|
| **Escrita** | `{ author: id }` **ou** `{ authorId: id }` | Ambos são aceitos. O transformador de escrita mapeia a propriedade de relação para a coluna de chave estrangeira, de modo que os dois resultam na mesma escrita. |
| **Leitura** | `authorId` | É uma coluna. Toda leitura a retorna. |
| **Leitura com `include`** | `author`, a própria linha de destino | Carregado apenas quando a consulta o especifica, portanto fica ausente de qualquer outra leitura. |

```typescript
type Post = { id: string; title: string; authorId: string; author?: { name: string } };
const posts = client.data.collection<Post>("posts");

// Write: either spelling.
await posts.create({ title: "Hello", author: authorId } as Partial<Post>);
await posts.create({ title: "Hello", authorId });

// Read: the key.
const post = await posts.get(id);
post.authorId;          // "uuid-1234"
post.author;            // undefined — nothing asked for it

// Read with include: the row.
const { data } = await posts.include("author").find();
data[0].authorId;       // "uuid-1234" — still there
data[0].author?.name;   // "Jane Doe"
```

Um `Database` gerado tipa os três com precisão: `Insert` e `Update` aceitam qualquer uma das sintaxes de escrita, `Row` possui `authorId` incondicionalmente, e `author` é opcional em `Row` e **obrigatório** na linha retornada por uma leitura com `include` — consulte [Includes tipados](#typed-includes).

O único caso em que os três se sobrepõem é uma relação nomeada de forma idêntica à sua própria chave estrangeira. Nesse caso, a linha incluída é servida *sobre* a coluna, e o tipo gerado reflete isso tipando essa chave como ambos.

### Includes tipados

O comando `rebase generate-sdk` grava o grafo de relações no seu tipo `Database`, juntamente com dois utilitários criados com base nele:

```typescript no-verify
import type { IncludeFor, RowWith } from "./database.types";

const ok: IncludeFor<"posts"> = { comments: { limit: 5, include: { author: true } } };

// @ts-expect-error — 'authr' is not a relation of 'comments'
const typo: IncludeFor<"posts"> = { comments: { include: { authr: true } } };
```

`IncludeFor<A>` restringe as chaves de um include às relações que existem, em todos os níveis. `RowWith<A, I>` é a linha retornada pela leitura, com todas as relações incluídas definidas como **obrigatórias** — portanto, após solicitar o autor, `row.author.name` não precisa de `?.`.

Sem um `Database` gerado, o `include` permanece como um simples `string[]` ou árvore: um tipo de linha escrito manualmente não possui relações definidas para verificação, e o erro 400 do servidor serve como a barreira de proteção.

### Nomes de relações

Os nomes de relação passados para `include()` devem corresponder ao `relationName` definido no array `relations` da coleção:

```typescript
// Collection definition
relations: [
    { relationName: "author", target: () => usersCollection, ... },
    { relationName: "categories", target: () => categoriesCollection, ... }
]

// SDK usage — names must match
client.data.articles.include("author", "categories").find()
```

## Consultando através de uma relação

`include()` busca linhas relacionadas *depois* que a página foi selecionada. Os dois recursos abaixo selecionam a página **junto com** elas: eles compilam para SQL, de modo que são executados antes de `limit` e `offset`, e não depois.

Isso é exatamente o que uma tela de fila precisa — *quem está esperando, os mais antigos primeiro* — onde ambas as partes da pergunta são respondidas por uma tabela relacionada, e não pela linha que está sendo listada.

### Filtrar por uma coluna da linha relacionada

Uma chave com pontos acessa, por meio de uma relação, uma das colunas de destino:

```typescript
// Candidates with at least one application still open.
const { data } = await client.data.talents.find({
    where: {
        "applications.status": ["in", ["applied", "reviewing", "interview"]]
    }
});
```

Isso compila para um `EXISTS` sobre a tabela relacionada, correlacionado à linha que está sendo listada — não um join, o que multiplicaria as linhas e silenciosamente quebraria o `limit`.

Todos os operadores funcionam, porque o elemento que está sendo comparado é uma coluna comum:

```typescript
where: {
    "applications.createdAt": ["<", "2026-01-01"],   // waiting since before…
    "agency.name": ["ilike", "%staffing%"]            // through a belongsTo
}
```

Os operadores negativos — `!=`, `not-in`, `not-like`, `not-ilike` — significam **"nenhuma linha relacionada corresponde"**, e não "alguma linha relacionada é diferente":

```typescript
// Candidates with no hired application.
where: { "applications.status": ["!=", "hired"] }
```

Essa é a interpretação esperada, e a única que faz com que `==` e `!=` particionem as linhas corretamente. A outra interpretação — "alguma candidatura não é 'hired'" — é verdadeira para quase todo candidato com mais de uma candidatura, e não responde ao que foi solicitado.

`is-null` e `is-not-null` propositalmente **não** são um par complementar aqui. Eles significam "possui uma linha relacionada cuja coluna não está preenchida" e "possui uma linha onde ela está preenchida" — ambos verdadeiros para um candidato com duas candidaturas, uma de cada tipo.

Um nome de relação que não existe, ou uma coluna que o destino não possui, resulta em um 400 listando as colunas reais do destino. Nunca é uma condição descartada: descartar uma chave de filtro *ampliaria* a leitura para todas as linhas.

### Ordenar por um agregado sobre uma relação

```typescript
// Candidates, whoever has been waiting longest first.
const { data } = await client.data.talents.find({
    where: { "applications.status": ["in", ["applied", "reviewing"]] },
    orderBy: [[{ relation: "applications", field: "createdAt", agg: "min" }, "asc"]]
});

// Clients, busiest first.
orderBy: [[{ relation: "orders", agg: "count" }, "desc"]]
```

O construtor fluente aceita a mesma chave:

```typescript
const { data } = await client.data.clients
    .orderBy({ relation: "orders", agg: "count" }, "desc")
    .find();
```

`min`, `max`, `count`, `sum` e `avg`. `field` é obrigatório para todos eles, exceto `count`, que conta as linhas relacionadas quando você o omite e conta as linhas com uma coluna não nula quando você o especifica.

Esta é a parte de uma fila que não pode ser contornada no cliente. Um filtro pode ser aproximado desnormalizando uma flag na linha; uma ordenação não pode ser aproximada de forma alguma assim que o conjunto de resultados é paginado, porque o cliente armazena apenas uma página por vez e a página foi selecionada pela ordem errada.

As linhas para as quais a relação não encontra correspondência ficam em uma extremidade definida — **por último na ordem ascendente, primeiro na descendente**, o posicionamento que o Postgres atribui a um `NULL`. Uma contagem (`count`) de nada resulta em `0` em vez de nulo, portanto, essas linhas são ordenadas como zero.

Via HTTP, a chave é uma única string, cabendo em `?orderBy=` sem alterações:

```bash
GET /api/data/talents?orderBy=min(applications.createdAt):asc
```

A paginação por cursor funciona sobre isso. Não há nenhum agregado armazenado na linha do cursor para comparar, portanto o driver recalcula o valor da linha do cursor em SQL a partir do id existente.

### Segurança em nível de linha

Ambos compilam para uma subconsulta que é executada como o leitor, portanto, uma linha relacionada que suas políticas ocultam não corresponde a um filtro e não contribui para um agregado.

Uma ressalva, apenas no sentido **negativo**: "nenhuma linha relacionada corresponde" e "nenhuma linha relacionada *que este leitor possa ver* corresponde" são a mesma sentença. Uma tabela de destino com segurança em nível de linha e sem política de `SELECT` para `rebase_user` é opaca, portanto todas as linhas parecem não corresponder e um filtro `!=` / `not-in` reporta em excesso. Nada vaza — as próprias políticas da tabela listada ainda decidem quais linhas existem, e o sentido positivo retorna corretamente nada. A correção é uma política de `SELECT` no destino. O Rebase deriva uma para relacionamentos muitos-para-muitos declarados; um esquema escrito manualmente precisa fornecê-la.

### Suporte do mecanismo

Apenas Postgres. Firestore e MongoDB declaram `filterableRelationKinds: []` e não oferecem nenhum dos recursos — um banco orientado a documentos se conecta por referência e não possui subconsultas para compilar essas instruções. Consulte [capacidades da fonte de dados](/docs/backend/multiple-sources).

### Por que não `additionalFields`?

`AdditionalFieldDelegate.value()` é assíncrono e recebe todo o contexto, portanto *pode* ler outra coleção — e mesmo assim não pode ajudar aqui. Ele é executado no navegador, uma vez por linha, **depois** que a página foi buscada e ordenada. Um valor computado ali pode ser exibido, mas nunca filtrado, ordenado ou paginado.

Se um valor derivado não for um agregado sobre uma relação, coloque-o no banco de dados — uma coluna gerada ou mantida por trigger — e ele se tornará uma propriedade comum.

## Próximos passos

- [Consultando dados](/docs/sdk/querying/) — o construtor de consultas retornado por estes acessadores
- [Relações](/docs/collections/relations/) — declarando as conexões que esta página lê
- [API REST](/docs/backend/api/) — o mesmo `include` via HTTP

---
