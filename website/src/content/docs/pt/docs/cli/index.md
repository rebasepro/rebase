---
sourceHash: 174c7e210e0d7d49
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

`--json` é o modificador, e fora da família `cloud` ele é o único: `rebase status`, `rebase resources`, `rebase apps list`, `rebase upgrade` e `rebase verify` colocam então um único valor JSON no stdout — o resultado, ou um envelope `{"error": {"message", "code", "hint", "issues"}}` com um código de saída diferente de zero — em **cada** encerramento do comando, para que o chamador possa analisar o stdout incondicionalmente. Sem ele, eles exibem texto legível por humanos e as falhas vão para o stderr. O `rebase cloud` usa o mesmo envelope e é a única exceção ao modificador: ele também ativa o JSON automaticamente quando o stdout não for um TTY, ou quando `REBASE_JSON=1` estiver definido. Assim, `rebase cloud status | cat` resulta em JSON, enquanto `rebase status | cat` não — em um script, passe `--json` explicitamente em vez de depender de qualquer uma das regras.

## Comandos

### `rebase init`

Inicialize um novo projeto Rebase:

```bash
rebase init [directory]
```

Configura um `backend/` (as tabelas em `backend/schema/`) e um `frontend/` (o painel de administração, com suas customizações de tabela em `frontend/src/cms/`); `--headless` faz o scaffolding apenas do `backend/`, sem `backend/schema/`. A [Estrutura do projeto](/docs/getting-started/project-structure/) mostra ambas as árvores de arquivos.

| Flag | O que faz |
|---|---|
| `-t, --template <preset>` | `blog`, `ecommerce` ou `blank`. Padrão `blog` |
| `--headless` | Apenas backend — sem painel de administração e sem `backend/schema/`: o servidor serve as próprias tabelas do banco de dados. `--template` não tem efeito, pois não há tabelas para popular |
| `-y, --yes` | Nunca perguntar. **Obrigatório onde não houver terminal para responder**, como no CI. Ignora o git init e a instalação de dependências — os padrões interativos dizem sim para ambos, portanto passe `--git` / `--install` se desejar executá-los |
| `-i, --install` | Instala dependências após o scaffolding. Sem ela, o init pergunta (padrão sim); sob `--yes`, nada é instalado |
| `--no-install` | Não instala nada e não pergunta |
| `-g, --git` | Inicializa um repositório e faz o primeiro commit. Sem ela, o init pergunta (padrão sim); sob `--yes`, nenhum repositório |
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

Inicia tanto o frontend quanto o backend com hot reloading e regenera o schema do Drizzle e os tipos do SDK (`generated/sdk/`) na inicialização e a cada salvamento sob `backend/schema/`.

Ambas as portas são derivadas do caminho do projeto, para que vários projetos Rebase possam rodar
lado a lado. Use as URLs que o `rebase dev` exibe. Fixe uma com `rebase dev --port 3001`.

Uma aplicação estática no `rebase.json` sem etapa de build (sem `build`, e o `output` é
a sua `root`, como um site HTML simples) é servida pelo backend a partir desse
diretório, em seu `path`, assim como `rebase start` a serve a partir do bundle, e
`FRONTEND_URL` é definida para ela (na porta do backend) para que links enviados por e-mail caiam lá.
<span class="since-badge" data-since="0.35">Desde 0.35</span> Seus [`redirects` e `cleanUrls`](/docs/architecture/redirects-and-clean-urls/) também são servidos, e uma aplicação que declara redirecionamentos não precisa de `index.html`.
Uma aplicação com build é executada no Vite em sua própria porta, e `FRONTEND_URL` é a do Vite.

Uma edição no `.env` reinicia o backend, que lê o arquivo novamente, da mesma forma que o painel de administração faz. O que
o `rebase dev` define por si mesmo é mantido até que você o reinicie: `PORT`, e
`DATABASE_URL` quando estiver no banco de dados gerenciado ou no Docker.

Com
`--database-url`, o `rebase dev` primeiro verifica se algo responde naquele host
e porta. Se nada responder, ele avisa mencionando a flag e sai com código `1` sem
nada iniciado; ele também deixa os nomes do banco de dados no `.env` intocados, nunca iniciando
seu contêiner compose.

### `rebase build`

Compila o projeto em um bundle implantável em `dist-bundle/`:

```bash
rebase build
```

O bundle é o artefato que você implanta — a imagem de runtime o carrega, de modo que não há
imagem de aplicação para você mesmo compilar. Flags úteis:

| Flag | Efeito |
|------|--------|
| `--output <dir>` (ou `--out`) | Escreve o bundle em outro lugar que não seja `dist-bundle/` (uma aplicação por vez) |
| `--vendor` | Sempre instala e inclui as dependências do bundle |
| `--no-vendor` | Nunca faz vendoring; o pod as instala a cada inicialização |
| `--skip-type-check` | Pula a checagem de tipos (mais rápido, menos seguro) |
| `--no-static` | Não embute o frontend no bundle do backend (cada aplicação estática ainda ganha seu próprio bundle) |
| `--skip-static-build` | Embute o frontend como já compilado, sem executar seu comando de build |

Um frontend — qualquer aplicação estática do `rebase.json` com uma configuração do Vite — cuja configuração não use `rebaseBackendGuard()` (de
`@rebasepro/app/vitePlugin`) é recusado: é ele quem mantém o código do servidor fora do
bundle do navegador e impede o Vite de embutir um arquivo do backend como uma URL `data:`
(ele falha o build, identificando a si mesmo, quando outro plugin substitui seu
`build.assetsInlineLimit`). `frontend/src/cms/ui-config.json` é transportado para o bundle como
`entry.uiConfig`, a apresentação do workspace que um backend implantado serve.

As dependências são incluídas via vendor por padrão para que uma nova instância não precise passar por uma
instalação de 35 a 55 segundos. Uma árvore que ultrapasse 2 GB no disco é descartada,
pois o limite de upload é de 1 GB comprimido.

Toda aplicação estática que o
bundle transporta recebe uma cópia brotli (`.br`) e uma gzip (`.gz`) ao lado de cada
asset com hash de conteúdo de 1 KB ou mais — os arquivos que um navegador armazena em cache por um ano.
O runtime envia aquele que o navegador aceita, de modo que esses arquivos não demandam trabalho
de compressão por requisição, inclusive na primeira visita após um deploy, e
navegadores que aceitam brotli o recebem (cerca de 11% menor que o gzip no
JavaScript do admin). A saída de build do próprio frontend permanece inalterada; apenas a cópia
no bundle muda. No aplicativo de exemplo, isso adiciona menos de um segundo ao build
e cerca de 2,4 MB ao bundle.

### `rebase upgrade`

Atualiza todos os pacotes `@rebasepro/*` fixados pelo projeto para uma versão específica e,
em seguida, instala usando o gerenciador de pacotes indicado pelo arquivo de lock. O `rebase upgrade` escolhe a
versão mais recente; `--to 0.21.0` uma versão exata, sem consulta ao registro; `--to canary` uma
dist-tag. Cada versão fixada em `dependencies`, `devDependencies` e
`optionalDependencies`, em cada `package.json` do projeto, mantém seu `^`
ou `~`, e nada mais no arquivo é alterado. `peerDependencies` e
especificações `workspace:`, `link:`, `file:`, git e de tags são listadas e mantidas intactas.
Overrides em `pnpm-workspace.yaml` e `package.json` também são atualizados, mas um override `link:` ou
`file:` tem precedência sobre qualquer versão fixada: ele é reportado e
`--drop-local-overrides` o remove. `--dry-run` não escreve nada, `--no-install`
pula a instalação e `--json` imprime um único documento.

