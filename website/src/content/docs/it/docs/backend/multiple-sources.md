---
sourceHash: ec729d5ce6fb4036
title: Database e Bucket Multipli
sidebar_label: Origini Multiple
description: Instrada le collezioni verso database diversi e le proprietà verso bucket di archiviazione diversi, e configura ciascuno di essi dall'ambiente.
---

## Panoramica

Un progetto non è limitato a un solo database e un solo bucket. Ogni cosa con un nome di cui un progetto ha bisogno — un database, un bucket, un topic, una coda — si **dichiara con un costruttore nella tua configurazione**, e si configura dall'ambiente tramite una variabile derivata dalla sua chiave. I cron e le funzioni sono file, ed entrano nello stesso grafo sotto il nome del file.

Una sola regola, qualunque sia il tipo: non esiste un secondo posto in cui guardare, e non c'è nulla da mantenere sincronizzato a mano.

## Dichiarare le risorse

Mettile in `config/resources.ts`. Esportarle è buona pratica — ti dà qualcosa da
importare — ma ciò che le registra è la dichiarazione.

```ts
// config/resources.ts
import { bucket, database, queue, topic } from "@rebasepro/types";

/** Il database del progetto. Legge DATABASE_URL, come sempre. */
export const main = database();

/** Un secondo database. Legge DATABASE_URL__ANALYTICS. */
export const analytics = database("analytics", { label: "Analytics warehouse" });

/** Un bucket. Legge S3_BUCKET__MEDIA. */
export const media = bucket("media", { engine: "s3", label: "Public media" });

/** Un topic, recapitato tramite la coda di lavori durevole. */
export const signups = topic<{ userId: string }>("signups");

signups.subscription("send-welcome", async (event) => {
    // …
});
```

`queue()` è nuovo <span class="since-badge" data-since="0.18">Since 0.18</span>. `database()`, `bucket()` e `topic()`
sono dichiarabili dalla 0.17, quindi un progetto sulla versione rilasciata
dichiara quei tre e raggiunge il lavoro in background tramite `jobs.tasks`.

Quindi indirizza una collezione verso una di esse, tramite handle — lo stesso
nome, scritto una volta sola:

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

...o una proprietà di un file:

```ts
import { media } from "../resources";

coverImage: {
    name: "Cover image",
    type: "string",
    storage: { storageSource: media, acceptedFiles: ["image/*"] }
}
```

`defineCollection` registra la chiave dell'handle, quindi da lì in poi una collezione è dato semplice: si serializza, si confronta, raggiunge la UI di amministrazione. La forma stringa (`dataSource: "analytics"`) funziona ancora; l'handle è quello che una rinomina segue e su cui atterra "vai alla definizione".

In una funzione, gli stessi handle raggiungono la risorsa:

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

### Vedere ciò che hai dichiarato

<span class="since-badge" data-since="0.18">Since 0.18</span>

```bash
rebase resources            # elencale
rebase resources --write    # rigenera rebase.resources.json
rebase resources --check    # fallisce se quel file è obsoleto
```

`rebase.resources.json` è **generato** e va committato. È ciò che un host legge per decidere cosa approvvigionare *prima* di eseguire qualsiasi cosa — è così che una console può dire "questo progetto vuole un bucket `media` e non ne ha nessuno" al primo deploy. Modifica le dichiarazioni, mai il file; `--check` fa fallire una build se i due divergono.

Ogni voce registra anche **chi la usa** — `collection:page_views` su un database, `property:posts.cover` su un bucket, `function:report` su ciò che la funzione importa da `resources.ts`. È la mappa di cui una console ha bisogno per rispondere a "cosa si rompe se rimuovo questo".

`rebase status` va un passo oltre: per ogni dichiarazione dice se l'ambiente la lega, usando gli stessi resolver che usa l'avvio, quindi non può rassicurarti su una distribuzione che sta per rifiutarsi di partire.

### Un motore di cui la build non ha mai sentito parlare

Ogni tipo possiede la propria lista di motori, e uno sconosciuto viene rifiutato al punto di chiamata anziché accettato e messo in errore più tardi. Qualcosa di davvero fuori dalla lista si scrive `custom:`:

```ts
export const objects = bucket("objects", { engine: "custom:minio" });
```

### Correggere un kind già pubblicato

<span class="since-badge" data-since="0.18">Since 0.18</span>

