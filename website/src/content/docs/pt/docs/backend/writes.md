---
sourceHash: b1b5ef4227e130d2
title: Escrita via REST
sidebar_label: Escrita via REST
description: Chaves de idempotência, escritas condicionais com ETag e If-Match, operações de campo, upserts em chave natural, return=minimal e lotes entre tabelas.
---

Os verbos estão na página da [REST API](/docs/backend/api/). Esta página aborda as
cinco coisas que uma escrita pode *solicitar* além do seu verbo, e o endpoint que grava
em várias tabelas de uma só vez. Todas elas são opcionais por requisição: uma escrita que
não solicita nada disso se comporta exatamente como sempre se comportou.

## Escrita

Além dos verbos, as rotas de escrita aceitam cinco coisas que alteram a forma como a escrita
se comporta. Todas as cinco são opcionais por requisição, portanto nada aqui altera o
comportamento de uma requisição que não as solicita. As rotas aninhadas
(`/api/data/authors/42/posts`) executam o mesmo código de escrita que as rotas raiz,
portanto tudo nesta seção também se aplica a elas, exceto `?on_conflict=`.

O corpo de uma escrita deve ser um objeto JSON. `null`, um número, uma string ou um array
resulta em `400 BAD_REQUEST`.

<span class="since-badge" data-since="0.31">Desde 0.31</span> Uma escrita aceita os valores documentados pela API REST e nada mais — o
mesmo formato que uma leitura retorna: uma relação to-one (`belongsTo`, `hasOne`, um
`via` to-one) como a chave da linha relacionada ou `null`, uma relação to-many como uma lista de chaves
ou objetos `{ id, _pivot? }`, uma data como texto ISO, um vetor como uma lista de números,
um geoponto como `{ latitude, longitude }`, um `bytea` como uma
URL `data:application/octet-stream;base64,`. Uma relação to-one escrita como um
objeto (`{ "author": { "id": 5 } }`) resulta em `400 VALIDATION_INVALID_VALUE`
("'posts.author' links one 'authors' row: write that row's key …"), e o mesmo ocorre para um
vetor escrito como `{ "value": [...] }`. Em processo, `rebase.data` também aceita um
`Date` e um `Buffer` / `Uint8Array`.

