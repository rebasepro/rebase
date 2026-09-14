---
sourceHash: 04421ade309db1ce
title: Busca
sidebar_label: Busca
description: Como o .search() se comporta por padrão e como ativar a busca textual ranqueada em uma coleção Postgres nos campos especificados — incluindo conteúdo JSONB e arrays.
---

O `.search("termo")` funciona em todas as coleções sem configuração prévia. A forma
como ele é compilado depende se a coleção solicitou algo a mais.

## O padrão

Sem nenhuma configuração, o `.search()` realiza uma **correspondência de substring sem distinção entre maiúsculas e minúsculas (case-insensitive)**,
combinada com operadores OR entre as propriedades `string` de nível raiz da coleção:

```sql
WHERE name ILIKE '%term%' OR description ILIKE '%term%'
```

Isso é suficiente para uma coleção pequena com texto em colunas simples. No entanto, possui
três limitações que nenhuma configuração interna consegue resolver:

- **Não analisa o conteúdo de propriedades `map` ou `array`.** Uma coleção que armazena
  seu conteúdo pesquisável em JSONB — tags, certificações, um questionário — terá
  uma caixa de busca que silenciosamente não retornará nada.
- **Não possui relevância.** As linhas retornam na ordem definida pelo `orderBy`, então o melhor resultado
  pode acabar na página sete.
- **Não pode usar um índice.** Um `%` no início anula o uso de árvores B (B-tree), fazendo com que toda busca
  seja uma varredura sequencial (sequential scan). Funciona bem para mil linhas; vira um gargalo crítico em um milhão.

O termo é buscado de forma **literal**: `%` e `_` são caracteres especiais do operador LIKE, e
são escapados antes da criação do padrão. Dessa forma, buscar por `50%` realmente pesquisa por
`50%` em vez de retornar todas as linhas. Se desejar usar caracteres curinga, o operador de filtro
`like` aceita um padrão (`.where("title", "like", "post-%")`); o `.search()` não
aceita.

O comportamento padrão não muda, e uma coleção que não ativou a busca avançada compila
exatamente para o mesmo SQL de antes.

## Ativando a busca textual

Declare um bloco `search` em uma coleção Postgres, especificando os campos que deseja
indexar:

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

Nada é inferido. Um campo só é pesquisado se você o indicar explicitamente, e um caminho
que não puder ser resolvido causará uma falha na inicialização em vez de ser ignorado silenciosamente — um campo
de busca que você acredita estar ativo, mas não está, é exatamente a falha que este bloco
foi feito para evitar.

O `.search()` é então compilado para uma correspondência textual ranqueada (full-text match), e as linhas retornam com um
`_score`:

```typescript
const { data } = await client.data.talents
    .search("auditor iso 14001")
    .orderBy("_score", "desc")
    .find();
```

### O que a declaração cria

Uma coluna `tsvector`, definida como `GENERATED ALWAYS AS … STORED`, e um índice GIN sobre ela.
O Postgres recalcula a coluna a cada escrita em um campo de origem e rejeita qualquer
tentativa de escrita direta nela, garantindo que o índice nunca fique dessincronizado da linha. A coluna
nunca é retornada pela API.

Essas instruções são geradas em `drizzle/search.sql`, ao lado de `schema.sql` e
`policies.sql`, e o comando `rebase db push` as aplica para você — sem a necessidade de executar
nada extra. Elas ficam em um arquivo separado porque uma coluna `tsvector` gerada precisa que uma
função auxiliar `IMMUTABLE` exista previamente (`unaccent` é apenas `STABLE`, e
planificar um documento `jsonb` requer uma função que retorne conjuntos), e o Atlas — o
mecanismo por trás do `db push` — não gerencia funções em seu plano gratuito.

Uma consequência importante caso faça o deploy por migrações em vez do push:
adicionar um bloco `search` isoladamente não gera uma migração, pois o schema
que o Atlas compara não foi alterado. O comando `rebase db generate` informa isso quando ocorre.
O bloco ainda é aplicado pelo `rebase db push` e pela verificação de schema na
inicialização; para incluí-lo explicitamente em uma migração, anexe `drizzle/search.sql` a ela.

### Alterando o bloco posteriormente

