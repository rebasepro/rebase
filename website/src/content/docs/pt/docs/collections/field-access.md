---
sourceHash: 0d49afd8ac50f59e
title: Acesso a campos
sidebar_label: Acesso a campos
description: Permissões de leitura e escrita por propriedade de acordo com a role. Um chamador autorizado pelas regras de segurança da linha ainda assim não recebe um campo que suas roles não podem ler.
---

## Visão geral

[Security rules](/docs/collections/security-rules/) decidem quais **linhas** um chamador
alcança. `access` decide quais **campos de uma linha alcançada** ele vê e pode definir.

```typescript
import { defineCollection } from "@rebasepro/cms-types";

const staff = defineCollection({
    slug: "staff",
    name: "Staff",
    table: "staff",
    properties: {
        id: { type: "number", isId: "increment" },
        name: { type: "string" },
        salary: {
            type: "number",
            // Read by HR (and admins). Set by nobody through the API.
            access: { read: ["hr"], write: [] }
        }
    },
    securityRules: [
        { operation: "select", access: "public" }
    ]
});
```

A regra acima não coloca nenhum filtro de linha no `select`, de modo que todo chamador
autorizado pela API lê todas as linhas de funcionários (`staff`). Apenas um chamador
com a role `hr` obtém a coluna `salary` de uma linha, e ninguém a define via HTTP.

## A regra

`access` possui duas listas opcionais, e uma lista omitida não é uma lista vazia — a
diferença é o cerne do recurso.

| `read` / `write` | Significado |
|------------------|-------------|
| omitido | Delega para a linha. Qualquer pessoa autorizada pelas regras de segurança da coleção a ler (ou escrever) a linha recebe o campo. |
| `[]` | Ninguém, por meio da API, em qualquer nível de privilégio — nem `admin`, nem a chave de serviço, nem uma leitura em processo (in-process). |
| `["hr"]` | Um chamador com a role `hr`, **ou** `admin`, **ou** código de servidor confiável sem uma requisição associada. |

Roles são roles de aplicação do Rebase — as mesmas que `rebase.roles()` retorna
dentro de uma política e contra as quais `policy.rolesOverlap` compila. Elas vêm do
contexto da chamada: `user.roles` na requisição autenticada.

### Por que `admin` sempre passa

Cada política básica injetada pelo Rebase contém uma ramificação `rolesOverlap(['admin'])`,
e `rebase.dataAsAdmin` é executado como `{ uid: "service", roles: ["admin"] }`. Uma regra de
campo que pudesse bloquear um administrador de ver uma coluna de seu próprio banco de dados
também impediria o Studio de renderizá-la e a CLI de exportá-la. Se você precisa de uma
coluna que nenhum administrador leia por meio da API, use `read: []`.

### Por que o plano confiável sempre passa

Uma chamada `rebase.data` em processo (in-process) em um hook, migração ou no adaptador de
autenticação verificando uma senha não possui requisição nem roles por trás. Esse é um código
de servidor, e uma lista de roles não se aplica a ele. `[]` ainda se aplica: essa é uma
declaração sobre a superfície da API, e não sobre quem está chamando.

## `excludeFromApi` é o mesmo mecanismo

`excludeFromApi: true` é uma forma sintática alternativa (sugar) para `access: { read: [], write: [] }`.
Há um único predicado por trás de ambas as grafias, portanto, tudo nesta página também se
aplica a essa flag. Escreva da forma que considerar mais legível — mas não use ambas na
mesma propriedade, o que é recusado na inicialização.

## O que um chamador vê

### Leituras

Um campo que você não pode ler fica **ausente** da resposta. Não é `null`, nem uma string
vazia — a chave simplesmente não está lá.

```json
// GET /api/data/staff/1  as a caller holding `staff`
{ "id": 1, "name": "Ada" }

// the same row as a caller holding `hr`
{ "id": 1, "name": "Ada", "salary": 90000 }
```

Isso é deliberado. Um valor retido retornado como `null` é indistinguível de um
`null` armazenado, de modo que um cliente poderia mapear a coluna inteira contando-os —
e um `update` que enviasse a linha de volta sobrescreveria o valor real com o nulo recebido.

