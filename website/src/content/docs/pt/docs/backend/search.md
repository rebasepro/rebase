---
sourceHash: 7047b4fd73bde89d
title: Busca
sidebar_label: Busca
description: Como o .search() se comporta por padrão e como habilitar a busca de texto completo ranqueada em uma coleção Postgres nos campos especificados — incluindo conteúdo JSONB e array.
---

O `.search("term")` funciona em todas as coleções sem configuração. O que ele
compila depende se a coleção solicitou algo a mais.

## O padrão

Sem nenhuma configuração, o `.search()` é uma **correspondência de substring que
não diferencia maiúsculas de minúsculas** (case-insensitive), combinada com `OR`
entre as propriedades `string` de nível superior da coleção. A string de busca é
dividida por espaços em branco e cada termo precisa corresponder — mas eles podem
corresponder a propriedades diferentes, portanto, um nome mantido em duas colunas
ainda é encontrado:

```sql
-- .search("ada lovelace")
WHERE (first_name ILIKE '%ada%'      OR last_name ILIKE '%ada%')
  AND (first_name ILIKE '%lovelace%' OR last_name ILIKE '%lovelace%')
```

Envolva um trecho em aspas duplas — `.search('"ada lovelace"')` — para buscar
pela frase exata, da mesma forma que o caminho de texto completo abaixo as lê.

Isso é suficiente para uma coleção pequena com seu texto em colunas simples.
Tem três limitações que nenhuma configuração interna pode resolver:

- **Não consegue ver dentro de propriedades `map` ou `array`.** Uma coleção que
  mantém seu conteúdo pesquisável em JSONB — tags, certificações, um questionário —
  tem uma caixa de busca que silenciosamente não corresponde a nada.
- **Não tem relevância.** As linhas retornam na ordem do `orderBy`, portanto a
  melhor correspondência pode estar na página sete.
- **Não pode usar um índice.** Um `%` no início inutiliza uma B-tree, então toda
  busca é uma varredura sequencial (sequential scan). Aceitável com mil linhas;
  um abismo com um milhão.

O termo é correspondido **literalmente**: `%` e `_` são metacaracteres do LIKE e
são escapados antes da criação do padrão; portanto, buscar por `50%` busca por
`50%` em vez de retornar todas as linhas. Se você quiser curingas, o operador de
filtro `like` aceita um padrão (`.where("title", "like", "post-%")`); o `.search()`
não aceita.

Uma busca de uma única palavra compila exatamente para o SQL de sempre.

## Habilitando o recurso

Declare um bloco `search` em uma coleção Postgres, nomeando os campos que você
deseja indexar:

```typescript
import type { PostgresCollectionConfig } from "@rebasepro/types";

const talents: PostgresCollectionConfig = {
    slug: "talents",
    table: "talents",
    name: "Candidates",
    properties: {
        id: { name: "ID", type: "string", isId: "uuid" },
        full_name: { name: "Full name", type: "string" },
        bio: { name: "Bio", type: "string" },
        interests: { name: "Interests", type: "array", of: { name: "Interest", type: "string" } },
        questionnaire: { name: "Questionnaire", type: "map", properties: {} }
    },
    search: {
        language: "spanish",
        unaccent: true,
        fields: [
            { path: "full_name", weight: "A" },
            { path: "bio", weight: "D" },
            "interests",
            "questionnaire.certifications"
        ]
    }
};
```

Nada é inferido. Um campo é pesquisado se e somente se você o nomear, e um
caminho que não resolve falha na inicialização em vez de ser ignorado silenciosamente —
um campo de busca que você acredita estar ativo e não está é exatamente a falha
que este bloco existe para evitar.

O `.search()` então compila para uma correspondência de texto completo ranqueada,
e as linhas retornam com um `_score`:

```typescript
const { data } = await client.data.talents
    .search("auditor iso 14001")
    .orderBy("_score", "desc")
    .find();
```

### O que a declaração cria

Uma coluna `tsvector`, `GENERATED ALWAYS AS … STORED`, e um índice GIN sobre ela.
O Postgres recalcula a coluna a cada gravação de um campo de origem e recusa
qualquer tentativa de gravá-la diretamente, para que o índice não fique desalinhado
com a linha. A coluna nunca é retornada pela API.

