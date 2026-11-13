---
sourceHash: bdf9409c94709498
title: Database e bucket multipli
sidebar_label: Più sorgenti
description: Instrada le tabelle verso diversi database e le colonne di archiviazione verso diversi bucket, e configura ciascuno di essi dall'ambiente.
---

## Panoramica

Un progetto non è limitato a un solo database e un solo bucket. Ogni elemento con nome
di cui un progetto ha bisogno — un database, un bucket, un topic, una coda — viene **dichiarato con un
costruttore in `backend/resources.ts`** e configurato dall'ambiente tramite una variabile
derivata dalla sua chiave. I cron e le funzioni sono file, ed entrano nello stesso
grafo sotto il nome del file.

Una sola regola, qualunque sia il tipo: non c'è un secondo posto dove cercare, e nulla che
debba essere sincronizzato manualmente.

## Dichiarare le risorse

Inseriscile in `backend/resources.ts`. Esportarle è una buona pratica — ti dà
qualcosa da importare — ma è la dichiarazione che le registra.

```ts
// backend/resources.ts
import { bucket, database, queue, topic } from "@rebasepro/types";

/** The project's database. Reads DATABASE_URL, as it always did. */
export const main = database();

/** A second one. Reads DATABASE_URL__ANALYTICS. */
export const analytics = database("analytics", { label: "Analytics warehouse" });

/** A bucket. Reads S3_BUCKET__MEDIA. */
export const media = bucket("media", { engine: "s3", label: "Public media" });

/** A topic, delivered through the durable job queue. */
export const signups = topic<{ userId: string }>("signups");

signups.subscription("send-welcome", async (event) => {
    // …
});
```

`database()`, `bucket()` e `topic()` sono dichiarabili dalla versione 0.17, e
`queue()` dalla versione 0.18.

Poi punta una tabella a una di esse, tramite handle — lo stesso nome, scritto una volta sola:

<span class="since-badge" data-since="0.31">Dalla 0.31</span>

```ts
// backend/schema/page_views.ts
import { defineTable, col } from "@rebasepro/server/schema";
import { analytics, media } from "../resources";

export const pageViews = defineTable("page_views", {
    database: analytics,
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        path: col.text().notNull(),
        // A file column, stored in the `media` bucket.
        screenshot: col.storage({ path: "screenshots/", source: media, accept: ["image/*"] })
    },
    rls: "admin-only"
});
```

La tabella compilata registra la chiave dell'handle, quindi oltre quel punto si tratta di semplici
dati — si serializzano, si confrontano, raggiungono il pannello di amministrazione tramite
`GET /api/schema/tables`. Funziona anche la forma a stringa (`database: "analytics"`);
l'handle è quello seguito dalla ridenominazione e su cui atterra il comando "vai alla definizione".

In una funzione, gli stessi handle raggiungono la risorsa:

```ts
import { defineFunction } from "@rebasepro/server/functions";
import { analytics, media } from "../resources";

export default defineFunction((app, { rebase }) => {
    app.post("/report", async (c) => {
        const rows = await rebase.sql("select count(*) from page_views", { database: analytics });
        const file = new File([JSON.stringify(rows)], "report.json", { type: "application/json" });
        await rebase.bucket(media).putObject({ key: "report.json", file });
        return c.json({ ok: true });
    });
});
```

`{ database: analytics }` esegue la query sulla connessione propria di quella sorgente —
qualunque cosa a cui punti `DATABASE_URL__ANALYTICS`, su qualsiasi server — e nessuna
opzione la esegue su quella predefinita. Una chiave che fa riferimento a una sorgente non configurata viene
rifiutata con un errore che elenca quelle esistenti.

### Visualizzare ciò che hai dichiarato

```bash
rebase resources            # list them
rebase resources --write    # regenerate rebase.resources.json
rebase resources --check    # fail if that file is stale
```

`rebase.resources.json` viene **generato** e salvato nel commit. È ciò che un host legge
per decidere cosa sottoporre a provisioning *prima* di eseguire qualsiasi cosa — ed è così che una console
può segnalare "questo progetto richiede un bucket `media` e non ne ha nessuno" al primo deploy.
Modifica le dichiarazioni, mai il file; `--check` fa fallire una build se i due
non corrispondono.

