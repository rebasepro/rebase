---
sourceHash: d0b65c1ecccde6ba
title: Referência da CLI
sidebar_label: CLI
description: Comandos da CLI do Rebase para inicialização de projetos, geração de schema, migrações de banco de dados e geração de SDK.
---

## Visão Geral

A CLI do Rebase (`rebase`) gerencia seu projeto desde o scaffolding até a implantação.

## Instalação

```bash
pnpm add -g @rebasepro/cli
```

Ou execute qualquer comando sem instalá-lo: `pnpm dlx @rebasepro/cli <command>`.

## Saída legível por máquina

`--json` é o switch e, fora da família `cloud`, é o único: `rebase status`, `rebase resources`, `rebase apps list`, `rebase upgrade` e `rebase verify` colocam então um valor JSON no stdout — o resultado ou um envelope `{"error": {"message", "code", "hint", "issues"}}` com saída diferente de zero — em **cada** encerramento do comando, para que o chamador possa analisar o stdout incondicionalmente. Sem ele, eles escrevem texto legível para humanos e as falhas vão para o stderr. O `rebase cloud` usa o mesmo envelope e é a única exceção ao switch: ele também ativa o JSON automaticamente quando o stdout não for um TTY, ou quando `REBASE_JSON=1` estiver definido. Assim, `rebase cloud status | cat` é JSON enquanto `rebase status | cat` não é — em um script, passe `--json` explicitamente em vez de depender de qualquer uma das regras.

## Comandos

### `rebase init`

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Inicializa um novo projeto Rebase:

```bash
rebase init [directory]
```

Configura um `backend/` (as tabelas em `backend/schema/`) e um `frontend/` (o painel de administração, com suas personalizações de tabelas em `frontend/src/cms/`); `--headless` faz o scaffold apenas do `backend/`, sem `backend/schema/`. [Estrutura do projeto](/docs/getting-started/project-structure/) mostra ambas as árvores.

| Flag | O que faz |
|---|---|
| `-t, --template <preset>` | `blog`, `ecommerce` ou `blank`. Padrão `blog` |
| `--headless` | Apenas backend — sem painel de administração e sem `backend/schema/`: o servidor serve as próprias tabelas do banco de dados. `--template` não tem efeito, pois não há tabelas para popular |
| `-y, --yes` | Nunca solicita confirmação. **Obrigatório sempre que não houver um terminal para responder**, como no CI. Pula o git init e a instalação de dependências — os padrões interativos respondem sim a ambos, portanto passe `--git` / `--install` se quiser executá-los |
| `-i, --install` | Instala dependências após o scaffolding. Sem ela, o init pergunta (padrão sim); com `--yes`, nada é instalado |
| `--no-install` | Não instala nada e não pergunta |
| `-g, --git` | Inicializa um repositório e faz o primeiro commit. Sem ela, o init pergunta (padrão sim); com `--yes`, nenhum repositório é criado |
| `--database-url <url>` | Usa um banco de dados existente em vez do gerenciado. Deve ser uma URL `postgres://` ou `postgresql://`: qualquer outra coisa é recusada antes que qualquer arquivo seja gravado, e o prompt interativo pergunta novamente |
| `--introspect` | Gera `backend/schema` a partir desse banco de dados. Implica `--template blank` e requer `--install` |
| `--project <slug>` | Vincula o scaffold a um projeto do Rebase Cloud |
| `--setup-key <key>` | A chave de uso único que autentica esse vínculo |
| `-a, --agent <name>` | Configura agentes de codificação de IA: as [skills](/docs/ai/skills) e o [servidor MCP](/docs/ai/mcp). Repetível ou separado por vírgulas — `claude`, `cursor`, `windsurf`, `gemini`, `codex`, `kiro`, `copilot` ou `all`. Sem ela, o `init` pergunta e pré-seleciona os agentes instalados na máquina; com `--yes`, nenhum |

### `rebase dev`

Inicia o servidor de desenvolvimento:

```bash
rebase dev
```

Inicia tanto o frontend quanto o backend com hot reloading e regenera o schema do Drizzle e os tipos do SDK (`generated/sdk/`) na inicialização e a cada salvamento em `backend/schema/`.

Ambas as portas são derivadas do caminho do projeto para que vários projetos Rebase possam ser executados lado a lado. Use as URLs exibidas pelo `rebase dev`. Fixe uma com `rebase dev --port 3001`.

