---
sourceHash: ba06503a40ad1397
title: Eine laufende App
sidebar_label: Eine laufende App
description: CLI-Befehle, die über die API mit einer laufenden Rebase-App interagieren – Zeilen, Benutzer, Cron, Logs, Funktionen, Dateien, der RLS-Simulator – auf rebase dev, einem angegebenen Server oder einem Rebase Cloud-Projekt.
---

Diese Befehle kommunizieren über deren eigene API mit einer laufenden App, sodass Row-Level Security, Feldzugriff, Hooks und Storage-Richtlinien bestimmen, was sie tun dürfen, genau wie beim SDK. Sie erreichen das lokale `rebase dev`, einen angegebenen Server oder ein Rebase Cloud-Projekt mit überall denselben Flags.

## Server und Anmeldedaten auswählen

| Flag | Wohin Anfragen gehen und als wer |
|---|---|
| *(keines)* | `REBASE_BASE_URL` (Shell, dann `.env`), andernfalls das `rebase dev`, das in diesem Checkout läuft; mit dem Service-Key aus `.env` |
| `--url <server>` | Dieser Server, mit dem Service-Key aus `.env` |
| `--project <slug>` | Ein Rebase Cloud-Projekt über den Studio-Proxy der Konsole: Sie melden sich mit `rebase cloud login` an, und die Control Plane hängt den App-Key serverseitig an, sodass kein Schlüssel Ihren Rechner erreicht. Für Organisationsinhaber und Admins bei einem Projekt, dessen Studio-Zugriff aktiviert ist (`rebase cloud settings set --studio on`) |
| `--cloud` | Das Rebase Cloud-Projekt, mit dem dieses Verzeichnis verknüpft ist |
| `--token <bearer>` | Stattdessen diesen Bearer senden: ein `rk_`-Key oder das Access-Token eines Benutzers. Bei einem Cloud-Projekt geht dies an die eigene Adresse der App |
| `--session` | Die Personensitzung senden, die `rebase auth login` für diesen Server gespeichert hat |
| `--anon` | Nichts senden: was ein Besucher erhält |

Es wird nichts weiter erraten: Ohne `REBASE_BASE_URL` und ohne laufendes `rebase dev` verweigert ein Befehl die Ausführung, anstatt den Service-Key an das zu senden, was auch immer an einem Port lauscht. Jeder Befehl akzeptiert `--json` (und gibt JSON aus, wann immer stdout kein Terminal ist, wie bei `rebase cloud`) und `--yes`, womit die Bestätigung beantwortet wird, die jeder destruktive Befehl verlangt; ohne Terminal bricht er mit `confirmation_required` ab, anstatt eine Eingabeaufforderung anzuzeigen.

`rebase api-keys`, `rebase storage orphans|move` und `rebase schema reconcile` akzeptieren dieselben Flags.

## `rebase api`

Jede Route, die die App bereitstellt, mit den Anmeldedaten des Projekts – der Long Tail, der keinen eigenen Befehl hat: der Refresh einer Materialized View, das RLS-Audit, `/api/meta/contract`, eine von einem Plugin hinzugefügte Route.

```bash
rebase api data/posts -f status=eq.published -f limit=5   # GET /api/data/posts?status=eq.published&limit=5
rebase api POST data/posts -F title=Hello -F published=true
rebase api /api/admin/rls-audit --project acme
rebase api PATCH data/posts/42 --input change.json --include
```

Ein Pfad ohne führendes `/` liegt unter `/api`. `-f key=value` ist ein String-Feld und `-F` ein typisiertes Feld (`true`, `false`, `null`, Zahlen, JSON, `@file`); Felder bilden den Query-String bei GET, HEAD oder DELETE und andernfalls einen JSON-Body. Anders als bei `gh api` macht ein Feld allein den Request niemals zu einem POST: Eine Schreiboperation gibt ihre Methode an oder enthält `--input`. Die Antwort wird so ausgegeben, wie sie empfangen wurde – JSON formatiert (pretty-printed) – und eine Nicht-2xx-Antwort wird ausgegeben und beendet den Prozess mit Exit-Code 1. Ein `Authorization`-Header wird abgelehnt; die Ziel-Flags bestimmen die Anmeldedaten.

## `rebase data`

