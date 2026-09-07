---
sourceHash: a3fccf5118b08dd0
title: Referência da CLI
sidebar_label: CLI
description: Comandos da CLI do Rebase para inicializar projetos, gerar schemas, migrar bancos de dados e gerar o SDK.
---

## Visão Geral

A CLI do Rebase (`rebase`) gerencia seu projeto do scaffolding até a implantação.

## Installation

```bash
pnpm add -g @rebasepro/cli
```

Ou use via `pnpm dlx`:

```bash
pnpm dlx @rebasepro/cli <command>
```

## Saída legível por máquina

<span class="since-badge" data-since="0.18">Since 0.18</span>

`--json` é a chave, e fora da família `cloud` é a única: `rebase status`,
`rebase resources` e `rebase apps list` passam então a colocar um único valor
JSON no stdout — o resultado, ou um envelope
`{"error": {"message", "code", "hint", "issues"}}` com saída diferente de zero —
em **toda** saída do comando, de modo que quem chama pode fazer o parsing do
stdout incondicionalmente. Sem ela, escrevem texto para pessoas e as falhas vão
para o stderr. `rebase cloud` usa o mesmo envelope e é a única exceção à chave:
ele também liga o JSON por conta própria quando o stdout não é um TTY, ou quando
`REBASE_JSON=1` está definido. Então `rebase cloud status | cat` é JSON enquanto
`rebase status | cat` não é — em um script, passe `--json` explicitamente em vez
de confiar em qualquer uma das duas regras.

## Comandos

### `rebase init`

Inicialize um novo projeto Rebase:

```bash
rebase init [directory]
```

Monta a estrutura do projeto com os pacotes de frontend, backend e compartilhados.

| Flag | O que faz |
|---|---|
| `-t, --template <preset>` | `blog`, `ecommerce` ou `blank`. Padrão `blog` |
| `--headless` | Somente backend — sem painel de administração e sem arquivos de coleções. `--template` não tem efeito, porque não há coleções a semear |
| `-y, --yes` | Nunca pergunta. **Obrigatório onde não há terminal para responder**, como em CI. Pula o `git init` e a instalação de dependências — os padrões interativos dizem sim a ambos, então passe `--git` / `--install` se os quiser |
| `-i, --install` | Instalar as dependências após o scaffolding |
| `-g, --git` | Inicializar um repositório e fazer o primeiro commit |
| `--database-url <url>` | Usar um banco de dados existente em vez do gerenciado |
| `--introspect` | Gerar coleções a partir desse banco. Implica `--template blank` e exige `--install` |
| `--project <slug>` | Vincular o scaffold a um projeto do Rebase Cloud |
| `--setup-key <key>` | A chave de uso único que autentica esse vínculo |

### `rebase dev`

Inicie o servidor de desenvolvimento:

```bash
rebase dev
```

Inicia tanto o frontend quanto o backend com hot reloading.

As duas portas são derivadas do caminho do projeto, de modo que vários projetos
Rebase podem rodar lado a lado. Use as URLs que o `rebase dev` imprime. Fixe uma
com `rebase dev --port 3001`.

### `rebase build`

Compile o projeto em um bundle implantável em `dist-bundle/`:

```bash
rebase build
```

O bundle é o artefato que você implanta — a imagem do runtime o carrega, então não
há nenhuma imagem de aplicação para você construir. Flags úteis:

| Flag | Efeito |
|------|--------|
| `--out <dir>` | Gravar o bundle em outro lugar que não `dist-bundle/` |
| `--vendor` | Sempre instalar e enviar as dependências do bundle |
| `--no-vendor` | Nunca embutir; o pod instala no primeiro início |
| `--skip-type-check` | Pular a checagem de tipos (mais rápido, menos seguro) |
| `--no-static` | Pular a construção do frontend |

As dependências são embutidas por padrão para que um reinício do pod não pague de
35 a 55 segundos de instalação. Uma árvore que passa de 200 MB em disco é
descartada, porque o limite de upload é de 100 MB comprimidos — o raciocínio está
no changelog.

### `rebase start`

