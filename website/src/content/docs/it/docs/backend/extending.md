---
sourceHash: 41183c8dc79d618d
title: Rebase non fa X
sidebar_label: Estendere il server
description: La scala di estensione lato server — dichiarazione, callback di collezione, funzione personalizzata, rotte personalizzate, server personalizzato, eject — con ciò che ciascuno può e non può raggiungere.
---

## Panoramica

Qualcosa di cui hai bisogno non si trova nella configurazione della collezione. Questa pagina descrive l'ordine in cui provare le varie soluzioni e — aspetto ancora più utile — ciò che ogni gradino *non può* raggiungere, in modo da fermarti al primo in grado di svolgere il lavoro.

Esiste una pagina corrispondente per il pannello di amministrazione:
[Extending Rebase](/docs/frontend/extending) copre plugin, slot, override dei componenti
e viste personalizzate. Questa è dedicata al server.

La regola che la scala riflette: **ogni gradino comporta un costo rispetto a ciò che quello sottostante manteneva.** Una dichiarazione è portabile, aggiornabile e compresa dal pianificatore dello schema, dall'SDK generato e dal pannello di amministrazione. Nel momento in cui raggiungi `rebase eject`, diventi responsabile della sequenza di avvio e gli aggiornamenti del runtime della piattaforma non raggiungeranno più il tuo progetto. Sali quindi solo fino a dove è strettamente necessario.

## La scala

| # | Gradino | Raggiunge | **Non** raggiunge | Costo di questa scelta |
|---|---|---|---|---|
| 1 | **Dichiarazione** — una proprietà, una relazione, un indice, un blocco `search`, una regola di sicurezza | Lo schema, l'SDK generato, il pannello di amministrazione, il pianificatore delle migrazioni | Tutto ciò che richiede l'esecuzione di codice | Nessuno. Questo è il percorso supportato |
| 2 | **Callback di collezione** — `beforeQuery`, `afterRead`, `beforeSave`, `afterSave`, `beforeDelete`, `afterDelete` | Ogni lettura e scrittura di una collezione, su qualsiasi trasporto, all'interno della transazione della richiesta stessa | Richieste che non toccano alcuna collezione; l'involucro della risposta; tutto ciò che è asincrono rispetto alla scrittura | Viene eseguito sull'hot path, mantenendo aperta la transazione |
| 3 | **Funzione personalizzata** — un'app Hono in `functions/` | Il proprio URL, con autenticazione risolta, il driver limitato al chiamante e `rebase` a disposizione | Le rotte `/api/data` integrate. Si posiziona *accanto* ad esse, non davanti | Una superficie in più da autorizzare; nessun metodo SDK generato per essa |
| 4 | **Rotte e middleware personalizzati** sull'app Hono | Qualsiasi elemento HTTP, inclusi i percorsi eseguiti *prima* dei router di Rebase | Il driver e l'identità del chiamante, a meno che non protegga tu stesso la rotta | Fuori da ogni router Rebase: nessun middleware di autenticazione è stato eseguito |
| 5 | **Server personalizzato** — incorpora il driver in Express, Fastify o semplice `http` | L'adattatore dati e il realtime, in un processo scritto da te | Tutto ciò che `initializeRebaseBackend` configura: rotte di autenticazione, storage, job, cron, API di amministrazione, il server MCP | Assembli tu il backend. Rebase qui è una libreria, non un coordinatore |
| 6 | **`rebase eject`** | L'entrypoint e il `Dockerfile`, nel tuo repository | — | **Gli aggiornamenti del runtime della piattaforma non raggiungono più questo progetto.** CORS, configurazione dell'autenticazione, storage e shutdown diventano a carico tuo |

:::tip[Due gradini vengono spesso saltati senza motivo]
`beforeQuery` (gradino 2) restringe una lettura *prima che venga compilata*, motivo
per cui solitamente le persone ricorrono al gradino 3 o 5. E un blocco `search` con
`mode: "hybrid"` (gradino 1) è ciò per cui le persone di solito ricorrono all'SQL grezzo. Entrambi sono
abbastanza recenti da non essere menzionati nelle risposte più datate su internet.
:::

## 1. Dichiarazione

La maggior parte di ciò di cui ha bisogno un backend è una dichiarazione sulla collezione, perché una
dichiarazione è l'unico gradino che il resto del sistema può leggere. Il pianificatore dello schema
la trasforma in DDL, il generatore di codice la trasforma in metodi SDK, il pannello di amministrazione
la renderizza e `rebase doctor` la confronta con il database attivo.

