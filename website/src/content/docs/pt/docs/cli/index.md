---
sourceHash: c5b8a13884254638
title: Referência da CLI
sidebar_label: CLI
description: Comandos da CLI do Rebase para inicialização de projetos, geração de schema, migrações de banco de dados e geração de SDK.
---

## Visão geral

A CLI do Rebase (`rebase`) gerencia seu projeto desde o scaffolding até a implantação.

## Instalação

```bash
pnpm add -g @rebasepro/cli
```

Ou execute qualquer comando sem instalá-lo: `pnpm dlx @rebasepro/cli <command>`.

## Saída legível por máquina

`--json` é o modificador, e fora da família `cloud` ele é o único: `rebase status`, `rebase resources`, `rebase apps list`, `rebase upgrade` e `rebase verify` enviam um único valor JSON para o stdout — o resultado, ou um envelope `{"error": {"message", "code", "hint", "issues"}}` com um encerramento diferente de zero — em **todas** as finalizações do comando, permitindo que quem o chamou faça o parse do stdout incondicionalmente. Sem ele, eles escrevem texto legível para humanos e as falhas vão para o stderr. O `rebase cloud` usa o mesmo envelope e é a única exceção ao modificador: ele também ativa o JSON automaticamente quando o stdout não é um TTY, ou quando `REBASE_JSON=1` está definido. Portanto, `rebase cloud status | cat` produz JSON enquanto `rebase status | cat` não produz — em um script, passe `--json` explicitamente em vez de depender de qualquer uma das regras.

## Comandos

### `rebase init`

Inicializa um novo projeto Rebase:

```bash
rebase init [directory]
```

Configura um `backend/` (as tabelas em `backend/schema/`) e um `frontend/` (o painel de administração, com suas personalizações de tabela em `frontend/src/cms/`); `--headless` cria o scaffold apenas do `backend/`, sem `backend/schema/`. A [Estrutura do projeto](/docs/getting-started/project-structure/) mostra as duas árvores.

| Flag | O que faz |
|---|---|
| `-t, --template <preset>` | `blog`, `ecommerce` ou `blank`. Padrão `blog` |
| `--headless` | Apenas backend — sem painel de administração e sem `backend/schema/`: o servidor serve as próprias tabelas do banco de dados. `--template` não tem efeito, pois não há tabelas para popular |
| `-y, --yes` | Nunca solicita confirmação. **Obrigatório onde não houver terminal para responder**, como em CI. Ele pula o git init e a instalação de dependências — os padrões interativos respondem sim a ambos, portanto passe `--git` / `--install` se quiser executá-los |
| `-i, --install` | Instala dependências após o scaffolding. Sem ela, o init pergunta (padrão sim); sob `--yes`, nada é instalado |
| `--no-install` | Não instala nada e não pergunta |
| `-g, --git` | Inicializa um repositório e faz o primeiro commit. Sem ela, o init pergunta (padrão sim); sob `--yes`, nenhum repositório é criado |
| `--database-url <url>` | Usa um banco de dados existente em vez do gerenciado. Deve ser uma URL `postgres://` ou `postgresql://`: qualquer outra coisa é recusada antes que um arquivo seja gravado, e o prompt interativo pergunta novamente |
| `--introspect` | Gera `backend/schema` a partir desse banco de dados. Implica `--template blank` e requer `--install` |
| `--project <slug>` | Vincula o scaffold a um projeto do Rebase Cloud |
| `--setup-key <key>` | A chave de uso único que autentica esse vínculo |
| `-a, --agent <name>` | Configura agentes de codificação de IA: as [skills](/docs/ai/skills) e o [servidor MCP](/docs/ai/mcp). Repetível ou separado por vírgula — `claude`, `cursor`, `windsurf`, `gemini`, `codex`, `kiro`, `copilot` ou `all`. Sem ela, o `init` pergunta e marca previamente os agentes instalados na máquina; sob `--yes`, nenhum |

### `rebase dev`

Inicia o servidor de desenvolvimento:

```bash
rebase dev
```

Inicia tanto o frontend quanto o backend com hot reloading e regenera o schema do Drizzle e os tipos do SDK (`generated/sdk/`) na inicialização e a cada salvamento em `backend/schema/`.

Ambas as portas são derivadas do caminho do projeto, para que vários projetos Rebase possam rodar lado a lado. Use as URLs exibidas pelo `rebase dev`. Fixe uma porta com `rebase dev --port 3001`.

