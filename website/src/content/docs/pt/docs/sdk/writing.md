---
sourceHash: dc2857e881f65bd3
title: Gravação de dados
sidebar_label: Gravação de dados
description: create, upsert, update e delete com o SDK — operações de campo, gravações condicionais, chaves de idempotência, gravações em lote e gravação entre tabelas em uma única transação.
---

As leituras estão em [Consulta de dados](/docs/sdk/querying/). Esta página é a outra metade:
tudo o que altera uma linha.

Cada método aqui passa pelo mesmo pipeline que uma gravação originada de qualquer outro lugar
passa — [hooks](/docs/collections/callbacks/),
[relations](/docs/collections/relations/) e
[row-level security](/docs/collections/security-rules/) continuam sendo aplicados. Nada
disso é um atalho para burlar suas próprias regras; o que essas opções proporcionam é um round trip, uma
transação ou uma condição de corrida que você não precisa mais perder.

## Gravações de linha única

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

Insira a linha ou atualize aquela que já ocupa sua chave:

```typescript
await client.data.products.upsert(
    { sku: "LAMP-01", name: "Desk lamp", price: 39 },
    { onConflict: ["sku"] }
);
```

O servidor decide qual executar dentro de uma única transação e recorre a
`INSERT … ON CONFLICT DO UPDATE`, portanto, diferentemente de um `findById` seguido por
`create`-ou-`update`, ele não perde a corrida entre os dois e, ao contrário do
`create`, não falha quando a linha já existe.

Quando a linha já existe, o upsert é uma atualização dela. Os campos enviados são
gravados e os que você omitir mantêm seus valores armazenados — eles não são redefinidos
para o seu `defaultValue`. `beforeSave` e `afterSave` visualizam `status: "existing"`
com os valores anteriores, e o histórico registra uma atualização. Uma chave que referencia uma linha
fora do escopo de `beforeQuery` de quem fez a chamada resulta em um 404.

O padrão de `onConflict` é a chave primária, que é o alvo incorreto para a maioria
das gravações para as quais um upsert é utilizado: com base em um id serial que é uma
inserção simples, porque quem chama não sabe o id — portanto, uma importação reexecutável
duplicaria cada linha na segunda execução. Em vez disso, informe a chave natural. Ela deve
conter uma garantia de unicidade com a qual o banco de dados possa fazer correspondência — `validation: { unique:
true }` na propriedade, ou as colunas de um [índice](/docs/backend/indexes/)
`unique: true` — e qualquer outra coisa resultará em um erro 400 listando os alvos
que realmente existem, em vez de um erro gerado de dentro de uma transação.

O timestamp `on_create` e o criador `user_on_create` de uma linha que já
existia não são alterados: um conflito significa que sua criação é um fato do passado.

#### Mantendo a linha armazenada: `where` e `ignoreDuplicates`

`where` substitui a linha armazenada apenas quando há correspondência — um filtro nas
colunas da linha armazenada, escrito da mesma forma que em um `find()`. `ignoreDuplicates` nunca
a substitui. De qualquer forma, a chamada é resolvida como `undefined` quando a linha armazenada
for mantida como estava, e a verificação é feita pela própria instrução (`ON CONFLICT … DO UPDATE
… WHERE`, `ON CONFLICT DO NOTHING`), portanto nenhuma outra gravação pode acontecer entre a leitura
e a decisão:

```typescript
// Keep the best score of the day: written only when it beats the stored one.
const kept = await client.data.scores.upsert(
    { day, player, score },
    { where: { score: ["<", score] } }
);

// Claim a slot once; a second claim changes nothing.
const claim = await client.data.claims.upsert({ slot, owner }, { ignoreDuplicates: true });
if (!claim) throw new Error("taken");
```

`createMany(rows, { upsert: true, where })` e `{ upsert: true, ignoreDuplicates: true }`
fazem o mesmo por linha e retornam apenas as linhas que gravaram. Ambos necessitam de `upsert`, e
os dois não podem ser combinados (`INVALID_CONFLICT_RULE`).

#### Indisponível na tabela de autenticação

<span class="since-badge" data-since="0.31">Desde 0.31</span>

