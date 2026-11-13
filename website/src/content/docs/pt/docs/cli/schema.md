---
sourceHash: 78c09101b46f0864
title: Geração de Schema
sidebar_label: Geração de Schema
description: Gere schemas do Drizzle ORM a partir das tabelas em backend/schema, crie migrações SQL, faça a introspecção de um banco de dados existente em arquivos defineTable e mantenha seu banco de dados sincronizado com a Rebase CLI.
---

## Visão Geral

<span class="since-badge" data-since="0.31">Since 0.31</span>

O Rebase usa um pipeline **schema-as-code** onde as tabelas que você declara com
`defineTable` em `backend/schema/` são a única fonte da verdade. A CLI
as transforma por meio de um pipeline determinístico:

```
Tables (backend/schema) → Drizzle Schema → SQL Migrations → PostgreSQL
```

Esta página cobre todos os comandos da CLI envolvidos nesse pipeline.

## O Pipeline

### 1. Tabelas → Drizzle Schema

<span class="since-badge" data-since="0.31">Since 0.31</span>

As tabelas que `backend/schema/index.ts` exporta descrevem colunas, tipos, relações,
enums e segurança em nível de linha (row-level security / RLS). Cada comando abaixo as lê por meio do loader
usado na inicialização do backend, portanto, um schema que não compila — uma tabela sem
`rls`, `"inherit"` sem `defaultRls`, um `defineTable` que o index não
exporta — interrompe o comando com um `SchemaDefinitionError` nomeando cada problema,
e nada é gravado. O comando `schema generate` gera um arquivo de schema do Drizzle ORM
a partir delas.

