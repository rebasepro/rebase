---
sourceHash: 1a01ad3180c225c1
title: Geração de Schema
sidebar_label: Geração de Schema
description: Gere schemas do Drizzle ORM a partir das tabelas em backend/schema, crie migrações SQL, faça introspecção de um banco de dados existente em arquivos defineTable e mantenha seu banco de dados sincronizado com a Rebase CLI.
---

## Visão Geral

O Rebase usa uma pipeline de **schema-as-code** onde as tabelas que você declara com
`defineTable` em `backend/schema/` são a única fonte da verdade. A CLI
as transforma por meio de uma pipeline determinística:

```
Tables (backend/schema) → Drizzle Schema → SQL Migrations → PostgreSQL
```

Esta página cobre todos os comandos da CLI envolvidos nessa pipeline.

## A Pipeline

### 1. Tabelas → Drizzle Schema

As tabelas exportadas por `backend/schema/index.ts` descrevem colunas, tipos, relações,
enums e row-level security. Cada comando abaixo as lê por meio do loader
a partir do qual o backend inicializa, portanto, um schema que não compila — uma tabela sem
`rls`, `"inherit"` sem `defaultRls`, um `defineTable` que o index não
exporta — interrompe o comando com um `SchemaDefinitionError` nomeando cada problema,
e nada é gravado. O comando `schema generate` gera um arquivo de schema do Drizzle ORM
a partir delas.

