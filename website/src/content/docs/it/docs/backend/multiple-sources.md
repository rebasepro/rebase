---
sourceHash: 6eb6098e26cb24c0
title: Database e Bucket Multipli
sidebar_label: Sorgenti Multiple
description: Indirizza le collection a database diversi e le proprietà a bucket di archiviazione diversi, configurando ciascuno dall'ambiente.
---

## Panoramica

Un progetto non è limitato a un solo database e un solo bucket. Ogni elemento con nome di cui un progetto ha bisogno — un database, un bucket, un topic, una coda — viene **dichiarato con un costruttore nella configurazione** e configurato dall'ambiente tramite una variabile derivata dalla sua chiave. Cron e funzioni sono file ed entrano nello stesso grafo sotto il nome del file.

Una sola regola, qualunque sia la tipologia: non c'è un secondo posto in cui guardare e non c'è nulla da mantenere sincronizzato a mano.

## Dichiarazione delle risorse

Inseriscile in `config/resources.ts`. Esportarle è una buona pratica — ti fornisce qualcosa da importare — ma è la dichiarazione che le registra.

```ts
// config/resources.ts
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

`queue()` è nuovo. `database()`, `bucket()` e `topic()` sono dichiarabili dalla versione 0.17, quindi un progetto sulla versione rilasciata dichiara questi tre e gestisce i processi in background tramite `jobs.tasks`.

Quindi punta una collection a una risorsa, tramite l'handle — lo stesso nome, scritto una sola volta:

```ts
import { defineCollection } from "@rebasepro/cms-types";
import { analytics } from "../resources";

const pageViewsCollection = defineCollection({
    name: "Page Views",
    slug: "page_views",
    table: "page_views",
    dataSource: analytics,
    properties: { /* … */ }
});
```

...oppure una proprietà di tipo file:

```ts
import { media } from "../resources";

coverImage: {
    name: "Cover image",
    type: "string",
    storage: { storageSource: media, acceptedFiles: ["image/*"] }
}
```

`defineCollection` registra la chiave dell'handle, quindi oltre quel punto una collection è costituita da semplici dati — si serializza, si confronta, raggiunge l'interfaccia utente di amministrazione. La forma in formato stringa (`dataSource: "analytics"`) funziona ancora; l'handle è quello che viene tracciato da una ridenominazione e su cui atterra la funzionalità "vai alla definizione".

In una funzione, gli stessi handle accedono alla risorsa:

```ts
import { defineFunction } from "@rebasepro/server/functions";
import { analytics, media } from "../../config/resources";

export default defineFunction((app, { rebase }) => {
    app.post("/report", async (c) => {
        const rows = await rebase.sql("select count(*) from page_views", { database: analytics });
        const file = new File([JSON.stringify(rows)], "report.json", { type: "application/json" });
        await rebase.bucket(media).putObject({ key: "report.json", file });
        return c.json({ ok: true });
    });
});
```

### Visualizzare ciò che hai dichiarato

```bash
rebase resources            # list them
rebase resources --write    # regenerate rebase.resources.json
rebase resources --check    # fail if that file is stale
```

`rebase.resources.json` viene **generato** e salvato nel commit. È ciò che un host legge per decidere cosa sottoporre a provisioning *prima* di eseguire qualsiasi cosa — ed è così che una console può indicare "questo progetto richiede un bucket `media` e non ne ha nessuno" al primo deploy. Modifica le dichiarazioni, mai il file; `--check` interrompe la build con un errore se i due non concordano.

Ciascuna voce registra anche **chi la usa** — `collection:page_views` su un database, `property:posts.cover` su un bucket, `function:report` su qualsiasi cosa la funzione importi da `resources.ts`. Questa è la mappa di cui una console ha bisogno per rispondere a "cosa si rompe se rimuovo questo".

`rebase status` fa un passo in più: per ogni dichiarazione indica se l'ambiente la associa (bind), utilizzando gli stessi resolver usati dall'avvio (boot), quindi non può rassicurarti su un deployment che sta per rifiutarsi di avviarsi.

### Un engine sconosciuto alla build

Ogni tipo possiede il proprio elenco di engine, e uno sconosciuto viene rifiutato nel punto di chiamata anziché essere accettato per poi fallire successivamente. Qualcosa che si trova realmente al di fuori dell'elenco viene indicato con `custom:`:

```ts
export const objects = bucket("objects", { engine: "custom:minio" });
```

### Correggere un kind già distribuito

Per gli autori di driver. La definizione registrata di un tipo di risorsa (resource kind) è **congelata** una volta pubblicato il pacchetto che la contiene: ogni driver pubblicato incorpora la propria copia di `@rebasepro/types`, e la copia confronta la voce del registro condiviso con il proprio letterale e genera un'eccezione a fronte di qualsiasi differenza. La modifica del letterale manda quindi in crash, al caricamento del driver, qualsiasi bundle compilato con un driver precedente.

`amendResourceKind` corregge ciò a cui un kind si *associa* — le sue basi di ambiente, le chiavi delle sue opzioni — senza toccare il letterale che qualsiasi copia più vecchia confronta:

```ts
import { amendResourceKind } from "@rebasepro/types";

