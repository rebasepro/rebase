---
sourceHash: 8d5e791f9d3e039e
title: Un'app in esecuzione
sidebar_label: Un'app in esecuzione
description: Comandi CLI che operano su un'app Rebase in esecuzione tramite la sua API — righe, utenti, cron, log, funzioni, file, il simulatore RLS — su rebase dev, un server specificato o un progetto Rebase Cloud.
---

Questi comandi comunicano con un'app in esecuzione tramite la sua stessa API, quindi la row-level security, l'accesso ai campi, gli hook e le policy di storage determinano cosa possono fare, proprio come per l'SDK. Raggiungono l'istanza locale `rebase dev`, un server specificato o un progetto Rebase Cloud, con gli stessi flag ovunque.

## Scegliere il server e la credenziale

| Flag | Dove vanno le richieste e con quale identità |
|---|---|
| *(nessuno)* | `REBASE_BASE_URL` (shell, poi `.env`), altrimenti l'istanza `rebase dev` in esecuzione per questo checkout; con la service key da `.env` |
| `--url <server>` | Quel server, con la service key da `.env` |
| `--project <slug>` | Un progetto Rebase Cloud, tramite il proxy Studio della console: si effettua l'accesso con `rebase cloud login`, e il control plane allega la chiave dell'app dal proprio lato, quindi nessuna chiave raggiunge la tua macchina. Proprietari e amministratori dell'organizzazione, su un progetto con accesso a Studio abilitato (`rebase cloud settings set --studio on`) |
| `--cloud` | Il progetto Rebase Cloud a cui è collegata questa directory |
| `--token <bearer>` | Invia questo bearer token: una chiave `rk_` o un token di accesso utente. Su un progetto Cloud punta all'indirizzo dell'app stessa |
| `--session` | Invia la sessione personale memorizzata da `rebase auth login` per quel server |
| `--anon` | Non invia nulla: ciò che riceve un visitatore |

Non viene fatto alcun altro tentativo di deduzione: in assenza di `REBASE_BASE_URL` e di un `rebase dev` in esecuzione, il comando rifiuta l'operazione anziché inviare la service key a qualunque processo sia in ascolto su una porta. Il `rebase dev` in esecuzione è quello il cui processo è attivo, sulla porta comunicata dal relativo backend (`.rebase/dev.json`, altrimenti il file `.rebase/state.json` del backend stesso); `.rebase-dev-url` è destinato ai tuoi script, e un'esecuzione terminata in modo anomalo lo lascia presente, pertanto nessun comando lo legge. Ogni comando accetta `--json` (e produce output JSON ogni volta che stdout non è un terminale, come avviene per `rebase cloud`) e `--yes`, che risponde alla conferma richiesta da ogni operazione distruttiva; in assenza di un terminale, rifiuta l'operazione con `confirmation_required` anziché mostrare un prompt interattivo.

`rebase api-keys`, `rebase storage orphans|move` e `rebase schema reconcile` accettano gli stessi flag.

## `rebase api`

Qualsiasi route servita dall'app, con le credenziali del progetto — la "long tail" di funzionalità che non hanno un comando dedicato: l'aggiornamento di una vista materializzata, l'audit RLS, `/api/meta/contract`, una route aggiunta da un plugin.

```bash
rebase api data/posts -f status=eq.published -f limit=5   # GET /api/data/posts?status=eq.published&limit=5
rebase api POST data/posts -F title=Hello -F published=true
rebase api /api/admin/rls-audit --project acme
rebase api PATCH data/posts/42 --input change.json --include
```

Un percorso privo di uno `/` iniziale si intende sotto `/api`. `-f key=value` è un campo stringa e `-F` un campo tipizzato (`true`, `false`, `null`, numeri, JSON, `@file`); i campi costituiscono la query string per GET, HEAD o DELETE, oppure un body JSON negli altri casi. A differenza di `gh api`, la presenza di un campo da sola non rende mai la richiesta una POST: un'operazione di scrittura deve specificare il metodo o includere `--input`. La risposta viene stampata così come viene ricevuta — formattata come pretty-printed JSON — e una risposta non-2xx viene stampata con codice di uscita 1. Un header `Authorization` viene rifiutato; i flag di destinazione scelgono le credenziali.