Execute o bundle compilado como servidor de produção:

```bash
rebase start
```

Lê `PORT` e o resto do `.env`, ao contrário do `rebase dev`. Aponte-o para um
bundle em outro lugar com `rebase start --bundle ./dist-bundle`.

### `rebase apps list`

Mostre os apps que este repositório declara:

```bash
rebase apps list
```

Um repositório pode declarar mais de um app implantável — um backend e um site de
marketing, por exemplo. É assim que você vê sobre o que o `rebase build` e a
implantação vão agir.

### `rebase eject`

Assuma o processo do servidor e a imagem dele:

```bash
rebase eject
```

Escreve o ponto de entrada do backend e um `Dockerfile` no projeto e vira o
backend dele, de modo que o repositório passe a construir a própria imagem em vez
de rodar o runtime publicado. A partir daí **as atualizações do runtime da
plataforma deixam de alcançá-lo**, e CORS, a ligação da autenticação, o
armazenamento e o desligamento passam a ser seus para configurar.

Pré-visualize com `rebase eject --dry-run`, que lista o que mudaria e não muda
nada. `--force` substitui um `backend/src/index.ts` ou `env.ts` existente,
mantendo o arquivo atual como `<name>.bak`.

### `rebase schema generate`

Gere o schema do Drizzle ORM a partir das suas coleções em TypeScript:

```bash
rebase schema generate
```

Isso lê suas coleções de `config/collections/` e gera `backend/src/schema.generated.ts` com as definições de tabelas, enums e relações do Drizzle.

### `rebase db push`

Envie as mudanças de schema diretamente para o banco (somente desenvolvimento):

```bash
rebase db push
```

:::caution
`db push` modifica o banco diretamente, sem arquivos de migração. Use `db generate` + `db migrate` em produção.
:::

### `rebase db generate`

Gere arquivos de migração SQL a partir das mudanças de schema:

```bash
rebase db generate
```

Cria arquivos de migração com data e hora em `drizzle/`, que podem ser revisados e commitados.

### `rebase db migrate`

Execute as migrações pendentes do banco:

```bash
rebase db migrate
```

Aplica ao banco todas as migrações ainda não aplicadas.

### `rebase db backup` / `backups` / `restore`

```bash
rebase db backup --out ./backups        # or s3://bucket/prefix, gs://bucket/prefix
rebase db backups                       # list what is stored
rebase db restore ./backups/<file>.dump --yes
```

`backup` roda `pg_dump`; `restore` roda `pg_restore` e é destrutivo, então exige
`--yes`. `--out` aceita um caminho local ou uma URL de object storage, e assume
`$BACKUP_DESTINATION` ou `./backups` por padrão.

### `rebase db pull`

Copie outro banco de dados para o de desenvolvimento local:

```bash
rebase db pull --from postgres://…  [--anonymize]
```

`--anonymize` substitui os campos pessoais no caminho de entrada, de modo que uma
cópia de produção possa ser trabalhada localmente sem levar dados reais de
clientes para um notebook.

O `pg_dump` remove os privilégios, então a cópia chegaria com as políticas RLS da
origem e sem nenhum dos grants por trás delas — cada leitura como `rebase_user`
falhando com `permission denied`. O pull reprovisiona o papel da aplicação depois,
usando a mesma rotina que o boot e o `rebase db push` usam, de modo que as tabelas
internas do Rebase continuem revogadas como devem.

O destino é sempre o banco de desenvolvimento local deste projeto e não pode ser
escolhido: `--database-url` é recusado em vez de aceito, então não há como
escrever «puxar para a produção». `--from` é a única direção.

### `rebase db url`

Imprime a string de conexão que este projeto está usando, e nada mais, para que
ela possa ser encadeada:

```bash
rebase db url
psql "$(rebase db url)"
```

O banco de desenvolvimento gerenciado é o caso que precisa disto: o `.env` deixa
`DATABASE_URL` comentada de propósito, e a porta é derivada do caminho do
projeto, então nada em disco a nomeia. Quando você definiu uma `DATABASE_URL`
sua, é ela que é impressa — a ordem de resolução é a mesma que todo outro comando
segue. Ele inicia o banco gerenciado se ainda não estiver rodando.