amendResourceKind("database", {
    envBases: ["DATABASE_URL", "DATABASE_READ_URL", "ADMIN_CONNECTION_STRING"]
});
```

La modifica si applica solo alle letture tramite questa copia, quindi un driver meno recente continua a eseguire l'associazione nel modo in cui faceva al momento della pubblicazione. Usalo per ogni correzione a un kind già distribuito; usa `registerResourceKind` solo per un kind che nessuno ha ancora pubblicato.

### Passarli al frontend

Il provider `<Rebase>` ha bisogno di sapere quali sorgenti esistono e come ciascuna viene raggiunta — una sorgente `direct` è una con cui il browser comunica direttamente. Importa lo stesso pacchetto di configurazione del backend, potendo così riutilizzare le dichiarazioni anziché ripeterle:

```tsx
import "../config/resources";                 // registers them
import { declaredDataSources, declaredStorageSources } from "@rebasepro/types";

<Rebase
    dataSources={declaredDataSources()}
    storageSources={declaredStorageSources()}
>
    {children}
</Rebase>
```

L'import con effetti collaterali (side-effect import) è intenzionale: è la dichiarazione che effettua la registrazione, quindi un bundler che scartasse un modulo inutilizzato lascerebbe vuoti entrambi gli elenchi.

## Configurare ciascuna sorgente

I nomi delle variabili d'ambiente sono derivati dalla chiave della risorsa, quindi non c'è nulla da mantenere sincronizzato manualmente:

```
<VARIABLE>              the default resource   DATABASE_URL, S3_BUCKET
<VARIABLE>__<KEY>       a named resource       DATABASE_URL__ANALYTICS, S3_BUCKET__MEDIA
```

La chiave viene convertita in maiuscolo e i caratteri non alfanumerici diventano underscore, quindi `media-cdn` legge `S3_BUCKET__MEDIA_CDN`.

Il separatore è intenzionalmente un **doppio** underscore. Uno singolo entrerebbe in conflitto con i nomi di variabili reali — `S3_BUCKET_NAME` verrebbe interpretato come il bucket per una sorgente chiamata `name`.

### Database

```bash
DATABASE_URL=postgres://localhost/app
DATABASE_URL__ANALYTICS=postgres://warehouse.internal/analytics

