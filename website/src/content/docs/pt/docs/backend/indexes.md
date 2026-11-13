---
sourceHash: e086faac3624de8d
title: Índices
sidebar_label: Índices
description: Declare índices comuns do Postgres em uma tabela — btree, GIN e BRIN, parciais, compostos, de cobertura e únicos — e por que um índice escrito manualmente costumava desaparecer.
---

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Uma tabela declara os índices que suas consultas precisam, ao lado das colunas que eles cobrem:

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const posts = defineTable("posts", {
    columns: {
        id:          col.uuid().primaryKey().defaultRandom(),
        title:       col.text().notNull(),
        status:      col.enum(["draft", "published"]).notNull().default("draft"),
        publishDate: col.timestamp({ withTimezone: true }),
    },
    indexes: [
        {
            columns: ["status", { column: "publishDate", direction: "desc" }],
            reason: "admin list: filter by status, newest first",
        },
    ],
    rls: "admin-only",
});
```

## Por que isso existe

O gerador de DDL sempre emitiu instruções de índice para exatamente duas coisas,
e ambas são estruturas pertencentes a uma *funcionalidade* em vez de consultas que você escreveu: o índice
GIN por trás de um bloco [`search`](/docs/backend/search), e o índice ANN por trás
de uma coluna [`col.vector()`](/docs/sdk/aggregates-and-search#the-index). O caso simples — o btree
por trás de uma cláusula `where` — não tinha local de declaração algum.

Portanto, a única maneira de ter um era escrevendo-o manualmente. E:

:::caution[Se você possui índices escritos manualmente em uma tabela gerenciada pelo Rebase]
O `rebase db push` é declarativo. Um índice em uma tabela gerenciada que estivesse ausente
do `schema.sql` era considerado drift, e o Atlas planejava um `DROP INDEX` para ele —
o que não está na lista de instruções destrutivas, portanto a aplicação autoaprovada o
executava sem perguntar. Todo índice escrito manualmente em uma tabela gerenciada estava com
os dias contados.

Isso foi corrigido pela regra de propriedade abaixo: um índice que o Rebase não criou agora
é excluído do diff pelo nome e nunca é tocado. Declarar seus índices escritos manualmente
continua sendo o melhor estado final — um índice declarado é criado em um banco de dados novo
e em cada tenant, enquanto um manual não é —, mas nada os removerá nesse meio-tempo.
:::

## A estrutura

<span class="since-badge" data-since="0.31">Desde 0.31</span>

| Campo | Tipo | Descrição |
|-------|------|-------------|
| `columns` | `(string \| { column, direction?, nulls? })[]` | **Obrigatório.** As colunas-chave, em ordem. 1–5 entradas. |
| `reason` | `string` | Por que este índice existe, em uma linha. Fortemente recomendado. |
| `using` | `"btree" \| "gin" \| "brin"` | Método de acesso. O padrão é `btree`. |
| `where` | `IndexPredicate` | Torna o índice parcial — ele cobre apenas as linhas correspondentes a isso. |
| `unique` | `boolean` | Apenas btree. Uma garantia de unicidade composta. |
| `include` | `string[]` | Apenas btree. Colunas de carga útil carregadas para varreduras somente de índice (index-only scans). |

### `columns` aceita chaves de coluna, nunca nomes SQL

<span class="since-badge" data-since="0.31">Desde 0.31</span>

O nome de uma relação `belongsTo` representa sua coluna de chave estrangeira, logo a relação
`author` é a coluna `author_id`:

```ts
indexes: [
    // `author` is the relation; its key is the column author_id.
    { columns: ["author"], reason: "an author's posts, and the ON DELETE cascade" },
]
```

Escrever `author_id` aqui é recusado: é um nome de coluna SQL, não uma chave da
tabela, e `columns` nomeia chaves. O Postgres não
indexa uma coluna de chave estrangeira para você — sem este índice, tanto "listar as publicações
deste autor" quanto o cascateamento `ON DELETE` são varreduras sequenciais (sequential scans).

Uma relação `hasMany` ou muitos-para-muitos não possui coluna nesta tabela e é
recusada: declare o índice na tabela que possui a chave estrangeira.

### A ordem importa, e apenas um subconjunto inicial é utilizável

O Postgres pode usar um subconjunto inicial das colunas-chave, portanto
`["ownerId", "createdAt"]` atende a uma consulta filtrando por `ownerId`, e a uma
filtrando por ambos, e **nunca** a uma filtrando apenas por `createdAt`.

`direction` e `nulls` justificam sua presença apenas quando o `ORDER BY` de uma consulta mistura
direções. Um índice `DESC` isolado é redundante com seu par `ASC` — o Postgres
varre uma btree no sentido inverso com a mesma rapidez —, de modo que um único índice atende ao filtro *e* à
ordenação no exemplo no topo desta página.

```ts
indexes: [{ columns: [{ column: "createdAt", direction: "desc", nulls: "last" }], reason: "…" }]
```

Escrever o padrão do Postgres explicitamente não custa nada: o nome derivado calcula o hash
da ordem *efetiva*, portanto adicionar `direction: "asc"` a uma coluna que já era
ascendente não é uma redefinição e não reconstrói nada.

O limite é de cinco chaves. O Postgres permite trinta e duas; além de quatro, as colunas finais
são peso morto em cada escrita, e a declaração geralmente é alguém esperando que uma
consulta fique mais rápida por acréscimo. Colunas de carga útil que não são pesquisadas pertencem ao
`include`, que não conta para o limite.

### `where` é estruturado, não SQL

```ts
indexes: [{
    columns: ["publishDate"],
    where: { column: "status", op: "=", value: "published" },
    reason: "public feed: published posts by date",
}]
```

O índice então mantém apenas linhas publicadas e permanece pequeno à medida que os rascunhos se acumulam.

Os operadores são `=`, `!=`, `<`, `<=`, `>`, `>=`, `in`, `is null` e
`is not null`, combinados com `and`:

```ts
indexes: [{
    columns: ["assignee"],
    where: {
        and: [
            { column: "status", op: "in", value: ["open", "in_progress"] },
            { column: "archivedAt", op: "is null" },
        ],
    },
    reason: "the open-work queue, which is a fraction of the table",
}]
```

Deliberadamente não há `or`. Um predicado OR quase sempre significa que o índice
não deveria ser parcial; se você realmente precisar de um, declare dois índices.

Um predicado é uma estrutura em vez de uma string porque uma string não poderia ser
verificada contra as colunas da tabela, não poderia ter sua impressão digital (fingerprint) gerada sem
colocar seu próprio texto no nome do índice — logo, reformatá-lo renomearia um
índice ativo — e seria o único lugar onde um chamador recorreria a uma classe
de operador de extensão que o planejador não pode reproduzir.

### `unique` é apenas para compostos

A unicidade de coluna única é feita com `.unique()` na coluna, e declará-la aqui
também é recusado em vez de aceito como um sinônimo. `.unique()` compila para um
`UNIQUE` inline cujo índice subjacente
o Postgres — não o Rebase — nomeia como `<table>_<column>_key`.

```ts
indexes: [{ columns: ["workspaceId", "slug"], unique: true, reason: "one slug per workspace" }]
```

### `include` permite uma varredura somente de índice (index-only scan)

Colunas de carga útil residem nas páginas folha: não são pesquisáveis, não são ordenadas e
economizam uma busca na heap ao custo de um índice mais pesado. Elas não podem se sobrepor a `columns`.

```ts
indexes: [{ columns: ["status"], include: ["title"], reason: "the status sidebar counts, without touching the heap" }]
```

### `using`

`btree` (o padrão) atende a igualdade, intervalo, `ORDER BY` e unicidade.

`gin` serve para contenção em uma coluna de array ou em uma coluna `jsonb`. `brin` serve para uma
coluna naturalmente ordenada em uma tabela append-only — minúsculo e inútil a partir do momento
em que as linhas começam a chegar fora de ordem. Nenhum dos dois tem ordenação, portanto `direction` e
`nulls` são irrepresentáveis neles, em vez de serem recusados posteriormente pelo Postgres.

Não há `gist` nem `hash`: toda classe de operador gist interessante é fornecida em
uma extensão, e índices hash não podem ser únicos, compostos ou ordenados. Essa
restrição é o que mantém todo o modelo no caminho do Atlas — o `rebase db push`
materializa o estado desejado em um banco de dados temporário limpo para realizar o planejamento, e
o `CREATE EXTENSION` não pode estar nesse arquivo. **A busca por trigramas é
[`search:`](/docs/backend/search); ANN é uma
coluna [`col.vector()`](/docs/sdk/aggregates-and-search#the-index).** Um índice que precise de
`gin_trgm_ops` ou `vector_cosine_ops` é recusado no momento da compilação em vez de ser
emitido para falhar depois contra um banco de dados que você nunca viu.

### `reason`

<span class="since-badge" data-since="0.31">Desde 0.31</span>

É o único campo sem SQL por trás e é opcional — mas escreva-o.

Um índice é a única coisa que um schema pode declarar que custa dinheiro para sempre
e cujo benefício é invisível a partir da configuração. O motivo é o que é impresso
ao lado de "0 scans in 34 days, 412 MB", que é o único momento em que alguém está em
condições de decidir se deve excluí-lo. Sem ele ninguém pode decidir, portanto ninguém
o faz, e a tabela acumula índices durante toda a vida útil do produto.

Ele deliberadamente **não** faz parte da identidade do índice — reformular uma
justificativa nunca reconstrói um índice.

## Como uma declaração é chamada

`<table>_<columns>_ix_<7 hex>`, ou `_ux_` quando único. Por exemplo,
`posts_status_publish_date_ix_a91c3f4`.

O hash é sobre a *semântica* do índice — método, colunas, ordem, unicidade,
colunas incluídas, predicado — e não sobre seu SQL renderizado, de modo que uma alteração na forma como o
Rebase formata o DDL nunca renomeia nada em seu banco de dados.

O hash é fundamental. O `CREATE INDEX IF NOT EXISTS` faz a correspondência pelo **nome**,
não pela definição: com um nome legível, alterar uma declaração manteria o
índice antigo e reportaria sucesso para sempre. Com o hash no nome, uma redefinição
é um objeto diferente, logo ele é criado e o antigo é removido.

Duas consequências que valem a pena mencionar:

- **Alterar uma declaração é um DROP e um CREATE**, emitidos diretamente — sem
  `CONCURRENTLY`, e com uma janela sem índice no meio. Tudo bem em um banco de dados
  de desenvolvimento; em uma tabela ativa grande, aplique isso em um momento de sua escolha.
- O nome é [um nome derivado congelado](/docs/architecture/schema-as-code). Ele está
  em `contracts/derived-names.txt` e não pode mudar entre versões.

## Quem é o dono de um índice

`_ix_`/`_ux_` seguido de sete caracteres hexadecimais é inalcançável por qualquer outro nomeador aqui — `_fkey`,
`_gin`, `_trgm`, `_pkey`, `_key`, as distâncias de vetores, o prefixo `idx_` de auth. Portanto,
o nome sozinho decide a propriedade:

| O índice | No plano? | Nomeado pelo Rebase? | O que acontece |
|---|---|---|---|
| declarado | sim | sim | criado, depois mantido |
| declaração excluída | não | sim | **removido**, conforme o esperado |
| manual, ou de introspecção | não | não | **excluído — nunca tocado** |

Nenhum dos casos precisa de confirmação. Excluir uma declaração *deve* remover o índice
silenciosamente; o que nunca deve ser removido é um índice que o Rebase não criou. Isso também
é o que torna a viagem de ida e volta da introspecção segura: os índices existentes de um banco de dados
para o qual você apontou o Rebase são estrangeiros até que alguém os declare.

### Declarando um índice que você já possui

Quando você declara um índice que o banco de dados já possui sob outro nome, o Rebase
assume o controle desse índice em vez de construir uma segunda cópia. Antes de construir um
índice declarado que está ausente, o `rebase db push`, o `rebase db migrate` e a
inicialização procuram por um índice existente na mesma tabela que corresponda a ele em todas
as partes. Uma correspondência é renomeada para o nome declarado com
`ALTER INDEX … RENAME TO …`, o que altera o catálogo e não reconstrói nada.
A partir de então, ele é o índice declarado: encontrado pelo nome, mantido e removido se a
declaração for removida.

Todas estas partes devem coincidir:

- o método de acesso;
- a unicidade;
- as colunas-chave, em ordem, cada uma com sua direção e posicionamento de `NULLS`
  (a direção conta apenas para `btree`);
- as colunas do `INCLUDE`;
- o predicado. Aspas do Postgres, conversões literais (casts) e parênteses são ignorados;
  qualquer outra diferença significa que não há correspondência.

O Rebase deixa um índice existente em paz e constrói o declarado ao lado dele
quando esse índice diferir em qualquer uma dessas partes. Ele também o deixa em paz quando uma
chave é uma expressão, uma chave usa uma classe de operador ou ordenação (collation) não padrão, o
índice dá suporte a uma restrição, o índice é `INVALID` ou já possui um nome
do Rebase.

O `rebase db generate` grava cada índice declarado na migração como
`CREATE INDEX IF NOT EXISTS`, de modo que a instrução tenha sucesso quando o `rebase db migrate`
acabar de renomear um índice existente para esse nome.

## Quando eles são criados

Ambos os produtores os emitem, o que importa porque nem todo deployment executa
o `db push`:

- **`rebase db push` / `rebase db generate`** os colocam em `schema.sql`, no
  caminho comum do Atlas — para que recebam migrações, detecção de drift e rollback
  como qualquer outro objeto.
- **`rebase schema generate`** também os grava em `schema.generated.ts`, para que
  o schema do Drizzle descreva a mesma tabela que o banco de dados possui. As colunas `INCLUDE`
  de um índice de cobertura são a única exceção: o Drizzle não pode expressá-las,
  e a linha gerada traz um comentário informando isso e apontando para o
  `schema.sql`, que pode.
- **A garantia de schema em tempo de inicialização (Boot-time schema ensure)** também os cria, nos mesmos termos que os
  índices de busca e ANN ao lado deles. Um tenant de runtime gerenciado é provisionado na
  inicialização e nunca executa `db push`; sem isso, ele iniciaria sem nenhum de seus
  índices declarados e nada avisaria sobre isso. Uma tabela criada pela inicialização recebe seus
  índices junto com a tabela. Em uma tabela que já existe, a inicialização constrói um
  índice ausente após o servidor estar atendendo requisições, em segundo plano, da mesma forma que
  constrói os [índices de chave estrangeira](#o-que-a-atualização-faz-em-um-banco-de-dados-existente).
  Ele usa `CREATE INDEX CONCURRENTLY` em uma conexão própria, para que o
  `statement_timeout` de 30 s da pool não possa cancelar uma construção longa. Um índice que uma
  construção interrompida deixou como `INVALID` sob seu nome é removido e construído novamente.
  O `IF NOT EXISTS` faz a correspondência pelo nome, portanto nunca repara um índice. Um índice
  `unique` é construído da mesma maneira, mas antes de o servidor atender requisições, e a inicialização falha
  se ele não puder ser construído. Atender requisições sem ele permitiria a entrada de linhas duplicadas.

## Chaves estrangeiras são indexadas para você

O Postgres cria o
índice para o qual uma chave estrangeira *aponta* — a chave primária do destino — e nunca um na
coluna que a *contém*. Cada leitura do outro lado de um link filtra por
essa coluna: uma inclusão `hasMany` ou `hasOne`, uma listagem aninhada como
`/authors/5/posts` (sua página e sua contagem), o lado reverso de um
`manyToMany` e a verificação `ON DELETE` quando uma linha pai é excluída. Sem
um índice, cada uma dessas operações lê todas as linhas da tabela filha.

Portanto, o Rebase deriva uma btree simples para:

- a `localKey` de cada [`belongsTo`](/docs/collections/relations/#belongsto--the-key-is-on-this-table)
  — que também é a coluna que o `hasOne` / `hasMany` do outro lado lê;
- a coluna de destino de cada junção `manyToMany`. A chave primária da junção
  `(source, target)` já atende às buscas pela coluna de origem; o lado
  reverso do link precisa deste índice. Uma junção é uma tabela do Rebase, portanto esta
  não permite cancelamento (opt-out).

Medido no Postgres 18 com cache aquecido, 1M de comentários em 50k posts:

| A leitura | Sem o índice | Com ele |
|---|---|---|
| `include=comments` em uma página de 25 posts (`post_id IN (…)`) | 38 ms | 0.3 ms |
| `GET /posts/77/comments?limit=25` — a página | 28 ms | 0.3 ms |
| …e seu `count(*)` | 29 ms | 0.2 ms |
| excluindo um post (verificação de `ON DELETE SET NULL`) | 129 ms | 1.7 ms |

Nada é indexado duas vezes. O índice derivado é ignorado quando a coluna já
lidera a chave primária, possui um `UNIQUE` (`.unique()` em uma coluna vinculada, ou
`unique: true` na relação), ou lidera um índice em `indexes:` —
simples ou composto, desde que seja uma btree sem `where`. Um índice parcial
não pode atender a uma busca que precisa alcançar todas as linhas, e um índice GIN ou BRIN
responde a uma pergunta diferente, portanto nenhum deles é considerado.

O nome é aquele derivado pela [declaração](#como-uma-declaração-é-chamada) de um índice
simples naquela coluna — `posts_author_id_ix_00ad191` — portanto o índice derivado
e `indexes: [{ columns: ["author"], … }]` são um único objeto, não dois. É um
[nome derivado congelado](/docs/architecture/schema-as-code) como qualquer outro.

Para manter a restrição e remover o índice — uma tabela com tantas operações de escrita que o
índice custa mais do que as buscas que ele atende, ou uma em que você mantém um índice
próprio fora de `indexes:` — configure isso na relação:

```ts
relations: {
    author: rel.belongsTo(() => authors, { index: false }),
}
```

`index` existe apenas em `belongsTo`: nos outros tipos, a chave estrangeira é uma
coluna no destino (defina `index` no `belongsTo` do destino) ou em uma junção.

O Rebase lê apenas suas tabelas para decidir isso, nunca o banco de dados: o `db
push` e a inicialização precisam chegar ao mesmo conjunto de índices com os mesmos nomes, ou
o próximo push removeria o que a inicialização construiu. Um índice que você escreveu manualmente na
mesma coluna, fora de `indexes:`, portanto não é visto — declare-o em
`indexes:`, ou defina `index: false`, para manter um índice em vez de dois.

### O que a atualização faz em um banco de dados existente

Os índices são novos objetos em tabelas que já contêm dados, e os dois caminhos
os constroem de maneira diferente:

- **A inicialização não espera por eles.** Em uma tabela que já existe, a
  garantia de schema deixa os índices de chave estrangeira ausentes fora da inicialização e
  os constrói depois que o servidor estiver atendendo requisições, um de cada vez, com
  `CREATE INDEX CONCURRENTLY` em uma conexão própria (o `statement_timeout` de 30 s
  da pool não se aplica a ela). Isso não adquire nenhum bloqueio pelo qual leituras ou escritas
  precisem esperar. Uma tabela que outra sessão esteja retendo — a construção de outra instância, um
  `ALTER TABLE` — é deixada de lado dentro do limite de tempo de bloqueio (lock budget) da inicialização e tentada novamente na
  próxima inicialização. Um índice que uma construção interrompida deixou como `INVALID` (um deploy que
  substituiu o processo no meio da construção, duas instâncias disputando um mesmo nome) é removido
  e construído novamente. Cada um é registrado em log conforme inicia e termina; uma falha é um
  aviso, nunca uma falha de inicialização. Uma tabela criada por esta inicialização recebe seus índices junto
  com a tabela, antes que qualquer coisa possa escrever nela. Sob `REBASE_PROVISION_ONLY`, as
  construções são executadas antes de o processo ser encerrado, já que nada após ele as executaria.
- **O `rebase db push` os constrói antes de realizar o planejamento**, com o mesmo construtor e
  nos mesmos termos que a inicialização: `CREATE INDEX CONCURRENTLY`, um de cada vez,
  para que leituras e escritas continuem enquanto ele é executado (cerca de 0,4 s para 1M de linhas e 6 s para
  10M como uma construção comum em um SSD de laptop, `maintenance_work_mem` de 64 MB; uma
  concorrente demora mais e não bloqueia nada). O Atlas então encontra cada índice
  no devido lugar e não planeja nada para ele. Um índice que ele não conseguiu construir primeiro — uma
  tabela retida por outra sessão durante todo o tempo de bloqueio — é deixado para o Atlas,
  que o constrói dentro da transação do push e, portanto, bloqueia escritas nessa
  tabela durante a construção; o push informa qual. Uma coluna de chave estrangeira que o próprio
  push adiciona recebe seu índice do Atlas juntamente com a coluna, antes que qualquer
  dado esteja nela. O `--dry-run` não constrói nada: ele lista os nomes dos índices que um push real
  construiria primeiro, e o plano que ele imprime os lista, já que eles ainda não existem.

## O que é recusado, e quando

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Tudo isso é recusado quando o schema é compilado, indicando o nome da tabela e a
posição no array — um índice que silenciosamente não existe é a falha
que toda essa funcionalidade elimina:

- uma chave que não seja coluna nem relação `belongsTo` da tabela, ou uma relação
  cuja chave estrangeira resida na outra tabela
- mais de cinco chaves em `columns`, ou a mesma coluna duas vezes
- exatamente as colunas da chave primária — `<table>_pkey` já indexa essas
- uma coluna presente tanto em `columns` quanto em `include`
- `unique` em uma coluna que já declara `.unique()`
- `direction` ou `nulls` sob `gin` ou `brin`
- uma lista `in` que repete um valor
- duas declarações que derivam o mesmo nome — elas representam o mesmo índice, duas vezes
- um `reason` vazio

## Relacionados

<span class="since-badge" data-since="0.31">Desde 0.31</span>

- [Search](/docs/backend/search) — busca textual ranqueada, que constrói seu próprio índice
  GIN sobre um `tsvector` gerado
- [Busca vetorial](/docs/sdk/aggregates-and-search#vector-search) — o índice ANN sobre uma
  coluna de embedding, configurado em `col.vector()`
- [Schema as code](/docs/architecture/schema-as-code) — como as declarações chegam
  ao banco de dados, e o que é um nome derivado
- [Tabelas](/docs/schema/) — cada chave de `defineTable`
