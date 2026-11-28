---
sourceHash: f6e7c705c409b9aa
title: Eine laufende App
sidebar_label: Eine laufende App
description: CLI-Befehle, die über ihre API auf eine laufende Rebase-App zugreifen – Zeilen, Benutzer, Cron, Protokolle, Funktionen, Dateien, der RLS-Simulator – auf rebase dev, einem Server Ihrer Wahl oder einem Rebase-Cloud-Projekt.
---

Diese Befehle kommunizieren über die eigene API einer laufenden App mit dieser. Daher bestimmen Row-Level Security, Feldzugriffsbeschränkungen, Hooks und Storage-Richtlinien, was sie tun dürfen – genau wie beim SDK. Sie erreichen das lokale `rebase dev`, einen von Ihnen benannten Server oder ein Rebase-Cloud-Projekt, überall mit denselben Flags.

## Server und Anmeldedaten auswählen

| Flag | Wohin Anfragen gesendet werden und als wer |
|---|---|
| *(keines)* | `REBASE_BASE_URL` (Shell, dann `.env`), andernfalls das `rebase dev`, das dieser Checkout ausführt; mit dem Service-Key aus `.env` |
| `--url <server>` | Dieser Server mit dem Service-Key aus `.env` |
| `--project <slug>` | Ein Rebase-Cloud-Projekt über den Studio-Proxy der Konsole: Sie melden sich mit `rebase cloud login` an, und die Control-Plane hängt den Schlüssel der App serverseitig an, sodass kein Schlüssel Ihren Rechner erreicht. Organisationsinhaber und Administratoren bei einem Projekt, dessen Studio-Zugriff aktiviert ist (`rebase cloud settings set --studio on`) |
| `--cloud` | Das Rebase-Cloud-Projekt, mit dem dieses Verzeichnis verknüpft ist |
| `--token <bearer>` | Diesen Bearer-Token stattdessen senden: ein `rk_`-Schlüssel oder das Zugriffstoken eines Benutzers. Bei einem Cloud-Projekt geht dies an die eigene Adresse der App |
| `--session` | Die persönliche Sitzung senden, die `rebase auth login` für diesen Server gespeichert hat |
| `--anon` | Nichts senden: das, was ein Besucher erhält |

Nichts sonst wird erraten: Ohne `REBASE_BASE_URL` und ohne laufendes `rebase dev` verweigert ein Befehl die Ausführung, anstatt den Service-Key an irgendeinen Dienst zu senden, der an einem Port lauscht. Das laufende `rebase dev` ist dasjenige, dessen Prozess aktiv ist, an dem Port, den sein Backend gemeldet hat (`.rebase/dev.json`, andernfalls das backend-eigene `.rebase/state.json`); `.rebase-dev-url` ist für Ihre Skripte gedacht, und ein abgebrochener Durchlauf hinterlässt sie, sodass kein Befehl sie liest. Jeder Befehl akzeptiert `--json` (und gibt JSON aus, wann immer stdout kein Terminal ist, wie bei `rebase cloud`) sowie `--yes`, was die Bestätigung beantwortet, die jeder destruktive Befehl verlangt; ohne Terminal bricht er stattdessen mit `confirmation_required` ab, anstatt nachzufragen.

`rebase api-keys`, `rebase storage orphans|move` und `rebase schema reconcile` akzeptieren dieselben Flags.

## `rebase api`

Jede Route, die die App bereitstellt, mit den Anmeldedaten des Projekts – der lange Schwanz von Operationen, für die es keinen eigenen Befehl gibt: das Aktualisieren einer materialized View, das RLS-Audit, `/api/meta/contract`, eine von einem Plugin hinzugefügte Route.

```bash
rebase api data/posts -f status=eq.published -f limit=5   # GET /api/data/posts?status=eq.published&limit=5
rebase api POST data/posts -F title=Hello -F published=true
rebase api /api/admin/rls-audit --project acme
rebase api PATCH data/posts/42 --input change.json --include
```

