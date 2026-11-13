---
sourceHash: 8ce5fe3122103e0c
title: Acesso a campos
sidebar_label: Acesso a campos
description: "Permissões de leitura e escrita por coluna por papel com .access(), colunas que nunca saem do servidor com .private() e colunas que clientes não podem escrever com .readOnly(). Um chamador liberado pelas políticas da linha ainda assim não recebe uma coluna que seus papéis não podem ler."
---

<span class="since-badge" data-since="0.31">Desde 0.31</span>

A [segurança em nível de linha](/docs/collections/security-rules/) decide quais **linhas** um
chamador alcança. Três modificadores de coluna decidem quais **colunas de uma linha alcançada**
ele vê e pode definir:

| Modificador | Leitura | Escrita |
|---|---|---|
| `.access({ read, write })` | os papéis em `read`, quando fornecido | os papéis em `write`, quando fornecido |
| `.private()` | ninguém, através da API | ninguém, através da API |
| `.readOnly()` | conforme a linha | ninguém, através da API |

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

A regra acima não coloca nenhum filtro de linha no `select`, portanto, todo chamador que a API
permite a entrada lê todas as linhas de `staff`. Apenas um chamador com o papel `hr` obtém a coluna
`salary` de uma linha, e ninguém a define via HTTP.

## A regra

<span class="since-badge" data-since="0.31">Desde 0.31</span>

`.access()` recebe duas listas opcionais, e uma lista omitida não é uma lista vazia —
a diferença é o cerne do recurso.

| `read` / `write` | Significado |
|------------------|-------------|
| omitido | Delega para a linha. Qualquer um que o `rls` da tabela permita ler (ou escrever) na linha obtém a coluna. |
| `[]` | Ninguém, através da API, em qualquer nível de privilégio — nem `admin`, nem a chave de serviço, nem uma leitura em processo. |
| `["hr"]` | Um chamador com o papel `hr`, **ou** `admin`, **ou** código de servidor confiável sem requisição por trás. |

Os papéis são papéis de aplicação do Rebase — os mesmos que `rebase.roles()` retorna
dentro de uma política e contra os quais `policy.rolesOverlap` compila. Eles vêm do
contexto da chamada: `user.roles` na requisição autenticada.

### Por que `admin` sempre passa

Toda política de referência injetada pelo Rebase carrega um braço `rolesOverlap(['admin'])`, e
`rebase.dataAsAdmin` é executado como `{ uid: "service", roles: ["admin"] }`. Uma regra de campo
que pudesse bloquear um administrador de uma coluna do seu próprio banco de dados também
impediria o Studio de renderizá-la e a CLI de exportá-la. Se você precisa de uma coluna que
nenhum administrador leia através da API, utilize `read: []`.

### Por que o plano confiável passa

Código de servidor sem uma requisição por trás — uma migração, ou o adaptador de autenticação
verificando uma senha — lê sem nenhum papel, e uma lista de papéis não se aplica a ele.
`[]` ainda se aplica: essa é uma declaração sobre a superfície da API, e não sobre quem está chamando.

O `context.data` de um hook não faz parte desse plano. Dentro de uma requisição, ele lê com os
papéis do chamador, portanto as regras de campo se aplicam ao que ele lê exatamente como se aplicam
à requisição: o próprio driver recusa um filtro, ordenação, projeção, include, busca vetorial,
agregação ou verificação de unicidade que mencione uma coluna que esses papéis não podem ler
(`FIELD_NOT_READABLE`), e responde a um nome `.private()` da mesma forma que responderia a um erro
de digitação — o mesmo que no REST e no socket.

## `.private()` e `.readOnly()` são o mesmo mecanismo

<span class="since-badge" data-since="0.31">Desde 0.31</span>

