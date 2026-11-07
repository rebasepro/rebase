---
sourceHash: b813cdc1b302b6c6
title: L'endpoint MCP remoto
sidebar_label: Endpoint MCP remoto
description: Offri MCP da un backend distribuito su /mcp, in modo che le persone che usano la tua app possano connettere Claude o Cursor con la propria identità — OAuth con schermata di consenso, nove tool sotto tre scope, ogni chiamata regolata dalla propria row-level security.
---

:::tip[Vuoi connettere Claude ai tuoi progetti?]
Quello è il [Rebase connector](/docs/ai/rebase-connector/): un unico connettore per
tutti, e un server self-hosted vi si unisce con `rebase cloud connect`. Questa
pagina è per le persone che **usano** la tua app.
:::

Il [server MCP](/docs/ai/mcp/) è uno strumento per sviluppatori: viene eseguito sulla tua macchina e contiene una chiave di servizio o una chiave API. Un backend distribuito può anche offrire direttamente MCP, su `/mcp`, per
le persone che usano la tua applicazione. Un assistente connesso da uno di loro legge e
scrive nel progetto **con l'identità di quella persona**, e ogni chiamata viene eseguita con la sua specifica
row-level security.

È disattivato a meno che non venga abilitato, ed entrambe le variabili sono obbligatorie:

```bash
REBASE_MCP_ENABLED=true
REBASE_PUBLIC_URL=https://app.example.com   # this deployment's real origin
```

Senza `REBASE_PUBLIC_URL`, un secret JWT o un data driver in grado di limitare l'ambito di una query
a un singolo utente, l'endpoint rifiuta di montarsi e ne spiega il motivo nel log di avvio. Nessun
`REBASE_ROLE` lo abilita.

- **OAuth, con una schermata di consenso.** Un client individua l'authorization server
  tramite `/.well-known/oauth-protected-resource`, si registra (la registrazione
  dinamica è attiva per impostazione predefinita; `REBASE_MCP_OPEN_REGISTRATION=false` la limita
  ai client registrati da te) e reindirizza la persona a una schermata di consenso che ne esegue
  l'accesso tramite il tuo `/auth/login` esistente. A un account con un secondo fattore
  viene quindi richiesto il codice di autenticazione o un codice di recupero, tramite le
  rotte `/auth/mfa/challenge` esistenti. Quando il frontend della tua app
  mantiene una sessione nello stesso browser, la schermata propone quell'account, e
  l'azione Consenti fornisce l'autorizzazione per quell'account senza password; è così che si connette chi accede solo
  con Google, GitHub o un link via email. Altrimenti, l'accesso avviene tramite
  password, e chi non ne possiede una deve prima impostarla con `/auth/forgot-password`
  ("Password dimenticata" della tua app); la schermata lo segnala esplicitamente. Indica inoltre l'host a cui viene inviato il codice di autorizzazione,
  precisando che tale host non è verificato: chiunque può registrare un client con
  qualsiasi nome, quindi l'host è la parte che una persona può verificare.
- **Undici tool, tre scope.** Gli stessi [scope](/docs/backend/roles-and-scopes/)
  utilizzati da qualsiasi credenziale. `data:read` offre `list_collections`, `describe_collection`,
  `query_collection`, `count_documents`, `get_document` e le tre viste,
  `show_collection`, `show_record` e `show_app`; `data:write` aggiunge `create_document` e
  `update_document`; `data:delete` aggiunge `delete_document`. Un client che non richiede
  nulla ottiene `data:read`. Ciascuno di essi può essere ristretto a una collection: `data:read:posts`
  elenca, descrive e legge `posts` e nient'altro. Uno scope stabilisce quali tool vengono
  offerti e quali collection possono raggiungere, non quali righe: un elenco vuoto può essere
  dovuto all'RLS in azione, e `data:write` non può comunque scrivere una riga a cui la persona non ha accesso.
