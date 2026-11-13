---
sourceHash: 04353ad7d35cfe5c
title: Guida rapida
sidebar_label: Guida rapida
description: Crea un nuovo progetto Rebase e avvialo localmente in meno di 2 minuti.
---

## Crea un nuovo progetto

```bash
pnpm dlx @rebasepro/cli init my-app
```

Questo esegue lo scaffold di un progetto con due pacchetti. Se termini come *table*, *collection*,
*Studio*, *managed runtime*, *bundle* o *resource* ti risultano nuovi, il riquadro in
[Project Structure](/docs/getting-started/project-structure/) li definisce.

| Cartella | Descrizione |
|----------|-------------|
| `backend/` | Le tue tabelle (`backend/schema/`), ciò che il runtime legge accanto ad esse (`resources.ts`, `storage.ts`), le tue funzioni e cron, e lo schema Drizzle generato. Non c'è alcun file server — il runtime pubblicato avvia il progetto |
| `frontend/` | SPA React — Vite + TypeScript con la UI di amministrazione di Rebase, e le relative personalizzazioni delle tabelle in `src/cms/` |

## Prerequisiti

- **Node.js** 22.22+ — ogni scaffold, headless incluso, dichiara `"node": ">=22.22.0"`
- **pnpm** (consigliato) o npm

