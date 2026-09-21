---
sourceHash: a6c102be4bcc017e
title: Busca
sidebar_label: Busca
description: Como o .search() se comporta por padrão e como habilitar a busca textual ranqueada em uma coleção Postgres nos campos que você especificar — incluindo conteúdo em JSONB e arrays.
---

O `.search("term")` funciona em todas as coleções sem configuração prévia. Em que ele
é compilado depende se a coleção solicitou algo a mais.

## O padrão

Sem nenhuma configuração, o `.search()` é uma **correspondência de substring que não diferencia maiúsculas de minúsculas (case-insensitive)**,
combinada com OR entre as propriedades `string` de nível superior da coleção. A string de busca
é dividida por espaços em branco e cada termo precisa corresponder — mas eles podem corresponder
a propriedades diferentes, de modo que um nome armazenado em duas colunas ainda é encontrado:

```sql
-- .search("ada lovelace")
WHERE (first_name ILIKE '%ada%'      OR last_name ILIKE '%ada%')
  AND (first_name ILIKE '%lovelace%' OR last_name ILIKE '%lovelace%')
```

Envolva uma sequência entre aspas duplas — `.search('"ada lovelace"')` — para buscar
pela frase exata, da mesma forma que o fluxo de texto completo (full-text) abaixo os interpreta.

Isso é suficiente para uma coleção pequena com seu texto em colunas simples. Há
três limitações que nenhuma configuração interna consegue resolver:

- **Não é possível enxergar dentro de propriedades `map` ou `array`.** Uma coleção que mantém
  seu conteúdo pesquisável em JSONB — tags, certificações, um questionário — terá
  uma caixa de busca que silenciosamente não encontra nada.
- **Não há relevância.** As linhas retornam na ordem do `orderBy`, então o melhor resultado
  pode estar na página sete.
- **Não é possível usar um índice.** Um `%` no início anula uma B-tree, fazendo com que cada busca
  seja uma varredura sequencial. Aceitável com mil linhas; um desastre com um milhão.

O termo é correspondido **literalmente**: `%` e `_` são metacaracteres do LIKE e
são escapados antes da construção do padrão, portanto buscar por `50%` pesquisa por
`50%` em vez de retornar todas as linhas. Se você quiser caracteres curinga, o operador
de filtro `like` aceita um padrão (`.where("title", "like", "post-%")`); o `.search()`
não aceita.

Uma busca de uma única palavra compila exatamente para o SQL de sempre.

## Habilitando o recurso

Declare um bloco `search` em uma coleção Postgres, especificando os campos que você
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

Nada é inferido. Um campo só é pesquisado se e somente se você o declarar, e um caminho
que não puder ser resolvido falha na inicialização em vez de ser ignorado silenciosamente — um
campo de busca que você acredita estar ativo e não está é exatamente a falha que este bloco
existe para evitar.

O `.search()` então é compilado para uma correspondência de busca textual ranqueada, e as linhas
retornam com um `_score`:

```typescript
const { data } = await client.data.talents
    .search("auditor iso 14001")
    .orderBy("_score", "desc")
    .find();
```

### O que essa declaração cria

Uma coluna `tsvector`, `GENERATED ALWAYS AS … STORED`, e um índice GIN sobre ela.
O Postgres recalcula a coluna a cada gravação em um campo de origem e recusa qualquer
tentativa de gravação direta nela, garantindo que o índice não fique desalinhado da linha.
A coluna nunca é retornada pela API.

Eles são gerados em `drizzle/search.sql`, ao lado de `schema.sql` e
`policies.sql`, e o `rebase db push` os aplica para você — nada adicional para
executar. Eles têm seu próprio arquivo porque uma coluna `tsvector` gerada precisa que uma
função auxiliar `IMMUTABLE` exista primeiro (`unaccent` é apenas `STABLE`, e
o achatamento de um documento `jsonb` precisa de uma função que retorne conjuntos), e o Atlas —
o mecanismo por trás do `db push` — não suporta o gerenciamento de funções em seu plano gratuito.

Uma consequência importante de saber se você faz deploy via migração em vez de push:
adicionar apenas um bloco `search` não gera nenhuma migração, porque o esquema que o
Atlas compara não foi alterado. O `rebase db generate` avisa quando isso acontece.
O bloco ainda é aplicado pelo `rebase db push` e pela validação do esquema na inicialização;
para incluí-lo explicitamente em uma migração, anexe o `drizzle/search.sql` a ela.

