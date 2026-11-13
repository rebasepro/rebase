---
sourceHash: 8412da52cc99478c
title: Rebase non supporta X
sidebar_label: Estendere il server
description: La scala di estensione lato server — dichiarazione, hook di tabella, funzione personalizzata, rotte personalizzate, server personalizzato, eject — con ciò che ciascun livello può e non può raggiungere.
---

## Panoramica

Qualcosa di cui hai bisogno non è presente nella definizione della tabella. Questa pagina indica l'ordine in cui
provare le diverse soluzioni e — cosa ancora più utile — ciò che ciascun livello *non* può
raggiungere, in modo da fermarsi a salire la scala non appena trovi quello adatto al tuo scopo.

Esiste una pagina corrispondente per il pannello di amministrazione:
[Estendere Rebase](/docs/frontend/extending) tratta plugin, slot, override dei componenti
e viste personalizzate. Questa pagina è dedicata al server.

La regola codificata dalla scala: **ogni gradino costa qualcosa che quello inferiore
manteneva.** Una dichiarazione è portabile, aggiornabile e compresa dal pianificatore
dello schema, dall'SDK generato e dal pannello di amministrazione. Nel momento in cui arrivi a
`rebase eject` diventi responsabile della sequenza di avvio, e gli aggiornamenti del runtime
della piattaforma non raggiungeranno più il tuo progetto. Quindi sali solo fino a dove è strettamente necessario.

## La scala

| # | Gradino | Cosa raggiunge | Cosa **non** raggiunge | Costo di questa scelta |
|---|---|---|---|---|
| 1 | **Dichiarazione** — una colonna, una relazione, un indice, un blocco `search`, una regola `rls` | Lo schema, l'SDK generato, il pannello di amministrazione, il migration planner | Qualsiasi cosa debba eseguire codice | Nessuno. Questo è il percorso supportato |
| 2 | **Hook di tabella** — `beforeQuery`, `afterRead`, `beforeSave`, `afterSave`, `beforeDelete`, `afterDelete` | Ogni lettura e scrittura di una tabella, su qualsiasi trasporto, all'interno della transazione della richiesta | Richieste che non toccano alcuna tabella; l'envelope della risposta; qualsiasi operazione asincrona rispetto alla scrittura | Viene eseguito sull'hot path, mantenendo aperta la transazione |
| 3 | **Funzione personalizzata** — un'app Hono in `functions/` | Il proprio URL, con l'autenticazione risolta, il driver limitato al chiamante e l'oggetto `rebase` a disposizione | Le rotte integrate `/api/data`. Si posiziona *accanto* ad esse, non davanti | Una superficie in più da autorizzare; nessun metodo SDK viene generato per essa |
| 4 | **Rotte e middleware personalizzati** sull'app Hono | Qualsiasi elemento HTTP, inclusi i percorsi eseguiti *prima* dei router di Rebase | Il driver e l'identità del chiamante, a meno che non protegga tu stesso la rotta | Fuori da ogni router di Rebase: nessun middleware di autenticazione è stato eseguito |
| 5 | **Server personalizzato** — compila il backend con `createRebaseBackend` e monta i gruppi di rotte desiderati, oppure integra solo il driver in Express, Fastify o semplice `http` | Ciascun gruppo di rotte, nel percorso scelto, e il controllo su quale processo avvia i timer; al livello minimo, solo l'adattatore dati e realtime | Con il solo driver: tutto il resto, dalle rotte di autenticazione e lo storage fino a cron e all'API admin | Chiami manualmente ogni passaggio che `initializeRebaseBackend` eseguiva per te |
| 6 | **`rebase eject`** | L'entrypoint e il `Dockerfile`, nel tuo repository | — | **Gli aggiornamenti del runtime della piattaforma smettono di raggiungere questo progetto.** CORS, configurazione dell'autenticazione, storage e arresto diventano tua responsabilità |

:::tip[Due gradini vengono comunemente saltati senza motivo]
`beforeQuery` (gradino 2) restringe una lettura *prima che venga compilata*, che è il
motivo per cui le persone di solito ricorrono al gradino 3 o 5. E un blocco `search` con
`mode: "hybrid"` (gradino 1) è ciò per cui le persone di solito ricorrono a SQL grezzo. Entrambi sono
abbastanza recenti, quindi le risposte più datate su internet non li menzionano.
:::

