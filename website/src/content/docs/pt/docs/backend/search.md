---
sourceHash: 72daf47d8a15bafe
title: Busca
sidebar_label: Busca
description: Como o .search() se comporta por padrão e como uma tabela adota a busca de texto completo ranqueada sobre as colunas que você especificar — incluindo conteúdo JSONB e de arrays.
---

O `.search("term")` funciona em todas as tabelas sem configuração. A forma como ele
é compilado depende se a tabela solicitou algo a mais.

## O padrão

Sem nenhuma configuração, o `.search()` é uma **correspondência de substring que não diferencia maiúsculas de minúsculas (case-insensitive)**,
unida por operadores OR entre as colunas de texto da tabela. A string de busca
é dividida nos espaços em branco e cada termo precisa corresponder — mas eles podem corresponder
a colunas diferentes, de modo que um nome armazenado em duas colunas ainda seja encontrado:

```sql
-- .search("ada lovelace")
WHERE (first_name ILIKE '%ada%'      OR last_name ILIKE '%ada%')
  AND (first_name ILIKE '%lovelace%' OR last_name ILIKE '%lovelace%')
```

Envolva uma sequência em aspas duplas — `.search('"ada lovelace"')` — para buscar
pela frase exata, da mesma forma que o caminho de busca de texto completo abaixo as interpreta.

Isso é suficiente para uma tabela pequena com seu texto em colunas simples. Há
três limitações que nenhuma configuração interna consegue resolver:

- **Não é capaz de enxergar dentro de colunas JSON ou array.** Uma tabela que mantém
  seu conteúdo pesquisável em JSONB — tags, certificações, um questionário — tem
  uma caixa de busca que silenciosamente não encontra nada.
- **Não possui relevância.** As linhas retornam na ordem do `orderBy`, portanto a melhor
  correspondência pode estar na página sete.
- **Não pode usar um índice.** Um `%` no início anula uma árvore B (B-tree), de modo que toda busca
  se torna uma varredura sequencial (sequential scan). Aceitável com mil linhas; um abismo com um milhão.
  O `rebase doctor` aponta as tabelas onde isso começou a ser um problema: nenhum
  bloco `search` e mais de cerca de 10.000 linhas.

A correspondência do termo é feita de forma **literal**: `%` e `_` são metacaracteres do LIKE e
são escapados antes da construção do padrão, portanto buscar por `50%` busca por
`50%` em vez de retornar todas as linhas. Se você quiser caracteres curinga, o operador de filtro
`like` aceita um padrão (`.where("title", "like", "post-%")`); o `.search()` não
aceita.

Uma busca de uma única palavra compila exatamente para o mesmo SQL de sempre.

## Habilitando a busca avançada

<span class="since-badge" data-since="0.31">Since 0.31</span>

Declare `search` em uma tabela, nomeando as colunas que você deseja indexar:

```ts
import { defineTable, col, json } from "@rebasepro/server/schema";

export const talents = defineTable("talents", {
    columns: {
        id:            col.uuid().primaryKey().defaultRandom(),
        fullName:      col.text().notNull(),
        bio:           col.text(),
        interests:     col.text().array(),
        questionnaire: col.jsonb(json.object({ certifications: json.array(json.string()) }, { additional: true })),
    },
    search: {
        language: "spanish",
        unaccent: true,
        fields: [
            { path: "fullName", weight: "A" },
            { path: "bio", weight: "D" },
            "interests",
            "questionnaire.certifications",
        ],
    },
    rls: [{ operation: "select", access: "authenticated" }],
});
```

Nada é inferido. Um campo só é pesquisado se você o nomear explicitamente, e um caminho
que não resolver é rejeitado quando o esquema é compilado em vez de ser
ignorado silenciosamente — um campo de busca que você acredita estar ativo e não está é exatamente a
falha que este bloco existe para evitar. O mesmo se aplica a uma coluna restrita por `.private()` ou
`.access({ read })`: o índice é compartilhado por todos os chamadores.

O `.search()` então compila para uma correspondência de texto completo ranqueada, e as linhas retornam com um
`_score`:

```typescript
const { data } = await client.data.talents
    .search("auditor iso 14001")
    .orderBy("_score", "desc")
    .find();
```

### O que sua declaração cria

Uma coluna `tsvector`, `GENERATED ALWAYS AS … STORED`, e um índice GIN sobre ela.
O Postgres recalcula a coluna a cada gravação de um campo de origem e recusa qualquer
tentativa de escrevê-la diretamente, garantindo que o índice não fique desalinhado da linha. A coluna
nunca é retornada pela API.

