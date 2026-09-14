---
sourceHash: b3e463880abd2023
title: Acesso a campos
sidebar_label: Acesso a campos
description: Permissões de leitura e escrita por propriedade com base em papéis. Um chamador autorizado pelas regras de segurança da linha ainda assim não recebe um campo que seus papéis não podem ler.
---

## Visão geral

As [regras de segurança](/docs/collections/security-rules/) decidem quais **linhas** um chamador
pode acessar. O `access` decide quais **campos de uma linha acessada** ele vê e pode definir.

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

A regra acima não aplica nenhum filtro de linha ao `select`, portanto, todo chamador autorizado
pela API lê todas as linhas da tabela `staff`. Apenas um chamador com o papel `hr` obtém a coluna
`salary` de uma linha, e ninguém pode defini-la via HTTP.

## A regra

O `access` possui duas listas opcionais, e uma lista omitida não é uma lista vazia — a
diferença é o cerne de todo o recurso.

| `read` / `write` | Significado |
|------------------|-------------|
| omitido | Delega para a linha. Qualquer pessoa que as regras de segurança da coleção permitirem ler (ou gravar) a linha recebe o campo. |
| `[]` | Ninguém, por meio da API, sob nenhum nível de privilégio — nem `admin`, nem a chave de serviço, nem uma leitura em processo. |
| `["hr"]` | Um chamador com o papel `hr`, **ou** `admin`, **ou** código de servidor confiável sem uma requisição associada. |

Os papéis são papéis da aplicação Rebase — os mesmos retornados por `rebase.roles()`
dentro de uma política e contra os quais `policy.rolesOverlap` compila. Eles vêm do
contexto da chamada: `user.roles` na requisição autenticada.

### Por que `admin` sempre passa

Toda política padrão injetada pelo Rebase contém uma condição `rolesOverlap(['admin'])`, e
o `rebase.dataAsAdmin` é executado como `{ uid: "service", roles: ["admin"] }`. Uma regra de campo
que pudesse bloquear um administrador de acessar uma coluna de seu próprio banco de dados
também impediria o Studio de renderizá-la e a CLI de exportá-la. Se você precisa de
uma coluna que nenhum administrador leia por meio da API, use `read: []`.

### Por que o plano confiável passa

Código de servidor sem uma requisição associada — uma migração, ou o adaptador de autenticação
verificando uma senha — lê sem papéis atribuídos, e uma lista de papéis não
se aplica a ele. `[]` ainda se aplica: trata-se de uma declaração sobre a superfície da API
e não sobre quem está chamando.

O `context.data` de um callback não faz parte desse plano. Dentro de uma requisição, ele lê com os
papéis do chamador, portanto, as regras de campo se aplicam ao que ele lê exatamente como se
aplicam à requisição.

## `excludeFromApi` é o mesmo mecanismo

`excludeFromApi: true` é um atalho sintático para `access: { read: [], write: [] }`. Existe
um único predicado por trás de ambas as formas, portanto, tudo nesta página também se aplica
à flag. Escreva a que for mais legível — mas não use ambas na mesma propriedade, o que é
recusado na inicialização.

## O que um chamador vê

### Leituras

Um campo que você não pode ler fica **ausente** da resposta. Nem `null`, nem uma string
vazia — a chave simplesmente não está lá.

```json
// GET /api/data/staff/1  as a caller holding `staff`
{ "id": 1, "name": "Ada" }

// the same row as a caller holding `hr`
{ "id": 1, "name": "Ada", "salary": 90000 }
```

Isso é intencional. Um valor omitido retornado como `null` é indistinguível de um
`null` armazenado, permitindo que um cliente mapeasse toda a coluna contando-os — e um
`update` que enviasse a linha de volta sobrescreveria o valor real com o `null` que
havia recebido.

