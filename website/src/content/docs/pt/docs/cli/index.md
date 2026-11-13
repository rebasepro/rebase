---
sourceHash: 4281e973dcdf0b86
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

Ou execute qualquer comando sem instalá-lo: `pnpm dlx @rebasepro/cli <command>`.

## Saída legível por máquina

`--json` é o modificador, e fora da família `cloud` ele é o único: `rebase status`, `rebase resources`, `rebase apps list`, `rebase upgrade` e `rebase verify` colocam um único valor JSON no stdout — o resultado, ou um envelope `{"error": {"message", "code", "hint", "issues"}}` com uma saída diferente de zero — em **todas** as finalizações do comando, permitindo que o chamador faça o parse do stdout incondicionalmente. Sem ele, eles exibem texto legível para humanos e as falhas vão para o stderr. `rebase cloud` usa o mesmo envelope e é a única exceção ao modificador: ele também ativa o JSON automaticamente quando o stdout não for um TTY, ou quando `REBASE_JSON=1` estiver definido. Assim, `rebase cloud status | cat` produz JSON enquanto `rebase status | cat` não — em um script, passe `--json` explicitamente em vez de depender de qualquer uma das regras.

## Comandos

### `rebase init`

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Inicializa um novo projeto Rebase:

```bash
rebase init [directory]
```

Configura um `backend/` (as tabelas em `backend/schema/`) e um `frontend/` (o painel de administração, com suas customizações de tabela em `frontend/src/cms/`); `--headless` faz o scaffold apenas do `backend/`, sem `backend/schema/`. A [estrutura do projeto](/docs/getting-started/project-structure/) mostra ambas as árvores.

| Flag | O que faz |
|---|---|
| `-t, --template <preset>` | `blog`, `ecommerce` ou `blank`. Padrão: `blog` |
| `--headless` | Apenas backend — sem painel de administração e sem `backend/schema/`: o servidor serve as próprias tabelas do banco de dados. `--template` não tem efeito, pois não há tabelas para popular |
| `-y, --yes` | Nunca solicita confirmações. **Obrigatório sempre que não houver terminal para responder**, como em CI. Ele pula o git init e a instalação de dependências — os padrões interativos dizem sim para ambos, portanto passe `--git` / `--install` se desejar executá-los |
| `-i, --install` | Instala dependências após o scaffolding. Sem ela, o init pergunta (padrão sim); sob `--yes`, nada é instalado |
| `--no-install` | Não instala nada e não pergunta |
| `-g, --git` | Inicializa um repositório e faz o primeiro commit. Sem ela, o init pergunta (padrão sim); sob `--yes`, nenhum repositório é criado |
| `--database-url <url>` | Usa um banco de dados existente em vez do gerenciado. Deve ser uma URL `postgres://` ou `postgresql://`: qualquer outra coisa é recusada antes que um arquivo seja escrito, e o prompt interativo pergunta novamente |
| `--introspect` | Gera `backend/schema` a partir desse banco de dados. Implica `--template blank` e requer `--install` |
| `--project <slug>` | Vincula o scaffold a um projeto do Rebase Cloud |
| `--setup-key <key>` | A chave de uso único que autentica esse vínculo |
| `-a, --agent <name>` | Configura agentes de codificação de IA: as [skills](/docs/ai/skills) e o [servidor MCP](/docs/ai/mcp). Repetível ou separado por vírgulas — `claude`, `cursor`, `windsurf`, `gemini`, `codex`, `kiro`, `copilot` ou `all`. Sem ela, o `init` pergunta e pré-marca os agentes instalados na máquina; sob `--yes`, nenhum |

### `rebase dev`

Inicia o servidor de desenvolvimento:

```bash
rebase dev
```

Inicia tanto o frontend quanto o backend com hot reloading, e regenera o schema do Drizzle e os tipos do SDK (`generated/sdk/`) na inicialização e a cada salvamento em `backend/schema/`.

Ambas as portas são derivadas do caminho do projeto, para que vários projetos Rebase possam rodar lado a lado. Use as URLs impressas por `rebase dev`. Fixe uma porta com `rebase dev --port 3001`.