O uso de `upsert()` na tabela de autenticação (aquela declarada com `defineAuthTable`) é recusado
com um erro 400 (`INVALID_CONFLICT_TARGET`), assim como `createMany` com `upsert`.
Criar um usuário e alterar um usuário seguem regras diferentes — uma criação
gera o hash da senha e envia o convite; uma atualização não pode rebaixar o último
administrador — e um upsert só descobre de qual caso se trata durante a gravação. Em vez disso,
chame `create` ou `update`.

### Update

```typescript
const updated = await client.data.products.update(42, {
    name: "Updated Name",
    price: 39.99
});
```

#### Operações de campo

Em vez disso, um valor pode ser uma operação no valor *armazenado*:

```typescript
await client.data.posts.update(postId, {
    views: { $inc: 1 },
    tags:  { $push: "featured" },
    meta:  { $merge: { lastSeen: Date.now() } }
});
```

| Operador | Tipo de propriedade | Significado |
|----------|---------------------|-------------|
| `$inc` | `number` | somar (negativo para subtrair) |
| `$push` | `array` | anexar um valor ou cada um de um array de valores |
| `$pull` | `array` | remover todas as ocorrências de um valor |
| `$merge` | `map` | mesclar superficialmente (shallow merge) um objeto |

O motivo para utilizá-las é a leitura que você deixa de fazer e a condição de corrida
que essa leitura causaria. `views = current + 1` significa buscar `current` primeiro, e duas
requisições que leem `4` cada uma gravarão `5` — um incremento é perdido e nenhuma das
respostas indicará isso. Compilada na instrução, a aritmética ocorre dentro do
bloqueio (lock) da linha.

Exatamente um operador por campo, e apenas em um update: sobre uma linha que ainda
não existe, não há nada sobre o que operar; portanto, uma operação em um `create`,
`createMany` ou `upsert` resulta em um 400. Um operador no tipo de propriedade incorreto, ou um
`$operator` com erro de digitação, resulta em um 400 identificando o campo — nunca em um documento JSON
gravado na coluna.

Uma operação responde à `validation` da propriedade da mesma forma que um valor simples, e
isso inclui o valor resultante por ela produzido. `{ stock: { $inc: -1 } }` em um `stock` com
`validation: { min: 0 }` é bem-sucedido enquanto o estoque for de pelo menos 1 e é recusado
em 0 com o mesmo 400 (`VALIDATION_CONSTRAINT`) que `{ stock: -1 }` recebe. O
mesmo se aplica a `max`, `moreThan`, `lessThan`, `positive` e `negative`, e aos itens
`min` e `max` de um array após um `$push` ou `$pull`. A verificação faz parte
da instrução de atualização, portanto dois decrementos simultâneos de um estoque igual a 1 não podem
ser ambos bem-sucedidos, e uma atualização recusada não grava nada.

Enquanto estiver offline, elas são recusadas em vez de enfileiradas: uma operação é avaliada
contra um valor armazenado do qual o dispositivo não tem uma cópia atual, e uma linha otimista
só poderia exibir o próprio marcador até que a fila fosse processada.

### Delete

```typescript
await client.data.products.delete(42);
```

Em uma tabela com [soft delete](/docs/collections/soft-delete), isso marca a
linha em vez de removê-la. `client.data.products.trash` lista, conta, restaura
e expurga as linhas marcadas.

### Gravações condicionais

`update` e `delete` aceitam um `ifMatch`, de modo que uma gravação é recusada quando a linha foi
alterada desde que você a leu:

```typescript
import { etagOf } from "@rebasepro/client";

const post = await client.data.posts.get(1);
await client.data.posts.update(1, { title: "New" }, { ifMatch: etagOf(post) });
// → RebaseApiError, status 412, if somebody edited it in between
```

Sem isso, o fluxo de ler-modificar-gravar opera como "o último a gravar vence" sobre tudo o que você
não enviou: dois editores com um segundo de diferença são ambos bem-sucedidos, e a alteração do primeiro é
perdida sem nenhum erro em lugar algum.

`etagOf(row)` lê a versão a partir de uma linha retornada por `findById`/`get`. Ele
reside em uma chave não enumerável, portanto nunca entra no tipo `Row` gerado, em um
`JSON.stringify` ou em um spread no corpo da próxima atualização. Ele é `undefined` para uma
linha vinda de `find()`, do cache offline ou de um servidor que não envia
`ETag` — e passar `undefined` não envia nenhuma pré-condição, logo a chamada acima
se degrada para uma atualização comum em vez de lançar um erro.

