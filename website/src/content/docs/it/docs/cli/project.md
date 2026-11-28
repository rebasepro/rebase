---
sourceHash: f6e7c705c409b9aa
title: Un'app in esecuzione
sidebar_label: Un'app in esecuzione
description: Comandi CLI che operano su un'applicazione Rebase in esecuzione tramite la sua API — righe, utenti, cron, log, funzioni, file, il simulatore RLS — su rebase dev, un server specificato o un progetto Rebase Cloud.
---

Questi comandi comunicano con un'app in esecuzione tramite la sua stessa API, quindi row-level security, accesso ai campi, hook e policy di storage determinano cosa possono fare, proprio come avviene per l'SDK. Raggiungono il `rebase dev` locale, un server specificato o un progetto Rebase Cloud, con gli stessi flag ovunque.

## Scelta del server e delle credenziali

| Flag | Dove vanno le richieste e con quale identità |
|---|---|
| *(nessuno)* | `REBASE_BASE_URL` (shell, poi `.env`), altrimenti il `rebase dev` eseguito in questo checkout; con la chiave di servizio da `.env` |
| `--url <server>` | Quel server, con la chiave di servizio da `.env` |
| `--project <slug>` | Un progetto Rebase Cloud, tramite il proxy Studio della console: accedi con `rebase cloud login` e il piano di controllo allega la chiave dell'app dal suo lato, quindi nessuna chiave raggiunge la tua macchina. Proprietari e amministratori dell'organizzazione, su un progetto con accesso a Studio attivo (`rebase cloud settings set --studio on`) |
| `--cloud` | Il progetto Rebase Cloud a cui è collegata questa directory |
| `--token <bearer>` | Invia invece questo bearer: una chiave `rk_` o il token di accesso di un utente. Su un progetto Cloud viene indirizzato all'indirizzo dell'app stessa |
| `--session` | Invia la sessione utente memorizzata da `rebase auth login` per quel server |
| `--anon` | Non invia nulla: ciò che riceve un visitatore anonimo |

Niente altro viene ipotizzato: in assenza di `REBASE_BASE_URL` e di un `rebase dev` in esecuzione, un comando rifiuta l'operazione anziché inviare la chiave di servizio a qualsiasi cosa sia in ascolto su una porta. Il `rebase dev` in esecuzione è quello il cui processo è attivo, sulla porta comunicata dal relativo backend (`.rebase/dev.json`, altrimenti il file `.rebase/state.json` del backend stesso); `.rebase-dev-url` è destinato ai tuoi script, e un'esecuzione terminata in modo anomalo lo lascia orfano, quindi nessun comando lo legge. Ogni comando accetta `--json` (ed emette JSON ogni volta che stdout non è un terminale, come avviene per `rebase cloud`) e `--yes`, che risponde alla conferma richiesta da ogni operazione distruttiva; senza un terminale, rifiuta l'operazione con `confirmation_required` anziché richiedere un prompt.

`rebase api-keys`, `rebase storage orphans|move` e `rebase schema reconcile` accettano gli stessi flag.

## `rebase api`

Qualsiasi route servita dall'app, con le credenziali del progetto — la lunga serie di operazioni che non hanno un comando dedicato: l'aggiornamento di una vista materializzata, l'audit RLS, `/api/meta/contract`, una route aggiunta da un plugin.

```bash
rebase api data/posts -f status=eq.published -f limit=5   # GET /api/data/posts?status=eq.published&limit=5
rebase api POST data/posts -F title=Hello -F published=true
rebase api /api/admin/rls-audit --project acme
rebase api PATCH data/posts/42 --input change.json --include
```

Un percorso privo di uno `/` iniziale si trova sotto `/api`. `-f key=value` è un campo stringa e `-F` un campo tipizzato (`true`, `false`, `null`, numeri, JSON, `@file`); i campi costituiscono la query string di una richiesta GET, HEAD o DELETE, oppure un body JSON negli altri casi. A differenza di `gh api`, la sola presenza di un campo non trasforma mai la richiesta in un POST: un'operazione di scrittura specifica il proprio metodo o include `--input`. La risposta viene stampata così come viene ricevuta — formattata come JSON leggibile (pretty-printed) — e una risposta non-2xx viene stampata uscendo con codice 1. L'header `Authorization` viene rifiutato; sono i flag di destinazione a determinare le credenziali.

## `rebase data`

