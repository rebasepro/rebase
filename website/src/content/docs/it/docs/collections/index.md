---
sourceHash: f7689301748e2ce5
title: Tabelle nel CMS
sidebar_label: Tabelle nel CMS
description: "Come il CMS mostra ogni tabella Postgres senza configurazione frontend: etichette, il widget assegnato a ciascun tipo di colonna, campi obbligatori e di sola lettura, relazioni, display slot e controlli Crea, Modifica ed Elimina che seguono la row-level security della tabella."
---

<span class="since-badge" data-since="0.31">Da 0.31</span>

Se usi il CMS, non devi descrivergli le tue tabelle. Quando qualcuno effettua
l'accesso, il pannello richiede al backend le tabelle che quella persona può vedere
e mostra ciascuna di esse come una **collection**: una pagina nella navigazione con
una vista a tabella, un modulo, filtri e le righe correlate del record. Una tabella
è l'oggetto backend dichiarato in [`backend/schema`](/docs/schema/); una collection
è il modo in cui il pannello la visualizza.

```tsx
// frontend/src/App.tsx: nothing about posts, users or tags here.
<Rebase client={rebaseClient} authController={authController}>
    <RebaseAuth/>
    <RebaseCMS/>
    <RebaseShell title="Acme"/>
</Rebase>
```

Tutto ciò che segue è ricavato dal descrittore della tabella: le sue colonne con i
rispettivi tipi Postgres, supporto ai valori null, valori predefiniti, regole di
convalida e archiviazione, relazioni e impostazioni di row-level security. Per
modificarne qualsiasi aspetto, aggiungi un file
[`customizeTable`](/docs/frontend/customize-table/); indicherà solo le differenze.

:::note[Arrivi dalle collection?]
In precedenza il pannello leggeva `config/collections` tramite un plugin Vite.
Ora legge le tabelle fornite dal backend, e la presentazione si trova in
`frontend/src/cms/*.tsx`.
:::

## Da dove provengono le tabelle

<span class="since-badge" data-since="0.31">Da 0.31</span>

`<RebaseCMS>` chiama `client.schema.tables()`, che legge
`GET /api/schema/tables`. La risposta è l'elenco dei descrittori delle tabelle,
redatto in base al chiamante: una tabella che non può leggere è assente, così come
una colonna che i suoi ruoli non possono leggere (vedi [Accesso ai campi](/docs/collections/field-access/)).
Il codice degli hook non lascia mai il server; il descrittore indica solo quali hook esistono.

- Il pannello effettua la richiesta quando un utente accede, e la ripete quando
  l'utente connesso o i suoi ruoli cambiano. A un visitatore non autenticato non viene
  inviata alcuna tabella.
- Il server etichetta la risposta con un `ETag`. Il client conserva l'ultima risposta
  e invia nuovamente il tag, quindi uno schema non modificato comporta un `304`.
- L'aggiornamento della navigazione ripete la richiesta. L'editor dello schema
  esegue questa operazione dopo aver modificato una tabella.

Gli stessi descrittori guidano lo Studio e le app MCP, quindi tutti e tre concordano
sulla definizione di una tabella.

## Etichette

<span class="since-badge" data-since="0.31">Da 0.31</span>

Ogni etichetta è derivata da un identificatore, affinché una tabella risulti identica
per ogni chiamante e a ogni caricamento:

| Identificatore | Etichetta |
|---|---|
| colonna `first_name`, `firstName` o `FirstName` | First Name |
| colonna `author_id`, `photoUrl`, `apiKey` | Author ID, Photo URL, API Key |
| colonna `__order` | Order |
| tabella `order_items` | Order Items, un record: Order Item |
| tabella `addresses`, `status_updates` | Addresses / Address, Status Updates / Status Update |
| valore enum `needs_review` | Needs Review |

