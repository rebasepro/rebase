---
sourceHash: 151bdf50176c7654
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
| `--database-url <url>` | Usa um banco de dados existente em vez do gerenciado |
| `--introspect` | Gera collections a partir desse banco de dados. Implica `--template blank` e requer `--install` |
| `--project <slug>` | Vincula o scaffold a um projeto do Rebase Cloud |
| `--setup-key <key>` | A chave de uso único que autentica esse vínculo |
| `-a, --agent <name>` | Configura agentes de codificação de IA: as [skills](/docs/ai/skills) e o [servidor MCP](/docs/ai/mcp). Repetível ou separado por vírgulas — `claude`, `cursor`, `windsurf`, `gemini`, `codex`, `kiro`, `copilot` ou `all`. Sem ele, o `init` pergunta e pré-seleciona os agentes instalados na máquina; com `--yes`, nenhum |

### `rebase dev`

Inicia o servidor de desenvolvimento:

```bash
rebase dev
```

Inicia tanto o frontend quanto o backend com hot reloading e regenera o schema do Drizzle e os tipos do SDK (`generated/sdk/`) na inicialização e a cada salvamento de collection. para os tipos do SDK — na 0.23 ele regenera apenas o schema, e cabe a você executar o `rebase generate-sdk`.

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

### `rebase upgrade`

Atualiza todos os pacotes `@rebasepro/*` fixados pelo projeto para uma única versão e, em seguida, instala com o gerenciador de pacotes especificado no lockfile. `rebase upgrade` obtém a versão mais recente; `--to 0.21.0` define uma versão exata, sem consulta ao registro; `--to canary` define uma dist-tag. Cada dependência fixada em `dependencies`, `devDependencies` e `optionalDependencies`, em cada `package.json` do projeto, mantém seu `^` ou `~`, e nada mais no arquivo é alterado. `peerDependencies` e especificações com `workspace:`, `link:`, `file:`, git e tags são listadas e deixadas intactas. Substituições (overrides) em `pnpm-workspace.yaml` e `package.json` também são atualizadas, mas um override `link:` ou `file:` tem precedência sobre qualquer fixação: ele é reportado, e `--drop-local-overrides` o remove. `--dry-run` não grava nada, `--no-install` pula a instalação e `--json` imprime um único documento.

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

### `rebase schema generate`

Gera o schema do Drizzle ORM a partir das suas collections TypeScript:

```bash
rebase schema generate
```

Isso lê suas collections de `config/collections/` e gera `backend/src/schema.generated.ts` com definições de tabelas, enums e relações do Drizzle.

### `rebase db push`

Envia alterações de schema diretamente para o banco de dados (somente desenvolvimento):

```bash
rebase db push
```

:::caution
`db push` modifica o banco de dados diretamente sem arquivos de migração. Use `db generate` + `db migrate` para produção.
:::

### `rebase db generate`

Gera arquivos de migração SQL a partir de alterações de schema:

```bash
rebase db generate
```

Cria arquivos de migração com carimbo de data/hora em `drizzle/migrations/` que podem ser revisados e comitados.

### `rebase db migrate`

Executa migrações pendentes do banco de dados:

```bash
rebase db migrate
```

Aplica todas as migrações não aplicadas ao banco de dados.

### `rebase db backup` / `backups` / `restore`

```bash
rebase db backup --out ./backups        # ou s3://bucket/prefix, gs://bucket/prefix
rebase db backups list                  # lista o que está armazenado
rebase db restore ./backups/<file>.dump --yes
```

`backup` executa o `pg_dump`; `restore` executa o `pg_restore` e, por ser destrutivo, exige `--yes`.
O agendamento, o arquivo de roles que acompanha cada dump, e o procedimento de restauração estão em [Backups e restauração](/docs/deployment/backups/).

### `rebase db pull`

Copia outro banco de dados para o banco de dados de desenvolvimento local:

```bash
rebase db pull --from postgres://…  [--anonymize]
```

`--anonymize` substitui campos pessoais durante a importação, para que uma cópia de produção possa ser trabalhada localmente sem levar dados reais de clientes para um laptop.

