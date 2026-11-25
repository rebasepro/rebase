---
sourceHash: da06ce7daeaa1c32
title: L'endpoint MCP remoto
sidebar_label: Endpoint MCP remoto
description: Esponi MCP da un backend distribuito su /mcp, così che le persone che usano la tua app possano connettere Claude o Cursor come se stesse — OAuth con schermata di consenso, diciassette tool sotto tre scope, ogni chiamata sotto la propria row-level security.
---

:::tip[Stai connettendo Claude ai tuoi progetti?]
Quello è il [connettore Rebase](/docs/ai/rebase-connector/): un unico connettore per
tutti loro, e un server self-hosted vi si collega con `rebase cloud connect`. Questa
pagina è per le persone che **usano** la tua app.
:::

Il [server MCP](/docs/ai/mcp/) è uno strumento per sviluppatori: viene eseguito sulla tua macchina e contiene una chiave
di servizio o una chiave API. Un backend distribuito può anche esporre MCP stesso, su `/mcp`, per
le persone che utilizzano la tua applicazione. Un assistente collegato da una di esse legge e
scrive nel progetto **come quella persona**, e ogni chiamata viene eseguita sotto la propria
row-level security.

È disattivato a meno che non lo attivi tu, ed entrambe le variabili sono obbligatorie:

```bash
REBASE_MCP_ENABLED=true
REBASE_PUBLIC_URL=https://app.example.com   # this deployment's real origin
```

Senza `REBASE_PUBLIC_URL`, un segreto JWT o un data driver in grado di limitare l'ambito di una query
a un singolo utente, l'endpoint rifiuta di montarsi e ne indica il motivo nel log di avvio. Nessun
`REBASE_ROLE` lo attiva.

- **OAuth, con una schermata di consenso.** Un client trova il server di autorizzazione
  tramite `/.well-known/oauth-protected-resource`, si registra (la registrazione
  dinamica è attiva per impostazione predefinita; `REBASE_MCP_OPEN_REGISTRATION=false` la limita
  ai client registrati da te) e invia l'utente a una schermata di consenso che ne esegue l'accesso
  tramite il tuo `/auth/login` esistente. A un account con un secondo fattore
  viene quindi richiesto il codice dell'autenticatore o un codice di recupero, tramite le
  rotte `/auth/mfa/challenge` esistenti. Quando il frontend della tua app
  mantiene una sessione nello stesso browser, la schermata propone quell'account e
  Consenti (Allow) fornisce il consenso a suo nome senza password; è così che si connette chi effettua l'accesso solo
  con Google, GitHub o un link e-mail. Altrimenti si accede con una
  password, e chi non ne ha ne imposta prima una con `/auth/forgot-password`
  ("Password dimenticata" della tua app); la schermata lo comunica all'utente. Indica inoltre l'host a cui viene inviato il codice di autorizzazione
  e specifica che tale host non è verificato: chiunque può registrare un client con
  qualsiasi nome, quindi l'host è la parte che una persona può verificare.
- **Diciassette tool, tre scope.** Gli stessi [scope](/docs/backend/roles-and-scopes/)
  utilizzati da ogni credenziale. `data:read` offre `list_tables`, `describe_table`,
  `query_table`, `count_rows`, `aggregate_rows`, `get_row`, le tre viste,
  `show_table`, `show_record` e `show_app`, `show_app_guide`, e gli sperimentali
  `list_apps` e `open_app`; `data:write` aggiunge `create_row`, `update_row` e gli
  sperimentali `save_app` e `delete_app`; `data:delete` aggiunge `delete_row`. Un client che non
  richiede nulla ottiene `data:read`. Ciascuno scope può restringersi a una tabella: `data:read:posts`
  elenca, descrive e legge `posts` e nient'altro. Uno scope decide quali tool vengono
  offerti e quali tabelle raggiungono, non quali righe: un elenco vuoto può essere
  dovuto al funzionamento di RLS, e `data:write` non può comunque scrivere una riga che la persona non potrebbe scrivere.
