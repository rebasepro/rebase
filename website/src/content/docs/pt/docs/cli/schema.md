---
sourceHash: d2dda811dc43afa7
title: Geração de Esquema
sidebar_label: Geração de Esquema
description: Gere esquemas Drizzle ORM a partir das definições de coleções, crie migrações SQL e mantenha seu banco de dados sincronizado com a CLI da Rebase.
---

## Visão Geral

A Rebase usa um pipeline de **esquema-como-código** onde suas definições de coleções em TypeScript são a única fonte de verdade. A CLI as transforma através de um pipeline determinístico:

```
Collections (TypeScript) → Drizzle Schema → SQL Migrations → PostgreSQL
```

Esta página cobre todos os comandos da CLI envolvidos nesse pipeline.

## O Pipeline

### 1. Coleções → Esquema Drizzle

Suas definições de coleções em `config/collections/` descrevem tabelas, colunas, tipos, relações e enums. O comando `schema generate` as lê e produz um arquivo de esquema Drizzle ORM.

### 2. Esquema Drizzle → Migrações

A partir do esquema Drizzle gerado, `db generate` compara com o estado atual do banco de dados e produz arquivos de migração SQL com carimbo de data/hora.

### 3. Migrações → PostgreSQL

O comando `db migrate` aplica as migrações pendentes ao seu banco de dados PostgreSQL.

## Comandos

### `rebase schema generate`

Gere um arquivo de esquema Drizzle ORM a partir das suas definições de coleções:

```bash
rebase schema generate
```

**O que ele faz:**
- Lê todas as coleções de `config/collections/`
- Gera `backend/src/schema.generated.ts` com as definições de tabelas, enums e relações do Drizzle

**Opções:**

| Flag | Descrição |
|------|-------------|
| `--collections, -c` | Diretório de coleções (padrão: `config/collections/`); caminhos relativos são resolvidos a partir de onde você executa o comando |
| `--output, -o` | Caminho de saída para o arquivo de esquema gerado; caminhos relativos são resolvidos a partir de onde você executa o comando |
| `--watch, -w` | Observar mudanças e regenerar automaticamente |

O **modo watch** é útil durante o desenvolvimento — edite um arquivo de coleção e o esquema é regenerado instantaneamente:

```bash
rebase schema generate --watch
```

### `rebase schema stale`

Verifique se o esquema gerado ainda corresponde às coleções:

```bash
rebase schema stale          # report, and exit 1 if anything is stale
rebase schema stale --fix    # regenerate the file instead
```


**O que ele faz:**
- Renderiza o que as coleções em `config/collections/` geram e o compara, declaração por declaração, com `backend/src/schema.generated.ts`
- Nomeia cada diferença — uma tabela ausente, uma coluna com outro tipo, um rótulo de enum removido, ou chaves estrangeiras nomeadas como uma versão anterior as derivava — e sai com código diferente de zero
- Com `--fix`, regenera o arquivo em vez de reportar

O `rebase dev` mantém o arquivo atualizado por conta própria, então esta é a verificação
para um build ou uma etapa de CI. Ele aceita `--collections` e `--output` como o
`rebase schema generate` aceita.

### `rebase schema introspect`

Faça engenharia reversa das definições de coleções a partir de um banco de dados PostgreSQL existente:

```bash
rebase schema introspect
```

**O que ele faz:**
- Conecta-se ao seu banco de dados (usando a string de conexão do seu `.env`)
- Inspeciona todas as tabelas, colunas, tipos e chaves estrangeiras
- Gera arquivos de definição de coleções
- <span class="since-badge" data-since="0.25">Desde 0.25</span> Lê as políticas de
  segurança em nível de linha de cada tabela para as `securityRules` da sua coleção:
  nome, comando, modo, lista `TO`, `USING` e `WITH CHECK`. As políticas
  `<table>_default_*` que o próprio Rebase adiciona ficam de fora. Assim, o
  `db push` depois dela recria cada política como estava. Na 0.24 as políticas
  ficam fora dos arquivos, e um push pode remover uma cujo nome tem a forma de uma
  política gerada (`<table>_<op>_<hash>`)
