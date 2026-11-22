---
sourceHash: 194ea0c912d942b7
title: Eine laufende App
sidebar_label: Eine laufende App
description: CLI-Befehle, die über ihre API auf eine laufende Rebase-App zugreifen – Zeilen, Benutzer, Cron, Logs, Funktionen, Dateien, der RLS-Simulator – unter rebase dev, einem angegebenen Server oder einem Rebase Cloud-Projekt.
---

Diese Befehle kommunizieren über deren eigene API mit einer laufenden App, sodass Row-Level Security, Feldzugriffe, Hooks und Storage-Richtlinien darüber entscheiden, was sie tun dürfen, genau wie beim SDK. Sie erreichen das lokale `rebase dev`, einen von Ihnen angegebenen Server oder ein Rebase Cloud-Projekt – überall mit denselben Flags.

## Server und Anmeldedaten auswählen

| Flag | Wohin Anfragen gesendet werden und als wer |
|---|---|
| *(keines)* | `REBASE_BASE_URL` (Shell, dann `.env`), andernfalls das `rebase dev`, das in diesem Checkout läuft; mit dem Service-Key aus `.env` |
| `--url <server>` | Dieser Server, mit dem Service-Key aus `.env` |
| `--project <slug>` | Ein Rebase Cloud-Projekt über den Studio-Proxy der Konsole: Sie melden sich mit `rebase cloud login` an, und die Control-Plane hängt den Schlüssel der App serverseitig an, sodass kein Schlüssel Ihren Rechner erreicht. Für Organisations-Eigentümer und -Admins bei einem Projekt, dessen Studio-Zugriff aktiviert ist (`rebase cloud settings set --studio on`) |
| `--cloud` | Das Rebase Cloud-Projekt, mit dem dieses Verzeichnis verknüpft ist |
| `--token <bearer>` | Diesen Bearer stattdessen senden: einen `rk_`-Schlüssel oder das Zugriffstoken eines Benutzers. Bei einem Cloud-Projekt geht dies an die eigene Adresse der App |
| `--session` | Die Benutzersitzung senden, die `rebase auth login` für diesen Server gespeichert hat |
| `--anon` | Nichts senden: was ein Besucher erhält |

Es wird nichts weiter vermutet: Ohne `REBASE_BASE_URL` und ohne laufendes `rebase dev` verweigert ein Befehl die Ausführung, anstatt den Service-Key an das zu senden, was auch immer an einem Port lauscht. Das laufende `rebase dev` ist dasjenige, dessen Prozess aktiv ist, an dem Port, den sein Backend gemeldet hat (`.rebase/dev.json`, andernfalls das backend-eigene `.rebase/state.json`); `.rebase-dev-url` ist für Ihre Skripte gedacht, und ein abgebrochener Lauf hinterlässt diese Datei, weshalb kein Befehl sie liest. Jeder Befehl akzeptiert `--json` (und gibt JSON aus, wann immer stdout kein Terminal ist, wie auch `rebase cloud`) und `--yes`, was die Bestätigung beantwortet, die jeder destruktive Befehl anfordert; ohne Terminal verweigert er die Ausführung mit `confirmation_required`, anstatt interaktiv nachzufragen.

`rebase api-keys`, `rebase storage orphans|move` und `rebase schema reconcile` akzeptieren dieselben Flags.

## `rebase api`

Jede Route, die die App bereitstellt, mit den Anmeldedaten des Projekts – der Long Tail, der keinen eigenen Befehl hat: das Aktualisieren einer materialized View, das RLS-Audit, `/api/meta/contract`, eine von einem Plugin hinzugefügte Route.

```bash
rebase api data/posts -f status=eq.published -f limit=5   # GET /api/data/posts?status=eq.published&limit=5
rebase api POST data/posts -F title=Hello -F published=true
rebase api /api/admin/rls-audit --project acme
rebase api PATCH data/posts/42 --input change.json --include
```

Ein Pfad ohne führendes `/` liegt unter `/api`. `-f key=value` ist ein String-Feld und `-F` ein typisiertes Feld (`true`, `false`, `null`, Zahlen, JSON, `@file`); Felder bilden den Query-String bei GET, HEAD oder DELETE und andernfalls einen JSON-Body. Anders als bei `gh api` macht ein Feld allein die Anfrage niemals zu einem POST: Eine Schreiboperation benennt ihre Methode oder enthält `--input`. Die Antwort wird so ausgegeben, wie sie empfangen wurde – JSON formatiert (pretty-printed) – und eine Nicht-2xx-Antwort wird ausgegeben und beendet den Prozess mit Exit-Code 1. Ein `Authorization`-Header wird abgelehnt; die Ziel-Flags wählen die Anmeldedaten aus.

