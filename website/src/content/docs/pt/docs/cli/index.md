---
sourceHash: 0dca906999fefc66
title: Referência da CLI
sidebar_label: CLI
description: Comandos da CLI do Rebase para inicialização de projetos, geração de schemas, migrações de banco de dados e geração de SDKs.
---

## Visão geral

A CLI do Rebase (`rebase`) gerencia seu projeto desde o scaffolding até o deploy.

## Instalação

```bash
pnpm add -g @rebasepro/cli
```

Ou execute qualquer comando sem instalá-lo: `pnpm dlx @rebasepro/cli <command>`.

## Saída legível por máquina

`--json` é a flag, e fora da família `cloud` ela é a única: `rebase status`, `rebase resources`, `rebase apps list`, `rebase upgrade` e `rebase verify` colocam então um valor JSON no stdout — o resultado, ou um envelope `{"error": {"message", "code", "hint", "issues"}}` com código de saída diferente de zero — em **toda** finalização do comando, para que o chamador possa analisar o stdout incondicionalmente. Sem ela, eles escrevem texto legível para humanos e as falhas vão para o stderr. O `rebase cloud` usa o mesmo envelope e é a única exceção à flag: ele também ativa o JSON automaticamente quando o stdout não for um TTY, ou quando `REBASE_JSON=1` estiver definido. Portanto, `rebase cloud status | cat` é JSON, enquanto `rebase status | cat` não é — em um script, passe `--json` explicitamente em vez de depender de qualquer uma das regras.

## Comandos

### `rebase init`

Inicializa um novo projeto Rebase:

```bash
rebase init [directory]
```

Configura um `backend/` (as tabelas em `backend/schema/`) e um `frontend/` (o painel de administração, com suas customizações de tabela em `frontend/src/cms/`); `--headless` gera o scaffold apenas do `backend/`, sem `backend/schema/`. A [Estrutura do projeto](/docs/getting-started/project-structure/) mostra ambas as árvores.

| Flag | O que faz |
|---|---|
| `-t, --template <preset>` | `blog`, `ecommerce` ou `blank`. Padrão: `blog` |
| `--headless` | Apenas backend — sem painel de administração e sem `backend/schema/`: o servidor expõe as próprias tabelas do banco de dados. `--template` não tem efeito, pois não há tabelas para popular |
| `-y, --yes` | Nunca solicitar confirmação. **Obrigatório sempre que não houver um terminal para responder**, como no CI. Ignora o git init e a instalação de dependências — os padrões interativos dizem "sim" para ambos, portanto passe `--git` / `--install` caso os deseje |
| `-i, --install` | Instalar dependências após o scaffolding. Sem ela, o init pergunta (padrão: sim); sob `--yes`, nada é instalado |
| `--no-install` | Não instalar nada e não perguntar |
| `-g, --git` | Inicializar um repositório e fazer o primeiro commit. Sem ela, o init pergunta (padrão: sim); sob `--yes`, nenhum repositório é criado |
| `--database-url <url>` | Usar um banco de dados existente em vez do gerenciado. Deve ser uma URL `postgres://` ou `postgresql://`: qualquer outra coisa é recusada antes que um arquivo seja gravado, e o prompt interativo pergunta novamente |
| `--introspect` | Gerar `backend/schema` a partir desse banco de dados. Implica `--template blank` e requer `--install` |
| `--project <slug>` | Vincular o scaffold a um projeto do Rebase Cloud |
| `--setup-key <key>` | A chave de uso único que autentica esse vínculo |
| `-a, --agent <name>` | Configurar agentes de codificação de IA: as [skills](/docs/ai/skills) e o [servidor MCP](/docs/ai/mcp). Repetível ou separado por vírgula — `claude`, `cursor`, `windsurf`, `gemini`, `codex`, `kiro`, `copilot` ou `all`. Sem ela, o `init` pergunta e pré-seleciona os agentes instalados na máquina; sob `--yes`, nenhum |

### `rebase dev`

Inicia o servidor de desenvolvimento:

```bash
rebase dev
```

Inicia tanto o frontend quanto o backend com hot reloading e regenera o schema do Drizzle e os tipos do SDK (`generated/sdk/`) na inicialização e a cada salvamento em `backend/schema/`.

Ambas as portas são derivadas do caminho do projeto para que vários projetos Rebase possam ser executados lado a lado. Use as URLs exibidas por `rebase dev`. Fixe uma com `rebase dev --port 3001`.

