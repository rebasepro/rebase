---
sourceHash: c423ff16c60af471
title: Solo backend (headless)
sidebar_label: Solo backend
description: Esegui Rebase come Backend-as-a-Service headless sul tuo database PostgreSQL — un'API REST, autenticazione, storage e realtime, senza pannello di amministrazione e senza backend/schema.
---

Rebase ha due forme, e questa pagina riguarda quella che non apre mai un browser: un'API
REST, autenticazione, storage, realtime e backup su un database PostgreSQL che
hai già. Nessun pannello di amministrazione, nessun `backend/schema/`. Se stavi
cercando un'alternativa a Supabase o PostgREST, questa è la soluzione comparabile.

Tutto ciò che si trova in questa pagina funziona anche nel progetto completo — è lo stesso server.
Ciò che `--headless` rimuove è il pacchetto frontend e i file delle tabelle, non
una funzionalità.

## Crea lo scaffold

```bash
pnpm dlx @rebasepro/cli init my-api --headless --yes
cd my-api
```

Un unico workspace, nessun `frontend/`:

| Folder | What is in it |
|--------|---------------|
| `backend/` | `storage.ts` (`storageAuthorize`), le tue funzioni personalizzate e i cron job, e il `backend/schema/` generato da `--introspect`, quando richiesto. Non è presente alcun file server — il runtime pubblicato avvia il progetto |

`--template` non ha effetto qui: un preset popola le tabelle, e questa variante non ne ha
alcuna. Node 22.22+, lo stesso requisito minimo del progetto completo — il `package.json`
dell'overlay headless dichiara `"node": ">=22.22.0"` e sostituisce quello
sottostante.

## Collegalo al tuo database

`init` genera un file `.env` pronto all'uso. Per utilizzare un database già esistente, passa
il suo URL durante la creazione dello scaffold:

```bash
pnpm dlx @rebasepro/cli init my-api --headless --database-url "postgres://user:pass@host:5432/db" --yes
```

Oppure imposta `DATABASE_URL` in `.env` successivamente — il risultato è lo stesso. Senza
`DATABASE_URL`, `rebase dev` avvia un PostgreSQL gestito (PGlite) nella directory
del progetto, utile per provare l'API ma non è lo scopo principale di questa
variante.

Quindi:

```bash
pnpm install
pnpm run dev
```

**Leggi l'URL dall'output.** `rebase dev` ricava una porta libera dal
percorso del progetto anziché usarne una fissa, quindi differisce tra progetti e
tra macchine diverse.

## Da dove provengono le tabelle

Non ce ne sono nel codice: senza `backend/schema/index.ts`, il backend non dichiara alcuna tabella. Il server legge lo schema del database all'avvio e serve
le tabelle che trova, quindi l'API segue le tue migrazioni: modificando lo schema,
gli endpoint cambieranno di conseguenza.

Una tabella viene servita non appena la row-level security (RLS) è abilitata su di essa. Senza una policy,
viene servita ma non restituisce alcuna riga, e l'avvio mostrerà un avviso; una policy ne consente l'accesso:

```sql
ALTER TABLE your_table ENABLE ROW LEVEL SECURITY;
-- rebase.uid() is text: the cast makes this work for a uuid or integer column too.
CREATE POLICY your_table_owner ON your_table
    FOR ALL USING (user_id::text = rebase.uid());
```

`rebase.uid()`, `rebase.roles()` e `rebase.jwt()` sono installati da Rebase e
leggono l'identità della richiesta autenticata. Consulta
[Row-level security](/docs/collections/security-rules/) per il vocabolario delle policy
e [rls-check](/docs/rls-check/) per un audit di ciò che le tue policy effettivamente
consentono.

Una tabella senza RLS viene **ignorata**, intenzionalmente: ogni richiesta autenticata
viene eseguita come `rebase_user`, quindi servire una tabella non protetta dalla row-level security
consegnerebbe ogni riga a qualsiasi chiamante autenticato. Ciascuna tabella ignorata viene indicata all'avvio insieme all'istruzione SQL
necessaria a proteggerla.