| Voglio… | Dichiarare | Riferimento |
|---|---|---|
| Aggiungere una colonna | una proprietà | [Properties](/docs/collections/properties) |
| Collegare due collezioni | una proprietà `relation` | [Relations](/docs/collections/relations) |
| Velocizzare una query | `indexes` | [Indexes](/docs/backend/indexes) |
| Decidere chi può leggere o scrivere una riga | `securityRules` | [Authentication](/docs/backend/authentication) |
| Cercare testo correttamente — accenti, JSONB, ranking, sottostringhe | un blocco `search` | [Search](/docs/backend/search) |
| Trovare righe per significato semantico | una proprietà `vector` | [Search](/docs/backend/search) |
| Mantenere le righe cancellate | `softDelete` | [Writes](/docs/backend/writes) |
| Registrare chi ha modificato cosa | `history` | [History](/docs/backend/history) |
| Eseguire un'attività pianificata | un file cron job | [Cron Jobs](/docs/backend/cron-jobs) |
| Eseguire qualcosa dopo una scrittura, fuori banda | un job | [Jobs](/docs/backend/jobs) |

**Ciò che non può raggiungere:** qualsiasi cosa debba prendere una decisione al momento della richiesta.
Una dichiarazione è costituita da dati. Se la risposta dipende da chi effettua la richiesta, passa al gradino 2.

## 2. Callback di collezione

**Ambito:** una collezione, oppure ogni collezione quando registrate globalmente su
`initializeRebaseBackend({ callbacks })`.

I callback si attivano su **ogni** percorso dati — REST, SDK, sottoscrizioni WebSocket
e scritture lato server tramite `rebase.dataAsAdmin` — e ciascuno viene eseguito all'interno della
transazione aperta per quella richiesta. È qui che risiede l'intero valore: non esiste alcun modo per
accedere alle righe di una collezione aggirandoli.

| Callback | Si attiva | Usalo per |
|---|---|---|
| `beforeQuery` | prima che una lettura sia compilata | restringere **quali righe** vengono richieste da una lettura |
| `afterRead` | per riga, dopo il recupero | redazione, mascheramento PII, campi calcolati |
| `beforeSave` | dopo la validazione, prima della scrittura | valori predefiniti, colonne derivate, rifiuto di una scrittura |
| `afterSave` | dopo la scrittura, prima del commit | effetti collaterali che devono essere annullati insieme ad essa |
| `afterSaveError` | quando un salvataggio genera un errore | reporting; `props.error` è l'errore generato |
| `beforeDelete` | prima dell'eliminazione | rifiutarla |
| `afterDelete` | dopo l'eliminazione, prima del commit | pulizia a cascata |

→ [Callback per collezione](/docs/collections/callbacks) ·
[Hook globali](/docs/backend/hooks)

### Restringere una lettura con `beforeQuery`

`afterRead` vede le righe che sono già state recuperate, quindi può oscurare o redigere un valore
ma non può impedire che la riga venga letta. `beforeQuery` viene eseguito prima: riceve la
query analizzata e restituisce condizioni da concatenare con un **AND**.

```ts
// config/collections/documents.ts
callbacks: {
    beforeQuery: ({ context }) => {
        if (context.user?.roles?.includes("admin")) return;        // no narrowing
        return { filter: { tenant_id: ["==", context.user?.tenant ?? null] } };
    }
}
```

Vale la pena conoscere tre proprietà prima di farvi affidamento:

- **Può solo restringere.** Il valore restituito è un filtro da aggiungere in AND, e non
  c'è forma possibile che possa ampliare la lettura. Questa è una scelta deliberata: se a un hook venisse
  passata la query chiedendogli di restituirne una nuova, potrebbe omettere una condizione; su un
  data plane con sicurezza a livello di riga (RLS), una condizione omessa restituirebbe ogni riga che
  le policy consentono.
- **Si attiva su ogni percorso di lettura.** L'elenco (listing), la get singola, il conteggio,
  l'aggregazione, la ricerca, la lettura vettoriale, un elenco su percorso annidato, il refetch realtime
  che crea i frame di sottoscrizione e le righe caricate per una relazione o un `?include=` — dove ad
  applicarsi è l'hook della collezione di **destinazione**. Un hook rispettato dall'elenco e non
  dal conteggio genererebbe una pagina con l'indicazione "1 di 4 risultati".
