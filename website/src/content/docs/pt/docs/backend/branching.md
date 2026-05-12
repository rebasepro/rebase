---
title: Ramificação de Banco de Dados
sidebar_label: Ramificação
slug: pt/docs/backend/branching
description: Crie ramificações de banco de dados isoladas para desenvolvimento, staging e teste usando CREATE DATABASE ... TEMPLATE do PostgreSQL — cópias instantâneas e de fidelidade total com zero tempo de inatividade.
---

## Visão Geral

A ramificação de banco de dados permite criar **cópias instantâneas e isoladas** de todo o seu banco de dados — esquema e dados — para desenvolvimento, staging ou teste. Cada ramificação é um banco de dados PostgreSQL real criado a partir de um template, sendo assim uma cópia de fidelidade total com zero tempo de inatividade.

Isso é semelhante à ramificação do git, mas para o seu banco de dados. Crie uma ramificação, experimente migrações ou dados e exclua-a quando terminar. Seu banco de dados de produção nunca é afetado.

## Como Funciona

O Rebase usa o `CREATE DATABASE ... TEMPLATE` nativo do PostgreSQL para criar ramificações. Isso é:

-   **Instantâneo** — O PostgreSQL copia o template no nível do sistema de arquivos
-   **Fidelidade total** — esquema, dados, índices, restrições, políticas RLS — tudo é copiado
-   **Isolado** — as alterações na ramificação não afetam o banco de dados de origem

Os metadados da ramificação são armazenados em uma tabela `rebase.branches` no banco de dados principal, para que o sistema sempre saiba quais ramificações existem e de onde vieram.

## API

A API de ramificação está disponível através da interface `DatabaseAdmin` do backend:

### Criar uma Ramificação

```typescript
// Create a branch from the default database
await admin.createBranch("feature_auth");

// Create a branch from a specific source database
await admin.createBranch("staging", { source: "production" });
```

Isso cria um novo banco de dados PostgreSQL chamado `rb_feature_auth` (prefixado para evitar colisões) e o registra na tabela de metadados.

### Listar Ramificações

```typescript
const branches = await admin.listBranches();
// [
//   {
//     name: "feature_auth",
//     parentDatabase: "rebase",
//     createdAt: "2026-04-15T10:30:00Z",
//     sizeBytes: 52428800
//   }
// ]
```

### Obter Informações da Ramificação

```typescript
const branch = await admin.getBranchInfo("feature_auth");
// { name: "feature_auth", parentDatabase: "rebase", createdAt: ..., sizeBytes: ... }
```

### Excluir uma Ramificação

```typescript
await admin.deleteBranch("feature_auth");
```

Isso descarta o banco de dados PostgreSQL e remove os metadados. O banco de dados principal nunca pode ser excluído.

## Configuração

A ramificação de banco de dados requer que o `adminConnectionString` seja configurado no seu inicializador PostgreSQL, já que a criação e exclusão de bancos de dados exigem privilégios elevados:

```typescript
createPostgresBootstrapper({
    connection: db,
    schema: { tables, enums, relations },
    adminConnectionString: process.env.ADMIN_CONNECTION_STRING || databaseUrl,
    connectionString
})
```

O `DatabasePoolManager` gerencia automaticamente o pool de conexões para bancos de dados de ramificação. Ao alternar para uma ramificação, o gerenciador de pool cria um novo pool de conexões direcionado a esse banco de dados.

## Nomenclatura das Ramificações

Os nomes das ramificações são higienizados para permitir apenas caracteres alfanuméricos e underscores. O nome real do banco de dados PostgreSQL é prefixado com `rb_` para evitar colisões:

| Nome da ramificação | Nome do banco de dados |
|---|---|
| `feature_auth` | `rb_feature_auth` |
| `staging` | `rb_staging` |
| `v2_migration` | `rb_v2_migration` |

## Casos de Uso

### Ambientes de Pré-visualização

Crie uma ramificação para cada pull request ou implantação de pré-visualização. A ramificação obtém uma cópia completa dos dados de produção, para que os revisores possam testar com dados reais.

### Teste de Migração

Antes de executar uma migração em produção, crie uma ramificação e execute a migração nela primeiro. Se algo der errado, basta excluir a ramificação.

### Experimentos de Dados

Precisa testar uma transformação de dados? Crie uma ramificação, execute seu script e verifique os resultados sem afetar a produção.

## Limitações

-   **Conexões ativas** — O PostgreSQL exige que todas as conexões com o banco de dados de origem sejam fechadas antes de criar um template. O serviço de ramificação desconecta automaticamente os pools ociosos, mas outros clientes (por exemplo, pgAdmin) devem ser desconectados manualmente.
-   **Espaço em disco** — cada ramificação é uma cópia completa do banco de dados. Monitore o uso do disco ao criar muitas ramificações.
-   **Consultas entre bancos de dados** — as ramificações são bancos de dados PostgreSQL separados. Você não pode fazer JOIN entre uma ramificação e o banco de dados principal.

## Próximos Passos

-   **[Visão Geral do Backend](/docs/backend)** — Referência completa de configuração do backend
-   **[CLI](/docs/cli)** — Gerencie ramificações pela linha de comando
-   **[Histórico de Entidades](/docs/backend/history)** — Acompanhe as alterações dentro de uma ramificação
---
