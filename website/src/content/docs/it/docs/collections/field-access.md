---
sourceHash: 8ce5fe3122103e0c
title: Accesso ai campi
sidebar_label: Accesso ai campi
description: "Permessi di lettura e scrittura per colonna in base al ruolo con .access(), colonne che non lasciano mai il server con .private(), e colonne che i client non possono scrivere con .readOnly(). Un chiamante autorizzato dalle policy della riga continua a non ricevere una colonna che i suoi ruoli non possono leggere."
---

<span class="since-badge" data-since="0.31">Da 0.31</span>

La [sicurezza a livello di riga](/docs/collections/security-rules/) stabilisce a quali **righe** accede un
chiamante. Tre modificatori di colonna decidono quali **colonne di una riga raggiunta**
possono essere visualizzate e impostate:

| Modificatore | Lettura | Scrittura |
|---|---|---|
| `.access({ read, write })` | i ruoli in `read`, se specificati | i ruoli in `write`, se specificati |
| `.private()` | nessuno, tramite l'API | nessuno, tramite l'API |
| `.readOnly()` | come la riga | nessuno, tramite l'API |

Le relazioni accettano le stesse regole come opzioni: `rel.*(target, { access: { read, write } })`
e `rel.*(target, { private: true })`.

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const staff = defineTable("staff", {
    columns: {
        id:     col.integer().primaryKey().generatedByDefaultAsIdentity(),
        name:   col.text().notNull(),
        // Read by HR (and admins). Set by nobody through the API.
        salary: col.numeric({ precision: 10, scale: 2 }).access({ read: ["hr"], write: [] }),
    },
    rls: [{ operation: "select", access: "public" }],
});
```

La regola sopra indicata non applica alcun filtro di riga a `select`, quindi qualsiasi chiamante ammesso dall'API
legge ogni riga di staff. Solo un chiamante con il ruolo `hr` ottiene la colonna `salary` di
una riga, e nessuno può impostarla tramite HTTP.

## La regola

<span class="since-badge" data-since="0.31">Da 0.31</span>

`.access()` accetta due elenchi opzionali, e un elenco omesso non equivale a un elenco vuoto —
questa differenza costituisce l'intera funzionalità.

| `read` / `write` | Significato |
|------------------|-------|
| omesso | Delega alla riga. Chiunque sia autorizzato dalla `rls` della tabella a leggere (o scrivere) la riga ottiene la colonna. |
| `[]` | Nessuno, tramite l'API, a qualsiasi livello di privilegio — né `admin`, né la service key, né una lettura in-process. |
| `["hr"]` | Un chiamante con il ruolo `hr`, **o** `admin`, **o** codice server fidato senza una richiesta sottostante. |

I ruoli sono ruoli applicativi di Rebase — gli stessi restituiti da `rebase.roles()`
all'interno di una policy e rispetto ai quali compila `policy.rolesOverlap`. Provengono dal
contesto di chiamata: `user.roles` sulla richiesta autenticata.

### Perché `admin` passa sempre

Ogni policy di base inserita da Rebase include un ramo `rolesOverlap(['admin'])`, e
`rebase.dataAsAdmin` viene eseguito come `{ uid: "service", roles: ["admin"] }`. Una regola di campo
che potesse escludere un amministratore da una colonna del proprio database impedirebbe
anche a Studio di visualizzarla e alla CLI di esportarla. Se hai bisogno di una colonna
che nessun amministratore possa leggere tramite l'API, si usa `read: []`.

### Perché il piano fidato passa

Il codice server privo di una richiesta sottostante — una migrazione o l'adattatore di autenticazione
che verifica una password — legge senza alcun ruolo, e un elenco di ruoli non
si applica ad esso. `[]` si applica comunque: si tratta di un'affermazione sulla superficie dell'API
piuttosto che su chi sta chiamando.

Il `context.data` di un hook non appartiene a quel piano. All'interno di una richiesta legge con i
ruoli del chiamante, quindi le regole di campo si applicano a ciò che legge esattamente come si applicano
alla richiesta: il driver stesso rifiuta filtri, ordinamenti, proiezioni, include,
ricerche vettoriali, aggregazioni o verifiche di univocità che specificano una colonna che tali ruoli
non possono leggere (`FIELD_NOT_READABLE`), e risponde a un nome `.private()` come
risponderebbe a un refuso — esattamente come REST e il socket.

## `.private()` e `.readOnly()` sono lo stesso meccanismo

<span class="since-badge" data-since="0.31">Da 0.31</span>

`.private()` equivale a `.access({ read: [], write: [] })`, con una differenza: una
colonna privata viene esclusa anche da OpenAPI, dai tipi dell'SDK e dagli schemi dei tool MCP,
quindi nemmeno il suo nome è pubblico (vedi [Query](#query)). Una colonna
non può essere contemporaneamente `.private()` e dichiarare `.access()`; in tal caso lo schema viene rifiutato.

`.readOnly()` corrisponde a `write: []`: nessuno può scrivere la colonna tramite l'API, indipendentemente
dal proprio ruolo, mentre valori predefiniti, trigger e codice server continuano a popolarla. Le letture
sono delegate alla riga, oppure a `.access({ read })` quando entrambi sono specificati.

## Cosa vede un chiamante

### Letture

Un campo che non puoi leggere è **assente** dalla risposta. Non `null`, non una stringa
vuota: la chiave semplicemente non c'è.

```json
// GET /api/data/staff/1  as a caller holding `staff`
{ "id": 1, "name": "Ada" }

