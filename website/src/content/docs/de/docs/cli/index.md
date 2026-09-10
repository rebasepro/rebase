---
sourceHash: 97dd0e836d51f599
title: CLI-Referenz
sidebar_label: CLI
description: Rebase CLI-Befehle für Projektinitialisierung, Schemagenerierung, Datenbankmigrationen und SDK-Generierung.
---

## Übersicht

Die Rebase CLI (`rebase`) verwaltet Ihr Projekt vom Scaffolding bis zum Deployment.

## Installation

```bash
pnpm add -g @rebasepro/cli
```

Oder über `pnpm dlx` ausführen:

```bash
pnpm dlx @rebasepro/cli <command>
```

## Maschinenlesbare Ausgabe

`--json` ist der Schalter, und außerhalb der `cloud`-Befehlsfamilie ist er der einzige: `rebase status`, `rebase resources` und `rebase apps list` geben dann genau einen JSON-Wert auf stdout aus – das Ergebnis oder einen `{"error": {"message", "code", "hint", "issues"}}`-Umschlag mit einem Exit-Code ungleich null – bei **jedem** Beenden des Befehls, sodass ein Aufrufer stdout bedingungslos parsen kann. Ohne diesen Schalter geben sie menschenlesbaren Text aus und Fehler gehen an stderr. `rebase cloud` verwendet denselben Umschlag und ist die einzige Ausnahme von diesem Schalter: Es aktiviert JSON auch selbsttätig, wenn stdout kein TTY ist oder wenn `REBASE_JSON=1` gesetzt ist. Somit liefert `rebase cloud status | cat` JSON, während `rebase status | cat` dies nicht tut – übergeben Sie in einem Skript explizit `--json`, anstatt sich auf eine der beiden Regeln zu verlassen.

## Befehle

### `rebase init`

Initialisiert ein neues Rebase-Projekt:

```bash
rebase init [directory]
```

Richtet die Projektstruktur mit Frontend, Backend und geteilten Packages ein.

| Flag | Beschreibung |
|---|---|
| `-t, --template <preset>` | `blog`, `ecommerce` oder `blank`. Standardwert ist `blog` |
| `--headless` | Nur Backend – kein Admin-Panel und keine Collection-Dateien. `--template` hat keine Auswirkung, da keine Collections zum Seeden vorhanden sind |
| `-y, --yes` | Niemals nachfragen. **Erforderlich überall dort, wo kein Terminal zum Antworten vorhanden ist**, wie z. B. in CI. Überspringt Git-Init und die Installation von Abhängigkeiten – die interaktiven Standardwerte bejahen beides; übergeben Sie also `--git` / `--install`, falls Sie diese wünschen |
| `-i, --install` | Abhängigkeiten nach dem Scaffolding installieren |
| `-g, --git` | Ein Repository initialisieren und den ersten Commit erstellen |
| `--database-url <url>` | Eine bestehende Datenbank anstelle der verwalteten verwenden |
| `--introspect` | Collections aus dieser Datenbank generieren. Impliziert `--template blank` und erfordert `--install` |
| `--project <slug>` | Das Scaffolding mit einem Rebase Cloud-Projekt verknüpfen |
| `--setup-key <key>` | Der Einmalschlüssel, der diese Verknüpfung authentifiziert |

### `rebase dev`

Startet den Entwicklungsserver:

```bash
rebase dev
```

Startet sowohl Frontend als auch Backend mit Hot-Reloading.

Beide Ports werden aus dem Pfad des Projekts abgeleitet, sodass mehrere Rebase-Projekte parallel nebeneinander laufen können. Verwenden Sie die URLs, die `rebase dev` ausgibt. Pinnen Sie einen Port mit `rebase dev --port 3001` fest.

### `rebase build`

Baut das Projekt in ein deploybares Bundle in `dist-bundle/`:

```bash
rebase build
```

Das Bundle ist das Artefakt, das Sie deployen – das Runtime-Image lädt es, sodass Sie kein eigenes Anwendungs-Image erstellen müssen. Nützliche Flags:

| Flag | Auswirkung |
|------|--------|
| `--out <dir>` | Das Bundle an einen anderen Ort als `dist-bundle/` schreiben |
| `--vendor` | Abhängigkeiten des Bundles immer installieren und mitliefern |
| `--no-vendor` | Niemals vendoren; der Pod installiert beim ersten Start |
| `--skip-type-check` | Typprüfung überspringen (schneller, weniger sicher) |
| `--no-static` | Erstellung des Frontends überspringen |

Abhängigkeiten werden standardmäßig per Vendoring gebündelt, damit ein Pod-Neustart keine 35–55 Sekunden dauernde Installation verursacht. Ein Verzeichnisbaum, der auf der Festplatte auf über 200 MB anwächst, wird stattdessen verworfen, da das Upload-Limit komprimiert 100 MB beträgt – siehe Changelog für die Begründung.

### `rebase start`

Führt das erstellte Bundle als Produktionsserver aus:

```bash
rebase start
```

Liest im Gegensatz zu `rebase dev` `PORT` und den Rest von `.env` aus. Verweisen Sie mit `rebase start --bundle ./dist-bundle` auf ein Bundle an einem anderen Speicherort.

### `rebase apps list`

Zeigt die Apps an, die dieses Repository deklariert:

```bash
rebase apps list
```

Ein Repository kann mehr als eine deploybare App deklarieren – beispielsweise ein Backend und eine Marketing-Website. So sehen Sie, worauf sich `rebase build` und das Deployment auswirken.

### `rebase eject`

Übernehmen Sie die vollständige Kontrolle über den Serverprozess und dessen Image:

```bash
rebase eject
```

Schreibt den Backend-Einstiegspunkt und ein `Dockerfile` in das Projekt und stellt dessen Backend um, sodass das Repository ein eigenes Image baut, anstatt die veröffentlichte Runtime auszuführen. Von da an **greifen Plattform-Runtime-Upgrades nicht mehr**, und CORS, Authentifizierungsverdrahtung, Speicher und das Herunterfahren müssen von Ihnen konfiguriert werden.

Erstellen Sie eine Vorschau mit `rebase eject --dry-run`, was auflistet, was sich ändern würde, aber nichts verändert. `--force` ersetzt ein vorhandenes `backend/src/index.ts` oder `env.ts` und behält die aktuelle Datei als `<name>.bak` bei.

### `rebase schema generate`

Drizzle-ORM-Schema aus Ihren TypeScript-Collections generieren:

```bash
rebase schema generate
```

Dies liest Ihre Collections aus `config/collections/` und generiert `backend/src/schema.generated.ts` mit Drizzle-Tabellendefinitionen, Enums und Relationen.

### `rebase db push`

Schemaänderungen direkt in die Datenbank übertragen (nur Entwicklung):

```bash
rebase db push
```

:::caution
`db push` ändert die Datenbank direkt ohne Migrationsdateien. Verwenden Sie `db generate` + `db migrate` für die Produktion.
:::

### `rebase db generate`

SQL-Migrationsdateien aus Schemaänderungen generieren:

```bash
rebase db generate
```

Erstellt mit einem Zeitstempel versehene Migrationsdateien in `drizzle/`, die überprüft und committet werden können.

### `rebase db migrate`

Ausstehende Datenbankmigrationen ausführen:

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

`backup` führt `pg_dump` aus; `restore` führt `pg_restore` aus und ist destruktiv, weshalb es `--yes` erfordert. `--out` akzeptiert einen lokalen Pfad oder eine Object-Storage-URL und fällt standardmäßig auf `$BACKUP_DESTINATION` oder `./backups` zurück.

### `rebase db pull`

Eine andere Datenbank in die lokale Entwicklungsdatenbank kopieren:

```bash
rebase db pull --from postgres://…  [--anonymize]
```

`--anonymize` ersetzt personenbezogene Felder beim Import, sodass an einer Produktionskopie lokal gearbeitet werden kann, ohne echte Kundendaten auf ein Notebook zu übertragen.