Eles são gerados em `drizzle/search.sql`, junto a `schema.sql` e `policies.sql`,
e o `rebase db push` os aplica para você — nada extra para executar. Eles têm seu
próprio arquivo porque uma coluna `tsvector` gerada precisa que uma função auxiliar
`IMMUTABLE` exista primeiro (`unaccent` é apenas `STABLE`, e achatar um documento
`jsonb` requer uma função que retorna conjuntos), e o Atlas — o mecanismo por trás
do `db push` — não pode gerenciar funções no plano gratuito.

Uma consequência que vale a pena saber se você faz deploy por migração em vez de
push: adicionar um bloco `search` por conta própria não produz nenhuma migração,
porque o schema que o Atlas compara não mudou. O `rebase db generate` avisa quando
isso acontece. O bloco ainda é aplicado pelo `rebase db push` e pela verificação
de schema na inicialização; para incluí-lo em uma migração explicitamente, anexe
`drizzle/search.sql` a uma.

### Alterando o bloco posteriormente

Uma coluna gerada carrega sua expressão, e o Postgres não pode alterar essa
expressão no local — portanto, adicionar um campo, mover um peso, alterar o idioma
ou ativar o `unaccent` **não** é algo que `ADD COLUMN IF NOT EXISTS` possa aplicar
a uma coluna já existente.

O Rebase registra uma impressão digital (fingerprint) da expressão na coluna ao criá-la
e a compara a cada inicialização e a cada `db push`. Uma alteração é recusada,
explicitamente, com as duas instruções que a aplicam — um `DROP COLUMN` e um
`ADD COLUMN`, que reescrevem a tabela e reconstroem o índice GIN. Execute-os no
momento que preferir; nada reescreve uma tabela em produção sem a sua intervenção.

