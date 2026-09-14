---
sourceHash: 6a990240f0d07538
title: Referência da CLI
sidebar_label: CLI
description: Comandos da CLI do Rebase para inicialização de projetos, geração de schemas, migrações de banco de dados e geração de SDK.
---

## Visão Geral

A CLI do Rebase (`rebase`) gerencia seu projeto desde o scaffolding até o deploy.

## Instalação

```bash
pnpm add -g @rebasepro/cli
```

Ou utilize via `pnpm dlx`:

```bash
pnpm dlx @rebasepro/cli <command>
```

## Saída legível por máquina

`--json` é a flag de controle, e fora da família `cloud` é a única: `rebase status`, `rebase resources` e `rebase apps list` colocam um único valor JSON no stdout — o resultado, ou um envelope `{"error": {"message", "code", "hint", "issues"}}` com uma saída diferente de zero — em **todas** as finalizações do comando, permitindo que quem faz a chamada faça o parse do stdout incondicionalmente. Sem ela, eles exibem texto para leitura humana e as falhas vão para o stderr. `rebase cloud` usa o mesmo envelope e é a única exceção à flag: ele também ativa o JSON automaticamente quando o stdout não for um TTY, ou quando `REBASE_JSON=1` estiver definido. Assim, `rebase cloud status | cat` resulta em JSON, enquanto `rebase status | cat` não — em um script, passe `--json` explicitamente em vez de confiar em qualquer uma das regras.

## Comandos

### `rebase init`

Inicializa um novo projeto Rebase:

```bash
rebase init [directory]
```

Configura a estrutura do projeto com frontend, backend e pacotes compartilhados.

| Flag | O que faz |
|---|---|
| `-t, --template <preset>` | `blog`, `ecommerce` ou `blank`. Padrão: `blog` |
| `--headless` | Apenas backend — sem painel de administração e sem arquivos de coleções. `--template` não tem efeito, pois não há coleções para inicializar |
| `-y, --yes` | Nunca solicita confirmação. **Obrigatório onde não há terminal para interagir**, como em ambientes de CI. Ele pula o git init e a instalação de dependências — os padrões interativos dizem "sim" para ambos, portanto passe `--git` / `--install` se desejar executá-los |
| `-i, --install` | Instala as dependências após o scaffolding |
| `-g, --git` | Inicializa um repositório e faz o primeiro commit |
| `--database-url <url>` | Usa um banco de dados existente em vez do gerenciado |
| `--introspect` | Gera coleções a partir desse banco de dados. Implica `--template blank` e requer `--install` |
| `--project <slug>` | Vincula o scaffold a um projeto do Rebase Cloud |
| `--setup-key <key>` | A chave de uso único que autentica esse vínculo |

### `rebase dev`

Inicia o servidor de desenvolvimento:

```bash
rebase dev
```

Inicia tanto o frontend quanto o backend com hot reloading.

Ambas as portas são derivadas do caminho do projeto, permitindo que vários projetos Rebase rodem lado a lado. Use as URLs exibidas por `rebase dev`. Fixe uma porta específica com `rebase dev --port 3001`.

### `rebase build`

Compila o projeto em um pacote pronto para deploy em `dist-bundle/`:

```bash
rebase build
```

O bundle é o artefato que você publica — a imagem de runtime o carrega, portanto não há necessidade de compilar uma imagem da aplicação por conta própria. Flags úteis:

| Flag | Efeito |
|------|--------|
| `--out <dir>` | Grava o bundle em um local diferente de `dist-bundle/` |
| `--vendor` | Sempre instala e empacota as dependências do bundle |
| `--no-vendor` | Nunca inclui dependências empacotadas; o pod as instala na primeira inicialização |
| `--skip-type-check` | Pula a verificação de tipos (mais rápido, menos seguro) |
| `--no-static` | Pula a compilação do frontend |

As dependências são incluídas no pacote por padrão para que a reinicialização de um pod não sofra com uma instalação de 35 a 55 segundos. Uma árvore que ultrapasse 200 MB em disco é descartada, pois o limite de upload é de 100 MB compactado — consulte o changelog para entender os motivos.

### `rebase start`

Executa o bundle compilado como um servidor de produção:

```bash
rebase start
```

Lê a variável `PORT` e o restante do `.env`, diferentemente do `rebase dev`. Aponte para um bundle em outro local com `rebase start --bundle ./dist-bundle`.