# Optional, per source:
DB_POOL_MAX__ANALYTICS=5
REBASE_DRIVER__ANALYTICS=@rebasepro/server-postgres
```

Il driver viene scelto in base all'`engine` dichiarato (`postgres` e `mongodb` sono noti), e `REBASE_DRIVER__<KEY>` ne esegue l'override per qualsiasi altra cosa. `REBASE_DB_POOL_MAX` è un limite per l'intero processo, non un binding per sorgente, quindi non accetta alcun suffisso.

In fase di sviluppo non è necessario impostare nulla di tutto questo: `rebase dev` serve ogni database dichiarato dal suo Postgres gestito — una seconda istanza per `analytics`, avviata su richiesta — ed esporta direttamente `DATABASE_URL__ANALYTICS`. Una variabile impostata manualmente non viene mai sovrascritta.

Le tabelle e le policy di row-level security vengono sottoposte a provisioning **per sorgente**: una collection indirizzata ad `analytics` riceve la sua tabella, e le sue policy, nel database analytics.

### Storage

```bash
S3_BUCKET__MEDIA=my-media-bucket
S3_REGION__MEDIA=eu-central-1
S3_ACCESS_KEY_ID__MEDIA=…
S3_SECRET_ACCESS_KEY__MEDIA=…
```

L'engine viene ricavato dalla dichiarazione, quindi non c'è alcun `STORAGE_TYPE` da impostare.

#### Quale bucket riceve un upload non qualificato

<span class="since-badge" data-since="0.25">Da 0.25</span>

Una proprietà di storage che non specifica alcuna `storageSource` scrive nel bucket di **default**.
Dichiarare bucket con nome non lo sposta mai. Il default mantiene la propria configurazione
qualunque cosa dichiari `config/resources.ts`: `STORAGE_TYPE`, `STORAGE_PATH` (`./uploads`
quando non è impostato) e le variabili `S3_*` / `GCS_*` senza suffisso. Aggiungere
`bucket("media", { engine: "s3" })` a un progetto che ha già file in `./uploads` li lascia
dove sono e ancora serviti. `media` legge le proprie variabili `__MEDIA` e, in sviluppo, fa le
veci di una propria directory, `uploads__media`.

Per inviare invece gli upload non qualificati a un bucket con nome, contrassegnalo:

```ts
export const media = bucket("media", { engine: "s3", default: true });
```

Il default allora *è* `media`. I file che il default conteneva prima restano dove sono e non
vengono più serviti attraverso di esso, quindi copiali prima:
`rebase storage move --from "(default)" --to media`.

Due sorgenti non possono condividere una posizione. Se un bucket con nome si risolvesse nella
directory del default (o in una al suo interno), oppure nello stesso bucket di un object store
sullo stesso endpoint, il boot si rifiuta e nomina la variabile da cambiare.

Su 0.24, un progetto che dichiara solo bucket con nome vede il primo dichiarato promosso a
default al boot, con un avviso, quindi aggiungere `bucket("media")` sposta il default su
`uploads__media`.

### Più bucket su un unico account

Ogni variabile viene letta per chiave, il che è corretto per il nome del bucket ma non per le credenziali — quindici bucket su una sola installazione MinIO significherebbero quindici copie della stessa chiave di accesso. Specifica un `account` e le variabili a livello di provider verranno lette una volta sola:

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

La forma account copre le variabili che descrivono il *provider*: `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_ENDPOINT`, `S3_REGION`, `S3_FORCE_PATH_STYLE`, `GCS_PROJECT_ID` e `GCS_KEY_FILENAME`. Il nome del bucket non è tra queste e non usa mai un fallback — se lo facesse, due bucket sullo stesso account diventerebbero silenziosamente uno solo.

Un valore impostato per singolo bucket ha comunque la precedenza, quindi una singola sorgente può essere spostata su un altro provider senza staccare le altre dal loro account condiviso. Non esiste deliberatamente alcun fallback alla variabile senza suffisso: quella appartiene alla sorgente di default, e permettere a un bucket con nome di ereditarla significherebbe che un errore di battitura nella chiave porterebbe a firmare con le credenziali di un'altra sorgente.

## Topic e code

Un topic viene distribuito tramite la coda di job persistente (durable job queue): la pubblicazione scrive **una riga per sottoscrizione**, in modo che ciascun subscriber riprovi secondo la propria pianificazione e uno che fallisce non blocca gli altri né li costringe a essere rieseguiti.

```ts
await signups.publish({ userId });
```

Una coda è l'altra forma di elaborazione in background: un elenco di lavoro con **un solo gestore (handler)**, in cui il chiamante detiene l'id del job. Le code sono una novità — i topic sono stati introdotti nella versione 0.17.

```ts
export const thumbnails = queue<{ key: string }>("thumbnails");
thumbnails.handler(async ({ key }, { attempt }) => { /* … */ });