Ogni voce registra anche **chi la utilizza** — `table:page_views` su un
database, `column:posts.cover` su un bucket, `function:report` su qualsiasi cosa
la funzione importi da `resources.ts`. Questa è la mappa di cui una console ha bisogno per
rispondere alla domanda "cosa si rompe se rimuovo questo".

`rebase status` fa un passo ulteriore: per ogni dichiarazione indica se
l'ambiente la collega (effettua il bind), utilizzando gli stessi resolver usati dall'avvio, quindi non può
rassicurarti su un deployment che sta per rifiutarsi di avviarsi.

### Un engine sconosciuto alla build

Ogni tipologia ha la propria lista di engine, e uno sconosciuto viene rifiutato nel punto di chiamata
anziché essere accettato per poi fallire in seguito. Qualcosa di realmente al di fuori della lista viene
espresso con `custom:`:

```ts
export const objects = bucket("objects", { engine: "custom:minio" });
```

### Correggere un kind già rilasciato

Per gli autori di driver. La definizione registrata di un kind di risorsa è **congelata** una volta che
il pacchetto che la contiene è stato pubblicato: ogni driver pubblicato incorpora la propria
copia di `@rebasepro/types`, e la copia confronta la voce del registro condiviso
con il proprio valore letterale e genera un errore a fronte di qualsiasi differenza. Modificare il letterale,
quindi, distrugge al caricamento del driver ogni bundle creato con un driver precedente.

`amendResourceKind` corregge ciò a cui un kind *effettua il bind* — i suoi prefissi di ambiente, le sue
chiavi di opzione — senza toccare il letterale confrontato da qualsiasi copia precedente:

```ts
import { amendResourceKind } from "@rebasepro/types";

amendResourceKind("database", {
    envBases: ["DATABASE_URL", "DATABASE_READ_URL", "ADMIN_CONNECTION_STRING"]
});
```

La modifica si applica solo alle letture tramite questa copia, quindi un driver precedente continua a
effettuare il bind nello stesso modo in cui faceva al momento della pubblicazione. Usalo per ogni correzione a un
kind già rilasciato; usa `registerResourceKind` solo per un kind che nessuno ha ancora pubblicato.

### Passaggio al frontend

<span class="since-badge" data-since="0.31">Dalla 0.31</span>

Il frontend non importa `backend/resources.ts`: un'importazione di valori di
qualsiasi elemento in `backend/` da `frontend/` viene rifiutata da
`pnpm check:frontend-backend-imports`, perché invierebbe moduli server al
browser. Non è necessario farlo. Il provider `<Rebase>` legge i bucket serviti dal
backend da `GET /api/storage/sources` e li collega ciascuno, e ogni
tabella servita dal backend, in qualunque database si trovi, viene raggiunta tramite
l'API.

Ciò che il frontend dichiara autonomamente è una sorgente `direct` — con cui il browser comunica
senza passare dal backend, come ad esempio Firestore — passata a `<Rebase>` come
istanza attiva tramite `dataSources` o `storageSources`. Consulta
[Firebase](/docs/frontend/firebase/).

## Configurare ciascuna sorgente

I nomi delle variabili d'ambiente sono derivati dalla chiave della risorsa, quindi non c'è
nulla da sincronizzare manualmente:

```
<VARIABLE>              the default resource   DATABASE_URL, S3_BUCKET
<VARIABLE>__<KEY>       a named resource       DATABASE_URL__ANALYTICS, S3_BUCKET__MEDIA
```

La chiave viene convertita in maiuscolo e i caratteri non alfanumerici diventano trattini bassi, quindi
`media-cdn` legge `S3_BUCKET__MEDIA_CDN`.

Il separatore è intenzionalmente un **doppio** trattino basso. Uno singolo entrerebbe in conflitto
con nomi di variabili reali — `S3_BUCKET_NAME` verrebbe analizzato come il bucket per una
sorgente chiamata `name`.

### Database

```bash
DATABASE_URL=postgres://localhost/app
DATABASE_URL__ANALYTICS=postgres://warehouse.internal/analytics

# Optional, per source:
DB_POOL_MAX__ANALYTICS=5
REBASE_DRIVER__ANALYTICS=@rebasepro/server-postgres
```

