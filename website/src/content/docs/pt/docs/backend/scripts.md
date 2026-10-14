---
sourceHash: d0d64eef975c9c59
title: Scripts e o Console
sidebar_label: Scripts e o Console
description: Abra os dados de um projeto a partir de um script, de um teste ou de um REPL com openRebase, ou a partir do terminal com rebase console. Sem servidor, sem alterações de schema.
---

## Visão geral

Na 0.24 não existe
`openRebase` nem `rebase console`: um script precisa construir um backend, ou
chamar a API REST de um servidor em execução.

Para olhar algumas linhas, corrigir uma, testar um filtro ou conferir o que uma
política permite que um usuário veja, você não deveria precisar iniciar um
servidor. O Rebase entrega os dados do projeto como um objeto, em dois lugares:

- **`rebase console`**, um REPL do Node no seu terminal com o projeto aberto;
- **`openRebase`**, o mesmo objeto em um script ou em um teste seu.

Ambos abrem o banco de dados sem alterá-lo: nenhuma tabela, role, trigger ou
função é criada. O `close()` de um script encerra o que o `openRebase` abriu. No
banco de dados de desenvolvimento gerenciado, o `rebase console` inicia esse banco
quando ele não está em execução e o deixa em execução depois, como fazem os comandos
`rebase db`; o `rebase db stop` o encerra. O objeto tem o vocabulário que uma
[função customizada](/docs/backend/custom-functions/) recebe do servidor,
`dataAsAdmin` e `sql`, de modo que um trecho de código passa de uma função para
um script e para o console sem mudar.

## `rebase console`

Execute-o no seu projeto:

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
| `collections` | As coleções do projeto, carregadas da mesma forma que o `rebase db push` as carrega |

O console abre o projeto da mesma forma que o `rebase db push`: o mesmo `.env`,
o mesmo banco de dados e as mesmas coleções. Um projeto no banco de dados de
desenvolvimento gerenciado o tem iniciado antes. O histórico do que você digitou
fica em `.rebase/console_history`, que o `.gitignore` do scaffold já deixa de
fora.

Uma entrada encadeada por pipe roda uma linha de cada vez, cada uma depois que o
`await` da linha anterior foi resolvido, de modo que a transcrição acima funciona como
`printf '…\n…\n' | rebase console`. Tudo o que vem depois de `.exit` é ignorado, e os
valores só são coloridos em um terminal. Tudo o que o console registra em log vai para
o stderr.

### Um trecho de código: `--eval`

`rebase console -e "<code>"` executa um único trecho de código em vez do REPL. O
valor de uma expressão, ou o `return` do corpo de uma função, é aguardado
(awaited) e impresso como JSON na saída padrão (stdout), de modo que a saída
pode ser encadeada em um pipe:

```bash
rebase console -e "rebase.dataAsAdmin.posts.find({ limit: 5 })"
rebase console -e "rebase.sql('select count(*) from posts')" | jq .
rebase console -e "const u = await rebase.withAuth({ uid: 'u1', roles: ['user'] }); return (await u.data.posts.find()).data"
```

Tudo o que o console registra em log, seja qual for o `LOG_LEVEL`, vai para o stderr,
de modo que o stdout contém o resultado e nada mais. Um trecho que lança uma exceção
imprime o erro no stderr e termina com código `1`.

Um banco de dados que
o console não consegue abrir é relatado uma única vez, e ele termina com código `1`:
o banner "Cannot connect to PostgreSQL" que os comandos `db` imprimem, ou, no banco
de desenvolvimento gerenciado, o aviso de que ele não tem nenhuma conexão livre. Esse
banco aceita apenas algumas conexões por vez e um `rebase dev` em execução ocupa
algumas, então feche outro cliente ou pare o `rebase dev` e execute o console novamente. Na
0.24 o banner aparecia duas vezes, sob uma linha `❌ [ERROR]` vazia, e um banco
gerenciado cheio imprimia `read ECONNRESET` com o seu stack trace como uma linha de JSON.

### Opções

| Flag | O que faz |
|---|---|
| `--eval`, `-e` | Executa este código em vez do REPL, imprime seu resultado aguardado como JSON e termina com código 1 se ele lançar uma exceção |
| `--collections`, `-c` | Caminho para o diretório de coleções, se não for o do próprio projeto |
| `--database-url` | Abre este banco de dados em vez do banco do projeto |
| `--docker` | Usa o banco de dados do docker compose, iniciando-o se necessário |

## `openRebase`

O `openRebase` de `@rebasepro/server-postgres` é o que o console chama. Use-o em
um script, um seed, uma correção de dados ou um teste. Em um projeto gerado pelo
scaffold, coloque o script em `backend/`, por exemplo `backend/scripts/publish-drafts.ts`:
o workspace do backend é o que depende de `@rebasepro/server-postgres`, e um script na
pasta `scripts/` da raiz não consegue importá-lo.

