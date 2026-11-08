---
sourceHash: aa952b8682070ef6
title: L'endpoint MCP remoto
sidebar_label: Endpoint MCP remoto
description: Fornisci MCP da un backend distribuito su /mcp, in modo che gli utenti della tua app possano connettere Claude o Cursor a proprio nome — OAuth con schermata di consenso, dodici strumenti sotto tre scope, ogni chiamata regolata dalla propria row-level security.
---

:::tip[Vuoi connettere Claude ai tuoi progetti?]
Quello è il [connettore Rebase](/docs/ai/rebase-connector/): un unico connettore per
tutti loro, e un server self-hosted si unisce ad esso con `rebase cloud connect`. Questa
pagina è destinata alle persone che **usano** la tua app.
:::

Il [server MCP](/docs/ai/mcp/) è uno strumento per sviluppatori: viene eseguito sulla tua macchina e contiene una
chiave di servizio o una chiave API. Un backend distribuito può anche fornire direttamente MCP, su
`/mcp`, per gli utenti della tua applicazione. Un assistente collegato da uno di essi legge e
scrive nel progetto **a nome di quella persona**, e ogni chiamata viene eseguita sotto la sua
specifica row-level security.

È disattivato a meno che non venga abilitato, ed entrambe le variabili sono obbligatorie:

```bash
REBASE_MCP_ENABLED=true
REBASE_PUBLIC_URL=https://app.example.com   # this deployment's real origin
```

Senza `REBASE_PUBLIC_URL`, un secret JWT o un driver dati in grado di limitare l'ambito di una query
a un singolo utente, l'endpoint rifiuta il montaggio e ne indica il motivo nel log di avvio. Nessun
`REBASE_ROLE` può attivarlo.

- **OAuth, con schermata di consenso.** Un client individua l'authorization server
  tramite `/.well-known/oauth-protected-resource`, si registra (la registrazione
  dinamica è attiva per impostazione predefinita; `REBASE_MCP_OPEN_REGISTRATION=false` la limita
  ai client registrati da te) e reindirizza l'utente a una schermata di consenso che ne esegue
  l'accesso tramite il tuo `/auth/login` esistente. A un account con autenticazione a due fattori
  viene quindi richiesto il codice di autenticazione o un codice di recupero, tramite le
  route `/auth/mfa/challenge` esistenti. Quando il frontend della tua app mantiene una sessione
  nello stesso browser, la schermata propone quell'account e "Consenti" accorda il consenso per tale
  account senza richiedere la password; è così che si connette chi effettua l'accesso esclusivamente
  con Google, GitHub o un link e-mail. In caso contrario, l'accesso avviene tramite password;
  se l'utente non ne possiede una, ne imposta prima una con `/auth/forgot-password`
  (la funzione "Password dimenticata" della tua app), come indicato nella schermata. Viene inoltre indicato l'host a cui viene inviato il codice di autorizzazione,
  specificando che tale host non è verificato: chiunque può registrare un client con
  qualsiasi nome, pertanto l'host è l'elemento che l'utente può verificare.
- **Dodici strumenti, tre scope.** <span class="since-badge" data-since="0.29">Da 0.29</span> Gli stessi [scope](/docs/backend/roles-and-scopes/)
  utilizzati da ogni credenziale. `data:read` offre `list_collections`, `describe_collection`,
  `query_collection`, `count_documents`, `aggregate_documents`, `get_document` e le tre viste,
  `show_collection`, `show_record` e `show_app`; `data:write` aggiunge `create_document` e
  `update_document`; `data:delete` aggiunge `delete_document`. Un client che non richiede
  nulla ottiene `data:read`. Ciascuno può essere ristretto a una specifica collezione: `data:read:posts`
  elenca, descrive e legge `posts` e nient'altro. Uno scope determina quali strumenti vengono
  offerti e quali collezioni raggiungono, non quali righe: un elenco vuoto può essere il
  normale funzionamento della RLS, e `data:write` continua a non poter scrivere una riga a cui l'utente non ha accesso.
