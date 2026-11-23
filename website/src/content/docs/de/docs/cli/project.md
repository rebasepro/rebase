---
sourceHash: 1f147c4f06a5601d
title: Eine laufende App
sidebar_label: Eine laufende App
description: CLI-Befehle, die über ihre API auf eine laufende Rebase-App zugreifen – Zeilen, Benutzer, Cron, Protokolle, Funktionen, Dateien, der RLS-Simulator – auf rebase dev, einem benannten Server oder einem Rebase Cloud-Projekt.
---

Diese Befehle kommunizieren über ihre eigene API mit einer laufenden App, sodass Row-Level Security, Feldzugriff, Hooks und Speicher-Policies darüber entscheiden, was sie tun dürfen, genau wie beim SDK. Sie erreichen das lokale `rebase dev`, einen benannten Server oder ein Rebase Cloud-Projekt – überall mit denselben Flags.

## Auswahl von Server und Anmeldedaten

| Flag | Wohin Anfragen gehen und als wer |
|---|---|
| *(keins)* | `REBASE_BASE_URL` (Shell, dann `.env`), andernfalls das `rebase dev`, das dieser Checkout ausführt; mit dem Service-Key aus `.env` |
| `--url <server>` | Dieser Server, mit dem Service-Key aus `.env` |
| `--project <slug>` | Ein Rebase Cloud-Projekt über den Studio-Proxy der Konsole: Sie melden sich mit `rebase cloud login` an, und die Control Plane hängt den Key der App serverseitig an, sodass kein Key Ihre Maschine erreicht. Für Organisationsinhaber und -administratoren bei einem Projekt, dessen Studio-Zugriff aktiviert ist (`rebase cloud settings set --studio on`) |
| `--cloud` | Das Rebase Cloud-Projekt, mit dem dieses Verzeichnis verknüpft ist |
| `--token <bearer>` | Stattdessen diesen Bearer-Token senden: ein `rk_`-Key oder das Access-Token eines Benutzers. Bei einem Cloud-Projekt geht dies an die eigene Adresse der App |
| `--session` | Die persönliche Sitzung senden, die `rebase auth login` für diesen Server gespeichert hat |
| `--anon` | Nichts senden: was ein anonymer Besucher erhält |

Es wird nichts anderes erraten: Ohne `REBASE_BASE_URL` und ohne laufendes `rebase dev` verweigert ein Befehl die Ausführung, anstatt den Service-Key an irgendeinen Dienst zu senden, der an einem Port lauscht. Das laufende `rebase dev` ist die Instanz, deren Prozess aktiv ist, an dem Port, den sein Backend gemeldet hat (`.rebase/dev.json`, andernfalls das backend-eigene `.rebase/state.json`); `.rebase-dev-url` ist für Ihre Skripte gedacht und bleibt nach einem abgebrochenen Lauf zurück, weshalb kein Befehl diese Datei liest. Jeder Befehl akzeptiert `--json` (und gibt JSON aus, wann immer stdout kein Terminal ist, wie bei `rebase cloud`) und `--yes`, womit die Bestätigung beantwortet wird, die jeder destruktive Befehl anfordert; ohne Terminal verweigert er die Ausführung mit `confirmation_required`, anstatt eine Eingabeaufforderung anzuzeigen.

`rebase api-keys`, `rebase storage orphans|move` und `rebase schema reconcile` akzeptieren dieselben Flags.

## `rebase api`

Jede Route, die die App bereitstellt, mit den Anmeldedaten des Projekts – die vielen Sonderfälle, für die es keinen eigenen Befehl gibt: das Aktualisieren einer Materialized View, das RLS-Audit, `/api/meta/contract`, eine von einem Plugin hinzugefügte Route.

```bash
rebase api data/posts -f status=eq.published -f limit=5   # GET /api/data/posts?status=eq.published&limit=5
rebase api POST data/posts -F title=Hello -F published=true
rebase api /api/admin/rls-audit --project acme
rebase api PATCH data/posts/42 --input change.json --include
```

