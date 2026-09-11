---
sourceHash: 27723fe81b7fd939
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

Oder über `pnpm dlx` verwenden:

```bash
pnpm dlx @rebasepro/cli <command>
```

## Maschinenlesbare Ausgabe

`--json` ist die entsprechende Option, und außerhalb der `cloud`-Befehlsfamilie ist es die einzige: `rebase status`, `rebase resources` und `rebase apps list` geben dann bei **jedem** Beenden des Befehls einen einzelnen JSON-Wert auf stdout aus – das Ergebnis oder einen `{"error": {"message", "code", "hint", "issues"}}`-Umschlag mit einem Exit-Code ungleich null –, sodass ein Aufrufer stdout bedingungslos parsen kann. Ohne diese Option geben sie menschenlesbaren Text aus, und Fehler werden an stderr gesendet. `rebase cloud` verwendet denselben Umschlag und ist die einzige Ausnahme von dieser Regel: Es schaltet JSON auch automatisch ein, wenn stdout kein TTY ist oder wenn `REBASE_JSON=1` gesetzt ist. Daher liefert `rebase cloud status | cat` JSON, während `rebase status | cat` dies nicht tut – übergeben Sie in einem Skript explizit `--json`, anstatt sich auf eine der beiden Regeln zu verlassen.

## Befehle

### `rebase init`

Initialisiert ein neues Rebase-Projekt:

```bash
rebase init [directory]
```

Richtet die Projektstruktur mit Frontend-, Backend- und geteilten Packages ein.

| Flag | Funktion |
|---|---|
| `-t, --template <preset>` | `blog`, `ecommerce` oder `blank`. Standardwert: `blog` |
| `--headless` | Nur Backend – kein Admin-Panel und keine Collection-Dateien. `--template` hat keine Auswirkung, da keine Collections zum Seeden vorhanden sind |
| `-y, --yes` | Niemals nachfragen. **Erforderlich überall dort, wo kein Terminal zum Antworten vorhanden ist**, z. B. in CI. Überspringt Git-Init und die Installation von Abhängigkeiten – die interaktiven Standardwerte bejahen beides; übergeben Sie also `--git` / `--install`, wenn Sie dies wünschen |
| `-i, --install` | Abhängigkeiten nach dem Scaffolding installieren |
| `-g, --git` | Ein Repository initialisieren und den ersten Commit erstellen |
| `--database-url <url>` | Eine bestehende Datenbank anstelle der verwalteten verwenden |
| `--introspect` | Collections aus dieser Datenbank generieren. Impliziert `--template blank` und erfordert `--install` |
| `--project <slug>` | Das Gerüst mit einem Rebase Cloud-Projekt verknüpfen |
| `--setup-key <key>` | Der Einmalschlüssel, der diese Verknüpfung authentifiziert |

### `rebase dev`

Startet den Entwicklungsserver:

```bash
rebase dev
```

Startet sowohl Frontend als auch Backend mit Hot Reloading.

Beide Ports werden vom Pfad des Projekts abgeleitet, sodass mehrere Rebase-Projekte nebeneinander laufen können. Verwenden Sie die URLs, die `rebase dev` ausgibt. Einen Port können Sie mit `rebase dev --port 3001` festlegen.

### `rebase build`

Baut das Projekt zu einem bereitstellbaren Bundle in `dist-bundle/`:

```bash
rebase build
```

Das Bundle ist das Artefakt, das Sie bereitstellen – das Runtime-Image lädt es, sodass Sie kein eigenes Anwendungs-Image erstellen müssen. Nützliche Flags:

| Flag | Auswirkung |
|------|------------|
| `--out <dir>` | Schreibt das Bundle an einen anderen Ort als `dist-bundle/` |
| `--vendor` | Abhängigkeiten des Bundles immer installieren und mitliefern |
| `--no-vendor` | Niemals vendoren; der Pod installiert beim ersten Start |
| `--skip-type-check` | Typprüfung überspringen (schneller, weniger sicher) |
| `--no-static` | Erstellung des Frontends überspringen |

