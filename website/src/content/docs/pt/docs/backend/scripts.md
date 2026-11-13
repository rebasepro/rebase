---
sourceHash: 87e4ee6ea63add18
title: Scripts e o Console
sidebar_label: Scripts e o Console
description: Abra os dados de um projeto a partir de um script, um teste ou um REPL com openRebase, ou do terminal com rebase console. Sem servidor, sem alterações de schema.
---

## Visão Geral

Para visualizar algumas linhas, corrigir uma delas, testar um filtro ou verificar o que uma política permite que um usuário
veja, você não precisa iniciar um servidor. O Rebase disponibiliza os dados do seu projeto
como um objeto, em dois lugares:

- **`rebase console`**, um REPL do Node no seu terminal com o projeto aberto;
- **`openRebase`**, o mesmo objeto em um script ou teste próprio.

Ambos abrem o banco de dados sem modificá-lo: nenhuma tabela, role, trigger ou
função é criada. O método `close()` de um script encerra o que o `openRebase` abriu. No
banco de dados de desenvolvimento gerenciado, o `rebase console` inicia esse banco de dados caso ele não
esteja em execução e o mantém em execução depois, exatamente como os comandos `rebase db` fazem;
o comando `rebase db stop` o interrompe. O objeto possui o
vocabulário que uma [função customizada](/docs/backend/custom-functions/) recebe do
servidor, `dataAsAdmin` e `sql`, permitindo que um trecho de código transite entre uma função, um script
e o console sem alterações.

## `rebase console`

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Execute-o em seu projeto:

```bash
rebase console
```

```text
> const { data } = await rebase.dataAsAdmin.posts.find({ limit: 3 })
> data.map(p => p.title)
[ 'Draft', 'Second post', 'Hello' ]
> const ada = await rebase.withAuth({ uid: "ada", roles: ["user"] })
> (await ada.data.posts.find({ limit: 3 })).data.length
3
```

Dois nomes estão no escopo, e o `await` de nível superior funciona:

| Nome | O que é |
|---|---|
| `rebase` | O que o [`openRebase`](#openrebase) retorna: `dataAsAdmin`, `sql`, `withAuth(user)` e `close()` |
| `tables` | Os descritores das tabelas que o projeto disponibiliza, carregados de `backend/schema` da mesma forma que o `rebase db push` os carrega (`rebase.tables`) |

O console abre o projeto da mesma maneira que o `rebase db push` faz: o mesmo `.env`,
o mesmo banco de dados e as mesmas tabelas, a partir de `backend/schema`. Ele também carrega
os `hooks` globais de `backend/hooks.ts`, garantindo que suas operações de escrita executem os mesmos hooks que
uma escrita no servidor. Um projeto no
banco de dados de desenvolvimento gerenciado o iniciará primeiro. O histórico do que você digitou é
mantido em `.rebase/console_history`, que o `.gitignore` do scaffold já
ignora por padrão.

A entrada canalizada (piped) é executada uma linha de cada vez, cada uma após o `await` da linha anterior
ter sido resolvido, portanto a transcrição acima funciona como
`printf '…\n…\n' | rebase console`. Qualquer conteúdo após `.exit` é ignorado, e
os valores só são coloridos em um terminal. Tudo o que o console registra é enviado para
o stderr.

### Um único snippet: `--eval`

`rebase console -e "<code>"` executa um trecho de código em vez de abrir o REPL. O
valor de uma expressão, ou o `return` do corpo de uma função, é aguardado com await e impresso como
JSON no stdout, permitindo que a saída seja encadeada via pipe:

```bash
rebase console -e "rebase.dataAsAdmin.posts.find({ limit: 5 })"
rebase console -e "rebase.sql('select count(*) from posts')" | jq .
rebase console -e "const u = await rebase.withAuth({ uid: 'u1', roles: ['user'] }); return (await u.data.posts.find()).data"
```

Tudo o que o console registra, independentemente do que o `LOG_LEVEL` determinar, vai para o stderr, garantindo que o
stdout contenha o resultado e nada mais. Um trecho de código que lança uma exceção imprime o erro
no stderr e encerra com código `1`.

Um banco de dados que o
console não conseguir abrir é reportado uma vez, e ele encerra com código `1`: seja o banner "Cannot connect to
PostgreSQL" que os comandos `db` exibem ou, no banco de desenvolvimento gerenciado,
o aviso de que não há conexões disponíveis. Esse banco de dados aceita apenas algumas
conexões por vez e um processo `rebase dev` em execução consome algumas delas; portanto, feche outro
cliente ou pare o `rebase dev` e execute novamente.

### Opções

<span class="since-badge" data-since="0.31">Desde 0.31</span>

| Flag | O que faz |
|---|---|
| `--eval`, `-e` | Executa este código em vez do REPL, imprime o resultado aguardado como JSON e encerra com código 1 em caso de exceção |
| `--schema-dir` | O diretório de schema, se não for o padrão do projeto (`backend/schema`, ou a chave `tables` de `rebase.json`) |
| `--database-url` | Abre este banco de dados em vez do banco do projeto |
| `--docker` | Usa o banco de dados do docker compose, iniciando-o se necessário |

## `openRebase`

<span class="since-badge" data-since="0.31">Desde 0.31</span>

`openRebase` de `@rebasepro/server-postgres` é o que o console invoca por debaixo dos panos. Use-o
em um script, seed, correção de dados ou teste. Em um projeto gerado por scaffolding, coloque o
script dentro de `backend/`, por exemplo `backend/scripts/publish-drafts.ts`: a workspace
do backend é a que depende de `@rebasepro/server-postgres`, e um script
na pasta raiz `scripts/` não pode importá-lo.

O `openRebase` recebe as tabelas do projeto compiladas: `compileSchema` de
`@rebasepro/common` transforma os resultados de `defineTable` nas tabelas com as quais o driver
trabalha, hooks inclusos. Coloque isso em um módulo compartilhado entre os scripts,
`backend/scripts/tables.ts`, após adicionar `@rebasepro/common` ao
`backend/package.json`:

```typescript no-verify
import { compileSchema } from "@rebasepro/common";
import * as schema from "../schema";

// Every table the index exports, and the defaultRls its "inherit" tables take.
export const tables = compileSchema(
    [schema.users, schema.posts, schema.authors, schema.tags],
    { defaultRls: schema.defaultRls }
);
```

Passe os hooks globais que `backend/hooks.ts` exporta como `hooks`, e as operações de escrita
de um script os executarão exatamente como uma escrita no servidor faria; sem eles, um `beforeSave`
global que atribui um tenant ou registra uma linha de auditoria não será executado em nenhuma escrita do script. Se omitir
`tables`, o `openRebase` lerá as tabelas do banco de dados, da mesma forma que um servidor
sem `backend/schema` faz. O `rebase console` carrega ambos para você.

```typescript
import { openRebase } from "@rebasepro/server-postgres";
import { tables } from "./tables";

const rebase = await openRebase({ databaseUrl: process.env.DATABASE_URL!, tables });

const { data: drafts } = await rebase.dataAsAdmin.posts.find({ where: { status: ["==", "draft"] } });
console.log(`${drafts.length} drafts`);
for (const draft of drafts) {
    await rebase.dataAsAdmin.posts.update(String(draft.id), { status: "published" });
}

await rebase.close();
```

Execute-o a partir de `backend/`. O comando `rebase db url` imprime a URL do banco de dados que o
projeto utiliza, incluindo o banco de dados de desenvolvimento gerenciado:

```bash
cd backend
DATABASE_URL="$(pnpm exec rebase db url)" pnpm exec tsx scripts/publish-drafts.ts
```

| Membro | O que faz |
|---|---|
| `dataAsAdmin` | Todas as tabelas, lidas e escritas sob a identidade de serviço do servidor (`{ uid: "service", roles: ["admin"] }`): admin, e ainda assim avaliadas pelas suas políticas de RLS, exatamente como `rebase.dataAsAdmin` em uma função |
| `sql(query, { params })` | SQL bruto na conexão do proprietário (owner), com a mesma convenção de chamada de `rebase.sql` em uma função. É executado na única fonte de dados aberta: qualquer `{ database }` apontando para outra fonte é recusado |
| `withAuth(user)` | Resolve para `{ data }`: as tabelas como aquele usuário as enxerga. Cada leitura e escrita é executada em nome dele, filtrada pela segurança a nível de linha (RLS), exatamente como seria em uma requisição HTTP daquele usuário |
| `tables` | Os descritores das tabelas que ele atende: aquelas que foram fornecidas ou as descritas pelo banco de dados |
| `close()` | Encerra o pool de conexões criado pelo `openRebase`. É seguro chamar duas vezes |

Suas opções:

| Opção | O que faz |
|---|---|
| `databaseUrl` | O banco de dados a ser aberto. `openRebase` cria o pool e `close()` o encerra |
| `connection` | Uma conexão Drizzle já existente (`createPostgresDatabaseConnection(url).db`), em vez de `databaseUrl`. Ela permanece sob seu controle: `close()` a mantém aberta |
| `tables` | As tabelas do projeto, compiladas com `compileSchema` (veja acima). Se omitido ou vazio, lê-as do banco de dados em vez disso, como faz um servidor sem `backend/schema`, servindo-as em modo somente leitura |
| `pool` | Configurações do pool, usadas com `databaseUrl` |
| `dataSourceKey` | O banco de dados de onde essas tabelas são servidas. O padrão é `(default)` |
| `hooks` | Os hooks globais do projeto: os `hooks` exportados por `backend/hooks.ts`, que o servidor executa antes dos hooks próprios de cada tabela. Passe-os aqui e a escrita de um script também os executará. O `rebase console` faz isso automaticamente |

O `openRebase` não lê variáveis de ambiente. A `DATABASE_URL` acima é lida pelo
seu próprio script, e configurações como `REBASE_DB_POOL_MAX` ou `REALTIME_CDC` não têm
efeito aqui.

A inicialização não registra
nada em nível `info`, portanto o stdout de um script conterá apenas o que o script imprimir, e
`tsx scripts/report.ts > report.json` gravará estritamente o seu JSON. Avisos e erros
são direcionados para o stderr em ambiente de desenvolvimento. A mensagem sobre como as requisições são isoladas (`RLS
enforcement active`) é registrada como `debug`; na inicialização de um servidor tradicional, ela ainda é impressa como
`info`. Caso não consiga se conectar ao banco de dados, a abertura é rejeitada com um único erro,
`Cannot connect to PostgreSQL at <host>:<port>: <reason>.`, sem registrar nada nos logs:
cabe ao script decidir o que exibir.

Seus métodos de acesso são tipados pelo `Database` registrado por `rebase generate-sdk --register`,
da mesma forma que o `rebase` de uma função é tipado; assim, o nome incorreto de uma tabela, campo ou
valor de enum em um script resultará em um erro de tipo. O `backend/tsconfig.json` do scaffold
inclui `scripts/`, portanto o comando `tsc --noEmit` em `backend/` acusará esses erros. Sem esse registro, forneça o tipo por chamada
com `openRebase<Database>({ … })`; `OpenedRebase<Database>` é o tipo a ser utilizado em
uma função utilitária auxiliar que receba a instância. Sem nenhum dos dois, as linhas não terão tipagem forte, motivo pelo qual o primeiro
exemplo converte `draft.id` com `String()`.

### Verificando o que um usuário pode ver

`withAuth` é a maneira mais rápida de testar uma regra de segurança contra dados reais. O
scaffold de blog, padrão do `rebase init`, declara regras na própria tabela `posts`: um
usuário autenticado sem papéis lê posts publicados e nenhum rascunho, e apenas um
admin pode criar ou editar um post. (As outras tabelas definem `rls: "inherit"` e adotam o
`defaultRls` de `backend/schema/index.ts`.) Este exemplo valida ambas as partes em
`backend/scripts/ada-check.ts`:

```typescript
import { openRebase } from "@rebasepro/server-postgres";
import { tables } from "./tables";

const rebase = await openRebase({ databaseUrl: process.env.DATABASE_URL!, tables });
const ada = await rebase.withAuth({ uid: "ada", roles: ["user"] });

// A signed-in user reads published posts, and no drafts…
const { data: seen } = await ada.data.posts.find();
console.log(seen.every(post => post.status === "published"));

// …and writing one is refused: only an admin may.
const refused = await ada.data.posts.create({ title: "Not an admin" }).then(() => false, () => true);
console.log(refused);

// SQL as Ada runs under the same policies: her rows, read-only unless { write: true }.
const counted = await ada.sql("SELECT count(*)::int AS n FROM posts");
console.log(Number(counted[0]?.n) === seen.length);

await rebase.close();
```

Execute-o da mesma forma que o primeiro script, e ele imprimirá `true` três vezes:

```bash
cd backend
DATABASE_URL="$(pnpm exec rebase db url)" pnpm exec tsx scripts/ada-check.ts
```

Uma regra que filtra linhas por proprietário é validada da mesma maneira: compare o
campo de proprietário de cada linha com o `uid` fornecido. No scaffold do blog nenhuma regra faz isso, e
`authorId` em um post representa o id de um registro de autor, não de um usuário.

Um usuário é representado por `{ uid, roles?, isAnonymous?, claims? }`; `claims` é o que
`rebase.jwt()` lê em uma política.

O `withAuth` é executado com a role restrita criada na inicialização do servidor (`rebase_user`).
Em um banco de dados onde nenhum servidor Rebase tenha sido inicializado, essa role não existe, e
as requisições com `withAuth` falharão com o erro de role desconhecida do Postgres, em vez de serem executadas
sem filtros. Execute `rebase db push`, ou inicialize o servidor uma vez, antes de rodar os testes.

### Em um teste

```typescript
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { openRebase, type OpenedRebase } from "@rebasepro/server-postgres";
import { tables } from "./tables";

let rebase: OpenedRebase;
before(async () => {
    rebase = await openRebase({ databaseUrl: process.env.TEST_DATABASE_URL!, tables });
});
after(() => rebase.close());

test("a signed-in user reads published posts only and writes none", async () => {
    const ada = await rebase.withAuth({ uid: "ada", roles: ["user"] });
    const { data: seen } = await ada.data.posts.find();
    assert.ok(seen.every(post => post.status === "published"));
    await assert.rejects(ada.data.posts.create({ title: "Not an admin" }));
});
```

Salve-o como `backend/scripts/posts.test.ts` e execute-o a partir de `backend/` com o
test runner do Node, apontando `TEST_DATABASE_URL` para um banco de dados no qual um servidor Rebase
já tenha sido inicializado:

```bash
TEST_DATABASE_URL="$(pnpm exec rebase db url)" pnpm exec tsx --test scripts/posts.test.ts
```

O mesmo padrão funciona sob Vitest ou Jest.

### Tabelas com histórico

Uma escrita em uma tabela com [`history: true`](/docs/backend/history/) registra
sua entrada da mesma forma que uma escrita no servidor faria. O registro é gravado na própria
transação da linha, portanto uma escrita revertida (rollback) não deixa histórico. A operação é registrada sob a
identidade com a qual foi executada: `service` para `dataAsAdmin`, e o `uid` do usuário sob
`withAuth`. As escritas realizadas a partir do `rebase console` são registradas da mesma forma.

O `openRebase` não cria tabelas ou estruturas no banco para gravação de histórico. Se nenhum backend com histórico tiver sido
inicializado no banco de dados, a tabela `rebase.entity_history` estará ausente. Uma escrita em
uma tabela com histórico será recusada com o erro
[`HISTORY_UNAVAILABLE`](/docs/backend/errors/#data-queries-and-writes) antes
que qualquer um de seus hooks seja executado, e a mensagem indicará o que está faltando. As leituras funcionam
normalmente. Inicialize o backend uma vez com o histórico habilitado (o que o `rebase dev` faz), e as operações de escrita
passarão a funcionar.

As entradas são apenas registradas, nunca expurgadas diretamente pelo script. A retenção é uma configuração de servidor à qual
o script não tem acesso, portanto o servidor expurga essas entradas normalmente: na próxima escrita da entidade
e em sua varredura horária automática.

### O que fica de fora

O `openRebase` abre apenas a camada de dados e nada mais. Ele não inicializa um serviço de realtime
próprio, mas suas escritas continuam alcançando consultas ativas (live queries): as triggers de
captura de alterações do banco de dados anunciam cada escrita, independentemente de quem a realizou, garantindo que os clientes inscritos em um
servidor em execução façam o refetch após um backfill de dados. Somente com `REALTIME_CDC=off` configurado no servidor
é que essas alterações não são anunciadas. Veja mais em
[Database change capture](/docs/backend/realtime-cdc/). Storage, envio de e-mails, administração de
autenticação e suas funções customizadas não estão disponíveis nele.

Os hooks próprios de cada tabela são executados a cada escrita, exatamente como no servidor. Os hooks
globais do projeto só são executados se você os passar através da opção `callbacks`.
O `rebase console` passa esses hooks automaticamente: ele lê os `hooks` exportados pelo seu
`backend/hooks.ts`, garantindo que um `beforeSave` global também seja acionado em suas escritas. Caso
esse arquivo não possa ser importado (por exemplo, se depender de uma variável de ambiente não
fornecida ao console), o console exibirá uma linha informando que os hooks globais estão
desativados para a sessão e abrirá sem eles.

Quando um script também precisar desses recursos adicionais, inicialize o backend sem servi-lo via HTTP:
`createRebaseBackend({ …, provision: false })` fornece o objeto `backend.rebase`, o cliente
completo em processo (in-process), sem rotas montadas e sem serviços iniciados. Veja mais em
[o backend sem um servidor](/docs/backend/custom-server/#the-backend-without-a-server).
Para testar o hook de uma tabela isoladamente sem qualquer banco de dados, invoque-o com
[`createCallContext`](/docs/collections/callbacks/#testing-a-hook).

## Relacionados

- [Integração de Servidor Customizado](/docs/backend/custom-server/) — o backend como partes públicas
- [Referência da CLI](/docs/cli/) — todos os comandos do `rebase`
- [Regras de Segurança](/docs/collections/security-rules/) — critérios de filtragem utilizados pelo `withAuth`
