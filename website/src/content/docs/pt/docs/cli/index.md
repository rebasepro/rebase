---
sourceHash: ab3e8ab0477304ad
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

`--json` é a flag de alternância e, fora da família `cloud`, é a única: `rebase status`, `rebase resources`, `rebase apps list`, `rebase upgrade` e `rebase verify` colocam então um valor JSON no stdout — o resultado ou um envelope `{"error": {"message", "code", "hint", "issues"}}` com código de saída diferente de zero — em **toda** saída do comando, para que o chamador possa analisar o stdout incondicionalmente. Sem ela, eles escrevem texto legível por humanos e as falhas vão para o stderr. O `rebase cloud` usa o mesmo envelope e é a única exceção à flag: ele também ativa o JSON por conta própria quando o stdout não for um TTY ou quando `REBASE_JSON=1` estiver definido. Portanto, `rebase cloud status | cat` produz JSON enquanto `rebase status | cat` não — em um script, passe `--json` explicitamente em vez de depender de qualquer uma dessas regras.

## Comandos

### `rebase init`

Inicializa um novo projeto Rebase:

```bash
rebase init [directory]
```

Configura um `backend/` (as tabelas em `backend/schema/`) e um `frontend/` (o painel administrativo, com suas customizações de tabela em `frontend/src/cms/`); `--headless` gera o scaffolding apenas de `backend/`, sem `backend/schema/`. [Estrutura do projeto](/docs/getting-started/project-structure/) mostra ambas as árvores.

| Flag | O que faz |
|---|---|
| `-t, --template <preset>` | `blog`, `ecommerce` ou `blank`. Padrão `blog` |
| `--headless` | Apenas backend — sem painel administrativo e sem `backend/schema/`: o servidor atende às próprias tabelas do banco de dados. `--template` não tem efeito, pois não há tabelas para popular (seed) |
| `-y, --yes` | Nunca solicitar confirmação. **Obrigatório onde não houver terminal para responder**, como no CI. Ignora o git init e a instalação de dependências — os padrões interativos respondem sim a ambos, portanto passe `--git` / `--install` se quiser executá-los |
| `-i, --install` | Instala dependências após o scaffolding. Sem ela, o init pergunta (padrão sim); sob `--yes`, nada é instalado |
| `--no-install` | Não instala nada e não pergunta |
| `-g, --git` | Inicializa um repositório e faz o primeiro commit. Sem ela, o init pergunta (padrão sim); sob `--yes`, nenhum repositório |
| `--database-url <url>` | Usa um banco de dados existente em vez do gerenciado. Deve ser uma URL `postgres://` ou `postgresql://`: qualquer outra coisa é recusada antes que um arquivo seja escrito, e o prompt interativo pergunta novamente |
| `--introspect` | Gera `backend/schema` a partir desse banco de dados. Implica `--template blank` e requer `--install` |
| `--project <slug>` | Vincula o scaffold a um projeto do Rebase Cloud |
| `--setup-key <key>` | A chave de uso único que autentica esse vínculo |
| `-a, --agent <name>` | Configura agentes de codificação de IA: as [skills](/docs/ai/skills) e o [servidor MCP](/docs/ai/mcp). Repetível ou separado por vírgulas — `claude`, `cursor`, `windsurf`, `gemini`, `codex`, `kiro`, `copilot` ou `all`. Sem ela, o `init` pergunta e pré-seleciona os agentes instalados na máquina; sob `--yes`, nenhum |

### `rebase dev`

Inicia o servidor de desenvolvimento:

```bash
rebase dev
```

Inicia o frontend e o backend com hot reloading e regenera o schema do Drizzle e os tipos do SDK (`generated/sdk/`) na inicialização e a cada salvamento em `backend/schema/`.

Ambas as portas são derivadas do caminho do projeto para que vários projetos Rebase possam rodar lado a lado. Use as URLs exibidas por `rebase dev`. Fixe uma com `rebase dev --port 3001`.

Uma alteração no `.env` reinicia o backend, que lê o arquivo novamente, assim como o painel administrativo faz. O que o `rebase dev` define por si próprio é mantido até que você o reinicie: `PORT` e `DATABASE_URL` quando estiver no banco de dados gerenciado ou no Docker.