Abhängigkeiten werden standardmäßig per Vendoring eingebunden, damit ein Pod-Neustart nicht 35–55 Sekunden für die Installation beansprucht. Ein Verzeichnisbaum, der auf der Festplatte auf über 200 MB anwächst, wird stattdessen verworfen, da das Upload-Limit komprimiert 100 MB beträgt – die Gründe dafür finden Sie im Changelog.

### `rebase start`

Führt das erstellte Bundle als Produktionsserver aus:

```bash
rebase start
```

Liest im Gegensatz zu `rebase dev` die Variable `PORT` und den Rest von `.env` ein. Verweisen Sie mit `rebase start --bundle ./dist-bundle` auf ein Bundle an einem anderen Ort.

### `rebase apps list`

Zeigt die Apps an, die dieses Repository deklariert:

```bash
rebase apps list
```

Ein Repository kann mehr als eine bereitstellbare App deklarieren – beispielsweise ein Backend und eine Marketing-Website. So sehen Sie, worauf sich `rebase build` und das Deployment auswirken.

### `rebase eject`

Übernehmen Sie die vollständige Kontrolle über den Serverprozess und sein Image:

```bash
rebase eject
```

Schreibt den Backend-Einstiegspunkt und ein `Dockerfile` in das Projekt und stellt dessen Backend um, sodass das Repository sein eigenes Image baut, anstatt die veröffentlichte Laufzeitumgebung auszuführen. Ab diesem Zeitpunkt **greifen Plattform-Laufzeit-Upgrades nicht mehr**, und CORS, Auth-Verdrahtung, Storage und Shutdown liegen in Ihrer Verantwortung zur Konfiguration.

Vorschau mit `rebase eject --dry-run`, was auflistet, was sich ändern würde, aber nichts ändert. `--force` ersetzt ein vorhandenes `backend/src/index.ts` oder `env.ts` und behält die aktuelle Datei als `<name>.bak`.

### `rebase schema generate`

Generiert das Drizzle ORM-Schema aus Ihren TypeScript-Collections:

```bash
rebase schema generate
```

Dies liest Ihre Collections aus `config/collections/` und generiert `backend/src/schema.generated.ts` mit Drizzle-Tabellendefinitionen, Enums und Relationen.

### `rebase db push`

Pusht Schemaänderungen direkt in die Datenbank (nur für die Entwicklung):

```bash
rebase db push
```

:::caution
`db push` modifiziert die Datenbank direkt ohne Migrationsdateien. Verwenden Sie `db generate` + `db migrate` für die Produktion.
:::

### `rebase db generate`

Generiert SQL-Migrationsdateien aus Schemaänderungen:

```bash
rebase db generate
```

Erstellt mit Zeitstempel versehene Migrationsdateien in `drizzle/`, die überprüft und committet werden können.

### `rebase db migrate`

Führt ausstehende Datenbankmigrationen aus:

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

`backup` führt `pg_dump` aus; `restore` führt `pg_restore` aus und ist destruktiv, daher ist `--yes` erforderlich. `--out` akzeptiert einen lokalen Pfad oder eine Object-Storage-URL und fällt standardmäßig auf `$BACKUP_DESTINATION` oder `./backups` zurück.

### `rebase db pull`

Kopiert eine andere Datenbank in die lokale Entwicklungsdatenbank:

```bash
rebase db pull --from postgres://…  [--anonymize]
```

`--anonymize` ersetzt personenbezogene Felder beim Import, sodass eine Produktionskopie lokal bearbeitet werden kann, ohne echte Kundendaten auf ein Notebook zu übertragen.

`pg_dump` entfernt Berechtigungen, sodass die Kopie mit den RLS-Policies der Quelle, aber ohne die dahinterliegenden Grants ankommen würde – jeder Lesevorgang als `rebase_user` würde mit `permission denied` fehlschlagen. Der Pull richtet die Anwendungsrolle anschließend neu ein und verwendet dabei dieselbe Routine wie beim Booten und bei `rebase db push`, sodass die internen Tabellen von Rebase wie vorgesehen widerrufen bleiben.