// the same row as a caller holding `hr`
{ "id": 1, "name": "Ada", "salary": 90000 }
```

È una scelta intenzionale. Un valore omesso restituito come `null` sarebbe indistinguibile da un
`null` memorizzato, consentendo a un client di mappare l'intera colonna contando i valori nulli — e un
`update` che reinviasse la riga sovrascriverebbe il valore reale con il null ricevuto.

Si applica a ogni punto di uscita: elenchi, singoli get, destinazioni di relazioni incluse con
`?include=`, risultati di `_batch`, frame realtime da `.listen()`, risultati di
aggregazione e snapshot della [cronologia](#cronologia).

Il valore di una relazione è costituito dalle righe correlate, quindi una relazione che non puoi leggere viene
omessa del tutto. `?include=` la esclude dalla riga, insieme al suo `_count`,
da qualsiasi punto di accesso: REST, SDK, `.listen()` e inclusioni annidate al livello inferiore.
Farvi riferimento in qualsiasi altro punto viene rifiutato come per un campo (vedi [Query](#query)).

### Query

Una clausola `where`, `orderBy`, `fields`, `select` di aggregazione o `groupBy` che indica un campo che
non puoi leggere restituisce un errore **400 `FIELD_NOT_READABLE`**. Lo stesso vale per un filtro tramite relazione
su un campo della sua destinazione che non puoi leggere (`?author.salary=gt.1`), un ordinamento aggregato
su di esso (`orderBy=max(staff.salary)`), e una relazione che non puoi leggere
specificata in un percorso annidato (`/departments/1/members`, `/departments/1/members/7`) o
in un ordinamento aggregato (`orderBy=count(members)`):

```http
GET /api/data/staff?salary=gt.100000
```

```json
{
  "error": {
    "code": "FIELD_NOT_READABLE",
    "message": "'salary' is not readable on table 'staff' with your roles, so it cannot be used in a filter.",
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

Senza questo comportamento, il valore sarebbe leggibile un predicato alla volta: venti richieste equivarrebbero a
una ricerca binaria su uno stipendio.

L'errore **indica il nome del campo**. Si tratta di una scelta progettuale, non di una svista: il
documento OpenAPI pubblicato elenca ogni colonna di ogni tabella — viene
servito dall'applicazione, non dal router dati autenticato — quindi i nomi dei campi
sono già pubblici. Nascondere il nome in questo caso non proteggerebbe nulla e risponderebbe a
un banale refuso del chiamante con "unknown field", inducendolo a cercare un errore di battitura
inesistente. **I nomi dei campi sono pubblici; i valori dei campi non lo sono.**

Ad eccezione delle colonne `.private()`. OpenAPI, `describe_table` e l'SDK generato
la omettono, quindi il suo nome non è pubblico, e indicare "not readable" confermerebbe la sua esistenza.
Un filtro, `orderBy`, `fields`, `include`, `select` di aggregazione o
`groupBy`, oppure `vector_search` che fa riferimento a una colonna privata riceve esattamente la stessa risposta di un nome
errato — `UNKNOWN_FILTER_FIELD`, `UNKNOWN_ORDER_BY_FIELD`, `UNKNOWN_FIELD`,
`UNKNOWN_RELATION`, `UNKNOWN_AGGREGATE_FIELD` o `UNKNOWN_VECTOR_PROPERTY`,
con lo stesso messaggio e gli stessi dettagli — e nessuna risposta di campo sconosciuto la include tra i
campi validi.

### Scritture

Un valore fornito per un campo che non puoi scrivere restituisce un errore **400**, senza mai scartare la chiave in modo silenzioso:
una scrittura che ignora un campo segnalerebbe il successo di una modifica che non è mai avvenuta.

| Codice | Quando |
|------|------|
| `FIELD_NOT_WRITABLE` | `write` è un elenco di ruoli che non soddisfi. Un collega potrebbe ottenere un 200 con lo stesso payload. |
| `VALIDATION_EXCLUDED_FIELDS` | `write` è `[]`, o la colonna è `.private()` o `.readOnly()`. Nessuno può scriverla; la risposta è la stessa per ogni chiamante. |

Entrambi includono `details.violations` indicizzati in base al nome inviato sulla rete. Applicato su
creazione, `PATCH`/`PUT`, `/bulk`, `_batch`, upsert, operazioni sui campi
(`{ "salary": { "$inc": 1000 } }` fa riferimento a `salary` come qualsiasi valore) e sul frame WebSocket `SAVE`.

Un'operazione sui campi richiede anche i permessi di lettura (`read`) sul campo stesso. Un'operazione su un campo che puoi
scrivere ma non leggere viene rifiutata con `FIELD_NOT_READABLE`: l'eventuale superamento di un
limite rivelerebbe il valore che non ti è consentito vedere.

### Un collegamento segue la propria colonna chiave

<span class="since-badge" data-since="0.31">Da 0.31</span>

Una relazione `belongsTo` e la colonna chiave a cui è associata sono un unico campo con due
forme di scrittura. Scrivere `{ "reviewer": 7 }` è soggetto a ogni regola di `reviewerId`
(la sua regola di scrittura, `.readOnly()`, `.private()`, un timestamp di creazione, la colonna
tenant); inviare entrambi con valori differenti restituisce `400 VALIDATION_INVALID_VALUE`.
Un chiamante che non può leggere `reviewerId` non riceve `reviewer` in un `include`,
e un filtro, ordinamento o voce `fields` che vi fa riferimento risponde con `FIELD_NOT_READABLE`;
dietro una chiave `.private()` la relazione non esiste affatto per i client. L'endpoint dello
schema, OpenAPI ed MCP descrivono i due elementi insieme.

Lo stesso vale per ogni relazione, attraverso qualsiasi elemento letto dalla sua join: una
`hasMany` / `hasOne` legge la foreign key della tabella di destinazione, una `via` ogni colonna su cui si uniscono i suoi
passaggi, su ogni tabella che attraversa. Un chiamante che non può leggere una
di queste colonne non riceve la relazione in un `include` o in un `_count`, ottiene
`FIELD_NOT_READABLE` filtrando o ordinando attraverso di essa (una relazione sconosciuta quando
la colonna è `.private()`), e non la vede descritta.

`strictWrites: false` su una tabella consente solo di inoltrare al driver una chiave non dichiarata
dalla tabella. Non allenta mai una regola su una colonna dichiarata, uno stamp,
il tenant, la chiave, la destinazione di una relazione o `_pivot`.

## Ricerca

<span class="since-badge" data-since="0.31">Da 0.31</span>

La ricerca di fallback — per una tabella senza blocco `search` — esegue il matching `ILIKE` sulle
colonne di testo e ignora quelle che il chiamante non può leggere. Nulla trapela
attraverso di essa.

Una tabella che **dichiara** un [blocco `search`](/docs/backend/search) compila
in una singola colonna `tsvector` generata e condivisa da tutti i chiamanti. Non ne esiste una
variante per ruolo, quindi una colonna con restrizioni indicata in `search.fields`
rimarrebbe *ricercabile* per i chiamanti che non possono vederne il valore — recuperabile un termine alla
volta. Lo schema viene rifiutato con questa combinazione: rimuovi la colonna da
`search.fields` oppure elimina la restrizione di lettura. Nemmeno una colonna `tenant` può avere restrizioni
di lettura.

## Cronologia

La [cronologia delle entità](/docs/backend/history) memorizza l'intera riga e viene servita a
chiunque possa leggere la riga — la condizione di accesso è "puoi recuperare questa entità", non "sei
un admin". Pertanto, la regola di lettura viene applicata anche a ogni snapshot memorizzato: la voce
è comunque elencata, con l'indicazione di chi l'ha modificata e quando, e le colonne escluse vengono rimosse
dai suoi `values`.

Il ripristino non viene influenzato. La route di ripristino legge la voce memorizzata lato server, consentendo a
un chiamante di ripristinare una versione di cui non può vedere tutti i campi — esattamente come
può già sovrascrivere una riga senza doverla leggere per intero.

## Cosa mostra il CMS

Nulla da configurare. Il CMS legge attraverso la stessa API, quindi una colonna che il
chiamante non può leggere non arriva mai e il form non la disegna; una colonna che
non può scrivere viene rifiutata se si tenta di inviarla. Questa è una garanzia lato
server, a differenza dell'occultamento di un campo nel CMS, che impedisce solo il suo
*rendering* lasciando il valore nel JSON.

## Tipi generati e OpenAPI

I tipi `Row`, `Insert` e `Update` dell'SDK hanno un'unica forma per tutti i chiamanti —
non esiste un tipo `Row` valido sia per un lettore con il ruolo `hr` sia per uno che
non lo possiede — quindi una regola basata sui **ruoli** non li modifica. Una colonna `.private()` è assente
da tutti e tre, e una `.readOnly()` è assente da `Insert` e `Update`. I
[tipi dedotti](/docs/schema/types/) seguono la stessa regola.

Il documento OpenAPI dichiara la regola anziché simulare una vista per singolo chiamante.
Ogni colonna soggetta a restrizioni include `x-rebase-access`:

```json
"salary": {
  "type": "number",
  "description": "Salary — Field access: readable by `hr` (and `admin`); writable by nobody through the API. A caller without the role does not receive the field at all — it is absent, not null.",
  "x-rebase-access": { "read": ["hr"], "write": [] }
}
```

Un campo che nessuno può leggere è assente dallo schema di lettura e dai parametri
di filtro; un campo che nessuno può scrivere è assente dallo schema di input. Le due
direzioni costituiscono schemi separati e vengono valutate separatamente, in modo che un token inviato da un admin
e mai riletto compaia nel corpo della richiesta ma non nella riga.

## Scritture in-process

Le scritture in-process — `context.data` in un hook, `rebase.dataAsAdmin` in un hook,
una funzione o un cron job — non passano attraverso il controllo di scrittura: `.readOnly()`,
`access.write` a livello di campo e `.private()` sono regole del perimetro dell'API.
È proprio questo che rende la regola applicabile: qualcosa deve pur essere in grado di
memorizzare l'hash della password. Ciò che si applica comunque in-process, per una colonna e per il
collegamento a essa associato: gli stamp del server hanno la precedenza sui valori forniti, una riga non può
cambiare tenant e la sua chiave non può essere modificata. La sicurezza a livello di riga si applica
ovunque.

Le letture tramite `rebase.dataAsAdmin` dispongono del ruolo `admin`, quindi una regola basata sui ruoli non
nasconde loro nulla. `[]` continua invece a nasconderlo — anche a `dataAsAdmin`. Usa
[`rebase.sql()`](/docs/backend/custom-functions) se hai bisogno della colonna grezza.

## Validazione

<span class="since-badge" data-since="0.31">Da 0.31</span>

`.access()` su una colonna e `access` su una relazione generano un'eccezione al caricamento
del modulo a meno che `read` e `write` non siano elenchi di nomi di ruolo non vuoti: una stringa
dove è previsto un elenco (`read: "admin"`) viene rifiutata anziché interpretata in
altro modo.

I seguenti casi vengono rifiutati al momento della compilazione dello schema, prima che il server gestisca
qualsiasi richiesta:

- `.private()` e `.access()` sulla stessa colonna: sono lo stesso meccanismo;
- una colonna con restrizioni di lettura indicata in `search.fields` della tabella o utilizzata come
  campo `tenant`;
- una chiave primaria `.private()`: la chiave è il modo in cui ogni riga viene indirizzata.

I *nomi* dei ruoli non vengono verificati rispetto a un set predefinito: i ruoli sono dati applicativi, creati
ed eliminati durante l'esecuzione del server. Un refuso in un nome si traduce in un campo che nessuno può leggere,
che è la modalità di fallimento più sicura.

## Vedi anche

- [Sicurezza a livello di riga](/docs/collections/security-rules/) — a quali righe accede un chiamante
- [Colonne](/docs/schema/columns/) — tutti i modificatori di colonna
- [Codici di errore](/docs/backend/errors/) — `FIELD_NOT_READABLE`, `FIELD_NOT_WRITABLE`