Um app estático em `rebase.json` sem etapa de build (sem `build`, e `output` sendo sua `root`, como um site em HTML puro) é servido pelo backend a partir desse diretório, em seu `path`, assim como `rebase start` o serve a partir do bundle, e `FRONTEND_URL` é definido para ele (na porta do backend) para que links enviados por e-mail levem até lá. Um app com build é executado no Vite em sua própria porta, e `FRONTEND_URL` é o do Vite.

Uma edição no `.env` reinicia o backend, que lê o arquivo novamente, assim como o painel de administração faz. O que o próprio `rebase dev` define é mantido até que você o reinicie: `PORT`, e `DATABASE_URL` quando estiver no banco de dados gerenciado ou no Docker.

Com `--database-url`, o `rebase dev` verifica primeiro se algo responde naquele host e porta. Se nada responder, ele informa isso, citando a flag, e encerra com código `1` sem iniciar nada; ele também não altera as variáveis do banco de dados no `.env`, nunca iniciando seu container do compose.

### `rebase build`

Compila o projeto em um bundle pronto para deploy em `dist-bundle/`:

```bash
rebase build
```

O bundle é o artefato que você publica — a imagem de runtime o carrega, de modo que não há necessidade de compilar uma imagem da aplicação por conta própria. Flags úteis:

| Flag | Efeito |
|------|--------|
| `--output <dir>` (ou `--out`) | Gravar o bundle em outro local que não `dist-bundle/` (um app por vez) |
| `--vendor` | Sempre instalar e incluir as dependências do bundle |
| `--no-vendor` | Nunca fazer vendor; o pod as instala a cada inicialização |
| `--skip-type-check` | Pular a verificação de tipos (mais rápido, menos seguro) |
| `--no-static` | Não embutir o frontend no bundle do backend (cada app estático ainda recebe seu próprio bundle) |
| `--skip-static-build` | Embutir o frontend conforme já compilado, sem executar seu comando de build |

Um frontend — cada app estático de `rebase.json` com uma configuração do Vite — cuja configuração não use `rebaseBackendGuard()` (de `@rebasepro/app/vitePlugin`) é recusado: é isso que mantém o código do servidor fora do bundle do navegador e impede o Vite de embutir um arquivo do backend como uma URL `data:` (ele falha o build, identificando a si mesmo, quando outro plugin substitui seu `build.assetsInlineLimit`). O `frontend/src/cms/ui-config.json` é transportado para o bundle como `entry.uiConfig`, a apresentação do workspace que um backend em produção serve.

As dependências são vendored por padrão para que uma nova instância não precise arcar com uma instalação de 35 a 55 segundos. Uma árvore que ultrapasse 2 GB em disco é descartada, pois o limite de upload é de 1 GB comprimido.

Cada app estático transportado pelo bundle recebe uma cópia em brotli (`.br`) e gzip (`.gz`) ao lado de cada asset com hash de conteúdo de 1 KB ou mais — os arquivos que o navegador armazena em cache por um ano. O runtime envia aquele que o navegador aceitar, portanto esses arquivos não custam trabalho de compressão por requisição, incluindo a primeira visita após um deploy, e navegadores que aceitam brotli o recebem (cerca de 11% menor que gzip no JavaScript do painel administrativo). A saída de build do seu próprio frontend permanece como estava; apenas a cópia no bundle é alterada. No app de exemplo, isso adiciona menos de um segundo ao build e cerca de 2,4 MB ao bundle.

### `rebase upgrade`

Atualiza todos os pacotes `@rebasepro/*` fixados pelo projeto para uma única versão e, em seguida, instala com o gerenciador de pacotes indicado pelo lockfile. O `rebase upgrade` pega a mais recente (`latest`); `--to 0.21.0` define uma versão exata, sem consulta ao registro; `--to canary` define uma dist-tag. Cada versão fixada em `dependencies`, `devDependencies` e `optionalDependencies`, em cada `package.json` do projeto, mantém seu `^` ou `~`, e nada mais no arquivo é alterado. `peerDependencies` e especificações `workspace:`, `link:`, `file:`, git e tags são listadas e mantidas intactas. Substituições (overrides) em `pnpm-workspace.yaml` e `package.json` também são atualizadas, mas uma substituição `link:` ou `file:` tem precedência sobre qualquer versão fixada: ela é reportada, e `--drop-local-overrides` a remove. `--dry-run` não grava nada, `--no-install` pula a instalação e `--json` exibe um documento único.