Le etichette della tabella provengono dal nome con cui è stata definita, non dal suo
slug o nome SQL. `ID`, `IDs`, `URL`, `URLs`, `UUID`, `API` e `IP` mantengono le
maiuscole. Il singolare modifica solo l'ultima parola e lascia invariate le parole
che finiscono semplicemente in `s` (`Status`, `Analysis`, `Address`).

## Il campo assegnato a ciascuna colonna

<span class="since-badge" data-since="0.31">Da 0.31</span>

| Colonna | Campo nel modulo | Note |
|---|---|---|
| `col.text()`, `col.varchar({ length })`, `col.char({ length })`, `col.uuid()` | input di testo | `varchar` e `char` limitano la lunghezza |
| una colonna di testo con `.validate({ email: true })` | input email | convalidata come email |
| una colonna di testo con `.validate({ url: true })` | input URL, con anteprima del link | convalidata come URL |
| una colonna di testo con `{ enum: [...] }`, una colonna numerica con `.oneOf([...])` | select | un'opzione per valore |
| una colonna di testo o uuid con `.userId()` | selettore utente | il valore è l'ID dell'utente |
| `col.enum([...])`, una colonna `pgEnum` | select, visualizzato come chip colorato | un colore per valore, generato dal valore stesso |
| `col.smallint()` … `col.bigserial({ mode: "number" })` | input numerico | solo numeri interi |
| `col.real()`, `col.doublePrecision()`, `col.numeric({ precision, scale })` | input numerico | |
| `col.boolean()` | switch | |
| `col.timestamp({ withTimezone: true })` | selettore di data e ora | |
| `col.date()` | selettore di data | |
| `col.time()` | ora del giorno | |
| `col.storage(…)` | campo di upload con anteprima | `.multiple()` è un campo multi-file |
| `<item>.array()` | elenco ripetibile del campo dell'elemento | un array di testo `{ enum: [...] }` è una selezione multipla |
| `col.jsonb().$type<T>()`, `col.json().$type<T>()` | editor chiave/valore | il tipo `T` viene rimosso a runtime |
| `col.jsonb(json.object({…}))` | un gruppo di campi tipizzati | liste, blocchi tipizzati e file all'interno, definiti dalla struttura |
| `col.geopoint()` | latitudine e longitudine | |
| `col.vector({ dimensions })` | input vettoriale | |
| `col.bytea()` | campo binario | base64 durante il trasferimento |

Un valore enum mantiene il proprio colore ovunque appaia: nella select, nel chip
della tabella e come colonna kanban. Il colore dipende unicamente dal valore, quindi
l'aggiunta di un valore non ricolora mai gli altri. `customizeTable` consente di
specificare le etichette e i colori desiderati tramite `enumLabels`; un valore non
specificato mantiene quello derivato.

Una colonna `jsonb` dichiarata con una [struttura `json.*`](/docs/schema/json/)
ottiene un modulo reale: un oggetto è un gruppo di campi, un array ripete il
proprio elemento, un array di `json.oneOf` è un editor di blocchi e `json.storage()`
è un campo di upload al suo interno. Senza una struttura, il pannello non può
conoscere il documento e offre una modifica libera di tipo chiave/valore.

Ciascun tipo di colonna, il rispettivo widget e le opzioni che lo modificano sono
descritti in [Campi](/docs/collections/properties/).

## Campi obbligatori, predefiniti e di sola lettura

<span class="since-badge" data-since="0.31">Da 0.31</span>