Uma edição no `.env` reinicia o backend, que lê o arquivo novamente, assim como o painel de administração faz. O que o `rebase dev` define por si próprio é mantido até que você o reinicie: `PORT`, e `DATABASE_URL` quando estiver no banco de dados gerenciado ou no Docker.

Com `--database-url`, o `rebase dev` primeiro verifica se algo responde naquele host e porta. Se nada responder, ele informa isso, indicando a flag, e sai com código `1` sem iniciar nada; ele também não altera as variáveis de banco de dados do `.env`, nunca iniciando seu container compose.

### `rebase build`

Compila o projeto em um bundle pronto para deploy em `dist-bundle/`:

```bash
rebase build
```

O bundle é o artefato que você implanta — a imagem de runtime o carrega, portanto não há necessidade de compilar uma imagem de aplicação por conta própria. Flags úteis:

| Flag | Efeito |
|------|--------|
| `--output <dir>` (ou `--out`) | Grava o bundle em outro local que não seja `dist-bundle/` (uma aplicação por vez) |
| `--vendor` | Sempre instala e empacota as dependências no bundle |
| `--no-vendor` | Nunca faz vendoring; o pod as instala a cada inicialização |
| `--skip-type-check` | Pula a checagem de tipos (mais rápido, menos seguro) |
| `--no-static` | Não embute o frontend no bundle do backend (cada app estático ainda recebe seu próprio bundle) |
| `--skip-static-build` | Embute o frontend já compilado, sem executar seu comando de build |

<span class="since-badge" data-since="0.31">Desde 0.31</span> Um frontend — qualquer app estático do `rebase.json` com uma configuração Vite — cuja configuração não utilize `rebaseBackendGuard()` (de `@rebasepro/app/vitePlugin`) é recusado: é ele quem impede que o código do servidor vá parar no bundle do navegador, e impede o Vite de embutir um arquivo do backend como uma URL `data:` (ele falha a compilação, identificando-se, quando outro plugin substitui seu `build.assetsInlineLimit`). `frontend/src/cms/ui-config.json` é transportado para o bundle como `entry.uiConfig`, a apresentação do workspace que um backend implantado serve.

As dependências são incluídas via vendoring por padrão para que uma nova instância não precise esperar de 35 a 55 segundos de instalação. Uma árvore que ultrapasse 2 GB em disco é descartada, pois o limite de upload é de 1 GB compactado.

Cada app estático que o bundle carrega recebe uma cópia em brotli (`.br`) e gzip (`.gz`) ao lado de cada asset com hash de conteúdo de 1 KB ou mais — os arquivos que o navegador armazena em cache por um ano. O runtime envia aquele que o navegador aceita, de modo que esses arquivos não consomem processamento de compressão por requisição, incluindo a primeira visita após um deploy, e navegadores que suportam brotli o recebem (cerca de 11% menor que o gzip no JavaScript da administração). A saída de build do seu próprio frontend permanece intocada; apenas a cópia no bundle muda. No app de exemplo, isso adiciona menos de um segundo à compilação e cerca de 2,4 MB ao bundle.

### `rebase upgrade`

Atualiza todos os pacotes `@rebasepro/*` fixados pelo projeto para uma única versão e, em seguida, instala com o gerenciador de pacotes especificado no lockfile. `rebase upgrade` obtém a versão mais recente (`latest`); `--to 0.21.0` define uma versão exata, sem consulta ao registro; `--to canary` usa uma dist-tag. Cada versão fixada em `dependencies`, `devDependencies` e `optionalDependencies`, em cada `package.json` do projeto, mantém seu `^` ou `~`, e nada mais no arquivo é alterado. `peerDependencies` e especificações como `workspace:`, `link:`, `file:`, git e tags são listadas e mantidas como estão. Overrides em `pnpm-workspace.yaml` e `package.json` também são atualizados, mas um override `link:` ou `file:` tem precedência sobre qualquer versão fixada: isso é informado, e `--drop-local-overrides` o remove. `--dry-run` não grava nada, `--no-install` pula a instalação e `--json` imprime um único documento.

Um projeto em uma versão de pré-lançamento, como uma canary, permanece em seu canal, a menos que `latest` seja mais recente. Uma dist-tag que faria o downgrade de uma versão fixada é recusada (`downgrade_refused` sob `--json`), a menos que você passe `--allow-downgrade`; um `--to` exato é aplicado e sinalizado como downgrade. Um `--dry-run` de um upgrade que a execução real recusaria mostra o que seria alterado e sai com código 0, e sob `--json` seu documento traz a recusa como `wouldRefuse` (`{ code, message, hint }`).