Uma aplicação estática no `rebase.json` sem etapa de build (sem `build`, e com `output` sendo sua `root`, como um site HTML simples) é servida pelo backend a partir desse diretório, em seu `path`, da mesma forma que o `rebase start` a serve a partir do bundle, e `FRONTEND_URL` é definida para ela (na porta do backend) para que links enviados por e-mail direcionem para lá. <span class="since-badge" data-since="0.35">Desde 0.35</span> Seus [`redirects` e `cleanUrls`](/docs/architecture/redirects-and-clean-urls/) também são servidos, e uma aplicação que declara redirecionamentos não precisa de `index.html`. Uma aplicação com build é executada no Vite em sua própria porta, e `FRONTEND_URL` assume o valor da do Vite.

Uma edição no `.env` reinicia o backend, que relê o arquivo, assim como o painel de administração faz. O que o `rebase dev` define por conta própria é mantido até que você o reinicie: `PORT`, e `DATABASE_URL` quando estiver no banco de dados gerenciado ou no Docker.

Com `--database-url`, o `rebase dev` primeiro verifica se algo responde naquele host e porta. Se nada responder, ele avisa mencionando a flag e encerra com código `1` sem iniciar nada; ele também não altera as variáveis de ambiente do banco de dados no `.env`, nunca iniciando seu container compose.

### `rebase build`

Compila o projeto em um bundle implantável em `dist-bundle/`:

```bash
rebase build
```

O bundle é o artefato que você implanta — a imagem de runtime o carrega, portanto não há necessidade de compilar uma imagem de aplicação por conta própria. Flags úteis:

| Flag | Efeito |
|------|--------|
| `--output <dir>` (ou `--out`) | Grava o bundle em outro local que não `dist-bundle/` (uma aplicação por vez) |
| `--vendor` | Sempre instala e empacota as dependências do bundle |
| `--no-vendor` | Nunca inclui dependências no bundle; o pod as instala a cada inicialização |
| `--skip-type-check` | Pula a checagem de tipos (mais rápido, menos seguro) |
| `--no-static` | Não embute o frontend no bundle do backend (cada aplicação estática ainda recebe seu próprio bundle) |
| `--skip-static-build` | Embute o frontend como já compilado, sem executar seu comando de build |

Um frontend — cada aplicação estática do `rebase.json` com configuração do Vite — cuja configuração não use `rebaseBackendGuard()` (de `@rebasepro/app/vitePlugin`) é recusado: é isso que mantém o código do servidor fora do bundle do navegador, e impede o Vite de embutir um arquivo do backend como uma URL `data:` (ele falha a compilação, identificando-se, quando outro plugin substitui seu `build.assetsInlineLimit`). `frontend/src/cms/ui-config.json` é transportado para o bundle como `entry.uiConfig`, a apresentação do workspace que um backend implantado serve.

As dependências são incluídas no bundle por padrão para que uma nova instância não sofra uma instalação de 35 a 55 segundos. Uma árvore que ultrapasse 2 GB em disco é descartada, pois o limite de upload é de 1 GB compactado.

Toda aplicação estática transportada pelo bundle recebe uma cópia em brotli (`.br`) e gzip (`.gz`) ao lado de cada ativo com hash de conteúdo de 1 KB ou mais — os arquivos que um navegador armazena em cache por um ano. O runtime envia a que o navegador aceitar, de modo que esses arquivos não gerem trabalho de compressão por requisição, incluindo a primeira visita após um deploy, e navegadores que aceitam brotli o recebem (cerca de 11% menor que o gzip no JavaScript do admin). A saída de compilação do seu próprio frontend é mantida inalterada; apenas a cópia no bundle muda. Na aplicação de exemplo, isso adiciona menos de um segundo à compilação e cerca de 2,4 MB ao bundle.

### `rebase upgrade`

Atualiza todos os pacotes `@rebasepro/*` fixados no projeto para uma única versão e, em seguida, instala com o gerenciador de pacotes especificado no lockfile. O `rebase upgrade` utiliza a versão mais recente; `--to 0.21.0` define uma versão exata, sem consulta ao registro; `--to canary` define uma dist-tag. Cada fixação em `dependencies`, `devDependencies` e `optionalDependencies`, em todo `package.json` do projeto, mantém seu `^` ou `~`, e nada mais no arquivo é alterado. `peerDependencies` e especificações `workspace:`, `link:`, `file:`, git e tags são listadas e deixadas intactas. Substituições (overrides) em `pnpm-workspace.yaml` e `package.json` também são atualizadas, mas um override `link:` ou `file:` tem precedência sobre qualquer fixação: ele é relatado e `--drop-local-overrides` o remove. `--dry-run` não grava nada, `--no-install` pula a instalação e `--json` imprime um único documento.