Ein Pfad ohne führendes `/` liegt unter `/api`. `-f key=value` ist ein String-Feld und `-F` ein typisiertes Feld (`true`, `false`, `null`, Zahlen, JSON, `@file`); Felder bilden den Query-String bei GET, HEAD oder DELETE und andernfalls einen JSON-Body. Anders als bei `gh api` macht ein Feld allein die Anfrage niemals zu einem POST: Eine Schreiboperation gibt ihre Methode explizit an oder enthält `--input`. Die Antwort wird so ausgegeben, wie sie empfangen wurde – JSON formatiert (pretty-printed) – und eine Nicht-2xx-Antwort wird ausgegeben und beendet den Befehl mit Exit-Code 1. Ein `Authorization`-Header wird abgelehnt; die Ziel-Flags bestimmen die Anmeldedaten.

## `rebase data`

Die Zeilen einer Tabelle über `/api/data`. Filter entsprechen denen der API (`?status=eq.published`) und werden wie angegeben durchgereicht: `--where status=eq.published`, `--where price=gte.10` sowie ein einfaches `--where status=draft` für Gleichheit.

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

| Aktion | Hinweise |
|---|---|
| `query <table>` | `--where`, `--or`, `--order-by col[:desc]` (wiederholbar), `--limit`, `--offset`, `--fields a,b`, `--include`, `--search`, `--deleted include\|only`; `--all` durchläuft jede Seite; `--format table\|json\|ndjson\|csv` (csv und ndjson streamen bei `--all`) |
| `get <table> <id>` | Eine Zeile, mit `--fields` und `--include` |
| `count <table>` | Die Zeilen, die auf `--where` zutreffen |
| `aggregate <table>` | `--select` und `--group-by`, entsprechend der API |
| `insert <table>` | `--data <json>` oder `--file <path\|->`; ein Array entspricht mehreren Zeilen in einem Bulk-Schreibvorgang; `--upsert <column>` |
| `update <table> [<id>]` | Eine Zeile oder jede Zeile, die auf `--where` zutrifft, nach Zählung und Bestätigung; `--if-match <etag>` |
| `delete <table> [<id>]` | Fragt zuerst nach Bestätigung; `--hard` bei einer Tabelle mit Soft-Delete |
| `import <table>` | `--file` (JSON-Array, NDJSON oder CSV nach Dateiendung, oder `--format`), in Batches (`--batch`); `--upsert`, `--ignore-duplicates`. Liest zurück, was `query --format json` schreibt |
| `history <table> <id>`, `revert <table> <id> <historyId>` | Tabellen mit aktivierter Historie |
| `watch <table>` | Die übereinstimmenden Zeilen bei jeder Änderung über den Realtime-Socket. Nicht über den Studio-Proxy: Bei einem Cloud-Projekt `--token` oder `--session` übergeben |

Der Service-Key entspricht der `admin`-Rolle: Row-Level Security greift weiterhin unter dieser Rolle. Übergeben Sie `--token`, `--session` oder `--anon`, um die Tabelle aus der Sicht einer anderen Identität zu sehen.

## `rebase schema show`

Die Tabellen oder die Spalten, Relationen und Row-Level Security einer einzelnen Tabelle – standardmäßig aus `backend/schema` oder mit `--remote` (bzw. einem beliebigen Ziel-Flag), wie der laufende Server sie für diese Anmeldedaten beschreibt. Anmeldedaten ohne `schema:read` sehen keine Policies, und eine Tabelle, die nicht gelesen werden kann, wird nicht aufgeführt.

```bash
rebase schema show
rebase schema show posts --remote --project acme
```

## `rebase users`

Die Accounts über `/api/admin/users`, `/roles` und `/guests`. Ein Account wird über seine UID oder seine E-Mail-Adresse identifiziert (eine exakte Übereinstimmung, niemals der erste unscharfe Treffer).

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

`create` versendet eine Einladung per E-Mail oder gibt einmalig ein temporäres Passwort zurück, wenn keine E-Mail gesendet werden kann. `--no-invite` erstellt den Account ohne Passwort und sendet nichts, gedacht für eine App, bei der die Anmeldung über Magic-Links, E-Mail-Codes oder einen Provider erfolgt (`POST /api/admin/users` mit `invite: false`). Das Zuweisen einer Rolle, `--disable`, `delete` und `mfa-reset` erfordern eine Bestätigung. Kein Aufrufer darf eine Rolle vergeben, die über der eigenen steht, oder Aktionen auf einem Account ausführen, der höher eingestuft ist. `rebase auth reset-password` ist die ältere Schreibweise und greift weiterhin auf die Datenbank zurück, wenn der Server nicht läuft.

### Accounts importieren