Ein Pfad ohne vorangestelltes `/` befindet sich unter `/api`. `-f key=value` ist ein String-Feld und `-F` ein typisiertes Feld (`true`, `false`, `null`, Zahlen, JSON, `@file`); Felder bilden den Query-String bei einem GET, HEAD oder DELETE und andernfalls einen JSON-Body. Anders als bei `gh api` macht ein Feld allein den Request niemals zu einem POST: Eine Schreiboperation gibt ihre Methode explizit an oder übergibt `--input`. Die Antwort wird so ausgegeben, wie sie empfangen wurde – JSON formatiert (pretty-printed) – und eine Nicht-2xx-Antwort wird ausgegeben und beendet den Prozess mit Exit-Code 1. Ein `Authorization`-Header wird verweigert; die Ziel-Flags wählen die Anmeldedaten.

## `rebase data`

Die Zeilen einer Tabelle über `/api/data`. Filter entsprechen denen der API selbst (`?status=eq.published`), unverändert wie geschrieben durchgereicht: `--where status=eq.published`, `--where price=gte.10` sowie ein einfaches `--where status=draft` für Gleichheit.

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
| `insert <table>` | `--data <json>` oder `--file <path\|->`; ein Array entspricht mehreren Zeilen in einem einzigen Bulk-Schreibvorgang; `--upsert <column>` |
| `update <table> [<id>]` | Eine Zeile oder jede Zeile, die auf `--where` zutrifft, nach Zählung und Bestätigung; `--if-match <etag>` |
| `delete <table> [<id>]` | Fragt zuerst nach; `--hard` bei einer Tabelle mit Soft-Delete |
| `import <table>` | `--file` (JSON-Array, NDJSON oder CSV anhand der Dateiendung oder `--format`), in Batches (`--batch`); `--upsert`, `--ignore-duplicates`. Liest zurück, was `query --format json` ausgibt |
| `history <table> <id>`, `revert <table> <id> <historyId>` | Tabellen mit aktivierter Historie |
| `watch <table>` | Die übereinstimmenden Zeilen bei jeder Änderung über den Realtime-Socket. Nicht über den Studio-Proxy: Übergeben Sie bei einem Cloud-Projekt `--token` oder `--session` |

Der Service-Key entspricht der Rolle `admin`: Row-Level Security wird weiterhin angewendet, eben als diese Rolle. Übergeben Sie `--token`, `--session` oder `--anon`, um die Tabelle so zu sehen, wie jemand anderes sie sieht.

## `rebase schema show`

Die Tabellen oder die Spalten, Relationen und Row-Level Security einer einzelnen Tabelle – standardmäßig aus `backend/schema` oder mit `--remote` (oder einem beliebigen Ziel-Flag), wie der laufende Server sie für diese Anmeldedaten beschreibt. Anmeldedaten ohne `schema:read` sehen keine Richtlinien, und eine Tabelle, die nicht gelesen werden kann, wird nicht aufgeführt.

```bash
rebase schema show
rebase schema show posts --remote --project acme
```

## `rebase users`

Die Accounts über `/api/admin/users`, `/roles` und `/guests`. Ein Account wird über seine uid oder seine E-Mail-Adresse angegeben (eine exakte Übereinstimmung, niemals der erste unscharfe Treffer).

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

`create` versendet eine Einladung per E-Mail oder gibt einmalig ein temporäres Passwort zurück, wenn keine E-Mails versendet werden können. `--no-invite` erstellt das Konto ohne Passwort und sendet nichts – für Apps, bei denen die Anmeldung per Magic-Link, E-Mail-Code oder Provider erfolgt (`POST /api/admin/users` mit `invite: false`). Das Vergeben einer Rolle, `--disable`, `delete` und `mfa-reset` fragen zuvor um Bestätigung. Kein Aufrufer darf eine Rolle vergeben, die über der eigenen steht, oder Operationen auf einem Account ausführen, der höher eingestuft ist als er selbst. `rebase auth reset-password` ist die ältere Schreibweise und greift weiterhin direkt auf die Datenbank zurück, wenn der Server nicht läuft.