### `rebase apps list`

Exibe os aplicativos que este repositório declara:

```bash
rebase apps list
```

Um repositório pode declarar mais de um aplicativo publicável — por exemplo, um backend e um site institucional. É assim que você vê sobre o que o `rebase build` e o deploy irão atuar.

### `rebase eject`

Assume o controle do processo do servidor e de sua imagem:

```bash
rebase eject
```

Escreve o ponto de entrada do backend e um `Dockerfile` no projeto e transfere o backend para ele, de modo que o repositório construa sua própria imagem em vez de rodar o runtime publicado. A partir desse momento, **as atualizações do runtime da plataforma não o alcançarão mais**, e o CORS, a configuração de autenticação, o armazenamento e o encerramento do processo passam a ser configurados por você.

Visualize previamente com `rebase eject --dry-run`, que lista o que mudaria sem alterar nada. `--force` substitui um `backend/src/index.ts` ou `env.ts` existente, mantendo o arquivo atual como `<name>.bak`.

### `rebase schema generate`

Gera o schema do Drizzle ORM a partir de suas coleções TypeScript:

```bash
rebase schema generate
```

Isso lê suas coleções em `config/collections/` e gera `backend/src/schema.generated.ts` com definições de tabelas, enums e relações do Drizzle.

### `rebase db push`

Aplica as alterações de schema diretamente ao banco de dados (apenas para desenvolvimento):

```bash
rebase db push
```

:::caution
`db push` modifica o banco de dados diretamente, sem arquivos de migração. Use `db generate` + `db migrate` para produção.
:::

### `rebase db generate`

Gera arquivos de migração SQL a partir das alterações de schema:

```bash
rebase db generate
```

Cria arquivos de migração com timestamp em `drizzle/` que podem ser revisados e comitados.

### `rebase db migrate`

Executa as migrações pendentes do banco de dados:

```bash
rebase db migrate
```

Aplica todas as migrações pendentes ao banco de dados.

### `rebase db backup` / `backups` / `restore`

```bash
rebase db backup --out ./backups        # or s3://bucket/prefix, gs://bucket/prefix
rebase db backups list                  # list what is stored
rebase db restore ./backups/<file>.dump --yes
```

`backup` executa o `pg_dump`; `restore` executa o `pg_restore` e é destrutivo, portanto requer `--yes`. `--out` aceita um caminho local ou uma URL de object storage, tendo como padrão `$BACKUP_DESTINATION` ou `./backups`.

### `rebase db pull`

Copia outro banco de dados para o banco de desenvolvimento local:

```bash
rebase db pull --from postgres://…  [--anonymize]
```

`--anonymize` substitui campos pessoais durante a importação, para que uma cópia de produção possa ser trabalhada localmente sem levar dados reais de clientes para um computador pessoal.

O `pg_dump` remove privilégios, portanto a cópia chegaria com as políticas de RLS da origem, mas sem nenhuma das concessões (grants) por trás delas — fazendo com que cada leitura como `rebase_user` falhasse com `permission denied`. O pull provisiona novamente a role da aplicação depois, usando a mesma rotina utilizada na inicialização e no `rebase db push`, garantindo que as tabelas internas do Rebase permaneçam revogadas como devem ser.

O destino é sempre o banco de dados de desenvolvimento local deste projeto e não pode ser escolhido: `--database-url` é recusado em vez de aceito, para que não haja como instruir um "pull para a produção". `--from` é a única direção possível.

### `rebase db url`

Exibe a string de conexão que este projeto está usando, e nada mais, facilitando o uso com pipes:

```bash
rebase db url
psql "$(rebase db url)"
```

O banco de dados de desenvolvimento gerenciado é o caso que necessita disso: o `.env` deixa o `DATABASE_URL` comentado propositalmente, e a porta é derivada do caminho do projeto, logo nada no disco a especifica diretamente. Quando você define um `DATABASE_URL` próprio, é isso que ele imprime — a ordem de resolução é a mesma seguida por todos os outros comandos. Ele inicializa o banco de dados gerenciado caso ainda não esteja em execução.

### `rebase db stop` / `rebase db reset`

Apenas para o banco de dados de desenvolvimento gerenciado:

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

O PostgreSQL não copia nem descarta um banco de dados ao qual qualquer outro processo esteja conectado, e o "qualquer outro processo" comum é o seu próprio `rebase dev`. `create` e `delete` identificam o que está mantendo o banco de dados aberto; `--force` desconecta essas sessões antes.