Escrever uma relação `hasMany` ou `hasOne` a partir do pai (`{ "replies": [1, 2] }`
em uma thread) define a chave estrangeira nas linhas filhas, portanto, está sujeita às
regras dessa chave: uma coluna de chave que seja `.readOnly()`, `.private()` ou restrita por
`access.write` a recusa (`400 VALIDATION_EXCLUDED_FIELDS` /
`FIELD_NOT_WRITABLE`, "Writing 'replies' on 'threads' sets 'threadId' on the
rows of 'replies'"), assim como faria uma escrita da chave no filho.

Uma atualização não pode alterar a chave de uma linha. Um corpo que especifique a chave com outro
valor resulta em `400 KEY_IMMUTABLE`, antes da execução de qualquer hook e sem que nada seja gravado,
independentemente de como a atualização chegue: REST, o socket de tempo real, MCP ou o
`rebase.data` em processo. A chave que a linha já possui é aceita, da mesma forma que um
formulário que envia a linha inteira de volta a envia. Para mover uma linha para uma nova chave, crie-a
no novo destino e exclua a antiga.

### Idempotência

`Idempotency-Key: <uuid>` em qualquer escrita significa "se você já respondeu a esta
requisição exata, responda-a novamente em vez de executá-la duas vezes".

```bash
curl -X POST /api/data/orders \
     -H "Idempotency-Key: 1f0f…" \
     -d '{"total": 40}'
```

Um cliente que nunca recebe uma resposta não tem como saber se a escrita foi confirmada (committed), então
ele tenta novamente — e sem uma chave o servidor não consegue distinguir essa nova tentativa de uma segunda
escrita genuína. Em uma tabela com um id atribuído pelo servidor, isso resulta em uma linha duplicada,
pois o id que o cliente inventou nunca foi usado.

Uma chave identifica **uma requisição**: ela registra o método, o caminho, a query string
e o corpo para os quais foi reivindicada. Reenvie essa requisição exata e sua resposta será reproduzida (replayed); envie uma
diferente com a mesma chave e ela será recusada com `IDEMPOTENCY_KEY_REUSED`
(422) em vez de ser respondida com o resultado da primeira. Uma nova tentativa que chegue
enquanto a primeira ainda estiver em andamento recebe `IDEMPOTENCY_KEY_IN_PROGRESS` (409) —
envie-a novamente assim que a primeira for concluída. A query string conta porque ela
altera o que uma requisição faz: `DELETE /api/data/posts/5?hard=true` sob a chave de uma
exclusão lógica anterior é uma requisição diferente, não uma reprodução. A ordem dos seus
parâmetros não importa.

Respeitado em `POST`, `PATCH`, `DELETE`, em todas as três rotas `/bulk` e em `/_batch`.
As chaves duram 24 horas e têm escopo restrito ao chamador autenticado; uma
requisição não autenticada não possui um principal ao qual associar o escopo, portanto o cabeçalho é
ignorado nesse caso. Um backend que não consiga armazenar chaves ignora o cabeçalho em vez de
recusar a escrita.

`DELETE` é o caso que vale a pena ler duas vezes. Reexecutada sem uma chave, a segunda
tentativa descobre que a linha sumiu e responde `404` — o que um cliente que está tentando novamente interpreta como
uma falha permanente para uma exclusão que, na verdade, teve sucesso. Sob uma chave, ela reproduz
o `204`.

### Concorrência otimista: `ETag` e `If-Match`

`GET /api/data/:slug/:id` retorna um `ETag`, assim como o `GET` aninhado de
linha única. Envie-o de volta como `If-Match` em um `PATCH` ou `DELETE` posterior e a escrita será
recusada com `412` se a linha tiver sido alterada nesse meio tempo.

Um `PATCH` bem-sucedido responde com o `ETag` da versão que gravou,
de modo que a próxima escrita condicional não precise de uma leitura prévia. A tag também acompanha um
`204` respondido para `Prefer: return=minimal`, e uma resposta reproduzida para uma
`Idempotency-Key` carrega a mesma tag da primeira. Uma assinatura de linha em tempo real
carrega a mesma tag em cada frame (consulte [Tempo real](/docs/backend/realtime/)).

```bash
# read
curl -i /api/data/docs/d1
# → ETag: "9f2c…"

# write, conditionally
curl -X PATCH /api/data/docs/d1 \
     -H 'If-Match: "9f2c…"' \
     -d '{"title": "Second draft"}'
# → 412 PRECONDITION_FAILED if somebody else edited it first
```

Sem isso, o fluxo de leitura-modificação-escrita segue o princípio de que o último a gravar vence sobre tudo o que a segunda
escrita não enviou: dois editores com um segundo de diferença têm sucesso e a alteração do primeiro
se perde sem nenhum erro em lugar algum.

A tag é derivada de uma coluna de timestamp com `.onUpdateNow()` quando a
tabela declara uma — essa coluna já *é* uma versão — e de um hash estável
da linha caso contrário. `If-Match: *` assegura apenas que a linha existe.
Nada é gravado quando a pré-condição falha.

O formulário de registro da administração salva com `If-Match`: um salvamento feito contra uma versão
que alguém substituiu entretanto é recusado, o formulário informa isso, e a edição permanece no
formulário, sofrendo rebase para a nova versão com os campos conflitantes marcados.

A tag é comparada dentro da própria transação de escrita, após a linha ser
bloqueada. Duas escritas que carregam a mesma tag não podem passar ao mesmo tempo: a segunda espera
a primeira ser confirmada, lê o que ela gravou e é recusada com `412`.

### Operações de campo

O valor de uma propriedade no corpo de um `PATCH` pode ser uma operação sobre o valor
armazenado em vez de um valor simples:

```bash
curl -X PATCH /api/data/posts/p1 -d '{
  "views": { "$inc": 1 },
  "tags":  { "$push": "featured" },
  "meta":  { "$merge": { "seen": true } }
}'
```

| Operador | Tipo de propriedade | Torna-se |
|----------|---------------------|----------|
| `$inc` | `number` | `SET col = COALESCE(col, 0) + n` |
| `$push` | `array` | `array_append(col, …)` ou uma concatenação jsonb |
| `$pull` | `array` | `array_remove(col, …)` ou uma reagregação jsonb |
| `$merge` | `map` | `col || '…'::jsonb` (um merge **superficial**) |

O objetivo é evitar a leitura que o chamador não precisa mais fazer. Expressar `views + 1` como um
valor significa lê-lo primeiro, e duas requisições que leem `4`, somam um e
escrevem `5` terminam em `5` — sem que nada em nenhuma das respostas indique que um incremento foi
perdido. Compilada na instrução, a aritmética ocorre dentro do bloqueio da linha
e não se perde.

Exatamente um operador por campo. Um operador em um tipo de propriedade para o qual não está definido,
um `$operator` desconhecido ou um operando com formato incorreto resulta em um `400`
(`INVALID_FIELD_OPERATION`) indicando o campo — um erro de digitação nunca é gravado na
coluna como um documento JSON.

O `map` é a exceção, porque seu valor *é* um documento JSON e pode conter
chaves `$` próprias — o `$schema` e o `$id` de um JSON Schema, ou um documento exportado de outro banco de dados. Em um
`map`, apenas um objeto com exatamente uma chave que seja um dos operadores acima é
uma operação; qualquer outro objeto é armazenado como enviado, com chaves `$` e tudo. Assim,
`{ "meta": { "$merge": { … } } }` faz o merge, e
`{ "meta": { "$schema": "https://json-schema.org/draft/2020-12/schema" } }` é
armazenado. Portanto, um operador com erro de digitação em um `map` também é armazenado; em todos os outros
tipos, ele ainda é recusado. O cliente offline não possui um schema para diferenciar um `map` de
qualquer outra coisa, portanto, enquanto estiver offline, ele recusa tal valor como uma operação de campo;
envie-o assim que a conexão for restabelecida.

As operações se aplicam apenas a atualizações: sobre uma linha que
ainda não existe não há nada sobre o que operar, portanto elas são recusadas em
`POST`, em criações via `/bulk` e em upserts.

Uma operação responde à `validation` da propriedade da mesma forma que um valor. Elementos
inseridos via push são avaliados pelas regras de elemento, chaves mescladas pelas propriedades do map,
e o valor que uma operação *produz* pelos limites declarados: `min`,
`max`, `moreThan`, `lessThan`, `positive` e `negative` de um número, ou os itens `min` e
`max` de um array. Essa última verificação é uma condição no mesmo `UPDATE`, não uma leitura
prévia. Em `stock: { validation: { min: 0 } }`, `{ "stock": { "$inc": -1 } }`
tem sucesso enquanto o estoque for pelo menos 1 e é recusado em 0 com o `400`
(`VALIDATION_CONSTRAINT`) que `{ "stock": -1 }` recebe, indicando o campo e o
limite. Dois decrementos concorrentes em um estoque de 1 não podem ambos ser bem-sucedidos, porque
o segundo é avaliado em relação à linha confirmada pelo primeiro. Um número não definido conta
como `0` e um array não definido como vazio. Uma operação recusada não grava nada, nem mesmo
os valores simples ao lado dela no corpo. Como a verificação faz parte da
instrução, ela também se aplica a gravações em processo por meio de `rebase.data`, que ignoram
a validação em nível de requisição.

### Upsert em uma chave natural

`POST /api/data/:slug?on_conflict=sku` insere a linha ou atualiza aquela
que já possui esse SKU, em vez de falhar ao encontrá-lo. A rota bulk aceita
o mesmo destino que `onConflict` junto a `upsert: true`, assim como cada
operação de `upsert` em um lote.

```bash
curl -X POST '/api/data/products?on_conflict=sku' \
     -d '{"sku": "LAMP-01", "name": "Desk lamp", "price": 39}'

curl -X POST /api/data/products/bulk -d '{
  "rows": [ … ],
  "upsert": true,
  "onConflict": ["tenant_id", "sku"]
}'
```

O destino deve conter uma garantia de unicidade com a qual o banco de dados possa fazer correspondência: a
chave primária (o padrão quando nenhuma é especificada), uma coluna declarada
como `.unique()`, ou as colunas de um [índice](/docs/backend/indexes/) com `unique: true`.
Qualquer outra coisa resulta em um `400`
(`INVALID_CONFLICT_TARGET`) listando os destinos que de fato existem — caso contrário, o Postgres
responderia *there is no unique or exclusion constraint matching the ON
CONFLICT specification* de dentro de uma transação que já realizou trabalho.

Especificar um destino sem `upsert: true` em uma escrita bulk também resulta em `400`:
ignorá-lo silenciosamente transformaria uma importação reexecutável em uma importação que gera duplicatas.

`?on_conflict=` é recusado em uma criação aninhada (`INVALID_CONFLICT_TARGET`). A
linha correspondente poderia residir sob outro registro pai, e o upsert a moveria
para baixo deste. Envie o upsert para a rota própria da tabela.

Um upsert que encontra uma linha armazenada é uma atualização dela. O servidor lê a linha
indicada pela chave, dentro do escopo do chamador e da transação da escrita, e
executa a atualização comum: os campos no corpo são gravados, os omitidos
mantêm seus valores armazenados em vez de serem redefinidos para o seu `.default()`,
`beforeSave` e `afterSave` visualizam `status: "existing"` com os valores anteriores,
e o histórico registra uma atualização. Uma linha que a leitura não conseguiu ver, ou uma inserida
concorrentemente, ainda é capturada por `ON CONFLICT … DO UPDATE`, que define apenas o que
o corpo e os hooks escreveram, além dos registros `.onUpdateNow()`. Uma chave que referencia uma linha
fora do escopo de `beforeQuery` do chamador responde com `404`. Uma chave que pertence a uma
linha na [lixeira](/docs/collections/soft-delete/) responde com `409 ROW_IN_TRASH`
e não grava nada: restaure a linha primeiro, ou purgue-a.

Uma linha que já existia mantém seu timestamp `.onCreateNow()` e seu
criador `.onCreateUser()`. Um conflito significa que a criação da linha é um fato do
passado, e uma reimportação noturna que redefinisse `createdAt` em tudo o que tocasse
arruinaria qualquer consulta de "novos nesta semana".

#### Não disponível na tabela de autenticação

<span class="since-badge" data-since="0.31">Desde 0.31</span>

A tabela de autenticação (aquela declarada com `defineAuthTable`) recusa um upsert por qualquer
meio — `?on_conflict=`, `/bulk` com `upsert: true`, uma operação de `upsert` no `_batch`,
o `upsert()` do SDK e o socket de tempo real — com um `400`
(`INVALID_CONFLICT_TARGET`). Suas linhas são os usuários, e criar um e
alterar um seguem regras diferentes: uma criação gera o hash da senha, normaliza
o e-mail, executa `onCreateUser` e envia o convite, enquanto uma atualização não pode
rebaixar o último administrador. Um upsert só descobre qual dos dois é dentro da
escrita, tarde demais para aplicar qualquer uma das regras. Crie usuários com um `POST` comum e altere-os
com `PATCH`.

### `Prefer: return=minimal`

Por padrão, toda escrita responde com a linha completa, que é o que carrega as
definições feitas pelo servidor — um id serial, um carimbo `.onCreateNow()`, tudo o que o
`beforeSave` reescreveu. Envie `Prefer: return=minimal` quando não precisar de nada disso:

```bash
curl -X POST /api/data/events \
     -H "Prefer: return=minimal" \
     -d '{"kind": "page_view"}'
# → 204 No Content, Preference-Applied: return=minimal
```

Uma escrita única responde `204`. Uma escrita `/bulk` ou `/_batch` responde `200`
contendo os **ids** em vez das linhas — em uma criação, o id é a única coisa
que o chamador não pode calcular, portanto descartá-lo significaria reler a tabela por
meio de alguma chave natural para descobrir o que acabou de ser gravado. Uma chave de coluna única vem
de volta como um escalar; uma chave composta, como um objeto de suas colunas.

## Lotes entre tabelas

<span class="since-badge" data-since="0.31">Desde 0.31</span> Cada operação indica sua tabela como `table` (anteriormente era `collection`).

`POST /api/data/_batch` grava em várias tabelas em uma única transação, sob a
própria role do chamador, com a mesma validação, hooks e segurança em nível de linha
que a rota de linha única de cada operação aplicaria.

```json
POST /api/data/_batch
{
  "operations": [
    { "op": "create", "table": "orders",
      "values": { "total": 40 }, "ref": "order" },
    { "op": "create", "table": "order_items",
      "values": { "order_id": { "$ref": "order.id" }, "sku": "A-1" } },
    { "op": "update", "table": "stock",
      "id": "A-1", "values": { "count": { "$inc": -1 } } },
    { "op": "delete", "table": "carts", "id": "c-9" }
  ]
}
```

```json
{
  "data": [ { "id": 31, "total": 40 }, { "id": 88, … }, { … }, null ],
  "meta": { "operations": 4 }
}
```

`op` é `create`, `update`, `upsert` ou `delete`. `update` e `delete` precisam de um
`id`; `create`, `update` e `upsert` precisam de `values`; `upsert` pode especificar um
destino `onConflict` nos mesmos termos descritos acima. `data` é alinhado com
`operations` — a linha gravada para um create, update ou upsert, e `null` para um
delete — de modo que um índice em um corresponde ao mesmo índice no outro.

### `$ref`: apontando para uma linha criada pelo mesmo lote

Uma operação pode se identificar com `ref`, e qualquer operação posterior pode utilizar
`{ "$ref": "<name>.<field>" }` onde um valor for esperado — em `values` em qualquer nível de profundidade, ou
como um `id`. Ele é resolvido para aquele campo da linha gravada pela operação nomeada.

Essa é a razão pela qual o endpoint existe em vez de ser um loop: a chave
estrangeira de um filho não pode ser conhecida até que o pai tenha sido inserido, portanto, sem isso,
o pai e os filhos teriam que ser requisições separadas — precisamente a
sequência que pode ter sucesso pela metade. Apenas referências para trás (**backward**) são resolvidas; uma
referência futura é recusada antes da abertura da transação.

### O que é verificado antes que qualquer coisa seja gravada

Estrutura, tabelas desconhecidas, campos desconhecidos, restrições de valor, operações de campo,
alvos de conflito e o alcance do `$ref` são todos decididos antes da abertura
da transação. Um lote é do tipo tudo-ou-nada, e encontrar um erro de digitação na operação 40
custaria, de outra forma, o rollback das 39 gravações anteriores.

Limitado ao mesmo número de operações que uma escrita bulk (1000 por padrão), já
que um lote mantém seus bloqueios durante toda a transação. Os hooks de cada operação
são executados dentro dela, um após o outro, portanto o custo de um hook lento é pago uma vez por linha com a
transação aberta: 100 linhas cujo `beforeSave` aguarda 50 ms mantêm uma conexão,
e os bloqueios de cada linha gravada até então, por 5,3 s. O mesmo vale para uma
escrita `/bulk`. Consulte [Um hook retém uma conexão](/docs/collections/context-data-api/#a-hook-holds-a-connection). Um driver que não puder
tornar o lote atômico responde com `BATCH_UNSUPPORTED` em vez de recorrer a um loop
de escritas individuais — o que não forneceria nem a atomicidade nem o round trip
único pelos quais um lote é utilizado.

Um `update` ou `delete` especificando uma linha que não existe falha todo o lote
com um `404`, pelo mesmo motivo que uma escrita parcial é recusada em qualquer outro lugar:
aplicado pela metade é um estado do qual não há uma boa recuperação.