| Colonna | Nel modulo |
|---|---|
| `.notNull()` | obbligatorio, con il `requiredMessage` di `.validate()` se presente |
| `.default(literal)` | un nuovo record si apre con quel valore; rimane obbligatorio in modifica |
| `` .default(sql`…`) ``, `.defaultNow()`, `.dbDefault()` | può essere lasciato vuoto in fase di creazione, affinché venga popolato dal database |
| `.unique()` | il modulo verifica che il valore non sia già in uso prima di salvare |
| una chiave primaria generata (`.defaultRandom()`, `.generatedByDefaultAsIdentity()`, un serial) | non modificabile; una chiave senza valore predefinito viene inserita manualmente alla creazione |
| `.onCreateNow()`, `.onUpdateNow()` | in sola lettura ed esclusi dalle colonne predefinite della tabella |
| `.onCreateUser()`, `.onUpdateUser()` | in sola lettura |
| `.readOnly()`, `.generatedAlwaysAs(…)` | in sola lettura |
| il campo `tenant` della tabella | compilato dal server alla creazione ed escluso dalle colonne predefinite della tabella; ancora modificabile per un chiamante autorizzato alla scrittura |
| `.private()` | mai inviato, quindi mai mostrato |

Le regole `.validate()` di una colonna vengono verificate dal modulo prima del
salvataggio, così come il server le verifica all'arrivo. Vedi
[Convalida e condizioni](/docs/collections/validation-and-conditions/).

L'id del record e i suoi timestamp `.onCreateNow()` e `.onUpdateNow()` vengono
mostrati nel blocco di sola lettura in fondo alla barra laterale del modulo.

## Relazioni

<span class="since-badge" data-since="0.31">Da 0.31</span>

- Un `belongsTo` è un selettore della riga correlata, al posto della relativa colonna
  di chiave esterna: il modulo mostra **Author**, non **Author ID**. È obbligatorio
  quando la chiave esterna è `NOT NULL` senza valore predefinito. Una chiave esterna
  che fa parte della chiave primaria rimane un campo a sé stante, accanto al selettore.
- Un `hasOne` è un selettore della singola riga correlata.
- Un `hasMany`, un `manyToMany` e una relazione a molti `via` sono **schede** del
  record che elencano le righe correlate. Il selettore accanto alla scheda è nascosto.
- Un `via` è di sola lettura a meno che non sia scrivibile.
- Una relazione verso una tabella non fornita al chiamante viene omessa: il pannello
  non può aprire una tabella che non possiede. In tal caso, un `belongsTo` lascia la
  propria chiave esterna come un campo semplice, in modo che il valore rimanga visibile.

Vedi [Relazioni nel pannello](/docs/collections/relations-in-the-admin-panel/).

## Display slot

<span class="since-badge" data-since="0.31">Da 0.31</span>

