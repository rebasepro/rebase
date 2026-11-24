---
sourceHash: 0d5aca4c8590b2d6
title: Strumenti Studio
sidebar_label: Studio
description: Rebase Studio fornisce strumenti per sviluppatori per query SQL, scripting JavaScript, gestione delle policy RLS, un diagramma dello schema e l'esplorazione dello storage.
---

## Panoramica

Studio è la metà per sviluppatori del pannello di amministrazione. La stessa
applicazione che il tuo team dei contenuti usa per modificare le righe include
anche una console SQL, uno scratchpad JavaScript, un editor di policy RLS, un
diagramma dello schema e un browser di storage — e Studio è la modalità che li
sblocca. Niente da installare e niente da distribuire: è già presente nel
pannello, dietro lo switch nel drawer.

Esiste perché l'alternativa sarebbe un secondo set di credenziali. Modificare
una tabella, verificare cosa consente realmente una policy o eseguire una
singola query in produzione altrimenti richiederebbe un client di database, una
copia della stringa di connessione e un audit trail che termina con "qualcuno con
psql". Studio fa tutto questo come amministratore autenticato, attraverso la
stessa autorizzazione utilizzata dall'API.

## Le due modalità

Il pannello ha due modalità — `"cms" | "studio"`:

- **CMS** (`"cms"`) — Per editor di contenuti e team operativi. Mostra le tabelle e la gestione dei dati. Questa è la modalità predefinita.
- **Studio** (`"studio"`) — Per gli sviluppatori. Sblocca gli strumenti indicati di seguito.

Passa dall'una all'altra con il controller della modalità di amministrazione o
con il toggle nel drawer. La modalità scelta viene mantenuta in `localStorage`
sotto la chiave `rebase-admin-mode`; un browser che ha utilizzato il pannello
prima della versione 0.17.0 conterrà il vecchio valore `"content"` e verrà
migrato a `"cms"` durante la lettura.

## Strumenti Studio integrati

Lo schema di una tabella è codice: `defineTable` in `backend/schema`, oppure —
per un progetto che non ne dichiara alcuno — qualsiasi cosa contenga il
database, modificata tramite SQL o una migrazione. Studio non dispone di un
editor visuale di tabelle; lo strumento Collections che svolgeva questa funzione
è stato rimosso, poiché le colonne di una tabella e la sua presentazione nel
pannello sono state disaccoppiate e un singolo form che modificava entrambi non
corrispondeva più a nessuno dei due. L'editor RLS salva comunque le policy in
`backend/schema` in fase di sviluppo, attraverso lo stesso passaggio
plan → confirm → apply del
[live schema editing](/docs/backend/live-schema-editing/).

### Strumenti integrati

Ogni strumento che riconosce lo schema legge le tabelle fornite dal server da
`GET /api/schema/tables`, con o senza il CMS nella pagina — così Studio funziona
come la console di un backend privo di pannello di amministrazione. Con un
runtime precedente alla 0.31, che non dispone di questa route, gli strumenti che
rilevano lo schema segnalano la necessità di aggiornare il runtime anziché tirare
a indovinare; a fronte di un backend senza autenticazione o in caso di errore
della richiesta, ciascuno ne indica la causa. La console SQL, i log, lo storage e
gli altri strumenti che non leggono lo schema funzionano comunque.

Questi strumenti sono inclusi in Studio e vengono **caricati in lazy loading da `RebaseStudio`** — ciascuno
è un chunk separato, scaricato la prima volta che viene aperto. Non sono importabili
singolarmente: `@rebasepro/studio` esporta volutamente solo l'orchestratore, in
modo che una console mai aperta non abbia alcun impatto in termini di risorse.