Das Ziel ist immer die lokale Entwicklungsdatenbank dieses Projekts und kann nicht frei gewählt werden: `--database-url` wird verweigert statt akzeptiert, sodass es keine Möglichkeit gibt, einen "Pull in die Produktion" durchzuführen. `--from` ist die einzige Richtung.

### `rebase db url`

Gibt den Verbindungsstring aus, den dieses Projekt verwendet, und nichts weiter, sodass er weitergeleitet werden kann:

```bash
rebase db url
psql "$(rebase db url)"
```

Die verwaltete Entwicklungsdatenbank ist der Fall, der dies erfordert: `.env` lässt `DATABASE_URL` absichtlich auskommentiert, und der Port wird vom Projektpfad abgeleitet, sodass nichts auf der Festplatte ihn benennt. Wenn Sie eine eigene `DATABASE_URL` festgelegt haben, wird diese ausgegeben – die Auflösungsreihenfolge ist dieselbe wie bei jedem anderen Befehl. Der Befehl startet die verwaltete Datenbank, falls sie nicht bereits läuft.

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

PostgreSQL kopiert oder löscht keine Datenbank, mit der noch eine Verbindung besteht – und das übliche "etwas anderes" ist Ihr eigenes `rebase dev`. `create` und `delete` benennen, was die Datenbank offen hält; `--force` trennt diese Sitzungen zuerst.

Jeder Branch ist eine vollständige Kopie auf der Festplatte, daher müssen sie bereinigt werden. `prune` entfernt drei Dinge: einen Eintrag, dessen Datenbank außerhalb von Rebase gelöscht wurde, eine Branch-Datenbank, deren Eintrag nie geschrieben wurde, und – nur mit `--older-than` – Branches, die älter als ein von Ihnen bestimmtes Alter sind. Es fragt vor dem Entfernen nach, es sei denn, Sie übergeben `--yes`.

`switch` speichert den Branch in `.rebase/branch.json` und ändert niemals `.env`. Er hat Vorrang vor `DATABASE_URL` in `.env` und weicht `--database-url` oder einer `DATABASE_URL` in der Shell, sodass ein Flag auf der Befehlszeile immer einen zuvor vorgenommenen Wechsel übersteuert. Das Löschen des Branches, auf dem Sie sich befinden, bringt Sie zur Hauptdatenbank zurück, anstatt den Checkout auf eine nicht mehr vorhandene Datenbank verweisen zu lassen.

:::note[Nicht auf der verwalteten Entwicklungsdatenbank]
`push`, `generate` und `migrate` planen ihre Aufgaben mit Atlas, was eine zweite leere Datenbank zum Vergleichen erfordert – und das verwaltete PGlite stellt genau eine bereit. Die Ausführung dort wird mit einer entsprechenden Meldung abgebrochen. Verweisen Sie `DATABASE_URL` auf ein echtes PostgreSQL für den Migrations-Workflow; `rebase dev` erstellt fehlende Tabellen auf der verwalteten Instanz bereits additiv.

`branch` wird dort aus einem ähnlichen Grund abgelehnt. `CREATE DATABASE ... TEMPLATE` gegen PGlite schreibt einen Katalogeintrag und kopiert nichts, sodass der Branch zu der Datenbank auflösen würde, aus der er geklont wurde – jeder Schreibvorgang, den Sie in einer Sandbox isolieren wollten, würde in Ihrer Entwicklungsdatenbank landen. `rebase dev --docker` liefert Ihnen einen echten Server, mit dem Branches funktionieren.
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
      ✓ S3_BUCKET__MEDIA
      ✓ S3_ACCESS_KEY_ID__MINIO (shared, for S3_ACCESS_KEY_ID__MEDIA)
  ○ exports  s3
      · S3_BUCKET__EXPORTS not set
      └ declared, not configured — uploads here answer 501 STORAGE_SOURCE_NOT_CONFIGURED