## 1. Dichiarazione

La maggior parte di ciò di cui un backend ha bisogno è una dichiarazione sulla tabella, poiché una
dichiarazione è l'unico gradino leggibile dal resto del sistema. Il pianificatore dello schema
la trasforma in DDL, il generatore di codice la trasforma in metodi SDK, il pannello di amministrazione
la renderizza e `rebase doctor` la confronta con il database attivo.

| Voglio… | Dichiarare | Riferimento |
|---|---|---|
| Aggiungere una colonna | una colonna `col.*` | [Colonne](/docs/schema/columns/) |
| Collegare due tabelle | una relazione `rel.*` | [Relazioni](/docs/collections/relations) |
| Rendere veloce una query | `indexes` | [Indici](/docs/backend/indexes) |
| Decidere chi può leggere o scrivere una riga | `rls` | [Sicurezza a livello di riga](/docs/collections/security-rules/) |
| Cercare testo correttamente — accenti, JSONB, ranking, sottostringhe | un blocco `search` | [Ricerca](/docs/backend/search) |
| Trovare righe per significato semantico | una colonna `col.vector()` | [Ricerca vettoriale](/docs/backend/vector-search/) |
| Mantenere le righe eliminate | `softDelete` | [Soft delete](/docs/collections/soft-delete) |
| Registrare chi ha modificato cosa | `history` | [Cronologia](/docs/backend/history) |
| Eseguire un'operazione pianificata | un file cron job | [Cron Job](/docs/backend/cron-jobs) |
| Eseguire un'operazione dopo una scrittura, fuori banda | un job | [Job](/docs/backend/jobs) |

**Cosa non può raggiungere:** qualsiasi cosa debba prendere una decisione al momento della richiesta.
Una dichiarazione è un dato. Se la risposta dipende da chi sta effettuando la richiesta, passa al gradino 2.

## 2. Hook di tabella

**Ambito:** una singola tabella, oppure ogni tabella quando esportati come `hooks` da
`backend/hooks.ts` (`initializeRebaseBackend({ hooks })` in caso di eject).

Gli hook scattano su **ogni** percorso dati — REST, SDK, sottoscrizioni WebSocket
e scritture lato server tramite `rebase.dataAsAdmin` — e ciascuno viene eseguito all'interno della
transazione aperta per quella specifica richiesta. Questo è il loro valore fondamentale: non esiste un modo
per accedere alle righe di una tabella che possa aggirarli.

| Hook | Quando scatta | Utilizzalo per |
|---|---|---|
| `beforeQuery` | prima che una lettura venga compilata | restringere **quali righe** una lettura richiede |
| `afterRead` | per ciascuna riga, dopo il recupero | redazione, mascheramento di PII, campi calcolati |
| `beforeSave` | dopo la validazione, prima della scrittura | valori predefiniti, colonne derivate, rifiuto di una scrittura |
| `afterSave` | dopo la scrittura, prima del commit | effetti collaterali che devono essere annullati insieme ad essa |
| `afterSaveError` | quando un salvataggio genera un errore | segnalazione errori; `props.error` contiene l'errore generato |
| `beforeDelete` | prima dell'eliminazione | rifiutare l'eliminazione |
| `afterDelete` | dopo l'eliminazione, prima del commit | operazioni di pulizia a cascata |

→ [Hook di tabella](/docs/collections/callbacks) ·
[Hook globali](/docs/backend/hooks)

### Restringere una lettura con `beforeQuery`

<span class="since-badge" data-since="0.31">Da 0.31</span>

`afterRead` intercetta righe che sono già state recuperate, quindi può oscurare un valore
ma non può impedire che la riga venga letta. `beforeQuery` viene eseguito prima: riceve la
query analizzata e restituisce condizioni da combinare in **AND** con essa.