### Accounts importieren

`import` übernimmt Accounts aus einem anderen System und behält deren IDs bei, sodass Zeilen, die auf einen Benutzer verweisen, weiterhin auf denselben Benutzer zeigen. Der Befehl akzeptiert CSV, ein JSON-Array oder NDJSON (`--format`, andernfalls anhand der Dateiendung) mit folgenden Spalten:

| Spalte | |
|---|---|
| `id` | Wird als ID des Accounts beibehalten. Optional: Ohne diese Angabe generiert die Benutzertabelle eine ID. Eine UUID ist der Regelfall; Buchstaben, Ziffern und `_ - . : \|` mit bis zu 128 Zeichen sind ebenfalls zulässig, wobei eine `uuid`-ID-Spalte ausschließlich UUIDs akzeptiert |
| `email` | Erforderlich |
| `display_name` / `displayName` | |
| `photo_url` / `photoUrl` | |
| `created_at` / `createdAt` | Wann der Account dort erstellt wurde. Optional: jetzt |
| `email_verified` / `emailVerified` | `true`/`t`/`1` oder `false`/`f`/`0`. Optional: `false`, und der erste Magic-Link oder Passwort-Reset, dem der Account folgt, bestätigt sie |
| `roles` | `editor;viewer`, ein in Anführungszeichen gesetztes `"editor,viewer"` oder ein Postgres-Array `{editor,viewer}` |
| `password_hash` / `encrypted_password` | Der Hash, den das andere System gespeichert hat. Wird nur mit `--password-hashes bcrypt` gelesen; ohne dieses Flag wird eine Datei mit dieser Spalte zurückgewiesen, bevor etwas gesendet wird |

Es wird keine E-Mail gesendet. Mit `--password-hashes bcrypt` meldet sich ein Account, dessen Zeile einen Hash enthält, mit seinem bisherigen Passwort an, und bei der ersten Anmeldung wird der Hash durch den Rebase-eigenen ersetzt. Jeder andere importierte Account meldet sich per Magic-Link, E-Mail-Code, Provider oder Passwort-Reset an. Ein Klartext-Passwort wird niemals importiert. Ein Account, dessen ID oder E-Mail-Adresse bereits vergeben ist, wird als übersprungen gemeldet und unverändert belassen – niemals aktualisiert –, sodass eine Datei erneut ausgeführt werden kann. Jeder Account wird als erstellt, übersprungen oder fehlgeschlagen (mit Begründung) gemeldet; der Befehl beendet mit Exit-Code 1, falls Fehler auftraten. `--dry-run` überprüft jeden Account und schreibt nichts. Die CLI sendet 100 Accounts pro Anfrage (`POST /api/admin/users/import`), gleichermaßen auf `rebase dev`, einem Server oder einem Rebase-Cloud-Projekt.

Aus Supabase:

```bash
SUPABASE_DB_URL="postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres"
psql "$SUPABASE_DB_URL" -c "\copy (select id, email, created_at, email_confirmed_at is not null as email_verified, encrypted_password from auth.users) to users.csv csv header"
rebase users import users.csv --password-hashes bcrypt --dry-run
rebase users import users.csv --password-hashes bcrypt --project my-app
```

`users.csv` enthält dann den Passwort-Hash jedes Accounts: Löschen Sie die Datei, sobald der Import abgeschlossen ist.

## `rebase cron`

Die geplanten Jobs (Scheduled Jobs) der App (`backend/crons/*`).

```bash
rebase cron list
rebase cron logs nightly-backup -n 5
rebase cron run cleanup-sessions --yes
rebase cron disable nightly-backup --yes
rebase cron reset nightly-backup          # the job's code decides again
```

