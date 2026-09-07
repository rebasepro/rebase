---
sourceHash: 04421ade309db1ce
title: Busca
sidebar_label: Busca
description: Como o .search() se comporta por padrão e como habilitar uma coleção Postgres para busca em texto completo ranqueada nos campos nomeados por você — incluindo conteúdo JSONB e array.
---

O `.search("term")` funciona em todas as coleções sem configuração. O que ele
compila depende de a coleção ter solicitado algo a mais ou não.

## O padrão

Sem nenhuma configuração, o `.search()` é uma **correspondência de substring insensível a maiúsculas e minúsculas** (case-insensitive),
combinada com `OR` entre as propriedades `string` de nível superior da coleção:

```sql
WHERE name ILIKE '%term%' OR description ILIKE '%term%'
```

Isso é suficiente para uma coleção pequena com seu texto em colunas simples. Possui
três limitações que nenhuma configuração interna consegue resolver:

- **Ele não consegue ver dentro de propriedades `map` ou `array`.** Uma coleção que
  mantém seu conteúdo pesquisável em JSONB — tags, certificações, um questionário — tem
  uma caixa de busca que silenciosamente não encontra nada.
- **Ele não possui relevância.** As linhas retornam na ordem do `orderBy`,
  portanto a melhor correspondência pode estar na página sete.
- **Ele não pode usar um índice.** Um `%` no início anula uma B-tree, fazendo com que
  cada busca seja uma varredura sequencial (sequential scan). Tudo bem para mil linhas;
  um abismo para um milhão.

O padrão não muda, e uma coleção que não habilitou o recurso compila para
exatamente o mesmo SQL de sempre.

## Habilitando o recurso

Declare um bloco `search` em uma coleção Postgres, nomeando os campos que você quer
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

Nada é inferido. Um campo é pesquisado se, e somente se, você o nomear, e um caminho
que não é resolvido falha na inicialização em vez de ser ignorado silenciosamente —
um campo de busca que você acredita estar ativo, mas não está, é exatamente a falha
que este bloco existe para prevenir.

O `.search()` então é compilado para uma correspondência de texto completo (full-text)
ranqueada, e as linhas retornam com um `_score`:

```typescript
const { data } = await client.data.talents
    .search("auditor iso 14001")
    .orderBy("_score", "desc")
    .find();
```

### O que a declaração cria

Uma coluna `tsvector`, `GENERATED ALWAYS AS … STORED`, e um índice GIN nela.
O Postgres recomputa a coluna a cada escrita em um campo de origem e recusa qualquer
tentativa de escrevê-la diretamente, garantindo que o índice nunca fique desalinhado
da linha. A coluna nunca é retornada pela API.

Eles são gerados em `drizzle/search.sql`, ao lado de `schema.sql` e
`policies.sql`, e o `rebase db push` os aplica para você — nada extra a ser
executado. Eles recebem seu próprio arquivo porque uma coluna `tsvector` gerada
precisa que uma função auxiliar `IMMUTABLE` exista primeiro (`unaccent` é apenas
`STABLE`, e achatar um documento `jsonb` precisa de uma função que retorne conjuntos),
e o Atlas — o mecanismo por trás do `db push` — não pode gerenciar funções em seu plano gratuito.

Uma consequência importante de saber se você faz deploy por migração em vez de push:
adicionar um bloco `search` isoladamente não produz nenhuma migração, porque o esquema
que o Atlas compara não mudou. O `rebase db generate` avisa quando isso acontece.
O bloco ainda é aplicado pelo `rebase db push` e pela verificação de esquema no momento
do boot; para colocá-lo em uma migração explicitamente, anexe o conteúdo de `drizzle/search.sql` a ela.

## O que você pode nomear em `fields`

| Caminho | Resolve para | Exemplo |
|---------|--------------|---------|
| Uma propriedade `string` | a coluna | `"full_name"` |
| Uma propriedade `string[]` | cada elemento | `"interests"` |
| Uma propriedade `map` | cada valor de string no documento | `"questionnaire"` |
| Um caminho dentro de um `map` | cada valor de string nesse ponto ou abaixo dele | `"questionnaire.certifications"` |

Um caminho para um map indexa **valores de string em qualquer profundidade** abaixo dele —
arrays de strings, objetos aninhados, arrays de objetos. Chaves JSON nunca são
indexadas, apenas valores, de forma que um nome de campo comum a todas as linhas não se
torne um termo que corresponda a todas as linhas.

Nomear um enum, um UUID, uma coluna `json` (em vez de `jsonb`) ou um array de números gera
um erro de inicialização explicando o motivo. Enums, em particular, são um vocabulário
fixo: filtre-os com `where`, que é exato e utiliza um índice.

## Opções

### `language`

A configuração de busca de texto do Postgres, que decide o radicalismo (stemming) e as palavras de parada (stopwords).
`"spanish"` reduz `auditores` para `auditor` e remove `de`; o padrão,
`"simple"`, não faz nenhum dos dois.

`"simple"` é o padrão porque é a única escolha que nunca está errada — um
stemmer aplicado ao idioma errado corrompe lexemas silenciosamente. Defina-o para o
idioma do seu conteúdo para obter stemming.

