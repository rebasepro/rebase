---
sourceHash: 3e9a0fde0de12d46
title: Un'applicazione in esecuzione
sidebar_label: Un'applicazione in esecuzione
description: Comandi della CLI che operano su un'applicazione Rebase in esecuzione tramite la sua API — righe, utenti, cron, log, funzioni, file, il simulatore RLS — su rebase dev, un server specificato o un progetto Rebase Cloud.
---

Questi comandi comunicano con un'applicazione in esecuzione tramite la sua stessa API; pertanto, la sicurezza a livello di riga (RLS), l'accesso ai campi, gli hook e le policy di archiviazione determinano cosa possono fare, esattamente come avviene per l'SDK. Raggiungono l'istanza locale di `rebase dev`, un server specificato o un progetto Rebase Cloud, utilizzando ovunque gli stessi flag.

## Scelta del server e delle credenziali

| Flag | Dove vanno le richieste e con quale identità |
|---|---|
| *(nessuno)* | `REBASE_BASE_URL` (shell, poi `.env`), altrimenti l'istanza `rebase dev` eseguita da questo checkout; con la chiave di servizio da `.env` |
| `--url <server>` | Quel server, con la chiave di servizio da `.env` |
| `--project <slug>` | Un progetto Rebase Cloud, tramite il proxy Studio della console: si effettua l'accesso con `rebase cloud login`, e il control plane allega la chiave dell'applicazione dal suo lato, evitando che la chiave raggiunga la tua macchina. Riservato a proprietari e amministratori dell'organizzazione, su un progetto con accesso a Studio attivo (`rebase cloud settings set --studio on`) |
| `--cloud` | Il progetto Rebase Cloud a cui è collegata questa directory |
| `--token <bearer>` | Invia invece questo bearer: una chiave `rk_` o il token di accesso di un utente. Su un progetto Cloud viene indirizzato all'indirizzo dell'applicazione |
| `--session` | Invia la sessione utente memorizzata da `rebase auth login` per quel server |
| `--anon` | Non invia nulla: ciò che riceve un visitatore anonimo |

Non viene fatta alcuna altra supposizione: senza `REBASE_BASE_URL` e senza un `rebase dev` in esecuzione, il comando rifiuta l'esecuzione invece di inviare la chiave di servizio a qualunque cosa sia in ascolto su una porta. L'istanza `rebase dev` in esecuzione è quella il cui processo è attivo, sulla porta annunciata dal suo backend (`.rebase/dev.json`, altrimenti il file `.rebase/state.json` del backend stesso); `.rebase-dev-url` è destinato ai tuoi script e un'esecuzione interrotta lo lascia intatto, quindi nessun comando lo legge. Ogni comando accetta `--json` (e produce output JSON ogni volta che stdout non è un terminale, esattamente come `rebase cloud`) e `--yes`, che risponde affermativamente alla richiesta di conferma prevista da ogni azione distruttiva; in assenza di terminale, il comando fallisce con `confirmation_required` invece di richiedere un prompt interattivo.

`rebase api-keys`, `rebase storage orphans|move` e `rebase schema reconcile` accettano gli stessi flag.

## `rebase api`

Qualsiasi route gestita dall'app, con le credenziali del progetto — la "long tail" di operazioni che non hanno un comando dedicato: l'aggiornamento di una vista materializzata, l'audit RLS, `/api/meta/contract`, una route aggiunta da un plugin.

```bash
rebase api data/posts -f status=eq.published -f limit=5   # GET /api/data/posts?status=eq.published&limit=5
rebase api POST data/posts -F title=Hello -F published=true
rebase api /api/admin/rls-audit --project acme
rebase api PATCH data/posts/42 --input change.json --include
```

