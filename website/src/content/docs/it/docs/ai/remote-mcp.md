---
sourceHash: fc4e87a4b7e7a310
title: L'endpoint MCP remoto
sidebar_label: Endpoint MCP remoto
description: Distribuisci MCP da un backend distribuito su /mcp, in modo che le persone che utilizzano la tua app possano connettere Claude o Cursor a proprio nome — OAuth con schermata di consenso, dodici tool sotto tre scope, ogni chiamata regolata dalla propria row-level security.
---

:::tip[Stai connettendo Claude ai tuoi progetti?]
In tal caso si utilizza il [connettore Rebase](/docs/ai/rebase-connector/): un unico connettore per
tutti loro, a cui un server self-hosted si unisce con `rebase cloud connect`. Questa
pagina è dedicata alle persone che **utilizzano** la tua app.
:::

Il [server MCP](/docs/ai/mcp/) è uno strumento per sviluppatori: viene eseguito sulla tua macchina e contiene una chiave
di servizio o una chiave API. Un backend distribuito può anche servire MCP stesso, su `/mcp`, per
le persone che utilizzano la tua applicazione. Un assistente collegato da una di esse legge e
scrive nel progetto **a nome di quella persona**, e ogni chiamata viene eseguita sotto la propria
row-level security.

È disattivato a meno che non venga abilitato, ed entrambe le variabili sono obbligatorie:

```bash
REBASE_MCP_ENABLED=true
REBASE_PUBLIC_URL=https://app.example.com   # this deployment's real origin
```

Senza `REBASE_PUBLIC_URL`, un segreto JWT o un data driver in grado di limitare l'ambito di una query
a un singolo utente, l'endpoint rifiuta di montarsi e ne indica il motivo nel log di avvio. Nessun
`REBASE_ROLE` lo attiva.

- **OAuth, con una schermata di consenso.** Un client individua il server di autorizzazione
  tramite `/.well-known/oauth-protected-resource`, si registra (la registrazione
  dinamica è attiva per impostazione predefinita; `REBASE_MCP_OPEN_REGISTRATION=false` la limita
  ai client registrati da te) e indirizza l'utente a una schermata di consenso che ne esegue
  l'accesso tramite l'endpoint `/auth/login` esistente. A un account con autenticazione a due fattori
  viene quindi richiesto il codice dell'autenticatore o un codice di ripristino, tramite le
  rotte `/auth/mfa/challenge` esistenti. Quando il frontend della tua app
  mantiene una sessione nello stesso browser, la schermata propone quell'account e
  l'opzione Consenti fornisce il consenso a suo nome senza password; è così che si connette chi accede solo
  con Google, GitHub o un link via email. Altrimenti, l'accesso avviene con
  password, e chi non ne possiede una la imposta prima con `/auth/forgot-password`
  ("Password dimenticata" della tua app); la schermata lo segnala chiaramente. Indica inoltre l'host a cui viene inviato il codice di autorizzazione,
  specificando che tale host non è verificato: chiunque può registrare un client con
  qualsiasi nome, quindi l'host è la parte che l'utente può verificare.
- **Dodici tool, tre scope.** <span class="since-badge" data-since="0.29">Da 0.29</span> Gli stessi [scope](/docs/backend/roles-and-scopes/)
  utilizzati da ogni credenziale. `data:read` offre `list_collections`, `describe_collection`,
  `query_collection`, `count_documents`, `aggregate_documents`, `get_document` e le tre viste,
  `show_collection`, `show_record` e `show_app`; `data:write` aggiunge `create_document` e
  `update_document`; `data:delete` aggiunge `delete_document`. Un client che non richiede
  nulla ottiene `data:read`. Ciascuno di essi può essere ristretto a una collection: `data:read:posts`
  elenca, descrive e legge `posts` e nient'altro. Uno scope determina quali tool vengono
  offerti e a quali collection possono accedere, non quali righe: un elenco vuoto può essere
  dovuto alla RLS in funzione, e `data:write` non può comunque scrivere una riga a cui la persona non ha accesso.
