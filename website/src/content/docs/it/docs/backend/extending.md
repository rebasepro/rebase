---
sourceHash: d83b91c0dc03f048
title: Rebase non fa X
sidebar_label: Estendere il server
description: La scala di estensione lato server — dichiarazione, callback di collezione, custom function, rotte personalizzate, server personalizzato, eject — con ciò che ciascuna può o non può raggiungere.
---

## Panoramica

Qualcosa di cui hai bisogno non si trova nella configurazione della collezione. Questa pagina indica l'ordine in cui provare le varie soluzioni e — cosa ancora più utile — ciò che ogni gradino *non può* raggiungere, così da fermarsi al primo in grado di svolgere il compito.

Esiste una pagina corrispondente per il pannello di amministrazione:
[Estendere Rebase](/docs/frontend/extending) illustra plugin, slot, override dei
componenti e viste personalizzate. Questa riguarda il server.

La regola che la scala codifica: **ogni gradino costa qualcosa che quello
sottostante manteneva.** Una dichiarazione è portabile, aggiornabile e compresa
dallo schema planner, dall'SDK generato e dal pannello di amministrazione. Nel
momento in cui raggiungi `rebase eject`, diventi proprietario della sequenza di
avvio e gli aggiornamenti del runtime della piattaforma non raggiungono più il
tuo progetto. Sali quindi solo fin dove è strettamente necessario.

## La scala

| # | Gradino | Raggiunge | **Non** raggiunge | Costo di trovarsi qui |
|---|---|---|---|---|
| 1 | **Dichiarazione** — una proprietà, una relazione, un indice, un blocco `search`, una regola di sicurezza | Lo schema, l'SDK generato, il pannello di amministrazione, il migration planner | Qualsiasi cosa debba eseguire codice | Nessuno. Questo è il percorso supportato |
| 2 | **Callback di collezione** — `beforeQuery`, `afterRead`, `beforeSave`, `afterSave`, `beforeDelete`, `afterDelete` | Ogni lettura e scrittura di una collezione, su qualsiasi trasporto, all'interno della transazione stessa della richiesta | Richieste che non toccano alcuna collezione; l'envelope della risposta; qualsiasi cosa asincrona rispetto alla scrittura | Viene eseguito sull'hot path, mantenendo aperta la transazione |
| 3 | **Custom function** — un'app Hono in `functions/` | Il proprio URL, con l'autenticazione risolta, il driver limitato al chiamante e `rebase` a portata di mano | Le rotte integrate `/api/data`. Si posiziona *accanto* ad esse, non davanti | Un'ulteriore superficie da autorizzare; non viene generato alcun metodo SDK per essa |
| 4 | **Rotte e middleware personalizzati** sull'app Hono | Qualsiasi cosa HTTP, inclusi i percorsi eseguiti *prima* dei router di Rebase | Il driver e l'identità del chiamante, a meno che non si protegga la rotta autonomamente | All'esterno di qualsiasi router di Rebase: nessun middleware di autenticazione è stato eseguito |
| 5 | **Server personalizzato** — incorpora il driver in Express, Fastify o nel modulo `http` nativo | L'adattatore dati e il realtime, in un processo scritto da te | Tutto ciò che `initializeRebaseBackend` configura: rotte di autenticazione, storage, job, cron, API di amministrazione, il server MCP | Assembli tu il backend. In questo caso Rebase è una libreria, non un coordinatore |
| 6 | **`rebase eject`** | L'entrypoint e il `Dockerfile`, nel tuo repository | — | **Gli aggiornamenti del runtime della piattaforma smettono di raggiungere questo progetto.** CORS, configurazione dell'autenticazione, storage e shutdown diventano a carico tuo |

:::tip[Due gradini vengono spesso saltati senza motivo]
<span class="since-badge" data-since="0.22">Da 0.22</span> `beforeQuery` (gradino 2) restringe una lettura *prima che venga compilata*, che è solitamente
il motivo per cui si ricorre al gradino 3 o 5. E un blocco `search` con
`mode: "hybrid"` (gradino 1) è ciò per cui le persone ricorrono solitamente a SQL grezzo (raw SQL). Entrambi sono
sufficientemente recenti da non essere menzionati nelle risposte più datate sul web.
:::

## 1. Dichiarazione

