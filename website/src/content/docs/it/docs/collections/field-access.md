---
sourceHash: f55095351eb33abe
title: Accesso ai campi
sidebar_label: Accesso ai campi
description: "Permessi di lettura e scrittura per colonna in base al ruolo con .access(), colonne che non lasciano mai il server con .private() e colonne che i client non possono scrivere con .readOnly(). Un chiamante autorizzato dalle policy della riga non riceve comunque una colonna che i suoi ruoli non possono leggere."
---

<span class="since-badge" data-since="0.31">Da 0.31</span>

La [sicurezza a livello di riga](/docs/collections/security-rules/) decide a quali **righe** accede un chiamante. Tre modificatori di colonna decidono quali **colonne di una riga raggiunta** può visualizzare e impostare:

| Modificatore | Lettura | Scrittura |
|---|---|---|
| `.access({ read, write })` | i ruoli in `read`, se specificati | i ruoli in `write`, se specificati |
| `.private()` | nessuno, tramite l'API | nessuno, tramite l'API |
| `.readOnly()` | come la riga | nessuno, tramite l'API |

Le relazioni accettano le stesse regole come opzioni: `rel.*(target, { access: { read, write } })` e `rel.*(target, { private: true })`.

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

La regola precedente non impone alcun filtro di riga su `select`, quindi ogni chiamante consentito dall'API può leggere ogni riga di staff. Solo un chiamante che possiede il ruolo `hr` ottiene la colonna `salary` di una riga, e nessuno può impostarla via HTTP.

## La regola

<span class="since-badge" data-since="0.31">Da 0.31</span>

`.access()` accetta due elenchi opzionali, e un elenco omesso non equivale a un elenco vuoto: questa differenza costituisce l'intera funzionalità.

| `read` / `write` | Significato |
|------------------|-------------|
| omesso | Delega alla riga. Chiunque l'`rls` della tabella consenta di leggere (o scrivere) la riga ottiene la colonna. |
| `[]` | Nessuno, tramite l'API, a qualsiasi livello di privilegio — né `admin`, né la chiave di servizio, né una lettura in-process. |
| `["hr"]` | Un chiamante con ruolo `hr`, **oppure** `admin`, **oppure** codice server fidato senza alcuna richiesta sottostante. |

I ruoli sono ruoli applicativi di Rebase — gli stessi che `rebase.roles()` restituisce all'interno di una policy e su cui `policy.rolesOverlap` esegue la compilazione. Provengono dal contesto di chiamata: `user.roles` sulla richiesta autenticata.

### Perché `admin` passa sempre

Ogni policy di base inserita da Rebase include un ramo `rolesOverlap(['admin'])`, e `rebase.dataAsAdmin` viene eseguito come `{ uid: "service", roles: ["admin"] }`. Una regola di campo che potesse escludere un amministratore da una colonna del proprio database impedirebbe anche allo Studio di visualizzarla e alla CLI di esportarla. Se serve una colonna che nessun amministratore possa leggere tramite l'API, si usa `read: []`.

### Perché il piano attendibile passa

Il codice server senza una richiesta sottostante — come una migrazione o l'adapter di autenticazione che verifica una password — legge senza alcun ruolo, e un elenco di ruoli non gli si applica. `[]` si applica comunque: è una dichiarazione sulla superficie dell'API piuttosto che su chi sta effettuando la chiamata.

Il `context.data` di un hook non appartiene a quel piano. All'interno di una richiesta legge con i ruoli del chiamante, perciò le regole di campo si applicano a ciò che legge esattamente come si applicano alla richiesta: il driver stesso rifiuta un filtro, un ordinamento, una proiezione, un'inclusione, una ricerca vettoriale, un aggregato o un controllo di unicità che specifichi una colonna che tali ruoli non possono leggere (`FIELD_NOT_READABLE`), e risponde a un nome `.private()` come risponderebbe a un refuso — esattamente come farebbero REST e il socket.

## `.private()` e `.readOnly()` sono lo stesso meccanismo

<span class="since-badge" data-since="0.31">Da 0.31</span>

`.private()` corrisponde a `.access({ read: [], write: [] })`, con una differenza: una colonna privata viene anche esclusa da OpenAPI, dai tipi dell'SDK e dagli schemi dei tool MCP, per cui nemmeno il suo nome è pubblico (vedi [Query](#query)). Una colonna non può essere contemporaneamente `.private()` e dichiarare `.access()`; lo schema viene rifiutato.

