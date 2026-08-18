---
title: Avvio Rapido
sidebar_label: Avvio Rapido
description: Crea un nuovo progetto Rebase e avvialo localmente in meno di 2 minuti.
---

## Crea un Nuovo Progetto

```bash
pnpm dlx @rebasepro/cli init my-app
```

Questo crea la struttura di un progetto con tre pacchetti:

| Cartella | Descrizione |
|--------|-------------|
| `frontend/` | SPA React — Vite + TypeScript con l'interfaccia utente di amministrazione Rebase |
| `backend/` | Server Node.js — Hono, PostgreSQL tramite Drizzle ORM, WebSocket |
| `config/` | Definizioni di collezioni TypeScript condivise da entrambi i lati |

## Prerequisiti

- **Node.js** 18+
- **Docker** — per eseguire il container PostgreSQL incluso. (Oppure usa il tuo PostgreSQL: installazione locale, Neon, Supabase, ecc.)
- **pnpm** (consigliato) o npm

## Il tuo Ambiente è Già Configurato

`init` genera un file `.env` pronto all'uso nella root del progetto, con un vero `JWT_SECRET`, una password del database e una porta locale libera per il database. Non devi creare o modificare nulla per iniziare.

:::caution
Non eseguire `cp .env.example .env`. `.env.example` è un riferimento per le variabili disponibili — copiarlo sopra il tuo `.env` scarta i segreti generati e fa puntare `DATABASE_URL` a un database che non esiste. Modifica direttamente `.env` se vuoi cambiare un valore.
:::

Se preferisci puntare al tuo PostgreSQL invece del container incluso, modifica `DATABASE_URL` in `.env`:

```bash
DATABASE_URL=postgresql://username:password@localhost:5432/your_database
```

## Avvia il Database

La struttura generata include un `docker-compose.yml` con un servizio PostgreSQL. Avvialo:

```bash
docker compose up -d db
```

(Salta questo passaggio se hai fatto puntare `DATABASE_URL` al tuo database.)

## Crea le Tabelle

Invia le tue collezioni al database. Questo crea le tabelle per le collezioni di esempio `posts`, `authors` e `tags`:

```bash
pnpm run db:push
```

Senza questo passaggio il pannello di amministrazione si apre comunque, ma ogni collezione è vuota e le sue chiamate API falliscono finché le tabelle non esistono.

## Introspezione di un Database Esistente (Opzionale)

Se ti stai connettendo a un database esistente con tabelle già presenti, puoi eseguirne l'introspezione per generare automaticamente i tuoi file di collezione TypeScript:

```bash
pnpm rebase schema introspect
```

Questo analizzerà le tabelle del tuo database e genererà i file TypeScript corrispondenti in `config/collections/`, così non dovrai scriverli manualmente.

## Avvia i Server di Sviluppo

```bash
pnpm dev
```

Questo avvia entrambi insieme:
- **Backend** — API REST, autenticazione, storage, WebSocket
- **Frontend** — il pannello di amministrazione Rebase
- **Hot reload** per entrambi — le modifiche hanno effetto istantaneamente

Entrambe le porte sono **derivate dal percorso del progetto** anziché fisse, così più
progetti Rebase possono essere eseguiti insieme. `rebase dev` stampa i due URL a cui
si è associato — usa quelli, non `localhost:3001`/`localhost:5173`. (`PORT` e
`VITE_API_URL` in `.env` configurano `rebase start`, il server di produzione, e qui
vengono ignorati.) Fissa una porta con `rebase dev --port 3001`.

## Primo Accesso

Quando apri l'URL del frontend stampato da `rebase dev`, vedrai la schermata di accesso. Il **primo utente** a registrarsi diventa automaticamente un amministratore — questo è il flusso di bootstrap.

1. Clicca su **Registrati**
2. Inserisci la tua email e password
3. Sei dentro — con accesso amministrativo completo

## Definisci la Tua Prima Collezione

Apri `config/collections/` e crea un nuovo file. Esporta la collezione come **export di default** — è così che il registry la rileva:

```typescript title="config/collections/products.ts"
import { defineCollection } from "@rebasepro/admin-types";

const productsCollection = defineCollection({
    slug: "products",
    name: "Products",
    singularName: "Product",
    table: "products",
    properties: {
        name: {
            type: "string",
            name: "Name",
            validation: { required: true }
        },
        price: {
            type: "number",
            name: "Price",
            validation: { required: true, min: 0 }
        },
        description: {
            type: "string",
            name: "Description",
            admin: { multiline: true }
        },
        active: {
            type: "boolean",
            name: "Active",
            defaultValue: true
        },
        createdAt: {
            type: "date",
            name: "Created At",
            autoValue: "on_create"
        }
    }
});

export default productsCollection;
```

Poi registrala in `config/collections/index.ts` così che sia il backend sia il pannello di amministrazione la conoscano:

```typescript title="config/collections/index.ts" {2,5}
// ...import esistenti
import productsCollection from "./products.js";

export const collections = [
    postsCollection, authorsCollection, tagsCollection, usersCollection, productsCollection
];
```

## Crea la Tabella

Invia la nuova collezione al database:

```bash
pnpm run db:push
```

Questo rigenera lo schema dalle tue collezioni e lo applica. Riavvia i server di sviluppo e la tua nuova collezione **Products** apparirà nella navigazione.

## Riferimento ai Comandi del Database

| Comando | Descrizione |
|---------|-------------|
| `rebase schema generate` | Genera lo schema Drizzle dalle tue collezioni TypeScript |
| `rebase schema introspect` | Genera collezioni TypeScript da un database esistente |
| `rebase db push` | Invia le modifiche allo schema direttamente al database (solo dev) |
| `rebase db generate` | Genera i file di migrazione SQL |
| `rebase db migrate` | Esegui le migrazioni in sospeso |

## Cosa Succede Dopo

- **[Struttura del Progetto](/docs/getting-started/project-structure)** — Comprendi il codice generato
- **[Collezioni](/docs/collections)** — Approfondimento sulla definizione dello schema
- **[Ambiente e Configurazione](/docs/getting-started/configuration)** — Tutte le opzioni di configurazione
- **[Deployment](/docs/getting-started/deployment)** — Distribuisci in produzione

---