Um projeto em uma versão de pré-lançamento, como uma canary, permanece em seu canal, a menos que a `latest`
seja mais recente. Uma dist-tag que moveria uma versão fixada para trás é recusada
(`downgrade_refused` sob `--json`), a menos que você passe `--allow-downgrade`; um
`--to` exato é aplicado e marcado como downgrade. Um `--dry-run` de um upgrade que a
execução real recusaria mostra o que seria movido e sai com código 0, e sob `--json` seu
documento traz a recusa como `wouldRefuse` (`{ code, message, hint }`).
Uma vez instalado, ele também atualiza as [agent skills](/docs/ai/skills/#updating-the-skills) do projeto a partir da nova CLI (`skills` no documento `--json`). Outros comandos terminam com uma linha no stderr quando uma versão mais recente for lançada; [`REBASE_NO_UPDATE_CHECK=1`](/docs/getting-started/configuration/) oculta essa mensagem.

### `rebase start`

Executa o bundle compilado da mesma forma que um deploy o executa:

```bash
rebase start
```

Lê `PORT` e o restante do `.env`, ao contrário de `rebase dev`, no `NODE_ENV` que
estiver definido. Um `.env` criado via scaffold define `development`, portanto a primeira conta a se registrar
ainda se torna o administrador, e o `rebase start` informa isso no topo; defina `NODE_ENV=production`
para um servidor de produção. `rebase start --bundle ./dist-bundle` executa um bundle em outro local.

O `rebase start` não inicia nenhum banco de dados, e o `.env` do scaffold não tem
`DATABASE_URL`, portanto uma execução local no banco de dados que o `rebase dev` usa é
`DATABASE_URL="$(rebase db url)" rebase start`.
Sem uma URL, ele imprime essa linha antes de inicializar.

### `rebase apps list`

Mostra as aplicações que este repositório declara:

```bash
rebase apps list
```

Um repositório pode declarar mais de uma aplicação implantável — um backend e um site
de marketing, por exemplo. É assim que você vê sobre o que o `rebase build` e o deploy agirão.

### `rebase eject`

Assume o controle do processo do servidor e de sua imagem:

```bash
rebase eject
```

Escreve o ponto de entrada do backend e um `Dockerfile` no projeto e transfere o controle do seu
backend, de modo que o repositório compila sua própria imagem em vez de executar o
runtime publicado. A partir de então, **as atualizações do runtime da plataforma não o alcançarão mais**,
e CORS, configuração de autenticação, armazenamento e encerramento ficam sob sua responsabilidade.

Visualize previamente com `rebase eject --dry-run`, que lista o que mudaria e
não altera nada. `--force` substitui um `backend/src/index.ts` ou
`env.ts` existente, mantendo o arquivo atual como `<name>.bak`.

O servidor ejetado
mantém uploads locais em `uploads/` do projeto, executado a partir do código-fonte ou compilado, assim
como faz o `rebase dev`. Ele roda em `backend/`, portanto um `STORAGE_PATH` relativo ali é
lido a partir de `backend/`.

### `rebase schema generate` / `rebase schema stale`

```bash
rebase schema generate       # backend/schema → backend/src/schema.generated.ts
rebase schema stale          # lista o que difere das tabelas, sai com código 1 se houver divergência
rebase schema stale --fix    # regenera o arquivo
```

Todo comando que lê o schema aceita `--schema-dir <dir>` para um projeto
que o mantém em outro local; `--collections` foi removido. O `rebase dev` mantém o
arquivo atualizado, portanto `stale` é a verificação indicada para um build ou CI. Consulte
[Geração de Schema](/docs/cli/schema/).

### `rebase db`

```bash
rebase db push                 # aplica as tabelas ao banco de dados (desenvolvimento)
rebase db generate             # escreve um arquivo de migração SQL
rebase db migrate              # aplica as migrações pendentes
rebase db url                  # imprime a string de conexão que este projeto usa
rebase db pull --from <url>    # copia outro banco de dados para o local
rebase db backup               # pg_dump; db backups list e db restore ao lado dele
rebase db branch create <name> # uma cópia para trabalhar; switch, list e prune também disponíveis
rebase db stop                 # para o banco de dados de desenvolvimento gerenciado
rebase db reset                # apaga-o e reinicia do zero
rebase db request-role migrate --to <role> # move as requisições para outra role do Postgres
rebase db provision --print    # o SQL que configura a role de requisição, para um DBA
```

Cada um está descrito em [Comandos de Banco de Dados](/docs/cli/database/), com a ordem em que um
comando escolhe seu banco de dados; `push`, `generate` e `migrate` são abordados em
detalhes em [Geração de Schema](/docs/cli/schema/).

### `rebase console`

Um REPL do Node com os dados do projeto disponíveis, ou um snippet executado com `-e`:

```bash
rebase console
rebase console -e "rebase.dataAsAdmin.posts.find({ limit: 5 })"
```

`rebase` (`dataAsAdmin`, `sql`, `withAuth(user)`) e `tables` (as
tabelas do projeto, carregadas de `backend/schema`) estão no escopo, e o `await`
no nível superior funciona. O banco de dados é resolvido da mesma forma que o `rebase db push`
o resolve, e abri-lo não altera nada nele. Com `-e`, o resultado esperado
é impresso como JSON no stdout e qualquer erro gerado resulta em saída `1`. Flags: `--eval`/`-e`,
`--schema-dir`, `--database-url`, `--docker`. Consulte
[Scripts e o Console](/docs/backend/scripts/).

### `rebase migrate`

Migrações unidirecionais de estruturas que esta versão não suporta mais:
`rebase migrate collections-to-tables` (`config/collections` → `backend/schema`
e `frontend/src/cms`) e `rebase migrate sdk-calls` (`data.collection("x")`
→ `data.table("x")` em seu próprio código). Suas flags, o que escrevem e a
seção "Revise antes de implantar" estão em
[Geração de Schema](/docs/cli/schema/#rebase-migrate).

### `rebase apps init` / `rebase apps config`

```bash
rebase apps list             # as aplicações que este projeto declara
rebase apps init             # escreve um rebase.json inferido a partir deste projeto
rebase apps config <app>     # a configuração de cliente para uma aplicação
```

`apps init` não aceita nenhum nome: ele infere cada aplicação a partir do projeto e escreve o
`rebase.json` completo, recusando-se a substituir um existente a menos que você passe
`--force`.

Um argumento de nome é
recusado. `--force` mantém o que a inferência não consegue descobrir a partir do arquivo substituído:
o nome de cada aplicação, seu `path` e sua rota `cms`. Todo o resto é inferido
novamente, e uma aplicação declarada que ele não encontre mais é informada como removida; portanto, em um
scaffold, ele reescreve o `rebase.json` original que o scaffold forneceu. O comando
de build da aplicação estática usa o gerenciador de pacotes do projeto.

Para um
código clonado não vinculado a um projeto do Cloud, o `apps config` informa que ele não está vinculado,
esteja o `rebase dev` em execução ou não, e fornece a URL do backend conforme
o `rebase dev` a serve.

### `rebase apps add admin`

```bash
rebase apps add admin                  # em /, ou em /admin quando outra aplicação estiver em /
rebase apps add admin --path /console  # em qualquer outro lugar, ou em uma URL https própria
```

Adiciona o painel de administração a um projeto headless ou portado, da mesma forma que o `rebase init` o teria escrito. O que ele escreve, qual versão fixa e quando recusa a operação: [Adicionando um painel de administração posteriormente](/docs/getting-started/headless/#adding-an-admin-panel-later).

### `rebase status`

Tudo o que este projeto declara, e se o ambiente realmente faz o binding:

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

Três arquivos decidem o que um backend pode alcançar, e este comando imprime os três juntos:
`rebase.json` diz onde está seu código e quem executa o servidor,
`backend/resources.ts` diz o que o projeto precisa, e o ambiente define como
alcançar cada item. Todo o resto — `rebase.resources.json`, o manifesto
do bundle — é gerado a partir do segundo arquivo para ferramentas que não podem executar seu
código, e você nunca precisa editá-lo.

Um `○` indica o estado que vale a pena conhecer antes de um deploy em vez de depois:
declarado, mas não configurado. Um `✗` significa que o ambiente configurou algo *incorretamente*,
o que impede a inicialização em vez de apenas degradar o serviço.

Um
`rebase.resources.json` que não coincida mais com as declarações recebe uma linha com `○`.
Um que ainda não tenha sido gerado não recebe: `rebase build` o escreve a cada
build, portanto um projeto que nunca foi compilado, como um scaffold novo, não tem
nada a corrigir.

### `rebase resources`

O que este projeto declara como necessário — os bancos de dados, buckets, tópicos e
filas solicitados por `backend/resources.ts`, bem como os crons e funções que seus arquivos definem:

```bash
rebase resources            # lista-os
rebase resources --write    # regenera rebase.resources.json
rebase resources --check    # falha se o grafo versionado estiver desatualizado
rebase resources --json     # legível por máquina
```

`rebase resources --check` é a flag usada por um job de CI para falhar caso o
`rebase.resources.json` não coincida mais com `backend/resources.ts`.
`--json` pode ser combinada
com ela: em caso de divergência, `rebase resources --check --json` sai com código 1 com um envelope de
erro (`resource_graph_missing` ou `resource_graph_stale`), e em caso de sucesso
o grafo traz `check.status`. `--write --json` escreve o arquivo e informa
`written.changed`.

Um recurso é declarado em `backend/resources.ts` — `database("analytics")`,
`bucket("media")`, `topic("signups")`, `queue("thumbnails")` — ou é um arquivo
sob `backend/crons` ou `backend/functions`, e nunca é escrito manualmente no
`rebase.resources.json`, que é gerado a partir dessas declarações para que uma plataforma de hospedagem possa
ler o que um projeto precisa sem precisar compilá-lo. Cada entrada registra quem a utiliza
(`table:events`, `column:posts.cover`, `function:report`).

Um backend também possui um banco de dados padrão e uma fonte de armazenamento padrão que ninguém
declara explicitamente. Ambos são listados aqui, marcados como `implicit`, e nenhum dos dois é escrito no
`rebase.resources.json` — a plataforma os fornece, portanto registrá-los solicitaria
o provisionamento de algo que ninguém pediu.
Declarar um recurso
com nome, como `bucket("media")`, mantém o padrão onde está, de modo que ambos são
listados. Apenas declarar o padrão explicitamente, ou marcar um bucket com
`default: true`, substitui-o.

Para ver o que a plataforma mantém para um projeto em relação ao que seu código declara,
e para remover um banco de dados provisionado que o código não menciona mais, consulte
[`rebase cloud resources`](/docs/cli/cloud#resources).

O comando `rebase cloud` — abrangendo todos os comandos para o Rebase Cloud: auth, vínculo de projeto, deploys, configuração, bancos de dados, recursos, computação e mais — tem [sua própria página](/docs/cli/cloud).

### `rebase generate-sdk`

```bash
rebase generate-sdk
```

Escreve um cliente tipado para as tabelas que `backend/schema/index.ts` exporta para
`generated/sdk/`, com `TableName` e `tablesDictionary`; `--from <link|url>`
lê o contrato de um backend em execução. `--register` também tipa
os dados do lado do servidor: ele escreve os tipos e a declaração `Register` em
`backend/generated/` e os registra no `rebase.json` (`registerDatabase`).
Consulte [Dados tipados do lado do servidor](/docs/backend/typed-server-data) e
[Geração de Schema](/docs/cli/schema/#rebase-generate-sdk).

### `rebase doctor`

```bash
rebase doctor
```

O comando para executar quando algo estiver errado e você ainda não souber o quê. Ele apenas
informa e nunca altera nada, sendo seguro contra qualquer banco de dados que você consiga
alcançar.

**Sem um banco de dados.** Estas verificações são executadas primeiro, pois tudo o que impede um projeto
de funcionar por completo ocorre antes que uma tabela possa ser comparada:

| Verificação | Motivo |
| --- | --- |
| Versão do Node | Comparada com o intervalo declarado pela CLI. Uma versão muito antiga não é reportada como "Node não suportado" — manifesta-se como um erro de sintaxe dentro de uma dependência. |
| Gerenciadores de pacotes | Dois arquivos de lock em um único projeto. `npm install` em um workspace pnpm reestrutura o `node_modules` em um formato incompatível com o pnpm, e o sintoma é `Cannot find module` horas depois. |
| Slugs duplicados | Duas tabelas declarando o mesmo slug. O schema se recusa a compilar com isso, e esta verificação aponta ambas. |
| Sanidade do `.env` | Um `JWT_SECRET` com menos de 32 caracteres (o que a produção recusa na inicialização), e `NODE_ENV=production` sem `CORS_ORIGINS` nem `FRONTEND_URL`. Os valores nunca são exibidos. |
| Divergência de versão de `@rebasepro/*` | O mesmo pacote fixado em versões diferentes nos vários arquivos `package.json` do projeto. Duas cópias quebram o `instanceof` entre elas, falhando como uma guarda de tipo que rejeita seu próprio tipo. |
| Strings de conexão | Um `=` não codificado em um parâmetro de URL, que as próprias ferramentas do PostgreSQL se recusam a interpretar — quebrando backups e o `psql` enquanto a aplicação continua funcionando. |
| Funções customizadas | O que cada função requer de sua plataforma de hospedagem, e quais delas não rodariam em um runtime edge. |

**Contra o banco de dados** — o do próprio projeto, resolvido da forma como `rebase db url`
o resolve; portanto, em um scaffold novo, é o banco de dados gerenciado, que o `doctor`
inicia:

| Verificação | Motivo |
| --- | --- |
| Tabelas → schema gerado | Se o `schema.generated.ts` está desatualizado. |
| Tabelas → banco de dados | Tabelas, colunas, enums, chaves estrangeiras e junções ausentes. |
| Extensões necessárias | Uma coluna `col.vector()` precisa de pgvector, que o Rebase instala apenas onde o projeto o declarou. |
| Carimbo do schema | Se este banco de dados foi provisionado a partir dessas tabelas. É um hash, portanto pode indicar que os dois divergem, mas nunca qual deles está à frente. Um carimbo `v1:` de um runtime anterior ao 0.31 é reportado uma vez, com a instrução de atualização: `rebase db push`. |
| Tabelas → tipos do SDK | Se o SDK tipado gerado está desatualizado. |
| Políticas de RLS | Se as políticas do banco de dados coincidem com o `rls` que você declarou, e se alguma política faz referência a uma role que este servidor não pode usar. |

Se o banco de dados estiver inacessível, suas fases serão reportadas como ignoradas informando o
motivo, e o restante continuará sendo executado — consulte [Solução de Problemas](/docs/troubleshooting/).

Sai com código diferente de zero quando uma verificação encontra um erro, ou quando uma fase não pôde ser executada
porque o banco de dados fornecido recusa conexões. Uma fase ignorada porque
nenhum banco de dados pôde ser resolvido não é considerada uma falha.

`rebase doctor --policies` executa apenas as verificações de RLS — sem diff de schema, sem
tipos de SDK — e falha de forma estrita (closed), tornando-se o formato ideal para uso como barreira de CI contra um
banco de dados implantado.

`rebase doctor --database`
executa apenas a validação prévia do banco de dados: se a role sob a qual as requisições autenticadas rodam
existe, é restrita e pode ser assumida via switch, quais outros logins podem alternar
para ela, se todas as roles podem se conectar e quais tabelas, permissões (grants) e políticas
o Rebase compartilharia com outras roles. Cada apontamento indica o SQL a ser executado como
administrador, a configuração de `rls` que adapta o Rebase ao banco de dados em vez disso, ou
ambos. Ele lê o catálogo e não altera nada, saindo com código 1 caso haja alguma
falha. Funciona também em projetos headless. Consulte
[Executando em um banco de dados existente ou compartilhado](/docs/deployment/existing-database/).

### `rebase verify`

```bash
rebase verify
rebase verify --json
rebase verify --live
rebase verify --live --database-url postgresql://…
```

Verifica se as tabelas estão prontas para implantação, em um único comando rápido para CI e para
hooks de agentes de IA. Offline por padrão, nunca altera nada.

| Etapa | O que causa a falha |
| --- | --- |
| Definições de tabela (`schema`) | `backend/schema` não carrega ou não compila através do carregador com o qual o backend inicializa: uma relação com uma tabela que o index não exporta, `rls: "inherit"` sem `defaultRls`, uma tabela sem chave primária — um apontamento por problema. Uma tabela sem `rls` é um deles. |
| Cobertura de RLS (`rls`) | Uma tabela com uma coluna `user_id`, `owner_id`, `organization_id` ou `tenant_id` cujas regras — próprias ou o `defaultRls` herdado — permitam que uma role leia todas as linhas independentemente dela. Um aviso. `rls-policy-recursion`: uma regra que lê sua própria tabela em uma subconsulta, ou duas tabelas cujas regras leem uma à outra, o que o Postgres se recusa a expandir, fazendo com que cada instrução protegida falhe com `42P17 infinite recursion detected in policy`; o apontamento informa a tabela lida e a correção, movendo a leitura para uma função `SECURITY DEFINER`. Um erro, ou um aviso quando o loop não for confirmado. |
| Atualização das migrações (`migrations`) | Uma tabela ou coluna que as tabelas declaram, mas que nenhum arquivo em `backend/drizzle/migrations` cria, ou uma removida que uma migração ainda cria. Ignorado para projetos sem migrações ainda. |
| Customizações do CMS (`cms`) | Um `customizeTable(...)` em `frontend/src/cms` (ou no `src/cms` de uma aplicação estática em `rebase.json`) que não corresponda às tabelas, lido estaticamente — os módulos não são executados. `cms-unknown-table`: o slug não indica nenhuma tabela, portanto o painel o ignora (o slug mais próximo é sugerido). `cms-unknown-field`: uma chave sob `fields` não é nem coluna nem relação (o nome SQL de uma coluna é respondido com sua respectiva chave). `cms-hidden-required`: um campo ocultado do formulário (`hiddenInForm`, `readOnly`, `disabled`) cuja coluna é `NOT NULL` sem valor padrão e sem preenchimento pelo servidor, de modo que criar um registro pelo painel sempre falha; um aviso quando um hook `beforeSave` ou transformação puder preenchê-lo, sendo silenciado por `filledByServer`. `cms-duplicate-customization`: um mesmo slug customizado duas vezes. `cms-not-static` (um aviso): uma chamada cujo slug, opções ou `fields` não sejam literais ou uma `const` no mesmo arquivo, de modo que nada nela pôde ser verificado. `cms-ui-config-not-mounted` (um aviso): `frontend/src/cms/ui-config.json` existe, mas `<RebaseCMS>` não o recebe como `uiConfig`. `cms-backend-guard-missing`: a configuração do Vite do frontend não usa `rebaseBackendGuard()`, portanto `rebase build` a recusaria. Um projeto headless não possui `frontend/src/cms` e pula esta etapa. |
| Auditoria de RLS em tempo real (`live`) | Com `--live`: o catálogo do [`rls-check`](/docs/rls-check) contra o banco de dados do projeto, e se todas as migrações foram aplicadas. O banco de dados é resolvido da mesma forma que os comandos `db` resolvem — `--database-url`, `DATABASE_URL`, `--docker`, ou o banco de desenvolvimento gerenciado. Um banco de dados não configurado ou que não responde é um erro, não uma etapa ignorada: a auditoria foi explicitamente solicitada. Uma política de leitura `USING (true)` compilada a partir de uma regra `access: "public"` é um aviso enquanto a API exigir token (`AUTH_REQUIRE`, ativo por padrão) — todo usuário autenticado lê todas as linhas — e um erro com `AUTH_REQUIRE=false`, onde as linhas são anônimas. |

`--json` imprime um único objeto, `{ ok, schemaDir, steps, findings, summary }`:
cada etapa é `{ id, title, status, detail? }` (`status` pode ser `passed`, `failed`,
`warnings` ou `skipped`), e cada apontamento traz `step`, `check` (uma categoria estável
em kebab-case), `severity`, `message`, e quando aplicável `fix`, `table`,
`file`, `line` e o `path` pontilhado na tabela (`posts.rls[0]`) — permitindo que um agente
corrija o que quebrou. `summary` contabiliza `errors` e `warnings`. `--quiet` não imprime nada quando tudo passa. Sai com código
diferente de zero em caso de erro; avisos não causam falha.

Um projeto criado via scaffold executa esta verificação para o Claude Code após cada edição sob `backend/schema/`: consulte
[`rebase skills install`](#rebase-skills-install).

### Comandos para uma aplicação em execução

`rebase api`, `rebase data`, `rebase users`, `rebase cron`, `rebase logs`, `rebase functions`, `rebase rls simulate`, `rebase auth login` e `rebase storage ls|cp|rm|url|stat` atuam em uma aplicação em execução por meio de sua API: o `rebase dev` local, um servidor especificado com `--url` ou um projeto do Rebase Cloud com `--project`. Consulte [Uma aplicação em execução](/docs/cli/project/).

### `rebase auth`

Comandos de gerenciamento de autenticação:

```bash
rebase auth reset-password --email admin@example.com --password NewPassword123!
```

### `rebase api-keys`

Gerencie as chaves de API de serviço do projeto — a credencial utilizada por um agente, script ou
outro serviço, ao contrário da sessão de um usuário final:

```bash
rebase api-keys list
rebase api-keys get abc123-def456
rebase api-keys create --name "Blog CI" --scopes data:read:posts,data:write:posts --expires-in 90
rebase api-keys create --name "Ops" --full-access --roles admin --expires-at 2027-01-31
rebase api-keys revoke abc123-def456
```

`--scopes` especifica o que a chave pode fazer, separado por vírgulas ou repetido; `--full-access`
concede a ela todos os escopos que a chave de serviço possui, exceto `keys:*`. `--roles` adiciona roles
de RLS além de `service`, `--expires-in` aceita dias e `--expires-at` uma data ISO.
`rebase api-keys scopes` lista todos os escopos conhecidos pelo backend. A chave é exibida apenas uma vez.
Tanto os escopos da chave quanto as permissões de row-level security da identidade sob a qual ela atua são aplicados.
Consulte [Chaves de API](/docs/backend/api-keys/).

### `rebase storage`

Manutenção completa
do armazenamento de arquivos, através do backend em execução com
`REBASE_SERVICE_KEY` a partir do `.env`:

```bash
rebase storage orphans                         # arquivos que nenhuma linha referencia
rebase storage orphans --source media --delete # e apaga-os, após confirmação
rebase storage move --from "(default)" --to media --prefix avatars
rebase storage move --from "(default)" --to media --prefix avatars --delete-source
```

`orphans` lê todas as linhas de todas as tabelas conforme armazenadas (inclusive linhas
com exclusão lógica/soft-deleted, passando por todos os hooks `beforeQuery` e `afterRead`) e cada
entrada do [histórico](/docs/backend/history/), já que uma reversão restaura o que ele contém.
Ele lista os arquivos de uma fonte (`--source`, a fonte padrão se omitida)
que nenhuma string em nenhum desses registros referencia: uma chave, uma URL, uma
referência `rebase-storage:` em um texto. Arquivos com menos de `--older-than` horas (24 por padrão) são desconsiderados,
pois o painel de administração faz upload do arquivo antes que a linha que o referencia seja salva.
A varredura roda no backend em segundo plano, para que um projeto grande demais para ser varrido
em uma única requisição (atrás de um ingress que causaria timeout) ainda assim termine. A
CLI a inicia e exibe seu progresso (arquivos listados, linhas lidas, tabelas
concluídas e eventuais tabelas que não puderam ser lidas) até a finalização. Com a
[fila de jobs](/docs/backend/jobs/) ativa, a varredura é um job `storage.orphans`
executado pelos workers de jobs. Sem ela, a varredura roda dentro do processo do servidor que
foi acionado, e a CLI avisa: reiniciar esse processo interrompe a varredura. Uma varredura
corresponde a uma tentativa de job, limitada por `jobs.timeoutMs` (15 minutos por padrão). Aumente
esse valor, ou defina como 0, para uma fonte que demore mais. `--json` imprime o mesmo
relatório anterior, somado ao seu `scanId`.

`--delete` pede confirmação antes de excluir (`--yes` pula a pergunta, sendo obrigatório
sem terminal). Ele exclui apenas a partir da varredura recém-impressa e apenas dentro de
15 minutos após a conclusão dessa varredura. Nada é excluído enquanto uma tabela
não puder ser lida: uma tabela com hooks de leitura em um banco de dados cujo driver
não consiga contorná-los é considerada não lida. Antes de excluir qualquer coisa, o servidor
lê todas as linhas e entradas de histórico novamente contra os arquivos listados. Em seguida, ele valida
cada arquivo mais uma vez imediatamente antes de excluí-lo. Um arquivo que uma linha passe a referenciar agora,
que tenha sido enviado novamente desde a varredura ou que já não exista mais é mantido, e a CLI
o lista como mantido. Arquivos referenciados apenas por tabelas não gerenciadas pelo Rebase parecerão
não utilizados: verifique antes de excluir. Em um backend na versão 0.25.1 ou anterior, a
CLI faz a varredura da maneira antiga, dentro de uma única requisição.

`move` copia os arquivos sob `--prefix` para outra fonte mantendo as mesmas chaves,
uma página por vez. Um arquivo que o destino já contenha com o mesmo tamanho é ignorado,
de modo que uma movimentação interrompida pode ser retomada executando o comando novamente; `--delete-source` exclui cada
arquivo da origem assim que o destino passar a contê-lo, sendo recusada caso as duas
fontes armazenem no mesmo bucket ou diretório. Concluída a movimentação, a CLI
varre a origem novamente em uma nova listagem e relata cada arquivo que a operação não
moveu: com `--delete-source`, qualquer arquivo ainda presente na origem; sem ela, qualquer arquivo
do qual o destino não possua uma cópia de tamanho equivalente. Ela encerra com código 1 se houver algum, e
executar a mesma movimentação novamente tentará processá-lo. `--json` imprime-os como `notMoved`. A leitura do
relatório de uma varredura requer `database:read`. Iniciar uma varredura, excluir e mover exigem
`database:write`, que a chave de serviço possui.

### `rebase skills install`

Instala as reference skills do Rebase para seus assistentes de codificação de IA — qualquer `--agent` listado acima:

```bash
rebase skills install
rebase skills install --agent claude,cursor
rebase skills install --agent all
rebase skills --hooks
```

Consulte [Agent Skills](/docs/ai/skills) para ver a lista completa e onde os arquivos são gravados.

`--hooks` instala a proteção para Claude Code que o `rebase init` inclui em cada
projeto: `.claude/hooks/post-edit-collection.sh`, registrado como um hook `PostToolUse`
em `.claude/settings.json`, que executa `rebase verify --quiet` após cada edição
sob `backend/schema/` ou `frontend/src/cms/` e devolve qualquer problema para o agente. Configurações
e hooks existentes são preservados. `rebase skills --hooks` instala apenas o hook isoladamente.

### `rebase telemetry`

Compartilhamento anônimo de uso, desativado até que você concorde. Uma execução interativa de `rebase init`
pergunta ao final, com o padrão sendo não; portanto, nada é compartilhado a menos que você
responda sim. A resposta é por máquina (`~/.rebase/telemetry.json`): após um sim, o
`init` nunca mais pergunta, e após um não, o próximo `init` pergunta novamente. Cada
projeto clonado recebe um ID de projeto aleatório, armazenado no arquivo
`.rebase/telemetry-project.json` (ignorado pelo git).

```bash
rebase telemetry status
rebase telemetry show
rebase telemetry enable
rebase telemetry disable
```

`status` exibe a configuração atual, `show` exibe exatamente o que seria enviado —
esteja o compartilhamento ativo ou não, para que você possa inspecionar o payload antes de decidir — e
os outros dois modificam essa preferência. Se você nunca executou o `init`, nada jamais foi coletado.

## Próximos Passos

- **[Geração de Schema](/docs/cli/schema/#production-workflow)** — O fluxo de trabalho de migrações, da edição da tabela até a produção
- **[Schema as Code](/docs/architecture/schema-as-code)** — Como funciona a geração de schema
- **[Início Rápido](/docs/getting-started/quickstart)** — Comece a usar
