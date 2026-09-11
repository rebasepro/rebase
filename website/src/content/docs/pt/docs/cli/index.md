---
sourceHash: ace00ff64a9b8e17
title: Referência da CLI
sidebar_label: CLI
description: Comandos da CLI do Rebase para inicialização de projetos, geração de schema, migrações de banco de dados e geração de SDK.
---

## Visão Geral

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

`--json` é a flag seletora e, fora da família de comandos `cloud`, é a única: `rebase status`, `rebase resources` e `rebase apps list` enviam um valor JSON na stdout — o resultado, ou um envelope `{"error": {"message", "code", "hint", "issues"}}` com um código de saída diferente de zero — em **todas** as finalizações do comando, permitindo que o chamador faça o parse da stdout incondicionalmente. Sem ela, esses comandos exibem texto legível por humanos e as falhas vão para a stderr. O comando `rebase cloud` utiliza o mesmo envelope e é a única exceção à flag: ele também ativa o JSON automaticamente quando a stdout não for um TTY ou quando `REBASE_JSON=1` estiver definido. Assim, `rebase cloud status | cat` gera JSON, enquanto `rebase status | cat` não — em um script, passe `--json` explicitamente em vez de depender de qualquer uma dessas regras.

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
| `--headless` | Apenas backend — sem painel de administração e sem arquivos de coleção. `--template` não tem efeito, pois não há coleções para popular |
| `-y, --yes` | Nunca solicita confirmação. **Obrigatório onde não houver terminal para responder**, como no CI. Ignora o git init e a instalação de dependências — os padrões interativos dizem sim para ambos, portanto passe `--git` / `--install` se desejar executá-los |
| `-i, --install` | Instala dependências após o scaffolding |
| `-g, --git` | Inicializa um repositório e faz o primeiro commit |
| `--database-url <url>` | Usa um banco de dados existente em vez do gerenciado |
| `--introspect` | Gera coleções a partir desse banco de dados. Implica `--template blank` e requer `--install` |
| `--project <slug>` | Vincula o scaffolding a um projeto do Rebase Cloud |
| `--setup-key <key>` | A chave de uso único que autentica essa vinculação |

### `rebase dev`

Inicia o servidor de desenvolvimento:

```bash
rebase dev
```

Inicia tanto o frontend quanto o backend com hot reloading.

Ambas as portas são derivadas do caminho do projeto, permitindo que vários projetos Rebase sejam executados lado a lado. Use as URLs exibidas por `rebase dev`. Fixe uma porta com `rebase dev --port 3001`.

### `rebase build`

Compila o projeto em um bundle pronto para deploy em `dist-bundle/`:

```bash
rebase build
```

O bundle é o artefato que você publica — a imagem de runtime o carrega, portanto não há imagem de aplicação para você construir manualmente. Flags úteis:

| Flag | Efeito |
|------|--------|
| `--out <dir>` | Grava o bundle em outro local que não seja `dist-bundle/` |
| `--vendor` | Sempre instala e empacota as dependências no bundle |
| `--no-vendor` | Nunca faz vendor; o pod instala na primeira inicialização |
| `--skip-type-check` | Pula a verificação de tipos (mais rápido, menos seguro) |
| `--no-static` | Pula a compilação do frontend |

As dependências são vendored por padrão para que a reinicialização de um pod não sofra uma espera de instalação de 35 a 55 segundos. Uma árvore que ultrapasse 200 MB no disco é descartada, pois o limite de upload é de 100 MB comprimido — consulte o changelog para entender o motivo.

### `rebase start`

Executa o bundle compilado como um servidor de produção:

```bash
rebase start
```

Lê a variável `PORT` e o restante do `.env`, diferentemente de `rebase dev`. Aponte para um bundle em outro local com `rebase start --bundle ./dist-bundle`.

### `rebase apps list`

Exibe os aplicativos que este repositório declara:

```bash
rebase apps list
```