| Tab | Slug | Gruppo | Cosa fa |
|-----|------|--------|---------|
| Tabelle | `tables` | Database | Ogni tabella e vista dello schema. Per quella selezionata: **Dati** ne legge le righe come proprietario del database tramite `/api/admin/db` (incluse tabelle non servite e viste) con paginazione, ordinamento e filtri lato server, celle di foreign key che aprono la riga a cui puntano, un visualizzatore di valori, modifiche in linea e multiple, importazione ed esportazione CSV, e **Leggi come** un utente dell'API mostra le righe che la sua row level security restituisce; **Struttura** modifica colonne (nome, tipo, null, default), indici (con dimensione e scansioni), vincoli (foreign key, univoco, controllo) e trigger; **Policy** è l'editor dello strumento Policy per quella tabella, con i suoi privilegi; **Relazioni** elenca le foreign key nei due sensi e disegna il vicinato della tabella; **Statistiche** mostra dimensioni, stima delle righe, scansioni, righe morte e ultimi vacuum e analyze, con **Analizza** e **Vacuum**; **Impostazioni** contiene i metadati della tabella (`rebase.table_meta`), rinomina ed eliminazione. **Mostra SQL** mostra la definizione della tabella come un unico script. Un selettore sopra l'elenco disegna l'intero schema come **Diagramma**. Ogni modifica allo schema mostra prima l'SQL che eseguirà. La selezione sta nell'URL (`?table=schema.name&tableTab=…`), così le altre viste collegano direttamente una tabella |
| Editor SQL | `sql` | Database | Esegui codice SQL raw sul tuo database PostgreSQL e visualizza i risultati in una tabella. La tabella mostra il risultato dell'ultima istruzione, fino alle prime 10.000 righe o 32 MB di valori; un risultato più lungo indica quante righe erano presenti, e la copia e l'esportazione includono solo le righe mostrate. Tale risultato offre anche l'opzione **Download full result as CSV**: il server ne invia lo streaming completo tramite un cursore di sola lettura (`POST /api/admin/sql/csv`), una query alla volta, su un tuo server Postgres invece che sul database di sviluppo in-process. I valori corrispondono al testo del database, come mostrato da psql, e **Export JSON** li scrive in questo modo; **Export typed JSON** scrive ciascun valore letto in base al tipo della sua colonna — interi e numerici gestiti esattamente da un numero JSON, booleani, `json`/`jsonb` come JSON — e mantiene ogni altro valore come testo. In ogni CSV (esportazione, copia e download completo), un valore che un foglio di calcolo interpreterebbe come formula (uno che inizia con `=`, `+`, `-`, `@`, un carattere di tabulazione o un ritorno a capo, diverso da un numero con segno) viene scritto con un `'` iniziale, proprio come fa l'esportazione delle collection. Mentre un'esecuzione è in corso, **Cancel run** restituisce immediatamente il controllo alla console; un server che accetta il frame `CANCEL_SQL` del socket (che include `cancel_sql` nell'`hello` con cui risponde al socket) interrompe inoltre l'istruzione con `pg_cancel_backend`. Il database di sviluppo in-process non può essere interrotto, e un server precedente viene lasciato a terminare l'istruzione entro il suo `statement_timeout` |
| Criteri | `rls` | Database | Ispeziona e gestisci le policy di Row Level Security per le tue tabelle. La parte dichiarata è ciò che il server ha compilato dall'`rls` di ciascuna tabella (fornito ai chiamanti che possiedono `schema:read`), confrontato con `pg_policies` nel modo in cui `rebase doctor` valuta il drift: una policy viene mostrata per come è memorizzata nel database, contrassegnata con il badge **Differs from code** se non corrisponde a quanto dichiarato nel progetto, mentre una regola dichiarata assente nel database viene elencata come non applicata. Una policy generata da Rebase non può essere modificata direttamente nel database, e su una tabella gestita da Rebase un banner indica che ogni avvio del server e ogni `rebase db push` riapplicano le policy dichiarate. Un chiamante privo di `schema:read` visualizza ciò che contiene il database e riceve una spiegazione del perché la dichiarazione non venga mostrata |
| Schema | `schema-visualizer` | Database | Diagramma entità delle tabelle e delle loro relazioni: i descrittori serviti (nomi SQL, tipi Postgres, chiavi, valori enum, foreign key, junction table) e, su un backend che serve `/api/admin/db`, il catalogo del database — le tabelle che il server non serve, disegnate come non servite, e le foreign key che il codice non dichiara. Dove è registrato lo strumento Tabelle il diagramma è la sua modalità **Diagramma**, e questo strumento resta fuori dalla navigazione mentre il suo percorso continua a funzionare. Il layout viene elaborato in un web worker, così la pagina resta reattiva mentre si dispone un diagramma grande. Uno schema di oltre 300 tabelle viene disegnato un vicinato alla volta — le tabelle a una o due relazioni di distanza — partendo dalla tabella più collegata |
| Rami | `branches` | Database | Crea e gestisci i [branch del database](/docs/backend/branching) ed esaminali come se fossero una pull request: le modifiche allo schema e alle policy RLS affiancate, le righe inserite, aggiornate ed eliminate, e un merge nel database di origine che stabilisce le priorità di risoluzione dei conflitti — consulta [Revisione e merge di un branch](/docs/backend/branching/#reviewing-and-merging-a-branch) |
| Backup | `backups` | Database | Esplora e scarica i backup del database |
| Console JS | `js` | Elaborazione | Scrivi ed esegui JavaScript tramite l'SDK di Rebase. Uno script riceve `context.tables`, i descrittori forniti (in precedenza era `context.collections`), e accede a una tabella tramite `client.data.<slug>` o `client.data.table("<slug>")` |
| Processi pianificati | `cron` | Elaborazione | Ispeziona e gestisci le [attività pianificate](/docs/backend/cron-jobs), inclusi i cron job SQL e HTTP senza codice |
| Archiviazione | `storage` | Archiviazione | Esplora, carica e gestisci file tra i vari backend di storage e configura policy di accesso dichiarative per lo storage |
| API | `api` | API | Documentazione API interattiva, dotata di uno strumento per l'esecuzione delle richieste |
| Webhook | `webhooks` | API | Configura e testa i webhook del database attivati da operazioni di inserimento, aggiornamento ed eliminazione di righe |
| Log | `logs` | API | Log in tempo reale delle richieste, oltre a tutto ciò che il server segnala come warn o error — vedi sotto |
| Utenti e ruoli | `users` | Controllo accessi | Gestisci gli account utente, le assegnazioni dei ruoli e gli ambiti dei ruoli RBAC senza codice |
| Chiavi API | `api-keys` | Controllo accessi | Crea e gestisci chiavi API di servizio con ambiti delimitati; le destinazioni di un ambito `data:*` sono le tabelle fornite |

### Cosa mostra la vista Logs

Due flussi convogliati in un unico ring buffer in memoria, gestito dal processo del server:

- **Ogni richiesta** — metodo, percorso, stato, durata, l'`X-Request-ID`, la
  tabella qualora la richiesta ne riguardasse una e, se la richiesta non è andata a buon
  fine, il `code` di errore e il messaggio ricevuti dal client. Una richiesta fallita viene registrata come
  `warn` (4xx) o `error` (5xx), in modo che il filtro per livello possa individuarla.
  La sua `source` deriva dal percorso: `/api/auth/*` e `/api/oauth/*` sono
  `auth`, `/api/storage/*` è `storage`, e tutto il resto è `api`, per cui il
  filtro Source individua gli accessi sotto Auth e i caricamenti sotto Storage.
- **Tutto ciò che il server segnala come warn o error** — un avviso sullo schema, un
  rifiuto di autenticazione, una diagnosi del driver, un errore di avvio. La proprietà `source` proviene dal
  prefisso stesso del messaggio (`[API]`, `[Auth]`, `[storage]`, `[realtime]`), e
  qualsiasi elemento non riconosciuto è `system`.

I messaggi informativi di routine (`info`) vengono deliberatamente esclusi. Il ring buffer contiene 10.000 voci
e una serie interminabile di risposte `200` finirebbe per espellere i dati che stai cercando nel pannello.

Una funzione personalizzata che genera un'eccezione mostra quindi il proprio messaggio qui, associato alla
richiesta che l'ha chiamata — esattamente il caso d'uso per cui è stata concepita.

Il ring buffer è limitato al singolo processo e al singolo avvio: non è persistente, non è condiviso
tra repliche e un riavvio lo svuota. Per tutto ciò che devi conservare, consulta
lo stdout del processo, che riporta le stesse righe e molto altro.

L'explorer lo specifica chiaramente. Mostra il log della singola istanza del server che
lo sta servendo e riporta il nome di tale istanza: l'evento `snapshot` di
`GET /api/admin/logs/stream` include `instance`, l'`HOSTNAME` del processo (il
nome del pod su Kubernetes, l'id del container con Docker) oppure `pid-<n>`. Non
esiste una vista aggregata tra repliche, né dei processi `functions` e `worker` di un
[deployment separato](/docs/deployment/split-processes/). Una riconnessione che atterra su
un'altra istanza sostituisce il contenuto della finestra anziché mescolare i due log.

## Attivare Studio

Un unico componente, posizionato ovunque all'interno di `<Rebase>`. Non esegue il rendering di alcun elemento visibile — registra
gli strumenti, e `<RebaseShell>` li disegna:

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

Gli strumenti appaiono nel drawer quando la modalità Studio è attiva. Omettendo del tutto
`<RebaseStudio>`, distribuirai un CMS riservato solo ai contenuti: nessuna modalità Studio,
nessuno switch, nessun elemento caricato in lazy loading.

## Aggiungere uno strumento personalizzato

`devViews` posiziona le tue viste personalizzate accanto a quelle integrate. Si tratta di normali
[`AppView`](/docs/frontend#custom-views) — l'unica cosa che differenzia uno
strumento Studio da una vista CMS è il componente su cui viene registrato:

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

| Registrato su | Mostrato in | Destinato a |
|---|---|---|
| `<RebaseCMS views>` | modalità content | elementi utilizzati da chi modifica i contenuti |
| `<RebaseStudio devViews>` | modalità Studio | elementi utilizzati per gestire il backend |

Una vista deve essere assegnata esattamente a uno solo di essi — il drawer le ordina in base a quale componente
l'ha registrata, quindi inserire uno slug in entrambi lo nasconderà dalla modalità content.

Come per `tools`, l'elenco viene letto in base al suo *contenuto*: definirlo inline è sicuro e
un nuovo rendering dell'host non rimonta lo strumento attualmente visualizzato. Ridenominare una
vista o modificarne il gruppo ne comporta la nuova registrazione.

### Scegliere quali strumenti mostrare

Omettendo `tools`, verranno registrati tutti gli strumenti sopra elencati. Passalo per registrarne un sottoinsieme —
ad esempio, una console in hosting che dispone già del proprio browser di storage può escludere tale strumento:

```tsx
<RebaseStudio tools={["sql", "rls", "schema-visualizer", "api"]} />
```

`"schema"`, lo strumento Collections, non è più accettato: lo strumento è stato rimosso.

L'elenco viene valutato per *contenuto*, non per identità di riferimento, quindi definirlo inline è sicuro: un
nuovo rendering dell'host non distrugge né rimonta lo strumento attualmente mostrato sullo schermo.

## Prossimi passi

- **[Plugin](/docs/plugins)** — Estendi il framework con i plugin
- **[Tabelle](/docs/schema/)** — Dichiarare le tabelle lette da Studio
- **[Personalizzare una tabella](/docs/frontend/customize-table/)** — Come vengono mostrate nel pannello
