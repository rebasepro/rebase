---
sourceHash: 0d49afd8ac50f59e
title: Accesso ai campi
sidebar_label: Accesso ai campi
description: Permessi di lettura e scrittura per proprietà in base al ruolo. Un chiamante ammesso dalle regole di sicurezza della riga non riceve comunque un campo che i suoi ruoli non possono leggere.
---

## Panoramica

Le [regole di sicurezza](/docs/collections/security-rules/) stabiliscono a quali **righe** accede un chiamante. `access` determina quali **campi di una riga raggiunta** può visualizzare e impostare.

```typescript
import { defineCollection } from "@rebasepro/cms-types";

const staff = defineCollection({
    slug: "staff",
    name: "Staff",
    table: "staff",
    properties: {
        id: { type: "number", isId: "increment" },
        name: { type: "string" },
        salary: {
            type: "number",
            // Read by HR (and admins). Set by nobody through the API.
            access: { read: ["hr"], write: [] }
        }
    },
    securityRules: [
        { operation: "select", access: "public" }
    ]
});
```

La regola sopra non applica alcun filtro di riga su `select`, quindi ogni chiamante ammesso dall'API legge ogni riga di staff. Solo un chiamante con il ruolo `hr` ottiene la colonna `salary` di una riga, e nessuno può impostarla tramite HTTP.

## La regola

`access` prevede due elenchi opzionali, e un elenco omesso non equivale a un elenco vuoto: questa differenza costituisce l'intera funzionalità.

| `read` / `write` | Significato |
|------------------|-------------|
| omesso | Delega alla riga. Chiunque sia autorizzato dalle regole di sicurezza della collection a leggere (o scrivere) la riga riceve il campo. |
| `[]` | Nessuno, tramite l'API, con qualsiasi livello di privilegio: né `admin`, né la chiave di servizio, né una lettura in-process. |
| `["hr"]` | Un chiamante con il ruolo `hr`, **oppure** `admin`, **oppure** codice server fidato senza alcuna richiesta sottostante. |

I ruoli sono ruoli applicativi di Rebase: gli stessi restituiti da `rebase.roles()` all'interno di una policy e rispetto ai quali compila `policy.rolesOverlap`. Provengono dal contesto della chiamata: `user.roles` nella richiesta autenticata.

### Perché `admin` passa sempre

Ogni policy di base inserita da Rebase contiene un ramo `rolesOverlap(['admin'])`, e `rebase.dataAsAdmin` viene eseguito come `{ uid: "service", roles: ["admin"] }`. Una regola di campo che escludesse un amministratore da una colonna del proprio database impedirebbe anche a Studio di renderizzarla e alla CLI di esportarla. Se necessiti di una colonna che nessun amministratore possa leggere tramite l'API, usa `read: []`.

### Perché il livello fidato passa

Una chiamata `rebase.data` in-process all'interno di un hook, di una migrazione o dell'adapter di autenticazione che verifica una password non ha alcuna richiesta né ruolo associato. Si tratta di codice server, e un elenco di ruoli non si applica ad esso. `[]` continua ad applicarsi: si tratta di una dichiarazione sulla superficie dell'API piuttosto che su chi effettua la chiamata.

## `excludeFromApi` è lo stesso meccanismo

`excludeFromApi: true` è zucchero sintattico per `access: { read: [], write: [] }`. Dietro a entrambe le sintassi vi è lo stesso predicato, pertanto tutto ciò che è descritto in questa pagina si applica anche al flag. Usa la forma che ritieni più leggibile, ma non entrambe sulla stessa proprietà: tale combinazione viene rifiutata all'avvio.

## Cosa vede il chiamante

### Letture

Un campo che non puoi leggere è **assente** dalla risposta. Non `null`, non una stringa vuota: la chiave semplicemente non è presente.

```json
// GET /api/data/staff/1  as a caller holding `staff`
{ "id": 1, "name": "Ada" }

// the same row as a caller holding `hr`
{ "id": 1, "name": "Ada", "salary": 90000 }
```

