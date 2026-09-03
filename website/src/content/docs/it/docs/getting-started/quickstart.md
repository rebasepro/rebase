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
- **pnpm** (consigliato) o npm

Nessun database da installare, e **niente Docker**. `rebase dev` esegue un PostgreSQL gestito per il progetto, con i dati sotto `.rebase/`. Vedi [Usa il tuo PostgreSQL](#usa-il-tuo-postgresql) se preferisci fornirne uno tu — un'installazione locale, Neon, Supabase o il container incluso in questa struttura.

## Il tuo Ambiente è Già Configurato

`init` genera un file `.env` pronto all'uso nella root del progetto, con un vero `JWT_SECRET`, una password del database e una porta locale libera per il database. Non devi creare o modificare nulla per iniziare.

:::caution
Non eseguire `cp .env.example .env`. `.env.example` è un riferimento per le variabili disponibili — copiarlo sopra il tuo `.env` scarta i segreti generati e fa puntare `DATABASE_URL` a un database che non esiste. Modifica direttamente `.env` se vuoi cambiare un valore.
:::

## Avvia i Server di Sviluppo

```bash
pnpm install   # only if you declined the install `init` offered
pnpm dev
```

Questa è tutta la prima esecuzione — non c'è alcun database da avviare né alcun passaggio di schema da ricordare. `rebase dev` fa tre cose prima di servire:

1. Genera `backend/src/schema.generated.ts` a partire da `config/collections/`.
2. Avvia un PostgreSQL gestito per questo progetto, con i dati sotto `.rebase/`.
3. Vi applica le tue collezioni, così che esistano le tabelle di esempio `posts`, `authors` e `tags`.

Poi avvia entrambe le metà insieme:

- **Backend** — API REST, autenticazione, storage, WebSocket
- **Frontend** — il pannello di amministrazione Rebase
- **Hot reload** per entrambi — le modifiche hanno effetto istantaneamente

Entrambe le porte sono **derivate dal percorso del progetto** anziché fisse, così più
progetti Rebase possono essere eseguiti insieme. `rebase dev` stampa i due URL a cui
si è associato — usa quelli, non `localhost:3001`/`localhost:5173`. (`PORT` e
`VITE_API_URL` in `.env` configurano `rebase start`, il server di produzione, e qui
vengono ignorati.) Fissa una porta con `rebase dev --port 3001`.

## Usa il tuo PostgreSQL

`DATABASE_URL` è commentata in `.env` di proposito — è questo che rende il database gestito l'impostazione predefinita. Puntala a qualsiasi PostgreSQL tu voglia (un'installazione locale, Neon, Supabase) e avrà la precedenza su quello gestito:

```bash
DATABASE_URL=postgresql://username:password@localhost:5432/your_database
```

La struttura generata include anche un `docker-compose.yml` con un servizio PostgreSQL, e l'URL già presente in `.env` punta a quello. Decommenta quella riga, poi:

```bash
docker compose up -d db
pnpm run db:push
pnpm dev
```

`db:push` è ciò che crea le tabelle delle tue collezioni su un database che Rebase non gestisce per te.

:::caution
`db:push`, `db:generate` e `db:migrate` pianificano le loro modifiche con [Atlas](https://atlasgo.io), che confronta il tuo schema con un secondo database vuoto. Il database di sviluppo gestito ne serve esattamente uno, quindi tutti e tre si rifiutano di essere eseguiti contro di esso e lo dicono, invece di fallire a metà strada. Lì non ti servono: `rebase dev` applica le tue collezioni all'avvio. Ricorri a essi quando sei su un PostgreSQL tuo, e per migrazioni, rimozioni e rinomine di colonne.
:::

## Introspezione di un Database Esistente (Opzionale)

Se ti stai connettendo a un database esistente con tabelle già presenti, puoi eseguirne l'introspezione per generare automaticamente i tuoi file di collezione TypeScript:

```bash
pnpm rebase schema introspect
```

Questo analizzerà le tabelle del tuo database e genererà i file TypeScript corrispondenti in `config/collections/`, così non dovrai scriverli manualmente.

## Primo Accesso

Quando apri l'URL del frontend stampato da `rebase dev`, vedrai la schermata di accesso. Il **primo utente** a registrarsi diventa automaticamente un amministratore — questo è il flusso di bootstrap.

1. Clicca su **Registrati**
2. Inserisci la tua email e password
3. Sei dentro — con accesso amministrativo completo

## Definisci la Tua Prima Collezione

Apri `config/collections/` e crea un nuovo file. Esporta la collezione come **export di default** — è così che il registry la rileva:

```typescript title="config/collections/products.ts"
import { defineCollection } from "@rebasepro/cms-types";

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

Riavvia `rebase dev`. Rigenera lo schema dalle tue collezioni e applica la nuova tabella prima di servire, così **Products** compare nella navigazione.

Su un PostgreSQL tuo, quello è invece il compito di `db:push`:

```bash
pnpm run db:push
```

## Riferimento ai Comandi del Database

| Comando | Descrizione |
|---------|-------------|
| `rebase schema generate` | Genera lo schema Drizzle dalle tue collezioni TypeScript. Non serve un database — `rebase dev` lo esegue per te |
| `rebase schema introspect` | Genera collezioni TypeScript da un database esistente |
| `rebase db push` | Invia le modifiche allo schema direttamente al database. Richiede un PostgreSQL tuo |
| `rebase db generate` | Genera i file di migrazione SQL. Richiede un PostgreSQL tuo |
| `rebase db migrate` | Esegui le migrazioni in sospeso. Richiede un PostgreSQL tuo |

## Cosa Succede Dopo

- **[Struttura del Progetto](/docs/getting-started/project-structure)** — Comprendi il codice generato
- **[Collezioni](/docs/collections)** — Approfondimento sulla definizione dello schema
- **[Ambiente e Configurazione](/docs/getting-started/configuration)** — Tutte le opzioni di configurazione
- **[Deployment](/docs/getting-started/deployment)** — Distribuisci in produzione

---
