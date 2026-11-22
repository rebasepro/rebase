---
sourceHash: 042c679d9fdfa2aa
title: Strumenti di Studio
sidebar_label: Studio
description: Rebase Studio fornisce strumenti per sviluppatori per query SQL, scripting JavaScript, gestione delle policy RLS, diagramma dello schema ed esplorazione dello storage.
---

## Panoramica

Studio è la metà per sviluppatori del pannello di amministrazione. La stessa applicazione che il tuo team dei contenuti utilizza per modificare le righe include anche una console SQL, uno scratchpad JavaScript, un editor di policy RLS, un diagramma dello schema e un browser di storage — e Studio è la modalità che li sblocca. Niente da installare e niente da distribuire: è già presente nel pannello, dietro il toggle nel drawer.

Esiste perché l'alternativa sarebbe un secondo set di credenziali. Modificare una tabella, verificare cosa consente realmente una policy o eseguire una query in produzione richiede altrimenti un client per il database, una copia della stringa di connessione e un audit trail che termina con "qualcuno con psql". Studio fa tutto questo come amministratore autenticato, tramite la stessa autorizzazione utilizzata dall'API.

## Le due modalità

Il pannello ha due modalità — `"cms" | "studio"`:

- **CMS** (`"cms"`) — Per editor di contenuti e team operativi. Mostra le tabelle e la gestione dei dati. Questa è l'impostazione predefinita.
- **Studio** (`"studio"`) — Per sviluppatori. Sblocca gli strumenti indicati di seguito.

Passa dall'una all'altra con il controller della modalità admin o il toggle nel drawer. La modalità scelta viene mantenuta in `localStorage` sotto la chiave `rebase-admin-mode`; un browser che ha utilizzato il pannello prima della versione 0.17.0 conserva il vecchio valore `"content"` e viene migrato a `"cms"` durante la lettura.

## Strumenti integrati di Studio

Lo schema di una tabella è codice: `defineTable` in `backend/schema`, o — per un progetto che non ne dichiara alcuno — qualunque cosa contenga il database, modificata tramite SQL o una migrazione. Studio non ha un editor visuale di tabelle; lo strumento Collections che svolgeva questo ruolo è stato rimosso, poiché le colonne di una tabella e la sua presentazione nel pannello sono state disaccoppiate e un unico modulo per modificarle entrambe non era più adatto a nessuna delle due. L'editor RLS salva comunque le policy in `backend/schema` in fase di sviluppo, attraverso la stessa sequenza pianifica → conferma → applica del [live schema editing](/docs/backend/live-schema-editing/).

### Strumenti integrati

Ogni strumento che riconosce lo schema legge le tabelle fornite dal server da `GET /api/schema/tables`, con o senza il CMS nella pagina — pertanto Studio funziona come console per un backend privo di pannello di amministrazione. Con un runtime precedente alla versione 0.31, che non dispone di questa route, gli strumenti sensibili allo schema indicano che il runtime deve essere aggiornato anziché fare supposizioni; con un backend senza autenticazione, o quando la richiesta fallisce, ciascuno ne segnala il motivo. La console SQL, i log, lo storage e gli altri strumenti che non leggono lo schema funzionano comunque.

Questi sono inclusi in Studio e vengono **caricati in lazy loading da `RebaseStudio`** — ciascuno è un chunk separato, recuperato la prima volta che lo apri. Non sono importabili singolarmente: `@rebasepro/studio` esporta deliberatamente solo l'orchestratore, in modo che una console mai aperta non abbia alcun costo in termini di risorse.

