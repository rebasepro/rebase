---
sourceHash: 1030bf24935489a6
slug: pt/docs/troubleshooting
title: Solução de problemas
description: As falhas que impedem um backend Rebase de iniciar ou responder requisições — um banco de dados inacessível, credenciais incorretas, uma extensão ausente, uma recusa de RLS, desvio de esquema (schema drift), uma porta ocupada, uma função que não carrega — e como cada uma se parece.
---

As falhas que impedem um backend Rebase de iniciar ou responder requisições, como cada uma
realmente se parece na tela e o que fazer a respeito.

A inicialização falha de forma ruidosa e completa. Se o banco de dados estiver inacessível,
as credenciais estiverem incorretas ou o esquema da coleção não puder ser aplicado,
`initializeRebaseBackend` lança um erro, nada é servido e o processo é encerrado com código `1`.
Não há modo degradado: um servidor que inicializa respondendo ao login enquanto todas as rotas
`/api/data/*` falham é mais difícil de diagnosticar do que um que nunca inicializa.

Portanto, o primeiro lugar para olhar é sempre a última linha no log antes do encerramento.

## Lendo um erro de inicialização

Cada erro de banco de dados que você vê é um encapsulador (*wrapper*). O Drizzle relança falhas de consulta como
`Failed query: …` com um rastreamento de pilha através de seus próprios componentes internos, e a frase que
informa o que está errado fica logo abaixo, em `.cause` — ou dentro de um `AggregateError`
quando um host de pilha dupla (*dual-stack*) tentou vários endereços.

O runtime desempacota isso para você. Uma falha de inicialização registra:

- um **diagnóstico em destaque** indicando o host, a porta e a solução, e
- linhas `caused by:` trazendo a cadeia de erros, terminando na razão fornecida pelo
  sistema operacional ou pelo Postgres.

Se você estiver lendo logs em JSON (`NODE_ENV=production`), a mesma cadeia estará sob
`error.cause`, com `code`, `address` e `port` em cada elo.

### `Failed query: [redacted]`

Essa não é uma linha de log truncada. O Drizzle monta cada falha de consulta como
`Failed query: <sql>` seguido pelos valores vinculados, portanto, a instrução e seus
parâmetros — um endereço de e-mail, um hash de senha — acompanham a mensagem e
o rastreamento de pilha de qualquer coisa que o driver relance. O registrador de logs (*logger*) remove esse trecho de
cada linha gravada e imprime `[redacted]` onde ele estava.

A instrução em si raramente é a resposta: o motivo está nas linhas `caused by:`
abaixo dela. Quando você realmente precisar dela, defina `REBASE_LOG_RAW_QUERIES=true` em
desenvolvimento e o SQL será exibido. Essa variável é ignorada fora do ambiente de desenvolvimento,
de modo que uma variável vazada para um ambiente de produção não poderá exibir dados confidenciais lá.

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
gerenciado para você sem precisar instalar nada.

Se o host e a porta no quadro não forem os que você esperava, a `DATABASE_URL` no
`.env` não é a que o processo leu — verifique se há um segundo `.env`, uma variável de shell
já exportada ou um contêiner que foi iniciado antes de você editá-lo.

## A senha ou o nome do banco de dados está incorreto

```
  ❌  Authentication failed for user "app" at db.internal:5432
  The driver said: password authentication failed for user "app" (28P01)
```

`28P01` indica uma senha incorreta, `28000` uma role que não pode se conectar a partir daqui e
`3D000` um banco de dados que não existe. Os três são fatos consolidados sobre a
string de conexão: tentar novamente produz a mesma resposta, então a inicialização falha imediatamente
em vez de relatar um pool que "pode se recuperar".

Verifique as credenciais em `DATABASE_URL`. Uma senha contendo `@`, `/`, `?` ou
`#` precisa ser codificada em URL (*percent-encoded*) — caracteres não codificados alteram a estrutura da URL
silenciosamente e o host ao qual você acaba se conectando não será o que você escreveu.

## `type "vector" does not exist`

O pgvector é uma extensão de servidor, portanto, o Rebase só a instala onde um projeto autoriza
explicitamente. Declare-a em `config/resources.ts`:

```ts
database({ extensions: ["vector"] })
```

O banco de dados também precisa de uma imagem que inclua a biblioteca. A imagem do scaffold
`pgvector/pgvector:pg18` inclui; uma imagem padrão `postgres:18` não. Se a própria instalação
for recusada (`extension "vector" is not available` ou um erro de permissão),
a configuração já está correta e o que está faltando é a biblioteca no
servidor ou uma role com permissão para executar `CREATE EXTENSION vector;`.

## O banco de dados recusou a instrução

```
DB_PERMISSION_DENIED — Permission denied by the database on "notes"
(row-level security). Check the RLS policies for this table.
```

SQLSTATE `42501`. Dois problemas diferentes ocorrem sob esse código, e a mensagem
os distingue:

- **Uma política de segurança em nível de linha (RLS) recusou a linha.** O sistema de controle de acesso
  está funcionando; o chamador solicitou algo que suas políticas não permitem. Verifique
  as `securityRules` da coleção e execute `npx @rebasepro/rls-check` para uma
  auditoria somente leitura do que o banco de dados realmente aplicará.
