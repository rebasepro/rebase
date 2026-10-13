---
sourceHash: dc27c5a35221e71c
title: Soft delete
sidebar_label: Soft delete
description: Transforme a exclusão em um timestamp, oculte linhas marcadas de todas as leituras e restaure-as com uma atualização comum.
---

## O que muda

Com o `softDelete` ativado, uma exclusão **marca uma coluna em vez de remover a linha**,
e cada leitura filtra as linhas marcadas. Nada mais na operação
muda: a mesma permissão é necessária, o `beforeDelete` ainda pode vetá-la e
o `afterDelete` ainda é disparado. Do ponto de vista de quem fez a chamada, a linha foi excluída;
como a tabela registra isso é responsabilidade dessa flag.

```typescript
import { defineCollection } from "@rebasepro/cms-types";

const invoices = defineCollection({
    slug: "invoices",
    name: "Invoices",
    table: "invoices",
    softDelete: true,
    properties: {
        reference: { name: "Reference", type: "string" },
        deletedAt: { name: "Deleted at", type: "date", admin: { readOnly: true } }
    }
});
```

`true` usa `deletedAt` (coluna `deleted_at`). A forma de objeto a renomeia:
`softDelete: { field: "archivedAt" }`.

:::caution[A declaração da coluna é sua responsabilidade]
A flag define o que uma coluna *significa*; ela não cria uma coluna do nada.
Uma collection que ativa o `softDelete` sem declarar essa propriedade `date`
é recusada na inicialização — deliberadamente cedo, pois a alternativa seria a falha
ocorrer quando alguém tentasse remover uma linha.
:::

Apenas Postgres, assim como [busca](/docs/backend/search) e
[índices](/docs/backend/indexes).

## O que uma leitura vê

Linhas marcadas ficam ocultas por padrão de `find`, `findById`, `count`,
agregações, refetch em tempo real e desta collection quando carregada através de
uma relação. Esse comportamento padrão é o objetivo: o código escrito antes da existência da flag continua
funcionando, e ninguém precisa se lembrar de filtrar.

Dois parâmetros de consulta tornam isso visível:

| Parâmetro | Responde |
|-----------|----------|
| `?deleted=include` | Linhas ativas **e** marcadas |
| `?deleted=only` | Apenas linhas marcadas — a visualização da lixeira |

Qualquer outro valor resulta em um 400 em vez de um fallback silencioso. Se `?deleted=true`
ocultasse silenciosamente todas as linhas excluídas, pareceria que funcionou e
responderia à pergunta oposta.

## Restaurando e excluindo de verdade

Uma **restauração** é uma atualização comum definindo o campo de volta para `null`. Não
há verbo especial, porque não há estado especial — a linha nunca saiu do lugar.
Via REST, é um `PATCH` — individual, `/bulk` ou `_batch` — cujo corpo define o
campo como `null`:

```bash
curl -X PATCH /api/data/invoices/7 -d '{"deletedAt": null}'
```

Essa atualização é a única que alcança uma linha marcada. Qualquer outra edição dela responde
`404`, como a linha responde a toda leitura padrão; restaure-a primeiro.

O inverso não é uma atualização. Definir o campo com um valor é recusado com `400`
`FIELD_NOT_WRITABLE` — exclua a linha em vez disso — de modo que a permissão `delete`,
`beforeDelete` e `afterDelete` sempre se aplicam a ela. Um upsert pode criar uma linha
que já esteja marcada, mas nunca marca uma que já estava armazenada.

Tampouco um upsert escreve em uma linha na lixeira: quando sua chave pertence a uma
linha marcada, ele é recusado com `409` `ROW_IN_TRASH` e nada é escrito.
Restaure a linha primeiro, ou a expurgue com `?hard=true` e faça o upsert novamente. Na 0.23
o upsert escreve seus valores na linha oculta e responde `201`.

Uma exclusão por um caminho muitos-para-muitos, como `DELETE /api/data/posts/1/tags/5`,
remove o vínculo do post 1 com a tag. Ela não faz soft delete da tag, que outros
posts ainda usam.

Um `DELETE` **real** é feito com `?hard=true` na chamada de exclusão. Ele precisa exatamente
da mesma permissão que uma exclusão comum: é o mesmo verbo, e restringi-lo
separadamente criaria uma segunda superfície de controle de acesso para uma única operação. O que
muda é se a linha pode retornar ou não. Apenas o valor literal `true` ou `1` significa
sim; um erro de digitação resulta em um 400, porque quem fez a chamada pediu para expurgar e
recebeu um soft delete acredita que os dados foram apagados.

## Pelo SDK

O cliente tipado alcança a lixeira por meio de `trash` em cada collection. Ele envia
as requisições acima: `?deleted=only` nas leituras, a atualização para `null` em uma
restauração e `?hard=true` em uma exclusão definitiva.

```typescript
const trashed = await client.data.invoices.trash.find({ limit: 20 });
const howMany = await client.data.invoices.trash.count();

await client.data.invoices.trash.restore(7);       // PATCH { deletedAt: null }
await client.data.invoices.trash.restoreMany([8, 9]);

await client.data.invoices.trash.purge(7);         // DELETE ?hard=true
await client.data.invoices.trash.purgeMany([8, 9]);
```

`trash.find` e `trash.count` aceitam os mesmos parâmetros que `find` e `count`.
Uma restauração define `deletedAt` a menos que você nomeie o campo: uma collection declarada
com `softDelete: { field: "archivedAt" }` restaura com
`trash.restore(7, { field: "archivedAt" })`. O cliente não consegue ler o nome do
campo a partir do servidor.

Use `trash` em uma collection que declara `softDelete`. Em uma que não declara,
o servidor ignora `?deleted=`, então `trash.find` retorna as linhas ativas e
`trash.purge` é uma exclusão comum.

O código do servidor tem o mesmo `trash`: `context.data.invoices.trash` em um callback,
e `rebase.data.invoices.trash` em uma função ou em um cron. Ele lê e exclui
definitivamente por meio do driver, com os privilégios do chamador, como o restante de
[`context.data`](/docs/collections/context-data-api) faz.

Com o [offline](/docs/sdk/offline) habilitado, a lixeira nunca é armazenada em cache e nada
nela entra na fila. Cada chamada precisa do servidor e falha com o erro `OFFLINE`
sem ele. Uma linha restaurada entra no banco de dados local, e uma excluída definitivamente sai dele.

## Próximos Passos

- **[Definindo Collections](/docs/collections)** — onde o `softDelete` é declarado
- **[API REST](/docs/backend/api)** — os endpoints de exclusão e consulta aos quais esses parâmetros pertencem
- **[Regras de Segurança (RLS)](/docs/collections/security-rules)** — quem tem permissão para excluir uma linha