```typescript
import { openRebase } from "@rebasepro/server-postgres";
import { collections } from "../../config/collections";

const rebase = await openRebase({ databaseUrl: process.env.DATABASE_URL!, collections });

const { data: drafts } = await rebase.dataAsAdmin.posts.find({ where: { status: ["==", "draft"] } });
console.log(`${drafts.length} drafts`);
for (const draft of drafts) {
    await rebase.dataAsAdmin.posts.update(String(draft.id), { status: "published" });
}

await rebase.close();
```


Execute-o a partir de `backend/`. O `rebase db url` imprime a URL do banco de dados que o
projeto usa, inclusive o banco de desenvolvimento gerenciado:

```bash
cd backend
DATABASE_URL="$(pnpm exec rebase db url)" pnpm exec tsx scripts/publish-drafts.ts
```

| Membro | O que faz |
|---|---|
| `dataAsAdmin` | Toda coleção, lida e escrita como a identidade de serviço do servidor (`{ uid: "service", roles: ["admin"] }`): admin, e ainda avaliada pelas suas políticas de RLS, exatamente como o `rebase.dataAsAdmin` em uma função |
| `sql(query, { params })` | SQL puro na conexão do owner, com a mesma convenção de chamada do `rebase.sql` em uma função |
| `withAuth(user)` | Resolve para `{ data }`: as coleções como aquele usuário as vê. Toda leitura e escrita roda como ele, filtrada pela segurança em nível de linha, como seria uma requisição HTTP desse usuário |
| `collections` | As coleções com que foi aberto |
| `close()` | Encerra o pool de conexões que o `openRebase` criou. É seguro chamá-lo duas vezes |

Suas opções:

| Opção | O que faz |
|---|---|
| `databaseUrl` | O banco de dados a abrir. O `openRebase` cria o pool e o `close()` o encerra |
| `connection` | Uma conexão Drizzle que você já possui (`createPostgresDatabaseConnection(url).db`), no lugar de `databaseUrl`. Ela continua sendo sua: o `close()` a deixa aberta |
| `collections` | As coleções do projeto. Um array vazio as lê do banco de dados, como faz um servidor sem arquivos de coleção, e as serve somente para leitura |
| `pool` | Configurações do pool, junto com `databaseUrl` |
| `dataSourceKey` | A fonte de dados de onde essas coleções são servidas. Padrão `(default)` |

O `openRebase` não lê nenhuma variável de ambiente. O `DATABASE_URL` acima é lido
pelo seu script, e configurações como `REBASE_DB_POOL_MAX` ou `REALTIME_CDC` não
mudam nada aqui.

A abertura não registra
nada em log no nível `info`, de modo que o stdout de um script contém o que o script
imprime, e `tsx scripts/report.ts > report.json` escreve apenas o seu JSON. Avisos e
erros vão para o stderr em desenvolvimento. A nota sobre como as requisições são
isoladas (`RLS enforcement active`) é registrada no nível `debug`; a inicialização de
um servidor ainda a imprime em `info`. Um banco de dados que ele não consegue alcançar
rejeita a abertura com um único erro,
`Cannot connect to PostgreSQL at <host>:<port>: <reason>.`, e não registra nada em
log: o que imprimir fica a cargo do script. Na 0.24 essa nota era a primeira linha do stdout de
um script, e um banco de dados inalcançável registrava um banner antes do erro.

Seus acessores são tipados pelo `Database` que o `rebase generate-sdk --register`
registra, como o `rebase` de uma função, de modo que uma coleção, um campo ou um valor
de enum escrito errado em um script é um erro de tipo. O `backend/tsconfig.json` do
scaffold inclui `scripts/`, então o `tsc --noEmit` em `backend/` o relata. Sem um registro, nomeie-o a cada
chamada com `openRebase<Database>({ … })`; `OpenedRebase<Database>` é o tipo a dar a um
helper que recebe um. Sem nenhum dos dois, as linhas não são tipadas, e é por isso que o
primeiro exemplo converte `draft.id` com `String()`.

### Conferindo o que um usuário pode ver

O `withAuth` é a forma mais rápida de testar uma regra de segurança contra dados reais. O
scaffold de blog, o padrão do `rebase init`, dá a toda coleção os
`defaultSecurityRules` de `config/collections/index.ts`: todo usuário autenticado
lê todos os posts, e só um admin escreve um. Isto confere as duas metades, como
`backend/scripts/ada-check.ts`:

