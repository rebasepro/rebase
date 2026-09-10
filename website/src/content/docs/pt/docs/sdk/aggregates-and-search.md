---
sourceHash: 6774e2ad2b2e95b0
title: Agregações e busca
sidebar_label: Agregações e busca
description: "Faça contagens, somas e agrupamentos com o SDK, filtre dentro de colunas JSON e execute busca textual e vetorial a partir do cliente."
---

## Agregações

`count`, `sum`, `avg`, `min` e `max` sobre as linhas selecionadas por um filtro,
sem buscá-las:

```bash
GET /api/data/orders/aggregate?select=count(),sum(total)
```

```json
{ "data": [{ "count": 128, "sum_total": 40522 }] }
```

Agrupe para obter uma linha por valor:

```bash
GET /api/data/orders/aggregate?select=count(),sum(total)&groupBy=status
```

```json
{
  "data": [
    { "status": "paid",    "count": 96, "sum_total": 31200 },
    { "status": "pending", "count": 32, "sum_total": 9322 }
  ]
}
```

Os resultados são indexados por função e campo — `count()` se torna `count`,
`sum(total)` se torna `sum_total`.

Ele aceita os mesmos filtros que o endpoint de listagem, de modo que uma agregação
pode ser restringida da mesma forma que uma listagem:

```bash
GET /api/data/orders/aggregate?select=sum(total)&status=eq.paid&createdAt=gte.2026-01-01
```

:::note
**A segurança em nível de linha (row-level security) se aplica às linhas que estão sendo agregadas.** Uma agregação é uma
maneira eficiente de obter informações sobre linhas que você não pode ler, portanto, ela é executada sob as próprias
políticas do chamador: quem não pode selecionar nada, não conta nada.
:::

As agregações precisam de um driver que as implemente. Em um driver que não as suporte, o
endpoint responde com `501` em vez de um resultado vazio — um painel não deve receber
a mensagem "nenhuma correspondência" quando a verdade é "não suportado".

## Filtrando dentro de JSON

Uma coluna `json` ou `jsonb` pode ser filtrada por caminho (path), usando a
sintaxe de seta do próprio Postgres:

```typescript
// Orders whose metadata says the country is US
const { data } = await client.data.orders
    .where("metadata->>country", "==", "US")
    .find();

// Nested paths walk with -> and take the leaf with ->>
await client.data.orders.where("metadata->address->>city", "==", "Berlin").find();
```

Via REST:

```bash
GET /api/data/orders?metadata->>country=eq.US
```

Os segmentos de caminho são sempre enviados como parâmetros vinculados (bound parameters), nunca concatenados no SQL.

### Como os valores são comparados

`->>` retorna **texto**, portanto as comparações são comparações de texto — exceto que um
operador de ordenação (`>`, `>=`, `<`, `<=`) fornecido com um **número** faz uma conversão para numérico:

```typescript
await client.data.orders.where("metadata->>score", ">", 100).find();     // numeric: 9 < 100
await client.data.orders.where("metadata->>version", ">", "1.2").find(); // text
```

Linhas cujo valor nesse caminho não é um número são excluídas de uma
comparação numérica em vez de causar falha na consulta. Booleanos são comparados como `"true"` /
`"false"`, que é como o `->>` os renderiza.

:::note
`array-contains` e os outros operadores de coluna inteira não estão disponíveis em um
caminho — eles fazem uma verificação sobre o documento inteiro, portanto, use-os na própria
coluna.
:::

## Busca textual

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

Por padrão, esta é uma **correspondência de substring que não diferencia maiúsculas de minúsculas** entre as
propriedades `string` de nível superior da coleção. Não se trata de uma busca de texto completo (full-text search): ela
não acessa propriedades `map` ou `array`, não faz stemming nem ranqueamento e não pode
usar um índice.

Uma coleção do Postgres pode optar pela busca de texto completo real declarando um
bloco `search`, o que também torna os resultados classificáveis por `_score`. Consulte
[Busca](/docs/backend/search).

## Busca vetorial

Para coleções com uma propriedade `vector`, ordene as linhas por similaridade com um
embedding de consulta. As linhas retornam das mais próximas para as mais distantes, cada uma carregando uma `_distance`.

