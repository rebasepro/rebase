---
sourceHash: 98d9c2872375ef18
title: Geração de Schema
sidebar_label: Geração de Schema
description: Gere schemas do Drizzle ORM a partir das tabelas em backend/schema, crie migrações SQL, faça introspecção de um banco de dados existente em arquivos defineTable e mantenha seu banco de dados sincronizado com a Rebase CLI.
---

## Visão Geral

<span class="since-badge" data-since="0.31">Desde 0.31</span>

O Rebase usa um pipeline de **schema-as-code** onde as tabelas que você declara com
`defineTable` em `backend/schema/` são a única fonte da verdade. A CLI
as transforma por meio de um pipeline determinístico:

```
Tables (backend/schema) → Drizzle Schema → SQL Migrations → PostgreSQL
```

Esta página aborda todos os comandos da CLI envolvidos nesse pipeline.

## O Pipeline

### 1. Tabelas → Schema do Drizzle

<span class="since-badge" data-since="0.31">Desde 0.31</span>

As tabelas exportadas por `backend/schema/index.ts` descrevem colunas, tipos, relações,
enums e row-level security. Cada comando abaixo as lê por meio do loader
a partir do qual o backend inicializa, portanto, um schema que não compila — uma tabela sem
`rls`, `"inherit"` sem `defaultRls`, um `defineTable` que o index não
exporta — interrompe o comando com um `SchemaDefinitionError` nomeando cada problema,
e nada é gravado. O comando `schema generate` gera um arquivo de schema do Drizzle ORM
a partir delas.

