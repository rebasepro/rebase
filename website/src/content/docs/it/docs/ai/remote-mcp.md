---
sourceHash: 929d8e7ae10aab87
title: L'endpoint MCP remoto
sidebar_label: Endpoint MCP remoto
description: Esegui MCP da un backend distribuito su /mcp, in modo che le persone che usano la tua app possano connettere Claude o Cursor a proprio nome — OAuth con una schermata di consenso, nove tool sotto tre scope, ogni chiamata protetta dalla propria row-level security.
---

:::tip[Vuoi connettere Claude ai tuoi progetti?]
Per farlo c'è il [connettore Rebase](/docs/ai/rebase-connector/): un unico connettore per
tutti, e un server self-hosted vi si collega con `rebase cloud connect`. Questa
pagina è destinata alle persone che **usano** la tua app.
:::

Il [server MCP](/docs/ai/mcp/) è uno strumento per sviluppatori: viene eseguito sulla tua macchina e gestisce una chiave
di servizio o una chiave API. Un backend distribuito può anche erogare MCP direttamente, su `/mcp`, per
le persone che usano la tua applicazione. Un assistente collegato da una di esse legge e
scrive nel progetto **a nome di quella persona**, e ogni chiamata viene eseguita sotto la sua
specifica row-level security.

È disattivato a meno che non venga abilitato esplicitamente, ed entrambe le variabili sono obbligatorie:

```bash
REBASE_MCP_ENABLED=true
REBASE_PUBLIC_URL=https://app.example.com   # this deployment's real origin
```

Senza `REBASE_PUBLIC_URL`, un segreto JWT o un driver dati in grado di limitare l'ambito di una query
a un singolo utente, l'endpoint rifiuta di avviarsi e ne spiega il motivo nel log di avvio. Nessun
`REBASE_ROLE` lo attiva.

- **OAuth, con una schermata di consenso.** Un client individua l'authorization server
  tramite `/.well-known/oauth-protected-resource`, si registra autonomamente (la
  registrazione dinamica è attiva per impostazione predefinita; `REBASE_MCP_OPEN_REGISTRATION=false` la limita
  ai client registrati da te) e reindirizza la persona a una schermata di consenso che ne
  esegue l'accesso tramite il tuo `/auth/login` esistente. A un account con un secondo fattore
  viene quindi richiesto il codice dell'autenticatore o un codice di recupero, attraverso le
  route `/auth/mfa/challenge` esistenti. Quando il frontend della tua app mantiene una sessione
  nello stesso browser, la schermata propone quell'account e l'opzione Consenti autorizza a suo nome
  senza password; è così che si connette chi accede esclusivamente con Google, GitHub o tramite link via email.
  In caso contrario, l'accesso avviene tramite password, e chi non ne possiede una la imposta prima con `/auth/forgot-password`
  (la funzione "Password dimenticata" della tua app); la schermata lo segnala chiaramente. Indica inoltre l'host a cui viene inviato il codice di autorizzazione,
  specificando che tale host non è verificato: chiunque può registrare un client con qualsiasi nome,
  pertanto l'host è la parte che una persona può verificare.
- **Nove tool, tre scope.** Gli stessi [scope](/docs/backend/roles-and-scopes/)
  utilizzati da ogni credenziale. `data:read` offre `list_collections`, `describe_collection`,
  `query_collection`, `show_collection`, `count_documents` e `get_document`; `data:write` aggiunge `create_document` e
  `update_document`; `data:delete` aggiunge `delete_document`. Un client che non richiede alcuno
  scope riceve `data:read`. Ciascuno di essi può essere ristretto a una specifica collezione: `data:read:posts`
  elenca, descrive e legge `posts` e nient'altro. Uno scope stabilisce quali tool vengono
  offerti e a quali collezioni possono accedere, non quali righe: un elenco vuoto può essere
  il normale effetto dell'RLS, e `data:write` non potrà comunque scrivere una riga a cui la persona non ha accesso.
