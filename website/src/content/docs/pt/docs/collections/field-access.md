---
sourceHash: f55095351eb33abe
title: Acesso a campos
sidebar_label: Acesso a campos
description: "Permissões de leitura e gravação por coluna por função com .access(), colunas que nunca saem do servidor com .private() e colunas que clientes não podem gravar com .readOnly(). Um chamador liberado pelas políticas da linha ainda assim não recebe uma coluna que suas funções não possam ler."
---

<span class="since-badge" data-since="0.31">Desde 0.31</span>

A [segurança a nível de linha (Row-level security)](/docs/collections/security-rules/) decide quais **linhas** um
chamador acessa. Três modificadores de coluna decidem quais **colunas de uma linha acessada**
ele vê e pode definir:

| Modificador | Leitura | Gravação |
|---|---|---|
| `.access({ read, write })` | as funções em `read`, quando fornecidas | as funções em `write`, quando fornecidas |
| `.private()` | ninguém, via API | ninguém, via API |
| `.readOnly()` | conforme a linha | ninguém, via API |

Relações aceitam as mesmas regras como opções: `rel.*(target, { access: { read, write } })`
e `rel.*(target, { private: true })`.

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const staff = defineTable("staff", {
    columns: {
        id:     col.integer().primaryKey().generatedByDefaultAsIdentity(),
        name:   col.text().notNull(),
        // Read by HR (and admins). Set by nobody through the API.
        salary: col.numeric({ precision: 10, scale: 2 }).access({ read: ["hr"], write: [] }),
    },
    rls: [{ operation: "select", access: "public" }],
});
```

A regra acima não aplica nenhum filtro de linha no `select`, portanto todo chamador que a API
permitir lê todas as linhas de staff. Apenas um chamador que possua a função `hr` obtém a coluna
`salary`, e ninguém pode defini-la via HTTP.

## A regra

<span class="since-badge" data-since="0.31">Desde 0.31</span>

`.access()` aceita duas listas opcionais, e uma lista omitida não é o mesmo que uma lista vazia —
essa diferença é a essência do recurso.

| `read` / `write` | Significado |
|------------------|-------------|
| omitido | Delega para a linha. Todos que o `rls` da tabela permite ler (ou gravar) a linha têm acesso à coluna. |
| `[]` | Ninguém, via API, sob qualquer privilégio — nem `admin`, nem a chave de serviço, nem uma leitura em processo. |
| `["hr"]` | Um chamador com `hr`, **ou** `admin`, **ou** código de servidor confiável sem uma requisição por trás. |

As funções são funções de aplicação do Rebase — as mesmas que `rebase.roles()` retorna
dentro de uma política e com as quais `policy.rolesOverlap` é compilado. Elas vêm do
contexto da chamada: `user.roles` na requisição autenticada.

### Por que `admin` sempre passa

Toda política de linha de base que o Rebase injeta carrega uma cláusula `rolesOverlap(['admin'])`, e
`rebase.dataAsAdmin` é executado como `{ uid: "service", roles: ["admin"] }`. Uma regra de campo
que pudesse bloquear um administrador de uma coluna do seu próprio banco de dados também
bloquearia o Studio de renderizá-la e a CLI de exportá-la. Se você precisa de uma coluna que
nenhum administrador leia via API, use `read: []`.

### Por que o plano confiável passa

Código de servidor sem uma requisição por trás — uma migração ou o adaptador de autenticação
verificando uma senha — lê sem nenhuma função, e uma lista de funções não se aplica a ele.
`[]` ainda se aplica: essa é uma declaração sobre a superfície da API, e não sobre quem
está chamando.

O `context.data` de um hook não faz parte desse plano. Dentro de uma requisição, ele lê com as
funções do chamador, portanto as regras de campo se aplicam ao que ele lê exatamente como se aplicam
à requisição: o próprio driver recusa filtros, ordenações, projeções, inclusões, buscas vetoriais,
agregações ou testes de unicidade que indiquem uma coluna que essas funções não possam ler
(`FIELD_NOT_READABLE`), e responde a um nome `.private()` da mesma forma que responde a um erro de
digitação — assim como no REST e no socket.

## `.private()` e `.readOnly()` são o mesmo mecanismo

<span class="since-badge" data-since="0.31">Desde 0.31</span>

`.private()` é o equivalente a `.access({ read: [], write: [] })`, com uma diferença: uma
coluna privada também é deixada de fora do OpenAPI, dos tipos do SDK e dos esquemas de ferramentas
do MCP, para que seu nome também não seja público (consulte [Consultas](#consultas)). Uma coluna
não pode ser `.private()` e declarar `.access()` ao mesmo tempo; o esquema será recusado.

`.readOnly()` é `write: []`: ninguém grava na coluna via API, independentemente de sua função,
enquanto padrões (defaults), gatilhos (triggers) e código de servidor continuam preenchendo-a.
As leituras são delegadas à linha, ou ao `.access({ read })` quando ambos são especificados.

## O que um chamador vê

### Leituras

Um campo que você não pode ler fica **ausente** da resposta. Não é retornado `null`, nem uma string
vazia — a chave simplesmente não está lá.

```json
// GET /api/data/staff/1  as a caller holding `staff`
{ "id": 1, "name": "Ada" }