- **Tre strumenti portano il tuo pannello di amministrazione davanti all'utente.** In un client che
  esegue il rendering delle MCP App, come Claude, aprono le viste del pannello di amministrazione direttamente nella
  conversazione, ricavate dalle tue collezioni: i relativi campi, enum, regole di validazione,
  relazioni, sezioni di form e impostazioni di visualizzazione.
  - `show_collection` accetta gli argomenti di `query_collection`, oltre a `view`
    (`table`, `list`, `cards` o `kanban`), e apre la vista della collezione: l'utente
    può cercare, filtrare, ordinare e paginare, aprire il form di una riga e aggiungere righe.
  - `show_record` apre il form di una singola riga (`id`), o un form per una nuova riga che
    inizia con i valori (`values`) compilati dal modello, affinché l'utente possa controllarli e
    salvarli personalmente.
  - `show_app` esegue un'app scritta dal modello per l'attività corrente: un componente
    React (`code`) e le collezioni (`collections`) che legge. Importa i pacchetti
    proprietari di Rebase, in modo che lo stesso codice funzioni nel tuo progetto:
    - `@rebasepro/app`: `useRows`, `useRow`, `useRowCount`, `useAggregate`
      e `useRowWrites` sulle righe del progetto;
    - `@rebasepro/cms`: `CollectionPanel` del pannello di amministrazione (con
      `CollectionToolbar` e i suoi elementi, e `onRowClick`, che passa all'app
      la riga selezionata così come viene letta da `useRows`), `EntityFormPanel` e `FormField`,
      `RecordDetail`, `FieldValue` e `useSidePanel`, ciascuno dei quali specifica la propria
      collezione tramite percorso, con i tuoi campi, viste e azioni personalizzati;
    - `@rebasepro/ui`, l'intero UI kit, inclusi `SplitView` e i riquadri KPI e
      grafici.

    Il server lo compila preventivamente, quindi un errore di sintassi, un modulo non fornito
    dalla vista o un nome non esposto da `@rebasepro/cms` o
    `@rebasepro/app` costituisce l'errore della chiamata, con l'indicazione della riga. Un errore durante
    l'esecuzione viene mostrato al suo posto e comunicato al modello con il messaggio successivo
    dell'utente. Un'app può utilizzare solo le collezioni che elenca. I suoi stili sono
    le utility standard di Tailwind, compilate con la vista prima dell'arrivo di qualsiasi
    app: un valore arbitrario come `h-[560px]` non ha alcun effetto, quindi una
    dimensione esatta deve essere definita tramite `style`.

  Ogni operazione di lettura e salvataggio nella vista è una chiamata a uno degli strumenti di lettura e scrittura,
  eseguita a nome della persona sotto la sua RLS, quindi un form offre solo ciò che è stato
  concesso alla connessione: senza `data:write` è in sola lettura, e un campo che
  i ruoli dell'utente non possono leggere non è presente. Questo è il perimetro entro cui opera
  anche il codice di un'app: viene eseguito nella vista, quindi ogni chiamata effettuata corrisponde a uno di
  questi strumenti, a nome dell'utente, e non può fare nulla che il modello non possa fare
  con gli stessi strumenti. Sul connettore hosted ogni scrittura viene inoltre pianificata
  e confermata dal server. All'interno di tale contesto, `useRowWrites` chiede conferma alla persona
  prima di scrivere, in modo che un'app non scriva nulla senza il suo clic; i
  controlli nativi dell'amministrazione (il Salva di un form, un'eliminazione, una modifica in tabella) si comportano come farebbero su una schermata `show_collection`. Il modello viene informato delle modifiche apportate. Legge le righe restituite da ciascuno strumento, non le configurazioni delle collezioni con cui la vista viene disegnata. Un client privo del supporto a MCP Apps, come Claude Code o Cursor, non mostra nulla
  e il modello legge le stesse righe che otterrebbe da `query_collection`.
- **Le autorizzazioni concesse prima della versione 0.24 mantengono la loro portata.** `mcp:read` viene interpretato come
  `data:read`, e `mcp:write` come `data:write data:delete`, sia per le autorizzazioni memorizzate sia
  per i token già emessi.