Die Zeilen einer Tabelle über `/api/data`. Filter entsprechen denen der API selbst (`?status=eq.published`) und werden wie eingegeben durchgereicht: `--where status=eq.published`, `--where price=gte.10` und ein einfaches `--where status=draft` für Gleichheit.

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
| `query <table>` | `--where`, `--or`, `--order-by col[:desc]` (wiederholbar), `--limit`, `--offset`, `--fields a,b`, `--include`, `--search`, `--deleted include\|only`; `--all` durchläuft jede Seite; `--format table\|json\|ndjson\|csv` (CSV und NDJSON streamen bei `--all`) |
| `get <table> <id>` | Eine Zeile, mit `--fields` und `--include` |
| `count <table>` | Die Zeilen, auf die `--where` zutrifft |
| `aggregate <table>` | `--select` und `--group-by`, wie von der API vorgegeben |
| `insert <table>` | `--data <json>` oder `--file <path\|->`; ein Array entspricht mehreren Zeilen in einem Bulk-Schreibvorgang; `--upsert <column>` |
| `update <table> [<id>]` | Eine Zeile oder jede Zeile, auf die `--where` zutrifft, nach einem Count und einer Bestätigung; `--if-match <etag>` |
| `delete <table> [<id>]` | Fragt vorher nach; `--hard` bei einer Tabelle mit Soft-Delete |
| `import <table>` | `--file` (JSON-Array, NDJSON oder CSV anhand der Dateiendung oder `--format`), in Batches (`--batch`); `--upsert`, `--ignore-duplicates`. Was `query --format json` schreibt, liest dies wieder ein |
| `history <table> <id>`, `revert <table> <id> <historyId>` | Tabellen mit aktivierter Historie |
| `watch <table>` | Die passenden Zeilen bei jeder Änderung über den Realtime-Socket. Nicht über den Studio-Proxy: Bei einem Cloud-Projekt `--token` oder `--session` übergeben |

Der Service-Key entspricht der `admin`-Rolle: Row-Level Security greift weiterhin, jedoch als diese Rolle. Übergeben Sie `--token`, `--session` oder `--anon`, um die Tabelle so zu sehen, wie jemand anderes sie sieht.

## `rebase schema show`

Die Tabellen oder die Spalten, Relationen und Row-Level Security einer einzelnen Tabelle – standardmäßig aus `backend/schema` oder mit `--remote` (bzw. einem beliebigen Ziel-Flag), wie der laufende Server sie für diese Anmeldedaten beschreibt. Anmeldedaten ohne `schema:read` sehen keine Richtlinien, und eine Tabelle, die sie nicht lesen können, wird nicht aufgeführt.

```bash
rebase schema show
rebase schema show posts --remote --project acme
```

## `rebase users`

Die Konten über `/api/admin/users`, `/roles` und `/guests`. Ein Konto wird über seine UID oder seine E-Mail-Adresse identifiziert (eine exakte Übereinstimmung, niemals der erste unscharfe Treffer).

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

`create` versendet eine Einladung per E-Mail oder gibt einmalig ein temporäres Passwort zurück, wenn keine E-Mail gesendet werden kann. Das Zuweisen einer Rolle, `--disable`, `delete` und `mfa-reset` fragen vorher nach. Kein Aufrufer darf eine Rolle vergeben, die über seiner eigenen steht, oder Aktionen auf einem Konto ausführen, das höher eingestuft ist als er selbst. `rebase auth reset-password` ist die ältere Schreibweise und fällt weiterhin auf die Datenbank zurück, wenn der Server nicht läuft.

## `rebase cron`

Die geplanten Jobs der App (`backend/crons/*`).

```bash
rebase cron list
rebase cron logs nightly-backup -n 5
rebase cron run cleanup-sessions --yes
rebase cron disable nightly-backup --yes
rebase cron reset nightly-backup          # the job's code decides again
```

`enable` und `disable` überschreiben den Job-Code auf jedem Prozess über Redeployments hinweg; `run` fragt vorher nach und `--async` antwortet, sobald die Ausführung gestartet wurde. Bei einem Cloud-Projekt benötigt `rebase cron` für Lesezugriffe keinen Studio-Zugriff: Es fordert von der Control Plane ein kurzlebiges `cron:read`-Plattform-Token an, über das jedes Mitglied mit Log-Zugriff verfügt. `run`, `enable`, `disable` und `reset` erfordern `cron:write`, worüber ein Organisationsinhaber oder Admin bei einem Projekt mit aktiviertem Studio verfügt. `rebase cloud cron` ist die ältere, reine Lese-Schreibweise.

## `rebase logs`

Das Request- und Anwendungslog des Servers – der Puffer, den der Studio Logs Explorer liest – einmalig oder fortlaufend mit `-f`.

```bash
rebase logs -n 50 --level warn
rebase logs -f --source auth --search "sign-in"
```