// the same row as a caller holding `hr`
{ "id": 1, "name": "Ada", "salary": 90000 }
```

Isso é intencional. Um valor omitido servido como `null` seria indistinguível de um `null` armazenado,
permitindo que um cliente mapeasse toda a coluna contando-os — e um `update` que devolvesse a linha
sobrescreveria o valor real com o null recebido.

Isso se aplica a todas as saídas: listagem, busca individual, alvos de relacionamento incluídos com
`?include=`, resultados de `_batch`, frames em tempo real de `.listen()`, resultados de agregações e
snapshots de [histórico](#histórico).

O valor de uma relação são suas linhas relacionadas, portanto uma relação que você não pode ler é
retida por completo. `?include=` a remove da linha, juntamente com seu `_count`, em qualquer interface:
REST, SDK, `.listen()` e includes aninhados um nível abaixo. Nomeá-la em qualquer outro lugar é recusado
como um campo (consulte [Consultas](#consultas)).

### Consultas

Um `where`, `orderBy`, `fields`, `select` agregado ou `groupBy` que mencione um campo que você
não pode ler resulta em um erro **400 `FIELD_NOT_READABLE`**. O mesmo vale para um filtro por meio de
uma relação em um campo de seu destino que você não pode ler (`?author.salary=gt.1`), uma ordenação
agregada sobre ele (`orderBy=max(staff.salary)`), e uma relação ilegível nomeada em um caminho aninhado
(`/departments/1/members`, `/departments/1/members/7`) ou em uma ordenação agregada (`orderBy=count(members)`):

```http
GET /api/data/staff?salary=gt.100000
```

```json
{
  "error": {
    "code": "FIELD_NOT_READABLE",
    "message": "'salary' is not readable on table 'staff' with your roles, so it cannot be used in a filter.",
    "details": {
      "collection": "staff",
      "fields": ["salary"],
      "violations": [
        { "field": "salary", "code": "access", "message": "'salary' is not readable with your roles." }
      ]
    }
  }
}
```

Sem isso, o valor seria legível um predicado por vez: vinte requisições equivaleriam a uma busca
binária sobre um salário.

O erro **informa o nome do campo**. Essa é uma decisão de design, não um descuido: o documento
OpenAPI publicado lista todas as colunas de todas as tabelas — ele é servido a partir da aplicação,
não pelo roteador de dados autenticado —, portanto os nomes dos campos já são públicos. Ocultar o
nome aqui não protegeria nada e responderia a um erro de digitação legítimo do chamador com "campo desconhecido",
levando-o a procurar um erro de ortografia inexistente. **Os nomes dos campos são públicos; os valores dos campos não são.**

Exceto para colunas `.private()`. O OpenAPI, `describe_table` e o SDK gerado as omitem, de modo que
seus nomes não são públicos, e responder com "não legível" confirmaria que elas existem. Um filtro,
`orderBy`, `fields`, `include`, `select` agregado ou `groupBy`, ou `vector_search` que nomeie uma coluna privada
recebe exatamente a mesma resposta dada a um nome incorreto — `UNKNOWN_FILTER_FIELD`, `UNKNOWN_ORDER_BY_FIELD`,
`UNKNOWN_FIELD`, `UNKNOWN_RELATION`, `UNKNOWN_AGGREGATE_FIELD` ou `UNKNOWN_VECTOR_PROPERTY`, com a mesma
mensagem e detalhes — e nenhuma resposta de campo desconhecido a listará entre os campos válidos.

### Gravações

Um valor enviado para um campo que você não pode gravar resulta em um erro **400**, nunca em uma chave
silenciosamente descartada — uma gravação que descarta um campo reportaria sucesso para uma edição que
não aconteceu.

| Código | Quando |
|--------|--------|
| `FIELD_NOT_WRITABLE` | `write` é uma lista de funções que você não satisfaz. Seu colega pode obter um 200 com o mesmo corpo de requisição. |
| `VALIDATION_EXCLUDED_FIELDS` | `write` é `[]`, ou a coluna é `.private()` ou `.readOnly()`. Ninguém pode gravá-la; a resposta é a mesma para todos os chamadores. |

Ambos trazem `details.violations` indexados pelo nome transmitido na requisição. Isso é aplicado na
criação, em `PATCH`/`PUT`, `/bulk`, `_batch`, upserts, operações de campo (`{ "salary": { "$inc": 1000 } }`
menciona `salary` como qualquer outro valor) e no frame `SAVE` do WebSocket.

Uma operação de campo também exige `read` no respectivo campo. Uma operação em um campo que você pode
gravar mas não ler é recusada com `FIELD_NOT_READABLE`: saber se a operação ultrapassou um limite revelaria
o valor que você não tem permissão para ver.

### Uma relação vinculada segue sua coluna de chave

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Um `belongsTo` e a coluna de chave à qual ele está vinculado são o mesmo campo com duas representações.
Gravar `{ "reviewer": 7 }` está sujeito a todas as regras de `reviewerId` (sua regra de gravação,
`.readOnly()`, `.private()`, stamp de criação, coluna de tenant); enviar ambos com valores diferentes
resulta em `400 VALIDATION_INVALID_VALUE`. Um chamador que não pode ler `reviewerId` não recebe
`reviewer` em um `include`, e uma entrada de filtro, ordenação ou `fields` que o mencione responde com
`FIELD_NOT_READABLE`; por trás de uma chave `.private()`, a relação simplesmente não existe para os clientes.
O endpoint de esquema, o OpenAPI e o MCP descrevem os dois juntos.

O mesmo vale para todas as relações, por meio do que quer que suas junções leiam: um `hasMany` / `hasOne`
lê a chave estrangeira do destino; um `via` lê todas as colunas nas quais suas etapas fazem join, em cada
tabela por onde passa. Um chamador que não possa ler uma dessas colunas não obtém a relação em um `include`
ou em um `_count`, recebe `FIELD_NOT_READABLE` ao filtrar ou ordenar por meio dela (uma relação desconhecida
quando a coluna for `.private()`), e não a vê descrita.

Um `via` que passa por uma tabela que o servidor não expõe — uma tabela retida (`TABLE_WITHHELD`) ou que
suas tabelas não declaram — fica inacessível para qualquer chamador, incluindo código confiável: suas
colunas de junção contam como ilegíveis e não graváveis, de modo que a relação é omitida de `include`,
e qualquer filtro, ordenação ou caminho que passe por ela é recusado (`FIELD_NOT_READABLE` ou `503 TABLE_WITHHELD`
mencionando a tabela retida).

Um `manyToMany` cuja junção seja uma tabela declarada por você (`through` aponta para um `defineTable`)
obedece às regras de coluna dessa tabela: uma gravação que defina uma coluna de link como `.readOnly()`,
`.private()` ou bloqueada por `access.write` na junção é recusada (`VALIDATION_EXCLUDED_FIELDS` /
`FIELD_NOT_WRITABLE`), assim como um campo `_pivot` bloqueado pela junção. O mesmo se aplica a rotas
aninhadas (`POST`, `PATCH` e `DELETE /:table/:id/:relation/:targetId`, bem como edições de `_pivot`)
e ao WebSocket. Uma junção criada automaticamente pelo Rebase não possui regras próprias.

A opção `strictWrites: false` em uma tabela apenas permite a passagem para o driver de chaves não declaradas
pela tabela. Ela nunca afrouxa uma regra em uma coluna declarada, stamp, tenant, chave, destino de relação
ou `_pivot`.

## Busca

<span class="since-badge" data-since="0.31">Desde 0.31</span>

A busca padrão (fallback) — em tabelas sem bloco `search` — executa correspondências com `ILIKE` em
suas colunas de texto e ignora aquelas que o chamador não pode ler. Nada vaza por meio dela.

Uma tabela que **declare** um [bloco `search`](/docs/backend/search) é compilada em uma única coluna
gerada de `tsvector` compartilhada por todos os chamadores. Não há variante dela por função; portanto,
uma coluna restrita listada em `search.fields` continuaria *passível de correspondência* para chamadores
que nunca poderiam ver seu valor — tornando-a recuperável termo a termo. O esquema é recusado caso essa
combinação seja encontrada: remova a coluna de `search.fields` ou elimine a restrição de leitura. Uma
coluna `tenant` também não pode ter restrição de leitura.

## Histórico

O [Histórico de entidades](/docs/backend/history) armazena a linha completa e é servido a qualquer pessoa
que possa ler a linha — o critério de acesso é "você pode buscar esta entidade", não "você é um administrador".
Portanto, a regra de leitura também é aplicada a cada snapshot armazenado: a entrada continua sendo listada,
com quem a alterou e quando, e as colunas restritas são removidas de seus `values`.

A reversão não é afetada. A rota de reversão lê a entrada armazenada no lado do servidor; dessa forma,
um chamador pode restaurar uma versão cujos campos ele não consiga ver na totalidade — exatamente como
ele já pode sobrescrever uma linha sem ler todos os seus dados.

## O que o CMS exibe

Não há nada a configurar. O CMS lê por meio da mesma API; portanto, uma coluna que o chamador não pode ler
nunca chega ao navegador e o formulário não a renderiza; uma coluna que ele não pode gravar é recusada se
algo tentar enviá-la. Essa é uma garantia do lado do servidor, diferentemente de ocultar um campo no CMS,
o que apenas impede sua *renderização* enquanto mantém o valor presente no JSON.

## Tipos gerados e OpenAPI

Os tipos `Row`, `Insert` e `Update` do SDK têm um formato único para todos os chamadores — não existe um
tipo `Row` que atenda simultaneamente a um leitor com o papel `hr` e a outro sem ele —, portanto, regras
baseadas em **funções (roles)** não os alteram. Uma coluna `.private()` fica ausente de todos os três tipos,
e uma coluna `.readOnly()` fica ausente de `Insert` e `Update`. Os [tipos inferidos](/docs/schema/types/)
seguem a mesma regra.

O documento OpenAPI declara a regra em vez de fingir ser personalizado por chamador. Cada coluna com restrição
carrega o atributo `x-rebase-access`:

```json
"salary": {
  "type": "number",
  "description": "Salary — Field access: readable by `hr` (and `admin`); writable by nobody through the API. A caller without the role does not receive the field at all — it is absent, not null.",
  "x-rebase-access": { "read": ["hr"], "write": [] }
}
```

Um campo que ninguém pode ler fica ausente do esquema de leitura e dos parâmetros de filtro; um campo
que ninguém pode gravar fica ausente do esquema de entrada. Os dois sentidos são tratados como esquemas
separados e avaliados de forma independente; dessa forma, um token que um administrador envia via POST e
nunca lê de volta aparece no corpo da requisição, mas não na linha retornada.

## Gravações em processo

Gravações em processo — como `context.data` em um hook, ou `rebase.dataAsAdmin` em um hook, em uma função
ou em um job cron — não passam pela verificação de gravação: `.readOnly()`, um `access.write` por campo e
`.private()` são regras que operam na fronteira da API. É isso que torna a regra viável: algo precisa ser
capaz de gravar o hash da senha. O que permanece válido em processo, tanto para uma coluna quanto para o
link associado a ela: stamps do servidor têm precedência sobre valores fornecidos, uma linha não pode mudar
de tenant e sua chave não pode ser alterada. O Row-level security continua valendo em todos os lugares.

Leituras por meio de `rebase.dataAsAdmin` possuem a função `admin`, de modo que regras de função não ocultam
nada delas. `[]` ainda oculta — inclusive de `dataAsAdmin`. Use [`rebase.sql()`](/docs/backend/custom-functions)
se precisar da coluna bruta.

## Validação

<span class="since-badge" data-since="0.31">Desde 0.31</span>

`.access()` em uma coluna, e `access` em uma relação, geram um erro ao carregar o módulo, a menos que
`read` e `write` sejam listas de nomes de funções não vazios: fornecer uma string onde se espera uma
lista (`read: "admin"`) resulta em recusa imediata, em vez de ser interpretado incorretamente.

As seguintes situações são recusadas no momento da compilação do esquema, antes de o servidor atender a qualquer requisição:

- `.private()` e `.access()` na mesma coluna: eles são o mesmo mecanismo;
- Uma coluna com restrição de leitura listada em `search.fields` da tabela ou usada como seu campo de `tenant`;
- Uma chave primária marcada como `.private()`: a chave primária é a forma como cada linha é endereçada.

Os *nomes* das funções não são validados contra um conjunto pré-definido: funções são dados da aplicação,
criados e excluídos enquanto o servidor está em execução. Um erro de digitação no nome resultará em um campo
que ninguém pode ler, o que representa um comportamento de falha seguro.

## Veja também

- [Segurança a nível de linha (Row-level security)](/docs/collections/security-rules/) — quais linhas um chamador acessa
- [Colunas](/docs/schema/columns/) — todos os modificadores de coluna
- [Códigos de erro](/docs/backend/errors/) — `FIELD_NOT_READABLE`, `FIELD_NOT_WRITABLE`