Um repositório pode declarar mais de uma aplicação implantável — por exemplo, um backend e um site de marketing. É assim que você visualiza sobre o que o `rebase build` e o deploy irão atuar.

### `rebase eject`

Assume o controle do processo do servidor e de sua imagem:

```bash
rebase eject
```

Grava o ponto de entrada do backend e um `Dockerfile` no projeto e transfere o controle do seu backend, para que o repositório construa sua própria imagem em vez de executar o runtime publicado. A partir desse momento, **as atualizações do runtime da plataforma não o alcançarão mais**, e as configurações de CORS, autenticação, armazenamento e encerramento passam a ser de sua responsabilidade.

Faça uma prévia com `rebase eject --dry-run`, que lista o que mudaria sem alterar nada. `--force` substitui um `backend/src/index.ts` ou `env.ts` existente, mantendo o arquivo atual como `<name>.bak`.

### `rebase schema generate`

Gera o schema do Drizzle ORM a partir de suas coleções TypeScript:

```bash
rebase schema generate
```

Isso lê suas coleções em `config/collections/` e gera `backend/src/schema.generated.ts` contendo as definições de tabela, enums e relações do Drizzle.

### `rebase db push`

Aplica alterações de schema diretamente ao banco de dados (apenas desenvolvimento):

```bash
rebase db push
```

:::caution
`db push` modifica o banco de dados diretamente, sem arquivos de migração. Use `db generate` + `db migrate` para produção.
:::

### `rebase db generate`

Gera arquivos de migração SQL a partir das alterações de schema:

```bash
rebase db generate
```

Cria arquivos de migração com timestamp em `drizzle/` que podem ser revisados e commitados.

### `rebase db migrate`

Executa migrações pendentes do banco de dados:

```bash
rebase db migrate
```

Aplica todas as migrações pendentes ao banco de dados.

### `rebase db backup` / `backups` / `restore`

```bash
rebase db backup --out ./backups        # ou s3://bucket/prefix, gs://bucket/prefix
rebase db backups                       # lista o que está armazenado
rebase db restore ./backups/<file>.dump --yes
```

`backup` executa o `pg_dump`; `restore` executa o `pg_restore` e é destrutivo, portanto requer `--yes`. `--out` aceita um caminho local ou uma URL de armazenamento de objetos, tendo como padrão `$BACKUP_DESTINATION` ou `./backups`.

### `rebase db pull`

Copia outro banco de dados para o banco local de desenvolvimento:

```bash
rebase db pull --from postgres://…  [--anonymize]
```

`--anonymize` substitui dados pessoais durante a importação, permitindo que uma cópia de produção seja trabalhada localmente sem levar dados reais de clientes para um computador pessoal.

O `pg_dump` remove privilégios, portanto a cópia chegaria com as políticas de RLS da origem, mas sem nenhuma das permissões que as sustentam — fazendo com que qualquer leitura como `rebase_user` falhe com `permission denied`. O pull provisiona novamente a role da aplicação em seguida, usando a mesma rotina da inicialização e do `rebase db push`, garantindo que as tabelas internas do Rebase continuem revogadas como devem ser.

O destino é sempre o banco de desenvolvimento local deste projeto e não pode ser alterado: `--database-url` é rejeitado caso seja fornecido, impossibilitando a execução acidental de um "pull para produção". `--from` é a única direção permitida.

### `rebase db url`

Exibe a string de conexão que este projeto está utilizando, e nada mais, permitindo redirecionamento via pipe:

```bash
rebase db url
psql "$(rebase db url)"
```