Uma linha retornada por `update()` carrega a versão produzida por aquela gravação, permitindo que
edições condicionais sejam encadeadas sem uma leitura intermediária. Uma linha que um callback de `listenById()`
recebe carrega a versão exibida naquele frame:

```typescript
import { etagOf } from "@rebasepro/client";

let shown: Record<string, unknown> | undefined;
client.data.posts.listenById(1, (post) => {
    shown = post; // etagOf(shown) is the version this frame shows
});

// On save: refused with 412 if the row has moved on since that frame
await client.data.posts.update(1, { title: "New" }, { ifMatch: etagOf(shown) });
```

A partir de um navegador em outra origem — um frontend Vite em sua própria porta, um host `app.`
chamando um host `api.` — a `ETag` só pode ser lida porque o servidor a especifica
em `Access-Control-Expose-Headers`. O runtime do Rebase faz isso, juntamente
com `Retry-After`, `X-Request-ID`, os cabeçalhos `X-RateLimit-*` e
`Preference-Applied`. Um backend que configura seu próprio `cors()` deve expor a
mesma lista; caso contrário, `etagOf` será sempre `undefined` nele e toda gravação condicional
será enviada de forma incondicional.

### Omitindo a resposta

Toda gravação é resolvida para a linha que foi gravada. Passe `{ returning: false }` quando você
não precisar dela:

```typescript
await client.data.events.create({ kind: "page_view" }, undefined, { returning: false });
```

Isso envia `Prefer: return=minimal`; o servidor responde `204` para uma gravação individual
e apenas os ids para um lote. O método então resolve para `undefined` (ou `[]`),
evitando que você use acidentalmente uma linha que o servidor nunca enviou. Vale a pena em importações
e gravações do tipo dispara-e-esquece — o padrão é retornar a linha porque ela traz o que o
*servidor* definiu.

## Gravações em lote

Três operações gravam várias linhas em uma **única requisição e em uma única
transação**. Cada linha ainda passa pelo pipeline normal — hooks, relations,
row-level security — portanto, um lote não é um atalho para ignorar suas próprias regras; o ganho
é ter um único round trip e uma única transação em vez de N de cada.

Todas as três são no formato **tudo-ou-nada**. Se qualquer linha for rejeitada, nenhuma delas será aplicada e
o erro indicará o índice problemático.

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

### Quantas instruções compõem um lote

Em uma tabela sem nenhum hook `beforeSave`, `afterSave` ou `afterSaveError`,
sem `history` e sem `tenant`, um lote é composto por poucas instruções em vez de
uma por linha: `createMany` envia instruções `INSERT … RETURNING` de múltiplas linhas (com
`upsert`, `INSERT … ON CONFLICT … DO UPDATE`), e `updateMany` envia um
`UPDATE … FROM (VALUES …) RETURNING` para cada sequência de entradas que definem os mesmos
campos. Valores padrão declarados, carimbos `.onCreateNow()` / `.onUpdateNow()`, `afterRead` e eventos de tempo real
se aplicam a cada linha da mesma forma que ocorrem individualmente. Se o banco de dados recusar o
lote, ele é desfeito e reexecutado linha por linha para que o erro continue identificando a entrada
que falhou. Uma tabela que declare um desses hooks mantém o pipeline linha por linha,
pois cada hook é executado uma vez por linha entre as gravações daquela linha.

Um `update` individual da mesma forma não lê nada quando nada necessita da linha armazenada:
o `UPDATE … RETURNING` é tanto o 404 para uma linha inexistente quanto a linha com a qual ele
responde. Um `delete` sem hook, histórico ou lixeira para atender também não faz nenhuma leitura.

### Quantos round trips compõem uma gravação

Uma gravação em uma tabela desse tipo é um único round trip até o banco de dados: o
`BEGIN` da transação, a identidade de quem chamou, a instrução e o `COMMIT` vão todos
em um único lote. Isso vale para `create`, `update`, `upsert`, `delete`,
`updateWhere`, `deleteWhere` e um `createMany` gravados juntos. Uma instrução que
o banco de dados recuse ignora o `COMMIT` subsequente, e a gravação sofre rollback como
qualquer falha. Uma gravação que executa um hook ou registra histórico envia seu
`COMMIT` após eles, em um segundo round trip.