const { id } = await thumbnails.enqueue({ key }, { runAt: new Date(Date.now() + 60_000) });
```

Entrambi sono di tipo **at-least-once** (almeno una volta). Un worker che si arresta anomalo mentre gestisce un job lo rilascia e il successivo avvia l'handler dall'inizio, quindi un handler deve tollerare la ricezione di un evento due volte. La pubblicazione o l'accodamento all'interno di una transazione che esegue un rollback non è mai avvenuto — si tratta dell'inserimento di una riga.

La dichiarazione di uno dei due attiva automaticamente la coda dei job, in qualsiasi percorso di avvio — un progetto sul runtime gestito, che non ha un entrypoint attraverso cui passare `jobs.tasks`, ottiene i propri handler in questo modo. La pubblicazione su un topic che nessuno dichiara, o l'accodamento su una coda priva di handler, genera un errore (throw) anziché scrivere righe che nessun worker gestisce.

## Cron e funzioni

Entrambi sono file — `backend/crons/<name>.ts`, `backend/functions/<name>.ts` — ed entrambi entrano nel grafo sotto il nome del file, che è anche l'ID con cui lo scheduler esegue un cron e il percorso su cui viene montata una funzione. Nessuno dei due effettua il binding dall'ambiente; sono nel grafo affinché l'host conosca le pianificazioni del progetto prima di eseguire qualsiasi cosa.

```ts
export default defineCron({
    name: "Nightly cleanup",
    schedule: "0 3 * * *",
    timezone: "Europe/Madrid",
    async handler({ rebase }) { /* … */ }
});
```

Senza `timezone` la pianificazione viene letta nel fuso orario dell'host — UTC in quasi tutti i container, il tuo su un laptop — quindi `0 3 * * *` corrisponde a un'ora diversa a seconda dell'ambiente prima o dopo un deploy. Un fuso orario sconosciuto viene rifiutato al caricamento del job.

## Comportamento in caso di errore

Una data source con server-transport dichiarata ma priva di stringa di connessione **causa il fallimento del boot**, indicando la variabile da impostare. Questo comportamento è intenzionale e merita di essere compreso: l'alternativa sarebbe che le collection indirizzate alla sorgente mancante ripieghino silenziosamente sul database predefinito. Ciò significherebbe dati che finiscono nel posto sbagliato dietro a un server che si dichiara funzionante — una situazione di gran lunga peggiore rispetto a un container che si rifiuta di avviarsi.

Vengono rifiutate anche due chiavi che deriverebbero lo stesso nome di variabile, poiché una di esse leggerebbe silenziosamente la configurazione dell'altra.

Le sorgenti dichiarate con `transport: "direct"` vengono ignorate completamente: il client comunica direttamente con esse, quindi il backend non mantiene alcuna connessione né richiede alcuna configurazione per esse.

## Controllo degli accessi allo storage

Le chiavi di storage condividono un unico namespace piatto e non sono soggette a row-level security, quindi senza un modello di controllo accessi esplicito il default sarebbe "qualsiasi utente autenticato può leggere, sovrascrivere, eliminare o elencare qualsiasi oggetto". In produzione il sistema si rifiuta di avviarsi anziché assumere tale comportamento.

Il modo per definire cosa significhi l'accesso per il tuo progetto è esportare `storageAuthorize` dal pacchetto di configurazione — una funzione, poiché nessuna variabile d'ambiente può esprimere "questo utente può leggere questa chiave":

```ts
// config/index.ts
import type { StorageAuthorize } from "@rebasepro/types";