Una tabella di join non viene servita in ogni caso: viene interpretata come il collegamento tra le due
tabelle che unisce. Se ha la RLS disattivata, verrà comunque segnalata all'avvio.

Il controllo viene eseguito all'avvio. Se la RLS viene disabilitata successivamente su una tabella servita, quest'ultima continuerà
a essere servita finché il riavvio successivo non la ignorerà. L'[audit programmato](/docs/rls-check/)
la segnala prima, ed è disattivato per impostazione predefinita.

:::note
`baas: { unprotectedTables: "serve" }` le serve comunque. Si tratta di un'opzione di
`initializeRebaseBackend`, quindi è accessibile solo dopo `rebase eject` —
il runtime gestito non la legge da alcun file o dall'ambiente. Ha senso solo quando ogni chiamante è già fidato.
:::

### In alternativa, generare i file delle tabelle

Se preferisci avere le tabelle definite in TypeScript — per i tipi, per
gli hook, per la revisione — esegui l'introspezione:

```bash
pnpm dlx @rebasepro/cli init my-api --headless --database-url "postgres://…" --introspect --install
```

`--introspect` implica `--template blank` e richiede `--install`, poiché viene eseguito
tramite la CLI installata. In un progetto esistente l'equivalente è:

```bash
pnpm rebase schema introspect
```

I file vengono inseriti in `backend/schema/`: un `defineTable` per ogni tabella, con le relative colonne,
relazioni e le policy sotto forma di `rls`, oltre a un file `index.ts` che le esporta. Da
quel momento in poi, il progetto ha le tabelle definite nel codice e l'introspezione all'avvio smette
di essere ciò che definisce l'API.

Lo scaffold headless
installa Atlas in `backend/`, quindi `rebase db push`, `rebase db generate`
e `pnpm run db:migrate` funzionano su quelle tabelle come in qualsiasi altro progetto.

## Utilizzo

Tramite HTTP:

```bash
curl "$REBASE_URL/api/data/posts?limit=10"
```

Oppure con il client type-safe, già incluso come dipendenza dello scaffold
headless:

```typescript title="scripts/example.ts"
import { createRebaseClient } from "@rebasepro/client";

// The URL `rebase dev` printed, or your deployment's. `pnpm example` reads it
// from `.rebase-dev-url` when the variable is unset.
const rebase = createRebaseClient({ baseUrl: process.env.REBASE_URL! });

const { data: posts } = await rebase.data.table("posts").find({
    where: { published: ["==", true] },
    limit: 10
});
```

- [REST API](/docs/backend/api/) — la struttura degli endpoint, i filtri e gli errori
- [Typed SDK](/docs/sdk/) — interrogazioni, autenticazione, realtime, storage
- `/api/docs` — il documento OpenAPI, servito dal backend in esecuzione una volta
  servita almeno una tabella, accessibile a un chiamante autenticato (mostrando le tabelle a cui ha accesso). Imposta
  `REBASE_ENABLE_SWAGGER=true` per pubblicarlo a chiunque, con la Swagger UI
  disponibile su `/api/swagger` al di fuori dell'ambiente di produzione. Un progetto senza tabelle non serve
  nessuno dei due: il documento viene generato a partire dalle tabelle

## `404 NO_TABLES`

Se ogni richiesta di dati risponde con questo:

```json
{
  "error": {
    "message": "This project serves no tables yet. …",
    "code": "NO_TABLES"
  }
}
```

significa che il progetto non dichiara tabelle nel codice *e* il database non ha fornito
nulla da servire. Prima della versione 0.31 il codice era `NO_COLLECTIONS`. È la prima risposta attesa da un progetto
headless puntato verso un database vuoto, ed è un 404 invece di un 500 perché
non c'è alcun errore — semplicemente non c'è ancora nulla da servire.