- **Un filtro che non può essere compilato rifiuta la richiesta.** Indicare una colonna che
  la tabella non possiede genera un errore 400, non una condizione ignorata, a prescindere da come
  sia impostato `configureUnknownFilterFields`.
- **Una scrittura su una riga da esso esclusa restituisce un 404.** Un aggiornamento o un'eliminazione
  indirizzati a una riga al di fuori dell'ambito vengono rifiutati prima della scrittura, con la stessa risposta
  "nessuna riga..." fornita da una lettura — di conseguenza l'ambito vale anche per le scritture, non solo per
  le letture. Ciò che *non* controlla sono i valori in fase di scrittura: il rifiuto di una scrittura in base
  al suo contenuto spetta a `beforeSave`.

Una lettura viene deliberatamente *non* ristretta: il controllo di univocità dietro a
`validation: { unique: true }`. Questo verifica se un valore esiste ovunque nella
tabella, e se fosse ristretto risponderebbe "univoco" per un valore già presente in una riga nascosta —
lasciando invece fallire l'inserimento a causa del vincolo.

`beforeQuery` è implementato da `@rebasepro/server-postgres`. Una collezione gestita
da un altro engine che ne dichiara uno **fallisce all'avvio**, indicandone il nome, invece di essere
servita con l'hook silenziosamente inerte. Lo stesso vale per un hook globale associato a un'origine dati
diversa da Postgres. L'offuscamento che funziona su qualsiasi engine è `afterRead`.

**Ciò che i callback non possono raggiungere:**

- Una richiesta che non tocca alcuna collezione. Non c'è nulla a cui il callback possa
  agganciarsi.
- L'involucro della risposta — codice di stato, intestazioni, struttura della paginazione. Un callback
  restituisce valori, non una risposta.
- Operazioni che devono sopravvivere alla transazione. `afterSave` viene eseguito *prima* del commit,
  quindi un'eccezione generata annulla (rollback) la scrittura. Tutto ciò che deve sopravvivere all'eventuale annullamento
  della scrittura non fa parte della scrittura stessa: inseriscilo nella
  [coda dei job](/docs/backend/jobs).
- Operazioni lente, nella pratica. Un callback mantiene aperta la transazione e con essa una connessione
  del pool. Tutto ciò che comunica con terze parti dovrebbe andare nella coda.

## 3. Funzioni personalizzate

**Ambito:** un URL sotto `/api/functions`.

Un'app Hono in `backend/functions/`, rilevata in base al nome del file come avviene per collezioni
e cron job. Il middleware di autenticazione è già stato eseguito quando viene raggiunto il tuo gestore,
il driver è limitato al chiamante e `rebase` è disponibile per storage, email,
job e `dataAsAdmin`.

```typescript
// backend/functions/promote.ts
import { defineFunction } from "@rebasepro/server/functions";

export default defineFunction((app, { rebase }) => {
    app.post("/", async (c) => {
        const { id } = await c.req.json<{ id: string }>();
        await rebase.dataAsAdmin.collection("products").update(id, { featured: true });
        return c.json({ ok: true });
    });
});
```

→ [Funzioni personalizzate](/docs/backend/custom-functions)

**Ciò che non può raggiungere:** le rotte integrate `/api/data`. Una funzione risiede
*accanto* ad esse, non davanti, quindi non può modificare il modo in cui un elenco viene
filtrato, paginato o strutturato — questo è il compito del gradino 2. Inoltre, non viene generato
alcun metodo SDK per essa; i chiamanti la raggiungono con `client.functions.invoke(...)` o con una semplice `fetch`.

## 4. Rotte e middleware personalizzati

**Ambito:** l'app Hono, prima che Rebase la gestisca.

