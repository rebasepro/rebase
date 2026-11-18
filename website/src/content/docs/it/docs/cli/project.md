---
sourceHash: 6cce3d2ac14320cc
title: Un'applicazione in esecuzione
sidebar_label: Un'applicazione in esecuzione
description: Comandi CLI che interagiscono con un'applicazione Rebase in esecuzione tramite la sua API — righe, utenti, cron, log, funzioni, file, il simulatore RLS — su rebase dev, un server specificato o un progetto Rebase Cloud.
---

Questi comandi comunicano con un'applicazione in esecuzione tramite la sua stessa API, quindi la row-level security, l'accesso ai campi, gli hook e le policy di archiviazione stabiliscono cosa possono fare, proprio come avviene per l'SDK. Raggiungono l'istanza locale di `rebase dev`, un server specificato o un progetto Rebase Cloud, con gli stessi flag ovunque.

## Scegliere il server e le credenziali

| Flag | Dove vanno le richieste e con quale identità |
|---|---|
| *(nessuno)* | `REBASE_BASE_URL` (shell, poi `.env`), altrimenti l'istanza `rebase dev` eseguita da questo checkout; con la service key di `.env` |
| `--url <server>` | Quel server, con la service key da `.env` |
| `--project <slug>` | Un progetto Rebase Cloud, tramite il proxy Studio della console: accedi con `rebase cloud login`, e il control plane allega la chiave dell'applicazione dal suo lato, quindi nessuna chiave raggiunge la tua macchina. Riservato a proprietari e admin dell'organizzazione, su un progetto con accesso a Studio abilitato (`rebase cloud settings set --studio on`) |
| `--cloud` | Il progetto Rebase Cloud a cui è collegata questa directory |
| `--token <bearer>` | Invia invece questo bearer: una chiave `rk_`, o un token di accesso utente. Su un progetto Cloud punta direttamente all'indirizzo dell'applicazione |
| `--session` | Invia la sessione utente che `rebase auth login` ha memorizzato per quel server |
| `--anon` | Non invia nulla: ciò che ottiene un visitatore anonimo |

Non viene fatto nessun altro presupposto: in assenza di `REBASE_BASE_URL` e senza un'istanza di `rebase dev` in esecuzione, il comando rifiuta l'esecuzione anziché inviare la service key a qualsiasi cosa sia in ascolto su una porta. Ogni comando accetta `--json` (e produce output JSON ogni volta che stdout non è un terminale, esattamente come `rebase cloud`) e `--yes`, che risponde alla conferma richiesta da ogni comando distruttivo; in assenza di un terminale rifiuta l'operazione con `confirmation_required` invece di richiedere l'input.

`rebase api-keys`, `rebase storage orphans|move` e `rebase schema reconcile` accettano gli stessi flag.

## `rebase api`

Qualsiasi route servita dall'applicazione, con le credenziali del progetto — la coda lunga di operazioni che non hanno un comando dedicato: l'aggiornamento di una vista materializzata, l'audit RLS, `/api/meta/contract`, una route aggiunta da un plugin.

```bash
rebase api data/posts -f status=eq.published -f limit=5   # GET /api/data/posts?status=eq.published&limit=5
rebase api POST data/posts -F title=Hello -F published=true
rebase api /api/admin/rls-audit --project acme
rebase api PATCH data/posts/42 --input change.json --include
```

Un percorso senza uno `/` iniziale si trova sotto `/api`. `-f key=value` rappresenta un campo stringa e `-F` un campo tipizzato (`true`, `false`, `null`, numeri, JSON, `@file`); i campi costituiscono la query string per una richiesta GET, HEAD o DELETE, oppure un body JSON negli altri casi. A differenza di `gh api`, un campo da solo non trasforma mai la richiesta in una POST: un'operazione di scrittura deve specificare il proprio metodo o includere `--input`. La risposta viene stampata così come ricevuta — JSON formattato — e una risposta non-2xx viene stampata uscendo con codice di errore 1. L'header `Authorization` viene rifiutato; i flag di destinazione selezionano le credenziali.

## `rebase data`

Le righe di una tabella, tramite `/api/data`. I filtri sono quelli nativi dell'API (`?status=eq.published`), inoltrati così come scritti: `--where status=eq.published`, `--where price=gte.10`, e un semplice `--where status=draft` per verificare l'uguaglianza.

