---
sourceHash: 23be8a1faf1d5f49
title: Documentos JSON
sidebar_label: Documentos JSON
description: "Tipifique uma coluna jsonb com col.jsonb().$type<T>(), ou atribua a ela uma estrutura com json.* para que o servidor valide campos aninhados, aplique valores padrão e carimbos, encontre os arquivos referenciados por um documento e pesquise dentro dele."
---

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Uma coluna `jsonb` pode ser declarada de duas maneiras. `col.jsonb().$type<T>()` tipifica o documento
para o TypeScript e não informa nada ao servidor sobre ele. `col.jsonb(shape)` recebe uma
estrutura criada com `json.*`, que tipifica o documento da mesma forma e também
o descreve para o servidor.

```ts
import { defineTable, col, json } from "@rebasepro/server/schema";

export const pages = defineTable("pages", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),

        // Typed for TypeScript only.
        settings: col.jsonb().$type<{ theme?: "light" | "dark"; pinned?: boolean }>(),

        // Typed, and known to the server.
        seo: col.jsonb(json.object({
            title:        json.string().validate({ max: 60 }).required(),
            canonicalUrl: json.string().validate({ url: true }),
            noIndex:      json.boolean().default(false),
        })),
    },
    rls: "admin-only",
});
```

Com uma estrutura, o servidor:

- **valida** cada campo antes de uma escrita, com as mesmas regras aceitas por uma coluna;
- **aplica valores padrão** a campos ausentes na criação;
- **carimba** campos de data com `.onCreateNow()` / `.onUpdateNow()`, e campos de usuário com `.onCreateUser()` / `.onUpdateUser()`, em qualquer nível de profundidade;
- **executa** os hooks `.transform()` de cada campo;
- **encontra os arquivos** referenciados por um documento (`json.storage()`), para que a varredura
  de órfãos os contabilize;
- **pode pesquisar** dentro do documento: um campo `search` pode indicar um caminho como
  `"seo.title"` (consulte [Search](/docs/backend/search/)).

A estrutura é fornecida com o descritor da tabela, de modo que o CMS possa construir um formulário
para o documento sem precisar ser instruído sobre como fazê-lo. Em vez disso, `col.jsonb().$type<T>()`
obtém um editor JSON genérico.

## Builders

<span class="since-badge" data-since="0.31">Desde 0.31</span>

| Builder | Contém | Tipo TypeScript |
|---|---|---|
| `json.string()` | uma string | `string` |
| `json.number()` | um número | `number` |
| `json.boolean()` | um booleano | `boolean` |
| `json.date()` | um instante, como uma string ISO | `string` |
| `json.geopoint()` | um ponto na Terra | `{ latitude: number; longitude: number }` |
| `json.storage(options)` | o caminho de um arquivo armazenado | `string` |
| `json.object(fields, { additional? })` | um objeto com chaves conhecidas | um tipo de objeto: campos obrigatórios são required, os demais opcionais |
| `json.array(of)` | um array de uma única estrutura | um array do tipo de `of` |
| `json.oneOf(variants, { typeField?, valueField? })` | um bloco tipificado | uma união de `{ type: "<variant>"; value: <seu tipo> }` |
| `json.unknown()` | qualquer valor | `unknown` |

