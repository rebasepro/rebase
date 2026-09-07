---
sourceHash: a3fccf5118b08dd0
title: CLI-Referenz
sidebar_label: CLI
description: Rebase CLI-Befehle zur Projektinitialisierung, Schema-Generierung, Datenbankmigrationen und SDK-Generierung.
---

## Überblick

Die Rebase CLI (`rebase`) verwaltet Ihr Projekt vom Scaffolding bis zur Bereitstellung.

## Installation

```bash
pnpm add -g @rebasepro/cli
```

Oder über `pnpm dlx` verwenden:

```bash
pnpm dlx @rebasepro/cli <command>
```

## Maschinenlesbare Ausgabe

<span class="since-badge" data-since="0.18">Since 0.18</span>

`--json` ist der Schalter, und außerhalb der `cloud`-Familie ist er der einzige:
`rebase status`, `rebase resources` und `rebase apps list` schreiben dann einen
einzigen JSON-Wert nach stdout — das Ergebnis oder eine Hülle
`{"error": {"message", "code", "hint", "issues"}}` mit einem Exit-Code ungleich
null — bei **jedem** Ausgang des Befehls, sodass ein Aufrufer stdout
bedingungslos parsen kann. Ohne den Schalter schreiben sie menschenlesbaren Text,
und Fehler gehen nach stderr. `rebase cloud` verwendet dieselbe Hülle und ist die
eine Ausnahme vom Schalter: Es schaltet JSON auch von sich aus ein, wenn stdout
kein TTY ist oder wenn `REBASE_JSON=1` gesetzt ist. `rebase cloud status | cat`
ist also JSON, `rebase status | cat` nicht — übergeben Sie in einem Skript
`--json` lieber explizit, statt sich auf eine der beiden Regeln zu verlassen.

## Befehle

### `rebase init`

Initialisieren Sie ein neues Rebase-Projekt:

```bash
rebase init [directory]
```

Richtet die Projektstruktur mit Frontend-, Backend- und Shared-Paketen ein.

| Flag | Wirkung |
|---|---|
| `-t, --template <preset>` | `blog`, `ecommerce` oder `blank`. Standard `blog` |
| `--headless` | Nur Backend — kein Admin-Panel und keine Sammlungsdateien. `--template` hat keine Wirkung, weil es keine Sammlungen zum Anlegen gibt |
| `-y, --yes` | Fragt nie nach. **Überall erforderlich, wo kein Terminal antworten kann**, etwa in CI. Es überspringt `git init` und die Installation der Abhängigkeiten — die interaktiven Voreinstellungen sagen zu beidem Ja, übergeben Sie also `--git` / `--install`, wenn Sie beides wollen |
| `-i, --install` | Abhängigkeiten nach dem Scaffolding installieren |
| `-g, --git` | Ein Repository initialisieren und den ersten Commit anlegen |
| `--database-url <url>` | Eine bestehende Datenbank statt der verwalteten verwenden |
| `--introspect` | Sammlungen aus dieser Datenbank generieren. Impliziert `--template blank` und benötigt `--install` |
| `--project <slug>` | Das Scaffold mit einem Rebase-Cloud-Projekt verknüpfen |
| `--setup-key <key>` | Der Einmalschlüssel, der diese Verknüpfung autorisiert |

### `rebase dev`

Starten Sie den Entwicklungsserver:

```bash
rebase dev
```

Startet sowohl Frontend als auch Backend mit Hot Reloading.

Beide Ports werden aus dem Projektpfad abgeleitet, sodass mehrere Rebase-Projekte
nebeneinander laufen können. Verwenden Sie die URLs, die `rebase dev` ausgibt.
Einen davon fixieren Sie mit `rebase dev --port 3001`.

### `rebase build`

Bauen Sie das Projekt zu einem auslieferbaren Bundle in `dist-bundle/`:

```bash
rebase build
```

Das Bundle ist das Artefakt, das Sie ausrollen — das Runtime-Image lädt es, es
gibt also kein Anwendungs-Image, das Sie selbst bauen müssten. Nützliche Flags:

| Flag | Wirkung |
|------|--------|
| `--out <dir>` | Das Bundle woandershin schreiben als nach `dist-bundle/` |
| `--vendor` | Die Abhängigkeiten des Bundles immer installieren und mitliefern |
| `--no-vendor` | Nie mitliefern; der Pod installiert beim ersten Start |
| `--skip-type-check` | Typprüfung überspringen (schneller, weniger sicher) |
| `--no-static` | Den Bau des Frontends überspringen |

Abhängigkeiten werden standardmäßig mitgeliefert, damit ein Pod-Neustart nicht
35–55 Sekunden Installation kostet. Ein Baum, der auf der Platte über 200 MB
wächst, wird stattdessen verworfen, weil die Upload-Grenze bei 100 MB komprimiert
liegt — die Begründung steht im Changelog.

### `rebase start`

Führen Sie das gebaute Bundle als Produktionsserver aus:

```bash
rebase start
```

Liest `PORT` und den Rest von `.env`, anders als `rebase dev`. Auf ein Bundle an
anderer Stelle richten Sie es mit `rebase start --bundle ./dist-bundle`.

### `rebase apps list`

Zeigen Sie die Apps, die dieses Repository deklariert:

```bash
rebase apps list
```

Ein Repository kann mehr als eine auslieferbare App deklarieren — etwa ein Backend
und eine Marketing-Website. So sehen Sie, worauf `rebase build` und die
Auslieferung wirken.

### `rebase eject`

Übernehmen Sie die Verantwortung für den Serverprozess und sein Image:

```bash
rebase eject
```

Schreibt den Backend-Einstiegspunkt und ein `Dockerfile` ins Projekt und stellt
dessen Backend um, sodass das Repository sein eigenes Image baut, statt die
veröffentlichte Runtime auszuführen. Ab dann **erreichen
Plattform-Runtime-Upgrades es nicht mehr**, und CORS, Auth-Verdrahtung, Storage
und Shutdown zu konfigurieren wird Ihre Sache.

Sehen Sie es sich mit `rebase eject --dry-run` an, das auflistet, was sich ändern
würde, und nichts ändert. `--force` ersetzt eine vorhandene
`backend/src/index.ts` oder `env.ts` und behält die aktuelle Datei als
`<name>.bak`.

### `rebase schema generate`

Generieren Sie das Drizzle-ORM-Schema aus Ihren TypeScript-Sammlungen:

```bash
rebase schema generate
```

Dies liest Ihre Sammlungen aus `config/collections/` und generiert `backend/src/schema.generated.ts` mit Drizzle-Tabellendefinitionen, Enums und Relationen.

### `rebase db push`

Übertragen Sie Schemaänderungen direkt an die Datenbank (nur Entwicklung):

```bash
rebase db push
```

:::caution
`db push` ändert die Datenbank direkt ohne Migrationsdateien. Verwenden Sie `db generate` + `db migrate` für die Produktion.
:::

### `rebase db generate`

Generieren Sie SQL-Migrationsdateien aus Schemaänderungen:

```bash
rebase db generate
```

Erstellt zeitgestempelte Migrationsdateien in `drizzle/`, die überprüft und committet werden können.

### `rebase db migrate`

Führen Sie ausstehende Datenbankmigrationen aus:

```bash
rebase db migrate
```

Wendet alle noch nicht angewendeten Migrationen auf die Datenbank an.

### `rebase db backup` / `backups` / `restore`

```bash
rebase db backup --out ./backups        # or s3://bucket/prefix, gs://bucket/prefix
rebase db backups                       # list what is stored
rebase db restore ./backups/<file>.dump --yes
```

`backup` führt `pg_dump` aus; `restore` führt `pg_restore` aus und ist destruktiv,
verlangt also `--yes`. `--out` nimmt einen lokalen Pfad oder eine
Objektspeicher-URL und fällt auf `$BACKUP_DESTINATION` oder `./backups` zurück.

### `rebase db pull`

Kopieren Sie eine andere Datenbank in die lokale Entwicklungsdatenbank:

```bash
rebase db pull --from postgres://…  [--anonymize]
```

`--anonymize` ersetzt personenbezogene Felder auf dem Weg hinein, sodass eine
Produktionskopie lokal bearbeitet werden kann, ohne echte Kundendaten auf ein
Notebook zu tragen.

`pg_dump` entfernt Privilegien, die Kopie käme also mit den RLS-Richtlinien der
Quelle an und ohne die Grants dahinter — jeder Lesezugriff als `rebase_user`
scheiterte mit `permission denied`. Der Pull richtet danach die App-Rolle neu
ein, mit derselben Routine, die auch Boot und `rebase db push` verwenden, sodass
Rebases interne Tabellen entzogen bleiben, wie sie sollen.

Ziel ist immer die lokale Entwicklungsdatenbank dieses Projekts, und sie lässt
sich nicht wählen: `--database-url` wird abgelehnt statt angenommen, es gibt also
keine Schreibweise für „in die Produktion ziehen“. `--from` ist die einzige
Richtung.

### `rebase db url`

Gibt die Verbindungszeichenfolge aus, die dieses Projekt verwendet, und sonst
nichts, sodass sie sich weiterleiten lässt:

```bash
rebase db url
psql "$(rebase db url)"
```

Die verwaltete Entwicklungsdatenbank ist der Fall, der das braucht: `.env` lässt
`DATABASE_URL` bewusst auskommentiert, und der Port wird aus dem Projektpfad
abgeleitet, sodass nichts auf der Platte ihn nennt. Haben Sie eine eigene
`DATABASE_URL` gesetzt, wird diese ausgegeben — die Auflösungsreihenfolge ist
dieselbe, der jeder andere Befehl folgt. Die verwaltete Datenbank wird gestartet,
falls sie noch nicht läuft.

### `rebase db stop` / `rebase db reset`

Nur für die verwaltete Entwicklungsdatenbank:

```bash
rebase db stop     # stop it; the data is kept
rebase db reset    # delete it and start over
```

### `rebase db branch`

```bash
rebase db branch create <name>
rebase db branch list
rebase db branch info <name>
rebase db branch switch <name>     # work on it; every later command follows
rebase db branch switch            # say which branch you are on
rebase db branch switch --off      # back to the main database
rebase db branch delete <name>
rebase db branch prune [--older-than 14d] [--include-dev-diff]
```

PostgreSQL kopiert oder löscht keine Datenbank, mit der noch etwas anderes
verbunden ist, und dieses „etwas anderes“ ist meist Ihr eigenes `rebase dev`.
`create` und `delete` nennen, was die Datenbank offen hält; `--force` trennt
diese Sitzungen zuerst.

<span class="since-badge" data-since="0.18">Since 0.18</span> Jeder Branch ist eine vollständige Kopie auf der Platte, sie müssen also
aufgeräumt werden. `prune` entfernt dreierlei: einen Eintrag, dessen Datenbank
außerhalb von Rebase gelöscht wurde, eine Branch-Datenbank, deren Eintrag nie
geschrieben wurde, und — nur mit `--older-than` — Branches jenseits eines von
Ihnen genannten Alters. Es fragt vor jeder Entfernung nach, sofern Sie nicht
`--yes` übergeben.

<span class="since-badge" data-since="0.18">Since 0.18</span> `switch` hält den Branch in `.rebase/branch.json` fest und bearbeitet nie `.env`.
Es hat Vorrang vor `DATABASE_URL` in `.env` und unterliegt `--database-url` oder
einer `DATABASE_URL` in der Shell, sodass ein Flag auf der Kommandozeile immer
einen früher gemachten Switch überstimmt. Löschen Sie den Branch, auf dem Sie
sind, landen Sie wieder auf der Hauptdatenbank, statt dass der Checkout auf eine
Datenbank zeigt, die es nicht mehr gibt.

