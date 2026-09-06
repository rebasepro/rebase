---
sourceHash: 7dadf2d57e6bfecf
title: Database e Bucket Multipli
sidebar_label: Origini Multiple
description: Instrada le collezioni verso database diversi e le proprietà verso bucket di archiviazione diversi, e configura ciascuno di essi dall'ambiente.
---

## Panoramica

Un progetto non è limitato a un solo database e un solo bucket. Le collezioni instradano già tramite `dataSource`, e le proprietà dei file instradano tramite `storageSource`; questa pagina spiega come ogni origine con nome ottiene la propria configurazione.

Due passaggi: **dichiara** le origini nel tuo pacchetto di configurazione, quindi **configura** ciascuna di esse con variabili d'ambiente derivate dalla sua chiave.

## Dichiarare le risorse

Ogni cosa con un nome di cui un progetto ha bisogno — un database, un bucket, un
topic — si **dichiara con un costruttore** in `config/resources.ts`. Una sola
regola, qualunque sia il tipo: non esiste un secondo posto in cui guardare.

```ts
// config/resources.ts
import { bucket, database, topic } from "@rebasepro/types";

/** Il database del progetto. Legge DATABASE_URL, come sempre. */
export const main = database();

/** Un secondo database. Legge DATABASE_URL__ANALYTICS. */
export const analytics = database("analytics", { label: "Analytics warehouse" });

/** Un bucket. Legge S3_BUCKET__MEDIA. */
export const media = bucket("media", { engine: "s3", label: "Public media" });

/** Un topic, recapitato tramite la coda di lavori durevole. */
export const signups = topic<{ userId: string }>("signups");
```

`rebase resources` elenca ciò che un progetto dichiara, `--write` rigenera
`rebase.resources.json` e `--check` fallisce se quel file è obsoleto. Quel file
è **generato** e va committato: è ciò che un host legge per decidere cosa
approvvigionare *prima* di eseguire qualsiasi cosa.

Un motore sconosciuto viene rifiutato al punto di chiamata, non più tardi. Per
uno che questa build non conosce si usa `custom:` — ad esempio
`bucket("objects", { engine: "custom:minio" })`.

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

### Quale bucket riceve un caricamento non qualificato

Una proprietà di storage che non nomina alcuna `storageSource` scrive nel bucket
**predefinito**, e un progetto con bucket nominati deve dire quale sia. O
dichiari il bucket predefinito — `export const uploads = bucket();` — oppure
contrassegni uno di quelli nominati:

```ts
export const media = bucket("media", { engine: "s3", default: true });
```

L'avvio rifiuta un progetto con bucket nominati e nessun predefinito, e nomina
entrambe le soluzioni. Prima veniva scelto il primo dichiarato, con un
avvertimento: così l'ordine di dichiarazione decideva dove finiscono i file di un
utente, e la risposta cambiava ai due lati di un deploy, perché il bucket locale
con cui lo sviluppo fa da sostituto viene scartato in produzione e la promozione
no.

Quindi indirizza una collezione verso una di esse:

```ts
import { defineCollection } from "@rebasepro/cms-types";
const pageViewsCollection = defineCollection({
    name: "Page Views",
    slug: "page_views",
    table: "page_views",
    dataSource: "analytics",
    properties: { /* … */ }
});
```

...o una proprietà di un file:

```ts
coverImage: {
    name: "Cover image",
    type: "string",
    storage: { storageSource: "media", acceptedFiles: ["image/*"] }
}
```

## Configurare ciascuna origine

I nomi delle variabili d'ambiente sono derivati dalla chiave dell'origine, quindi non c'è nulla da mantenere sincronizzato manualmente:

```
<VARIABLE>              the default source     DATABASE_URL, S3_BUCKET
<VARIABLE>__<KEY>       a named source         DATABASE_URL__ANALYTICS, S3_BUCKET__MEDIA
```

La chiave viene convertita in maiuscolo e i caratteri non alfanumerici diventano trattini bassi (underscore), quindi `media-cdn` legge `S3_BUCKET__MEDIA_CDN`.

Il separatore è intenzionalmente un **doppio** trattino basso. Uno singolo andrebbe in collisione con i nomi di variabili reali: `S3_BUCKET_NAME` verrebbe interpretato come il bucket per un'origine chiamata `name`.

### Database

```bash
DATABASE_URL=postgres://localhost/app
DATABASE_URL__ANALYTICS=postgres://warehouse.internal/analytics

# Optional, per source:
DB_POOL_MAX__ANALYTICS=5
ADMIN_CONNECTION_STRING__ANALYTICS=postgres://…
REBASE_DRIVER__ANALYTICS=@rebasepro/server-postgres
```

Il driver viene scelto dall'`engine` dichiarato (`postgres` e `mongodb` sono quelli noti) e `REBASE_DRIVER__<KEY>` lo sovrascrive per qualsiasi altra cosa.

### Archiviazione

```bash
STORAGE_TYPE__MEDIA=s3
S3_BUCKET__MEDIA=my-media-bucket
S3_REGION__MEDIA=eu-central-1
S3_ACCESS_KEY_ID__MEDIA=…
S3_SECRET_ACCESS_KEY__MEDIA=…
```

`STORAGE_TYPE__<KEY>` può essere omesso quando la dichiarazione specifica già l'engine.

### Più bucket su un solo account

Ogni variabile viene letta per chiave: è corretto per il *nome* del bucket e
sbagliato per le credenziali — quindici bucket sulla stessa installazione MinIO
significherebbero quindici copie della stessa access key. Indica un `account` e
le variabili a livello di provider vengono lette una volta sola:

```ts
export const media   = bucket("media",   { engine: "s3", account: "minio" });
export const avatars = bucket("avatars", { engine: "s3", account: "minio" });
```

```
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

Una conseguenza che vale la pena conoscere se dichiari esplicitamente le origini di archiviazione: non viene creato alcun bucket predefinito al tuo posto. Dichiarare solo un'origine `media` significa che non esiste alcuna origine `(default)`, e una proprietà che non ne specifica una non ha una destinazione — questo è intenzionale e funziona allo stesso modo sia in sviluppo che in produzione. Dichiara anche `(default)` se ne desideri una.

---