O banco de desenvolvimento gerenciado é o principal caso de uso para isso: o arquivo `.env` deixa o `DATABASE_URL` comentado propositalmente, e a porta é derivada do caminho do projeto, logo nada no disco a especifica textualmente. Quando você define um `DATABASE_URL` próprio, é isso que este comando imprime — a ordem de resolução é a mesma seguida por todos os outros comandos. Ele inicializa o banco gerenciado se ele ainda não estiver em execução.

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
rebase db branch switch <name>     # trabalha nele; todos os comandos seguintes o utilizarão
rebase db branch switch            # informa em qual branch você está
rebase db branch switch --off      # volta para o banco de dados principal
rebase db branch delete <name>
rebase db branch prune [--older-than 14d] [--include-dev-diff]
```

O PostgreSQL não copia nem remove um banco de dados ao qual haja qualquer outra conexão ativa, e geralmente esse "qualquer outra conexão" é o seu próprio `rebase dev`. Os comandos `create` e `delete` identificam o que está mantendo o banco aberto; `--force` desconecta essas sessões primeiro.

Cada branch é uma cópia completa no disco, portanto elas precisam ser limpas regularmente. O comando `prune` remove três coisas: um registro cujo banco foi excluído fora do Rebase, um banco de branch cujo registro nunca foi gravado e — apenas com `--older-than` — branches mais antigas do que o período especificado. Ele pede confirmação antes de remover qualquer item, a menos que você passe `--yes`.

`switch` grava a branch em `.rebase/branch.json` e nunca altera o `.env`. Ele tem precedência sobre o `DATABASE_URL` no `.env`, mas perde para `--database-url` ou para uma variável `DATABASE_URL` no shell, de modo que uma flag na linha de comando sempre sobrepõe uma troca feita anteriormente. Excluir a branch em que você se encontra retorna você ao banco principal, em vez de deixar o ambiente apontando para um banco que já não existe mais.

:::note[Não aplicável ao banco de desenvolvimento gerenciado]
`push`, `generate` e `migrate` planejam suas ações com o Atlas, que precisa de um segundo banco de dados vazio para comparação — e o PGlite gerenciado suporta exatamente um. Executá-los nesse ambiente gera uma mensagem de erro informando isso. Aponte `DATABASE_URL` para um PostgreSQL real para o fluxo de trabalho de migrações; o `rebase dev` já cria tabelas ausentes de forma aditiva no banco gerenciado.

O comando `branch` é recusado lá por um motivo semelhante. `CREATE DATABASE ... TEMPLATE` no PGlite apenas grava uma entrada no catálogo sem copiar nada, de modo que a branch apontaria para o próprio banco clonado — fazendo com que qualquer gravação que você pretendia isolar fosse parar no seu banco de desenvolvimento. O uso de `rebase dev --docker` fornece um servidor real no qual as branches funcionam perfeitamente.
:::

### `rebase apps init` / `rebase apps config`

```bash
rebase apps list             # os apps que este projeto declara
rebase apps init <name>      # registra um novo app no rebase.json
rebase apps config <app>     # a configuração final resolvida de um app
```

### `rebase status`

Tudo o que este projeto declara e se o ambiente realmente possui essas associações:

```bash
rebase status               # todos os recursos e as variáveis que eles leem
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

Três arquivos determinam o que um backend pode acessar, e este comando exibe os três juntos:
`rebase.json` define onde está seu código e quem executa o servidor,
`config/resources.ts` define o que o projeto precisa, e o ambiente define como
alcançar cada item. Todo o restante — `rebase.resources.json`, o manifesto
do bundle — é gerado a partir do segundo arquivo para ferramentas que não podem executar seu
código, portanto você nunca o edita manualmente.

O símbolo `○` indica o estado que convém conhecer antes do deploy, e não depois:
declarado, mas não configurado. Um `✗` indica que o ambiente define algo de forma *incorreta*,
o que impede a inicialização em vez de apenas degradar graciosamente.

### `rebase resources`

O que este projeto declara que necessita — bancos de dados, buckets, tópicos e
filas exigidos pelo código de configuração, além de crons e funções definidos por seus arquivos:

```bash
rebase resources            # lista-os
rebase resources --write    # regenera rebase.resources.json
rebase resources --check    # falha se o grafo commitado estiver desatualizado
rebase resources --json     # legível por máquina
```

