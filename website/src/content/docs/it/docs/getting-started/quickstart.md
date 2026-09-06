---
sourceHash: 6463f2ed4a86c836
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

- **Node.js** 22.22+ — ogni scaffold, incluso quello headless, dichiara `"node": ">=22.22.0"`
- **pnpm** (consigliato) o npm

Nessun database da installare, e niente Docker. `rebase dev` esegue un PostgreSQL gestito per il progetto, con i dati sotto `.rebase/`. Vedi [Variante: il tuo PostgreSQL](#variante-il-tuo-postgresql) se preferisci fornirne uno tu — un'installazione locale, Neon, Supabase o il container incluso in questa struttura.

## Il tuo Ambiente è Già Configurato

`init` genera un file `.env` pronto all'uso nella root del progetto, con un vero `JWT_SECRET`, una password del database e una porta locale libera per il database. Non devi creare o modificare nulla per iniziare.

:::caution
Non eseguire `cp .env.example .env`. `.env.example` è un riferimento per le variabili disponibili — copiarlo sopra il tuo `.env` scarta i segreti generati e fa puntare `DATABASE_URL` a un database che non esiste. Modifica direttamente `.env` se vuoi cambiare un valore.
:::

## Avvia i Server di Sviluppo

```bash
pnpm install
pnpm run dev
```

È tutto qui, il primo avvio. Non c'è alcun database da installare né un passaggio
per lo schema: senza `DATABASE_URL` impostata, `rebase dev` avvia un **PostgreSQL
gestito (PGlite)** nella cartella del progetto, genera lo schema Drizzle dalle
tue collection e crea le tabelle all'avvio — comprese le collection di esempio
`posts`, `authors` e `tags`.

Le due metà partono insieme:

- **Backend** — API REST, auth, storage, WebSocket
- **Frontend** — il pannello di amministrazione Rebase
- **Hot reload** per entrambi

Le due porte sono **derivate dal percorso di questo progetto** invece che fisse,
così più progetti Rebase possono convivere. `rebase dev` stampa i due URL a cui
si è legato: **usa quelli**, non `localhost:3001` / `localhost:5173`. (`PORT` e
`VITE_API_URL` in `.env` configurano `rebase start`, il server di produzione, e
qui vengono ignorati.) Fissa una porta con `rebase dev --port 3001`.

### Flag che vale la pena conoscere

| Flag | Su | Cosa fa |
|---|---|---|
| `--yes` | `init` | Accetta tutti i valori predefiniti. **Obbligatorio quando non c'è un terminale a cui chiedere**, come in CI |
| `--headless` | `init` | Un backend senza file di collection e senza UI |
| `--template <nome>` | `init` | Parte da un template diverso da quello predefinito |
| `--install` / `--no-install` | `init` | Esegue il gestore di pacchetti al posto tuo, oppure no |
| `--docker` | `dev` | Usa PostgreSQL in un container invece di quello gestito |
| `--no-db` | `dev` | Non tocca alcun database; lo porti tu |

## Variante: il tuo PostgreSQL

Il database gestito è una comodità, non un requisito. Per puntare il progetto a un
PostgreSQL tuo, togli il commento a `DATABASE_URL` in `.env`:

```bash
DATABASE_URL=postgresql://username:password@localhost:5432/your_database
```

Poi avvia i server come sopra. Una `DATABASE_URL` già impostata non viene mai
toccata, e una che punta fuori da questa macchina è lasciata completamente stare.

Con un database tuo hai in più i comandi di migrazione, che quello gestito non può
offrire: pianificano le modifiche con Atlas, che ha bisogno di un secondo database
vuoto per il confronto, e PGlite ne serve esattamente uno:

```bash
pnpm run db:push
```

L'avvio crea già le tabelle mancanti in modo additivo, quindi `db push` serve per
le due cose che lascia stare di proposito: la RLS delle tabelle di join nelle
relazioni molti-a-molti e qualsiasi modifica non puramente additiva — una colonna
rinominata, un tipo ristretto, un campo rimosso.

Lo scaffold include anche un `docker-compose.yml` con un servizio PostgreSQL, se
preferisci un container a un Postgres installato:

```bash
docker compose up -d db
```

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

Invia la nuova collezione al database:

```bash
pnpm run db:push
```

Questo rigenera lo schema dalle tue collezioni e lo applica. Riavvia i server di sviluppo e la tua nuova collezione **Products** apparirà nella navigazione.

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
