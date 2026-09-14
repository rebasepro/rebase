---
sourceHash: b3e463880abd2023
title: Accesso ai campi
sidebar_label: Accesso ai campi
description: Permessi di lettura e scrittura per proprietà in base al ruolo. Un chiamante ammesso dalle regole di sicurezza della riga non riceve comunque un campo che i suoi ruoli non possono leggere.
---

## Panoramica

Le [regole di sicurezza](/docs/collections/security-rules/) decidono quali **righe** un chiamante può
raggiungere. `access` decide quali **campi di una riga raggiunta** può vedere e impostare.

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

La regola sopra non applica alcun filtro di riga su `select`, quindi ogni chiamante ammesso
dall'API può leggere ogni riga di staff. Solo un chiamante con il ruolo `hr` ottiene la colonna
`salary` di una riga, e nessuno può impostarla tramite HTTP.

## La regola

`access` ha due liste opzionali, e una lista omessa non equivale a una lista vuota: la
differenza costituisce l'intera funzionalità.

| `read` / `write` | Significato |
|------------------|-------------|
| omesso | Delega alla riga. Chiunque sia autorizzato a leggere (o scrivere) la riga dalle regole di sicurezza della collection ottiene il campo. |
| `[]` | Nessuno, tramite l'API, con qualsiasi privilegio — né `admin`, né la service key, né una lettura in-process. |
| `["hr"]` | Un chiamante con il ruolo `hr`, **o** `admin`, **o** codice server fidato non associato a una richiesta. |

I ruoli sono ruoli applicativi di Rebase — gli stessi che `rebase.roles()` restituisce
all'interno di una policy e su cui si basa la compilazione di `policy.rolesOverlap`. Provengono
dal contesto della chiamata: `user.roles` nella richiesta autenticata.

### Perché `admin` passa sempre

Ogni policy di base inserita da Rebase contiene una clausola `rolesOverlap(['admin'])`, e
`rebase.dataAsAdmin` viene eseguito come `{ uid: "service", roles: ["admin"] }`. Una regola di campo
che potesse escludere un amministratore da una colonna del proprio database impedirebbe anche
a Studio di renderizzarla e alla CLI di esportarla. Se serve una colonna che nessun amministratore
possa leggere tramite l'API, si usa `read: []`.

### Perché il piano fidato passa

Il codice server non associato a una richiesta — una migrazione o l'adapter di autenticazione
che verifica una password — legge senza alcun ruolo e l'elenco dei ruoli non si applica ad
esso. `[]` si applica comunque: si tratta di un'istruzione che riguarda la superficie dell'API
piuttosto che l'identità del chiamante.

Il `context.data` di una callback non appartiene a quel piano. All'interno di una richiesta legge
con i ruoli del chiamante, quindi le regole di campo si applicano a ciò che legge esattamente come
si applicano alla richiesta.

## `excludeFromApi` è lo stesso meccanismo

`excludeFromApi: true` è zucchero sintattico per `access: { read: [], write: [] }`. C'è un
unico predicato dietro entrambe le sintassi, quindi tutto ciò che si trova in questa pagina si
applica anche a questo flag. Usa la forma più leggibile — ma non entrambe sulla stessa proprietà,
operazione che viene rifiutata all'avvio.

## Cosa vede un chiamante

### Letture

Un campo che non puoi leggere è **assente** dalla risposta. Non `null`, non una stringa
vuota: la chiave non è presente.

```json
// GET /api/data/staff/1  as a caller holding `staff`
{ "id": 1, "name": "Ada" }

// the same row as a caller holding `hr`
{ "id": 1, "name": "Ada", "salary": 90000 }
```

È una scelta deliberata. Un valore trattenuto restituito come `null` sarebbe indistinguibile da un
`null` memorizzato, consentendo a un client di mappare l'intera colonna contandoli — e un
`update` che rimandasse indietro la riga sovrascriverebbe il valore reale con il null ricevuto.