export const storageAuthorize: StorageAuthorize = async ({ key, user, operation }) => {
    if (!user) return false;
    const [ownerId] = key.split("/");
    return ownerId === user.uid || operation === "read";
};
```

Esistono due vie d'uscita (escape hatch) tramite variabili d'ambiente per i casi in cui questo sia effettivamente il modello desiderato:

- `STORAGE_PUBLIC_READ=true` — il bucket è un CDN pubblico di sola lettura. Scritture, eliminazioni e listing richiedono comunque l'autenticazione.
- `STORAGE_ALLOW_ANY_AUTHENTICATED=true` — ogni utente autenticato è autorizzato su ogni file. Difendibile per un'app a tenant singolo, mai per una multi-tenant.

## Storage in produzione

Senza alcun bucket configurato, lo storage è **disattivato** in produzione e gli upload rispondono con `501`. Il disco locale è il filesystem del container, quindi i file scritti lì svaniscono al riavvio successivo — un upload che fallisce in modo evidente può essere ritentato, mentre uno riuscito su un disco che sta per essere cancellato non può esserlo. Imposta `FORCE_LOCAL_STORAGE=true` solo quando è effettivamente montato un volume persistente.

Tale volume deve contenere tutti i bucket locali, non solo quello di default. La directory di un bucket locale con nome si trova accanto a quella predefinita, `<STORAGE_PATH>__<key>`. Con `STORAGE_PATH=/storage/uploads`, `bucket("media", { engine: "local" })` scrive su `/storage/uploads__media`. Monta il volume sulla directory genitore, `/storage`, come fa il file compose generato da `rebase init`, e non su `STORAGE_PATH` stesso. `STORAGE_PATH__MEDIA` imposta esplicitamente la directory di un bucket. Consulta [Self-hosting](/docs/deployment/self-hosting/#file-storage).

<span class="since-badge" data-since="0.25">Da 0.25</span> Dichiarare bucket non cambia il bucket di default. Con solo `bucket("media")` dichiarato, il default legge ancora le proprie variabili. In sviluppo è `./uploads`. In produzione, non associato, è disattivato come qualsiasi bucket non associato: gli upload che non specificano alcuna `storageSource` rispondono `501 STORAGE_NOT_CONFIGURED`. Il boot lo segnala una volta, con entrambe le soluzioni: associarlo (`STORAGE_TYPE=s3` e `S3_BUCKET`, oppure `STORAGE_TYPE=gcs` e `GCS_BUCKET`), oppure contrassegnare un bucket con nome `default: true`.

In sviluppo, un bucket dichiarato a cui non è associato nulla è una directory locale — `uploads__media` accanto al valore predefinito `uploads` — qualunque sia l'engine dichiarato, quindi `bucket("media", { engine: "s3" })` insieme a `rebase dev` è sufficiente per caricare un file. L'avvio (boot) indica quale engine la directory sta sostituendo e `rebase status` lo mostra in giallo accanto al segno di spunta. Questo non accade mai in produzione o sul runtime gestito: un bucket inventato lì scriverebbe i caricamenti sul filesystem di un container che svanisce al rollout successivo, quindi un bucket non associato rimane tale e risponde 501.

## Correlati

- [Backend Overview](/docs/backend/) — `dataSources` e dove risiede la dichiarazione
- [Storage Configuration](/docs/backend/storage/) — la stessa struttura per i bucket
- [Environment & Configuration](/docs/getting-started/configuration/) — la convenzione `__SUFFIX` che associa una sorgente alle sue variabili