Ogni interfaccia che visualizza un record utilizza alcuni dei sei slot: title, subtitle,
image, status, date e tags (vedi [display slot](/docs/frontend/view-modes/#display-slots)).
Uno slot viene popolato da una colonna solo quando la colonna vi appartiene chiaramente;
la prima colonna corrispondente, in ordine di dichiarazione, ha la precedenza:

| Slot | Colonna |
|---|---|
| title | una colonna di testo priva di set chiuso di valori e senza file, la cui chiave è `title`, `name`, `label`, `displayName`, `fullName`, `heading`, `subject` o `username` (ignorando maiuscole/minuscole e separatori) |
| image | una singola colonna `col.storage()` la cui proprietà `accept` specifica un tipo di immagine |
| status | una colonna denominata `status` con un set chiuso di valori |
| date | una colonna di tipo data o timestamp che il server non imposta automaticamente (`publishDate`); in mancanza di questa, il timestamp di aggiornamento e infine quello di creazione |

Uno slot non compilato da alcuna colonna viene affidato all'interpretazione del
record da parte del pannello (per il titolo: il primo campo di testo breve). La
proprietà `display` in `customizeTable` consente di impostare esplicitamente
qualsiasi slot.

## Chi vede quali controlli

<span class="since-badge" data-since="0.31">Da 0.31</span>

Il pannello nasconde **Crea**, **Modifica** ed **Elimina** quando l'utente autenticato
non è autorizzato a eseguire tali azioni. Lo determina valutando la row-level security
della tabella nel browser, con lo stesso modello di policy compilato per Postgres:

- le regole dichiarate in `rls`, più le policy aggiunte da Rebase: la baseline
  per l'amministratore (a meno che non sia specificato `defaultPolicies: false`), la
  lettura autonoma della tabella utenti e il controllo di scrittura per l'amministratore,
  oltre alla regola di tenancy
  (vedi [policy assegnate a una tabella](/docs/collections/security-rules/#policies-a-table-gets-without-writing-them));
- `rls: "admin-only"`: solo gli amministratori vedono i controlli;
- una regola scritta in SQL non elaborato (raw SQL) non può essere valutata nel
  browser, così come una clausola che il server ha nascosto a questo chiamante: il
  controllo viene mostrato e il database deciderà al momento della scrittura;
- una vista SQL è di sola lettura. Una vista standard viene elencata e le tabelle
  da cui legge determinano quali righe vengono restituite; una vista materializzata
  viene elencata per i ruoli che specifica (`["admin"]` quando non ne specifica alcuno).

Questo determina unicamente ciò che viene renderizzato a schermo. Ogni scrittura viene
verificata nuovamente da Postgres, quindi un controllo che non avrebbe dovuto essere
mostrato porterà a una scrittura rifiutata, mai a una scrittura che non sarebbe dovuta avvenire.

## Ordinamento e valori predefiniti

<span class="since-badge" data-since="0.31">Da 0.31</span>

Le tabelle compaiono nella navigazione nell'ordine in cui il backend le fornisce,
ossia l'ordine in cui sono esportate da `backend/schema/index.ts`. Ciascuna si apre
nella vista tabella. `customizeTable` imposta `group`, `icon`, `defaultViewMode` e
le altre opzioni; `<RebaseCMS navigationGroupMappings>` organizza i gruppi tra le varie tabelle.

## Caricamento ed errori

<span class="since-badge" data-since="0.31">Da 0.31</span>

- **Durante il caricamento delle tabelle**, una route verso una collection mostra
  lo stato di caricamento e non "collection non trovata", e un deep link si apre
  una volta che la collection esiste.
- **Se le tabelle non possono essere caricate**, la home page e la route della
  collection indicano cosa è fallito e consentono di riprovare. Quando il server non
  accetta più la sessione, il messaggio richiede di effettuare nuovamente l'accesso.
- **Un backend che non fornisce tabelle** (uno senza autenticazione configurata
  o precedente alla route) non costituisce un errore: il pannello mostra le
  [collection esterne](/docs/frontend/firebase/) e nient'altro.

Le personalizzazioni che fanno riferimento a una tabella non fornita al chiamante
vengono ignorate, con un avviso in fase di sviluppo. Vedi
[cosa viene rifiutato e cosa viene saltato](/docs/frontend/customize-table/#what-is-refused-and-what-is-skipped).

## Numerose tabelle

<span class="since-badge" data-since="0.31">Da 0.31</span>

Non vi è alcun limite al numero di tabelle. Il pannello ha bisogno di ogni collection
per visualizzare la navigazione, quindi i descrittori vengono recuperati dopo l'accesso,
e ciò che serve per aprire una collection (la tabella, le viste dei record, il modulo)
viene caricato solo in quel momento. Uno schema di grandi dimensioni rallenta `rebase db push`
più del pannello: con 400 o più tabelle un push richiede decine di secondi; vedi
[quanto dura un push](/docs/cli/schema#rebase-db-push).

## Passaggi successivi

<span class="since-badge" data-since="0.31">Da 0.31</span>

- [customizeTable](/docs/frontend/customize-table/): personalizza qualsiasi aspetto sopra descritto, per singola tabella
- [Campi](/docs/collections/properties/): widget e opzioni per ogni tipo di colonna
- [Modalità di visualizzazione](/docs/frontend/view-modes/): tabella, schede, kanban, display slot e filtri
- [Relazioni nel pannello](/docs/collections/relations-in-the-admin-panel/): schede, selettori e pivot
- [Firestore insieme a Postgres](/docs/frontend/firebase/): collection da un'altra sorgente dati