### `rebase db stop` / `rebase db reset`

Somente para o banco de desenvolvimento gerenciado:

```bash
rebase db stop     # stop it; the data is kept
rebase db reset    # delete it and start over
```

### `rebase db branch`

```bash
rebase db branch create <name>
rebase db branch list
rebase db branch info <name>
rebase db branch switch <name>     # work on it; every later command follows
rebase db branch switch            # say which branch you are on
rebase db branch switch --off      # back to the main database
rebase db branch delete <name>
rebase db branch prune [--older-than 14d] [--include-dev-diff]
```

O PostgreSQL não copia nem descarta um banco ao qual outra coisa esteja conectada,
e essa «outra coisa» costuma ser o seu próprio `rebase dev`. `create` e `delete`
nomeiam o que está mantendo o banco aberto; `--force` desconecta essas sessões
primeiro.

<span class="since-badge" data-since="0.18">Since 0.18</span> Cada branch é uma cópia completa em disco, então é preciso limpá-los. `prune`
remove três coisas: uma entrada cujo banco foi descartado fora do Rebase, um banco
de branch cuja entrada nunca foi escrita e — apenas com `--older-than` — branches
mais antigos do que a idade que você indicar. Ele pergunta antes de remover
qualquer coisa, a não ser que você passe `--yes`.

<span class="since-badge" data-since="0.18">Since 0.18</span> `switch` registra o branch em `.rebase/branch.json` e nunca edita o `.env`. Ele
tem precedência sobre `DATABASE_URL` no `.env` e perde para `--database-url` ou
para uma `DATABASE_URL` no shell, de modo que uma flag na linha de comando sempre
supera um switch feito antes. Excluir o branch em que você está devolve você ao
banco principal, em vez de deixar o checkout apontando para um banco que não
existe mais.

:::note[Não no banco de desenvolvimento gerenciado]
`push`, `generate` e `migrate` planejam o trabalho com o Atlas, que precisa de um
segundo banco vazio para comparar — e o PGlite gerenciado serve exatamente um.
Executá-los ali para com uma mensagem dizendo isso. Aponte `DATABASE_URL` para um
PostgreSQL de verdade para o fluxo de migrações; o `rebase dev` já cria as tabelas
faltantes de forma aditiva no gerenciado.

`branch` é recusado ali por um motivo aparentado.
`CREATE DATABASE ... TEMPLATE` contra o PGlite escreve uma entrada de catálogo e
não copia nada, então o branch resolveria para o banco do qual foi clonado — cada
escrita que você pretendia isolar cairia no seu banco de desenvolvimento. O
`rebase dev --docker` lhe dá um servidor de verdade contra o qual os branches
funcionam.
:::

### `rebase apps init` / `rebase apps config`

```bash
rebase apps list             # the apps this project declares
rebase apps init <name>      # register a new app in rebase.json
rebase apps config <app>     # what one app resolves to
```

### `rebase status`

<span class="since-badge" data-since="0.18">Since 0.18</span>

Tudo o que este projeto declara, e se o ambiente realmente o vincula:

```bash
rebase status               # every resource, and the variables it reads
rebase status --json        # machine-readable
```

```
  backend  ·  managed  Rebase's runtime boots your bundle
  declared in  config/resources.ts
  configured by  .env

  buckets
  ✓ media  s3 · account:minio
      ✓ S3_BUCKET__MEDIA
      ✓ S3_ACCESS_KEY_ID__MINIO (shared, for S3_ACCESS_KEY_ID__MEDIA)
  ○ exports  s3
      · S3_BUCKET__EXPORTS not set
      └ declared, not configured — uploads here answer 501 STORAGE_SOURCE_NOT_CONFIGURED
```

Três arquivos decidem o que um backend pode alcançar, e isto imprime os três
juntos: o `rebase.json` diz onde está o seu código e quem executa o servidor, o
`config/resources.ts` diz do que o projeto precisa, e o ambiente diz como alcançar
cada coisa. Todo o resto — `rebase.resources.json`, o manifesto do bundle — é
gerado a partir do do meio para leitores que não podem executar o seu código, e
você nunca o escreve.

