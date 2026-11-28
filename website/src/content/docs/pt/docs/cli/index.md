---
sourceHash: 38a7979a6ca8b028
title: Referência da CLI
sidebar_label: CLI
description: Comandos da CLI do Rebase para inicialização de projetos, geração de esquemas, migrações de banco de dados e geração de SDK.
---

## Visão Geral

A CLI do Rebase (`rebase`) gerencia seu projeto desde o scaffolding até o deploy.

## Instalação

```bash
pnpm add -g @rebasepro/cli
```

Ou execute qualquer comando sem instalá-lo: `pnpm dlx @rebasepro/cli <command>`.

## Saída legível por máquina

O parâmetro `--json` é o modificador e, fora da família `cloud`, é o único: `rebase status`, `rebase resources`, `rebase apps list`, `rebase upgrade` e `rebase verify` colocam então um único valor JSON na saída padrão (stdout) — o resultado, ou um envelope `{"error": {"message", "code", "hint", "issues"}}` com um código de saída diferente de zero — em **cada** encerramento do comando, para que o chamador possa analisar o stdout incondicionalmente. Sem ele, eles escrevem texto legível para humanos e as falhas vão para stderr. O `rebase cloud` usa o mesmo envelope e é a única exceção ao modificador: ele também ativa o JSON automaticamente quando o stdout não for um TTY, ou quando `REBASE_JSON=1` estiver definido. Portanto, `rebase cloud status | cat` produz JSON enquanto `rebase status | cat` não — em um script, passe `--json` explicitamente em vez de depender de qualquer uma das regras.

## Comandos

### `rebase init`

Inicializa um novo projeto Rebase:

```bash
rebase init [directory]
```

Configura um `backend/` (as tabelas em `backend/schema/`) e um `frontend/` (o painel de administração, com suas customizações de tabelas em `frontend/src/cms/`); `--headless` gera o scaffold apenas do `backend/`, sem `backend/schema/`. A [Estrutura do projeto](/docs/getting-started/project-structure/) mostra ambas as árvores.

| Flag | O que faz |
|---|---|
| `-t, --template <preset>` | `blog`, `ecommerce` ou `blank`. Padrão `blog` |
| `--headless` | Apenas backend — sem painel de administração e sem `backend/schema/`: o servidor serve as próprias tabelas do banco de dados. `--template` não tem efeito, pois não há tabelas para popular |
| `-y, --yes` | Nunca perguntar. **Obrigatório onde não houver terminal para responder**, como em CI. Pula o git init e a instalação de dependências — os padrões interativos dizem sim para ambos, então passe `--git` / `--install` se desejar executá-los |
| `-i, --install` | Instala dependências após o scaffolding. Sem ela, o init pergunta (padrão sim); sob `--yes`, nada é instalado |
| `--no-install` | Não instala nada e não pergunta |
| `-g, --git` | Inicializa um repositório e faz o primeiro commit. Sem ela, o init pergunta (padrão sim); sob `--yes`, nenhum repositório |
| `--database-url <url>` | Usa um banco de dados existente em vez do gerenciado. Deve ser uma URL `postgres://` ou `postgresql://`: qualquer outra coisa é recusada antes que um arquivo seja gravado, e o prompt interativo pergunta novamente |
| `--introspect` | Gera `backend/schema` a partir desse banco de dados. Implica `--template blank` e requer `--install` |
| `--project <slug>` | Vincula o scaffold a um projeto do Rebase Cloud |
| `--setup-key <key>` | A chave de uso único que autentica esse vínculo |
| `-a, --agent <name>` | Configura agentes de codificação de IA: as [skills](/docs/ai/skills) e o [servidor MCP](/docs/ai/mcp). Repetível ou separado por vírgula — `claude`, `cursor`, `windsurf`, `gemini`, `codex`, `kiro`, `copilot` ou `all`. Sem ela, o `init` pergunta e pré-seleciona os agentes instalados na máquina; sob `--yes`, nenhum |

### `rebase dev`

Inicia o servidor de desenvolvimento:

```bash
rebase dev
```