O `pg_dump` remove privilégios, então a cópia chegaria com as políticas de RLS da origem e nenhuma das concessões (grants) por trás delas — fazendo com que cada leitura como `rebase_user` falhe com `permission denied`. O pull provisiona novamente a role do app em seguida, usando a mesma rotina que a inicialização e o `rebase db push` utilizam, garantindo que as tabelas internas do Rebase permaneçam revogadas como devem ser.

O destino é sempre o banco de dados de desenvolvimento local deste projeto e não pode ser escolhido: `--database-url` é recusado em vez de aceito, logo não há como solicitar um "pull para produção". `--from` é a única direção.

### `rebase db url`

Imprime a string de conexão que este projeto está usando, e nada mais, permitindo o uso com pipes:

```bash
rebase db url
psql "$(rebase db url)"
```

O banco de dados de desenvolvimento gerenciado é o caso de uso que necessita disso: o `.env` deixa o `DATABASE_URL` comentado propositalmente, e a porta é derivada do caminho do projeto, portanto nada no disco a especifica diretamente. Quando você define um `DATABASE_URL` próprio, é isso que este comando imprime — a ordem de resolução é a mesma que todos os outros comandos seguem. Ele inicia o banco de dados gerenciado caso ainda não esteja em execução.

### `rebase db stop` / `rebase db reset`

Apenas para o banco de dados de desenvolvimento gerenciado:

```bash
rebase db stop     # para o banco; os dados são mantidos
rebase db reset    # apaga o banco e recomeça do zero
```

### `rebase db branch`

```bash
rebase db branch create <name>
rebase db branch list
rebase db branch info <name>
rebase db branch switch <name>     # trabalha nele; todos os comandos subsequentes o seguem
rebase db branch switch            # informa em qual branch você está
rebase db branch switch --off      # volta para o banco de dados principal
rebase db branch delete <name>
rebase db branch prune [--older-than 14d] [--include-dev-diff]
```

O PostgreSQL não copia nem descarta um banco de dados ao qual qualquer outro processo esteja conectado, e o habitual "qualquer outro processo" é o seu próprio `rebase dev`. `create` e `delete` informam o que está mantendo o banco de dados aberto; `--force` desconecta essas sessões primeiro.

Cada branch é uma cópia completa em disco, por isso elas precisam ser limpas. `prune` remove três coisas: uma entrada cujo banco de dados foi excluído fora do Rebase, um banco de dados de branch cuja entrada nunca foi gravada e — apenas com `--older-than` — branches que ultrapassaram a idade informada. Ele solicita confirmação antes de remover qualquer item, a menos que você passe `--yes`.

`switch` registra o branch em `.rebase/branch.json` e nunca edita o `.env`. Ele tem precedência sobre `DATABASE_URL` no `.env` e perde para `--database-url` ou um `DATABASE_URL` definido no shell; portanto, uma flag na linha de comando sempre sobrepõe uma troca feita anteriormente. Excluir o branch no qual você está atualmente o retorna ao banco de dados principal, em vez de deixar o ambiente apontado para um banco de dados inexistente.

:::note[Não aplicável ao banco de dados de desenvolvimento gerenciado]
`push`, `generate` e `migrate` planejam seu trabalho com o Atlas, que precisa de um segundo banco de dados vazio para comparação — e o PGlite gerenciado atende a exatamente um. Executá-los lá é interrompido com uma mensagem informando isso. Aponte `DATABASE_URL` para um PostgreSQL real para o fluxo de trabalho de migrações; o `rebase dev` já cria tabelas ausentes de forma aditiva no banco gerenciado.

`branch` é recusado lá por um motivo relacionado. `CREATE DATABASE ... TEMPLATE` no PGlite grava uma entrada de catálogo e não copia nada, de modo que o branch apontaria para o banco de dados do qual foi clonado — qualquer gravação que você pretendesse isolar acabaria no seu banco de dados de desenvolvimento. `rebase dev --docker` fornece um servidor real compatível com branches.
:::

### `rebase apps init` / `rebase apps config`