`.private()` equivale a `.access({ read: [], write: [] })`, com uma diferença: uma
coluna privada também é excluída do OpenAPI, dos tipos do SDK e dos esquemas de ferramentas MCP,
de modo que seu nome também não é público (consulte [Consultas](#consultas)). Uma coluna
não pode ser `.private()` e declarar `.access()` ao mesmo tempo; o esquema é recusado.

`.readOnly()` equivale a `write: []`: ninguém grava na coluna através da API, qualquer que
seja o papel, enquanto valores padrão, triggers e código do servidor ainda a preenchem.
As leituras são delegadas à linha, ou a `.access({ read })` quando ambos são especificados.

## O que o chamador vê

### Leituras

Um campo que você não pode ler fica **ausente** da resposta. Não é `null`, nem uma string
vazia — a chave simplesmente não está lá.

```json
// GET /api/data/staff/1  as a caller holding `staff`
{ "id": 1, "name": "Ada" }

// the same row as a caller holding `hr`
{ "id": 1, "name": "Ada", "salary": 90000 }
```

Isso é proposital. Um valor retido servido como `null` seria indistinguível de um
`null` armazenado, de modo que um cliente poderia mapear toda a coluna contando-os — e um
`update` que enviasse a linha de volta sobrescreveria o valor real com o null recebido.

Isso se aplica em todas as saídas: listagem, busca individual, alvos de relacionamento incluídos
com `?include=`, resultados de `_batch`, frames em tempo real de `.listen()`, resultados de agregação
e snapshots de [histórico](#histórico).

O valor de uma relação são as suas linhas relacionadas, portanto uma relação que você não pode ler
é retida por inteiro. `?include=` a omite da linha, juntamente com seu `_count`, em todas as portas:
REST, SDK, `.listen()` e includes aninhados um nível abaixo. Nomeá-la em qualquer outro lugar é
recusado da mesma forma que um campo (consulte [Consultas](#consultas)).

### Consultas

Um `where`, `orderBy`, `fields`, `select` de agregação ou `groupBy` que nomeie um campo que
você não pode ler resulta em um **400 `FIELD_NOT_READABLE`**. O mesmo ocorre com um filtro por meio
de uma relação em um campo do alvo que você não pode ler (`?author.salary=gt.1`), uma ordenação por
agregação sobre ele (`orderBy=max(staff.salary)`), e uma relação que você não pode ler referenciada
em um caminho aninhado (`/departments/1/members`, `/departments/1/members/7`) ou em uma ordenação
por agregação (`orderBy=count(members)`):

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

Sem isso, o valor seria legível um predicado por vez: vinte requisições equivalem a uma
busca binária sobre um salário.

O erro **indica o nome do campo**. Essa é uma decisão de design, não um descuido: o
documento OpenAPI publicado lista todas as colunas de todas as tabelas — ele é
servido pela aplicação, não pelo roteador de dados autenticado — portanto, os nomes dos
campos já são públicos. Ocultar o nome aqui não protegeria nada e responderia a um erro de
digitação genuíno do chamador com "campo desconhecido", levando-o a procurar um erro de
ortografia inexistente. **Nomes de campos são públicos; valores de campos não são.**

Exceto para colunas `.private()`. O OpenAPI, `describe_table` e o SDK gerado as
omitem, de modo que seu nome não é público, e um "not readable" confirmaria sua
existência. Um filtro, `orderBy`, `fields`, `include`, `select` de agregação ou
`groupBy`, ou `vector_search` que nomeie uma coluna privada recebe exatamente a resposta
dada a um nome incorreto — `UNKNOWN_FILTER_FIELD`, `UNKNOWN_ORDER_BY_FIELD`, `UNKNOWN_FIELD`,
`UNKNOWN_RELATION`, `UNKNOWN_AGGREGATE_FIELD` ou `UNKNOWN_VECTOR_PROPERTY`, com a mesma
mensagem e detalhes — e nenhuma resposta de campo desconhecido a lista entre os campos válidos.

### Escritas

Um valor para um campo que você não pode escrever resulta em um **400**, nunca em uma chave
descartada silenciosamente — uma escrita que descarta um campo reportaria sucesso para uma
edição que não aconteceu.

| Código | Quando |
|------|------|
| `FIELD_NOT_WRITABLE` | `write` é uma lista de papéis que você não satisfaz. Seu colega pode receber um 200 para o mesmo corpo. |
| `VALIDATION_EXCLUDED_FIELDS` | `write` é `[]`, ou a coluna é `.private()` ou `.readOnly()`. Ninguém pode escrever nela; a resposta é a mesma para qualquer chamador. |

Ambos trazem `details.violations` indexados pelo nome enviado na requisição. Aplicado
na criação, `PATCH`/`PUT`, `/bulk`, `_batch`, upserts, operações de campo
(`{ "salary": { "$inc": 1000 } }` nomeia `salary` como qualquer valor faria) e no
frame `SAVE` do WebSocket.

Uma operação de campo também exige `read` no respectivo campo. Uma operação em um campo
que você pode escrever, mas não ler, é recusada com `FIELD_NOT_READABLE`: saber se ela
ultrapassou um limite revelaria o valor que você não tem permissão para ver.

### Um link segue sua coluna de chave

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Um `belongsTo` e a coluna de chave à qual ele está vinculado são um único campo com duas
grafias. Escrever `{ "reviewer": 7 }` está sujeito a todas as regras de `reviewerId`
(sua regra de escrita, `.readOnly()`, `.private()`, carimbo de criação, a coluna de
tenant); enviar ambos com valores diferentes resulta em `400 VALIDATION_INVALID_VALUE`.
Um chamador que não pode ler `reviewerId` não obtém `reviewer` em um `include`, e uma
entrada de filtro, ordenação ou `fields` que o mencione responde com `FIELD_NOT_READABLE`;
atrás de uma chave `.private()`, a relação simplesmente não existe para os clientes. O
endpoint de esquema, o OpenAPI e o MCP descrevem os dois juntos.

O mesmo vale para todas as relações, através do que quer que seu join leia: um
`hasMany` / `hasOne` lê a chave estrangeira do alvo, um `via` lê cada coluna em que
suas etapas fazem join, em todas as tabelas pelas quais passa. Um chamador que não
pode ler uma dessas colunas não obtém a relação em um `include` ou `_count`, recebe
`FIELD_NOT_READABLE` ao filtrar ou ordenar por meio dela (uma relação desconhecida quando
a coluna é `.private()`) e não a vê descrita.

`strictWrites: false` em uma tabela apenas permite que uma chave não declarada pela
tabela passe para o driver. Isso nunca afrouxa uma regra em uma coluna declarada,
carimbo, tenant, chave, alvo de relação ou `_pivot`.

## Busca

<span class="since-badge" data-since="0.31">Desde 0.31</span>

A busca padrão — uma tabela sem um bloco `search` — faz a correspondência com `ILIKE`
nas suas colunas de texto e ignora aquelas que o chamador não pode ler. Nada vaza
por meio dela.

Uma tabela que **declara** um [bloco `search`](/docs/backend/search) compila para uma
única coluna `tsvector` gerada e compartilhada por todos os chamadores. Não há uma
variante por papel dela, portanto, uma coluna restrita nomeada em `search.fields` continuaria
passível de correspondência por chamadores que nunca podem ver seu valor — recuperável
um termo por vez. O esquema é recusado com essa combinação: remova a coluna de
`search.fields` ou elimine a restrição de leitura. Uma coluna de `tenant` também não
pode ter restrição de leitura.

## Histórico

O [histórico de entidades](/docs/backend/history) armazena a linha inteira e é servido
a qualquer pessoa que possa ler a linha — o controle de acesso é "você pode buscar esta
entidade", não "você é um admin". Portanto, a regra de leitura também é aplicada a cada
snapshot armazenado: a entrada ainda é listada, com quem a alterou e quando, e as colunas
retidas são removidas de seus `values`.

A reversão não é afetada. A rota de reversão lê a entrada armazenada no lado do servidor,
permitindo que um chamador restaure uma versão cujos campos ele não pode ver — exatamente
como ele já pode sobrescrever uma linha sem ler todos os seus campos.

## O que o CMS exibe

Nada a configurar. O CMS lê através da mesma API, portanto uma coluna que o chamador
não pode ler nunca chega e o formulário não a desenha; uma coluna que ele não pode
escrever é recusada caso algo tente enviá-la. Esta é uma garantia no lado do servidor,
diferentemente de ocultar um campo no CMS, o que apenas impede que ele seja
*renderizado*, deixando o valor no JSON.

## Tipos gerados e OpenAPI

Os tipos `Row`, `Insert` e `Update` do SDK possuem uma única forma para todos os chamadores —
não há um tipo `Row` que sirva simultaneamente para um leitor com o papel `hr` e outro sem
ele — portanto, uma regra de **papel** não os altera. Uma coluna `.private()` fica ausente
de todos os três, e uma `.readOnly()` fica ausente de `Insert` e `Update`. Os
[tipos inferidos](/docs/schema/types/) seguem a mesma regra.

O documento OpenAPI declara a regra em vez de fingir ser específico para cada chamador.
Cada coluna restrita traz `x-rebase-access`:

```json
"salary": {
  "type": "number",
  "description": "Salary — Field access: readable by `hr` (and `admin`); writable by nobody through the API. A caller without the role does not receive the field at all — it is absent, not null.",
  "x-rebase-access": { "read": ["hr"], "write": [] }
}
```

Um campo que ninguém pode ler fica ausente do esquema de leitura e dos parâmetros de filtro;
um campo que ninguém pode escrever fica ausente do esquema de entrada. As duas direções
são esquemas separados e avaliados separadamente, de modo que um token enviado por um admin
que nunca é lido de volta aparece no corpo da requisição e não na linha.

## Escritas em processo

Escritas em processo — `context.data` em um hook, `rebase.dataAsAdmin` em um hook,
uma função ou um cron job — não passam pela verificação de escrita: `.readOnly()`,
um `access.write` por campo e `.private()` são regras do limite da API.
É isso que torna a regra viável: algo precisa ser capaz de armazenar o hash da senha.
O que continua valendo em processo, tanto para uma coluna quanto para o link vinculado a ela:
carimbos do servidor têm precedência sobre um valor fornecido, uma linha não pode mudar de
tenant e sua chave não pode ser alterada. A segurança em nível de linha se aplica em todos
os lugares.

Leituras através de `rebase.dataAsAdmin` possuem o papel `admin`, portanto uma regra de papel não
oculta nada delas. `[]` ainda oculta — inclusive de `dataAsAdmin`. Use
[`rebase.sql()`](/docs/backend/custom-functions) se precisar da coluna bruta.

## Validação

<span class="since-badge" data-since="0.31">Desde 0.31</span>

`.access()` em uma coluna e `access` em uma relação lançam erro ao carregar o módulo,
a menos que `read` e `write` sejam listas de nomes de papéis não vazios: uma string
onde deveria haver uma lista (`read: "admin"`) é recusada em vez de ser interpretada
como outra coisa.

Estes casos são recusados quando o esquema é compilado, antes de o servidor servir qualquer coisa:

- `.private()` e `.access()` na mesma coluna: eles são o mesmo mecanismo;
- uma coluna com restrição de leitura nomeada em `search.fields` da tabela, ou usada como
  seu campo `tenant`;
- uma chave primária `.private()`: a chave é a forma como cada linha é endereçada.

Os *nomes* dos papéis não são verificados contra um conjunto fixo: papéis são dados da
aplicação, criados e excluídos enquanto o servidor roda. Um erro de digitação em um deles resulta
em um campo que ninguém pode ler, que é a direção segura para falhar.

## Veja também

- [Segurança em nível de linha](/docs/collections/security-rules/) — quais linhas um chamador alcança
- [Colunas](/docs/schema/columns/) — todos os modificadores de coluna
- [Códigos de erro](/docs/backend/errors/) — `FIELD_NOT_READABLE`, `FIELD_NOT_WRITABLE`
