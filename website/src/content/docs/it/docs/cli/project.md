---
sourceHash: ba06503a40ad1397
title: Un'applicazione in esecuzione
sidebar_label: Un'applicazione in esecuzione
description: Comandi CLI che operano su un'applicazione Rebase in esecuzione tramite la sua API — righe, utenti, cron, log, funzioni, file, il simulatore RLS — su rebase dev, un server specificato o un progetto Rebase Cloud.
---

Questi comandi comunicano con un'applicazione in esecuzione tramite la sua stessa API, quindi la row-level security, l'accesso ai campi, gli hook e le policy di archiviazione determinano cosa possono fare, esattamente come per l'SDK. Raggiungono l'istanza locale di `rebase dev`, un server specificato o un progetto Rebase Cloud, utilizzando gli stessi flag ovunque.

## Scegliere il server e le credenziali

| Flag | Dove vanno le richieste e con quale identità |
|---|---|
| *(nessuno)* | `REBASE_BASE_URL` (shell, poi `.env`), altrimenti il `rebase dev` eseguito da questo checkout; con la chiave di servizio da `.env` |
| `--url <server>` | Quel server, con la chiave di servizio da `.env` |
| `--project <slug>` | Un progetto Rebase Cloud, tramite il proxy Studio della console: accedi con `rebase cloud login` e il control plane allega la chiave dell'app dal suo lato, quindi nessuna chiave raggiunge la tua macchina. Proprietari e amministratori dell'organizzazione, su un progetto con accesso Studio attivo (`rebase cloud settings set --studio on`) |
| `--cloud` | Il progetto Rebase Cloud a cui è collegata questa directory |
| `--token <bearer>` | Invia invece questo bearer: una chiave `rk_` o il token di accesso di un utente. Su un progetto Cloud viene inviato all'indirizzo dell'app |
| `--session` | Invia la sessione utente memorizzata da `rebase auth login` per quel server |
| `--anon` | Non invia nulla: ciò che vede un visitatore |

Nient'altro viene dedotto: in assenza di `REBASE_BASE_URL` e di un `rebase dev` in esecuzione, il comando rifiuta l'esecuzione piuttosto che inviare la chiave di servizio a qualsiasi servizio sia in ascolto su una porta. Ogni comando accetta `--json` (e produce output JSON ogni volta che stdout non è un terminale, come accade per `rebase cloud`) e `--yes`, che risponde alla conferma richiesta da ogni operazione distruttiva; in assenza di un terminale, il comando rifiuta l'esecuzione con `confirmation_required` invece di mostrare un prompt.

`rebase api-keys`, `rebase storage orphans|move` e `rebase schema reconcile` accettano gli stessi flag.

## `rebase api`

Qualsiasi route servita dall'applicazione, con le credenziali del progetto — la "long tail" che non dispone di un comando dedicato: l'aggiornamento di una vista materializzata, l'audit RLS, `/api/meta/contract`, una route aggiunta da un plugin.

```bash
rebase api data/posts -f status=eq.published -f limit=5   # GET /api/data/posts?status=eq.published&limit=5
rebase api POST data/posts -F title=Hello -F published=true
rebase api /api/admin/rls-audit --project acme
rebase api PATCH data/posts/42 --input change.json --include
```

Un percorso senza `/` iniziale si trova sotto `/api`. `-f key=value` rappresenta un campo stringa e `-F` un campo tipizzato (`true`, `false`, `null`, numeri, JSON, `@file`); i campi formano la query string di un GET, HEAD o DELETE, oppure un body JSON negli altri casi. A differenza di `gh api`, un campo da solo non rende mai la richiesta una POST: un'operazione di scrittura specifica il proprio metodo o include `--input`. La risposta viene stampata così come viene ricevuta — con JSON formattato (pretty-printed) — e una risposta non-2xx viene stampata uscendo con codice 1. Un header `Authorization` viene rifiutato; i flag di destinazione selezionano le credenziali.

## `rebase data`

