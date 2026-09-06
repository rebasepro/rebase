---
sourceHash: 4e3fb1836c39f60c
title: Referência da CLI
sidebar_label: CLI
description: Comandos da CLI Rebase para inicialização de projeto, geração de esquema, migrações de banco de dados e geração de SDK.
---

## Visão Geral

A CLI Rebase (`rebase`) gerencia seu projeto desde a estruturação inicial até a implantação.

## Instalação

```bash
pnpm add -g @rebasepro/cli
```

Ou use via `pnpm dlx`:

```bash
pnpm dlx @rebasepro/cli <command>
```

## Comandos

### `rebase init`

Inicialize um novo projeto Rebase:

```bash
rebase init [directory]
```

Configura a estrutura do projeto com pacotes de frontend, backend e compartilhados.

### `rebase dev`

Inicie o servidor de desenvolvimento:

```bash
rebase dev
```

Inicia tanto o frontend quanto o backend com recarregamento a quente (hot reloading).

### `rebase schema generate`

Gere o esquema Drizzle ORM a partir de suas coleções TypeScript:

```bash
rebase schema generate
```

Isso lê suas coleções de `config/collections/` e gera `backend/src/schema.generated.ts` com definições de tabelas Drizzle, enums e relações.

### `rebase db push`

Envie alterações de esquema diretamente para o banco de dados (somente desenvolvimento):

```bash
rebase db push
```

:::caution
`db push` modifica o banco de dados diretamente sem arquivos de migração. Use `db generate` + `db migrate` para produção.
:::

### `rebase db generate`

Gere arquivos de migração SQL a partir de alterações de esquema:

```bash
rebase db generate
```

Cria arquivos de migração com carimbo de data/hora em `drizzle/` que podem ser revisados e confirmados.

### `rebase db migrate`

Execute migrações de banco de dados pendentes:

```bash
rebase db migrate
```

Aplica todas as migrações não aplicadas ao banco de dados.

### `rebase generate-sdk`

Gere um SDK de cliente tipado a partir das definições de suas coleções:

```bash
rebase generate-sdk
```

Cria tipos TypeScript e um cliente com segurança de tipo para todas as suas coleções.

### `rebase doctor`

Execute diagnósticos para detectar desvios (drift) entre suas coleções, o esquema gerado e o estado atual do banco de dados:

```bash
rebase doctor
```

### `rebase auth`

Comandos de gerenciamento de autenticação:

```bash
rebase auth reset-password --email admin@example.com --password NewPassword123!
```

## Fluxo de Trabalho de Migração

O fluxo de trabalho típico para alterações de esquema:

```bash
# 1. Edit your collection in config/collections/
# 2. Generate the Drizzle schema
rebase schema generate

# 3. Generate SQL migration
rebase db generate

# 4. Review the generated SQL in drizzle/

# 5. Apply the migration
rebase db migrate
```

## Próximos Passos

-   **[Schema as Code](/docs/architecture/schema-as-code)** — Como funciona a geração de esquema
-   **[Quickstart](/docs/getting-started/quickstart)** — Comece aqui
---
