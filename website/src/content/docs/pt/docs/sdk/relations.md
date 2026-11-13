---
sourceHash: 3db2d10879df1c44
title: Consultando relações
sidebar_label: Relações
description: "Inclua entidades relacionadas em uma consulta e leia uma tabela filha por meio de seu pai com os acessadores de relação do SDK."
---

## Carregando linhas relacionadas

As relações podem ser incluídas para que as entidades relacionadas sejam retornadas junto aos dados primários, em vez de apenas seus IDs de chave estrangeira.

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

Chamadas repetidas **acrescentam** entre si em vez de substituir, portanto
`.include("author").include("categories")` solicita ambos.

### Usando `find({ include })` (Params)

```typescript
const { data } = await client.data.posts.find({
    include: ["author", "categories"]
});
```

### Aninhamento: relações de relações

Um caminho com pontos carrega uma relação de uma relação, até **três saltos**:

```typescript
// Each post's comments, and each comment's author.
const { data } = await client.data
    .table<{ id: string; comments?: { author?: { name: string } }[] }>("posts")
    .include("comments.author")
    .find();

console.log(data[0].comments?.[0].author?.name);
```

Nomear o salto intermediário é opcional — `comments.author` já implica
`comments` — e enviar ambos resulta na mesma requisição feita duas vezes.

Cada salto é uma consulta em lote para a página inteira, e não uma por linha: uma página de 50
posts com `comments.author` são três consultas, independentemente do número de comentários.
O limite de profundidade é o que impede uma relação auto-referenciada de navegar indefinidamente;
além dele, a requisição retorna um 400 `INCLUDE_TOO_DEEP`.

### Restringindo o que uma relação carrega