Per gli autori di driver. La definizione registrata di un kind di risorsa è
**congelata** nel momento in cui viene pubblicato un pacchetto che la contiene:
ogni driver pubblicato incorpora la propria copia di `@rebasepro/types`, e
quella copia confronta la voce del registro condiviso con il proprio literal e
solleva un errore a ogni differenza. Modificare il literal uccide quindi ogni
bundle costruito con un driver più vecchio, al caricamento del driver.

`amendResourceKind` corregge ciò a cui un kind *si lega* — le sue basi di
variabili d'ambiente, le sue chiavi di opzione — senza toccare il literal che
una copia più vecchia confronta:

```ts
import { amendResourceKind } from "@rebasepro/types";

amendResourceKind("database", {
    envBases: ["DATABASE_URL", "DATABASE_READ_URL", "ADMIN_CONNECTION_STRING"]
});
```

La correzione vale solo per le letture attraverso questa copia, quindi un driver
più vecchio continua a legarsi come faceva quando è stato pubblicato. Usala per
ogni correzione a un kind già pubblicato; usa `registerResourceKind` solo per un
kind che nessuno ha pubblicato.

### Consegnarle al frontend

Il provider `<Rebase>` deve sapere quali origini esistono e come si raggiunge ciascuna — un'origine `direct` è una con cui parla il browser stesso. Importa lo stesso pacchetto di configurazione del backend, quindi può riutilizzare le dichiarazioni invece di ripeterle:

```tsx
import "../config/resources";                 // le registra
import { declaredDataSources, declaredStorageSources } from "@rebasepro/types";

<Rebase
    dataSources={declaredDataSources()}
    storageSources={declaredStorageSources()}
>
    {children}
</Rebase>
```

L'import per effetto collaterale è voluto: è la dichiarazione a registrare, quindi un bundler che scartasse un modulo inutilizzato lascerebbe entrambe le liste vuote.

## Configurare ciascuna origine

I nomi delle variabili d'ambiente sono derivati dalla chiave della risorsa, quindi non c'è nulla da mantenere sincronizzato manualmente:

```
<VARIABLE>              the default resource   DATABASE_URL, S3_BUCKET
<VARIABLE>__<KEY>       a named resource       DATABASE_URL__ANALYTICS, S3_BUCKET__MEDIA
```

La chiave viene convertita in maiuscolo e i caratteri non alfanumerici diventano trattini bassi (underscore), quindi `media-cdn` legge `S3_BUCKET__MEDIA_CDN`.

Il separatore è intenzionalmente un **doppio** trattino basso. Uno singolo andrebbe in collisione con i nomi di variabili reali: `S3_BUCKET_NAME` verrebbe interpretato come il bucket per un'origine chiamata `name`.

### Database

```bash
DATABASE_URL=postgres://localhost/app
DATABASE_URL__ANALYTICS=postgres://warehouse.internal/analytics

# Optional, per source:
DB_POOL_MAX__ANALYTICS=5
REBASE_DRIVER__ANALYTICS=@rebasepro/server-postgres
```

Il driver viene scelto dall'`engine` dichiarato (`postgres` e `mongodb` sono quelli noti) e `REBASE_DRIVER__<KEY>` lo sovrascrive per qualsiasi altra cosa. `REBASE_DB_POOL_MAX` è un tetto valido per l'intero processo, non un legame per singola origine, quindi non prende suffisso.

In sviluppo non imposti nulla di tutto questo: `rebase dev` serve ogni database dichiarato dal suo Postgres gestito — una seconda istanza per `analytics`, avviata su richiesta — ed esporta `DATABASE_URL__ANALYTICS` da sé. Una variabile impostata a mano non viene mai sovrascritta.

Tabelle e policy di sicurezza a livello di riga vengono approvvigionate **per origine**: una collezione instradata su `analytics` ottiene la sua tabella, e le sue policy, nel database analytics.

### Archiviazione

```bash
S3_BUCKET__MEDIA=my-media-bucket
S3_REGION__MEDIA=eu-central-1
S3_ACCESS_KEY_ID__MEDIA=…
S3_SECRET_ACCESS_KEY__MEDIA=…
```

Il motore viene dalla dichiarazione, quindi non c'è alcuno `STORAGE_TYPE` da impostare.

#### Quale bucket riceve un caricamento non qualificato

Una proprietà di storage che non nomina alcuna `storageSource` scrive nel bucket
**predefinito**, e un progetto con bucket nominati deve dire quale sia. O
dichiari il bucket con la chiave predefinita — `export const uploads =
bucket();` — oppure contrassegni uno di quelli nominati:

```ts
export const media = bucket("media", { engine: "s3", default: true });
```

Senza nessuna delle due, l'avvio promuove il primo bucket nominato dichiarato e
avverte, nominando entrambe le soluzioni. Scegline una: una promozione decide
dove finiscono i file di un utente in base all'ordine di dichiarazione, e la
risposta cambia ai due lati di un deploy, perché il bucket locale con cui lo
sviluppo fa da sostituto viene scartato in produzione e la promozione no.

### Più bucket su un solo account

Ogni variabile viene letta per chiave: è corretto per il *nome* del bucket e
sbagliato per le credenziali — quindici bucket sulla stessa installazione MinIO
significherebbero quindici copie della stessa access key. Indica un `account` e
le variabili a livello di provider vengono lette una volta sola:

```ts
export const media   = bucket("media",   { engine: "s3", account: "minio" });
export const avatars = bucket("avatars", { engine: "s3", account: "minio" });
```

```bash
S3_BUCKET__MEDIA=project-media       # per bucket, mai condiviso
S3_BUCKET__AVATARS=project-avatars
S3_ACCESS_KEY_ID__MINIO=…            # letta una volta, da entrambi
S3_SECRET_ACCESS_KEY__MINIO=…
S3_ENDPOINT__MINIO=https://minio.internal
```

La forma con account copre le variabili che descrivono il *provider*:
`S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_ENDPOINT`, `S3_REGION`,
`S3_FORCE_PATH_STYLE`, `GCS_PROJECT_ID` e `GCS_KEY_FILENAME`. Il nome del bucket
non è tra queste e non ricade mai sull'account: se lo facesse, due bucket sullo
stesso account diventerebbero silenziosamente uno solo.

Un valore per singolo bucket ha comunque la precedenza, quindi una fonte può
essere spostata su un altro provider senza staccare le altre dall'account
condiviso. Non esiste deliberatamente alcun ripiego sulla variabile senza
suffisso: quella appartiene alla fonte predefinita, e lasciare che un bucket con
nome la erediti significherebbe che una chiave digitata male firma con le
credenziali di un'altra fonte.

## Topic e code

Un topic viene recapitato tramite la coda di lavori durevole: pubblicare scrive **una riga per sottoscrizione**, così ogni sottoscrittore ritenta secondo il proprio calendario e uno guasto non blocca gli altri né li fa rieseguire.

```ts
await signups.publish({ userId });
```

Una coda è l'altra forma del lavoro in background: una lista di lavori con **un solo handler**, in cui il chiamante conserva l'id del job. Le code sono nuove
<span class="since-badge" data-since="0.18">Since 0.18</span> — i topic sono arrivati con la 0.17.

```ts
export const thumbnails = queue<{ key: string }>("thumbnails");
thumbnails.handler(async ({ key }, { attempt }) => { /* … */ });

const { id } = await thumbnails.enqueue({ key }, { runAt: new Date(Date.now() + 60_000) });
```

Entrambi sono **at-least-once**. Un worker che muore tenendo un job lo rilascia e il successivo riparte con l'handler dall'inizio, quindi un handler deve tollerare di vedere un evento due volte. Pubblicare o accodare dentro una transazione che viene annullata non è mai accaduto: è l'inserimento di una riga.

Dichiarare l'uno o l'altra accende da sola la coda di lavori, su ogni percorso di avvio — un progetto sul runtime gestito, che non ha un entrypoint attraverso cui passare `jobs.tasks`, ottiene i suoi handler per questa via. Pubblicare su un topic che nessuno dichiara, o accodare su una coda senza handler, solleva un errore invece di scrivere righe che nessun worker gestisce.

## Cron e funzioni

Entrambi sono file — `backend/crons/<name>.ts`, `backend/functions/<name>.ts` — ed entrambi entrano nel grafo sotto il nome del file, che è anche l'id con cui lo scheduler esegue un cron e il percorso su cui una funzione viene montata. Nessuno dei due si lega dall'ambiente; stanno nel grafo perché un host conosca i calendari di un progetto prima di eseguire qualsiasi cosa.

```ts
export default defineCron({
    name: "Nightly cleanup",
    schedule: "0 3 * * *",
    timezone: "Europe/Madrid",
    async handler({ rebase }) { /* … */ }
});
```