- **Tre tool mostrano il tuo pannello di amministrazione alla persona.** In un client che
  esegue il rendering delle MCP App, come Claude, aprono le viste proprietarie del pannello di amministrazione
  nella conversazione, ricavate dai descrittori di tabella che il backend serve a questa
  persona — colonne, enum, convalide, relazioni — con le preferenze di interfaccia utente composte dal
  pannello: il file `ui-config.json` fornito con il bundle, quello del workspace e
  quello dell'utente stesso (una chiave API non ne ha), così etichette, ordine delle colonne, colonne
  nascoste ed etichette degli enum corrispondono al pannello. Le personalizzazioni del pannello
  del tuo progetto vengono visualizzate nel punto in cui il backend serve la sua vista MCP.
  - `show_table` accetta gli argomenti di `query_table`, più `view`
    (`table`, `list`, `cards` o `kanban`), e apre la vista della tabella:
    l'utente può cercare, filtrare, ordinare e impaginare, aprire il modulo di una riga e aggiungere righe.
  - `show_record` apre il modulo di una singola riga (`id`), o un modulo per una nuova riga che
    inizia con i `values` compilati dal modello, affinché la persona possa controllarli e
    salvarli autonomamente.
  - `show_app` esegue un'app scritta dal modello per l'attività corrente:
    un componente React (`code`) e le `tables` che legge. Importa i pacchetti
    proprietari di Rebase, quindi lo stesso codice funziona nel tuo progetto:
    - `@rebasepro/app`: `useRows`, `useRow`, `useRowCount`, `useAggregate`
      e `useRowWrites` sulle righe del progetto;
    - `@rebasepro/cms`: il `CollectionPanel` del pannello di amministrazione (con
      `CollectionToolbar` e i suoi elementi, e `onRowClick`, che passa
      all'app la riga selezionata così come viene letta da `useRows`), `RecordForm` e `FormField`,
      `RecordDetail`, `FieldValue` e `useSidePanel`, ciascuno che fa riferimento alla propria
      tabella tramite percorso, con i tuoi campi, viste e azioni personalizzati;
    - `@rebasepro/ui`, l'intero UI kit, inclusi `SplitView` e i riquadri KPI e
      grafici.

    Il server la compila prima, quindi un errore di sintassi, un modulo che la vista
    non fornisce o un nome che non esporta da `@rebasepro/cms` o
    `@rebasepro/app` costituisce l'errore della chiamata, con l'indicazione della riga. Un errore durante l'esecuzione
    viene mostrato al suo posto e comunicato al modello con il messaggio successivo
    dell'utente. Un'app può utilizzare solo le tabelle che elenca. I suoi stili sono
    le utilità standard di Tailwind, compilate con la vista prima dell'arrivo di qualsiasi
    app: un valore arbitrario come `h-[560px]` non ha alcun effetto, quindi una
    dimensione esatta deve essere impostata tramite `style`.

    La descrizione di `show_app` riporta solo l'essenziale, poiché un client
    potrebbe troncare una descrizione troppo lunga del tool (claude.ai lo fa a circa 4.000
    caratteri). Indica al modello di chiamare prima `show_app_guide`, che
    restituisce ogni hook, componente e prop che un'app può utilizzare, corredato da un
    esempio pratico. `show_app_guide` viene offerto ovunque sia disponibile `show_app`.

  Ogni lettura e salvataggio nella vista è una chiamata ai tool di lettura e scrittura,
  eseguita come l'utente sotto la sua RLS, quindi un modulo offre solo ciò che è stato
  concesso alla sua connessione: senza `data:write` è in sola lettura, e un campo
  che i suoi ruoli non possono leggere non è presente. Questo è anche il confine entro cui
  opera il codice di un'app: viene eseguito nella vista, quindi ogni chiamata effettuata corrisponde a uno di
  quei tool, per conto dell'utente, e non può fare nulla che il modello non potrebbe fare
  con gli stessi tool. Sul connettore hosted ogni scrittura è inoltre pianificata
  e confermata dal server. All'interno di ciò, `useRowWrites` chiede conferma all'utente
  prima di scrivere, in modo che un'app non scriva senza un suo clic; i
  controlli proprietari di amministrazione (il pulsante Salva di un modulo, un'eliminazione, una modifica nella tabella) si comportano come farebbero
  in una schermata `show_table`. Al modello viene comunicato ciò che è stato modificato. Legge le righe restituite da ciascun tool, non i descrittori con cui
  la vista disegna. Un client senza MCP App, come Claude Code o Cursor, non mostra nulla
  e il modello legge le stesse righe che leggerebbe da `query_table`.
- **Sperimentale: app salvate nel progetto.** `save_app` conserva un'app creata
  dal modello con `show_app` affinché possa essere riaperta: compila il codice come
  fa `show_app` e lo memorizza con il suo `title`, `tables` e
  `visibility`, che può essere `personal` (il suo proprietario, impostazione predefinita), `roles` (chiunque
  abbia uno dei suoi `roles`) o `team` (tutti gli utenti che effettuano l'accesso). Il salvataggio per
  altri oltre a se stessi richiede il ruolo admin, poiché un'app condivisa è codice scritto da un'IA
  ed eseguito per altre persone. Solo il suo proprietario o un amministratore può sostituirne
  (`id`) o eliminarne una, e una persona ne può conservare al massimo 200. `list_apps` elenca
  le app che il chiamante può aprire, `open_app` ne apre una come farebbe `show_app` e
  `delete_app` ne rimuove una. Vedere un'app non significa accedere ai suoi dati: un'app aperta
  legge e scrive tramite i tool sopra descritti, agendo come chiunque la apra, sotto
  la sua RLS. Le app risiedono in `rebase.saved_apps`, che il backend crea
  la prima volta che un tool la utilizza e non concede a nessun utente finale.
  Il pannello di amministrazione apre le stesse app: aggiungi `savedAppsView` da
  `@rebasepro/cms` alle tue `views`. Esegue un'app in un iframe sandboxato
  senza `allow-same-origin` e senza accesso di rete autonomo, e inoltra le sue
  chiamate ai tool a `POST /api/admin/apps/mcp`, gli stessi tool per la sessione del pannello
  di amministrazione, montata con le rotte admin indipendentemente dal fatto che
  `REBASE_MCP_ENABLED` sia impostato o meno. I nomi e la struttura dei tool potrebbero ancora cambiare.
- **I consensi (grant) creati prima della 0.24 mantengono la loro portata.** `mcp:read` viene interpretato come
  `data:read` e `mcp:write` come `data:write data:delete`, sia sui grant archiviati che
  sui token già emessi.
- **Funziona anche una chiave API.** `/mcp` accetta anche `Authorization: Bearer rk_…`, per
  un client configurato con un header anziché con un flusso OAuth. La chiave accede
  ai tool coperti dai suoi scope `data:*`, agendo come il soggetto che rappresenta: una
  [chiave personale](/docs/backend/api-keys/#personal-keys) come il suo proprietario, una chiave di servizio
  come `api-key:<id>`.
- **Il vocabolario dell'SDK, le risposte di REST.** I tool accettano ciò che accetta l'SDK —
  `where` (`{"status": ["==", "paid"]}`), `orderBy` (`["created_at", "desc"]` o
  `"created_at:desc"`), `limit`, `offset`, `searchString` e `data` per
  una scrittura — e leggono tramite il percorso di `GET /api/data/<table>`, quindi una riga viene
  restituita esattamente come la serve REST (date ISO, una `belongsTo` come foreign key, ad es.
  `authorId`) e può essere reinviata in un aggiornamento senza modifiche. `query_table`
  risponde con `{ data, meta }` con `meta.total` e `meta.hasMore`, e `count_rows`
  con `{ count }`; `tools/list` fornisce a entrambi, ad `aggregate_rows` e a `get_row`
  un `outputSchema`, flessibile laddove una risposta possa variare. `aggregate_rows` corrisponde a `GET /api/data/<table>/aggregate`:
  `select` è un elenco nella sintassi di REST (`["count()", "sum(total)"]`), `groupBy`
  un elenco di campi, e risponde con `{ data }` con una riga per gruppo, più
  `meta.hasMore` in una chiamata raggruppata, i cui gruppi sono impaginabili con `limit` e `offset`
  e ordinabili con `orderBy`. Su una tabella riscritta da un hook `afterRead`
  restituisce solo `count()`, come fa REST. Come in REST, un `limit` superiore a 1000, un argomento non dichiarato e la
  modifica o l'eliminazione di una riga nel cestino (404) vengono rifiutati; impostando il campo di soft-delete
  su `null` la si ripristina. `deleted: "only"` (o `"include"`) su
  `query_table`, `count_rows` e `aggregate_rows` legge il cestino, come fa `?deleted=`
  di REST, così che una riga cestinata da `delete_row` possa essere ritrovata per
  essere ripristinata. La sua descrizione comunica al modello che l'eliminazione è permanente solo laddove
  la tabella non dispone di un campo di soft-delete.
- **L'elenco nomina le tabelle; `describe_table` ne fornisce lo schema.**
  `list_tables` risponde con `{ tables: [{ name, description, kind? }] }` — nessuna etichetta —
  e `describe_table { table }` con gli schemi OpenAPI `row` (le colonne servite a questo chiamante)
  e `create` (quelle scrivibili) di quella tabella, la sua `primaryKey`, le `relations` servite e `rls` (SQL
  grezzo oscurato senza `schema:read`), oltre a `softDeleteField` laddove le righe finiscano in un
  cestino, e la presentazione definita dalle preferenze UI del chiamante: `title` e,
  per colonna, `label`, `valueLabels`, `hidden`, `hiddenInForm`, `readOnly`. Ciò che una
  connessione può apprendere sullo schema è deciso dallo stesso serializzatore
  utilizzato da `GET /api/schema/tables`. Le descrizioni dei tool dicono al modello di
  descrivere una tabella prima di scrivervi. L'elenco di un progetto con 200 tabelle richiede
  circa 5k token e ogni descrizione
  meno di 1k; includendo ogni schema nell'elenco si arrivava a circa 150k.
- **Un token valido solo per questo endpoint.** Un token di accesso MCP viene rifiutato da
  `/api/data`, `/api/admin` e dal WebSocket, quindi la connessione di un assistente non
  gli assegna una sessione.

Ogni richiesta a `/mcp` rilegge l'account dell'utente. Un account eliminato o disabilitato,
oppure una "disconnessione da tutti i dispositivi" o una modifica della password successiva all'emissione
del token, blocca immediatamente un client connesso con un errore 401. Una retrocessione di privilegi si applica alla
chiamata successiva del tool. Ogni refresh esegue gli stessi controlli e rifiuta definitivamente
tale consenso. Una sessione ospite non può fornire alcun consenso.

Unica limitazione. La disconnessione di un client (`DELETE /api/oauth/grants/:clientId`, con la
sessione propria dell'utente) revoca immediatamente i suoi refresh token, ma un token di accesso
già emesso continua a funzionare fino alla sua scadenza, entro un'ora.

## Skills

L'endpoint può anche servire [Agent Skills](https://agentskills.io/specification)
tramite MCP: istruzioni che un assistente carica quando l'attività lo richiede, come la procedura
con cui il tuo team archivia un ordine o il significato di un campo. Inserisci ogni skill nella propria
cartella, con un file `SKILL.md` il cui frontmatter abbia un `name` corrispondente alla cartella
e una `description`, oltre a qualsiasi file a cui fa riferimento. Quindi specifica la cartella genitore
nella configurazione del backend:

```ts
// skills/order-intake/SKILL.md, skills/order-intake/references/fields.md, …
createRebaseBackend({
    ...options, // the rest of your backend config
    mcp: { skills: "./skills" }
});
```

Il percorso è relativo alla directory di lavoro. I data tool rimangono invariati
e `skills` si affianca a `tools` quando un backend ne fornisce di propri.

- **Cosa vede un client.** I client con revisione del protocollo 2026-07-28 o successiva
  (Claude Code, Claude) elencano le skill e ne caricano una quando è pertinente.
  Claude Code le nomina ciascuna `<connector>:<skill>`. Queste vengono servite tramite
  l'estensione MCP skills (`io.modelcontextprotocol/skills`): `skills/list`,
  `skills/get` e `resources/read` di `skill://<name>/…`. Ogni skill è accompagnata
  da un manifest SHA-256 dei suoi file. Il client verifica ogni file rispetto
  a quel manifest e l'approvazione dell'utente è vincolata a esso.
- **Chi può leggerle.** Qualsiasi connessione autenticata, indipendentemente dai suoi scope.
  Non inserire in una skill nulla che non sia destinato a chiunque si connetta.
- **Quando cambiano.** La cartella viene letta alla prima richiesta che ne ha bisogno,
  quindi una modifica ha effetto al deploy o riavvio successivo. Un file che cambia su
  disco prima di quel momento viene rifiutato, non servito a fronte di un manifest a cui non
  corrisponde più.
- **Cosa viene escluso.** Una skill che viola una regola viene ignorata e il log di avvio
  ne indica il motivo. Le regole: assenza di frontmatter, un nome diverso da quello della cartella,
  un symlink all'interno, oppure più di 512 file o 16 MiB. I file nascosti come
  `.gitkeep` non vengono mai serviti. Una skill che supera i limiti specifici di Claude Code (100 KB
  per file, 400 KB in totale) viene servita con un avviso, poiché Claude Code non
  la caricherà.

L'endpoint supporta entrambe le generazioni del protocollo. Un client della generazione 2025 si apre con
`initialize`, come in precedenza. Un client 2026-07-28 non invia alcun handshake. Ogni richiesta
trasmette la versione del protocollo e le capabilities in `params._meta`, oltre agli
header `MCP-Protocol-Version`, `Mcp-Method` e `Mcp-Name`, che devono corrispondere
al corpo della richiesta. Le sue capabilities provengono da `server/discover`. Le skill vengono
dichiarate solo lì.

Le rotte sono disponibili in [Endpoint](/docs/backend/endpoints/#mcp-surface) e le
variabili in [Configurazione](/docs/getting-started/configuration/#mcp-surface).