:::note[Nicht auf der verwalteten Entwicklungsdatenbank]
`push`, `generate` und `migrate` planen ihre Arbeit mit Atlas, das eine zweite,
leere Datenbank zum Vergleich braucht — und das verwaltete PGlite bedient genau
eine. Dort ausgeführt brechen sie mit einer entsprechenden Meldung ab. Richten
Sie `DATABASE_URL` für den Migrations-Workflow auf ein echtes PostgreSQL;
`rebase dev` legt fehlende Tabellen auf der verwalteten Datenbank ohnehin
additiv an.

`branch` wird dort aus verwandtem Grund abgelehnt.
`CREATE DATABASE ... TEMPLATE` schreibt gegen PGlite einen Katalogeintrag und
kopiert nichts, der Branch würde also auf die Datenbank auflösen, aus der er
geklont wurde — jeder Schreibvorgang, den Sie einsperren wollten, landete in
Ihrer Entwicklungsdatenbank. `rebase dev --docker` gibt Ihnen einen echten
Server, gegen den Branches funktionieren.
:::

### `rebase apps init` / `rebase apps config`

```bash
rebase apps list             # the apps this project declares
rebase apps init <name>      # register a new app in rebase.json
rebase apps config <app>     # what one app resolves to
```

### `rebase status`

<span class="since-badge" data-since="0.18">Since 0.18</span>

Alles, was dieses Projekt deklariert, und ob die Umgebung es tatsächlich bindet:

```bash
rebase status               # every resource, and the variables it reads
rebase status --json        # machine-readable
```

```
  backend  ·  managed  Rebase's runtime boots your bundle
  declared in  config/resources.ts
  configured by  .env

  buckets
  ✓ media  s3 · account:minio
      ✓ S3_BUCKET__MEDIA
      ✓ S3_ACCESS_KEY_ID__MINIO (shared, for S3_ACCESS_KEY_ID__MEDIA)
  ○ exports  s3
      · S3_BUCKET__EXPORTS not set
      └ declared, not configured — uploads here answer 501 STORAGE_SOURCE_NOT_CONFIGURED
```

Drei Dateien entscheiden, was ein Backend erreichen kann, und das hier druckt alle
drei zusammen: `rebase.json` sagt, wo Ihr Code liegt und wer den Server
ausführt, `config/resources.ts` sagt, was das Projekt braucht, und die Umgebung
sagt, wie jedes Ding zu erreichen ist. Alles andere — `rebase.resources.json`,
das Bundle-Manifest — wird aus der mittleren Datei für Leser generiert, die Ihren
Code nicht ausführen können, und Sie schreiben es nie.

Ein `○` ist der Zustand, den man vor einer Auslieferung kennen will und nicht
danach: deklariert, nicht konfiguriert. Ein `✗` heißt, die Umgebung setzt etwas
*falsch*, und das verweigert den Boot, statt sich zu verschlechtern.

### `rebase resources`

Was dieses Projekt zu brauchen erklärt — die Datenbanken, Buckets, Topics und
Queues, nach denen sein Konfigurationscode fragt, und die Crons und Functions,
die seine Dateien definieren:

```bash
rebase resources            # list them
rebase resources --write    # regenerate rebase.resources.json
rebase resources --check    # fail if the committed graph is stale
rebase resources --json     # machine-readable
```

`rebase resources --check` ist neu <span class="since-badge" data-since="0.18">Since 0.18</span> — das Flag, mit dem ein CI-Job an einer `rebase.resources.json` scheitert, die
nicht mehr zum Konfigurationscode passt.

Eine Ressource wird im Konfigurationscode deklariert — `database("analytics")`,
`bucket("media")`, `topic("signups")`, `queue("thumbnails")` — oder ist eine
Datei unter `backend/crons` bzw. `backend/functions`, und sie wird nie von Hand
in `rebase.resources.json` geschrieben, die aus diesen Deklarationen generiert
wird, damit ein Host lesen kann, was ein Projekt braucht, ohne es zu bauen. Jeder
Eintrag hält fest, wer sie nutzt (`collection:events`, `property:posts.cover`,
`function:report`).

Ein Backend hat außerdem eine Standarddatenbank und eine Standard-Storage-Quelle,
die niemand deklariert. Beide sind hier aufgeführt, als `implicit` markiert, und
keine von beiden wird nach `rebase.resources.json` geschrieben — der Host stellt
sie bereit, sie einzutragen hieße also, etwas anzufordern, wonach niemand gefragt
hat.