## `rebase data`

Le righe di una tabella, tramite `/api/data`. I filtri sono quelli nativi dell'API (`?status=eq.published`), inoltrati esattamente come scritti: `--where status=eq.published`, `--where price=gte.10` e un semplice `--where status=draft` per verificare l'uguaglianza.

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
| `query <table>` | `--where`, `--or`, `--order-by col[:desc]` (ripetibile), `--limit`, `--offset`, `--fields a,b`, `--include`, `--search`, `--deleted include\|only`; `--all` scorre tutte le pagine; `--format table\|json\|ndjson\|csv` (csv e ndjson in streaming con `--all`) |
| `get <table> <id>` | Una singola riga, con `--fields` e `--include` |
| `count <table>` | Le righe corrispondenti a `--where` |
| `aggregate <table>` | `--select` e `--group-by`, nativi dell'API |
| `insert <table>` | `--data <json>` o `--file <path\|->`; un array corrisponde a più righe in un'unica scrittura bulk; `--upsert <column>` |
| `update <table> [<id>]` | Una riga, o tutte le righe corrispondenti a `--where` dopo un conteggio e una conferma; `--if-match <etag>` |
| `delete <table> [<id>]` | Richiede prima conferma; `--hard` su una tabella con soft-delete |
| `import <table>` | `--file` (array JSON, NDJSON o CSV in base all'estensione, oppure `--format`), a batch (`--batch`); `--upsert`, `--ignore-duplicates`. Rilegge quanto generato da `query --format json` |
| `history <table> <id>`, `revert <table> <id> <historyId>` | Tabelle con la cronologia abilitata |
| `watch <table>` | Le righe corrispondenti a ogni loro modifica, tramite socket realtime. Non disponibile tramite il proxy Studio: su un progetto Cloud passare `--token` o `--session` |

La service key corrisponde al ruolo `admin`: la row-level security viene comunque applicata, con quel ruolo. Passa `--token`, `--session` o `--anon` per visualizzare la tabella con l'identità di qualcun altro.

## `rebase schema show`

Le tabelle, o le colonne, le relazioni e la row-level security di una tabella — da `backend/schema` per impostazione predefinita, oppure con `--remote` (o qualsiasi flag di destinazione) nel modo in cui il server in esecuzione le descrive a questa credenziale. Una credenziale priva di `schema:read` non vede alcuna policy, e una tabella che non può leggere non viene elencata.

```bash
rebase schema show
rebase schema show posts --remote --project acme
```

## `rebase users`

Gli account, tramite `/api/admin/users`, `/roles` e `/guests`. Un account viene identificato tramite il suo uid o la sua email (corrispondenza esatta, mai la prima corrispondenza approssimativa).

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

`create` invia un invito via email, oppure restituisce una password temporanea una tantum se non è possibile inviare email. `--no-invite` crea l'account senza password e non invia nulla, per un'app che gestisce l'accesso tramite magic link, codice email o provider esterno (`POST /api/admin/users` con `invite: false`). L'assegnazione di un ruolo, `--disable`, `delete` e `mfa-reset` richiedono prima conferma. Nessun chiamante può assegnare un ruolo superiore al proprio, né intervenire su un account di livello superiore. `rebase auth reset-password` è la variante precedente, e ricorre comunque al database quando il server non è in esecuzione.

### Importazione degli account

<span class="since-badge" data-since="0.35">Da 0.35</span> `import` trasferisce gli account da un altro sistema mantenendo i loro ID, in modo che le righe che puntano a un utente continuino a puntare allo stesso. Accetta un file CSV, un array JSON o NDJSON (`--format`, altrimenti determinato dall'estensione), con queste colonne:

| Colonna | |
|---|---|
| `id` | Mantenuto come ID dell'account. Facoltativo: senza di esso, la tabella degli utenti ne genera uno. Il caso tipico è un UUID; sono ammessi anche lettere, cifre e `_ - . : \|` fino a 128 caratteri, sebbene una colonna ID di tipo `uuid` accetti solo UUID |
| `email` | Obbligatorio |
| `display_name` / `displayName` | |
| `photo_url` / `photoUrl` | |
| `created_at` / `createdAt` | Data e ora in cui l'account è stato creato nel sistema di origine. Facoltativo: data/ora attuale |
| `email_verified` / `emailVerified` | `true`/`t`/`1` o `false`/`f`/`0`. Facoltativo: `false`, e il primo magic link o reset seguito dall'account lo confermerà |
| `roles` | `editor;viewer`, racchiuso tra virgolette `"editor,viewer"`, o un array Postgres `{editor,viewer}` |

Nessuna password e nessun hash viene importato, e non viene inviata alcuna email: un account importato accede tramite magic link, codice email, provider o reimpostazione della password. Un account il cui ID o la cui email risulti già occupato viene segnalato come ignorato (skipped) e lasciato invariato, mai aggiornato, consentendo di rieseguire il file. Ogni account viene segnalato come creato, ignorato o fallito con la relativa motivazione; il comando termina con codice 1 se anche uno solo fallisce. `--dry-run` controlla ogni account senza scrivere nulla. La CLI invia 100 account per richiesta (`POST /api/admin/users/import`), indifferentemente su `rebase dev`, un server o un progetto Rebase Cloud.

Da Supabase:

```bash
SUPABASE_DB_URL="postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres"
psql "$SUPABASE_DB_URL" -c "\copy (select id, email, created_at, email_confirmed_at is not null as email_verified from auth.users) to users.csv csv header"
rebase users import users.csv --dry-run
rebase users import users.csv --project my-app
```

## `rebase cron`

I job pianificati dell'app (`backend/crons/*`).

```bash
rebase cron list
rebase cron logs nightly-backup -n 5
rebase cron run cleanup-sessions --yes
rebase cron disable nightly-backup --yes
rebase cron reset nightly-backup          # the job's code decides again
```

`enable` e `disable` sovrascrivono il codice del job su ogni processo, anche tra i vari redeploy; `run` richiede prima conferma, e `--async` risponde non appena l'esecuzione è stata avviata. Su un progetto Cloud, `rebase cron` non richiede l'accesso a Studio per le operazioni di lettura: richiede al control plane un token di piattaforma temporaneo `cron:read`, di cui dispone qualsiasi membro con accesso ai log. `run`, `enable`, `disable` e `reset` richiedono `cron:write`, di cui dispongono i proprietari o gli amministratori dell'organizzazione su un progetto con Studio abilitato. `rebase cloud cron` è la sintassi precedente, di sola lettura.

## `rebase logs`

I log delle richieste e dell'applicazione del server — il buffer letto dalla vista Logs di Studio — una tantum, oppure seguiti in tempo reale con `-f`.

```bash
rebase logs -n 50 --level warn
rebase logs -f --source auth --search "sign-in"
```

Il buffer appartiene a un singolo processo. Con `--project` o `--cloud` corrisponde a `rebase cloud logs --runtime`: l'output di ogni replica, attraverso il control plane.

## `rebase functions`

Le route personalizzate dell'app, una per ciascun file in `backend/functions/`.

```bash
rebase functions list
rebase functions invoke hello --anon
rebase functions invoke billing webhook -X POST --input event.json
```

`invoke` accetta i campi, il body e gli header accettati da `rebase api`, e stampa la risposta così come viene ricevuta. Le funzioni gestiscono autonomamente i propri controlli di accesso, quindi la credenziale utilizzata fa la differenza: `--anon` mostra ciò che riceve un visitatore.

## `rebase storage`

I file archiviati, tramite le policy di storage. Il lato archiviato inizia con due punti: `:avatars/me.png` nella sorgente predefinita, `media:avatars/me.png` nella sorgente identificata da `media`.

```bash
rebase storage ls :avatars
rebase storage cp ./me.png :avatars/me.png
rebase storage cp :avatars/me.png ./me.png
rebase storage url :avatars/me.png      # a signed link: whoever holds it reads the file until it expires
rebase storage stat :avatars/me.png
rebase storage rm :avatars/me.png --yes
```

`cp --public` esegue l'upload sotto il prefisso pubblico (un URL permanente senza token), `--content-type` imposta il tipo e `--force` sovrascrive un file locale durante il download. `orphans` e `move` costituiscono la parte del gruppo dedicata alla manutenzione dell'intero archivio.

## `rebase rls simulate`

Ciò che vedrebbe un'altra identità, tramite il simulatore RLS dell'app — lo stesso utilizzato dalla funzione "view as" di Studio: per ogni tabella, le righe lette da quell'identità a confronto con quelle lette da te, le tabelle da cui i suoi scope la escludono e le colonne che non può leggere. In sola lettura.

```bash
rebase auth login --email you@example.com
rebase rls simulate --role anon
rebase rls simulate --user 3f0c9a7e-… --table posts
rebase rls simulate --key <api-key-id>
rebase rls options
```

Il simulatore risponde solo alla sessione di un amministratore e mai a una chiave, pertanto invia la sessione memorizzata da `rebase auth login`. `rebase verify --live` verifica le policy stesse, senza fare riferimento ad alcuna identità specifica.

## `rebase auth login`, `emails` e `keys`

Alcune route rispondono a una persona e mai a una macchina: il simulatore RLS, le chiavi personali, l'applicazione live dello schema. `rebase auth login` effettua l'accesso a un'app in esecuzione — tramite browser quando il server supporta il device sign-in, altrimenti con `--email` e una password (`--code` per il secondo fattore) — e memorizza la sessione in `~/.rebase/sessions.json`, suddivisa per server, mai nel progetto. `auth whoami` indica l'identità con cui il server ti riconosce e gli scope in tuo possesso; `auth logout` chiude la sessione anche sul server.

```bash
rebase auth login --email you@example.com
rebase auth whoami --session
rebase auth emails --latest --links      # the dev mailbox: sign-in, reset and magic-link mail with no SMTP_HOST
rebase auth keys create --name ci --scopes data:read:posts --expires-in 30
rebase auth keys revoke <id> --yes
```

`auth emails` legge la casella di posta di sviluppo che un server privo di `SMTP_HOST` mantiene anziché inviare email reali; `--clear` la svuota. Per una casella di posta vuota viene restituita un'indicazione del server interrogato (`The development mailbox at http://localhost:3082 (rebase dev) is empty.`, e il campo `server` nel JSON), poiché una risposta vuota da un altro backend apparirebbe identica a un'email mai inviata. `auth keys` gestisce le tue chiavi personali `rk_`, che agiscono a tuo nome, limitate agli scope specificati; il server risponde solo quando la tabella auth imposta `auth.personalKeys: true`. Le service key sono gestite con `rebase api-keys`, che include ora anche `update <id>`.

## Passaggi successivi

- [Indice degli endpoint](/docs/backend/endpoints/) — ogni route raggiunta da questi comandi e lo scope richiesto da ciascuna
- [REST API](/docs/backend/api/) — la sintassi di filtro, ordinamento e paginazione inoltrata da `rebase data`
- [rebase cloud](/docs/cli/cloud/) — il progetto stesso su Rebase Cloud: deploy, variabili d'ambiente, backup, accesso a Studio
- [Riferimento CLI](/docs/cli/) — tutti gli altri comandi