Duas alterações são isentas. Ativar o `fuzzy` é aditivo — uma segunda coluna — e
se aplica sem nada disso. Definir [`mode`](#mode) altera a consulta em vez da
coluna, portanto se aplica com um deploy.

A inicialização recusa em vez de atender requisições, porque a alternativa é
exatamente o que essa verificação substituiu: uma coluna que continua indexando o
conjunto de campos anterior e uma busca que não retorna nada para conteúdos
claramente presentes na linha.

## O que você pode especificar em `fields`

| Caminho | Resolve para | Exemplo |
|------|-------------|---------|
| Uma propriedade `string` | a coluna | `"full_name"` |
| Uma propriedade `string[]` | cada elemento | `"interests"` |
| Uma propriedade `map` | cada valor de string no documento | `"questionnaire"` |
| Um caminho dentro de um `map` | cada valor de string naquele ponto ou abaixo dele | `"questionnaire.certifications"` |

Um caminho para dentro de um map indexa **valores de string em qualquer profundidade**
abaixo dele — arrays de strings, objetos aninhados, arrays de objetos. As *chaves*
JSON nunca são indexadas, apenas os valores, de modo que o nome de um campo comum
a todas as linhas não se torna um termo que corresponde a todas as linhas.

Especificar um enum, um UUID, uma coluna `json` (em vez de `jsonb`) ou um array de
números gera um erro de inicialização explicando o motivo. Enums, em particular,
são um vocabulário fixo: filtre por eles com `where`, que é exato e usa um índice.

## Opções

### `language`

A configuração de busca textual do Postgres, que decide o stemming e stopwords.
`"spanish"` reduz `auditores` para o radical `auditor` e descarta `de`; o padrão,
`"simple"`, não faz nenhum dos dois.

`"simple"` é o padrão porque é a única escolha que nunca está errada — um stemmer
aplicado ao idioma errado corrompe lexemas silenciosamente. Defina-o para o idioma
do seu conteúdo para obter stemming.

### `mode`

Como uma string de busca é comparada com os campos especificados.

| `mode` | Corresponde | Encontra `Muñoz` a partir de `munoz` | Encontra `sebastian` a partir de `seb` |
|---|---|---|---|
| `"fts"` (padrão) | lexemas inteiros, via o `tsvector` e seu índice GIN | com `unaccent` | não |
| `"hybrid"` | isso, `OU` uma correspondência de substring nos mesmos campos | **sempre** | **sim** |

```typescript
search: {
    language: "spanish",
    mode: "hybrid",
    fields: ["full_name", "questionnaire.certifications"]
}
```

O padrão e o padrão sem bloco têm lacunas opostas, que é o que este modo
preenche. Medido em um Postgres real com cinco linhas
(`search-mode-matrix.test.ts` em `@rebasepro/server-postgres`):

| consulta | sem bloco (ILIKE) | `"fts"` + `unaccent` | `"hybrid"` |
|---|---|---|---|
| `munoz` | `Ana Munoz` | `Ana Munoz`, `Sebastian Muñoz` | `Ana Munoz`, `Sebastian Muñoz` |
| `seb` | ambos os Sebastians | — | ambos os Sebastians |
| `audit` | a linha `Lead Auditor` | — | a linha `Lead Auditor` |
| `iso 14001` | a linha `ISO 14001` | a linha `ISO 14001` | a linha `ISO 14001` |

`fuzzy` alcança as mesmas linhas, mas apenas depois que seu limite mínimo de
similaridade for ajustado: no padrão de 0.3, `iso 14001` também retorna uma linha
`ISO 9001`. O `"hybrid"` não possui limite para ajustar — uma substring ocorre ou
não ocorre.

**Quanto custa.** A parte da substring não pode usar o índice GIN; um `%` inicial
nunca pode. A parte do `@@` ainda roda primeiro e continua usando o índice, então o
que o modo adiciona é uma varredura sobre as linhas rejeitadas pelo índice. Em uma
tabela grande, essa é a diferença entre um scan por índice e um scan sequencial,
razão pela qual isso é um modo e não o padrão.

**Alterá-lo em uma coleção ativa é seguro** — a única opção neste bloco que é.
O `mode` funciona no lado da consulta: não altera nenhuma coluna gerada, nenhuma
expressão de geração e nenhum índice, portanto não dispara a recusa descrita em
[Alterando o bloco posteriormente](#changing-the-block-later). Ativá-lo requer
apenas um deploy e nada mais.

Ele remove os acentos na parte da substring **mesmo que `unaccent` não esteja
definido**, porque essa remoção também ocorre no lado da consulta. Isso é
intencional: `unaccent` é a configuração que você não pode ativar mais tarde sem
reescrever a tabela, portanto uma coleção presa sem ele ainda pode evitar perder
correspondências como `Muñoz`. O que o `unaccent` ainda proporciona é a remoção
de acentos na parte do `@@`, onde os lexemas são armazenados.

Ele adiciona a extensão `unaccent` e uma função auxiliar `IMMUTABLE` ao banco de
dados se elas ainda não estiverem lá. Ambas as instruções são
`IF NOT EXISTS` / `CREATE OR REPLACE` e nenhuma delas altera uma tabela.

### `unaccent`

Remove acentos antes da indexação, para que `auditoria` corresponda a `auditoría`.

Isso não é apenas estético em um idioma com acentos. O Postgres reduz as duas
grafias para **lexemas diferentes** — `to_tsvector('spanish', 'auditoría')`
resulta em `auditor`, enquanto `'auditoria'` resulta em `auditori` — portanto,
sem isso, uma consulta digitada sem acentos não encontrará nenhuma linha que os
contenha, que é como a maioria dos usuários digita a maior parte das buscas.

Requer a extensão `unaccent`.

### `fuzzy`

Também corresponde por similaridade de trigramas, para que correspondências
aproximadas ainda sejam ranqueadas: `iso14000` encontrando `ISO 14001`, algo que
nenhum stemming conseguiria fazer porque são simplesmente lexemas diferentes.

```typescript
search: {
    fields: ["full_name", "questionnaire.certifications"],
    fuzzy: true,
    fuzzyThreshold: 0.3   // default
}
```

Adiciona uma segunda coluna gerada e um índice de trigramas, e requer `pg_trgm`.
Custa tempo de escrita e disco; resolve a classe mais comum de falhas de busca.

### `weight`

Cada campo possui uma das quatro classes de peso do Postgres, de `A` (mais forte)
a `D`. O `ts_rank` pontua uma correspondência em `A` muito acima de uma em `D`,
que é como um nome supera uma menção passageira em uma descrição longa. O padrão
dos campos é `B`.

### `column`

A coluna gerada é nomeada `search_vector`. Altere-a apenas se isso colidir com uma
coluna que você já possui — ela se torna parte do seu schema depois de criada, e
renomeá-la posteriormente exige um drop e recreate, o que reescreve a tabela.

## Ranqueamento

O `_score` é o `ts_rank` contra a mesma consulta com a qual as linhas foram
combinadas e está presente apenas quando a coleção optou por esse recurso *e* a
requisição continha uma string de busca.

Com `mode: "hybrid"`, uma linha encontrada apenas pela parte da substring
recebe uma pontuação constante pequena (0.001) em vez de zero — abaixo do menor
`ts_rank` que uma correspondência real de lexema pode produzir, de modo que uma
correspondência de palavra inteira sempre supere uma de substring, e as linhas
encontradas apenas por substring recorram ao próprio critério de desempate da
consulta em vez de retornarem em qualquer ordem arbitrária da tabela.

Com o `fuzzy` ativado, a similaridade de trigramas é **adicionada** a essa pontuação.
Isso não é um mero refinamento — é o que torna o `fuzzy` um ranqueamento de fato.
Um erro de digitação não corresponde a nada no caminho exato, então cada linha que
ele encontra tem um `ts_rank` de exatamente zero; ordenar apenas por rank retornaria
a melhor correspondência em qualquer ordem arbitrária da tabela. Os dois termos são
somados em vez de ponderados, de modo que uma linha que correspondeu exatamente
contribui com ambos e supera uma linha meramente similar, sem precisar de um
coeficiente explícito. Fora dessas duas condições, `orderBy: "_score"` é tratado
como um campo desconhecido e retorna 400 em vez de retornar silenciosamente linhas
não ordenadas.

O `_score` não pode ser combinado com paginação por cursor (`startAfter`). A
relevância é calculada por consulta em vez de armazenada, portanto não há valor na
linha do cursor para comparar com a próxima página, e duas requisições com strings
de busca diferentes produzem pontuações que não estão na mesma escala. Use
`limit`/`offset` para páginas ordenadas por relevância.

## Por que esta linha correspondeu?

Uma lista ranqueada informa *quais* linhas, nunca o *porquê* de uma delas estar ali.
Peça a cada linha para se explicar:

```typescript
const { data } = await client.data.talents
    .search("iso 14001", { explain: true })
    .orderBy("_score", "desc")
    .find();

data[0]._matches;
// [{ field: "questionnaire.certifications",
//    snippet: "<mark>ISO</mark> <mark>14001</mark> Lead Auditor" }]
```

`field` é o caminho exatamente como declarado em `fields`, permitindo mapeá-lo
para um rótulo de exibição. Os campos retornam na ordem em que você os declarou.

Por consulta, não por coleção, porque o custo é por consulta: um `ts_headline` por
campo declarado para cada linha retornada, e o `ts_headline` reanalisa o documento
em vez de ler o índice. Adequado para uma página de resultados, inadequado para uma
exportação.

**O snippet contém marcação por definição** — cada correspondência é envolvida em
`<mark>`. Renderize como HTML ou remova as tags, mas não o trate como texto puro
e não confie no texto ao redor: é exatamente o que o usuário digitou. Dividir pelo
`<mark>` e renderizar as partes é mais seguro do que usar `dangerouslySetInnerHTML`.

Sob `mode: "hybrid"`, um campo correspondido apenas por substring também é
reportado — é o campo que causou a correspondência. Seu snippet retorna sem nada
marcado: `ts_headline` marca lexemas, e meia palavra não é um lexema.

Com o `unaccent` ativado, os snippets são lidos com os acentos removidos — `Auditoria`,
não `Auditoría`. O `ts_headline` sobre o texto original não consegue encontrar uma
correspondência gerada por uma consulta sem acento, portanto retornaria o texto sem
nada marcado; um snippet legível com destaque é melhor do que um visualmente mais
bonito que silenciosamente não destaca nada.

## Adicionando o bloco a uma coleção ativa

A coluna gerada é adicionada pela verificação de schema na inicialização, como
qualquer outra coluna, e seu índice é construído com `CREATE INDEX CONCURRENTLY`,
para que as gravações não sejam bloqueadas. Adicionar uma coluna gerada *armazenada*
(stored) reescreve a tabela, portanto, em uma tabela grande, planeje isso como
qualquer outra reescrita.

## Quais mecanismos

O bloco `search` é exclusivo do Postgres e é rejeitado na inicialização em outros
mecanismos em vez de ser silenciosamente ignorado. As coleções do MongoDB mantêm
sua correspondência baseada em regex; as coleções do Firestore usam o controlador
externo de busca de texto.

## Relacionado

- [REST API](/docs/backend/api/) — os parâmetros de consulta pelos quais uma busca chega ao servidor
- [Indexes](/docs/backend/indexes/) — o que o bloco de busca cria e quanto custa
- [Querying Data](/docs/sdk/querying/) — buscando a partir do SDK cliente