### Por que `{ id, data }` em vez de linhas planas

`createMany` recebe linhas planas porque uma linha que está sendo criada *são* suas próprias colunas.
`updateMany` especifica o endereço separadamente porque, em uma tabela cuja chave seja algo
além de `id` — um `sku`, uma chave composta —, uma linha plana não consegue indicar se uma
coluna é o endereço ou um valor a ser gravado. Isso espelha exatamente o
`update(id, data)` de linha única.

## Gravação por filtro

`updateWhere` e `deleteWhere` gravam todas as linhas correspondentes a um filtro em uma única
instrução — `UPDATE … WHERE … RETURNING` e `DELETE … WHERE`. O filtro corresponde ao
`where` e `logical` aceitos por `find()`:

```typescript
// Every expired session, gone; resolves to how many.
const removed = await client.data.sessions.deleteWhere({ where: { expiresAt: ["<", cutoff] } });

// Field operations work as on update(); resolves to the rows updated.
const bumped = await client.data.songs.updateWhere(
    { where: { "lower(artist)": ["in", ["abba", "queen"]] } },
    { plays: { $inc: 1 } }
);
```

Um filtro que não corresponda a nada não é um erro — retorna `[]` ou `0` —, o que também faz do
`deleteWhere` a deleção adequada para uma linha que já pode não existir mais,
onde `delete` responderia com 404. E como a instrução que grava é a mesma que verifica o
filtro, trata-se de uma operação compare-and-set:

```typescript
// Save only over the revision this client read; [] means somebody else saved first.
const [saved] = await client.data.saves.updateWhere(
    { where: { player: ["==", player], rev: ["==", rev] } },
    { body, rev: { $inc: 1 } }
);
```

Um filtro sem condições é recusado com `FILTER_REQUIRED` em vez de ser executado —
caso contrário, afetaria todas as linhas — e um campo que não seja uma coluna é recusado assim como
em uma leitura, nunca ignorado silenciosamente. Um update filtrado não pode alterar uma coluna de chave.

Em uma tabela cujas gravações executam processamento por linha — um hook de salvamento ou deleção, histórico,
tenancy, um `beforeQuery`, soft delete, controle de acesso por campo —, as linhas correspondentes são
lidas no escopo de quem fez a chamada e gravadas uma a uma através do pipeline completo,
em uma única transação. Via HTTP, essas são as rotas bulk com um filtro
no lugar dos ids: `PATCH /api/data/<slug>/bulk` com `{ where, logical, data }`
e `POST /api/data/<slug>/bulk/delete` com `{ where, logical }`. Elas não estão
disponíveis na tabela de autenticação, cujas atualizações e deleções são verificadas usuário
por usuário (`FILTERED_USER_WRITE`); especifique os usuários com `updateMany`/`deleteMany`.

### Tentativas de repetição e duplicatas

Um cliente que nunca recebe a resposta não tem como saber se o lote foi confirmado,
portanto tenta novamente — e, sem uma chave, o servidor não consegue diferenciar essa nova tentativa
de um segundo lote legítimo. Passe uma chave de idempotência em qualquer requisição que possa ser reenviada:

```typescript
const attemptKey = crypto.randomUUID();
await client.data.products.createMany(rows, { idempotencyKey: attemptKey });
```

Uma chave identifica uma única requisição, não um trabalho: ela é registrada para o método, o caminho
e o corpo com os quais foi enviada. Reenviar exatamente essa mesma requisição reproduz a sua resposta anterior;
a mesma chave em uma requisição diferente é recusada com `IDEMPOTENCY_KEY_REUSED`
(422). Portanto, gere uma nova para cada chamada em vez de reutilizar um id de negócio — um `importId`
compartilhado pelo `createMany` e pelo `deleteMany` de uma importação faria com que a
deleção fosse silenciosamente ignorada.