`import` übernimmt Accounts aus einem anderen System und behält deren IDs bei, sodass Zeilen, die auf einen Benutzer verweisen, weiterhin auf denselben Benutzer zeigen. Akzeptiert CSV, ein JSON-Array oder NDJSON (`--format`, andernfalls nach Dateiendung) mit folgenden Spalten:

| Spalte | |
|---|---|
| `id` | Wird als ID des Accounts beibehalten. Optional: Ohne Angabe generiert die Tabelle `users` eine. Eine UUID ist der Regelfall; Buchstaben, Ziffern und `_ - . : \|` bis zu 128 Zeichen sind ebenfalls zulässig, wobei eine Spalte vom Typ `uuid` nur UUIDs akzeptiert |
| `email` | Erforderlich |
| `display_name` / `displayName` | |
| `photo_url` / `photoUrl` | |
| `created_at` / `createdAt` | Wann der Account dort erstellt wurde. Optional: jetzt |
| `email_verified` / `emailVerified` | `true`/`t`/`1` oder `false`/`f`/`0`. Optional: `false`, und der erste Magic-Link oder Passwort-Reset, dem der Account folgt, bestätigt die Adresse |
| `roles` | `editor;viewer`, in Anführungszeichen `"editor,viewer"` oder ein Postgres-Array `{editor,viewer}` |

Es werden weder Passwörter noch Hashes importiert, und es wird keine E-Mail gesendet: Ein importierter Account meldet sich über einen Magic-Link, einen E-Mail-Code, einen Provider oder einen Passwort-Reset an. Ein Account, dessen ID oder E-Mail bereits vergeben ist, wird als übersprungen gemeldet und unverändert belassen (niemals aktualisiert), sodass eine Datei erneut ausgeführt werden kann. Jeder Account wird als erstellt, übersprungen oder fehlgeschlagen mit entsprechendem Grund protokolliert; der Befehl beendet sich mit Exit-Code 1, wenn mindestens ein Eintrag fehlschlägt. `--dry-run` prüft jeden Account und schreibt nichts. Die CLI sendet 100 Accounts pro Anfrage (`POST /api/admin/users/import`), gleichermaßen auf `rebase dev`, einem Server oder einem Rebase Cloud-Projekt.

Aus Supabase:

```bash
SUPABASE_DB_URL="postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres"
psql "$SUPABASE_DB_URL" -c "\copy (select id, email, created_at, email_confirmed_at is not null as email_verified from auth.users) to users.csv csv header"
rebase users import users.csv --dry-run
rebase users import users.csv --project my-app
```

## `rebase cron`

Die geplanten Jobs (Scheduled Jobs) der App (`backend/crons/*`).

```bash
rebase cron list
rebase cron logs nightly-backup -n 5
rebase cron run cleanup-sessions --yes
rebase cron disable nightly-backup --yes
rebase cron reset nightly-backup          # the job's code decides again
```

`enable` und `disable` überschreiben den Code des Jobs auf jedem Prozess über Redeployments hinweg; `run` verlangt eine Bestätigung, und `--async` antwortet, sobald der Lauf gestartet wurde. Bei einem Cloud-Projekt benötigt `rebase cron` für Leseoperationen keinen Studio-Zugriff: Es fordert von der Control Plane ein kurzlebiges `cron:read`-Plattform-Token an, über das jedes Mitglied mit Protokollzugriff verfügt. `run`, `enable`, `disable` und `reset` erfordern `cron:write`, das ein Organisationsinhaber oder -administrator bei einem Projekt mit aktiviertem Studio besitzt. `rebase cloud cron` ist die ältere, rein lesende Schreibweise.

## `rebase logs`

Das Anfrage- und Anwendungsprotokoll des Servers – der Puffer, den die Protokollansicht von Studio liest – einmalig oder fortlaufend mit `-f`.

```bash
rebase logs -n 50 --level warn
rebase logs -f --source auth --search "sign-in"
```

Der Puffer stammt von einem einzelnen Prozess. Mit `--project` oder `--cloud` entspricht dies `rebase cloud logs --runtime`: die Ausgabe aller Replikate über die Control Plane.

## `rebase functions`

Die eigenen Routen der App, eine pro Datei in `backend/functions/`.

```bash
rebase functions list
rebase functions invoke hello --anon
rebase functions invoke billing webhook -X POST --input event.json
```

`invoke` akzeptiert dieselben Felder, denselben Body und dieselben Header wie `rebase api` und gibt die Antwort so aus, wie sie empfangen wurde. Funktionen bestimmen ihre Zugriffsberechtigungen selbst, weshalb die Anmeldedaten entscheidend sind: `--anon` zeigt, was ein anonymer Besucher erhält.