### `rebase start`

Executa o bundle compilado da mesma forma que um deploy o executa:

```bash
rebase start
```

Lê o `PORT` e o restante do `.env`, ao contrário de `rebase dev`, no `NODE_ENV` definido por eles. Um `.env` gerado por scaffold define `development`, portanto a primeira conta cadastrada ainda se torna o administrador, e `rebase start` informa isso no topo; defina `NODE_ENV=production` para um servidor de produção. `rebase start --bundle ./dist-bundle` executa um bundle em outro local.

`rebase start` não inicia nenhum banco de dados, e o `.env` do scaffold não contém `DATABASE_URL`, portanto, para uma execução local usando o banco de dados que `rebase dev` utiliza, execute: `DATABASE_URL="$(rebase db url)" rebase start`. Sem uma URL definida, ele imprime essa linha antes de inicializar.

### `rebase apps list`

Exibe os apps que este repositório declara:

```bash
rebase apps list
```

Um repositório pode declarar mais de um app implantável — por exemplo, um backend e um site de marketing. É assim que você visualiza o que o `rebase build` e o deploy afetarão.

### `rebase eject`

Assume o controle do processo do servidor e de sua imagem:

```bash
rebase eject
```

Escreve o ponto de entrada do backend e um `Dockerfile` no projeto e transfere o controle do backend, para que o repositório crie sua própria imagem em vez de executar o runtime publicado. A partir de então, **as atualizações do runtime da plataforma não o alcançarão mais**, e configurações de CORS, autenticação, armazenamento e encerramento passam a ser de sua responsabilidade.

Visualize com antecedência usando `rebase eject --dry-run`, que lista o que seria alterado sem modificar nada. `--force` substitui um `backend/src/index.ts` ou `env.ts` existente, salvando o arquivo atual como `<name>.bak`.

O servidor ejetado mantém os uploads locais no diretório `uploads/` do projeto, seja executado a partir do código-fonte ou compilado, assim como o `rebase dev` faz. Ele roda em `backend/`, portanto um `STORAGE_PATH` relativo ali é lido a partir de `backend/`.

### `rebase schema generate` / `rebase schema stale`

<span class="since-badge" data-since="0.31">Desde 0.31</span>

```bash
rebase schema generate       # backend/schema → backend/src/schema.generated.ts
rebase schema stale          # name what differs from the tables, exit 1 if anything does
rebase schema stale --fix    # regenerate the file instead
```

Todos os comandos que leem o schema aceitam `--schema-dir <dir>` para projetos que o mantêm em outro lugar; `--collections` foi removido. O `rebase dev` mantém o arquivo atualizado, de modo que `stale` é a verificação adequada para build ou CI. Consulte [Geração de Schemas](/docs/cli/schema/).

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

Cada um é detalhado em [Comandos de Banco de Dados](/docs/cli/database/), com a ordem na qual um comando seleciona seu banco de dados; `push`, `generate` e `migrate` são abordados em detalhes em [Geração de Schemas](/docs/cli/schema/).

### `rebase console`

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Um REPL do Node com os dados do projeto abertos, ou um snippet executado com `-e`:

```bash
rebase console
rebase console -e "rebase.dataAsAdmin.posts.find({ limit: 5 })"
```

`rebase` (`dataAsAdmin`, `sql`, `withAuth(user)`) e `collections` (as tabelas do projeto, carregadas de `backend/schema`) estão no escopo, e `await` de nível superior funciona. O banco de dados é resolvido da mesma forma que `rebase db push` o resolve, e abri-lo não altera nada nele. Com `-e`, o resultado esperado é impresso como JSON no stdout e um erro lançado sai com código `1`. Flags: `--eval`/`-e`, `--schema-dir`, `--database-url`, `--docker`. Consulte [Scripts e o Console](/docs/backend/scripts/).

