---
sourceHash: 3c5e837860d6c8c6
title: L'endpoint MCP remoto
sidebar_label: Endpoint MCP remoto
description: Servi MCP da un backend distribuito su /mcp, così le persone che usano la tua app possono collegare Claude o Cursor come sé stesse — OAuth con schermata di consenso, otto tool sotto tre scope, ogni chiamata sotto la propria sicurezza a livello di riga.
---

Il [server MCP](/docs/ai/mcp/) è uno strumento per sviluppatori: viene eseguito sulla tua macchina e
conserva una chiave di servizio o una chiave API. Un backend distribuito può anche servire MCP
direttamente, su `/mcp`, per le persone che usano la tua applicazione. Un assistente che una di
loro collega legge e scrive il progetto **come quella persona**, e ogni chiamata viene eseguita
sotto la sua sicurezza a livello di riga.

È disattivato finché non lo attivi, e servono entrambe le variabili:

```bash
REBASE_MCP_ENABLED=true
REBASE_PUBLIC_URL=https://app.example.com   # this deployment's real origin
```

Senza `REBASE_PUBLIC_URL`, un segreto JWT o un driver di dati in grado di limitare una query
a un solo utente, l'endpoint rifiuta di montarsi e ne spiega il motivo nel log di avvio.
Nessun `REBASE_ROLE` lo attiva.

- **OAuth, con una schermata di consenso.** Un client trova il server di autorizzazione
  tramite `/.well-known/oauth-protected-resource`, si registra da solo (la registrazione
  dinamica è attiva per impostazione predefinita; `REBASE_MCP_OPEN_REGISTRATION=false` la
  limita ai client che registri tu) e porta la persona su una schermata di consenso che la fa
  accedere tramite il tuo `/auth/login` esistente. A un account con un secondo fattore viene poi
  chiesto il codice del suo autenticatore o un codice di recupero, tramite le route
  `/auth/mfa/challenge` esistenti. La schermata consente l'accesso solo con password:
  chi ha sempre usato soltanto Google, GitHub o un link via email ne imposta prima una con
  `/auth/forgot-password` (la funzione "Password dimenticata?" della tua app), e la schermata glielo
  dice. Indica inoltre l'host a cui viene inviato il codice di autorizzazione, e precisa che
  quell'host non è verificato: chiunque può registrare un client con qualsiasi nome, quindi
  l'host è la parte che una persona può controllare.
- **Otto tool, tre scope.** Gli stessi [scope](/docs/backend/roles-and-scopes/) usati da ogni
  credenziale. `data:read` offre `list_collections`, `describe_collection`,
  `query_collection`, `count_documents` e `get_document`; `data:write` aggiunge `create_document` e
  `update_document`; `data:delete` aggiunge `delete_document`. Un client che non richiede
  nulla ottiene `data:read`. Ciascuno si restringe a una collection: `data:read:posts`
  elenca, descrive e legge `posts` e nient'altro. Uno scope decide quali tool vengono
  offerti e quali collection raggiungono, non quali righe: un elenco vuoto può essere
  l'RLS che funziona, e `data:write` non può comunque scrivere una riga che la persona non
  potrebbe scrivere.
- **I grant concessi prima della 0.24 mantengono la loro portata.** `mcp:read` viene letto come
  `data:read`, e `mcp:write` come `data:write data:delete`, sui grant memorizzati e
  sui token già emessi.
- **Funziona anche una chiave API.** `/mcp` accetta anche `Authorization: Bearer rk_…`, per
  un client configurato con un header anziché con un flusso OAuth. La chiave raggiunge
  i tool coperti dai suoi scope `data:*`, come chi la usa: una
  [chiave personale](/docs/backend/api-keys/#personal-keys) come il suo proprietario, una chiave
  di servizio come `api-key:<id>`.
- **Il vocabolario dell'SDK, le risposte di REST.** I tool accettano ciò che accetta l'SDK —
  `where` (`{"status": ["==", "paid"]}`), `orderBy` (`["created_at", "desc"]` oppure
  `"created_at:desc"`), `limit`, `offset`, `searchString` e `data` per una
  scrittura — e leggono attraverso il percorso di `GET /api/data/<collection>`, quindi una riga
  torna come la serve REST (date ISO, una `belongsTo` come la sua chiave esterna, ad es.
  `authorId`) e può essere rimandata invariata in un aggiornamento. `query_collection`
  risponde con `{ data, meta }` con `meta.total` e `meta.hasMore`, e `count_documents`
  con `{ count }`. Come su REST, vengono rifiutati un `limit` superiore a 1000, un argomento non
  dichiarato e la modifica o l'eliminazione di una riga nel cestino (404); impostare a `null`
  il campo di soft delete la ripristina. `deleted: "only"` (oppure `"include"`) su
  `query_collection` e `count_documents` legge il cestino, come fa `?deleted=` di REST, così
  una riga che `delete_document` ha mandato nel cestino può essere ritrovata per
  ripristinarla. La sua descrizione dice al modello che l'eliminazione è permanente solo dove
  la collection non ha un campo di soft delete.
- **L'elenco indica i nomi delle collection; `describe_collection` fornisce lo schema di una.**
  `list_collections` risponde con `name`, `title` e `description` di ciascuna collection,
  e `describe_collection { collection }` con gli schemi OpenAPI `row` e
  `create` di quella collection, più `softDeleteField` dove le righe finiscono nel cestino. Le
  descrizioni dei tool dicono al modello di descrivere una collection prima di scriverci. L'elenco
  di un progetto con 200 collection pesa circa 5k token, e ogni descrizione
  meno di 1k; con tutti gli schemi nell'elenco erano circa 150k.
- **Un token solo per questo endpoint.** Un access token MCP viene rifiutato da
  `/api/data`, `/api/admin` e dal WebSocket, quindi collegare un assistente non gli
  consegna una sessione.

Ogni richiesta a `/mcp` rilegge l'account della persona. Un account eliminato o disattivato,
oppure un "esci ovunque" o un cambio di password successivo all'emissione del token,
ferma subito un client collegato con un 401. Un declassamento si applica alla sua
successiva chiamata a un tool. Ogni refresh esegue gli stessi controlli e rifiuta un tale
grant in via definitiva. Una sessione ospite non può dare il consenso in alcun modo.

Un limite. Disconnettere un client (`DELETE /api/oauth/grants/:clientId`, con la
sessione della persona stessa) revoca subito i suoi refresh token, ma un access token
già emesso continua a funzionare fino alla scadenza, entro l'ora.

Le route sono in [Endpoint](/docs/backend/endpoints/#mcp-surface) e le
variabili in [Configurazione](/docs/getting-started/configuration/#mcp-surface).