Um `○` é o estado que vale conhecer antes de uma implantação, e não depois:
declarado, não configurado. Um `✗` significa que o ambiente define algo de forma
*errada*, o que recusa o boot em vez de degradar.

### `rebase resources`

O que este projeto declara precisar — os bancos, buckets, tópicos e filas que o
código de configuração pede, e os crons e funções que os seus arquivos definem:

```bash
rebase resources            # list them
rebase resources --write    # regenerate rebase.resources.json
rebase resources --check    # fail if the committed graph is stale
rebase resources --json     # machine-readable
```

`rebase resources --check` é novo <span class="since-badge" data-since="0.18">Since 0.18</span> — a flag que um job de CI usa para falhar em um `rebase.resources.json` que não
corresponde mais ao código de configuração.

Um recurso é declarado no código de configuração — `database("analytics")`,
`bucket("media")`, `topic("signups")`, `queue("thumbnails")` — ou é um arquivo sob
`backend/crons` ou `backend/functions`, e nunca é escrito à mão em
`rebase.resources.json`, que é gerado a partir dessas declarações para que um host
possa ler do que um projeto precisa sem compilá-lo. Cada entrada registra quem o
usa (`collection:events`, `property:posts.cover`, `function:report`).

Um backend também tem um banco de dados padrão e uma fonte de armazenamento padrão
que ninguém declara. Ambos são listados aqui, marcados como `implicit`, e nenhum
dos dois é escrito em `rebase.resources.json` — o host os fornece, então registrá-
los seria pedir o provisionamento de algo que ninguém pediu.

Para ver o que a plataforma guarda para um projeto em face do que o seu código
declara, e para remover um banco provisionado que o código não nomeia mais, veja
`rebase cloud resources` abaixo.

### `rebase cloud`

Tudo o que diz respeito ao Rebase Cloud, que está em beta privado. Veja o
[guia do Rebase Cloud](/docs/deployment/cloud/) para saber o que é e o que o beta
não inclui.

Todo grupo responde a `--help`, e `--help` nunca executa o comando. A maioria dos
comandos age sobre o projeto vinculado em `.rebase/cloud.json`; `--project <id>`
opera sobre um sem vinculá-lo.

Três opções valem em todo lugar: `--json` para saída legível por máquina (também o
padrão quando encadeado, ou com `REBASE_JSON=1`), `--url <origin>` para mirar um
control plane específico (ou `REBASE_CLOUD_URL`), e `--project, -p <id>`.

#### Autenticação

```bash
rebase cloud login      # sign in to the control plane
rebase cloud logout     # sign out
rebase cloud whoami     # show the current session
```

#### Vínculo do projeto

```bash
rebase cloud link         # link this directory to a cloud project
rebase cloud link [url]   # or straight at a backend: no control plane, no login, and the rest of the family refuses until you unlink
rebase cloud unlink       # remove the link
rebase cloud use [org]    # select the active organization
rebase cloud open         # open the dashboard in a browser
```

#### Projetos

```bash
rebase cloud projects list
rebase cloud projects create [--link]
rebase cloud projects info [id]
rebase cloud projects delete [id]
```

#### Implantar e observar

```bash
rebase cloud deploy [app] [--source .]   # deploy an app and stream build logs
rebase cloud logs [--runtime] [-f]       # build logs, or the running process's
rebase cloud deployments list [--limit N|--all]
rebase cloud rollback [id] [-y]          # back to a successful deploy
rebase cloud cancel [-y]                 # cancel the in-flight build
rebase cloud start | stop | restart [-y] # stop and restart need -y
rebase cloud status                      # one-glance project status
rebase cloud metrics                     # live CPU / memory / disk
rebase cloud debug [health|logs|…]       # diagnose a deployment, read-only
```

`deploy` sem nome de app implanta o backend.

#### Configuração