- **Tre tool mettono il tuo pannello di amministrazione a disposizione dell'utente.** In un client che
  supporta il rendering di MCP Apps, come Claude, questi aprono le viste del pannello di amministrazione
  all'interno della conversazione, ricavate dalle tue collection: i loro campi, enum, validazioni,
  relazioni, sezioni di form e impostazioni di visualizzazione.
  - `show_collection` accetta gli argomenti di `query_collection`, oltre a `view`
    (`table`, `list`, `cards` o `kanban`), e apre la vista della collection: la
    persona può cercare, filtrare, ordinare e paginare, aprire il form di una riga e aggiungere righe.
  - `show_record` apre il form di una riga specifica (`id`), oppure un form per una nuova riga che
    parte dai `values` precompilati dal modello, affinché la persona possa controllarli
    e salvarli autonomamente.
  - `show_app` esegue un'app creata dal modello per l'attività corrente: un
    componente React (`code`) e le `collections` che legge. Importa l'UI kit
    (`@rebasepro/ui`), i riquadri KPI e i grafici di `@rebasepro/plugin-insights`,
    e `@rebasepro/mcp-apps`: `useQuery`, `useRecord`, `useCount` e
    `useMutate` sulle righe del progetto, oltre a `CollectionView` e `RecordForm`
    del pannello di amministrazione da comporre. Il server lo compila
    preventivamente, quindi un errore di sintassi o un'importazione mancante nella vista genera
    l'errore della chiamata, indicando la riga; un errore durante l'esecuzione viene mostrato al suo posto
    e comunicato al modello con il messaggio successivo dell'utente.

  Ogni lettura e salvataggio nella vista corrisponde a una chiamata dei tool di lettura e scrittura,
  eseguita a nome della persona con la sua RLS, quindi un form offre solo ciò che
  la sua connessione ha autorizzato: senza `data:write` è di sola lettura, e un campo
  che i suoi ruoli non possono leggere non è presente. Una modifica apportata dal codice di un'app viene mostrata
  alla persona per conferma prima dell'invio. Al modello viene comunicato cosa
  è stato modificato. Esso legge le righe restituite da ciascun tool, non le configurazioni delle collection
  usate dalla vista per il rendering. Un client senza MCP Apps, come Claude Code o Cursor, non mostra nulla,
  e il modello legge le stesse righe che otterrebbe da `query_collection`.
- **Le autorizzazioni concesse prima della versione 0.24 mantengono la loro validità.** `mcp:read` viene interpretato come
  `data:read`, e `mcp:write` come `data:write data:delete`, sia sulle autorizzazioni memorizzate che
  sui token già emessi.
- **Funziona anche una chiave API.** `/mcp` accetta anche `Authorization: Bearer rk_…`, per
  un client configurato con un header anziché con un flusso OAuth. La chiave accede
  ai tool coperti dai suoi scope `data:*`, agendo con l'identità corrispondente: una
  [chiave personale](/docs/backend/api-keys/#personal-keys) come il suo proprietario, una chiave di servizio
  come `api-key:<id>`.
- **Il vocabolario dell'SDK, le risposte di REST.** I tool accettano ciò che accetta l'SDK —
  `where` (`{"status": ["==", "paid"]}`), `orderBy` (`["created_at", "desc"]` o
  `"created_at:desc"`), `limit`, `offset`, `searchString`, e `data` per una
  scrittura — ed effettuano la lettura attraverso il percorso `GET /api/data/<collection>`, quindi una riga viene
  restituita nel formato servito da REST (date ISO, una relazione `belongsTo` come chiave esterna, ad es.
  `authorId`) e può essere inviata nuovamente in un aggiornamento senza modifiche. `query_collection`
  restituisce `{ data, meta }` con `meta.total` e `meta.hasMore`, e `count_documents`
  restituisce `{ count }`. Come su REST, un `limit` superiore a 1000, un argomento non dichiarato e
  la modifica o l'eliminazione di una riga nel cestino (404) vengono rifiutati; impostando il campo
  di soft-delete a `null` la si ripristina. `deleted: "only"` (o `"include"`) su
  `query_collection` e `count_documents` legge il cestino, proprio come fa `?deleted=`
  di REST, permettendo di ritrovare per il ripristino una riga cestinata da `delete_document`. La sua descrizione informa il modello che l'eliminazione è definitiva solo nei casi
  in cui la collection non disponga di un campo di soft-delete.
- **L'elenco nomina le collection; `describe_collection` ne fornisce lo schema.**
  `list_collections` restituisce `name`, `title` e `description` di ciascuna collection,
  e `describe_collection { collection }` fornisce gli schemi OpenAPI `row` e
  `create` di quella collection, oltre a `softDeleteField` se le righe vengono spostate nel cestino. Le descrizioni
  dei tool indicano al modello di descrivere una collection prima di scrivervi. L'elenco
  di un progetto con 200 collection occupa circa 5k token, e ogni descrizione
  meno di 1k; includendo ogni schema nell'elenco complessivo si arrivava a circa 150k.
- **Un token esclusivamente per questo endpoint.** Un token di accesso MCP viene rifiutato da
  `/api/data`, `/api/admin` e dal WebSocket, pertanto la connessione di un assistente non
  gli consegna una sessione.

Ogni richiesta a `/mcp` verifica nuovamente l'account dell'utente. Un account
eliminato o disabilitato, oppure un'azione di "disconnetti ovunque" o un cambio password avvenuto dopo
l'emissione del token, blocca immediatamente un client connesso con un 401. Una retrocessione di permessi si applica alla
chiamata del tool successiva. Ogni refresh esegue gli stessi controlli e rifiuta definitivamente
tale concessione. Una sessione ospite non può fornire alcun consenso.

Unico limite. La disconnessione di un client (`DELETE /api/oauth/grants/:clientId`, con la
sessione dell'utente stesso) revoca immediatamente i suoi refresh token, ma un token di accesso
già emesso continuerà a funzionare fino alla sua scadenza, entro un'ora.

Le rotte sono disponibili in [Endpoints](/docs/backend/endpoints/#mcp-surface) e le
variabili in [Configuration](/docs/getting-started/configuration/#mcp-surface).
