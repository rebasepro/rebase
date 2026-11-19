---
sourceHash: 26de566694c2cb42
title: Geração de Schema
sidebar_label: Geração de Schema
description: Gere schemas do Drizzle ORM a partir das tabelas em backend/schema, crie migrações SQL, faça introspecção de um banco de dados existente para arquivos defineTable e mantenha seu banco de dados em sincronia com o Rebase CLI.
---

## Visão Geral

O Rebase usa um pipeline de **schema-as-code** onde as tabelas que você declara com
`defineTable` em `backend/schema/` são a única fonte da verdade (single source of truth). A CLI
as transforma por meio de um pipeline determinístico:

```
Tables (backend/schema) → Drizzle Schema → SQL Migrations → PostgreSQL
```

Esta página cobre todos os comandos da CLI envolvidos nesse pipeline.

## O Pipeline

### 1. Tabelas → Drizzle Schema

As tabelas que o `backend/schema/index.ts` exporta descrevem colunas, tipos, relações,
enums e row-level security (segurança a nível de linha). Cada comando abaixo as lê por meio do loader
a partir do qual o backend inicializa, portanto, um schema que não compila — uma tabela sem
`rls`, `"inherit"` sem `defaultRls`, um `defineTable` que o index não
exporta — interrompe o comando com um `SchemaDefinitionError` especificando cada problema,
e nada é gravado. O comando `schema generate` gera um arquivo de schema do Drizzle ORM
a partir delas.