Uma retentativa que chega enquanto a primeira tentativa ainda está sendo processada recebe
`IDEMPOTENCY_KEY_IN_PROGRESS` (409): envie-a novamente, e ela será respondida com o
resultado da primeira tentativa assim que esta for concluída. As chaves são válidas por 24 horas e
apenas para um chamador autenticado — caso contrário, não haveria um principal para definir seu escopo.

A fila offline define uma chave automaticamente a cada repetição.

### Limites

Os lotes têm um limite máximo definido no servidor (1000 linhas por padrão), pois um lote mantém
seus locks durante toda a transação. Ultrapassar esse limite gera um erro `BULK_TOO_LARGE` que
informa tanto o limite quanto a contagem de linhas enviada, portanto, divida em partes:

```typescript
for (const chunk of chunks(rows, 1000)) {
    await client.data.products.createMany(chunk, { upsert: true });
}
```

Uma fonte de dados que não pode gravar atomicamente relata `BULK_UNSUPPORTED` em vez
de executar silenciosamente gravações individuais em loop — o que não ofereceria nem a atomicidade
nem o round trip único que você buscou ao usar um lote.

## Gravação entre tabelas

<span class="since-badge" data-since="0.31">Desde 0.31</span>

`createMany` e métodos afins operam em uma tabela por vez. `client.batch()` é a
forma entre tabelas: uma requisição, uma transação, tudo ou nada.

```typescript
const result = await client.batch([
    { op: "create", table: "orders",
      values: { total: 40 }, ref: "order" },
    { op: "create", table: "orderItems",
      values: { orderId: { $ref: "order.id" }, sku: "A-1" } },
    { op: "update", table: "stock",
      id: "A-1", values: { count: { $inc: -1 } } },
    { op: "delete", table: "carts", id: "c-9" }
]);

result.data;  // [ order, item, stock, null ] — aligned to the operations
result.meta;  // { operations: 4 }
```

`op` é `create`, `update`, `upsert` ou `delete`, e `table` restringe
`values` ao formato de `Insert` ou `Update` gerado para aquela tabela — uma coluna
que a tabela não possui gera um erro de compilação, assim como um create no qual falte um
campo obrigatório. `table` é o acessador, o nome adotado por `client.data.<accessor>`
(`orderItems` para o slug `order_items`); o cliente envia o slug,
por meio do dicionário `tables` com o qual foi criado. Cada
operação executa o pipeline que seu equivalente de linha única executaria — a mesma
validação, hooks e row-level security, sob o mesmo usuário.

### `$ref`

Uma operação pode definir um identificador próprio com `ref`; uma operação posterior pode inserir
`{ $ref: "<name>.<field>" }` em qualquer lugar onde um valor for aceito, inclusive como um `id` e em
qualquer nível de profundidade dentro de `values`. Isso é resolvido para aquele campo da linha gravada
pela operação identificada.

É por isso que o método existe em vez de um loop sobre `createMany`: a chave
estrangeira do registro filho não existe até que o pai seja inserido, de modo que os dois teriam que
ser requisições separadas — e requisições separadas podem ter sucesso apenas parcial. A recuperação
disso (ler novamente, identificar qual metade foi aplicada e desfazê-la) é um código que ninguém
quer escrever.

Apenas referências para operações anteriores são resolvidas. Uma referência futura é recusada antes
que a transação seja aberta, juntamente com tabelas desconhecidas, campos desconhecidos, operações de campo
inválidas e alvos de conflito inelegíveis — porque descobrir um erro na operação 40 custaria, de outro modo,
o rollback das 39 gravações anteriores a ela.

### Limites e falhas

O mesmo limite de 1000 operações de uma gravação em massa, pelo mesmo motivo: um lote
mantém seus locks durante toda a transação. Um `update` ou `delete` especificando uma linha
que não existe faz todo o lote falhar com um 404. Um backend cujo driver não ofereça suporte
a atomicidade responde com `BATCH_UNSUPPORTED` em vez de executar um loop.

`idempotencyKey` e `returning` funcionam da mesma forma que em qualquer outra gravação.

No lado do servidor, `rebase.dataAsAdmin.batch([...])` e `context.data.batch([...])`
aceitam as mesmas operações e respondem com o mesmo resultado, na transação do próprio chamador.
`batch` é uma palavra reservada ali, assim como `table`: uma tabela cujo
acessador seja `batch` é acessada com `data.table("batch")`.