Der Puffer gehört zu einem einzelnen Prozess. Mit `--project` oder `--cloud` entspricht dies `rebase cloud logs --runtime`: die Ausgabe jedes Replikats über die Control Plane.

## `rebase functions`

Die routeneigenen Endpunkte der App, einer pro Datei in `backend/functions/`.

```bash
rebase functions list
rebase functions invoke hello --anon
rebase functions invoke billing webhook -X POST --input event.json
```

`invoke` akzeptiert dieselben Felder, Bodies und Header wie `rebase api` und gibt die Antwort so aus, wie sie empfangen wurde. Funktionen bestimmen ihre Zugriffsberechtigungen selbst, daher spielen die Anmeldedaten eine Rolle: `--anon` zeigt, was ein Besucher erhält.

## `rebase storage`

Gespeicherte Dateien über die Storage-Richtlinien. Die serverseitige Speicherangabe beginnt mit einem Doppelpunkt: `:avatars/me.png` in der Standardquelle, `media:avatars/me.png` in der mit `media` bezeichneten Quelle.

```bash
rebase storage ls :avatars
rebase storage cp ./me.png :avatars/me.png
rebase storage cp :avatars/me.png ./me.png
rebase storage url :avatars/me.png      # a signed link: whoever holds it reads the file until it expires
rebase storage stat :avatars/me.png
rebase storage rm :avatars/me.png --yes
```

`cp --public` lädt unter dem öffentlichen Präfix hoch (eine permanente URL ohne Token), `--content-type` legt den Typ fest und `--force` überschreibt beim Download eine lokale Datei. `orphans` und `move` bilden den Teil der Befehlsgruppe für die Wartung des gesamten Speichers.

## `rebase rls simulate`

Was eine andere Identität sehen würde, basierend auf dem RLS-Simulator der App – denselben, den Studios „View as“ verwendet: pro Tabelle die Zeilen, die sie im Vergleich zu den Zeilen liest, die Sie lesen, die Tabellen, von denen ihre Scopes sie ausschließen, und die Spalten, die sie nicht lesen kann. Schreibgeschützt.

```bash
rebase auth login --email you@example.com
rebase rls simulate --role anon
rebase rls simulate --user 3f0c9a7e-… --table posts
rebase rls simulate --key <api-key-id>
rebase rls options
```

Der Simulator antwortet auf die eigene Sitzung eines Administrators und niemals auf einen Schlüssel, daher sendet dieser Befehl die Sitzung, die `rebase auth login` gespeichert hat. `rebase verify --live` prüft die Richtlinien selbst, unabhängig von einer bestimmten Identität.

## `rebase auth login`, `emails` und `keys`

Einige Routen antworten einer Person und niemals einer Maschine: der RLS-Simulator, persönliche Schlüssel, die Live-Schema-Anwendung. `rebase auth login` meldet Sie an einer laufenden App an – über den Browser, wenn der Server Geräteanmeldung anbietet, andernfalls mit `--email` und einem Passwort (`--code` für einen zweiten Faktor) – und speichert die Sitzung in `~/.rebase/sessions.json`, getrennt nach Server, niemals im Projekt. `auth whoami` zeigt, für wen der Server Sie hält und welche Scopes Sie besitzen; `auth logout` beendet die Sitzung auch dort.

```bash
rebase auth login --email you@example.com
rebase auth whoami --session
rebase auth emails --latest --links      # the dev mailbox: sign-in, reset and magic-link mail with no SMTP_HOST
rebase auth keys create --name ci --scopes data:read:posts --expires-in 30
rebase auth keys revoke <id> --yes
```

`auth emails` liest das Entwicklungs-Postfach aus, das ein Server ohne `SMTP_HOST` anstelle des E-Mail-Versands führt; `--clear` leert es. `auth keys` verwaltet Ihre eigenen `rk_`-Keys, die in Ihrem Namen agieren, beschränkt auf die angegebenen Scopes; der Server antwortet darauf nur, wenn die Auth-Tabelle `auth.personalKeys: true` festlegt. Service-Keys werden über `rebase api-keys` verwaltet, das nun auch um `update <id>` erweitert wurde.

## Nächste Schritte

- [Endpunkt-Index](/docs/backend/endpoints/) — jede Route, die diese Befehle erreichen, und die jeweils erforderlichen Scopes
- [REST-API](/docs/backend/api/) — die Filter-, Sortier- und Paginierungssyntax, die `rebase data` durchreicht
- [rebase cloud](/docs/cli/cloud/) — das Projekt selbst auf Rebase Cloud: Deployments, Umgebung, Backups, Studio-Zugriff
- [CLI-Referenz](/docs/cli/) — alle weiteren Befehle