```bash
rebase data query posts --where status=eq.published --order-by created_at:desc -n 10
rebase data query orders --all --format csv > orders.csv
rebase data get posts 42 --include author
rebase data count posts --where status=eq.draft
rebase data aggregate orders --select "count(),sum(total)" --group-by status
rebase data insert posts --data '{"title":"Hello"}'
rebase data update posts 42 --data '{"title":"Renamed"}'
rebase data delete posts --where status=eq.draft --yes
rebase data import posts --file seed.csv --upsert slug
rebase data history posts 42 && rebase data revert posts 42 <historyId>
rebase data watch posts --where status=eq.published
```

| Azione | Note |
|---|---|
| `query <table>` | `--where`, `--or`, `--order-by col[:desc]` (ripetibile), `--limit`, `--offset`, `--fields a,b`, `--include`, `--search`, `--deleted include\|only`; `--all` scorre ogni pagina; `--format table\|json\|ndjson\|csv` (csv e ndjson usano lo streaming con `--all`) |
| `get <table> <id>` | Una singola riga, con `--fields` e `--include` |
| `count <table>` | Le righe che soddisfano il criterio `--where` |
| `aggregate <table>` | `--select` e `--group-by`, nativi dell'API |
| `insert <table>` | `--data <json>` o `--file <path\|->`; un array corrisponde a più righe in una singola scrittura batch; `--upsert <column>` |
| `update <table> [<id>]` | Una riga, oppure ogni riga corrispondente a `--where` dopo un conteggio e una conferma; `--if-match <etag>` |
| `delete <table> [<id>]` | Richiede prima conferma; `--hard` su una tabella con soft-delete |
| `import <table>` | `--file` (array JSON, NDJSON o CSV in base all'estensione, oppure `--format`), a blocchi (`--batch`); `--upsert`, `--ignore-duplicates`. È in grado di rileggere ciò che viene generato da `query --format json` |
| `history <table> <id>`, `revert <table> <id> <historyId>` | Tabelle con la cronologia abilitata |
| `watch <table>` | Le righe corrispondenti a ogni loro modifica, tramite socket realtime. Non supportato tramite il proxy Studio: su un progetto Cloud passare `--token` o `--session` |

La service key assume il ruolo `admin`: la row-level security rimane comunque attiva per quel ruolo. Passa `--token`, `--session` o `--anon` per visualizzare la tabella con l'identità di un altro utente.

## `rebase schema show`

Le tabelle, o le colonne, le relazioni e la row-level security di una tabella specifica — da `backend/schema` per impostazione predefinita, o con `--remote` (o qualsiasi flag di destinazione) secondo come il server in esecuzione le descrive per queste credenziali. Delle credenziali senza il permesso `schema:read` non vedono alcuna policy, e una tabella che non possono leggere non viene elencata.

```bash
rebase schema show
rebase schema show posts --remote --project acme
```

## `rebase users`

Gli account, tramite `/api/admin/users`, `/roles` e `/guests`. Un account viene specificato tramite il suo uid o la sua email (una corrispondenza esatta, mai il primo risultato parziale).

```bash
rebase users list --search ada
rebase users create ada@example.com --role admin
rebase users update bob@example.com --add-role editor
rebase users update bob@example.com --disable
rebase users reset-password bob@example.com
rebase users mfa-reset bob@example.com
rebase users roles
rebase users guests prune --older-than 30d --yes
```

`create` invia un invito via email, oppure restituisce una password temporanea una sola volta quando non è possibile spedire email. `--no-invite` crea l'account senza password e non invia nulla, per un'applicazione il cui accesso avviene tramite magic link, codice email o provider esterno (`POST /api/admin/users` con `invite: false`). L'assegnazione di un ruolo, `--disable`, `delete` e `mfa-reset` richiedono prima conferma. Nessun chiamante può assegnare un ruolo superiore al proprio, né intervenire su un account di grado superiore. `rebase auth reset-password` è la variante di sintassi precedente, e ricorre comunque al database quando il server non è in esecuzione.

## `rebase cron`

I processi pianificati dell'applicazione (`backend/crons/*`).

```bash
rebase cron list
rebase cron logs nightly-backup -n 5
rebase cron run cleanup-sessions --yes
rebase cron disable nightly-backup --yes
rebase cron reset nightly-backup          # la logica del codice del job torna ad avere la precedenza
```

`enable` e `disable` sovrascrivono il codice del job su ogni processo, attraverso i vari redeploy; `run` richiede prima una conferma, e `--async` risponde non appena l'esecuzione è stata avviata. Su un progetto Cloud, `rebase cron` non richiede l'accesso a Studio per le letture: richiede al control plane un token di piattaforma `cron:read` temporaneo, posseduto da qualsiasi membro con accesso ai log. `run`, `enable`, `disable` e `reset` richiedono `cron:write`, posseduto da un proprietario o admin dell'organizzazione su un progetto con Studio abilitato. `rebase cloud cron` è la variante precedente, di sola lettura.

## `rebase logs`

I log delle richieste e dell'applicazione del server — il buffer letto dal Logs Explorer di Studio — una tantum, o seguiti in tempo reale con `-f`.

```bash
rebase logs -n 50 --level warn
rebase logs -f --source auth --search "sign-in"
```

Il buffer appartiene a un singolo processo. Con `--project` o `--cloud` questo equivale a `rebase cloud logs --runtime`: l'output di ogni replica, attraverso il control plane.

## `rebase functions`

Le route proprie dell'applicazione, una per ciascun file in `backend/functions/`.

```bash
rebase functions list
rebase functions invoke hello --anon
rebase functions invoke billing webhook -X POST --input event.json
```

`invoke` accetta i campi, il body e gli header accettati da `rebase api`, e stampa la risposta così come ricevuta. Le funzioni definiscono autonomamente i propri permessi di accesso, quindi le credenziali contano: `--anon` mostra ciò che riceve un visitatore non autenticato.

## `rebase storage`

I file archiviati, soggetti alle policy di archiviazione. Il percorso archiviato inizia con due punti: `:avatars/me.png` nella sorgente predefinita, `media:avatars/me.png` nella sorgente identificata da `media`.

```bash
rebase storage ls :avatars
rebase storage cp ./me.png :avatars/me.png
rebase storage cp :avatars/me.png ./me.png
rebase storage url :avatars/me.png      # un link firmato: chiunque lo possieda legge il file fino alla scadenza
rebase storage stat :avatars/me.png
rebase storage rm :avatars/me.png --yes
```

`cp --public` carica sotto il prefisso pubblico (un URL permanente, senza token), `--content-type` imposta il tipo di file, e `--force` sovrascrive un file locale durante il download. `orphans` e `move` costituiscono la parte del gruppo dedicata alla manutenzione dell'intero storage.

## `rebase rls simulate`

Cosa vedrebbe un'altra identità, tramite il simulatore RLS dell'applicazione — lo stesso utilizzato dalla funzionalità "view as" di Studio: per ogni tabella, le righe lette da quell'identità rispetto a quelle lette da te, le tabelle da cui i suoi scope la escludono e le colonne che non può leggere. Di sola lettura.

```bash
rebase auth login --email you@example.com
rebase rls simulate --role anon
rebase rls simulate --user 3f0c9a7e-… --table posts
rebase rls simulate --key <api-key-id>
rebase rls options
```

Il simulatore risponde alla sessione diretta di un amministratore e mai a una chiave, quindi questo comando invia la sessione memorizzata da `rebase auth login`. `rebase verify --live` controlla le policy stesse, indipendentemente da un'identità specifica.

## `rebase auth login`, `emails` e `keys`

Alcune route rispondono a una persona e mai a una macchina: il simulatore RLS, le chiavi personali, l'applicazione dello schema in tempo reale. `rebase auth login` esegue l'accesso a un'applicazione in esecuzione — tramite browser quando il server supporta l'accesso dispositivo, altrimenti con `--email` e una password (`--code` per l'autenticazione a due fattori) — e salva la sessione in `~/.rebase/sessions.json`, separata per server, mai all'interno del progetto. `auth whoami` indica per chi viene riconosciuta la sessione dal server e gli scope posseduti; `auth logout` termina la sessione anche su di esso.

```bash
rebase auth login --email you@example.com
rebase auth whoami --session
rebase auth emails --latest --links      # la casella di posta di dev: email di accesso, reset e magic link senza SMTP_HOST
rebase auth keys create --name ci --scopes data:read:posts --expires-in 30
rebase auth keys revoke <id> --yes
```

`auth emails` legge la casella di posta di sviluppo che un server privo di `SMTP_HOST` mantiene anziché inviare messaggi reali; `--clear` la svuota. `auth keys` gestisce le tue chiavi `rk_` personali, che agiscono a tuo nome, limitate agli scope specificati; il server risponde solo quando la tabella auth imposta `auth.personalKeys: true`. Le service key sono gestite tramite `rebase api-keys`, a cui è stato aggiunto anche `update <id>`.

## Passaggi successivi

- [Indice degli endpoint](/docs/backend/endpoints/) — ogni route raggiunta da questi comandi e lo scope richiesto da ciascuna
- [API REST](/docs/backend/api/) — la sintassi di filtro, ordinamento e paginazione inoltrata da `rebase data`
- [rebase cloud](/docs/cli/cloud/) — il progetto vero e proprio su Rebase Cloud: deploy, variabili di ambiente, backup, accesso a Studio
- [Riferimento CLI](/docs/cli/) — tutti gli altri comandi