Questa scelta è intenzionale. Un valore omesso restituito come `null` sarebbe indistinguibile da un `null` salvato nel database, consentendo a un client di mappare l'intera colonna contandoli; inoltre, un'`update` che rimandasse indietro la riga sovrascriverebbe il valore reale con il null appena ricevuto.

Si applica a ogni punto di uscita: elenco (list), get singolo, destinazioni di relazioni incluse con `?include=`, risultati di `_batch`, frame realtime da `.listen()`, risultati aggregati e snapshot della [cronologia](#history).

### Query

Un parametro `where`, `orderBy`, `fields`, una `select` di aggregazione o una `groupBy` che fa riferimento a un campo che non puoi leggere restituisce un **400 `FIELD_NOT_READABLE`**:

```http
GET /api/data/staff?salary=gt.100000
```

```json
{
  "error": {
    "code": "FIELD_NOT_READABLE",
    "message": "'salary' is not readable on 'staff' with your roles, so it cannot be used in a filter.",
    "details": {
      "collection": "staff",
      "fields": ["salary"],
      "violations": [
        { "field": "salary", "code": "access", "message": "'salary' is not readable with your roles." }
      ]
    }
  }
}
```

Senza questo controllo, il valore sarebbe leggibile un predicato alla volta: venti richieste basterebbero per una ricerca binaria su uno stipendio.

L'errore **indica il nome del campo**. È una decisione voluta, non una svista: il documento OpenAPI pubblicato elenca ogni proprietà di ogni collection (viene servito dall'app, non dal router dati autenticato), quindi i nomi dei campi sono già pubblici. Nascondere il nome in questo caso non proteggerebbe nulla e risponderebbe a un banale errore di battitura del chiamante con "unknown field", inducendolo a cercare un errore ortografico inesistente. **I nomi dei campi sono pubblici; i valori dei campi non lo sono.**

### Scritture

Un valore inviato per un campo che non puoi scrivere restituisce un **400**, senza mai scartare la chiave in modo silenzioso: una scrittura che scarta un campo segnalerebbe un esito positivo per una modifica mai avvenuta.

| Codice | Quando |
|------|------|
| `FIELD_NOT_WRITABLE` | `write` è un elenco di ruoli che non soddisfi. Un tuo collega potrebbe ricevere un 200 con lo stesso payload. |
| `VALIDATION_EXCLUDED_FIELDS` | `write` è `[]` (o `excludeFromApi`). Nessuno può scriverlo; la risposta è la stessa per ogni chiamante. |

Entrambi contengono `details.violations` indicizzati in base al nome inviato via rete. Viene applicato in creazione, `PATCH`/`PUT`, `/bulk`, `_batch`, upsert, operazioni di campo (`{ "salary": { "$inc": 1000 } }` fa riferimento a `salary` come qualsiasi valore) e nel frame WebSocket `SAVE`.

## Ricerca

La ricerca di fallback (una collection priva del blocco `search`) esegue il matching `ILIKE` sulle proprietà di tipo stringa, saltando quelle che il chiamante non può leggere. Nulla trapela tramite questa modalità.

Una collection che **invece dichiara** un [blocco `search`](/docs/backend/api/) viene compilata in una singola colonna `tsvector` generata e condivisa tra tutti i chiamanti. Non ne esiste una variante specifica per ruolo, quindi un campo con restrizioni specificato in `search.fields` rimarrebbe *ricercabile* per chiamanti che non possono vederne il valore, risultando recuperabile un termine alla volta. Rebase rifiuta questa combinazione all'avvio: rimuovi il campo da `search.fields` oppure elimina la restrizione di lettura.

## Cronologia

La [cronologia delle entità](/docs/backend/api/) memorizza l'intera riga ed è accessibile a chiunque possa leggere la riga stessa: il controllo è "puoi recuperare questa entità", non "sei un admin". Di conseguenza, la regola di lettura viene applicata anche a ciascuno snapshot memorizzato: la voce è comunque presente nell'elenco, con l'indicazione di chi l'ha modificata e quando, ma le colonne riservate sono rimosse dai suoi `values`.

