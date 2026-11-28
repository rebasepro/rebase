---
sourceHash: 3e29eee7079b7ef3
title: L'endpoint MCP remoto
sidebar_label: Endpoint MCP remoto
description: Esponi MCP da un backend distribuito su /mcp, in modo che gli utenti della tua app possano connettere Claude o Cursor a proprio nome — OAuth con schermata di consenso, diciassette tool sotto tre scope, ogni chiamata regolata dalla propria row-level security.
---

:::tip[Stai connettendo Claude ai tuoi progetti?]
Per quello c'è il [connettore Rebase](/docs/ai/rebase-connector/): un unico connettore per
tutti loro, a cui un server self-hosted si unisce con `rebase cloud connect`. Questa
pagina è destinata alle persone che **usano** la tua app.
:::

Il [server MCP](/docs/ai/mcp/) è uno strumento per sviluppatori: viene eseguito sulla tua macchina e contiene una chiave di servizio
o una chiave API. Un backend distribuito può anche esporre MCP direttamente, all'indirizzo `/mcp`, per
le persone che utilizzano la tua applicazione. L'assistente collegato da uno di loro legge e
scrive nel progetto **come quella persona**, e ogni chiamata viene eseguita con la propria
row-level security.

È disattivato a meno che non venga abilitato esplicitamente, ed entrambe le variabili sono obbligatorie:

```bash
REBASE_MCP_ENABLED=true
REBASE_PUBLIC_URL=https://app.example.com   # this deployment's real origin
```

Senza `REBASE_PUBLIC_URL`, un segreto JWT o un data driver in grado di limitare l'ambito di una query
a un singolo utente, l'endpoint rifiuta l'avvio e ne indica il motivo nel log di avvio. Nessun
`REBASE_ROLE` lo attiva.

`rebase dev` è l'unica eccezione: attiva `/mcp` per il server che
avvia, e tale server assegna il proprio indirizzo, `http://localhost:<port>`, come
URL pubblico, quindi non c'è nulla da configurare. Una riga `REBASE_MCP_ENABLED`
nella shell o in `.env` ha comunque la precedenza, incluso `false`. Il banner di sviluppo
stampa l'endpoint su una riga `MCP:` una volta avviato.

## Connettere un client

```bash
rebase mcp connect            # pick the clients to connect, from a list
rebase mcp connect --client claude-code,cursor
rebase mcp connect --print    # the URL, the command and the install links; changes nothing
rebase mcp url                # the URL alone
```

`rebase mcp connect` chiede al server dove si trova `/mcp`, leggendo il documento pubblicato
all'indirizzo `/.well-known/oauth-protected-resource/mcp`, garantendo così che l'URL sia corretto
dietro a un proxy, sotto `REBASE_PUBLIC_URL`, o su una porta di sviluppo che è cambiata. Quindi
connette ogni client selezionato:

| Client | `--client` | Cosa succede |
|---|---|---|
| Claude Code | `claude-code` | Esegue `claude mcp add --transport http <name> <url>` |
| Cursor | `cursor` | Apre il link di installazione di Cursor |
| VS Code | `vscode` | Apre il link di installazione di VS Code |
| Claude (claude.ai, desktop, mobile) | `claude` | Stampa i passaggi per Impostazioni → Connettori, con l'URL da incollare |
| ChatGPT | `chatgpt` | Stampa i passaggi per le impostazioni del suo connettore |

I client trovati già installati risultano già selezionati. Claude e ChatGPT si connettono
dai propri server, che non possono raggiungere `localhost`, quindi rispetto a un server di sviluppo
vengono indicati come richiedenti un progetto distribuito. `--client all` li seleziona tutti.
Senza un terminale, o con `--json`, e senza `--client`, il comando stampa l'output di
`--print` e non connette nulla.

Il server interrogato è quello del progetto stesso: `REBASE_BASE_URL`, altrimenti l'istanza di
`rebase dev` in esecuzione. `--cloud` interroga il progetto Rebase Cloud a cui è collegata
la directory, e `--url <server>` qualsiasi backend. Un server con `/mcp` disattivato non risponde a queste
richieste, e il comando spiega come abilitarlo.

Il server viene registrato con il nome del progetto, con il suffisso `-local` per le istanze su questa
macchina, in modo da poter connettere contemporaneamente sia un progetto locale che uno distribuito; `--name`
consente di modificarlo. Non viene mai chiamato `rebase`, che è il nome del [server MCP
per sviluppatori](/docs/ai/mcp/) nel file `.mcp.json` di un progetto, che verrebbe altrimenti
nascosto da un secondo server con lo stesso nome.

