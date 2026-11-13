---
sourceHash: 7f137cdb15196a3e
title: Strumenti di Studio
sidebar_label: Studio
description: Rebase Studio fornisce strumenti per sviluppatori per la modifica visuale dello schema, query SQL, scripting JavaScript, gestione delle policy RLS e navigazione dello storage.
---

## Panoramica

Studio è la metà per sviluppatori del pannello di amministrazione. La stessa applicazione che il tuo team dei contenuti usa per modificare le righe include anche un editor di schemi, una console SQL, uno scratchpad JavaScript, un browser di policy RLS e un browser di storage — e Studio è la modalità che li sblocca. Niente da installare e niente da distribuire: è già presente nel pannello, dietro l'interruttore nel drawer.

![L'editor di collezioni, lo strumento di punta di Studio: un editor visuale di schemi che riscrive il tuo TypeScript](/img/collection_editor.png)

Esiste perché l'alternativa consiste in un secondo set di credenziali. Modificare una tabella, verificare cosa permette realmente una policy o eseguire una query in produzione significa altrimenti dover usare un client per database, una copia della stringa di connessione e una traccia di audit che si conclude con "qualcuno tramite psql". Studio fa tutto questo come amministratore autenticato, attraverso la stessa autorizzazione utilizzata dall'API.

## Le due modalità

Il pannello ha due modalità — `"cms" | "studio"`:

- **CMS** (`"cms"`) — Per editor di contenuti e team operativi. Mostra le tabelle e la gestione dei dati. Questa è la modalità predefinita.
- **Studio** (`"studio"`) — Per sviluppatori. Sblocca gli strumenti indicati di seguito.

Passa da una all'altra con il controller della modalità admin o tramite l'interruttore nel drawer. La modalità selezionata viene salvata in `localStorage` sotto la chiave `rebase-admin-mode`; un browser che ha utilizzato il pannello prima della versione 0.17.0 conterrà il vecchio valore `"content"` e verrà migrato a `"cms"` in fase di lettura.

## Strumenti integrati di Studio

### Collection Editor

<span class="since-badge" data-since="0.31">Dalla 0.31</span>

Un editor visuale per una tabella e per il modo in cui il pannello la mostra. Un salvataggio è diviso in due:

- **Dati dello schema** — il tipo di una colonna, la nullabilità, il valore predefinito, la validazione, i valori enum, lo storage, le relazioni, le regole, la descrizione, la cronologia — diventano modifiche `TablePatch` che l'editor di schemi del server scrive in `backend/schema/<table>.ts` con [ts-morph](https://ts-morph.com/), modificando solo il codice specificato dalla modifica e lasciando il resto del file intatto: importazioni, commenti, formattazione, hook, colonne condivise. Una modifica che va a intaccare il codice — una colonna creata tramite un helper, regole memorizzate in una variabile — viene rifiutata indicando il punto in cui effettuarla. Una regola lasciata invariata viene reinviata esattamente come servita, garantendo che il nome della sua policy non cambi mai. Consulta [Modifica dello schema in tempo reale](/docs/backend/live-schema-editing/#the-edits-tablepatch).
- **Presentazione** — etichette, icona, modalità di visualizzazione, ordine delle colonne, colonne nascoste, larghezze, etichette e colori degli enum, kanban, valori predefiniti delle query — è una preferenza dell'interfaccia utente, mai una modifica dello schema. Quelle di un amministratore sono quelle dell'area di lavoro: laddove il server può scrivere il codice sorgente del progetto, queste vengono salvate in `frontend/src/cms/ui-config.json`, mentre in un deployment finiscono nella tabella `rebase.ui_preferences`, tramite `/api/admin/ui-config`. I ridimensionamenti e i cambi di vista effettuati da un singolo utente rimangono personali.

La modifica di uno slug, di una tabella SQL o di un database viene rifiutata in quanto considerata una migrazione. Una tabella le cui regole derivano da `defaultRls` richiede conferma prima di adottare regole proprie. Un chiamante a cui vengono fornite regole oscurate riceve un editor di sola lettura. Un salvataggio che il server non riesce a compilare elenca ciascun problema accanto al campo a cui si riferisce e nulla viene scritto. Un file modificato su disco dopo che l'editor lo ha letto propone una ricarica invece di sovrascrivere la modifica (`SCHEMA_EDIT_STALE_FILE`). Un campo la cui definizione è generata da codice — un helper, una variabile condivisa — viene mostrato in sola lettura, con la relativa motivazione. L'ordine delle colonne riguarda esclusivamente la presentazione: il riordinamento non sposta mai una colonna all'interno della tabella. Corrisponde allo screenshot all'inizio di questa pagina.

**Importare una tabella esistente.** Una tabella presente nel database ma non dichiarata in `backend/schema` compare nell'elenco sotto "Import an existing table"; selezionandone una viene scritto il suo file `defineTable` esattamente come la descrive il database — colonne, chiavi, indici, sicurezza a livello di riga — tramite la modifica `adoptTable`. L'adozione non altera nulla nel database: non pianifica alcun DDL e il primo passaggio relativo alle policy ricrea una volta sola una policy identica per certificarla. Il livello di sicurezza row-level security non viene mai abbassato: una tabella con RLS disabilitata o priva di policy viene adottata con `rls: "admin-only"`, come indicato nella finestra di dialogo. Una tabella priva di chiave primaria non può essere adottata. Le route sono `GET /api/admin/schema-editor/unmapped-tables` e `GET /api/admin/schema-editor/unmapped-tables/:schema/:table`.

**Collezioni Firestore.** In fase di sviluppo, l'editor di collezioni modifica anche le collezioni Firestore: un salvataggio riscrive sul posto la chiamata `defineFirestoreCollection({...})` della collezione in `frontend/src/cms`, modificando solo ciò che è stato editato. Funzioni, componenti personalizzati, commenti e importazioni rimangono invariati; i campi definiti tramite codice vengono mostrati in sola lettura. In produzione, le collezioni Firestore sono in sola lettura nell'editor. La creazione di una collezione o la modifica del suo slug si effettua da codice; per eliminarne una, rimuovi il relativo file e la voce corrispondente in `externalCollections`.

L'editor è attivo ovunque sia montato Studio — il componente `<RebaseStudio/>` di uno scaffold è sufficiente e non serve aggiungere alcuna prop. `collectionEditor` serve a configurarlo nel dettaglio anziché ad abilitarlo:

```tsx
import { RebaseCMS } from "@rebasepro/cms";
import { RebaseStudio } from "@rebasepro/studio";

// Studio is mounted, so the Collection Editor is available. Nothing else
// is needed for it.
<Rebase>
    <RebaseCMS tableCustomizations={tableCustomizations}/>
    <RebaseStudio/>
</Rebase>

// `collectionEditor` is for fine-tuning — a read-only editor, a different
// token — not for opting in.
<RebaseCMS
    tableCustomizations={tableCustomizations}
    collectionEditor={{
        getAuthToken: authController.getAuthToken
    }}
/>
```

Che un *salvataggio* vada a buon fine è una decisione del server, non del pannello: l'editor riscrive `backend/schema`, quindi è disabilitato con `NODE_ENV=production` (a meno che [la modifica dello schema in tempo reale](/docs/backend/live-schema-editing/) non specifichi un repository), in modalità `baas` e su un server privo di `schemaDir`. Il pannello interroga `GET /api/admin/schema-editor/status` e mostra il motivo ricevuto accanto al pulsante disabilitato.

### Strumenti integrati

<span class="since-badge" data-since="0.31">Dalla 0.31</span>

Ogni strumento che riconosce lo schema legge le tabelle fornite dal server da `GET /api/schema/tables`, con o senza il CMS nella pagina — così Studio può funzionare come console per un backend privo di pannello di amministrazione. Con un runtime precedente alla versione 0.31, che non dispone di questa route, gli strumenti sensibili allo schema indicano che è necessario aggiornare il runtime anziché tirare a indovinare; con un backend privo di autenticazione o in caso di errore della richiesta, ciascuno di essi ne segnala la causa. La console SQL, i log, lo storage e gli altri strumenti che non leggono lo schema funzionano comunque.

Questi strumenti sono inclusi in Studio e vengono **caricati in lazy loading da `RebaseStudio`** — ognuno è un chunk separato, scaricato la prima volta che viene aperto. Non possono essere importati singolarmente: `@rebasepro/studio` esporta intenzionalmente solo l'orchestratore, in modo tale che una console mai aperta non abbia alcun costo in termini di prestazioni o dimensioni del bundle.

| Scheda | Slug | Gruppo | Cosa fa |
|-----|------|-------|--------------|
| SQL Console | `sql` | Database | Esegui query SQL grezze sul tuo database PostgreSQL e visualizza i risultati in una tabella. La tabella mostra il risultato dell'ultima istruzione, fino alle sue prime 10.000 righe o 32 MB di valori; un risultato più lungo indica il numero totale di righe presenti, mentre la copia e l'esportazione includono solo le righe mostrate. Tale risultato offre anche l'opzione **Download full result as CSV**: il server ne invia lo streaming completo tramite un cursore di sola lettura (`POST /api/admin/sql/csv`), una query alla volta, su un server Postgres proprietario anziché sul database di sviluppo in-process. I valori corrispondono al testo del database, come mostrato da psql, e **Export JSON** li scrive in questo formato; **Export typed JSON** scrive ciascun valore letto in base al tipo della sua colonna — interi e numerici che un numero JSON può contenere esattamente, booleani, `json`/`jsonb` come JSON — e mantiene tutti gli altri valori come testo. In ogni CSV (esportazione, copia e download completo), un valore che un foglio di calcolo interpreterebbe come formula (uno che inizia con `=`, `+`, `-`, `@`, un carattere di tabulazione o un ritorno a capo, diverso da un numero con segno) viene scritto con un `'` iniziale, come avviene per l'esportazione delle collezioni. Durante l'esecuzione, **Cancel run** restituisce immediatamente il controllo alla console; un server che accetta il frame `CANCEL_SQL` del socket (indicando `cancel_sql` nel messaggio `hello` con cui risponde al socket) arresta anche l'istruzione con `pg_cancel_backend`. Il database di sviluppo in-process non può essere interrotto, mentre su un server più datato si attende che l'istruzione termini entro il suo `statement_timeout` |
| RLS Policies | `rls` | Database | Ispeziona e gestisci le policy di Row Level Security per le tue tabelle. La parte dichiarata è quanto compilato dal server dall'`rls` di ciascuna tabella (fornito ai chiamanti che dispongono del permesso `schema:read`), confrontato con `pg_policies` secondo le modalità con cui `rebase doctor` rileva il disallineamento: una policy viene elencata per come è registrata nel database, contrassegnata con il badge **Differs from code** laddove non corrisponda a quanto dichiarato nel progetto, mentre una regola dichiarata ma assente nel database viene elencata come non applicata. Una policy generata da Rebase non può essere modificata direttamente nel database, e su una tabella gestita da Rebase un banner segnala che ogni riavvio del server e ogni comando `rebase db push` riapplicano le policy dichiarate. Un chiamante privo di `schema:read` visualizza ciò che è presente nel database e riceve una spiegazione del perché la dichiarazione non è visibile |
| Schema Visualizer | `schema-visualizer` | Database | Diagramma entità-relazione delle tue tabelle e delle loro relazioni, ricavato dai descrittori forniti: nomi SQL, tipi Postgres, nullabilità, chiavi, valori enum, chiavi esterne e giunzioni corrispondono a quanto dichiarato dalle tabelle. Solo i marcatori RLS vengono letti dal database. Il layout viene elaborato in un web worker, in modo che la pagina rimanga reattiva durante la disposizione di diagrammi complessi. Uno schema con più di 300 tabelle viene tracciato analizzando la vicinanza di una singola tabella alla volta — le tabelle distanti una o due relazioni — a partire da quella con più connessioni; selezionane un'altra nell'elenco per spostarti |
| Branches | `branches` | Database | Crea e gestisci i [branch del database](/docs/backend/branching), ed esaminali come faresti con una pull request: le modifiche allo schema e alle policy RLS affiancate, le righe inserite, aggiornate ed eliminate, e un merge nel database di origine che mostra la priorità di risoluzione dei conflitti — consulta [Revisione e unione di un branch](/docs/backend/branching/#reviewing-and-merging-a-branch) |
| Backups | `backups` | Database | Esplora e scarica i backup del database |
| Logs Explorer | `logs` | Database | Log delle richieste in tempo reale, oltre a tutto ciò che il server segnala con livello warn o error — vedi sotto |
| JS Console | `js` | Compute | Scrivi ed esegui JavaScript tramite l'SDK di Rebase. Uno script riceve `context.tables`, i descrittori forniti (in precedenza `context.collections`), e accede a una tabella come `client.data.<slug>` o `client.data.table("<slug>")` |
| Cron Jobs | `cron` | Compute | Ispeziona e gestisci le [attività pianificate](/docs/backend/cron-jobs) |
| Storage | `storage` | Storage | Esplora, carica e gestisci file su tutti i tuoi backend di storage |
| API Explorer | `api` | API | Documentazione interattiva dell'API, completa di esecutore di richieste |
| API Keys | `api-keys` | Access Control | Crea e gestisci chiavi API di servizio con ambiti (scope); i target di uno scope `data:*` sono le tabelle fornite |

### Cosa mostra Logs Explorer

Due flussi in un unico buffer circolare in memoria, gestito dal processo del server:

- **Ogni richiesta** — metodo, percorso, stato, durata, l'`X-Request-ID`, la tabella qualora la richiesta ne riguardasse una e, in caso di esito negativo, il codice di errore (`code`) e il messaggio ricevuti dal client. Una richiesta non riuscita viene registrata con livello `warn` (4xx) o `error` (5xx), consentendo al filtro per livello di individuarla. La sua origine (`source`) deriva dal percorso: `/api/auth/*` e `/api/oauth/*` sono `auth`, `/api/storage/*` è `storage`, mentre tutto il resto è `api`, consentendo al filtro Source di trovare gli accessi sotto Auth e i caricamenti sotto Storage.
- **Tutto ciò che il server segnala come warn o error** — un avviso relativo allo schema, un rifiuto di autenticazione, una diagnosi del driver, un errore di avvio. Il campo `source` deriva dal prefisso del messaggio stesso (`[API]`, `[Auth]`, `[storage]`, `[realtime]`), mentre qualsiasi elemento non riconosciuto è `system`.

Il consueto traffico di messaggi `info` viene deliberatamente omesso. Il buffer circolare conserva 10.000 voci e un'ondata di risposte `200` finirebbe per espellere i dettagli che si desidera effettivamente analizzare nel pannello.

Una funzione personalizzata che genera un'eccezione mostrerà quindi il proprio messaggio qui, in corrispondenza della richiesta che l'ha invocata — esattamente il caso d'uso per cui questo strumento è stato progettato.

Il buffer circolare è vincolato al singolo processo e al singolo avvio: non è persistente, non è condiviso tra le repliche e un riavvio lo svuota. Per qualsiasi dato sia necessario conservare, consulta lo stdout del processo, che include le stesse righe e ulteriori informazioni.

L'explorer lo segnala esplicitamente. Mostra il log della specifica istanza del server che lo sta servendo e ne riporta il nome: l'evento `snapshot` di `GET /api/admin/logs/stream` contiene `instance`, l'`HOSTNAME` del processo (il nome del pod su Kubernetes, l'ID del container in Docker) o altrimenti `pid-<n>`. Non è disponibile una visualizzazione aggregata tra le repliche, né per i processi `functions` e `worker` di un [deployment suddiviso](/docs/deployment/split-processes/). Una riconnessione che indirizza a un'altra istanza sostituisce il contenuto della finestra anziché mescolare i due log.

Anche il **Collection Editor** è uno strumento di Studio, ma non figura in questo elenco in quanto viene registrato in modo diverso: `RebaseStudio` non lo carica tramite lazy loading. Il pannello lo monta ovunque siano registrati Studio e il CMS, poiché, a differenza degli strumenti sopra indicati, modifica sia lo schema che la presentazione renderizzata dal CMS. Si tratta di una differenza nelle modalità di montaggio e non nella sua natura: modifica lo schema e appartiene alla stessa categoria degli editor SQL e RLS.

## Abilitare Studio

Un solo componente, ovunque all'interno di `<Rebase>`. Non esegue il rendering di alcun elemento visibile — registra gli strumenti e `<RebaseShell>` li disegna:

```tsx
import { RebaseStudio } from "@rebasepro/studio";

export function App() {
    return (
        <Rebase client={client} authController={authController}>
            <RebaseCMS tableCustomizations={tableCustomizations}/>
            <RebaseStudio/>
            <RebaseShell title="My App"/>
        </Rebase>
    );
}
```

Gli strumenti compaiono nel drawer mentre la modalità Studio è attiva. Omettendo del tutto `<RebaseStudio>`, verrà distribuito un CMS per soli contenuti: nessuna modalità Studio, nessun interruttore, nessun elemento caricato in lazy loading.

## Aggiungere uno strumento personalizzato

`devViews` consente di affiancare le proprie viste a quelle integrate. Si tratta di normali [`AppView`](/docs/frontend#custom-views) — l'unica caratteristica che rende una vista uno strumento di Studio anziché una vista del CMS è il componente su cui viene registrata:

```tsx
import type { AppView } from "@rebasepro/cms-types";

const queues: AppView = {
    slug: "queues",
    name: "Queues",
    group: "Compute",
    icon: "ListOrdered",
    description: "Depth and failures, per queue",
    view: <QueuesView/>
};

<RebaseStudio devViews={[queues]}/>
```

| Registrato su | Compare in | Scopo |
|---|---|---|
| `<RebaseCMS views>` | modalità contenuti | elementi utilizzati da chi modifica i contenuti |
| `<RebaseStudio devViews>` | modalità Studio | strumenti utilizzati per gestire il backend |

Una vista deve appartenere a uno solo di essi — il drawer la ordina in base a quale componente l'ha registrata, pertanto inserire lo stesso slug in entrambi la nasconde dalla modalità contenuti.

Come per `tools`, l'elenco viene letto in base al suo *contenuto*: definirlo inline è sicuro e un nuovo rendering dell'host non rimonta lo strumento attualmente visualizzato sullo schermo. Rinominare una vista o modificarne il gruppo ne comporta invece la nuova registrazione.

### Scegliere quali strumenti mostrare

Omettendo `tools`, vengono registrati tutti gli strumenti sopra elencati. Specificando questa proprietà è possibile registrarne un sottoinsieme — ad esempio, una console ospitata dotata di un proprio browser di storage può escludere quello integrato:

```tsx
<RebaseStudio tools={["sql", "rls", "schema-visualizer", "api"]} />
```

La vista di Studio del Collection Editor corrisponde allo strumento `"schema"`. Se si omette `tools`, sarà inclusa; se si passa un elenco privo di `"schema"`, come nell'esempio sopra, verrà esclusa.

L'elenco viene letto in base al *contenuto* e non all'identità, quindi definirlo inline è sicuro: un nuovo rendering dell'host non smonta né rimonta lo strumento attualmente visualizzato.

## Prossimi passi

- **[Plugin](/docs/plugins)** — Estendi il framework con i plugin
- **[Tabelle](/docs/schema/)** — Dichiarare le tabelle lette da Studio
- **[Personalizzare una tabella](/docs/frontend/customize-table/)** — Come il pannello le mostra
