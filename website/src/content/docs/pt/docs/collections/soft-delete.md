---
sourceHash: 035955ac366c306b
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

Um `DELETE` **real** é feito com `?hard=true` na chamada de exclusão. Ele precisa exatamente
da mesma permissão que uma exclusão comum: é o mesmo verbo, e restringi-lo
separadamente criaria uma segunda superfície de controle de acesso para uma única operação. O que
muda é se a linha pode retornar ou não. Apenas o valor literal `true` ou `1` significa
sim; um erro de digitação resulta em um 400, porque quem fez a chamada pediu para expurgar e
recebeu um soft delete acredita que os dados foram apagados.

## Próximos Passos

- **[Definindo Collections](/docs/collections)** — onde o `softDelete` é declarado
- **[API REST](/docs/backend/api)** — os endpoints de exclusão e consulta aos quais esses parâmetros pertencem
- **[Regras de Segurança (RLS)](/docs/collections/security-rules)** — quem tem permissão para excluir uma linha

---