Isso se aplica a todas as saídas: listagem, busca individual, alvos de relacionamento
incluídos com `?include=`, resultados de `_batch`, frames em tempo real de `.listen()`,
resultados agregados e snapshots do [histórico](#history).

### Consultas

Um `where`, `orderBy`, `fields`, `select` de agregação ou `groupBy` que mencione um campo que
você não pode ler resulta em um erro **400 `FIELD_NOT_READABLE`**:

```http
GET /api/data/staff?salary=gt.100000
```

```json
{
  "error": {
    "code": "FIELD_NOT_READABLE",
    "message": "'salary' is not readable on 'staff' with your roles, so it cannot be used in a filter.",
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

Sem isso, o valor seria legível um predicado por vez: vinte requisições equivaleriam
a uma busca binária sobre um salário.

O erro **informa o nome do campo**. Essa é uma decisão de projeto, não um descuido: o
documento OpenAPI publicado lista todas as propriedades de cada coleção — ele é servido a
partir da aplicação, e não pelo roteador de dados autenticado —, logo, os nomes dos campos
já são públicos. Ocultar o nome aqui não protegeria nada e responderia a um erro de
digitação legítimo do chamador com "unknown field", fazendo-o procurar um erro de ortografia
inexistente. **Nomes de campos são públicos; valores de campos não são.**

### Escritas

Um valor enviado para um campo no qual você não pode escrever resulta em um erro **400**,
nunca em uma chave descartada silenciosamente — uma escrita que descarta um campo reportaria
sucesso para uma edição que não aconteceu.

| Código | Quando |
|--------|--------|
| `FIELD_NOT_WRITABLE` | `write` é uma lista de roles que você não atende. Seu colega pode receber um 200 para o mesmo corpo de requisição. |
| `VALIDATION_EXCLUDED_FIELDS` | `write` é `[]` (ou `excludeFromApi`). Ninguém pode escrever nele; a resposta é a mesma para qualquer chamador. |

Ambos trazem `details.violations` indexados pelo nome enviado na requisição (wire name).
Aplicado na criação, `PATCH`/`PUT`, `/bulk`, `_batch`, upserts, operações de campo
(`{ "salary": { "$inc": 1000 } }` referencia `salary` como qualquer valor faria) e no
frame `SAVE` via WebSocket.

## Busca

A busca padrão de fallback — em uma coleção sem bloco `search` — executa correspondência
com `ILIKE` nas suas propriedades de string e ignora aquelas que o chamador não pode ler.
Nada vaza por meio dela.

Uma coleção que **declara** um [bloco `search`](/docs/backend/api/) compila para uma única
coluna `tsvector` gerada e compartilhada por todos os chamadores. Não há uma variante dela
por role, portanto, um campo restrito informado em `search.fields` continuaria passível de
correspondência (*matchable*) para chamadores que nunca podem ver seu valor — recuperável
termo a termo. O Rebase recusa essa combinação na inicialização: remova o campo de
`search.fields` ou remova a restrição de leitura.

## Histórico

O [histórico de entidades](/docs/backend/api/) armazena a linha completa e é servido a
qualquer pessoa que possa ler a linha — o critério de acesso é "você pode buscar esta entidade?",
não "você é um admin?". Portanto, a regra de leitura também é aplicada a cada snapshot
armazenado: a entrada ainda é listada, indicando quem a alterou e quando, mas as colunas
retidas são removidas de seus `values`.

A reversão não é afetada. A rota de reversão lê a entrada armazenada no lado do servidor,
de modo que um chamador pode restaurar uma versão da qual não pode ver todos os campos —
exatamente como ele já pode sobrescrever uma linha sem ler todos os seus campos.

## O que o painel administrativo exibe

Nada a configurar. O Studio faz leituras por meio da mesma API, de modo que um campo que
o chamador não pode ler nunca chega e o formulário não o renderiza; um campo que ele não pode
escrever é recusado se algo tentar enviá-lo. Essa é uma garantia do lado do servidor, diferente
de `admin.hideFromCollection`, que apenas impede o painel de *renderizar* um campo, mantendo
o valor no JSON.

## Tipos gerados e OpenAPI

Os tipos `Row`, `Insert` e `Update` do SDK possuem o mesmo formato para todos os chamadores —
não existe um `Row` adequado tanto para um leitor que possui a role `hr` quanto para um que
não possui —, portanto, uma regra de **role** não os altera. Um campo fechado para todos
(`[]` ou `excludeFromApi`) fica ausente deles, como sempre foi.

O documento OpenAPI declara a regra em vez de fingir ser específico por chamador.
Cada propriedade restrita traz `x-rebase-access`:

```json
"salary": {
  "type": "number",
  "description": "Salary — Field access: readable by `hr` (and `admin`); writable by nobody through the API. A caller without the role does not receive the field at all — it is absent, not null.",
  "x-rebase-access": { "read": ["hr"], "write": [] }
}
```

Um campo que ninguém pode ler fica ausente do esquema de leitura e dos parâmetros de filtro;
um campo que ninguém pode escrever fica ausente do esquema de entrada. As duas direções são
esquemas separados e avaliados separadamente, de modo que um token que um administrador
envia e nunca lê de volta aparece no corpo da requisição e não na linha.

## Escritas em processo (in-process)

`rebase.data` e `rebase.dataAsAdmin` em um hook, função ou cron job não passam pela verificação
de escrita. Essa é a mesma isenção que `excludeFromApi` sempre teve, e é o que torna a regra
aplicável na prática: algo precisa ser capaz de armazenar o hash da senha.

Leituras via `rebase.dataAsAdmin` possuem a role `admin`, logo uma regra de role não oculta
nada delas. `[]` ainda oculta — inclusive para `dataAsAdmin`. Use
[`rebase.sql()`](/docs/backend/api/) se precisar da coluna bruta.

## Validação

Estes casos são recusados na inicialização, antes de o servidor atender a qualquer requisição:

- `access` e `excludeFromApi` na mesma propriedade — eles são o mesmo mecanismo e a flag tem
  precedência, portanto, o bloco ao lado dela seria inútil;
- uma string simples onde deveria haver uma lista (`read: "admin"`), o que é interpretado como
  uma regra não vazia que nenhum chamador satisfaz e ocultaria o campo de todos;
- uma role que não seja uma string não vazia;
- um campo restrito informado no `search.fields` da coleção.

Os *nomes* de roles não são verificados contra um conjunto fixo: roles são dados da aplicação,
criadas e excluídas enquanto o servidor está em execução. Um erro de digitação em uma delas
resulta em um campo que ninguém pode ler, o que é a forma mais segura de falhar.

## Veja também

- [Security Rules (RLS)](/docs/collections/security-rules/) — quais linhas um chamador alcança
- [Properties](/docs/collections/properties/) — a tabela completa de opções
- [Error codes](/docs/backend/errors/) — `FIELD_NOT_READABLE`, `FIELD_NOT_WRITABLE`

---