La maggior parte di ciò di cui un backend ha bisogno è una dichiarazione sulla
collezione, poiché una dichiarazione è l'unico gradino che il resto del sistema
può leggere. Lo schema planner la converte in DDL, il generatore di codice la
trasforma in metodi SDK, il pannello di amministrazione la renderizza e
`rebase doctor` la confronta con il database attivo.

| Voglio… | Dichiarare | Riferimento |
|---|---|---|
| Aggiungere una colonna | una proprietà | [Proprietà](/docs/collections/properties) |
| Collegare due collezioni | una proprietà `relation` | [Relazioni](/docs/collections/relations) |
| Rendere una query veloce | `indexes` | [Indici](/docs/backend/indexes) |
| Decidere chi può leggere o scrivere una riga | `securityRules` | [Autenticazione](/docs/backend/authentication) |
| Cercare testo in modo appropriato — accenti, JSONB, ranking, sottostringhe | un blocco `search` | [Ricerca](/docs/backend/search) |
| Trovare righe per significato | una proprietà `vector` | [Ricerca](/docs/backend/search) |
| Mantenere le righe eliminate | `softDelete` | [Scritture](/docs/backend/writes) |
| Registrare chi ha modificato cosa | `history` | [Cronologia](/docs/backend/history) |
| Eseguire qualcosa su pianificazione | un file cron job | [Cron Job](/docs/backend/cron-jobs) |
| Eseguire qualcosa dopo una scrittura, fuori banda | un job | [Job](/docs/backend/jobs) |

**Ciò che non può raggiungere:** qualsiasi cosa debba prendere una decisione al
momento della richiesta. Una dichiarazione è un dato. Se la risposta dipende da
chi effettua la richiesta, passa al gradino 2.

## 2. Callback di collezione

**Ambito:** una collezione, oppure ogni collezione se registrata globalmente su
`initializeRebaseBackend({ callbacks })`.

I callback si attivano su **ogni** percorso dati — REST, SDK, sottoscrizioni
WebSocket e scritture lato server tramite `rebase.dataAsAdmin` — e ciascuno viene
eseguito all'interno della transazione aperta per quella richiesta. Questo è il
loro vero valore: non esiste alcun modo per accedere alle righe di una collezione
aggirandoli.

| Callback | Si attiva | Usalo per |
|---|---|---|
| `beforeQuery` <span class="since-badge" data-since="0.22">Da 0.22</span> | prima che una lettura venga compilata | restringere **quali righe** richiede una lettura |
| `afterRead` | per riga, dopo che è stata recuperata | redazione/oscuramento, mascheramento di PII, campi calcolati |
| `beforeSave` | dopo la validazione, prima della scrittura | valori predefiniti, colonne derivate, rifiuto di una scrittura |
| `afterSave` | dopo la scrittura, prima del commit | effetti collaterali che devono essere annullati insieme ad essa |
| `afterSaveError` | quando un salvataggio genera un errore | segnalazione; `props.error` è l'errore generato |
| `beforeDelete` | prima dell'eliminazione | rifiutarla |
| `afterDelete` | dopo l'eliminazione, prima del commit | pulizia a cascata |

→ [Callback per collezione](/docs/collections/callbacks) ·
[Hook globali](/docs/backend/hooks)

### Restringere una lettura con `beforeQuery`

<span class="since-badge" data-since="0.22">Da 0.22</span> `afterRead` vede le righe che sono già state recuperate, quindi può oscurare un valore
ma non può impedire che la riga venga letta. `beforeQuery` viene eseguito prima: riceve la
query analizzata e restituisce condizioni da concatenare con **AND** al suo interno.

```ts
// config/collections/documents.ts
callbacks: {
    beforeQuery: ({ context }) => {
        if (context.user?.roles?.includes("admin")) return;        // no narrowing
        return { filter: { tenant_id: ["==", context.user?.tenant ?? null] } };
    }
}
```

Ci sono tre proprietà utili da conoscere prima di farvi affidamento:

- **Può solo restringere.** Il valore restituito è un filtro da aggiungere in AND,
  e non esiste una forma che possa restituire per ampliare la lettura. Questo è
  intenzionale: un hook a cui viene passata la query con la richiesta di restituirne
  una potrebbe rimuovere una condizione, e su un piano dati con row-level security
  una condizione rimossa restituisce ogni riga consentita dalle policy.