`rebase resources --check` é uma novidade — a flag utilizada por rotinas de CI para falhar
caso o `rebase.resources.json` não coincida mais com o código de configuração.

Um recurso é declarado no código de configuração — `database("analytics")`,
`bucket("media")`, `topic("signups")`, `queue("thumbnails")` — ou é um arquivo
em `backend/crons` ou `backend/functions`, nunca sendo escrito manualmente em
`rebase.resources.json`, que é gerado a partir dessas declarações para que um host possa
ler o que o projeto precisa sem ter que compilá-lo. Cada entrada registra quem o utiliza
(`collection:events`, `property:posts.cover`, `function:report`).

Um backend também possui um banco de dados padrão e uma fonte de armazenamento padrão que ninguém
declara explicitamente. Ambos são listados aqui, marcados como `implicit`, e nenhum deles é gravado em
`rebase.resources.json` — o host já os fornece; registrá-los solicitaria
o provisionamento de algo que ninguém pediu.

Para ver o que a plataforma mantém para um projeto em comparação ao que seu código declara,
e para remover um banco de dados provisionado que o código não menciona mais, veja
`rebase cloud resources` abaixo.

### `rebase cloud`

Tudo relacionado ao Rebase Cloud, que está em beta privado. Consulte o
[guia do Rebase Cloud](/docs/deployment/cloud/) para saber o que ele é e o que o beta
não inclui.

Todo grupo aceita `--help`, e `--help` nunca executa o comando. A maioria dos comandos
atua no projeto vinculado em `.rebase/cloud.json`; `--project <id>` opera em
um projeto sem vinculá-lo.

Três opções se aplicam a todos os comandos: `--json` para saída legível por máquina (também o
padrão em pipes ou com `REBASE_JSON=1`), `--url <origin>` para apontar para um
plano de controle específico (ou `REBASE_CLOUD_URL`), e `--project, -p <id>`.

#### Autenticação

```bash
rebase cloud login      # faz login no plano de controle
rebase cloud logout     # faz logout
rebase cloud whoami     # exibe a sessão atual
```

#### Vinculação de projeto

```bash
rebase cloud link         # vincula este diretório a um projeto na nuvem
rebase cloud link [url]   # ou diretamente a um backend: sem plano de controle, sem login, e os demais comandos da família serão recusados até que você desvincule
rebase cloud unlink       # remove a vinculação
rebase cloud use [org]    # seleciona a organização ativa
rebase cloud open         # abre o dashboard no navegador
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
rebase cloud logs [--runtime] [-f]       # logs de build, ou do processo em execução
rebase cloud deployments list [--limit N|--all]
rebase cloud rollback [id] [-y]          # reverte para um deploy bem-sucedido
rebase cloud cancel [-y]                 # cancela a compilação em andamento
rebase cloud start | stop | restart [-y] # stop e restart exigem -y
rebase cloud status                      # status resumido do projeto
rebase cloud metrics                     # CPU / memória / disco em tempo real
rebase cloud debug [health|logs|…]       # diagnostica uma implantação, apenas leitura
```

`deploy` sem o nome do app faz o deploy do backend.

#### Configuração

```bash
rebase cloud env list | set | unset | reveal | pull
rebase cloud domains list | add | verify | remove
rebase cloud extensions list | enable | disable
rebase cloud settings show | set        # name, branch, repo, subdomain
```

#### Organizações

```bash
rebase cloud orgs list | create | members
```

#### Bancos de dados

```bash
rebase cloud db list | create | info | connect | test
rebase cloud db backup list | create | restore | status | download
rebase cloud db pitr status | restore | cutover | discard
```

`db connect` abre uma porta local que *é* o banco de dados gerenciado (sem
endpoint público) até Ctrl-C; `--reveal` exibe a senha. Apenas para proprietário (owner) ou admin.

#### Recursos

O que a plataforma mantém para o projeto em relação ao que o código dele declara.