Il pannello di amministrazione offre gli stessi passaggi. Il suo drawer include un pulsante **Connect AI**
che mostra l'URL pubblicato dal server, il comando `claude mcp add`, i link
di installazione per Cursor e VS Code e, su un progetto distribuito, i passaggi per
connettere Claude e ChatGPT. Sotto di essi, elenca gli agenti che l'utente autenticato
ha collegato, ciascuno con un'opzione per disconnetterlo. Tutti gli utenti autenticati
vedono il pulsante quando `/mcp` è attivo. Quando è disattivato, è visibile solo
agli amministratori, insieme alle istruzioni su come attivarlo.

## Cosa ottiene una connessione

- **OAuth, con schermata di consenso.** Un client individua l'authorization server
  tramite `/.well-known/oauth-protected-resource`, si registra (la registrazione dinamica
  è attiva per impostazione predefinita; `REBASE_MCP_OPEN_REGISTRATION=false` la limita
  ai client registrati manualmente) e reindirizza l'utente a una schermata di consenso che effettua l'accesso
  tramite la tua route esistente `/auth/login`. A un account con un secondo fattore
  viene quindi richiesto il codice dell'autenticatore o un codice di recupero, tramite
  le route esistenti `/auth/mfa/challenge`. Se il frontend della tua app
  mantiene una sessione nello stesso browser, la schermata propone quell'account e
  "Consenti" esprime il consenso a suo nome senza richiedere la password; è così che si connette
  chi accede esclusivamente con Google, GitHub o un link email. Altrimenti, l'accesso avviene tramite
  password, e chi non ne possiede una deve prima impostarla tramite `/auth/forgot-password`
  ("Password dimenticata" della tua app); la schermata fornisce questa indicazione. Specifica inoltre l'host a cui viene inviato il codice di autorizzazione,
  segnalando che tale host non è verificato: chiunque può registrare un client con
  qualsiasi nome, pertanto l'host è l'elemento che l'utente può verificare.
- **Diciassette tool, tre scope.** Gli stessi [scope](/docs/backend/roles-and-scopes/)
  usati da qualsiasi credenziale. `data:read` offre `list_tables`, `describe_table`,
  `query_table`, `count_rows`, `aggregate_rows`, `get_row`, le tre viste `show_table`,
  `show_record` e `show_app`, `show_app_guide`, oltre ai tool sperimentali
  `list_apps` e `open_app`; `data:write` aggiunge `create_row`, `update_row` e gli
  sperimentali `save_app` e `delete_app`; `data:delete` aggiunge `delete_row`. Un client che non
  richiede nulla riceve `data:read`. Ciascuno scope può essere circoscritto a una tabella specifica: `data:read:posts`
  elenca, descrive e legge solo `posts` e nient'altro. Uno scope determina quali tool vengono
  offerti e quali tabelle possono raggiungere, non quali righe: un elenco vuoto può essere
  il risultato dell'RLS in azione, e `data:write` non può comunque scrivere una riga a cui l'utente non ha accesso.
