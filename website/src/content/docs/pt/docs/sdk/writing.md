---
sourceHash: a31d37ab40b701e5
title: Escrita de dados
sidebar_label: Escrita de dados
description: crie, faça upsert, atualize e exclua com o SDK — operações de campo, escritas condicionais, chaves de idempotência, escritas em lote e escrita entre coleções em uma única transação.
---

As leituras estão em [Querying data](/docs/sdk/querying/). Esta página é a outra metade:
tudo o que altera uma linha.

Cada método aqui passa pelo mesmo pipeline que uma escrita vinda de qualquer outro
lugar passa — [callbacks](/docs/collections/callbacks/),
[relações](/docs/collections/relations/) e
[segurança em nível de linha](/docs/collections/security-rules/) continuam valendo. Nada
disso é um atalho para burlar suas próprias regras; o que essas opções proporcionam é economizar
um round trip, uma transação ou uma condição de corrida que você não precisa mais perder.

## Escritas em linha única

### Create

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

### Upsert

Insira a linha ou substitua aquela que já ocupa sua chave:

```typescript
await client.data.users.upsert(
    { email: "ada@example.com", name: "Ada" },
    { onConflict: ["email"] }
);
```

Uma única instrução no servidor (`INSERT … ON CONFLICT DO UPDATE`), portanto, diferentemente de um
`findById` seguido por um `create`-ou-`update`, ela não perde a condição de corrida entre os
dois e, ao contrário do `create`, não falha quando a linha já existe.

`onConflict` tem como padrão a chave primária, que é o alvo incorreto para a maioria das
escritas em que um upsert é utilizado: indexado por um id serial que é uma simples
inserção, já que o chamador não sabe o id — portanto, uma importação executável novamente
duplica todas as linhas na segunda execução. Em vez disso, especifique a chave natural. Ela deve
conter uma garantia de exclusividade com a qual o banco de dados possa fazer a correspondência — `validation: { unique:
true }` na propriedade ou nas colunas de um [índice](/docs/backend/indexes/)
`unique: true` — e qualquer outra coisa resultará em um erro 400 listando os alvos
que realmente existem, em vez de um erro gerado de dentro de uma transação.

O timestamp `on_create` de uma linha que já existia é mantido intacto: um
conflito significa que sua criação é um fato do passado.

### Update

```typescript
const updated = await client.data.products.update(42, {
    name: "Updated Name",
    price: 39.99
});
```

#### Operações de campo

Em vez disso, um valor pode ser uma operação sobre o valor *armazenado*:

```typescript
await client.data.posts.update(postId, {
    views: { $inc: 1 },
    tags:  { $push: "featured" },
    meta:  { $merge: { lastSeen: Date.now() } }
});
```

| Operador | Tipo de propriedade | Significado |
|----------|---------------------|-------------|
| `$inc` | `number` | adiciona (negativo para subtrair) |
| `$push` | `array` | anexa um valor, ou cada valor de um array |
| `$pull` | `array` | remove todas as ocorrências de um valor |
| `$merge` | `map` | faz a mesclagem superficial (shallow-merge) de um objeto |

O motivo para recorrer a eles é a leitura que você deixa de fazer e a condição de corrida
que essa leitura abriria. `views = current + 1` significa buscar `current` primeiro, e duas
requisições que leem `4` escreverão `5` — um incremento é perdido e nenhuma
das respostas avisa isso. Compilada na instrução, a aritmética acontece dentro do
bloqueio da linha (row lock).

Exatamente um operador por campo, e apenas em uma atualização: em uma linha que ainda
não existe não há nada sobre o que operar, portanto, uma operação em um `create`,
`createMany` ou `upsert` retorna 400. Um operador no tipo de propriedade errado ou um
`$operator` com erro de digitação resulta em um 400 informando o nome do campo — nunca em um documento JSON
gravado na coluna.

Enquanto estiver offline, elas são recusadas em vez de enfileiradas: uma operação é avaliada
em relação a um valor armazenado do qual o dispositivo não tem uma cópia atualizada, e uma linha
otimista só poderia exibir o próprio marcador até que a fila fosse esvaziada.

### Delete

```typescript
await client.data.products.delete(42);
```

### Escritas condicionais