Isso se aplica a todas as saídas: listagem, busca individual, alvos de relacionamento incluídos com
`?include=`, resultados de `_batch`, mensagens em tempo real de `.listen()`, resultados
agregados e snapshots de [histórico](#histórico).

### Consultas

Um `where`, `orderBy`, `fields`, `select` agregado ou `groupBy` que cite um campo que
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

Sem isso, o valor poderia ser lido testando um predicado por vez: vinte requisições seriam uma
busca binária para descobrir um salário.

O erro **informa o nome do campo**. Essa é uma decisão intencional, não um descuido: o
documento OpenAPI publicado lista todas as propriedades de cada coleção — ele é
servido pela aplicação, não pelo roteador de dados autenticado —, portanto, os nomes dos campos
já são públicos. Ocultar o nome aqui não protegeria nada e responderia a um erro de
digitação genuíno do chamador com "campo desconhecido", levando-o a procurar um erro de
ortografia que não existe. **Nomes de campos são públicos; valores de campos não são.**

### Gravações

Um valor enviado para um campo que você não pode gravar resulta em um erro **400**, nunca em uma chave
silenciosamente descartada — uma gravação que descarta um campo reportaria sucesso para uma
edição que não aconteceu.

| Código | Quando |
|--------|--------|
| `FIELD_NOT_WRITABLE` | `write` é uma lista de papéis que você não atende. Seu colega pode receber um 200 com o mesmo corpo de requisição. |
| `VALIDATION_EXCLUDED_FIELDS` | `write` é `[]` (ou `excludeFromApi`). Ninguém pode gravar nele; a resposta é a mesma para todos os chamadores. |

Ambos trazem `details.violations` indexados pelo nome do campo enviado na requisição. Aplicado em
criações, `PATCH`/`PUT`, `/bulk`, `_batch`, upserts, operações de campo
(`{ "salary": { "$inc": 1000 } }` referencia `salary` como qualquer valor faria) e no
frame `SAVE` do WebSocket.

## Busca

A busca padrão — em uma coleção sem o bloco `search` — faz a correspondência com `ILIKE` em
suas propriedades de texto e ignora aquelas que o chamador não pode ler. Nada
vaza por meio dela.

Uma coleção que **declara** um [bloco `search`](/docs/backend/api/) é compilada
em uma única coluna `tsvector` gerada e compartilhada por todos os chamadores. Não há
uma variante dela por papel, portanto, um campo restrito declarado em `search.fields` continuaria
sendo *passível de correspondência* por chamadores que nunca poderiam ver seu valor — tornando-se
recuperável um termo por vez. O Rebase recusa essa combinação na inicialização: remova o campo de
`search.fields` ou retire a restrição de leitura.

## Histórico

O [histórico da entidade](/docs/backend/api/) armazena a linha completa e é fornecido para
qualquer um que possa ler a linha — o controle de acesso é "você pode consultar esta entidade", não "você
é um admin". Portanto, a regra de leitura também é aplicada a cada snapshot armazenado: a entrada
ainda é listada, com quem a alterou e quando, mas as colunas retidas são removidas
de seus `values`.

A reversão não é afetada. A rota de reversão lê a entrada armazenada no lado do servidor, permitindo que
um chamador restaure uma versão mesmo sem poder ver todos os seus campos — exatamente como já
é possível sobrescrever uma linha sem ler todos os seus dados.

## O que o painel de administração mostra

Nada precisa ser configurado. O Studio realiza leituras através da mesma API, portanto, um campo que
o chamador não pode ler nunca é entregue e o formulário não o exibe; um campo que ele
não pode gravar é recusado se algo tentar enviá-lo. Essa é uma garantia no nível do servidor,
diferente de `admin.hideFromCollection`, que apenas impede o painel de *renderizar*
um campo, mantendo o valor presente no JSON.

## Tipos gerados e OpenAPI

Os tipos `Row`, `Insert` e `Update` do SDK têm uma estrutura única para todos os chamadores —
não existe um tipo `Row` que seja correto simultaneamente para um leitor que possui `hr` e outro que
não possui —, portanto, uma regra de **papel** não os altera. Um campo inacessível para todos
(`[]` ou `excludeFromApi`) fica ausente deles, como sempre foi.

O documento OpenAPI declara a regra explicitamente em vez de simular ser por chamador.
Cada propriedade restrita inclui `x-rebase-access`:

```json
"salary": {
  "type": "number",
  "description": "Salary — Field access: readable by `hr` (and `admin`); writable by nobody through the API. A caller without the role does not receive the field at all — it is absent, not null.",
  "x-rebase-access": { "read": ["hr"], "write": [] }
}
```

Um campo que ninguém pode ler fica ausente do esquema de leitura e dos parâmetros de
filtro; um campo que ninguém pode gravar fica ausente do esquema de entrada. Os dois
fluxos possuem esquemas distintos e são validados separadamente, de modo que um token enviado por
um administrador e nunca lido de volta aparece no corpo da requisição e não na linha retornada.

## Gravações em processo

Gravações em processo — `context.data` em um callback, `rebase.dataAsAdmin` em um
callback, uma função ou uma tarefa cron — não passam pela validação de escrita. Essa
é a mesma isenção que o `excludeFromApi` sempre teve, e é o que torna a regra viável
de ser aplicada: algo precisa ser capaz de salvar o hash da senha.

Leituras via `rebase.dataAsAdmin` possuem o papel `admin`, logo uma regra baseada em papel
não oculta nada delas. `[]` ainda oculta — inclusive do `dataAsAdmin`. Utilize
[`rebase.sql()`](/docs/backend/api/) caso precise da coluna bruta.

## Validação

Estes casos são recusados na inicialização, antes de o servidor atender a qualquer requisição:

- `access` e `excludeFromApi` na mesma propriedade — tratam-se do mesmo mecanismo e
  a flag tem precedência, tornando o bloco ao lado inoperante;
- uma string simples onde deveria haver uma lista (`read: "admin"`), o que é interpretado como uma
  regra não vazia que nenhum chamador satisfaz, ocultando o campo de todos;
- um papel que não seja uma string não vazia;
- um campo restrito declarado em `search.fields` da coleção.

Os *nomes* dos papéis não são validados contra um conjunto fixo: papéis são dados da aplicação, criados
e removidos enquanto o servidor está em execução. Um erro de digitação em um deles resulta em um campo que
ninguém consegue ler, o que é a direção mais segura para falhar.

## Veja também

- [Regras de segurança (RLS)](/docs/collections/security-rules/) — quais linhas um chamador acessa
- [Propriedades](/docs/collections/properties/) — a tabela completa de opções
- [Códigos de erro](/docs/backend/errors/) — `FIELD_NOT_READABLE`, `FIELD_NOT_WRITABLE`