Le righe di una tabella, tramite `/api/data`. I filtri sono quelli nativi dell'API (`?status=eq.published`), inoltrati esattamente come scritti: `--where status=eq.published`, `--where price=gte.10` e un semplice `--where status=draft` per l'uguaglianza.

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
| `query <table>` | `--where`, `--or`, `--order-by col[:desc]` (ripetibile), `--limit`, `--offset`, `--fields a,b`, `--include`, `--search`, `--deleted include\|only`; `--all` scorre tutte le pagine; `--format table\|json\|ndjson\|csv` (csv e ndjson vengono trasmessi in streaming con `--all`) |
| `get <table> <id>` | Una singola riga, con `--fields` e `--include` |
| `count <table>` | Il numero di righe che corrispondono a `--where` |
| `aggregate <table>` | `--select` e `--group-by`, nativi dell'API |
| `insert <table>` | `--data <json>` o `--file <path\|->`; un array corrisponde a più righe in una singola scrittura cumulativa (bulk); `--upsert <column>` |
| `update <table> [<id>]` | Una singola riga, oppure tutte le righe che corrispondono a `--where` previa verifica del conteggio e richiesta di conferma; `--if-match <etag>` |
| `delete <table> [<id>]` | Chiede prima conferma; `--hard` per una tabella con soft-delete |
| `import <table>` | `--file` (array JSON, NDJSON o CSV in base all'estensione, oppure `--format`), a batch (`--batch`); `--upsert`, `--ignore-duplicates`. Legge ciò che `query --format json` esporta |
| `history <table> <id>`, `revert <table> <id> <historyId>` | Tabelle con la cronologia abilitata |
| `watch <table>` | Le righe corrispondenti a ogni loro modifica, tramite socket in tempo reale. Non passa attraverso il proxy Studio: su un progetto Cloud passare `--token` o `--session` |

La chiave di servizio corrisponde al ruolo `admin`: la row-level security viene comunque applicata, in base a tale ruolo. Passa `--token`, `--session` o `--anon` per visualizzare la tabella con un'altra identità.

## `rebase schema show`

Le tabelle, o le colonne, le relazioni e la row-level security di una specifica tabella — per impostazione predefinita da `backend/schema`, oppure con `--remote` (o qualsiasi flag di destinazione) così come il server in esecuzione le descrive a queste credenziali. Delle credenziali prive di `schema:read` non vedono alcuna policy, e una tabella che non possono leggere non viene elencata.

```bash
rebase schema show
rebase schema show posts --remote --project acme
```

## `rebase users`

Gli account, tramite `/api/admin/users`, `/roles` e `/guests`. Un account viene identificato dal suo UID o dalla sua email (corrispondenza esatta, mai la prima corrispondenza approssimativa).

```bash
rebase users list --search ada
rebase users create ada@example.com --role admin
rebase users import users.csv --dry-run
rebase users update bob@example.com --add-role editor
rebase users update bob@example.com --disable
rebase users reset-password bob@example.com
rebase users mfa-reset bob@example.com
rebase users roles
rebase users guests prune --older-than 30d --yes
```

`create` invia un invito via email oppure restituisce una password temporanea una tantum quando non è possibile inviare email. `--no-invite` crea l'account senza password e non invia nulla, ideale per un'app che effettua l'accesso tramite magic link, codice email o provider (`POST /api/admin/users` con `invite: false`). L'assegnazione di un ruolo, `--disable`, `delete` e `mfa-reset` richiedono prima conferma. Nessun chiamante può assegnare un ruolo superiore al proprio né agire su un account di rango superiore. `rebase auth reset-password` è la precedente sintassi e ricorre ancora al database quando il server non è in esecuzione.

### Importazione degli account

`import` importa gli account da un altro sistema mantenendo i loro ID, in modo che le righe che fanno riferimento a un utente puntino ancora allo stesso. Accetta un file CSV, un array JSON o NDJSON (`--format`, altrimenti in base all'estensione), con le seguenti colonne:

| Colonna | |
|---|---|
| `id` | Mantenuto come ID dell'account. Opzionale: in sua assenza, la tabella utenti ne genera uno. Un UUID è il caso comune; sono ammessi anche lettere, cifre e `_ - . : \|` fino a 128 caratteri, sebbene una colonna ID di tipo `uuid` accetti solo UUID |
| `email` | Obbligatorio |
| `display_name` / `displayName` | |
| `photo_url` / `photoUrl` | |
| `created_at` / `createdAt` | Quando l'account è stato creato in origine. Opzionale: data e ora correnti |
| `email_verified` / `emailVerified` | `true`/`t`/`1` o `false`/`f`/`0`. Opzionale: `false`, e il primo magic link o reset seguito dall'account lo confermerà |
| `roles` | `editor;viewer`, tra virgolette `"editor,viewer"`, o un array Postgres `{editor,viewer}` |
| `password_hash` / `encrypted_password` | L'hash memorizzato dall'altro sistema. Letto solo con `--password-hashes bcrypt`; senza questo flag un file contenente questa colonna viene rifiutato prima dell'invio di qualsiasi dato |

Nessuna email viene inviata. Con `--password-hashes bcrypt`, un account la cui riga contiene un hash effettua l'accesso con la password preesistente, e al suo primo accesso l'hash viene sostituito con quello nativo di Rebase. Qualsiasi altro account importato accede tramite magic link, codice email, provider o reimpostazione della password. Le password in chiaro non vengono mai importate. Un account il cui ID o la cui email risultano già occupati viene segnalato come ignorato e lasciato invariato, mai aggiornato, consentendo di rieseguire lo stesso file. Ogni account viene riportato come creato, ignorato o fallito con la relativa motivazione; il comando esce con codice 1 in caso di fallimenti. `--dry-run` verifica ogni account senza scrivere nulla. La CLI invia 100 account per richiesta (`POST /api/admin/users/import`), indifferentemente su `rebase dev`, su un server o su un progetto Rebase Cloud.

Da Supabase:

```bash
SUPABASE_DB_URL="postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres"
psql "$SUPABASE_DB_URL" -c "\copy (select id, email, created_at, email_confirmed_at is not null as email_verified, encrypted_password from auth.users) to users.csv csv header"
rebase users import users.csv --password-hashes bcrypt --dry-run
rebase users import users.csv --password-hashes bcrypt --project my-app
```

`users.csv` contiene quindi l'hash della password di ciascun account: eliminalo al termine dell'importazione.

## `rebase cron`

I job pianificati dell'app (`backend/crons/*`).

```bash
rebase cron list
rebase cron logs nightly-backup -n 5
rebase cron run cleanup-sessions --yes
rebase cron disable nightly-backup --yes
rebase cron reset nightly-backup          # the job's code decides again
```

`enable` e `disable` sovrascrivono il codice del job su ogni processo, anche tra vari redeploy; `run` chiede prima conferma e `--async` risponde non appena l'esecuzione è avviata. Su un progetto Cloud, `rebase cron` non richiede l'accesso a Studio per le operazioni di lettura: richiede al piano di controllo un token di piattaforma `cron:read` a breve durata, di cui dispone qualsiasi membro con accesso ai log. `run`, `enable`, `disable` e `reset` richiedono `cron:write`, posseduto da un proprietario o amministratore dell'organizzazione su un progetto con Studio attivo. `rebase cloud cron` è la precedente sintassi di sola lettura.

## `rebase logs`

Il log delle richieste e dell'applicazione del server — il buffer letto dalla vista Logs di Studio — una tantum o seguito in tempo reale con `-f`.

```bash
rebase logs -n 50 --level warn
rebase logs -f --source auth --search "sign-in"
```

Il buffer appartiene a un singolo processo. Con `--project` o `--cloud` corrisponde a `rebase cloud logs --runtime`: l'output di ogni replica, veicolato tramite il piano di controllo.

## `rebase functions`

Le route personalizzate dell'app, una per file in `backend/functions/`.

```bash
rebase functions list
rebase functions invoke hello --anon
rebase functions invoke billing webhook -X POST --input event.json
```

`invoke` accetta i campi, il body e gli header accettati da `rebase api`, e stampa la risposta così come viene ricevuta. Le funzioni definiscono autonomamente le proprie regole di accesso, quindi le credenziali sono rilevanti: `--anon` mostra ciò che riceve un visitatore anonimo.

## `rebase storage`

I file archiviati, tramite le policy di storage. Il lato storage inizia con i due punti: `:avatars/me.png` nella sorgente predefinita, `media:avatars/me.png` nella sorgente identificata dalla chiave `media`.

```bash
rebase storage ls :avatars
rebase storage cp ./me.png :avatars/me.png
rebase storage cp :avatars/me.png ./me.png
rebase storage url :avatars/me.png      # a signed link: whoever holds it reads the file until it expires
rebase storage stat :avatars/me.png
rebase storage rm :avatars/me.png --yes
```

`cp --public` effettua l'upload sotto il prefisso pubblico (un URL permanente senza token), `--content-type` ne imposta il tipo e `--force` sovrascrive un file locale durante il download. `orphans` e `move` costituiscono la parte del gruppo dedicata alla manutenzione dell'intero storage.

## `rebase rls simulate`

Ciò che vedrebbe un'altra identità, tramite il simulatore RLS dell'app — lo stesso utilizzato dalla funzione "view as" di Studio: tabella per tabella, le righe che legge rispetto a quelle lette dall'utente corrente, le tabelle da cui i suoi scope la escludono e le colonne che non può leggere. Di sola lettura.

```bash
rebase auth login --email you@example.com
rebase rls simulate --role anon
rebase rls simulate --user 3f0c9a7e-… --table posts
rebase rls simulate --key <api-key-id>
rebase rls options
```

Il simulatore risponde esclusivamente alla sessione di un amministratore e mai a una chiave, pertanto invia la sessione memorizzata da `rebase auth login`. `rebase verify --live` verifica le policy stesse, a prescindere da una specifica identità.

## `rebase auth login`, `emails` e `keys`

Alcune route rispondono a una persona e mai a una macchina: il simulatore RLS, le chiavi personali, l'applicazione live dello schema. `rebase auth login` effettua l'accesso a un'app in esecuzione — tramite browser quando il server offre l'accesso via dispositivo, altrimenti con `--email` e password (`--code` per l'autenticazione a due fattori) — e memorizza la sessione in `~/.rebase/sessions.json`, suddivisa per server, mai all'interno del progetto. `auth whoami` mostra l'identità con cui il server ti riconosce e gli scope che possiedi; `auth logout` termina la sessione anche sul server.

```bash
rebase auth login --email you@example.com
rebase auth whoami --session
rebase auth emails --latest --links      # the dev mailbox: sign-in, reset and magic-link mail with no SMTP_HOST
rebase auth keys create --name ci --scopes data:read:posts --expires-in 30
rebase auth keys revoke <id> --yes
```

`auth emails` legge la casella di posta di sviluppo che un server privo di `SMTP_HOST` mantiene anziché inviare le email; `--clear` la svuota. A una casella di posta vuota viene risposto indicando il server interrogato (`The development mailbox at http://localhost:3082 (rebase dev) is empty.`, e `server` nel JSON), poiché una risposta vuota da un altro backend risulterebbe identica a un messaggio mai inviato. `auth keys` gestisce le tue chiavi `rk_`, che agiscono a tuo nome, limitate agli scope specificati; il server risponde solo quando la tabella auth imposta `auth.personalKeys: true`. Le chiavi di servizio sono gestite tramite `rebase api-keys`, a cui è stato aggiunto anche `update <id>`.

## `rebase mcp`

Connetti un client AI all'endpoint MCP nativo dell'app in esecuzione (`/mcp`), dove un
agent effettua l'accesso come persona ed è vincolato alla row-level security di tale persona:

```bash
rebase mcp connect                        # pick the clients from a list
rebase mcp connect --client claude-code   # or name them: claude-code, cursor, vscode, claude, chatgpt, all
rebase mcp connect --print                # print every way to connect, change nothing
rebase mcp url                            # the endpoint's URL
```

| Flag | Descrizione |
|------|-------------|
| `--client <names>` | Salta il selettore. Separati da virgola, oppure `all` |
| `--name <name>` | Il nome con cui registrare il server. Predefinito: il nome del progetto, con `-local` per un server di sviluppo |
| `--print` | Stampa l'URL, il comando Claude Code e i link di installazione, senza modificare nulla |
| `--url <server>` | Il backend a questo indirizzo. Predefinito: `REBASE_BASE_URL`, altrimenti il `rebase dev` in esecuzione |
| `--cloud` | Il progetto Rebase Cloud a cui è collegata questa directory |
| `--json` | Output leggibile da macchina |

`rebase mcp url` accetta `--url`, `--cloud` e `--json`. Il comportamento di ciascun client
con l'URL è descritto in [Connecting a client](/docs/ai/remote-mcp/#connecting-a-client).
Non si tratta del server MCP di sviluppo presente in `.mcp.json`, configurato
da `rebase skills install --mcp`.

## Passaggi successivi

- [Indice degli endpoint](/docs/backend/endpoints/) — ogni route raggiunta da questi comandi e lo scope richiesto da ciascuna
- [API REST](/docs/backend/api/) — la sintassi di filtro, ordinamento e paginazione inoltrata da `rebase data`
- [rebase cloud](/docs/cli/cloud/) — il progetto stesso su Rebase Cloud: distribuzioni (deploy), variabili d'ambiente, backup, accesso a Studio
- [Riferimento CLI](/docs/cli/) — tutti gli altri comandi
