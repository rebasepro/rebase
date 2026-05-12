---
title: Branching del Database
sidebar_label: Branching
slug: it/docs/backend/branching
description: Crea branch di database isolati per sviluppo, staging e testing utilizzando CREATE DATABASE ... TEMPLATE di PostgreSQL — copie istantanee, a piena fedeltà e senza tempi di inattività.
---

## Overview

Il branching del database ti permette di creare **copie istantanee e isolate** del tuo intero database — schema e dati — per sviluppo, staging o testing. Ogni branch è un vero database PostgreSQL creato da un template, quindi è una copia a piena fedeltà senza tempi di inattività.

Questo è simile al branching di Git, ma per il tuo database. Crea un branch, sperimenta con migrazioni o dati, e cancellalo quando hai finito. Il tuo database di produzione non viene mai toccato.

## How It Works

Rebase utilizza `CREATE DATABASE ... TEMPLATE` nativo di PostgreSQL per creare i branch. Questo è:

- **Istantaneo** — PostgreSQL copia il template a livello di filesystem
- **A piena fedeltà** — schema, dati, indici, vincoli, policy RLS — tutto viene copiato
- **Isolato** — le modifiche nel branch non influenzano il database sorgente

I metadati del branch sono memorizzati in una tabella `rebase.branches` nel database principale, così il sistema sa sempre quali branch esistono e da dove provengono.

## API

L'API di branching è disponibile tramite l'interfaccia `DatabaseAdmin` del backend:

### Create a Branch

```typescript
// Create a branch from the default database
await admin.createBranch("feature_auth");

// Create a branch from a specific source database
await admin.createBranch("staging", { source: "production" });
```

Questo crea un nuovo database PostgreSQL chiamato `rb_feature_auth` (prefissato per evitare collisioni) e lo registra nella tabella dei metadati.

### List Branches

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

### Get Branch Info

```typescript
const branch = await admin.getBranchInfo("feature_auth");
// { name: "feature_auth", parentDatabase: "rebase", createdAt: ..., sizeBytes: ... }
```

### Delete a Branch

```typescript
await admin.deleteBranch("feature_auth");
```

Questo elimina il database PostgreSQL e rimuove i metadati. Il database principale non può mai essere eliminato.

## Configuration

Il branching del database richiede che `adminConnectionString` sia configurato nel tuo bootstrapper PostgreSQL, poiché la creazione e l'eliminazione di database necessitano di privilegi elevati:

```typescript
createPostgresBootstrapper({
    connection: db,
    schema: { tables, enums, relations },
    adminConnectionString: process.env.ADMIN_CONNECTION_STRING || databaseUrl,
    connectionString
})
```

Il `DatabasePoolManager` gestisce automaticamente il connection pooling per i database dei branch. Quando passi a un branch, il pool manager crea un nuovo pool di connessioni mirato a quel database.

## Branch Naming

I nomi dei branch vengono normalizzati per consentire solo caratteri alfanumerici e underscore. Il nome effettivo del database PostgreSQL è prefissato con `rb_` per evitare collisioni:

| Branch name | Database name |
|---|---|
| `feature_auth` | `rb_feature_auth` |
| `staging` | `rb_staging` |
| `v2_migration` | `rb_v2_migration` |

## Use Cases

### Preview Environments

Crea un branch per ogni pull request o deploy di anteprima. Il branch ottiene una copia completa dei dati di produzione, così i revisori possono testare con dati reali.

### Migration Testing

Prima di eseguire una migrazione in produzione, crea un branch ed esegui la migrazione lì per primo. Se qualcosa va storto, semplicemente elimina il branch.

### Data Experiments

Hai bisogno di testare una trasformazione di dati? Crea un branch, esegui il tuo script e verifica i risultati senza toccare la produzione.

## Limitations

- **Connessioni attive** — PostgreSQL richiede che tutte le connessioni al database sorgente siano chiuse prima di creare un template. Il servizio di branching disconnette automaticamente i pool inattivi, ma altri client (es. pgAdmin) devono essere disconnessi manualmente.
- **Spazio su disco** — ogni branch è una copia completa del database. Monitora l'utilizzo del disco quando crei molti branch.
- **Query tra database** — i branch sono database PostgreSQL separati. Non puoi JOINare tra un branch e il database principale.

## Next Steps

- **[Panoramica del Backend](/docs/backend)** — Riferimento completo alla configurazione del backend
- **[CLI](/docs/cli)** — Gestisci i branch dalla riga di comando
- **[Cronologia delle Entità](/docs/backend/history)** — Traccia le modifiche all'interno di un branch
---
