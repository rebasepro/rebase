---
sourceHash: 7b2e4e449b0ca1dc
title: Guida rapida
sidebar_label: Guida rapida
description: Crea un nuovo progetto Rebase e avvialo localmente in meno di 2 minuti.
---

## Crea un nuovo progetto

```bash
pnpm dlx @rebasepro/cli init my-app
```

Questo genera lo scaffold di un progetto con tre pacchetti. Se concetti come *collection*, *Studio*, *managed runtime*, *bundle* o *resource* sono nuovi per te, il riquadro con le cinque definizioni in [Project Structure](/docs/getting-started/project-structure/) li spiega nel dettaglio.



| Cartella | Descrizione |
|----------|-------------|
| `frontend/` | SPA React — Vite + TypeScript con l'interfaccia utente di amministrazione di Rebase |
| `backend/` | Le tue funzioni personalizzate e i cron job, oltre allo schema Drizzle generato. Non c'è alcun file server: il runtime pubblicato avvia direttamente il progetto |
| `config/` | File di configurazione e definizioni delle collezioni condivisi da entrambe le parti |

## Prerequisiti

- **Node.js** 22.22+ — ogni scaffold, incluso quello headless, dichiara `"node": ">=22.22.0"`
- **pnpm** (consigliato) o npm

Nessun database da installare e nessun Docker richiesto. `rebase dev` esegue un'istanza gestita di PostgreSQL per il progetto, con i dati memorizzati in `.rebase/`. Consulta [Variante: usa la tua istanza di PostgreSQL](#variante-usa-la-tua-istanza-di-postgresql) se preferisci fornirne una tu: un'installazione locale, Neon, Supabase o il container incluso in questo scaffold.

## Il tuo ambiente è già configurato

`init` genera un file `.env` pronto all'uso nella radice del progetto con un vero `JWT_SECRET`, una password per il database e una porta locale libera per il database. Non è necessario creare o modificare nulla per iniziare.

:::caution
Non eseguire `cp .env.example .env`. `.env.example` serve come riferimento per le variabili disponibili: sovrascriverlo al tuo `.env` scarterà i secret generati e farà puntare `DATABASE_URL` a un database inesistente. Modifica direttamente `.env` se vuoi cambiare un valore.
:::

## Avvia i server di sviluppo

```bash
pnpm install
pnpm run dev
```

Questo è tutto ciò che serve per il primo avvio. Non c'è alcun database da installare e nessun passaggio relativo allo schema: se non viene impostato alcun `DATABASE_URL`, `rebase dev` avvia un **PostgreSQL gestito (PGlite)** nella directory del progetto, genera lo schema Drizzle dalle tue collezioni e crea le tabelle all'avvio — incluse quelle di esempio `posts`, `authors` e `tags`.

Avvia entrambe le parti contemporaneamente:

- **Backend** — API REST, autenticazione, storage, WebSocket
- **Frontend** — il pannello: Rebase CMS e Rebase Studio
- **Hot reload** per entrambi

Entrambe le porte sono **derivate dal percorso del progetto** anziché essere fisse, consentendo a diversi progetti Rebase di essere eseguiti contemporaneamente. `rebase dev` mostrerà i due URL associati — **usa quelli**, non `localhost:3001` / `localhost:5173`. (`PORT` e `VITE_API_URL` in `.env` configurano `rebase start`, il server di produzione, e qui vengono ignorati.) Fissa una porta con `rebase dev --port 3001`.

### Flag utili da conoscere

| Flag | Su | Cosa fa |
|---|---|---|
| `--yes` | `init` | Non richiede mai conferme interattive. **Obbligatorio quando non c'è un terminale a cui rispondere**, come nei contesti di CI. Salta git init e l'installazione delle dipendenze — le opzioni predefinite interattive rispondono affermativamente a entrambi, quindi passa `--git` / `--install` se li desideri |
| `--headless` | `init` | Un backend senza file di collezione e senza interfaccia grafica — vedi [Backend only](/docs/getting-started/headless/) |
| `--template <name>` | `init` | Avvia il progetto da un template diverso da quello predefinito |
| `--install` / `--no-install` | `init` | Esegue il gestore di pacchetti al posto tuo, oppure lo ignora |
| `--docker` | `dev` | Usa PostgreSQL in un container al posto di quello gestito |
| `--no-db` | `dev` | Non avvia alcun database — né il container né quello gestito. Imposta `DATABASE_URL` manualmente |

## Variante: usa la tua istanza di PostgreSQL

Il database gestito è una comodità, non un obbligo. Per puntare il progetto a un'istanza di Postgres gestita da te, decommenta `DATABASE_URL` in `.env`:

```bash
DATABASE_URL=postgresql://username:password@localhost:5432/your_database
```

Quindi avvia i server di sviluppo come descritto sopra. Un `DATABASE_URL` impostato non viene mai sovrascritto, e qualsiasi URL che punti a una destinazione diversa da questa macchina viene lasciato del tutto inalterato.