```typescript
const { data } = await client.data.docs
    .vectorSearch("embedding", queryVector, { threshold: 0.35 })
    .where("status", "==", "published")
    .limit(10)
    .find();
```

`where` e `orderBy` na mesma consulta atuam como filtros aplicados *antes* da
ordenação — isso retorna as linhas mais próximas que também correspondem, e não as linhas mais próximas
filtradas posteriormente. Gerar o `queryVector` é sua responsabilidade: o Rebase armazena e
busca embeddings, ele não os computa.

### O que você precisa fornecer

- **pgvector.** Uma propriedade `vector` compila para uma coluna `VECTOR(n)`, e esse
  tipo vem da extensão `vector`. O Rebase a instalará para você, mas
  apenas onde você permitir:

  ```ts
  // config/resources.ts
  export const main = database({ extensions: ["vector"] });
  ```

  Essa linha é uma permissão em vez de uma solicitação — o Rebase executa
  `CREATE EXTENSION IF NOT EXISTS vector` apenas quando algo no seu esquema
  precisa dela. É opcional (opt-in) porque a instalação de uma extensão depende de coisas
  que o Rebase não consegue ver de dentro da conexão: a imagem precisa incluir a
  biblioteca (a imagem do scaffold `pgvector/pgvector:pg18` inclui, uma `postgres:18`
  padrão não), a role precisa ter permissão para instalá-la e um provedor gerenciado
  precisa tê-la em uma lista de permissões (allow-list).

  Se nada for declarado, o Rebase não instala nada — em vez disso, instale-a manualmente
  uma vez. De qualquer forma, a coluna é criada, e o Postgres a recusará com
  `type "vector" does not exist` em um banco de dados que não tenha nenhum dos dois,
  indicando ambas as alternativas para resolver.

A coluna, seu índice ANN e esse `CREATE EXTENSION` são gerados em
`drizzle/vector.sql`, ao lado de `schema.sql` e `policies.sql`, e o `rebase db
push` os aplica para você. Eles têm um arquivo próprio porque o Atlas — o
mecanismo por trás do `db push` — calcula seu diff materializando o `schema.sql` em um
banco de dados temporário que ele limpa no início de cada execução, portanto, um `VECTOR(n)` lá dentro
é resolvido contra um banco de dados que nunca pode ter o pgvector.

O `rebase db generate` anexa esse arquivo à migração que ele grava, de modo que uma
migração reproduzida em um banco de dados novo também cria a coluna. Uma alteração apenas
na propriedade vetorial não produz migração, porque o esquema comparado pelo Atlas
permanece inalterado — o `db generate` informa isso quando acontece.

### O índice

Toda coluna vetorial recebe um índice HNSW para distância de cosseno, criado com a
tabela e informado na inicialização. Cosseno porque é isso que o `vectorSearch` utiliza para
medição, a menos que você passe `distance` — um índice atende exatamente a um operador, portanto, uma
consulta `l2` em um índice de cosseno volta silenciosamente para uma varredura (scanning).

Ajuste-o ou desative-o na propriedade:

```ts
embedding: {
    type: "vector",
    dimensions: 1536,
    // Defaults: one HNSW index, cosine. Any of these may be omitted.
    index: {
        method: "hnsw",              // or "ivfflat"
        distance: ["cosine", "l2"],  // one index each
        m: 24,                       // hnsw
        efConstruction: 128          // hnsw
    }
}
```

`index: false` mantém a varredura exata de propósito. Acima de 2000 dimensões, o pgvector
não consegue construir nenhum dos tipos de índice, portanto, a coluna é criada e deixada sem índice, e
a inicialização avisa sobre isso — o `vectorSearch` ainda responde, como uma varredura exata.

O `vectorSearch` é uma consulta, não uma assinatura (subscription): `.listen()` em uma delas
é recusado em vez de ser atendido como uma listagem simples, porque nada recalcula as distâncias em uma
escrita.

## Próximos passos

- [Consultando dados](/docs/sdk/querying/) — o construtor de consultas sobre o qual estes operam
- [Busca](/docs/backend/search/) — como a busca textual e vetorial são configuradas no backend
- [API REST](/docs/backend/api/) — as mesmas consultas via HTTP

---