```bash
rebase cloud env list | set | unset | reveal | pull
rebase cloud domains list | add | verify | remove
rebase cloud extensions list | enable | disable
rebase cloud settings show | set        # name, branch, repo, subdomain
```

#### Organizações

```bash
rebase cloud orgs list | create | members
```

#### Bancos de dados

```bash
rebase cloud db list | create | info | test
rebase cloud db backup list | create | restore | status | download
rebase cloud db pitr status | restore | cutover | discard
```

#### Recursos

O que a plataforma guarda para o projeto, em face do que o seu código declara.

```bash
rebase cloud resources                       # each database and bucket: declared? provisioned?
rebase cloud resources prune database <key>  # remove one the code no longer declares
```

Uma implantação nunca remove um banco provisionado quando a declaração dele some —
isso seriam dados apagados por um push. Ela o mantém, o vincula e o cobra até que
alguém o remova pelo nome.

#### Compute

O que o projeto reserva, e quanto isso custa.

```bash
rebase cloud compute            # the current reservation and its monthly cost
rebase cloud compute set        # change it
```

`compute set` aceita `--cpu`, `--memory`, `--replicas`, `--spot`,
`--scale-to-zero`, `--db-mode`, `--db-instances`, `--db-cpu`, `--db-memory`,
`--storage`, `--autoscale-max`, `--autoscale-cpu-target` e `--no-autoscale`. Não
há faixas de plano: tudo é cobrado por recurso. Veja
[Rebase Cloud](/docs/deployment/cloud/).

#### Armazenamento, webhooks, clusters e cobrança

```bash
rebase cloud storage             # list storage buckets
rebase cloud storage create      # provision platform-managed storage
rebase cloud storage attach      # attach your own S3-compatible bucket
rebase cloud webhooks list | create | delete
rebase cloud clusters list | add | verify   # the clusters tenants run on; `add` registers one from a kubeconfig
rebase cloud billing             # the billing account and card on file
rebase cloud billing setup       # attach a card, one-time, opens a browser
rebase cloud billing checkout    # a Stripe session for one project
```

### `rebase generate-sdk`

Gere um SDK de cliente tipado a partir das suas definições de coleções:

```bash
rebase generate-sdk
```

Cria tipos TypeScript e um cliente com segurança de tipos para todas as suas coleções.

### `rebase doctor`

```bash
rebase doctor
```

O comando para rodar quando algo está errado e você ainda não sabe o quê. Ele
relata e nunca muda nada, então é seguro contra qualquer banco que você consiga
alcançar.

**Sem banco de dados.** Estes rodam primeiro, porque tudo o que impede um projeto
de funcionar acontece antes de qualquer tabela poder ser comparada:

| Verificação | Por quê |
| --- | --- |
| Versão do Node | Em face da faixa que a CLI declara. Antiga demais não é relatado como «Node não suportado» — é um erro de sintaxe dentro de uma dependência. |
| Gerenciadores de pacotes | Dois lockfiles em um só projeto. `npm install` em um workspace pnpm reescreve `node_modules` em um layout com o qual o pnpm discorda, e o sintoma é um `Cannot find module` horas depois. |
| Slugs duplicados | O registro fica com a última coleção registrada, então a outra não é relatada como ausente — ela é servida como vencedora, sob o próprio nome. |
| Sanidade do `.env` | Um `JWT_SECRET` com menos de 32 caracteres (com o qual a produção se recusa a subir), e `NODE_ENV=production` sem `CORS_ORIGINS` nem `FRONTEND_URL`. Os valores nunca são impressos. |
| Divergência de versões de `@rebasepro/*` | O mesmo pacote fixado em versões diferentes entre os `package.json` do projeto. Duas cópias quebram o `instanceof` entre elas, o que falha como um type guard rejeitando o próprio tipo. |
| Strings de conexão | Um `=` não codificado em um parâmetro de URL, que as próprias ferramentas do PostgreSQL se recusam a interpretar — então backups e `psql` quebram enquanto a aplicação continua funcionando. |
| Funções personalizadas | O que cada função precisa do seu host, e quais delas não rodariam em um runtime de edge. |