Cada comando que lê o schema aceita `--schema-dir <dir>` para um projeto
que mantém suas tabelas em outro lugar; o padrão é `backend/schema`, ou a
chave `tables` do app backend em `rebase.json`. `--collections` / `-c`, a
flag anterior à 0.31, é recusada com uma mensagem indicando o codemod
([`rebase migrate collections-to-tables`](#rebase-migrate)), assim como um
projeto que ainda possui `config/collections`.

### 2. Esquema declarado → Migrações

`db generate` gera o SQL desejado para Ptah a partir das tabelas, políticas,
funções, índices, gatilhos e vistas declarados. Ptah compara esse SQL com as
migrações em `backend/drizzle/migrations/`, reproduzidas em um banco
temporário, e escreve uma nova migração. Rebase também consulta o banco de
destino para proteger objetos que não gerencia. Uma coluna já adicionada
na inicialização ou por `db push` continua na migração porque o diff começa
pelo histórico de migrações.

### 3. Migrations → PostgreSQL

O comando `db migrate` aplica as migrações pendentes ao seu banco de dados PostgreSQL.

## Comandos

### `rebase schema generate`

Gera um arquivo de schema do Drizzle ORM a partir das suas tabelas:

```bash
rebase schema generate
```

**O que ele faz:**
- Lê as tabelas que o `backend/schema/index.ts` exporta
- Gera `backend/src/schema.generated.ts` com definições de tabela, enums e relações do Drizzle

**Opções:**

| Flag | Descrição |
|------|-----------|
| `--schema-dir` | O diretório de schemas (padrão: `backend/schema`); caminhos relativos são resolvidos a partir de onde você executa o comando |
| `--output, -o` | Caminho de saída para o arquivo de schema gerado; caminhos relativos são resolvidos a partir de onde você executa o comando |
| `--watch, -w` | Observa alterações e regenera automaticamente |

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

O `rebase dev` mantém o arquivo atualizado por conta própria, portanto, essa é a verificação para um build
ou etapa de CI. Ele aceita `--schema-dir` e `--output` assim como o `rebase schema generate`.

### `rebase schema reconcile`

Flexibilize (relax) e remova o que a inicialização não fará, depois de ter lido o plano:

```bash
rebase schema reconcile                         # relax NOT NULL on columns made nullable or removed
rebase schema reconcile --drop voice_cache.wav  # and drop a column no table declares
```

**O que ele faz:**
- Solicita ao backend em execução que faça o planejamento contra seu próprio banco de dados. Esse é o banco para o qual o `.env` e o link da nuvem apontam, funcionando também no Rebase Cloud, onde nada mais acessa o banco de dados diretamente.
- Planeja o `DROP NOT NULL` para cada coluna que uma tabela declara como anulável (nullable) e que o banco de dados ainda exige como obrigatória.
- Lista todas as colunas que nenhuma tabela declara. Uma coluna que seja `NOT NULL` sem valor padrão bloqueia qualquer inserção, por isso ela também é flexibilizada e seus dados são mantidos. Ela só remove as colunas que você especificar com `--drop <table>.<column>`, e mostra quantas linhas contêm valores em cada uma.
- Aplica as alterações assim que você digita `yes`. O servidor executa o plano apenas com base no resumo (digest) daquele que você leu, portanto, se o banco de dados ou as tabelas mudarem no intervalo, ele recusará e você precisará revisar novamente. `--yes` pula a confirmação.

A inicialização só adiciona itens; portanto, depois de remover uma coluna do seu `defineTable`, a coluna permanece no banco de dados com seus dados. Uma coluna `NOT NULL` sem valor padrão fará com que qualquer inserção falhe, e o log de inicialização sugere este comando para resolver: sem `--drop` para manter os dados, ou com a flag para remover a coluna. Faça o deploy da alteração da tabela primeiro, pois o reconcile planeja em relação ao que o backend está executando. Ele precisa de `REBASE_SERVICE_KEY` no `.env`. Localmente, o `rebase db push` cobre o mesmo por meio do seu controle de alterações destrutivas (destructive-change gate).

### `rebase schema introspect`

Gera arquivos `defineTable` a partir de um banco de dados PostgreSQL existente:

```bash
rebase schema introspect
```

**O que ele faz:**
- Conecta-se ao banco de dados deste projeto, aquele que `rebase db url` exibe (o banco gerenciado é iniciado se for esse o caso); `--database-url` especifica outro, e `--docker` usa o do compose
- Lê cada tabela, coluna, tipo, chave estrangeira e política (policy), e grava
  `backend/schema/<table>.ts` — um `defineTable` por tabela — e o
  `backend/schema/index.ts` que os exporta (mesclado a um index já existente)
- Declara cada coluna com seu tipo Postgres: `col.uuid()`, `col.varchar({ length })`,
  `col.numeric({ precision, scale })`, um enum com seus rótulos e nome de tipo real
  (um `pgEnum` quando o tipo é compartilhado), um array como `<item>.array()`,
  `col.vector({ dimensions })`, chaves identity e serial, padrões — grafados como o
  Drizzle os grafa. Um tipo que nenhum builder nomeia se torna
  `col.custom({ dataType: "<sql type>" })`, o qual o Rebase serve da mesma forma que o
  driver o retorna; `db generate` e `db push` o recusam até que o planejador
  possa planejá-lo
- Declara a coluna de chave estrangeira, o `belongsTo` nela e o `hasMany` reverso
  no destino; uma tabela de junção se torna um `manyToMany`, com suas próprias
  colunas formando o `pivot`
- Lê as políticas de row-level security de cada tabela em seu `rls`: nome,
  comando, modo, lista `TO`, `USING` e `WITH CHECK`. As políticas `<table>_default_*`
  que o próprio Rebase adiciona são omitidas, para que o `db push` subsequente recrie
  cada política como estava. Uma tabela com row-level security ativado e nenhuma política é
  gravada como `rls: "admin-only"`
- Lê cada expressão (o `USING` de uma política, um CHECK, o padrão de uma coluna) sob
  o `search_path` que o servidor usa, `public`, portanto uma função no schema `rebase`
  é escrita como `rebase.roles()`
- Converte um CHECK que ele consegue ler (`total >= 0`) no `.validate()` da coluna, e mantém a constraint em si no banco de dados, onde o push subsequente a preserva. Cada CHECK também é listado em "Not carried over" com seu SQL: um push em um *novo* banco de dados cria a validação, não a constraint
- Declara cada índice simples (apenas colunas, btree, gin ou brin, sem predicado) no `indexes` da tabela. Um índice exclusivo em uma coluna de chave estrangeira é deixado a cargo da relação, que cria um
- Com `--from supabase`, traduz as convenções do Supabase para um banco de dados que você está migrando: um padrão de coluna `auth.uid()` se torna `.onCreateUser()` (o servidor grava o id do chamador), uma coluna contendo um user id do Supabase (esse padrão, ou uma chave estrangeira para `auth.users`) se torna `col.text().userId()`, já que `rebase.users.id` e `rebase.uid()` são texto, e uma política `TO authenticated` / `TO anon` perde a role (um banco Rebase não tem nenhuma das duas) e passa a exigir um chamador autenticado / não autenticado; uma política exclusiva para `service_role` é descartada. Cada alteração é anotada no topo do arquivo da tabela. Sem a flag, elas são mantidas como estão (o Rebase rodando no mesmo banco ao lado do Supabase ainda precisa delas), e a execução informa quando as encontrou
- Conclui com o que **não** foi transportado: funções, triggers, extensões, CHECKs, índices que `indexes` não pode expressar, chaves estrangeiras com múltiplas colunas ou para outro schema. O SQL que recria cada um que o Postgres consegue exibir é gravado em `backend/sql/introspected-left-behind.sql`, para ser revisado e aplicado após o primeiro push (`psql "$DATABASE_URL" -f …`, ou `rebase cloud db query --file …` no Rebase Cloud)
- Lembra você de que `DATABASE_URL` ainda aponta para o banco de dados lido: em uma migração essa é a origem, e um `db push` agora escreveria nele
- Coloca o que não pôde definir com exatidão em um comentário no topo do arquivo da tabela e no terminal — um conjunto fechado de strings em uma coluna de texto, uma coluna gerada cuja expressão não foi lida, um tipo customizado — com o que um push faria com isso
- Com `--data-inference`, faz amostragem de até 100 linhas por tabela e grava o que
  encontrou relacionado à apresentação — títulos, ícones, boards, ordenações, opções de campos — em
  `frontend/src/cms/<table>.tsx` como um `customizeTable`, quando o frontend do
  projeto depende de `@rebasepro/cms`. Um projeto headless não recebe nada
- Contra um banco de dados que não está em execução, exibe o mesmo banner que o `db push`
  exibe, uma vez, e não cria nada. Ele imprime o diretório de saída como um
  caminho absoluto

**Opções:**

| Flag | Descrição |
|------|-----------|
| `--schema-dir` | Onde gravar os arquivos de tabela (padrão: `backend/schema`). `--output` foi removido |
| `--schema` | O schema do Postgres a ser lido (padrão: `public`) |
| `--force, -f` | Sobrescreve arquivos de tabela que já existem; sem ela, um arquivo existente é ignorado |
| `--database-url` | Lê este banco de dados em vez do próprio banco do projeto |
| `--docker` | Lê o banco de dados do compose, iniciando-o se necessário |
| `--from supabase` | Traduz convenções do Supabase (padrões `auth.uid()`, chaves estrangeiras de `auth.users`, `TO anon` / `TO authenticated`) para um banco de dados Rebase. Deixe desativado quando o Rebase rodar no mesmo banco ao lado do Supabase |
| `--data-inference` / `--no-data-inference` | Amostra até 100 linhas por tabela para detectar formatos, restrições e configurações de painel, ou lê apenas a estrutura. Sem nenhuma delas, o comando pergunta; sem um terminal, ele lê apenas a estrutura |

Isso é útil ao adotar o Rebase em um banco de dados existente — faça a introspecção
primeiro e depois edite as tabelas geradas. Uma tabela com row-level security desativado é
gravada como qualquer outra, com seu `rls`; o push ativa o RLS, e o dry
run informa isso. Um backend executado sem nenhum `backend/schema` serve o
banco de dados diretamente — consulte [Somente backend](/docs/getting-started/headless/).
Saindo do Supabase? Consulte [Migrando do Supabase](/docs/recipes/migrate-from-supabase/).

### `rebase db push`

Aplica o esquema declarado diretamente ao banco de dados:

```bash
rebase db push
rebase db push --dry-run
```

Rebase gera um único SQL desejado com tabelas, políticas, funções, índices
de busca e vetoriais, gatilhos e vistas. Ptah Compat planeja e aplica esses
objetos em conjunto. O plano fica restrito às declarações de Rebase. Tabelas,
vistas, extensões e funções externas permanecem intactas. Políticas,
gatilhos, índices e restrições CHECK e EXCLUDE personalizados em uma tabela
declarada também são protegidos.

O comando mostra o plano antes de aplicá-lo. Uma alteração destrutiva,
incluindo `DROP EXTENSION`, exige confirmação ou `--allow-destructive`.
`--dry-run` mostra o plano sem modificar o banco nem escrever uma migração.
Depois que o Ptah aplica o plano, o Rebase ativa RLS, prepara as tabelas de autenticação e os papéis de
requisição, e registra a versão do esquema. Os índices derivados de chaves
estrangeiras que faltarem são criados antes do plano.

Com PostgreSQL externo, inclusive um serviço Docker Compose local, o Ptah pode
reexecutar SQL para `db push`, `db push --dry-run` e `db generate`. Use
`PTAH_DEV_SERVER_DISPOSABLE=1` apenas quando puder descartar todo o servidor de
desenvolvimento. Em um servidor compartilhado, `PTAH_TRUST_REPLAY_SQL=1` permite a
execução com os privilégios da conexão de desenvolvimento. Ative a opção somente se
confiar no SQL. O PGlite gerenciado já é descartável. Consulte a
[configuração](/docs/getting-started/configuration/).

`db push` e `db generate` atualizam `.rebase/sql/` com o esquema atual.
O Git ignora esse diretório.

| Arquivo | Finalidade |
|---------|------------|
| `schema.sql` | Estado desejado dos objetos declarados |
| `search.sql` | Restaura colunas de busca geradas após uma falha |
| `policies.sql`, `vector.sql`, `triggers.sql`, `views.sql` | Trechos do SQL gerado |

A CLI remove cópias antigas de SQL gerado de `drizzle/` e preserva `drizzle/migrations/`.

Inclua `backend/drizzle/ptah-managed.json` no Git junto com as migrações. O Rebase
usa os nomes gravados para planejar a remoção de declarações retiradas.

Uma política cujo nome foi gerado pelo Rebase é removida quando outra regra
a substitui. Uma política com nome personalizado continua em vigor. Use
`rebase doctor --policies` para verificar divergências. Para que Rebase
gerencie uma política personalizada, declare-a no `rls` da tabela.

:::caution
`db push` modifica o banco diretamente. Use-o no desenvolvimento.
Na produção, crie uma migração revisável com `db generate` e aplique-a
com `db migrate`.
:::

### `rebase db generate`

Cria uma migração SQL com data e hora:

```bash
rebase db generate
```

Ptah compara o SQL desejado com o estado reconstruído das migrações em
`backend/drizzle/migrations/`. O diff começa por esse histórico, não pelo
banco ativo. Rebase ainda consulta o banco ativo para identificar objetos
externos. Uma coluna já adicionada na inicialização ou por `db push` também
aparece na migração gerada.

O comando grava a migração em `backend/drizzle/migrations/` e avisa sobre operações
destrutivas. Um plano vazio não gera uma migração.

Para a primeira migração, o comando mostra um exemplo com `--baseline <version>`.
Verifique antes que o banco de dados corresponde à versão.

Revise cada migração em busca de `DROP CONSTRAINT`. Restrições CHECK e EXCLUDE
manuais que só existem no histórico reexecutado podem aparecer no plano como
exclusões.

### `rebase db migrate`

Executa todas as migrações pendentes:

```bash
rebase db migrate
```

**O que ele faz:**
- Lê `drizzle/migrations/` em busca de migrações não aplicadas
- Aplica-as em ordem ao banco de dados
- Rastreia quais migrações foram aplicadas
- Aplica marcas (stamps) nas
  políticas de segurança em nível de linha da mesma forma que o `db push` e a inicialização do servidor fazem, para
  que o primeiro boot após uma migração não precise recriar cada uma
  delas. Como uma migração foi escrita a partir das tabelas da sua época, uma política só
  recebe a marca se corresponder exatamente ao que sua regra produz agora: o migrate a recria
  a partir de sua regra com outro nome, em uma transação revertida (rollback), e
  compara com o que o Postgres armazenou. Uma política
  diferente não recebe marca, e o próximo boot reaplica a tabela correspondente

O `--refuse-destructive`
faz com que ele recuse a execução. Ele executa um dry-run das migrações pendentes primeiro. Se alguma
instrução destruir dados, de acordo com a mesma verificação usada por `db push` e `db generate`, ele
lista essas instruções e encerra com código 1. Ele não aplica nada, nem mesmo os arquivos
anteriores àquela instrução. Sem a flag, o `db migrate` se comporta como antes e
aplica todos os arquivos pendentes:

```bash
rebase db migrate --refuse-destructive
```

Uma migração que recria uma coluna de busca a remove primeiro, portanto, essa flag também recusa
essa migração. Leia a lista impressa e, em seguida, execute `rebase db migrate`
sem a flag para aplicá-la.

#### Criando uma baseline para um banco de dados que o Rebase já inicializou

Toda inicialização do Rebase valida o schema, e o `rebase db push` o aplica diretamente. Portanto, um banco de dados que já executou qualquer um dos dois já possui as tabelas e tipos que a primeira migração criaria, e o `rebase db migrate` para com `type "posts_status" already exists (42710)`.

Não há nada de errado com a migração — o banco de dados foi provisionado de outra forma. Registre o ponto em que ele já está e depois faça a migração normalmente:

```bash
rebase db migrate --baseline 20260906101530
rebase db migrate
```

A versão é o prefixo numérico do arquivo de migração que descreve o que está no banco de dados *agora*. Essa migração e tudo o que veio antes dela são registrados como aplicados; tudo o que vier depois é executado. Em um banco de dados contra o qual nada jamais foi inicializado, nenhuma baseline é necessária — migre diretamente.

Para uma migração posterior, use o baseline somente depois de aplicar e verificar
todas as mudanças pendentes até a versão, inclusive exclusões e atualizações de
dados. Uma coluna existente comprova apenas uma mudança.

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
portanto, precisa de um servidor PostgreSQL real e consome o mesmo espaço em disco que a sua origem.

### `rebase doctor`

Detecta divergências triangulares (three-way drift) entre suas tabelas, o schema gerado do Drizzle e o banco de dados PostgreSQL ativo:

```bash
rebase doctor
```

**O que ele verifica:**
- Tabelas ↔ Schema gerado — estão em sincronia?
- Schema gerado ↔ Banco de dados — existem alterações não aplicadas?
- Tabelas ↔ Banco de dados — há alguma divergência inesperada?

Execute o `doctor` sempre que algo parecer fora de sincronia. Ele aponta com exatidão onde está a divergência.

A comparação do banco de dados inclui aquela que a inicialização faz antes de avisar que o `schema.generated.ts` e o banco de dados divergem, executada pelo mesmo código. Assim, cada diferença sobre a qual a inicialização alerta também está no relatório, nas mesmas palavras: uma coluna que é NOT NULL de um lado e nullable do outro, e uma coluna que o banco ainda tem mas o arquivo não tem (o boot nunca remove uma coluna, logo uma propriedade renomeada deixa sua coluna antiga para trás). Cada uma é um aviso, e a correção sugere `rebase db push`.

A comparação do banco de dados lê o banco do projeto, resolvido da forma como o `rebase db url` o resolve — em um scaffold recém-criado, o banco gerenciado, que o `doctor` inicializa. Quando nenhum puder ser resolvido, essa fase é reportada como **skipped** (ignorada) em vez de aprovada, e a execução nunca termina com "All schemas are in sync" — uma verificação que não ocorreu não é garantia de conformidade.

Ele também lista cada tabela sem um [bloco `search`](/docs/backend/search) que contenha mais de aproximadamente 10.000 linhas. Uma busca nessas tabelas — a caixa de busca do admin, `.search()`, `?searchString=` — usa `ILIKE '%term%'` sobre as colunas de texto, o que nenhum índice consegue atender, de modo que cada busca lê a tabela inteira e a contagem a lê novamente (cerca de um terço de segundo com 100.000 linhas, crescendo com o tamanho da tabela). A contagem de linhas é uma estimativa do próprio Postgres, logo a verificação não varre nada. Trata-se de uma dica: não altera o código de saída e nada é indexado automaticamente.

Ele aponta uma **junção órfã** (orphaned junction): uma tabela no schema `public` com formato de junção muitos-para-muitos (many-to-many) que nenhuma tabela declara. O formato consiste em duas colunas que juntas formam a chave primária, cada uma sendo uma chave estrangeira para uma tabela declarada. Renomear ou remover um `manyToMany` deixa sua antiga tabela de junção para trás, pois o push e o boot apenas criam tabelas, e todas as linhas de vínculo ainda permanecem nela. A nota é apenas informativa, portanto não altera o código de saída. Sua correção é a instrução `DROP TABLE`, que o `doctor` exibe e nunca executa.

### `rebase generate-sdk`

Gera um SDK tipado a partir de suas tabelas:

```bash
rebase generate-sdk
```

**O que ele faz:**
- Lê as tabelas que o `backend/schema/index.ts` exporta, por meio do loader a partir do qual o backend inicializa, para que o SDK descreva exatamente as tabelas servidas; um schema que não compila interrompe o processo
- Gera tipos TypeScript para cada tabela em `generated/sdk/`
- Produz um arquivo `database.types.ts` para uso com `createRebaseClient<Database>()`: o tipo `Database`, `TableName` (a união de todos os slugs), e `tablesDictionary` / `TablesDictionary`, o mapeamento de acessador para slug

O `rebase dev` executa isso para você na inicialização e a cada salvamento em
`backend/schema/`. Execute manualmente no CI, em um repositório que não possui
tabelas próprias (veja `--from` abaixo) ou em qualquer lugar onde o `rebase dev` não esteja em execução.

**Opções:**

| Flag | Descrição |
|------|-----------|
| `--schema-dir` | O diretório de schemas (padrão: `backend/schema`, ou a chave `tables` em `rebase.json`); caminhos relativos são resolvidos a partir de onde você executa o comando |
| `-o`, `--output` | Diretório de saída para o SDK (padrão: `generated/sdk/`) |
| `--from <link\|url>` | Lê o schema de um projeto em execução em vez do código-fonte local. `link` usa o projeto vinculado a este checkout. |
| `--token` | Bearer token para o endpoint de contrato (padrão: `$REBASE_SERVICE_KEY` do terminal; o `.env` não é lido) |
| `--register` | Também tipa dados do lado do servidor: grava os tipos e uma declaração `Register` em `backend/generated/`, e memoriza isso em `rebase.json` — veja [Dados tipados do lado do servidor](/docs/backend/typed-server-data/) |

O `--from` é o que permite que um repositório sem tabelas — um frontend separado,
um segundo aplicativo web, um app mobile — gere um cliente tipado a partir do
projeto com o qual se comunica: ele lê as `tables` de `/api/meta/contract` do
backend em execução. `REBASE_SERVICE_KEY` só é enviada para o projeto ao qual este
checkout está vinculado; passe `--token` explicitamente para qualquer outro host. A chave em
`.env` pertence ao seu backend local e nunca é enviada.
Uma recusa indica
qual situação ocorreu: um `--token` recusado, uma chave de shell recusada, uma chave
retida para um host não vinculado, uma chave existente apenas em `.env` ou nenhuma chave fornecida.

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

Os nomes de campos nos tipos gerados são aqueles que a API serve. O nome transmitido (wire name)
de um campo é sua chave de coluna, e a API é totalmente em camelCase: a introspecção
grava uma coluna `created_at` como `createdAt: col.timestamp({ withTimezone: true })`, cujo nome SQL
é o snake_case da chave, e a serve como `row.createdAt`. A coluna
em si não é alterada. O *accessor* da tabela é transformado em um nome de propriedade
da mesma forma (`my-notes` → `client.data.myNotes`), que é o que o `tablesDictionary`
mapeia de volta para o slug.

### `rebase migrate`

O comando `rebase migrate collections-to-tables [dir]` move `config/collections` para
`backend/schema` (um `defineTable` por coleção, cada coluna explícita em
sua posição original, na sintaxe do Drizzle, e `index.ts` com
`defaultRls`) e `frontend/src/cms` (um `customizeTable` por coleção customizada,
arquivos `defineFirestoreCollection`, `ui-config.json`), grava
`backend/resources.ts`, `backend/storage.ts` e `backend/generated/register.ts`,
adiciona `rebaseBackendGuard()` ao `vite.config.ts` do scaffold e, em seguida, executa
`rebase migrate sdk-calls`, que reescreve `.collection(` para `.table(`, os
outros renomeamentos do SDK e as fontes de regras `existsIn` / `membership` no seu código,
e move as importações de nomes que a versão 0.31 moveu para outro pacote
([a lista](/docs/upgrading/0-30-to-0-31-imports/)), adicionando o pacote às
dependências do importador ("Dependencies added": execute `pnpm install`). Atualize todos os pacotes `@rebasepro` para a versão 0.31 antes de executá-lo.
Cada execução relê o resultado: o SQL gerado — DDL, políticas, busca,
vector, triggers, views, o schema do Drizzle — deve ser idêntico byte a byte, caso contrário, todos os
arquivos serão restaurados. O que não puder ser transportado é recusado indicando o arquivo e a linha, e
o que restar para você fazer é impresso como etapas manuais numeradas, terminando com
`rebase skills install` quando o projeto contém agent skills. Seus próprios módulos em
`config/` permanecem; a execução imprime a linha `git rm` para o que foi substituído. Ele também
segue coleções do Firestore que uma função constrói, path aliases, um painel montado
fora de `App.tsx` e qualquer app estático sem proteção ([a lista completa](/docs/upgrading/0-30-to-0-31/#108-tables-in-backendschema-replace-configcollections--run-the-codemod-first)).
Após o `git rm`, o `--check` reporta `already-migrated`.

| Flag | Efeito |
|---|---|
| `--dry-run` | Imprime arquivos, recusas, notas e passos manuais; não grava nada. Comece por aqui. |
| `--check` | Em um projeto migrado: comprova que `backend/schema` ainda renderiza o mesmo SQL. Encerra com código 1 exibindo o diff, ou quando uma regra mudar de significado. |
| `--accept-rule-changes` | Com `--check`: confirma que as regras em "Review before deploying" foram revisadas. |
| `--json` / `--force` / `--skip-sdk-calls` | O relatório em JSON (com `ruleChanges`); executa em uma árvore de trabalho com alterações (dirty tree) ou sobre saídas editadas; deixa seu código intacto. |

Leia duas listas em sua saída do SDK: **"Rewritten by name — review"** (receptores
não tipados, data slots, test doubles) e **"Left unchanged — check each"**
(renomeie aqueles que pertencem ao SDK; [uma busca](/docs/upgrading/0-30-to-0-31-by-hand/#sdk-calls-no-type-checker-sees) encontra o restante).

A verificação de SQL comprova que a conversão foi fiel, mas não que uma regra continua significando o que
significava antes. A última seção da saída, **"Review before deploying: these rules
change meaning"**, lista cada regra cuja política agora concede algo diferente
— um simples `access: "authenticated"` não concedia nada e agora permite qualquer chamador
autenticado ([os quatro formatos](/docs/upgrading/0-30-to-0-31/#review-before-deploying-these-rules-change-meaning)).
Em seguida, verifique contra seu banco de dados: `rebase db push --dry-run` deve exibir "No
changes: the database already matches the declared schema.", e
`rebase doctor --policies` nenhuma divergência (no drift).

## Fluxo de Trabalho de Desenvolvimento

O fluxo de trabalho de iteração rápida para desenvolvimento:

```bash
# 1. Edit a table in backend/schema/
# 2. Generate the Drizzle schema
rebase schema generate

# 3. Push directly to dev database
rebase db push
```

## Fluxo de Trabalho de Produção

O fluxo de trabalho seguro e revisável para produção:

```bash
# 1. Edit a table in backend/schema/
# 2. Generate the Drizzle schema
rebase schema generate

# 3. Generate SQL migration files
rebase db generate

# 4. Review the generated SQL in backend/drizzle/migrations/
# 5. Commit the migration to version control
git add backend/drizzle/migrations/ backend/drizzle/ptah-managed.json

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
| `db migrate` falha com `already exists (42710)` | Verifique todas as mudanças até essa versão, inclusive exclusões e atualizações de dados, antes de definir um baseline. |
| `db migrate` falha com `column … already exists (42701)` | Verifique todas as mudanças até essa versão, inclusive exclusões e atualizações de dados, antes de definir um baseline. |

## Próximos Passos

- **[Tables](/docs/schema/)** — Defina seu modelo de dados
- **[CLI Reference](/docs/cli)** — Todos os comandos da CLI
- **[Typed SDK](/docs/sdk)** — Use o SDK tipado