Il driver viene scelto in base all'`engine` dichiarato — `postgres` è quello per cui Rebase
fornisce un driver server, ed è l'unico verso cui una tabella può essere instradata — e
`REBASE_DRIVER__<KEY>` ne esegue l'override per un driver personalizzato. Un database Firestore
non è una risorsa di backend: il CMS lo legge dal browser, tramite
[`defineFirestoreCollection`](/docs/frontend/firebase/).
`REBASE_DB_POOL_MAX` è un limite per l'intero processo, non un binding per singola sorgente, quindi
non accetta alcun suffisso.

In fase di sviluppo non devi impostare nulla di tutto questo: `rebase dev` serve ogni database
dichiarato dal suo Postgres gestito — una seconda istanza per `analytics`, avviata
su richiesta — ed esporta direttamente `DATABASE_URL__ANALYTICS`. Una variabile impostata
manualmente non viene mai sovrascritta.

Le tabelle e i criteri di row-level security vengono sottoposti a provisioning **per sorgente**: una
tabella instradata verso `analytics` ottiene la propria tabella e i propri criteri nel
database analytics.

### Storage

```bash
S3_BUCKET__MEDIA=my-media-bucket
S3_REGION__MEDIA=eu-central-1
S3_ACCESS_KEY_ID__MEDIA=…
S3_SECRET_ACCESS_KEY__MEDIA=…
```

L'engine deriva dalla dichiarazione, quindi non c'è alcun `STORAGE_TYPE` da impostare.

#### Quale bucket riceve un caricamento non qualificato

Una colonna di storage che non specifica alcuna `source` scrive nel bucket **predefinito**.
La dichiarazione di bucket con nome non lo sposta mai. Il predefinito mantiene la propria
configurazione a prescindere da ciò che dichiara `backend/resources.ts`: `STORAGE_TYPE`,
`STORAGE_PATH` (`<project>/uploads` se non impostato), e le variabili `S3_*` / `GCS_*`
senza suffisso. L'aggiunta di `bucket("media", { engine: "s3" })` a un progetto che ha
già file in `./uploads` li lascia dove sono e continuano a essere serviti. `media`
legge le proprie variabili `__MEDIA` e, in fase di sviluppo, si sostituisce con una propria
directory, `uploads__media`.

Per inviare invece i caricamenti non qualificati a un bucket con nome, contrassegnalo:

```ts
export const media = bucket("media", { engine: "s3", default: true });
```

Il predefinito a quel punto *è* `media`. I file precedentemente contenuti nel predefinito rimangono dove
sono e non vengono più serviti tramite esso, quindi copiali prima:
`rebase storage move --from "(default)" --to media`.

Due sorgenti non possono condividere la stessa posizione. Se un bucket con nome dovesse risolversi nella
directory del predefinito (o in una al suo interno), o nello stesso bucket dell'object store
sullo stesso endpoint, l'avvio viene rifiutato indicando la variabile da modificare.

### Più bucket su un unico account

Ogni variabile viene letta per chiave, il che è corretto per il nome del bucket ma non per
le credenziali — quindici bucket su una sola installazione di MinIO significherebbero quindici copie
della stessa chiave di accesso. Specifica un `account` e le variabili a livello di provider verranno
lette una sola volta:

```ts
export const media   = bucket("media",   { engine: "s3", account: "minio" });
export const avatars = bucket("avatars", { engine: "s3", account: "minio" });
```

```bash
S3_BUCKET__MEDIA=project-media       # per bucket, never shared
S3_BUCKET__AVATARS=project-avatars
S3_ACCESS_KEY_ID__MINIO=…            # read once, by both
S3_SECRET_ACCESS_KEY__MINIO=…
S3_ENDPOINT__MINIO=https://minio.internal
```

La forma basata su account copre le variabili che descrivono il *provider*:
`S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_ENDPOINT`, `S3_REGION`,
`S3_FORCE_PATH_STYLE`, `GCS_PROJECT_ID` e `GCS_KEY_FILENAME`. Il nome del bucket
non è tra queste e non usa mai un fallback — se lo facesse, due bucket sullo stesso account
diventerebbero silenziosamente uno solo.

