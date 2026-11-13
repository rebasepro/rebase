---
sourceHash: ff162864c3d1600b
slug: pt/docs/troubleshooting
title: Solução de problemas
description: As falhas que impedem um backend Rebase de iniciar ou responder requisições — um banco de dados inacessível, credenciais incorretas, uma extensão ausente, uma recusa de RLS, desvio de esquema (schema drift), uma porta ocupada, uma função que não carrega — e como cada uma delas se parece.
---

As falhas que impedem um backend Rebase de iniciar ou responder requisições, como cada
uma delas realmente se parece na tela e o que fazer a respeito.

A inicialização (boot) falha de forma ruidosa e completa. Se o banco de dados estiver inacessível,
as credenciais estiverem incorretas ou o esquema não puder ser compilado ou aplicado,
`initializeRebaseBackend` lança um erro, nada é servido e o processo encerra com código `1`.
Não há modo degradado: um servidor que inicializa respondendo a autenticação enquanto toda
rota `/api/data/*` falha é mais difícil de diagnosticar do que um que nunca inicializa.

Portanto, o primeiro lugar a verificar é sempre a última linha no log antes do encerramento.

## Lendo um erro de inicialização

Todo erro de banco de dados que você vê é um encapsulamento (wrapper). O Drizzle relança falhas de consulta como
`Failed query: …` com um stack trace que passa por seus próprios mecanismos internos, e a frase que
indica o que está errado fica logo abaixo, em `.cause` — ou dentro de um `AggregateError`
quando um host dual-stack tenta vários endereços.

O runtime desencapsula isso para você. Uma falha de inicialização registra no log:

- um **diagnóstico em destaque (em uma caixa)** indicando o host, a porta e a correção, e
- linhas `caused by:` contendo a cadeia de erros, terminando na razão fornecida pelo sistema
  operacional ou pelo Postgres.

Se você estiver lendo logs em JSON (`NODE_ENV=production`), a mesma cadeia estará sob
`error.cause`, com `code`, `address` e `port` em cada elo.

### `Failed query: [redacted]`

Essa não é uma linha de log truncada. O Drizzle monta cada falha de consulta como
`Failed query: <sql>` seguido pelos valores vinculados, de modo que a instrução e seus
parâmetros — um endereço de e-mail, um hash de senha — acompanham a mensagem e o
stack de qualquer coisa que o driver relance. O logger remove esse trecho de
cada linha que grava e imprime `[redacted]` no lugar.

De qualquer forma, a instrução SQL raramente é a resposta: a razão está nas linhas `caused by:`
logo abaixo. Quando você realmente precisar dela, defina `REBASE_LOG_RAW_QUERIES=true` em
desenvolvimento e o SQL será exibido. Essa variável é ignorada fora do desenvolvimento,
portanto, uma variável que vaze para um ambiente de produção não poderá desmascarar
nada por lá.

## O banco de dados não está em execução

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ❌  Cannot connect to PostgreSQL at 127.0.0.1:5432
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  The driver said: connect ECONNREFUSED 127.0.0.1:5432 (ECONNREFUSED)
```

Nada está escutando nesse endereço. Inicie o banco de dados:

```bash
docker compose up -d db       # the service a Rebase scaffold ships
brew services start postgresql@18
```

Ou execute `rebase dev` sem nenhuma `DATABASE_URL`, o que iniciará um banco de dados PGlite
gerenciado para você e não requer nada instalado.

Se o host e a porta na caixa não forem os esperados, a `DATABASE_URL` no
`.env` não é a que o processo leu — verifique se há um segundo `.env`, uma
variável de shell já exportada ou um contêiner que foi iniciado antes da sua edição.

## A senha ou o nome do banco de dados está incorreto

```
  ❌  Authentication failed for user "app" at db.internal:5432
  The driver said: password authentication failed for user "app" (28P01)
```

`28P01` indica uma senha incorreta, `28000` uma role que não pode se conectar a partir daqui, e
`3D000` um banco de dados que não existe. Os três são fatos definidos sobre a
connection string: tentar novamente produzirá a mesma resposta, então a inicialização falha imediatamente
em vez de reportar um pool que "pode se recuperar".

Verifique as credenciais em `DATABASE_URL`. Uma senha contendo `@`, `/`, `?` ou
`#` precisa ser codificada em percentual (percent-encoded) — caracteres não codificados alteram
silenciosamente a estrutura da URL e o host ao qual você acaba se conectando não será o que você informou.

## `SchemaDefinitionError` — o esquema não compila

<span class="since-badge" data-since="0.31">Desde 0.31</span>