Con un tuo database ottieni anche i comandi di migrazione, che l'istanza gestita non può offrire: pianificano le modifiche con [Atlas](https://atlasgo.io/), il motore di migrazione degli schemi utilizzato da Rebase, che richiede un secondo database vuoto per effettuare i confronti, mentre PGlite ne gestisce esattamente uno:

```bash
pnpm run db:push
```

La procedura di avvio crea già le tabelle mancanti in modo additivo, quindi `db push` serve per le due cose che lascia intenzionalmente invariate: l'eventuale [RLS](/docs/collections/security-rules/) (Row-Level Security di PostgreSQL, con cui Rebase stabilisce chi può leggere una riga) sulle tabelle ponte delle relazioni many-to-many, e qualsiasi modifica che non sia puramente additiva — una colonna rinominata, un tipo ristretto, un campo rimosso.

Lo scaffold include anche un file `docker-compose.yml` con un servizio PostgreSQL, qualora preferissi usare un container anziché un'installazione locale di Postgres:

```bash
docker compose up -d db
```

## Esegui l'introspezione di un database esistente (opzionale)

Se ti stai connettendo a un database esistente con tabelle già create, puoi eseguirne l'introspezione per generare automaticamente i file delle collezioni in TypeScript:

```bash
pnpm rebase schema introspect
```

Questo comando analizzerà le tabelle del tuo database e genererà i corrispondenti file TypeScript in `config/collections/`, evitandoti di doverli scrivere a mano.

## Primo accesso

Quando apri l'URL del frontend mostrato da `rebase dev`, vedrai la schermata di login. Il **primo utente** a registrarsi diventa automaticamente un amministratore: questo è il flusso di bootstrap.

1. Clicca su **Sign Up**
2. Inserisci email e password
3. Hai effettuato l'accesso — con privilegi completi di amministratore

`rebase init` ha inoltre inserito `REBASE_ADMIN_EMAIL` e una `REBASE_ADMIN_PASSWORD` generata all'interno di `.env`. Queste non sono le credenziali da usare in questa fase: `rebase dev` le ignora e lo segnala all'avvio. Servono per gli avvii in produzione — `docker compose up` o qualsiasi processo con `NODE_ENV=production` — dove la finestra di bootstrap è chiusa, poiché il server risponde su un hostname pubblico prima ancora che tu possa inserire dei dati. Consulta [Your first admin](/docs/getting-started/deployment#your-first-admin).

## Definisci la tua prima collezione

Apri `config/collections/` e crea un nuovo file. Esporta la collezione come **default export** — è così che il registro la riconosce. Il nome della tabella è opzionale: come impostazione predefinita corrisponde allo slug, quindi specificalo solo se differiscono:

```typescript title="config/collections/products.ts"
import { defineCollection } from "@rebasepro/cms-types";

const productsCollection = defineCollection({
    slug: "products",
    name: "Products",
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

Registrala poi in `config/collections/index.ts` in modo che sia il backend che il pannello di amministrazione possano rilevarla:

```typescript title="config/collections/index.ts" {2,5}
// ...existing imports
import productsCollection from "./products.js";

export const collections = [
    postsCollection, authorsCollection, tagsCollection, usersCollection, productsCollection
];
```

## Crea la tabella

Salva il file. Non serve altro: `rebase dev` rigenera `backend/src/schema.generated.ts` a partire dalle tue collezioni, riavvia il backend e l'avvio crea la nuova tabella — così la collezione **Products** compare direttamente nella barra di navigazione.

La stessa logica si applica all'aggiunta di una proprietà a una collezione esistente: salva e la colonna sarà subito pronta.

`rebase db push` è riservato alle modifiche che l'avvio lascia intenzionalmente invariate — una colonna rinominata, un tipo ristretto, un campo rimosso e l'RLS sulle tabelle ponte per le relazioni many-to-many. Richiede un'istanza PostgreSQL dedicata:

```bash
pnpm run db:push
```

## Riferimento dei comandi del database

| Comando | Descrizione |
|---------|-------------|
| `rebase schema generate` | Genera lo schema Drizzle dalle tue collezioni TypeScript. Nessun database richiesto — `rebase dev` lo esegue per te |
| `rebase schema introspect` | Genera collezioni TypeScript a partire da un database esistente |
| `rebase db push` | Applica le modifiche allo schema direttamente al database. Richiede una tua istanza di PostgreSQL |
| `rebase db generate` | Genera file di migrazione SQL. Richiede una tua istanza di PostgreSQL |
| `rebase db migrate` | Esegue le migrazioni in sospeso. Richiede una tua istanza di PostgreSQL |

## Passaggi successivi

- **[Project Structure](/docs/getting-started/project-structure)** — Comprendi il codice generato
- **[Collections](/docs/collections)** — Approfondimento sulla definizione dello schema
- **[Environment & Configuration](/docs/getting-started/configuration)** — Tutte le opzioni di configurazione
- **[Deployment](/docs/getting-started/deployment)** — Distribuisci in produzione
