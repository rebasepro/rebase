---
sourceHash: 14d61f8d5b137ed3
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

`--json` é o modificador, e fora da família `cloud` ele é o único: `rebase status`, `rebase resources`, `rebase apps list` e `rebase upgrade` então colocam um valor JSON no stdout — o resultado, ou um envelope `{"error": {"message", "code", "hint", "issues"}}` com um código de saída diferente de zero — em **cada** encerramento do comando, para que um chamador possa analisar o stdout incondicionalmente. Sem ele, eles escrevem texto legível para humanos e as falhas vão para o stderr. `rebase cloud` usa o mesmo envelope e é a única exceção ao modificador: ele também ativa o JSON por conta própria quando o stdout não for um TTY, ou quando `REBASE_JSON=1` estiver definido. Assim, `rebase cloud status | cat` produz JSON enquanto `rebase status | cat` não — em um script, passe `--json` explicitamente em vez de depender de qualquer uma das regras.

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
| `--headless` | Apenas backend — sem painel de administração e sem arquivos de collection. `--template` não tem efeito, pois não há collections para popular |
| `-y, --yes` | Nunca solicita confirmações interativas. **Obrigatório onde não houver terminal para responder**, como no CI. Ele ignora o git init e a instalação de dependências — os padrões interativos dizem sim para ambos, portanto passe `--git` / `--install` se desejar executá-los |
| `-i, --install` | Instala dependências após o scaffolding |
| `-g, --git` | Inicializa um repositório e faz o primeiro commit |
| `--database-url <url>` | Usa um banco de dados existente em vez do gerenciado. <span class="since-badge" data-since="0.25">Desde 0.25</span> Precisa ser uma URL `postgres://` ou `postgresql://`: qualquer outra coisa é recusada antes de um arquivo ser escrito, e o prompt interativo pergunta de novo |
| `--introspect` | Gera collections a partir desse banco de dados. Implica `--template blank` e requer `--install` |
| `--project <slug>` | Vincula o scaffold a um projeto do Rebase Cloud |
| `--setup-key <key>` | A chave de uso único que autentica esse vínculo |
| `-a, --agent <name>` | Configura agentes de codificação de IA: as [skills](/docs/ai/skills) e o [servidor MCP](/docs/ai/mcp). Repetível ou separado por vírgulas — `claude`, `cursor`, `windsurf`, `gemini`, `codex`, `kiro`, `copilot` ou `all`. Sem ele, o `init` pergunta e pré-seleciona os agentes instalados na máquina; com `--yes`, nenhum |

### `rebase dev`

Inicia o servidor de desenvolvimento:

```bash
rebase dev
```

Inicia tanto o frontend quanto o backend com hot reloading e regenera o schema do Drizzle e os tipos do SDK (`generated/sdk/`) na inicialização e a cada salvamento de collection. Na 0.23 ele regenera apenas o schema, e cabe a você executar o `rebase generate-sdk`.

Ambas as portas são derivadas do caminho do projeto, permitindo que vários projetos Rebase sejam executados lado a lado. Use as URLs exibidas pelo `rebase dev`. Fixe uma com `rebase dev --port 3001`.

### `rebase build`

Compila o projeto em um bundle implantável em `dist-bundle/`:

```bash
rebase build
```

O bundle é o artefato que você implanta — a imagem de runtime o carrega, portanto não há necessidade de compilar uma imagem de aplicação por conta própria. Flags úteis:

| Flag | Efeito |
|------|--------|
| `--output <dir>` (ou `--out`) | Grava o bundle em outro local que não seja `dist-bundle/` (um app por vez) |
| `--vendor` | Sempre instala e empacota as dependências do bundle |
| `--no-vendor` | Nunca faz o vendoring; o pod instala na primeira inicialização |
| `--skip-type-check` | Pula a verificação de tipos (mais rápido, menos seguro) |
| `--no-static` | Não embute o frontend no bundle do backend (cada app estático ainda recebe seu próprio bundle) |
| `--skip-static-build` | Embute o frontend como já compilado, sem executar seu comando de build |