Com `--database-url`, o `rebase dev` primeiro verifica se algo responde naquele host e porta. Se nada responder, ele avisa nomeando a flag e sai com código `1` sem iniciar nada; ele também não altera as variáveis de banco de dados do `.env`, nunca iniciando seu contêiner compose.

### `rebase build`

Compila o projeto em um bundle implantável em `dist-bundle/`:

```bash
rebase build
```

O bundle é o artefato que você implanta — a imagem de runtime o carrega, portanto não há imagem de aplicação para você mesmo construir. Flags úteis:

| Flag | Efeito |
|------|--------|
| `--output <dir>` (ou `--out`) | Escreve o bundle em outro lugar que não seja `dist-bundle/` (uma aplicação por vez) |
| `--vendor` | Sempre instala e empacota (vendor) as dependências do bundle |
| `--no-vendor` | Nunca inclui dependências no bundle (vendor); o pod as instala a cada inicialização |
| `--skip-type-check` | Pula a verificação de tipos (mais rápido, menos seguro) |
| `--no-static` | Não incorpora o frontend no bundle do backend (cada aplicação estática ainda recebe seu próprio bundle) |
| `--skip-static-build` | Incorpora o frontend como já compilado, sem executar seu comando de build |

Um frontend — qualquer aplicação estática de `rebase.json` com uma configuração do Vite — cuja configuração não use `rebaseBackendGuard()` (de `@rebasepro/app/vitePlugin`) é recusado: é isso que mantém o código do servidor fora do bundle do navegador e impede o Vite de embutir um arquivo de backend como uma URL `data:` (ele falha a compilação, mencionando a si mesmo, quando outro plugin substitui seu `build.assetsInlineLimit`). `frontend/src/cms/ui-config.json` é incluído no bundle como `entry.uiConfig`, a apresentação do workspace que um backend implantado serve.

As dependências são incluídas por padrão (vendored) para que uma nova instância não sofra uma instalação de 35–55 segundos. Uma árvore que passe de 2 GB em disco é descartada, pois o limite de upload é de 1 GB compactado.

Cada aplicação estática incluída no bundle recebe uma cópia brotli (`.br`) e gzip (`.gz`) ao lado de cada ativo com hash de conteúdo de 1 KB ou mais — os arquivos que um navegador armazena em cache por um ano. O runtime envia aquele que o navegador aceitar, portanto esses arquivos não exigem trabalho de compactação por requisição, incluindo a primeira visita após um deploy, e navegadores que aceitam brotli o recebem (cerca de 11% menor que o gzip no JavaScript do admin). A saída de build do seu próprio frontend permanece como estava; apenas a cópia no bundle é alterada. Na aplicação de exemplo, isso adiciona menos de um segundo ao build e cerca de 2,4 MB ao bundle.

### `rebase upgrade`

Atualiza cada pacote `@rebasepro/*` fixado no projeto para uma única versão e, em seguida, instala com o gerenciador de pacotes indicado pelo lockfile. `rebase upgrade` pega a versão mais recente; `--to 0.21.0` uma versão exata, sem consulta ao registro; `--to canary` uma dist-tag. Cada fixação em `dependencies`, `devDependencies` e `optionalDependencies`, em cada `package.json` do projeto, mantém seu `^` ou `~`, e nada mais no arquivo é alterado. `peerDependencies` e especificações `workspace:`, `link:`, `file:`, git e tags são listadas e mantidas intactas. Overrides em `pnpm-workspace.yaml` e `package.json` também são atualizados, mas um override `link:` ou `file:` tem precedência sobre qualquer fixação: ele é relatado e `--drop-local-overrides` o remove. `--dry-run` não grava nada, `--no-install` pula a instalação e `--json` imprime um único documento.

Um projeto em versão de pré-lançamento, como uma versão canary, permanece em seu canal, a menos que `latest` seja mais recente. Uma dist-tag que moveria uma versão para trás é recusada (`downgrade_refused` sob `--json`), a menos que você passe `--allow-downgrade`; um `--to` exato é aplicado e sinalizado como downgrade. Um `--dry-run` de um upgrade que a execução real recusaria mostra o que seria alterado e sai com código 0, e sob `--json` seu documento traz a recusa como `wouldRefuse` (`{ code, message, hint }`).

### `rebase start`

Executa o bundle compilado da mesma forma que um deploy o executa:

```bash
rebase start
```