## `rebase storage`

Gespeicherte Dateien unter Berücksichtigung der Speicher-Policies. Die Seite des Speichers beginnt mit einem Doppelpunkt: `:avatars/me.png` in der Standardquelle, `media:avatars/me.png` in der Quelle mit dem Schlüssel `media`.

```bash
rebase storage ls :avatars
rebase storage cp ./me.png :avatars/me.png
rebase storage cp :avatars/me.png ./me.png
rebase storage url :avatars/me.png      # a signed link: whoever holds it reads the file until it expires
rebase storage stat :avatars/me.png
rebase storage rm :avatars/me.png --yes
```

`cp --public` lädt Daten unter dem öffentlichen Präfix hoch (eine permanente URL ohne Token), `--content-type` setzt den Typ und `--force` überschreibt beim Download eine lokale Datei. `orphans` und `move` bilden den Teil der Befehlsgruppe für Wartungsarbeiten am gesamten Speicher.

## `rebase rls simulate`

Was eine andere Identität sehen würde, über den RLS-Simulator der App – denselben, den Studios „Anzeigen als“ verwendet: pro Tabelle die Zeilen, die diese Identität im Vergleich zu Ihren Zeilen lesen kann, die Tabellen, von denen sie durch ihre Scopes ausgeschlossen ist, und die Spalten, die sie nicht lesen kann. Schreibgeschützt.

```bash
rebase auth login --email you@example.com
rebase rls simulate --role anon
rebase rls simulate --user 3f0c9a7e-… --table posts
rebase rls simulate --key <api-key-id>
rebase rls options
```

Der Simulator reagiert nur auf die Sitzung eines Administrators und niemals auf einen Key, daher sendet dieser Befehl die von `rebase auth login` gespeicherte Sitzung. `rebase verify --live` überprüft die Policies selbst, unabhängig von einer bestimmten Identität.

## `rebase auth login`, `emails` und `keys`

Manche Routen antworten nur einer Person und niemals einer Maschine: der RLS-Simulator, persönliche Keys, die Live-Schema-Anwendung. `rebase auth login` meldet Sie bei einer laufenden App an – über den Browser, wenn der Server die Geräteanmeldung anbietet, andernfalls mit `--email` und einem Passwort (`--code` für einen zweiten Faktor) – und speichert die Sitzung in `~/.rebase/sessions.json`, getrennt nach Server, niemals im Projekt. `auth whoami` gibt aus, als wer der Server Sie ansieht und welche Scopes Sie besitzen; `auth logout` beendet die Sitzung auch dort.

```bash
rebase auth login --email you@example.com
rebase auth whoami --session
rebase auth emails --latest --links      # the dev mailbox: sign-in, reset and magic-link mail with no SMTP_HOST
rebase auth keys create --name ci --scopes data:read:posts --expires-in 30
rebase auth keys revoke <id> --yes
```

`auth emails` liest das Entwicklungs-Postfach aus, das ein Server ohne `SMTP_HOST` anstelle des Versands führt; `--clear` leert es. Ein leeres Postfach wird unter Angabe des angefragten Servers beantwortet (`The development mailbox at http://localhost:3082 (rebase dev) is empty.` und `server` im JSON), da sich eine leere Antwort von einem anderen Backend exakt so darstellt wie eine nie gesendete E-Mail. `auth keys` verwaltet Ihre eigenen `rk_`-Keys, die in Ihrem Namen handeln, eingeschränkt auf die angegebenen Scopes; der Server antwortet darauf nur, wenn die Auth-Tabelle `auth.personalKeys: true` konfiguriert hat. Service-Keys werden über `rebase api-keys` verwaltet, das nun ebenfalls `update <id>` unterstützt.

## Nächste Schritte

- [Endpunkt-Index](/docs/backend/endpoints/) – jede Route, die diese Befehle erreichen, und der jeweils erforderliche Scope
- [REST-API](/docs/backend/api/) – die Filter-, Sortier- und Paginierungssyntax, die `rebase data` durchreicht
- [rebase cloud](/docs/cli/cloud/) – das Projekt selbst auf Rebase Cloud: Deployments, Umgebung, Backups, Studio-Zugriff
- [CLI-Referenz](/docs/cli/) – alle weiteren Befehle