```ts
// backend/schema/documents.ts
import { defineTable, col } from "@rebasepro/server/schema";

export const documents = defineTable("documents", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        tenantId: col.text(),
        body: col.text()
    },
    rls: "admin-only",
    hooks: {
        beforeQuery: ({ context }) => {
            if (context.user?.roles?.includes("admin")) return;        // no narrowing
            return { filter: { tenantId: ["==", context.user?.claims?.tenant ?? null] } };
        }
    }
});
```

Quattro caratteristiche importanti da conoscere prima di farvi affidamento:

- **Può solo restringere.** Il valore restituito è un filtro da aggiungere in AND, e non esiste
  alcun formato che possa restituire per ampliare la lettura. È una scelta intenzionale: un hook a cui
  viene passata la query chiedendogli di restituirne una potrebbe rimuovere una condizione, e su un
  piano dati con row-level security una condizione rimossa restituirebbe ogni riga consentita
  dalle policy.
- **Scatta su ogni percorso di lettura.** L'elenco, la lettura singola, il conteggio,
  l'aggregazione, la ricerca, la lettura vettoriale, un elenco su percorso nidificato, il recupero realtime
  che compone i frame di sottoscrizione e le righe caricate per una relazione o
  un `?include=` — dove è l'hook della tabella di **destinazione** ad applicarsi.
  Un hook rispettato dall'elenco ma non dal conteggio produce una pagina che mostra
  "1 di 4 risultati".
- **Un filtro che non può essere compilato rifiuta la richiesta.** Indicare una colonna non presente
  nella tabella genera un errore 400, non una condizione ignorata, indipendentemente da come
  sia impostato `configureUnknownFilterFields`.
- **Una scrittura su una riga esclusa restituisce 404.** Un aggiornamento o un'eliminazione indirizzati a
  una riga al di fuori dell'ambito viene rifiutata prima della scrittura, con la stessa risposta
  "nessuna riga …" fornita da una lettura — quindi un ambito è un ambito anche per le scritture, non solo per
  le letture. Ciò che *non* controlla sono i valori scritti: rifiutare una scrittura
  in base al suo contenuto è compito di `beforeSave`.

Una lettura non viene volutamente ristretta: il controllo di unicità alla base
di `.unique()`. Questo verifica se un valore esiste ovunque all'interno della
tabella; se fosse ristretto risponderebbe "univoco" per un valore già presente in una riga
nascosta — lasciando poi fallire l'inserimento sul vincolo del database.

**Cosa non possono raggiungere gli hook:**

- Una richiesta che non tocca alcuna tabella. Non c'è nulla a cui l'hook possa
  agganciarsi.
- L'envelope della risposta — codice di stato, header, struttura della paginazione. Un hook
  restituisce valori, non una risposta.
- Operazioni che devono sopravvivere alla transazione. `afterSave` viene eseguito *prima* del commit,
  quindi un errore generato al suo interno annulla la scrittura (rollback). Tutto ciò che deve sopravvivere
  all'annullamento della scrittura non fa parte della scrittura: inseriscilo nella
  [coda dei job](/docs/backend/jobs).
- Operazioni lente, nella pratica. Un hook mantiene aperta la transazione e, con essa, una
  connessione del pool. Qualsiasi comunicazione con terze parti appartiene alla coda dei job.

## 3. Funzioni personalizzate

**Ambito:** un singolo URL sotto `/api/functions`.

Un'app Hono in `backend/functions/`, rilevata in base al nome del file come avviene per i cron job,
o passata come valore (`functions: { promote }`). Il middleware di autenticazione è già stato eseguito quando viene raggiunto il tuo handler,
il driver è limitato all'ambito del chiamante e l'oggetto `rebase` è disponibile per storage, email,
job e `dataAsAdmin`.

```typescript
// backend/functions/promote.ts
import { defineFunction } from "@rebasepro/server/functions";

export default defineFunction((app, { rebase }) => {
    app.post("/", async (c) => {
        const { id } = await c.req.json<{ id: string }>();
        await rebase.dataAsAdmin.table("products").update(id, { featured: true });
        return c.json({ ok: true });
    });
});
```

→ [Funzioni personalizzate](/docs/backend/custom-functions)