`enable` und `disable` überschreiben den Code des Jobs auf jedem Prozess, auch über Neu-Deployments hinweg; `run` fragt zuerst nach, und `--async` antwortet, sobald die Ausführung gestartet wurde. Bei einem Cloud-Projekt benötigt `rebase cron` für Lesezugriffe keinen Studio-Zugriff: Es fordert von der Control-Plane ein kurzlebiges `cron:read`-Plattform-Token an, über das jedes Mitglied mit Protokollzugriff (Log-Zugriff) verfügt. `run`, `enable`, `disable` und `reset` erfordern `cron:write`, worüber ein Organisationsinhaber oder -administrator bei einem Projekt mit aktiviertem Studio verfügt. `rebase cloud cron` ist die ältere, rein lesende Schreibweise.

## `rebase logs`

Das Request- und Anwendungsprotokoll des Servers – der Puffer, den die Protokollansicht (Logs) von Studio liest – einmalig oder fortlaufend mit `-f` verfolgt.

```bash
rebase logs -n 50 --level warn
rebase logs -f --source auth --search "sign-in"
```

Der Puffer gehört zu einem einzelnen Prozess. Mit `--project` oder `--cloud` entspricht dies `rebase cloud logs --runtime`: die Ausgabe jedes Replikats über die Control-Plane.

## `rebase functions`

Die app-eigenen Routen, eine pro Datei in `backend/functions/`.

```bash
rebase functions list
rebase functions invoke hello --anon
rebase functions invoke billing webhook -X POST --input event.json
```

`invoke` akzeptiert dieselben Felder, Body-Daten und Header wie `rebase api` und gibt die Antwort so aus, wie sie empfangen wurde. Funktionen bestimmen ihren Zugriff selbst, daher kommt es auf die Anmeldedaten an: `--anon` zeigt, was ein Besucher erhält.

## `rebase storage`

Gespeicherte Dateien über die Storage-Richtlinien. Die gespeicherte Seite beginnt mit einem Doppelpunkt: `:avatars/me.png` in der Standardquelle, `media:avatars/me.png` in der mit `media` bezeichneten Quelle.

```bash
rebase storage ls :avatars
rebase storage cp ./me.png :avatars/me.png
rebase storage cp :avatars/me.png ./me.png
rebase storage url :avatars/me.png      # a signed link: whoever holds it reads the file until it expires
rebase storage stat :avatars/me.png
rebase storage rm :avatars/me.png --yes
```

`cp --public` lädt unter dem öffentlichen Präfix hoch (eine permanente URL ohne Token), `--content-type` setzt den Typ und `--force` überschreibt beim Download eine lokale Datei. `orphans` und `move` bilden den Teil der Befehlsgruppe für die Wartung des gesamten Speichers.

## `rebase rls simulate`

Was eine andere Identität sehen würde, basierend auf dem RLS-Simulator der App – derselbe, den Studios „Anzeigen als“ (View as) verwendet: pro Tabelle die Zeilen, die sie im Vergleich zu den von Ihnen gelesenen Zeilen liest, die Tabellen, von denen sie durch ihre Scopes ausgeschlossen ist, und die Spalten, die sie nicht lesen kann. Schreibgeschützt.

```bash
rebase auth login --email you@example.com
rebase rls simulate --role anon
rebase rls simulate --user 3f0c9a7e-… --table posts
rebase rls simulate --key <api-key-id>
rebase rls options
```

Der Simulator reagiert nur auf die eigene Sitzung eines Administrators und niemals auf einen Schlüssel; daher sendet dieser Befehl die von `rebase auth login` gespeicherte Sitzung. `rebase verify --live` überprüft die Richtlinien selbst, unabhängig von einer bestimmten Identität.

## `rebase auth login`, `emails` and `keys`