A inicialização, `rebase db generate`, `db push`, `generate-sdk` e `doctor` compilam as
tabelas exportadas por `backend/schema/index.ts` antes de qualquer outra coisa, e interrompem a execução quando qualquer
tabela não compilar — ausência de `rls`, `"inherit"` sem `defaultRls`, uma relação
com uma tabela que o índice não exporta, um `defineTable` em um arquivo irmão que o índice
deixa de fora — listando todas as tabelas, chaves e problemas de uma só vez. Corrija cada um deles;
o comando `rebase verify` reporta a mesma lista sem iniciar nada.

## `config/collections` foi recusado

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Um projeto anterior à versão 0.31 mantém seu modelo de dados em `config/collections`, o qual
nada mais lê: o runtime, todos os comandos da CLI e um bundle de formato 2
são recusados exibindo `rebase migrate collections-to-tables` na mensagem. Execute-o
em uma árvore git limpa; ele reescreverá o projeto para `backend/schema` e
`frontend/src/cms`, garantirá que o SQL gerado permaneça inalterado e exibirá os passos
restantes para você. Veja [Atualizando de 0.30 para 0.31](https://rebase.pro/docs/upgrading/0-30-to-0-31/).

## `type "vector" does not exist`

O pgvector é uma extensão de servidor, então o Rebase a instala apenas onde o projeto diz
que pode. Declare-a em `backend/resources.ts`:

```ts
database({ extensions: ["vector"] })
```

O banco de dados também precisa de uma imagem que inclua a biblioteca. A imagem do scaffold
`pgvector/pgvector:pg18` a inclui; uma imagem padrão `postgres:18` não. Se a instalação
em si for recusada (`extension "vector" is not available`, ou um erro de permissão),
a configuração já está correta e o que está faltando é a biblioteca no
servidor ou uma role com permissão para executar `CREATE EXTENSION vector;`.

## O banco de dados recusou a instrução

<span class="since-badge" data-since="0.31">Desde 0.31</span>

```
DB_PERMISSION_DENIED — Permission denied by the database on "notes"
(row-level security). Check the RLS policies for this table.
```

SQLSTATE `42501`. Dois problemas diferentes ocorrem sob esse código, e a mensagem
os diferencia:

- **Uma política de segurança a nível de linha (RLS) negou a linha** — a mensagem acima. O
  sistema de controle de acesso está funcionando; o solicitante requisitou algo que suas
  políticas não permitem. Verifique a configuração de `rls` da tabela em `backend/schema` e execute
  `npx @rebasepro/rls-check` para uma auditoria somente leitura do que o banco de dados
  realmente aplicará.
- **A role não possui um `GRANT`.** A mensagem, em vez disso, especifica o objeto:

  ```
  DB_PERMISSION_DENIED — Permission denied by the database: the role this request
  runs as has no privilege on schema "rebase". That is a missing GRANT to that
  role, not a row-level security policy.
  ```

  Nada na requisição resolverá o problema — a role sob a qual as requisições rodam não tem
  acesso algum a esse objeto. O servidor concede permissões à sua role de requisições nos esquemas
  que provisiona durante a inicialização; um objeto criado fora dele (por outra role ou em
  um esquema não declarado por nenhuma tabela) precisa de seu próprio `GRANT`. Esse é um
  problema de implantação (deployment).

Uma leitura excluída por RLS não é um erro: as linhas são filtradas e você recebe uma
página vazia. Se uma tabela parecer vazia para um usuário autenticado que deveria ver
linhas, a política é o lugar onde procurar, e não a consulta.

## `SCHEMA_DRIFT` — uma tabela ou coluna não existe

```
SCHEMA_DRIFT — Schema drift: table "posts" does not exist.
```

O código e o banco de dados divergem. Em desenvolvimento:

```bash
rebase db push        # apply the tables to the database
rebase doctor         # the full three-way drift report
```

Em um tenant Cloud gerenciado, o `db push` não consegue alcançar o banco de dados — o runtime
aplica o esquema durante a inicialização; portanto, faça um novo deploy em vez de executar o push.

Se uma tabela existe, mas uma coluna não, a causa comum é um arquivo de tabela
que foi editado sem ser gerado novamente: execute `rebase schema generate` e faça o push
de novo.

## `Error: EOF` de `db push` no banco de dados gerenciado

```
Error: EOF
✗ atlas schema apply --to file://.rebase/sql/schema.sql --dry-run failed.
```

O banco de dados de desenvolvimento gerenciado aceita poucas conexões por vez, e um
`rebase dev` em execução mantém algumas delas ativas. O Atlas, que planeja o push, abre mais
duas conexões, e uma delas foi fechada inesperadamente. Nada foi aplicado, portanto o comando pode ser
executado novamente com segurança; o servidor de desenvolvimento fecha conexões ociosas após 30 segundos. Se o erro
persistir, pare o `rebase dev` enquanto faz o push.

O push fecha suas
próprias conexões antes que o Atlas inicie, o que normalmente deixa espaço para o Atlas,
e o erro explica o que aconteceu.

## A porta já está em uso

```
Port 3001 is in use — trying 3002.
```

O ambiente de desenvolvimento se vincula à próxima porta livre e avisa sobre isso. A mensagem é importante porque tudo
o mais — a `VITE_API_URL` do seu frontend, um favorito no navegador, um comando `curl` — ainda estará apontando
para a porta antiga. A causa comum é uma instância anterior do `rebase dev` ainda ocupando o
socket.

Passe `--port` para fixar uma porta ou encerre o outro processo. Em produção, não há
novas tentativas: a porta configurada é a porta utilizada, e o erro `EADDRINUSE` é fatal.

## O backend travou e o `rebase dev` continuou em execução

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Um backend que lança um erro na inicialização não interrompe o observador (watcher) — ele imprime a stack e
aguarda uma alteração de arquivo. Quando o backend não se anuncia dentro de
`REBASE_DEV_READY_TIMEOUT_MS` (30 segundos por padrão), o `rebase dev` reporta o seguinte:

```
  ✗ The backend has not started after 30s.
    Fix the error above; the watcher restarts it on the next change.
```

O erro exibido acima é o verdadeiro problema. As causas mais comuns são um erro de sintaxe em
um arquivo em `backend/schema`, uma importação que não resolve ou uma `DATABASE_URL` que
não aponta para nada.

## Uma função personalizada não está sendo servida

As funções são carregadas a partir de `backend/functions` na inicialização, e um arquivo que falha ao
carregar é **ignorado, não sendo um erro fatal** — o servidor inicia sem ele. Portanto, o sintoma é
um 404 em uma rota que você acabou de criar, e a explicação está duas linhas antes no
log de inicialização:

```
❌ [functions] Failed to load orders.ts: Cannot find module './util'
⚠️ [functions] 1 function file(s) were skipped and will NOT be served:
  - orders.ts (threw: Cannot find module './util')
```

As causas comuns: uma dependência importada que não está no `package.json`, um import
relativo sem sua extensão (`./util` em vez de `./util.js` — o projeto é
ESM, logo a extensão é obrigatória) e um arquivo que exporta algo diferente de
um app Hono. Crie funções usando `defineFunction(...)` de `@rebasepro/server/functions`
para obter esse último caso como um erro de compilação — use esse subcaminho, não a raiz
do pacote, para que a função permaneça portátil.

Subdiretórios não são verificados. `functions/admin/users.ts` é reportado como uma
entrada ignorada em vez de ser servido.

Assim que o servidor estiver ativo, uma função que lançar um erro no momento da requisição responderá com o
envelope de erro JSON e registrará o motivo no log; uma função que nunca retornar será interrompida em
`REBASE_FUNCTIONS_TIMEOUT_MS` e responderá com `504 FUNCTION_TIMEOUT`.

## Está funcionando? `/livez` e `/health`

| Caminho | Acessa o banco de dados | Resposta |
| --- | --- | --- |
| `/livez` | Não | `200 {"status":"ok"}` enquanto o processo estiver em execução. Use para uma verificação de atividade (liveness probe). |
| `/health` | Sim, todas as fontes de dados | `200 {"status":"ok"}` quando todas as fontes de dados configuradas responderem; `503 {"status":"degraded"}` quando alguma não responder. Use para uma verificação de prontidão (readiness probe). |

Não aponte uma liveness probe para `/health`: uma oscilação temporária no banco de dados faria
o orquestrador encerrar um processo perfeitamente saudável, transformando uma breve interrupção em um
ciclo contínuo de reinicializações (restart loop).

O endpoint `/health` não requer autenticação, portanto, fora do ambiente de desenvolvimento, ele publica apenas o veredito e
qual fonte de dados está degradada, e nada mais. O texto de erro do próprio driver —
que cita o host, a porta, o nome do banco de dados e a role — vai para os logs.

## Erros após a inicialização

Toda falha de API responde com o mesmo envelope e carrega um `code`. A
[referência de códigos de erro](/docs/backend/errors/) lista todos eles com o status
e a correção.

## Próximos passos

- [Códigos de erro](/docs/backend/errors/) — todos os valores de `code` que a API pode responder, com o status e a correção.
- [Ambiente e Configuração](/docs/getting-started/configuration/) — todas as variáveis que o runtime lê e aquelas sem as quais a produção se recusa a iniciar.
- [Visão Geral do Backend](/docs/backend/) — o que a inicialização faz, em ordem, e qual probe responde a qual pergunta.