Nessun database da installare e niente Docker. `rebase dev` esegue un PostgreSQL gestito per il progetto, con i suoi dati in `.rebase/`. Consulta [Variante: usa il tuo PostgreSQL](#variante-usa-il-tuo-postgresql) se preferisci fornirne uno — un'installazione locale, Neon, Supabase, o il container fornito da questo scaffold.

## Il tuo ambiente è già configurato

`init` genera un file `.env` pronto all'uso nella root del progetto con un vero `JWT_SECRET`, una password per il database e una porta locale libera per il database. Non devi creare o modificare nulla per iniziare.

:::caution
Non eseguire `cp .env.example .env`. `.env.example` è un riferimento per le variabili disponibili — copiarlo sopra il tuo `.env` scarta i secret generati — `JWT_SECRET`, la service key, la password del database e le credenziali del primo amministratore, che lì sono tutte vuote o commentate. Modifica direttamente `.env` se desideri cambiare un valore.
:::

## Avvia i server di sviluppo

```bash
cd my-app
pnpm install
pnpm run dev
```

Questo è tutto per la prima esecuzione. Non c'è alcun database da installare e nessun passaggio relativo allo schema:
senza alcun `DATABASE_URL` impostato, `rebase dev` avvia un **PostgreSQL gestito (PGlite)**
nella directory del progetto, genera lo schema Drizzle dalle tue tabelle e
crea le tabelle all'avvio — incluse le tabelle di esempio `posts`, `authors` e `tags`.

Avvia entrambe le parti insieme:

- **Backend** — API REST, autenticazione, storage, WebSocket
- **Frontend** — il pannello: Rebase CMS e Rebase Studio
- **Hot reload** per entrambi

Entrambe le porte sono **derivate dal percorso di questo progetto** anziché fisse, quindi più
progetti Rebase possono essere eseguiti fianco a fianco. `rebase dev` stampa i due URL a cui si è associato —
**usa quelli**, non `localhost:3001` / `localhost:5173`. (`PORT` e `VITE_API_URL`
in `.env` configurano `rebase start`, che esegue il bundle compilato, e qui vengono ignorati.)
Fissa una porta con `rebase dev --port 3001`.

### Flag utili da conoscere

| Flag | Su | Cosa fa |
|---|---|---|
| `--yes` | `init` | Non richiedere mai conferme. **Obbligatorio quando non c'è un terminale a cui rispondere**, come nella CI. Salta il git init e l'installazione delle dipendenze — i valori predefiniti interattivi dicono sì a entrambi, quindi passa `--git` / `--install` se li desideri |
| `--headless` | `init` | Un backend senza `backend/schema/` e senza UI, che serve le tabelle del tuo database — vedi [Backend only](/docs/getting-started/headless/) |
| `--template <name>` | `init` | Avvia da un template diverso da quello predefinito |
| `--install` / `--no-install` | `init` | Esegue il gestore di pacchetti per te, oppure lo ignora |
| `--docker` | `dev` | Usa PostgreSQL in un container invece di quello gestito. Gli altri comandi lo seguono finché `rebase dev` non viene eseguito senza di esso. Un `DATABASE_URL` ha la priorità: in tal caso non avvia nulla, e lo segnala |
| `--no-db` | `dev` | Non avvia alcun database — né il container né quello gestito. Imposta autonomamente `DATABASE_URL` |

## Variante: usa il tuo PostgreSQL

Il database gestito è una comodità, non un requisito. Per puntare il progetto a
un'istanza di Postgres gestita da te, decommenta `DATABASE_URL` in `.env`:

```bash
DATABASE_URL=postgresql://username:password@localhost:5432/your_database
```

Quindi avvia i server di sviluppo come sopra. Un `DATABASE_URL` impostato non viene mai
toccato, e uno che punta a qualcosa di diverso da questa macchina viene lasciato completamente
inalterato.

I comandi di migrazione pianificano le modifiche con [Atlas](https://atlasgo.io/), il
motore di migrazione dello schema con cui Rebase esegue la pianificazione, che necessita di un secondo database vuoto
con cui effettuare il confronto. Su un database tuo, Rebase ne crea uno accanto; su quello
gestito, che serve esattamente un database, avvia un PGlite temporaneo per la
durata del comando.
In entrambi i casi:

```bash
pnpm run db:push
```

L'avvio crea già le tabelle mancanti — e le relative
politiche [RLS](/docs/collections/security-rules/), la sicurezza a livello di riga di PostgreSQL,
ovvero il modo in cui Rebase controlla chi può leggere una riga — in modo additivo, quindi
`db push` serve per ciò che l'avvio lascia deliberatamente intatto: qualsiasi modifica che non sia
puramente additiva — una colonna rinominata, un tipo ristretto, un campo rimosso.

Lo scaffold include anche un file `docker-compose.yml` con un servizio PostgreSQL, se
preferisci un container anziché un'installazione di Postgres:

```bash
docker compose up -d db
```

## Esegui l'introspezione di un database esistente (Opzionale)

<span class="since-badge" data-since="0.31">Da 0.31</span>

Se ti stai connettendo a un database esistente con tabelle preesistenti, puoi eseguirne l'introspezione per generare un file `defineTable` per ciascuna di esse:

```bash
pnpm rebase schema introspect
```

Questo legge ogni tabella, colonna, foreign key e policy di sicurezza a livello di riga e scrive `backend/schema/<table>.ts` e l'`index.ts` che le esporta, così non devi scriverle a mano. Consulta [`schema introspect`](/docs/cli/schema/#rebase-schema-introspect).

## Primo accesso

Quando apri l'URL del frontend stampato da `rebase dev`, vedrai la schermata di login. Il **primo utente** a registrarsi diventa automaticamente un amministratore — questo è il flusso di bootstrap.

1. La schermata si apre su **Welcome!**, il modulo per quel primo account
2. Inserisci la tua email e la password, quindi fai clic su **Create account**
3. Sei dentro — con accesso completo da amministratore

`rebase init` ha anche scritto `REBASE_ADMIN_EMAIL` e una `REBASE_ADMIN_PASSWORD` generata in `.env`. Queste non sono le tue credenziali qui: `rebase dev` le ignora e lo segnala all'avvio. Esse appartengono a un avvio in produzione — `docker compose up`, o qualsiasi cosa con `NODE_ENV=production` — dove questa finestra di bootstrap è chiusa, perché il server risponde su un hostname prima che tu abbia digitato alcunché. Consulta [Il tuo primo admin](/docs/getting-started/deployment#your-first-admin).

## Definisci la tua prima tabella

<span class="since-badge" data-since="0.31">Da 0.31</span>

Crea un file in `backend/schema/`:

```typescript title="backend/schema/products.ts"
import { defineTable, col } from "@rebasepro/server/schema";

export const products = defineTable("products", {
    columns: {
        id:          col.uuid().primaryKey().defaultRandom(),
        name:        col.text().notNull(),
        price:       col.numeric().notNull().validate({ min: 0 }),
        description: col.text(),
        active:      col.boolean().default(true),
        createdAt:   col.timestamp({ withTimezone: true }).onCreateNow(),
    },
    // Takes the defaultRls the scaffold's index.ts exports: everyone reads, admins write.
    rls: "inherit",
});
```

Quindi esportala da `backend/schema/index.ts`. L'index è ciò che il backend,
la CLI e il generatore dell'SDK leggono: un `defineTable` che non viene esportato rifiuta
l'avvio, indicando il nome del file.

```typescript title="backend/schema/index.ts"
// ...existing exports
export { products } from "./products";
```

## Crea la tabella

<span class="since-badge" data-since="0.31">Da 0.31</span>

Salva il file. Questo è l'intero passaggio: `rebase dev` rigenera
`backend/src/schema.generated.ts` e i tipi dell'SDK in `generated/sdk/` dalle tue
tabelle, riavvia il backend e l'avvio crea la nuova tabella e le sue policy
di sicurezza a livello di riga — e **Products** appare nella navigazione del pannello
di amministrazione, con un elenco, un modulo e filtri derivati dalle colonne.

Lo stesso vale per una colonna aggiunta a una tabella già esistente: salva, e la
colonna è lì.

Per modificare l'aspetto della tabella nel pannello — un editor multiriga per
`description`, un'icona, un gruppo — aggiungi un file in `frontend/src/cms/` e passalo
a `<RebaseCMS tableCustomizations>` in `App.tsx`:

```tsx title="frontend/src/cms/products.tsx"
import { customizeTable } from "@rebasepro/cms";
import type { products } from "../../../backend/schema/products";

export const productsCms = customizeTable<typeof products>("products", {
    icon: "ShoppingCart",
    fields: {
        description: { multiline: true },
    },
});
```

Consulta [Personalizzare una tabella](/docs/frontend/customize-table/).

`rebase db push` serve per le modifiche che l'avvio lascia deliberatamente intatte — una
colonna rinominata, un tipo ristretto, un campo rimosso:

```bash
pnpm run db:push
```

Funziona sul database
gestito esattamente come sul tuo.

## Riferimento comandi database

<span class="since-badge" data-since="0.31">Da 0.31</span>

| Comando | Descrizione |
|---------|-------------|
| `rebase schema generate` | Genera lo schema Drizzle dalle tue tabelle. Nessun database necessario — `rebase dev` lo esegue per te |
| `rebase schema introspect` | Scrive i file `defineTable` a partire da un database esistente |
| `rebase db push` | Applica le modifiche allo schema direttamente al database, incluso quello gestito |
| `rebase db generate` | Genera i file di migrazione SQL |
| `rebase db migrate` | Esegue le migrazioni in sospeso |

I tre comandi
`db` funzionano sul database gestito.

## Passaggi successivi

- **[Struttura del progetto](/docs/getting-started/project-structure)** — Comprendi il codice generato
- **[Tabelle](/docs/schema/)** — Approfondimento sulla definizione dello schema
- **[Ambiente e configurazione](/docs/getting-started/configuration)** — Tutte le opzioni di configurazione
- **[Distribuzione](/docs/getting-started/deployment)** — Distribuisci in produzione