- **Funziona anche una chiave API.** `/mcp` accetta anche `Authorization: Bearer rk_…`, per
  un client configurato con un header anziché con un flusso OAuth. La chiave accede
  agli strumenti coperti dai suoi scope `data:*`, operando con l'identità corrispondente: una
  [chiave personale](/docs/backend/api-keys/#personal-keys) come il suo proprietario, una service key
  come `api-key:<id>`.
- **Il vocabolario dell'SDK, le risposte di REST.** Gli strumenti accettano gli stessi parametri dell'SDK —
  `where` (`{"status": ["==", "paid"]}`), `orderBy` (`["created_at", "desc"]` o
  `"created_at:desc"`), `limit`, `offset`, `searchString`, e `data` per una
  scrittura — ed effettuano letture tramite il percorso di `GET /api/data/<collection>`, quindi una riga viene restituita
  esattamente come fornita da REST (date ISO, un `belongsTo` come foreign key, ad es.
  `authorId`) e può essere reinviata in un aggiornamento senza modifiche. `query_collection`
  risponde con `{ data, meta }`, dove compaiono `meta.total` e `meta.hasMore`, mentre `count_documents`
  restituisce `{ count }`. `aggregate_documents` corrisponde a `GET /api/data/<collection>/aggregate`:
  `select` è una lista nella sintassi di REST (`["count()", "sum(total)"]`), `groupBy`
  un elenco di campi, e restituisce `{ data }` con una riga per gruppo, oltre a
  `meta.hasMore` nelle chiamate con raggruppamento, i cui gruppi supportano la paginazione con `limit` e `offset`
  e l'ordinamento con `orderBy`. Su una collezione riscritta da un callback `afterRead`,
  fornisce unicamente `count()`, proprio come REST. Come su REST, un `limit` superiore a 1000, un argomento non dichiarato e la
  modifica o eliminazione di una riga nel cestino (404) vengono rifiutati; impostando il campo di soft-delete
  a `null` la riga viene ripristinata. `deleted: "only"` (o `"include"`) su
  `query_collection`, `count_documents` e `aggregate_documents` legge il cestino, esattamente come il parametro
  `?deleted=` di REST, consentendo di ritrovare una riga spostata nel cestino da `delete_document` per
  ripristinarla. La sua descrizione informa il modello che l'eliminazione è definitiva solo nei casi in cui
  la collezione non possiede un campo di soft-delete.
- **L'elenco nomina le collezioni; `describe_collection` fornisce lo schema di una di esse.**
  `list_collections` restituisce `name`, `title` e `description` di ciascuna collezione,
  e `describe_collection { collection }` restituisce gli schemi OpenAPI `row` e
  `create` di tale collezione, oltre a `softDeleteField` se le righe vengono inviate a un cestino. Le descrizioni
  degli strumenti indicano al modello di descrivere una collezione prima di scrivervi. L'elenco per un
  progetto da 200 collezioni occupa circa 5k token e ogni descrizione
  meno di 1k; includendo ogni schema nell'elenco si arrivava a circa 150k.
- **Un token riservato esclusivamente a questo endpoint.** Un token di accesso MCP viene rifiutato da
  `/api/data`, `/api/admin` e dal WebSocket, pertanto la connessione di un assistente non
  gli conferisce una sessione completa.

Ogni richiesta a `/mcp` rilegge l'account dell'utente. Un account eliminato o disabilitato,
oppure una "disconnessione ovunque" o un cambio password effettuati dopo l'emissione del token,
bloccano immediatamente un client connesso con un 401. Una retrocessione di permessi viene applicata alla sua
chiamata di strumento successiva. Ogni refresh esegue i medesimi controlli e revoca definitivamente
tale concessione. Una sessione ospite non può in alcun modo prestare il consenso.

Un limite. La disconnessione di un client (`DELETE /api/oauth/grants/:clientId`, tramite la
sessione dell'utente stesso) revoca immediatamente i suoi refresh token, ma un token di accesso
già emesso continua a funzionare fino alla sua scadenza, entro un'ora.

Le route sono disponibili in [Endpoint](/docs/backend/endpoints/#mcp-surface) e le
variabili in [Configurazione](/docs/getting-started/configuration/#mcp-surface).
