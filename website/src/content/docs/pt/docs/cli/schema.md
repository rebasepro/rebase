---
sourceHash: 80785b5fbb8f2d05
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

### `rebase schema introspect`

Faça engenharia reversa das definições de coleções a partir de um banco de dados PostgreSQL existente:

```bash
rebase schema introspect
```

**O que ele faz:**
- Conecta-se ao seu banco de dados (usando a string de conexão do seu `.env`)
- Inspeciona todas as tabelas, colunas, tipos e chaves estrangeiras
- Gera arquivos de definição de coleções

**Opções:**

| Flag | Descrição |
|------|-------------|
| `--output, -o` | Diretório de saída para os arquivos de coleção gerados |

Isso é útil ao adotar a Rebase em um banco de dados existente — faça a introspecção primeiro, depois personalize as coleções geradas.

<span class="since-badge" data-since="0.24">Since 0.24</span> **Introspectar e depois fazer push não muda nada.** As propriedades geradas dizem exatamente o que cada coluna é — `columnType`, `precision`/`scale`, `defaultValue`, `required`, o `isId` de uma chave (`"increment"` para uma identity inteira, `columnType: "serial"` para uma serial, `"manual"` para uma chave sem default), o `onDelete` de uma relação, e o bloco `search` de uma coleção lido de volta a partir da coluna que ele construiu — então `rebase db push --dry-run` logo depois de uma introspecção não planeja nenhuma mudança. Onde nenhuma propriedade consegue descrever uma coluna — um `timestamp` sem fuso horário, um `interval`, um `inet`, um tipo enum que não se chama `<table>_<column>`, um default como `CURRENT_DATE` — a introspecção avisa, por coluna, no terminal e no topo do arquivo, com o que um push faria com ela e, quando existir, a instrução que faz as duas coisas coincidirem (`ALTER TYPE "mood" RENAME TO "customers_current_mood";`). Uma tabela com chave composta por mais de uma coluna é deixada de fora com o motivo: uma coleção lê uma linha por uma única coluna de chave, e o `db push` deixa em paz uma tabela que não é uma coleção. Na 0.23 o push logo depois de uma introspecção ainda pode planejar mudanças de tipo, defaults removidos e NOT NULLs, e uma chave `id` fantasma.

### `rebase db push`

Envie as mudanças de esquema diretamente para o banco de dados sem arquivos de migração:

```bash
rebase db push
```

**O que ele faz:**
- Lê o esquema Drizzle gerado
- Aplica as mudanças diretamente ao banco de dados (CREATE, ALTER, DROP)
- Executa o plano primeiro em modo dry run e para antes de tudo o que destrói dados: uma tabela, coluna, schema, view ou tipo removidos, um `TRUNCATE`, ou uma mudança de tipo de coluna que pode perder valores (`timestamptz` → `date`, `numeric` → `integer`). Pergunta em um terminal e recusa caso contrário; `--allow-destructive` (ou `--yes`) aplica mesmo assim
- Aplica as políticas RLS das suas coleções e **remove as políticas que um push anterior substituiu**
- **Não** cria arquivos de migração

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

#### Definir uma baseline num banco de dados que o Rebase já arrancou

Cada arranque do Rebase assegura o esquema, e `rebase db push` aplica-o diretamente. Um banco de dados em que qualquer um dos dois já tenha corrido já tem as tabelas e os tipos que a primeira migração criaria, e `rebase db migrate` para em `pq: type "posts_status" already exists (42710)`.

Não há nada de errado com a migração: o banco de dados foi provisionado por outra via. Registe onde ele já está e migre normalmente:

```bash
rebase db migrate --baseline 20260906101530
rebase db migrate
```

A versão é o prefixo numérico do ficheiro de migração que descreve o que está no banco de dados *agora*. Essa migração e todas as anteriores ficam registadas como aplicadas; tudo o que vem depois é executado. Num banco de dados que nunca arrancou não é precisa baseline — migre diretamente.

### `rebase db branch`

Ramificação de banco de dados para desenvolvimento paralelo:

```bash
rebase db branch create feature_auth
rebase db branch list
rebase db branch delete feature_auth
```

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

<span class="since-badge" data-since="0.24">Since 0.24</span> para ler todo arquivo, parando no primeiro que estiver quebrado, para o `rebase dev` executá-lo
e para o `--collections` neste comando. Na 0.23 ele lê os arquivos que o barril `index.ts`
lista, pula um que não carrega com um aviso, e toma o
diretório como `--collections-dir`; o `rebase dev` só regenera o esquema.

**Opções:**

| Flag | Descrição |
|------|-------------|
| `-c`, `--collections` | Diretório de coleções (padrão: `config/collections/`); caminhos relativos são resolvidos a partir de onde você executa o comando. `--collections-dir` também é aceito. |
| `-o`, `--output` | Diretório de saída para o SDK (padrão: `generated/sdk/`) |
| `--from <link\|url>` | Lê o esquema de um projeto em execução em vez do código local. `link` usa o projeto vinculado a este checkout. |
| `--token` | Token Bearer para o endpoint de contrato (padrão: `$REBASE_SERVICE_KEY`) |

`--from` é o que permite que um repositório sem coleções — um frontend separado, uma segunda aplicação web, uma aplicação móvel — gere um cliente tipado a partir do projeto com que fala. `REBASE_SERVICE_KEY` só é enviado ao projeto vinculado a este checkout; para qualquer outro host, passe `--token` explicitamente.

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

Os nomes dos campos nos tipos gerados são os que a API serve, inalterados: uma coluna `createdAt` é `row.createdAt`. Apenas o *accessor* da coleção é convertido num nome de propriedade (`my-notes` → `client.data.myNotes`), que é o que `collectionsDictionary` mapeia de volta para o slug.

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
#    see the baselining section above.
rebase db migrate
```

## Solução de Problemas

| Sintoma | Solução |
|---------|----------|
| `Could not detect an active database plugin` | Instale `@rebasepro/server-postgres` em `backend/package.json` |
| O arquivo de esquema não atualiza | Verifique se o caminho `--collections` aponta para o diretório correto |
| A migração mostra mudanças inesperadas | Execute `rebase doctor` para identificar a divergência |
| `db push` falha em produção | Use `db generate` + `db migrate` em vez disso |
| `db migrate` falha com `already exists (42710)` | O arranque ou `db push` já provisionaram o esquema — registe-o com `rebase db migrate --baseline <version>` |

## Próximos Passos

- **[Coleções](/docs/collections)** — Defina seu modelo de dados
- **[Referência da CLI](/docs/cli)** — Todos os comandos da CLI
- **[SDK tipado](/docs/sdk)** — Use o SDK gerado