- **Si attiva su ogni percorso di lettura.** L'elenco (listing), la singola get,
  il count, l'aggregazione, la ricerca, la lettura vettoriale, un elenco su percorso
  nidificato, il refetch in tempo reale che genera i frame delle sottoscrizioni e
  le righe caricate per una relazione o un `?include=` — dove è l'hook della
  collezione di **destinazione** ad applicarsi. Un hook rispettato dal listing ma
  non dal count risulterebbe in una pagina che mostra "1 di 4 risultati".
- **Un filtro che non può compilare rifiuta la richiesta.** Indicare una colonna
  non presente nella tabella restituisce un errore 400, non una condizione ignorata,
  indipendentemente da come è configurato `configureUnknownFilterFields`.

Una lettura viene deliberatamente *non* ristretta: il controllo di unicità alla
base di `validation: { unique: true }`. Questo controlla se un valore esiste in
qualsiasi punto della tabella e, se ristretto, risponderebbe "univoco" per un valore
già presente in una riga nascosta — lasciando invece fallire l'inserimento a causa
del vincolo (constraint).

`beforeQuery` è implementato da `@rebasepro/server-postgres`. Una collezione gestita
da un altro engine che ne dichiara uno **fallisce all'avvio**, per nome, piuttosto
che essere avviata con l'hook silenziosamente inattivo. Lo stesso vale per un hook
globale associato a un'origine dati diversa da Postgres. L'oscuramento che funziona
su tutti gli engine è `afterRead`.

**Ciò che i callback non possono raggiungere:**

- Una richiesta che non tocca alcuna collezione. Non c'è nulla a cui il callback
  possa agganciarsi.
- L'envelope della risposta — codice di stato, header, formato di paginazione.
  Un callback restituisce valori, non una risposta.
- Operazioni che devono sopravvivere alla transazione. `afterSave` viene eseguito
  *prima* del commit, quindi un errore in questo punto annulla (rollback) la scrittura.
  Qualsiasi operazione che debba persistere anche in caso di annullamento della
  scrittura non fa parte della scrittura: inseriscila nella
  [coda dei job](/docs/backend/jobs).
- Operazioni lente, in pratica. Un callback mantiene aperta la transazione e, con
  essa, una connessione del pool. Qualsiasi cosa comunichi con terze parti dovrebbe
  andare nella coda.

## 3. Custom function

**Ambito:** un URL sotto `/api/functions`.

Un'app Hono in `backend/functions/`, rilevata in base al nome del file allo stesso
modo delle collezioni e dei cron job. Il middleware di autenticazione è già stato
eseguito quando viene raggiunto il tuo handler, il driver è limitato all'ambito
del chiamante e `rebase` è disponibile per storage, email, job e `dataAsAdmin`.

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

→ [Custom function](/docs/backend/custom-functions)

**Ciò che non può raggiungere:** le rotte predefinite `/api/data`. Una funzione
si trova *accanto* ad esse, non davanti, quindi non può modificare il modo in cui
un elenco viene filtrato, impaginato o strutturato — per quello c'è il gradino 2.
Inoltre, non viene generato alcun metodo SDK per essa; i chiamanti la raggiungono
con `client.functions.invoke(...)` o con un semplice `fetch`.

## 4. Rotte e middleware personalizzati

**Ambito:** l'app Hono, prima che Rebase la gestisca.