```bash
rebase cloud resources                       # cada banco e bucket: declarado? provisionado?
rebase cloud resources prune database <key>  # remove um recurso que o código não declara mais
```

Um deploy nunca remove um banco provisionado quando sua declaração é apagada — isso
significaria apagar dados por meio de um push. A plataforma o mantém, conecta e cobra até que alguém
o remova explicitamente pelo nome.

#### Computação

O que o projeto reserva e quanto isso custa.

```bash
rebase cloud compute            # a reserva atual e seu custo mensal
rebase cloud compute set        # altera a reserva
```

`compute set` aceita `--cpu`, `--memory`, `--replicas`, `--spot`,
`--scale-to-zero`, `--db-mode`, `--db-instances`, `--db-cpu`, `--db-memory`,
`--storage`, `--autoscale-max`, `--autoscale-cpu-target` e `--no-autoscale`.
Não existem planos fixos: tudo é cobrado por recurso. Veja
[Rebase Cloud](/docs/deployment/cloud/).

#### Armazenamento, webhooks, clusters e cobrança

```bash
rebase cloud storage             # lista buckets de armazenamento
rebase cloud storage create      # provisiona armazenamento gerenciado pela plataforma
rebase cloud storage attach      # anexa seu próprio bucket compatível com S3
rebase cloud webhooks list | create | delete
rebase cloud clusters list | add | verify   # os clusters onde rodam os tenants; `add` registra a partir de um kubeconfig
rebase cloud billing             # conta de cobrança e cartão cadastrado
rebase cloud billing setup       # vincula um cartão, uso único, abre no navegador
rebase cloud billing checkout    # sessão do Stripe para um projeto
```

### `rebase generate-sdk`

Gera um SDK cliente tipado a partir das definições das suas coleções:

```bash
rebase generate-sdk
```

Cria tipos TypeScript e um cliente com segurança de tipos para todas as suas coleções.

### `rebase doctor`

```bash
rebase doctor
```

O comando a ser executado quando algo estiver errado e você ainda não souber o quê. Ele
apenas relata e nunca altera nada, portanto é seguro executá-lo contra qualquer banco de dados que você
consiga acessar.

**Sem um banco de dados.** Estas verificações rodam primeiro, pois tudo que impede um projeto
de funcionar acontece antes mesmo de qualquer tabela poder ser comparada:

| Verificação | Motivo |
| --- | --- |
| Versão do Node | Comparada à faixa que a CLI declara. Uma versão muito antiga não é reportada como "Node não suportado" — ela se manifesta como um erro de sintaxe dentro de uma dependência. |
| Gerenciadores de pacote | Dois lockfiles em um projeto. Rodar `npm install` em um workspace pnpm reestrutura o `node_modules` em um formato com o qual o pnpm discorda, e o sintoma é `Cannot find module` horas depois. |
| Slugs duplicados | O registro mantém a última coleção registrada, portanto a outra não é dada como ausente — ela é servida como a vencedora, sob seu próprio nome. |
| Sanidade do `.env` | Um `JWT_SECRET` com menos de 32 caracteres (o que a produção recusa para inicializar) e `NODE_ENV=production` sem `CORS_ORIGINS` nem `FRONTEND_URL`. Os valores nunca são exibidos. |
| Divergência de versão do `@rebasepro/*` | O mesmo pacote fixado em versões diferentes entre os arquivos `package.json` do projeto. Duas cópias quebram o `instanceof` entre elas, falhando como uma guarda de tipo (type guard) que rejeita seu próprio tipo. |
| Strings de conexão | Um `=` não codificado em um parâmetro de URL, que as próprias ferramentas do PostgreSQL recusam ao fazer o parse — quebrando backups e o `psql` enquanto o app continua funcionando. |
| Funções customizadas | O que cada função requer de seu host, e quais delas não executariam em um runtime edge. |

**Contra o banco de dados**, quando `DATABASE_URL` estiver definido:

| Verificação | Motivo |
| --- | --- |
| Coleções → schema gerado | Se o `schema.generated.ts` está desatualizado. |
| Coleções → banco de dados | Tabelas, colunas, enums, chaves estrangeiras e junções ausentes. |
| Extensões necessárias | Uma propriedade `{ type: "vector" }` precisa do pgvector, que o Rebase instala somente onde o projeto declarou. |
| Carimbo do schema (Schema stamp) | Se este banco foi provisionado a partir destas coleções. Trata-se de um hash, servindo para apontar que os dois divergem, mas nunca qual está à frente. |
| Coleções → tipos do SDK | Se o SDK tipado gerado está desatualizado. |
| Políticas de RLS | Se as políticas do banco correspondem às `securityRules` declaradas e se alguma política referencia uma role que este servidor não pode usar. |

Se o banco de dados estiver inacessível, suas fases serão reportadas como ignoradas com o
motivo correspondente e o restante continuará em execução — consulte [Solução de Problemas](/docs/troubleshooting/).

Finaliza com código diferente de zero quando uma verificação encontra um erro, ou quando uma fase não pôde ser executada
porque o banco de dados fornecido recusa conexões. Uma fase ignorada porque você
não definiu `DATABASE_URL` não é considerada falha.

`rebase doctor --policies` executa apenas as verificações de RLS — sem diff de schema, sem tipos de SDK — e falha de forma segura (fail-closed), sendo o formato ideal para uso como barreira (gate) de CI contra um banco de dados em produção.

### `rebase auth`

Comandos de gerenciamento de autenticação:

```bash
rebase auth reset-password --email admin@example.com --password NewPassword123!
```

### `rebase api-keys`

Gerencia chaves de API com escopo de serviço — a credencial que um agente, script ou outro
serviço utiliza, em oposição à sessão de um usuário final:

```bash
rebase api-keys list
rebase api-keys create --name "Analytics" --permissions '[{"collection":"events","operations":["read"]}]'
rebase api-keys create --name "Full Access" --full-access --expires 90d
rebase api-keys revoke abc123-def456
```

`--permissions` aceita um array JSON de objetos `{ collection, operations }`, ou use
`--full-access` para leitura/gravação/exclusão em todas as coleções e funções. `--expires`
aceita `7d`, `30d`, `90d`, `1y` ou uma data ISO, e `--rate-limit` define as requisições
por janela de 15 minutos. A chave é exibida apenas uma vez, na sua criação.

As chaves passam por dupla validação: as permissões da própria chave e a segurança em nível de linha (RLS) da
identidade sob a qual ela atua são ambas aplicadas, garantindo que uma chave nunca consiga ler mais do que essa identidade pode.

### `rebase skills install`

Instala as skills de referência do Rebase para seu assistente de programação por IA. Suporta
Cursor, Claude Code, Windsurf, Gemini CLI e Antigravity:

```bash
rebase skills install
rebase skills install --agent claude,cursor
rebase skills install --agent all
```

Consulte [Skills do Agente](/docs/ai/skills) para obter a lista completa e saber onde os arquivos são gravados.

### `rebase telemetry`

Compartilhamento anônimo de dados de uso. **`rebase init` pergunta uma vez por projeto, e a confirmação
tem como padrão "sim" — nada é enviado a menos que você responda:**

```bash
rebase telemetry status
rebase telemetry show
rebase telemetry enable
rebase telemetry disable
```

`status` imprime a configuração atual, `show` exibe exatamente o que seria enviado —
esteja o compartilhamento ativado ou não, para que você possa inspecionar os dados antes de decidir — e
os outros dois ativam ou desativam o envio. Se você nunca rodou `init`, nada jamais foi coletado.

## Fluxo de Migração

O fluxo típico para alterações de schema:

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

## Próximos Passos

- **[Schema as Code](/docs/architecture/schema-as-code)** — Como funciona a geração de schema
- **[Início Rápido](/docs/getting-started/quickstart)** — Comece a usar

---