Um zu sehen, was die Plattform für ein Projekt vorhält, verglichen mit dem, was
sein Code deklariert, und um eine bereitgestellte Datenbank zu entfernen, die der
Code nicht mehr nennt, siehe `rebase cloud resources` weiter unten.

### `rebase cloud`

Alles rund um Rebase Cloud, das sich in der privaten Beta befindet. Was es ist
und was die Beta nicht enthält, steht im
[Rebase-Cloud-Leitfaden](/docs/deployment/cloud/).

Jede Gruppe antwortet auf `--help`, und `--help` führt den Befehl nie aus. Die
meisten Befehle wirken auf das verknüpfte Projekt in `.rebase/cloud.json`;
`--project <id>` wirkt auf eines, ohne es zu verknüpfen.

Drei Optionen gelten überall: `--json` für maschinenlesbare Ausgabe (auch der
Standard bei einer Pipe oder mit `REBASE_JSON=1`), `--url <origin>`, um eine
bestimmte Control Plane anzusprechen (oder `REBASE_CLOUD_URL`), und
`--project, -p <id>`.

#### Auth

```bash
rebase cloud login      # sign in to the control plane
rebase cloud logout     # sign out
rebase cloud whoami     # show the current session
```

#### Projektverknüpfung

```bash
rebase cloud link         # link this directory to a cloud project
rebase cloud link [url]   # or straight at a backend: no control plane, no login, and the rest of the family refuses until you unlink
rebase cloud unlink       # remove the link
rebase cloud use [org]    # select the active organization
rebase cloud open         # open the dashboard in a browser
```

#### Projekte

```bash
rebase cloud projects list
rebase cloud projects create [--link]
rebase cloud projects info [id]
rebase cloud projects delete [id]
```

#### Ausliefern und beobachten

```bash
rebase cloud deploy [app] [--source .]   # deploy an app and stream build logs
rebase cloud logs [--runtime] [-f]       # build logs, or the running process's
rebase cloud deployments list [--limit N|--all]
rebase cloud rollback [id] [-y]          # back to a successful deploy
rebase cloud cancel [-y]                 # cancel the in-flight build
rebase cloud start | stop | restart [-y] # stop and restart need -y
rebase cloud status                      # one-glance project status
rebase cloud metrics                     # live CPU / memory / disk
rebase cloud debug [health|logs|…]       # diagnose a deployment, read-only
```

`deploy` ohne App-Namen liefert das Backend aus.

#### Konfiguration

```bash
rebase cloud env list | set | unset | reveal | pull
rebase cloud domains list | add | verify | remove
rebase cloud extensions list | enable | disable
rebase cloud settings show | set        # name, branch, repo, subdomain
```

#### Organisationen

```bash
rebase cloud orgs list | create | members
```

#### Datenbanken

```bash
rebase cloud db list | create | info | test
rebase cloud db backup list | create | restore | status | download
rebase cloud db pitr status | restore | cutover | discard
```

#### Ressourcen

Was die Plattform für das Projekt vorhält, verglichen mit dem, was sein Code deklariert.

```bash
rebase cloud resources                       # each database and bucket: declared? provisioned?
rebase cloud resources prune database <key>  # remove one the code no longer declares
```

Eine Auslieferung entfernt nie eine bereitgestellte Datenbank, wenn ihre
Deklaration verschwindet — das wären Daten, die ein Push löscht. Sie bleibt
erhalten, wird gebunden und abgerechnet, bis jemand sie namentlich prunt.

#### Compute

Was das Projekt reserviert und was das kostet.

```bash
rebase cloud compute            # the current reservation and its monthly cost
rebase cloud compute set        # change it
```

`compute set` nimmt `--cpu`, `--memory`, `--replicas`, `--spot`,
`--scale-to-zero`, `--db-mode`, `--db-instances`, `--db-cpu`, `--db-memory`,
`--storage`, `--autoscale-max`, `--autoscale-cpu-target` und `--no-autoscale`
entgegen. Es gibt keine Tarifstufen: Alles wird pro Ressource bepreist. Siehe
[Rebase Cloud](/docs/deployment/cloud/).