Um projeto em uma versão de pré-lançamento (prerelease), como uma canary, permanece em seu canal a menos que `latest` seja mais recente. Uma dist-tag que moveria uma versão fixada para trás é recusada (`downgrade_refused` sob `--json`), a menos que você passe `--allow-downgrade`; um `--to` exato é aplicado e marcado como downgrade. Um `--dry-run` de uma atualização que a execução real recusaria mostra o que mudaria e encerra com código 0; sob `--json`, seu documento traz a recusa como `wouldRefuse` (`{ code, message, hint }`).

#### Atualizar um projeto PostgreSQL para o Rebase 0.35

Execute a CLI do Rebase 0.35 na raiz do projeto no Linux, macOS ou Windows. Ela
substitui `@ariga/atlas` por `@stokaro/ptah-compat` no backend PostgreSQL. Os
arquivos de migração, o `atlas.sum` e as revisões registradas são preservados.

```bash
pnpm dlx @rebasepro/cli@0.35.0 upgrade --to 0.35.0 # version-pin: ignore
```

### `rebase start`

Executa o bundle compilado da mesma forma que um deploy o executa:

```bash
rebase start
```

Lê o `PORT` e o restante do `.env`, diferentemente de `rebase dev`, no `NODE_ENV` definido por eles. Um `.env` gerado no scaffold define `development`, portanto a primeira conta a se registrar ainda se torna o administrador, e o `rebase start` informa isso no topo; defina `NODE_ENV=production` para um servidor de produção. `rebase start --bundle ./dist-bundle` executa um bundle em outro local.

O `rebase start` não inicia nenhum banco de dados, e o `.env` do scaffold não tem `DATABASE_URL`, então uma execução local no banco de dados usado pelo `rebase dev` é feita com `DATABASE_URL="$(rebase db url)" rebase start`. Sem isso, ele exibe essa linha antes da inicialização.

### `rebase apps list`

Mostra os apps que este repositório declara:

```bash
rebase apps list
```

Um repositório pode declarar mais de um app publicável — um backend e um site de marketing, por exemplo. É assim que você vê sobre o que o `rebase build` e o deploy agirão.

### `rebase eject`

Assume o controle do processo do servidor e de sua imagem:

```bash
rebase eject
```

Grava o ponto de entrada do backend e um `Dockerfile` no projeto e transfere o backend, para que o repositório construa sua própria imagem em vez de executar o runtime publicado. A partir de então, **as atualizações do runtime da plataforma não o alcançarão mais**, e o CORS, a integração de autenticação, o armazenamento e o encerramento passam a ser de sua responsabilidade de configuração.

Visualize isso previamente com `rebase eject --dry-run`, que lista o que mudaria sem alterar nada. `--force` substitui um `backend/src/index.ts` ou `env.ts` existente, mantendo o arquivo atual como `<name>.bak`.

O servidor ejetado mantém os uploads locais em `uploads/` do projeto, executado a partir do código-fonte ou compilado, assim como o `rebase dev` faz. Ele é executado em `backend/`, portanto um `STORAGE_PATH` relativo é lido a partir de `backend/`.

### `rebase schema generate` / `rebase schema stale`

```bash
rebase schema generate       # backend/schema → backend/src/schema.generated.ts
rebase schema stale          # lista o que difere das tabelas, encerra com 1 se houver diferenças
rebase schema stale --fix    # regenera o arquivo
```

Todos os comandos que leem o schema aceitam `--schema-dir <dir>` para projetos que o mantêm em outro local; `--collections` foi removido. O `rebase dev` mantém o arquivo atualizado, portanto `stale` é a verificação ideal para um build ou CI. Consulte [Geração de Schema](/docs/cli/schema/).

### `rebase db`

```bash
rebase db push                 # aplica as tabelas ao banco de dados (desenvolvimento)
rebase db generate             # gera um arquivo de migração SQL
rebase db migrate              # aplica as migrações pendentes
rebase db url                  # exibe a string de conexão usada por este projeto
rebase db pull --from <url>    # copia outro banco de dados para o local
rebase db backup               # pg_dump; db backups list e db restore disponíveis
rebase db branch create <name> # uma cópia para trabalhar; switch, list e prune disponíveis
rebase db stop                 # interrompe o banco de dados de desenvolvimento gerenciado
rebase db reset                # apaga o banco de dados e recomeça do zero
rebase db request-role migrate --to <role> # transfere as requisições para outra role do Postgres
rebase db provision --print    # o SQL que configura a request role, para um DBA
```

Cada um deles é abordado em [Comandos de Banco de Dados](/docs/cli/database/), incluindo a ordem em que um comando escolhe seu banco de dados; `push`, `generate` e `migrate` são detalhados em [Geração de Schema](/docs/cli/schema/).

