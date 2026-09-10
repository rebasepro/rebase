---
sourceHash: 9c622813c5a4eca9
title: Escrita via REST
sidebar_label: Escrita via REST
description: Chaves de idempotência, escritas condicionais com ETag e If-Match, operações de campo, upserts em chave natural, return=minimal e lotes entre coleções.
---

Os verbos estão na página da [REST API](/docs/backend/api/). Esta página aborda as
cinco coisas que uma escrita pode *solicitar* além do seu verbo, e o endpoint que escreve
em várias coleções de uma só vez. Todas elas são opcionais por requisição: uma escrita
que não solicita nada disso se comporta exatamente como sempre se comportou.

## Escrita

Além dos verbos, as rotas de escrita aceitam cinco coisas que alteram o comportamento
da escrita. Todas as cinco são opcionais por requisição, portanto nada aqui altera o que
uma requisição que não as solicita faz.

### Idempotência

`Idempotency-Key: <uuid>` em qualquer escrita significa "se você já respondeu a esta
requisição exata, responda novamente em vez de executá-la duas vezes".

```bash
curl -X POST /api/data/orders \
     -H "Idempotency-Key: 1f0f…" \
     -d '{"total": 40}'
```

Um cliente que nunca recebe uma resposta não tem como saber se a escrita foi confirmada, então
ele tenta novamente — e, sem uma chave, o servidor não consegue distinguir essa nova tentativa de
uma segunda escrita legítima. Em uma tabela com ID atribuído pelo servidor, isso resulta em uma
linha duplicada, porque o ID inventado pelo cliente nunca foi usado.

Uma chave identifica **uma requisição**: ela registra o método, o caminho e o corpo para os quais
foi reivindicada. Reenvie essa requisição exata e sua resposta será reproduzida; envie uma
diferente sob a mesma chave e ela será recusada com `IDEMPOTENCY_KEY_REUSED` (422) em vez de ser
respondida com o resultado da primeira. Uma nova tentativa que chegue enquanto a primeira ainda
estiver em andamento recebe `IDEMPOTENCY_KEY_IN_PROGRESS` (409) — envie-a novamente assim que a
primeira for concluída.

Suportado em `POST`, `PATCH`, `DELETE`, em todas as três rotas `/bulk` e em `/_batch`.
As chaves duram 24 horas e têm escopo restrito ao chamador autenticado; uma requisição não
autenticada não possui um principal ao qual associar o escopo, portanto o cabeçalho é ignorado
nesse caso. Um backend incapaz de armazenar chaves ignora o cabeçalho em vez de recusar a escrita.

`DELETE` é o caso que vale a pena ler duas vezes. Ao ser repetida sem uma chave, a segunda
tentativa descobre que a linha não existe mais e responde `404` — o que um cliente que está
tentando novamente interpreta como uma falha permanente para uma exclusão que, na verdade,
foi bem-sucedida. Com uma chave, a resposta `204` é reproduzida.

### Concorrência otimista: `ETag` e `If-Match`

`GET /api/data/:slug/:id` retorna uma `ETag`. Envie-a de volta como `If-Match` em um
`PATCH` ou `DELETE` posterior e a escrita será recusada com `412` se a linha tiver sido
alterada nesse intervalo.

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

Sem isso, o ciclo leitura-modificação-escrita adota a regra do "último a escrever vence"
sobre tudo o que a segunda escrita não enviou: dois editores com um segundo de diferença têm
sucesso e a alteração do primeiro desaparece sem nenhum erro em lugar algum.

A tag é derivada de uma propriedade `date` com `autoValue: "on_update"` quando a coleção
declara uma — essa coluna já *é* uma versão — e a partir de um hash estável da linha caso
contrário. `If-Match: *` afirma apenas que a linha existe. Nada é escrito quando a pré-condição
falha.

### Operações de campo

O valor de uma propriedade no corpo de um `PATCH` pode ser uma operação sobre o valor
armazenado, em vez de um valor:

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
| `$push` | `array` | `array_append(col, …)`, ou uma concatenação jsonb |
| `$pull` | `array` | `array_remove(col, …)`, ou uma reagregação jsonb |
| `$merge` | `map` | `col || '…'::jsonb` (uma mesclagem **superficial**) |

A vantagem é a leitura que o chamador não precisa mais fazer. Expressar `views + 1` como um
valor significa lê-lo primeiro, e duas requisições que leem `4`, somam um e escrevem `5`
terminam em `5` — sem nada em nenhuma das respostas indicando que um incremento foi perdido.
Compilada diretamente na instrução, a operação aritmética ocorre dentro do bloqueio da linha
e não se perde.

Exatamente um operador por campo. Um operador em um tipo de propriedade para o qual não foi
definido, um `$operator` desconhecido ou um operando com formato incorreto resulta em um `400`
(`INVALID_FIELD_OPERATION`) indicando o nome do campo — um erro de digitação nunca é gravado
na coluna como um documento JSON. As operações se aplicam apenas a atualizações: em uma linha
que ainda não existe não há nada sobre o que operar, portanto elas são recusadas em `POST`,
em criações via `/bulk` e em upserts.

### Upsert em uma chave natural

`POST /api/data/:slug?on_conflict=email` escreve
`INSERT … ON CONFLICT (email) DO UPDATE` em vez de uma inserção simples. A rota em lote
aceita o mesmo destino que `onConflict` junto a `upsert: true`, assim como cada operação de
`upsert` de um lote.

