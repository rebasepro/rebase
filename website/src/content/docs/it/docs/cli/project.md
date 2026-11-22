---
sourceHash: 194ea0c912d942b7
title: Un'applicazione in esecuzione
sidebar_label: Un'applicazione in esecuzione
description: Comandi della CLI che agiscono su un'app Rebase in esecuzione tramite la sua API — righe, utenti, cron, log, funzioni, file, il simulatore RLS — su rebase dev, un server specificato o un progetto Rebase Cloud.
---

Questi comandi comunicano con un'applicazione in esecuzione tramite la sua stessa API; pertanto, la sicurezza a livello di riga (row-level security), l'accesso ai campi, gli hook e le policy di archiviazione determinano ciò che possono fare, esattamente come avviene per l'SDK. Raggiungono il `rebase dev` locale, un server a scelta o un progetto Rebase Cloud, utilizzando gli stessi flag ovunque.

## Scegliere il server e le credenziali

| Flag | Dove vanno le richieste e con quale identità |
|---|---|
| *(nessuno)* | `REBASE_BASE_URL` (shell, poi `.env`), altrimenti l'istanza di `rebase dev` in esecuzione in questo checkout; con la chiave di servizio da `.env` |
| `--url <server>` | Quel server, con la chiave di servizio da `.env` |
| `--project <slug>` | Un progetto Rebase Cloud, tramite il proxy Studio della console: si effettua l'accesso con `rebase cloud login` e il piano di controllo (control plane) allega la chiave dell'app dal proprio lato, evitando che la chiave raggiunga la macchina locale. Riservato a proprietari e amministratori dell'organizzazione, su un progetto con accesso a Studio attivo (`rebase cloud settings set --studio on`) |
| `--cloud` | Il progetto Rebase Cloud a cui è collegata questa directory |
| `--token <bearer>` | Invia questo bearer alternativo: una chiave `rk_` o il token di accesso di un utente. Su un progetto Cloud viene inviato all'indirizzo specifico dell'app |
| `--session` | Invia la sessione utente che `rebase auth login` ha memorizzato per quel server |
| `--anon` | Non invia nulla: ciò che ottiene un visitatore |

Nient'altro viene dedotto: in assenza di `REBASE_BASE_URL` e senza un `rebase dev` attivo, il comando rifiuta di procedere anziché inviare la chiave di servizio a qualsiasi cosa sia in ascolto su una porta. L'istanza di `rebase dev` in esecuzione è quella il cui processo è attivo, sulla porta comunicata dal relativo backend (`.rebase/dev.json`, altrimenti il file `.rebase/state.json` del backend stesso); `.rebase-dev-url` è destinato ai tuoi script, e un'esecuzione terminata in modo anomalo lo lascia orfano, quindi nessun comando lo legge. Ogni comando accetta `--json` (e restituisce JSON ogni volta che stdout non è un terminale, come accade per `rebase cloud`) e `--yes`, che risponde alla conferma richiesta da ogni operazione distruttiva; in assenza di un terminale, l'operazione viene rifiutata con `confirmation_required` anziché richiedere un prompt.

`rebase api-keys`, `rebase storage orphans|move` e `rebase schema reconcile` accettano gli stessi flag.

## `rebase api`

Qualsiasi route gestita dall'app, con le credenziali del progetto — la "long tail" che non dispone di un comando dedicato: l'aggiornamento di una vista materializzata, l'audit RLS, `/api/meta/contract`, una route aggiunta da un plugin.

```bash
rebase api data/posts -f status=eq.published -f limit=5   # GET /api/data/posts?status=eq.published&limit=5
rebase api POST data/posts -F title=Hello -F published=true
rebase api /api/admin/rls-audit --project acme
rebase api PATCH data/posts/42 --input change.json --include
```