### Alterando o bloco posteriormente

Uma coluna gerada carrega sua expressão, e o Postgres não pode alterar essa expressão
no local — portanto, adicionar um campo, alterar um peso, mudar o idioma ou ativar
o `unaccent` **não** é algo que o `ADD COLUMN IF NOT EXISTS` consiga aplicar a uma coluna
que já existe.

O Rebase registra um fingerprint da expressão na coluna quando a cria e o compara a cada
inicialização e a cada `db push`. Uma alteração é recusada de forma explícita, com as
duas instruções necessárias para aplicá-la — um `DROP COLUMN` e um `ADD COLUMN`, que
reescrevem a tabela e recriam o índice GIN. Execute-as no momento de sua escolha;
nada reescreverá uma tabela em produção sem a sua autorização. (Ativar o `fuzzy` é
aditivo — uma segunda coluna — e se aplica sem nada disso.)

A inicialização é recusada em vez de servir as requisições, porque a alternativa é o que
essa verificação veio substituir: uma coluna que continua indexando o conjunto de campos
anterior e uma busca que não retorna nada para conteúdos que estão claramente na linha.

## O que você pode especificar em `fields`

| Caminho | Resolve para | Exemplo |
|------|-------------|---------|
| Uma propriedade `string` | a coluna | `"full_name"` |
| Uma propriedade `string[]` | cada elemento | `"interests"` |
| Uma propriedade `map` | cada valor de string no documento | `"questionnaire"` |
| Um caminho dentro de um `map` | cada valor de string naquele ponto ou abaixo dele | `"questionnaire.certifications"` |

Um caminho para um map indexa **valores de string em qualquer profundidade** abaixo dele — arrays
de strings, objetos aninhados, arrays de objetos. As *chaves* do JSON nunca são indexadas, apenas
os valores, de modo que o nome de um campo comum a todas as linhas não se torne um termo que
corresponda a todas as linhas.

Especificar um enum, um UUID, uma coluna `json` (em vez de `jsonb`) ou um array de números
gera um erro na inicialização explicando o motivo. Enums, em particular, têm um vocabulário fixo:
filtre por eles usando `where`, que é exato e utiliza um índice.

## Opções

### `language`

A configuração de busca textual do Postgres, que define o stemming e as stopwords.
`"spanish"` reduz `auditores` para `auditor` e remove `de`; o padrão,
`"simple"`, não faz nenhum dos dois.

`"simple"` é o padrão porque é a única opção que nunca erra — um stemmer
aplicado ao idioma errado corrompe lexemas silenciosamente. Defina-o para o
idioma do seu conteúdo para habilitar o stemming.

### `unaccent`

Remove os acentos antes da indexação, fazendo com que `auditoria` corresponda a `auditoría`.

Isso não é meramente cosmético em idiomas com acentuação. O Postgres reduz as duas grafias
para **lexemas diferentes** — `to_tsvector('spanish', 'auditoría')` produz `auditor`,
enquanto `'auditoria'` produz `auditori` — portanto, sem isso, uma consulta digitada sem
acentos não encontrará nenhuma linha que os contenha, o que representa a maioria das buscas
feitas pelos usuários.

Requer a extensão `unaccent`.

### `fuzzy`

Também realiza correspondência por similaridade de trigramas, para que correspondências aproximadas
continuem sendo ranqueadas: `iso14000` encontrando `ISO 14001`, algo que nenhum nível de
stemming faria porque são simplesmente lexemas diferentes.

```typescript
search: {
    fields: ["full_name", "questionnaire.certifications"],
    fuzzy: true,
    fuzzyThreshold: 0.3   // default
}
```

Adiciona uma segunda coluna gerada e um índice de trigramas, exigindo o `pg_trgm`.
Custa tempo de gravação e espaço em disco; resolve a classe mais comum de falhas de busca.

### `weight`

Cada campo recebe uma das quatro classes de peso do Postgres, de `A` (mais forte)
a `D`. O `ts_rank` pontua uma correspondência em `A` muito acima de uma em `D`,
que é como um nome supera uma menção passageira em uma descrição longa. O padrão
para os campos é `B`.

### `column`