```typescript
import { openRebase } from "@rebasepro/server-postgres";
import { collections } from "../../config/collections";

const rebase = await openRebase({ databaseUrl: process.env.DATABASE_URL!, collections });
const ada = await rebase.withAuth({ uid: "ada", roles: ["user"] });

// A signed-in user reads every post…
const { data: seen } = await ada.data.posts.find();
const { data: all } = await rebase.dataAsAdmin.posts.find();
console.log(seen.length === all.length);

// …and writing one is refused: only an admin may.
const refused = await ada.data.posts.create({ title: "Not an admin" }).then(() => false, () => true);
console.log(refused);

await rebase.close();
```

Execute-o da mesma forma que o primeiro script, e ele imprime `true` duas vezes:

```bash
cd backend
DATABASE_URL="$(pnpm exec rebase db url)" pnpm exec tsx scripts/ada-check.ts
```

Uma regra que filtra linhas pelo dono é conferida da mesma forma: compare o campo de
dono de cada linha com o `uid` que você passou. No scaffold de blog nenhuma regra faz
isso, e o `authorId` de um post é o id de uma linha de autor, não de um usuário.

Um usuário é `{ uid, roles?, isAnonymous?, claims? }`; `claims` é o que o
`rebase.jwt()` lê em uma política.

O `withAuth` roda como a role restrita que a inicialização de um servidor cria
(`rebase_user`). Contra um banco de dados em que nenhum servidor Rebase foi
iniciado, essa role não existe, e as requisições de `withAuth` falham com o erro
de role desconhecida do Postgres em vez de rodar sem filtro. Execute
`rebase db push`, ou inicie o servidor uma vez, antes.

### Em um teste

```typescript
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { openRebase, type OpenedRebase } from "@rebasepro/server-postgres";
import { collections } from "../../config/collections";

let rebase: OpenedRebase;
before(async () => {
    rebase = await openRebase({ databaseUrl: process.env.TEST_DATABASE_URL!, collections });
});
after(() => rebase.close());

test("a signed-in user reads every post and writes none", async () => {
    const ada = await rebase.withAuth({ uid: "ada", roles: ["user"] });
    const { data: seen } = await ada.data.posts.find();
    const { data: all } = await rebase.dataAsAdmin.posts.find();
    assert.equal(seen.length, all.length);
    await assert.rejects(ada.data.posts.create({ title: "Not an admin" }));
});
```


Salve-o como `backend/scripts/posts.test.ts` e execute-o a partir de `backend/` com o
test runner do Node, apontando `TEST_DATABASE_URL` para um banco de dados em que um
servidor Rebase já tenha sido iniciado:

```bash
TEST_DATABASE_URL="$(pnpm exec rebase db url)" pnpm exec tsx --test scripts/posts.test.ts
```

O mesmo funciona com Vitest ou Jest.

### Coleções com histórico

Uma escrita em uma coleção com [`history: true`](/docs/backend/history/) registra
a sua entrada da mesma forma que uma escrita do servidor. A entrada é escrita na
transação da própria linha, então uma escrita que sofre rollback não deixa
entrada alguma. Ela é registrada com a identidade com que a escrita rodou:
`service` para o `dataAsAdmin`, o `uid` do usuário sob o `withAuth`. As escritas
feitas pelo `rebase console` são registradas da mesma forma.

O `openRebase` não cria nada onde registrar. Se nenhum backend com histórico foi
iniciado no banco de dados, falta a tabela `rebase.entity_history`. Uma escrita em
uma coleção com histórico é então recusada com
[`HISTORY_UNAVAILABLE`](/docs/backend/errors/#data-queries-and-writes) antes de
qualquer um dos seus callbacks rodar, e a mensagem diz o que está faltando. As
leituras funcionam normalmente. Inicie o backend uma vez com o histórico ativado
(o `rebase dev` faz isso), e as escritas passam.

As entradas são registradas, nunca podadas. A retenção é uma configuração do
servidor que um script não enxerga, então o servidor as poda como de costume:
quando ele escreve a entidade em seguida, e na sua varredura de hora em hora.

### O que ele deixa de fora

O `openRebase` abre a camada de dados e nada mais. Ele não inicia o tempo real,
então suas escritas não são anunciadas às consultas ao vivo. Storage, e-mail,
administração de autenticação e as suas funções não estão nele.

Quando um script precisa dessas coisas também, construa o backend sem servi-lo:
`createRebaseBackend({ …, provision: false })` entrega a você o `backend.rebase`,
o cliente completo em processo, sem nada montado e sem nada iniciado. Veja
[o backend sem um servidor](/docs/backend/custom-server/#the-backend-without-a-server).
Para testar um callback de coleção sem banco de dados algum, chame-o com
[`createCallContext`](/docs/collections/callbacks/#testing-a-callback).

## Relacionado

- [Integração com Servidor Customizado](/docs/backend/custom-server/) — o backend como peças públicas
- [Referência da CLI](/docs/cli/) — todos os comandos `rebase`
- [Regras de Segurança](/docs/collections/security-rules/) — o que filtra o `withAuth`