`initializeRebaseBackend` accetta l'app passata come parametro, pertanto tutto ciò che registri su
tale app *prima* di chiamarlo viene eseguito prima di ogni router di Rebase — consulta
[Ordine di registrazione delle rotte](/docs/backend/custom-functions#route-registration-order)
per i dettagli sulla struttura.

:::caution[Nessun middleware di autenticazione è stato eseguito qui]
Una rotta registrata in questo modo si trova **all'esterno** di ogni router Rebase, quindi
`getDriver(c)` non è impostato e nessun componente ha verificato il token. Proteggila con
`requireAuth` / `requireAdmin` importati da **`@rebasepro/server`** — la radice del pacchetto —
che verificano autonomamente il token. Le guardie esportate da
`@rebasepro/server/functions` leggono un'identità che un router Rebase ha già
risolto, e restituiranno 500 piuttosto che fingere che ne esista una.
:::

Un'insidia di Hono da tenere a mente, perché silenziosa: `app.use("/*", guard)` copre
solo le rotte dichiarate *sotto* di essa. Una rotta aggiunta successivamente — in fondo al
file, magari tra mesi — rimarrà non protetta. Inserisci le guardie direttamente nello slot middleware della rotta stessa.

**Ciò che non può raggiungere:** l'identità, il driver contestualizzato e l'involucro degli errori
— a meno che tu non li colleghi manualmente. Tutto ciò che un router Rebase fornisce a un gestore è
frutto dell'elaborazione svolta dal router Rebase stesso.

## 5. Server personalizzato

**Ambito:** il processo.

`@rebasepro/server-postgres` è agnostico rispetto al framework: dipende solo da Drizzle e da
`http.Server` di Node. Puoi quindi incorporare l'adattatore dati e il realtime in
Express, Fastify o semplice Node e saltare del tutto il coordinatore.

→ [Integrazione server personalizzato](/docs/backend/custom-server)

**Ciò che non può raggiungere:** tutto ciò che `initializeRebaseBackend` configura,
ovvero la maggior parte del backend — le rotte di autenticazione e il refresh dei token, lo storage,
la coda dei job, il cron, l'API di amministrazione con cui comunica lo Studio, il server MCP, l'involucro degli errori,
lo stack dei middleware. Ciascuno di questi elementi può essere assemblato manualmente;
nessuno si configura da solo. A questo gradino, Rebase è una libreria, non un coordinatore.

Fai ricorso ad esso quando hai un server esistente che deve rimanere l'entrypoint. Se
ciò che desideri in realtà è una sola rotta personalizzata, passa al gradino 3 o 4, con una
superficie di esposizione nettamente inferiore.

## 6. `rebase eject`

**Ambito:** il repository.

Scrive l'entrypoint del backend e un `Dockerfile` nel progetto e ne ribalta la configurazione,
in modo che il repository compili la propria immagine invece di eseguire il runtime distribuito.

```bash
rebase eject --dry-run   # lists what would change, changes nothing
rebase eject
```

→ [`rebase eject`](/docs/cli#rebase-eject)

**Quanto costa:** **gli aggiornamenti del runtime della piattaforma non raggiungono più il progetto.**
CORS, configurazione dell'autenticazione, storage e shutdown diventano interamente a carico tuo per configurazione
e manutenzione. Questo è l'unico gradino della scala dal quale è difficile tornare indietro.

Esegui prima un'anteprima. `--force` sostituisce un eventuale `backend/src/index.ts` o
`env.ts` esistente, conservando il file corrente come `<name>.bak`.

## Quando nessuna di queste soluzioni è la risposta

Vale la pena menzionare due casi, poiché la scala non vi si adatta.

**SQL grezzo.** Non è necessario uscire dal framework per scrivere una query che il query
builder non è in grado di esprimere. Restringi il tipo di `driver.admin` con `isSQLAdmin` e usa
`executeSql`, da una funzione personalizzata o da un callback:

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
da `context.driver` all'interno di un callback. Restringine il tipo con `isSQLAdmin` invece di effettuare un casting:
la guardia fa la differenza tra un driver che dichiara l'impossibilità di eseguire SQL e uno
che genera un errore `admin.executeSql is not a function` nel punto di chiamata.

**Qualcosa che il framework dovrebbe fare e non fa.** Se ti ritrovi ad applicare
patch a `@rebasepro/server-postgres`, o a eseguire l'eject per un singolo comportamento, conviene
aprire una issue piuttosto che creare un fork —
[github.com/rebasepro/rebase/issues](https://github.com/rebasepro/rebase/issues).
Sia `beforeQuery` sia `search.mode: "hybrid"` esistono proprio perché una patch al driver
era l'unica alternativa.

## Risorse correlate

- [Estendere Rebase (frontend)](/docs/frontend/extending) — la stessa scala per il pannello di amministrazione
- [Callback per collezione](/docs/collections/callbacks)
- [Hook globali](/docs/backend/hooks)
- [Funzioni personalizzate](/docs/backend/custom-functions)
- [Integrazione server personalizzato](/docs/backend/custom-server)
- [Ricerca](/docs/backend/search)
- [Indice degli endpoint](/docs/backend/endpoints) — ogni rotta montata dal server