Tre passaggi permettono di risolvere il problema, nell'ordine consigliato per la verifica:

1. **Il database non ha tabelle.** Creale — tramite una migrazione, SQL diretto o un
   file `defineTable` associato a `rebase db push` — e riavvia.
2. **Le tabelle non hanno la row-level security abilitata**, quindi l'avvio le ha
   ignorate. Il log di avvio elenca ciascuna tabella insieme all'SQL per abilitarla. Abilitala e aggiungi una policy,
   come illustrato sopra. Anche la
   risposta lo segnala: il suo messaggio indica i nomi delle tabelle e fornisce
   l'istruzione `ALTER TABLE … ENABLE ROW LEVEL SECURITY` corrispondente, mentre
   `details.unprotectedTables` ne riporta l'elenco.
3. **`DATABASE_URL` punta a una destinazione diversa** da quella prevista. `rebase status`
   stampa i tre file che determinano a cosa si collega il backend.

## Aggiungere un pannello di amministrazione in seguito

Nulla ti impedisce di aggiungerlo in seguito. Un singolo comando aggiunge la cartella `frontend/` che
`rebase init` avrebbe creato senza `--headless`, con il rispettivo workspace e
la relativa applicazione in `rebase.json`:

```bash
pnpm rebase apps add admin               # at /, or at /admin when another app is at /
pnpm rebase apps add admin --path /admin
pnpm install
pnpm run dev
```

Scrive ciò che `rebase init` avrebbe generato senza `--headless`, a partire dagli stessi
template:

- `frontend/`, con `rebaseBackendGuard()` nella configurazione di Vite. L'admin esegue il rendering di
  ogni tabella servita dal backend, a partire da `GET /api/schema/tables`, senza richiedere un file per
  ciascuna tabella; la personalizzazione per `users` viene inclusa solo quando
  `backend/schema/users.ts` dichiara la tabella di autenticazione come fa lo scaffold. Le
  personalizzazioni specifiche del pannello risiedono in `frontend/src/cms/`.
- l'applicazione `admin` in `rebase.json`, con `cms` sul suo percorso e un comando di build
  nel gestore di pacchetti del progetto. Un progetto privo di `rebase.json` ne riceverà uno.
- `frontend` nei `workspaces` di `package.json` e in `pnpm-workspace.yaml`.
- in presenza di tabelle nel codice (`backend/schema/index.ts`, manualmente o tramite
  `rebase schema introspect`), gli script `db:push`, `db:generate` e
  `schema:generate` dello scaffold, la build del backend che esegue
  prima `rebase schema generate`, e `ts-morph`. Gli script eventualmente modificati vengono mantenuti
  e segnalati.

Ogni pacchetto `@rebasepro/*` è bloccato (pinned) alla versione già in uso nel progetto
(a partire da `@rebasepro/server`), non a quella della CLI. Un progetto che specifica solo
riferimenti `link:` o `workspace:` riceverà la versione della CLI, con relativo avviso.

L'operazione viene rifiutata se `frontend/` esiste già, se un'applicazione è già denominata `admin` o
dichiara il CMS, oppure se `--path` è già occupato o non è un percorso valido su cui servire un'applicazione. Un rifiuto non altera alcunché, così come una scrittura che fallisce a
metà: ogni file viene ripristinato. Con l'opzione `--json` viene stampato ciò che è stato scritto, oppure il
contenitore dell'errore (error envelope). Consulta [Configurazione del Frontend](/docs/frontend/) per i dettagli relativi al frontend.

## Passaggi successivi

- [Autenticazione](/docs/backend/authentication/) — provider, token, chiavi API
- [Row-level security](/docs/collections/security-rules/) — il modello di accesso
- [Funzioni personalizzate](/docs/backend/custom-functions/) — le tue rotte personalizzate
- [Distribuzione](/docs/getting-started/deployment/) — portare il progetto in produzione