Eles são gerados em `.rebase/sql/search.sql`, junto de `schema.sql` e
`policies.sql`, e o `rebase db push` os aplica para você — nada a mais para
executar. Eles recebem um arquivo próprio porque uma coluna `tsvector` gerada precisa que uma
função auxiliar `IMMUTABLE` exista previamente (`unaccent` é apenas `STABLE`, e
achatar um documento `jsonb` requer uma função que retorna conjuntos de dados), e o Atlas — o
motor por trás do `db push` — não gerencia funções em seu plano gratuito.

Uma consequência importante caso você faça deploy por migração em vez de push:
adicionar um bloco `search` isoladamente não gera nenhuma migração, pois o esquema
que o Atlas compara não mudou. O `rebase db generate` avisa quando isso acontece.
O bloco ainda é aplicado pelo `rebase db push` e pela verificação do esquema na inicialização;
para incluí-lo explicitamente em uma migração, anexe o `.rebase/sql/search.sql`,
que o `rebase db generate` acabou de gravar, a ela.

### Alterando o bloco posteriormente

Uma coluna gerada carrega sua expressão, e o Postgres não pode alterar essa
expressão in-place — portanto, adicionar um campo, mover um peso, mudar o idioma
ou habilitar o `unaccent` **não** é algo que o `ADD COLUMN IF NOT EXISTS` consiga
aplicar a uma coluna que já existe.

O Rebase registra uma impressão digital (fingerprint) da expressão na coluna ao criá-la
e a compara a cada inicialização e a cada `db push`. Qualquer alteração é recusada, explicitamente,
com as duas instruções necessárias para aplicá-la — um `DROP COLUMN` e um `ADD COLUMN`,
que reescrevem a tabela e reconstroem o índice GIN. Execute-as no momento de sua
escolha; nada reescreve uma tabela em produção em seu lugar.

