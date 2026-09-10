---
sourceHash: 97dd0e836d51f599
title: Referência da CLI
sidebar_label: CLI
description: Comandos da CLI do Rebase para inicialização de projetos, geração de schemas, migrações de banco de dados e geração de SDK.
---

## Visão geral

A CLI do Rebase (`rebase`) gerencia seu projeto desde o scaffolding até o deploy.

## Instalação

```bash
pnpm add -g @rebasepro/cli
```

Ou use via `pnpm dlx`:

```bash
pnpm dlx @rebasepro/cli <command>
```

## Saída legível por máquina

`--json` é a flag de controle e, fora da família `cloud`, é a única: `rebase status`, `rebase resources` e `rebase apps list` colocam um único valor JSON no stdout — o resultado, ou um envelope `{"error": {"message", "code", "hint", "issues"}}` com saída diferente de zero — em **todas** as saídas do comando, para que o chamador possa analisar o stdout incondicionalmente. Sem ela, eles exibem texto legível por humanos e falhas vão para o stderr. `rebase cloud` usa o mesmo envelope e é a única exceção à flag: ele também ativa o JSON automaticamente quando o stdout não é um TTY, ou quando `REBASE_JSON=1` está definido. Portanto, `rebase cloud status | cat` produz JSON enquanto `rebase status | cat` não — em scripts, passe `--json` explicitamente em vez de depender de qualquer uma das regras.

## Comandos

### `rebase init`

Inicializa um novo projeto Rebase:

```bash
rebase init [directory]
```

Configura a estrutura do projeto com frontend, backend e pacotes compartilhados.

| Flag | O que faz |
|---|---|
| `-t, --template <preset>` | `blog`, `ecommerce` ou `blank`. Padrão `blog` |
| `--headless` | Apenas backend — sem painel de administração e sem arquivos de coleções. `--template` não tem efeito, pois não há coleções para popular |
| `-y, --yes` | Nunca solicita confirmação. **Obrigatório onde quer que não haja terminal para responder**, como em ambientes de CI. Pula o git init e a instalação de dependências — os padrões interativos dizem sim para ambos, portanto passe `--git` / `--install` se desejar executá-los |
| `-i, --install` | Instala dependências após o scaffolding |
| `-g, --git` | Inicializa um repositório e cria o primeiro commit |
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

Ambas as portas são derivadas do caminho do projeto, permitindo que vários projetos Rebase sejam executados
lado a lado. Use as URLs exibidas por `rebase dev`. Fixe uma porta com `rebase dev --port 3001`.

### `rebase build`

Compila o projeto em um bundle pronto para deploy em `dist-bundle/`:

```bash
rebase build
```

O bundle é o artefato que você implanta — a imagem de runtime o carrega, portanto não há
imagem de aplicação para você construir por conta própria. Flags úteis:

| Flag | Efeito |
|------|--------|
| `--out <dir>` | Grava o bundle em outro local além de `dist-bundle/` |
| `--vendor` | Sempre instala e inclui as dependências do bundle |
| `--no-vendor` | Nunca faz o vendoring; o pod instala na primeira inicialização |
| `--skip-type-check` | Pula a verificação de tipos (mais rápido, menos seguro) |
| `--no-static` | Pula a compilação do frontend |

As dependências são incluídas (vendored) por padrão para que a reinicialização de um pod não pague o custo de
35–55 segundos de instalação. Uma árvore de diretórios que ultrapasse 200 MB em disco é descartada, pois o
limite de upload é de 100 MB compactado — consulte o changelog para ver a justificativa.

### `rebase start`

Executa o bundle compilado como um servidor de produção:

```bash
rebase start
```

Lê `PORT` e o restante do `.env`, diferentemente de `rebase dev`. Aponte para um bundle
em outro local com `rebase start --bundle ./dist-bundle`.

### `rebase apps list`

Exibe as aplicações declaradas por este repositório:

```bash
rebase apps list
```

Um repositório pode declarar mais de uma aplicação implantável — um backend e um site
de marketing, por exemplo. É assim que você visualiza em quais aplicações `rebase build` e o deploy atuarão.