```

Drei Dateien bestimmen, was ein Backend erreichen kann, und dieser Befehl gibt alle drei zusammen aus:
`rebase.json` gibt an, wo sich Ihr Code befindet und wer den Server ausführt,
`config/resources.ts` legt fest, was das Projekt benötigt, und die Umgebung bestimmt,
wie die einzelnen Ressourcen erreicht werden. Alles andere – `rebase.resources.json`, das Bundle-Manifest – wird aus der mittleren Datei für Leseprogramme generiert, die Ihren Code nicht ausführen können, und wird niemals manuell geschrieben.

Ein `○` ist der Zustand, den man vor einem Deployment kennen sollte und nicht erst danach: deklariert, aber nicht konfiguriert. Ein `✗` bedeutet, dass die Umgebung etwas *falsch* setzt, was den Start verweigert, anstatt im Betrieb herabgestuft zu laufen.

### `rebase resources`

Was dieses Projekt laut Deklaration benötigt – die Datenbanken, Buckets, Topics und Queues, die sein Konfigurationscode anfordert, sowie die Crons und Funktionen, die seine Dateien definieren:

```bash
rebase resources            # list them
rebase resources --write    # regenerate rebase.resources.json
rebase resources --check    # fail if the committed graph is stale
rebase resources --json     # machine-readable
```

`rebase resources --check` ist neu – das Flag, das ein CI-Job verwendet, um bei einer `rebase.resources.json` fehlzuschlagen, die nicht mehr mit dem Konfigurationscode übereinstimmt.

Eine Ressource wird im Konfigurationscode deklariert – `database("analytics")`, `bucket("media")`, `topic("signups")`, `queue("thumbnails")` – oder ist eine Datei unter `backend/crons` oder `backend/functions`, und wird niemals manuell in `rebase.resources.json` geschrieben. Diese wird aus diesen Deklarationen generiert, damit ein Host lesen kann, was ein Projekt benötigt, ohne es bauen zu müssen. Jeder Eintrag dokumentiert, wer ihn verwendet (`collection:events`, `property:posts.cover`, `function:report`).

Ein Backend verfügt außerdem über eine Standarddatenbank und eine Standard-Storage-Quelle, die niemand deklariert. Beide sind hier aufgeführt, als `implicit` gekennzeichnet und werden nicht in `rebase.resources.json` geschrieben – der Host stellt sie bereit; ein Erfassen würde also anfordern, dass etwas bereitgestellt wird, wonach niemand gefragt hat.

Um zu sehen, was die Plattform für ein Projekt im Vergleich zu dem vorhält, was der Code deklariert, und um eine bereitgestellte Datenbank zu entfernen, die der Code nicht mehr nennt, siehe `rebase cloud resources` weiter unten.

### `rebase cloud`

Alles rund um Rebase Cloud, das sich in der Private Beta befindet. Siehe den [Rebase Cloud-Leitfaden](/docs/deployment/cloud/) für Details darüber, was es ist und was die Beta nicht enthält.

Jede Befehlsgruppe reagiert auf `--help`, und `--help` führt den Befehl niemals aus. Die meisten Befehle wirken sich auf das verknüpfte Projekt in `.rebase/cloud.json` aus; `--project <id>` operiert auf einem Projekt, ohne es zu verknüpfen.

Drei Optionen gelten überall: `--json` für maschinenlesbare Ausgabe (auch standardmäßig bei Weiterleitung über eine Pipe oder mit `REBASE_JSON=1`), `--url <origin>`, um eine bestimmte Control Plane anzusteuern (oder `REBASE_CLOUD_URL`), und `--project, -p <id>`.

#### Authentifizierung

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

#### Bereitstellen und Überwachen

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

`deploy` ohne Angabe eines App-Namens stellt das Backend bereit.

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
rebase cloud db list | create | info | connect | test
rebase cloud db backup list | create | restore | status | download
rebase cloud db pitr status | restore | cutover | discard
```

`db connect` öffnet einen lokalen Port, der *die* verwaltete Datenbank darstellt – welche keinen öffentlichen Endpunkt besitzt – und hält ihn bis Strg-C offen. `--reveal` zeigt das Passwort mit an.

#### Ressourcen

Was die Plattform für das Projekt vorhält, verglichen mit dem, was sein Code deklariert.

```bash
rebase cloud resources                       # each database and bucket: declared? provisioned?
rebase cloud resources prune database <key>  # remove one the code no longer declares
```