`update` e `delete` aceitam um `ifMatch`, de forma que uma escrita é recusada caso a linha
tenha sido alterada desde que você a leu:

```typescript
import { etagOf } from "@rebasepro/client";

const post = await client.data.posts.get(1);
await client.data.posts.update(1, { title: "New" }, { ifMatch: etagOf(post) });
// → RebaseApiError, status 412, if somebody edited it in between
```

Sem isso, o ciclo leitura-modificação-escrita adota a regra do "último a escrever vence" (last-writer-wins) sobre tudo o que você
não enviou: dois editores com um segundo de diferença são bem-sucedidos, e a alteração do primeiro
é perdida sem nenhum erro em lugar algum.

`etagOf(row)` lê a versão de uma linha originada de `findById`/`get`. Ela
reside em uma chave não enumerável, portanto, nunca entra no tipo `Row` gerado, em um
`JSON.stringify` ou em um spread para o próximo corpo de atualização. O valor é `undefined` para
uma linha vinda de `find()`, do cache offline ou de um servidor que não envia
`ETag` — e passar `undefined` não envia nenhuma pré-condição, fazendo com que a chamada acima
se degrade para uma atualização comum em vez de lançar um erro.

### Ignorando a resposta

Toda escrita resolve para a linha que foi gravada. Passe `{ returning: false }` quando
não precisar dela:

```typescript
await client.data.events.create({ kind: "page_view" }, undefined, { returning: false });
```

Isso envia `Prefer: return=minimal`; o servidor responde com `204` para uma escrita única
e apenas com os ids para um lote. O método então resolve para `undefined` (ou `[]`),
evitando que você use acidentalmente uma linha que o servidor nunca enviou. Vale a pena em importações
e escritas do tipo "dispare e esqueça" (fire-and-forget) — o padrão é retornar a linha porque ela traz o que o
*servidor* determinou.

## Escritas em lote

Três operações escrevem várias linhas em uma **única requisição e em uma única
transação**. Cada linha ainda passa pelo pipeline normal — callbacks, relações,
segurança em nível de linha — portanto, um lote não é um atalho para burlar suas próprias regras; o ganho
é um round trip e uma transação em vez de N de cada.

Todas as três são **tudo ou nada**. Se qualquer linha for rejeitada, nenhuma delas será gravada e
o erro indicará o índice com problema.

```typescript
// Create
await client.data.products.createMany([
    { name: "Widget", price: 9.99 },
    { name: "Gadget", price: 19.99 }
]);

// Update — each entry names its row and the fields to change
await client.data.orders.updateMany([
    { id: "o-1", data: { status: "shipped" } },
    { id: "o-2", data: { status: "shipped" } }
]);

// Delete — by id
await client.data.sessions.deleteMany(["s-1", "s-2"]);
```

### Por que `{ id, data }` em vez de linhas simples

O `createMany` recebe linhas simples (flat rows) porque uma linha sendo criada *é* suas colunas.
O `updateMany` especifica o endereço separadamente, porque em uma tabela cuja chave é algo
além do `id` — um `sku`, uma chave composta —, uma linha simples não tem como dizer se uma
coluna é o endereço ou um valor a ser gravado. Isso reproduz exatamente o
`update(id, data)` de linha única.

### Por que `deleteMany` recebe ids, não um filtro

Uma exclusão em massa baseada em filtro é uma operação diferente e muito mais perigosa: a
forma de falha é uma condição omitida ou digitada incorretamente esvaziar uma tabela, e isso não pode
ser revisado no local da chamada da mesma forma que uma lista explícita. Leia primeiro, depois passe
os ids pretendidos:

```typescript
const stale = await client.data.sessions.findAll({
    where: { expiresAt: ["<", cutoff] }
});
await client.data.sessions.deleteMany(stale.map(s => s.id as string));
```

### Novas tentativas e duplicatas

Um cliente que nunca recebe a resposta não tem como saber se o lote foi confirmado (committed),
então ele tenta novamente — e, sem uma chave, o servidor não consegue distinguir essa nova tentativa de
um segundo lote autêntico. Passe uma chave de idempotência em qualquer coisa que possa ser reenviada:

```typescript
const attemptKey = crypto.randomUUID();
await client.data.products.createMany(rows, { idempotencyKey: attemptKey });
```