Inicia tanto o frontend quanto o backend com hot reloading e regenera o esquema do Drizzle e os tipos do SDK (`generated/sdk/`) na inicialização e a cada salvamento em `backend/schema/`. O backend iniciado também serve o [endpoint MCP remoto](/docs/ai/remote-mcp/) em `/mcp` sem necessidade de configuração, a menos que uma linha `REBASE_MCP_ENABLED` no shell ou no `.env` determine o contrário; a linha `MCP:` do banner imprime sua URL, e [`rebase mcp connect`](/docs/cli/project/#rebase-mcp) conecta um cliente de IA a ele.

Ambas as portas são derivadas do caminho do projeto para que vários projetos Rebase possam ser executados lado a lado. Use as URLs impressas pelo `rebase dev`. Fixe uma com `rebase dev --port 3001`.

Uma aplicação estática no `rebase.json` sem etapa de build (sem `build`, e com `output` sendo sua `root`, como um site em HTML puro) é servida pelo backend a partir desse diretório, em seu `path`, assim como o `rebase start` a serve a partir do bundle, e `FRONTEND_URL` é definida para ela (na porta do backend) para que links enviados por e-mail apontem para lá. Seus [`redirects` e `cleanUrls`](/docs/architecture/redirects-and-clean-urls/) também são servidos, e uma aplicação que declara redirecionamentos não precisa de `index.html`. Uma aplicação com build é executada no Vite em sua própria porta, e `FRONTEND_URL` é a do Vite.

Uma edição no `.env` reinicia o backend, que lê o arquivo novamente, assim como faz o painel de administração. O que o `rebase dev` define por conta própria é mantido até você reiniciá-lo: `PORT`, e `DATABASE_URL` quando estiver no banco de dados gerenciado ou no Docker.

Com `--database-url`, o `rebase dev` primeiro verifica se algo responde naquele host e porta. Se nada responder, ele avisa mencionando a flag e encerra com código `1` sem iniciar nada; ele também não altera os nomes de banco de dados no `.env`, nunca iniciando seu contêiner compose.

### `rebase build`

Compila o projeto em um bundle pronto para deploy em `dist-bundle/`:

```bash
rebase build
```

O bundle é o artefato que você implanta — a imagem de runtime o carrega, portanto não há imagem de aplicação para você mesmo construir. Flags úteis:

| Flag | Efeito |
|------|--------|
| `--output <dir>` (ou `--out`) | Grava o bundle em outro lugar que não `dist-bundle/` (uma aplicação por vez) |
| `--vendor` | Sempre instala e empacota as dependências no bundle |
| `--no-vendor` | Nunca faz vendoring; o pod as instala a cada inicialização |
| `--skip-type-check` | Pula a checagem de tipos (mais rápido, menos seguro) |
| `--no-static` | Não incorpora o frontend no bundle do backend (cada app estático ainda recebe seu próprio bundle) |
| `--skip-static-build` | Incorpora o frontend como já compilado, sem executar seu comando de build |

Um frontend — cada aplicação estática do `rebase.json` com uma configuração do Vite — cuja configuração não utilize `rebaseBackendGuard()` (de `@rebasepro/app/vitePlugin`) é recusado: é ele que mantém o código do servidor fora do bundle do navegador e impede o Vite de embutir um arquivo do backend como uma URL `data:` (ele falha o build, identificando-se, quando outro plugin substitui seu `build.assetsInlineLimit`). `frontend/src/cms/ui-config.json` é transportado para o bundle como `entry.uiConfig`, a apresentação do workspace que um backend implantado serve.

As dependências passam por vendoring por padrão para que uma nova instância não sofra com uma instalação de 35 a 55 segundos. Uma árvore que ultrapasse 2 GB em disco é descartada, pois o limite de upload é de 1 GB comprimido.

Cada aplicação estática que o bundle carrega recebe uma cópia em brotli (`.br`) e gzip (`.gz`) ao lado de cada asset com hash de conteúdo de 1 KB ou mais — os arquivos que um navegador armazena em cache por um ano. O runtime envia aquele que o navegador aceitar, para que esses arquivos não demandem trabalho de compressão por requisição, incluindo o primeiro acesso após um deploy, e navegadores que aceitam brotli o recebem (cerca de 11% menor que gzip no JavaScript do admin). A saída de build do próprio frontend permanece inalterada; apenas a cópia no bundle é modificada. Na aplicação de exemplo, isso adiciona menos de um segundo ao build e cerca de 2,4 MB ao bundle.

### `rebase upgrade`

Atualiza todos os pacotes `@rebasepro/*` fixados no projeto para uma única versão e, em seguida, instala com o gerenciador de pacotes indicado pelo lockfile. `rebase upgrade` obtém a versão mais recente (`latest`); `--to 0.21.0` define uma versão exata, sem consulta ao registro; `--to canary` define uma dist-tag. Cada fixação em `dependencies`, `devDependencies` e `optionalDependencies`, em cada `package.json` do projeto, mantém seu `^` ou `~`, e nada mais no arquivo é alterado. `peerDependencies` e especificações com `workspace:`, `link:`, `file:`, git e tags são listadas e mantidas intactas. Substituições (overrides) em `pnpm-workspace.yaml` e `package.json` também são atualizadas, mas um override `link:` ou `file:` tem precedência sobre qualquer fixação: ele é relatado, e `--drop-local-overrides` o remove. `--dry-run` não grava nada, `--no-install` pula a instalação e `--json` imprime um único documento.

Um projeto em uma versão de pré-lançamento (prerelease), como canary, permanece em seu canal a menos que `latest` seja mais recente. Uma dist-tag que moveria uma versão para trás é recusada (`downgrade_refused` sob `--json`), a menos que você passe `--allow-downgrade`; um `--to` exato é aplicado e sinalizado como downgrade. Um `--dry-run` de uma atualização que a execução real recusaria mostra o que mudaria e sai com código 0, e sob `--json` seu documento inclui a recusa como `wouldRefuse` (`{ code, message, hint }`). Uma vez instalado, ele também atualiza as [skills de agente](/docs/ai/skills/#updating-the-skills) do projeto a partir da nova CLI (`skills` no documento `--json`). Outros comandos terminam com uma linha no stderr quando uma versão mais recente estiver disponível; [`REBASE_NO_UPDATE_CHECK=1`](/docs/getting-started/configuration/) oculta essa mensagem.

### `rebase start`

Executa o bundle compilado da mesma forma que um deploy o executa:

```bash
rebase start
```

Lê `PORT` e o restante do `.env`, ao contrário de `rebase dev`, no `NODE_ENV` definido por eles. Um `.env` gerado no scaffold define `development`, então a primeira conta a se registrar ainda se torna o administrador, e o `rebase start` informa isso no topo; defina `NODE_ENV=production` para um servidor de produção. `rebase start --bundle ./dist-bundle` executa um bundle em outro local.

O `rebase start` não inicializa nenhum banco de dados, e o `.env` do scaffold não possui `DATABASE_URL`, portanto, uma execução local no banco de dados usado pelo `rebase dev` é feita com `DATABASE_URL="$(rebase db url)" rebase start`. Sem ela, essa linha é exibida antes da inicialização.

### `rebase apps list`

Mostra as aplicações que este repositório declara:

```bash
rebase apps list
```

Um repositório pode declarar mais de uma aplicação implantável — um backend e um site de marketing, por exemplo. É assim que você visualiza sobre o que o `rebase build` e o deploy atuarão.

### `rebase eject`

Assume o controle total do processo do servidor e de sua imagem:

```bash
rebase eject
```

Grava o ponto de entrada do backend e um `Dockerfile` no projeto e altera o backend, para que o repositório construa sua própria imagem em vez de executar o runtime publicado. A partir de então, **as atualizações do runtime da plataforma não o alcançarão mais**, e configurações de CORS, autenticação, armazenamento e desligamento passam a ser de sua responsabilidade.

Visualize com `rebase eject --dry-run`, que lista o que mudaria sem alterar nada. `--force` substitui um `backend/src/index.ts` ou `env.ts` existente, mantendo o arquivo atual como `<name>.bak`.

O servidor ejetado mantém os uploads locais em `uploads/` do projeto, executado a partir do código-fonte ou compilado, assim como faz o `rebase dev`. Ele roda em `backend/`, portanto, um `STORAGE_PATH` relativo é lido a partir de `backend/`.

### `rebase schema generate` / `rebase schema stale`

```bash
rebase schema generate       # backend/schema → backend/src/schema.generated.ts
rebase schema stale          # name what differs from the tables, exit 1 if anything does
rebase schema stale --fix    # regenerate the file instead
```

Todo comando que lê o esquema aceita `--schema-dir <dir>` para um projeto que o mantenha em outro local; `--collections` foi removido. O `rebase dev` mantém o arquivo atualizado, portanto `stale` é a verificação indicada para um build ou CI. Consulte [Geração de Esquema](/docs/cli/schema/).

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

Cada um está detalhado em [Comandos de Banco de Dados](/docs/cli/database/), com a ordem na qual um comando seleciona seu banco de dados; `push`, `generate` e `migrate` são abordados em detalhes em [Geração de Esquema](/docs/cli/schema/).

### `rebase console`

Um REPL do Node com os dados do projeto abertos, ou um snippet executado com `-e`:

```bash
rebase console
rebase console -e "rebase.dataAsAdmin.posts.find({ limit: 5 })"
```

`rebase` (`dataAsAdmin`, `sql`, `withAuth(user)`) e `tables` (as tabelas do projeto, carregadas de `backend/schema`) estão no escopo, e `await` de nível superior funciona. O banco de dados é resolvido da mesma forma que o `rebase db push` o resolve, e abri-lo não altera nada nele. Com `-e`, o resultado aguardado é impresso como JSON no stdout e um erro encerra com `1`. Flags: `--eval`/`-e`, `--schema-dir`, `--database-url`, `--docker`. Consulte [Scripts e o Console](/docs/backend/scripts/).

### `rebase migrate`

Migrações unidirecionais de uma estrutura que esta versão não suporta mais: `rebase migrate collections-to-tables` (`config/collections` → `backend/schema` e `frontend/src/cms`) e `rebase migrate sdk-calls` (`data.collection("x")` → `data.table("x")` no seu próprio código). Suas flags, o que elas gravam e a seção "Revisar antes do deploy" estão em [Geração de Esquema](/docs/cli/schema/#rebase-migrate).

### `rebase apps init` / `rebase apps config`

```bash
rebase apps list             # the apps this project declares
rebase apps init             # write a rebase.json inferred from this project
rebase apps config <app>     # the client configuration for one app
```

O `apps init` não aceita nomes: ele infere cada aplicação a partir do projeto e grava todo o `rebase.json`, recusando-se a substituir um existente a menos que você passe `--force`.

Um argumento de nome é recusado. `--force` preserva o que a inferência não consegue deduzir a partir do arquivo substituído: o nome de cada aplicação, seu `path` e sua rota `cms`. Todo o restante é inferido novamente, e uma aplicação declarada que não seja mais encontrada é listada como removida, portanto, em um scaffold, ele regrava o `rebase.json` original do scaffold. O comando de build da aplicação estática usa o gerenciador de pacotes do projeto.

Para um repositório não vinculado a um projeto Cloud, o `apps config` informa que ele não está vinculado, independentemente de o `rebase dev` estar em execução ou não, e fornece a URL do backend conforme servida pelo `rebase dev`.

### `rebase apps add admin`

```bash
rebase apps add admin                  # at /, or at /admin when another app is at /
rebase apps add admin --path /console  # anywhere else, or an https URL of its own
```

Adiciona o painel de administração a um projeto headless ou portado, da mesma forma que o `rebase init` o teria criado. O que ele grava, qual versão ele fixa e quando recusa: [Adicionando um painel de administração mais tarde](/docs/getting-started/headless/#adding-an-admin-panel-later).

### `rebase status`

Tudo o que este projeto declara e se o ambiente de fato o vincula:

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

Três arquivos determinam o que um backend pode alcançar, e este comando imprime os três juntos: `rebase.json` define onde seu código está e quem executa o servidor, `backend/resources.ts` define o que o projeto precisa, e o ambiente define como alcançar cada recurso. Todo o resto — `rebase.resources.json`, o manifesto do bundle — é gerado a partir do segundo arquivo para leitores que não podem executar seu código, e você nunca precisa editá-lo manualmente.

Um `○` é o estado que vale a pena conhecer antes de um deploy, em vez de depois: declarado, não configurado. Um `✗` significa que o ambiente configurou algo de forma *incorreta*, o que impede a inicialização em vez de degradar o funcionamento.

Um `rebase.resources.json` que não corresponde mais às declarações recebe uma linha com `○`. Um que ainda não foi gravado não recebe: o `rebase build` o grava em cada compilação, portanto, um projeto que nunca foi compilado, como um scaffold recém-criado, não tem nada a corrigir.

### `rebase resources`

O que este projeto declara que precisa — os bancos de dados, buckets, tópicos e filas solicitados por `backend/resources.ts`, e os crons e funções definidos por seus arquivos:

```bash
rebase resources            # list them
rebase resources --write    # regenerate rebase.resources.json
rebase resources --check    # fail if the committed graph is stale
rebase resources --json     # machine-readable
```

`rebase resources --check` é a flag usada em CI para falhar caso o `rebase.resources.json` não coincida mais com `backend/resources.ts`. `--json` pode ser combinado com ela: em caso de divergência, `rebase resources --check --json` encerra com código 1 com um envelope de erro (`resource_graph_missing` ou `resource_graph_stale`), e em caso de sucesso o grafo traz `check.status`. `--write --json` grava o arquivo e reporta `written.changed`.

Um recurso é declarado em `backend/resources.ts` — `database("analytics")`, `bucket("media")`, `topic("signups")`, `queue("thumbnails")` — ou é um arquivo em `backend/crons` ou `backend/functions`, e nunca é escrito manualmente em `rebase.resources.json`, que é gerado a partir dessas declarações para que um host possa ler o que o projeto precisa sem compilá-lo. Cada entrada registra quem o utiliza (`table:events`, `column:posts.cover`, `function:report`).

Um backend também possui um banco de dados padrão e uma fonte de armazenamento padrão que ninguém declara explicitamente. Ambos são listados aqui, marcados como `implicit`, e nenhum é gravado no `rebase.resources.json` — o host os fornece, portanto registrá-los solicitaria o provisionamento de algo que ninguém pediu. Declarar um recurso nomeado, como `bucket("media")`, mantém o padrão inalterado, exibindo ambos. Apenas declarar o padrão explicitamente, ou marcar um bucket com `default: true`, o substitui.

Para visualizar o que a plataforma mantém para um projeto em comparação com o que seu código declara e remover um banco de dados provisionado que o código não menciona mais, consulte [`rebase cloud resources`](/docs/cli/cloud#resources).

`rebase cloud` — todos os comandos do Rebase Cloud: autenticação, vínculo de projetos, deploys, configuração, bancos de dados, recursos, computação e muito mais — tem [sua própria página](/docs/cli/cloud).

### `rebase generate-sdk`

```bash
rebase generate-sdk
```

Grava um cliente tipado para as tabelas exportadas por `backend/schema/index.ts` em `generated/sdk/`, com `TableName` e `tablesDictionary`; `--from <link|url>` lê o contrato de um backend em execução. `--register` também tipa dados do lado do servidor: ele grava os tipos e a declaração `Register` em `backend/generated/` e a armazena em `rebase.json` (`registerDatabase`). Consulte [Dados tipados no servidor](/docs/backend/typed-server-data) e [Geração de Esquema](/docs/cli/schema/#rebase-generate-sdk).

### `rebase doctor`

```bash
rebase doctor
```

O comando a ser executado quando algo estiver errado e você ainda não souber o que é. Ele apenas gera relatórios e nunca altera nada, portanto é seguro contra qualquer banco de dados acessível.

**Sem um banco de dados.** Estes são executados primeiro, pois tudo o que impede um projeto de funcionar ocorre antes que uma tabela possa ser comparada:

| Verificação | Motivo |
| --- | --- |
| Node version | Em relação ao intervalo declarado pela CLI. Uma versão muito antiga não é reportada como "Node não suportado" — trata-se de um erro de sintaxe dentro de uma dependência. |
| Package managers | Dois lockfiles em um mesmo projeto. Executar `npm install` em um workspace pnpm reestrutura o `node_modules` de uma forma incompatível com o pnpm, e o sintoma é `Cannot find module` horas depois. |
| Duplicate slugs | Duas tabelas declarando o mesmo slug. O esquema se recusa a compilar com isso, e esta verificação identifica ambas. |
| `.env` sanity | Um `JWT_SECRET` com menos de 32 caracteres (o que a produção recusa ao inicializar) e `NODE_ENV=production` sem `CORS_ORIGINS` nem `FRONTEND_URL`. Os valores nunca são exibidos. |
| `@rebasepro/*` version skew | O mesmo pacote fixado em versões diferentes nos arquivos `package.json` do projeto. Duas cópias quebram o `instanceof` entre elas, falhando como um type guard que rejeita seu próprio tipo. |
| Connection strings | Um `=` não codificado em um parâmetro de URL, o qual as próprias ferramentas do PostgreSQL se recusam a processar — quebrando backups e o `psql`, enquanto a aplicação continua funcionando. |
| Custom functions | O que cada função requer de seu host e quais delas não rodariam em um runtime edge. |

**No banco de dados** — o do próprio projeto, resolvido da forma como o `rebase db url` o resolve; em um scaffold novo, é o banco de dados gerenciado, que o `doctor` inicializa:

| Verificação | Motivo |
| --- | --- |
| Tables → generated schema | Se `schema.generated.ts` está desatualizado. |
| Tables → database | Tabelas, colunas, enums, chaves estrangeiras e junções ausentes. |
| Required extensions | Uma coluna `col.vector()` requer pgvector, que o Rebase instala apenas onde o projeto o declarou. |
| Schema stamp | Se este banco de dados foi provisionado a partir destas tabelas. Um hash, portanto pode indicar que os dois discordam, mas nunca qual está à frente. Uma marcação `v1:` de um runtime anterior à 0.31 é reportada uma vez, com a instrução de atualização: `rebase db push`. |
| Tables → SDK types | Se o SDK tipado gerado está desatualizado. |
| RLS policies | Se as políticas do banco de dados coincidem com o `rls` declarado e se alguma política menciona uma role que este servidor não pode usar. |

Se o banco de dados estiver inacessível, suas fases serão reportadas como ignoradas com o motivo, e o restante continuará sendo executado — consulte [Solução de Problemas](/docs/troubleshooting/).

Encerra com código diferente de zero quando uma verificação encontra um erro ou quando uma fase não pôde ser executada porque o banco de dados fornecido recusa conexões. Uma fase ignorada porque nenhum banco de dados pôde ser resolvido não é considerada uma falha.

`rebase doctor --policies` executa apenas as verificações de RLS — sem diff de esquema, sem tipos de SDK — e falha de forma estrita (fail closed), tornando-se o formato ideal para validação em pipelines de CI contra um banco de dados implantado.

`rebase doctor --database` executa apenas a checagem prévia (preflight) do banco de dados: se a role sob a qual as requisições autenticadas rodam existe, se é restrita e se é possível alternar para ela, quais outros logins podem alternar para ela, se todas as roles podem se conectar e quais tabelas, permissões (grants) e políticas o Rebase compartilharia com outras roles. Cada apontamento indica o SQL a ser executado como administrador, a configuração de `rls` que adapta o Rebase ao banco de dados, ou ambos. Ele lê o catálogo e não altera nada, saindo com 1 quando um apontamento for uma falha. Funciona também em projetos headless. Consulte [Executando em um banco de dados existente ou compartilhado](/docs/deployment/existing-database/).

### `rebase verify`

```bash
rebase verify
rebase verify --json
rebase verify --live
rebase verify --live --database-url postgresql://…
```

Verifica se as tabelas estão seguras para deploy, em um comando rápido para CI e hooks de agentes de IA. Offline por padrão, e nunca altera nada.

| Etapa | O que causa falha |
| --- | --- |
| Table definitions (`schema`) | `backend/schema` não carrega ou não compila, por meio do loader usado pelo backend: uma relação com uma tabela que o index não exporta, `rls: "inherit"` sem `defaultRls`, uma tabela sem chave primária — um apontamento por problema. Uma tabela sem `rls` é um deles. |
| RLS coverage (`rls`) | Uma tabela com uma coluna `user_id`, `owner_id`, `organization_id` ou `tenant_id` cujas regras — próprias ou o `defaultRls` herdado — permitam que uma role leia todas as linhas, desconsiderando-a. Um aviso. `rls-policy-recursion`: uma regra que lê sua própria tabela em uma subconsulta, ou duas tabelas cujas regras leem uma à outra, o que o Postgres se recusa a expandir, fazendo com que qualquer instrução protegida por ela falhe com `42P17 infinite recursion detected in policy`; o apontamento indica a tabela lida e a solução, movendo a leitura para uma função `SECURITY DEFINER`. Um erro, ou um aviso quando o loop não for confirmado. |
| Migration freshness (`migrations`) | Uma tabela ou coluna declarada pelas tabelas que nenhum arquivo em `backend/drizzle/migrations` cria, ou uma removida por elas que uma migração ainda cria. Ignorado para projetos sem migrações. |
| CMS customizations (`cms`) | Um `customizeTable(...)` em `frontend/src/cms` (ou no `src/cms` de um app estático em `rebase.json`) que não corresponda às tabelas, lido estaticamente — os módulos não são executados. `cms-unknown-table`: o slug não corresponde a nenhuma tabela, portanto o painel o ignora (o slug mais próximo é sugerido). `cms-unknown-field`: uma chave sob `fields` não é nem coluna nem relação (o nome SQL de uma coluna é retornado com sua chave). `cms-hidden-required`: um campo omitido do formulário (`hiddenInForm`, `readOnly`, `disabled`) cuja coluna é `NOT NULL` sem valor padrão e sem preenchimento pelo servidor, fazendo com que a criação de um registro pelo painel sempre falhe; um aviso caso um hook `beforeSave` ou transformação possa preenchê-lo, silenciado por `filledByServer`. `cms-duplicate-customization`: um slug customizado duas vezes. `cms-not-static` (um aviso): uma chamada cujo slug, opções ou `fields` não sejam literais ou uma `const` no mesmo arquivo, portanto nada nela foi verificado. `cms-ui-config-not-mounted` (um aviso): `frontend/src/cms/ui-config.json` existe, mas não foi passado para `<RebaseCMS>` como `uiConfig`. `cms-backend-guard-missing`: a configuração do Vite do frontend não usa `rebaseBackendGuard()`, portanto o `rebase build` a recusará. Um projeto headless não possui `frontend/src/cms` e pula esta etapa. |
| Live RLS audit (`live`) | Com `--live`: o catálogo do [`rls-check`](/docs/rls-check) contra o banco de dados do projeto e a verificação de aplicação de todas as migrações. O banco de dados é resolvido da mesma forma que os comandos `db` resolvem — `--database-url`, `DATABASE_URL`, `--docker`, ou o banco de dados de desenvolvimento gerenciado. Um banco de dados que não esteja configurado ou não responda é um erro, e não uma etapa ignorada: afinal, a auditoria foi solicitada explicitamente. Uma política de leitura `USING (true)` compilada a partir de uma regra `access: "public"` é um aviso enquanto a API exigir token (`AUTH_REQUIRE`, ativo por padrão) — todo usuário autenticado lê todas as linhas — e um erro com `AUTH_REQUIRE=false`, onde as linhas são anônimas. |

`--json` imprime um objeto, `{ ok, schemaDir, steps, findings, summary }`: cada etapa é `{ id, title, status, detail? }` (`status` é `passed`, `failed`, `warnings` ou `skipped`), e cada apontamento traz `step`, `check` (um identificador estável em kebab-case), `severity`, `message`, e quando aplicável `fix`, `table`, `file`, `line` e o `path` pontilhado na tabela (`posts.rls[0]`) — permitindo que um agente repare o que quebrou. `summary` contabiliza `errors` e `warnings`. `--quiet` não imprime nada quando tudo passa. Encerra com código diferente de zero em caso de erro; avisos não causam falha.

Um projeto gerado via scaffold o executa para o Claude Code após cada edição em `backend/schema/`: consulte [`rebase skills install`](#rebase-skills-install).

### Comandos para uma aplicação em execução

`rebase api`, `rebase data`, `rebase users`, `rebase cron`, `rebase logs`, `rebase functions`, `rebase rls simulate`, `rebase auth login` e `rebase storage ls|cp|rm|url|stat` atuam em uma aplicação em execução por meio de sua API: o `rebase dev` local, um servidor especificado com `--url`, ou um projeto do Rebase Cloud com `--project`. Consulte [Uma aplicação em execução](/docs/cli/project/).

### `rebase auth`

Comandos de gerenciamento de autenticação:

```bash
rebase auth reset-password --email admin@example.com --password NewPassword123!
```

### `rebase api-keys`

Gerencia as chaves de API de serviço do projeto — a credencial que um agente, script ou outro serviço utiliza, ao contrário da sessão de um usuário final:

```bash
rebase api-keys list
rebase api-keys get abc123-def456
rebase api-keys create --name "Blog CI" --scopes data:read:posts,data:write:posts --expires-in 90
rebase api-keys create --name "Ops" --full-access --roles admin --expires-at 2027-01-31
rebase api-keys revoke abc123-def456
```

`--scopes` especifica o que a chave pode fazer, separado por vírgulas ou repetido; `--full-access` concede a ela todos os escopos que a chave de serviço possui, exceto `keys:*`. `--roles` adiciona roles de RLS além de `service`, `--expires-in` aceita dias e `--expires-at` uma data em formato ISO. `rebase api-keys scopes` lista todos os escopos que o backend conhece. A chave é exibida apenas uma vez. Tanto os escopos da chave quanto a segurança em nível de linha (RLS) da identidade que ela assume são aplicados. Consulte [Chaves de API](/docs/backend/api-keys/).

### `rebase storage`

Manutenção completa de arquivos armazenados através do backend em execução com `REBASE_SERVICE_KEY` do `.env`:

```bash
rebase storage orphans                         # files no row names
rebase storage orphans --source media --delete # and delete them, after asking
rebase storage move --from "(default)" --to media --prefix avatars
rebase storage move --from "(default)" --to media --prefix avatars --delete-source
```

`orphans` lê cada linha de cada tabela conforme armazenada (incluindo linhas excluídas via soft-delete, ignorando qualquer hook `beforeQuery` e `afterRead`) e cada entrada de [histórico](/docs/backend/history/), já que uma reversão restaura o conteúdo armazenado. Ele lista os arquivos de uma origem (`--source`, a origem padrão quando omitida) que nenhuma string em nenhum desses registros referencia: uma chave, uma URL ou uma referência `rebase-storage:` em um texto. Arquivos mais recentes que `--older-than` horas (24 por padrão) são desconsiderados, pois o painel de administração faz upload de um arquivo antes que a linha que o referencia seja salva. A varredura é executada no backend em segundo plano, portanto um projeto grande demais para ser varrido dentro de uma única requisição (atrás de um ingress com timeout) ainda assim é concluído. A CLI a inicia e depois exibe seu progresso (arquivos listados, linhas lidas, tabelas concluídas e eventuais tabelas que não puderam ser lidas) até o término. Com a [fila de jobs](/docs/backend/jobs/) ativada, a varredura é um job `storage.orphans` executado pelos workers. Sem ela, a varredura roda dentro do processo do servidor solicitado, e a CLI informa isso: reiniciar esse processo interrompe a varredura. Uma varredura é uma tentativa de job, limitada por `jobs.timeoutMs` (15 minutos por padrão). Aumente esse valor ou defina-o como 0 para uma origem que demore mais. `--json` imprime o mesmo relatório de antes, além de seu `scanId`.

`--delete` solicita confirmação antes de excluir (`--yes` pula a pergunta e é obrigatório sem um terminal). Ele exclui apenas a partir da varredura recém-impressa e somente dentro de 15 minutos após a conclusão dessa varredura. Nada é excluído enquanto uma tabela não puder ser lida: uma tabela com hooks de leitura em um banco de dados cujo driver não consiga ler além deles é considerada não lida. Antes de excluir qualquer coisa, o servidor lê todas as linhas e entradas de histórico novamente em comparação com os arquivos listados. Em seguida, ele consulta cada arquivo novamente antes de excluí-lo. Um arquivo que uma linha passe a referenciar agora, que tenha sido reenviado após a varredura ou que tenha desaparecido é mantido, e a CLI o lista como mantido. Arquivos que apenas tabelas não atendidas pelo Rebase referenciam parecerão não utilizados: verifique antes de excluir. Em relação a um backend da versão 0.25.1 ou anterior, a CLI realiza a varredura da maneira antiga, dentro de uma única requisição.

`move` copia os arquivos sob `--prefix` para outra origem sob as mesmas chaves, uma página por vez. Um arquivo que o destino já possua com o mesmo tamanho é ignorado, de modo que uma transferência interrompida é retomada executando o comando novamente; `--delete-source` exclui cada arquivo da origem assim que o destino o contiver, sendo recusado quando ambas as origens utilizarem o mesmo bucket ou diretório. Concluída a transferência, a CLI lista a origem novamente com uma nova varredura e indica cada arquivo que não foi movido: com `--delete-source`, qualquer arquivo que permaneça na origem; sem ele, qualquer arquivo do qual o destino não possua uma cópia com o mesmo tamanho. Ele encerra com código 1 caso haja algum, e executar a mesma transferência novamente o incluirá. `--json` imprime esses arquivos como `notMoved`. A leitura do relatório de uma varredura requer `database:read`. Iniciar uma varredura, excluir e mover requerem `database:write`, permissão que a chave de serviço possui.

### `rebase skills install`

Instala as skills de referência do Rebase para seus assistentes de codificação de IA — todas as opções de `--agent` mencionadas acima:

```bash
rebase skills install
rebase skills install --agent claude,cursor
rebase skills install --agent all
rebase skills --hooks
```

Consulte [Skills de Agente](/docs/ai/skills) para obter a lista completa e saber onde os arquivos são gravados.

`--hooks` instala a proteção (guardrail) do Claude Code que o `rebase init` inclui em cada projeto: `.claude/hooks/post-edit-collection.sh`, registrado como um hook `PostToolUse` em `.claude/settings.json`, que executa `rebase verify --quiet` após cada edição em `backend/schema/` ou `frontend/src/cms/` e devolve qualquer problema para o agente. Configurações e hooks existentes são mantidos. `rebase skills --hooks` instala apenas o hook.

### `rebase telemetry`

Compartilhamento anônimo de uso, desativado até você concordar. Um `rebase init` interativo pergunta ao final, e o prompt define como padrão "não", portanto nada é compartilhado a menos que você responda afirmativamente. A resposta é por máquina (`~/.rebase/telemetry.json`): após um "sim", o `init` nunca mais pergunta, e após um "não", o próximo `init` pergunta novamente. Cada clone/checkout recebe um ID de projeto aleatório, mantido em seu `.rebase/telemetry-project.json` (ignorado pelo git).

```bash
rebase telemetry status
rebase telemetry show
rebase telemetry enable
rebase telemetry disable
```

`status` imprime a configuração atual, `show` exibe exatamente o que seria enviado — esteja o compartilhamento ativado ou não, para que você possa conferir o payload antes de decidir — e os outros dois a alteram. Se você nunca executou o `init`, nada jamais foi coletado.

## Próximos Passos

- **[Geração de Esquema](/docs/cli/schema/#production-workflow)** — O fluxo de trabalho de migração, desde a edição de uma tabela até a produção
- **[Esquema como Código](/docs/architecture/schema-as-code)** — Como funciona a geração de esquema
- **[Início Rápido](/docs/getting-started/quickstart)** — Primeiros passos