As dependências são incluídas (vendored) por padrão para que a reinicialização de um pod não sofra uma espera de 35 a 55 segundos de instalação. Uma árvore de diretórios que ultrapasse 200 MB no disco é descartada, pois o limite de upload é de 100 MB compactado — veja o changelog para entender o motivo.

<span class="since-badge" data-since="0.25">Desde 0.25</span> Todo app estático que o
bundle leva recebe uma cópia brotli (`.br`) e uma gzip (`.gz`) ao lado de cada
asset com hash de conteúdo de 1 KB ou mais — os arquivos que um navegador mantém em cache por um ano.
O runtime envia a que o navegador aceita, de modo que esses arquivos não custam
nenhum trabalho de compressão por requisição, inclusive na primeira visita após um deploy, e
os navegadores que aceitam brotli a recebem (cerca de 11% menor que o gzip no JavaScript
do admin). A saída de build do seu próprio frontend é deixada como estava; só a cópia
dentro do bundle muda. No app de exemplo isso acrescenta menos de um segundo ao build
e cerca de 2,4 MB ao bundle.

### `rebase upgrade`

Atualiza todos os pacotes `@rebasepro/*` fixados pelo projeto para uma única versão e, em seguida, instala com o gerenciador de pacotes especificado no lockfile. `rebase upgrade` obtém a versão mais recente; `--to 0.21.0` define uma versão exata, sem consulta ao registro; `--to canary` define uma dist-tag. Cada dependência fixada em `dependencies`, `devDependencies` e `optionalDependencies`, em cada `package.json` do projeto, mantém seu `^` ou `~`, e nada mais no arquivo é alterado. `peerDependencies` e especificações com `workspace:`, `link:`, `file:`, git e tags são listadas e deixadas intactas. Substituições (overrides) em `pnpm-workspace.yaml` e `package.json` também são atualizadas, mas um override `link:` ou `file:` tem precedência sobre qualquer fixação: ele é reportado, e `--drop-local-overrides` o remove. `--dry-run` não grava nada, `--no-install` pula a instalação e `--json` imprime um único documento.

<span class="since-badge" data-since="0.25">Desde 0.25</span> Um projeto em uma
prerelease, como um canary, permanece no seu canal, a menos que `latest` seja mais
novo. Uma dist-tag que moveria uma fixação para trás é recusada (`downgrade_refused`
sob `--json`), a menos que você passe `--allow-downgrade`; um `--to` exato é aplicado
e sinalizado como um downgrade. Na 0.24, o `rebase upgrade` usa `latest`
independentemente.

### `rebase start`

Executa o bundle compilado da mesma forma que um deploy o executa:

```bash
rebase start
```

Lê `PORT` e o restante do `.env`, diferentemente de `rebase dev`, no `NODE_ENV`
que eles definem. Um `.env` gerado pelo scaffold diz `development`, então a
primeira conta a se registrar ainda se torna o admin, e o `rebase start` avisa
isso no topo; defina `NODE_ENV=production` para um servidor de produção. O
`rebase start --bundle ./dist-bundle` executa um bundle em outro local.

O `rebase start` não inicia nenhum banco de dados, e o `.env` do scaffold não tem
`DATABASE_URL`, então uma execução local no banco de dados que o `rebase dev` usa é
`DATABASE_URL="$(rebase db url)" rebase start`. <span class="since-badge" data-since="0.25">Desde 0.25</span>
Sem um, ele imprime essa linha antes de iniciar; na 0.24 o runtime para em
"DATABASE_URL: is required".

### `rebase apps list`

Mostra os apps que este repositório declara:

```bash
rebase apps list
```

Um repositório pode declarar mais de um app implantável — um backend e um site de marketing, por exemplo. É assim que você visualiza sobre o que o `rebase build` e o deploy atuarão.

### `rebase eject`

Assume o controle do processo do servidor e de sua imagem:

```bash
rebase eject
```

Grava o ponto de entrada do backend e um `Dockerfile` no projeto e altera a configuração do backend, para que o repositório construa sua própria imagem em vez de executar o runtime publicado. A partir de então, **as atualizações do runtime da plataforma não o alcançarão mais**, e o CORS, a configuração de autenticação, o armazenamento e o encerramento passam a ser de sua responsabilidade configurar.