Lê `PORT` e o restante do `.env`, diferentemente de `rebase dev`, no `NODE_ENV` configurado. Um `.env` recém-gerado define `development`, portanto a primeira conta registrada ainda se torna administradora, e o `rebase start` informa isso no topo; defina `NODE_ENV=production` para um servidor de produção. `rebase start --bundle ./dist-bundle` executa um bundle em outro local.

O `rebase start` não inicia nenhum banco de dados, e o `.env` inicial não tem `DATABASE_URL`, portanto uma execução local no banco de dados usado por `rebase dev` é `DATABASE_URL="$(rebase db url)" rebase start`. Sem uma URL, ele imprime essa linha antes da inicialização.

### `rebase apps list`

Exibe as aplicações que este repositório declara:

```bash
rebase apps list
```

Um repositório pode declarar mais de uma aplicação implantável — por exemplo, um backend e um site de marketing. É assim que você vê sobre o que o `rebase build` e o deploy atuarão.

### `rebase eject`

Assume o controle total do processo do servidor e de sua imagem:

```bash
rebase eject
```

Grava o ponto de entrada (entrypoint) do backend e um `Dockerfile` no projeto e altera o backend para que o repositório crie sua própria imagem em vez de executar o runtime publicado. A partir de então, **as atualizações do runtime da plataforma não o alcançarão mais**, e o CORS, configuração de autenticação, armazenamento e encerramento passam a ser de sua responsabilidade.

Visualize previamente com `rebase eject --dry-run`, que lista o que mudaria sem alterar nada. `--force` substitui um `backend/src/index.ts` ou `env.ts` existente, mantendo o arquivo atual como `<name>.bak`.

O servidor ejetado mantém os uploads locais em `uploads/` do projeto, seja executado a partir do código-fonte ou compilado, assim como o `rebase dev` faz. Ele é executado em `backend/`, portanto um `STORAGE_PATH` relativo nele é lido a partir de `backend/`.

### `rebase schema generate` / `rebase schema stale`

```bash
rebase schema generate       # backend/schema → backend/src/schema.generated.ts
rebase schema stale          # name what differs from the tables, exit 1 if anything does
rebase schema stale --fix    # regenerate the file instead
```

Cada comando que lê o schema aceita `--schema-dir <dir>` para um projeto que o mantém em outro local; `--collections` foi removido. O `rebase dev` mantém o arquivo atualizado, portanto `stale` é a verificação adequada para build ou CI. Consulte [Geração de Schemas](/docs/cli/schema/).

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

Cada um está em [Comandos de Banco de Dados](/docs/cli/database/), com a ordem em que um comando seleciona seu banco de dados; `push`, `generate` e `migrate` são abordados em detalhes em [Geração de Schemas](/docs/cli/schema/).

### `rebase console`

Um REPL do Node com os dados do projeto acessíveis, ou um snippet executado com `-e`:

```bash
rebase console
rebase console -e "rebase.dataAsAdmin.posts.find({ limit: 5 })"
```

`rebase` (`dataAsAdmin`, `sql`, `withAuth(user)`) e `tables` (as tabelas do projeto, carregadas de `backend/schema`) estão no escopo, e o `await` de nível superior funciona. O banco de dados é resolvido da mesma forma que `rebase db push` o resolve, e abri-lo não altera nada nele. Com `-e`, o resultado aguardado é impresso como JSON no stdout e uma exceção não capturada sai com código `1`. Flags: `--eval`/`-e`, `--schema-dir`, `--database-url`, `--docker`. Consulte [Scripts e o Console](/docs/backend/scripts/).

### `rebase migrate`