Uma coluna gerada mantém sua expressão, e o Postgres não pode alterar essa
expressão in-place — portanto, adicionar um campo, mover um peso (weight), alterar o idioma
ou habilitar o `unaccent` **não** é algo que o `ADD COLUMN IF NOT EXISTS` consiga
aplicar a uma coluna existente.

O Rebase registra uma assinatura (fingerprint) da expressão na coluna ao criá-la
e a compara a cada inicialização e a cada `db push`. Qualquer alteração é rejeitada explicitamente,
com a indicação das duas instruções necessárias para aplicá-la — um `DROP COLUMN` e um `ADD COLUMN`,
que reescrevem a tabela e reconstroem o índice GIN. Execute-as no momento de sua
escolha; nada reescreverá uma tabela em produção sem a sua autorização. (Ativar o `fuzzy` é uma alteração
aditiva — uma segunda coluna — e se aplica sem passar por nada disso.)

A inicialização é recusada em vez de prosseguir com a execução, pois a alternativa seria o problema que essa verificação
veio substituir: uma coluna que continua indexando o conjunto de campos anterior e uma busca que
não retorna nada para conteúdos que estão claramente presentes na linha.

## O que pode ser especificado em `fields`

| Caminho | Resolve para | Exemplo |
|---------|--------------|---------|
| Uma propriedade `string` | a coluna | `"full_name"` |
| Uma propriedade `string[]` | cada elemento | `"interests"` |
| Uma propriedade `map` | todo valor de string no documento | `"questionnaire"` |
| Um caminho dentro de um `map` | todo valor de string neste nível ou abaixo | `"questionnaire.certifications"` |

Um caminho para dentro de um map indexa **valores de string em qualquer nível de profundidade**
abaixo dele — arrays de strings, objetos aninhados, arrays de objetos. As *chaves* do JSON nunca são indexadas,
apenas os valores, para que o nome de um campo compartilhado por todas as linhas não se torne um termo que corresponda a
todas elas.

Indicar um enum, um UUID, uma coluna `json` (em vez de `jsonb`) ou um array de
números resultará em um erro de inicialização explicando o motivo. Enums, em particular, são um
vocabulário fixo: filtre-os usando `where`, que realiza busca exata e utiliza índice.

## Opções

### `language`

A configuração de busca textual do Postgres, que define o processo de lematização (stemming) e as palavras irrelevantes (stopwords).
`"spanish"` reduz `auditores` para `auditor` e remove `de`; o padrão,
`"simple"`, não faz nenhum dos dois.

`"simple"` é o padrão porque é a única opção que nunca erra — um lematizador
aplicado ao idioma incorreto desconfigura lexemas de forma silenciosa. Configure-o com o idioma
do seu conteúdo para obter o processo de lematização.

### `unaccent`

Remove os acentos antes de indexar, de forma que `auditoria` corresponda a `auditoría`.

Isso não é uma questão puramente cosmética em um idioma com acentos. O Postgres lematiza as duas grafias
como **lexemas diferentes** — `to_tsvector('spanish', 'auditoría')` produz
`auditor`, enquanto `'auditoria'` produz `auditori` — logo, sem essa opção, uma consulta digitada
sem acentos não encontrará nenhuma linha que os contenha, o que representa a maioria das buscas feitas
pela maioria dos usuários.

Requer a extensão `unaccent`.

### `fuzzy`

Também faz a correspondência com base em similaridade por trigramas, permitindo que aproximações sejam ranqueadas: `iso14000` alcançando
`ISO 14001`, algo que nenhum nível de lematização conseguiria fazer, já que
são lexemas completamente distintos.

```typescript
search: {
    fields: ["full_name", "questionnaire.certifications"],
    fuzzy: true,
    fuzzyThreshold: 0.3   // default
}
```

Adiciona uma segunda coluna gerada e um índice de trigramas, exigindo o `pg_trgm`.
Gera custos de tempo de escrita e disco, mas resolve o tipo mais comum de falha em buscas.

### `weight`

Cada campo recebe uma das quatro classes de peso do Postgres, de `A` (mais forte)
a `D`. O `ts_rank` pontua uma correspondência `A` muito acima de uma `D`, fazendo com que uma ocorrência
no nome tenha mais relevância do que uma menção de passagem em uma descrição longa. O padrão dos campos é `B`.

### `column`