Cada comando que lê o schema aceita `--schema-dir <dir>` para um projeto
que mantém suas tabelas em outro lugar; o padrão é `backend/schema`, ou a
chave `tables` da aplicação backend em `rebase.json`. `--collections` / `-c`, a
flag anterior à versão 0.31, é recusada com uma mensagem indicando o codemod
([`rebase migrate collections-to-tables`](#rebase-migrate)), assim como um
projeto que ainda possui `config/collections`.

### 2. Schema do Drizzle → Migrações

A partir do schema gerado do Drizzle, `db generate` compara as diferenças em relação às migrações já existentes em `backend/drizzle/migrations/`, reproduzidas em um banco de dados temporário (scratch database), e produz arquivos de migração SQL com timestamp. Ele nunca lê o seu banco de dados: uma coluna que o boot ou o `db push` já adicionou ainda será gerada como `ADD COLUMN`.

### 3. Migrações → PostgreSQL

O comando `db migrate` aplica migrações pendentes ao seu banco de dados PostgreSQL.

## Comandos

### `rebase schema generate`

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Gere um arquivo de schema do Drizzle ORM a partir das suas tabelas:

```bash
rebase schema generate
```

**O que ele faz:**
- Lê as tabelas exportadas por `backend/schema/index.ts`
- Gera `backend/src/schema.generated.ts` com definições de tabela, enums e relações do Drizzle

**Opções:**

| Flag | Descrição |
|------|-----------|
| `--schema-dir` | O diretório do schema (padrão: `backend/schema`); caminhos relativos são resolvidos a partir de onde você executa o comando |
| `--output, -o` | Caminho de saída para o arquivo de schema gerado; caminhos relativos são resolvidos a partir de onde você executa o comando |
| `--watch, -w` | Monitora alterações e regenera automaticamente |

O **modo watch** é útil durante o desenvolvimento — edite um arquivo de tabela e o schema é regenerado instantaneamente:

```bash
rebase schema generate --watch
```

### `rebase schema stale`

Verifique se o schema gerado ainda corresponde às tabelas:

```bash
rebase schema stale          # report, and exit 1 if anything is stale
rebase schema stale --fix    # regenerate the file instead
```

**O que ele faz:**
- Renderiza o que as tabelas em `backend/schema/` geram e compara, declaração por declaração, com `backend/src/schema.generated.ts`
- Nomeia cada diferença — uma tabela ausente, uma coluna redefinida, um rótulo de enum removido ou chaves estrangeiras nomeadas da forma como uma versão anterior as derivava — e encerra com código diferente de zero
- Com `--fix`, regenera o arquivo em vez de apenas relatar

O `rebase dev` mantém o arquivo atualizado sozinho, portanto esta é a verificação adequada para um build
ou uma etapa de CI. Ele aceita `--schema-dir` e `--output` assim como
o `rebase schema generate`.

### `rebase schema reconcile`

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Flexibilize e remova o que a inicialização não fará, depois de ler o plano:

```bash
rebase schema reconcile                         # relax NOT NULL on columns made nullable or removed
rebase schema reconcile --drop voice_cache.wav  # and drop a column no table declares
```

**O que ele faz:**
- Solicita que o backend em execução planeje contra o seu próprio banco de dados. É para esse banco que o `.env` e o link na nuvem apontam, funcionando portanto no Rebase Cloud, onde nada mais acessa o banco de dados diretamente.
- Planeja `DROP NOT NULL` para cada coluna que uma tabela declara como anulável (nullable), mas que o banco de dados ainda exige.
- Lista todas as colunas que nenhuma tabela declara. Uma coluna que seja `NOT NULL` sem valor padrão bloqueia todas as inserções, portanto ela também é flexibilizada e seus dados permanecem. Remove apenas as colunas especificadas com `--drop <table>.<column>`, e mostra quantas linhas possuem valor em cada uma.
- Aplica as alterações assim que você digita `yes`. O servidor executa o plano apenas com base no digest daquele que você leu; portanto, se o banco de dados ou as tabelas mudarem nesse meio-tempo, ele recusa e você deve revisar novamente. `--yes` pula a confirmação.

A inicialização (boot) apenas adiciona itens; portanto, após remover uma coluna do seu `defineTable`, a coluna permanece no banco de dados, com seus dados. Uma coluna `NOT NULL` sem valor padrão faz com que todas as inserções falhem, e os logs de boot recomendam este comando: sem `--drop` para manter os dados, com a flag para remover a coluna. Faça o deploy da alteração da tabela primeiro, pois o reconcile planeja em relação ao que o backend está executando. Ele precisa de `REBASE_SERVICE_KEY` no `.env`. Localmente, o `rebase db push` cobre o mesmo cenário por meio do seu controle de alterações destrutivas.

### `rebase schema introspect`

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Gera arquivos `defineTable` a partir de um banco de dados PostgreSQL existente:

```bash
rebase schema introspect
```

**O que ele faz:**
- Conecta-se ao banco de dados deste projeto, aquele exibido por `rebase db url` (o banco gerenciado é iniciado caso seja ele); `--database-url` indica outro, e `--docker` usa o banco do Docker Compose
- Lê cada tabela, coluna, tipo, chave estrangeira e política, e gera
  `backend/schema/<table>.ts` — um `defineTable` por tabela — e o
  `backend/schema/index.ts` que as exporta (mesclado ao index já
  existente)
- Declara cada coluna com seu tipo Postgres: `col.uuid()`, `col.varchar({ length })`,
  `col.numeric({ precision, scale })`, um enum com seus rótulos e nome de tipo real
  (um `pgEnum` quando o tipo é compartilhado), um array como `<item>.array()`,
  `col.vector({ dimensions })`, chaves identity e serial, valores padrão — nomeados como
  o Drizzle os nomeia. Um tipo que nenhum builder nomeia torna-se
  `col.custom({ dataType: "<sql type>" })`, que o Rebase serve da forma como o
  driver o retorna; `db generate` e `db push` o recusam até que o planejador
  possa processá-lo
- Declara a coluna de chave estrangeira, o `belongsTo` nela e o
  `hasMany` inverso no alvo; uma tabela de junção torna-se um `manyToMany`, com suas próprias
  colunas como `pivot`
- Lê as políticas de row-level security de cada tabela para o seu `rls`: nome,
  comando, modo, lista `TO`, `USING` e `WITH CHECK`. As políticas `<table>_default_*`
  que o próprio Rebase adiciona são omitidas, para que o `db push` posterior recrie
  cada política como estava. Uma tabela com row-level security ativado e nenhuma política é
  gravada com `rls: "admin-only"`
- Lê todas as expressões (o `USING` de uma política, um CHECK, um padrão de coluna) sob
  o `search_path` usado pelo servidor, `public`, de forma que uma função no
  schema `rebase` seja gravada como `rebase.roles()`
- Converte uma restrição CHECK legível (`total >= 0`) no `.validate()` da coluna e
  mantém a constraint no banco de dados, onde o push subsequente a preserva
- Insere o que não pôde definir com exatidão em um comentário no topo do arquivo da
  tabela e no terminal — um conjunto fechado de strings em uma coluna de texto, uma
  coluna gerada cuja expressão não foi lida, um tipo personalizado — juntamente
  com o que um push faria com isso
- Com `--data-inference`, faz uma amostragem de até 100 linhas por tabela e grava o que for
  de apresentação — títulos, ícones, quadros (boards), ordenações, opções de campo — em
  `frontend/src/cms/<table>.tsx` como um `customizeTable`, caso o frontend do projeto
  dependa de `@rebasepro/cms`. Um projeto headless não recebe nada
- Ao ser executado contra um banco de dados que não está ativo, exibe o mesmo banner que o `db push`
  exibe, uma vez, e não cria nada. Ele imprime o diretório de saída como um
  caminho absoluto

**Opções:**

| Flag | Descrição |
|------|-----------|
| `--schema-dir` | Onde gravar os arquivos de tabela (padrão: `backend/schema`). `--output` foi removido |
| `--schema` | O schema do Postgres a ser lido (padrão: `public`) |
| `--force, -f` | Sobrescreve arquivos de tabela existentes; sem essa flag, arquivos existentes são ignorados |
| `--database-url` | Lê este banco de dados em vez do banco do próprio projeto |
| `--docker` | Lê o banco de dados do compose, iniciando-o se necessário |
| `--data-inference` / `--no-data-inference` | Faz amostragem de até 100 linhas por tabela para detectar formatos, constraints e configurações de painel, ou lê apenas a estrutura. Sem nenhuma das opções, ele pergunta interativamente; sem um terminal, lê apenas a estrutura |

Isso é útil ao adotar o Rebase em um banco de dados existente — execute o introspect
primeiro e depois edite as tabelas geradas. Uma tabela com row-level security desativado é
gravada como qualquer outra, com seu `rls`; o push ativará o RLS, e o dry
run informará isso. Um backend executado sem nenhum `backend/schema` serve o
banco de dados diretamente — consulte [Backend only](/docs/getting-started/headless/).

### `rebase db push`

Aplica alterações de schema diretamente ao banco de dados sem arquivos de migração:

```bash
rebase db push
```

**O que ele faz:**
- Lê o schema gerado do Drizzle
- Aplica alterações diretamente ao banco de dados (CREATE, ALTER, DROP)
- Executa primeiro um teste (dry-run) do plano e para antes de qualquer operação que destrua dados:
  exclusão de tabela, coluna, schema, view ou tipo, um `TRUNCATE`, ou uma alteração de tipo de coluna
  que possa perder valores (`timestamptz` → `date`, `numeric` → `integer`),
  ou uma alteração de chave primária — `(id)` → `(id, locale)` atribui a cada linha um novo id, fazendo
  com que links, chaves estrangeiras e IDs armazenados em outros lugares deixem de encontrar sua linha.
  Ele também para
  antes da remoção de uma constraint CHECK ou EXCLUDE existente no banco: nenhuma linha
  é perdida, mas a partir de então o banco aceita linhas que antes recusava.
  Ele solicita confirmação no terminal (onde Ctrl-C ou Ctrl-D responde não) e recusa
  caso contrário; `--allow-destructive` aplica mesmo assim. `--yes` ainda faz isso
  nesta versão, com um aviso de depreciação; a partir da próxima versão, ela aprovará
  apenas pushes que não destruam nada. Um push interrompido nesse ponto descarta seu banco de dados
  temporário `<db>_dev_diff` ao sair
- Ativa row-level security para todas as tabelas declaradas, incluindo junções, logo após a
  alteração do schema e antes de qualquer etapa que possa falhar, garantindo que um push interrompido no meio do caminho deixe uma nova tabela
  negando todas as requisições em vez de deixá-la aberta
- Aplica as políticas de RLS para as quais o `rls` das suas tabelas compila e **remove políticas substituídas por um push anterior**
- Mantém inalterada
  qualquer constraint CHECK e EXCLUDE em uma tabela declarada. Uma tabela
  não pode declarar nenhuma das duas, portanto são regras próprias do banco de dados, criadas manualmente
  ou importadas por um banco que o `schema introspect` adotou; para remover uma, exclua-a
  manualmente (`ALTER TABLE … DROP CONSTRAINT …`). Triggers e funções que você escreveu
  também não são modificados
- Faz a correspondência exata do
  nome de tudo o que mantém inalterado, incluindo caracteres como `.`, `[`, `]`
  ou `*`
- Constrói qualquer
  [índice de chave estrangeira que o Rebase deriva](/docs/backend/indexes#foreign-keys-are-indexed-for-you)
  que esteja ausente em uma tabela existente **antes** do planejamento, com
  `CREATE INDEX CONCURRENTLY`, para que as gravações na tabela continuem durante a criação;
  o Atlas então o encontra já criado. `--dry-run` lista esses índices e não cria nada
- Aplica uma assinatura (stamp)
  nas políticas que aplica da mesma forma que o boot do servidor faz, de modo que a primeira inicialização após um
  push não precise recriar cada uma delas
- `--dry-run`
  lista as alterações de row-level security que o push faria, sob "Planned
  row-level security changes": as tabelas para as quais o RLS seria ativado e cada
  política que ele cria, substitui ou remove, calculadas da mesma forma que as etapas
  do push decidem. Exibe "No changes" apenas quando nem o schema nem o
  row-level security mudariam. Onde a assinatura de uma política não corresponder à sua
  regra, ou se ela não tiver nenhuma (uma criada por `db migrate` ou manualmente), o dry
  run a recria temporariamente a partir de sua regra sob outro nome, em uma transação com
  rollback, e compara o que o Postgres armazenou: se o resultado for idêntico,
  não há alteração. Portanto, uma regra que o `schema introspect` leu de volta como SQL não gera planejamento de alterações, e
  nem as políticas aplicadas por `db migrate`. Apenas aquelas que não puderam ser comparadas (por exemplo,
  se o lock da tabela não foi concedido em dois segundos) são listadas separadamente. O push
  em si imprime uma única linha com a contagem das alterações
- Exibe cada
  instrução que o Atlas aplica uma única vez. O Atlas conecta-se sem SSL a um banco de dados nesta
  máquina (`localhost`, `127.x`, `::1`) cuja URL não especifique `sslmode`, assim como a aplicação
  faz, em vez de falhar com `SSL is not enabled on the server`; uma URL que
  especifique `sslmode`, ou outro host, é repassada exatamente como escrita. Uma execução do Atlas
  que falhe antes de planejar não deixa nenhum banco de dados `<db>_dev_diff` para trás
- `--dry-run`
  não grava nada no projeto: `src/schema.generated.ts` é mantido como está,
  e as cópias `drizzle/*.sql` que uma versão anterior commitou são listadas, não
  excluídas. Apenas os dados de entrada do plano vão para `.rebase/sql/`, que não é commitado
- **Não** cria arquivos de migração

**Quanto tempo leva.** Quase todo o tempo de um push é consumido pelo Atlas
calculando o plano: ele constrói o schema desejado em um banco de dados temporário e compara as diferenças
com o banco real, e esse custo cresce mais rápido do que o número de tabelas — em um laptop
ocioso, cerca de 0,25 s por plano para 11 tabelas, 0,9 s para 111 e 5,5 s para 411. Um push que
não altera nada planeja uma vez; um que altera algo planeja duas vezes (o dry-run
que o controle de alterações destrutivas avalia, e depois a aplicação). Portanto, um push em um schema de
400 ou mais tabelas leva dezenas de segundos, e mais ainda em uma máquina ocupada ou lenta.
Esse tempo é do Atlas, não do seu banco de dados: as etapas complementares — geração de
SQL, lock de RLS, busca, triggers, políticas, roles — levam poucos segundos
nessa escala, usando uma única conexão com seu banco de dados.

**Os arquivos que ele gera pelo caminho**, todos em `.rebase/sql/` no diretório
do backend. `db push` e `db generate` gravam todos os cinco a partir de suas tabelas
em cada execução, antes de ler qualquer um deles, portanto uma cópia commitada não seria lida por
nada. O diretório possui seu próprio `.gitignore` e nunca é commitado.

| Arquivo | Conteúdo |
|---------|----------|
| `schema.sql` | Tabelas, colunas, constraints e índices — o estado desejado do Atlas e o único sobre o qual ele faz diff |
| `policies.sql` | As políticas de RLS para as quais o `rls` das suas tabelas compila |
| `search.sql` | As funções de busca textual (full-text search) e colunas geradas para tabelas com um bloco `search` |
| `vector.sql` | Extensões pgvector e índices ANN |
| `triggers.sql` | `rebase.set_updated_at()` e as triggers `BEFORE UPDATE` por trás de `.onUpdateNow()` |

O Atlas gerencia apenas o primeiro e nada mais; portanto, o `db push` e a garantia de schema no
momento do boot aplicam os outros quatro por conta própria. Um deploy baseado **apenas em migrações** — que
executa `db migrate` e nunca `db push` — precisa incorporar esses quatro
manualmente em uma migração; o `db generate` avisa quando uma alteração é invisível para o Atlas.

Um projeto que commitou esses arquivos em `drizzle/` em uma versão anterior tem
essas cópias excluídas em sua primeira execução, e o comando lista cada uma delas para que você possa
commitar a exclusão. Ele exclui apenas arquivos que começam com o cabeçalho
do gerador. Arquivos que você mesmo escreveu permanecem, assim como `drizzle/migrations/`.

:::note[Editar uma regra de segurança renomeia sua política]
Uma regra sem um `name` explícito compila para `<table>_<op>_<hash>`, onde o hash cobre a semântica da regra — portanto, *editar* uma regra (em vez de adicionar uma nova) produz uma política com um novo nome e deixa a antiga para trás.

Isso costumava ser um grande problema: o Postgres combina políticas `PERMISSIVE` com operador OR, portanto um `USING (rebase.uid() IS NOT NULL)` obsoleto continuava concedendo tudo, não importando o quão restritiva fosse a sua substituição. Tornar uma regra mais restrita não surtia efeito, e o push informava sucesso.

O `db push` agora reconcilia isso: ele remove políticas geradas que não correspondem mais a nenhuma regra e relata — sem remover — qualquer política com nome personalizado que suas tabelas não descrevam, já que estas são indistinguíveis de SQL escrito deliberadamente por alguém.

Para auditar um banco de dados que recebeu push antes dessa funcionalidade existir, execute `rebase doctor --policies`. Ele funciona como uma validação no CI: encerra com código diferente de zero se houver divergência (drift) e também se não conseguir executar a verificação — ausência de `DATABASE_URL`, caminho de `--schema-dir` que não resolve, permissão de leitura de `pg_policies` não concedida à role do CI. Uma validação que não pôde verificar não passou.

O `doctor` e o `db push` distinguem os dois tipos de políticas órfãs. Uma política com nome gerado foi substituída, e o próximo push a removerá. Qualquer outro nome foi escrito manualmente ou por outra ferramenta e ainda está em vigor: descreva-a no `rls` da tabela correspondente para mantê-la (a visualização de RLS do Studio a importa) ou remova-a manualmente se estiver obsoleta.
:::

:::caution
`db push` modifica o banco de dados diretamente. Use-o apenas em desenvolvimento. Para produção, use `db generate` + `db migrate` para criar arquivos de migração auditáveis.
:::

### `rebase db generate`

Gere arquivos de migração SQL a partir de alterações no schema:

```bash
rebase db generate
```

**O que ele faz:**
- Compara o schema do Drizzle com o estado que as migrações em `drizzle/migrations/` constroem, e não com o seu banco de dados
- Produz arquivos de migração SQL com timestamp em `backend/drizzle/migrations/`
- Os arquivos podem ser revisados, editados e commitados no controle de versão
- Identifica cada
  instrução na nova migração que destrói dados, usando a mesma verificação que o `db push`
  executa antes de aplicar: remoção de tabela, coluna, schema, view ou tipo, um
  `TRUNCATE`, alteração de tipo de coluna que possa perder valores, alteração de chave
  primária ou remoção de uma constraint CHECK ou EXCLUDE que o banco possui. Ele
  ainda grava o arquivo e encerra com código 0, emitindo um aviso sem recusar a execução.
- Conclui orientando sobre o que
  fazer a seguir: `rebase db migrate` e, para a primeira migração de um projeto, a instrução
  `--baseline <version>` necessária caso a inicialização do banco já tenha sido configurada. Uma
  migração posterior não recebe a linha de baseline, pois aplicar baseline a uma migração destrutiva
  pularia seu `DROP`; uma execução que não grava nenhuma migração apenas informa isso.

**Um CHECK adicionado por uma migração sua é removido pela próxima.** O `db generate`
compara seus arquivos de migração, não o banco de dados, e o Atlas não tem como deixar um
objeto de fora dessa comparação (diff). Portanto, uma constraint CHECK ou EXCLUDE que você escreveu
em uma migração manualmente, e que nenhuma tabela pode declarar, retorna como
`ALTER TABLE … DROP CONSTRAINT …` na próxima migração gerada, agrupada
na mesma instrução da alteração real. O relatório acima aponta essa remoção quando
o banco de dados já possui a constraint; ele não a remove do
arquivo. Exclua a cláusula antes de executar `rebase db migrate`, ou deixe
`rebase db migrate --refuse-destructive` barrar a execução. O `db push` lê o
banco de dados e mantém a constraint.

As migrações geradas são arquivos SQL simples — você pode inspecioná-los e modificá-los antes de aplicar.

### `rebase db migrate`

Execute todas as migrações pendentes:

```bash
rebase db migrate
```

**O que ele faz:**
- Lê `drizzle/migrations/` em busca de migrações não aplicadas
- Aplica-as em ordem ao banco de dados
- Rastreia quais migrações já foram aplicadas
- Assina (stamps) as
  políticas de row-level security da mesma forma que o `db push` e o boot do servidor fazem, de modo
  que a primeira inicialização após a migração não as recrie. Como uma migração foi escrita a partir das tabelas da sua época, uma política só é assinada quando corresponde exatamente ao que sua regra produz agora: o comando migrate a recria
  temporariamente a partir de sua regra sob outro nome, em uma transação com rollback, e
  compara com o que o Postgres armazenou, exatamente como o `db push --dry-run` faz. Uma política
  diferente não recebe assinatura, e o próximo boot reaplica sua tabela

`--refuse-destructive`
faz com que ele recuse a execução. Ele executa primeiro um teste (dry-run) das migrações pendentes. Se qualquer
instrução destruir dados, de acordo com a mesma verificação que `db push` e `db generate` usam, ele
lista essas instruções e encerra com código 1. Nada é aplicado, nem mesmo os arquivos
anteriores a essa instrução. Sem essa flag, `db migrate` se comporta como antes e
aplica todos os arquivos pendentes:

```bash
rebase db migrate --refuse-destructive
```

Uma migração que reconstrói uma coluna de busca a remove primeiro, portanto essa flag também recusará
essa migração. Leia a lista exibida e execute `rebase db migrate`
sem a flag para aplicá-la.

#### Fazendo baseline de um banco de dados já inicializado pelo Rebase

Toda inicialização do Rebase valida e garante o schema, e o `rebase db push` o aplica diretamente. Portanto, um banco de dados que já executou qualquer um deles já possui as tabelas e tipos que a primeira migração criaria, e `rebase db migrate` falha com `pq: type "posts_status" already exists (42710)`.

Não há nada de errado com a migração — o banco de dados foi provisionado de outra forma. Registre o estado atual do banco e prossiga com a migração normalmente:

```bash
rebase db migrate --baseline 20260906101530
rebase db migrate
```

A versão é o prefixo numérico do arquivo de migração que descreve o que está no banco de dados *agora*. Essa migração e todas as anteriores a ela são registradas como aplicadas; tudo o que vier depois é executado. Em um banco de dados contra o qual nada foi inicializado anteriormente, nenhum baseline é necessário — basta migrar diretamente.

O mesmo acontece mais tarde no fluxo normal: edite uma tabela enquanto `rebase dev` estiver em execução, e o boot adicionará a coluna antes que `rebase db generate` escreva a migração correspondente; assim, `rebase db migrate` falhará com `column … already exists (42701)`. Aplique o baseline nessa migração da mesma maneira. `--baseline` funciona em um banco de dados que já registra migrações: ele marca tudo até aquela versão como aplicado usando `atlas migrate set` e informa isso, ou avisa que não há nada para registrar caso o histórico já tenha atingido essa versão. Uma versão inexistente em `drizzle/migrations` é recusada antes de qualquer execução, listando as versões disponíveis.

### `rebase db branch`

Branching de banco de dados para desenvolvimento paralelo:

```bash
rebase db branch create feature_auth
rebase db branch switch feature_auth
rebase db branch list
rebase db branch switch --off

rebase db branch info feature_auth
rebase db branch delete feature_auth
```

`rebase db branch switch` (e `switch --off`) e `rebase db branch prune`
são novos. `create`, `list`, `info` e `delete` foram lançados na versão 0.17.

Cada branch é uma cópia completa do banco de dados feita com `CREATE DATABASE ... TEMPLATE`,
portanto necessita de um servidor PostgreSQL real e consome o mesmo espaço em disco que a sua fonte.

### `rebase doctor`

Detecte divergências (three-way drift) entre suas tabelas, o schema gerado do Drizzle e o banco de dados PostgreSQL ativo:

```bash
rebase doctor
```

**O que ele verifica:**
- Tabelas ↔ Schema gerado — estão sincronizados?
- Schema gerado ↔ Banco de dados — existem alterações não aplicadas?
- Tabelas ↔ Banco de dados — há alguma divergência inesperada?

Execute `doctor` sempre que algo parecer dessincronizado. Ele identifica com precisão onde está a divergência.

A comparação com o banco de dados inclui a mesma que o boot faz antes de alertar que `schema.generated.ts` e o banco divergem, executada pelo mesmo código. Assim, todas as diferenças que o boot alerta estão também no relatório, nos mesmos termos: uma coluna NOT NULL de um lado e anulável do outro, e uma coluna que o banco de dados ainda tem mas o arquivo não possui mais (o boot nunca remove colunas, então uma propriedade renomeada deixa a coluna antiga para trás). Cada uma é um aviso, e a solução sugerida aponta para `rebase db push`.

A comparação com o banco lê o banco de dados do projeto, resolvido da forma como `rebase db url` resolve — em um scaffold novo, o banco gerenciado, que o `doctor` inicia. Quando nenhum pode ser resolvido, essa fase é informada como **ignorada (skipped)** em vez de aprovada, e a execução nunca termina com "All schemas are in sync" — uma verificação que não ocorreu não é garantia de conformidade.

Ele também lista qualquer tabela sem um [bloco `search`](/docs/backend/search) que contenha mais de cerca de 10.000 linhas. Uma busca nessa tabela — no campo de busca do admin, `.search()`, `?searchString=` — é feita com `ILIKE '%term%'` sobre as colunas de texto, o que nenhum índice consegue atender; logo, cada busca lê a tabela inteira, e a contagem lê tudo novamente (cerca de um terço de segundo com 100.000 linhas, crescendo proporcionalmente). A contagem de linhas é a estimativa do próprio Postgres, portanto a verificação não realiza varreduras de leitura (scans). Isso é apenas uma dica: não altera o código de saída e nada é indexado automaticamente.

Ele identifica uma **junção órfã (orphaned junction)**: uma tabela em `public` com formato de junção many-to-many que nenhuma tabela declara. O formato consiste em duas colunas que juntas formam a chave primária, cada uma sendo chave estrangeira para uma tabela declarada. Renomear ou remover um `manyToMany` deixa a junção antiga para trás, pois push e boot apenas criam tabelas, mantendo todas as linhas de vínculo lá. Esta observação é apenas informativa, portanto não altera o código de saída. Sua correção é o comando `DROP TABLE`, que o `doctor` exibe mas nunca executa.

### `rebase generate-sdk`

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Gere um SDK tipado a partir das suas tabelas:

```bash
rebase generate-sdk
```

**O que ele faz:**
- Lê as tabelas exportadas por `backend/schema/index.ts` por meio do loader usado no boot do backend, garantindo que o SDK descreva exatamente as tabelas servidas; um schema que não compila interrompe a execução
- Gera tipos TypeScript para cada tabela em `generated/sdk/`
- Produz um arquivo `database.types.ts` para uso com `createRebaseClient<Database>()`: o tipo `Database`, `TableName` (a união de todos os slugs) e `tablesDictionary` / `TablesDictionary`, o mapeamento do acessador (accessor) para o slug

`rebase dev` executa isso automaticamente na inicialização e a cada salvamento em
`backend/schema/`. Execute-o manualmente em CI, em um repositório que não possui
tabelas próprias (veja `--from` abaixo) ou em qualquer lugar onde `rebase dev` não esteja em execução.

**Opções:**

| Flag | Descrição |
|------|-----------|
| `--schema-dir` | O diretório do schema (padrão: `backend/schema`, ou a chave `tables` em `rebase.json`); caminhos relativos são resolvidos a partir de onde você executa o comando |
| `-o`, `--output` | Diretório de saída para o SDK (padrão: `generated/sdk/`) |
| `--from <link\|url>` | Lê o schema de um projeto em execução em vez do código-fonte local. `link` usa o projeto vinculado a este checkout. |
| `--token` | Token Bearer para o endpoint de contrato (padrão: `$REBASE_SERVICE_KEY` do shell; `.env` não é lido) |
| `--register` | Também tipa os dados do lado do servidor: grava os tipos e uma declaração `Register` em `backend/generated/` e registra isso em `rebase.json` — consulte [Dados tipados do lado do servidor](/docs/backend/typed-server-data/) |

`--from` é o que permite a um repositório que não contém tabelas — um
frontend separado, uma segunda aplicação web, um aplicativo móvel — gerar um cliente tipado a partir do
projeto com o qual se comunica: ele lê as `tables` de `/api/meta/contract` do
backend em execução. `REBASE_SERVICE_KEY` só é enviada para o projeto ao qual este
checkout está vinculado; passe `--token` explicitamente para qualquer outro host. A chave no
`.env` pertence ao seu backend local e nunca é enviada.
Uma recusa informa
qual dessas situações ocorreu: um `--token` recusado, uma chave de shell recusada, uma chave
retida para um host não vinculado, uma chave presente apenas no `.env` ou nenhuma chave fornecida.

**Uso após a geração:**

```typescript
import { createRebaseClient } from "@rebasepro/client";
import { tablesDictionary, type Database } from "./generated/sdk/database.types";

const client = createRebaseClient<Database>({
    baseUrl: import.meta.env.VITE_API_URL,
    tables: tablesDictionary,
});

// Full type safety and autocomplete
const { data } = await client.data.products.find();
```

Os nomes de campos nos tipos gerados são os mesmos servidos pela API. O nome trafegado
(wire name) de um campo é a sua chave de coluna, e a API adota camelCase por completo: a introspecção
grava uma coluna `created_at` como `createdAt: col.timestamp({ withTimezone: true })`, cujo nome SQL
é a versão em snake_case da chave, e a serve como `row.createdAt`. A coluna
em si não é modificada. O *acessador* da tabela é convertido em um nome de propriedade
da mesma forma (`my-notes` → `client.data.myNotes`), que é o que `tablesDictionary`
mapeia de volta para o slug.

### `rebase migrate`

<span class="since-badge" data-since="0.31">Desde 0.31</span>

`rebase migrate collections-to-tables [dir]` move `config/collections` para
`backend/schema` (um `defineTable` por collection, cada coluna explícita em
sua posição original, na sintaxe do Drizzle, e `index.ts` com
`defaultRls`) e `frontend/src/cms` (um `customizeTable` por collection personalizada,
arquivos `defineFirestoreCollection`, `ui-config.json`), grava
`backend/resources.ts`, `backend/storage.ts` e `backend/generated/register.ts`,
adiciona `rebaseBackendGuard()` ao `vite.config.ts` do scaffold e, em seguida, executa
`rebase migrate sdk-calls`, que reescreve `.collection(` para `.table(`, as
demais renomeações de SDK e as fontes de regra `existsIn` / `membership` no seu código,
e move as importações de nomes que a versão 0.31 moveu para outro pacote (os tipos
e utilitários do painel de administração para `@rebasepro/cms-types`, o utilitário de migração para
`@rebasepro/common/migrate` — [a lista](/docs/upgrading/0-30-to-0-31-imports/)),
adicionando o pacote às dependências do importador ("Dependencies added": execute
`pnpm install`). Atualize todos os pacotes `@rebasepro` para a versão 0.31 antes de executá-lo.
Cada execução valida o resultado: o SQL gerado — DDL, políticas, search,
vector, triggers, views, o schema do Drizzle — deve ser idêntico byte a byte, caso contrário
todos os arquivos são restaurados. O que não puder ser convertido é recusado com a indicação de arquivo e linha, e
o que for deixado para você resolver é exibido como etapas manuais numeradas, finalizando com
`rebase skills install` quando o projeto contiver agent skills. Seus próprios módulos em
`config/` permanecem; a execução exibe a linha de comando `git rm` para os itens que foram substituídos.

| Flag | Efeito |
|---|---|
| `--dry-run` | Exibe arquivos, recusas, notas e etapas manuais; não grava nada. Comece por aqui. |
| `--check` | Em um projeto migrado: comprova que `backend/schema` ainda renderiza o mesmo SQL. Encerra com código 1 exibindo o diff, ou se alguma regra mudar de significado. |
| `--accept-rule-changes` | Com `--check`: indica que as regras em "Review before deploying" foram revisadas. |
| `--json` / `--force` / `--skip-sdk-calls` | Relatório em JSON (com `ruleChanges`); executa em uma árvore git com alterações pendentes (dirty tree) ou sobre saídas editadas; não altera seu código. |

Leia duas listas na saída do SDK: **"Rewritten by name — review"** (chamadas em um
receptor não tipado, reescritas pelo nome) e **"Left unchanged — check each"**
(chamadas não confirmadas como sendo do SDK: renomeie aquelas que forem, ou elas falharão em tempo de execução).

A verificação de SQL comprova que a conversão foi fiel, mas não que uma regra continua tendo exatamente
o mesmo significado que antes. A última seção da saída, **"Review before deploying: these rules
change meaning"**, lista cada regra cuja política agora concede algo diferente
— um `access: "authenticated"` isolado não concedia nada e agora admite qualquer chamada autenticada
([os quatro formatos](/docs/upgrading/0-30-to-0-31/#review-before-deploying-these-rules-change-meaning)).
Depois, verifique contra seu banco de dados: `rebase db push --dry-run` deve exibir "No
changes: the database already matches these tables.", e
`rebase doctor --policies` nenhuma divergência (no drift).

## Fluxo de Desenvolvimento

<span class="since-badge" data-since="0.31">Desde 0.31</span>

O fluxo de trabalho de iteração rápida para desenvolvimento:

```bash
# 1. Edit a table in backend/schema/
# 2. Generate the Drizzle schema
rebase schema generate

# 3. Push directly to dev database
rebase db push
```

## Fluxo de Produção

<span class="since-badge" data-since="0.31">Desde 0.31</span>

O fluxo de trabalho seguro e auditável para produção:

```bash
# 1. Edit a table in backend/schema/
# 2. Generate the Drizzle schema
rebase schema generate

# 3. Generate SQL migration files
rebase db generate

# 4. Review the generated SQL in backend/drizzle/migrations/
# 5. Commit the migration to version control
git add backend/drizzle/migrations/

# 6. Apply in production
#    A database Rebase has already booted needs a baseline the first time —
#    see "Baselining a database Rebase has already booted" above.
rebase db migrate
```

## Solução de Problemas

| Sintoma | Solução |
|---------|---------|
| `Could not detect an active database plugin` | Instale `@rebasepro/server-postgres` em `backend/package.json` |
| Arquivo de schema não atualiza | Verifique se o caminho de `--schema-dir` (ou a chave `tables` em `rebase.json`) aponta para o diretório correto |
| A migração mostra alterações inesperadas | Execute `rebase doctor` para identificar divergências |
| `db push` falha em produção | Use `db generate` + `db migrate` em vez disso |
| Uma migração não deve descartar dados em CI ou produção | `rebase db migrate --refuse-destructive` encerra com 1 e não aplica nada se uma instrução pendente destruir dados |
| `db migrate` falha com `already exists (42710)` | O boot ou `db push` já provisionou o schema — registre-o com `rebase db migrate --baseline <version>` |
| `db migrate` falha com `column … already exists (42701)` | `rebase dev` adicionou a coluna no boot — faça o baseline dessa migração da mesma forma |
| `db push` no banco de dados gerenciado falha com `Error: EOF` | O Atlas perdeu uma conexão mantida pelo `rebase dev` em execução. Execute novamente; se continuar falhando, pare o `rebase dev` primeiro |

## Próximos Passos

- **[Tabelas](/docs/schema/)** — Defina seu modelo de dados
- **[Referência da CLI](/docs/cli)** — Todos os comandos da CLI
- **[SDK Tipado](/docs/sdk)** — Use o SDK gerado