- **Tre tool portano il tuo pannello di amministrazione direttamente all'utente.** Nei client che
  supportano il rendering di MCP Apps, come Claude, questi tool aprono le viste del pannello di amministrazione
  direttamente nella conversazione, generate a partire dai descrittori delle tabelle che il backend fornisce a questo
  utente — colonne, enum, validazioni, relazioni — insieme alle preferenze di interfaccia utente
  composte dal pannello: il file `ui-config.json` incluso nel bundle, quelle del workspace e
  quelle personali dell'utente (una chiave API non ne ha), in modo che etichette, ordine delle colonne, colonne nascoste
  ed etichette degli enum corrispondano al pannello. Le personalizzazioni del pannello
  del tuo progetto vengono mostrate dove il backend espone la sua vista MCP.
  - `show_table` accetta gli argomenti di `query_table`, più `view`
    (`table`, `list`, `cards` o `kanban`), e apre la vista della tabella: l'utente
    può cercare, filtrare, ordinare e paginare, aprire il modulo di una riga e aggiungerne di nuove.
  - `show_record` apre il modulo di una singola riga (`id`), oppure il modulo per una nuova riga che
    inizia dai `values` inseriti dal modello, affinché l'utente possa verificarli e
    salvarli personalmente.
  - `show_app` esegue un'applicazione scritta dal modello per l'attività corrente: un
    componente React (`code`) e le `tables` che legge. Importa i pacchetti
    ufficiali di Rebase, quindi lo stesso codice funziona anche nel tuo progetto:
    - `@rebasepro/app`: `useRows`, `useRow`, `useRowCount`, `useAggregate`
      e `useRowWrites` sulle righe del progetto;
    - `@rebasepro/cms`: `CollectionPanel` del pannello di amministrazione (con
      `CollectionToolbar` e i relativi elementi, e `onRowClick`, che passa
      all'app la riga selezionata così come letta da `useRows`), `RecordForm` e `FormField`,
      `RecordDetail`, `FieldValue` e `useSidePanel`, ciascuno dei quali identifica la propria
      tabella tramite percorso, con i tuoi campi, viste e azioni personalizzati;
    - `@rebasepro/ui`, l'intero kit UI, inclusi `SplitView`, riquadri KPI e
      grafici.

    Il server la compila preventivamente, quindi un errore di sintassi, un modulo non fornito
    dalla vista o un nome non esposto da `@rebasepro/cms` o
    `@rebasepro/app` genera un errore di chiamata indicando la riga corrispondente. Un errore durante l'esecuzione
    viene mostrato al suo posto e comunicato al modello con il messaggio successivo dell'utente.
    Un'app può utilizzare esclusivamente le tabelle che elenca. I suoi stili si basano sulle
    utility standard di Tailwind, compilate con la vista prima dell'arrivo di qualsiasi app:
    un valore arbitrario come `h-[560px]` non ha alcun effetto in questo contesto, pertanto per una
    dimensione esatta occorre usare `style`.

    La descrizione di `show_app` include solo l'essenziale, poiché alcuni client
    potrebbero troncare descrizioni dei tool troppo lunghe (claude.ai lo fa a circa 4.000
    caratteri). Indica al modello di chiamare prima `show_app_guide`, che
    restituisce ogni hook, componente e prop utilizzabile da un'app, accompagnati da un
    esempio pratico. `show_app_guide` viene offerto ovunque sia disponibile `show_app`.

  Ogni operazione di lettura e salvataggio nella vista è una chiamata ai tool di lettura e scrittura,
  eseguita a nome dell'utente e vincolata dalla sua RLS; pertanto un modulo offre solo ciò che è stato
  concesso dalla sua connessione: senza `data:write` è in sola lettura, e un campo
  che i suoi ruoli non possono leggere non viene incluso. Questo è il medesimo perimetro entro cui opera
  anche il codice dell'app: viene eseguito nella vista, quindi ogni chiamata effettuata corrisponde a uno di
  questi tool, come l'utente, e non può fare nulla che il modello non possa fare con gli stessi tool.
  Nel connettore hosted ogni operazione di scrittura viene inoltre pianificata e confermata dal server.
  All'interno di tale flusso, `useRowWrites` chiede conferma all'utente prima di procedere alla scrittura,
  evitando modifiche involontarie senza un click esplicito; i controlli nativi dell'amministrazione
  (il Salva di un form, un'eliminazione, la modifica di una tabella) si comportano come farebbero su una schermata `show_table`.
  Al modello viene notificato ciò che è stato modificato. Esso legge le righe restituite da ciascun tool, non i descrittori usati dalla
  vista per il rendering. Un client privo del supporto a MCP Apps, come Claude Code o Cursor, non mostra nulla
  e il modello legge le stesse righe che otterrebbe tramite `query_table`.
- **Sperimentale: app salvate nel progetto.** `save_app` conserva un'app che il
  modello ha creato con `show_app` in modo da poterla riaprire: compila il codice nello stesso modo di
  `show_app` e la memorizza insieme al suo `title`, alle `tables` e alla
  `visibility`, che può essere `personal` (il suo proprietario, valore predefinito), `roles` (chiunque
  possieda uno dei suoi `roles`) o `team` (tutti gli utenti che effettuano l'accesso). Il salvataggio per
  utenti diversi da se stessi richiede il ruolo di amministratore, poiché un'app condivisa è codice scritto da un'IA
  ed eseguito per altre persone. Solo il proprietario o un amministratore può sostituirne
  (`id`) o eliminarne una, e ogni utente può conservarne al massimo 200. `list_apps` elenca
  le app che il chiamante può aprire, `open_app` ne apre una come farebbe `show_app` e
  `delete_app` ne rimuove una. La visibilità di un'app non implica l'accesso ai relativi dati: un'app aperta
  legge e scrive attraverso i tool sopra descritti, per conto di chiunque la apra, sotto
  la sua RLS. Le app risiedono in `rebase.saved_apps`, creata dal backend
  la prima volta che un tool la utilizza e non concessa a nessun utente finale.
  Anche il pannello di amministrazione può aprire le stesse app: aggiungi `savedAppsView` da
  `@rebasepro/cms` alle tue `views`. Esegue un'app in un iframe in sandbox
  senza `allow-same-origin` e privo di una propria rete, e inoltra le chiamate ai
  tool a `POST /api/admin/apps/mcp`, gli stessi tool per la sessione del pannello di
  amministrazione, montata con le route di amministrazione indipendentemente dal fatto che
  `REBASE_MCP_ENABLED` sia impostato o meno. I nomi e le strutture dei tool potrebbero subire modifiche.
- **Le autorizzazioni create prima della versione 0.24 mantengono la loro portata.** `mcp:read` viene interpretato come
  `data:read`, e `mcp:write` come `data:write data:delete`, sia per le autorizzazioni memorizzate sia
  per i token già emessi.
- **Funziona anche una chiave API.** `/mcp` accetta anche `Authorization: Bearer rk_…`, per
  i client configurati tramite header anziché flusso OAuth. La chiave ha accesso
  ai tool coperti dai suoi scope `data:*`, agendo per conto di chi rappresenta: una
  [chiave personale](/docs/backend/api-keys/#personal-keys) come il suo proprietario, una service key
  come `api-key:<id>`.
- **Il vocabolario dell'SDK, le risposte di REST.** I tool accettano i parametri dell'SDK —
  `where` (`{"status": ["==", "paid"]}`), `orderBy` (`["created_at", "desc"]` o
  `"created_at:desc"`), `limit`, `offset`, `searchString` e `data` per la
  scrittura — e leggono attraverso il percorso `GET /api/data/<table>`, pertanto una riga viene
  restituita nel formato REST (date ISO, `belongsTo` rappresentato dalla foreign key, es.
  `authorId`) e può essere rinviata in un aggiornamento senza modifiche. `query_table`
  risponde con `{ data, meta }` con `meta.total` e `meta.hasMore`, e `count_rows`
  con `{ count }`; `tools/list` assegna a entrambi, ad `aggregate_rows` e a `get_row`
  un `outputSchema`, flessibile laddove la risposta può variare. `aggregate_rows` equivale a `GET /api/data/<table>/aggregate`:
  `select` è un elenco nella sintassi REST (`["count()", "sum(total)"]`), `groupBy`
  un elenco di campi, e restituisce `{ data }` con una riga per gruppo, oltre a
  `meta.hasMore` nelle chiamate raggruppate, i cui gruppi sono paginabili con `limit` e `offset`
  e ordinabili con `orderBy`. Su una tabella riscritta da un hook `afterRead`,
  restituisce solo `count()`, come fa REST. Come con REST, un `limit` superiore a 1000, un argomento non dichiarato e
  la modifica o eliminazione di una riga nel cestino (404) vengono rifiutati; impostare il campo di soft-delete
  su `null` ripristina la riga. `deleted: "only"` (o `"include"`) su
  `query_table`, `count_rows` e `aggregate_rows` legge il cestino, analogamente a
  `?deleted=` in REST, permettendo di ritrovare e ripristinare una riga cestinata da `delete_row`. La sua descrizione informa il modello che l'eliminazione è definitiva solo se
  la tabella non possiede un campo di soft-delete.
- **L'elenco nomina le tabelle; `describe_table` ne fornisce lo schema.**
  `list_tables` risponde con `{ tables: [{ name, description, kind? }] }` — senza etichetta —
  e `describe_table { table }` restituisce gli schemi OpenAPI della tabella
  `row` (le colonne fornite al chiamante) e `create` (quelle scrivibili), la sua `primaryKey`,
  le `relations` esposte e le regole `rls` (l'SQL grezzo viene oscurato senza `schema:read`),
  oltre a `softDeleteField` per le righe cestinabili e la configurazione di visualizzazione definita dalle preferenze UI del chiamante: `title`, e
  per ciascuna colonna `label`, `valueLabels`, `hidden`, `hiddenInForm`, `readOnly`. Le informazioni che
  una connessione può ottenere sullo schema sono determinate dallo stesso serializzatore
  usato da `GET /api/schema/tables`. Le descrizioni dei tool suggeriscono al modello di
  descrivere una tabella prima di scrivervi. L'elenco di un progetto con 200 tabelle richiede
  circa 5.000 token, e ogni descrizione
  meno di 1.000; includendo tutti gli schemi nell'elenco si arrivava a circa 150.000 token.
- **Un token valido solo per questo endpoint.** Un access token MCP viene rifiutato da
  `/api/data`, `/api/admin` e dal WebSocket, pertanto la connessione di un assistente non
  equivale alla concessione di una sessione completa.

Ogni richiesta a `/mcp` rilegge l'account dell'utente. Un account eliminato o disabilitato,
oppure un'azione di "disconnetti da tutti i dispositivi" o un cambio password avvenuto dopo l'emissione del token,
blocca immediatamente il client connesso con un errore 401. Una retrocessione di privilegi si applica alla
successiva chiamata al tool. Ogni refresh esegue le medesime verifiche e revoca definitivamente tale autorizzazione.
Una sessione ospite non può in alcun modo prestare il consenso.

Unica limitazione: la disconnessione di un client (`DELETE /api/oauth/grants/:clientId`, effettuata tramite la
sessione dell'utente) revoca immediatamente i suoi refresh token, ma un access token
già emesso continuerà a funzionare fino alla sua scadenza naturale, entro un'ora.

## Skills

L'endpoint può anche distribuire [Agent Skills](https://agentskills.io/specification)
tramite MCP: istruzioni che un assistente carica quando l'attività lo richiede, come il flusso
seguito dal tuo team per registrare un ordine o il significato di uno specifico campo. Inserisci ogni skill nella propria
cartella, con un file `SKILL.md` il cui frontmatter contiene un `name` corrispondente alla cartella
e una `description`, oltre a eventuali file collegati. Quindi indica la cartella genitore
nella configurazione del backend:

```ts
// skills/order-intake/SKILL.md, skills/order-intake/references/fields.md, …
createRebaseBackend({
    ...options, // the rest of your backend config
    mcp: { skills: "./skills" }
});
```

Il percorso è relativo alla directory di lavoro. I tool relativi ai dati rimangono
invariati e `skills` si affianca a `tools` quando un backend ne fornisce di propri.

- **Cosa vede un client.** I client basati sulla revisione del protocollo 2026-07-28 o successiva
  (Claude Code, Claude) elencano le skill e ne caricano una quando pertinente.
  Claude Code le denomina con il formato `<connector>:<skill>`. Esse vengono fornite tramite
  l'estensione skills di MCP (`io.modelcontextprotocol/skills`): `skills/list`,
  `skills/get` e `resources/read` di `skill://<name>/…`. Ciascuna skill è corredata
  da un manifesto SHA-256 dei propri file. Il client verifica ogni file rispetto a
  tale manifesto, e l'approvazione dell'utente è vincolata a esso.
- **Chi può leggerle.** Qualsiasi connessione autenticata, indipendentemente dai suoi scope.
  Non inserire in una skill nulla che non debba essere accessibile a chiunque si connetta.
- **Quando cambiano.** La cartella viene letta alla prima richiesta che la necessita,
  quindi una modifica diverrà effettiva al deploy o riavvio successivo. Un file modificato su
  disco prima di tale momento viene rifiutato e non fornito se non corrisponde più al manifesto.
- **Cosa viene escluso.** Una skill che viola una regola viene ignorata e il log di avvio
  ne spiega il motivo. Le regole: assenza di frontmatter, nome diverso da quello della cartella,
  presenza di symlink al suo interno, oppure più di 512 file o 16 MiB di dimensione. I file nascosti come
  `.gitkeep` non vengono mai distribuiti. Una skill che supera i limiti specifici di Claude Code (100 KB
  per file, 400 KB totali) viene distribuita con un avviso (warning), poiché Claude Code
  non la caricherà.

L'endpoint risponde a entrambe le generazioni del protocollo. Un client dell'era 2025 avvia la comunicazione con
`initialize`, come in precedenza. Un client con revisione 2026-07-28 non invia alcun handshake. Ogni richiesta
include la versione del protocollo e le relative capabilities in `params._meta`, oltre agli
header `MCP-Protocol-Version`, `Mcp-Method` e `Mcp-Name`, che devono coincidere
con il body. Le sue capabilities provengono da `server/discover`. Le skill sono
dichiarate esclusivamente lì.

Le route sono descritte in [Endpoint](/docs/backend/endpoints/#mcp-surface) e le
variabili in [Configurazione](/docs/getting-started/configuration/#mcp-surface).