### `rebase migrate`

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Migrações unidirecionais a partir de uma estrutura que esta versão não lê mais:
`rebase migrate collections-to-tables` (`config/collections` → `backend/schema` e `frontend/src/cms`) e `rebase migrate sdk-calls` (`data.collection("x")` → `data.table("x")` no seu próprio código). Suas flags, o que elas escrevem e a seção "Revisar antes de implantar" estão em [Geração de Schemas](/docs/cli/schema/#rebase-migrate).

### `rebase apps init` / `rebase apps config`

```bash
rebase apps list             # the apps this project declares
rebase apps init             # write a rebase.json inferred from this project
rebase apps config <app>     # the client configuration for one app
```

`apps init` não recebe um nome: ele infere todos os apps a partir do projeto e escreve o `rebase.json` completo, recusando-se a substituir um existente a menos que você passe `--force`.

Um argumento de nome é recusado. `--force` preserva o que a inferência não consegue determinar a partir do arquivo substituído: o nome de cada app, seu `path` e sua rota `cms`. Todo o restante é inferido novamente, e um app declarado que não seja mais encontrado é marcado como removido, de modo que em um scaffold ele regrava o `rebase.json` original. O comando de build do app estático utiliza o gerenciador de pacotes do projeto.

Para um repositório não vinculado a um projeto Cloud, `apps config` informa que ele não está vinculado, quer o `rebase dev` esteja em execução ou não, e fornece a URL do backend conforme servida pelo `rebase dev`.

### `rebase status`

Tudo o que este projeto declara e se o ambiente realmente faz o vínculo correspondente:

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

Três arquivos definem o que um backend pode alcançar, e este comando exibe os três juntos:
`rebase.json` indica onde está seu código e quem executa o servidor, `backend/resources.ts` declara o que o projeto precisa e o ambiente define como alcançar cada recurso. Todo o restante — `rebase.resources.json`, o manifesto do bundle — é gerado a partir do intermediário para leitores que não conseguem executar seu código, e você nunca precisa editá-lo manualmente.

Um `○` representa o estado importante de se conhecer antes de um deploy e não depois: declarado, mas não configurado. Um `✗` indica que o ambiente define algo *incorretamente*, o que impede a inicialização em vez de degradar suavemente.

Um `rebase.resources.json` que não coincida mais com as declarações recebe uma linha com `○`. Um que ainda não foi escrito não recebe: `rebase build` o grava a cada compilação, portanto um projeto que nunca foi compilado, como um scaffold recém-criado, não tem nada a corrigir.

### `rebase resources`

O que este projeto declara que necessita — os bancos de dados, buckets, tópicos e filas que `backend/resources.ts` requisita, além dos crons e funções definidos por seus arquivos:

```bash
rebase resources            # list them
rebase resources --write    # regenerate rebase.resources.json
rebase resources --check    # fail if the committed graph is stale
rebase resources --json     # machine-readable
```

`rebase resources --check` é a flag usada em CI para falhar caso um `rebase.resources.json` não coincida mais com `backend/resources.ts`. `--json` combina-se com ela: havendo divergência, `rebase resources --check --json` sai com código 1 e um envelope de erro (`resource_graph_missing` ou `resource_graph_stale`), e em caso de sucesso o grafo traz `check.status`. `--write --json` grava o arquivo e reporta `written.changed`.

Um recurso é declarado em `backend/resources.ts` — `database("analytics")`, `bucket("media")`, `topic("signups")`, `queue("thumbnails")` — ou é um arquivo sob `backend/crons` ou `backend/functions`, nunca sendo escrito manualmente em `rebase.resources.json`, que é gerado a partir dessas declarações para que uma plataforma hospedeira possa ler o que o projeto precisa sem precisar compilá-lo. Cada entrada registra quem o utiliza (`table:events`, `column:posts.cover`, `function:report`).

Um backend também possui um banco de dados padrão e uma fonte de armazenamento padrão que ninguém precisa declarar. Ambos são listados aqui, marcados como `implicit`, e nenhum deles é gravado em `rebase.resources.json` — a plataforma de hospedagem os fornece, portanto registrá-los solicitaria o provisionamento de algo que ninguém pediu. Declarar um recurso nomeado, como `bucket("media")`, mantém o padrão intacto, listando ambos. Apenas declarar o padrão explicitamente, ou marcar um bucket como `default: true`, o substitui.

Para visualizar o que a plataforma mantém para um projeto em relação ao que seu código declara, e para remover um banco de dados provisionado que o código não menciona mais, consulte [`rebase cloud resources`](/docs/cli/cloud#resources).

`rebase cloud` — todos os comandos para o Rebase Cloud: autenticação, vínculo de projetos, deploys, configuração, bancos de dados, recursos, computação e mais — tem [sua própria página](/docs/cli/cloud).

### `rebase generate-sdk`

<span class="since-badge" data-since="0.31">Desde 0.31</span>

```bash
rebase generate-sdk
```

Gera um cliente tipado para as tabelas exportadas por `backend/schema/index.ts` em `generated/sdk/`, com `TableName` e `tablesDictionary`; `--from <link|url>` lê o contrato de um backend em execução. `--register` também tipa os dados do lado do servidor: escreve os tipos e a declaração de `Register` em `backend/generated/` e a armazena em `rebase.json` (`registerDatabase`). Consulte [Dados tipados no servidor](/docs/backend/typed-server-data) e [Geração de Schemas](/docs/cli/schema/#rebase-generate-sdk).

### `rebase doctor`

```bash
rebase doctor
```

O comando para executar quando algo estiver errado e você ainda não souber o quê. Ele apenas relata e nunca modifica nada, sendo seguro contra qualquer banco de dados acessível.

**Sem banco de dados.** Estas verificações rodam primeiro, pois tudo o que impede um projeto de funcionar ocorre antes que uma tabela possa ser comparada:

| Verificação | Por quê |
| --- | --- |
| Versão do Node | Comparada com o intervalo declarado pela CLI. Versões muito antigas não são reportadas como "Node não suportado" — manifestam-se como erros de sintaxe dentro de dependências. |
| Gerenciadores de pacotes | Dois lockfiles no mesmo projeto. Executar `npm install` em um workspace pnpm reestrutura o `node_modules` em um formato incompatível com o pnpm, causando erros de `Cannot find module` horas depois. |
| Slugs duplicados | Duas tabelas declarando o mesmo slug. O schema não compila com isso, e esta verificação identifica ambas. |
| Validade do `.env` | Um `JWT_SECRET` com menos de 32 caracteres (o que impede a inicialização em produção) e `NODE_ENV=production` sem `CORS_ORIGINS` nem `FRONTEND_URL`. Os valores nunca são exibidos. |
| Divergência de versão de `@rebasepro/*` | O mesmo pacote fixado em versões diferentes nos vários arquivos `package.json` do projeto. Duas cópias quebram o `instanceof` entre elas, falhando como um type guard que rejeita seu próprio tipo. |
| Strings de conexão | Um `=` não codificado em um parâmetro de URL, que as ferramentas do próprio PostgreSQL se recusam a processar — quebrando backups e o `psql` enquanto a aplicação continua funcionando. |
| Funções customizadas | O que cada função requer de seu host e quais delas não executariam em um edge runtime. |

**No banco de dados** — o do próprio projeto, resolvido da forma como `rebase db url` o resolve; logo, em um scaffold novo, é o banco de dados gerenciado, que o `doctor` inicializa:

| Verificação | Por quê |
| --- | --- |
| Tabelas → schema gerado | Se `schema.generated.ts` está desatualizado. |
| Tabelas → banco de dados | Tabelas, colunas, enums, chaves estrangeiras e tabelas de junção ausentes. |
| Extensões necessárias | Uma coluna `col.vector()` requer o pgvector, que o Rebase instala apenas onde o projeto o declarou. |
| Carimbo do schema (Schema stamp) | Se este banco de dados foi provisionado a partir destas tabelas. É um hash, portanto pode informar se os dois divergem, mas nunca qual está à frente. Um carimbo `v1:` de um runtime anterior ao 0.31 é reportado uma vez, com a instrução de recarimbá-lo: `rebase db push`. |
| Tabelas → tipos do SDK | Se o SDK tipado gerado está desatualizado. |
| Políticas RLS | Se as políticas do banco de dados coincidem com o `rls` declarado e se alguma política faz referência a uma role que este servidor não pode usar. |

Se o banco de dados estiver inacessível, suas fases serão reportadas como ignoradas com o motivo, e o restante continuará sendo executado — consulte [Solução de Problemas](/docs/troubleshooting/).

Sai com código diferente de zero quando uma verificação encontra um erro ou quando uma fase não pôde ser executada porque o banco de dados fornecido recusa conexões. Uma fase ignorada porque nenhum banco de dados pôde ser resolvido não é considerada falha.

`rebase doctor --policies` executa apenas as verificações de RLS — sem diff de schema, sem tipos de SDK — e falha preventivamente (fails closed), tornando-se a opção ideal para portais de validação em CI contra um banco de dados implantado.

`rebase doctor --database` executa apenas a pré-validação do banco de dados: se a role com a qual as requisições autenticadas rodam existe, se é restrita e pode ser assumida, quais outros logins podem alternar para ela, se todas as roles podem se conectar e quais tabelas, permissões (grants) e políticas o Rebase compartilharia com outras roles. Cada apontamento indica o SQL a ser executado como administrador, a configuração de `rls` que adapta o Rebase ao banco de dados em vez disso, ou ambos. Ele lê o catálogo e não altera nada, saindo com código 1 caso haja alguma falha. Funciona também em projetos headless. Consulte [Executando em um banco de dados existente ou compartilhado](/docs/deployment/existing-database/).

### `rebase verify`

```bash
rebase verify
rebase verify --json
rebase verify --live
rebase verify --live --database-url postgresql://…
```

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Verifica se as tabelas estão seguras para deploy, em um único comando rápido para CI e para hooks de agentes de IA. Funciona offline por padrão e nunca altera nada.

| Etapa | O que causa falha |
| --- | --- |
| Definições de tabela (`schema`) | `backend/schema` não carrega ou não compila através do carregador com o qual o backend inicializa: uma relação para uma tabela que o índice não exporta, `rls: "inherit"` sem `defaultRls`, uma tabela sem chave primária — um apontamento por problema. Uma tabela sem `rls` é um deles. |
| Cobertura de RLS (`rls`) | Uma tabela com uma coluna `user_id`, `owner_id`, `organization_id` ou `tenant_id` cujas regras — próprias ou herdadas de `defaultRls` — permitem que uma role leia todas as linhas independentemente disso. Gera um aviso. |
| Atualização das migrações (`migrations`) | Uma tabela ou coluna declarada nas tabelas que nenhum arquivo em `backend/drizzle/migrations` cria, ou uma removida que uma migração ainda cria. Ignorado em projetos que ainda não possuem migrações. |
| Customizações do CMS (`cms`) | Um `customizeTable(...)` em `frontend/src/cms` (ou no `src/cms` de um app estático em `rebase.json`) que não corresponda às tabelas, lido estaticamente — os módulos não são executados. `cms-unknown-table`: o slug não corresponde a nenhuma tabela, logo o painel o ignora (o slug mais próximo é sugerido). `cms-unknown-field`: uma chave sob `fields` não é nem coluna nem relação (o nome SQL de uma coluna é retornado com sua chave). `cms-hidden-required`: um campo omitido do formulário (`hiddenInForm`, `readOnly`, `disabled`) cuja coluna é `NOT NULL` sem valor padrão e sem preenchimento pelo servidor, fazendo com que a criação de um registro pelo painel sempre falhe; gera um aviso se um hook `beforeSave` ou transformação puder preenchê-lo, silenciado por `filledByServer`. `cms-duplicate-customization`: um mesmo slug customizado duas vezes. `cms-not-static` (aviso): uma chamada cujo slug, opções ou `fields` não sejam literais ou uma `const` no mesmo arquivo, portanto nada nela pôde ser verificado. `cms-ui-config-not-mounted` (aviso): `frontend/src/cms/ui-config.json` existe, mas não foi passado para `<RebaseCMS>` como `uiConfig`. `cms-backend-guard-missing`: a configuração do Vite no frontend não utiliza `rebaseBackendGuard()`, o que faria o `rebase build` recusá-lo. Um projeto headless não possui `frontend/src/cms` e pula esta etapa. |
| Auditoria de RLS ao vivo (`live`) | Com `--live`: executa o catálogo [`rls-check`](/docs/rls-check) contra o banco de dados do projeto e valida se todas as migrações foram aplicadas. O banco de dados é resolvido da mesma forma que os comandos `db` resolvem — `--database-url`, `DATABASE_URL`, `--docker`, ou o banco de desenvolvimento gerenciado. Um banco de dados não configurado ou que não responde gera erro, e não pulo: a auditoria foi expressamente solicitada. Uma política de leitura `USING (true)` compilada de uma regra `access: "public"` gera um aviso enquanto a API exigir token (`AUTH_REQUIRE`, ativo por padrão) — qualquer usuário autenticado lê todas as linhas — e um erro com `AUTH_REQUIRE=false`, onde as linhas se tornam anônimas. |

`--json` imprime um único objeto, `{ ok, schemaDir, steps, findings, summary }`: cada etapa é `{ id, title, status, detail? }` (`status` pode ser `passed`, `failed`, `warnings` ou `skipped`), e cada apontamento traz `step`, `check` (um tipo estável em kebab-case), `severity`, `message` e, quando aplicável, `fix`, `table`, `file`, `line` e o `path` separado por pontos na tabela (`posts.rls[0]`) — permitindo que um agente repare o que quebrou. `summary` totaliza `errors` e `warnings`. `--quiet` não exibe nada quando tudo passa. Sai com código diferente de zero em caso de erro; avisos não causam falha.

Um projeto criado via scaffold executa essa verificação para o Claude Code após cada edição em `backend/schema/`: consulte [`rebase skills install`](#rebase-skills-install).

### `rebase auth`

Comandos de gerenciamento de autenticação:

```bash
rebase auth reset-password --email admin@example.com --password NewPassword123!
```

### `rebase api-keys`

Gerencia as chaves de API de serviço do projeto — a credencial utilizada por um agente, script ou outro serviço, em oposição à sessão de um usuário final:

```bash
rebase api-keys list
rebase api-keys get abc123-def456
rebase api-keys create --name "Blog CI" --scopes data:read:posts,data:write:posts --expires-in 90
rebase api-keys create --name "Ops" --full-access --roles admin --expires-at 2027-01-31
rebase api-keys revoke abc123-def456
```

`--scopes` especifica o que a chave pode fazer, separado por vírgulas ou repetido; `--full-access` concede todos os escopos que a chave de serviço possui, exceto `keys:*`. `--roles` adiciona roles de RLS além de `service`, `--expires-in` aceita dias e `--expires-at` uma data ISO. `rebase api-keys scopes` lista todos os escopos conhecidos pelo backend. Uma chave é exibida apenas uma vez. Tanto os escopos da chave quanto a segurança em nível de linha (RLS) da identidade que ela representa são aplicados. Consulte [Chaves de API](/docs/backend/api-keys/).

### `rebase storage`

Manutenção completa do armazenamento de arquivos salvos, por meio do backend em execução com `REBASE_SERVICE_KEY` do `.env`:

```bash
rebase storage orphans                         # files no row names
rebase storage orphans --source media --delete # and delete them, after asking
rebase storage move --from "(default)" --to media --prefix avatars
rebase storage move --from "(default)" --to media --prefix avatars --delete-source
```

`orphans` lê cada linha de cada tabela como armazenada (incluindo linhas excluídas via soft-delete, ultrapassando hooks `beforeQuery` e `afterRead`) e cada entrada de [histórico](/docs/backend/history/), já que uma reversão restaura o que ela continha. Ele lista os arquivos de uma fonte (`--source`, a fonte padrão se omitida) que nenhuma string em qualquer uma delas referencia: uma chave, uma URL, uma referência `rebase-storage:` em um texto. Arquivos com menos de `--older-than` horas (24 por padrão) são desconsiderados, pois o painel administrativo faz o upload de um arquivo antes que a linha que o referencia seja salva. A varredura roda no backend em segundo plano, portanto um projeto grande demais para varrer em uma única requisição (atrás de um ingress com timeout) ainda conclui a operação. A CLI a inicia e depois mostra seu progresso (arquivos listados, linhas lidas, tabelas concluídas e eventuais erros de leitura) até terminar. Com a [fila de jobs](/docs/backend/jobs/) ativa, a varredura é um job `storage.orphans` executado pelos workers. Sem ela, roda no processo do servidor solicitado, e a CLI informa isso: reiniciar esse processo interrompe a varredura. Uma varredura é uma tentativa de job, limitada por `jobs.timeoutMs` (15 minutos por padrão). Aumente esse limite ou defina-o como 0 para uma fonte mais demorada. `--json` imprime o relatório habitual acrescido do `scanId`.

`--delete` pede confirmação antes de excluir (`--yes` pula a pergunta, sendo obrigatório sem terminal). Ele deleta apenas arquivos do relatório acabado de imprimir e somente dentro de 15 minutos após a conclusão da varredura. Nada é excluído se uma tabela não puder ser lida: uma tabela com hooks de leitura em um banco cujo driver não possa ignorá-los é considerada não lida. Antes de deletar qualquer coisa, o servidor lê novamente cada linha e entrada de histórico contra os arquivos listados. Em seguida, consulta cada arquivo novamente antes da exclusão. Arquivos agora referenciados por alguma linha, reenviados após a varredura ou inexistentes são preservados, e a CLI os lista como mantidos. Arquivos referenciados apenas por tabelas que o Rebase não gerencia parecem não utilizados: verifique antes de deletar. Contra um backend da versão 0.25.1 ou anterior, a CLI faz a varredura à maneira antiga, dentro de uma única requisição.

`move` copia os arquivos sob `--prefix` para outra fonte mantendo as mesmas chaves, página por página. Arquivos que o destino já contenha com o mesmo tamanho são pulados, logo uma operação interrompida pode ser retomada executando-a novamente; `--delete-source` deleta cada arquivo da origem assim que o destino o contiver, sendo recusado caso as duas fontes usem o mesmo bucket ou diretório. Ao término, a CLI faz uma nova listagem da origem e informa cada arquivo que não foi movido: com `--delete-source`, qualquer arquivo ainda presente na origem; sem ela, qualquer arquivo cujo destino não contenha uma cópia de tamanho idêntico. O comando sai com código 1 caso haja algum, e executá-lo novamente prossegue com a migração. `--json` os imprime como `notMoved`. Ler relatórios de varredura requer `database:read`. Iniciar varreduras, deletar e mover requerem `database:write`, privilégio que a chave de serviço detém.

### `rebase skills install`

Instala as skills de referência do Rebase para seus assistentes de codificação de IA — todos os informados em `--agent` acima:

```bash
rebase skills install
rebase skills install --agent claude,cursor
rebase skills install --agent all
rebase skills --hooks
```

Consulte [Agent Skills](/docs/ai/skills) para obter a lista completa e os locais onde os arquivos são gravados.

`--hooks` instala a salvaguarda do Claude Code que o `rebase init` inclui em todos os projetos: `.claude/hooks/post-edit-collection.sh`, registrado como um hook `PostToolUse` em `.claude/settings.json`, que executa `rebase verify --quiet` após cada edição em `backend/schema/` ou `frontend/src/cms/` e repassa quaisquer problemas de volta ao agente. Configurações e hooks existentes são preservados. `rebase skills --hooks` instala exclusivamente o hook.

### `rebase telemetry`

Compartilhamento anônimo de uso, desativado até que você concorde. Um `rebase init` interativo pergunta ao final, com resposta padrão "não", de forma que nada é compartilhado a menos que você responda afirmativamente. A resposta é definida por máquina (`~/.rebase/telemetry.json`): após um "sim", o `init` nunca mais pergunta, e após um "não", o próximo `init` pergunta novamente. Cada repositório recebe um identificador aleatório mantido em `.rebase/telemetry-project.json` (ignorado pelo git).

```bash
rebase telemetry status
rebase telemetry show
rebase telemetry enable
rebase telemetry disable
```

`status` imprime a configuração atual, `show` imprime exatamente o que seria enviado — quer o compartilhamento esteja ativo ou não, permitindo inspecionar o payload antes de decidir — e os outros dois alteram a definição. Se você nunca rodou o `init`, nada jamais foi coletado.

## Próximos Passos

- **[Geração de Schemas](/docs/cli/schema/#production-workflow)** — O fluxo de trabalho de migrações, desde a edição de uma tabela até a produção
- **[Schema as Code](/docs/architecture/schema-as-code)** — Como funciona a geração de schemas
- **[Início Rápido](/docs/getting-started/quickstart)** — Dê os primeiros passos