Un percorso privo di `/` iniziale si intende sotto `/api`. `-f chiave=valore` rappresenta un campo stringa e `-F` un campo tipizzato (`true`, `false`, `null`, numeri, JSON, `@file`); i campi compongono la query string in una richiesta GET, HEAD o DELETE e un corpo JSON in caso contrario. A differenza di `gh api`, un campo da solo non rende mai la richiesta una POST: un'operazione di scrittura specifica esplicitamente il metodo o include `--input`. La risposta viene stampata così come viene ricevuta — in formato JSON formattato (pretty-printed) — e una risposta non-2xx viene stampata con codice di uscita 1. L'header `Authorization` viene rifiutato: sono i flag di destinazione a determinare le credenziali.

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
| `query <table>` | `--where`, `--or`, `--order-by col[:desc]` (ripetibile), `--limit`, `--offset`, `--fields a,b`, `--include`, `--search`, `--deleted include\|only`; `--all` attraversa tutte le pagine; `--format table\|json\|ndjson\|csv` (csv e ndjson vengono trasmessi in streaming con `--all`) |
| `get <table> <id>` | Una singola riga, con `--fields` e `--include` |
| `count <table>` | Il conteggio delle righe che corrispondono a `--where` |
| `aggregate <table>` | `--select` e `--group-by`, nativi dell'API |
| `insert <table>` | `--data <json>` o `--file <path\|->`; un array inserisce più righe in una singola scrittura cumulativa (bulk); `--upsert <column>` |
| `update <table> [<id>]` | Una riga, oppure ogni riga corrispondente a `--where` previa verifica del conteggio e conferma; `--if-match <etag>` |
| `delete <table> [<id>]` | Richiede prima conferma; `--hard` su una tabella con soft-delete |
| `import <table>` | `--file` (array JSON, NDJSON o CSV in base all'estensione, oppure `--format`), a lotti (`--batch`); `--upsert`, `--ignore-duplicates`. È in grado di rileggere ciò che viene generato da `query --format json` |
| `history <table> <id>`, `revert <table> <id> <historyId>` | Tabelle con cronologia abilitata |
| `watch <table>` | Le righe corrispondenti a ogni loro modifica, tramite socket realtime. Non supportato tramite il proxy Studio: su un progetto Cloud passare `--token` o `--session` |

La chiave di servizio corrisponde al ruolo `admin`: la sicurezza a livello di riga (RLS) viene comunque applicata, ma per quel ruolo. Passa `--token`, `--session` o `--anon` per visualizzare la tabella con le autorizzazioni di un'altra identità.

## `rebase schema show`

Le tabelle, oppure le colonne, le relazioni e la sicurezza a livello di riga di una tabella — per impostazione predefinita da `backend/schema`, oppure con `--remote` (o qualsiasi flag di destinazione) così come il server in esecuzione le descrive per questa credenziale. Una credenziale priva di `schema:read` non vedrà alcuna policy e una tabella che non può leggere non verrà elencata.

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

`create` invia un invito via email oppure restituisce una password temporanea una tantum quando non è possibile inviare email. `--no-invite` crea l'account senza password e non invia nulla, ideale per un'app in cui l'accesso avviene tramite magic link, codice email o provider esterno (`POST /api/admin/users` con `invite: false`). L'assegnazione di un ruolo, `--disable`, `delete` e `mfa-reset` richiedono prima conferma. Nessun chiamante può assegnare un ruolo superiore al proprio o agire su un account con privilegi più elevati. `rebase auth reset-password` è la variante precedente del comando e si appoggia ancora direttamente al database quando il server non è in esecuzione.

### Importazione degli account

`import` migra gli account da un altro sistema mantenendo i loro ID, in modo che le righe collegate a un utente continuino a puntare allo stesso record. Accetta un file CSV, un array JSON o NDJSON (`--format`, altrimenti dedotto dall'estensione), con le seguenti colonne:

| Colonna | |
|---|---|
| `id` | Mantenuto come ID dell'account. Facoltativo: in sua assenza la tabella users ne genera uno. Il caso più comune è un UUID; sono ammessi anche lettere, cifre e `_ - . : \|` fino a 128 caratteri, sebbene una colonna ID di tipo `uuid` accetti solo UUID |
| `email` | Obbligatorio |
| `display_name` / `displayName` | |
| `photo_url` / `photoUrl` | |
| `created_at` / `createdAt` | Data e ora di creazione dell'account nel sistema di origine. Facoltativo: ora attuale |
| `email_verified` / `emailVerified` | `true`/`t`/`1` o `false`/`f`/`0`. Facoltativo: `false`, e il primo magic link o reset seguito dall'account lo confermerà |
| `roles` | `editor;viewer`, tra virgolette `"editor,viewer"`, oppure un array Postgres `{editor,viewer}` |
| `password_hash` / `encrypted_password` | L'hash memorizzato dall'altro sistema. Letto solo con `--password-hashes bcrypt`; senza questo flag, un file contenente questa colonna viene rifiutato prima di effettuare qualsiasi invio |

Non viene inviata alcuna email. Con `--password-hashes bcrypt`, un account la cui riga include un hash effettua l'accesso con la password precedente, e al suo primo accesso l'hash viene sostituito con quello nativo di Rebase. Qualsiasi altro account importato accede tramite magic link, codice inviato via email, provider o reimpostazione della password. Non è mai possibile importare una password in chiaro. Un account il cui ID o email è già registrato viene segnalato come saltato e lasciato inalterato, mai aggiornato, consentendo di rieseguire il file in sicurezza. Ogni account viene notificato come creato, saltato o fallito con il relativo motivo; il comando termina con codice 1 se si verificano errori. `--dry-run` verifica ogni account senza scrivere alcun dato. La CLI invia 100 account per richiesta (`POST /api/admin/users/import`), indifferentemente su `rebase dev`, su un server o su un progetto Rebase Cloud.

Da Supabase:

```bash
SUPABASE_DB_URL="postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres"
psql "$SUPABASE_DB_URL" -c "\copy (select id, email, created_at, email_confirmed_at is not null as email_verified, encrypted_password from auth.users) to users.csv csv header"
rebase users import users.csv --password-hashes bcrypt --dry-run
rebase users import users.csv --password-hashes bcrypt --project my-app
```

`users.csv` conterrà l'hash delle password di ogni account: eliminalo una volta completata l'importazione.

## `rebase cron`

I job pianificati dell'applicazione (`backend/crons/*`).

```bash
rebase cron list
rebase cron logs nightly-backup -n 5
rebase cron run cleanup-sessions --yes
rebase cron disable nightly-backup --yes
rebase cron reset nightly-backup          # the job's code decides again
```

`enable` e `disable` sovrascrivono il codice del job su ogni processo, anche attraverso i redeploy; `run` richiede prima conferma e `--async` restituisce una risposta non appena l'esecuzione è avviata. Su un progetto Cloud, `rebase cron` non richiede l'accesso a Studio per le operazioni di lettura: richiede al control plane un token di piattaforma `cron:read` a breve durata, posseduto da qualsiasi membro con accesso ai log. `run`, `enable`, `disable` e `reset` richiedono invece `cron:write`, a disposizione dei proprietari o degli amministratori dell'organizzazione su un progetto con Studio abilitato. `rebase cloud cron` è la precedente sintassi, di sola lettura.

## `rebase logs`

I log delle richieste e dell'applicazione del server — il buffer letto dalla vista Logs di Studio — visualizzati una sola volta, oppure seguiti in tempo reale con `-f`.

```bash
rebase logs -n 50 --level warn
rebase logs -f --source auth --search "sign-in"
```

Il buffer appartiene a un singolo processo. Con `--project` o `--cloud` corrisponde a `rebase cloud logs --runtime`: l'output di ogni replica, veicolato attraverso il control plane.

## `rebase functions`

Le route personalizzate dell'applicazione, una per ciascun file in `backend/functions/`.

```bash
rebase functions list
rebase functions invoke hello --anon
rebase functions invoke billing webhook -X POST --input event.json
```

`invoke` accetta gli stessi campi, corpo e header supportati da `rebase api`, e stampa la risposta così come viene ricevuta. Le funzioni gestiscono autonomamente i propri controlli di accesso, quindi la credenziale utilizzata fa la differenza: `--anon` mostra ciò che riceve un visitatore anonimo.

## `rebase storage`

I file archiviati, soggetti alle policy di archiviazione. Il lato storage inizia con i due punti: `:avatars/me.png` nella sorgente predefinita, `media:avatars/me.png` nella sorgente identificata dalla chiave `media`.

```bash
rebase storage ls :avatars
rebase storage cp ./me.png :avatars/me.png
rebase storage cp :avatars/me.png ./me.png
rebase storage url :avatars/me.png      # a signed link: whoever holds it reads the file until it expires
rebase storage stat :avatars/me.png
rebase storage rm :avatars/me.png --yes
```

`cp --public` carica i file sotto il prefisso pubblico (un URL permanente senza token), `--content-type` ne imposta il tipo MIME e `--force` sovrascrive il file locale durante il download. `orphans` e `move` costituiscono la parte del gruppo dedicata alla manutenzione dell'intero archivio.

## `rebase rls simulate`

Cosa vedrebbe un'altra identità, tramite il simulatore RLS dell'applicazione — lo stesso utilizzato dalla funzione "view as" di Studio: per ogni tabella, le righe che tale identità può leggere a confronto con quelle visibili da te, le tabelle da cui i suoi scope la escludono e le colonne che non può visualizzare. Sola lettura.

```bash
rebase auth login --email you@example.com
rebase rls simulate --role anon
rebase rls simulate --user 3f0c9a7e-… --table posts
rebase rls simulate --key <api-key-id>
rebase rls options
```

Il simulatore risponde esclusivamente alla sessione di un amministratore e mai a una chiave; pertanto, questo comando invia la sessione memorizzata da `rebase auth login`. `rebase verify --live` controlla le policy stesse, senza fare riferimento a una specifica identità.

## `rebase auth login`, `emails` e `keys`

Alcune route rispondono esclusivamente a un utente e mai a una macchina: il simulatore RLS, le chiavi personali, l'applicazione dello schema live. `rebase auth login` effettua l'accesso a un'applicazione in esecuzione — tramite browser quando il server supporta l'accesso dispositivo, altrimenti con `--email` e password (`--code` per l'autenticazione a due fattori) — e memorizza la sessione in `~/.rebase/sessions.json`, suddivisa per server e mai all'interno del progetto. `auth whoami` indica l'identità riconosciuta dal server e gli scope posseduti; `auth logout` termina la sessione anche su di esso.

```bash
rebase auth login --email you@example.com
rebase auth whoami --session
rebase auth emails --latest --links      # the dev mailbox: sign-in, reset and magic-link mail with no SMTP_HOST
rebase auth keys create --name ci --scopes data:read:posts --expires-in 30
rebase auth keys revoke <id> --yes
```

`auth emails` legge la casella di posta per lo sviluppo che un server privo di `SMTP_HOST` mantiene invece di inviare le email; `--clear` la svuota. Se la casella è vuota, la risposta include il server interrogato (`The development mailbox at http://localhost:3082 (rebase dev) is empty.` e il campo `server` nel JSON), poiché una risposta vuota da un altro backend apparirebbe identica a una mail mai spedita. `auth keys` gestisce le tue chiavi personali `rk_`, che agiscono a tuo nome limitatamente agli scope specificati; il server risponde solo quando la tabella di autenticazione imposta `auth.personalKeys: true`. Le chiavi di servizio vengono gestite tramite `rebase api-keys`, che include ora anche il comando `update <id>`.

## Prossimi passi

- [Indice degli endpoint](/docs/backend/endpoints/) — ogni route raggiunta da questi comandi e lo scope richiesto da ciascuna
- [API REST](/docs/backend/api/) — la sintassi per filtri, ordinamento e paginazione inoltrata da `rebase data`
- [rebase cloud](/docs/cli/cloud/) — il progetto su Rebase Cloud: deploy, variabili d'ambiente, backup, accesso a Studio
- [Riferimento della CLI](/docs/cli/) — tutti gli altri comandi