`pg_dump` entfernt Berechtigungen, sodass die Kopie mit den RLS-Policies der Quelle, aber ohne die dahinterliegenden Grants ankommen würde – jeder Lesevorgang als `rebase_user` schlägt mit `permission denied` fehl. Der Pull richtet die App-Rolle anschließend neu ein, indem er dieselbe Routine verwendet wie der Boot-Vorgang und `rebase db push`, sodass Rebase-interne Tabellen wie vorgesehen widerrufen bleiben.

Das Ziel ist immer die lokale Entwicklungsdatenbank dieses Projekts und kann nicht gewählt werden: `--database-url` wird verweigert und nicht akzeptiert, sodass es keine Möglichkeit gibt, ein „Pull in die Produktion“ durchzuführen. `--from` ist die einzige Richtung.

### `rebase db url`

Gibt den Connection String aus, den dieses Projekt verwendet, und sonst nichts, sodass er über Pipes weitergeleitet werden kann:

```bash
rebase db url
psql "$(rebase db url)"
```

Die verwaltete Entwicklungsdatenbank ist der Fall, der dies benötigt: `.env` lässt `DATABASE_URL` absichtlich auskommentiert, und der Port wird aus dem Projektpfad abgeleitet, sodass nichts auf der Festplatte ihn benennt. Wenn Sie eine eigene `DATABASE_URL` festgelegt haben, wird diese ausgegeben – die Auflösungsreihenfolge ist dieselbe, der auch jeder andere Befehl folgt. Er startet die verwaltete Datenbank, falls sie nicht bereits läuft.

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

PostgreSQL kopiert oder löscht keine Datenbank, mit der noch eine Verbindung besteht, und dieses „noch etwas“ ist üblicherweise Ihr eigenes `rebase dev`. `create` und `delete` nennen das, was die Datenbank offen hält; `--force` trennt diese Sitzungen zuerst.

Jeder Branch ist eine vollständige Kopie auf der Festplatte, daher müssen sie aufgeräumt werden. `prune` entfernt drei Dinge: einen Eintrag, dessen Datenbank außerhalb von Rebase gelöscht wurde, eine Branch-Datenbank, deren Eintrag nie geschrieben wurde, und – nur mit `--older-than` – Branches, die älter als ein von Ihnen angegebenes Alter sind. Es fragt nach, bevor etwas entfernt wird, es sei denn, Sie übergeben `--yes`.

`switch` vermerkt den Branch in `.rebase/branch.json` und editiert `.env` niemals. Er hat Vorrang vor `DATABASE_URL` in `.env` und weicht `--database-url` oder einer `DATABASE_URL` in der Shell, sodass ein Flag auf der Befehlszeile immer Vorrang vor einem zuvor durchgeführten Wechsel hat. Das Löschen des Branches, auf dem Sie sich befinden, bringt Sie zur Hauptdatenbank zurück, anstatt den Checkout auf eine Datenbank verweisen zu lassen, die nicht mehr existiert.

:::note[Nicht auf der verwalteten Entwicklungsdatenbank]
`push`, `generate` und `migrate` planen ihre Arbeit mit Atlas, das eine zweite leere Datenbank zum Abgleich benötigt – und das verwaltete PGlite stellt genau eine bereit. Deren Ausführung dort bricht mit einer entsprechenden Meldung ab. Verweisen Sie `DATABASE_URL` für den Migrations-Workflow auf ein echtes PostgreSQL; `rebase dev` erstellt fehlende Tabellen auf der verwalteten Datenbank bereits additiv.

`branch` wird dort aus einem ähnlichen Grund verweigert. `CREATE DATABASE ... TEMPLATE` auf PGlite schreibt einen Katalogeintrag und kopiert nichts, sodass der Branch auf die Datenbank verweisen würde, von der er geklont wurde – jeder Schreibvorgang, den Sie isolieren wollten, würde in Ihrer Entwicklungsdatenbank landen. `rebase dev --docker` liefert Ihnen einen echten Server, mit dem Branches funktionieren.
:::

### `rebase apps init` / `rebase apps config`

```bash
rebase apps list             # the apps this project declares
rebase apps init <name>      # register a new app in rebase.json
rebase apps config <app>     # what one app resolves to
```