```bash
rebase apps list             # os apps que este projeto declara
rebase apps init <name>      # registra um novo app no rebase.json
rebase apps config <app>     # para o que um app específico se resolve
```

### `rebase status`

Tudo o que este projeto declara e se o ambiente realmente faz o binding de cada item:

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

Três arquivos decidem o que um backend pode alcançar, e este comando imprime todos os três juntos:
`rebase.json` diz onde está seu código e quem executa o servidor,
`config/resources.ts` diz do que o projeto precisa, e o ambiente define como alcançar cada recurso. Todo o resto — `rebase.resources.json`, o manifesto do bundle — é gerado a partir do arquivo intermediário para ferramentas que não podem executar seu código, e você nunca precisa editá-lo manualmente.

Um `○` representa o estado importante de se conhecer antes de um deploy, em vez de depois: declarado, não configurado. Um `✗` significa que o ambiente define algo de forma *incorreta*, o que impede a inicialização em vez de degradar graciosamente.

### `rebase resources`

O que este projeto declara como necessário — os bancos de dados, buckets, tópicos e filas solicitados pelo seu código de configuração, e os crons e functions definidos pelos seus arquivos:

```bash
rebase resources            # lista os recursos
rebase resources --write    # regenera rebase.resources.json
rebase resources --check    # falha se o grafo comitado estiver desatualizado
rebase resources --json     # legível por máquina
```

`rebase resources --check` é uma novidade — a flag usada em pipelines de CI para falhar quando um `rebase.resources.json` não corresponder mais ao código de configuração.

Um recurso é declarado no código de configuração — `database("analytics")`, `bucket("media")`, `topic("signups")`, `queue("thumbnails")` — ou é um arquivo em `backend/crons` ou `backend/functions`, nunca sendo escrito manualmente em `rebase.resources.json`, que é gerado a partir dessas declarações para que um host possa ler o que um projeto precisa sem compilá-lo. Cada entrada registra quem o utiliza (`collection:events`, `property:posts.cover`, `function:report`).

Um backend também possui um banco de dados padrão e uma fonte de armazenamento padrão que ninguém declara. Ambos são listados aqui, marcados como `implicit`, e nenhum dos dois é gravado no `rebase.resources.json` — o host os fornece; portanto, registrá-los solicitaria o provisionamento de algo que ninguém pediu.

Para verificar o que a plataforma mantém para um projeto em relação ao que seu código declara e para remover um banco de dados provisionado que o código não referencia mais, consulte `rebase cloud resources` abaixo.

### `rebase cloud`

Tudo relacionado ao Rebase Cloud, que está em beta privado. Consulte o [guia do Rebase Cloud](/docs/deployment/cloud/) para saber o que ele é e o que o beta não inclui.

Cada grupo responde a `--help`, e `--help` nunca executa o comando. A maioria dos comandos atua no projeto vinculado em `.rebase/cloud.json`; `--project <id>` opera em um projeto sem a necessidade de vinculá-lo.

Três opções se aplicam globalmente: `--json` para saída legível por máquina (também o padrão quando usado com pipe ou com `REBASE_JSON=1`), `--url <origin>` para direcionar a um control plane específico (ou `REBASE_CLOUD_URL`) e `--project, -p <id>`.

#### Autenticação

```bash
rebase cloud login      # sign in to the control plane
rebase cloud logout     # sign out
rebase cloud whoami     # the current session, or what REBASE_TOKEN may do
rebase cloud tokens create --can deploy,logs   # a token for CI, shown once
```

#### Vínculo de projeto

```bash
rebase cloud link         # vincula este diretório a um projeto na nuvem
rebase cloud link [url]   # ou direto a um backend: sem control plane, sem login, e o restante da família é recusado até que você desvincule
rebase cloud unlink       # remove o vínculo
rebase cloud use [org]    # seleciona a organização ativa
rebase cloud open         # abre o dashboard em um navegador
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
rebase cloud deploy [app] [--source .]   # faz o deploy de um app e transmite os logs de build
rebase cloud logs [--runtime] [-f]       # logs de build ou do processo em execução
rebase cloud deployments list [--limit N|--all]
rebase cloud rollback [id] [-y]          # reverte para um deploy bem-sucedido
rebase cloud cancel [-y]                 # cancela o build em andamento
rebase cloud start | stop | restart [-y] # stop e restart precisam de -y
rebase cloud status                      # status do projeto em uma única visualização
rebase cloud metrics                     # CPU / memória / disco em tempo real
rebase cloud debug [health|logs|…]       # diagnostica uma implantação, somente leitura
```