Uma chave identifica uma única requisição, não um trabalho (job): ela é registrada para o método, o caminho
e o corpo com os quais foi enviada. Reenviar exatamente essa requisição reproduz sua resposta;
a mesma chave em uma requisição diferente é recusada com `IDEMPOTENCY_KEY_REUSED`
(422). Portanto, gere uma por chamada em vez de reutilizar um id de negócio — um `importId`
compartilhado entre o `createMany` e o `deleteMany` de uma mesma importação deixaria a
exclusão silenciosamente sem ser executada.

Uma nova tentativa que chega enquanto a primeira tentativa ainda está sendo respondida recebe
`IDEMPOTENCY_KEY_IN_PROGRESS` (409): envie-a novamente e ela será respondida com
o resultado da primeira tentativa assim que for concluída. As chaves são respeitadas por 24 horas e
apenas para um chamador autenticado — caso contrário, não há uma entidade (principal) à qual associá-la.

A fila offline define uma chave automaticamente a cada repetição (replay).

### Limites

Os lotes são limitados no lado do servidor (1000 linhas por padrão), pois um lote mantém
seus bloqueios durante toda a transação. Ultrapassar isso resulta em um erro `BULK_TOO_LARGE` que
informa tanto o limite quanto a contagem de linhas enviada, portanto, divida em partes (chunks):

```typescript
for (const chunk of chunks(rows, 1000)) {
    await client.data.products.createMany(chunk, { upsert: true });
}
```

Uma fonte de dados que não consegue gravar atomicamente relata `BULK_UNSUPPORTED` em vez
de executar silenciosamente escritas individuais em loop — o que não ofereceria nem a atomicidade
nem o round trip único que você buscou ao usar um lote.

## Escrita entre coleções

O `createMany` e similares operam em uma coleção de cada vez. `client.batch()` é a
forma entre coleções: uma requisição, uma transação, tudo ou nada.

```typescript
const result = await client.batch([
    { op: "create", collection: "orders",
      values: { total: 40 }, ref: "order" },
    { op: "create", collection: "order_items",
      values: { order_id: { $ref: "order.id" }, sku: "A-1" } },
    { op: "update", collection: "stock",
      id: "A-1", values: { count: { $inc: -1 } } },
    { op: "delete", collection: "carts", id: "c-9" }
]);

result.data;  // [ order, item, stock, null ] — aligned to the operations
result.meta;  // { operations: 4 }
```

`op` é `create`, `update`, `upsert` ou `delete`, e `collection` restringe
`values` ao formato gerado de `Insert` ou `Update` daquela coleção. Cada
operação executa o pipeline que seu equivalente de linha única executaria — a mesma
validação, callbacks e segurança em nível de linha, como o mesmo usuário.

### `$ref`

Uma operação pode se identificar com `ref`; uma posterior pode usar
`{ $ref: "<name>.<field>" }` onde quer que um valor seja aceito, inclusive como um `id` e em
qualquer profundidade dentro de `values`. Isso é resolvido para aquele campo da linha gravada
pela operação nomeada.

É por isso que o método existe em vez de um loop sobre o `createMany`: a chave
estrangeira do filho não existe até que o pai seja inserido, então os dois teriam
que ser requisições separadas — e requisições separadas podem ser concluídas pela metade. A recuperação
disso (ler de volta, descobrir qual metade foi gravada, desfazê-la) é um código que ninguém
escreve.

Apenas referências para trás (backward references) são resolvidas. Uma referência para frente é recusada antes da
abertura da transação, juntamente com coleções desconhecidas, campos desconhecidos, operações de campo
inválidas e alvos de conflito inelegíveis — porque descobrir um erro na
operação 40, de outra forma, custaria o rollback das 39 escritas anteriores.

### Limites e falhas

O mesmo limite de 1000 operações de uma escrita em massa, pelo mesmo motivo: um lote
mantém seus bloqueios durante toda a transação. Um `update` ou `delete` que especifique uma linha
que não existe faz todo o lote falhar com um erro 404. Um backend cujo driver
não possa garantir a atomicidade responde com `BATCH_UNSUPPORTED` em vez de entrar em loop.

`idempotencyKey` e `returning` funcionam da mesma forma que em qualquer outra escrita.

---