Um projeto em uma versão de pré-lançamento, como uma canary, permanece em seu canal, a menos que `latest` seja mais recente. Uma dist-tag que moveria uma versão para trás é recusada (`downgrade_refused` sob `--json`), a menos que você passe `--allow-downgrade`; um `--to` exato é aplicado e sinalizado como downgrade. Um `--dry-run` de uma atualização que a execução real recusaria mostra o que mudaria e encerra com código 0; sob `--json`, seu documento traz a recusa como `wouldRefuse` (`{ code, message, hint }`).

### `rebase start`

Executa o bundle compilado da mesma forma que uma implantação o executa:

```bash
rebase start
```

Lê o `PORT` e o restante do `.env`, diferentemente do `rebase dev`, no `NODE_ENV` definido por eles. Um `.env` gerado por scaffold define `development`, de modo que a primeira conta registrada ainda se torna a administradora, e o `rebase start` informa isso no topo; defina `NODE_ENV=production` para um servidor de produção. `rebase start --bundle ./dist-bundle` executa um bundle em outro local.

O `rebase start` não inicia nenhum banco de dados, e o `.env` do scaffold não possui `DATABASE_URL`, portanto, uma execução local no banco de dados que o `rebase dev` usa é feita com `DATABASE_URL="$(rebase db url)" rebase start`. Sem isso, ele imprime essa linha antes de inicializar.

### `rebase apps list`

Mostra as aplicações que este repositório declara:

```bash
rebase apps list
```

Um repositório pode declarar mais de uma aplicação implantável — um backend e um site de marketing, por exemplo. É assim que você vê sobre o que o `rebase build` e a implantação irão agir.

### `rebase eject`

Assume o controle do processo do servidor e de sua imagem:

```bash
rebase eject
```

Grava o ponto de entrada do backend e um `Dockerfile` no projeto e transfere o controle do backend, para que o repositório crie sua própria imagem em vez de executar o runtime publicado. A partir de então, **as atualizações do runtime da plataforma não o alcançarão mais**, e CORS, configuração de autenticação, armazenamento e encerramento passam a ser de sua responsabilidade de configuração.

Visualize previamente com `rebase eject --dry-run`, que lista o que mudaria sem alterar nada. `--force` substitui um `backend/src/index.ts` ou `env.ts` existente, mantendo o arquivo atual como `<name>.bak`.

O servidor ejetado mantém os uploads locais em `uploads/` do projeto, executado a partir do código-fonte ou compilado, assim como faz o `rebase dev`. Ele roda em `backend/`, portanto, um `STORAGE_PATH` relativo ali é lido a partir de `backend/`.

### `rebase schema generate` / `rebase schema stale`

```bash
rebase schema generate       # backend/schema → backend/src/schema.generated.ts
rebase schema stale          # indica o que difere das tabelas, encerra com 1 se houver divergências
rebase schema stale --fix    # regenera o arquivo
```

Todo comando que lê o schema aceita `--schema-dir <dir>` para projetos que o mantêm em outro lugar; `--collections` foi removido. O `rebase dev` mantém o arquivo atualizado, portanto `stale` é a verificação ideal para um build ou CI. Consulte [Geração de Schema](/docs/cli/schema/).

### `rebase db`

```bash
rebase db push                 # aplica as tabelas ao banco de dados (desenvolvimento)
rebase db generate             # cria um arquivo de migração SQL
rebase db migrate              # aplica as migrações pendentes
rebase db url                  # imprime a string de conexão utilizada por este projeto
rebase db pull --from <url>    # copia outro banco de dados para o local
rebase db backup               # pg_dump; db backups list e db restore também disponíveis
rebase db branch create <name> # uma cópia para trabalhar; switch, list e prune também disponíveis
rebase db stop                 # para o banco de dados de desenvolvimento gerenciado
rebase db reset                # apaga o banco de dados e recomeça do zero
rebase db request-role migrate --to <role> # move as requisições para outra role do Postgres
rebase db provision --print    # o SQL que configura a role de requisições, para um DBA
```

Cada um deles está documentado em [Comandos de Banco de Dados](/docs/cli/database/), com a ordem na qual o comando seleciona seu banco de dados; `push`, `generate` e `migrate` são abordados em detalhes em [Geração de Schema](/docs/cli/schema/).

### `rebase console`

Um REPL do Node com os dados do projeto carregados, ou um snippet executado com `-e`:

```bash
rebase console
rebase console -e "rebase.dataAsAdmin.posts.find({ limit: 5 })"
```