Uma edição no `.env` reinicia o backend, que lê o arquivo novamente, assim como o painel de administração faz. O que o `rebase dev` define por si mesmo é mantido até que você o reinicie: `PORT` e `DATABASE_URL` quando estiver no banco de dados gerenciado ou no Docker.

Com `--database-url`, o `rebase dev` primeiro verifica se algo responde nesse host e porta. Se nada responder, ele avisa mencionando a flag e encerra com código `1` sem nada iniciado; ele também não altera os nomes do banco de dados no `.env`, nunca iniciando seu contêiner compose.

### `rebase build`

Compila o projeto em um bundle implantável em `dist-bundle/`:

```bash
rebase build
```

O bundle é o artefato que você implanta — a imagem de runtime o carrega, portanto não há necessidade de compilar uma imagem da aplicação você mesmo. Flags úteis:

| Flag | Efeito |
|------|--------|
| `--output <dir>` (ou `--out`) | Escreve o bundle em outro local além de `dist-bundle/` (um app por vez) |
| `--vendor` | Sempre instala e envia as dependências do bundle |
| `--no-vendor` | Nunca inclui dependências vendored; o pod as instala a cada inicialização |
| `--skip-type-check` | Pula a verificação de tipos (mais rápido, menos seguro) |
| `--no-static` | Não incorpora o frontend no bundle do backend (cada app estático ainda obtém seu próprio bundle) |
| `--skip-static-build` | Incorpora o frontend como já compilado, sem executar seu comando de build |

<span class="since-badge" data-since="0.31">Desde 0.31</span> Um frontend — cada app estático de `rebase.json` com uma configuração do Vite — cuja configuração não use `rebaseBackendGuard()` (de `@rebasepro/app/vitePlugin`) é recusado: é isso que mantém o código do servidor fora do bundle do navegador e impede o Vite de embutir um arquivo de backend como uma URL `data:` (ele falha o build, identificando-se, quando outro plugin substitui seu `build.assetsInlineLimit`). `frontend/src/cms/ui-config.json` é transportado para o bundle como `entry.uiConfig`, a apresentação do workspace que um backend implantado serve.

As dependências são incluídas (vendored) por padrão para que uma nova instância não sofra uma instalação de 35 a 55 segundos. Uma árvore que ultrapasse 2 GB em disco é descartada, pois o limite de upload é de 1 GB compactado.

Cada app estático que o bundle transporta recebe uma cópia brotli (`.br`) e gzip (`.gz`) ao lado de cada ativo com hash de conteúdo de 1 KB ou mais — os arquivos que um navegador armazena em cache por um ano. O runtime envia a versão que o navegador aceitar, portanto esses arquivos não custam processamento de compactação por requisição, incluindo a primeira visita após um deploy, e os navegadores que aceitam brotli o recebem (cerca de 11% menor que o gzip no JavaScript do admin). A saída de build própria do seu frontend permanece inalterada; apenas a cópia no bundle muda. No app de exemplo, isso adiciona menos de um segundo ao build e cerca de 2,4 MB ao bundle.

### `rebase upgrade`

Atualiza todos os pacotes `@rebasepro/*` fixados pelo projeto para uma única versão e, em seguida, instala com o gerenciador de pacotes indicado pelo seu lockfile. O `rebase upgrade` adota a mais recente (`latest`); `--to 0.21.0` uma versão exata, sem consulta ao registro; `--to canary` uma dist-tag. Cada versão fixada em `dependencies`, `devDependencies` e `optionalDependencies`, em cada `package.json` do projeto, mantém seu `^` ou `~`, e nada mais no arquivo é alterado. `peerDependencies` e especificações `workspace:`, `link:`, `file:`, git e tags são listadas e deixadas intocadas. As substituições (overrides) em `pnpm-workspace.yaml` e `package.json` também são atualizadas, mas um override `link:` ou `file:` tem precedência sobre qualquer fixação: isso é reportado, e `--drop-local-overrides` o remove. `--dry-run` não grava nada, `--no-install` pula a instalação e `--json` imprime um único documento.

Um projeto em uma versão de pré-lançamento, como uma canary, permanece em seu canal a menos que `latest` seja mais recente. Uma dist-tag que moveria uma versão para trás é recusada (`downgrade_refused` com `--json`), a menos que você passe `--allow-downgrade`; um `--to` exato é aplicado e sinalizado como downgrade. Um `--dry-run` de um upgrade que a execução real recusaria mostra o que mudaria e encerra com código 0, e com `--json` seu documento traz a recusa como `wouldRefuse` (`{ code, message, hint }`).

