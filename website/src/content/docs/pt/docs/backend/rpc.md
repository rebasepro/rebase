---
sourceHash: 690d0ebb30684b40
title: Funções SQL como RPC
sidebar_label: Funções SQL (RPC)
description: "Exponha uma função Postgres em POST /api/rpc/<name> com defineRpc: declarada por função, argumentos validados, executada como o chamador sob row-level security, e as públicas com rate limit."
---

Uma função SQL que você declara com `defineRpc` é disponibilizada em `POST /api/rpc/<name>`,
com seus argumentos nomeados como o corpo JSON. Ela é executada como o chamador, da mesma
forma que o `getSql(c)`: um chamador anônimo com a identidade anônima, um autenticado
como ele mesmo, de modo que a row-level security das tabelas se aplica dentro da função,
e uma função `SECURITY DEFINER` é executada como seu proprietário. Isso é o que o
`supabase.rpc('fn', args)` faz, sem precisar escrever um manipulador por função.

Apenas funções declaradas podem ser chamadas. Uma função que existe no banco de dados
e ninguém declarou responde com `404 RPC_NOT_FOUND`.

## Declarando uma função

As declarações ficam ao lado das tabelas, em `backend/schema/`, e o índice do schema
as exporta:

```typescript
// backend/schema/rpc.ts
import { defineRpc, json } from "@rebasepro/server/schema";

export const getPublicProposal = defineRpc("get_public_proposal", {
    access: "public",
    args: { token: json.string().required() }
});

export const myTrips = defineRpc("my_trips", {
    access: "authenticated",
    args: { from: json.date(), limit: json.number().validate({ integer: true, max: 100 }) }
});

export const bookTrip = defineRpc("book_trip", {
    access: "authenticated",
    write: true,
    args: { trip_id: json.number().required() }
});
```

```typescript
// backend/schema/index.ts
export * from "./rpc";
```

A função em si é o SQL que você cria no banco de dados, por exemplo, a partir de um arquivo
em `backend/sql/`:

```sql
CREATE OR REPLACE FUNCTION public.get_public_proposal(token text)
RETURNS public.proposals
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT * FROM public.proposals p WHERE p.share_token = get_public_proposal.token $$;
```

O nome é o nome da função como o Postgres o armazena (um `CREATE FUNCTION getProposal`
sem aspas é armazenado como `getproposal`), e também o segmento de URL. O `schema`
tem como padrão `"public"`. Assim como uma tabela, uma RPC definida em um arquivo
em `backend/schema/` que o índice não exporta impede a inicialização, assim como
um nome declarado duas vezes.

| Opção | Significado |
|---|---|
| `access` | Obrigatório. `"public"`: qualquer pessoa, autenticada ou não, sempre com rate limit. `"authenticated"`: qualquer chamador com uma identidade (uma sessão, uma sessão de convidado, uma chave de API, a chave de serviço); um anônimo recebe `401` |
| `args` | Os argumentos nomeados, um campo `json.*` por parâmetro SQL. Ausente: a função não recebe nenhum |
| `schema` | O schema do Postgres no qual a função reside. Padrão `"public"` |
| `write` | Executa a chamada em modo leitura-escrita. Desativado por padrão: a chamada é somente leitura e pode ser atendida por uma réplica de leitura |
| `rateLimit` | `{ limit, windowMs }` por chamador para esta função. Uma RPC pública sem isso é limitada a 120 chamadas por minuto |
| `description` | O que ela faz, para quem estiver lendo as declarações |

## Chamando uma função

A partir do SDK:

```typescript
const proposal = await rebase.rpc<Proposal | null>("get_public_proposal", { token });
const trips = await rebase.rpc<Trip[]>("my_trips", { limit: 20 });
```

Via HTTP:

```bash
curl -X POST https://your-app.example.com/api/rpc/get_public_proposal \
  -H "content-type: application/json" \
  -d '{"token": "f1c2…"}'
```

Uma chamada autenticada envia seu token como em qualquer outra rota. Os argumentos
podem ser tipados a partir da declaração, que o frontend importa apenas como tipo:

```typescript
import type { RpcArgs } from "@rebasepro/server/schema";
import type { myTrips } from "../../backend/schema/rpc";

const args: RpcArgs<typeof myTrips> = { limit: 20 };
const trips = await rebase.rpc<Trip[]>("my_trips", args);
```

## Argumentos

O corpo é verificado em relação a `args` antes que qualquer coisa chegue ao banco de dados. Uma chave
que `args` não nomeia, um argumento `.required()` ausente e um valor do tipo incorreto
(um número para `json.string()`, uma string que não é uma data para `json.date()`)
são recusados em conjunto com `400 VALIDATION_CONSTRAINT`, com cada violação identificando
seu campo (`filters.from`, `tags[2]`). As regras aceitas por uma coluna JSON também
se aplicam: `.validate({ min, max, pattern, … })`, `.oneOf([...])`.

