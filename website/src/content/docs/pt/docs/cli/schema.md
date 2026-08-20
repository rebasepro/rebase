---
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
| `--collections, -c` | Caminho para o diretório de coleções (padrão: `config/collections/`) |
| `--output, -o` | Caminho de saída para o arquivo de esquema gerado |
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

### `rebase db push`

Envie as mudanças de esquema diretamente para o banco de dados sem arquivos de migração:

```bash
rebase db push
```

**O que ele faz:**
- Lê o esquema Drizzle gerado
- Aplica as mudanças diretamente ao banco de dados (CREATE, ALTER, DROP)
- **Não** cria arquivos de migração

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
- Produz arquivos de migração SQL com carimbo de data/hora no diretório `drizzle/`
- Os arquivos podem ser revisados, editados e commitados no controle de versão

As migrações geradas são arquivos SQL simples — você pode inspecioná-las e modificá-las antes de aplicá-las.

### `rebase db migrate`

Execute todas as migrações pendentes:

```bash
rebase db migrate
```

**O que ele faz:**
- Lê o diretório `drizzle/` em busca de migrações não aplicadas
- Aplica-as em ordem ao banco de dados
- Rastreia quais migrações foram aplicadas

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

Gere um SDK cliente tipado a partir das suas definições de coleções:

```bash
rebase generate-sdk
```

**O que ele faz:**
- Lê as coleções de `config/collections/` (suporta exports de barril `index.ts` ou arquivos individuais)
- Gera tipos TypeScript para todas as entidades em `generated/sdk/`
- Produz um arquivo `database.types.ts` para uso com `createRebaseClient<Database>()`

**Opções:**

| Flag | Descrição |
|------|-------------|
| `-c`, `--collections-dir` | Caminho para o diretório de coleções (padrão: `config/collections/`) |
| `-o`, `--output` | Diretório de saída para o SDK (padrão: `generated/sdk/`) |
| `--from <link\|url>` | Lê o esquema de um projeto em execução em vez do código local. `link` usa o projeto vinculado a este checkout. |
| `--token` | Token Bearer para o endpoint de contrato (padrão: `$REBASE_SERVICE_KEY`) |

`--from` é o que permite que um repositório sem coleções — um frontend separado, uma segunda aplicação web, uma aplicação móvel — gere um cliente tipado a partir do projeto com que fala. `REBASE_SERVICE_KEY` só é enviado ao projeto vinculado a este checkout; para qualquer outro host, passe `--token` explicitamente.

**Uso após a geração:**

```typescript
import { createRebaseClient } from "@rebasepro/client";
import { collectionsDictionary, type Database } from "./generated/sdk/database.types";

const client = createRebaseClient<Database>({
    baseUrl: "http://localhost:3001",
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

# 4. Review the generated SQL in drizzle/
# 5. Commit the migration to version control
git add drizzle/

# 6. Apply in production
rebase db migrate
```

## Solução de Problemas

| Sintoma | Solução |
|---------|----------|
| `Could not detect an active database plugin` | Instale `@rebasepro/server-postgres` em `backend/package.json` |
| O arquivo de esquema não atualiza | Verifique se o caminho `--collections` aponta para o diretório correto |
| A migração mostra mudanças inesperadas | Execute `rebase doctor` para identificar a divergência |
| `db push` falha em produção | Use `db generate` + `db migrate` em vez disso |

## Próximos Passos

- **[Coleções](/docs/collections)** — Defina seu modelo de dados
- **[Referência da CLI](/docs/cli)** — Todos os comandos da CLI
- **[SDK Cliente](/docs/sdk)** — Use o SDK gerado