### `rebase eject`

Assume o controle do processo do servidor e de sua imagem:

```bash
rebase eject
```

Grava o ponto de entrada do backend e um `Dockerfile` no projeto e altera a configuração do seu
backend, fazendo com que o repositório construa sua própria imagem em vez de executar o
runtime publicado. A partir desse momento, **as atualizações do runtime da plataforma não o alcançarão mais**,
e o CORS, a integração de autenticação, o armazenamento e o encerramento passam a ser de sua responsabilidade de configuração.

Visualize as alterações previamente com `rebase eject --dry-run`, que lista o que mudaria sem
alterar nada. `--force` substitui um arquivo `backend/src/index.ts` ou
`env.ts` existente, mantendo o arquivo atual como `<name>.bak`.

### `rebase schema generate`

Gera o schema do Drizzle ORM a partir das suas coleções TypeScript:

```bash
rebase schema generate
```

Isso lê suas coleções em `config/collections/` e gera `backend/src/schema.generated.ts` com definições de tabelas, enums e relações do Drizzle.

### `rebase db push`

Aplica alterações de schema diretamente ao banco de dados (apenas para desenvolvimento):

```bash
rebase db push
```

:::caution
`db push` modifica o banco de dados diretamente sem arquivos de migração. Use `db generate` + `db migrate` para produção.
:::

### `rebase db generate`

Gera arquivos de migração SQL a partir das alterações de schema:

```bash
rebase db generate
```

Cria arquivos de migração com timestamp em `drizzle/` que podem ser revisados e comitados.

### `rebase db migrate`

Executa migrações pendentes do banco de dados:

```bash
rebase db migrate
```

Aplica todas as migrações não aplicadas ao banco de dados.

### `rebase db backup` / `backups` / `restore`

```bash
rebase db backup --out ./backups        # ou s3://bucket/prefix, gs://bucket/prefix
rebase db backups                       # lista o que está armazenado
rebase db restore ./backups/<file>.dump --yes
```

`backup` executa `pg_dump`; `restore` executa `pg_restore` e é destrutivo, portanto
exige `--yes`. `--out` aceita um caminho local ou uma URL de object storage, e o
padrão é `$BACKUP_DESTINATION` ou `./backups`.

### `rebase db pull`

Copia outro banco de dados para o banco de desenvolvimento local:

```bash
rebase db pull --from postgres://…  [--anonymize]
```

`--anonymize` substitui campos com dados pessoais durante a importação, permitindo que uma cópia de produção seja
utilizada localmente sem transferir dados reais de clientes para um notebook.

O `pg_dump` remove privilégios, portanto a cópia chegaria com as políticas de RLS da
origem e nenhuma das concessões (grants) por trás delas — fazendo com que qualquer leitura como `rebase_user` falhasse
com `permission denied`. O comando pull provisiona novamente a role da aplicação em seguida, usando
a mesma rotina que a inicialização e o `rebase db push` usam, para que as tabelas internas do Rebase continuem
revogadas como deveriam.

O destino é sempre o banco de desenvolvimento local deste projeto e não pode ser
escolhido: `--database-url` é recusado em vez de aceito, logo não há como
instruir um "pull para produção". `--from` é a única direção.

### `rebase db url`

Exibe a string de conexão que este projeto está usando, e nada mais, para que ela
possa ser usada em pipes:

```bash
rebase db url
psql "$(rebase db url)"
```

O banco de dados de desenvolvimento gerenciado é o caso que necessita disso: o `.env` deixa
`DATABASE_URL` comentada de propósito, e a porta é derivada do
caminho do projeto, portanto nada em disco a nomeia. Quando você define uma `DATABASE_URL`
própria, é isso que o comando imprime — a ordem de resolução é a mesma que
todos os outros comandos seguem. Ele inicia o banco gerenciado se ele ainda não estiver
em execução.

### `rebase db stop` / `rebase db reset`

Apenas para o banco de dados de desenvolvimento gerenciado:

```bash
rebase db stop     # para o banco; os dados são mantidos
rebase db reset    # apaga o banco e começa do zero
```

### `rebase db branch`

```bash
rebase db branch create <name>
rebase db branch list
rebase db branch info <name>
rebase db branch switch <name>     # trabalha nele; todos os comandos posteriores o seguem
rebase db branch switch            # informa em qual branch você está
rebase db branch switch --off      # volta para o banco de dados principal
rebase db branch delete <name>
rebase db branch prune [--older-than 14d] [--include-dev-diff]
```

O PostgreSQL não copia nem remove um banco de dados ao qual qualquer outro processo esteja conectado, e
o habitual "qualquer outro processo" é o seu próprio `rebase dev`. `create` e `delete` informam
o que está mantendo o banco aberto; `--force` desconecta essas sessões primeiro.

Cada branch é uma cópia completa em disco, portanto elas precisam ser limpas. `prune` remove
três coisas: uma entrada cujo banco foi excluído fora do Rebase, um banco de
branch cuja entrada nunca foi gravada e — somente com `--older-than` — branches
com idade superior à especificada. Ele solicita confirmação antes de remover qualquer item, a menos que você passe `--yes`.

`switch` registra a branch em `.rebase/branch.json` e nunca edita o `.env`. Ele
tem precedência sobre `DATABASE_URL` no `.env` e perde para `--database-url` ou uma
`DATABASE_URL` no shell, portanto uma flag na linha de comando sempre tem prioridade sobre uma
alternância feita anteriormente. Deletar a branch em que você está retorna você ao banco de dados
principal, em vez de deixar o ambiente apontando para um banco que não existe mais.

:::note[Não aplicável ao banco de desenvolvimento gerenciado]
`push`, `generate` e `migrate` planejam seu trabalho com o Atlas, que precisa de um segundo
banco vazio para comparação — e o PGlite gerenciado serve exatamente um.
Executá-los lá é interrompido com uma mensagem informando isso. Aponte `DATABASE_URL` para um
PostgreSQL real para o fluxo de trabalho de migrações; o `rebase dev` já cria tabelas ausentes
de forma incremental no banco gerenciado.

`branch` é recusado lá por um motivo relacionado. `CREATE DATABASE ... TEMPLATE`
no PGlite grava uma entrada de catálogo e não copia nada, de modo que a branch
apontaria para o banco do qual foi clonada — qualquer gravação que você pretendia isolar
iria parar no seu banco de desenvolvimento. O `rebase dev --docker` fornece um servidor
real contra o qual branches funcionam.
:::

### `rebase apps init` / `rebase apps config`

```bash
rebase apps list             # as aplicações que este projeto declara
rebase apps init <name>      # registra uma nova aplicação em rebase.json
rebase apps config <app>     # a configuração resolvida de uma aplicação
```

### `rebase status`

Tudo o que este projeto declara e se o ambiente realmente faz o vínculo:

```bash
rebase status               # cada recurso e as variáveis que ele lê
rebase status --json        # legível por máquina
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
`rebase.json` informa onde está o seu código e quem executa o servidor,
`config/resources.ts` diz o que o projeto precisa e o ambiente define como
alcançar cada item. Todo o restante — `rebase.resources.json`, o manifesto do
bundle — é gerado a partir do segundo arquivo para leitores que não conseguem executar o seu
código, e você nunca o edita manualmente.

Um `○` é o estado que vale a pena conhecer antes de um deploy em vez de depois:
declarado, mas não configurado. Um `✗` significa que o ambiente define algo *incorretamente*,
o que impede a inicialização em vez de apenas degradar o serviço.

### `rebase resources`

O que este projeto declara que precisa — os bancos de dados, buckets, tópicos e
filas solicitados pelo seu código de configuração, e os crons e funções definidos por seus arquivos:

```bash
rebase resources            # lista-os
rebase resources --write    # regenera rebase.resources.json
rebase resources --check    # falha se o grafo comitado estiver desatualizado
rebase resources --json     # legível por máquina
```

`rebase resources --check` é novo — a flag usada por jobs de CI para falhar
em caso de um `rebase.resources.json` que não corresponda mais ao código de configuração.

Um recurso é declarado no código de configuração — `database("analytics")`,
`bucket("media")`, `topic("signups")`, `queue("thumbnails")` — ou é um arquivo
em `backend/crons` ou `backend/functions`, e nunca deve ser escrito manualmente em
`rebase.resources.json`, que é gerado a partir dessas declarações para que um host possa
ler o que um projeto precisa sem precisar compilá-lo. Cada entrada registra quem a utiliza
(`collection:events`, `property:posts.cover`, `function:report`).

Um backend também possui um banco de dados padrão e uma fonte de armazenamento padrão que ninguém
declara. Ambos são listados aqui, marcados como `implicit`, e nenhum deles é gravado em
`rebase.resources.json` — o host os fornece, portanto registrá-los solicitaria
o provisionamento de algo que ninguém pediu.

Para ver o que a plataforma mantém para um projeto em relação ao que seu código declara,
e para remover um banco provisionado que o código não menciona mais, consulte
`rebase cloud resources` abaixo.

### `rebase cloud`

Tudo relacionado ao Rebase Cloud, que está em beta privado. Consulte o
[guia do Rebase Cloud](/docs/deployment/cloud/) para saber o que ele é e o que o beta
não inclui.

Todos os grupos respondem a `--help`, e `--help` nunca executa o comando. A maioria dos comandos
atua no projeto vinculado em `.rebase/cloud.json`; `--project <id>` opera em
um projeto sem vinculação.

Três opções se aplicam a todos os lugares: `--json` para saída legível por máquina (também o
padrão quando usado em pipes, ou com `REBASE_JSON=1`), `--url <origin>` para direcionar a um
painel de controle (control plane) específico (ou `REBASE_CLOUD_URL`), e `--project, -p <id>`.

#### Auth

```bash
rebase cloud login      # faz login no control plane
rebase cloud logout     # faz logout
rebase cloud whoami     # exibe a sessão atual
```

#### Project link

```bash
rebase cloud link         # vincula este diretório a um projeto na nuvem
rebase cloud link [url]   # ou diretamente a um backend: sem control plane, sem login, e o restante da família recusa operações até desvincular
rebase cloud unlink       # remove o vínculo
rebase cloud use [org]    # seleciona a organização ativa
rebase cloud open         # abre o dashboard no navegador
```

#### Projects

```bash
rebase cloud projects list
rebase cloud projects create [--link]
rebase cloud projects info [id]
rebase cloud projects delete [id]
```

#### Deploy and observe

```bash
rebase cloud deploy [app] [--source .]   # faz o deploy de um app e transmite os logs de build
rebase cloud logs [--runtime] [-f]       # logs de build ou do processo em execução
rebase cloud deployments list [--limit N|--all]
rebase cloud rollback [id] [-y]          # reverte para um deploy bem-sucedido
rebase cloud cancel [-y]                 # cancela o build em andamento
rebase cloud start | stop | restart [-y] # stop e restart exigem -y
rebase cloud status                      # status do projeto em visão geral
rebase cloud metrics                     # CPU / memória / disco em tempo real
rebase cloud debug [health|logs|…]       # diagnostica uma implantação, somente leitura
```

`deploy` sem o nome de uma aplicação faz o deploy do backend.

#### Config

```bash
rebase cloud env list | set | unset | reveal | pull
rebase cloud domains list | add | verify | remove
rebase cloud extensions list | enable | disable
rebase cloud settings show | set        # nome, branch, repositório, subdomínio
```

#### Organizations

```bash
rebase cloud orgs list | create | members
```

#### Databases

```bash
rebase cloud db list | create | info | test
rebase cloud db backup list | create | restore | status | download
rebase cloud db pitr status | restore | cutover | discard
```

#### Resources

O que a plataforma mantém para o projeto, em relação ao que seu código declara.

```bash
rebase cloud resources                       # cada banco de dados e bucket: declarado? provisionado?
rebase cloud resources prune database <key>  # remove um que o código não declara mais
```

Um deploy nunca remove um banco de dados provisionado quando sua declaração é removida — isso
seria apagar dados através de um push. Ele mantém, vincula e cobra por ele até que alguém
faça a limpeza (prune) informando seu nome.

#### Compute

O que o projeto reserva e quanto isso custa.

```bash
rebase cloud compute            # a reserva atual e seu custo mensal
rebase cloud compute set        # altera a reserva
```

`compute set` aceita `--cpu`, `--memory`, `--replicas`, `--spot`,
`--scale-to-zero`, `--db-mode`, `--db-instances`, `--db-cpu`, `--db-memory`,
`--storage`, `--autoscale-max`, `--autoscale-cpu-target` e `--no-autoscale`.
Não há níveis de planos: tudo é cobrado por recurso. Consulte
[Rebase Cloud](/docs/deployment/cloud/).

#### Storage, webhooks, clusters and billing

```bash
rebase cloud storage             # lista os buckets de armazenamento
rebase cloud storage create      # provisiona armazenamento gerenciado pela plataforma
rebase cloud storage attach      # anexa seu próprio bucket compatível com S3
rebase cloud webhooks list | create | delete
rebase cloud clusters list | add | verify   # os clusters onde os tenants rodam; `add` registra um a partir de um kubeconfig
rebase cloud billing             # a conta de faturamento e o cartão cadastrado
rebase cloud billing setup       # vincula um cartão, ação única, abre o navegador
rebase cloud billing checkout    # uma sessão do Stripe para um projeto
```

### `rebase generate-sdk`

Gera um SDK de cliente tipado a partir das definições de suas coleções:

```bash
rebase generate-sdk
```

Cria tipos TypeScript e um cliente type-safe para todas as suas coleções.

### `rebase doctor`

```bash
rebase doctor
```

O comando para executar quando algo estiver errado e você ainda não souber o quê. Ele
apenas reporta e nunca altera nada, portanto é seguro executá-lo contra qualquer banco de dados que
você consiga acessar.

**Sem um banco de dados.** Estas verificações são executadas primeiro, pois tudo o que impede um projeto
de funcionar por completo acontece antes que uma tabela possa ser comparada:

| Verificação | Motivo |
| --- | --- |
| Versão do Node | Comparada com a faixa declarada pela CLI. Uma versão muito antiga não é reportada como "Node incompatível" — ela se manifesta como um erro de sintaxe dentro de uma dependência. |
| Gerenciadores de pacotes | Dois arquivos de lock em um único projeto. Executar `npm install` em um workspace pnpm reestrutura o `node_modules` em um formato incompatível com o pnpm, e o sintoma é `Cannot find module` horas depois. |
| Slugs duplicados | O registro mantém a última coleção registrada, de modo que a outra não é dada como ausente — ela é servida como a vencedora, sob seu próprio nome. |
| Sanidade do `.env` | Um `JWT_SECRET` com menos de 32 caracteres (o que impede a inicialização em produção) e `NODE_ENV=production` sem `CORS_ORIGINS` nem `FRONTEND_URL`. Os valores nunca são exibidos. |
| Divergência de versão de `@rebasepro/*` | O mesmo pacote fixado em versões diferentes nos arquivos `package.json` do projeto. Duas cópias quebram o `instanceof` entre elas, falhando como um type guard que rejeita seu próprio tipo. |
| Strings de conexão | Um `=` não codificado em um parâmetro de URL, que as próprias ferramentas do PostgreSQL recusam analisar — quebrando backups e o `psql` enquanto a aplicação continua funcionando. |
| Funções customizadas | O que cada função exige de seu host e quais delas não rodariam em um runtime edge. |

**Contra o banco de dados**, quando `DATABASE_URL` estiver definida:

| Verificação | Motivo |
| --- | --- |
| Coleções → schema gerado | Se `schema.generated.ts` está desatualizado. |
| Coleções → banco de dados | Tabelas, colunas, enums, chaves estrangeiras e junções ausentes. |
| Extensões necessárias | Uma propriedade `{ type: "vector" }` precisa do pgvector, que o Rebase instala apenas onde o projeto declarou. |
| Schema stamp | Se este banco de dados foi provisionado a partir destas coleções. Trata-se de um hash, indicando se os dois divergem, mas sem especificar qual está à frente. |
| Coleções → tipos do SDK | Se o SDK tipado gerado está desatualizado. |
| Políticas de RLS | Se as políticas do banco correspondem às `securityRules` declaradas e se alguma política referencia uma role que este servidor não pode usar. |

Se o banco de dados estiver inacessível, suas etapas são reportadas como ignoradas juntamente com o
motivo, e o restante continua sendo executado — consulte [Solução de problemas](/docs/troubleshooting/).

Encerra com código diferente de zero quando uma verificação encontra um erro ou quando uma etapa não pôde ser executada
porque o banco de dados informado recusa conexões. Uma etapa ignorada por
não haver `DATABASE_URL` definida não é considerada uma falha.

`rebase doctor --policies` executa apenas as verificações de RLS — sem diff de schema, sem
tipos de SDK — e falha de forma segura (fail-closed), tornando-o ideal para uso como barreira (gate) de CI contra um
banco de dados em produção.

### `rebase auth`

Comandos de gerenciamento de autenticação:

```bash
rebase auth reset-password --email admin@example.com --password NewPassword123!
```

### `rebase api-keys`

Gerencia chaves de API com escopo para serviços — a credencial utilizada por um agente, script ou outro
serviço, em oposição à sessão de um usuário final:

```bash
rebase api-keys list
rebase api-keys create --name "Analytics" --permissions '[{"collection":"events","operations":["read"]}]'
rebase api-keys create --name "Full Access" --full-access --expires 90d
rebase api-keys revoke abc123-def456
```

`--permissions` aceita um array JSON de objetos `{ collection, operations }`, ou use
`--full-access` para permissões de leitura/gravação/exclusão em todas as coleções e funções. `--expires`
aceita `7d`, `30d`, `90d`, `1y` ou uma data ISO, e `--rate-limit` define requisições
por janela de 15 minutos. A chave é exibida apenas uma vez, no momento da criação.

As chaves contam com dupla verificação: aplicam-se tanto as permissões da própria chave quanto o row-level security
da identidade sob a qual ela opera, garantindo que uma chave nunca possa ler mais do que essa identidade tem permissão.

### `rebase skills install`

Instala as skills de referência do Rebase para o seu assistente de programação com IA. Suporta
Cursor, Claude Code, Windsurf, Gemini CLI e Antigravity:

```bash
rebase skills install
rebase skills install --agent claude,cursor
rebase skills install --agent all
```

Consulte [Agent Skills](/docs/ai/skills) para obter a lista completa e saber onde os arquivos são gravados.

### `rebase telemetry`

Compartilhamento anônimo de dados de uso. **`rebase init` pergunta uma vez por projeto, e a confirmação
tem padrão positivo (yes) — nada é enviado a menos que você responda:**

```bash
rebase telemetry status
rebase telemetry show
rebase telemetry enable
rebase telemetry disable
```

`status` imprime a configuração atual, `show` exibe exatamente o que seria enviado —
esteja o compartilhamento ativo ou não, para que você possa ler o payload antes de decidir — e
os outros dois comandos alteram a configuração. Se você nunca executou `init`, nada foi coletado.

## Fluxo de trabalho de migrações

O fluxo de trabalho típico para alterações de schema:

```bash
# 1. Edite sua coleção em config/collections/
# 2. Gere o schema do Drizzle
rebase schema generate

# 3. Gere a migração SQL
rebase db generate

# 4. Revise o SQL gerado em drizzle/

# 5. Aplique a migração
rebase db migrate
```

## Próximos passos

- **[Schema as Code](/docs/architecture/schema-as-code)** — Como funciona a geração de schemas
- **[Início rápido](/docs/getting-started/quickstart)** — Comece a usar

---