`initializeRebaseBackend` accetta l'app fornita, quindi qualsiasi cosa registrata
su tale app *prima* di chiamarlo viene eseguita prima di ogni router di Rebase —
consulta [Route Registration Order](/docs/backend/custom-functions#route-registration-order)
per i dettagli della struttura.

:::caution[Nessun middleware di autenticazione è stato eseguito qui]
Una rotta registrata in questo modo si trova **all'esterno** di qualsiasi router
di Rebase, pertanto `getDriver(c)` non è impostato e nulla ha verificato il token.
Proteggila con `requireAuth` / `requireAdmin` importati da **`@rebasepro/server`** —
la radice del pacchetto — che verificano autonomamente il token. Le guardie esportate
da `@rebasepro/server/functions` leggono un'identità già risolta da un router di Rebase
e restituiscono 500 invece di fingere che ne esista una.
:::

Un'insidia di Hono che vale la pena segnalare, poiché non genera errori:
`app.use("/*", guard)` copre solo le rotte dichiarate *sotto* di esso. Una rotta
aggiunta successivamente — in fondo al file, tra qualche mese — rimarrebbe non
protetta. Inserisci le guardie direttamente nello slot middleware della rotta stessa.

**Ciò che non può raggiungere:** l'identità, il driver scoped e l'envelope degli
errori — a meno che tu non li configuri manualmente. Tutto ciò che un router di
Rebase fornisce a un handler è frutto del lavoro del router di Rebase stesso.

## 5. Server personalizzato

**Ambito:** il processo.

`@rebasepro/server-postgres` è indipendente dal framework: dipende unicamente da
Drizzle e da `http.Server` di Node. È quindi possibile incorporare l'adattatore dati
e il realtime in Express, Fastify o Node nativo e saltare completamente il coordinatore.

→ [Integrazione di un server personalizzato](/docs/backend/custom-server)

**Ciò che non può raggiungere:** tutto ciò che `initializeRebaseBackend` configura,
ovvero la maggior parte del backend — le rotte di autenticazione e il refresh dei
token, lo storage, la coda dei job, cron, le API di amministrazione con cui comunica
lo Studio, il server MCP, l'envelope degli errori, lo stack di middleware. Ognuno di
questi componenti può essere assemblato a mano, ma nessuno si configura da solo.
A questo gradino, Rebase è una libreria, non un coordinatore.

Scegli questa opzione quando hai un server esistente che deve rimanere l'entrypoint.
Se ciò che desideri realmente è solo una rotta personalizzata, quello è il
gradino 3 o 4, con una superficie di esposizione nettamente inferiore.

## 6. `rebase eject`

**Ambito:** il repository.

Scrive l'entrypoint del backend e un `Dockerfile` all'interno del progetto e ne
converte il backend, in modo che il repository compili la propria immagine anziché
eseguire il runtime pubblicato.

```bash
rebase eject --dry-run   # lists what would change, changes nothing
rebase eject
```

→ [`rebase eject`](/docs/cli#rebase-eject)

**Cosa comporta:** **gli aggiornamenti del runtime della piattaforma non raggiungono più il progetto.**
CORS, configurazione dell'autenticazione, storage e shutdown diventano interamente
a tuo carico per la configurazione e la manutenzione. Questo è l'unico gradino della
scala da cui è difficile tornare indietro.

Esegui prima un'anteprima. `--force` sostituisce un file `backend/src/index.ts` o
`env.ts` esistente, salvando il file corrente come `<name>.bak`.

## Quando nessuna di queste è la risposta adatta

Vale la pena menzionare due casi, poiché la scala non vi si adatta.

**SQL nativo (Raw SQL).** Non è necessario abbandonare il framework per scrivere
una query che il query builder non riesce a esprimere. Esegui il narrowing di
`driver.admin` con `isSQLAdmin` e usa `executeSql`, da una custom function o da
un callback:

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

`driver` è ciò che viene fornito dal contesto di una custom function (`c.get("driver")`)
o da `context.driver` all'interno di un callback. Restringine il tipo con `isSQLAdmin`
anziché eseguire un casting: il type guard fa la differenza tra un driver che dichiara
chiaramente di non poter eseguire SQL e uno che genera un'eccezione
`admin.executeSql is not a function` nel punto di chiamata.

**Qualcosa che il framework dovrebbe fare e non fa.** Se ti ritrovi ad applicare
patch a `@rebasepro/server-postgres` o a fare l'eject per un singolo comportamento,
vale la pena aprire una issue invece di creare un fork —
[github.com/rebasepro/rebase/issues](https://github.com/rebasepro/rebase/issues).
<span class="since-badge" data-since="0.22">Da 0.22</span> Sia `beforeQuery` sia `search.mode: "hybrid"` esistono proprio perché una versione con
patch del driver era l'unica alternativa.

## Risorse correlate

- [Estendere Rebase (frontend)](/docs/frontend/extending) — la stessa scala per il pannello di amministrazione
- [Callback per collezione](/docs/collections/callbacks)
- [Hook globali](/docs/backend/hooks)
- [Custom function](/docs/backend/custom-functions)
- [Integrazione server personalizzato](/docs/backend/custom-server)
- [Ricerca](/docs/backend/search)
- [Indice degli endpoint](/docs/backend/endpoints) — tutte le rotte registrate dal server