Un valore specifico per singolo bucket ha comunque la precedenza dove impostato, consentendo di spostare
una singola sorgente su un altro provider senza disconnettere le altre dal loro account condiviso. Non c'è
deliberatamente alcun fallback alla variabile priva di suffisso: quest'ultima appartiene alla
sorgente predefinita, e consentire a un bucket con nome di ereditarla significherebbe che una chiave digitata male
effettuerebbe la firma con le credenziali di un'altra sorgente.

## Topic e code

Un topic viene recapitato tramite la coda di job durevole: la pubblicazione scrive **una riga
per sottoscrizione**, quindi ogni sottoscrittore effettua i tentativi secondo la propria pianificazione e un
sottoscrittore in errore non blocca gli altri né li costringe a essere eseguiti nuovamente.

```ts
await signups.publish({ userId });
```

Una coda è l'altra forma di lavoro in background: un elenco di lavoro con **un solo
gestore (handler)**, dove il chiamante conserva l'id del job. Le code sono state introdotte nella versione 0.18,
i topic nella 0.17.

```ts
export const thumbnails = queue<{ key: string }>("thumbnails");
thumbnails.handler(async ({ key }, { attempt }) => { /* … */ });

const { id } = await thumbnails.enqueue({ key }, { runAt: new Date(Date.now() + 60_000) });
```

Entrambi sono con recapito **at-least-once**. Un worker che termina in modo anomalo mentre gestisce un job lo rilascia e
quello successivo riavvia l'handler dall'inizio, quindi un handler deve tollerare la ricezione
di un evento per due volte. La pubblicazione o l'accodamento all'interno di una transazione che subisce un rollback
non è mai avvenuta — si tratta dell'inserimento di una riga.

La dichiarazione di uno dei due attiva automaticamente la coda di job, in ogni percorso di avvio — un
progetto sul runtime gestito, che non ha un entrypoint attraverso cui passare `jobs.tasks`,
ottiene i propri handler in questo modo. La pubblicazione su un topic che nessuno dichiara, o
l'inserimento in una coda priva di handler, genera un'eccezione anziché scrivere righe che nessun
worker gestirebbe.

## Cron e funzioni

Entrambi sono file — `backend/crons/<name>.ts`, `backend/functions/<name>.ts` —
ed entrambi entrano nel grafo sotto il nome del file, che è anche l'id con cui lo
scheduler esegue un cron e il percorso su cui una funzione viene montata. Nessuno dei due effettua il binding
dall'ambiente; sono presenti nel grafo affinché un host conosca le pianificazioni di un progetto
prima di eseguire qualsiasi elemento.

```ts
export default defineCron({
    name: "Nightly cleanup",
    schedule: "0 3 * * *",
    timezone: "Europe/Madrid",
    async handler({ rebase }) { /* … */ }
});
```

Senza `timezone` la pianificazione viene interpretata nel fuso orario dell'host — UTC in quasi
tutti i container, il tuo locale su un portatile — quindi `0 3 * * *` corrisponde a un'ora diversa
prima e dopo un deploy. Una zona sconosciuta viene rifiutata al caricamento del job.

## Comportamento in caso di errore

Una sorgente dati con trasporto server dichiarata priva di stringa di connessione **fa fallire
l'avvio**, indicando il nome della variabile da impostare. Questo comportamento è intenzionale ed è importante comprenderlo:
l'alternativa sarebbe che le tabelle instradate verso la sorgente mancante ripieghino silenziosamente sul
database predefinito. Ciò comporterebbe dati salvati nella posizione sbagliata dietro un
server che dichiara di essere integro — una situazione di gran lunga peggiore rispetto a un container che si rifiuta di
avviarsi.

Anche due chiavi che deriverebbero lo stesso nome di variabile vengono rifiutate, poiché una
di esse leggerebbe silenziosamente la configurazione dell'altra.

Le sorgenti dichiarate con `transport: "direct"` vengono completamente ignorate: il client
comunica direttamente con esse, quindi il backend non mantiene alcuna connessione e non richiede
alcuna configurazione al riguardo.

## Controllo degli accessi allo storage