Einige Routen antworten einer Person und niemals einer Maschine: der RLS-Simulator, persönliche Schlüssel, die Live-Schema-Anwendung. `rebase auth login` meldet Sie bei einer laufenden App an – über den Browser, wenn der Server Geräteanmeldung (Device Sign-In) anbietet, andernfalls mit `--email` und einem Passwort (`--code` für einen zweiten Faktor) – und speichert die Sitzung in `~/.rebase/sessions.json`, aufgeschlüsselt nach Server, niemals im Projekt. `auth whoami` gibt an, für wen der Server Sie hält und welche Scopes Sie besitzen; `auth logout` beendet die Sitzung auch dort.

```bash
rebase auth login --email you@example.com
rebase auth whoami --session
rebase auth emails --latest --links      # the dev mailbox: sign-in, reset and magic-link mail with no SMTP_HOST
rebase auth keys create --name ci --scopes data:read:posts --expires-in 30
rebase auth keys revoke <id> --yes
```

`auth emails` liest das Entwicklungs-Postfach, das ein Server ohne `SMTP_HOST` anstelle des Versendens führt; `--clear` leert es. Ein leeres Postfach wird unter Angabe des angefragten Servers beantwortet (`The development mailbox at http://localhost:3082 (rebase dev) is empty.` und `server` im JSON), da sich eine leere Antwort von einem anderen Backend genau wie eine nie gesendete E-Mail liest. `auth keys` verwaltet Ihre eigenen `rk_`-Schlüssel, die in Ihrem Namen handeln, beschränkt auf die angegebenen Scopes; der Server beantwortet dies nur, wenn in der Auth-Tabelle `auth.personalKeys: true` gesetzt ist. Service-Keys werden über `rebase api-keys` verwaltet, das nun auch `update <id>` umfasst.

## `rebase mcp`

Verbinden Sie einen KI-Client mit dem MCP-Endpunkt (`/mcp`) einer laufenden App, an dem sich ein Agent als Person anmeldet und an die Row-Level Security dieser Person gebunden ist:

```bash
rebase mcp connect                        # pick the clients from a list
rebase mcp connect --client claude-code   # or name them: claude-code, cursor, vscode, claude, chatgpt, all
rebase mcp connect --print                # print every way to connect, change nothing
rebase mcp url                            # the endpoint's URL
```

| Flag | Beschreibung |
|------|-------------|
| `--client <names>` | Die Auswahl überspringen. Kommagetrennt oder `all` |
| `--name <name>` | Der Name, unter dem der Server registriert werden soll. Standard: Name des Projekts, mit `-local` für einen Dev-Server |
| `--print` | Die URL, den Befehl für Claude Code und die Installations-Links ausgeben und nichts ändern |
| `--url <server>` | Das Backend unter dieser Adresse. Standard: `REBASE_BASE_URL`, andernfalls das laufende `rebase dev` |
| `--cloud` | Das Rebase-Cloud-Projekt, mit dem dieses Verzeichnis verknüpft ist |
| `--json` | Maschinenlesbare Ausgabe |

`rebase mcp url` akzeptiert `--url`, `--cloud` und `--json`. Wie die einzelnen Clients mit der URL umgehen, ist unter [Connecting a client](/docs/ai/remote-mcp/#connecting-a-client) beschrieben. Dies ist nicht der Entwickler-MCP-Server in `.mcp.json`, der von `rebase skills install --mcp` eingerichtet wird.

## Nächste Schritte

- [Endpunkt-Index](/docs/backend/endpoints/) – jede Route, die diese Befehle erreichen, und der jeweils erforderliche Scope
- [REST-API](/docs/backend/api/) – die Filter-, Sortier- und Paginierungssyntax, die `rebase data` durchreicht
- [rebase cloud](/docs/cli/cloud/) – das Projekt selbst auf Rebase Cloud: Deployments, Umgebung, Backups, Studio-Zugriff
- [CLI-Referenz](/docs/cli/) – alle weiteren Befehle