Cada branch é uma cópia completa em disco, portanto elas precisam ser limpas periodicamente. O `prune` remove três coisas: uma entrada cujo banco de dados foi excluído fora do Rebase, um banco de dados de branch cuja entrada nunca foi gravada e — apenas com `--older-than` — branches mais antigas do que o período especificado. Ele pede confirmação antes de remover qualquer coisa, a menos que você passe `--yes`.

`switch` registra a branch em `.rebase/branch.json` e nunca edita o `.env`. Ele tem precedência sobre o `DATABASE_URL` no `.env` e perde para `--database-url` ou um `DATABASE_URL` definido no shell, de modo que uma flag na linha de comando sempre tem prioridade sobre uma troca feita anteriormente. Excluir a branch em que você está retorna você para o banco de dados principal, em vez de deixar o checkout apontando para um banco que não existe mais.

:::note[Não aplicável ao banco de desenvolvimento gerenciado]
`push`, `generate` e `migrate` planejam seu trabalho com o Atlas, que precisa de um segundo banco de dados vazio para comparação — e o PGlite gerenciado disponibiliza exatamente um. Executá-los lá é interrompido com uma mensagem informando isso. Aponte `DATABASE_URL` para um PostgreSQL real para usar o fluxo de migração; o `rebase dev` já cria tabelas ausentes de forma cumulativa no banco gerenciado.

O comando `branch` é recusado lá por um motivo relacionado. `CREATE DATABASE ... TEMPLATE` no PGlite grava uma entrada de catálogo e não copia nada, de modo que a branch resolveria para o banco de dados do qual foi clonada — toda gravação que você pretendia isolar cairia no seu banco de dados de desenvolvimento. `rebase dev --docker` fornece um servidor real com o qual as branches funcionam.
:::

### `rebase apps init` / `rebase apps config`

```bash
rebase apps list             # the apps this project declares
rebase apps init <name>      # register a new app in rebase.json
rebase apps config <app>     # what one app resolves to
```

### `rebase status`

Tudo o que este projeto declara, e se o ambiente de fato o vincula:

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

Três arquivos decidem o que um backend pode acessar, e este comando imprime todos os três juntos:
`rebase.json` define onde está seu código e quem executa o servidor,
`config/resources.ts` define o que o projeto precisa, e o ambiente define como
alcançar cada item. Todo o resto — `rebase.resources.json`, o manifesto do
bundle — é gerado a partir do segundo arquivo para ferramentas que não podem executar o seu código, e você nunca precisa escrevê-los manualmente.

Um `○` representa o estado que vale a pena conhecer antes de um deploy, em vez de depois:
declarado, mas não configurado. Um `✗` significa que o ambiente define algo *incorretamente*,
o que impede a inicialização em vez de apenas degradar o serviço.

### `rebase resources`

O que este projeto declara que precisa — os bancos de dados, buckets, tópicos e
filas que o código de configuração solicita, além dos crons e funções que seus arquivos definem:

```bash
rebase resources            # list them
rebase resources --write    # regenerate rebase.resources.json
rebase resources --check    # fail if the committed graph is stale
rebase resources --json     # machine-readable
```

`rebase resources --check` é novo — a flag que um job de CI usa para falhar
caso o `rebase.resources.json` comitado não corresponda mais ao código de configuração.

Um recurso é declarado no código de configuração — `database("analytics")`,
`bucket("media")`, `topic("signups")`, `queue("thumbnails")` — ou é um arquivo
em `backend/crons` ou `backend/functions`, e nunca é escrito manualmente em
`rebase.resources.json`, que é gerado a partir dessas declarações para que um host possa
ler o que um projeto precisa sem precisar compilá-lo. Cada entrada registra quem a utiliza
(`collection:events`, `property:posts.cover`, `function:report`).

Um backend também possui um banco de dados padrão e uma fonte de armazenamento padrão que ninguém
declara. Ambos são listados aqui, marcados como `implicit`, e nenhum deles é gravado no
`rebase.resources.json` — o host os fornece, portanto registrá-los significaria solicitar
o provisionamento de algo que ninguém pediu.

Para ver o que a plataforma mantém para um projeto em comparação com o que seu código declara,
e para remover um banco de dados provisionado que o código não referencia mais, consulte
`rebase cloud resources` abaixo.

### `rebase cloud`