Le chiavi di storage condividono un unico namespace piatto e non sono soggette a row-level security, quindi
in assenza di un modello esplicito di controllo degli accessi il comportamento predefinito sarebbe "qualsiasi utente autenticato
può leggere, sovrascrivere, eliminare o elencare qualsiasi oggetto". In ambiente di produzione l'avvio viene rifiutato
anziché assumere tale comportamento.

Il modo per definire cosa significa l'accesso per il tuo progetto è esportare `storageAuthorize`
da `backend/storage.ts` — una funzione, poiché nessuna variabile d'ambiente può esprimere
"questo utente può leggere questa chiave":

```ts
// backend/storage.ts
import type { StorageAuthorize } from "@rebasepro/types";

export const storageAuthorize: StorageAuthorize = async ({ key, user, operation }) => {
    if (!user) return false;
    const [ownerId] = key.split("/");
    return ownerId === user.uid || operation === "read";
};
```

Esistono due vie d'uscita tramite variabili d'ambiente per i casi in cui questo è effettivamente il modello previsto:

- `STORAGE_PUBLIC_READ=true` — il bucket è una CDN pubblica di sola lettura. Senza un
  hook `storageAuthorize`, scritture, eliminazioni ed elenchi sono riservati esclusivamente agli amministratori.
- `STORAGE_ALLOW_ANY_AUTHENTICATED=true` — ogni utente autenticato è autorizzato per
  qualsiasi file. Sostenibile per un'app single-tenant, mai per una multi-tenant.

## Storage in produzione

Senza alcun bucket configurato, lo storage è **disattivato** in produzione e i caricamenti rispondono
con `501`. Il disco locale è il filesystem del container, quindi i file scritti lì svaniscono al
riavvio successivo — un caricamento che fallisce in modo evidente può essere ritentato, mentre uno riuscito
su un disco in procinto di essere cancellato non può esserlo. Imposta `FORCE_LOCAL_STORAGE=true` solo quando un
volume durevole è effettivamente montato.

Quel volume deve contenere ogni bucket locale, non solo quello predefinito. La directory
di un bucket locale con nome si trova accanto a quella del predefinito, `<STORAGE_PATH>__<key>`.
Con `STORAGE_PATH=/storage/uploads`, `bucket("media", { engine: "local" })`
scrive su `/storage/uploads__media`. Monta il volume sul loro elemento genitore,
`/storage`, come fa il file compose generato da `rebase init`, e non su
`STORAGE_PATH` stesso. `STORAGE_PATH__MEDIA` imposta esplicitamente la directory di un singolo bucket.
Consulta [Self-hosting](/docs/deployment/self-hosting/#file-storage).

La dichiarazione di
bucket non modifica il bucket predefinito. Con solo `bucket("media")`
dichiarato, il predefinito continua a leggere le proprie variabili. In sviluppo è
`./uploads`. In produzione, senza binding, è disattivato come qualsiasi bucket privo di binding: i caricamenti
che non specificano alcuna `source` rispondono con `501 STORAGE_NOT_CONFIGURED`. L'avvio lo segnala
una volta sola, indicando entrambe le soluzioni: collegalo (`STORAGE_TYPE=s3` e `S3_BUCKET`, oppure
`STORAGE_TYPE=gcs` e `GCS_BUCKET`), o contrassegna un bucket con nome come `default: true`.

In fase di sviluppo, un bucket dichiarato a cui nulla effettua il bind è una directory locale —
`uploads__media` accanto al predefinito `uploads` — qualunque sia l'engine dichiarato, quindi
`bucket("media", { engine: "s3" })` insieme a `rebase dev` è sufficiente per caricare un
file. L'avvio indica per quale engine la directory funge da sostituto, e `rebase
status` lo mostra in giallo accanto al segno di spunta. Questo non accade mai in produzione,
o sul runtime gestito: un bucket inventato lì scriverebbe i caricamenti nel filesystem
di un container che svanisce al rollout successivo, quindi un bucket non associato
rimane privo di binding e risponde 501.

## Contenuti correlati

- [Panoramica del backend](/docs/backend/) — dove risiede ciascuna dichiarazione
- [Configurazione dello storage](/docs/backend/storage/) — la stessa struttura per i bucket
- [Ambiente e configurazione](/docs/getting-started/configuration/) — la convenzione `__SUFFIX` che associa una sorgente alle sue variabili