## `rebase data`

Die Zeilen einer Tabelle über `/api/data`. Filter entsprechen denen der API (`?status=eq.published`) und werden wie geschrieben weitergegeben: `--where status=eq.published`, `--where price=gte.10` und ein einfaches `--where status=draft` für Gleichheit.

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
| `query <table>` | `--where`, `--or`, `--order-by col[:desc]` (wiederholbar), `--limit`, `--offset`, `--fields a,b`, `--include`, `--search`, `--deleted include\|only`; `--all` durchläuft jede Seite; `--format table\|json\|ndjson\|csv` (csv und ndjson streamen mit `--all`) |
| `get <table> <id>` | Eine Zeile, mit `--fields` und `--include` |
| `count <table>` | Die Zeilen, die auf `--where` zutreffen |
| `aggregate <table>` | `--select` und `--group-by`, wie von der API vorgegeben |
| `insert <table>` | `--data <json>` oder `--file <path\|->`; ein Array entspricht mehreren Zeilen in einem Bulk-Schreibvorgang; `--upsert <column>` |
| `update <table> [<id>]` | Eine Zeile oder jede Zeile, die auf `--where` zutrifft, nach einer Zählung und Bestätigung; `--if-match <etag>` |
| `delete <table> [<id>]` | Fragt vorher nach; `--hard` bei einer Tabelle mit Soft-Delete |
| `import <table>` | `--file` (JSON-Array, NDJSON oder CSV nach Dateiendung oder `--format`), in Batches (`--batch`); `--upsert`, `--ignore-duplicates`. Liest das wieder ein, was `query --format json` schreibt |
| `history <table> <id>`, `revert <table> <id> <historyId>` | Tabellen mit aktivierter Historie |
| `watch <table>` | Die übereinstimmenden Zeilen bei jeder Änderung über den Realtime-Socket. Nicht über den Studio-Proxy: Übergeben Sie bei einem Cloud-Projekt `--token` oder `--session` |

Der Service-Key entspricht der Rolle `admin`: Row-Level Security greift weiterhin, unter dieser Rolle. Übergeben Sie `--token`, `--session` oder `--anon`, um die Tabelle aus der Sicht einer anderen Identität zu sehen.

## `rebase schema show`

Die Tabellen oder die Spalten, Relationen und Row-Level Security einer einzelnen Tabelle – standardmäßig aus `backend/schema` oder mit `--remote` (oder einem beliebigen Ziel-Flag), so wie der laufende Server sie für diese Anmeldedaten beschreibt. Anmeldedaten ohne `schema:read` sehen keine Richtlinien, und eine Tabelle, die nicht gelesen werden darf, wird nicht aufgelistet.

```bash
rebase schema show
rebase schema show posts --remote --project acme
```

## `rebase users`

Die Konten über `/api/admin/users`, `/roles` und `/guests`. Ein Konto wird über seine uid oder seine E-Mail-Adresse angegeben (eine exakte Übereinstimmung, niemals der erste unscharfe Treffer).

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

`create` versendet eine Einladung per E-Mail oder gibt einmalig ein temporäres Passwort zurück, wenn keine E-Mail gesendet werden kann. `--no-invite` erstellt das Konto ohne Passwort und versendet nichts – für Apps, bei denen die Anmeldung über Magic-Links, E-Mail-Codes oder Drittanbieter erfolgt (`POST /api/admin/users` mit `invite: false`). Das Zuweisen einer Rolle, `--disable`, `delete` und `mfa-reset` erfordern vorher eine Bestätigung. Kein Aufrufer darf eine Rolle vergeben, die über der eigenen liegt, oder Aktionen für ein Konto ausführen, das höher eingestuft ist. `rebase auth reset-password` ist die ältere Schreibweise und greift weiterhin auf die Datenbank zurück, wenn der Server nicht läuft.

### Konten importieren

`import` übernimmt Konten aus einem anderen System und behält deren IDs bei, sodass Zeilen, die auf einen Benutzer verweisen, weiterhin auf denselben verweisen. Der Befehl akzeptiert CSV, ein JSON-Array oder NDJSON (`--format`, andernfalls nach Dateiendung) mit folgenden Spalten:

| Spalte | |
|---|---|
| `id` | Wird als ID des Kontos beibehalten. Optional: Ohne diese Angabe generiert die Users-Tabelle eine ID. Eine UUID ist der Regelfall; Buchstaben, Ziffern und `_ - . : \|` mit bis zu 128 Zeichen sind ebenfalls zulässig, wobei eine `uuid`-ID-Spalte nur UUIDs akzeptiert |
| `email` | Erforderlich |
| `display_name` / `displayName` | |
| `photo_url` / `photoUrl` | |
| `created_at` / `createdAt` | Wann das Konto dort erstellt wurde. Optional: jetzt |
| `email_verified` / `emailVerified` | `true`/`t`/`1` oder `false`/`f`/`0`. Optional: `false`; der erste Magic-Link oder Passwort-Reset, dem das Konto folgt, bestätigt dies |
| `roles` | `editor;viewer`, in Anführungszeichen `"editor,viewer"` oder ein Postgres-Array `{editor,viewer}` |

Es werden weder Passwörter noch Hashes importiert und es wird keine E-Mail versendet: Ein importiertes Konto meldet sich per Magic-Link, E-Mail-Code, Drittanbieter oder Passwort-Reset an. Ein Konto, dessen ID oder E-Mail bereits vergeben ist, wird als übersprungen gemeldet und unverändert gelassen (niemals aktualisiert), sodass eine Datei erneut ausgeführt werden kann. Jedes Konto wird mit dem entsprechenden Status (erstellt, übersprungen oder fehlgeschlagen) samt Grund gemeldet; der Befehl beendet mit Exit-Code 1, falls Fehler aufgetreten sind. `--dry-run` überprüft jedes Konto, ohne Schreibvorgänge durchzuführen. Die CLI sendet 100 Konten pro Anfrage (`POST /api/admin/users/import`), gleichermaßen bei `rebase dev`, einem Server oder einem Rebase Cloud-Projekt.

Von Supabase:

```bash
SUPABASE_DB_URL="postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres"
psql "$SUPABASE_DB_URL" -c "\copy (select id, email, created_at, email_confirmed_at is not null as email_verified from auth.users) to users.csv csv header"
rebase users import users.csv --dry-run
rebase users import users.csv --project my-app
```

## `rebase cron`

Die geplanten Aufgaben (Cronjobs) der App (`backend/crons/*`).

```bash
rebase cron list
rebase cron logs nightly-backup -n 5
rebase cron run cleanup-sessions --yes
rebase cron disable nightly-backup --yes
rebase cron reset nightly-backup          # the job's code decides again
```

`enable` und `disable` überschreiben den Code des Jobs auf jedem Prozess über Re-Deployments hinweg; `run` fragt vorher nach, und `--async` antwortet, sobald die Ausführung gestartet wurde. Bei einem Cloud-Projekt benötigt `rebase cron` für Lesezugriffe keinen Studio-Zugriff: Es fordert von der Control-Plane ein kurzlebiges `cron:read`-Plattform-Token an, über das jedes Mitglied mit Protokollzugriff verfügt. `run`, `enable`, `disable` und `reset` erfordern `cron:write`, was Organisations-Eigentümer oder Admins bei einem Projekt mit aktiviertem Studio besitzen. `rebase cloud cron` ist die ältere, rein lesende Schreibweise.

## `rebase logs`

Das Anfrage- und Anwendungsprotokoll des Servers – der Puffer, den der Studio Logs Explorer liest – einmalig oder fortlaufend mit `-f`.

```bash
rebase logs -n 50 --level warn
rebase logs -f --source auth --search "sign-in"
```

Der Puffer gehört zu einem einzelnen Prozess. Mit `--project` oder `--cloud` entspricht dies `rebase cloud logs --runtime`: die Ausgabe jedes Replikats über die Control-Plane.

## `rebase functions`

Die anwendungseigenen Routen, eine pro Datei in `backend/functions/`.

```bash
rebase functions list
rebase functions invoke hello --anon
rebase functions invoke billing webhook -X POST --input event.json
```

`invoke` nimmt dieselben Felder, Body-Daten und Header wie `rebase api` entgegen und gibt die Antwort so aus, wie sie empfangen wurde. Funktionen bestimmen ihre Zugriffsberechtigungen selbst, daher spielen die Anmeldedaten eine Rolle: `--anon` zeigt, was ein Besucher erhält.