Tudo relacionado ao Rebase Cloud, que está em beta privado. Consulte o
[guia do Rebase Cloud](/docs/deployment/cloud/) para saber o que ele é e o que o beta
não inclui.

Todos os grupos respondem a `--help`, e `--help` nunca executa o comando. A maioria dos comandos
atua no projeto vinculado em `.rebase/cloud.json`; `--project <id>` opera em
um projeto sem vinculá-lo.

Três opções se aplicam a todos os lugares: `--json` para saída legível por máquina (também o
padrão quando usado com pipes ou com `REBASE_JSON=1`), `--url <origin>` para direcionar a um
plano de controle específico (ou `REBASE_CLOUD_URL`), e `--project, -p <id>`.

#### Auth

```bash
rebase cloud login      # sign in to the control plane
rebase cloud logout     # sign out
rebase cloud whoami     # show the current session
```

#### Vínculo de projeto (Project link)

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

#### Deploy e observabilidade

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

`deploy` sem o nome do aplicativo faz o deploy do backend.

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
rebase cloud db list | create | info | connect | test
rebase cloud db backup list | create | restore | status | download
rebase cloud db pitr status | restore | cutover | discard
```

`db connect` abre uma porta local que *é* o banco de dados gerenciado (sem endpoint
público) até Ctrl-C; `--reveal` adiciona a senha. Apenas para proprietário (owner) ou admin.

#### Recursos

O que a plataforma mantém para o projeto, em comparação com o que o código declara.

```bash
rebase cloud resources                       # each database and bucket: declared? provisioned?
rebase cloud resources prune database <key>  # remove one the code no longer declares
```

Um deploy nunca remove um banco de dados provisionado quando sua declaração é removida — isso
resultaria em dados excluídos por um push. A plataforma o mantém, o vincula e o cobra até que alguém
o remova explicitamente pelo nome.

#### Computação (Compute)

O que o projeto reserva e quanto isso custa.

```bash
rebase cloud compute            # the current reservation and its monthly cost
rebase cloud compute set        # change it
```

`compute set` aceita `--cpu`, `--memory`, `--replicas`, `--spot`,
`--scale-to-zero`, `--db-instances`, `--db-cpu`, `--db-memory`,
`--storage`, `--autoscale-max`, `--autoscale-cpu-target` e `--no-autoscale`.
Não há níveis de planos (tiers): tudo é precificado por recurso. Consulte
[Rebase Cloud](/docs/deployment/cloud/).

#### Armazenamento, webhooks, clusters e faturamento

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

Gera um SDK de cliente tipado a partir das definições de suas coleções:

```bash
rebase generate-sdk
```

Cria tipos TypeScript e um cliente com tipagem estática para todas as suas coleções.

### `rebase doctor`

```bash
rebase doctor
```

O comando para executar quando algo estiver errado e você ainda não souber o quê. Ele
apenas relata e nunca altera nada, sendo seguro contra qualquer banco de dados que você
possa acessar.

**Sem banco de dados.** Estas verificações rodam primeiro, pois tudo o que impede um projeto
de funcionar por completo acontece antes que uma tabela possa ser comparada:

| Verificação | Por quê |
| --- | --- |
| Versão do Node | Comparada com o intervalo declarado pela CLI. Uma versão muito antiga não é relatada como "Node não suportado" — manifesta-se como um erro de sintaxe dentro de uma dependência. |
| Gerenciadores de pacotes | Dois arquivos de lockfile em um mesmo projeto. Executar `npm install` em um workspace pnpm reescreve o `node_modules` em um layout incompatível com o pnpm, e o sintoma é `Cannot find module` horas depois. |
| Slugs duplicados | O registro mantém a última coleção registrada, portanto a outra não é dada como ausente — ela é servida como a vencedora, sob seu próprio nome. |
| Sanidade do `.env` | Um `JWT_SECRET` com menos de 32 caracteres (o que impede a inicialização em produção) e `NODE_ENV=production` sem `CORS_ORIGINS` nem `FRONTEND_URL`. Os valores nunca são exibidos. |
| Divergência de versão de `@rebasepro/*` | O mesmo pacote fixado em versões diferentes nos arquivos `package.json` do projeto. Duas cópias quebram o `instanceof` entre elas, o que falha como um type guard rejeitando seu próprio tipo. |
| Strings de conexão | Um `=` não codificado em um parâmetro de URL, o qual as próprias ferramentas do PostgreSQL recusam fazer o parse — assim, backups e o `psql` quebram enquanto a aplicação continua funcionando. |
| Funções customizadas | O que cada função precisa de seu host e quais delas não executariam em um runtime de borda (edge runtime). |

**Contra o banco de dados**, quando `DATABASE_URL` estiver definido:

| Verificação | Por quê |
| --- | --- |
| Coleções → schema gerado | Se `schema.generated.ts` está desatualizado. |
| Coleções → banco de dados | Tabelas, colunas, enums, chaves estrangeiras e junções ausentes. |
| Extensões necessárias | Uma propriedade `{ type: "vector" }` precisa do pgvector, que o Rebase instala apenas onde um projeto o declarou. |
| Carimbo do schema (Schema stamp) | Se este banco de dados foi provisionado a partir dessas coleções. Trata-se de um hash, para poder dizer se os dois discordam, mas nunca qual está à frente. |
| Coleções → tipos do SDK | Se o SDK tipado gerado está desatualizado. |
| Políticas de RLS | Se as políticas do banco de dados correspondem às `securityRules` declaradas e se alguma política faz referência a uma role que este servidor não pode usar. |

Se o banco de dados estiver inacessível, suas etapas são relatadas como ignoradas juntamente com
o motivo, e o restante continua executando normalmente — consulte [Solução de Problemas](/docs/troubleshooting/).

Finaliza com código de saída diferente de zero quando uma verificação encontra um erro ou quando uma etapa não pôde ser executada
porque o banco de dados fornecido recusa conexões. Uma etapa ignorada porque
você não definiu `DATABASE_URL` não é considerada uma falha.

`rebase doctor --policies` executa apenas as verificações de RLS — sem diff de schema, sem
tipos de SDK — e adota o comportamento "fail-closed" (falha caso haja divergências), tornando-se o formato ideal para ser utilizado como validação de CI contra um banco de dados em produção.

### `rebase auth`

Comandos para gerenciamento de autenticação:

```bash
rebase auth reset-password --email admin@example.com --password NewPassword123!
```

### `rebase api-keys`

Gerencia chaves de API de serviço com escopo — a credencial utilizada por um agente, script ou outro
serviço, em contraste com a sessão de um usuário final:

```bash
rebase api-keys list
rebase api-keys create --name "Analytics" --permissions '[{"collection":"events","operations":["read"]}]'
rebase api-keys create --name "Full Access" --full-access --expires 90d
rebase api-keys revoke abc123-def456
```

`--permissions` aceita um array JSON de objetos `{ collection, operations }`, ou use
`--full-access` para permissão de leitura/gravação/exclusão em todas as coleções e funções. `--expires`
aceita `7d`, `30d`, `90d`, `1y` ou uma data ISO, e `--rate-limit` define o limite de requisições
por janela de 15 minutos. Uma chave é exibida apenas uma vez, no momento da criação.

As chaves contam com controle duplo: tanto as permissões da própria chave quanto a segurança em nível de linha (RLS) da
identidade sob a qual ela atua são aplicadas, de modo que uma chave nunca pode ler mais do que essa identidade tem permissão.

### `rebase skills install`

Instala as skills de referência do Rebase para o seu assistente de codificação com IA. Suporta
Cursor, Claude Code, Windsurf, Gemini CLI e Antigravity:

```bash
rebase skills install
rebase skills install --agent claude,cursor
rebase skills install --agent all
```

Consulte [Agent Skills](/docs/ai/skills) para a lista completa e informações sobre onde os arquivos são gravados.

### `rebase telemetry`

Compartilhamento anônimo de dados de uso. **O `rebase init` pergunta uma vez por projeto, e o prompt
tem como padrão "sim" — nada é enviado a menos que você responda:**

```bash
rebase telemetry status
rebase telemetry show
rebase telemetry enable
rebase telemetry disable
```

`status` exibe a configuração atual, `show` exibe exatamente o que seria enviado —
esteja o compartilhamento ativado ou não, para que você possa inspecionar o payload antes de decidir — e
os outros dois alteram a configuração. Se você nunca executou `init`, nada foi coletado até então.

## Fluxo de Trabalho de Migração

O fluxo de trabalho típico para alterações de schema:

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

- **[Schema as Code](/docs/architecture/schema-as-code)** — Como funciona a geração de schemas
- **[Início Rápido](/docs/getting-started/quickstart)** — Comece a usar