Migrações unidirecionais a partir de uma estrutura que esta versão não lê mais: `rebase migrate collections-to-tables` (`config/collections` → `backend/schema` e `frontend/src/cms`) e `rebase migrate sdk-calls` (`data.collection("x")` → `data.table("x")` no seu próprio código). Suas flags, o que gravam e a seção "Revise antes de implantar" estão em [Geração de Schemas](/docs/cli/schema/#rebase-migrate).

### `rebase apps init` / `rebase apps config`

```bash
rebase apps list             # the apps this project declares
rebase apps init             # write a rebase.json inferred from this project
rebase apps config <app>     # the client configuration for one app
```

`apps init` não aceita um nome: ele infere cada aplicação a partir do projeto e grava todo o `rebase.json`, recusando-se a substituir um existente a menos que você passe `--force`.

Um argumento de nome é recusado. `--force` preserva o que a inferência não consegue identificar a partir do arquivo substituído: o nome de cada aplicação, seu `path` e sua rota `cms`. Todo o restante é inferido novamente, e uma aplicação declarada que não seja mais encontrada é listada como removida, portanto, em um scaffold, ele reescreve o `rebase.json` fornecido originalmente. O comando de build da aplicação estática usa o gerenciador de pacotes do projeto.

Para um checkout não vinculado a um projeto Cloud, `apps config` informa que ele não está vinculado, independentemente de `rebase dev` estar em execução ou não, e fornece a URL do backend conforme servida por `rebase dev`.

### `rebase status`

Tudo o que este projeto declara e se o ambiente realmente vincula cada item:

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

Três arquivos decidem o que um backend pode alcançar, e este comando exibe os três juntos: `rebase.json` define onde está seu código e quem executa o servidor, `backend/resources.ts` define o que o projeto precisa e o ambiente diz como alcançar cada recurso. Todo o resto — `rebase.resources.json`, o manifesto do bundle — é gerado a partir do segundo para leitores que não podem executar seu código, e você nunca precisa editá-lo manualmente.

Um `○` representa o estado que vale a pena saber antes de um deploy, em vez de depois: declarado, não configurado. Um `✗` significa que o ambiente configurou algo *incorretamente*, o que recusa a inicialização em vez de degradar a execução.

Um `rebase.resources.json` que não corresponda mais às declarações recebe uma linha com `○`. Um que ainda não foi escrito não recebe: o `rebase build` o escreve a cada compilação, portanto um projeto que nunca foi compilado, como um scaffold recém-criado, não tem nada a corrigir.

### `rebase resources`

O que este projeto declara que precisa — os bancos de dados, buckets, tópicos e filas solicitados por `backend/resources.ts`, e os crons e funções que seus arquivos definem:

```bash
rebase resources            # list them
rebase resources --write    # regenerate rebase.resources.json
rebase resources --check    # fail if the committed graph is stale
rebase resources --json     # machine-readable
```

`rebase resources --check` é a flag usada em um job de CI para falhar caso um `rebase.resources.json` não corresponda mais a `backend/resources.ts`. `--json` combina-se a ela: havendo divergência (drift), `rebase resources --check --json` sai com código 1 trazendo um envelope de erro (`resource_graph_missing` ou `resource_graph_stale`), e em caso de sucesso o grafo traz `check.status`. `--write --json` grava o arquivo e relata `written.changed`.

Um recurso é declarado em `backend/resources.ts` — `database("analytics")`, `bucket("media")`, `topic("signups")`, `queue("thumbnails")` — ou é um arquivo em `backend/crons` ou `backend/functions`, e nunca é escrito manualmente em `rebase.resources.json`, que é gerado a partir dessas declarações para que um host possa ler o que um projeto precisa sem compilá-lo. Cada entrada registra quem o utiliza (`table:events`, `column:posts.cover`, `function:report`).

Um backend também possui um banco de dados padrão e uma fonte de armazenamento padrão que ninguém declara. Ambos são listados aqui, marcados como `implicit`, e nenhum deles é gravado em `rebase.resources.json` — o host os fornece, portanto registrá-los solicitaria o provisionamento de algo que ninguém pediu. Declarar um recurso nomeado, como `bucket("media")`, mantém o padrão onde está, de modo que ambos são listados. Apenas declarar o próprio padrão ou marcar um bucket como `default: true` o substitui.

Para ver o que a plataforma mantém para um projeto em comparação com o que seu código declara e para remover um banco de dados provisionado que o código não menciona mais, consulte [`rebase cloud resources`](/docs/cli/cloud#resources).

`rebase cloud` — todos os comandos para o Rebase Cloud: autenticação, vínculo de projetos, deploys, configuração, bancos de dados, recursos, computação e muito mais — tem [sua própria página](/docs/cli/cloud).

### `rebase generate-sdk`

```bash
rebase generate-sdk
```

Grava um cliente tipado para as tabelas exportadas por `backend/schema/index.ts` em `generated/sdk/`, com `TableName` e `tablesDictionary`; `--from <link|url>` lê o contrato de um backend em execução. `--register` também tipa os dados do lado do servidor: ele grava os tipos e a declaração `Register` em `backend/generated/` e salva essa preferência em `rebase.json` (`registerDatabase`). Consulte [Dados tipados no servidor](/docs/backend/typed-server-data) e [Geração de Schemas](/docs/cli/schema/#rebase-generate-sdk).

### `rebase doctor`

```bash
rebase doctor
```

O comando a ser executado quando algo estiver errado e você ainda não souber o que é. Ele apenas relata e nunca altera nada, portanto é seguro executá-lo contra qualquer banco de dados acessível.

**Sem um banco de dados.** Estes são executados primeiro, pois tudo o que impede um projeto de funcionar ocorre antes que uma tabela possa ser comparada:

| Verificação | Por que |
| --- | --- |
| Versão do Node | Comparada com o intervalo que a CLI declara. Uma versão muito antiga não é relatada como "Node não suportado" — manifesta-se como um erro de sintaxe dentro de uma dependência. |
| Gerenciadores de pacotes | Dois lockfiles em um mesmo projeto. Executar `npm install` em um workspace pnpm reestrutura o `node_modules` em um formato incompatível com o pnpm, e o sintoma é `Cannot find module` horas depois. |
| Slugs duplicados | Duas tabelas declarando o mesmo slug. O schema recusa a compilação por conta disso, e esta verificação aponta ambas. |
| Sanidade do `.env` | Um `JWT_SECRET` com menos de 32 caracteres (o que impede a inicialização em produção) e `NODE_ENV=production` sem `CORS_ORIGINS` nem `FRONTEND_URL`. Os valores nunca são exibidos. |
| Divergência de versão de `@rebasepro/*` | O mesmo pacote fixado em versões diferentes entre os arquivos `package.json` do projeto. Duas cópias quebram o `instanceof` entre elas, falhando como uma verificação de tipo (type guard) que rejeita seu próprio tipo. |
| Strings de conexão | Um `=` não codificado em um parâmetro de URL, que as próprias ferramentas do PostgreSQL se recusam a analisar — assim, backups e `psql` quebram enquanto a aplicação continua funcionando. |
| Funções customizadas | O que cada função requer de seu host e quais delas não rodariam em um runtime edge. |

**No banco de dados** — o do próprio projeto, resolvido da forma como `rebase db url` o resolve, portanto em um scaffold novo é o banco de dados gerenciado, que o `doctor` inicializa:

| Verificação | Por que |
| --- | --- |
| Tabelas → schema gerado | Se o `schema.generated.ts` está desatualizado. |
| Tabelas → banco de dados | Tabelas, colunas, enums, chaves estrangeiras e junções ausentes. |
| Extensões necessárias | Uma coluna `col.vector()` requer pgvector, que o Rebase instala apenas onde um projeto a declarou. |
| Carimbo do schema | Se este banco de dados foi provisionado a partir destas tabelas. Um hash, para que possa informar que os dois divergem, mas nunca qual está à frente. Um carimbo `v1:` de um runtime anterior ao 0.31 é relatado uma vez, com a instrução de recarimbamento: `rebase db push`. |
| Tabelas → tipos do SDK | Se o SDK tipado gerado está desatualizado. |
| Políticas de RLS | Se as políticas do banco de dados correspondem ao `rls` que você declarou e se alguma política menciona uma role que este servidor não pode usar. |

Se o banco de dados estiver inacessível, suas fases serão relatadas como ignoradas com o motivo, e o restante ainda será executado — consulte [Solução de problemas](/docs/troubleshooting/).

Sai com código diferente de zero quando uma verificação encontra um erro ou quando uma fase não pôde ser executada porque o banco de dados fornecido recusa conexões. Uma fase ignorada porque nenhum banco de dados pôde ser resolvido não é considerada falha.

`rebase doctor --policies` executa apenas as verificações de RLS — sem diff de schema, sem tipos de SDK — e falha de forma restritiva (fails closed), tornando-se o formato ideal para ser usado como barreira (gate) de CI contra um banco de dados implantado.

`rebase doctor --database` executa apenas a verificação preliminar (preflight) do banco de dados: se a role sob a qual as requisições autenticadas rodam existe, é restrita e pode ser assumida via troca de contexto, quais outros logins podem alternar para ela, se todas as roles podem se conectar e quais tabelas, permissões (grants) e políticas o Rebase compartilharia com outras roles. Cada apontamento indica o SQL a ser executado como administrador, a configuração de `rls` que adapta o Rebase ao banco de dados ou ambos. Ele lê o catálogo e não altera nada, saindo com código 1 quando um apontamento for uma falha. Funciona também em projetos headless. Consulte [Executando em um banco de dados existente ou compartilhado](/docs/deployment/existing-database/).

### `rebase verify`

```bash
rebase verify
rebase verify --json
rebase verify --live
rebase verify --live --database-url postgresql://…
```

Verifica se as tabelas estão seguras para envio à produção, em um comando rápido para CI e hooks de agentes de IA. Offline por padrão, e nunca altera nada.

| Etapa | O que a faz falhar |
| --- | --- |
| Definições de tabela (`schema`) | `backend/schema` não carrega ou não compila, por meio do carregador a partir do qual o backend inicializa: uma relação com uma tabela que o índice não exporta, `rls: "inherit"` sem `defaultRls`, uma tabela sem chave primária — um apontamento por problema. Uma tabela sem `rls` é um deles. |
| Cobertura de RLS (`rls`) | Uma tabela com uma coluna `user_id`, `owner_id`, `organization_id` ou `tenant_id` cujas regras — próprias ou o `defaultRls` herdado — permitem que uma role leia todas as linhas independentemente disso. Um aviso. `rls-policy-recursion`: uma regra que lê sua própria tabela em uma subconsulta, ou duas tabelas cujas regras leem uma à outra, o que o Postgres se recusa a expandir, fazendo com que qualquer declaração protegida falhe com `42P17 infinite recursion detected in policy`; o apontamento indica a tabela lida e a correção, que consiste em mover a leitura para uma função `SECURITY DEFINER`. Um erro, ou um aviso quando o loop não for garantido. |
| Atualização de migrações (`migrations`) | Uma tabela ou coluna declarada pelas tabelas que nenhum arquivo em `backend/drizzle/migrations` cria, ou uma tabela/coluna removida que uma migração ainda cria. Ignorado para projetos que ainda não possuem migrações. |
| Customizações do CMS (`cms`) | Um `customizeTable(...)` em `frontend/src/cms` (ou no `src/cms` de uma aplicação estática em `rebase.json`) que não corresponde às tabelas, lido estaticamente — os módulos não são executados. `cms-unknown-table`: o slug não indica nenhuma tabela, portanto o painel o ignora (o slug mais próximo é sugerido). `cms-unknown-field`: uma chave sob `fields` não é nem coluna nem relação (o nome SQL de uma coluna é respondido com sua chave). `cms-hidden-required`: um campo omitido do formulário (`hiddenInForm`, `readOnly`, `disabled`) cuja coluna é `NOT NULL` sem valor padrão e sem nada que o servidor preencha, de modo que a criação de um registro pelo painel sempre falha; um aviso quando um hook ou transformação `beforeSave` puder preenchê-lo, e silenciado por `filledByServer`. `cms-duplicate-customization`: um mesmo slug customizado duas vezes. `cms-not-static` (um aviso): uma chamada cujo slug, opções ou `fields` não são literais ou uma `const` no mesmo arquivo, portanto nada nela foi verificado. `cms-ui-config-not-mounted` (um aviso): `frontend/src/cms/ui-config.json` existe, mas não é passado para `<RebaseCMS>` como `uiConfig`. `cms-backend-guard-missing`: a configuração do Vite do frontend não usa `rebaseBackendGuard()`, portanto `rebase build` a recusaria. Um projeto headless não possui `frontend/src/cms` e pula esta etapa. |
| Auditoria de RLS ao vivo (`live`) | Com `--live`: o catálogo de [`rls-check`](/docs/rls-check) contra o banco de dados do projeto e se todas as migrações foram aplicadas. O banco de dados é resolvido conforme os comandos `db` o resolvem — `--database-url`, `DATABASE_URL`, `--docker`, ou caso contrário o banco de dados de desenvolvimento gerenciado. Um banco de dados não configurado ou que não responde é um erro, não uma etapa ignorada: a auditoria foi expressamente solicitada. Uma política de leitura `USING (true)` compilada a partir de uma regra `access: "public"` é um aviso enquanto a API exigir token (`AUTH_REQUIRE`, ativado por padrão) — todo usuário autenticado lê todas as linhas — e um erro com `AUTH_REQUIRE=false`, onde as linhas são anônimas. |

`--json` imprime um único objeto, `{ ok, schemaDir, steps, findings, summary }`: cada etapa é `{ id, title, status, detail? }` (`status` é `passed`, `failed`, `warnings` ou `skipped`), e cada apontamento traz `step`, `check` (um tipo estável em kebab-case), `severity`, `message` e, quando aplicável, `fix`, `table`, `file`, `line` e o `path` separado por pontos na tabela (`posts.rls[0]`) — para que um agente possa reparar o que quebrou. `summary` contabiliza `errors` e `warnings`. `--quiet` não imprime nada quando tudo passar. Sai com código diferente de zero em caso de erro; avisos não geram falha.

Um projeto gerado a partir do scaffold o executa para o Claude Code após cada edição em `backend/schema/`: consulte [`rebase skills install`](#rebase-skills-install).

### Comandos para uma aplicação em execução

`rebase api`, `rebase data`, `rebase users`, `rebase cron`, `rebase logs`, `rebase functions`, `rebase rls simulate`, `rebase auth login` e `rebase storage ls|cp|rm|url|stat` atuam em uma aplicação em execução por meio de sua API: o `rebase dev` local, um servidor indicado com `--url` ou um projeto do Rebase Cloud com `--project`. Consulte [Uma aplicação em execução](/docs/cli/project/).

### `rebase auth`

Comandos de gerenciamento de autenticação:

```bash
rebase auth reset-password --email admin@example.com --password NewPassword123!
```

### `rebase api-keys`

Gerencia as chaves de API de serviço do projeto — a credencial usada por um agente, script ou outro serviço, em oposição à sessão de um usuário final:

```bash
rebase api-keys list
rebase api-keys get abc123-def456
rebase api-keys create --name "Blog CI" --scopes data:read:posts,data:write:posts --expires-in 90
rebase api-keys create --name "Ops" --full-access --roles admin --expires-at 2027-01-31
rebase api-keys revoke abc123-def456
```

`--scopes` especifica o que a chave pode fazer, separado por vírgulas ou repetido; `--full-access` concede a ela todos os escopos que a chave de serviço possui, exceto `keys:*`. `--roles` adiciona roles de RLS além de `service`, `--expires-in` recebe dias e `--expires-at` uma data ISO. `rebase api-keys scopes` lista todos os escopos conhecidos pelo backend. Uma chave é exibida apenas uma vez. Tanto os escopos da chave quanto a segurança em nível de linha (RLS) da identidade sob a qual ela atua são aplicados. Consulte [Chaves de API](/docs/backend/api-keys/).

### `rebase storage`

Manutenção em todo o armazenamento dos arquivos guardados, por meio do backend em execução com `REBASE_SERVICE_KEY` do `.env`:

```bash
rebase storage orphans                         # files no row names
rebase storage orphans --source media --delete # and delete them, after asking
rebase storage move --from "(default)" --to media --prefix avatars
rebase storage move --from "(default)" --to media --prefix avatars --delete-source
```

`orphans` lê todas as linhas de todas as tabelas conforme armazenadas (linhas excluídas via soft-delete incluídas, ignorando todos os hooks `beforeQuery` e `afterRead`) e todas as entradas do [histórico](/docs/backend/history/), já que uma reversão restaura o que ela contém. Ele lista os arquivos de uma fonte (`--source`, a fonte padrão quando omitida) que nenhuma string em qualquer uma delas referencia: uma chave, uma URL, uma referência `rebase-storage:` em um texto. Arquivos mais recentes do que `--older-than` horas (24 por padrão) são ignorados, pois o painel administrativo faz o upload de um arquivo antes que a linha que o referencia seja salva. A varredura roda no backend em segundo plano, para que um projeto grande demais para ser varrido em uma única requisição (atrás de um ingress que causaria timeout) ainda assim termine. A CLI a inicia e então exibe seu progresso (arquivos listados, linhas lidas, tabelas concluídas e quaisquer que não puderam ser lidas) até ser finalizada. Com a [fila de jobs](/docs/backend/jobs/) ativada, a varredura é um job `storage.orphans` executado pelos workers de jobs. Sem ela, a varredura roda dentro do processo do servidor solicitado, e a CLI informa isso: reiniciar esse processo interrompe a varredura. Uma varredura é uma tentativa de job, limitada por `jobs.timeoutMs` (15 minutos por padrão). Aumente esse valor ou defina como 0 para uma fonte que demore mais. `--json` imprime o mesmo relatório de antes, além de seu `scanId`.

`--delete` pergunta antes de excluir (`--yes` pula a pergunta e é obrigatório sem um terminal). Ele exclui apenas a partir da varredura recém-impressa e apenas dentro de 15 minutos após a conclusão dessa varredura. Nada é excluído enquanto uma tabela não puder ser lida: uma tabela com hooks de leitura em um banco de dados cujo driver não consegue ignorá-los é contabilizada como não lida. Antes de excluir qualquer coisa, o servidor lê novamente cada linha e entrada de histórico confrontando-as com os arquivos listados. Em seguida, ele consulta cada arquivo novamente antes de excluí-lo. Um arquivo que uma linha passe a referenciar agora, que tenha sido carregado novamente desde a varredura ou que já não exista mais é mantido, e a CLI o lista como mantido. Arquivos referenciados apenas por tabelas que o Rebase não atende parecerão não utilizados: verifique antes de excluir. Em relação a um backend da versão 0.25.1 ou anterior, a CLI faz a varredura da maneira antiga, dentro de uma única requisição.

`move` copia os arquivos sob `--prefix` para outra fonte sob as mesmas chaves, uma página por vez. Um arquivo que o destino já possui com o mesmo tamanho é ignorado, de modo que uma movimentação interrompida pode ser retomada executando-a novamente; `--delete-source` exclui cada arquivo da fonte assim que o destino passar a contê-lo, sendo recusado quando as duas fontes armazenarem no mesmo bucket ou diretório. Quando a movimentação termina, a CLI lista a fonte novamente com uma nova varredura e lista cada arquivo que a operação não moveu: com `--delete-source`, qualquer arquivo ainda presente na fonte; sem ela, qualquer arquivo do qual o destino não possua uma cópia com o mesmo tamanho. Ele sai com código 1 caso reste algum arquivo, e executar a mesma movimentação novamente o processará. `--json` os imprime como `notMoved`. Ler o relatório de uma varredura requer `database:read`. Iniciar uma varredura, excluir e mover requerem `database:write`, permissão que a chave de serviço possui.

### `rebase skills install`

Instala as skills de referência do Rebase para seus assistentes de codificação de IA — todas as opções de `--agent` mencionadas acima:

```bash
rebase skills install
rebase skills install --agent claude,cursor
rebase skills install --agent all
rebase skills --hooks
```

Consulte [Skills de Agentes](/docs/ai/skills) para a lista completa e onde os arquivos são gravados.

`--hooks` instala o mecanismo de proteção (guardrail) do Claude Code que o `rebase init` inclui em todos os projetos: `.claude/hooks/post-edit-collection.sh`, registrado como um hook `PostToolUse` em `.claude/settings.json`, que executa `rebase verify --quiet` após cada edição em `backend/schema/` ou `frontend/src/cms/` e repassa qualquer problema de volta ao agente. Configurações e hooks existentes são mantidos. `rebase skills --hooks` instala apenas o hook.

### `rebase telemetry`

Compartilhamento anônimo de uso, desativado até que você concorde. Um `rebase init` interativo pergunta ao final e o prompt tem "não" como padrão, portanto nada é compartilhado a menos que você responda sim. A resposta é por máquina (`~/.rebase/telemetry.json`): após um sim, o `init` nunca mais pergunta; após um não, o próximo `init` perguntará novamente. Cada checkout recebe um ID de projeto aleatório, mantido em seu arquivo ignorado pelo git `.rebase/telemetry-project.json`.

```bash
rebase telemetry status
rebase telemetry show
rebase telemetry enable
rebase telemetry disable
```

`status` exibe a configuração atual, `show` exibe exatamente o que seria enviado — quer o compartilhamento esteja ativado ou não, para que você possa ler o payload antes de decidir — e os outros dois a alteram. Se você nunca executou o `init`, nada foi coletado.

## Próximos passos

- **[Geração de Schemas](/docs/cli/schema/#production-workflow)** — O fluxo de trabalho de migração, desde a edição de uma tabela até a produção
- **[Schema as Code](/docs/architecture/schema-as-code)** — Como funciona a geração de schemas
- **[Início rápido](/docs/getting-started/quickstart)** — Primeiros passos