Cada comando que lê o schema aceita `--schema-dir <dir>` para um projeto
que mantém suas tabelas em outro lugar; o padrão é `backend/schema`, ou a
chave `tables` do app backend em `rebase.json`. O `--collections` / `-c`, a
flag anterior à versão 0.31, é recusada com uma mensagem indicando o codemod
([`rebase migrate collections-to-tables`](#rebase-migrate)), assim como um
projeto que ainda contém `config/collections`.

### 2. Drizzle Schema → Migrações

A partir do schema gerado do Drizzle, o `db generate` faz a comparação de diferenças (diff) com as migrações já existentes em `backend/drizzle/migrations/`, reproduzidas em um banco de dados temporário de rascunho, e produz arquivos de migração SQL com carimbo de data/hora (timestamp). Ele nunca lê o seu banco de dados: uma coluna que a inicialização ou o `db push` já adicionou ainda sairá como `ADD COLUMN`.

### 3. Migrações → PostgreSQL

O comando `db migrate` aplica migrações pendentes ao seu banco de dados PostgreSQL.

## Comandos

### `rebase schema generate`

Gere um arquivo de schema do Drizzle ORM a partir das suas tabelas:

```bash
rebase schema generate
```

**O que ele faz:**
- Lê as tabelas que o `backend/schema/index.ts` exporta
- Gera `backend/src/schema.generated.ts` com definições de tabelas, enums e relações do Drizzle

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

Verifica se o schema gerado ainda corresponde às tabelas:

```bash
rebase schema stale          # report, and exit 1 if anything is stale
rebase schema stale --fix    # regenerate the file instead
```

**O que ele faz:**
- Renderiza o que as tabelas em `backend/schema/` geram e compara, declaração por declaração, com `backend/src/schema.generated.ts`
- Aponta cada diferença — uma tabela ausente, uma coluna com tipo alterado, um rótulo de enum removido ou chaves estrangeiras nomeadas da maneira como uma versão anterior as derivava — e encerra com código diferente de zero
- Com `--fix`, regenera o arquivo em vez de apenas relatar

O `rebase dev` mantém o arquivo atualizado por conta própria, portanto esta é a verificação adequada para um build
ou etapa de CI. Ele aceita `--schema-dir` e `--output` assim como o `rebase schema generate`.

### `rebase schema reconcile`

Torne permissivo e descarte o que a inicialização não descartará, após ter lido o plano:

```bash
rebase schema reconcile                         # relax NOT NULL on columns made nullable or removed
rebase schema reconcile --drop voice_cache.wav  # and drop a column no table declares
```

**O que ele faz:**
- Solicita ao backend em execução que faça o planejamento contra seu próprio banco de dados. Esse é o backend para o qual o `.env` e o link da nuvem apontam, portanto funciona no Rebase Cloud, onde nada mais alcança o banco de dados.
- Planeja `DROP NOT NULL` para cada coluna que uma tabela declara como anulável que o banco de dados ainda exige.
- Lista todas as colunas que nenhuma tabela declara. Uma coluna que seja `NOT NULL` sem padrão bloqueia qualquer inserção, portanto ela também é tornada permissiva, mantendo seus dados. Ela descarta apenas as colunas que você especificar com `--drop <table>.<column>`, e mostra quantas linhas possuem valor em cada uma.
- Aplica as alterações assim que você digitar `yes`. O servidor executa o plano apenas com base no digest daquele que você leu, de modo que se o banco de dados ou as tabelas mudaram nesse meio tempo, ele recusa e você deve revisar novamente. `--yes` pula a confirmação.

A inicialização apenas adiciona; portanto, após remover uma coluna de seu `defineTable`, a coluna permanece no banco de dados com seus dados. Uma coluna `NOT NULL` sem padrão fará com que qualquer inserção falhe, e o log de inicialização indica este comando para resolver isso: sem `--drop` para manter os dados, com ele para remover a coluna. Faça o deploy da alteração da tabela primeiro, pois o reconcile faz o planejamento com base no que o backend executa. Ele precisa de `REBASE_SERVICE_KEY` no `.env`. Localmente, o `rebase db push` cobre o mesmo cenário por meio de sua proteção contra alterações destrutivas.

### `rebase schema introspect`

Gere arquivos `defineTable` a partir de um banco de dados PostgreSQL existente:

```bash
rebase schema introspect
```

**O que ele faz:**
- Conecta-se ao banco de dados deste projeto, aquele que `rebase db url` exibe (o gerenciado é iniciado se for o caso); `--database-url` especifica outro, e `--docker` usa o do compose
- Lê todas as tabelas, colunas, tipos, chaves estrangeiras e políticas, e grava
  `backend/schema/<table>.ts` — um `defineTable` por tabela — e o
  `backend/schema/index.ts` que os exporta (mesclado em um index que já
  exista)
- Declara cada coluna com seu tipo Postgres: `col.uuid()`, `col.varchar({ length })`,
  `col.numeric({ precision, scale })`, um enum com seus rótulos e nome real do tipo
  (um `pgEnum` quando o tipo é compartilhado), um array como `<item>.array()`,
  `col.vector({ dimensions })`, chaves identity e serial, valores padrão — declarados da forma como
  o Drizzle os declara. Um tipo que nenhum construtor nomeia se torna
  `col.custom({ dataType: "<sql type>" })`, que o Rebase fornece conforme o
  driver o retorna; `db generate` e `db push` o recusam até que o planejador
  possa planejá-lo
- Declara a coluna de chave estrangeira, o `belongsTo` nela e o
  `hasMany` reverso no destino; uma tabela de junção se torna um `manyToMany`,
  com suas próprias colunas sendo o `pivot`
- Lê as políticas de row-level security de cada tabela para o seu `rls`: nome,
  comando, modo, lista `TO`, `USING` e `WITH CHECK`. As políticas `<table>_default_*`
  adicionadas pelo próprio Rebase são deixadas de fora, de modo que o `db push`
  posterior recria cada política como ela era. Uma tabela com row-level security
  ativado e sem políticas é gerada com `rls: "admin-only"`
- Lê cada expressão (o `USING` de uma política, um CHECK, um valor padrão de coluna) sob
  o `search_path` que o servidor usa, `public`, de modo que uma função no schema
  `rebase` é gravada como `rebase.roles()`
- Converte um CHECK que consiga ler (`total >= 0`) no `.validate()` da coluna, e deixa a restrição em si no banco de dados, onde o push subsequente a mantém. Todo CHECK também é listado em "Not carried over" com seu respectivo SQL: um push em um *novo* banco de dados cria a validação, não a restrição
- Declara cada índice simples (apenas colunas, btree, gin ou brin, sem predicado) nos `indexes` da tabela. Um índice exclusivo em uma coluna de chave estrangeira é deixado a cargo da relação, que cria um
- Com `--from supabase`, traduz as convenções do Supabase para um banco de dados do qual você está migrando: um padrão de coluna de `auth.uid()` torna-se `.onCreateUser()` (o servidor grava o id do chamador), uma coluna que armazena um id de usuário do Supabase (esse padrão ou uma chave estrangeira para `auth.users`) torna-se `col.text().userId()`, já que `rebase.users.id` e `rebase.uid()` são texto, e uma política `TO authenticated` / `TO anon` perde a role (um banco de dados do Rebase não tem nenhuma das duas) e exige um chamador autenticado / não autenticado; uma política exclusiva para `service_role` é descartada. Cada alteração é indicada no topo do arquivo da tabela. Sem essa flag, elas são mantidas como estão (o Rebase rodando no mesmo banco de dados ao lado do Supabase ainda precisa delas), e a execução informa quando as identificou
- Conclui com o que **não** foi transferido: funções, triggers, extensões, CHECKs, índices que `indexes` não consegue expressar, chaves estrangeiras compostas por várias colunas ou apontando para outro schema. O SQL que recria cada um que o Postgres consegue exibir é gravado em `backend/sql/introspected-left-behind.sql`, para revisar e aplicar após o primeiro push (`psql "$DATABASE_URL" -f …`, ou `rebase cloud db query --file …` no Rebase Cloud)
- Lembra que `DATABASE_URL` ainda aponta para o banco de dados que foi lido: em uma migração essa é a origem, e um `db push` agora escreveria nele
- Em um projeto headless, substitui o `ai-instructions.md` do scaffold ("o banco de dados é o schema") pelas regras de schema-in-code apenas de backend enquanto o arquivo estiver exatamente como o scaffold escreveu; um arquivo editado não é alterado, e o comando informa quais de suas regras deixaram de valer
- Insere o que não pôde expressar exatamente em um comentário no topo do arquivo da tabela e no terminal — um conjunto fechado de strings em uma coluna de texto, uma coluna gerada cuja expressão não foi lida, um tipo customizado — com o que um push faria a respeito
- Com `--data-inference`, faz uma amostragem de até 100 linhas por tabela e grava o que
  identificou referente à apresentação — títulos, ícones, quadros, ordenações, opções de campo — em
  `frontend/src/cms/<table>.tsx` como um `customizeTable`, quando o frontend
  do projeto depender de `@rebasepro/cms`. Um projeto headless não recebe nada
- Ao ser executado contra um banco de dados que não está em execução, exibe o mesmo banner
  que o `db push`, uma vez, e não cria nada. Ele imprime o diretório de saída como
  um caminho absoluto

**Opções:**

| Flag | Descrição |
|------|-----------|
| `--schema-dir` | Onde gravar os arquivos de tabela (padrão: `backend/schema`). `--output` foi removido |
| `--schema` | O schema Postgres a ser lido (padrão: `public`) |
| `--force, -f` | Sobrescreve arquivos de tabela que já existem; sem isso, um arquivo existente é ignorado |
| `--database-url` | Lê este banco de dados em vez do banco do próprio projeto |
| `--docker` | Lê o banco de dados do compose, iniciando-o se necessário |
| `--from supabase` | Traduz convenções do Supabase (padrões `auth.uid()`, chaves estrangeiras `auth.users`, `TO anon` / `TO authenticated`) para um banco de dados Rebase. Não utilize quando o Rebase rodar no mesmo banco de dados ao lado do Supabase |
| `--data-inference` / `--no-data-inference` | Faz amostragem de até 100 linhas por tabela para detectar formatos, restrições e configurações de painel, ou lê apenas a estrutura. Sem nenhuma das opções, uma confirmação é solicitada; em ambientes sem terminal, lê apenas a estrutura |

Isso é útil ao adotar o Rebase em um banco de dados existente — faça a introspecção
primeiro e depois edite as tabelas geradas. Uma tabela com row-level security desativado é
gravada como qualquer outra, com seu `rls`; o push ativará o RLS, e o dry
run informará isso. Um backend executado sem nenhum `backend/schema` simplesmente
atende ao banco de dados diretamente — consulte [Apenas backend](/docs/getting-started/headless/).
Está saindo do Supabase? Consulte [Migrando do Supabase](/docs/recipes/migrate-from-supabase/).

### `rebase db push`

Envie alterações de schema diretamente para o banco de dados sem arquivos de migração:

```bash
rebase db push
```

**O que ele faz:**
- Lê o schema gerado do Drizzle
- Aplica alterações diretamente ao banco de dados (CREATE, ALTER, DROP)
- Executa previamente um dry-run do plano e para antes de qualquer coisa que destrua dados: exclusão
  de tabela, coluna, schema, view ou tipo, um `TRUNCATE`, ou uma alteração de tipo de coluna
  que possa perder valores (`timestamptz` → `date`, `numeric` → `integer`),
  ou uma alteração de chave primária — `(id)` → `(id, locale)` dá a cada linha um novo id, portanto
  links, chaves estrangeiras e ids armazenados em outros lugares deixam de encontrar sua linha.
  Ele também para
  antes da remoção de uma restrição CHECK ou EXCLUDE existente no banco de dados: nenhuma linha
  é perdida, mas a partir de então o banco de dados aceita linhas que antes recusava.
  Ele solicita confirmação no terminal, onde Ctrl-C ou Ctrl-D responde não, e recusa
  caso contrário; `--allow-destructive` aplica de qualquer maneira. `--yes` ainda faz isso
  nesta versão, com um aviso de depreciação; a partir da próxima versão, ele aprovará
  apenas pushes que não destruam nada. Um push que
  é interrompido nesse ponto descarta seu banco de dados temporário `<db>_dev_diff` ao sair
- Ativa o row-level security para cada tabela declarada, incluindo junções, logo após a
  alteração do schema e antes de qualquer etapa passível de falha, de forma que um push interrompido no meio do caminho deixe uma nova tabela
  negando qualquer requisição em vez de mantê-la aberta
- Aplica as políticas de RLS para as quais o `rls` de suas tabelas compila e **remove políticas que um push anterior substituiu**
- <span class="since-badge" data-since="0.35">A partir da versão 0.35</span> Com `--prune-policies`, também remove as políticas em tabelas declaradas que nenhuma tabela declara — aquelas que o dry run lista como "left in force", como políticas próprias do banco de dados após uma tabela migrar para `rls: "admin-only"` — na transação que aplica as declaradas. O dry run lista cada uma sob "Planned row-level security changes", e o push as protege como uma coluna descartada (solicita confirmação no terminal e, fora dele, exige `--allow-destructive`): remover uma política altera quem pode ler e gravar as linhas, e remover uma política `RESTRICTIVE` amplia o acesso. Tabelas que `backend/schema` não declara e o schema `rebase` nunca são tocados
- Mantém inalterada
  qualquer restrição CHECK e EXCLUDE em uma tabela declarada. Uma tabela
  não pode declarar nenhuma das duas, portanto são regras próprias do banco de dados, criadas manualmente
  ou trazidas por um banco de dados adotado via `schema introspect`; para remover uma, exclua-a
  manualmente (`ALTER TABLE … DROP CONSTRAINT …`). Triggers e funções que você escreveu
  também não são tocados
- Faz a correspondência exata
  do nome de tudo o que mantém inalterado, incluindo caracteres como `.`, `[`, `]`
  ou `*`
- Cria qualquer
  [índice de chave estrangeira que o Rebase deriva](/docs/backend/indexes#foreign-keys-are-indexed-for-you)
  que esteja faltando em uma tabela existente **antes** do planejamento, com
  `CREATE INDEX CONCURRENTLY`, para que as gravações na tabela continuem durante a criação;
  o Atlas então o encontra já no lugar. `--dry-run` apenas lista esses índices e não cria nada
- Aplica um carimbo
  nas políticas aplicadas da mesma forma que a inicialização do servidor faz, para que a primeira inicialização após um
  push as mantenha inalteradas em vez de recriar cada uma delas
- `--dry-run`
  lista o row-level security que o push alteraria, sob "Planned
  row-level security changes": as tabelas para as quais ele ativa o RLS, e cada
  política que ele cria, substitui ou remove, determinadas da forma como as próprias
  etapas do push decidem. Ele informa "No changes" apenas quando nem o schema nem o
  row-level security sofreriam alterações. Onde o carimbo de uma política não corresponder à sua
  regra, ou se ela não tiver nenhum (uma criada por `db migrate`, uma escrita manualmente), o dry
  run a recria a partir de sua regra com outro nome, em uma transação revertida (rollback),
  e compara o que o Postgres armazenou: o que resultar idêntico é
  considerado sem alteração. Assim, uma regra que o `schema introspect` leu de volta como SQL não planeja nada, e
  nem as políticas que o `db migrate` aplicou. Apenas aquelas que ele não conseguiu comparar (por exemplo, se
  o lock da tabela não foi concedido em dois segundos) são listadas separadamente. O push
  em si imprime uma única linha contabilizando as alterações
- Notifica quando um `rebase dev` estiver sendo executado no mesmo banco de dados: ele aplica novas tabelas e colunas conforme você salva, portanto "No changes" pode significar que elas já foram aplicadas
- Mostra cada
  instrução aplicada pelo Atlas uma vez. O Atlas se conecta sem SSL a um banco de dados nesta
  máquina (`localhost`, `127.x`, `::1`) cuja URL não especifique `sslmode`, assim como o app
  faz, em vez de falhar com `SSL is not enabled on the server`; uma URL que
  especifique `sslmode`, ou outro host, é repassada exatamente como escrita. Uma execução do Atlas
  que falhe antes de planejar não deixa nenhum banco de dados `<db>_dev_diff` para trás
- `--dry-run`
  não grava nada do projeto: `src/schema.generated.ts` é mantido como está,
  e as cópias em `drizzle/*.sql` que uma versão mais antiga commitou são listadas, não
  excluídas. Apenas a entrada do plano vai para `.rebase/sql/`, que não é commitado
- **Não** cria arquivos de migração

**Quanto tempo leva.** Quase todo o tempo de um push é o Atlas calculando o plano: ele
cria o schema desejado em um banco de dados temporário de rascunho e calcula o diff em relação ao banco real,
e esse custo cresce mais rápido do que a quantidade de tabelas — em um laptop ocioso
cerca de 0,25 s por plano com 11 tabelas, 0,9 s com 111 e 5,5 s com 411. Um push que
não altera nada planeja uma vez; um que altera algo planeja duas vezes (o dry-run
que a verificação de alterações destrutivas lê e, em seguida, a aplicação). Portanto, um push em um schema de
400 ou mais tabelas leva dezenas de segundos, e mais em uma máquina ocupada ou lenta.
Esse tempo é do Atlas, não do seu banco de dados: as etapas complementares — geração do
SQL, lock de RLS, busca, triggers, políticas, role — levam apenas alguns segundos
nessa escala, usando uma única conexão ao seu banco de dados.

**Os arquivos que ele gera pelo caminho**, todos em `.rebase/sql/` no diretório
do backend. O `db push` e o `db generate` gravam todos os cinco a partir de suas tabelas em
cada execução, antes de ler qualquer um deles, de modo que uma cópia commitada não seria lida por
nada. O diretório possui seu próprio `.gitignore` e nunca é commitado.

| Arquivo | Conteúdo |
|---------|----------|
| `schema.sql` | Tabelas, colunas, restrições e índices — o estado desejado pelo Atlas e o único sobre o qual ele faz o diff |
| `policies.sql` | As políticas de RLS para as quais o `rls` de suas tabelas compila |
| `search.sql` | As funções de busca de texto completo e colunas geradas, para tabelas com um bloco `search` |
| `vector.sql` | Extensões pgvector e índices ANN |
| `triggers.sql` | `rebase.set_updated_at()` e os triggers `BEFORE UPDATE` por trás de `.onUpdateNow()` |

O Atlas gerencia o primeiro e nada mais, de modo que o `db push` e a garantia de schema na
inicialização aplicam os outros quatro por conta própria. Uma implantação **baseada apenas em migrações** — que
executa `db migrate` e nunca `db push` — precisa incorporar esses quatro arquivos manualmente em uma
migração; o `db generate` avisa quando uma alteração for invisível para o Atlas.

Um projeto que tenha commitado esses arquivos em `drizzle/` em uma versão anterior terá
essas cópias excluídas na sua primeira execução, e o comando listará cada uma delas para que você possa
commitar a exclusão. Ele exclui apenas arquivos que começam com o cabeçalho
do gerador. Arquivos que você mesmo escreveu permanecem, assim como `drizzle/migrations/`.

:::note[Editar uma regra de segurança renomeia sua política]
Uma regra sem um `name` explícito compila para `<table>_<op>_<hash>`, onde o hash cobre a semântica da regra — portanto, *editar* uma regra (em vez de adicionar uma) produz uma política com um novo nome e mantém a antiga para trás.

Isso costumava ter um impacto enorme: o Postgres combina políticas `PERMISSIVE` com o operador OR, de modo que uma regra substituída como `USING (rebase.uid() IS NOT NULL)` continuava concedendo tudo, não importava o quão restrita fosse sua substituição. Restringir uma regra não tinha efeito, e o push informava sucesso.

O `db push` agora reconcilia isso: ele remove políticas geradas que não correspondem mais a nenhuma regra e relata — sem remover — qualquer política com nome customizado não descrita por suas tabelas, já que essas são indistinguíveis de um SQL escrito deliberadamente por alguém.

Para auditar um banco de dados que recebeu push antes desse recurso, execute `rebase doctor --policies`. Ele funciona como uma barreira de CI: encerra com código diferente de zero em caso de divergência, e também quando não consegue executar a verificação de forma alguma — ausência de `DATABASE_URL`, um caminho `--schema-dir` não resolvido ou falta de permissão da role de CI para ler `pg_policies`. Uma barreira que não conseguiu verificar não é considerada aprovada.

O `doctor` e o `db push` distinguem os dois tipos de políticas órfãs. Uma política com nome gerado foi substituída, e o próximo push a removerá. Qualquer outro nome foi escrito manualmente ou por outra ferramenta e permanece em vigor: descreva-a no `rls` de sua tabela para mantê-la (a visualização de RLS do Studio a importa) ou remova-a com `rebase db push --prune-policies` se estiver obsoleta.
:::

:::caution
O `db push` modifica o banco de dados diretamente. Use-o apenas em desenvolvimento. Para produção, use `db generate` + `db migrate` para criar arquivos de migração auditáveis.
:::

### `rebase db generate`

Gere arquivos de migração SQL a partir de alterações de schema:

```bash
rebase db generate
```

**O que ele faz:**
- Compara o schema do Drizzle com o estado construído pelas migrações em `drizzle/migrations/`, e não com o seu banco de dados
- Produz arquivos de migração SQL com carimbo de data/hora em `backend/drizzle/migrations/`
- Os arquivos podem ser revisados, editados e commitados no controle de versão
- Identifica cada
  instrução na nova migração que destrói dados, usando a mesma verificação que o `db push`
  executa antes de aplicar: remoção de tabela, coluna, schema, view ou tipo, um
  `TRUNCATE`, uma alteração de tipo de coluna que pode perder valores, uma alteração de chave
  primária ou a remoção de uma restrição CHECK ou EXCLUDE existente no banco de dados. Ele
  ainda grava o arquivo e encerra com código 0, portanto apenas avisa e não recusa a operação.
- Conclui indicando o
  próximo passo: `rebase db migrate`, e para a primeira migração de um projeto, a instrução
  `--baseline <version>` que um banco de dados já configurado pela inicialização necessita em vez disso. Uma
  migração posterior não recebe uma linha de baseline, já que uma migração destrutiva que recebesse baseline
  pularia seu `DROP`, e uma execução que não grava migração alguma informa apenas isso.

**Um CHECK adicionado por uma migração sua é removido pela próxima.** O `db generate`
faz o diff dos seus arquivos de migração, não do banco de dados, e o Atlas não tem como deixar um
objeto de fora desse diff. Portanto, uma restrição CHECK ou EXCLUDE que você escreveu manualmente em
uma migração e que nenhuma tabela pode declarar, retorna como
`ALTER TABLE … DROP CONSTRAINT …` na próxima migração que ele gravar, agrupada na
mesma instrução da alteração real. O relatório acima aponta essa remoção quando
o banco de dados já possui a restrição; ele não a remove do
arquivo. Exclua a cláusula antes de `rebase db migrate` ou deixe o
`rebase db migrate --refuse-destructive` ser interrompido por ela. O `db push` lê o
banco de dados e mantém a restrição.

As migrações geradas são arquivos SQL comuns — você pode inspecioná-los e modificá-los antes de aplicar.

### `rebase db migrate`

Execute todas as migrações pendentes:

```bash
rebase db migrate
```

**O que ele faz:**
- Lê `drizzle/migrations/` em busca de migrações não aplicadas
- Aplica-as em ordem ao banco de dados
- Rastreia quais migrações foram aplicadas
- Carimba as
  políticas de row-level security da mesma forma que o `db push` e a inicialização do servidor fazem, de
  modo que a primeira inicialização após uma migração as deixe intocadas em vez de recriar cada
  uma. Uma migração foi escrita a partir das tabelas da sua época, portanto uma política só é
  carimbada quando for exatamente o que sua regra gera agora: o migrate a cria
  novamente a partir de sua regra sob outro nome, em uma transação revertida (rollback), e
  compara o que o Postgres armazenou, assim como faz o `db push --dry-run`. Uma política que
  diferir não recebe carimbo, e a próxima inicialização reaplica sua tabela

`--refuse-destructive`
faz com que ele recuse a execução. Ele executa previamente um dry-run das migrações pendentes. Se qualquer
instrução destruir dados, de acordo com a mesma verificação usada por `db push` e
`db generate`, ele lista essas instruções e encerra com código 1. Ele não aplica nada, nem mesmo os arquivos
anteriores àquela instrução. Sem a flag, o `db migrate` comporta-se como antes e
aplica todos os arquivos pendentes:

```bash
rebase db migrate --refuse-destructive
```

Uma migração que reconstrói uma coluna de busca a remove primeiro, portanto esta flag também recusará
essa migração. Leia a lista exibida e, em seguida, execute `rebase db migrate`
sem a flag para aplicá-la.

#### Definindo a baseline de um banco de dados que o Rebase já inicializou

Toda inicialização do Rebase garante o schema, e o `rebase db push` o aplica diretamente. Assim, um banco de dados que já executou qualquer um dos dois já possui as tabelas e tipos que a primeira migração criaria, e o `rebase db migrate` é interrompido com `pq: type "posts_status" already exists (42710)`.

Não há nada de errado com a migração — o banco de dados simplesmente foi provisionado de outra forma. Registre o estado em que ele já se encontra e migre normalmente:

```bash
rebase db migrate --baseline 20260906101530
rebase db migrate
```

A versão é o prefixo numérico do arquivo de migração que descreve o que está no banco de dados *agora*. Essa migração e tudo o que vier antes dela são registrados como aplicados; tudo o que vier depois é executado. Em um banco de dados contra o qual nada jamais foi inicializado, nenhuma baseline é necessária — migre diretamente.

O mesmo ocorre mais adiante no ciclo de trabalho comum: edite uma tabela enquanto o `rebase dev` está rodando, e a inicialização adiciona a coluna antes que o `rebase db generate` escreva a migração que a adiciona, de modo que o `rebase db migrate` é interrompido com `column … already exists (42701)`. Defina a baseline dessa migração da mesma maneira. O `--baseline` funciona em um banco de dados que já registra migrações: ele marca tudo até a versão especificada como aplicado com `atlas migrate set` e notifica isso, ou informa que não há nada a registrar quando o histórico já o alcançou. Uma versão que nenhum arquivo em `drizzle/migrations` possui é recusada antes que qualquer coisa seja executada, listando as versões disponíveis.

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
exigindo portanto um servidor PostgreSQL real e ocupando o mesmo espaço em disco que a sua origem.

### `rebase doctor`

Detecte divergências (three-way drift) entre suas tabelas, o schema gerado do Drizzle e o banco de dados PostgreSQL ativo:

```bash
rebase doctor
```

**O que ele verifica:**
- Tabelas ↔ Schema gerado — estão sincronizados?
- Schema gerado ↔ Banco de dados — existem alterações não aplicadas?
- Tabelas ↔ Banco de dados — há alguma divergência inesperada?

Execute o `doctor` sempre que algo parecer fora de sincronia. Ele aponta com exatidão onde está a divergência.

A comparação do banco de dados inclui aquela que a inicialização faz antes de avisar que `schema.generated.ts` e o banco discordam, executada através do mesmo código. Portanto, toda diferença alertada pela inicialização também está no relatório, nas mesmas palavras: uma coluna que é NOT NULL de um lado e anulável do outro, e uma coluna que o banco ainda tem mas o arquivo não (a inicialização nunca descarta uma coluna, logo uma propriedade renomeada deixa sua coluna antiga para trás). Cada uma é um aviso, e a correção indica o `rebase db push`.

A comparação do banco de dados lê o banco do projeto, resolvido da forma como o `rebase db url` o resolve — em um scaffold recém-criado, o banco gerenciado, que o `doctor` inicia. Quando nenhum puder ser resolvido, essa fase é relatada como **ignorada** em vez de aprovada, e a execução nunca termina com "All schemas are in sync" — uma verificação que não ocorreu não é atestado de que tudo está em ordem.

Ele também aponta cada tabela sem o bloco [`search`](/docs/backend/search) que contenha mais de aproximadamente 10.000 linhas. Uma busca nessas tabelas — a caixa de busca do admin, `.search()`, `?searchString=` — é um `ILIKE '%term%'` nas colunas de texto, que nenhum índice consegue atender, de modo que cada busca lê a tabela inteira, e a contagem a lê novamente (cerca de um terço de segundo com 100.000 linhas, aumentando com a tabela). A contagem de linhas é uma estimativa do próprio Postgres, portanto a verificação não faz nenhuma varredura pesada. Trata-se de uma dica: não altera o código de saída e nada é indexado automaticamente para você.

Ele identifica uma **junção órfã**: uma tabela no schema `public` com a estrutura de uma junção many-to-many que nenhuma tabela declara. Essa estrutura consiste em duas colunas que juntas formam a chave primária, cada uma sendo uma chave estrangeira para uma tabela declarada. Renomear ou remover um `manyToMany` deixa sua antiga junção para trás, pois o push e a inicialização apenas criam tabelas, e todas as linhas de vínculo ainda estão nela. O aviso é apenas informativo, portanto não altera o código de saída. Sua correção é o comando `DROP TABLE`, que o `doctor` exibe e nunca executa.

### `rebase generate-sdk`

Gere um SDK tipado a partir das suas tabelas:

```bash
rebase generate-sdk
```

**O que ele faz:**
- Lê as tabelas que o `backend/schema/index.ts` exporta, por meio do loader usado na inicialização do backend, para que o SDK descreva exatamente as tabelas servidas; um schema que não compila interrompe a execução
- Gera tipos TypeScript para cada tabela em `generated/sdk/`
- Produz um arquivo `database.types.ts` para uso com `createRebaseClient<Database>()`: o tipo `Database`, `TableName` (a união de todos os slugs) e `tablesDictionary` / `TablesDictionary`, o mapeamento do acessador para o slug

O `rebase dev` executa isso para você na inicialização e a cada salvamento sob
`backend/schema/`. Execute manualmente no CI, em um repositório que não possui
tabelas próprias (veja `--from` abaixo) ou em qualquer lugar onde o `rebase dev` não esteja em execução.

**Opções:**

| Flag | Descrição |
|------|-----------|
| `--schema-dir` | O diretório do schema (padrão: `backend/schema`, ou a chave `tables` em `rebase.json`); caminhos relativos são resolvidos a partir de onde você executa o comando |
| `-o`, `--output` | Diretório de saída para o SDK (padrão: `generated/sdk/`) |
| `--from <link\|url>` | Lê o schema de um projeto em execução em vez do código-fonte local. `link` usa o projeto vinculado deste checkout. |
| `--token` | Token Bearer para o endpoint de contrato (padrão: `$REBASE_SERVICE_KEY` da shell; `.env` não é lido) |
| `--register` | Também tipa dados do lado do servidor: grava os tipos e uma declaração `Register` em `backend/generated/`, e a memoriza em `rebase.json` — consulte [Dados tipados do lado do servidor](/docs/backend/typed-server-data/) |

O `--from` é o que permite a um repositório que não contém tabelas — um
frontend separado, um segundo aplicativo web, um app mobile — gerar um cliente tipado a partir do
projeto com o qual se comunica: ele lê as `tables` do endpoint `/api/meta/contract` do
backend em execução. `REBASE_SERVICE_KEY` é enviada apenas para o projeto ao qual este
checkout está vinculado; passe `--token` explicitamente para qualquer outro host. A chave no
`.env` pertence ao seu backend local e nunca é enviada.
Uma recusa indica
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

Os nomes de campos nos tipos gerados são aqueles que a API fornece. O nome de tráfego
de um campo é sua chave de coluna, e a API adota camelCase em toda a sua extensão: a introspecção
grava uma coluna `created_at` como `createdAt: col.timestamp({ withTimezone: true })`, cujo nome SQL
é o snake_case da chave, e a fornece como `row.createdAt`. A coluna
em si permanece inalterada. O *acessador* da tabela é convertido em um nome de propriedade da
mesma forma (`my-notes` → `client.data.myNotes`), que é o que o `tablesDictionary`
mapeia de volta para o slug.

### `rebase migrate`

`rebase migrate collections-to-tables [dir]` move `config/collections` para
`backend/schema` (um `defineTable` por coleção, cada coluna explícita em
sua posição original, na grafia do Drizzle, e `index.ts` com
`defaultRls`) e `frontend/src/cms` (um `customizeTable` por coleção personalizada,
arquivos `defineFirestoreCollection`, `ui-config.json`), grava
`backend/resources.ts`, `backend/storage.ts` e `backend/generated/register.ts`,
adiciona `rebaseBackendGuard()` ao `vite.config.ts` do scaffold e, em seguida, executa
`rebase migrate sdk-calls`, que reescreve `.collection(` para `.table(`, as
outras renomeações do SDK e as origens de regras `existsIn` / `membership` no seu código,
e move os imports dos nomes que a versão 0.31 moveu para outro pacote
([a lista](/docs/upgrading/0-30-to-0-31-imports/)), adicionando o pacote às dependências do
importador ("Dependencies added": execute `pnpm install`). Atualize todos os pacotes `@rebasepro` para a versão 0.31 antes de executá-lo.
Cada execução lê o resultado gerado: o SQL gerado — DDL, políticas, busca,
vetores, triggers, views, o schema do Drizzle — deve ser idêntico byte a byte, caso contrário todos os
arquivos são revertidos. O que ele não consegue transferir é recusado indicando o arquivo e a linha, e
o que for deixado para você resolver manualmente é exibido como etapas numeradas, terminando com
`rebase skills install` quando o projeto contiver agent skills. Seus próprios módulos em
`config/` permanecem; a execução exibe a linha `git rm` para o que foi substituído. Ela também
rastreia coleções do Firestore criadas por funções, aliases de caminhos, um painel montado
fora de `App.tsx` e qualquer app estático desprotegido ([a lista completa](/docs/upgrading/0-30-to-0-31/#108-tables-in-backendschema-replace-configcollections--run-the-codemod-first)).
Após o `git rm`, o `--check` relata `already-migrated`.

| Flag | Efeito |
|---|---|
| `--dry-run` | Imprime arquivos, recusas, notas e etapas manuais; não grava nada. Comece por aqui. |
| `--check` | Em um projeto migrado: comprova se `backend/schema` ainda renderiza o mesmo SQL. Encerra com código 1 exibindo o diff, ou caso alguma regra mude de significado. |
| `--accept-rule-changes` | Com `--check`: as regras em "Review before deploying" foram revisadas. |
| `--json` / `--force` / `--skip-sdk-calls` | O relatório em JSON (com `ruleChanges`); executa em uma árvore de trabalho modificada ou sobre saída editada; não altera seu código. |

Leia duas listas na saída do SDK: **"Rewritten by name — review"** (receptores
não tipados, slots de dados, dublês de teste) e **"Left unchanged — check each"**
(renomeie aqueles que pertencem ao SDK; [uma busca](/docs/upgrading/0-30-to-0-31-by-hand/#sdk-calls-no-type-checker-sees) encontra o restante).

A verificação do SQL comprova a fidelidade da conversão, mas não que uma regra continua significando o
que significava antes. A última seção da saída, **"Review before deploying: these rules
change meaning"**, lista cada regra cuja política agora concede algo diferente
— um `access: "authenticated"` simples não concedia nada e agora admite qualquer chamador
autenticado ([os quatro formatos](/docs/upgrading/0-30-to-0-31/#review-before-deploying-these-rules-change-meaning)).
Em seguida, verifique em relação ao seu banco de dados: `rebase db push --dry-run` deve exibir "No
changes: the database already matches these tables.", e
`rebase doctor --policies` nenhuma divergência.

## Fluxo de Desenvolvimento

O fluxo de iteração rápida para desenvolvimento:

```bash
# 1. Edit a table in backend/schema/
# 2. Generate the Drizzle schema
rebase schema generate

# 3. Push directly to dev database
rebase db push
```

## Fluxo de Produção

O fluxo seguro e auditável para produção:

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
| O arquivo de schema não está atualizando | Verifique se o caminho `--schema-dir` (ou a chave `tables` em `rebase.json`) aponta para o diretório correto |
| A migração mostra alterações inesperadas | Execute `rebase doctor` para identificar divergências (drift) |
| `db push` falha em produção | Use `db generate` + `db migrate` em vez disso |
| Uma migração não deve descartar dados no CI ou em produção | `rebase db migrate --refuse-destructive` encerra com código 1 e não aplica nada quando uma instrução pendente destrói dados |
| `db migrate` falha com `already exists (42710)` | A inicialização ou o `db push` já provisionaram o schema — registre-o com `rebase db migrate --baseline <version>` |
| `db migrate` falha com `column … already exists (42701)` | O `rebase dev` adicionou a coluna na inicialização — defina a baseline dessa migração da mesma maneira |
| `db push` no banco de dados gerenciado falha com `Error: EOF` | O Atlas perdeu uma conexão que o `rebase dev` em execução mantém aberta. Execute novamente; se continuar falhando, pare o `rebase dev` primeiro |

## Próximos Passos

- **[Tabelas](/docs/schema/)** — Defina seu modelo de dados
- **[Referência da CLI](/docs/cli)** — Todos os comandos da CLI
- **[SDK Tipado](/docs/sdk)** — Use o SDK gerado