### `rebase console`

Um REPL do Node com os dados do projeto abertos, ou um snippet executado com `-e`:

```bash
rebase console
rebase console -e "rebase.dataAsAdmin.posts.find({ limit: 5 })"
```

`rebase` (`dataAsAdmin`, `sql`, `withAuth(user)`) e `tables` (as tabelas do projeto, carregadas a partir de `backend/schema`) estão no escopo, e `await` de nível superior funciona. O banco de dados é resolvido da mesma forma que em `rebase db push`, e abri-lo não altera nada nele. Com `-e`, o resultado aguardado é impresso como JSON no stdout e um erro lançado encerra com `1`. Flags: `--eval`/`-e`, `--schema-dir`, `--database-url`, `--docker`. Consulte [Scripts e o Console](/docs/backend/scripts/).

### `rebase migrate`

Migrações unidirecionais a partir de uma estrutura que esta versão não suporta mais: `rebase migrate collections-to-tables` (`config/collections` → `backend/schema` e `frontend/src/cms`) e `rebase migrate sdk-calls` (`data.collection("x")` → `data.table("x")` no seu próprio código). Suas flags, o que gravam e a seção "Revise antes de fazer deploy" estão em [Geração de Schema](/docs/cli/schema/#rebase-migrate).

### `rebase apps init` / `rebase apps config`

```bash
rebase apps list             # os apps que este projeto declara
rebase apps init             # grava um rebase.json inferido a partir deste projeto
rebase apps config <app>     # a configuração de cliente para um app
```

`apps init` não recebe nenhum nome: ele infere todos os apps a partir do projeto e grava todo o `rebase.json`, recusando-se a substituir um existente a menos que você passe `--force`.

Um argumento de nome é recusado. `--force` mantém o que a inferência não consegue descobrir a partir do arquivo substituído: o nome de cada app, seu `path` e sua rota `cms`. Todo o restante é inferido novamente, e um app declarado que não for mais encontrado é indicado como removido, de modo que em um scaffold ele regrava o `rebase.json` original do scaffold. O comando de build do app estático utiliza o gerenciador de pacotes do projeto.

Para um repositório clonado não vinculado a um projeto Cloud, `apps config` informa que ele não está vinculado, independentemente de o `rebase dev` estar em execução ou não, e fornece a URL do backend conforme servida pelo `rebase dev`.

### `rebase status`

Tudo o que este projeto declara e se o ambiente realmente faz o binding:

```bash
rebase status               # todos os recursos e as variáveis que eles leem
rebase status --json        # legível por máquina
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

Três arquivos determinam o que um backend pode acessar, e este comando exibe os três juntos: `rebase.json` define onde seu código está e quem executa o servidor, `backend/resources.ts` define o que o projeto precisa e o ambiente define como alcançar cada item. Todo o resto — `rebase.resources.json`, o manifesto do bundle — é gerado a partir do intermediário para leitores que não conseguem executar seu código, e você nunca o edita manualmente.

Um `○` é o estado que convém conhecer antes de um deploy e não depois: declarado, não configurado. Um `✗` significa que o ambiente configurou algo de forma *incorreta*, o que recusa a inicialização em vez de degradar suavemente.

Um `rebase.resources.json` que não coincida mais com as declarações recebe uma linha com `○`. Um que ainda não foi gerado não recebe: `rebase build` o grava a cada build, portanto um projeto que nunca foi compilado, como um scaffold novo, não tem nada a corrigir.

### `rebase resources`

O que este projeto declara precisar — bancos de dados, buckets, tópicos e filas solicitados por `backend/resources.ts`, bem como os crons e funções definidos por seus arquivos:

```bash
rebase resources            # lista-os
rebase resources --write    # regenera o rebase.resources.json
rebase resources --check    # falha se o grafo versionado estiver desatualizado
rebase resources --json     # legível por máquina
```

`rebase resources --check` é a flag que um job de CI usa para falhar caso o `rebase.resources.json` não coincida mais com o `backend/resources.ts`. `--json` pode ser combinado com ela: em caso de divergência, `rebase resources --check --json` encerra com código 1 e um envelope de erro (`resource_graph_missing` ou `resource_graph_stale`), e em caso de sucesso o grafo traz `check.status`. `--write --json` grava o arquivo e reporta `written.changed`.

Um recurso é declarado em `backend/resources.ts` — `database("analytics")`, `bucket("media")`, `topic("signups")`, `queue("thumbnails")` — ou é um arquivo em `backend/crons` ou `backend/functions`, e nunca deve ser escrito manualmente em `rebase.resources.json`, que é gerado a partir dessas declarações para que um host possa ler o que um projeto precisa sem compilá-lo. Cada entrada registra quem a utiliza (`table:events`, `column:posts.cover`, `function:report`).

Um backend também possui um banco de dados padrão e uma fonte de armazenamento padrão que ninguém declara. Ambos são listados aqui, marcados como `implicit`, e nenhum dos dois é gravado no `rebase.resources.json` — o host os fornece, portanto registrá-los solicitaria o provisionamento de algo que ninguém pediu. Declarar um recurso nomeado, como `bucket("media")`, mantém o padrão onde está, de modo que ambos são listados. Apenas declarar o próprio padrão ou marcar um bucket como `default: true` o substitui.

Para ver o que a plataforma mantém para um projeto em comparação com o que seu código declara, e para remover um banco de dados provisionado que o código não menciona mais, consulte [`rebase cloud resources`](/docs/cli/cloud#resources).

`rebase cloud` — todos os comandos para o Rebase Cloud: autenticação, vínculo de projeto, deploys, configuração, bancos de dados, recursos, computação e mais — possui [sua própria página](/docs/cli/cloud).

### `rebase generate-sdk`

```bash
rebase generate-sdk
```

Grava um cliente tipado para as tabelas exportadas por `backend/schema/index.ts` em `generated/sdk/`, com `TableName` e `tablesDictionary`; `--from <link|url>` lê o contrato de um backend em execução. `--register` também tipa dados do lado do servidor: ele grava os tipos e a declaração `Register` em `backend/generated/` e registra isso em `rebase.json` (`registerDatabase`). Consulte [Dados tipados no servidor](/docs/backend/typed-server-data) e [Geração de Schema](/docs/cli/schema/#rebase-generate-sdk).

### `rebase doctor`

```bash
rebase doctor
```

O comando para executar quando algo estiver errado e você ainda não souber o quê. Ele apenas relata e nunca altera nada, portanto é seguro contra qualquer banco de dados que você consiga alcançar.

**Sem um banco de dados.** Estas verificações são executadas primeiro, porque tudo o que impede um projeto de funcionar ocorre antes mesmo que uma tabela possa ser comparada:

| Verificação | Motivo |
| --- | --- |
| Versão do Node | Comparada com o intervalo declarado pela CLI. Uma versão muito antiga não é reportada como "Node não suportado" — ela se manifesta como erro de sintaxe dentro de uma dependência. |
| Gerenciadores de pacotes | Dois lockfiles em um mesmo projeto. Executar `npm install` em um workspace pnpm reescreve `node_modules` em uma estrutura com a qual o pnpm não concorda, e o sintoma é `Cannot find module` horas depois. |
| Slugs duplicados | Duas tabelas declarando o mesmo slug. O schema se recusa a compilar com isso, e esta verificação aponta ambas. |
| Sanidade do `.env` | Um `JWT_SECRET` com menos de 32 caracteres (o que impede a inicialização em produção) e `NODE_ENV=production` sem `CORS_ORIGINS` nem `FRONTEND_URL`. Os valores nunca são exibidos. |
| Divergência de versão de `@rebasepro/*` | O mesmo pacote fixado em versões diferentes entre os arquivos `package.json` do projeto. Duas cópias quebram o `instanceof` entre elas, falhando como um type guard que rejeita seu próprio tipo. |
| Strings de conexão | Um `=` não codificado em um parâmetro de URL, que as ferramentas do próprio PostgreSQL se recusam a interpretar — fazendo com que backups e `psql` quebrem enquanto a aplicação continua funcionando. |
| Funções customizadas | O que cada função requer de seu host e quais delas não rodariam em um runtime edge. |

**Contra o banco de dados** — o do próprio projeto, resolvido da forma como `rebase db url` o resolve, de modo que em um scaffold novo é o banco de dados gerenciado, que o `doctor` inicializa:

| Verificação | Motivo |
| --- | --- |
| Tabelas → schema gerado | Se o `schema.generated.ts` está desatualizado. |
| Tabelas → banco de dados | Tabelas, colunas, enums, chaves estrangeiras e tabelas de junção ausentes. |
| Extensões necessárias | Uma coluna `col.vector()` necessita do pgvector, que o Rebase instala somente onde o projeto declarou. |
| Carimbo do schema (Schema stamp) | Se este banco de dados foi provisionado a partir destas tabelas. Um hash, para que possa informar se os dois discordam, mas nunca qual está à frente. Um carimbo `v1:` de um runtime anterior ao 0.31 é reportado uma vez, com a instrução de atualização: `rebase db push`. |
| Tabelas → tipos do SDK | Se o SDK tipado gerado está desatualizado. |
| Políticas de RLS | Se as políticas do banco de dados coincidem com o `rls` declarado e se alguma política menciona uma role que este servidor não pode usar. |

Se o banco de dados estiver inacessível, suas fases serão reportadas como ignoradas com o motivo, e o restante continuará sendo executado — consulte [Solução de problemas](/docs/troubleshooting/).

Encerra com código diferente de zero quando uma verificação encontra um erro, ou quando uma fase não pôde ser executada porque o banco de dados fornecido recusa conexões. Uma fase ignorada porque nenhum banco de dados pôde ser resolvido não é considerada falha.

`rebase doctor --policies` executa apenas as verificações de RLS — sem diff de schema, sem tipos do SDK — e falha preventivamente (fails closed), o que o torna a opção ideal como barreira de validação no CI contra um banco de dados em produção.

`rebase doctor --database` executa apenas a pré-verificação do banco de dados: se a role sob a qual as requisições autenticadas rodam existe, se é restrita e pode ser assumida, quais outros logins podem alternar para ela, se todas as roles podem se conectar e quais tabelas, permissões (grants) e políticas o Rebase compartilharia com outras roles. Cada apontamento indica o SQL a ser executado como administrador, a configuração de `rls` que adapta o Rebase ao banco de dados, ou ambos. Ele lê o catálogo e não altera nada, encerrando com código 1 se encontrar uma falha. Funciona também em projetos headless. Consulte [Execução em um banco de dados existente ou compartilhado](/docs/deployment/existing-database/).

### `rebase verify`

```bash
rebase verify
rebase verify --json
rebase verify --live
rebase verify --live --database-url postgresql://…
```

Verifica se as tabelas estão prontas para produção em um único comando rápido para CI e hooks de agentes de IA. Funciona offline por padrão e nunca altera nada.

| Etapa | O que a faz falhar |
| --- | --- |
| Definições de tabelas (`schema`) | `backend/schema` não carrega ou não compila através do carregador com o qual o backend inicializa: uma relação com uma tabela que o index não exporta, `rls: "inherit"` sem `defaultRls`, uma tabela sem chave primária — um apontamento por problema. Uma tabela sem `rls` é um deles. |
| Cobertura de RLS (`rls`) | Uma tabela com uma coluna `user_id`, `owner_id`, `organization_id` ou `tenant_id` cujas regras — próprias ou o `defaultRls` herdado — permitam que uma role leia todas as linhas independentemente disso. Um aviso. `rls-policy-recursion`: uma regra que lê sua própria tabela em uma subconsulta, ou duas tabelas cujas regras leem uma à outra, o que o Postgres se recusa a expandir, fazendo com que qualquer declaração protegida falhe com `42P17 infinite recursion detected in policy`; o apontamento indica a tabela que ela lê e a correção: mover a leitura para uma função `SECURITY DEFINER`. Um erro, ou um aviso quando o loop não for garantido. |
| Atualização das migrações (`migrations`) | Uma tabela ou coluna declarada pelas tabelas que nenhum arquivo em `backend/drizzle/migrations` cria, ou uma removida que uma migração ainda cria. Ignorado para projetos que ainda não possuem migrações. |
| Customizações do CMS (`cms`) | Um `customizeTable(...)` em `frontend/src/cms` (ou no `src/cms` de um app estático em `rebase.json`) que não corresponde às tabelas, lido estaticamente — os módulos não são executados. `cms-unknown-table`: o slug não indica nenhuma tabela, portanto o painel o ignora (o slug mais próximo é sugerido). `cms-unknown-field`: uma chave sob `fields` não é nem coluna nem relação (o nome SQL de uma coluna é retornado com sua chave). `cms-hidden-required`: um campo ocultado no formulário (`hiddenInForm`, `readOnly`, `disabled`) cuja coluna é `NOT NULL` sem valor padrão e sem nada que o servidor preencha, de modo que criar um registro pelo painel sempre falha; um aviso caso um hook `beforeSave` ou transform possa preenchê-lo, silenciado por `filledByServer`. `cms-duplicate-customization`: um slug customizado duas vezes. `cms-not-static` (aviso): uma chamada cujo slug, opções ou `fields` não sejam literais ou uma `const` no mesmo arquivo, portanto nada nela foi verificado. `cms-ui-config-not-mounted` (aviso): `frontend/src/cms/ui-config.json` existe, mas `<RebaseCMS>` não o recebe como `uiConfig`. `cms-backend-guard-missing`: a configuração do Vite do frontend não usa `rebaseBackendGuard()`, portanto `rebase build` a recusaria. Um projeto headless não possui `frontend/src/cms` e pula esta etapa. |
| Auditoria de RLS ao vivo (`live`) | Com `--live`: o catálogo do [`rls-check`](/docs/rls-check) contra o banco de dados do projeto e se todas as migrações foram aplicadas. O banco de dados é resolvido da mesma forma que os comandos `db` resolvem — `--database-url`, `DATABASE_URL`, `--docker`, ou o banco de dados gerenciado de desenvolvimento. Um banco de dados não configurado ou que não responde gera erro, não uma etapa ignorada: a auditoria foi solicitada explicitamente. Uma política de leitura `USING (true)` compilada a partir de uma regra `access: "public"` gera um aviso enquanto a API exigir token (`AUTH_REQUIRE`, ativo por padrão) — todo usuário autenticado lê todas as linhas — e gera erro com `AUTH_REQUIRE=false`, onde as linhas são anônimas. |

`--json` exibe um único objeto, `{ ok, schemaDir, steps, findings, summary }`: cada etapa é `{ id, title, status, detail? }` (`status` pode ser `passed`, `failed`, `warnings` ou `skipped`), e cada finding traz `step`, `check` (um tipo estável em kebab-case), `severity`, `message` e, quando aplicável, `fix`, `table`, `file`, `line` e o caminho pontuado (`path`) dentro da tabela (`posts.rls[0]`) — permitindo que um agente repare o que quebrou. `summary` conta `errors` e `warnings`. `--quiet` não exibe nada quando tudo passa. Encerra com código diferente de zero em caso de erro; avisos não causam falha.

Um projeto criado via scaffold executa essa verificação para o Claude Code após cada edição em `backend/schema/`: consulte [`rebase skills install`](#rebase-skills-install).

### Comandos para um app em execução

`rebase api`, `rebase data`, `rebase users`, `rebase cron`, `rebase logs`, `rebase functions`, `rebase rls simulate`, `rebase auth login` e `rebase storage ls|cp|rm|url|stat` atuam em um app em execução através de sua API: o `rebase dev` local, um servidor especificado via `--url` ou um projeto do Rebase Cloud com `--project`. Consulte [Um app em execução](/docs/cli/project/).

### `rebase auth`

Comandos para gerenciamento de autenticação:

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

`--scopes` define o que a chave pode fazer, separado por vírgula ou repetido; `--full-access` concede todos os escopos que a chave de serviço possui, exceto `keys:*`. `--roles` adiciona roles de RLS além de `service`, `--expires-in` aceita dias e `--expires-at` aceita uma data ISO. `rebase api-keys scopes` lista todos os escopos conhecidos pelo backend. Uma chave é exibida apenas uma vez. Tanto os escopos da chave quanto a segurança em nível de linha (RLS) da identidade que ela representa são aplicados. Consulte [Chaves de API](/docs/backend/api-keys/).

### `rebase storage`

Manutenção completa do storage de arquivos armazenados, através do backend em execução com `REBASE_SERVICE_KEY` do `.env`:

```bash
rebase storage orphans                         # arquivos que nenhuma linha referencia
rebase storage orphans --source media --delete # e apaga-os, após confirmação
rebase storage move --from "(default)" --to media --prefix avatars
rebase storage move --from "(default)" --to media --prefix avatars --delete-source
```

`orphans` lê cada linha de cada tabela conforme armazenada (incluindo linhas marcadas com soft-delete, ignorando hooks `beforeQuery` e `afterRead`) e cada entrada de [histórico](/docs/backend/history/), já que uma reversão restaura o que ela continha. Ele lista os arquivos de uma fonte (`--source`, a fonte padrão se omitida) que nenhuma string entre elas referencia: uma chave, uma URL, uma referência `rebase-storage:` em um texto. Arquivos mais recentes que `--older-than` horas (24 por padrão) são desconsiderados, porque o painel de administração faz upload de um arquivo antes que a linha que o referencia seja salva. A varredura é executada no backend em segundo plano, de modo que um projeto grande demais para ser varrido em uma única requisição (atrás de um ingress com timeout) ainda assim seja concluído. A CLI a inicia e mostra o progresso (arquivos listados, linhas lidas, tabelas concluídas e eventuais tabelas que não puderam ser lidas) até o término. Com a [fila de jobs](/docs/backend/jobs/) ativa, a varredura se torna um job `storage.orphans` processado pelos workers. Sem ela, a varredura é executada dentro do processo do servidor solicitado, e a CLI informa isso: reiniciar esse processo interrompe a varredura. Uma varredura corresponde a uma tentativa de job, limitada por `jobs.timeoutMs` (15 minutos por padrão). Aumente esse valor ou defina-o como 0 para fontes mais lentas. `--json` exibe o mesmo relatório de antes, além do `scanId`.

`--delete` solicita confirmação antes de excluir (`--yes` pula a pergunta e é obrigatório sem um terminal). Ele exclui apenas a partir da varredura que acabou de ser exibida e somente dentro de 15 minutos após a conclusão dessa varredura. Nada é excluído enquanto uma tabela não puder ser lida: uma tabela com hooks de leitura em um banco de dados cujo driver não consiga ignorá-los conta como não lida. Antes de excluir qualquer coisa, o servidor lê novamente cada linha e entrada de histórico contra os arquivos listados. Em seguida, solicita cada arquivo novamente imediatamente antes de excluí-lo. Um arquivo que uma linha passe a referenciar agora, que tenha sido reenviado desde a varredura, ou que já não exista mais é mantido, e a CLI o lista como mantido. Arquivos referenciados apenas por tabelas que o Rebase não gerencia parecerão não utilizados: verifique antes de excluir. Em relação a um backend na versão 0.25.1 ou anterior, a CLI faz a varredura pelo método antigo, em uma única requisição.

`move` copia os arquivos sob `--prefix` para outra fonte mantendo as mesmas chaves, uma página por vez. Um arquivo que o destino já contenha com o mesmo tamanho é ignorado, de modo que uma migração interrompida pode ser retomada executando-a novamente; `--delete-source` exclui cada arquivo da origem assim que o destino passar a contê-lo, sendo recusado quando ambas as fontes usarem o mesmo bucket ou diretório. Quando o processo termina, a CLI lista a origem novamente com uma nova varredura e aponta todos os arquivos que a migração não moveu: com `--delete-source`, qualquer arquivo ainda presente na origem; sem ela, qualquer arquivo de cujo destino não possua uma cópia com o mesmo tamanho. Ela encerra com código 1 se houver algum, e executar a mesma migração novamente tentará processá-lo. `--json` os exibe como `notMoved`. A leitura do relatório de uma varredura requer `database:read`. Iniciar uma varredura, excluir e mover requerem `database:write`, que a service key possui.

### `rebase skills install`

Instala as skills de referência do Rebase para seus assistentes de codificação de IA — todos os `--agent` listados acima:

```bash
rebase skills install
rebase skills install --agent claude,cursor
rebase skills install --agent all
rebase skills --hooks
```

Consulte [Agent Skills](/docs/ai/skills) para a lista completa e onde os arquivos são gravados.

`--hooks` instala a proteção do Claude Code que o `rebase init` inclui em todo projeto: `.claude/hooks/post-edit-collection.sh`, registrado como um hook `PostToolUse` em `.claude/settings.json`, que executa `rebase verify --quiet` após cada edição em `backend/schema/` ou `frontend/src/cms/` e devolve qualquer problema encontrado para o agente. Configurações e hooks existentes são preservados. `rebase skills --hooks` instala apenas o hook isoladamente.

### `rebase telemetry`

Compartilhamento anônimo de dados de uso, desativado até que você consinta. Uma execução interativa de `rebase init` pergunta ao final, e o prompt tem como padrão "não", de modo que nada é compartilhado a menos que você responda afirmativamente. A resposta é gravada por máquina (`~/.rebase/telemetry.json`): após um sim, o `init` nunca mais pergunta; após um não, o próximo `init` perguntará novamente. Cada checkout recebe um ID de projeto aleatório, armazenado no arquivo ignorado pelo git `.rebase/telemetry-project.json`.

```bash
rebase telemetry status
rebase telemetry show
rebase telemetry enable
rebase telemetry disable
```

`status` exibe a configuração atual, `show` exibe exatamente o que seria enviado — esteja o compartilhamento ativo ou não, permitindo que você veja a carga de dados antes de decidir — e os outros dois alteram a configuração. Se você nunca executou `init`, nada jamais foi coletado.

## Próximos passos

- **[Geração de Schema](/docs/cli/schema/#production-workflow)** — O fluxo de trabalho de migrações, desde a edição de uma tabela até a produção
- **[Schema as Code](/docs/architecture/schema-as-code)** — Como funciona a geração de schemas
- **[Início rápido](/docs/getting-started/quickstart)** — Comece a usar