#### Storage, Webhooks, Cluster und Abrechnung

```bash
rebase cloud storage             # list storage buckets
rebase cloud storage create      # provision platform-managed storage
rebase cloud storage attach      # attach your own S3-compatible bucket
rebase cloud webhooks list | create | delete
rebase cloud clusters list | add | verify   # the clusters tenants run on; `add` registers one from a kubeconfig
rebase cloud billing             # the billing account and card on file
rebase cloud billing setup       # attach a card, one-time, opens a browser
rebase cloud billing checkout    # a Stripe session for one project
```

### `rebase generate-sdk`

Generieren Sie ein typisiertes Client-SDK aus Ihren Sammlungsdefinitionen:

```bash
rebase generate-sdk
```

Erstellt TypeScript-Typen und einen typsicheren Client für all Ihre Sammlungen.

### `rebase doctor`

```bash
rebase doctor
```

Der Befehl, den Sie ausführen, wenn etwas nicht stimmt und Sie noch nicht wissen,
was. Er berichtet und ändert nie etwas, ist also gegen jede erreichbare Datenbank
unbedenklich.

**Ohne Datenbank.** Diese laufen zuerst, weil alles, was ein Projekt überhaupt am
Funktionieren hindert, vor jedem Tabellenvergleich passiert:

| Prüfung | Warum |
| --- | --- |
| Node-Version | Gegen den Bereich, den die CLI deklariert. Zu alt wird nicht als „nicht unterstütztes Node“ gemeldet — es ist ein Syntaxfehler in einer Abhängigkeit. |
| Paketmanager | Zwei Lockfiles in einem Projekt. `npm install` in einem pnpm-Workspace schreibt `node_modules` in ein Layout um, mit dem pnpm nicht einverstanden ist, und das Symptom ist Stunden später `Cannot find module`. |
| Doppelte Slugs | Die Registry behält die zuletzt registrierte Sammlung, die andere wird also nicht als fehlend gemeldet — sie wird als Gewinnerin unter ihrem eigenen Namen ausgeliefert. |
| Plausibilität von `.env` | Ein `JWT_SECRET` kürzer als 32 Zeichen (mit dem die Produktion den Boot verweigert) und `NODE_ENV=production` ohne `CORS_ORIGINS` und ohne `FRONTEND_URL`. Werte werden nie ausgegeben. |
| Versionsdrift bei `@rebasepro/*` | Dasselbe Paket über die `package.json`-Dateien des Projekts hinweg auf verschiedene Versionen gepinnt. Zwei Kopien brechen `instanceof` zwischen ihnen, was als Type Guard fehlschlägt, der seinen eigenen Typ ablehnt. |
| Verbindungszeichenfolgen | Ein nicht kodiertes `=` in einem URL-Parameter, das PostgreSQLs eigene Werkzeuge zu parsen verweigern — Backups und `psql` brechen, während die App weiterläuft. |
| Benutzerdefinierte Functions | Was jede Function von ihrem Host braucht, und welche davon auf einer Edge-Runtime nicht liefe. |

**Gegen die Datenbank**, wenn `DATABASE_URL` gesetzt ist:

| Prüfung | Warum |
| --- | --- |
| Sammlungen → generiertes Schema | Ob `schema.generated.ts` veraltet ist. |
| Sammlungen → Datenbank | Fehlende Tabellen, Spalten, Enums, Fremdschlüssel und Junctions. |
| Benötigte Erweiterungen | Eine Property mit `{ type: "vector" }` braucht pgvector, das Rebase nur dort installiert, wo ein Projekt es deklariert hat. |
| Schema-Stempel | Ob diese Datenbank aus diesen Sammlungen bereitgestellt wurde. Ein Hash, er kann also sagen, dass die beiden nicht übereinstimmen, aber nie, welcher voraus ist. |
| Sammlungen → SDK-Typen | Ob das generierte typisierte SDK veraltet ist. |
| RLS-Richtlinien | Ob die Richtlinien der Datenbank zu den von Ihnen deklarierten `securityRules` passen, und ob eine Richtlinie eine Rolle nennt, die dieser Server nicht verwenden kann. |