- **Tre tool mettono il tuo pannello di amministrazione a disposizione dell'utente.** In un client che
  esegue il rendering delle MCP App, come Claude, questi aprono le viste del pannello di amministrazione direttamente nella
  conversazione, attingendo dalle tue collection: i loro campi, enum, validazioni,
  relazioni, sezioni di form e impostazioni di visualizzazione.
  - `show_collection` accetta gli argomenti di `query_collection`, oltre a `view`
    (`table`, `list`, `cards` o `kanban`), e apre la vista della collection: la
    persona può cercare, filtrare, ordinare e paginare, aprire il form di una riga e aggiungere righe.
  - `show_record` apre il form di una riga (`id`), oppure un form per una nuova riga che
    inizia dai `values` compilati dal modello, affinché l'utente possa verificarli e
    salvarli autonomamente.
  - `show_app` esegue un'app scritta dal modello per l'attività corrente: un
    componente React (`code`) e le `collections` che legge. Importa i pacchetti
    nativi di Rebase, in modo che lo stesso codice funzioni nel tuo progetto:
    - `@rebasepro/app`: `useRows`, `useRow`, `useRowCount`, `useAggregate`
      e `useRowWrites` sulle righe del progetto;
    - `@rebasepro/cms`: il `CollectionPanel` del pannello di amministrazione (con
      `CollectionToolbar` e i suoi componenti, e `onRowClick`, che passa
      all'app la riga selezionata così come letta da `useRows`), `EntityFormPanel` e `FormField`,
      `EntityViewPanel`, `FieldValue` e `useSidePanel`, ciascuno specificando la propria
      collection tramite percorso, con i tuoi campi personalizzati, viste e azioni;
    - `@rebasepro/ui`, l'intero kit UI, inclusi `SplitView` e i riquadri e
      grafici dei KPI.

    Il server lo compila prima, quindi un errore di sintassi, un modulo non fornito
    dalla vista o un nome non esportato da `@rebasepro/cms` o
    `@rebasepro/app` diventa l'errore della chiamata, con l'indicazione della riga. Un errore durante l'esecuzione
    viene mostrato al suo posto e comunicato al modello con il messaggio
    successivo dell'utente. Un'app può utilizzare solo le collection che elenca. I suoi stili sono
    le utility standard di Tailwind, integrate con la vista prima che arrivi qualsiasi
    app: un valore arbitrario come `h-[560px]` non ha alcun effetto, quindi una
    dimensione esatta deve essere definita come `style`.

  Ogni lettura e salvataggio nella vista è una chiamata ai tool di lettura e scrittura,
  eseguita a nome della persona e sotto la sua RLS, quindi un form offre solo ciò per cui
  la connessione è stata autorizzata: senza `data:write` è di sola lettura, e un campo
  che i suoi ruoli non possono leggere non vi compare. Questo è il perimetro entro cui opera
  anche il codice di un'app: viene eseguito nella vista, quindi ogni chiamata effettuata corrisponde a uno di
  quei tool, per conto dell'utente, e non può fare nulla che il modello non potrebbe fare
  con gli stessi tool. Sul connettore hosted ogni scrittura viene inoltre pianificata
  e confermata dal server. All'interno di questo contesto, `useRowWrites` chiede conferma alla persona
  prima di scrivere, in modo che un'app non scriva senza un suo clic; i
  controlli nativi di amministrazione (il Salva di un form, un'eliminazione, una modifica in tabella) si comportano come
  in una schermata `show_collection`. Al modello viene comunicato cosa è stato modificato. Legge le righe restituite da ciascun tool, non le configurazioni delle collection utilizzate per
  disegnare la vista. Un client senza MCP App, come Claude Code o Cursor, non mostra nulla,
  e il modello legge le stesse righe che otterrebbe da `query_collection`.
- **Le autorizzazioni concesse prima della 0.24 mantengono la loro portata.** `mcp:read` viene interpretato come
  `data:read`, e `mcp:write` come `data:write data:delete`, sia sulle autorizzazioni memorizzate sia
  sui token già emessi.
- **Funziona anche una chiave API.** `/mcp` accetta anche `Authorization: Bearer rk_…`, per
  un client configurato con un header anziché con un flusso OAuth. La chiave accede
  ai tool coperti dai suoi scope `data:*`, con l'identità associata: una
  [chiave personale](/docs/backend/api-keys/#personal-keys) come proprietario, una chiave di servizio
  come `api-key:<id>`.
- **Il vocabolario dell'SDK, le risposte di REST.** I tool accettano ciò che accetta l'SDK —
  `where` (`{"status": ["==", "paid"]}`), `orderBy` (`["created_at", "desc"]` o
  `"created_at:desc"`), `limit`, `offset`, `searchString` e `data` per una
  scrittura — e leggono attraverso il percorso di `GET /api/data/<collection>`, quindi una riga viene
  restituita così come la fornisce REST (date ISO, una relazione `belongsTo` come chiave esterna, es.
  `authorId`) e può essere reinviata in un aggiornamento senza modifiche. `query_collection`
  risponde con `{ data, meta }`, dove sono presenti `meta.total` e `meta.hasMore`, e `count_documents`
  con `{ count }`. `aggregate_documents` corrisponde a `GET /api/data/<collection>/aggregate`:
  `select` è un elenco nella sintassi di REST (`["count()", "sum(total)"]`), `groupBy`
  un elenco di campi, e risponde con `{ data }` con una riga per gruppo, oltre a
  `meta.hasMore` nelle chiamate raggruppate, i cui gruppi supportano la paginazione con `limit` e `offset`
  e l'ordinamento con `orderBy`. Su una collection che una callback `afterRead` riscrive, restituisce
  esclusivamente `count()`, esattamente come REST. Come su REST, un `limit` superiore a 1000, un argomento non dichiarato e la
  modifica o l'eliminazione di una riga cestinata (404) vengono rifiutati; impostare il campo
  di soft-delete a `null` la ripristina. `deleted: "only"` (o `"include"`) su
  `query_collection`, `count_documents` e `aggregate_documents` legge il cestino, proprio come fa
  `?deleted=` di REST, consentendo di ritrovare una riga cestinata da `delete_document` per
  ripristinarla. La sua descrizione indica al modello che l'eliminazione è definitiva solo laddove
  la collection non dispone di un campo di soft-delete.
- **L'elenco nomina le collection; `describe_collection` ne fornisce lo schema.**
  `list_collections` restituisce `name`, `title` e `description` di ciascuna collection,
  e `describe_collection { collection }` gli schemi OpenAPI `row` e
  `create` di tale collection, oltre a `softDeleteField` dove le righe finiscono nel cestino. Le descrizioni
  dei tool indicano al modello di descrivere una collection prima di scrivervi. L'elenco di un
  progetto con 200 collection richiede circa 5k token, e ogni descrizione
  meno di 1k; includendo ogni schema nell'elenco si arrivava a circa 150k.
- **Un token riservato esclusivamente a questo endpoint.** Un token di accesso MCP viene rifiutato da
  `/api/data`, `/api/admin` e dal WebSocket, pertanto la connessione di un assistente non
  gli consegna una sessione.

Ogni richiesta a `/mcp` rilegge l'account dell'utente. Un account eliminato
o disabilitato, oppure un'azione di "disconnetti ovunque" o un cambio password avvenuti dopo
l'emissione del token, blocca immediatamente un client connesso con un 401. Una retrocessione di ruolo si applica alla
chiamata al tool successiva. Ogni refresh esegue gli stessi controlli e rifiuta definitivamente
tale autorizzazione. Una sessione ospite non può fornire alcun consenso.

Un'unica limitazione. La disconnessione di un client (`DELETE /api/oauth/grants/:clientId`, con la
sessione dell'utente) revoca immediatamente i suoi refresh token, ma un access token
già emesso continua a funzionare fino alla sua scadenza, entro un'ora.

Le rotte sono disponibili in [Endpoint](/docs/backend/endpoints/#mcp-surface) e le
variabili in [Configurazione](/docs/getting-started/configuration/#mcp-surface).