`rebase` (`dataAsAdmin`, `sql`, `withAuth(user)`) e `tables` (as tabelas do projeto, carregadas de `backend/schema`) estão no escopo, e o `await` de nível superior funciona. O banco de dados é resolvido da mesma forma que o `rebase db push` o resolve, e abri-lo não altera nada nele. Com `-e`, o resultado aguardado é impresso como JSON no stdout e um erro lançado encerra com `1`. Flags: `--eval`/`-e`, `--schema-dir`, `--database-url`, `--docker`. Consulte [Scripts e o Console](/docs/backend/scripts/).

### `rebase migrate`

Migrações unidirecionais a partir de uma estrutura que esta versão não lê mais: `rebase migrate collections-to-tables` (`config/collections` → `backend/schema` e `frontend/src/cms`) e `rebase migrate sdk-calls` (`data.collection("x")` → `data.table("x")` em seu próprio código). Suas flags, o que elas gravam e a seção "Revisar antes de implantar" estão em [Geração de Schema](/docs/cli/schema/#rebase-migrate).

### `rebase apps init` / `rebase apps config`

```bash
rebase apps list             # as aplicações que este projeto declara
rebase apps init             # grava um rebase.json inferido a partir deste projeto
rebase apps config <app>     # a configuração de cliente para uma aplicação
```

`apps init` não aceita nome: ele infere todas as aplicações a partir do projeto e grava o `rebase.json` completo, recusando-se a substituir um existente a menos que você passe `--force`.

Um argumento de nome é recusado. `--force` mantém o que a inferência não consegue descobrir a partir do arquivo que substitui: o nome de cada aplicação, seu `path` e sua rota de `cms`. Todo o restante é inferido novamente, e uma aplicação declarada que não seja mais encontrada é listada como removida, portanto, em um scaffold ele regrava o `rebase.json` original. O comando de build da aplicação estática usa o gerenciador de pacotes do projeto.

Para um checkout não vinculado a um projeto Cloud, o `apps config` informa que ele não está vinculado, quer o `rebase dev` esteja em execução ou não, e fornece a URL do backend conforme servida pelo `rebase dev`.

### `rebase apps add admin`

```bash
rebase apps add admin                  # em /, ou em /admin quando outra aplicação estiver em /
rebase apps add admin --path /console  # em qualquer outro lugar, ou uma URL https própria
```

Adiciona o painel de administração a um projeto headless ou portado, conforme o `rebase init` o teria criado. O que ele grava, qual versão ele fixa e quando recusa a execução: [Adicionando um painel de administração posteriormente](/docs/getting-started/headless/#adding-an-admin-panel-later).

### `rebase status`

Tudo o que este projeto declara e se o ambiente realmente faz o bind correspondente:

```bash
rebase status               # cada recurso e as variáveis que ele lê
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

Três arquivos decidem o que um backend pode alcançar, e este comando imprime os três juntos: `rebase.json` define onde seu código está e quem executa o servidor, `backend/resources.ts` define o que o projeto precisa, e o ambiente define como alcançar cada coisa. Todo o restante — `rebase.resources.json`, o manifesto do bundle — é gerado a partir do intermediário para leitores que não podem executar seu código, e você nunca precisa escrevê-lo manualmente.

Um `○` representa o estado que vale a pena conhecer antes de uma implantação em vez de depois: declarado, não configurado. Um `✗` significa que o ambiente configurou algo de forma *incorreta*, o que impede a inicialização em vez de degradar graciosamente.

Um `rebase.resources.json` que não corresponda mais às declarações recebe uma linha com `○`. Um que ainda não tenha sido gerado não recebe: `rebase build` o grava a cada compilação, portanto, um projeto que nunca foi compilado, como um scaffold recém-criado, não tem nada a corrigir.

### `rebase resources`

O que este projeto declara como necessário — os bancos de dados, buckets, tópicos e filas solicitados por `backend/resources.ts`, e os crons e funções definidos por seus arquivos:

```bash
rebase resources            # lista-os
rebase resources --write    # regenera rebase.resources.json
rebase resources --check    # falha se o grafo versionado estiver desatualizado
rebase resources --json     # legível por máquina
```

`rebase resources --check` é a flag que um job de CI usa para falhar em caso de um `rebase.resources.json` que não coincida mais com `backend/resources.ts`. `--json` pode ser combinado com ela: havendo divergência, `rebase resources --check --json` encerra com código 1 e um envelope de erro (`resource_graph_missing` ou `resource_graph_stale`), e em caso de sucesso o grafo traz `check.status`. `--write --json` grava o arquivo e relata `written.changed`.

Um recurso é declarado em `backend/resources.ts` — `database("analytics")`, `bucket("media")`, `topic("signups")`, `queue("thumbnails")` — ou é um arquivo sob `backend/crons` ou `backend/functions`, e nunca é escrito manualmente em `rebase.resources.json`, que é gerado a partir dessas declarações para que um host possa ler o que o projeto precisa sem precisar compilá-lo. Cada entrada registra quem o utiliza (`table:events`, `column:posts.cover`, `function:report`).

Um backend também possui um banco de dados padrão e uma fonte de armazenamento padrão que ninguém declara. Ambos são listados aqui, marcados como `implicit`, e nenhum deles é gravado em `rebase.resources.json` — o host os fornece, portanto registrá-los solicitaria o provisionamento de algo que ninguém pediu. Declarar um recurso nomeado, como `bucket("media")`, mantém o padrão inalterado, de modo que ambos são listados. Apenas declarar o padrão explicitamente, ou marcar um bucket como `default: true`, o substitui.

Para ver o que a plataforma mantém para um projeto em comparação com o que o código declara, e para remover um banco de dados provisionado que o código não menciona mais, consulte [`rebase cloud resources`](/docs/cli/cloud#resources).

`rebase cloud` — todos os comandos para o Rebase Cloud: autenticação, vínculo de projeto, implantações, configuração, bancos de dados, recursos, computação e mais — tem [sua própria página](/docs/cli/cloud).

### `rebase generate-sdk`

```bash
rebase generate-sdk
```

Grava um cliente tipado para as tabelas exportadas por `backend/schema/index.ts` em `generated/sdk/`, com `TableName` e `tablesDictionary`; `--from <link|url>` lê o contrato de um backend em execução. `--register` também tipa dados no lado do servidor: ele grava os tipos e a declaração `Register` em `backend/generated/` e a armazena em `rebase.json` (`registerDatabase`). Consulte [Dados tipados no lado do servidor](/docs/backend/typed-server-data) e [Geração de Schema](/docs/cli/schema/#rebase-generate-sdk).

### `rebase doctor`

```bash
rebase doctor
```

O comando para executar quando algo estiver errado e você ainda não souber o quê. Ele relata os problemas e nunca altera nada, portanto é seguro executá-lo contra qualquer banco de dados acessível.

**Sem banco de dados.** Estas verificações são executadas primeiro, porque tudo o que impede um projeto de funcionar ocorre antes mesmo que uma tabela possa ser comparada:

| Verificação | Motivo |
| --- | --- |
| Versão do Node | Comparada com a faixa declarada pela CLI. Uma versão muito antiga não é relatada como "Node não suportado" — trata-se de um erro de sintaxe dentro de uma dependência. |
| Gerenciadores de pacotes | Dois arquivos de lockfile em um mesmo projeto. Executar `npm install` em um workspace pnpm reestrutura o `node_modules` de uma forma incompatível com o pnpm, e o sintoma é `Cannot find module` horas depois. |
| Slugs duplicados | Duas tabelas declarando o mesmo slug. O schema se recusa a compilar nessa condição, e isto aponta ambas. |
| Sanidade do `.env` | Um `JWT_SECRET` com menos de 32 caracteres (o qual a produção se recusa a inicializar), e `NODE_ENV=production` sem `CORS_ORIGINS` nem `FRONTEND_URL`. Os valores nunca são impressos. |
| Divergência de versão de `@rebasepro/*` | O mesmo pacote fixado em versões diferentes nos arquivos `package.json` do projeto. Duas cópias quebram o `instanceof` entre elas, o que falha como um type guard rejeitando seu próprio tipo. |
| Strings de conexão | Um `=` não codificado em um parâmetro de URL, que as próprias ferramentas do PostgreSQL se recusam a interpretar — fazendo com que backups e o `psql` quebrem enquanto a aplicação continua funcionando. |
| Funções customizadas | O que cada função precisa do host, e quais delas não rodariam em um runtime edge. |

**Contra o banco de dados** — o do próprio projeto, resolvido da forma como o `rebase db url` o resolve; logo, em um scaffold novo, é o banco de dados gerenciado, que o `doctor` inicializa:

| Verificação | Motivo |
| --- | --- |
| Tabelas → schema gerado | Se o `schema.generated.ts` está desatualizado. |
| Tabelas → banco de dados | Tabelas, colunas, enums, chaves estrangeiras e tabelas de junção ausentes. |
| Extensões necessárias | Uma coluna `col.vector()` necessita do pgvector, que o Rebase instala apenas onde o projeto o declarou. |
| Carimbo do schema (stamp) | Se este banco de dados foi provisionado a partir destas tabelas. É um hash, portanto pode indicar que os dois discordam, mas nunca qual está à frente. Um carimbo `v1:` de um runtime anterior ao 0.31 é relatado uma vez, com a revalidação: `rebase db push`. |
| Tabelas → tipos do SDK | Se o SDK tipado gerado está desatualizado. |
| Políticas de RLS | Se as políticas do banco de dados coincidem com o `rls` declarado, e se alguma política menciona uma role que este servidor não pode usar. |

Se o banco de dados estiver inacessível, suas etapas são relatadas como ignoradas informando o motivo, e o restante continua em execução — consulte [Solução de Problemas](/docs/troubleshooting/).

Encerra com código diferente de zero quando uma verificação encontra um erro, ou quando uma etapa não pôde ser executada porque o banco de dados fornecido recusa conexões. Uma etapa ignorada porque nenhum banco de dados pôde ser resolvido não é considerada falha.

`rebase doctor --policies` executa apenas as verificações de RLS — sem diff de schema, sem tipos de SDK — e falha preventivamente (fails closed), o que o torna a forma ideal para ser usada como verificação de segurança em CI contra um banco de dados em produção.

`rebase doctor --database` executa apenas a checagem prévia do banco de dados: se a role sob a qual as requisições autenticadas rodam existe, se é restrita e pode ser assumida, quais outros logins podem alternar para ela, se todas as roles podem se conectar e quais tabelas, permissões e políticas o Rebase compartilharia com outras roles. Cada descoberta informa o SQL a ser executado como administrador, a configuração de `rls` que adapta o Rebase ao banco de dados, ou ambos. Ele lê o catálogo e não altera nada, encerrando com código 1 quando um problema for uma falha. Funciona também em projetos headless. Consulte [Executando em um banco de dados existente ou compartilhado](/docs/deployment/existing-database/).

### `rebase verify`

```bash
rebase verify
rebase verify --json
rebase verify --live
rebase verify --live --database-url postgresql://…
```

Verifica se as tabelas estão seguras para envio, em um comando rápido para CI e hooks de agentes de IA. Funciona offline por padrão e nunca altera nada.

| Etapa | O que causa falha |
| --- | --- |
| Definições de tabela (`schema`) | `backend/schema` não carrega ou não compila através do loader com o qual o backend inicializa: uma relação com uma tabela que o index não exporta, `rls: "inherit"` sem `defaultRls`, uma tabela sem chave primária — uma ocorrência por problema. Uma tabela sem `rls` é uma delas. |
| Cobertura de RLS (`rls`) | Uma tabela com uma coluna `user_id`, `owner_id`, `organization_id` ou `tenant_id` cujas regras — próprias ou herdadas de `defaultRls` — permitem que uma role leia todas as linhas independentemente disso. Gera um aviso. `rls-policy-recursion`: uma regra que lê sua própria tabela em uma subconsulta, ou duas tabelas cujas regras leem uma à outra, o que o Postgres se recusa a expandir, fazendo com que cada instrução protegida por ela falhe com `42P17 infinite recursion detected in policy`; o relatório aponta a tabela lida e a solução, que consiste em mover a leitura para uma função `SECURITY DEFINER`. Trata-se de um erro, ou um aviso quando o loop não for garantido. |
| Atualização das migrações (`migrations`) | Uma tabela ou coluna declarada nas tabelas que nenhum arquivo em `backend/drizzle/migrations` cria, ou uma removida por elas que uma migração ainda cria. Ignorado em projetos que ainda não possuem migrações. |
| Customizações do CMS (`cms`) | Um `customizeTable(...)` em `frontend/src/cms` (ou no `src/cms` de uma aplicação estática em `rebase.json`) que não corresponde às tabelas, lido estaticamente — os módulos não são executados. `cms-unknown-table`: o slug não corresponde a nenhuma tabela, fazendo com que o painel o ignore (o slug mais próximo é sugerido). `cms-unknown-field`: uma chave sob `fields` não é nem coluna nem relação (o nome SQL de uma coluna é retornado com sua chave). `cms-hidden-required`: um campo omitido do formulário (`hiddenInForm`, `readOnly`, `disabled`) cuja coluna é `NOT NULL` sem valor padrão e sem preenchimento pelo servidor, de modo que criar um registro a partir do painel sempre falha; gera aviso quando um hook `beforeSave` ou transformação puder preenchê-lo, e é silenciado por `filledByServer`. `cms-duplicate-customization`: um mesmo slug customizado duas vezes. `cms-not-static` (aviso): uma chamada cujo slug, opções ou `fields` não são literais ou uma constante no mesmo arquivo, portanto nada nela foi verificado. `cms-ui-config-not-mounted` (aviso): `frontend/src/cms/ui-config.json` existe, mas não foi passado para `<RebaseCMS>` como `uiConfig`. `cms-backend-guard-missing`: a configuração do Vite no frontend não utiliza `rebaseBackendGuard()`, portanto o `rebase build` a recusaria. Um projeto headless não possui `frontend/src/cms` e pula esta etapa. |
| Auditoria de RLS ao vivo (`live`) | Com `--live`: o catálogo [`rls-check`](/docs/rls-check) contra o banco de dados do projeto e se todas as migrações foram aplicadas. O banco de dados é resolvido da mesma forma que os comandos `db` resolvem — `--database-url`, `DATABASE_URL`, `--docker`, ou o banco de dados de desenvolvimento gerenciado. Um banco de dados não configurado ou que não responde é tratado como erro, e não como etapa ignorada: afinal, a auditoria foi solicitada explicitamente. Uma política de leitura `USING (true)` compilada de uma regra `access: "public"` gera um aviso enquanto a API exigir token (`AUTH_REQUIRE`, ativado por padrão) — todo usuário autenticado lê todas as linhas — e gera um erro com `AUTH_REQUIRE=false`, onde as linhas são anônimas. |

`--json` imprime um objeto único, `{ ok, schemaDir, steps, findings, summary }`: cada etapa é `{ id, title, status, detail? }` (`status` pode ser `passed`, `failed`, `warnings` ou `skipped`), e cada problema encontrado traz `step`, `check` (um identificador estável em kebab-case), `severity`, `message` e, quando aplicável, `fix`, `table`, `file`, `line` e o caminho pontuado (`path`) na tabela (`posts.rls[0]`) — permitindo que um agente repare o que quebrou. O `summary` contabiliza `errors` e `warnings`. `--quiet` não imprime nada quando tudo passa. Encerra com código diferente de zero em caso de erro; avisos não causam falha.

Um projeto criado via scaffold executa essa verificação para o Claude Code após cada edição em `backend/schema/`: consulte [`rebase skills install`](#rebase-skills-install).

### Comandos para uma aplicação em execução

`rebase api`, `rebase data`, `rebase users`, `rebase cron`, `rebase logs`, `rebase functions`, `rebase rls simulate`, `rebase auth login` e `rebase storage ls|cp|rm|url|stat` atuam em uma aplicação em execução por meio de sua API: o `rebase dev` local, um servidor indicado via `--url`, ou um projeto Rebase Cloud com `--project`. Consulte [Uma aplicação em execução](/docs/cli/project/).

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

`--scopes` define o que a chave pode fazer, separado por vírgulas ou repetido; `--full-access` concede todos os escopos que a chave de serviço possui, exceto `keys:*`. `--roles` adiciona roles de RLS além de `service`, `--expires-in` aceita dias e `--expires-at` uma data em formato ISO. O comando `rebase api-keys scopes` lista todos os escopos conhecidos pelo backend. Uma chave é exibida apenas uma vez. Tanto os escopos da chave quanto a segurança em nível de linha (RLS) da identidade sob a qual ela atua são aplicados. Consulte [Chaves de API](/docs/backend/api-keys/).

### `rebase storage`

Manutenção global dos arquivos armazenados, por meio do backend em execução com a variável `REBASE_SERVICE_KEY` do `.env`:

```bash
rebase storage orphans                         # arquivos não referenciados por nenhuma linha
rebase storage orphans --source media --delete # e os remove, após confirmação
rebase storage move --from "(default)" --to media --prefix avatars
rebase storage move --from "(default)" --to media --prefix avatars --delete-source
```

O comando `orphans` lê cada linha de cada tabela conforme armazenada (incluindo linhas excluídas via soft-delete, ultrapassando todos os hooks `beforeQuery` e `afterRead`) e cada entrada de [histórico](/docs/backend/history/), já que uma reversão restaura o que ela continha. Ele lista os arquivos de uma fonte (`--source`, a fonte padrão se omitida) que nenhuma string em nenhum desses registros referencia: uma chave, uma URL, uma menção a `rebase-storage:` em um texto. Arquivos mais novos que `--older-than` horas (24 por padrão) são deixados de fora, pois o painel administrativo faz o upload de um arquivo antes que a linha que o referencia seja salva. A varredura é executada no backend em segundo plano, portanto, um projeto grande demais para ser varrido em uma única requisição (atrás de um ingress com timeout) ainda assim é concluído. A CLI a inicia e exibe seu progresso (arquivos listados, linhas lidas, tabelas concluídas e quaisquer que não puderam ser lidas) até o término. Com a [fila de jobs](/docs/backend/jobs/) ativada, a varredura se torna um job `storage.orphans` processado pelos workers de job. Sem ela, a varredura é executada dentro do processo do servidor que recebeu a requisição, e a CLI informa isso: reiniciar esse processo interrompe a varredura. Uma varredura é uma tentativa de job, limitada por `jobs.timeoutMs` (15 minutos por padrão). Aumente esse valor ou defina-o como 0 para uma fonte que exija mais tempo. `--json` imprime o mesmo relatório de antes, além de seu `scanId`.

`--delete` pede confirmação antes de excluir (`--yes` pula a pergunta e é obrigatório sem terminal). Ele exclui apenas a partir da varredura que acabou de ser impressa e somente dentro de 15 minutos após a conclusão dessa varredura. Nada é excluído enquanto uma tabela não puder ser lida: uma tabela com hooks de leitura em um banco de dados cujo driver não consegue contorná-los é contabilizada como não lida. Antes de excluir qualquer coisa, o servidor relê cada linha e entrada de histórico confrontando-as com os arquivos listados. Em seguida, solicita cada arquivo novamente imediatamente antes de excluí-lo. Um arquivo referenciado por uma linha agora, que tenha sido reenviado desde a varredura ou que tenha desaparecido é mantido, e a CLI o lista como mantido. Arquivos referenciados apenas por tabelas que o Rebase não gerencia parecerão não utilizados: verifique antes de excluir. Em um backend da versão 0.25.1 ou anterior, a CLI faz a varredura à maneira antiga, dentro de uma única requisição.

`move` copia os arquivos sob `--prefix` para outra fonte mantendo as mesmas chaves, uma página por vez. Um arquivo que o destino já possui com o mesmo tamanho é ignorado, de modo que uma transferência interrompida pode ser retomada executando o comando novamente; `--delete-source` exclui cada arquivo da origem assim que o destino passa a contê-lo, sendo recusado quando ambas as fontes usam o mesmo bucket ou diretório. Quando a transferência é concluída, a CLI lista a origem novamente com uma nova verificação e indica todos os arquivos que a operação não moveu: com `--delete-source`, qualquer arquivo que ainda permaneça na origem; sem ela, qualquer arquivo cujo destino não possua uma cópia com o mesmo tamanho. O comando encerra com 1 caso haja algum, e executar a mesma movimentação novamente tentará transferi-lo. `--json` os imprime como `notMoved`. Ler o relatório de uma varredura requer `database:read`. Iniciar uma varredura, excluir e mover exigem `database:write`, que a chave de serviço possui.

### `rebase skills install`

Instala as skills de referência do Rebase para seus assistentes de codificação com IA — todos os especificados em `--agent` acima:

```bash
rebase skills install
rebase skills install --agent claude,cursor
rebase skills install --agent all
rebase skills --hooks
```

Consulte [Skills do Agente](/docs/ai/skills) para obter a lista completa e onde os arquivos são gravados.

`--hooks` instala a proteção para Claude Code que o `rebase init` inclui em cada projeto: `.claude/hooks/post-edit-collection.sh`, registrado como um hook `PostToolUse` em `.claude/settings.json`, que executa `rebase verify --quiet` após cada edição em `backend/schema/` ou `frontend/src/cms/` e devolve qualquer problema ao agente. Configurações e hooks existentes são preservados. O comando `rebase skills --hooks` instala apenas o hook.

### `rebase telemetry`

Compartilhamento anônimo de uso, desativado até que você concorde. Um `rebase init` interativo pergunta ao final, e a resposta padrão no prompt é não, portanto, nada é compartilhado a menos que você responda afirmativamente. A resposta é configurada por máquina (`~/.rebase/telemetry.json`): após um sim, o `init` nunca mais pergunta, e após um não, o próximo `init` pergunta novamente. Cada checkout recebe um ID de projeto aleatório, mantido em seu arquivo ignorado pelo git `.rebase/telemetry-project.json`.

```bash
rebase telemetry status
rebase telemetry show
rebase telemetry enable
rebase telemetry disable
```

`status` imprime a configuração atual, `show` exibe exatamente o que seria enviado — quer o compartilhamento esteja ativo ou não, permitindo que você leia o payload antes de decidir — e os outros dois alteram a configuração. Se você nunca executou o `init`, nada jamais foi coletado.

## Próximos passos

- **[Geração de Schema](/docs/cli/schema/#production-workflow)** — O fluxo de trabalho de migrações, desde a edição de uma tabela até a produção
- **[Schema as Code](/docs/architecture/schema-as-code)** — Como funciona a geração de schema
- **[Início Rápido](/docs/getting-started/quickstart)** — Comece a usar o Rebase