Il ripristino (revert) non viene influenzato. La route di ripristino legge la voce memorizzata lato server, permettendo al chiamante di ripristinare una versione di cui non può visualizzare tutti i campi, esattamente come può già sovrascrivere una riga senza doverne leggere ogni proprietà.

## Cosa mostra il pannello di amministrazione

Non c'è nulla da configurare. Studio legge tramite la stessa API, quindi un campo che il chiamante non può leggere non viene mai recapitato e il modulo non lo disegna; un campo che non può scrivere viene rifiutato se si tenta di inviarlo. Questa è una garanzia lato server, a differenza di `admin.hideFromCollection`, che si limita a impedire al pannello di *renderizzare* un campo, lasciando però il valore nel JSON.

## Tipi generati e OpenAPI

I tipi `Row`, `Insert` e `Update` dell'SDK hanno un'unica struttura per tutti i chiamanti — non esiste un tipo `Row` valido sia per un lettore con il ruolo `hr` sia per uno che non lo possiede — pertanto una regola basata sui **ruoli** non li modifica. Un campo precluso a tutti (`[]` o `excludeFromApi`) ne è invece escluso, come è sempre stato.

Il documento OpenAPI dichiara la regola anziché simulare una variante specifica per ogni chiamante. Ogni proprietà con restrizioni include `x-rebase-access`:

```json
"salary": {
  "type": "number",
  "description": "Salary — Field access: readable by `hr` (and `admin`); writable by nobody through the API. A caller without the role does not receive the field at all — it is absent, not null.",
  "x-rebase-access": { "read": ["hr"], "write": [] }
}
```

Un campo che nessuno può leggere è assente dallo schema di lettura e dai parametri di filtro; un campo che nessuno può scrivere è assente dallo schema di input. Le due direzioni costituiscono schemi separati e vengono valutate distintamente, quindi un token inviato da un amministratore che non viene mai riletto comparirà nel body della richiesta e non nella riga.

## Scritture in-process

`rebase.data` e `rebase.dataAsAdmin` all'interno di un hook, di una funzione o di un cron job non sono soggetti al controllo di scrittura. È la stessa esenzione che `excludeFromApi` ha sempre avuto, ed è ciò che rende la regola concretamente applicabile: qualcosa deve pur poter salvare l'hash della password.

Le letture tramite `rebase.dataAsAdmin` possiedono il ruolo `admin`, quindi una regola sui ruoli non nasconde loro nulla. `[]` continua invece a farlo, anche per `dataAsAdmin`. Usa [`rebase.sql()`](/docs/backend/api/) se hai bisogno della colonna grezza.

## Validazione

I seguenti casi vengono rifiutati all'avvio, prima che il server gestisca qualsiasi richiesta:

- `access` ed `excludeFromApi` sulla stessa proprietà: rappresentano lo stesso meccanismo e il flag prevale, rendendo inutile il blocco adiacente;
- una stringa semplice dove è previsto un elenco (`read: "admin"`), che verrebbe interpretata come una regola non vuota che nessun chiamante soddisfa, nascondendo il campo a chiunque;
- un ruolo che non sia una stringa non vuota;
- un campo con restrizioni indicato in `search.fields` della collection.

I *nomi* dei ruoli non vengono verificati rispetto a un set predefinito: i ruoli sono dati applicativi, creati ed eliminati durante l'esecuzione del server. Un errore di battitura in un nome genera un campo che nessuno può leggere, garantendo un comportamento sicuro in caso di errore (fail-safe).

## Vedi anche

- [Regole di sicurezza (RLS)](/docs/collections/security-rules/) — a quali righe accede un chiamante
- [Proprietà](/docs/collections/properties/) — la tabella completa delle opzioni
- [Codici di errore](/docs/backend/errors/) — `FIELD_NOT_READABLE`, `FIELD_NOT_WRITABLE`

---
