---
sourceHash: 59fb182b5af4d770
title: Strumenti Studio
sidebar_label: Studio
description: Rebase Studio fornisce strumenti per sviluppatori per la modifica visiva dello schema, query SQL, scripting JavaScript, gestione delle policy RLS e navigazione dello storage.
---

## Panoramica

Studio è la metà per sviluppatori del pannello di amministrazione. La stessa
applicazione con cui il tuo team di contenuti modifica le righe porta anche un
editor di schema, una console SQL, un blocco per appunti JavaScript, un browser
delle policy RLS e un browser dello storage — e Studio è la modalità che li
sblocca. Niente da installare e niente da distribuire: è già nel pannello, dietro
l'interruttore nel drawer.

![L'editor di collezioni, lo strumento di punta di Studio: un editor di schema visuale che riscrive il tuo TypeScript](/img/collection_editor.png)

Esiste perché l'alternativa è un secondo set di credenziali. Modificare una
collezione, controllare cosa consente davvero una policy o eseguire una singola
query sulla produzione significa altrimenti un client di database, una copia
della stringa di connessione e un audit trail che finisce a «qualcuno con psql».
Studio fa tutto questo come l'admin che ha effettuato l'accesso, attraverso la
stessa autorizzazione che usa l'API.

## Le due modalità

Il pannello ha due modalità — `"cms" | "studio"`:

- **CMS** (`"cms"`) — Per editor di contenuti e team operativi. Mostra le collezioni e la gestione dei dati. È il valore predefinito.
- **Studio** (`"studio"`) — Per gli sviluppatori. Sblocca gli strumenti qui sotto.

Passa dall'una all'altra con il controller della modalità admin o con
l'interruttore del drawer. La modalità scelta viene conservata in `localStorage`
sotto `rebase-admin-mode`; un browser che ha usato il pannello prima della 0.17.0
conserva il vecchio valore `"content"` e viene migrato a `"cms"` in lettura.

## Strumenti Studio Integrati

### Editor di Collezioni

Un editor di schema visuale che ti permette di creare e modificare collezioni tramite un'interfaccia utente drag-and-drop. Quando salvi le modifiche, utilizza [ts-morph](https://ts-morph.com/) per scrivere nei tuoi file sorgente TypeScript solo le chiavi che hai cambiato — e soltanto quelle — lasciando il resto di ogni file com'era: import, commenti, formattazione, handler, proprietà condivise. Una modifica a qualcosa che il file definisce nel codice, come una proprietà importata da un altro modulo, viene respinta indicando dove va fatta. È lo screenshot in cima a questa pagina.

L'editor è attivo ovunque sia montato Studio — il `<RebaseStudio/>` di uno scaffold basta, e non c'è alcuna prop da aggiungere. `collectionEditor` lo regola, non lo attiva:

```tsx
import { RebaseCMS } from "@rebasepro/cms";
import { RebaseStudio } from "@rebasepro/studio";

// Studio è montato, quindi l'editor delle collezioni è disponibile.
// Non serve altro.
<Rebase>
    <RebaseCMS collections={collections}/>
    <RebaseStudio/>
</Rebase>

// `collectionEditor` serve per la messa a punto — un editor in sola
// lettura, un token diverso — non per attivarlo.
<RebaseCMS
    collections={collections}
    collectionEditor={{
        getAuthToken: authController.getAuthToken
    }}
/>
```

Se un *salvataggio* vada a buon fine lo decide il server, non il pannello: l'editor riscrive i file sorgente delle collezioni, quindi è disattivato con `NODE_ENV=production`, in modalità `baas` e su un server senza `collectionsDir`. Il pannello interroga `GET /api/schema-editor/status` e mostra il motivo ricevuto accanto al pulsante disabilitato.

### Strumenti integrati

Fanno parte di Studio e vengono **caricati in modo lazy da `RebaseStudio`** — ognuno è un chunk separato, scaricato la prima volta che lo apri. Non sono importabili singolarmente: `@rebasepro/studio` esporta deliberatamente solo l'orchestratore, così una console che non apri mai non costa nulla.

| Scheda | Slug | Gruppo | Cosa fa |
|--------|------|--------|---------|
| Console SQL | `sql` | Database | Eseguire SQL grezzo sul tuo database PostgreSQL e leggere i risultati in tabella |
| Policy RLS | `rls` | Database | Ispezionare e gestire le policy di Row Level Security delle tue tabelle. <span class="since-badge" data-since="0.24">Da 0.24</span> Una policy viene elencata così come la conserva il database, con il badge **Differs from code** dove non corrisponde a ciò che dichiara il progetto. Una policy che Rebase genera non può essere modificata direttamente nel database, e su una tabella gestita da Rebase un banner indica che ogni avvio del server e `rebase db push` riapplicano le policy dichiarate |
| Visualizzatore di schema | `schema-visualizer` | Database | Diagramma delle entità delle tue collezioni e delle loro relazioni, tracciato dalle definizioni delle collezioni: tabelle, colonne, tipi e relazioni sono come le dichiarano le collezioni. Solo gli indicatori RLS vengono letti dal database |
| Branch | `branches` | Database | Creare e gestire i [branch del database](/docs/backend/branching) |
| Backup | `backups` | Database | Sfogliare e scaricare i backup del database |
| Esploratore dei log | `logs` | Database | Log delle richieste in tempo reale, più tutto ciò che il server segnala a warn o error — vedi sotto |
| Console JS | `js` | Compute | Scrivere ed eseguire JavaScript tramite l'SDK di Rebase |
| Job cron | `cron` | Compute | Ispezionare e gestire le [attività pianificate](/docs/backend/cron-jobs) |
| Storage | `storage` | Storage | Sfogliare, caricare e gestire i file nei tuoi backend di storage |
| Esploratore API | `api` | API | Documentazione API interattiva, con un esecutore di richieste |
| Chiavi API | `api-keys` | Controllo degli accessi | Creare e gestire chiavi API di servizio con scope |

### Cosa mostra l'esploratore dei log

Due flussi in un unico anello in memoria, tenuto nel processo del server:

- **Ogni richiesta** — metodo, percorso, stato, durata, l'`X-Request-ID`, la
  collezione quando la richiesta ne riguardava una e, in caso di fallimento, il
  `code` di errore e il messaggio ricevuti dal client. Una richiesta fallita
  viene registrata a `warn` (4xx) o `error` (5xx), così il filtro per livello la
  trova.
  <span class="since-badge" data-since="0.24">Da 0.24</span> Il suo `source` deriva dal percorso: `/api/auth/*` e `/api/oauth/*` sono
  `auth`, `/api/storage/*` è `storage`, e tutto il resto è `api`, così il
  filtro Source trova gli accessi sotto Auth e i caricamenti sotto Storage.
- **Tutto ciò che il server segnala a warn o error** — un avviso di schema, un
  rifiuto di autenticazione, una diagnosi del driver, un fallimento di boot.
  `source` deriva dal prefisso del messaggio stesso (`[API]`, `[Auth]`,
  `[storage]`, `[realtime]`), e tutto ciò che non è riconosciuto diventa
  `system`.

Le chiacchiere di routine a livello `info` restano fuori di proposito. L'anello
contiene 10.000 voci e un muro di `200` espelle proprio ciò per cui avevi aperto
il pannello.

Una function personalizzata che solleva un'eccezione mostra quindi il proprio
messaggio qui, accanto alla richiesta che l'ha chiamata — il caso per cui tutto
questo esiste.

L'anello è per processo e per boot: non è durevole, non è condiviso tra le
repliche e un riavvio lo svuota. Per tutto ciò che devi conservare, leggi lo
stdout del processo, che porta le stesse righe e altro ancora.

<span class="since-badge" data-since="0.24">Da 0.24</span> L'esploratore lo dice. Mostra il log dell'unica istanza del server che lo
serve e ne indica il nome: l'evento `snapshot` di
`GET /api/admin/logs/stream` porta `instance`, l'`HOSTNAME` del processo (il
nome del pod su Kubernetes, l'id del container sotto Docker) oppure `pid-<n>`. Non
esiste una vista tra le repliche, né dei processi `functions` e `worker` di un
[deployment suddiviso](/docs/deployment/split-processes/). Una riconnessione che
finisce su un'altra istanza sostituisce la finestra invece di mescolare i due log.

Anche l'**editor di collezioni** è uno strumento Studio, ma non è in questo
elenco perché viene registrato in modo diverso: `RebaseStudio` non lo carica in
modo lazy. Il pannello lo monta ovunque Studio sia registrato, perché a
differenza degli strumenti qui sopra ha bisogno del sorgente delle collezioni del
progetto sottomano per riscriverlo. È una differenza in come viene montato, non
in cosa è — modifica lo schema, e il suo posto è accanto agli editor SQL e RLS.

## Attivare Studio

Un componente, ovunque all'interno di `<Rebase>`. Non renderizza nulla — registra
gli strumenti, e `<RebaseShell>` li disegna:

```tsx
import { RebaseStudio } from "@rebasepro/studio";

export function App() {
    return (
        <Rebase client={client} authController={authController}>
            <RebaseCMS collections={collections}/>
            <RebaseStudio/>
            <RebaseShell title="My App"/>
        </Rebase>
    );
}
```

Gli strumenti compaiono nel drawer finché la modalità Studio è attiva. Ometti del
tutto `<RebaseStudio>` e distribuirai un CMS di soli contenuti: nessuna modalità
Studio, nessun interruttore, niente caricato in modo lazy.

## Aggiungere un tuo strumento

`devViews` mette le tue viste accanto a quelle integrate. Sono normali
[`AppView`](/docs/frontend#custom-views) — l'unica cosa che rende una vista uno
strumento Studio invece che una vista del CMS è il componente su cui viene
registrata:

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

| Registrata su | Compare in | Per |
|---|---|---|
| `<RebaseCMS views>` | modalità contenuti | ciò che usa chi modifica i contenuti |
| `<RebaseStudio devViews>` | modalità Studio | ciò che usi tu per far girare il backend |

Una vista va esattamente in una delle due — il drawer ordina in base a chi l'ha
registrata, quindi elencare uno slug in entrambe la nasconde dalla modalità
contenuti.

Come `tools`, l'elenco viene letto per *contenuto*: scriverlo inline è sicuro, e
un nuovo render dell'host non rimonta lo strumento a schermo. Rinominare una
vista o cambiarne il gruppo invece la registra di nuovo.

### Scegliere quali strumenti compaiono

Ometti `tools` e vengono registrati tutti gli strumenti qui sopra. Passalo per
registrarne un sottoinsieme — una console ospitata che ha già il proprio browser
dello storage, per esempio, può lasciare fuori quello:

```tsx
<RebaseStudio tools={["sql", "rls", "schema-visualizer", "api"]} />
```

L'elenco viene letto per *contenuto*, non per identità, quindi scriverlo inline è
sicuro: un nuovo render dell'host non smonta e rimonta lo strumento a schermo.

## Passi Successivi

- **[Plugin](/docs/plugins)** — Estendi il framework con i plugin
- **[Collezioni](/docs/collections)** — Configurazione delle collezioni