`deploy` sem o nome de um app implanta o backend. O deploy do bundle do backend também faz o upload do código-fonte do projeto — o que o git rastreia, nunca um `.env` — para que uma atualização de plataforma possa recompilá-lo; `--no-source` pula isso nessa execução, e `cloud settings set --platform-rebuilds off` desativa essa função e exclui a cópia armazenada. `--allow-downgrade` implanta uma versão anterior.

#### Configuração

```bash
rebase cloud env list | set | unset | reveal | pull
rebase cloud domains list | add <domain> | verify [domain] | remove <domain>
rebase cloud extensions list | enable | disable
rebase cloud settings show | set        # name, branch, repo, subdomain, rebuilds
```

#### Organizações

```bash
rebase cloud orgs list | create | members
```

#### Bancos de Dados

```bash
rebase cloud db list | create | info | connect | test
rebase cloud db backup list | create | restore | status | download
rebase cloud db pitr status | restore | cutover | discard
```

`db connect` abre uma porta local que *é* o banco de dados gerenciado (sem endpoint público) até que Ctrl-C seja pressionado; `--reveal` adiciona a senha. Apenas para proprietário (owner) ou administrador.

#### Recursos

O que a plataforma mantém para o projeto, em comparação com o que seu código declara.

```bash
rebase cloud resources                       # cada banco de dados e bucket: declarado? provisionado?
rebase cloud resources prune database <key>  # remove um recurso que o código não declara mais
```

Um deploy nunca remove um banco de dados provisionado quando sua declaração é excluída — isso equivaleria a dados apagados por um push. Ele mantém, vincula e cobra por ele até que alguém o remova explicitamente pelo nome.

#### Computação

O que o projeto reserva e quanto isso custa.

```bash
rebase cloud compute            # a reserva atual e seu custo mensal
rebase cloud compute set        # altera as configurações de reserva
```

`compute set` aceita `--cpu`, `--memory`, `--replicas`, `--spot`,
`--scale-to-zero`, `--db-instances`, `--db-cpu`, `--db-memory`,
`--storage`, `--autoscale-max`, `--autoscale-cpu-target` e `--no-autoscale`.
Não há níveis de planos: tudo é cobrado por recurso. Consulte
[Rebase Cloud](/docs/deployment/cloud/).

#### Armazenamento, webhooks, clusters e faturamento

```bash
rebase cloud storage             # lista os buckets de armazenamento
rebase cloud storage create      # provisiona armazenamento gerenciado pela plataforma
rebase cloud storage attach      # anexa seu próprio bucket compatível com S3
rebase cloud webhooks list | create | delete
rebase cloud clusters list | add | verify   # os clusters nos quais os tenants rodam; `add` registra um a partir de um kubeconfig
rebase cloud billing             # a conta de faturamento e o cartão registrado
rebase cloud billing setup       # anexa um cartão, uso único, abre o navegador
rebase cloud billing checkout    # uma sessão do Stripe para um projeto
```

### `rebase generate-sdk`

Gera um SDK tipado a partir das definições de suas collections:

```bash
rebase generate-sdk
```

Cria tipos TypeScript e um cliente com tipagem estrita para todas as suas collections.

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

### `rebase skills install`

Instala as reference skills do Rebase para seus assistentes de codificação com IA — engloba cada `--agent` citado acima:

```bash
rebase skills install
rebase skills install --agent claude,cursor
rebase skills install --agent all
```

Consulte [Agent Skills](/docs/ai/skills) para obter a lista completa e os locais onde os arquivos são gravados.

### `rebase telemetry`

Compartilhamento anônimo de telemetria de uso. **O comando `rebase init` pergunta uma vez por projeto e a opção padrão é sim — nada é enviado a menos que você responda:**

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