| Scheda | Slug | Gruppo | Cosa fa |
|-----|------|-------|--------------|
| Tables | `tables` | Database | Crea e modifica tabelle PostgreSQL, colonne, indici e metadati di tabella (`rebase.table_meta`), modifica le righe direttamente ed esponi le tabelle tramite REST, Realtime, OpenAPI ed MCP senza scrivere codice |
| SQL Console | `sql` | Database | Esegui query SQL raw sul tuo database PostgreSQL e visualizza i risultati in una tabella. La tabella mostra il risultato dell'ultima istruzione, fino alle prime 10.000 righe o 32 MB di valori; un risultato più lungo indica quante righe erano presenti, e la copia e l'esportazione includono solo le righe mostrate. Tale risultato offre anche l'opzione **Download full result as CSV**: il server ne trasmette l'intero contenuto in streaming tramite un cursore di sola lettura (`POST /api/admin/sql/csv`), una query alla volta, su un server Postgres proprietario anziché sul database di sviluppo in-process. I valori corrispondono al testo restituito dal database, così come mostrato da psql, e **Export JSON** li scrive in questo modo; **Export typed JSON** scrive ciascun valore letto in base al tipo della sua colonna — interi e numerici che un numero JSON può rappresentare esattamente, booleani, `json`/`jsonb` come JSON — e mantiene tutti gli altri valori come testo. In ogni CSV (esportazione, copia e download completo), un valore che un foglio di calcolo interpreterebbe come formula (uno che inizia con `=`, `+`, `-`, `@`, un carattere di tabulazione o un ritorno a capo, diverso da un numero con segno) viene scritto con un `'` iniziale, come avviene per l'esportazione delle collection. Mentre un'esecuzione è in corso, **Cancel run** sblocca immediatamente la console; un server che accetta il frame `CANCEL_SQL` del socket (elenca `cancel_sql` nell'`hello` con cui risponde al socket) interrompe anche l'istruzione con `pg_cancel_backend`. Il database di sviluppo in-process non può essere interrotto, e un server precedente viene lasciato completare l'istruzione entro il suo `statement_timeout` |
| RLS Policies | `rls` | Database | Ispeziona e gestisci le policy di Row Level Security per le tue tabelle. La parte dichiarata è ciò che il server ha compilato dall'`rls` di ciascuna tabella (fornito ai chiamanti in possesso di `schema:read`), confrontato con `pg_policies` nello stesso modo in cui `rebase doctor` valuta il drift: una policy viene elencata così come è memorizzata nel database, contrassegnata con il badge **Differs from code** dove non corrisponde a ciò che il progetto dichiara, e una regola dichiarata assente nel database viene elencata come non applicata. Una policy generata da Rebase non può essere modificata direttamente nel database, e su una tabella gestita da Rebase un banner avvisa che ogni avvio del server e ogni `rebase db push` riapplicano le policy dichiarate. Un chiamante senza `schema:read` visualizza ciò che contiene il database e viene informato del motivo per cui la dichiarazione non viene mostrata |
| Schema Visualizer | `schema-visualizer` | Database | Diagramma entità delle tabelle e delle relative relazioni, generato a partire dai descrittori forniti: nomi SQL, tipi Postgres, supporto per valori nulli, chiavi, valori enum, chiavi esterne e giunzioni sono conformi a quanto dichiarato dalle tabelle. Solo i marcatori RLS vengono letti dal database. Il calcolo del layout viene eseguito in un web worker, garantendo la reattività della pagina durante la disposizione di diagrammi complessi. Uno schema con oltre 300 tabelle viene tracciato analizzando una porzione per volta — le tabelle distanti una o due relazioni — a partire dalla tabella con il maggior numero di connessioni; seleziona un'altra tabella nell'elenco per spostarti |
| Branches | `branches` | Database | Crea e gestisci i [branch del database](/docs/backend/branching) e revisionane uno come una pull request: le modifiche allo schema e alle policy RLS affiancate, le righe inserite, aggiornate ed eliminate, e un merge nel database di origine che stabilisce cosa ha la precedenza — consulta [Revisione e unione di un branch](/docs/backend/branching/#reviewing-and-merging-a-branch) |
| Backups | `backups` | Database | Esplora e scarica i backup del database |
| Logs Explorer | `logs` | Database | Log in tempo reale delle richieste, oltre a tutto ciò che il server segnala con livello warn o error — vedi sotto |
| JS Console | `js` | Compute | Scrivi ed esegui JavaScript tramite l'SDK di Rebase. Uno script riceve `context.tables`, i descrittori forniti (in precedenza `context.collections`), e accede a una tabella come `client.data.<slug>` o `client.data.table("<slug>")` |
| Cron Jobs | `cron` | Compute | Ispeziona e gestisci le [attività pianificate](/docs/backend/cron-jobs), inclusi i cron job SQL e HTTP senza codice |
| Storage | `storage` | Storage | Sfoglia, carica e gestisci file tra i vari backend di storage e configura policy di accesso dichiarative per l'archiviazione |
| API Explorer | `api` | API | Documentazione interattiva dell'API, con un request runner |
| Webhooks | `webhooks` | API | Configura e testa webhook di database attivati su inserimenti, aggiornamenti ed eliminazioni di righe |
| Users & Roles | `users` | Access Control | Gestisci account utente, assegnazioni di ruoli e ambiti di ruolo RBAC senza codice |
| API Keys | `api-keys` | Access Control | Crea e gestisci chiavi API di servizio con ambiti (scope); le destinazioni di uno scope `data:*` sono le tabelle fornite |

### Cosa mostra il Logs Explorer

Due flussi in un unico ring buffer in memoria, mantenuto nel processo server:

- **Ogni richiesta** — metodo, percorso, stato, durata, l'`X-Request-ID`, la
  tabella qualora la richiesta ne riguardasse una e, in caso di fallimento della
  richiesta, il `code` di errore e il messaggio ricevuti dal client. Una richiesta non
  riuscita viene registrata a livello `warn` (4xx) o `error` (5xx), in modo che il filtro
  per livello possa individuarla. Il relativo `source` deriva dal path: `/api/auth/*` e
  `/api/oauth/*` sono `auth`, `/api/storage/*` è `storage`, e tutto il resto è `api`,
  così che il filtro Source individui gli accessi sotto Auth e i caricamenti sotto Storage.
- **Tutto ciò che il server segnala come warn o error** — un avviso di schema, un
  rifiuto di autenticazione, una diagnosi del driver, un errore di avvio. `source` deriva
  dal prefisso del messaggio stesso (`[API]`, `[Auth]`, `[storage]`, `[realtime]`), e
  qualsiasi cosa non riconosciuta è `system`.

Il traffico di routine di livello `info` viene deliberatamente tralasciato. Il ring buffer contiene 10.000 voci
e una sequenza continua di `200` rischierebbe di cancellare ciò che hai aperto il pannello per cercare.

Una funzione personalizzata che genera un errore (throw) mostra quindi qui il proprio messaggio, associato alla
richiesta che l'ha chiamata — esattamente lo scenario per cui questo strumento esiste.

Il ring è per processo e per avvio: non è persistente, non è condiviso tra repliche e un riavvio lo svuota.
Per qualsiasi cosa tu debba conservare, consulta lo stdout del processo, che riporta le stesse righe e altre ancora.

L'explorer lo segnala chiaramente. Mostra il log della singola istanza del server che lo sta servendo e riporta
il nome di tale istanza: l'evento `snapshot` di `GET /api/admin/logs/stream` include `instance`, l'`HOSTNAME`
del processo (il nome del pod su Kubernetes, l'ID del container in Docker) oppure `pid-<n>`. Non è disponibile
una visualizzazione trasversale tra repliche, né dei processi `functions` e `worker` di un
[deployment separato](/docs/deployment/split-processes/). Una riconnessione che atterra su un'altra istanza
sostituisce la finestra invece di unire i due log.

## Attivazione di Studio

Un solo componente, ovunque all'interno di `<Rebase>`. Non effettua il rendering di nulla a livello visivo — registra gli strumenti, e `<RebaseShell>` li disegna:

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

Gli strumenti compaiono nel drawer quando la modalità Studio è attiva. Ometti del tutto `<RebaseStudio>`
e distribuirai un CMS per soli contenuti: nessuna modalità Studio, nessun toggle, nessun componente caricato in lazy loading.

## Aggiungere il proprio strumento

`devViews` posiziona le tue viste personalizzate accanto a quelle integrate. Si tratta di normali
[`AppView`](/docs/frontend#custom-views) — l'unica cosa che rende una vista uno strumento di Studio anziché una vista del CMS è il componente su cui viene registrata:

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

| Registrato su | Compare in | Destinato a |
|---|---|---|
| `<RebaseCMS views>` | modalità contenuti | elementi utilizzati da chi modifica i contenuti |
| `<RebaseStudio devViews>` | modalità Studio | elementi utilizzati per gestire il backend |

Una vista appartiene esattamente a uno di essi — il drawer le ordina in base a quale componente l'ha registrata,
quindi inserire uno slug in entrambi lo nasconde dalla modalità contenuti.

Come per `tools`, l'elenco viene letto in base al suo *contenuto*: definirlo inline è sicuro e un re-render
dell'host non rimonta lo strumento attualmente visualizzato sullo schermo. Rinominare una vista o modificarne
il gruppo ne comporta la nuova registrazione.

### Scegliere quali strumenti mostrare

Ometti `tools` e tutti gli strumenti sopra elencati verranno registrati. Passalo per registrare un sottoinsieme —
ad esempio, una console ospitata dotata di un proprio browser di storage può escludere quest'ultimo:

```tsx
<RebaseStudio tools={["sql", "rls", "schema-visualizer", "api"]} />
```

`"schema"`, lo strumento Collections, non è più accettato: lo strumento è stato rimosso.

L'elenco viene letto in base al *contenuto*, non all'identità, quindi definirlo inline è sicuro: un re-render dell'host non smonta e rimonta lo strumento visualizzato sullo schermo.

## Passaggi successivi

- **[Plugin](/docs/plugins)** — Estendi il framework con i plugin
- **[Tabelle](/docs/schema/)** — Dichiarare le tabelle lette da Studio
- **[Personalizzare una tabella](/docs/frontend/customize-table/)** — Come vengono mostrate dal pannello