Cada comando que lê o schema aceita `--schema-dir <dir>` para um projeto
que mantém suas tabelas em outro lugar; o padrão é `backend/schema`, ou a
chave `tables` do aplicativo backend em `rebase.json`. `--collections` / `-c`, a
flag anterior à versão 0.31, é recusada com uma mensagem indicando o codemod
([`rebase migrate collections-to-tables`](#rebase-migrate)), assim como um
projeto que ainda possui `config/collections`.

### 2. Drizzle Schema → Migrações

A partir do schema do Drizzle gerado, o `db generate` faz a comparação (diff) com as migrações já presentes em `backend/drizzle/migrations/`, reproduzidas em um banco de dados temporário (scratch database), e produz arquivos de migração SQL com timestamp. Ele nunca lê o seu banco de dados: uma coluna que a inicialização ou o `db push` já adicionou ainda aparecerá como `ADD COLUMN`.

### 3. Migrações → PostgreSQL

O comando `db migrate` aplica as migrações pendentes ao seu banco de dados PostgreSQL.

## Comandos

### `rebase schema generate`

<span class="since-badge" data-since="0.31">Since 0.31</span>

Gera um arquivo de schema do Drizzle ORM a partir das suas tabelas:

```bash
rebase schema generate
```

**O que faz:**
- Lê as tabelas que `backend/schema/index.ts` exporta
- Gera `backend/src/schema.generated.ts` com definições de tabela, enums e relações do Drizzle

**Opções:**

| Flag | Descrição |
|------|-----------|
| `--schema-dir` | O diretório de schemas (padrão: `backend/schema`); caminhos relativos são resolvidos a partir de onde você executa o comando |
| `--output, -o` | Caminho de saída para o arquivo de schema gerado; caminhos relativos são resolvidos a partir de onde você executa o comando |
| `--watch, -w` | Monitora alterações e regenera automaticamente |

O **modo watch** é útil durante o desenvolvimento — edite um arquivo de tabela e o schema será regenerado instantaneamente:

```bash
rebase schema generate --watch
```

### `rebase schema stale`

Verifica se o schema gerado ainda corresponde às tabelas:

```bash
rebase schema stale          # report, and exit 1 if anything is stale
rebase schema stale --fix    # regenerate the file instead
```

**O que faz:**
- Renderiza o que as tabelas em `backend/schema/` geram e compara, declaração por declaração, com `backend/src/schema.generated.ts`
- Nomeia cada diferença — uma tabela ausente, uma coluna com tipo alterado, um rótulo de enum removido ou chaves estrangeiras nomeadas da forma como uma versão anterior as derivava — e sai com código diferente de zero
- Com `--fix`, regenera o arquivo em vez de apenas relatar

O `rebase dev` mantém o arquivo atualizado sozinho, portanto, esta é a verificação ideal para uma etapa de build
ou CI. Ele aceita `--schema-dir` e `--output` assim como o `rebase schema generate`.

### `rebase schema reconcile`

<span class="since-badge" data-since="0.31">Since 0.31</span>

Flexibiliza e remove o que a inicialização não fará, depois de você ter lido o plano:

```bash
rebase schema reconcile                         # relax NOT NULL on columns made nullable or removed
rebase schema reconcile --drop voice_cache.wav  # and drop a column no table declares
```

**O que faz:**
- Solicita ao backend em execução que faça o planejamento contra seu próprio banco de dados. Esse é o banco para o qual o `.env` e o link da nuvem apontam, portanto, funciona no Rebase Cloud, onde nada mais alcança o banco de dados.
- Planeja `DROP NOT NULL` para cada coluna que uma tabela declara como anulável que o banco de dados ainda exige.
- Lista todas as colunas que nenhuma tabela declara. Uma coluna `NOT NULL` sem padrão bloqueia qualquer inserção, por isso ela também é flexibilizada, e seus dados permanecem. Remove apenas as colunas especificadas com `--drop <table>.<column>`, e mostra quantas linhas contêm um valor em cada uma.
- Aplica as alterações assim que você digita `yes`. O servidor executa o plano apenas com base no hash/digest daquele que você leu; portanto, se o banco de dados ou as tabelas mudaram nesse intervalo, ele recusa e você revisa novamente. `--yes` pula a confirmação.

A inicialização (boot) apenas adiciona, portanto, depois que você remove uma coluna de seu `defineTable`, a coluna permanece no banco de dados, junto com seus dados. Uma coluna `NOT NULL` sem padrão faz com que todas as inserções falhem, e o log de inicialização sugere este comando para isso: sem `--drop` para manter os dados, com ele para remover a coluna. Faça o deploy da alteração da tabela primeiro, pois o reconcile planeja contra o que o backend está executando. Ele requer `REBASE_SERVICE_KEY` no `.env`. Localmente, o `rebase db push` cobre o mesmo por meio de seu mecanismo de controle de alterações destrutivas.

### `rebase schema introspect`

<span class="since-badge" data-since="0.31">Since 0.31</span>

Gera arquivos `defineTable` a partir de um banco de dados PostgreSQL existente:

```bash
rebase schema introspect
```

**O que faz:**
- Conecta-se ao banco de dados deste projeto, aquele exibido por `rebase db url` (o gerenciado é iniciado caso seja ele); `--database-url` especifica outro, e `--docker` usa o do compose
- Lê cada tabela, coluna, tipo, chave estrangeira e política, e grava
  `backend/schema/<table>.ts` — um `defineTable` por tabela — e o
  `backend/schema/index.ts` que as exporta (mesclado em um índice que já
  exista)
- Declara cada coluna com seu tipo Postgres: `col.uuid()`, `col.varchar({ length })`,
  `col.numeric({ precision, scale })`, um enum com seus rótulos e nome real do tipo
  (um `pgEnum` quando o tipo é compartilhado), um array como `<item>.array()`,
  `col.vector({ dimensions })`, chaves identity e serial, valores padrão — nomeados como
  o Drizzle os nomeia. Um tipo que nenhum builder reconhece torna-se
  `col.custom({ dataType: "<sql type>" })`, que o Rebase entrega da forma como o
  driver o retorna; `db generate` e `db push` o recusam até que o planejador
  possa planejá-lo
- Declara a coluna de chave estrangeira, o `belongsTo` nela e o
  `hasMany` inverso no alvo; uma tabela de junção se torna um `manyToMany`, com suas
  próprias colunas formando o `pivot`
- Lê as políticas de segurança em nível de linha de cada tabela em seu `rls`: nome,
  comando, modo, lista `TO`, `USING` e `WITH CHECK`. As políticas `<table>_default_*`
  adicionadas pelo próprio Rebase são deixadas de fora, para que o `db push`
  posterior recrie cada política exatamente como era. Uma tabela com RLS ativado
  e sem políticas é gravada com `rls: "admin-only"`
- Lê todas as expressões (`USING` de uma política, um CHECK, o valor padrão de uma coluna) sob
  o `search_path` que o servidor usa, `public`, portanto uma função no schema `rebase`
  é escrita como `rebase.roles()`
- Converte um CHECK legível (`total >= 0`) no `.validate()` da coluna, e
  mantém a constraint no banco de dados, onde o push subsequente a
  preserva
- Insere o que não pôde expressar com exatidão em um comentário no topo do
  arquivo da tabela e no terminal — um conjunto fechado de strings em uma coluna de texto, uma
  coluna gerada cuja expressão não foi lida, um tipo personalizado — com o que
  um push faria a respeito
- Com `--data-inference`, faz uma amostragem de até 100 linhas por tabela e grava o que
  encontrar referente à apresentação — títulos, ícones, quadros, ordenações, opções de campo — em
  `frontend/src/cms/<table>.tsx` como um `customizeTable`, caso o frontend do
  projeto dependa de `@rebasepro/cms`. Um projeto headless não recebe nada
- Diante de um banco de dados que não está em execução, imprime o mesmo banner
  exibido pelo `db push`, uma única vez, e não cria nada. Ele exibe o diretório de saída como um
  caminho absoluto

**Opções:**

| Flag | Descrição |
|------|-----------|
| `--schema-dir` | Onde gravar os arquivos de tabela (padrão: `backend/schema`). `--output` foi removido |
| `--schema` | O schema do Postgres a ser lido (padrão: `public`) |
| `--force, -f` | Sobrescreve arquivos de tabela que já existem; sem ela, um arquivo existente é ignorado |
| `--database-url` | Lê este banco de dados em vez do próprio banco do projeto |
| `--docker` | Lê o banco de dados do compose, iniciando-o se necessário |
| `--data-inference` / `--no-data-inference` | Amostra até 100 linhas por tabela para detectar formatos, constraints e configurações de painel, ou lê apenas a estrutura. Sem nenhuma das flags, o comando solicita confirmação; sem um terminal, lê apenas a estrutura |

Isso é útil ao adotar o Rebase em um banco de dados existente — faça a introspecção
primeiro e depois edite as tabelas geradas. Uma tabela com segurança em nível de linha desativada é
gravada como qualquer outra, com seu `rls`; o push ativará o RLS, e o dry-run
informará isso. Um backend executado sem nenhum `backend/schema` simplesmente
atende o banco de dados diretamente — consulte [Backend only](/docs/getting-started/headless/).

### `rebase db push`

Envia alterações de schema diretamente para o banco de dados sem arquivos de migração:

```bash
rebase db push
```

**O que faz:**
- Lê o schema do Drizzle gerado
- Aplica alterações diretamente ao banco de dados (CREATE, ALTER, DROP)
- Executa um dry-run do plano primeiro e para antes de qualquer ação que destrua dados:
  exclusão de tabela, coluna, schema, view ou tipo, um `TRUNCATE`, ou uma alteração de tipo de
  coluna que possa perder valores (`timestamptz` → `date`, `numeric` → `integer`),
  ou uma alteração de chave primária — `(id)` → `(id, locale)` dá a cada linha um novo id, de modo
  que links, chaves estrangeiras e IDs armazenados em outros lugares deixam de encontrar sua linha.
  Ele também para
  antes da remoção de uma constraint CHECK ou EXCLUDE existente no banco de dados: nenhuma linha
  é perdida, mas a partir de então o banco aceita linhas que antes recusava.
  Ele pergunta no terminal, onde Ctrl-C ou Ctrl-D responde não, e recusa caso
  contrário; `--allow-destructive` aplica mesmo assim. `--yes` ainda faz isso
  nesta versão, com um aviso de descontinuação; a partir da próxima versão ele aprovará
  apenas pushes que não destruam nada. Um push que
  é interrompido nesse ponto descarta seu banco de dados temporário `<db>_dev_diff` ao sair
- Ativa a segurança em nível de linha para todas as tabelas declaradas, junções incluídas, logo após a
  alteração do schema e antes de qualquer etapa que possa falhar, de modo que um push interrompido no meio do caminho deixe uma nova tabela
  negando todas as solicitações em vez de deixá-la aberta
- Aplica as políticas de RLS para as quais o `rls` das suas tabelas compila e **remove políticas que um push anterior substituiu**
- Mantém todas
  as constraints CHECK e EXCLUDE em tabelas declaradas como estão. Uma tabela
  não pode declarar nenhuma delas, portanto são regras próprias do banco de dados, escritas manualmente
  ou herdadas por um banco que o `schema introspect` adotou; para remover uma, exclua-a
  manualmente (`ALTER TABLE … DROP CONSTRAINT …`). Triggers e funções que você escreveu
  também não são tocados
- Faz a correspondência exata
  do nome de tudo o que deixa inalterado, incluindo caracteres como `.`, `[`, `]` ou `*`
- Constrói qualquer
  [índice de chave estrangeira que o Rebase deriva](/docs/backend/indexes#foreign-keys-are-indexed-for-you)
  que esteja ausente em uma tabela existente **antes** do planejamento, com
  `CREATE INDEX CONCURRENTLY`, para que as gravações na tabela continuem durante a criação;
  o Atlas então o encontra já criado. O `--dry-run` lista esses índices e não cria nada
- Registra uma marca (stamp) nas
  políticas que aplica da mesma forma que a inicialização do servidor faz, para que o primeiro boot após um
  push não precise recriar cada uma delas
- O `--dry-run`
  lista as alterações de segurança em nível de linha que o push faria, sob "Planned
  row-level security changes": as tabelas nas quais o RLS seria ativado e cada
  política criada, substituída ou removida, calculadas da mesma forma que as
  etapas do push decidem. Ele informa "No changes" apenas quando nem o schema nem
  a segurança em nível de linha mudariam. Onde a marca de uma política não corresponde à sua
  regra, ou ela não possui marca (uma criada por `db migrate` ou escrita à mão), o dry-run
  a recria a partir de sua regra sob outro nome, em uma transação com rollback,
  e compara com o que o Postgres armazenou: se o resultado for idêntico,
  não há alteração. Assim, uma regra lida pelo `schema introspect` como SQL não planeja nada,
  e o mesmo vale para políticas aplicadas pelo `db migrate`. Apenas aquelas que não puderam ser comparadas (por
  exemplo, se o lock da tabela não foi concedido em dois segundos) são listadas separadamente. O push
  em si imprime uma única linha com a contagem das alterações
- Exibe cada
  instrução que o Atlas aplica uma vez. O Atlas conecta-se sem SSL a um banco de dados nesta
  máquina (`localhost`, `127.x`, `::1`) cuja URL não especifica `sslmode`, como o próprio app
  faz, em vez de falhar com `SSL is not enabled on the server`; uma URL que
  especifica `sslmode` ou outro host é repassada exatamente como escrita. Uma execução do Atlas
  que falhe antes de planejar não deixa nenhum banco de dados `<db>_dev_diff` para trás
- O `--dry-run`
  não altera nada do projeto: `src/schema.generated.ts` permanece inalterado,
  e as cópias `drizzle/*.sql` comitadas por uma versão anterior são apenas listadas, não
  excluídas. Apenas os dados de entrada do plano vão para `.rebase/sql/`, que não é comitado
- **Não** cria arquivos de migração

**Quanto tempo leva.** Quase todo o tempo de um push é gasto pelo Atlas calculando o plano: ele
constrói o schema desejado em um banco de dados temporário e faz o diff contra o banco
real, e esse custo cresce mais rápido do que o número de tabelas — em um laptop sem carga,
cerca de 0,25 s por plano com 11 tabelas, 0,9 s com 111 e 5,5 s com 411. Um push que
não altera nada planeja uma vez; um que altera algo planeja duas vezes (o dry-run
lido pelo controle de alterações destrutivas e, em seguida, a aplicação). Portanto, um push em um schema de
400 ou mais tabelas leva dezenas de segundos, e mais ainda em uma máquina lenta ou ocupada.
Esse tempo pertence ao Atlas, não ao seu banco de dados: as etapas complementares — geração de
SQL, lock de RLS, busca, triggers, políticas, a role — levam poucos segundos
nessa escala, através de uma única conexão com o seu banco de dados.

**Os arquivos gerados no processo**, todos sob `.rebase/sql/` no diretório
backend. `db push` e `db generate` escrevem todos os cinco a partir das suas tabelas
a cada execução, antes de ler qualquer um deles, de modo que uma cópia comitada não seria lida
por nada. O diretório possui seu próprio `.gitignore` e nunca é comitado.

| Arquivo | Conteúdo |
|---------|----------|
| `schema.sql` | Tabelas, colunas, constraints e índices — o estado desejado do Atlas, e o único que ele compara (diff) |
| `policies.sql` | As políticas de RLS para as quais o `rls` das suas tabelas compila |
| `search.sql` | As funções de busca textual (full-text search) e colunas geradas, para tabelas com um bloco `search` |
| `vector.sql` | Extensões pgvector e índices ANN |
| `triggers.sql` | `rebase.set_updated_at()` e os triggers `BEFORE UPDATE` por trás de `.onUpdateNow()` |

O Atlas gerencia apenas o primeiro arquivo, de modo que o `db push` e a verificação de schema
na inicialização aplicam os outros quatro por conta própria. Uma implantação **apenas com migrações** (migration-only) —
que executa `db migrate` e nunca `db push` — precisa incorporar esses quatro arquivos manualmente em uma
migração; o `db generate` avisa quando uma alteração for invisível para o Atlas.

Um projeto que comitou esses arquivos em `drizzle/` sob uma versão anterior terá
essas cópias excluídas na sua primeira execução, e o comando indicará cada uma para que você possa
comitar a exclusão. Ele exclui apenas arquivos iniciados com o cabeçalho do gerador.
Arquivos escritos por você permanecem, assim como `drizzle/migrations/`.

:::note[Editar uma regra de segurança renomeia sua política]
Uma regra sem um `name` explícito compila para `<table>_<op>_<hash>`, onde o hash cobre a semântica da regra — portanto, *editar* uma regra (em vez de adicionar uma nova) gera uma política com um novo nome e deixa a antiga para trás.

Isso costumava ser um grande problema: o Postgres combina políticas `PERMISSIVE` com operador OR, de modo que um `USING (rebase.uid() IS NOT NULL)` substituído continuava concedendo tudo, não importando quão restritiva fosse a sua substituição. Tornar uma regra mais restrita não tinha efeito, e o push informava sucesso.

O `db push` agora reconcilia isso: ele remove políticas geradas que não correspondem mais a nenhuma regra e relata — sem remover — qualquer política com nome personalizado que suas tabelas não descrevam, já que essas são indistinguíveis de SQL escrito deliberadamente por alguém.

Para auditar um banco de dados que recebeu push antes desse recurso, execute `rebase doctor --policies`. Ele funciona como uma barreira (gate) de CI: encerra com código diferente de zero em caso de divergência (drift) e também quando não puder executar a verificação — ausência de `DATABASE_URL`, um caminho `--schema-dir` que não resolve, ou permissão de leitura em `pg_policies` não concedida à role do CI. Uma barreira que não pôde verificar não é considerada aprovada.

O `doctor` e o `db push` diferenciam os dois tipos de órfãos. Uma política com nome gerado foi substituída, e o próximo push a removerá. Qualquer outro nome foi escrito manualmente ou por outra ferramenta e ainda está em vigor: descreva-a no `rls` da respectiva tabela para mantê-la (a visualização de RLS do Studio a importa) ou remova-a manualmente se estiver obsoleta.
:::

:::caution
O `db push` modifica o banco de dados diretamente. Use-o apenas em desenvolvimento. Para produção, use `db generate` + `db migrate` para criar arquivos de migração que possam ser revisados.
:::

### `rebase db generate`

Gera arquivos de migração SQL a partir das alterações de schema:

```bash
rebase db generate
```

**O que faz:**
- Compara o schema do Drizzle contra o estado construído pelas migrações em `drizzle/migrations/`, e não contra o seu banco de dados
- Produz arquivos de migração SQL com timestamp em `backend/drizzle/migrations/`
- Os arquivos podem ser revisados, editados e comitados no controle de versão
- Nomeia cada
  instrução na nova migração que destrói dados, usando a mesma verificação que o `db push`
  executa antes de aplicar: remoção de tabela, coluna, schema, view ou tipo, um
  `TRUNCATE`, uma alteração de tipo de coluna que possa perder valores, alteração de chave
  primária ou remoção de uma constraint CHECK ou EXCLUDE que o banco possui. Ele
  ainda grava o arquivo e sai com código 0, portanto avisa sem recusar.
- Conclui informando o que
  fazer em seguida: `rebase db migrate` e, para a primeira migração de um projeto, a
  linha `--baseline <version>` que um banco de dados já configurado pela inicialização necessita em vez disso. Uma
  migração posterior não recebe a linha de baseline, pois uma alteração destrutiva que passasse por baseline
  ignoraria seu `DROP`, e uma execução que não gera migração apenas relata isso.

**Um CHECK adicionado por uma migração sua será removido pela seguinte.** O `db generate`
compara seus arquivos de migração, não o banco de dados, e o Atlas não tem como deixar um
objeto de fora desse diff. Portanto, uma constraint CHECK ou EXCLUDE que você escreveu manualmente em
uma migração e que nenhuma tabela pode declarar, retorna como
`ALTER TABLE … DROP CONSTRAINT …` na próxima migração gravada, unida
na mesma instrução da alteração real. O relatório acima nomeia essa remoção quando
o banco já possui a constraint; ele não a remove do
arquivo. Exclua a cláusula antes de `rebase db migrate` ou deixe que
`rebase db migrate --refuse-destructive` a interrompa. O `db push` lê o
banco de dados e preserva a constraint.

As migrações geradas são arquivos SQL comuns — você pode inspecioná-las e modificá-las antes de aplicar.

### `rebase db migrate`

Executa todas as migrações pendentes:

```bash
rebase db migrate
```

**O que faz:**
- Lê `drizzle/migrations/` em busca de migrações não aplicadas
- Aplica-as em ordem ao banco de dados
- Rastreia quais migrações foram aplicadas
- Aplica marcas (stamps) nas
  políticas de segurança em nível de linha da mesma forma que o `db push` e a inicialização do servidor fazem, para
  que o primeiro boot após uma migração não precise recriar cada uma
  delas. Como uma migração foi escrita a partir das tabelas da sua época, uma política só
  recebe a marca se corresponder exatamente ao que sua regra produz agora: o migrate a recria
  a partir de sua regra com outro nome, em uma transação revertida (rollback), e
  compara com o que o Postgres armazenou, assim como o `db push --dry-run` faz. Uma política
  diferente não recebe marca, e o próximo boot reaplica a tabela correspondente

O `--refuse-destructive`
faz com que ele recuse a execução. Ele executa primeiro um dry-run das migrações pendentes. Se qualquer
instrução destruir dados, de acordo com a mesma verificação que `db push` e `db generate`
utilizam, ele lista essas instruções e sai com código 1. Nada é aplicado, nem mesmo os arquivos
anteriores a essa instrução. Sem a flag, o `db migrate` se comporta normalmente e
aplica todos os arquivos pendentes:

```bash
rebase db migrate --refuse-destructive
```

Uma migração que reconstrói uma coluna de busca a remove primeiro, portanto esta flag também recusará
essa migração. Leia a lista exibida e, em seguida, execute `rebase db migrate`
sem a flag para aplicá-la.

#### Definindo o baseline de um banco de dados que o Rebase já inicializou

Toda inicialização do Rebase valida o schema, e o `rebase db push` o aplica diretamente. Portanto, um banco de dados que já executou qualquer um dos dois já possui as tabelas e tipos que a primeira migração criaria, e o `rebase db migrate` para com `pq: type "posts_status" already exists (42710)`.

Não há nada de errado com a migração — o banco de dados simplesmente foi provisionado de outra forma. Registre o estado atual e depois migre normalmente:

```bash
rebase db migrate --baseline 20260906101530
rebase db migrate
```

A versão é o prefixo numérico do arquivo de migração que descreve o que está no banco de dados *agora*. Essa migração e tudo o que veio antes dela são registrados como aplicados; tudo o que estiver depois dela será executado. Em um banco de dados contra o qual nada foi inicializado anteriormente, nenhum baseline é necessário — execute o migrate diretamente.

O mesmo acontece posteriormente no fluxo normal: edite uma tabela enquanto o `rebase dev` estiver em execução, e o boot adicionará a coluna antes que o `rebase db generate` escreva a migração correspondente, fazendo com que o `rebase db migrate` pare com `column … already exists (42701)`. Defina o baseline dessa migração da mesma maneira. `--baseline` funciona em um banco de dados que já registra migrações: ele marca tudo até aquela versão como aplicado usando `atlas migrate set` e informa isso, ou indica que não há nada para registrar quando o histórico já alcançou essa versão. Uma versão que não conste em nenhum arquivo em `drizzle/migrations` é recusada antes que qualquer coisa seja executada, listando as versões existentes.

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
portanto precisa de um servidor PostgreSQL real e ocupa o mesmo espaço em disco que sua origem.

### `rebase doctor`

Detecta divergências (three-way drift) entre suas tabelas, o schema do Drizzle gerado e o banco de dados PostgreSQL ativo:

```bash
rebase doctor
```

**O que ele verifica:**
- Tabelas ↔ Schema gerado — estão sincronizados?
- Schema gerado ↔ Banco de dados — existem alterações não aplicadas?
- Tabelas ↔ Banco de dados — há alguma divergência inesperada?

Execute o `doctor` sempre que algo parecer fora de sincronia. Ele aponta exatamente onde está a discrepância.

A comparação com o banco de dados inclui a mesma que a inicialização faz antes de avisar que `schema.generated.ts` e o banco discordam, executada através do mesmo código. Portanto, toda diferença alertada pelo boot também consta no relatório, com as mesmas palavras: uma coluna que é NOT NULL de um lado e anulável do outro, e uma coluna que o banco ainda possui mas que não está no arquivo (a inicialização nunca remove colunas, então uma propriedade renomeada deixa a coluna antiga para trás). Cada uma é um aviso, e a correção indica o `rebase db push`.

A comparação com o banco de dados lê o banco do projeto, resolvido da forma como o `rebase db url` o resolve — em um projeto novo, o gerenciado, que o `doctor` inicia. Quando nenhum puder ser resolvido, essa fase é relatada como **pulada** (skipped) em vez de aprovada, e a execução nunca termina com "All schemas are in sync" — uma verificação que não ocorreu não atesta conformidade.

Ele também aponta cada tabela sem um [bloco `search`](/docs/backend/search) que contenha mais de cerca de 10.000 linhas. Uma busca nessas tabelas — a caixa de busca do admin, `.search()`, `?searchString=` — executa `ILIKE '%term%'` nas colunas de texto, o que nenhum índice tradicional atende; logo, cada busca lê a tabela inteira, e a contagem lê tudo novamente (cerca de um terço de segundo com 100.000 linhas, aumentando com a tabela). A contagem de linhas é uma estimativa do próprio Postgres, portanto a verificação não varre nada. Trata-se de uma dica: não altera o código de saída e nada é indexado automaticamente.

Ele identifica uma **junção órfã**: uma tabela em `public` no formato de junção many-to-many que nenhuma tabela declara. A estrutura consiste em duas colunas que juntas formam a chave primária, cada uma sendo chave estrangeira para uma tabela declarada. Renomear ou remover um `manyToMany` deixa a antiga tabela de junção para trás, porque push e boot apenas criam tabelas, e todas as linhas de vínculo permanecem nela. A nota é apenas informativa, portanto não altera o código de saída. Sua correção é a instrução `DROP TABLE`, que o `doctor` exibe e nunca executa.

### `rebase generate-sdk`

<span class="since-badge" data-since="0.31">Since 0.31</span>

Gera um SDK tipado a partir das suas tabelas:

```bash
rebase generate-sdk
```

**O que faz:**
- Lê as tabelas que `backend/schema/index.ts` exporta, por meio do loader usado na inicialização do backend, para que o SDK descreva exatamente as tabelas servidas; um schema que não compila interrompe o processo
- Gera tipos TypeScript para cada tabela em `generated/sdk/`
- Produz um arquivo `database.types.ts` para uso com `createRebaseClient<Database>()`: o tipo `Database`, `TableName` (a união de todos os slugs) e `tablesDictionary` / `TablesDictionary`, o mapeamento do acessador para o slug

O `rebase dev` executa isso automaticamente na inicialização e a cada salvamento em
`backend/schema/`. Execute-o você mesmo no CI, em um repositório que não
tenha tabelas próprias (consulte `--from` abaixo) ou em qualquer lugar onde o `rebase dev` não esteja em execução.

**Opções:**

| Flag | Descrição |
|------|-----------|
| `--schema-dir` | O diretório de schemas (padrão: `backend/schema`, ou a chave `tables` em `rebase.json`); caminhos relativos são resolvidos a partir de onde você executa o comando |
| `-o`, `--output` | Diretório de saída para o SDK (padrão: `generated/sdk/`) |
| `--from <link\|url>` | Lê o schema de um projeto em execução em vez do código-fonte local. `link` usa o projeto vinculado a este checkout. |
| `--token` | Token Bearer para o endpoint de contrato (padrão: `$REBASE_SERVICE_KEY` da shell; `.env` não é lido) |
| `--register` | Também tipa os dados no servidor: grava os tipos e uma declaração `Register` em `backend/generated/`, e memoriza em `rebase.json` — consulte [Dados tipados no servidor](/docs/backend/typed-server-data/) |

O `--from` é o que permite a um repositório sem tabelas — um
frontend separado, um segundo aplicativo web, um aplicativo mobile — gerar um cliente tipado a partir do
projeto com o qual se comunica: ele lê as `tables` do endpoint
`/api/meta/contract` do backend em execução. `REBASE_SERVICE_KEY` só é enviado para o projeto ao qual
este checkout está vinculado; passe `--token` explicitamente para qualquer outro host. A chave no
`.env` pertence ao seu backend local e nunca é enviada.
Uma recusa explica
qual destes cenários ocorreu: um `--token` recusado, uma chave de shell recusada, uma chave
retida para um host não vinculado, uma chave presente apenas no `.env`, ou nenhuma chave fornecida.

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

Os nomes dos campos nos tipos gerados são aqueles que a API disponibiliza. O nome de tráfego
de um campo é a sua chave de coluna, e a API adota camelCase em tudo: a introspecção
grava uma coluna `created_at` como `createdAt: col.timestamp({ withTimezone: true })`, cujo nome SQL
é o snake_case da chave, e a entrega como `row.createdAt`. A coluna
em si permanece inalterada. O *acessador* da tabela é transformado em um nome de propriedade da
mesma forma (`my-notes` → `client.data.myNotes`), que é o que o `tablesDictionary`
mapeia de volta para o slug.

### `rebase migrate`

<span class="since-badge" data-since="0.31">Since 0.31</span>

`rebase migrate collections-to-tables [dir]` move `config/collections` para
`backend/schema` (um `defineTable` por collection, cada coluna explícita em
sua posição original, na sintaxe do Drizzle, e `index.ts` com
`defaultRls`) e `frontend/src/cms` (um `customizeTable` por collection
personalizada, arquivos `defineFirestoreCollection`, `ui-config.json`), grava
`backend/resources.ts`, `backend/storage.ts` e `backend/generated/register.ts`,
adiciona `rebaseBackendGuard()` ao `vite.config.ts` de um scaffold, e então executa
`rebase migrate sdk-calls`, que reescreve `.collection(` para `.table(`, as
outras renomeações do SDK e as origens de regras `existsIn` / `membership` no seu código,
além de mover as importações de nomes que a versão 0.31 moveu para outro pacote
([a lista](/docs/upgrading/0-30-to-0-31-imports/)), adicionando o pacote às
dependências de quem importa ("Dependencies added": execute `pnpm install`). Atualize todos os pacotes `@rebasepro` para 0.31 antes de executá-lo.
Cada execução relê o resultado: o SQL gerado — DDL, políticas, busca,
vetores, triggers, views, o schema do Drizzle — deve ser idêntico byte a byte, caso contrário
todos os arquivos são restaurados. O que não puder ser convertido é recusado com indicação de arquivo e linha, e
o que for deixado para você é exibido como etapas manuais numeradas, finalizando com
`rebase skills install` caso o projeto contenha agent skills. Seus próprios módulos em
`config/` permanecem; a execução exibe o comando `git rm` para o que foi substituído. Ela também
rastreia collections do Firestore construídas por funções, aliases de caminho, um painel montado
fora de `App.tsx` e qualquer app estático desprotegido ([a lista completa](/docs/upgrading/0-30-to-0-31/#108-tables-in-backendschema-replace-configcollections--run-the-codemod-first)).
Após o `git rm`, `--check` informa `already-migrated`.

| Flag | Efeito |
|---|---|
| `--dry-run` | Imprime arquivos, recusas, notas e etapas manuais; não grava nada. Comece por aqui. |
| `--check` | Em um projeto migrado: comprova que `backend/schema` ainda gera o mesmo SQL. Sai com 1 em caso de diff ou enquanto uma regra mudar de significado. |
| `--accept-rule-changes` | Com `--check`: as regras em "Review before deploying" foram revisadas. |
| `--json` / `--force` / `--skip-sdk-calls` | O relatório em JSON (com `ruleChanges`); executa em uma árvore modificada (dirty) ou sobre saída já editada; deixa seu código inalterado. |

Leia duas listas na saída do SDK: **"Rewritten by name — review"** (receptores
sem tipagem, data slots, dublês de teste) e **"Left unchanged — check each"**
(renomeie os que forem do SDK; [uma busca](/docs/upgrading/0-30-to-0-31-by-hand/#sdk-calls-no-type-checker-sees) localiza o restante).

A verificação de SQL comprova que a conversão foi fiel, mas não que uma regra ainda signifique o que
significava. A última seção da saída, **"Review before deploying: these rules
change meaning"**, lista cada regra cuja política agora concede algo diferente
— um simples `access: "authenticated"` não concedia nada e agora permite qualquer chamador
autenticado ([os quatro formatos](/docs/upgrading/0-30-to-0-31/#review-before-deploying-these-rules-change-meaning)).
Em seguida, verifique contra seu banco de dados: `rebase db push --dry-run` deve exibir "No
changes: the database already matches these tables.", e
`rebase doctor --policies` nenhuma divergência (no drift).

## Fluxo de Trabalho de Desenvolvimento

<span class="since-badge" data-since="0.31">Since 0.31</span>

O fluxo de trabalho de iteração rápida para desenvolvimento:

```bash
# 1. Edit a table in backend/schema/
# 2. Generate the Drizzle schema
rebase schema generate

# 3. Push directly to dev database
rebase db push
```

## Fluxo de Trabalho de Produção

<span class="since-badge" data-since="0.31">Since 0.31</span>

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
| Arquivo de schema não atualiza | Verifique se o caminho `--schema-dir` (ou a chave `tables` em `rebase.json`) aponta para o diretório correto |
| Migração mostra alterações inesperadas | Execute `rebase doctor` para identificar divergências |
| `db push` falha em produção | Use `db generate` + `db migrate` em vez disso |
| Uma migração não pode remover dados no CI ou produção | `rebase db migrate --refuse-destructive` sai com código 1 e não aplica nada quando uma instrução pendente destrói dados |
| `db migrate` falha com `already exists (42710)` | A inicialização ou `db push` já provisionou o schema — registre-o com `rebase db migrate --baseline <version>` |
| `db migrate` falha com `column … already exists (42701)` | O `rebase dev` adicionou a coluna na inicialização — defina o baseline dessa migração da mesma forma |
| `db push` no banco de dados gerenciado falha com `Error: EOF` | O Atlas perdeu uma conexão mantida pelo `rebase dev` em execução. Execute-o novamente; se persistir a falha, pare o `rebase dev` primeiro |

## Próximos Passos

- **[Tables](/docs/schema/)** — Defina seu modelo de dados
- **[CLI Reference](/docs/cli)** — Todos os comandos da CLI
- **[Typed SDK](/docs/sdk)** — Use o SDK tipado