Ein Deployment entfernt niemals eine bereitgestellte Datenbank, wenn deren Deklaration entfällt – das wären Daten, die durch einen Push gelöscht würden. Sie wird beibehalten, gebunden und abgerechnet, bis jemand sie namentlich bereinigt (pruned).

#### Compute

Was das Projekt reserviert und was das kostet.

```bash
rebase cloud compute            # the current reservation and its monthly cost
rebase cloud compute set        # change it
```

`compute set` akzeptiert `--cpu`, `--memory`, `--replicas`, `--spot`, `--scale-to-zero`, `--db-mode`, `--db-instances`, `--db-cpu`, `--db-memory`, `--storage`, `--autoscale-max`, `--autoscale-cpu-target` und `--no-autoscale`. Es gibt keine Tarifstufen: Alles wird pro Ressource abgerechnet. Siehe [Rebase Cloud](/docs/deployment/cloud/).

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

Generiert ein typisiertes Client-SDK aus Ihren Collection-Definitionen:

```bash
rebase generate-sdk
```

Erstellt TypeScript-Typen und einen typsicheren Client für alle Ihre Collections.

### `rebase doctor`

```bash
rebase doctor
```

Der Befehl, den man ausführt, wenn etwas nicht stimmt und man noch nicht weiß, woran es liegt. Er liefert Berichte und ändert niemals etwas, sodass er für jede erreichbare Datenbank sicher ausgeführt werden kann.

**Ohne Datenbank.** Diese Prüfungen laufen zuerst, da alles, was ein Projekt am Funktionieren hindert, passiert, bevor eine Tabelle verglichen werden kann:

| Prüfung | Warum |
| --- | --- |
| Node-Version | Gegen den von der CLI deklarierten Bereich. Eine zu alte Version wird nicht als „nicht unterstütztes Node“ gemeldet – es ist ein Syntaxfehler innerhalb einer Abhängigkeit. |
| Paketmanager | Zwei Lockfiles in einem Projekt. `npm install` in einem pnpm-Workspace schreibt `node_modules` in ein Layout um, dem pnpm widerspricht, und das Symptom ist Stunden später `Cannot find module`. |
| Doppelte Slugs | Die Registry behält die zuletzt registrierte Collection, sodass die andere nicht als fehlend gemeldet wird – sie wird als Gewinner unter ihrem eigenen Namen bereitgestellt. |
| `.env`-Plausibilität | Ein `JWT_SECRET`, das kürzer als 32 Zeichen ist (womit der Boot in Produktion verweigert wird), und `NODE_ENV=production` ohne `CORS_ORIGINS` oder `FRONTEND_URL`. Werte werden niemals ausgegeben. |
| `@rebasepro/*`-Versionsabweichung | Dasselbe Paket ist in verschiedenen `package.json`-Dateien des Projekts auf unterschiedliche Versionen gepinnt. Zwei Kopien unterbrechen `instanceof` zwischen ihnen, was als Type Guard fehlschlägt, der seinen eigenen Typ ablehnt. |
| Verbindungsstrings | Ein uncodiertes `=` in einem URL-Parameter, dessen Parsing die PostgreSQL-eigenen Tools verweigern – wodurch Backups und `psql` fehlschlagen, während die App weiter funktioniert. |
| Benutzerdefinierte Funktionen | Was jede Funktion von ihrem Host benötigt und welche davon nicht auf einer Edge-Runtime laufen würden. |

**Gegen die Datenbank**, wenn `DATABASE_URL` gesetzt ist:

| Prüfung | Warum |
| --- | --- |
| Collections → generiertes Schema | Ob `schema.generated.ts` veraltet ist. |
| Collections → Datenbank | Fehlende Tabellen, Spalten, Enums, Fremdschlüssel und Verknüpfungen (Junctions). |
| Erforderliche Extensions | Eine Eigenschaft mit `{ type: "vector" }` benötigt pgvector, das Rebase nur dort installiert, wo ein Projekt dies deklariert hat. |
| Schema-Stempel | Ob diese Datenbank aus diesen Collections provisioniert wurde. Ein Hash, der aussagen kann, dass beide nicht übereinstimmen, aber niemals, welches davon weiter vorn liegt. |
| Collections → SDK-Typen | Ob das generierte typisierte SDK veraltet ist. |
| RLS-Policies | Ob die Policies der Datenbank den von Ihnen deklarierten `securityRules` entsprechen und ob eine Policy eine Rolle benennt, die dieser Server nicht verwenden kann. |