Si applica a ogni punto di uscita: list, get singolo, destinazioni di relazioni incluse con
`?include=`, risultati di `_batch`, frame realtime da `.listen()`, risultati aggregati e snapshot
della [cronologia](#cronologia).

### Query

Un `where`, `orderBy`, `fields`, `select` aggregata o `groupBy` che fa riferimento a un campo che
non puoi leggere restituisce un errore **400 `FIELD_NOT_READABLE`**:

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

Senza questo controllo, il valore sarebbe leggibile un predicato alla volta: venti richieste
equivarrebbero a una ricerca binaria su uno stipendio.

L'errore **indica il nome del campo**. È una decisione consapevole, non una svista: il
documento OpenAPI pubblicato elenca ogni proprietà di ogni collection — viene servito
dall'app, non dal router dei dati autenticato — quindi i nomi dei campi sono già pubblici.
Nascondere il nome qui non proteggerebbe nulla e risponderebbe a un banale refuso del chiamante
con "unknown field", spingendolo a cercare un errore di battitura inesistente. **I nomi dei campi
sono pubblici; i valori dei campi non lo sono.**

### Scritture

Un valore per un campo che non puoi scrivere restituisce un errore **400**, non viene mai scartato
silenziosamente: una scrittura che scarta un campo segnalerebbe il successo di una modifica che non è
mai avvenuta.

| Codice | Quando |
|--------|--------|
| `FIELD_NOT_WRITABLE` | `write` è un elenco di ruoli che non soddisfi. Un tuo collega potrebbe ricevere un 200 per lo stesso body. |
| `VALIDATION_EXCLUDED_FIELDS` | `write` è `[]` (o `excludeFromApi`). Nessuno può scriverlo; la risposta è la stessa per ogni chiamante. |

Entrambi contengono `details.violations` indicizzati in base al nome inviato sul wire. Applicato
su create, `PATCH`/`PUT`, `/bulk`, `_batch`, upsert, operazioni sui campi
(`{ "salary": { "$inc": 1000 } }` fa riferimento a `salary` come qualsiasi valore) e sul
frame WebSocket `SAVE`.

## Ricerca

La ricerca di fallback — una collection senza blocco `search` — confronta tramite `ILIKE` le
proprietà stringa, saltando quelle che il chiamante non può leggere. Nulla viene
divulgato attraverso di essa.

Una collection che **dichiara** un blocco [`search`](/docs/backend/api/) viene compilata
in una singola colonna generata `tsvector` condivisa da tutti i chiamanti. Non ne esiste una
variante per ruolo, pertanto un campo riservato indicato in `search.fields` rimarrebbe
*ricercabile* per i chiamanti che non possono vederne il valore — recuperabile un termine
alla volta. Rebase rifiuta questa combinazione all'avvio: rimuovi il campo da
`search.fields` oppure rimuovi la restrizione di lettura.

## Cronologia

La [cronologia dell'entità](/docs/backend/api/) memorizza l'intera riga e viene fornita a
chiunque possa leggere la riga: il controllo d'accesso si basa su "puoi recuperare questa entità",
non su "sei un amministratore". Pertanto la regola di lettura viene applicata anche a ciascuno
snapshot memorizzato: la voce compare comunque nell'elenco, con l'autore e la data della modifica,
ma le colonne trattenute vengono rimosse dai suoi `values`.

Il ripristino (revert) non viene influenzato. La route di ripristino legge la voce memorizzata lato
server, quindi un chiamante può ripristinare una versione di cui non può vedere tutti i campi —
esattamente come può già sovrascrivere una riga senza leggerne l'intero contenuto.

## Cosa mostra il pannello di amministrazione

Niente da configurare. Lo Studio legge attraverso la stessa API, quindi un campo che il
chiamante non può leggere non arriva mai e il modulo non lo disegna; un campo che non può
scrivere viene rifiutato se qualcosa tenta di inviarlo. Questa è una garanzia lato server, a
differenza di `admin.hideFromCollection`, che si limita a impedire al pannello di
*renderizzare* un campo, lasciando il valore nel JSON.

## Tipi generati e OpenAPI

I tipi `Row`, `Insert` e `Update` dell'SDK hanno un'unica forma per tutti i chiamanti —
non esiste un tipo `Row` adatto sia a un lettore con ruolo `hr` sia a uno che non lo possiede —
quindi una regola sui **ruoli** non li modifica. Un campo precluso a tutti
(`[]`, o `excludeFromApi`) è assente da essi, come è sempre stato.

Il documento OpenAPI dichiara la regola anziché simulare una visualizzazione specifica per chiamante.
Ogni proprietà con restrizioni include `x-rebase-access`:

```json
"salary": {
  "type": "number",
  "description": "Salary — Field access: readable by `hr` (and `admin`); writable by nobody through the API. A caller without the role does not receive the field at all — it is absent, not null.",
  "x-rebase-access": { "read": ["hr"], "write": [] }
}
```

Un campo che nessuno può leggere è assente dallo schema di lettura e dai parametri di
filtro; un campo che nessuno può scrivere è assente dallo schema di input. Le due direzioni
costituiscono schemi separati e vengono valutate separatamente, quindi un token che un
amministratore invia e non rilegge mai appare nel corpo della richiesta ma non nella riga.

## Scritture in-process

Le scritture in-process — `context.data` in una callback, `rebase.dataAsAdmin` in una
callback, una funzione o un cron job — non passano attraverso il controllo di scrittura. È
la stessa esenzione che `excludeFromApi` ha sempre avuto, ed è ciò che rende la regola
concretamente applicabile: qualcosa deve pur essere in grado di memorizzare l'hash della password.

Le letture tramite `rebase.dataAsAdmin` possiedono il ruolo `admin`, quindi una regola sui ruoli non
nasconde loro nulla. `[]` lo fa comunque — anche per `dataAsAdmin`. Usa
[`rebase.sql()`](/docs/backend/api/) se hai bisogno della colonna grezza.

## Validazione

Queste configurazioni vengono rifiutate all'avvio, prima che il server gestisca qualsiasi richiesta:

- `access` ed `excludeFromApi` sulla stessa proprietà — sono un unico meccanismo e il
  flag prevale, quindi il blocco accanto sarebbe inerte;
- una stringa semplice dove è richiesta una lista (`read: "admin"`), che verrebbe interpretata come una
  regola non vuota che nessun chiamante soddisfa, nascondendo il campo a chiunque;
- un ruolo che non sia una stringa non vuota;
- un campo con restrizioni indicato nei `search.fields` della collection.

I *nomi* dei ruoli non vengono verificati rispetto a un set predefinito: i ruoli sono dati
applicativi, creati ed eliminati durante l'esecuzione del server. Un errore di battitura in un
ruolo genera un campo che nessuno può leggere, ovvero il comportamento fallimentare più sicuro.

## Vedi anche

- [Security Rules (RLS)](/docs/collections/security-rules/) — quali righe può raggiungere un chiamante
- [Proprietà](/docs/collections/properties/) — la tabella completa delle opzioni
- [Codici di errore](/docs/backend/errors/) — `FIELD_NOT_READABLE`, `FIELD_NOT_WRITABLE`