Duas alterações são exceções. Habilitar `fuzzy` é uma alteração aditiva — uma segunda coluna — e
é aplicada sem nada disso. Definir [`mode`](#mode) altera a consulta em vez
da coluna, portanto entra em vigor apenas com um deploy.

A inicialização é recusada em vez de continuar servindo requisições, porque a alternativa seria o problema
que essa verificação veio substituir: uma coluna que continua indexando o conjunto de campos anterior, e uma busca que
não retorna nada para um conteúdo claramente presente na linha.

## O que você pode nomear em `fields`

<span class="since-badge" data-since="0.31">Since 0.31</span>

Um caminho começa com a chave de uma coluna.

| Caminho | Resolve para | Exemplo |
|------|-------------|---------|
| Uma coluna de texto | a própria coluna | `"fullName"` |
| Uma coluna `col.text().array()` | cada elemento | `"interests"` |
| Uma coluna `col.jsonb()` | todos os valores de string no documento | `"questionnaire"` |
| Um caminho dentro de uma coluna `col.jsonb()` | todos os valores de string no nível especificado ou abaixo dele | `"questionnaire.certifications"` |

Um caminho para dentro de um mapa indexa **valores de string em qualquer profundidade**
abaixo dele — arrays de strings, objetos aninhados, arrays de objetos. As *chaves* JSON
nunca são indexadas, apenas os valores, de modo que um nome de campo comum a todas as linhas não se torne um termo que corresponda
a todas as linhas.

Nomear um enum, um UUID, uma coluna `json` (em vez de `jsonb`) ou um array de
números é recusado, informando o motivo. Enums, em particular, são um vocabulário
fixo: filtre por eles com `where`, que é exato e utiliza índice.

## Opções

### `language`

A configuração de busca de texto do Postgres, que define o stemming (redução ao radical) e stopwords.
`"spanish"` reduz `auditores` para `auditor` e remove `de`; o padrão,
`"simple"`, não faz nenhum dos dois.

`"simple"` é o padrão porque é a única escolha que nunca falha — um
algoritmo de stemming aplicado ao idioma errado corrompe silenciosamente os lexemas. Defina-o para o
idioma do seu conteúdo para obter o stemming adequado.

### `mode`

Como uma string de busca é comparada com os campos que você nomeou.

| `mode` | Corresponde a | Encontra `Muñoz` a partir de `munoz` | Encontra `sebastian` a partir de `seb` |
|---|---|---|---|
| `"fts"` (padrão) | lexemas inteiros, via `tsvector` e seu índice GIN | com `unaccent` | não |
| `"hybrid"` | isso, `OU` uma correspondência de substring sobre os mesmos campos | **sempre** | **sim** |

```typescript
search: {
    language: "spanish",
    mode: "hybrid",
    fields: ["fullName", "questionnaire.certifications"]
}
```

O padrão e o comportamento padrão sem o bloco possuem lacunas opostas, e é isso que este
modo resolve. Medido contra uma instância real do Postgres em cinco linhas
(`search-mode-matrix.test.ts` em `@rebasepro/server-postgres`):

| consulta | sem bloco (ILIKE) | `"fts"` + `unaccent` | `"hybrid"` |
|---|---|---|---|
| `munoz` | `Ana Munoz` | `Ana Munoz`, `Sebastian Muñoz` | `Ana Munoz`, `Sebastian Muñoz` |
| `seb` | ambos os Sebastians | — | ambos os Sebastians |
| `audit` | o `Lead Auditor` | — | o `Lead Auditor` |
| `iso 14001` | a linha `ISO 14001` | a linha `ISO 14001` | a linha `ISO 14001` |

O `fuzzy` alcança as mesmas linhas, mas apenas depois que seu piso de similaridade for calibrado: no
padrão de 0.3, `iso 14001` também retorna uma linha com `ISO 9001`. O `"hybrid"` não possui
limiar para calibrar — uma substring ou ocorre ou não ocorre.

**O que isso custa.** A parte de substring não pode usar o índice GIN; um `%` inicial
nunca pode. A parte `@@` ainda executa primeiro e ainda usa o índice, portanto o que o
modo adiciona é uma varredura sobre as linhas rejeitadas pelo índice. Em uma tabela grande, essa é
a diferença entre uma varredura de índice e uma sequencial, razão pela qual isso é
um modo opcional e não o padrão.

**Alterá-lo em uma tabela ativa é seguro** — a única opção neste bloco
que tem essa característica. O `mode` opera no lado da consulta: ele não altera nenhuma coluna gerada, nenhuma
expressão de geração e nenhum índice, portanto não dispara a recusa descrita em
[Alterando o bloco posteriormente](#alterando-o-bloco-posteriormente). Habilitá-lo requer apenas
um deploy e nada mais.

Ele remove acentos na parte de substring **independentemente de `unaccent` estar definido ou não**,
porque essa remoção também ocorre no lado da consulta. Isso é deliberado: `unaccent` é a
configuração que você não pode habilitar posteriormente sem reescrever a tabela, então uma tabela
presa sem ela ainda pode deixar de perder resultados como `Muñoz`. O que o `unaccent` ainda oferece
é a remoção de acentos na parte `@@`, onde os lexemas são armazenados.

Ele adiciona a extensão `unaccent` e uma função auxiliar `IMMUTABLE` ao
banco de dados se ainda não estiverem presentes. Ambas as instruções usam
`IF NOT EXISTS` / `CREATE OR REPLACE`, e nenhuma delas altera tabelas.

### `unaccent`

Remove acentos antes da indexação, para que `auditoria` corresponda a `auditoría`.

Isso não é meramente cosmético em um idioma com acentuação. O Postgres reduz as duas grafias
a **lexemas diferentes** — `to_tsvector('spanish', 'auditoría')` produz
`auditor` enquanto `'auditoria'` produz `auditori` — portanto, sem isso, uma consulta digitada
sem acentos perde todas as linhas que os contenham, o que corresponde à maioria das buscas feitas
pelos usuários.

Requer a extensão `unaccent`.

### `fuzzy`

Também busca por similaridade de trigramas, para que correspondências aproximadas ainda sejam ranqueadas: `iso14000` alcançando
`ISO 14001`, algo que nenhuma quantidade de stemming fará, pois são simplesmente
lexemas diferentes.

```typescript
search: {
    fields: ["fullName", "questionnaire.certifications"],
    fuzzy: true,
    fuzzyThreshold: 0.3   // padrão
}
```

Adiciona uma segunda coluna gerada e um índice de trigramas, e requer `pg_trgm`.
Custa tempo de gravação e espaço em disco; resolve a classe mais comum de buscas com falha.

### `weight`

Cada campo recebe uma das quatro classes de peso do Postgres, de `A` (mais forte)
a `D`. O `ts_rank` pontua uma correspondência em `A` muito acima de uma em `D`, permitindo que um
nome supere uma menção de passagem em uma descrição longa. O padrão dos campos é `B`.

### `column`

A coluna gerada é chamada de `search_vector`. Altere-a apenas se houver conflito
com uma coluna que você já possua — ela passa a fazer parte do seu esquema após criada, e
renomeá-la posteriormente exige removê-la e recriá-la, o que reescreve a tabela.

## Classificação (Ranking)

O `_score` é o `ts_rank` aplicado à mesma consulta com a qual as linhas foram comparadas, e só
está presente quando a tabela habilitou o recurso *e* a requisição incluiu uma string
de busca.

Com `mode: "hybrid"`, uma linha encontrada apenas pela parte de substring recebe uma pequena
constante (0.001) em vez de zero — abaixo do menor `ts_rank` que uma correspondência real de lexema
pode produzir, de modo que uma correspondência de palavra inteira sempre supere uma de substring, e as
linhas encontradas apenas por substring usem o critério de desempate da própria consulta em vez de retornar
em qualquer ordem aleatória definida pela tabela.

Com `fuzzy` ativado, a similaridade de trigramas é **adicionada** a esse rank. Isso não é um
refinamento — é o que torna o `fuzzy` passível de ranqueamento. Um erro de digitação não corresponde a nada no
caminho exato, portanto cada linha encontrada por ele tem um `ts_rank` exatamente igual a zero; ordenar
apenas pelo rank retornaria a melhor correspondência em qualquer ordem definida pela tabela.
Os dois termos são somados em vez de ponderados, de modo que uma linha com correspondência exata
contribui com ambos e supera uma linha meramente similar sem necessitar de um coeficiente
para isso. Fora dessas duas condições, `orderBy: "_score"` é tratado como um campo desconhecido e
retorna 400 em vez de retornar linhas não ordenadas silenciosamente.

O `_score` não pode ser combinado com paginação por cursor (`startAfter`). A relevância é
calculada por consulta em vez de armazenada, portanto não há valor na linha do cursor para
comparar com a próxima página, e duas requisições com strings de busca diferentes
produzem pontuações que não estão na mesma escala. Use `limit`/`offset` para
páginas ordenadas por relevância.

## Por que esta linha correspondeu?

Uma lista ranqueada informa *quais* linhas corresponderam, nunca o *porquê* de uma delas estar ali. Peça a cada linha para
se explicar:

```typescript
const { data } = await client.data.talents
    .search("iso 14001", { explain: true })
    .orderBy("_score", "desc")
    .find();

data[0]._matches;
// [{ field: "questionnaire.certifications",
//    snippet: "<mark>ISO</mark> <mark>14001</mark> Lead Auditor" }]
```

O `field` é o caminho exatamente como declarado em `fields`, permitindo mapeá-lo para
um rótulo para exibição. Os campos retornam na ordem em que você os declarou.

Isso é feito por consulta, não por tabela, porque o custo é por consulta: um `ts_headline`
por campo declarado para cada linha retornada, e o `ts_headline` analisa o documento novamente
em vez de ler o índice. Ideal para uma página de resultados, inadequado para uma exportação.

**O snippet contém marcação por definição** — cada correspondência é envolvida em
`<mark>`. Renderize-o como HTML ou remova as tags, mas não o trate como texto simples
e não confie no texto ao redor: ele é exatamente o que o usuário digitou.
Dividir a string em `<mark>` e renderizar as partes é mais seguro do que usar
`dangerouslySetInnerHTML`.

No `mode: "hybrid"`, um campo correspondido apenas por substring também é reportado — ele
é o campo que causou o resultado. Seu snippet retorna sem nada marcado:
o `ts_headline` marca lexemas, e meia palavra não é um lexema.

Com `unaccent` ativado, os snippets são lidos com os acentos removidos — `Auditoria`, não
`Auditoría`. O `ts_headline` sobre o texto original não consegue encontrar uma correspondência gerada por
uma consulta sem acentos, portanto retornaria o texto sem nenhuma marcação;
um snippet legível com destaque visual é melhor do que um visualmente correto que silenciosamente
não destaca nada.

## Adicionando o bloco a uma tabela ativa

A coluna gerada é adicionada pela verificação de esquema na inicialização, como qualquer outra
coluna. Seu índice é construído em segundo plano após o servidor já estar em execução, usando
`CREATE INDEX CONCURRENTLY` para que as gravações não sejam bloqueadas (consulte
[Indexes](/docs/backend/indexes#when-they-are-created)). Até que o índice seja
construído, a busca funciona, mas lê a tabela inteira. Adicionar uma coluna gerada *armazenada* (stored)
de fato reescreve a tabela, portanto, em tabelas grandes, planeje isso como qualquer outra
reescrita.

## Relacionados

- [REST API](/docs/backend/api/) — os parâmetros de consulta com os quais uma busca chega ao servidor
- [Indexes](/docs/backend/indexes/) — o que o bloco de busca cria e quanto custa
- [Querying Data](/docs/sdk/querying/) — realizando buscas a partir do SDK tipado