**Contra o banco de dados**, quando `DATABASE_URL` está definida:

| Verificação | Por quê |
| --- | --- |
| Coleções → schema gerado | Se o `schema.generated.ts` está desatualizado. |
| Coleções → banco de dados | Tabelas, colunas, enums, chaves estrangeiras e tabelas de junção faltando. |
| Extensões necessárias | Uma propriedade `{ type: "vector" }` precisa do pgvector, que o Rebase instala só onde um projeto o declarou. |
| Carimbo do schema | Se este banco foi provisionado a partir destas coleções. É um hash, então pode dizer que os dois discordam e nunca qual está à frente. |
| Coleções → tipos do SDK | Se o SDK tipado gerado está desatualizado. |
| Políticas RLS | Se as políticas do banco correspondem às `securityRules` que você declarou, e se alguma política nomeia um papel que este servidor não pode usar. |

Se o banco estiver inacessível, as fases dele são relatadas como puladas com o
motivo e o resto ainda roda — veja
[Solução de problemas](/docs/troubleshooting/).

Sai com código diferente de zero quando uma verificação encontra um erro, ou
quando uma fase não pôde rodar porque o banco que lhe foi dado recusa conexões.
Uma fase pulada porque você não definiu `DATABASE_URL` não é uma falha.

`rebase doctor --policies` roda apenas as verificações de RLS — sem diff de
schema, sem tipos do SDK — e falha de forma fechada, o que o torna a forma a usar
como gate de CI contra um banco implantado.

### `rebase auth`

Comandos de gerenciamento de autenticação:

```bash
rebase auth reset-password --email admin@example.com --password NewPassword123!
```

### `rebase api-keys`

Gerencie chaves de API de serviço com escopo — a credencial que um agente, um
script ou outro serviço usa, em oposição à sessão de um usuário final:

```bash
rebase api-keys list
rebase api-keys create --name "Analytics" --permissions '[{"collection":"events","operations":["read"]}]'
rebase api-keys create --name "Full Access" --full-access --expires 90d
rebase api-keys revoke abc123-def456
```

`--permissions` recebe um array JSON de objetos `{ collection, operations }`, ou
use `--full-access` para leitura/escrita/exclusão em todas as coleções e funções.
`--expires` aceita `7d`, `30d`, `90d`, `1y` ou uma data ISO, e `--rate-limit`
define as requisições por janela de 15 minutos. Uma chave é exibida uma única vez,
na criação.

As chaves passam por dois portões: valem tanto as permissões da própria chave
quanto a row-level security da identidade sob a qual ela age, de modo que uma
chave nunca pode ler mais do que aquela identidade pode.

### `rebase skills install`

Instale as skills de referência do Rebase para o seu assistente de programação com
IA. Suporta Cursor, Claude Code, Windsurf, Gemini CLI e Antigravity:

```bash
rebase skills install
rebase skills install --agent claude,cursor
rebase skills install --agent all
```

Veja [Agent Skills](/docs/ai/skills) para a lista completa e para onde os arquivos são escritos.

### `rebase telemetry`

Compartilhamento anônimo de uso. **É opt-in, e fica desligado a menos que você o ligue:**

```bash
rebase telemetry status
rebase telemetry show
rebase telemetry enable
rebase telemetry disable
```

`status` imprime a configuração atual, `show` imprime exatamente o que seria
enviado, e os outros dois a alteram. O `rebase init` pergunta uma vez; se você
nunca rodou o `init`, nada jamais foi coletado.

## Fluxo de trabalho de migração

O fluxo de trabalho típico para mudanças de schema:

```bash
# 1. Edit your collection in config/collections/
# 2. Generate the Drizzle schema
rebase schema generate

# 3. Generate SQL migration
rebase db generate

# 4. Review the generated SQL in drizzle/

# 5. Apply the migration
rebase db migrate
```

## Próximos Passos

- **[Schema como código](/docs/architecture/schema-as-code)** — Como funciona a geração de schema
- **[Início rápido](/docs/getting-started/quickstart)** — Comece por aqui