Wenn die Datenbank nicht erreichbar ist, werden ihre Phasen mit der entsprechenden Begründung als übersprungen gemeldet und der Rest läuft trotzdem weiter – siehe [Fehlerbehebung](/docs/troubleshooting/).

Gibt einen Exit-Code ungleich null zurück, wenn eine Prüfung einen Fehler findet oder wenn eine Phase nicht ausgeführt werden konnte, weil die angegebene Datenbank Verbindungen verweigert. Eine Phase, die übersprungen wurde, weil Sie keine `DATABASE_URL` festgelegt haben, gilt nicht als Fehler.

`rebase doctor --policies` führt nur die RLS-Prüfungen durch – kein Schema-Diff, keine SDK-Typen – und schlägt im Zweifelsfall fehl (fail closed), was es zur idealen Variante für ein CI-Gate gegen eine bereitgestellte Datenbank macht.

### `rebase auth`

Befehle zur Authentifizierungsverwaltung:

```bash
rebase auth reset-password --email admin@example.com --password NewPassword123!
```

### `rebase api-keys`

Verwalten Sie berechtigungseingeschränkte Service-API-Schlüssel – die Anmeldedaten, die ein Agent, ein Skript oder ein anderer Dienst verwendet, im Gegensatz zur Sitzung eines Endbenutzers:

```bash
rebase api-keys list
rebase api-keys create --name "Analytics" --permissions '[{"collection":"events","operations":["read"]}]'
rebase api-keys create --name "Full Access" --full-access --expires 90d
rebase api-keys revoke abc123-def456
```

`--permissions` nimmt ein JSON-Array von `{ collection, operations }`-Objekten entgegen, oder verwenden Sie `--full-access` für Lese-/Schreib-/Löschrechte auf allen Collections und Funktionen. `--expires` akzeptiert `7d`, `30d`, `90d`, `1y` oder ein ISO-Datum, und `--rate-limit` legt Anfragen pro 15-Minuten-Fenster fest. Ein Schlüssel wird nur einmal bei der Erstellung angezeigt.

Schlüssel sind doppelt abgesichert: Sowohl die eigenen Berechtigungen des Schlüssels als auch die Row-Level Security der Identität, als die er agiert, greifen, sodass ein Schlüssel niemals mehr lesen kann, als diese Identität darf.

### `rebase skills install`

Installieren Sie die Rebase-Referenz-Skills für Ihren KI-Coding-Assistenten. Unterstützt Cursor, Claude Code, Windsurf, Gemini CLI und Antigravity:

```bash
rebase skills install
rebase skills install --agent claude,cursor
rebase skills install --agent all
```

Siehe [Agent Skills](/docs/ai/skills) für die vollständige Liste und die Speicherorte der geschriebenen Dateien.

### `rebase telemetry`

Anonyme Nutzungsdatenübermittlung. **`rebase init` fragt einmal pro Projekt nach, und die Eingabeaufforderung ist standardmäßig auf Ja eingestellt – es wird nichts gesendet, es sei denn, Sie beantworten sie:**

```bash
rebase telemetry status
rebase telemetry show
rebase telemetry enable
rebase telemetry disable
```

`status` gibt die aktuelle Einstellung aus, `show` gibt exakt das aus, was gesendet werden würde – unabhängig davon, ob das Teilen aktiviert ist oder nicht, sodass Sie die Payload vor einer Entscheidung prüfen können –, und die anderen beiden ändern die Einstellung. Wenn Sie `init` nie ausgeführt haben, wurde nie etwas erfasst.

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
- **[Schnellstart](/docs/getting-started/quickstart)** — Erste Schritte

---