**Cosa non può raggiungere:** le rotte integrate `/api/data`. Una funzione si posiziona
*accanto* ad esse, non davanti, quindi non può modificare il modo in cui un elenco viene
filtrato, paginato o strutturato — quello è il gradino 2. Inoltre non riceve alcun metodo SDK
generato; i chiamanti vi accedono tramite `client.functions.invoke(...)` o una semplice chiamata `fetch`.

## 4. Rotte e middleware personalizzati

**Ambito:** l'app Hono, prima che Rebase la modifichi.

`initializeRebaseBackend` accetta l'app che gli passi, quindi qualsiasi elemento registrato su
quell'app *prima* di invocarlo viene eseguito prima di ogni router di Rebase — consulta
[Ordine di registrazione delle rotte](/docs/backend/custom-functions#route-registration-order)
per i dettagli. Un gruppo di rotte montato autonomamente da `backend.routes` (gradino 5)
non fa parte di queste rotte: include già il proprio middleware di autenticazione.

:::caution[Nessun middleware di autenticazione è stato eseguito qui]
Una rotta registrata in questo modo si trova **all'esterno** di ogni router di Rebase, quindi
`getDriver(c)` non è impostato e nessun componente ha verificato il token. Proteggila con
`requireAuth` importato da **`@rebasepro/server`** — la radice del pacchetto — che
verifica il token autonomamente, poi usa `requireAdmin` o `requireScope` dallo stesso
import per stabilire cosa il chiamante può fare. I guard esportati da
`@rebasepro/server/functions` leggono un'identità già risolta da un router di Rebase,
e restituiranno un errore 500 anziché fingere che ne esista una.
:::

Un'insidia di Hono da tenere presente, poiché silenziosa: `app.use("/*", guard)` protegge
solo le rotte dichiarate *sotto* di esso. Una rotta aggiunta successivamente — in fondo
al file, mesi dopo — rimarrà non protetta. Inserisci i guard direttamente nello slot dei
middleware della rotta stessa.

**Cosa non può raggiungere:** l'identità, il driver vincolato all'ambito e l'envelope degli errori
— a meno che tu non configuri ciascuno di essi manualmente. Tutto ciò che un router di Rebase fornisce a un handler è
frutto delle operazioni svolte dal router stesso.

## 5. Server personalizzato

**Ambito:** il processo.

`initializeRebaseBackend` è una scorciatoia per alcune chiamate pubbliche, e questo gradino
consiste nel chiamarle direttamente. `createRebaseBackend` compila il backend senza montare,
avviare o ascoltare nulla. `backend.routes` contiene ciascun gruppo di rotte come
una sotto-app Hono montabile singolarmente, su qualsiasi percorso. `mount`, `attachRealtime` e
`start` gestiscono il resto, se desideri utilizzarli:

```typescript
const backend = await createRebaseBackend({ database: adapter, auth, schemaDir, provision: true });

app.route("/v2/data", backend.routes.data());   // only the parts you want,
app.route("/v2/auth", backend.routes.auth());   // at the paths you want
await backend.attachRealtime(server);
backend.start();                                // cron, job workers, sweeps
```

Un gruppo include il proprio contesto di autenticazione, rate limit e controllo admin, e rifiuta
gli header di impersonificazione e simulazione a meno che non si tratti del gruppo data o functions,
quindi `getDriver(c)` funziona all'interno di un gruppo montato ovunque. Ciò che non include è il
middleware a livello di processo aggiunto da `mount()`: il limite sul body, la compressione, CSRF e
l'envelope degli errori devono essere aggiunti da te quando monti i gruppi singolarmente.

Facendo un ulteriore passo in profondità, `@rebasepro/server-postgres` è indipendente dal framework:
dipende solo da Drizzle e da `http.Server` di Node, consentendoti di integrare
il data driver e il realtime in Express, Fastify o Node standard escludendo
completamente il server Rebase.

→ [Integrazione server personalizzato](/docs/backend/custom-server)

**Cosa non può raggiungere:** con `createRebaseBackend`, nulla è fuori portata;
assumi il controllo dell'ordine delle chiamate. Utilizzando unicamente il driver, tutto ciò che il
server predispone deve essere sviluppato da te: le rotte di autenticazione e il refresh dei token, lo storage,
la coda dei job, il cron, l'API admin utilizzata da Studio, il server MCP,
l'envelope degli errori e lo stack dei middleware.

Ricorri a questo approccio se hai un server esistente che deve rimanere l'entrypoint principale, o
quando solo una parte del backend deve risiedere in questo processo. Se ciò di cui hai effettivamente
bisogno è una sola rotta personalizzata, quello è il gradino 3 o 4, con una superficie notevolmente ridotta.

## 6. `rebase eject`

**Ambito:** il repository.

Scrive l'entrypoint del backend e un `Dockerfile` all'interno del progetto modificando la configurazione
del backend, in modo che il repository compili la propria immagine invece di eseguire il
runtime pubblicato.

```bash
rebase eject --dry-run   # lists what would change, changes nothing
rebase eject
```

→ [`rebase eject`](/docs/cli#rebase-eject)

**Quanto costa:** **gli aggiornamenti del runtime della piattaforma non raggiungono più il progetto.**
CORS, configurazione dell'autenticazione, storage e arresto diventano tua responsabilità da configurare
e mantenere operativi. Questo è l'unico gradino della scala da cui è difficile tornare indietro.

Esegui prima un'anteprima. L'opzione `--force` sostituisce un eventuale `backend/src/index.ts` o
`env.ts` esistente, salvando il file corrente come `<nome>.bak`.

## Quando nessuna di queste opzioni è la risposta

Vale la pena evidenziare due casi specifici, poiché non rientrano in questa scala.

**SQL grezzo.** Non è necessario abbandonare il framework per scrivere una query non
esprimibile tramite il query builder. Riduci il tipo di `driver.admin` con `isSQLAdmin` e usa
`executeSql`, da una funzione personalizzata o da un hook:

```typescript
import { isSQLAdmin, type DataDriver } from "@rebasepro/types";

async function topSellers(driver: DataDriver, since: string) {
    const admin = driver.admin;
    if (!isSQLAdmin(admin)) throw new Error("Native SQL is not available on this driver.");
    return admin.executeSql(
        "select product_id, sum(qty) from order_lines where created_at > $1 group by 1",
        { params: [since] }
    );
}
```

`driver` è ciò che viene fornito dal contesto di una funzione personalizzata (`c.get("driver")`), oppure
da `context.driver` all'interno di un hook. Effettua il restringimento del tipo con `isSQLAdmin` anziché
un casting diretto: il guard fa la differenza tra un driver non in grado di eseguire SQL che lo segnala
chiaramente e uno che lancia `admin.executeSql is not a function` nel punto di chiamata.

`executeSql` restituisce
ogni riga letta. Per query SQL la cui dimensione dei risultati non è sotto il tuo controllo, passa `maxResultBytes`:
un risultato le cui righe occupano più byte di tale soglia viene rifiutato con un errore avente
`code` pari a `RESULT_TOO_LARGE`, senza mai essere restituito parzialmente. L'evento `EXECUTE_SQL` del
socket realtime, attraverso cui passa `executeSql` di un client admin, imposta un limite di 128 MB per
ciascun chiamante.

**Una funzionalità che il framework dovrebbe avere e non ha.** Se ti trovi a dover applicare
delle patch a `@rebasepro/server-postgres`, o a eseguire l'eject per un singolo comportamento, è preferibile
aprire una issue anziché creare un fork —
[github.com/rebasepro/rebase/issues](https://github.com/rebasepro/rebase/issues).
Sia `beforeQuery` che `search.mode: "hybrid"` esistono perché un driver con patch era l'unica alternativa possibile.

## Risorse correlate

- [Estendere Rebase (frontend)](/docs/frontend/extending) — la stessa scala per il pannello di amministrazione
- [Hook di tabella](/docs/collections/callbacks)
- [Hook globali](/docs/backend/hooks)
- [Funzioni personalizzate](/docs/backend/custom-functions)
- [Integrazione server personalizzato](/docs/backend/custom-server)
- [Ricerca](/docs/backend/search)
- [Indice degli endpoint](/docs/backend/endpoints) — tutte le rotte montate dal server