### `unaccent`

Remove acentos antes de indexar, para que `auditoria` corresponda a `auditoría`.

Isso não é algo meramente cosmético em um idioma acentuado. O Postgres reduz as duas
grafias para **lexemas diferentes** — `to_tsvector('spanish', 'auditoría')` produz
`auditor` enquanto `'auditoria'` produz `auditori` — portanto, sem isso, uma consulta
digitada sem acentos perde todas as linhas que os possuem, que é a forma como a maioria dos
usuários digita a maioria das consultas.

Requer a extensão `unaccent`.

### `fuzzy`

Também corresponde por similaridade de trigramas, para que correspondências aproximadas
ainda sejam ranqueadas: `iso14000` alcançando `ISO 14001`, algo que nenhum nível de
stemming faria porque são simplesmente lexemas diferentes.

```typescript
search: {
    fields: ["full_name", "questionnaire.certifications"],
    fuzzy: true,
    fuzzyThreshold: 0.3   // padrão
}
```

Adiciona uma segunda coluna gerada e um índice de trigrama, e requer `pg_trgm`.
Custa tempo de escrita e disco; previne a classe mais comum de falha de busca.

### `weight`

Cada campo carrega uma das quatro classes de peso do Postgres, de `A` (mais forte)
a `D`. O `ts_rank` pontua um resultado em `A` muito acima de um em `D`, que é como um
nome supera uma menção passageira em uma longa descrição. O padrão dos campos é `B`.

### `column`

A coluna gerada é nomeada `search_vector`. Altere-a apenas se houver colisão com uma
coluna que você já possui — ela faz parte do seu esquema uma vez criada, e renomeá-la
posteriormente exige exclusão e recriação, o que reescreve a tabela.

## Ranqueamento

O `_score` é o `ts_rank` aplicado contra a mesma consulta com a qual as linhas corresponderam,
e está presente apenas quando a coleção habilitou o recurso *e* a requisição incluiu uma string de busca.

Com `fuzzy` ativado, a similaridade de trigramas é **adicionada** a esse rank. Isso não é um
refinamento — é o que faz do `fuzzy` um ranqueamento. Um erro de digitação não corresponde a nada
no caminho exato, então cada linha encontrada tem um `ts_rank` exatamente igual a zero; ordenar apenas pelo
rank retornaria a melhor correspondência na ordem que a tabela quisesse. Os dois termos são somados em vez de
ponderados, portanto, uma linha que correspondeu exatamente contribui com ambos e supera uma linha apenas similar,
sem precisar de um coeficiente para definir isso. Fora dessas duas condições, `orderBy: "_score"` é um campo
desconhecido e retorna 400 em vez de retornar linhas não ordenadas silenciosamente.

O `_score` não pode ser combinado com paginação por cursor (`startAfter`). A relevância é
calculada por consulta em vez de armazenada, portanto não há valor na linha do cursor para
comparar a página seguinte, e duas requisições com strings de busca diferentes produzem pontuações
que não estão na mesma escala. Use `limit`/`offset` para páginas ordenadas por relevância.

## Por que esta linha correspondeu à busca?

Uma lista ranqueada informa *quais* linhas, mas nunca *por que* uma delas está ali.
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

`field` é o caminho exatamente como declarado em `fields`, para que você possa
mapeá-lo para um rótulo de exibição. Os campos retornam na ordem em que você os declarou.

Por consulta, não por coleção, porque o custo é por consulta: um `ts_headline`
por campo declarado por linha retornada, e o `ts_headline` reanalisa o documento em
vez de ler o índice. Certo para uma página de resultados, errado para uma exportação.

**O trecho (snippet) contém marcação por construção** — cada resultado é
envolvido por `<mark>`. Renderize-o como HTML ou remova as tags, mas não o trate
como texto puro, e não confie no texto ao redor: é qualquer coisa que o usuário
digitou. Dividir em `<mark>` e renderizar as partes é mais seguro do que
`dangerouslySetInnerHTML`.

Com `unaccent` ativado, os trechos são lidos com os acentos removidos — `Auditoria`, não
`Auditoría`. O `ts_headline` sobre o texto original não consegue encontrar um resultado
gerado por uma consulta sem acentos, portanto retornaria o texto sem nada marcado; um
trecho legível que destaca o resultado é melhor do que um mais bonito que silenciosamente
não destaca nada.

## Adicionando o bloco a uma coleção em execução

A coluna gerada é adicionada pela verificação de esquema na inicialização, como qualquer
outra coluna, e seu índice é construído com `CREATE INDEX CONCURRENTLY` para que as
escritas não sejam bloqueadas. Adicionar uma coluna gerada do tipo *stored* reescreve a tabela,
portanto, em uma tabela grande, planeje isso como qualquer outra reescrita.

## Quais mecanismos

O bloco `search` é exclusivo do Postgres e é rejeitado na inicialização em outros mecanismos,
em vez de ser silenciosamente ignorado. Coleções do MongoDB mantêm sua correspondência baseada em
regex; coleções do Firestore usam o controlador externo de busca de texto.

---
