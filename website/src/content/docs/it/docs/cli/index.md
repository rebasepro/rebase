---
title: Riferimento CLI
sidebar_label: CLI
description: Comandi Rebase CLI per l'inizializzazione del progetto, la generazione dello schema, le migrazioni del database e la generazione dell'SDK.
---

## Overview

La CLI Rebase (`rebase`) gestisce il tuo progetto dallo scaffolding al deployment.

## Installation

```bash
pnpm add -g @rebasepro/cli
```

Oppure usa tramite `pnpm dlx`:

```bash
pnpm dlx @rebasepro/cli <command>
```

## Commands

### `rebase init`

Inizializza un nuovo progetto Rebase:

```bash
rebase init [directory]
```

Imposta la struttura del progetto con pacchetti frontend, backend e condivisi.

### `rebase dev`

Avvia il server di sviluppo:

```bash
rebase dev
```

Avvia sia il frontend che il backend con hot reloading.

### `rebase schema generate`

Genera lo schema Drizzle ORM dalle tue collezioni TypeScript:

```bash
rebase schema generate
```

Questo legge le tue collezioni da `config/collections/` e genera `backend/src/schema.generated.ts` con definizioni di tabelle Drizzle, enum e relazioni.

### `rebase db push`

Applica le modifiche dello schema direttamente al database (solo per sviluppo):

```bash
rebase db push
```

:::caution
`db push` modifica il database direttamente senza file di migrazione. Usa `db generate` + `db migrate` per la produzione.
:::

### `rebase db generate`

Genera file di migrazione SQL dalle modifiche dello schema:

```bash
rebase db generate
```

Crea file di migrazione con timestamp in `drizzle/` che possono essere revisionati e committati.

### `rebase db migrate`

Esegui le migrazioni del database in sospeso:

```bash
rebase db migrate
```

Applica tutte le migrazioni non ancora applicate al database.

### `rebase generate-sdk`

Genera un SDK client tipizzato dalle tue definizioni di collezione:

```bash
rebase generate-sdk
```

Crea tipi TypeScript e un client type-safe per tutte le tue collezioni.

### `rebase doctor`

Esegui la diagnostica per rilevare disallineamenti (drift) tra le tue collezioni, lo schema generato e lo stato attuale del database:

```bash
rebase doctor
```

### `rebase auth`

Comandi di gestione dell'autenticazione:

```bash
rebase auth reset-password --email admin@example.com --password NewPassword123!
```

## Migration Workflow

Il workflow tipico per le modifiche allo schema:

```bash
# 1. Modifica la tua collezione in config/collections/
# 2. Genera lo schema Drizzle
rebase schema generate

# 3. Genera la migrazione SQL
rebase db generate

# 4. Revisiona il SQL generato in drizzle/

# 5. Applica la migrazione
rebase db migrate
```

## Prossimi Passi

- **[Schema come Codice](/docs/architecture/schema-as-code)** — Come funziona la generazione dello schema
- **[Guida Rapida](/docs/getting-started/quickstart)** — Inizia qui

---