Visualize previamente com `rebase eject --dry-run`, que lista o que mudaria sem alterar nada. `--force` substitui um `backend/src/index.ts` ou `env.ts` existente, mantendo o arquivo atual como `<name>.bak`.

<span class="since-badge" data-since="0.25">Desde 0.25</span> O servidor ejetado
mantém os uploads locais no `uploads/` do projeto, executado a partir do código-fonte
ou compilado, como o `rebase dev` faz. Ele roda em `backend/`, então um `STORAGE_PATH`
relativo ali é lido a partir de `backend/`. Na 0.24 o servidor compilado usa
`backend/dist/uploads`, que o próximo build apaga.

### `rebase schema generate`

Gera o schema do Drizzle ORM a partir das suas collections TypeScript:

```bash
rebase schema generate
```

Isso lê suas collections de `config/collections/` e gera `backend/src/schema.generated.ts` com definições de tabelas, enums e relações do Drizzle.

### `rebase schema stale`

```bash
rebase schema stale          # name what differs from the collections, exit 1 if anything does
rebase schema stale --fix    # regenerate backend/src/schema.generated.ts instead
```


O `rebase dev` mantém o arquivo atualizado por conta própria, então esta é a
verificação para um build ou uma etapa de CI. Veja
[Geração de Esquema](/docs/cli/schema/#rebase-schema-stale).

### `rebase db`

```bash
rebase db push                 # apply the collections to the database (development)
rebase db generate             # write a SQL migration file
rebase db migrate              # apply the pending migrations
rebase db url                  # print the connection string this project uses
rebase db pull --from <url>    # copy another database into the local one
rebase db backup               # pg_dump; db backups list and db restore beside it
rebase db branch create <name> # a copy to work on; switch, list and prune it too
rebase db stop                 # stop the managed development database
rebase db reset                # delete it and start over
```


Cada um está em [Comandos de Banco de Dados](/docs/cli/database/), com a ordem em que
um comando escolhe o seu banco de dados; `push`, `generate` e `migrate` são tratados em
profundidade em [Geração de Esquema](/docs/cli/schema/).

### `rebase console`

<span class="since-badge" data-since="0.25">Desde 0.25</span>

Um REPL do Node com os dados do projeto abertos, ou um único trecho de código executado com `-e`:

```bash
rebase console
rebase console -e "rebase.dataAsAdmin.posts.find({ limit: 5 })"
```

`rebase` (`dataAsAdmin`, `sql`, `withAuth(user)`) e `collections` estão no escopo, e o
`await` de nível superior funciona. O banco de dados é resolvido como o `rebase db push`
o resolve, e abri-lo não altera nada nele. Com `-e`, o resultado aguardado (awaited)
é impresso como JSON no stdout e uma exceção encerra com código `1`. Flags: `--eval`/`-e`,
`--collections`/`-c`, `--database-url`, `--docker`. Veja
[Scripts e o Console](/docs/backend/scripts/).

### `rebase apps init` / `rebase apps config`

```bash
rebase apps list             # the apps this project declares
rebase apps init             # write a rebase.json inferred from this project
rebase apps config <app>     # the client configuration for one app
```


O `apps init` não recebe nome: ele deduz cada app a partir do projeto, escreve o
`rebase.json` inteiro e se recusa a substituir um que já exista, a menos que você
passe `--force`.

<span class="since-badge" data-since="0.25">Desde 0.25</span> Um argumento de nome é
recusado. O `--force` mantém, a partir do arquivo que ele substitui, o que a dedução
não consegue saber: o nome de cada app, o seu `path` e a sua rota `cms`. Todo o resto
é deduzido de novo, e um app declarado que ele não encontra mais é indicado como
removido, de modo que em um scaffold ele escreve de volta o `rebase.json` que o scaffold
trazia. O comando de build do app estático usa o gerenciador de pacotes do projeto. Na
0.24 o nome é ignorado, e o `--force` escreve a dedução simples: o app estático vira
`web`, compilado com `npm run build --workspace frontend`.

<span class="since-badge" data-since="0.25">Desde 0.25</span> Para um checkout não
vinculado a um projeto do Cloud, o `apps config` fornece a URL do backend como o
`rebase dev` a serve. Na 0.24 ele imprime `http://localhost:3001`.

### `rebase status`

Tudo o que este projeto declara e se o ambiente realmente faz o binding de cada item:

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

Três arquivos decidem o que um backend pode alcançar, e este comando imprime todos os três juntos:
`rebase.json` diz onde está seu código e quem executa o servidor,
`config/resources.ts` diz do que o projeto precisa, e o ambiente define como alcançar cada recurso. Todo o resto — `rebase.resources.json`, o manifesto do bundle — é gerado a partir do arquivo intermediário para ferramentas que não podem executar seu código, e você nunca precisa editá-lo manualmente.

Um `○` representa o estado importante de se conhecer antes de um deploy, em vez de depois: declarado, não configurado. Um `✗` significa que o ambiente define algo de forma *incorreta*, o que impede a inicialização em vez de degradar graciosamente.

### `rebase resources`

O que este projeto declara como necessário — os bancos de dados, buckets, tópicos e filas solicitados pelo seu código de configuração, e os crons e functions definidos pelos seus arquivos:

```bash
rebase resources            # list them
rebase resources --write    # regenerate rebase.resources.json
rebase resources --check    # fail if the committed graph is stale
rebase resources --json     # machine-readable
```

`rebase resources --check` é a flag que um job de CI usa para falhar quando um `rebase.resources.json` não corresponde mais ao código de configuração.
<span class="since-badge" data-since="0.25">Desde 0.25</span> O `--json` se combina com ela:
em caso de divergência, `rebase resources --check --json` termina com código 1 com um envelope de erro
(`resource_graph_missing` ou `resource_graph_stale`), e em caso de sucesso o grafo carrega `check.status`.
`--write --json` escreve o arquivo e informa `written.changed`. Na 0.24 o `--json` imprimia o grafo e
ignorava ambas as flags.

Um recurso é declarado no código de configuração — `database("analytics")`, `bucket("media")`, `topic("signups")`, `queue("thumbnails")` — ou é um arquivo em `backend/crons` ou `backend/functions`, nunca sendo escrito manualmente em `rebase.resources.json`, que é gerado a partir dessas declarações para que um host possa ler o que um projeto precisa sem compilá-lo. Cada entrada registra quem o utiliza (`collection:events`, `property:posts.cover`, `function:report`).

Um backend também possui um banco de dados padrão e uma fonte de armazenamento padrão que ninguém declara. Ambos são listados aqui, marcados como `implicit`, e nenhum dos dois é gravado no `rebase.resources.json` — o host os fornece; portanto, registrá-los solicitaria o provisionamento de algo que ninguém pediu.

Para verificar o que a plataforma mantém para um projeto em relação ao que seu código declara e para remover um banco de dados provisionado que o código não referencia mais, consulte [`rebase cloud resources`](/docs/cli/cloud#resources).

`rebase cloud` — todos os comandos do Rebase Cloud: autenticação, vínculo de projeto, deploys, configuração, bancos de dados, recursos, computação e mais — tem [uma página própria](/docs/cli/cloud).

### `rebase generate-sdk`

Gera um SDK tipado a partir das definições de suas collections:

```bash
rebase generate-sdk
```

Cria tipos TypeScript e um cliente com tipagem estrita para todas as suas collections.

`--register` também tipa os dados no lado do servidor: grava os tipos e a
declaração `Register` em `config/generated/` e lembra da escolha em
`rebase.json` (`registerDatabase`), de modo que execuções posteriores, o `rebase dev` e clones novos
os mantêm atualizados.
Veja [Dados tipados no servidor](/docs/backend/typed-server-data).

### `rebase doctor`

```bash
rebase doctor
```

O comando para executar quando algo estiver errado e você ainda não souber o que é. Ele apenas gera relatórios e nunca altera nada, portanto é seguro executá-lo contra qualquer banco de dados acessível.

**Sem um banco de dados.** Estas verificações são executadas primeiro, pois tudo o que impede um projeto de funcionar ocorre antes mesmo que uma tabela possa ser comparada:

| Verificação | Motivo |
| --- | --- |
| Versão do Node | Comparada com o intervalo declarado pela CLI. Versão defasada não é reportada como "Node não suportado" — manifesta-se como um erro de sintaxe dentro de uma dependência. |
| Gerenciadores de pacotes | Dois lockfiles em um mesmo projeto. Executar `npm install` em um workspace pnpm reestrutura o `node_modules` em um formato incompatível com o pnpm, cujo sintoma é `Cannot find module` horas depois. |
| Slugs duplicados | O registro mantém a última collection registrada, então a outra não é reportada como ausente — ela é servida como a vencedora, sob seu próprio nome. |
| Sanidade do `.env` | Um `JWT_SECRET` com menos de 32 caracteres (o qual a produção se recusa a inicializar), e `NODE_ENV=production` sem `CORS_ORIGINS` nem `FRONTEND_URL`. Os valores nunca são exibidos. |
| Divergência de versão de `@rebasepro/*` | O mesmo pacote fixado em versões diferentes entre os arquivos `package.json` do projeto. Duas cópias quebram o `instanceof` entre elas, o que falha como um type guard rejeitando seu próprio tipo. |
| Strings de conexão | Um caractere `=` não codificado em um parâmetro de URL, o qual as próprias ferramentas do PostgreSQL se recusam a interpretar — fazendo com que backups e o `psql` quebrem enquanto a aplicação continua funcionando. |
| Funções customizadas | O que cada função requer de seu host e quais delas não executariam em um runtime de edge. |

**Contra o banco de dados**, quando `DATABASE_URL` estiver definido:

| Verificação | Motivo |
| --- | --- |
| Collections → schema gerado | Se o arquivo `schema.generated.ts` está desatualizado. |
| Collections → banco de dados | Tabelas, colunas, enums, chaves estrangeiras e tabelas de junção ausentes. |
| Extensões obrigatórias | Uma propriedade `{ type: "vector" }` necessita da pgvector, que o Rebase só instala onde o projeto a declarou. |
| Carimbo do schema (Schema stamp) | Se este banco de dados foi provisionado a partir destas collections. É um hash, portanto pode indicar que os dois discordam, mas nunca qual deles está adiantado. |
| Collections → tipos do SDK | Se o SDK tipado gerado está desatualizado. |
| Políticas de RLS | Se as políticas do banco de dados correspondem às `securityRules` declaradas e se alguma política faz referência a uma role que este servidor não pode usar. |

Se o banco de dados estiver inacessível, suas etapas são reportadas como ignoradas informando o motivo, e o restante continua sendo executado — consulte [Solução de Problemas](/docs/troubleshooting/).

Encerra com código diferente de zero quando uma verificação encontra um erro, ou quando uma etapa não pôde ser executada porque o banco de dados fornecido recusa conexões. Uma etapa ignorada por você não ter definido `DATABASE_URL` não é considerada uma falha.

`rebase doctor --policies` executa apenas as verificações de RLS — sem diff de schema, sem tipos do SDK — e falha de forma estrita (fails closed), tornando-se o formato ideal para ser utilizado como validação de CI contra um banco de dados implantado.

### `rebase auth`

Comandos para gerenciamento de autenticação:

```bash
rebase auth reset-password --email admin@example.com --password NewPassword123!
```

### `rebase api-keys`

Gerencia as chaves de API de serviço do projeto — a credencial que um agente, script ou
outro serviço utiliza, em oposição à sessão de um usuário final:

```bash
rebase api-keys list
rebase api-keys get abc123-def456
rebase api-keys create --name "Blog CI" --scopes data:read:posts,data:write:posts --expires-in 90
rebase api-keys create --name "Ops" --full-access --roles admin --expires-at 2027-01-31
rebase api-keys revoke abc123-def456
```

`--scopes` nomeia o que a chave pode fazer, separado por vírgulas ou repetido; `--full-access`
dá a ela todos os escopos que a chave de serviço tem, exceto `keys:*`. `--roles` adiciona roles de RLS além de
`service`, `--expires-in` aceita dias e `--expires-at` uma data ISO.
`rebase api-keys scopes` lista todos os escopos que o backend conhece. A chave é exibida apenas uma vez.
As chaves possuem dupla validação de acesso: tanto os escopos da chave quanto o row-level security da identidade
que ela assume são aplicados. Consulte [Chaves de API](/docs/backend/api-keys/).

### `rebase storage`

<span class="since-badge" data-since="0.25">Desde 0.25</span> Manutenção de todo o armazenamento de arquivos, por meio do backend em execução, com
`REBASE_SERVICE_KEY` do `.env`:

```bash
rebase storage orphans                         # files no row names
rebase storage orphans --source media --delete # and delete them, after asking
rebase storage move --from "(default)" --to media --prefix avatars
rebase storage move --from "(default)" --to media --prefix avatars --delete-source
```

`orphans` lê cada linha de cada collection, inclusive as com soft delete, e
lista os arquivos de uma fonte (`--source`, a fonte padrão quando omitido)
que nenhuma string em nenhuma linha nomeia: uma chave, uma URL, uma referência `rebase-storage:` em
um texto. Arquivos mais novos que `--older-than` horas (24 por padrão) ficam de fora,
porque o painel de administração envia um arquivo antes de a linha que o nomeia ser salva.
`--delete` pergunta antes de excluir (`--yes` dispensa a pergunta, e é obrigatório
sem um terminal), o servidor encontra os arquivos de novo antes, e nada é
excluído enquanto uma collection não puder ser lida. Arquivos que apenas as suas próprias tabelas
fora das collections nomeiam parecem sem uso: confira antes de excluir.

`move` copia os arquivos sob `--prefix` para outra fonte sob as mesmas chaves,
uma página por vez. Um arquivo que o destino já guarda com o mesmo tamanho é ignorado,
de modo que uma movimentação interrompida é retomada executando-a de novo; `--delete-source` exclui cada
arquivo da origem assim que o destino o guarda. Ambos exigem `database:read`, e
excluir ou mover exige `database:write`, que a chave de serviço possui.

### `rebase skills install`

Instala as reference skills do Rebase para seus assistentes de codificação com IA — engloba cada `--agent` citado acima:

```bash
rebase skills install
rebase skills install --agent claude,cursor
rebase skills install --agent all
```

Consulte [Agent Skills](/docs/ai/skills) para obter a lista completa e os locais onde os arquivos são gravados.

### `rebase telemetry`

Compartilhamento anônimo de uso, desativado até você dizer sim. Um `rebase init`
interativo pergunta no final, e o prompt tem como padrão não, então nada é
compartilhado a menos que você responda sim. A resposta vale por máquina
(`~/.rebase/telemetry.json`): depois de um sim o `init` nunca mais pergunta, e depois
de um não o próximo `init` pergunta de novo. Cada checkout recebe um id de projeto
aleatório, guardado no seu `.rebase/telemetry-project.json`, que está no gitignore.
<span class="since-badge" data-since="0.25">Desde 0.25</span>
Na 0.24 o prompt tem como padrão sim, e o id do projeto muda a cada reinício do
`rebase dev`.

```bash
rebase telemetry status
rebase telemetry show
rebase telemetry enable
rebase telemetry disable
```

`status` imprime a configuração atual, `show` exibe exatamente o que seria enviado — esteja o compartilhamento ativado ou não, para que você possa ler o payload antes de decidir — e os outros dois alteram essa configuração. Se você nunca executou o `init`, nada jamais foi coletado.

## Próximos Passos

- **[Geração de Schema](/docs/cli/schema/#production-workflow)** — O fluxo de trabalho de migrações, da edição da collection até a produção
- **[Schema as Code](/docs/architecture/schema-as-code)** — Como funciona a geração de schema
- **[Início Rápido](/docs/getting-started/quickstart)** — Comece a usar o Rebase