`.readOnly()` corrisponde a `write: []`: nessuno scrive la colonna tramite l'API, qualunque sia il proprio ruolo, mentre valori di default, trigger e codice server possono ancora popolarla. Le letture sono delegate alla riga, o ad `.access({ read })` quando entrambi sono definiti.

## Cosa vede un chiamante

### Letture

Un campo che non puoi leggere è **assente** dalla risposta. Non `null`, non una stringa vuota: la chiave non è presente.

```json
// GET /api/data/staff/1  as a caller holding `staff`
{ "id": 1, "name": "Ada" }

// the same row as a caller holding `hr`
{ "id": 1, "name": "Ada", "salary": 90000 }
```

Questo è intenzionale. Un valore omesso restituito come `null` non è distinguibile da un `null` memorizzato, quindi un client potrebbe mappare l'intera colonna contandoli — e un `update` che rimandasse indietro la riga sovrascriverebbe il valore reale con il null ricevuto.

Si applica a ogni punto di uscita: elenco (list), lettura singola (single get), target di relazioni inclusi con `?include=`, risultati di `_batch`, frame realtime da `.listen()`, risultati aggregati e snapshot della [cronologia](#cronologia).

Il valore di una relazione è costituito dalle righe ad essa correlate, quindi una relazione che non puoi leggere viene omessa del tutto. `?include=` la esclude dalla riga, insieme al suo `_count`, da qualsiasi interfaccia: REST, SDK, `.listen()` e inclusioni annidate al livello inferiore. Specificare il suo nome in qualsiasi altro punto viene rifiutato come per un campo (vedi [Query](#query)).

### Query

Un `where`, `orderBy`, `fields`, un `select` aggregato o un `groupBy` che fa riferimento a un campo che non puoi leggere restituisce un errore **400 `FIELD_NOT_READABLE`**. Lo stesso vale per un filtro attraverso una relazione su un campo della sua destinazione non leggibile (`?author.salary=gt.1`), un ordinamento aggregato su di esso (`orderBy=max(staff.salary)`), e una relazione non leggibile specificata in un percorso annidato (`/departments/1/members`, `/departments/1/members/7`) o in un ordinamento aggregato (`orderBy=count(members)`):

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

Senza questo comportamento, il valore sarebbe leggibile un predicato alla volta: venti richieste equivarrebbero a una ricerca binaria su uno stipendio.

L'errore **indica il nome del campo**. È una scelta voluta, non una svista: il documento OpenAPI pubblicato elenca ogni colonna di ogni tabella — viene servito dall'applicazione, non dal router dati autenticato — quindi i nomi dei campi sono già pubblici. Nascondere il nome qui non proteggerebbe nulla e risponderebbe a un vero refuso del chiamante con "unknown field" (campo sconosciuto), portandolo a cercare un errore di battitura inesistente. **I nomi dei campi sono pubblici; i valori dei campi non lo sono.**

Fanno eccezione le colonne `.private()`. OpenAPI, `describe_table` e l'SDK generato le omettono, quindi il loro nome non è pubblico, e un errore "not readable" confermerebbe la loro esistenza. Un filtro, `orderBy`, `fields`, `include`, un `select` o `groupBy` aggregato, o un `vector_search` che fa riferimento a una colonna privata riceve esattamente la stessa risposta di un nome errato — `UNKNOWN_FILTER_FIELD`, `UNKNOWN_ORDER_BY_FIELD`, `UNKNOWN_FIELD`, `UNKNOWN_RELATION`, `UNKNOWN_AGGREGATE_FIELD` o `UNKNOWN_VECTOR_PROPERTY`, con lo stesso messaggio e dettagli — e nessuna risposta di campo sconosciuto la elenca tra i campi validi.

### Scritture

Un valore per un campo che non puoi scrivere genera un **400**, mai una chiave rimossa silenziosamente: una scrittura che ignora un campo segnalerebbe il successo per una modifica che non è avvenuta.

| Codice | Quando |
|------|------|
| `FIELD_NOT_WRITABLE` | `write` è un elenco di ruoli che non soddisfi. Un collega potrebbe ricevere un 200 per lo stesso payload. |
| `VALIDATION_EXCLUDED_FIELDS` | `write` è `[]`, oppure la colonna è `.private()` o `.readOnly()`. Nessuno può scriverla; la risposta è la stessa per ogni chiamante. |

Entrambi contengono `details.violations` indicizzati in base al nome inviato via rete. Applicato su creazione, `PATCH`/`PUT`, `/bulk`, `_batch`, upsert, operazioni di campo (`{ "salary": { "$inc": 1000 } }` fa riferimento a `salary` come qualsiasi altro valore) e sul frame `SAVE` di WebSocket.

Un'operazione di campo richiede anche il permesso di `read` sul campo interessato. Un'operazione su un campo che puoi scrivere ma non leggere viene rifiutata con `FIELD_NOT_READABLE`: il superamento o meno di un limite rivelerebbe il valore che non sei autorizzato a vedere.

### Un collegamento segue la sua colonna chiave

<span class="since-badge" data-since="0.31">Da 0.31</span>

Un `belongsTo` e la colonna chiave a cui è associato sono un unico campo con due rappresentazioni. Scrivere `{ "reviewer": 7 }` è soggetto a ogni regola di `reviewerId` (la sua regola di scrittura, `.readOnly()`, `.private()`, un timestamp di creazione, la colonna tenant); inviare entrambi con valori diversi restituisce `400 VALIDATION_INVALID_VALUE`. Un chiamante che non può leggere `reviewerId` non riceve `reviewer` in un `include`, e un filtro, ordinamento o voce `fields` che vi faccia riferimento risponde con `FIELD_NOT_READABLE`; dietro una chiave `.private()`, la relazione non esiste affatto per i client. L'endpoint dello schema, OpenAPI e MCP li descrivono insieme.

Lo stesso vale per ogni relazione, attraverso qualsiasi elemento la sua join legga: un `hasMany` / `hasOne` legge la foreign key della destinazione, un `via` legge ogni colonna su cui si uniscono i suoi passaggi, su ogni tabella che attraversa. Un chiamante che non può leggere una di queste colonne non ottiene la relazione in un `include` o in un `_count`, riceve `FIELD_NOT_READABLE` filtrando o ordinando attraverso di essa (una relazione sconosciuta quando la colonna è `.private()`), e non la vede descritta.

Un `via` attraverso una tabella non servita dal server — una che viene trattenuta (`TABLE_WITHHELD`) o che le sue tabelle non dichiarano — è precluso a ogni chiamante, incluso il codice attendibile: le sue colonne di join sono considerate non leggibili e non scrivibili, quindi viene omesso da `include`, e un filtro, ordinamento o percorso che lo attraversa viene rifiutato (`FIELD_NOT_READABLE`, o `503 TABLE_WITHHELD` indicando la tabella trattenuta).

Un `manyToMany` la cui tabella di giunzione è dichiarata (`through` fa riferimento a un `defineTable`) è soggetto alle regole di colonna di quella tabella: una scrittura che imposta una colonna di collegamento su `.readOnly()`, `.private()` o chiusa da `access.write` sulla tabella di giunzione viene rifiutata (`VALIDATION_EXCLUDED_FIELDS` / `FIELD_NOT_WRITABLE`), così come un campo `_pivot` precluso dalla tabella di giunzione. Lo stesso vale per le route annidate (`POST`, `PATCH` e `DELETE /:table/:id/:relation/:targetId`, e una modifica a `_pivot`) e via WebSocket. Una giunzione creata automaticamente da Rebase non ha regole proprie.

`strictWrites: false` su una tabella consente solo a una chiave non dichiarata dalla tabella di passare al driver. Non allenta mai una regola su una colonna dichiarata, un timestamp, il tenant, la chiave, la destinazione di una relazione o `_pivot`.

## Ricerca

<span class="since-badge" data-since="0.31">Da 0.31</span>

La ricerca di fallback — una tabella senza un blocco `search` — esegue il confronto con `ILIKE` sulle colonne di testo e ignora quelle che il chiamante non può leggere. Nulla trapela attraverso di essa.

Una tabella che **dichiara** un [blocco `search`](/docs/backend/search) viene compilata in una singola colonna `tsvector` generata e condivisa tra tutti i chiamanti. Non ne esiste una variante per ruolo, quindi una colonna con restrizioni indicata in `search.fields` rimarrebbe *ricercabile* per i chiamanti che non possono vederne il valore — ricostruibile termine per termine. Lo schema viene rifiutato con questa combinazione: rimuovi la colonna da `search.fields` o rimuovi la restrizione di lettura. Nemmeno una colonna `tenant` può avere restrizioni di lettura.

## Cronologia

La [cronologia delle entità](/docs/backend/history) memorizza l'intera riga e viene servita a chiunque possa leggere la riga — il criterio di accesso è "puoi recuperare questa entità", non "sei un amministratore". La regola di lettura viene quindi applicata anche a ciascuno snapshot archiviato: la voce compare comunque nell'elenco, con chi l'ha modificata e quando, ma le colonne escluse vengono rimosse dai suoi `values`.

Il ripristino non viene influenzato. La route di ripristino legge la voce memorizzata sul lato server, per cui un chiamante può ripristinare una versione di cui non può visualizzare tutti i campi — esattamente come può già sovrascrivere una riga senza leggerla per intero.

## Cosa mostra il CMS

Nulla da configurare. Il CMS legge attraverso la stessa API, quindi una colonna che il chiamante non può leggere non arriva mai e il form non la disegna; una colonna che non può scrivere viene rifiutata se qualcosa tenta di inviarla. Questa è una garanzia lato server, a differenza del semplice nascondere un campo nel CMS, che impedisce solo che venga *renderizzato*, lasciando il valore nel JSON.

## Tipi generati e OpenAPI

I tipi `Row`, `Insert` e `Update` dell'SDK hanno un'unica forma per tutti i chiamanti — non esiste un `Row` adatto sia per un lettore con ruolo `hr` sia per uno senza — quindi una regola basata sui **ruoli** non li modifica. Una colonna `.private()` è assente da tutti e tre, e una colonna `.readOnly()` è assente da `Insert` e `Update`. I [tipi dedotti](/docs/schema/types/) seguono la stessa regola.

Il documento OpenAPI definisce la regola anziché simulare una variante per chiamante. Ogni colonna con restrizioni include `x-rebase-access`:

```json
"salary": {
  "type": "number",
  "description": "Salary — Field access: readable by `hr` (and `admin`); writable by nobody through the API. A caller without the role does not receive the field at all — it is absent, not null.",
  "x-rebase-access": { "read": ["hr"], "write": [] }
}
```

Un campo che nessuno può leggere è assente dallo schema di lettura e dai parametri di filtro; un campo che nessuno può scrivere è assente dallo schema di input. Le due direzioni costituiscono schemi separati e sono valutate separatamente, quindi un token che un amministratore invia tramite post e non rilegge mai compare nel corpo della richiesta e non nella riga.

## Scritture in-process

Le scritture in-process — `context.data` in un hook, `rebase.dataAsAdmin` in un hook, una funzione o un cron job — non passano attraverso il controllo di scrittura: `.readOnly()`, un `access.write` per campo e `.private()` sono regole che si applicano al perimetro dell'API. È proprio questo che rende la regola applicabile: qualcosa deve pur essere in grado di memorizzare l'hash della password. Ciò che si applica comunque in-process, sia per una colonna sia per il collegamento ad essa associato: gli stamp del server prevalgono su un valore fornito, una riga non può cambiare tenant e la sua chiave non può essere modificata. La sicurezza a livello di riga si applica ovunque.

Le letture tramite `rebase.dataAsAdmin` detengono il ruolo `admin`, quindi una regola basata sui ruoli non nasconde loro nulla. `[]` continua comunque a farlo — anche nei confronti di `dataAsAdmin`. Usa [`rebase.sql()`](/docs/backend/custom-functions) se hai bisogno della colonna non elaborata.

## Validazione

<span class="since-badge" data-since="0.31">Da 0.31</span>

`.access()` su una colonna, e `access` su una relazione, sollevano un errore al caricamento del modulo a meno che `read` e `write` non siano elenchi di nomi di ruoli non vuoti: una stringa dove è previsto un elenco (`read: "admin"`) viene rifiutata anziché interpretata diversamente.

Vengono rifiutati alla compilazione dello schema, prima che il server gestisca qualsiasi richiesta:

- `.private()` e `.access()` sulla stessa colonna: sono un unico meccanismo;
- una colonna con restrizioni di lettura indicata in `search.fields` della tabella o usata come campo `tenant`;
- una chiave primaria `.private()`: la chiave è il modo in cui viene indirizzata ogni riga.

I *nomi* dei ruoli non vengono verificati rispetto a un set predefinito: i ruoli sono dati dell'applicazione, creati ed eliminati durante l'esecuzione del server. Un refuso in uno di essi genera un campo che nessuno può leggere, che è la direzione più sicura in caso di errore.

## Vedi anche

- [Sicurezza a livello di riga](/docs/collections/security-rules/) — a quali righe accede un chiamante
- [Colonne](/docs/schema/columns/) — tutti i modificatori di colonna
- [Codici di errore](/docs/backend/errors/) — `FIELD_NOT_READABLE`, `FIELD_NOT_WRITABLE`