- <span class="since-badge" data-since="0.25">Desde 0.25</span> Gera uma tabela
  cujas políticas dão a cada usuário as suas próprias linhas (elas leem `rebase.uid()`,
  `app.uid` ou o JWT) como uma entidade na navegação, por menos linhas que tenha.
  Na 0.24 uma tabela pequena é uma lista de códigos, e uma tabela que pertence a
  outra é ocultada como filha dela
- <span class="since-badge" data-since="0.25">Desde 0.25</span> Contra um banco de
  dados que não está em execução, imprime o mesmo banner que o `db push` imprime,
  uma vez, e não cria nada. Imprime o diretório de saída como um caminho absoluto

**Opções:**

| Flag | Descrição |
|------|-------------|
| `--output, -o` | Diretório de saída para os arquivos de coleção gerados |
| `--schema` | O schema do Postgres a ler (padrão: `public`) |
| `--force, -f` | Sobrescreve os arquivos de coleção que já existem; sem ele, um arquivo existente é ignorado |

Isso é útil ao adotar a Rebase em um banco de dados existente — faça a introspecção primeiro, depois personalize as coleções geradas.

**Introspectar e depois fazer push não muda nada.** As propriedades geradas dizem exatamente o que cada coluna é — `columnType`, `precision`/`scale`, `defaultValue`, `required`, o `isId` de uma chave (`"increment"` para uma identity inteira, `columnType: "serial"` para uma serial, `"manual"` para uma chave sem default), o `onDelete` de uma relação — e o seu `index: false` onde o banco de dados não tem índice na coluna da chave, já que um `belongsTo` é [indexado por padrão](/docs/backend/indexes#foreign-keys-are-indexed-for-you) (apague a linha para que um seja construído) — e o bloco `search` de uma coleção lido de volta a partir da coluna que ele construiu — então `rebase db push --dry-run` logo depois de uma introspecção não planeja nenhuma mudança. Onde nenhuma propriedade consegue descrever uma coluna — um `timestamp` sem fuso horário, um `interval`, um `inet`, um tipo enum que não se chama `<table>_<column>`, um default como `CURRENT_DATE` — a introspecção avisa, por coluna, no terminal e no topo do arquivo, com o que um push faria com ela e, quando existir, a instrução que faz as duas coisas coincidirem (`ALTER TYPE "mood" RENAME TO "customers_current_mood";`). Uma tabela com chave composta por mais de uma coluna volta como uma chave composta, com o seu `isId` em cada coluna da chave. Ela é deixada de fora, com o motivo, quando uma coluna da chave não pode levar `isId` (um timestamp, por exemplo) ou a chave estrangeira de outra tabela aponta para ela, o que uma relação de uma só coluna não consegue fazer; o `db push` deixa em paz uma tabela que não é uma coleção. Na 0.23 o push logo depois de uma introspecção ainda pode planejar mudanças de tipo, defaults removidos e NOT NULLs, e uma chave `id` fantasma.

**Como são os arquivos gerados**

A introspecção escreve as coleções com `defineCollection`, que mantém as chaves das propriedades *literais* — de modo que `propertiesOrder`, `listProperties`, `sort` e `display.title` completam com os nomes das suas próprias colunas, e uma chave deixada para trás por uma coluna renomeada é um erro de compilação em vez de uma linha que silenciosamente não faz nada. Qual delas é importada depende do que o seu projeto declara como dependência, e é decidido a cada execução:

| Seu projeto declara | As coleções geradas usam | Bloco `admin` |
|------|------|------|
| `@rebasepro/cms-types` (um projeto com o painel) | `defineCollection` de `@rebasepro/cms-types` | sim |
| `@rebasepro/common` (um projeto `--headless`) | `defineCollection` de `@rebasepro/common` | não |
| nenhum dos dois | uma anotação `PostgresCollectionConfig`, com um aviso | não |

Um projeto headless não tem painel de administração, e os tipos do core não declaram nenhum campo `admin` — então o bloco não é emitido ali. Ele é apresentação (`icon`, `propertiesOrder`, `multiline`); nada no schema, na API ou nos seus dados depende dele.

### `rebase db push`

Envie as mudanças de esquema diretamente para o banco de dados sem arquivos de migração:

```bash
rebase db push
```

**O que ele faz:**
- Lê o esquema Drizzle gerado
- Aplica as mudanças diretamente ao banco de dados (CREATE, ALTER, DROP)
- Executa o plano primeiro em modo dry run e para antes de tudo o que destrói dados: uma tabela, coluna, schema, view ou tipo removidos, um `TRUNCATE`, uma mudança de tipo de coluna que pode perder valores (`timestamptz` → `date`, `numeric` → `integer`), ou uma mudança de chave primária: `(id)` → `(id, locale)` dá a cada linha um id novo, de modo que links, chaves estrangeiras e ids guardados em outros lugares deixam de encontrar sua linha. Pergunta em um terminal, onde Ctrl-C ou Ctrl-D responde não, e recusa caso contrário; `--allow-destructive` (ou `--yes`) aplica mesmo assim. Um push que para aí remove, ao sair, o seu banco de dados temporário `<db>_dev_diff`
- Ativa a segurança em nível de linha em todas as tabelas de coleção, incluindo as tabelas de junção, logo após a mudança de schema e antes de qualquer etapa que possa falhar, de modo que um push que para no meio deixa uma tabela nova negando todas as requisições em vez de aberta a elas
- Aplica as políticas RLS das suas coleções e **remove as políticas que um push anterior substituiu**
- <span class="since-badge" data-since="0.25">Desde 0.25</span> Constrói qualquer
  [índice de chave estrangeira que o Rebase deriva](/docs/backend/indexes#foreign-keys-are-indexed-for-you)
  e que uma tabela existente não tenha, **antes** de planejar, com
  `CREATE INDEX CONCURRENTLY`, para que as escritas na tabela continuem durante a construção;
  o Atlas então o encontra no lugar. `--dry-run` os nomeia e não constrói nada
- <span class="since-badge" data-since="0.25">Desde 0.25</span> Marca as
  políticas que aplica do mesmo modo que a inicialização do servidor, de modo que a primeira inicialização depois de um
  push as deixa em paz em vez de recriar cada uma
- <span class="since-badge" data-since="0.25">Desde 0.25</span> `--dry-run`
  não grava nada do projeto: `src/schema.generated.ts` é deixado como está,
  e as cópias `drizzle/*.sql` que uma versão mais antiga incluiu em um commit são nomeadas, não
  excluídas. Apenas a entrada do plano vai para `.rebase/sql/`, que não entra em um commit
- **Não** cria arquivos de migração

**Quanto tempo leva.** Quase todo o tempo de um push é o Atlas calculando o plano: ele
constrói o schema desejado em um banco de dados temporário e o compara com o
real, e esse custo cresce mais rápido que o número de tabelas — em um notebook sem carga,
cerca de 0,25 s por plano com 11 tabelas, 0,9 s com 111 e 5,5 s com 411. Um push que
não muda nada planeja uma vez; um que muda alguma coisa planeja duas vezes (o dry-run
que o gate de mudanças destrutivas lê, e depois a aplicação). Assim, um push em um schema de
400 ou mais tabelas leva dezenas de segundos, e mais em uma máquina ocupada ou lenta.
Esse tempo é do Atlas, não do seu banco de dados: as etapas ao redor — gerar o
SQL, o lock de RLS, busca, triggers, políticas, a role — levam alguns segundos nesse
tamanho, sobre uma conexão com o seu banco de dados.

**Os arquivos que ele gera no caminho**, todos em `.rebase/sql/` no diretório do backend. `db push` e `db generate` escrevem os cinco a partir das suas coleções a cada execução, antes de ler qualquer um deles, então nada leria uma cópia incluída em um commit. O diretório traz seu próprio `.gitignore` e nunca entra em um commit.

| Arquivo | Contém |
|------|-------|
| `schema.sql` | Tabelas, colunas, constraints e índices — o estado desejado do Atlas, e o único que ele compara |
| `policies.sql` | As políticas RLS em que suas `securityRules` são compiladas |
| `search.sql` | As funções de busca de texto completo e as colunas geradas, para coleções com um bloco `search` |
| `vector.sql` | Extensões pgvector e índices ANN |
| `triggers.sql` | `rebase.set_updated_at()` e os triggers `BEFORE UPDATE` por trás de `autoValue: "on_update"` |

O Atlas gerencia o primeiro e nada mais, então `db push` e o ajuste do schema na inicialização aplicam os outros quatro por conta própria. Um deploy **só com migrações** — um que executa `db migrate` e nunca `db push` — precisa incluir esses quatro em uma migração manualmente; `db generate` avisa quando uma mudança é invisível para o Atlas.

Um projeto que fez commit desses arquivos em `drizzle/` em uma versão anterior tem essas cópias removidas na primeira execução, e o comando cita cada uma para que você possa fazer commit da remoção. Ele remove apenas arquivos que começam com o cabeçalho do gerador. Um arquivo que você mesmo escreveu permanece, assim como `drizzle/migrations/`.

:::note[Editar uma regra de segurança renomeia sua política]
Uma regra sem um `name` explícito é compilada como `<table>_<op>_<hash>`, em que o hash cobre a semântica da regra — então *editar* uma regra (em vez de adicionar uma) produz uma política com um novo nome e deixa a antiga para trás.

Isso importava muito antes: o Postgres combina políticas `PERMISSIVE` com OR, então um `USING (rebase.uid() IS NOT NULL)` substituído continuava concedendo tudo, por mais restrita que fosse a sua substituta. Tornar uma regra mais restrita não tinha efeito, e o push informava sucesso.

Agora o `db push` reconcilia isso: remove as políticas geradas que não correspondem mais a nenhuma regra e informa — sem remover — qualquer política com nome personalizado que suas coleções não descrevem, já que ela não se distingue de SQL que alguém escreveu de propósito.

Para auditar um banco de dados que recebeu push antes dessa mudança, execute `rebase doctor --policies`. Funciona como um gate de CI: sai com código diferente de zero quando há drift, e também quando não conseguiu executar a verificação — sem `DATABASE_URL`, um caminho `--collections` que não se resolve, uma leitura de `pg_policies` não concedida ao papel de CI. Um gate que não conseguiu olhar não passou.

<span class="since-badge" data-since="0.25">Desde 0.25</span> O `doctor` e o `db push` distinguem os dois tipos de política órfã. Uma política com nome gerado foi substituída, e o próximo push a remove. Qualquer outro nome foi escrito à mão ou por outra ferramenta e ainda está em vigor: descreva-a nas `securityRules` da sua coleção para mantê-la (a visão de RLS do Studio a importa), ou remova-a à mão se estiver obsoleta. Na 0.24 ambas são "left behind by an earlier push".
:::

:::caution
`db push` modifica o banco de dados diretamente. Use-o apenas em desenvolvimento. Para produção, use `db generate` + `db migrate` para criar arquivos de migração revisáveis.
:::

### `rebase db generate`

Gere arquivos de migração SQL a partir das mudanças de esquema:

```bash
rebase db generate
```

**O que ele faz:**
- Compara o esquema Drizzle com o estado atual do banco de dados
- Produz arquivos de migração SQL com carimbo de data/hora em `drizzle/migrations/`
- Os arquivos podem ser revisados, editados e commitados no controle de versão
- <span class="since-badge" data-since="0.25">Desde 0.25</span> Nomeia cada instrução da nova migração que destrói dados, usando a verificação que o `db push` executa antes de aplicar: uma tabela, coluna, schema, view ou tipo removido, um `TRUNCATE`, uma mudança de tipo de coluna que pode perder valores, ou uma mudança de chave primária. Ele ainda escreve o arquivo e sai com 0, ou seja, avisa e não recusa.

As migrações geradas são arquivos SQL simples — você pode inspecioná-las e modificá-las antes de aplicá-las.

### `rebase db migrate`

Execute todas as migrações pendentes:

```bash
rebase db migrate
```

**O que ele faz:**
- Lê `drizzle/migrations/` em busca de migrações não aplicadas
- Aplica-as em ordem ao banco de dados
- Rastreia quais migrações foram aplicadas

<span class="since-badge" data-since="0.25">Desde 0.25</span> `--refuse-destructive`
faz com que ele recuse. Ele executa primeiro uma simulação (dry-run) das migrações pendentes. Se alguma
instrução destruir dados, pela mesma verificação que `db push` e `db generate` usam, ele lista essas
instruções e sai com 1. Não aplica nada, nem mesmo os arquivos anteriores a essa instrução. Sem a flag,
`db migrate` se comporta como antes e aplica todos os arquivos pendentes:

```bash
rebase db migrate --refuse-destructive
```

Uma migração que reconstrói uma coluna de busca a remove primeiro, então esta flag recusa essa
migração também. Leia a lista que ele imprime e depois execute `rebase db migrate`
sem a flag para aplicá-la.

#### Definir uma baseline num banco de dados que o Rebase já arrancou

Cada arranque do Rebase assegura o esquema, e `rebase db push` aplica-o diretamente. Um banco de dados em que qualquer um dos dois já tenha corrido já tem as tabelas e os tipos que a primeira migração criaria, e `rebase db migrate` para em `pq: type "posts_status" already exists (42710)`.

Não há nada de errado com a migração: o banco de dados foi provisionado por outra via. Registe onde ele já está e migre normalmente:

```bash
rebase db migrate --baseline 20260906101530
rebase db migrate
```

A versão é o prefixo numérico do ficheiro de migração que descreve o que está no banco de dados *agora*. Essa migração e todas as anteriores ficam registadas como aplicadas; tudo o que vem depois é executado. Num banco de dados que nunca arrancou não é precisa baseline — migre diretamente.

O mesmo acontece mais tarde no ciclo habitual: edite uma coleção enquanto o `rebase dev` corre, e o arranque adiciona a coluna antes de o `rebase db generate` escrever a migração que a adiciona, de modo que o `rebase db migrate` para em `column … already exists (42701)`. Registe essa migração como baseline do mesmo modo. <span class="since-badge" data-since="0.25">Desde 0.25</span> O `--baseline` funciona num banco de dados que já regista migrações: marca tudo até à versão como aplicado com `atlas migrate set` e informa isso, ou informa que não há nada a registar quando o histórico já a alcança. Na 0.24 o Atlas ignora o `--baseline` assim que qualquer migração está registada, pelo que o mesmo erro volta.

### `rebase db branch`

Ramificação de banco de dados para desenvolvimento paralelo:

```bash
rebase db branch create feature_auth
rebase db branch switch feature_auth
rebase db branch list
rebase db branch switch --off

rebase db branch info feature_auth
rebase db branch delete feature_auth
```

`rebase db branch switch` (e `switch --off`) e `rebase db branch prune` são novos.
`create`, `list`, `info` e `delete` foram lançados na 0.17.

Cada branch é uma cópia completa do banco de dados feita com `CREATE DATABASE ... TEMPLATE`,
portanto precisa de um servidor PostgreSQL real e custa o mesmo espaço em disco que a sua origem.

### `rebase doctor`

Detecte a divergência de três vias entre suas definições de coleções, o esquema Drizzle gerado e o banco de dados PostgreSQL ativo:

```bash
rebase doctor
```

**O que ele verifica:**
- Coleções ↔ Esquema gerado — estão sincronizados?
- Esquema gerado ↔ Banco de dados — há mudanças não aplicadas?
- Coleções ↔ Banco de dados — há alguma divergência inesperada?

Execute `doctor` sempre que algo parecer fora de sincronia. Ele aponta exatamente onde está a incompatibilidade.

A comparação com o banco de dados precisa de `DATABASE_URL` (ou `ADMIN_CONNECTION_STRING`). Sem uma delas, essa fase é reportada como **ignorada** (skipped) em vez de aprovada, e a execução nunca termina com "All schemas are in sync" — uma verificação que não aconteceu não é um atestado de saúde.

<span class="since-badge" data-since="0.25">Desde 0.25</span> Ele também nomeia toda coleção sem [bloco `search`](/docs/backend/search) cuja tabela tenha mais de cerca de 10.000 linhas. Uma busca ali — a caixa de busca do admin, `.search()`, `?searchString=` — é `ILIKE '%term%'` sobre as colunas de texto, que nenhum índice consegue atender, então cada uma lê a tabela inteira, e a sua contagem a lê de novo (cerca de um terço de segundo com 100.000 linhas, crescendo com a tabela). A contagem de linhas é a estimativa do próprio Postgres, então a verificação não varre nada. É uma dica: ela não muda o código de saída, e nada é indexado para você.

<span class="since-badge" data-since="0.25">Desde 0.25</span> Ele nomeia uma **junção órfã**: uma tabela `public` com a forma de uma junção many-to-many que nenhuma coleção declara. A forma são duas colunas que juntas formam a chave primária, cada uma uma chave estrangeira para a tabela de uma coleção. Renomear ou remover uma `manyToMany` deixa a junção antiga para trás, porque push e boot apenas criam tabelas, e todas as linhas de vínculo continuam nela. A nota é apenas informativa, então não altera o código de saída. A correção é a instrução `DROP TABLE`, que o `doctor` mostra e nunca executa.

### `rebase generate-sdk`

Gere um SDK tipado a partir das suas definições de coleções:

```bash
rebase generate-sdk
```

**O que ele faz:**
- Lê todo arquivo de coleção em `config/collections/` — os arquivos que o backend serve, listados ou não no barril `index.ts` — e para no primeiro que não carregar
- Gera tipos TypeScript para todas as entidades em `generated/sdk/`
- Produz um arquivo `database.types.ts` para uso com `createRebaseClient<Database>()`

O `rebase dev` executa isto para você ao iniciar e a cada salvamento em
`config/collections/`. Execute-o você mesmo no CI, em um repositório que não tem
coleções (veja `--from` abaixo), ou onde quer que o `rebase dev` não esteja em execução.

Na 0.23 o comando lê apenas os arquivos que o barril `index.ts` lista, pula um que
não carrega com um aviso, e toma o diretório como `--collections-dir`; e o `rebase dev`
só regenera o esquema, de modo que os tipos do SDK são seus para regenerar.

**Opções:**

| Flag | Descrição |
|------|-------------|
| `-c`, `--collections` | Diretório de coleções (padrão: `config/collections/`); caminhos relativos são resolvidos a partir de onde você executa o comando. `--collections-dir` também é aceito. |
| `-o`, `--output` | Diretório de saída para o SDK (padrão: `generated/sdk/`) |
| `--from <link\|url>` | Lê o esquema de um projeto em execução em vez do código local. `link` usa o projeto vinculado a este checkout. |
| `--token` | Token Bearer para o endpoint de contrato (padrão: `$REBASE_SERVICE_KEY` do shell; o `.env` não é lido) |

`--from` é o que permite que um repositório sem coleções — um frontend separado, uma segunda aplicação web, uma aplicação móvel — gere um cliente tipado a partir do projeto com que fala. `REBASE_SERVICE_KEY` só é enviado ao projeto vinculado a este checkout; para qualquer outro host, passe `--token` explicitamente. A chave no `.env` pertence ao seu
backend local e nunca é enviada.
<span class="since-badge" data-since="0.25">Desde 0.25</span> Uma recusa diz qual
destes casos aconteceu: um `--token` recusado, uma chave do shell recusada, uma chave
retida de um host que não está vinculado, uma chave apenas no `.env`, ou nenhuma chave.
Na 0.24 ela sempre diz para passar `--token` ou definir `REBASE_SERVICE_KEY`.

**Uso após a geração:**

```typescript
import { createRebaseClient } from "@rebasepro/client";
import { collectionsDictionary, type Database } from "./generated/sdk/database.types";

const client = createRebaseClient<Database>({
    baseUrl: import.meta.env.VITE_API_URL,
    collections: collectionsDictionary,
});

// Full type safety and autocomplete
const { data } = await client.data.products.find();
```

Os nomes dos campos nos tipos gerados são os que a API serve. O nome de um campo na rede é a chave da sua propriedade, e a API é camelCase por inteiro: a introspecção gera uma coluna `created_at` como uma propriedade `createdAt` que carrega `columnName: "created_at"`, e a serve como `row.createdAt`. A coluna em si não é alterada. O *accessor* da coleção é convertido num nome de propriedade da mesma forma (`my-notes` → `client.data.myNotes`), que é o que `collectionsDictionary` mapeia de volta para o slug.

## Fluxo de Trabalho de Desenvolvimento

O fluxo de trabalho de iteração rápida para desenvolvimento:

```bash
# 1. Edit your collection in config/collections/
# 2. Generate the Drizzle schema
rebase schema generate

# 3. Push directly to dev database
rebase db push
```

## Fluxo de Trabalho de Produção

O fluxo de trabalho seguro e revisável para produção:

```bash
# 1. Edit your collection in config/collections/
# 2. Generate the Drizzle schema
rebase schema generate

# 3. Generate SQL migration files
rebase db generate

# 4. Review the generated SQL in drizzle/migrations/
# 5. Commit the migration to version control
git add drizzle/migrations/

# 6. Apply in production
#    A database Rebase has already booted needs a baseline the first time —
#    see "Baselining a database Rebase has already booted" above.
rebase db migrate
```

## Solução de Problemas

| Sintoma | Solução |
|---------|----------|
| `Could not detect an active database plugin` | Instale `@rebasepro/server-postgres` em `backend/package.json` |
| O arquivo de esquema não atualiza | Verifique se o caminho `--collections` aponta para o diretório correto |
| A migração mostra mudanças inesperadas | Execute `rebase doctor` para identificar a divergência |
| `db push` falha em produção | Use `db generate` + `db migrate` em vez disso |
| Uma migração não pode destruir dados em CI ou produção | <span class="since-badge" data-since="0.25">Desde 0.25</span> `rebase db migrate --refuse-destructive` sai com 1 e não aplica nada quando uma instrução pendente destrói dados |
| `db migrate` falha com `already exists (42710)` | O arranque ou `db push` já provisionaram o esquema — registe-o com `rebase db migrate --baseline <version>` |
| `db migrate` falha com `column … already exists (42701)` | O `rebase dev` adicionou a coluna no arranque — registe essa migração como baseline do mesmo modo |
| `db push` no banco de dados gerenciado falha com `Error: EOF` | O Atlas perdeu uma conexão que o `rebase dev` em execução mantém. Execute-o de novo; se continuar falhando, pare primeiro o `rebase dev` |

## Próximos Passos

- **[Coleções](/docs/collections)** — Defina seu modelo de dados
- **[Referência da CLI](/docs/cli)** — Todos os comandos da CLI
- **[SDK tipado](/docs/sdk)** — Use o SDK gerado