Un percorso privo di `/` iniziale si trova sotto `/api`. `-f key=value` rappresenta un campo stringa e `-F` un campo tipizzato (`true`, `false`, `null`, numeri, JSON, `@file`); i campi costituiscono la query string di una richiesta GET, HEAD o DELETE, oppure un body JSON negli altri casi. A differenza di `gh api`, un campo da solo non trasforma mai la richiesta in una POST: un'operazione di scrittura deve specificare il metodo o includere `--input`. La risposta viene stampata così come viene ricevuta — con JSON formattato (pretty-printed) — e una risposta non-2xx viene stampata terminando con codice di uscita 1. Un header `Authorization` viene rifiutato; sono i flag di destinazione a selezionare le credenziali.

## `rebase data`

Le righe di una tabella, tramite `/api/data`. I filtri sono quelli nativi dell'API (`?status=eq.published`), inoltrati così come scritti: `--where status=eq.published`, `--where price=gte.10` e un semplice `--where status=draft` per verificare l'uguaglianza.

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
| `query <table>` | `--where`, `--or`, `--order-by col[:desc]` (ripetibile), `--limit`, `--offset`, `--fields a,b`, `--include`, `--search`, `--deleted include\|only`; `--all` attraversa ogni pagina; `--format table\|json\|ndjson\|csv` (csv e ndjson trasmettono in streaming con `--all`) |
| `get <table> <id>` | Una singola riga, con `--fields` e `--include` |
| `count <table>` | Il conteggio delle righe corrispondenti a `--where` |
| `aggregate <table>` | `--select` e `--group-by`, nativi dell'API |
| `insert <table>` | `--data <json>` o `--file <path\|->`; un array corrisponde a più righe in una singola scrittura di massa (bulk); `--upsert <column>` |
| `update <table> [<id>]` | Una singola riga, oppure ogni riga corrispondente a `--where` previo conteggio e richiesta di conferma; `--if-match <etag>` |
| `delete <table> [<id>]` | Chiede conferma prima di procedere; `--hard` per una tabella con soft-delete |
| `import <table>` | `--file` (array JSON, NDJSON o CSV in base all'estensione, oppure `--format`), a lotti (`--batch`); `--upsert`, `--ignore-duplicates`. È in grado di rileggere quanto scritto da `query --format json` |
| `history <table> <id>`, `revert <table> <id> <historyId>` | Tabelle con cronologia abilitata |
| `watch <table>` | Le righe corrispondenti ogni volta che cambiano, tramite socket realtime. Non disponibile tramite il proxy Studio: su un progetto Cloud passare `--token` o `--session` |

La chiave di servizio corrisponde al ruolo `admin`: la row-level security rimane attiva, applicata a tale ruolo. Passa `--token`, `--session` o `--anon` per visualizzare la tabella con i permessi di un altro utente.

## `rebase schema show`

Le tabelle, o le colonne, le relazioni e la row-level security di una specifica tabella — per impostazione predefinita da `backend/schema`, oppure con `--remote` (o qualsiasi flag di destinazione) secondo quanto descritto dal server in esecuzione a queste credenziali. Una credenziale priva di `schema:read` non vedrà alcuna policy e una tabella che non può leggere non verrà elencata.

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

`create` invia un invito via email, oppure restituisce una password temporanea una tantum nel caso in cui non sia possibile inviare email. `--no-invite` crea l'account senza password e non invia nulla, ideale per un'app che gestisce l'accesso tramite magic link, codice email o provider esterno (`POST /api/admin/users` con `invite: false`). L'assegnazione di un ruolo, `--disable`, `delete` e `mfa-reset` richiedono conferma prima di procedere. Nessun chiamante può assegnare un ruolo superiore al proprio, né eseguire azioni su un account di grado più elevato. `rebase auth reset-password` rappresenta la vecchia sintassi e si appoggia comunque al database di fallback quando il server non è in esecuzione.

### Importazione degli account

`import` importa account da un altro sistema mantenendo i loro ID, in modo che le righe collegate a un utente continuino a puntare allo stesso record. Accetta un file CSV, un array JSON o NDJSON (`--format`, altrimenti dedotto dall'estensione), con le seguenti colonne:

| Colonna | |
|---|---|
| `id` | Mantenuto come ID dell'account. Facoltativo: in sua assenza, la tabella degli utenti ne genera uno. Il caso comune è un UUID; sono ammessi anche lettere, cifre e `_ - . : \|` fino a 128 caratteri, sebbene una colonna ID di tipo `uuid` accetti esclusivamente UUID |
| `email` | Obbligatorio |
| `display_name` / `displayName` | |
| `photo_url` / `photoUrl` | |
| `created_at` / `createdAt` | Data e ora di creazione dell'account nel sistema di origine. Facoltativo: data e ora correnti |
| `email_verified` / `emailVerified` | `true`/`t`/`1` o `false`/`f`/`0`. Facoltativo: `false`, e il primo magic link o reset aperto dall'account lo confermerà |
| `roles` | `editor;viewer`, tra virgolette `"editor,viewer"` o come array Postgres `{editor,viewer}` |

Nessuna password e nessun hash viene importato, e non viene inviata alcuna email: un account importato effettua l'accesso tramite magic link, codice email, provider o reimpostazione della password. Un account il cui ID o la cui email risultano già occupati viene segnalato come saltato e lasciato invariato, mai aggiornato, consentendo di rieseguire il file. Per ciascun account viene indicato lo stato: creato, saltato o fallito con la relativa motivazione; il comando termina con codice di uscita 1 se si verifica almeno un errore. `--dry-run` verifica ogni account senza scrivere nulla. La CLI invia 100 account per richiesta (`POST /api/admin/users/import`), indifferentemente su `rebase dev`, un server o un progetto Rebase Cloud.

Da Supabase:

```bash
SUPABASE_DB_URL="postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres"
psql "$SUPABASE_DB_URL" -c "\copy (select id, email, created_at, email_confirmed_at is not null as email_verified from auth.users) to users.csv csv header"
rebase users import users.csv --dry-run
rebase users import users.csv --project my-app
```

## `rebase cron`

I job pianificati dell'applicazione (`backend/crons/*`).

```bash
rebase cron list
rebase cron logs nightly-backup -n 5
rebase cron run cleanup-sessions --yes
rebase cron disable nightly-backup --yes
rebase cron reset nightly-backup          # the job's code decides again
```

`enable` e `disable` sovrascrivono il codice del job su ogni processo, anche attraverso i vari redeploy; `run` richiede prima una conferma e `--async` restituisce una risposta non appena l'esecuzione è avviata. Su un progetto Cloud, `rebase cron` non richiede l'accesso a Studio per le operazioni di lettura: richiede al control plane un token di piattaforma temporaneo `cron:read`, disponibile per qualsiasi membro con accesso ai log. `run`, `enable`, `disable` e `reset` richiedono invece `cron:write`, posseduto da un proprietario o amministratore dell'organizzazione su un progetto con Studio attivo. `rebase cloud cron` è la vecchia sintassi di sola lettura.

## `rebase logs`

Il log delle richieste e dell'applicazione del server — il buffer letto dal Logs Explorer di Studio — una tantum oppure seguito in tempo reale con `-f`.

```bash
rebase logs -n 50 --level warn
rebase logs -f --source auth --search "sign-in"
```

Il buffer appartiene a un singolo processo. Con `--project` o `--cloud`, questo equivale a `rebase cloud logs --runtime`: l'output di ogni replica, veicolato attraverso il control plane.

## `rebase functions`

Le route personalizzate dell'applicazione, una per file in `backend/functions/`.

```bash
rebase functions list
rebase functions invoke hello --anon
rebase functions invoke billing webhook -X POST --input event.json
```

`invoke` accetta i campi, il body e gli header accettati da `rebase api` e stampa la risposta così come viene ricevuta. Le funzioni gestiscono autonomamente il proprio controllo degli accessi, quindi le credenziali utilizzate sono rilevanti: `--anon` mostra ciò che riceve un visitatore anonimo.

## `rebase storage`

I file archiviati, regolati dalle storage policy. La destinazione archiviata inizia con i due punti: `:avatars/me.png` nell'origine (source) predefinita, `media:avatars/me.png` nell'origine denominata `media`.

```bash
rebase storage ls :avatars
rebase storage cp ./me.png :avatars/me.png
rebase storage cp :avatars/me.png ./me.png
rebase storage url :avatars/me.png      # a signed link: whoever holds it reads the file until it expires
rebase storage stat :avatars/me.png
rebase storage rm :avatars/me.png --yes
```

`cp --public` carica con prefisso pubblico (un URL permanente, senza token), `--content-type` imposta il tipo e `--force` sovrascrive un file locale durante il download. `orphans` e `move` costituiscono la parte del gruppo dedicata alla manutenzione dell'intero storage.

## `rebase rls simulate`

Cosa vedrebbe un'altra identità, tramite il simulatore RLS dell'applicazione — lo stesso utilizzato dalla funzione "view as" di Studio: per ciascuna tabella, le righe visibili all'identità rispetto a quelle visibili all'utente corrente, le tabelle da cui i suoi scope la escludono e le colonne non leggibili. Sola lettura.

```bash
rebase auth login --email you@example.com
rebase rls simulate --role anon
rebase rls simulate --user 3f0c9a7e-… --table posts
rebase rls simulate --key <api-key-id>
rebase rls options
```

Il simulatore risponde esclusivamente alla sessione di un amministratore e mai a una chiave; per questo motivo, il comando invia la sessione memorizzata da `rebase auth login`. `rebase verify --live` verifica le policy stesse, a prescindere da una specifica identità.

## `rebase auth login`, `emails` e `keys`

Alcune route rispondono a una persona fisica e mai a una macchina: il simulatore RLS, le chiavi personali, l'applicazione dello schema live. `rebase auth login` effettua l'accesso a un'applicazione in esecuzione — tramite browser quando il server supporta l'accesso dispositivo (device sign-in), altrimenti con `--email` e una password (`--code` per l'autenticazione a due fattori) — e conserva la sessione in `~/.rebase/sessions.json`, suddivisa per server, mai all'interno del progetto. `auth whoami` mostra l'identità riconosciuta dal server e gli scope posseduti; `auth logout` termina la sessione anche su tale server.

```bash
rebase auth login --email you@example.com
rebase auth whoami --session
rebase auth emails --latest --links      # the dev mailbox: sign-in, reset and magic-link mail with no SMTP_HOST
rebase auth keys create --name ci --scopes data:read:posts --expires-in 30
rebase auth keys revoke <id> --yes
```

`auth emails` legge la casella di posta di sviluppo che un server privo di `SMTP_HOST` gestisce localmente anziché inviare le email; `--clear` la svuota. Per una casella di posta vuota viene restituito il server interrogato (`The development mailbox at http://localhost:3082 (rebase dev) is empty.`, con `server` nel JSON), poiché una risposta vuota proveniente da un altro backend risulterebbe indistinguibile da un messaggio mai inviato. `auth keys` gestisce le tue chiavi `rk_` personali, che agiscono a tuo nome limitatamente agli scope specificati; il server risponde solo quando la tabella auth imposta `auth.personalKeys: true`. Le chiavi di servizio sono gestite tramite `rebase api-keys`, a cui è stato aggiunto anche il comando `update <id>`.

## Passaggi successivi

- [Indice degli endpoint](/docs/backend/endpoints/) — tutte le route raggiunte da questi comandi e lo scope necessario per ciascuna
- [API REST](/docs/backend/api/) — la sintassi di filtro, ordinamento e paginazione inoltrata da `rebase data`
- [rebase cloud](/docs/cli/cloud/) — il progetto su Rebase Cloud: deploy, variabili d'ambiente, backup, accesso a Studio
- [Riferimento della CLI](/docs/cli/) — tutti gli altri comandi