A coluna gerada é chamada de `search_vector`. Altere apenas se houver conflito com
uma coluna que você já possui — ela passa a fazer parte do seu esquema uma vez criada,
e renomeá-la posteriormente exige remoção e recriação, o que reescreve a tabela.

## Ranqueamento

O `_score` é o `ts_rank` calculado em relação à mesma consulta com a qual as linhas foram
correspondidas, e está presente apenas quando a coleção habilitou o recurso *e* a requisição
incluiu uma string de busca.

Com o `fuzzy` ativado, a similaridade de trigramas é **somada** a essa classificação. Isso não é
um mero refinamento — é o que torna o `fuzzy` um ranqueamento de fato. Um erro de digitação
não corresponde a nada no caminho exato, então cada linha encontrada terá um `ts_rank` exatamente
zero; ordenar apenas por rank retornaria a melhor correspondência em qualquer ordem arbitrária da
tabela. Os dois termos são somados em vez de ponderados, de modo que uma linha que correspondeu
exatamente contribui com ambos e supera uma linha apenas similar, sem a necessidade de um coeficiente
explícito. Fora dessas duas condições, `orderBy: "_score"` é considerado um campo desconhecido e
retorna 400 em vez de retornar silenciosamente linhas não ordenadas.

O `_score` não pode ser combinado com paginação por cursor (`startAfter`). A relevância é
computada por consulta em vez de ser armazenada, portanto não há valor na linha do cursor
para comparar com a próxima página, e duas requisições com strings de busca diferentes geram
pontuações que não estão na mesma escala. Use `limit`/`offset` para páginas ordenadas por relevância.

## Por que esta linha correspondeu?

Uma lista ranqueada informa *quais* linhas correspondem, mas nunca o *porquê* de uma delas estar ali.
Peça para cada linha se explicar:

```typescript
const { data } = await client.data.talents
    .search("iso 14001", { explain: true })
    .orderBy("_score", "desc")
    .find();

data[0]._matches;
// [{ field: "questionnaire.certifications",
//    snippet: "<mark>ISO</mark> <mark>14001</mark> Lead Auditor" }]
```

`field` é o caminho exatamente como declarado em `fields`, permitindo mapeá-lo para
um rótulo de exibição. Os campos retornam na ordem em que foram declarados.

Ocorre por consulta, não por coleção, porque o custo computacional é por consulta: um `ts_headline`
por campo declarado para cada linha retornada, e o `ts_headline` analisa o documento novamente
em vez de ler o índice. Adequado para uma página de resultados, inadequado para uma exportação.

**O snippet contém marcação por definição** — cada correspondência é envolvida por `<mark>`.
Renderize-o como HTML ou remova as tags, mas não o trate como texto puro, e não confie no
texto ao redor: ele conterá o que quer que o usuário tenha digitado. Dividir a string
por `<mark>` e renderizar as partes é mais seguro do que usar `dangerouslySetInnerHTML`.

Com o `unaccent` ativado, os snippets são lidos com os acentos normalizados — `Auditoria`, não
`Auditoría`. O `ts_headline` sobre o texto original não consegue encontrar uma correspondência
gerada por uma consulta sem acentos, portanto retornaria o texto sem nenhum destaque; um snippet
legível com destaques é melhor do que um visualmente perfeito que silenciosamente não destaca nada.

## Adicionando o bloco a uma coleção em produção

A coluna gerada é adicionada pela verificação de esquema na inicialização, como qualquer outra
coluna, e seu índice é construído com `CREATE INDEX CONCURRENTLY` para que as gravações não sejam
bloqueadas. Adicionar uma coluna gerada *armazenada* de fato reescreve a tabela, portanto, em tabelas
grandes, planeje essa operação como qualquer outra reescrita.

## Motores compatíveis

O bloco `search` é exclusivo do Postgres e é rejeitado na inicialização em outros mecanismos,
em vez de ser silenciosamente ignorado. As coleções do MongoDB mantêm a correspondência baseada
em regex; as coleções do Firestore utilizam o controlador externo de busca textual.

## Conteúdo relacionado

- [REST API](/docs/backend/api/) — os parâmetros de consulta com os quais uma busca chega ao servidor
- [Indexes](/docs/backend/indexes/) — o que o bloco search cria e qual é o seu custo
- [Querying Data](/docs/sdk/querying/) — realizando buscas a partir do SDK cliente