Um argumento omitido não é passado, portanto, o `DEFAULT` da própria função SQL
se aplica; um `.default(value)` no campo o preenche em vez disso. Um argumento enviado
como `null` é passado como `NULL`.

Os valores chegam à função como um único parâmetro vinculado (bound parameter), um objeto JSON
que o Postgres converte para os tipos dos parâmetros da função (`json_to_record`), de modo que um
array se torna um `integer[]`, um objeto um `jsonb`, uma string ISO um `timestamptz`. Eles nunca são
gravados no texto da instrução. Um valor que o Postgres não consegue ler como o tipo do parâmetro
resulta em `400 RPC_INVALID_ARGUMENT`.

## O que ela responde

A resposta segue o tipo de retorno da função, assim como no PostgREST:

| A função retorna | A resposta |
|---|---|
| `SETOF <table>`, `TABLE (…)` | um array de linhas |
| `SETOF integer` (qualquer valor único) | um array de valores |
| um tipo de linha (row type) ou parâmetros `OUT` | a linha, ou `null` quando for `NULL` |
| um valor único (`bigint`, `text`, `jsonb`, …) | o valor |
| `void` | `null` |

Os valores são formatados da mesma forma que em `/api/data`: um `timestamptz` em RFC 3339, um
`bigint` como número quando couber.

## Como quem ela é executada

Cada chamada abre uma transação como o chamador, com a mesma identidade que a API
de dados usa, de modo que uma função `SECURITY INVOKER` (o padrão) visualiza exatamente as
linhas que as políticas do chamador concedem a ele, e `rebase.uid()` dentro dela é o chamador.
Um chamador anônimo de uma RPC pública executa como a identidade anônima: uma política que
exige um usuário oculta todas as linhas dele. Uma função `SECURITY DEFINER` é executada como
a role proprietária, que é como uma função entrega a um chamador anônimo uma linha por meio de
um token sem abrir a tabela para ele.

Uma chave de API que restringe o que pode fazer precisa de `data:read` para chamar uma RPC, ou
`data:write` para uma declarada com `write: true`, de forma irrestrita: uma função lê
quaisquer tabelas que ela precisar ler.

## Escritas

Uma chamada é executada como somente leitura, a menos que a RPC especifique `write: true`. Uma
função que insere, atualiza ou exclui sem isso falha com `500 RPC_READ_ONLY`. Uma operação de
escrita ainda passa pelas políticas de inserção e atualização das tabelas como o chamador.

## Rate limits

Toda RPC `public` é limitada por chamador (pelo ID do usuário quando autenticado, por endereço
IP caso contrário): 120 chamadas por minuto, a menos que declare `rateLimit`. A contagem reside
onde o backend armazena seus [rate limits de funções](/docs/backend/function-rate-limits/),
de modo que `REBASE_RATE_LIMIT_STORE=sql` a compartilha entre réplicas. Ao ultrapassá-lo, a
chamada responde `429 RATE_LIMITED` com `Retry-After`. As chamadas também consomem o limite da
API de dados do chamador. Uma RPC `authenticated` só é limitada quando declara `rateLimit`.

## Erros da função

`RAISE EXCEPTION 'This proposal has expired'` responde com `400 RPC_EXCEPTION`
com essa mensagem, além de `details.sqlState`, `detail` e `hint`.
`RAISE SQLSTATE 'PT404'` responde com o status após `PT`, como no PostgREST.
Todos os códigos de RPC estão listados em [Erros](/docs/backend/errors/#sql-functions-as-rpc).

## No runtime gerenciado e no Rebase Cloud

Nada a configurar: as declarações fazem parte de `backend/schema`, que o
`rebase build` inclui no bundle, e o runtime as lê onde lê as tabelas. A função em si
deve existir no banco de dados que o deployment utiliza.

Um backend ejetado que passa `schemaDir` as lê a partir do mesmo índice; um que passa suas
tabelas como valores passa suas RPCs da mesma forma:

```typescript
await initializeRebaseBackend({ app, server, tables, rpc: [getPublicProposal, myTrips], /* … */ });
```

As RPCs fazem parte da superfície de dados: um processo que não atende `/api/data`
(`REBASE_ROLE=functions`) não atende `/api/rpc`, e elas são executadas no banco de
dados padrão.

## O que ela não faz

- As chamadas são apenas `POST`; um `GET` em um nome declarado responde com `405`.
- Apenas parâmetros nomeados podem ser passados. Uma função cujos parâmetros não têm nomes,
  ou que retorna `SETOF record` sem parâmetros `OUT`, não pode ser chamada desta forma.
- Entre sobrecargas de um mesmo nome, a chamada alcança aquela cujos parâmetros nomeados
  aceitam exatamente os argumentos enviados; duas que aceitem ambos resultam em `500 RPC_AMBIGUOUS`.

Para lógica que não seja uma única função SQL, escreva uma [função personalizada](/docs/backend/custom-functions/)
e execute SQL nela com `getSql(c)`.