- **A role não possui um `GRANT`.** Nada na requisição resolverá o problema — a
  role de conexão não pode acessar a tabela de forma alguma. Trata-se de um problema de implantação.

Uma leitura excluída por RLS não é um erro: as linhas são filtradas e você recebe uma
página vazia. Se uma coleção parecer vazia para um usuário autenticado que deveria ver
linhas, a política é o lugar onde procurar, e não a consulta.

## `SCHEMA_DRIFT` — uma tabela ou coluna não existe

```
SCHEMA_DRIFT — Schema drift: table "posts" does not exist.
```

O código e o banco de dados divergem. Em desenvolvimento:

```bash
rebase db push        # apply the collections to the database
rebase doctor         # the full three-way drift report
```

Em um locatário gerenciado na Nuvem (Cloud tenant), o `db push` não consegue alcançar o banco de dados — o runtime
aplica o esquema na inicialização, portanto, faça uma nova implantação em vez de executar o push.

Se uma tabela existir, mas uma coluna não, a causa comum é um arquivo de coleção
que foi editado sem ser regenerado: execute `rebase schema generate` e faça o push
novamente.

## A porta já está em uso

```
Port 3001 is in use — trying 3002.
```

O ambiente de dev vincula a próxima porta livre e avisa sobre isso. A mensagem é importante porque todo
o restante — a `VITE_API_URL` do seu frontend, um favorito, um comando `curl` — ainda está apontando
para a porta antiga. A causa comum é uma execução anterior de `rebase dev` ainda segurando
o socket.

Passe `--port` para fixar uma porta, ou encerre o outro processo. Em produção não há nova
tentativa: a porta configurada é a porta utilizada, e `EADDRINUSE` é fatal.

## O backend travou e o `rebase dev` continuou em execução

Um backend que lança exceção na inicialização não para o monitorador (*watcher*) — ele imprime o rastreamento de pilha e
aguarda uma alteração de arquivo. O `rebase dev` relata isso:

```
  ✗ The backend crashed on startup.
    Fix the error above; the watcher restarts it on the next change.
```

O erro acima dele é o verdadeiro. As causas mais comuns são um erro de sintaxe em
um arquivo de coleção, uma importação que não resolve e uma `DATABASE_URL` que
aponta para o vazio.

## Uma função personalizada não está sendo servida

As funções são carregadas de `backend/functions` na inicialização, e um arquivo que falha ao
carregar é **ignorado, não fatal** — o servidor inicia sem ele. Portanto, o sintoma é
um 404 em uma rota que você acabou de escrever, e a explicação está duas linhas acima no
log de inicialização:

```
❌ [functions] Failed to load orders.ts: Cannot find module './util'
⚠️ [functions] 1 function file(s) were skipped and will NOT be served:
  - orders.ts (threw: Cannot find module './util')
```

As causas comuns: uma dependência importada que não está no `package.json`, uma importação
relativa sem sua extensão (`./util` em vez de `./util.js` — o projeto é ESM, portanto a
extensão é obrigatória) e um arquivo que exporta algo diferente de um aplicativo Hono.
Escreva usando `defineFunction(...)` de `@rebasepro/server/functions` para
obter esse último como um erro de compilação — use esse subcaminho, não a raiz do pacote,
para que a função permaneça portátil.

Subdiretórios não são examinados. `functions/admin/users.ts` é relatado como uma
entrada ignorada em vez de ser servido.

Assim que o servidor estiver ativo, uma função que lança exceção no momento da requisição responde com o
envelope de erro em JSON e registra o motivo; uma função que nunca retorna é interrompida em
`REBASE_FUNCTIONS_TIMEOUT_MS` e responde com `504 FUNCTION_TIMEOUT`.

## Está ativo? `/livez` e `/health`

| Caminho | Acessa o banco de dados | Resposta |
| --- | --- | --- |
| `/livez` | Não | `200 {"status":"ok"}` enquanto o processo estiver em execução. Use para uma liveness probe. |
| `/health` | Sim, todas as fontes de dados | `200 {"status":"ok"}` quando todas as fontes de dados configuradas responderem; `503 {"status":"degraded"}` quando alguma não responder. Use para uma readiness probe. |

Não configure uma liveness probe em `/health`: uma oscilação passageira no banco de dados faria
com que o orquestrador encerrasse um processo saudável, transformando uma breve indisponibilidade em um
ciclo de reinicialização contínuo.

O endpoint `/health` não requer autenticação, portanto, fora do ambiente de desenvolvimento ele publica apenas o veredito e
qual fonte de dados está degradada, e nada mais. O texto de erro do próprio driver —
que cita o host, a porta, o nome do banco de dados e a role — vai para os logs.

## Erros após a inicialização

Todas as falhas de API respondem com o mesmo envelope e trazem um `code`. A
[referência de códigos de erro](/docs/backend/errors/) lista todos eles com o status
e a solução.

## Próximos passos

- [Códigos de erro](/docs/backend/errors/) — todos os `code`s que a API pode responder, com o status e a solução.
- [Ambiente e Configuração](/docs/getting-started/configuration/) — todas as variáveis que o runtime lê e aquelas sem as quais o ambiente de produção se recusa a iniciar.
- [Visão Geral do Backend](/docs/backend/) — o que a inicialização faz, em ordem, e qual probe responde a qual pergunta.

---