### `rebase start`

Executa o bundle compilado da mesma forma que um deployment o executa:

```bash
rebase start
```

Lê `PORT` e o restante do `.env`, diferentemente do `rebase dev`, no `NODE_ENV` que eles definirem. Um `.env` gerado no scaffold define `development`, portanto a primeira conta a se registrar ainda se torna o administrador, e o `rebase start` informa isso no topo; defina `NODE_ENV=production` para um servidor de produção. `rebase start --bundle ./dist-bundle` executa um bundle em outro local.

O `rebase start` não inicia nenhum banco de dados, e o `.env` do scaffold não tem `DATABASE_URL`, portanto uma execução local no banco de dados usado pelo `rebase dev` é `DATABASE_URL="$(rebase db url)" rebase start`. Sem uma, ele imprime essa linha antes de inicializar.

### `rebase apps list`

Mostra as aplicações que este repositório declara:

```bash
rebase apps list
```

Um repositório pode declarar mais de uma aplicação implantável — por exemplo, um backend e um site de marketing. É assim que você vê sobre o que o `rebase build` e o deploy irão atuar.

### `rebase eject`

Assuma o controle do processo do servidor e de sua imagem:

```bash
rebase eject
```

Grava o ponto de entrada do backend e um `Dockerfile` no projeto e altera o backend, para que o repositório construa sua própria imagem em vez de executar o runtime publicado. A partir de então, **as atualizações do runtime da plataforma não o alcançarão mais**, e a configuração de CORS, autenticação, armazenamento e encerramento passa a ser sua responsabilidade.

Visualize previamente com `rebase eject --dry-run`, que lista o que mudaria sem alterar nada. `--force` substitui um `backend/src/index.ts` ou `env.ts` existente, mantendo o arquivo atual como `<name>.bak`.

O servidor ejetado mantém uploads locais em `uploads/` do projeto, executado a partir do código-fonte ou compilado, assim como o `rebase dev` faz. Ele é executado em `backend/`, portanto um `STORAGE_PATH` relativo ali é lido a partir de `backend/`.

### `rebase schema generate` / `rebase schema stale`

<span class="since-badge" data-since="0.31">Desde 0.31</span>

```bash
rebase schema generate       # backend/schema → backend/src/schema.generated.ts
rebase schema stale          # name what differs from the tables, exit 1 if anything does
rebase schema stale --fix    # regenerate the file instead
```

Todo comando que lê o schema aceita `--schema-dir <dir>` para um projeto que o mantenha em outro local; `--collections` foi removido. O `rebase dev` mantém o arquivo atualizado, portanto `stale` é a verificação para um build ou CI. Consulte [Geração de Schema](/docs/cli/schema/).

### `rebase db`

```bash
rebase db push                 # apply the tables to the database (development)
rebase db generate             # write a SQL migration file
rebase db migrate              # apply the pending migrations
rebase db url                  # print the connection string this project uses
rebase db pull --from <url>    # copy another database into the local one
rebase db backup               # pg_dump; db backups list and db restore beside it
rebase db branch create <name> # a copy to work on; switch, list and prune it too
rebase db stop                 # stop the managed development database
rebase db reset                # delete it and start over
rebase db request-role migrate --to <role> # move requests to another Postgres role
rebase db provision --print    # the SQL that sets up the request role, for a DBA
```

Cada um deles está em [Comandos de Banco de Dados](/docs/cli/database/), com a ordem na qual um comando seleciona seu banco de dados; `push`, `generate` e `migrate` são abordados em detalhes em [Geração de Schema](/docs/cli/schema/).

### `rebase console`

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Um REPL do Node com os dados do projeto abertos, ou um snippet executado com `-e`:

```bash
rebase console
rebase console -e "rebase.dataAsAdmin.posts.find({ limit: 5 })"
```

`rebase` (`dataAsAdmin`, `sql`, `withAuth(user)`) e `tables` (as tabelas do projeto, carregadas de `backend/schema`) estão no escopo, e `await` no nível superior funciona. O banco de dados é resolvido da mesma forma que o `rebase db push` o resolve, e abri-lo não altera nada nele. Com `-e`, o resultado aguardado é impresso como JSON no stdout e qualquer exceção lançada encerra com código `1`. Flags: `--eval`/`-e`, `--schema-dir`, `--database-url`, `--docker`. Consulte [Scripts e o Console](/docs/backend/scripts/).