Ist die Datenbank nicht erreichbar, werden ihre Phasen mit dem Grund als
übersprungen gemeldet, und der Rest läuft weiter — siehe
[Fehlerbehebung](/docs/troubleshooting/).

Beendet sich mit einem Code ungleich null, wenn eine Prüfung einen Fehler findet
oder wenn eine Phase nicht laufen konnte, weil die ihr übergebene Datenbank
Verbindungen ablehnt. Eine Phase, die übersprungen wurde, weil Sie keine
`DATABASE_URL` gesetzt haben, ist kein Fehlschlag.

`rebase doctor --policies` führt nur die RLS-Prüfungen aus — kein Schema-Diff,
keine SDK-Typen — und schlägt fail-closed fehl, was es zur richtigen Form für ein
CI-Gate gegen eine ausgelieferte Datenbank macht.

### `rebase auth`

Befehle zur Authentifizierungsverwaltung:

```bash
rebase auth reset-password --email admin@example.com --password NewPassword123!
```

### `rebase api-keys`

Verwalten Sie Service-API-Schlüssel mit Scopes — der Berechtigungsnachweis, den
ein Agent, ein Skript oder ein anderer Dienst verwendet, im Unterschied zur
Sitzung eines Endbenutzers:

```bash
rebase api-keys list
rebase api-keys create --name "Analytics" --permissions '[{"collection":"events","operations":["read"]}]'
rebase api-keys create --name "Full Access" --full-access --expires 90d
rebase api-keys revoke abc123-def456
```

`--permissions` nimmt ein JSON-Array aus `{ collection, operations }`-Objekten
entgegen, oder verwenden Sie `--full-access` für Lesen/Schreiben/Löschen in jeder
Sammlung und Function. `--expires` akzeptiert `7d`, `30d`, `90d`, `1y` oder ein
ISO-Datum, und `--rate-limit` setzt die Anzahl der Requests pro
15-Minuten-Fenster. Ein Schlüssel wird genau einmal angezeigt, bei der
Erstellung.

Schlüssel sind doppelt abgesichert: Es gelten sowohl die Berechtigungen des
Schlüssels selbst als auch die Row-Level-Security der Identität, unter der er
handelt — ein Schlüssel kann also nie mehr lesen, als diese Identität darf.

### `rebase skills install`

Installieren Sie die Rebase-Referenz-Skills für Ihren KI-Coding-Assistenten.
Unterstützt Cursor, Claude Code, Windsurf, Gemini CLI und Antigravity:

```bash
rebase skills install
rebase skills install --agent claude,cursor
rebase skills install --agent all
```

Die vollständige Liste und wohin die Dateien geschrieben werden, finden Sie unter [Agent Skills](/docs/ai/skills).

### `rebase telemetry`

Anonyme Nutzungsdaten. **Opt-in und aus, solange Sie es nicht eingeschaltet haben:**

```bash
rebase telemetry status
rebase telemetry show
rebase telemetry enable
rebase telemetry disable
```

`status` gibt die aktuelle Einstellung aus, `show` gibt genau das aus, was
gesendet würde, und die beiden anderen ändern sie. `rebase init` fragt einmal;
haben Sie `init` nie ausgeführt, wurde nie etwas erhoben.

## Migrations-Workflow

Der typische Workflow für Schemaänderungen:

```bash
# 1. Edit your collection in config/collections/
# 2. Generate the Drizzle schema
rebase schema generate

# 3. Generate SQL migration
rebase db generate

# 4. Review the generated SQL in drizzle/

# 5. Apply the migration
rebase db migrate
```

## Nächste Schritte

- **[Schema als Code](/docs/architecture/schema-as-code)** — Wie die Schema-Generierung funktioniert
- **[Schnellstart](/docs/getting-started/quickstart)** — Erste Schritte