`json.storage()` aceita as mesmas opções que [`col.storage()`](/docs/schema/columns/#storage-columns).
`json.object(fields, { additional: true })` também aceita chaves que não foram nomeadas explicitamente.

## Modificadores

<span class="since-badge" data-since="0.31">Desde 0.31</span>

| Modificador | Em | O que faz |
|---|---|---|
| `.required()` | todos os campos | A chave deve estar presente no documento. Torna a chave obrigatória (não opcional) no tipo. |
| `.default(value)` | todos os campos | O valor gravado quando a chave está ausente na criação. |
| `.describe(text)` | todos os campos | O que o valor representa, para OpenAPI e MCP. |
| `.validate(rules)` | todos os campos | As regras aceitas por uma coluna do mesmo tipo: regras de texto em `json.string()`, regras numéricas em `json.number()`, limites de data em `json.date()`, contagens de itens, `uniqueItems` e `uniqueBy` em `json.array()`. Consulte [Validation](/docs/schema/columns/#validation). |
| `.transform({ beforeSave?, afterRead? })` | todos os campos | Hooks em nível de campo, executados no servidor. `value` é `T \| undefined`, a menos que `.required()` venha antes. |
| `.oneOf(values)` | `json.string()`, `json.number()` | Um conjunto fechado de valores aceitos, tipificado como a união deles. |
| `.onCreateNow()` | `json.date()` | O servidor grava a hora atual quando a linha é criada. |
| `.onUpdateNow()` | `json.date()` | O servidor grava a hora atual em cada escrita. |
| `.onCreateUser()` | `json.string()` | O servidor grava o ID do usuário atuante quando a linha é criada, ou `null` quando não há usuário atuando. |
| `.onUpdateUser()` | `json.string()` | O servidor grava o ID do usuário atuante em cada escrita. |
| `.userId()` | `json.string()` | O valor é o ID de um usuário: o painel oferece um seletor de usuários, e um chamador com permissão de escrita na tabela pode buscar usuários para preenchê-lo. Consulte [User columns](/docs/schema/columns/#user-columns). |

Os campos são opcionais, a menos que marcados com `.required()`. Uma chave obrigatória também é obrigatória
no tipo TypeScript:

```ts
import { col, json } from "@rebasepro/server/schema";

const address = json.object({
    street:  json.string().required(),
    city:    json.string().required(),
    country: json.string().validate({ length: 2, uppercase: true }).required(),
    notes:   json.string(),
});

// { street: string; city: string; country: string; notes?: string }
const shipping = col.jsonb(address);
```

### Carimbos dentro de um documento

Os carimbos funcionam em qualquer nível de profundidade de uma coluna JSON: campos de objeto, cada item de array e
o valor de um item `oneOf` cujo `type` identifica a variante. Em uma criação,
objetos ausentes no caminho até um carimbo são criados. Em uma atualização, apenas os
campos `onUpdate*` são carimbados, e apenas dentro de um documento que a atualização envia; um
documento que ela não envia mantém seu valor armazenado. Um carimbo substitui o que foi enviado
pela escrita, e o `.default()` de um campo o preenche primeiro.

## Arrays e blocos tipificados

<span class="since-badge" data-since="0.31">Desde 0.31</span>

`json.array(of)` é uma lista de uma única estrutura. `json.oneOf(variants)` é um bloco cuja
chave `type` indica qual é a variante e cuja chave `value` contém o
conteúdo dessa variante. Como itens de um array, ele representa a estrutura de um editor de blocos:

```ts
import { defineTable, col, json } from "@rebasepro/server/schema";

export const articles = defineTable("articles", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        body: col.jsonb(json.array(json.oneOf({
            paragraph: json.string(),
            image:     json.storage({ path: "articles/images/", accept: ["image/*"] }),
            quote:     json.object({ text: json.string().required(), author: json.string() }),
        }))),
    },
    rls: "admin-only",
});
```

O `body` de uma linha é então tipificado como um array de:

```ts
type Block =
    | { type: "paragraph"; value: string }
    | { type: "image"; value: string }
    | { type: "quote"; value: { text: string; author?: string } };
```

`json.array(json.object({...})).validate({ uniqueBy: ["sku"] })` recusa dois
itens que compartilham um valor em um campo nomeado (`unique_by`; valores ausentes e `null`
não são comparados, e um `$push` verifica os itens adicionados entre si).
`validate({ uniqueItems: true })` recusa dois itens iguais.
O topo de um documento pode ser um escalar ou um `json.oneOf`, e
`json.unknown()` é um campo para qualquer valor JSON; o servidor valida cada estrutura em
escritas via REST, MCP e sockets.

`typeField` e `valueField` renomeiam as duas chaves, para documentos que já usam
outros nomes: `json.oneOf({ … }, { typeField: "kind", valueField: "data" })`.

## `jsonb` ou `json`

<span class="since-badge" data-since="0.31">Desde 0.31</span>

`col.json()` aceita os mesmos argumentos que `col.jsonb()`. Ele armazena o texto exatamente como foi
fornecido, incluindo a ordem das chaves e espaços em branco, e não pode ser indexado ou pesquisado da
mesma forma que o `jsonb`. Use-o apenas quando o texto exato for importante; caso contrário, use
`col.jsonb()`.

Um ponto na Terra tem seu próprio construtor de coluna, `col.geopoint()`, armazenado como `jsonb`.
Uma lista de valores simples que o Postgres deve indexar muitas vezes funciona melhor como uma coluna
de array: `col.text().array()`. Listas aninhadas devem usar `jsonb`: `.array()` de
um array é recusado.

## Próximos passos

<span class="since-badge" data-since="0.31">Desde 0.31</span>

- [Columns](/docs/schema/columns/): os builders de colunas e suas regras de validação
- [Search](/docs/backend/search/): pesquisando caminhos dentro de um documento
- [Table hooks](/docs/collections/callbacks/): `.transform()` e os hooks em nível de tabela