### `rebase status`

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
      ✓ S3_ACCESS_KEY_ID__MINIO (shared, for S3_ACCESS_KEY_ID__MEDIA)
  ○ exports  s3
      · S3_BUCKET__EXPORTS not set
      └ declared, not configured — uploads here answer 501 STORAGE_SOURCE_NOT_CONFIGURED
```

Drei Dateien bestimmen, was ein Backend erreichen kann, und dieser Befehl gibt alle drei zusammen aus:
`rebase.json` gibt an, wo sich Ihr Code befindet und wer den Server ausführt,
`config/resources.ts` gibt an, was das Projekt benötigt, und die Umgebung legt fest, wie
jedes Element erreicht wird. Alles andere – `rebase.resources.json`, das Bundle-Manifest –
wird aus der mittleren Datei für Parser generiert, die Ihren Code nicht ausführen können, und
wird von Ihnen niemals manuell geschrieben.

Ein `○` ist der Status, den man besser vor einem Deployment statt danach kennt:
deklariert, nicht konfiguriert. Ein `✗` bedeutet, dass die Umgebung etwas *falsch* setzt,
was den Boot-Vorgang verweigert, anstatt in einen eingeschränkten Zustand überzugehen.

### `rebase resources`

Was dieses Projekt als Bedarf deklariert – die Datenbanken, Buckets, Topics und
Queues, die sein Konfigurationscode anfordert, sowie die Crons und Functions, die seine Dateien definieren:

```bash
rebase resources            # list them
rebase resources --write    # regenerate rebase.resources.json
rebase resources --check    # fail if the committed graph is stale
rebase resources --json     # machine-readable
```

`rebase resources --check` ist neu – das Flag, das ein CI-Job verwendet, um
fehlzuschlagen, wenn eine `rebase.resources.json` nicht mehr mit dem Konfigurationscode übereinstimmt.

Eine Ressource wird im Konfigurationscode deklariert – `database("analytics")`,
`bucket("media")`, `topic("signups")`, `queue("thumbnails")` – oder ist eine Datei
unter `backend/crons` oder `backend/functions`, und wird niemals manuell in
`rebase.resources.json` geschrieben. Diese wird aus diesen Deklarationen generiert, damit ein Host
lesen kann, was ein Projekt benötigt, ohne es zu bauen. Jeder Eintrag erfasst, wer ihn verwendet
(`collection:events`, `property:posts.cover`, `function:report`).

Ein Backend hat außerdem eine Standarddatenbank und eine Standard-Speicherquelle, die niemand
deklariert. Beide werden hier aufgeführt, als `implicit` markiert, und keine von beiden wird in
`rebase.resources.json` geschrieben – der Host stellt sie bereit, sodass ihre Erfassung das
Bereitstellen von etwas verlangen würde, das niemand angefordert hat.

Um zu sehen, was die Plattform für ein Projekt im Vergleich zu dem vorhält, was dessen Code deklariert,
und um eine bereitgestellte Datenbank zu entfernen, die der Code nicht mehr nennt,
siehe `rebase cloud resources` unten.

### `rebase cloud`

Alles rund um Rebase Cloud, das sich in der Private Beta befindet. Im
[Rebase Cloud-Leitfaden](/docs/deployment/cloud/) erfahren Sie, was es ist und was die Beta
nicht enthält.

Jede Gruppe reagiert auf `--help`, und `--help` führt den Befehl niemals aus. Die meisten Befehle
wirken sich auf das verknüpfte Projekt in `.rebase/cloud.json` aus; `--project <id>` operiert auf
einem Projekt ohne Verknüpfung.

Drei Optionen gelten überall: `--json` für maschinenlesbare Ausgabe (auch standardmäßig bei Verwendung
von Pipes oder mit `REBASE_JSON=1`), `--url <origin>` zur Adressierung einer spezifischen
Control Plane (oder `REBASE_CLOUD_URL`) und `--project, -p <id>`.

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

#### Deployen und beobachten

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

`deploy` ohne App-Namen deployt das Backend.

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

Was die Plattform für das Projekt vorhält, im Vergleich zu dem, was sein Code deklariert.

```bash
rebase cloud resources                       # each database and bucket: declared? provisioned?
rebase cloud resources prune database <key>  # remove one the code no longer declares
```

Ein Deployment entfernt niemals eine bereitgestellte Datenbank, wenn ihre Deklaration wegfällt – das
wären per Push gelöschte Daten. Sie wird beibehalten, gebunden und abgerechnet, bis jemand
sie namentlich bereinigt (pruned).

#### Compute

Was das Projekt reserviert und was dies kostet.

```bash
rebase cloud compute            # the current reservation and its monthly cost
rebase cloud compute set        # change it
```

`compute set` akzeptiert `--cpu`, `--memory`, `--replicas`, `--spot`,
`--scale-to-zero`, `--db-mode`, `--db-instances`, `--db-cpu`, `--db-memory`,
`--storage`, `--autoscale-max`, `--autoscale-cpu-target` und `--no-autoscale`.
Es gibt keine Tarifstufen (Plan Tiers): Alles wird pro Ressource abgerechnet. Siehe
[Rebase Cloud](/docs/deployment/cloud/).

#### Speicher, Webhooks, Cluster und Abrechnung

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

Ein typisiertes Client-SDK aus Ihren Collection-Definitionen generieren:

```bash
rebase generate-sdk
```

Erstellt TypeScript-Typen und einen typsicheren Client für alle Ihre Collections.

### `rebase doctor`

```bash
rebase doctor
```

Der Befehl, den man ausführt, wenn etwas nicht stimmt und man noch nicht weiß, was es ist. Er
berichtet und ändert niemals etwas, sodass er für jede erreichbare Datenbank
sicher ist.

**Ohne Datenbank.** Diese Prüfungen laufen zuerst, da alles, was ein Projekt
daran hindert, überhaupt zu funktionieren, passiert, bevor eine Tabelle verglichen werden kann:

| Prüfung | Grund |
| --- | --- |
| Node version | Gegen den von der CLI deklarierten Bereich. Eine zu alte Version wird nicht als „nicht unterstütztes Node“ gemeldet – sie ist ein Syntaxfehler innerhalb einer Abhängigkeit. |
| Package managers | Zwei Lockfiles in einem Projekt. `npm install` in einem pnpm-Workspace schreibt `node_modules` in ein Layout um, das nicht zu pnpm passt, und das Symptom lautet Stunden später `Cannot find module`. |
| Duplicate slugs | Die Registry behält die zuletzt registrierte Collection, sodass die andere nicht als fehlend gemeldet wird – sie wird als Gewinner unter ihrem eigenen Namen bereitgestellt. |
| `.env` sanity | Ein `JWT_SECRET`, das kürzer als 32 Zeichen ist (womit die Produktion den Start verweigert), und `NODE_ENV=production` ohne `CORS_ORIGINS` oder `FRONTEND_URL`. Werte werden niemals ausgegeben. |
| `@rebasepro/*` version skew | Dasselbe Paket ist in verschiedenen `package.json`-Dateien des Projekts auf unterschiedliche Versionen gepinnt. Zwei Kopien beschädigen `instanceof` untereinander, was fehlschlägt, da ein Type Guard seinen eigenen Typ ablehnt. |
| Connection strings | Ein nicht-kodiertes `=` in einem URL-Parameter, das PostgreSQL-eigene Tools nicht parsen können – Backups und `psql` schlagen also fehl, während die App weiter funktioniert. |
| Custom functions | Was jede Funktion von ihrem Host benötigt und welche davon nicht auf einer Edge-Runtime laufen würden. |

**Gegen die Datenbank**, wenn `DATABASE_URL` gesetzt ist:

| Prüfung | Grund |
| --- | --- |
| Collections → generated schema | Ob `schema.generated.ts` veraltet ist. |
| Collections → database | Fehlende Tabellen, Spalten, Enums, Fremdschlüssel und Junctions. |
| Required extensions | Eine `{ type: "vector" }`-Eigenschaft benötigt pgvector, das Rebase nur dort installiert, wo ein Projekt es deklariert hat. |
| Schema stamp | Ob diese Datenbank aus diesen Collections provisioniert wurde. Ein Hash, sodass festgestellt werden kann, dass beide voneinander abweichen, aber nie, welches weiter fortgeschritten ist. |
| Collections → SDK types | Ob das generierte typisierte SDK veraltet ist. |
| RLS policies | Ob die Policies der Datenbank mit den von Ihnen deklarierten `securityRules` übereinstimmen und ob eine Policy eine Rolle nennt, die dieser Server nicht verwenden kann. |

Wenn die Datenbank nicht erreichbar ist, werden ihre Phasen mit der Begründung als übersprungen
gemeldet, und der Rest läuft weiterhin – siehe [Fehlerbehebung](/docs/troubleshooting/).

Beendet sich mit einem Exit-Code ungleich null, wenn eine Prüfung einen Fehler findet oder wenn eine
Phase nicht ausgeführt werden konnte, weil die angegebene Datenbank Verbindungen verweigert. Eine
Phase, die übersprungen wurde, weil Sie keine `DATABASE_URL` gesetzt haben, gilt nicht als Fehler.

`rebase doctor --policies` führt nur die RLS-Prüfungen durch – kein Schema-Diff, keine
SDK-Typen – und schlägt restriktiv fehl (fails closed), was es zur geeigneten Form für die Verwendung als
CI-Gate gegen eine bereitgestellte Datenbank macht.

### `rebase auth`

Befehle zur Authentifizierungsverwaltung:

```bash
rebase auth reset-password --email admin@example.com --password NewPassword123!
```

### `rebase api-keys`

Verwalten Sie berechtigungseingeschränkte Service-API-Schlüssel – die Anmeldedaten, die ein Agent,
Skript oder ein anderer Dienst im Gegensatz zur Sitzung eines Endbenutzers verwendet:

```bash
rebase api-keys list
rebase api-keys create --name "Analytics" --permissions '[{"collection":"events","operations":["read"]}]'
rebase api-keys create --name "Full Access" --full-access --expires 90d
rebase api-keys revoke abc123-def456
```

`--permissions` akzeptiert ein JSON-Array von `{ collection, operations }`-Objekten, oder verwenden Sie
`--full-access` für Lesen/Schreiben/Löschen auf jeder Collection und Funktion. `--expires`
akzeptiert `7d`, `30d`, `90d`, `1y` oder ein ISO-Datum, und `--rate-limit` legt die Anfragen
pro 15-Minuten-Fenster fest. Ein Schlüssel wird nur einmal bei der Erstellung angezeigt.

Schlüssel sind zweifach abgesichert: Sowohl die eigenen Berechtigungen des Schlüssels als auch die Row-Level Security
der Identität, als die er agiert, finden Anwendung, sodass ein Schlüssel niemals mehr lesen kann, als diese Identität darf.

### `rebase skills install`

Installieren Sie die Rebase-Referenz-Skills für Ihren KI-Coding-Assistenten. Unterstützt
Cursor, Claude Code, Windsurf, Gemini CLI und Antigravity:

```bash
rebase skills install
rebase skills install --agent claude,cursor
rebase skills install --agent all
```

Siehe [Agent Skills](/docs/ai/skills) für die vollständige Liste und die Speicherorte der geschriebenen Dateien.

### `rebase telemetry`

Anonyme Freigabe von Nutzungsdaten. **`rebase init` fragt einmal pro Projekt nach, und die
Eingabeaufforderung ist standardmäßig auf Ja eingestellt – es wird nichts gesendet, es sei denn, Sie beantworten sie:**

```bash
rebase telemetry status
rebase telemetry show
rebase telemetry enable
rebase telemetry disable
```

`status` gibt die aktuelle Einstellung aus, `show` gibt genau das aus, was gesendet werden würde –
unabhängig davon, ob das Teilen aktiviert ist oder nicht, sodass Sie die Nutzlast vor Ihrer Entscheidung
einsehen können – und die beiden anderen ändern sie. Wenn Sie `init` nie ausgeführt haben, wurde auch
nie etwas erfasst.

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

- **[Schema as Code](/docs/architecture/schema-as-code)** — Wie die Schemagenerierung funktioniert
- **[Quickstart](/docs/getting-started/quickstart)** — Erste Schritte

---