### `rebase migrate`

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Migrações unidirecionais a partir de uma estrutura que esta versão não lê mais: `rebase migrate collections-to-tables` (`config/collections` → `backend/schema` e `frontend/src/cms`) e `rebase migrate sdk-calls` (`data.collection("x")` → `data.table("x")` no seu próprio código). Suas flags, o que elas gravam e a seção "Revisar antes de implantar" estão em [Geração de Schema](/docs/cli/schema/#rebase-migrate).

### `rebase apps init` / `rebase apps config`

```bash
rebase apps list             # the apps this project declares
rebase apps init             # write a rebase.json inferred from this project
rebase apps config <app>     # the client configuration for one app
```

`apps init` não aceita nome: ele infere cada aplicação a partir do projeto e grava todo o `rebase.json`, recusando-se a substituir um existente a menos que você passe `--force`.

Um argumento de nome é recusado. `--force` preserva o que a inferência não tem como saber a partir do arquivo substituído: o nome de cada app, seu `path` e sua rota `cms`. Todo o restante é inferido novamente, e uma aplicação declarada que ele não encontrar mais é indicada como removida, portanto, em um scaffold ele grava de volta o `rebase.json` original. O comando de build da aplicação estática usa o gerenciador de pacotes do projeto.

Para um checkout não vinculado a um projeto Cloud, o `apps config` informa que ele não está vinculado, esteja o `rebase dev` em execução ou não, e fornece a URL do backend conforme servida pelo `rebase dev`.

### `rebase status`

Tudo o que este projeto declara e se o ambiente realmente o vincula:

```bash
rebase status               # every resource, and the variables it reads
rebase status --json        # machine-readable
```

```
  backend  ·  managed  Rebase's runtime boots your bundle
  declared in  backend/resources.ts
  configured by  .env

  buckets
  ✓ media  s3 · account:minio
      ✓ S3_BUCKET__MEDIA
      ✓ S3_ACCESS_KEY_ID__MINIO (shared, for S3_ACCESS_KEY_ID__MEDIA)
  ○ exports  s3
      · S3_BUCKET__EXPORTS not set
      └ declared, not configured — uploads here answer 501 STORAGE_SOURCE_NOT_CONFIGURED
```

Três arquivos decidem o que um backend pode alcançar, e este comando imprime os três juntos: `rebase.json` diz onde está seu código e quem executa o servidor, `backend/resources.ts` diz do que o projeto precisa e o ambiente diz como alcançar cada item. Todo o resto — `rebase.resources.json`, o manifesto do bundle — é gerado a partir do intermediário para leitores que não podem executar seu código, e você nunca precisa escrevê-lo manualmente.

Um `○` é o estado que vale a pena saber antes de um deploy em vez de depois: declarado, não configurado. Um `✗` significa que o ambiente define algo *incorretamente*, o que impede a inicialização em vez de degradar.

Um `rebase.resources.json` que não corresponda mais às declarações recebe uma linha com `○`. Um que ainda não foi gerado não recebe: o `rebase build` o grava em cada build, portanto um projeto que nunca foi compilado, como um scaffold recém-criado, não tem nada a corrigir.

### `rebase resources`

O que este projeto declara que precisa — os bancos de dados, buckets, tópicos e filas solicitados por `backend/resources.ts`, e os crons e funções definidos por seus arquivos:

```bash
rebase resources            # list them
rebase resources --write    # regenerate rebase.resources.json
rebase resources --check    # fail if the committed graph is stale
rebase resources --json     # machine-readable
```

`rebase resources --check` é a flag usada em jobs de CI para falhar caso o `rebase.resources.json` não coincida mais com `backend/resources.ts`. `--json` combina-se com ela: em caso de divergência (drift), `rebase resources --check --json` encerra com código 1 com um envelope de erro (`resource_graph_missing` ou `resource_graph_stale`), e em caso de sucesso o grafo traz `check.status`. `--write --json` grava o arquivo e reporta `written.changed`.

Um recurso é declarado em `backend/resources.ts` — `database("analytics")`, `bucket("media")`, `topic("signups")`, `queue("thumbnails")` — ou é um arquivo em `backend/crons` ou `backend/functions`, e nunca é escrito manualmente em `rebase.resources.json`, que é gerado a partir dessas declarações para que um host possa ler o que um projeto precisa sem compilá-lo. Cada entrada registra quem o utiliza (`table:events`, `column:posts.cover`, `function:report`).

Um backend também possui um banco de dados padrão e uma fonte de armazenamento padrão que ninguém declara. Ambos são listados aqui, marcados como `implicit`, e nenhum deles é gravado em `rebase.resources.json` — o host os fornece, portanto gravá-los solicitaria o provisionamento de algo que ninguém pediu. Declarar um recurso nomeado, como `bucket("media")`, mantém o padrão inalterado, de modo que ambos são listados. Apenas declarar o próprio padrão ou marcar um bucket com `default: true` o substitui.

Para ver o que a plataforma mantém para um projeto em comparação com o que seu código declara e remover um banco de dados provisionado que o código não menciona mais, consulte [`rebase cloud resources`](/docs/cli/cloud#resources).

`rebase cloud` — todos os comandos para o Rebase Cloud: autenticação, vínculo de projeto, deploys, configuração, bancos de dados, recursos, computação e mais — tem [sua própria página](/docs/cli/cloud).

### `rebase generate-sdk`

<span class="since-badge" data-since="0.31">Desde 0.31</span>

```bash
rebase generate-sdk
```

Gera um cliente tipado para as tabelas que `backend/schema/index.ts` exporta em `generated/sdk/`, com `TableName` e `tablesDictionary`; `--from <link|url>` lê o contrato de um backend em execução. `--register` também tipa dados no lado do servidor: ele grava os tipos e a declaração `Register` em `backend/generated/` e o registra em `rebase.json` (`registerDatabase`). Consulte [Dados tipados no servidor](/docs/backend/typed-server-data) e [Geração de Schema](/docs/cli/schema/#rebase-generate-sdk).

### `rebase doctor`

```bash
rebase doctor
```

O comando para executar quando algo estiver errado e você ainda não souber o que é. Ele relata e nunca altera nada, portanto é seguro contra qualquer banco de dados que você consiga acessar.

**Sem um banco de dados.** Estes são executados primeiro, pois tudo o que impede um projeto de funcionar ocorre antes que uma tabela possa ser comparada:

| Verificação | Motivo |
| --- | --- |
| Versão do Node | Em relação à faixa declarada pela CLI. Uma versão muito antiga não é reportada como "Node não suportado" — trata-se de um erro de sintaxe dentro de uma dependência. |
| Gerenciadores de pacotes | Dois lockfiles em um projeto. Executar `npm install` em um workspace pnpm reescreve o `node_modules` em um layout incompatível com o pnpm, e o sintoma é `Cannot find module` horas depois. |
| Slugs duplicados | Duas tabelas declarando o mesmo slug. O schema se recusa a compilar nessa situação, e isso identifica ambas. |
| Sanidade do `.env` | Um `JWT_SECRET` com menos de 32 caracteres (com o qual a produção se recusa a inicializar), e `NODE_ENV=production` sem `CORS_ORIGINS` nem `FRONTEND_URL`. Os valores nunca são impressos. |
| Divergência de versão de `@rebasepro/*` | O mesmo pacote fixado em versões diferentes entre os arquivos `package.json` do projeto. Duas cópias quebram o `instanceof` entre elas, o que falha como um type guard rejeitando seu próprio tipo. |
| Strings de conexão | Um `=` não codificado em um parâmetro de URL, o qual as próprias ferramentas do PostgreSQL se recusam a interpretar — assim, backups e o `psql` quebram enquanto a aplicação continua funcionando. |
| Funções customizadas | Do que cada função precisa de seu host e quais delas não funcionariam em um runtime edge. |

**Em relação ao banco de dados** — o do próprio projeto, resolvido da forma como o `rebase db url` o resolve; portanto, em um scaffold recém-criado, é o banco de dados gerenciado, que o `doctor` inicia:

| Verificação | Motivo |
| --- | --- |
| Tabelas → schema gerado | Se `schema.generated.ts` está desatualizado. |
| Tabelas → banco de dados | Tabelas, colunas, enums, chaves estrangeiras e junções ausentes. |
| Extensões necessárias | Uma coluna `col.vector()` precisa do pgvector, que o Rebase instala apenas onde um projeto a declarou. |
| Carimbo do schema (Schema stamp) | Se este banco de dados foi provisionado a partir dessas tabelas. Um hash, portanto ele pode indicar que os dois discordam, mas nunca qual está à frente. Um carimbo `v1:` de um runtime anterior a 0.31 é reportado uma vez, com a revalidação: `rebase db push`. |
| Tabelas → tipos do SDK | Se o SDK tipado gerado está desatualizado. |
| Políticas de RLS | Se as políticas do banco de dados coincidem com o `rls` que você declarou e se alguma política menciona uma role que este servidor não pode usar. |

Se o banco de dados estiver inacessível, suas fases serão reportadas como ignoradas com o motivo e o restante continuará em execução — consulte [Solução de Problemas](/docs/troubleshooting/).

Encerra com código diferente de zero quando uma verificação encontra um erro ou quando uma fase não pôde ser executada porque o banco de dados fornecido recusa conexões. Uma fase ignorada porque nenhum banco de dados pôde ser resolvido não é uma falha.

`rebase doctor --policies` executa apenas as verificações de RLS — sem diff de schema, sem tipos de SDK — e falha de forma restritiva (fail closed), o que o torna a forma indicada para uso como barreira de CI contra um banco de dados implantado.

`rebase doctor --database` executa apenas a verificação prévia do banco de dados: se a role sob a qual as requisições autenticadas rodam existe, é restrita e permite alternância, quais outros logins podem alternar para ela, se todas as roles podem se conectar e quais tabelas, permissões (grants) e políticas o Rebase compartilharia com outras roles. Cada apontamento indica o SQL a ser executado como administrador, a configuração de `rls` que adapta o Rebase ao banco de dados ou ambos. Ele lê o catálogo e não altera nada, encerrando com código 1 quando um apontamento for uma falha. Funciona também em projetos headless. Consulte [Executando em um banco de dados existente ou compartilhado](/docs/deployment/existing-database/).

### `rebase verify`

```bash
rebase verify
rebase verify --json
rebase verify --live
rebase verify --live --database-url postgresql://…
```

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Verifica se as tabelas estão seguras para envio, em um comando rápido para CI e para hooks de agentes de IA. Offline por padrão e nunca altera nada.

| Etapa | O que causa falha |
| --- | --- |
| Definições de tabela (`schema`) | `backend/schema` não carrega ou não compila, por meio do loader a partir do qual o backend inicializa: uma relação com uma tabela que o index não exporta, `rls: "inherit"` sem `defaultRls`, uma tabela sem chave primária — um apontamento por problema. Uma tabela sem `rls` é um deles. |
| Cobertura de RLS (`rls`) | Uma tabela com uma coluna `user_id`, `owner_id`, `organization_id` ou `tenant_id` cujas regras — as suas próprias ou o `defaultRls` herdado — permitem que uma role leia todas as linhas independentemente disso. Um aviso. |
| Atualização de migrações (`migrations`) | Uma tabela ou coluna declarada pelas tabelas que nenhum arquivo em `backend/drizzle/migrations` cria, ou uma que elas removeram mas que uma migração ainda cria. Ignorado para um projeto ainda sem migrações. |
| Personalizações do CMS (`cms`) | Um `customizeTable(...)` em `frontend/src/cms` (ou no `src/cms` de uma aplicação estática em `rebase.json`) que não coincide com as tabelas, lido estaticamente — os módulos não são executados. `cms-unknown-table`: o slug não indica nenhuma tabela, portanto o painel o ignora (o slug mais próximo é sugerido). `cms-unknown-field`: uma chave sob `fields` não é nem coluna nem relação (o nome SQL de uma coluna é respondido com sua chave). `cms-hidden-required`: um campo mantido fora do formulário (`hiddenInForm`, `readOnly`, `disabled`) cuja coluna é `NOT NULL` sem valor padrão e nada preenchido pelo servidor, de modo que criar um registro pelo painel sempre falha; um aviso quando um hook `beforeSave` ou transform puder preenchê-lo, silenciado por `filledByServer`. `cms-duplicate-customization`: um mesmo slug personalizado duas vezes. `cms-not-static` (um aviso): uma chamada cujo slug, opções ou `fields` não são literais ou uma `const` no mesmo arquivo, logo nada nela pôde ser verificado. `cms-ui-config-not-mounted` (um aviso): `frontend/src/cms/ui-config.json` existe, mas não é passado para `<RebaseCMS>` como `uiConfig`. `cms-backend-guard-missing`: a configuração do Vite do frontend não usa `rebaseBackendGuard()`, portanto `rebase build` a recusaria. Um projeto headless não possui `frontend/src/cms` e pula esta etapa. |
| Auditoria de RLS ao vivo (`live`) | Com `--live`: o catálogo [`rls-check`](/docs/rls-check) contra o banco de dados do projeto e se todas as migrações foram aplicadas. O banco de dados é resolvido da mesma forma que os comandos `db` resolvem — `--database-url`, `DATABASE_URL`, `--docker`, caso contrário o banco de dados de desenvolvimento gerenciado. Um banco de dados que não esteja configurado ou não responda é um erro, não um pulo: a auditoria foi solicitada. Uma política de leitura `USING (true)` compilada a partir de uma regra `access: "public"` é um aviso enquanto a API exigir um token (`AUTH_REQUIRE`, ativado por padrão) — todo usuário autenticado lê todas as linhas — e um erro com `AUTH_REQUIRE=false`, onde as linhas são anônimas. |

`--json` imprime um único objeto, `{ ok, schemaDir, steps, findings, summary }`: cada etapa é `{ id, title, status, detail? }` (`status` é `passed`, `failed`, `warnings` ou `skipped`), e cada apontamento traz `step`, `check` (um tipo estável em kebab-case), `severity`, `message` e, quando aplicável, `fix`, `table`, `file`, `line` e o `path` pontilhado na tabela (`posts.rls[0]`) — para que um agente possa reparar o que quebrou. `summary` contabiliza `errors` e `warnings`. `--quiet` não imprime nada quando tudo passa. Encerra com código diferente de zero em caso de erro; avisos não causam falha.

Um projeto criado com scaffold executa esse comando para o Claude Code após cada edição em `backend/schema/`: consulte [`rebase skills install`](#rebase-skills-install).

### `rebase auth`

Comandos de gerenciamento de autenticação:

```bash
rebase auth reset-password --email admin@example.com --password NewPassword123!
```

### `rebase api-keys`

Gerencia as chaves de API de serviço do projeto — a credencial usada por um agente, script ou outro serviço, ao contrário da sessão de um usuário final:

```bash
rebase api-keys list
rebase api-keys get abc123-def456
rebase api-keys create --name "Blog CI" --scopes data:read:posts,data:write:posts --expires-in 90
rebase api-keys create --name "Ops" --full-access --roles admin --expires-at 2027-01-31
rebase api-keys revoke abc123-def456
```

`--scopes` define o que a chave pode fazer, separado por vírgulas ou repetido; `--full-access` concede todos os escopos que a chave de serviço possui, exceto `keys:*`. `--roles` adiciona roles de RLS além de `service`, `--expires-in` recebe dias e `--expires-at` uma data ISO. `rebase api-keys scopes` lista todos os escopos conhecidos pelo backend. Uma chave é exibida apenas uma vez. Tanto os escopos da chave quanto a segurança em nível de linha (RLS) da identidade sob a qual ela atua são aplicados. Consulte [Chaves de API](/docs/backend/api-keys/).

### `rebase storage`

Manutenção completa de arquivos armazenados, por meio do backend em execução com `REBASE_SERVICE_KEY` do `.env`:

```bash
rebase storage orphans                         # files no row names
rebase storage orphans --source media --delete # and delete them, after asking
rebase storage move --from "(default)" --to media --prefix avatars
rebase storage move --from "(default)" --to media --prefix avatars --delete-source
```

`orphans` lê todas as linhas de todas as tabelas conforme armazenadas (incluindo linhas com soft-delete, ultrapassando todos os hooks `beforeQuery` e `afterRead`) e todas as entradas de [histórico](/docs/backend/history/), já que uma reversão restaura o que ela contém. Ele lista os arquivos de uma fonte (`--source`, a fonte padrão se omitida) que nenhuma string em qualquer uma delas referencia: uma chave, uma URL, uma referência `rebase-storage:` em um texto. Arquivos mais novos que `--older-than` horas (24 por padrão) são desconsiderados, pois o painel de administração faz upload de um arquivo antes que a linha que o referencia seja salva. A varredura roda no backend em segundo plano, para que um projeto grande demais para varrer em uma única requisição (atrás de um ingress com timeout) ainda assim termine. A CLI a inicia e depois mostra seu progresso (arquivos listados, linhas lidas, tabelas concluídas e quaisquer que não puderam ser lidas) até terminar. Com a [fila de jobs](/docs/backend/jobs/) ativada, a varredura é um job `storage.orphans` executado pelos job workers. Sem ela, a varredura é executada dentro do processo do servidor que foi requisitado, e a CLI informa isso: reiniciar esse processo interrompe a varredura. Uma varredura é uma tentativa de job, limitada por `jobs.timeoutMs` (15 minutos por padrão). Aumente esse valor ou defina-o como 0 para uma fonte que demore mais. `--json` imprime o mesmo relatório de antes, além de seu `scanId`.

`--delete` pergunta antes de excluir (`--yes` pula a pergunta e é obrigatório quando não há terminal). Ele exclui apenas a partir da varredura recém-impressa e apenas dentro de 15 minutos após a conclusão dessa varredura. Nada é excluído se uma tabela não puder ser lida: uma tabela com hooks de leitura em um banco de dados cujo driver não consegue ultrapassá-los conta como não lida. Antes de excluir qualquer coisa, o servidor lê todas as linhas e entradas de histórico novamente em relação aos arquivos listados. Em seguida, ele verifica cada arquivo novamente antes de excluí-lo. Um arquivo referenciado por uma linha agora, que tenha sido reenviado desde a varredura ou que já não exista é mantido, e a CLI o lista como mantido. Arquivos referenciados apenas por tabelas que o Rebase não gerencia parecem não utilizados: verifique antes de excluir. Em um backend da versão 0.25.1 ou anterior, a CLI faz a varredura da maneira antiga, dentro de uma única requisição.

`move` copia os arquivos sob `--prefix` para outra fonte sob as mesmas chaves, uma página por vez. Um arquivo que o destino já possui com o mesmo tamanho é ignorado, de modo que uma movimentação interrompida é retomada ao ser executada novamente; `--delete-source` exclui cada arquivo da origem assim que o destino o contiver, sendo recusado caso as duas fontes armazenem no mesmo bucket ou diretório. Quando a movimentação termina, a CLI lista a origem novamente com uma nova varredura e indica cada arquivo que não foi movido: com `--delete-source`, qualquer arquivo ainda na origem; sem ele, qualquer arquivo do qual o destino não possua uma cópia com o mesmo tamanho. Ele encerra com código 1 quando houver algum, e executar a mesma movimentação novamente o processará. `--json` imprime esses arquivos como `notMoved`. A leitura do relatório de uma varredura requer `database:read`. Iniciar uma varredura, excluir e mover requerem `database:write`, que a chave de serviço possui.

### `rebase skills install`

Instala as skills de referência do Rebase para seus assistentes de codificação com IA — cada `--agent` acima:

```bash
rebase skills install
rebase skills install --agent claude,cursor
rebase skills install --agent all
rebase skills --hooks
```

Consulte [Skills de Agente](/docs/ai/skills) para a lista completa e onde os arquivos são gravados.

`--hooks` instala o mecanismo de proteção (guardrail) do Claude Code que o `rebase init` inclui em cada projeto: `.claude/hooks/post-edit-collection.sh`, registrado como um hook `PostToolUse` em `.claude/settings.json`, que executa `rebase verify --quiet` após cada edição em `backend/schema/` ou `frontend/src/cms/` e devolve qualquer problema ao agente. As configurações e hooks existentes são preservados. `rebase skills --hooks` instala apenas o hook.

### `rebase telemetry`

Compartilhamento anônimo de uso, desativado até que você diga sim. Um `rebase init` interativo pergunta ao final, e o prompt tem 'não' como padrão, portanto nada é compartilhado a menos que você responda sim. A resposta é por máquina (`~/.rebase/telemetry.json`): após um sim, o `init` nunca mais pergunta, e após um não, o próximo `init` pergunta novamente. Cada checkout recebe um ID de projeto aleatório, mantido em seu `.rebase/telemetry-project.json` ignorado pelo git.

```bash
rebase telemetry status
rebase telemetry show
rebase telemetry enable
rebase telemetry disable
```

`status` imprime a configuração atual, `show` imprime exatamente o que seria enviado — esteja o compartilhamento ativado ou não, para que você possa ler o payload antes de decidir — e os outros dois a alteram. Se você nunca executou `init`, nada jamais foi coletado.

## Próximos Passos

- **[Geração de Schema](/docs/cli/schema/#production-workflow)** — O fluxo de trabalho de migração, desde a edição de uma tabela até a produção
- **[Schema as Code](/docs/architecture/schema-as-code)** — Como a geração de schema funciona
- **[Início Rápido](/docs/getting-started/quickstart)** — Comece agora