- **`show_collection` mostra le righe direttamente alla persona.** Accetta gli stessi
  argomenti di `query_collection` e restituisce la medesima pagina, oltre alle colonne mostrate dal
  pannello di amministrazione. Un client in grado di visualizzare le MCP App, come Claude, la apre sotto forma di
  tabella all'interno della conversazione: la persona può caricare ulteriori righe e, se la
  connessione dispone dello scope `data:write`, modificare una cella direttamente sul posto. Ogni salvataggio è una
  chiamata a `update_document` eseguita a suo nome, sotto la sua RLS, e il modello viene informato su cosa
  è stato modificato. Un client privo del supporto per le MCP App, come Claude Code o Cursor, non mostra alcuna
  tabella, e il modello legge la pagina esattamente come farebbe con `query_collection`.
- **Le autorizzazioni concesse prima della 0.24 mantengono la loro portata.** `mcp:read` viene interpretato come
  `data:read`, e `mcp:write` come `data:write data:delete`, sia sulle autorizzazioni memorizzate sia
  sui token già emessi.
- **Funziona anche con una chiave API.** `/mcp` accetta anche l'header `Authorization: Bearer rk_…`, per
  i client configurati tramite header anziché con un flusso OAuth. La chiave ha accesso
  ai tool coperti dai suoi scope `data:*`, agendo per conto di chi rappresenta: una
  [chiave personale](/docs/backend/api-keys/#personal-keys) come il suo proprietario, una chiave di servizio
  come `api-key:<id>`.
- **Il vocabolario dell'SDK, le risposte di REST.** I tool accettano gli stessi parametri dell'SDK —
  `where` (`{"status": ["==", "paid"]}`), `orderBy` (`["created_at", "desc"]` o
  `"created_at:desc"`), `limit`, `offset`, `searchString`, e `data` per una
  scrittura — e leggono attraverso il percorso di `GET /api/data/<collection>`, in modo che una riga venga
  restituita esattamente come farebbe REST (date ISO, un `belongsTo` come la sua chiave esterna, es.
  `authorId`) e possa essere reinviata in un aggiornamento senza modifiche. `query_collection`
  risponde con `{ data, meta }` con `meta.total` e `meta.hasMore`, e `count_documents` con
  `{ count }`. Come in REST, un `limit` superiore a 1000, un argomento non dichiarato e una
  modifica o eliminazione di una riga nel cestino (404) vengono rifiutati; impostando il campo di soft-delete
  su `null` la si ripristina. `deleted: "only"` (o `"include"`) su
  `query_collection` e `count_documents` legge il cestino, proprio come fa `?deleted=`
  in REST, consentendo di ritrovare per il ripristino una riga spostata nel cestino da `delete_document`. La sua descrizione segnala al modello che l'eliminazione è definitiva solo nei casi
  in cui la collezione non preveda un campo di soft-delete.
- **L'elenco nomina le collezioni; `describe_collection` ne fornisce lo schema.**
  `list_collections` restituisce `name`, `title` e `description` di ciascuna collezione,
  mentre `describe_collection { collection }` restituisce gli schemi OpenAPI `row` e
  `create` di quella collezione, oltre a `softDeleteField` se le righe vengono spostate nel cestino. Le descrizioni
  dei tool indicano al modello di descrivere una collezione prima di scrivervi. L'elenco di un
  progetto con 200 collezioni occupa circa 5k token, e ogni descrizione
  meno di 1k; includendo ogni schema direttamente nell'elenco si arrivava a circa 150k.
- **Un token esclusivo per questo endpoint.** Un token di accesso MCP viene rifiutato da
  `/api/data`, `/api/admin` e dal WebSocket, pertanto la connessione di un assistente non gli
  assegna una sessione.

Ogni richiesta verso `/mcp` rilegge l'account della persona. Un account eliminato o disabilitato,
oppure una richiesta di "disconnetti ovunque" o la modifica della password dopo l'emissione del token,
blocca immediatamente il client connesso con un errore 401. Un declassamento dei permessi si applica alla
successiva chiamata a un tool. Ogni operazione di refresh esegue le medesime verifiche e rifiuta
definitivamente tale autorizzazione. Una sessione ospite non può concedere alcun consenso.

Un'unica limitazione. La disconnessione di un client (`DELETE /api/oauth/grants/:clientId`, con la
sessione della persona stessa) revoca immediatamente i suoi refresh token, ma un access token
già emesso continua a funzionare fino alla sua scadenza, entro un'ora.

Le route sono disponibili in [Endpoint](/docs/backend/endpoints/#mcp-surface) e le
variabili in [Configurazione](/docs/getting-started/configuration/#mcp-surface).