```bash
curl -X POST '/api/data/users?on_conflict=email' \
     -d '{"email": "ada@example.com", "name": "Ada"}'

curl -X POST /api/data/users/bulk -d '{
  "rows": [ … ],
  "upsert": true,
  "onConflict": ["tenant_id", "slug"]
}'
```

O destino deve possuir uma garantia de unicidade com a qual o banco de dados possa fazer a
correspondência: a chave primária (o padrão quando nenhuma é especificada), uma propriedade
com `validation: { unique: true }` ou as colunas de um [índice](/docs/backend/indexes/) com
`unique: true`. Qualquer outra coisa resulta em um `400` (`INVALID_CONFLICT_TARGET`) listando
os destinos que realmente existem — caso contrário, o Postgres responderia *there is no
unique or exclusion constraint matching the ON CONFLICT specification* de dentro de uma
transação que já realizou trabalho.

Especificar um destino sem `upsert: true` em uma escrita em lote também resulta em `400`:
ignorá-lo silenciosamente transformaria uma importação que pode ser executada novamente em
uma que duplica dados.

Uma linha que já existia mantém seu timestamp `on_create`. Um conflito significa que a
criação da linha é um fato do passado, e uma reimportação noturna que redefinisse `createdAt`
em tudo o que tocasse arruinaria qualquer consulta de "novidades desta semana".

### `Prefer: return=minimal`

Toda escrita responde com a linha completa por padrão, que é o que contém as coisas decididas
pelo servidor — um ID serial, um carimbo de `autoValue` ou o que quer que `beforeSave` tenha
reescrito. Envie `Prefer: return=minimal` quando você não precisar de nada disso:

```bash
curl -X POST /api/data/events \
     -H "Prefer: return=minimal" \
     -d '{"kind": "page_view"}'
# → 204 No Content, Preference-Applied: return=minimal
```

Uma única escrita responde com `204`. Uma escrita via `/bulk` ou `/_batch` responde com `200`
contendo os **ids** em vez das linhas — em uma criação, o ID é a única coisa que o chamador
não consegue calcular, portanto descartá-lo significaria reler a tabela por alguma chave
natural para saber o que acabou de ser gravado. Uma chave de coluna única retorna como um
escalar; uma chave composta, como um objeto com suas colunas.

## Lotes entre coleções

`POST /api/data/_batch` realiza escritas em várias coleções em uma única transação, sob a
própria role do chamador, com a mesma validação, callbacks e segurança a nível de linha que a
rota de linha única de cada operação aplicaria.

```json
POST /api/data/_batch
{
  "operations": [
    { "op": "create", "collection": "orders",
      "values": { "total": 40 }, "ref": "order" },
    { "op": "create", "collection": "order_items",
      "values": { "order_id": { "$ref": "order.id" }, "sku": "A-1" } },
    { "op": "update", "collection": "stock",
      "id": "A-1", "values": { "count": { "$inc": -1 } } },
    { "op": "delete", "collection": "carts", "id": "c-9" }
  ]
}
```

```json
{
  "data": [ { "id": 31, "total": 40 }, { "id": 88, … }, { … }, null ],
  "meta": { "operations": 4 }
}
```

`op` pode ser `create`, `update`, `upsert` ou `delete`. `update` e `delete` precisam de um
`id`; `create`, `update` e `upsert` precisam de `values`; `upsert` pode especificar um destino
`onConflict` nos mesmos termos descritos acima. `data` é alinhado com `operations` — a linha
escrita para create, update ou upsert, e `null` para delete —, portanto um índice em um
corresponde ao índice no outro.

### `$ref`: apontando para uma linha criada pelo mesmo lote

Uma operação pode se identificar com `ref`, e qualquer operação posterior pode colocar
`{ "$ref": "<name>.<field>" }` onde iria um valor — em `values` em qualquer nível de
profundidade, ou como um `id`. Isso é resolvido para o campo correspondente da linha que a
operação nomeada gravou.

Esta é a razão pela qual o endpoint existe em vez de ser um loop: a chave estrangeira de um
registro filho não pode ser conhecida até que o pai seja inserido, então, sem isso, o pai e os
filhos teriam que ser requisições separadas — exatamente a sequência que pode ter um sucesso
parcial. Apenas referências **para trás** são resolvidas; referências para a frente são
recusadas antes da abertura da transação.

### O que é verificado antes de qualquer escrita

Formato, coleções desconhecidas, campos desconhecidos, restrições de valor, operações de campo,
destinos de conflito e a acessibilidade de `$ref` são todos validados antes da abertura da
transação. Um lote é tudo-ou-nada, e encontrar um erro de digitação na operação 40, de outra
forma, custaria o rollback das 39 operações anteriores.

Limitado ao mesmo número de operações de uma escrita em lote (1000 por padrão), já que um lote
retém seus bloqueios durante toda a transação. Um driver incapaz de tornar o lote atômico
responde com `BATCH_UNSUPPORTED` em vez de recorrer a um loop de escritas individuais — o que
não ofereceria nem a atomicidade nem o round trip único buscados ao usar um lote.

Um `update` ou `delete` especificando uma linha que não existe faz todo o lote falhar com `404`,
pelo mesmo motivo que uma escrita parcial é recusada em qualquer outro lugar: um estado
parcialmente aplicado não oferece uma recuperação adequada.

---
