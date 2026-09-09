---
sourceHash: 17ca6f6a285eea43
title: Índices
sidebar_label: Índices
description: Declare índices comuns do Postgres em uma coleção — btree, GIN e BRIN, parciais, compostos, de cobertura e únicos — e por que um índice manual costumava desaparecer.
---

Uma coleção declara os índices de que suas consultas precisam, no mesmo arquivo das
propriedades que eles cobrem:

```typescript
import type { PostgresCollectionConfig } from "@rebasepro/types";

const posts: PostgresCollectionConfig = {
    slug: "posts",
    table: "posts",
    name: "Blog posts",
    properties: {
        id: { name: "ID", type: "string", isId: "uuid" },
        title: { name: "Title", type: "string" },
        status: { name: "Status", type: "string", enum: { draft: "Draft", published: "Published" } },
        publish_date: { name: "Publish date", type: "date" }
    },
    indexes: [
        {
            on: ["status", { prop: "publish_date", direction: "desc" }],
            reason: "admin list: filter by status, newest first"
        }
    ]
};
```

Apenas Postgres. Em outro mecanismo, a chave é recusada na inicialização em vez de
ser ignorada silenciosamente.

## Por que isso existe

O gerador de DDL sempre emitiu instruções de índice para exatamente duas coisas,
e ambas são estruturas que uma *funcionalidade* possui, em vez de consultas que você escreveu: o
índice GIN por trás de um [bloco `search`](/docs/backend/search), e o índice ANN por trás
de uma [propriedade `vector`](/docs/sdk/aggregates-and-search#the-index). O caso comum — o btree
por trás de uma cláusula `where` — não tinha nenhum local de declaração.

Portanto, a única maneira de ter um era escrevê-lo manualmente. E:

:::caution[Se você tiver índices manuais em uma tabela gerenciada pelo Rebase]
O `rebase db push` é declarativo. Um índice em uma tabela gerenciada que estivesse ausente
do `schema.sql` era considerado um desvio (drift), e o Atlas planejava um `DROP INDEX` para ele —
o que não está na lista de instruções destrutivas, portanto, a aplicação autoaprovada o
removia sem perguntar. Todo índice manual em uma tabela gerenciada estava com os dias contados.

Isso foi corrigido pela regra de propriedade abaixo: um índice que o Rebase não criou agora
é excluído do diff pelo nome e nunca é tocado. Declarar seus índices manuais ainda é
o melhor estado final — um índice declarado é criado em um banco de dados novo e em cada
tenant, enquanto um manual não é —, mas nada os removerá enquanto isso.
:::

## A estrutura

| Campo | Tipo | Descrição |
|-------|------|-------------|
| `on` | `(string \| IndexKey)[]` | **Obrigatório.** As colunas-chave, em ordem. 1 a 5 entradas. |
| `reason` | `string` | **Obrigatório.** Por que este índice existe, em uma linha. |
| `using` | `"btree" \| "gin" \| "brin"` | Método de acesso. O padrão é `btree`. |
| `where` | `IndexPredicate` | Torna o índice parcial — ele cobre apenas as linhas que correspondem a isso. |
| `unique` | `boolean` | Apenas btree. Uma garantia de unicidade composta. |
| `include` | `string[]` | Apenas btree. Colunas de carga útil (payload) carregadas para index-only scans. |

### `on` recebe chaves de propriedade, nunca nomes de coluna

Esta é a pegadinha. Uma relação `belongsTo` é compilada para sua `localKey` resolvida,
portanto, a propriedade `author` é a coluna `author_id`:

```typescript
// Correct — `author` is the relation property.
{ on: ["author"], reason: "an author's posts, and the ON DELETE cascade" }
```

Escrever `author_id` aqui funcionaria para a maioria das propriedades e silenciosamente não indexaria
nada para uma chave estrangeira, que é justamente a que as pessoas procuram. O Postgres não
indexa uma coluna de chave estrangeira para você — sem esse índice, tanto "listar as postagens
deste autor" quanto a deleção em cascata (`ON DELETE`) são varreduras sequenciais (sequential scans).

Uma relação `hasMany` ou muitos-para-muitos não possui coluna nesta tabela e é
recusada, devendo ser declarada na coleção que de fato possui a chave estrangeira.

### A ordem importa, e apenas um subconjunto inicial é utilizável

O Postgres pode usar um subconjunto inicial das colunas-chave, portanto
`["ownerId", "createdAt"]` atende a uma consulta que filtra por `ownerId`, e a uma
que filtra por ambos, e **nunca** a uma que filtra apenas por `createdAt`.

`direction` e `nulls` só justificam seu uso quando o `ORDER BY` de uma consulta mistura
direções. Um índice `DESC` isolado é redundante com seu par `ASC` — o Postgres
varre uma btree de trás para frente com a mesma rapidez —, de modo que um único índice atende ao filtro *e* à
ordenação no exemplo no topo desta página.

```typescript
{ on: [{ prop: "createdAt", direction: "desc", nulls: "last" }], reason: "…" }
```

Escrever o padrão do Postgres explicitamente não custa nada: o nome derivado gera o hash
da ordem *efetiva*, portanto adicionar `direction: "asc"` a uma coluna que já era
ascendente não é uma redefinição e não reconstrói nada.

O limite é de cinco chaves. O Postgres permite trinta e duas; além de quatro, as colunas finais
tornam-se peso morto a cada escrita, e a declaração costuma ser alguém esperando que uma
consulta fique mais rápida por acúmulo. Colunas de carga útil que não são pesquisadas pertencem a
`include`, que não conta para o limite.

### `where` é estruturado, não SQL

```typescript
{
    on: ["publish_date"],
    where: { prop: "status", op: "=", value: "published" },
    reason: "public feed: published posts by date"
}
```

O índice então armazena apenas linhas publicadas e permanece pequeno à medida que os rascunhos se acumulam.

Os operadores são `=`, `!=`, `<`, `<=`, `>`, `>=`, `in`, `is null` e
`is not null`, combinados com `and`:

```typescript
{
    on: ["assignee"],
    where: {
        and: [
            { prop: "status", op: "in", value: ["open", "in_progress"] },
            { prop: "archived_at", op: "is null" }
        ]
    },
    reason: "the open-work queue, which is a fraction of the table"
}
```

Deliberadamente não há `or`. Um predicado OR quase sempre significa que o índice
não deveria ser parcial de forma alguma; se você realmente precisar de um, declare dois índices.

Um predicado é estruturado em vez de uma string porque uma string não poderia ser
verificada em relação às propriedades da coleção, não poderia gerar uma impressão digital (fingerprint) sem
colocar seu próprio texto no nome do índice — portanto, reformatá-la renomearia um
índice em produção — e seria o único lugar onde o chamador usaria uma classe de operadores de extensão
que o planejador não pode reproduzir.

### `unique` é apenas para compostos

A unicidade de coluna única é `validation.unique` na propriedade, e declará-la
aqui também é recusado em vez de ser aceito como um sinônimo.
`validation.unique` é compilado para um `UNIQUE` inline cujo índice de suporte
é nomeado pelo Postgres — e não pelo Rebase — como `<table>_<column>_key`.

```typescript
{ on: ["workspaceId", "slug"], unique: true, reason: "one slug per workspace" }
```

### `include` proporciona um index-only scan

Colunas de carga útil vivem nas páginas folha: não são pesquisáveis, não são ordenadas, e
evitam uma busca na tabela (heap fetch) ao custo de um índice maior. Elas não podem se sobrepor a `on`.

```typescript
{ on: ["status"], include: ["title"], reason: "the status sidebar counts, without touching the heap" }
```

### `using`

`btree` (o padrão) atende a igualdade, intervalo, `ORDER BY` e unicidade.

`gin` é para contenção sobre uma propriedade `array` ou um `map` JSONB. `brin` é para uma
coluna naturalmente ordenada em uma tabela somente de inserção (append-only) — minúsculo e inútil no momento
em que as linhas começarem a chegar fora de ordem. Nenhum dos dois tem ordenação, portanto `direction` e
`nulls` não são representáveis neles em vez de serem recusados mais tarde pelo Postgres.

Não há `gist` nem `hash`: toda classe interessante de operador gist vem em uma
extensão, e índices hash não podem ser únicos, compostos ou ordenados. Essa
restrição é o que mantém todo o modelo no caminho do Atlas — o `rebase db push`
materializa o estado desejado em um banco de dados temporário limpo para realizar o planejamento, e
`CREATE EXTENSION` não pode entrar nesse arquivo. **A busca por trigramas é
[`search:`](/docs/backend/search); ANN é uma
[propriedade `vector`](/docs/sdk/aggregates-and-search#the-index).** Um índice que necessite de
`gin_trgm_ops` ou `vector_cosine_ops` é recusado no momento da compilação em vez de ser
emitido para falhar mais tarde em um banco de dados que você nunca viu.

### `reason` é obrigatório

É o único campo obrigatório sem nenhum SQL por trás.

Um índice é a única coisa que uma configuração do Rebase pode declarar que custa dinheiro para sempre
e cujo benefício é invisível na configuração. O motivo é o que é exibido
ao lado de "0 scans em 34 dias, 412 MB", que é o único momento em que alguém está em
posição de decidir se deve excluí-lo. Sem isso ninguém pode decidir, portanto ninguém o
faz, e a tabela acumula índices durante toda a vida útil do produto.

Deliberadamente **não** faz parte da identidade do índice — reformular uma
justificativa nunca reconstrói um índice.

## Como uma declaração é nomeada

`<table>_<columns>_ix_<7 hex>`, ou `_ux_` quando único. Por exemplo,
`posts_status_publish_date_ix_a91c3f4`.

O hash é baseado na *semântica* do índice — método, colunas, ordem, unicidade,
colunas incluídas, predicado — e não em seu SQL renderizado, portanto, uma alteração na forma como
o Rebase formata o DDL nunca renomeia nada em seu banco de dados.

O hash é estrutural. `CREATE INDEX IF NOT EXISTS` faz a correspondência pelo **nome**,
não pela definição: com um nome legível, alterar uma declaração manteria o
índice antigo e reportaria sucesso para sempre. Com o hash no nome, uma redefinição
é um objeto diferente, então ele é criado e o antigo é removido.

Duas consequências que valem a pena mencionar:

- **Alterar uma declaração é um DROP e um CREATE**, emitidos diretamente — sem
  `CONCURRENTLY`, e com uma janela sem índice entre eles. Tranquilo em um banco de dados
  de desenvolvimento; em uma tabela grande em produção, aplique no momento de sua escolha.
- O nome é [um nome derivado congelado](/docs/architecture/schema-as-code). Ele está
  em `contracts/derived-names.txt` e não pode mudar entre versões.

## Quem é o dono de um índice

`_ix_`/`_ux_` mais sete hexadecimais é inalcançável por qualquer outro gerador de nomes aqui — `_fkey`,
`_gin`, `_trgm`, `_pkey`, `_key`, as distâncias vetoriais, o prefixo `idx_` de auth. Portanto,
o nome por si só decide a propriedade:

| O índice | No plano? | Nomeado pelo Rebase? | O que acontece |
|---|---|---|---|
| declarado | sim | sim | criado, depois mantido |
| declaração excluída | não | sim | **removido (dropped)**, conforme o esperado |
| manual ou originado de introspecção | não | não | **excluído — nunca tocado** |

Nenhum dos casos precisa de confirmação. Excluir uma declaração *deve* remover o índice
silenciosamente; o que nunca deve ser removido é um índice que o Rebase não criou. Isso também
é o que torna a ida e volta (round trip) da introspecção segura: os índices existentes de um banco de dados
para o qual você apontou o Rebase são considerados externos até que alguém os declare.

## Quando eles são criados

Ambos os produtores os emitem, o que é importante porque nem todo deployment executa
`db push`:

- **`rebase db push` / `rebase db generate`** os colocam no `schema.sql`, no
  caminho comum do Atlas — para que eles tenham migrações, detecção de desvio (drift) e rollback
  como qualquer outro objeto.
- **`rebase schema generate`** também os grava no `schema.generated.ts`, para
  que o schema do Drizzle descreva a mesma tabela que o banco de dados possui. As colunas `INCLUDE`
  de um índice de cobertura são a única exceção: o Drizzle não consegue expressá-las,
  e a linha gerada traz um comentário informando isso e apontando para o
  `schema.sql`, que as suporta.
- **A garantia de schema na inicialização (Boot-time schema ensure)** os cria com
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS`, nos mesmos termos que os índices ANN
  ao lado dele. Um tenant em runtime gerenciado faz o provisionamento na inicialização e nunca executa
  `db push`; sem isso, ele iniciaria sem nenhum de seus índices declarados e
  nada avisaria sobre isso.

## O que é recusado e quando

Todos estes geram erro em tempo de build, informando a coleção e a posição no
array — um índice que silenciosamente não existe é a falha que toda essa funcionalidade
elimina:

- uma propriedade que não está na coleção, ou uma relação cuja chave estrangeira
  reside na outra tabela
- mais de cinco chaves em `on`, ou a mesma coluna duas vezes
- exatamente as colunas da chave primária — `<table>_pkey` já indexa essas colunas
- uma coluna presente em `on` e em `include` simultaneamente
- `unique` em uma única coluna cuja propriedade já declara `validation.unique`
- `direction` ou `nulls` sob `gin` ou `brin`
- uma lista `in` que repete um valor
- duas declarações que derivam o mesmo nome — são o mesmo índice, duas vezes
- um `reason` vazio ou ausente

## Relacionados

- [Busca](/docs/backend/search) — busca textual ranqueada (full-text), que cria seu próprio
  índice GIN sobre um `tsvector` gerado
- [Busca vetorial](/docs/sdk/aggregates-and-search#vector-search) — o índice ANN sobre uma
  coluna de embedding, configurado na propriedade
- [Schema como código](/docs/architecture/schema-as-code) — como as declarações chegam
  ao banco de dados e o que é um nome derivado

---