Senza `timezone` il calendario viene letto nel fuso dell'host — UTC in quasi ogni container, il tuo su un portatile — quindi `0 3 * * *` indica un'ora diversa ai due lati di un deploy. Un fuso sconosciuto viene rifiutato al caricamento del job.

## Comportamento in caso di errore

Un'origine dati con trasporto server dichiarata ma priva di stringa di connessione **fa fallire l'avvio**, indicando la variabile da impostare. Questo è intenzionale ed è importante capirne il motivo: l'alternativa è che le collezioni instradate verso l'origine mancante ripieghino silenziosamente sul database predefinito. Ciò significherebbe dati che finiscono nel posto sbagliato dietro un server che si dichiara operativo: molto peggio di un container che si rifiuta di avviarsi.

Anche due chiavi che deriverebbero lo stesso nome di variabile vengono rifiutate, perché una di esse leggerebbe silenziosamente la configurazione dell'altra.

Le origini dichiarate con `transport: "direct"` vengono ignorate completamente: il client comunica direttamente con esse, quindi il backend non mantiene alcuna connessione e non richiede alcuna configurazione per esse.

## Controllo degli accessi all'archiviazione

Le chiavi di archiviazione condividono un unico namespace piatto e non sono soggette a sicurezza a livello di riga (row-level security), quindi senza un modello esplicito di controllo degli accessi il comportamento predefinito sarebbe "qualsiasi utente autenticato può leggere, sovrascrivere, eliminare o elencare qualsiasi oggetto". L'ambiente di produzione si rifiuta di avviarsi piuttosto che dare per scontato ciò.

Il modo per definire cosa significa accesso per il tuo progetto è un export `storageAuthorize` dal pacchetto di configurazione: una funzione, poiché nessuna variabile d'ambiente può esprimere "questo utente può leggere questa chiave":

```ts
// config/index.ts
import type { StorageAuthorize } from "@rebasepro/types";

export const storageAuthorize: StorageAuthorize = async ({ key, user, operation }) => {
    if (!user) return false;
    const [ownerId] = key.split("/");
    return ownerId === user.uid || operation === "read";
};
```

Esistono due scorciatoie tramite variabili d'ambiente per i casi in cui quello sia realmente il modello adottato:

- `STORAGE_PUBLIC_READ=true` — il bucket è una CDN pubblica in sola lettura. Le scritture, le eliminazioni e l'elenco richiedono comunque l'autenticazione.
- `STORAGE_ALLOW_ANY_AUTHENTICATED=true` — ogni utente autenticato ha accesso a qualsiasi file. Difendibile per un'applicazione single-tenant, mai per una multi-tenant.

## Archiviazione in produzione

Senza un bucket configurato, l'archiviazione è **disattivata** in produzione e i caricamenti rispondono con `501`. Il disco locale è il filesystem del container, quindi i file scritti lì scompaiono al riavvio successivo: un caricamento che fallisce con un errore chiaro può essere riprovato, uno che ha avuto successo su un disco che sta per essere cancellato no. Imposta `FORCE_LOCAL_STORAGE=true` solo quando è realmente montato un volume duraturo.

Una conseguenza che vale la pena conoscere se dichiari esplicitamente i bucket: non viene inventato alcun bucket predefinito al tuo posto. Dichiarare solo `bucket("media")` significa che non esiste un bucket predefinito, e una proprietà che non ne nomina uno non ha una destinazione — deliberatamente, e allo stesso modo sia in sviluppo che in produzione. Aggiungi anche `bucket()` se ne vuoi uno.

In sviluppo, un bucket dichiarato che nulla lega è una directory locale — `uploads__media` accanto a `uploads` predefinito — qualunque motore dichiari, quindi `bucket("media", { engine: "s3" })` più `rebase dev` basta per caricare un file. L'avvio dice per quale motore la directory sta facendo da sostituto, e `rebase status` lo mostra in giallo accanto al segno di spunta. Questo non accade mai in produzione, né sul runtime gestito: un bucket inventato lì scriverebbe i caricamenti su un filesystem di container che scompare al rollout successivo, quindi un bucket non legato resta non legato e risponde 501.

## Correlati

- [Panoramica del backend](/docs/backend/) — `dataSources` e dove vive la dichiarazione
- [Configurazione dell'archiviazione](/docs/backend/storage/) — la stessa forma per i bucket
- [Ambiente e configurazione](/docs/getting-started/configuration/) — la convenzione `__SUFFIX` che lega un'origine alle sue variabili

---