A forma de lista não tem onde colocar um `limit` por relação, portanto uma relação que
precisa ser restringida recebe um objeto de opções:

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
| `limit` | Linhas **por pai**, não na página inteira — cinco comentários em cada post, não cinco no total. Aplicado pela consulta, portanto as linhas além dele nunca são lidas do banco de dados. |
| `where` | O mesmo dialeto de filtro usado pelo `where` de nível superior. Enviado para a consulta, de modo que o `limit` se aplica às linhas correspondentes. |
| `logical` | Um grupo `or`/`and`/`not` sobre as linhas relacionadas. |
| `orderBy` | A mesma sintaxe de ordenação, incluindo a [ordenação de NULLs](/docs/sdk/querying#where-nulls-sort). Empates e um `limit` sem `orderBy` seguem a chave da linha relacionada, em ordem ascendente. |
| `fields` | Colunas da linha *relacionada*. Sua chave sempre permanece, garantindo que a linha continue endereçável. |
| `include` | Relações da linha relacionada, por sua vez — é assim que a árvore se aninha. |
| `count` | Também retorna quantas linhas relacionadas existem no total, por pai, sob o `_count` da linha. Veja [Contando o que um limit deixa de fora](#contando-o-que-um-limit-deixa-de-fora). |

`true` é o atalho para "carregar por completo": `{ author: true }` e
`["author"]` são a mesma requisição.

### Contando o que um limit deixa de fora

Um `limit` restringe
o que é enviado, e `count: true` informa quanto foi deixado de fora. É disto que uma lista
precisa para exibir quatro tags e um "+33":

```typescript
const { data } = await client.data.posts.include({
    tags: { limit: 4, count: true }
}).find();

// data[0] → { id: 1, title: "…", tags: [ …4 rows ], _count: { tags: 37 } }
```

- `_count` é um objeto por linha, indexado pelo nome da relação. Contar duas relações
  adiciona duas chaves.
- O total é contado na mesma instrução SQL que lê as linhas. Ele cobre
  as mesmas linhas que uma leitura sem o `limit` retornaria: o `where` do include,
  soft delete e row-level security são todos aplicados. Solicitá-lo não adiciona nenhuma consulta.
- Sem um `limit`, o total é o número de linhas retornadas.
- `count` funciona apenas em relações to-many. Em uma relação to-one, ele retorna um
  400 `INVALID_INCLUDE`. O mesmo ocorre em uma tabela que tenha uma coluna chamada
  `_count`, pois o total a sobrescreveria.
- Uma relação que o chamador não tem permissão para ler (acesso a campos) é deixada de fora de `_count`,
  da mesma forma que suas linhas são.

### Nomes de relação desconhecidos são recusados

Um nome que não seja uma relação da tabela resulta em um **400
`UNKNOWN_RELATION`**, em todos os níveis da árvore — inclusive dentro de um
`include` aninhado. Anteriormente isso era ignorado, respondendo 200 com o campo simplesmente
ausente, e um campo de relação ausente é indistinguível de uma linha que
genuinamente não possui nenhuma linha relacionada. Um erro de digitação, portanto, parecia exatamente como dados vazios.

Com um tipo `Database` gerado, isso nem chega a acontecer: as chaves de `include` são
verificadas contra as relações reais da tabela em tempo de compilação, recursivamente.
Veja [Includes tipados](#includes-tipados).

### Na rede

`include` é um parâmetro de consulta com duas formas de escrita, diferenciadas por uma
chave na abertura:

```
GET /api/data/posts?include=author,comments.author
GET /api/data/posts?include={"comments":{"limit":5,"include":{"author":true}}}
```

A forma simples é o que um ser humano digita e o que a maioria das requisições necessita; o formato JSON
existe porque a forma simples não pode conter opções por relação, e inventar uma
pontuação para elas (`comments(limit:5)`) seria uma terceira gramática para aprender
além das duas que esta API já possui. Ambas são aceitas em todas as rotas de listagem e
busca por ID, e o SDK escolhe a que a consulta necessitar.

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

Quando as relações são incluídas, a resposta contém **tanto** a chave estrangeira escalar quanto o objeto de relação hidratado:

```typescript
const { data } = await client.data
    .table<{ authorId: string; author?: { name: string } }>("posts")
    .include("author")
    .find();

for (const post of data) {
    // Scalar foreign key — always present
    console.log(post.authorId);    // "uuid-1234"

    // Hydrated relation — present when included
    console.log(post.author?.name); // "Jane Doe"
}
```

> **Nota:** Sem `.include("author")`, apenas o campo escalar `authorId` é retornado. O objeto `author` hidratado será `undefined`.

### Um `belongsTo` tem três formas

Uma relação, três lugares onde ela aparece — e a rede deliberadamente não
é simétrica quanto a isso, então vale a pena conhecer todas as três:

| Onde | Formato | Por quê |
|-------|-------|-----|
| **Escrita** | `{ author: id }` **ou** `{ authorId: id }` | Ambos são aceitos. O transformador de escrita mapeia a propriedade de relação para a coluna de chave estrangeira, de modo que os dois resultam na mesma escrita. Um objeto (`{ author: { id } }`) resulta em um 400 que nomeia a relação: envie a chave. |
| **Leitura** | `authorId` | É uma coluna. Toda leitura a retorna. |
| **Leitura com `include`** | `author`, a própria linha do destino | Carregada somente quando a consulta a especifica, portanto fica ausente em qualquer outra leitura. |

```typescript
type Post = { id: string; title: string; authorId: string; author?: { name: string } };
const posts = client.data.table<Post>("posts");

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

Um `Database` gerado tipa os três com precisão: `Insert` e `Update` aceitam
qualquer uma das formas de escrita, `Row` possui `authorId` incondicionalmente, e `author` é
opcional em `Row` — `RowWith<"posts", ["author"]>` é a linha com ele
**obrigatório**, para uma leitura que o solicitou. Veja [Includes tipados](#includes-tipados).

O único caso em que os três coincidem é uma relação nomeada de forma idêntica à sua própria
chave estrangeira. Nesse caso, a linha incluída é servida *sobre* a coluna, e o
tipo gerado expressa isso tipando essa chave como ambos.

### Includes tipados

O comando `rebase generate-sdk` escreve o grafo de relações no seu tipo `Database`, juntamente com
dois utilitários construídos sobre ele:

```typescript no-verify
import type { IncludeFor, RowWith } from "./database.types";

const ok: IncludeFor<"posts"> = { comments: { limit: 5, include: { author: true } } };

// @ts-expect-error — 'authr' is not a relation of 'comments'
const typo: IncludeFor<"posts"> = { comments: { include: { authr: true } } };
```

`IncludeFor<A>` restringe as chaves de um include a relações que existem, em todos os
níveis — e um cliente tipado valida o `include` da mesma maneira, em `find({ include })`
e em `.include(...)`, de modo que `posts.include("authr")` é um erro de compilação em vez
de um 400 `UNKNOWN_RELATION`. As linhas retornadas por uma leitura ainda tipam cada relação
como opcional; `RowWith<A, I>` é essa linha com cada relação incluída tornada
**obrigatória**, para tipar o que você lê — assim, após solicitar o autor,
um `RowWith<"posts", ["author"]>` não precisa de `?.` em `row.author.name`.

Sem um `Database` gerado, o `include` permanece como um simples `string[]` ou árvore: um
tipo de linha escrito manualmente não possui relações para serem validadas, e o 400
do servidor atua como salvaguarda.

### Nomes de Relação

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Os nomes que você passa para `include()` são as chaves de `relations` da tabela:

```ts
// backend/schema/articles.ts
import { defineTable, col, rel } from "@rebasepro/server/schema";
import { users } from "./users";
import { categories } from "./categories";

export const articles = defineTable("articles", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        title: col.text().notNull()
    },
    relations: {
        author: rel.belongsTo(() => users),
        categories: rel.manyToMany(() => categories)
    },
    rls: "admin-only"
});
```

```typescript
// SDK usage — names must match
client.data.articles.include("author", "categories").find()
```

## Consultando através de uma relação

`include()` busca linhas relacionadas *depois* que a página foi selecionada. Os dois
recursos abaixo selecionam a página **junto com** elas: eles compilam para SQL, portanto rodam
antes de `limit` e `offset`, e não depois.

Isto é o que uma tela de fila necessita — *quem está esperando, quem está há mais tempo primeiro* — onde
ambas as metades da questão são respondidas por uma tabela relacionada, em vez da linha
que está sendo listada.

### Filtrar por uma coluna da linha relacionada

Uma chave com pontos alcança, através de uma relação, uma das colunas do destino:

```typescript
// Candidates with at least one application still open.
const { data } = await client.data.talents.find({
    where: {
        "applications.status": ["in", ["applied", "reviewing", "interview"]]
    }
});
```

Isso compila para um `EXISTS` sobre a tabela relacionada, correlacionado à linha que está
sendo listada — e não para um join, que multiplicaria linhas e quebraria silenciosamente o `limit`.

Todos os operadores funcionam, porque o que está sendo comparado é uma coluna comum:

```typescript
where: {
    "applications.createdAt": ["<", "2026-01-01"],   // waiting since before…
    "agency.name": ["ilike", "%staffing%"]            // through a belongsTo
}
```

Os operadores negativos — `!=`, `not-in`, `not-like`, `not-ilike` — significam **"nenhuma
linha relacionada corresponde"**, não "alguma linha relacionada é diferente":

```typescript
// Candidates with no hired application.
where: { "applications.status": ["!=", "hired"] }
```

Essa é a interpretação que você deseja, e a única que faz `==` e `!=`
dividirem as linhas. A outra interpretação — "alguma candidatura não é 'hired'" — é
verdadeira para quase todos os candidatos com mais de uma candidatura, e não responde
a nada do que foi solicitado.

`is-null` e `is-not-null` deliberadamente **não** são um par complementar aqui.
Eles significam "possui uma linha relacionada cuja coluna não está preenchida" e "possui uma onde ela está
preenchida" — ambos verdadeiros para um candidato com duas candidaturas, uma de cada tipo.

Um nome de relação que não existe, ou uma coluna que o destino não possui, resulta em um
400 informando as colunas reais do destino. Nunca é uma condição descartada: descartar
uma chave de filtro *ampliaria* a leitura para todas as linhas.

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

`min`, `max`, `count`, `sum` e `avg`. `field` é obrigatório para todos eles,
exceto `count`, que conta as linhas relacionadas quando você o omite e conta
as linhas com uma coluna não nula quando você o especifica.

Esta é a parte de uma fila que não pode ser contornada no cliente. Um filtro pode
ser aproximado desnormalizando uma flag na linha; uma ordenação não pode ser
aproximada de forma alguma assim que o conjunto de resultados é paginado, porque o cliente retém apenas
uma página de cada vez e a página foi escolhida pela ordem errada.

Linhas nas quais a relação não alcança nada caem em uma extremidade definida — **último
em ordem ascendente, primeiro em ordem descendente**, a mesma posição que o Postgres atribui a um `NULL`. Um `count`
de nada é `0` em vez de null, portanto essas linhas são ordenadas como zero.

Via HTTP, a chave é uma única string, encaixando-se em `?orderBy=` sem alterações:

```bash
GET /api/data/talents?orderBy=min(applications.createdAt):asc
```

A paginação por cursor funciona com isso. Não há nenhum agregado armazenado na linha do cursor
para comparação, portanto o driver recalcula o valor da linha do cursor em SQL a partir
do id que ele possui.

### Row-level security

Ambos compilam para uma subconsulta executada com a identidade do leitor, portanto uma linha relacionada que suas
políticas ocultam não corresponde a um filtro e não contribui para um agregado.

Uma ressalva, apenas na direção **negativa**: "nenhuma linha relacionada corresponde" e "nenhuma
linha relacionada *que este leitor possa ver* corresponde" são a mesma sentença. Uma tabela de destino
com row-level security e sem nenhuma política de `SELECT` para `rebase_user` é opaca, portanto
toda linha parece não correspondente e um filtro `!=` / `not-in` reporta em excesso. Nada
vaza — as próprias políticas da tabela listada ainda decidem quais linhas sequer existem,
e a direção positiva retorna nada corretamente. A correção é uma política de `SELECT` no destino. O Rebase deriva uma para um many-to-many declarado; um esquema manual precisa fornecê-la.

### Suporte de mecanismo

Apenas Postgres. Uma coleção Firestore no CMS declara
`filterableRelationKinds: []` e não oferece nenhum dos dois recursos — um banco orientado a documentos
vincula por referência e não possui subconsultas para as quais compilar esses comandos. Veja
[Firebase](/docs/frontend/firebase/).

### Por que não `additionalFields`?

`AdditionalFieldDelegate.value()` é assíncrono e recebe todo o contexto, portanto ele *pode*
ler outra tabela — e ainda assim não pode ajudar aqui. Ele é executado no navegador,
uma vez por linha, **depois** que a página foi buscada e ordenada. Um valor calculado ali
pode ser exibido, mas nunca pode ser filtrado, ordenado ou paginado.

Se um valor derivado não for um agregado sobre uma relação, coloque-o no banco de dados —
uma coluna gerada, ou uma mantida por trigger — e ele se tornará uma propriedade comum.

## Próximos passos

- [Consultando Dados](/docs/sdk/querying/) — o construtor de consultas que esses acessadores retornam
- [Relações](/docs/collections/relations/) — declarando os vínculos que esta página lê
- [API REST](/docs/backend/api/) — o mesmo `include` via HTTP