## `rebase storage`

Gespeicherte Dateien über die Storage-Richtlinien. Die gespeicherte Seite beginnt mit einem Doppelpunkt: `:avatars/me.png` in der Standardquelle, `media:avatars/me.png` in der mit `media` benannten Quelle.

```bash
rebase storage ls :avatars
rebase storage cp ./me.png :avatars/me.png
rebase storage cp :avatars/me.png ./me.png
rebase storage url :avatars/me.png      # a signed link: whoever holds it reads the file until it expires
rebase storage stat :avatars/me.png
rebase storage rm :avatars/me.png --yes
```

`cp --public` lädt Dateien unter dem öffentlichen Präfix hoch (eine permanente URL ohne Token), `--content-type` setzt den Typ und `--force` überschreibt beim Download eine lokale Datei. `orphans` und `move` bilden den Teil der Befehlsgruppe für die Wartung des gesamten Speichers.

## `rebase rls simulate`

Was eine andere Identität sehen würde, basierend auf dem RLS-Simulator der App – derselbe, den auch die „View as“-Funktion von Studio nutzt: pro Tabelle die Zeilen, die sie liest, im Vergleich zu den Zeilen, die Sie lesen, die Tabellen, von denen sie durch Scopes ausgeschlossen ist, und die Spalten, die sie nicht lesen kann. Schreibgeschützt.

```bash
rebase auth login --email you@example.com
rebase rls simulate --role anon
rebase rls simulate --user 3f0c9a7e-… --table posts
rebase rls simulate --key <api-key-id>
rebase rls options
```

Der Simulator antwortet auf die eigene Sitzung eines Administrators und niemals auf einen Schlüssel; daher sendet dies die Sitzung, die `rebase auth login` gespeichert hat. `rebase verify --live` prüft die Richtlinien selbst, unabhängig von einer bestimmten Identität.

## `rebase auth login`, `emails` und `keys`

Einige Routen antworten nur einer Person und niemals einer Maschine: der RLS-Simulator, persönliche Schlüssel, Live-Schema-Anwendungen. `rebase auth login` meldet Sie an einer laufenden App an – über den Browser, wenn der Server die Geräteanmeldung (Device Sign-in) anbietet, andernfalls mit `--email` und einem Passwort (`--code` für einen zweiten Faktor) – und speichert die Sitzung in `~/.rebase/sessions.json`, aufgeschlüsselt nach Server, niemals im Projekt. `auth whoami` zeigt, als wer der Server Sie ansieht und welche Scopes Sie besitzen; `auth logout` beendet die Sitzung auch dort.

```bash
rebase auth login --email you@example.com
rebase auth whoami --session
rebase auth emails --latest --links      # the dev mailbox: sign-in, reset and magic-link mail with no SMTP_HOST
rebase auth keys create --name ci --scopes data:read:posts --expires-in 30
rebase auth keys revoke <id> --yes
```

`auth emails` liest das Entwicklungs-Postfach aus, das ein Server ohne `SMTP_HOST` führt, anstatt E-Mails zu versenden; `--clear` leert es. Ein leeres Postfach wird mit dem abgefragten Server beantwortet (`The development mailbox at http://localhost:3082 (rebase dev) is empty.` und `server` im JSON), da sich eine leere Antwort von einem anderen Backend genau wie eine nie gesendete E-Mail liest. `auth keys` verwaltet Ihre eigenen `rk_`-Schlüssel, die in Ihrem Namen agieren, eingeschränkt auf die angegebenen Scopes; der Server antwortet darauf nur, wenn die Auth-Tabelle `auth.personalKeys: true` festlegt. Service-Keys werden über `rebase api-keys` verwaltet, das nun auch `update <id>` unterstützt.

## Nächste Schritte

- [Endpunkt-Index](/docs/backend/endpoints/) — jede Route, die diese Befehle erreichen, und die jeweils erforderlichen Scopes
- [REST-API](/docs/backend/api/) — die Filter-, Sortier- und Paginierungs-Syntax, die `rebase data` durchreicht
- [rebase cloud](/docs/cli/cloud/) — das Projekt selbst auf Rebase Cloud: Deployments, Umgebung, Backups, Studio-Zugriff
- [CLI-Referenz](/docs/cli/) — alle weiteren Befehle