A coluna gerada é nomeada como `search_vector`. Só altere esse nome se houver
conflito com uma coluna existente — uma vez criada, ela fará parte do seu schema, e
renomeá-la posteriormente exigirá exclusão e recriação, reescrevendo a tabela.

## Ranqueamento

`_score` é o `ts_rank` calculado com a mesma consulta que encontrou as linhas, e está
presente apenas quando a coleção ativou a busca avançada *e* a requisição continha uma string
de pesquisa.

Com a opção `fuzzy` ativada, a similaridade por trigramas é **somada** a esse ranqueamento. Isso não é um mero
refinamento — é o que viabiliza o `fuzzy` como critério de ordenação. Um erro de digitação não encontra nada
na busca exata, fazendo com que cada linha retornada tenha um `ts_rank` igual a zero; ordenar
apenas pelo rank traria o melhor resultado na ordem que a tabela quisesse.
Os dois termos são somados em vez de ponderados; assim, uma linha com correspondência exata
acumula ambos os valores e se sobrepõe a uma linha meramente parecida, sem a necessidade de um coeficiente
específico. Fora dessas duas condições, `orderBy: "_score"` torna-se um campo desconhecido e
retorna erro 400 em vez de retornar linhas desordenadas silenciosamente.

O `_score` não pode ser combinado com paginação por cursor (`startAfter`). A relevância é
calculada por consulta em vez de ser persistida, de modo que não há valor na linha do cursor
para comparar contra a próxima página, e duas requisições com strings de busca distintas
produzem pontuações em escalas incompatíveis. Use `limit`/`offset` para páginas ordenadas
por relevância.

## Por que esta linha correspondeu à busca?

Uma lista ranqueada mostra *quais* linhas correspondem, mas nunca o *porquê*. Peça a cada linha para
se justificar:

```typescript
const { data } = await client.data.talents
    .search("iso 14001", { explain: true })
    .orderBy("_score", "desc")
    .find();

data[0]._matches;
// [{ field: "questionnaire.certifications",
//    snippet: "<mark>ISO</mark> <mark>14001</mark> Lead Auditor" }]
```

O `field` é exatamente o caminho declarado em `fields`, permitindo mapeá-lo para
um rótulo legível na interface. Os campos retornam na ordem em que foram declarados.

Isso é aplicado por consulta, não por coleção, pois o custo recai sobre a consulta: uma execução de `ts_headline`
por campo declarado para cada linha retornada, e a função `ts_headline` processa o documento novamente
em vez de ler o índice. Ideal para uma página de resultados, inadequado para uma exportação em massa.

**O snippet contém marcação HTML por definição** — cada correspondência é envolvida por
`<mark>`. Renderize como HTML ou remova as tags, mas não trate o trecho como texto
puro e não confie no texto ao redor: ele reflete exatamente o que o usuário digitou.
Dividir a string nas tags `<mark>` e renderizar as partes é mais seguro do que usar
`dangerouslySetInnerHTML`.

Com o `unaccent` ativado, os snippets aparecem com acentos removidos — `Auditoria`, não
`Auditoría`. Executar `ts_headline` sobre o texto original não consegue localizar um termo retornado
por uma busca sem acentos, trazendo o texto sem nenhum destaque; um snippet legível com
destaque visual é preferível a um texto mais bem formatado que não destaca nada.

## Adicionando o bloco a uma coleção em produção

A coluna gerada é adicionada pela verificação de schema na inicialização, como qualquer outra
coluna, e seu índice é construído com `CREATE INDEX CONCURRENTLY` para não bloquear
operações de escrita. No entanto, adicionar uma coluna gerada do tipo *stored* reescreve a tabela; em bases
grandes, planeje essa operação como faria com qualquer outra reescrita estrutural.

## Mecanismos suportados

O bloco `search` é exclusivo do Postgres e é rejeitado na inicialização em outros mecanismos,
em vez de ser ignorado silenciosamente. Coleções MongoDB mantêm sua correspondência baseada
em regex; coleções Firestore utilizam o controlador externo de busca textual.

## Conteúdo relacionado

- [REST API](/docs/backend/api/) — os parâmetros de consulta usados para enviar a busca ao servidor
- [Índices](/docs/backend/indexes/) — o que o bloco de busca cria e quais são seus custos
- [Consultando Dados](/docs/sdk/querying/) — realizando buscas a partir do SDK cliente