Le righe di una tabella, tramite `/api/data`. I filtri sono quelli nativi dell'API (`?status=eq.published`), passati esattamente come scritti: `--where status=eq.published`, `--where price=gte.10` e un semplice `--where status=draft` per verificare l'uguaglianza.

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
| `get <table> <id>` | Una riga, con `--fields` e `--include` |
| `count <table>` | Il numero di righe che corrispondono a `--where` |
| `aggregate <table>` | `--select` e `--group-by`, quelli nativi dell'API |
| `insert <table>` | `--data <json>` o `--file <path\|->`; un array rappresenta più righe in un'unica scrittura bulk; `--upsert <column>` |
| `update <table> [<id>]` | Una riga, o tutte le righe corrispondenti a `--where` dopo un conteggio e una conferma; `--if-match <etag>` |
| `delete <table> [<id>]` | Chiede prima conferma; `--hard` su una tabella con soft-delete |
| `import <table>` | `--file` (array JSON, NDJSON o CSV in base all'estensione, oppure `--format`), a lotti (`--batch`); `--upsert`, `--ignore-duplicates`. Rilegge ciò che viene scritto da `query --format json` |
| `history <table> <id>`, `revert <table> <id> <historyId>` | Tabelle con cronologia abilitata |
| `watch <table>` | Le righe corrispondenti a ogni loro modifica, tramite socket realtime. Non attraverso il proxy Studio: su un progetto Cloud passa `--token` o `--session` |

La chiave di servizio ha il ruolo `admin`: la row-level security viene comunque applicata con quel ruolo. Passa `--token`, `--session` o `--anon` per visualizzare la tabella con l'identità di qualcun altro.

## `rebase schema show`

Le tabelle, o le colonne, le relazioni e la row-level security di una specifica tabella — da `backend/schema` per impostazione predefinita, oppure con `--remote` (o qualsiasi flag di destinazione) secondo quanto descritto dal server in esecuzione a queste credenziali. Delle credenziali senza `schema:read` non vedono alcuna policy e una tabella che non possono leggere non compare nell'elenco.

```bash
rebase schema show
rebase schema show posts --remote --project acme
```

## `rebase users`

Gli account, tramite `/api/admin/users`, `/roles` e `/guests`. Un account viene identificato tramite il suo uid o la sua email (corrispondenza esatta, mai il primo risultato approssimativo).

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

`create` invia un invito via email, oppure restituisce una password temporanea una tantum se non è possibile inviare email. L'assegnazione di un ruolo, `--disable`, `delete` e `mfa-reset` richiedono conferma preventiva. Nessun chiamante può assegnare un ruolo superiore al proprio né intervenire su un account di livello superiore. `rebase auth reset-password` è la variante precedente e ricorre comunque al database quando il server non è in esecuzione.

## `rebase cron`

I job pianificati dell'applicazione (`backend/crons/*`).

```bash
rebase cron list
rebase cron logs nightly-backup -n 5
rebase cron run cleanup-sessions --yes
rebase cron disable nightly-backup --yes
rebase cron reset nightly-backup          # the job's code decides again
```

`enable` e `disable` sovrascrivono il codice del job su ogni processo, anche tra i vari redeploy; `run` chiede prima conferma e `--async` risponde non appena l'esecuzione è avviata. Su un progetto Cloud, `rebase cron` non richiede l'accesso a Studio per le operazioni di lettura: richiede al control plane un token di piattaforma temporaneo `cron:read`, posseduto da qualsiasi membro con accesso ai log. `run`, `enable`, `disable` e `reset` richiedono `cron:write`, che solo un proprietario o un amministratore dell'organizzazione possiede su un progetto con Studio attivo. `rebase cloud cron` è la variante precedente, di sola lettura.

## `rebase logs`

I log delle richieste e dell'applicazione del server — il buffer letto dal Logs Explorer di Studio — una tantum oppure seguiti in tempo reale con `-f`.

```bash
rebase logs -n 50 --level warn
rebase logs -f --source auth --search "sign-in"
```

Il buffer appartiene a un singolo processo. Con `--project` o `--cloud` corrisponde a `rebase cloud logs --runtime`: l'output di ogni replica, attraverso il control plane.

## `rebase functions`

Le route personalizzate dell'applicazione, una per file in `backend/functions/`.

```bash
rebase functions list
rebase functions invoke hello --anon
rebase functions invoke billing webhook -X POST --input event.json
```

`invoke` accetta i campi, il body e gli header accettati da `rebase api` e stampa la risposta così come viene ricevuta. Le funzioni gestiscono autonomamente il proprio controllo degli accessi, quindi le credenziali sono determinanti: `--anon` mostra ciò che riceve un visitatore.

## `rebase storage`

I file archiviati, tramite le policy di archiviazione. Il percorso di archiviazione inizia con i due punti: `:avatars/me.png` nell'origine predefinita, `media:avatars/me.png` nell'origine denominata `media`.

```bash
rebase storage ls :avatars
rebase storage cp ./me.png :avatars/me.png
rebase storage cp :avatars/me.png ./me.png
rebase storage url :avatars/me.png      # a signed link: whoever holds it reads the file until it expires
rebase storage stat :avatars/me.png
rebase storage rm :avatars/me.png --yes
```

`cp --public` esegue l'upload sotto il prefisso pubblico (un URL permanente senza token), `--content-type` imposta il tipo e `--force` sovrascrive un file locale durante il download. `orphans` e `move` costituiscono la parte del gruppo dedicata alla manutenzione dell'intero storage.

## `rebase rls simulate`

Cosa vedrebbe un'altra identità, tramite il simulatore RLS dell'applicazione — lo stesso utilizzato dalla funzione "view as" di Studio: per ciascuna tabella, le righe che legge rispetto a quelle lette dall'utente corrente, le tabelle da cui i suoi scope la escludono e le colonne che non può leggere. In sola lettura.

```bash
rebase auth login --email you@example.com
rebase rls simulate --role anon
rebase rls simulate --user 3f0c9a7e-… --table posts
rebase rls simulate --key <api-key-id>
rebase rls options
```

Il simulatore risponde esclusivamente alla sessione di un amministratore e mai a una chiave, quindi questo comando invia la sessione memorizzata da `rebase auth login`. `rebase verify --live` verifica le policy stesse, a prescindere da una specifica identità.

## `rebase auth login`, `emails` e `keys`

Alcune route rispondono a una persona e mai a una macchina: il simulatore RLS, le chiavi personali, l'applicazione live dello schema. `rebase auth login` effettua l'accesso a un'applicazione in esecuzione — tramite browser quando il server supporta l'accesso da dispositivo, altrimenti con `--email` e una password (`--code` per il secondo fattore) — e memorizza la sessione in `~/.rebase/sessions.json`, suddivisa per server, mai all'interno del progetto. `auth whoami` indica l'identità rilevata dal server e gli scope posseduti; `auth logout` termina la sessione anche su di esso.

```bash
rebase auth login --email you@example.com
rebase auth whoami --session
rebase auth emails --latest --links      # the dev mailbox: sign-in, reset and magic-link mail with no SMTP_HOST
rebase auth keys create --name ci --scopes data:read:posts --expires-in 30
rebase auth keys revoke <id> --yes
```

`auth emails` legge la casella di posta per lo sviluppo che un server senza `SMTP_HOST` mantiene invece di inviare le email; `--clear` la svuota. `auth keys` gestisce le tue chiavi personali `rk_`, che operano a tuo nome, limitate agli scope specificati; il server risponde solo se la tabella auth imposta `auth.personalKeys: true`. Le chiavi di servizio sono gestite tramite `rebase api-keys`, che include ora anche `update <id>`.

## Prossimi passi

- [Indice degli endpoint](/docs/backend/endpoints/) — ogni route raggiunta da questi comandi e lo scope richiesto da ciascuna
- [API REST](/docs/backend/api/) — la sintassi per filtri, ordinamento e paginazione inoltrata da `rebase data`
- [rebase cloud](/docs/cli/cloud/) — il progetto su Rebase Cloud: deploy, variabili d'ambiente, backup, accesso a Studio
- [Riferimento CLI](/docs/cli/) — tutti gli altri comandi
