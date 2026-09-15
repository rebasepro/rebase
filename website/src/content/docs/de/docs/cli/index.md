---
sourceHash: 8060b4b8b622955b
title: CLI-Referenz
sidebar_label: CLI
description: Rebase CLI-Befehle für Projektinitialisierung, Schemagenerierung, Datenbankmigrationen und SDK-Generierung.
---

## Übersicht

Das Rebase CLI (`rebase`) verwaltet Ihr Projekt vom Scaffolding bis zum Deployment.

## Installation

```bash
pnpm add -g @rebasepro/cli
```

Oder über `pnpm dlx` ausführen:

```bash
pnpm dlx @rebasepro/cli <command>
```

## Maschinenlesbare Ausgabe

`--json` ist der Schalter, und außerhalb der `cloud`-Befehlsfamilie ist es der einzige: `rebase status`, `rebase resources`, `rebase apps list` und <span class="since-badge" data-since="0.22">Since 0.22</span> `rebase upgrade` geben dann genau einen JSON-Wert auf stdout aus — das Ergebnis oder einen `{"error": {"message", "code", "hint", "issues"}}`-Umschlag bei einem Exit-Code ungleich null — und zwar bei **jedem** Beenden des Befehls, sodass ein Aufrufer stdout bedingungslos parsen kann. Ohne diesen Schalter geben sie menschenlesbaren Text aus und Fehler gehen nach stderr. `rebase cloud` verwendet denselben Umschlag und ist die einzige Ausnahme von diesem Schalter: Es aktiviert JSON auch automatisch, wenn stdout kein TTY ist oder wenn `REBASE_JSON=1` gesetzt ist. Daher liefert `rebase cloud status | cat` JSON, während `rebase status | cat` dies nicht tut — übergeben Sie in einem Skript explizit `--json`, anstatt sich auf eine der beiden Regeln zu verlassen.

## Befehle

### `rebase init`

Initialisiert ein neues Rebase-Projekt:

```bash
rebase init [directory]
```

Richtet die Projektstruktur mit Frontend-, Backend- und Shared-Packages ein.

| Flag | Funktion |
|---|---|
| `-t, --template <preset>` | `blog`, `ecommerce` oder `blank`. Standard: `blog` |
| `--headless` | Nur Backend — kein Admin-Panel und keine Collection-Dateien. `--template` hat keine Auswirkung, da keine Collections zum Seeden vorhanden sind |
| `-y, --yes` | Niemals nachfragen. **Erforderlich überall dort, wo kein Terminal zum Antworten vorhanden ist**, wie z. B. in CI. Überspringt Git-Init und die Installation von Abhängigkeiten — die interaktiven Standardwerte bejahen beides; übergeben Sie also `--git` / `--install`, falls Sie diese wünschen |
| `-i, --install` | Abhängigkeiten nach dem Scaffolding installieren |
| `-g, --git` | Ein Repository initialisieren und den ersten Commit erstellen |
| `--database-url <url>` | Eine bestehende Datenbank anstelle der verwalteten verwenden |
| `--introspect` | Collections aus dieser Datenbank generieren. Impliziert `--template blank` und erfordert `--install` |
| `--project <slug>` | Das Scaffold mit einem Rebase Cloud-Projekt verknüpfen |
| `--setup-key <key>` | Der Einmalschlüssel, der diese Verknüpfung authentifiziert |

### `rebase dev`

Startet den Entwicklungsserver:

```bash
rebase dev
```

Startet sowohl Frontend als auch Backend mit Hot Reloading.

Beide Ports werden vom Pfad des Projekts abgeleitet, sodass mehrere Rebase-Projekte nebeneinander laufen können. Verwenden Sie die URLs, die `rebase dev` ausgibt. Pinnen Sie einen Port mit `rebase dev --port 3001` fest.

### `rebase build`

Erstellt das Projekt als deploybares Bundle in `dist-bundle/`:

```bash
rebase build
```

Das Bundle ist das Artefakt, das Sie deployen — das Runtime-Image lädt es, sodass Sie kein eigenes Anwendungs-Image erstellen müssen. Nützliche Flags:

| Flag | Wirkung |
|------|--------|
| `--out <dir>` | Schreibt das Bundle an einen anderen Ort als `dist-bundle/` |
| `--vendor` | Abhängigkeiten des Bundles immer installieren und mitliefern |
| `--no-vendor` | Niemals vendoren; der Pod installiert beim ersten Start |
| `--skip-type-check` | Typprüfung überspringen (schneller, weniger sicher) |
| `--no-static` | Erstellung des Frontends überspringen |

Abhängigkeiten werden standardmäßig gevendort, damit ein Pod-Neustart nicht jedes Mal eine 35–55 Sekunden dauernde Installation durchführen muss. Ein Verzeichnisbaum, der auf der Festplatte über 200 MB anwächst, wird stattdessen verworfen, da das Upload-Limit komprimiert 100 MB beträgt — siehe Changelog für die Begründung.

### `rebase upgrade`

<span class="since-badge" data-since="0.22">Since 0.22</span> Hebt jedes `@rebasepro/*`-Paket, das das Projekt pinnt, auf ein einziges
Release an und installiert dann mit dem Paketmanager, den die Lockfile nennt.
`rebase upgrade` nimmt das neueste Release, `--to 0.21.0` eine exakte Version ohne
Registry-Abfrage, `--to canary` einen Dist-Tag. Jeder Pin in `dependencies`,
`devDependencies` und `optionalDependencies`, in jeder `package.json` unter dem
Projekt, behält sein `^` oder `~`, und sonst ändert sich nichts an der Datei.
`peerDependencies` sowie `workspace:`-, `link:`-, `file:`-, Git- und Tag-Angaben
werden aufgelistet und bleiben unverändert. Overrides in `pnpm-workspace.yaml` und
`package.json` werden ebenso angehoben, aber ein `link:`- oder `file:`-Override
gewinnt gegen jeden Pin: Er wird gemeldet, und `--drop-local-overrides` entfernt
ihn. `--dry-run` schreibt nichts, `--no-install` überspringt die Installation, und
`--json` gibt ein einziges Dokument aus.

### `rebase start`

Führt das erstellte Bundle als Produktionsserver aus:

```bash
rebase start
```

Liest im Gegensatz zu `rebase dev` `PORT` und den Rest von `.env` ein. Verweisen Sie mit `rebase start --bundle ./dist-bundle` auf ein Bundle an einem anderen Ort.

### `rebase apps list`

Zeigt die Apps an, die dieses Repository deklariert:

```bash
rebase apps list
```

Ein Repository kann mehr als eine deploybare App deklarieren — beispielsweise ein Backend und eine Marketing-Website. So sehen Sie, worauf `rebase build` und Deployments wirken.

### `rebase eject`

Übernehmen Sie die Kontrolle über den Serverprozess und sein Image:

```bash
rebase eject
```

Schreibt den Backend-Entrypoint und ein `Dockerfile` in das Projekt und stellt das Backend um, sodass das Repository sein eigenes Image baut, anstatt die veröffentlichte Runtime auszuführen. Von da an **erreichen Plattform-Runtime-Upgrades das Projekt nicht mehr**, und CORS, Auth-Verdrahtung, Speicher und Shutdown müssen von Ihnen selbst konfiguriert werden.

Erstellen Sie eine Vorschau mit `rebase eject --dry-run`, was auflistet, was sich ändern würde, ohne etwas zu ändern. `--force` ersetzt eine bestehende `backend/src/index.ts` oder `env.ts` und behält die aktuelle Datei als `<name>.bak`.

### `rebase schema generate`

Generiert ein Drizzle-ORM-Schema aus Ihren TypeScript-Collections:

```bash
rebase schema generate
```

Liest Ihre Collections aus `config/collections/` und generiert `backend/src/schema.generated.ts` mit Drizzle-Tabellendefinitionen, Enums und Relationen.

### `rebase db push`

Überträgt Schemaänderungen direkt in die Datenbank (nur für die Entwicklung):

```bash
rebase db push
```

:::caution
`db push` ändert die Datenbank direkt ohne Migrationsdateien. Verwenden Sie `db generate` + `db migrate` für die Produktion.
:::

### `rebase db generate`

Generiert SQL-Migrationsdateien aus Schemaänderungen:

```bash
rebase db generate
```

Erstellt mit Zeitstempeln versehene Migrationsdateien in `drizzle/`, die überprüft und committet werden können.

### `rebase db migrate`

Führt ausstehende Datenbankmigrationen aus:

```bash
rebase db migrate
```

Wendet alle nicht angewendeten Migrationen auf die Datenbank an.

### `rebase db backup` / `backups` / `restore`

```bash
rebase db backup --out ./backups        # or s3://bucket/prefix, gs://bucket/prefix
rebase db backups list                  # list what is stored
rebase db restore ./backups/<file>.dump --yes
```

`backup` führt `pg_dump` aus; `restore` führt `pg_restore` aus und ist destruktiv, weshalb es `--yes` erfordert. `--out` akzeptiert einen lokalen Pfad oder eine Object-Storage-URL und fällt standardmäßig auf `$BACKUP_DESTINATION` oder `./backups` zurück.

### `rebase db pull`

Kopiert eine andere Datenbank in die lokale Entwicklungsdatenbank:

```bash
rebase db pull --from postgres://…  [--anonymize]
```

`--anonymize` ersetzt personenbezogene Felder beim Importieren, sodass mit einer Produktionskopie lokal gearbeitet werden kann, ohne echte Kundendaten auf einen Laptop zu laden.

`pg_dump` entfernt Berechtigungen, sodass die Kopie mit den RLS-Policies der Quelle ankäme, aber ohne die zugrunde liegenden Grants — jeder Lesezugriff als `rebase_user` würde mit `permission denied` fehlschlagen. Der Pull provisioniert die Anwendungsrolle anschließend neu, indem dieselbe Routine verwendet wird wie beim Booten und bei `rebase db push`, sodass die internen Tabellen von Rebase wie vorgesehen gesperrt bleiben.

Das Ziel ist immer die lokale Entwicklungsdatenbank dieses Projekts und kann nicht frei gewählt werden: `--database-url` wird abgelehnt statt akzeptiert, sodass es keine Möglichkeit gibt, ein "Pull in die Produktion" auszuführen. `--from` ist die einzige Richtung.

### `rebase db url`

Gibt den Connection-String aus, den dieses Projekt verwendet, und nichts anderes, damit er weitergeleitet (gepipet) werden kann:

```bash
rebase db url
psql "$(rebase db url)"
```

Die verwaltete Entwicklungsdatenbank ist der Fall, der dies benötigt: `.env` lässt `DATABASE_URL` absichtlich auskommentiert, und der Port wird vom Projektpfad abgeleitet, sodass nichts auf der Festplatte den Namen nennt. Wenn Sie eine eigene `DATABASE_URL` festgelegt haben, gibt der Befehl diese aus — die Auflösungsreihenfolge ist dieselbe wie bei jedem anderen Befehl. Er startet die verwaltete Datenbank, falls sie nicht bereits läuft.

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

PostgreSQL kopiert oder löscht keine Datenbank, mit der noch etwas verbunden ist, und das typische "etwas" ist Ihr eigenes `rebase dev`. `create` und `delete` nennen, was die Datenbank offen hält; `--force` trennt diese Sitzungen zuerst.

Jeder Branch ist eine vollständige Kopie auf der Festplatte, daher müssen sie aufgeräumt werden. `prune` entfernt drei Dinge: einen Eintrag, dessen Datenbank außerhalb von Rebase gelöscht wurde, eine Branch-Datenbank, deren Eintrag nie geschrieben wurde, und — nur mit `--older-than` — Branches, die ein von Ihnen angegebenes Alter überschreiten. Es fragt vor dem Entfernen nach, es sei denn, Sie übergeben `--yes`.

`switch` vermerkt den Branch in `.rebase/branch.json` und bearbeitet niemals `.env`. Es hat Vorrang vor `DATABASE_URL` in `.env` und unterliegt `--database-url` oder einer `DATABASE_URL` in der Shell, sodass ein Flag auf der Befehlszeile immer Vorrang vor einem zuvor durchgeführten Switch hat. Das Löschen des Branches, auf dem Sie sich gerade befinden, bringt Sie zur Hauptdatenbank zurück, anstatt den Checkout auf eine nicht mehr existierende Datenbank verweisen zu lassen.

:::note[Nicht auf der verwalteten Entwicklungsdatenbank]
`push`, `generate` und `migrate` planen ihre Arbeit mit Atlas, welches eine zweite leere Datenbank zum Vergleichen benötigt — und das verwaltete PGlite stellt genau eine bereit. Das Ausführen dieser Befehle dort stoppt mit einer entsprechenden Meldung. Verweisen Sie `DATABASE_URL` für den Migrations-Workflow auf ein echtes PostgreSQL; `rebase dev` erstellt fehlende Tabellen auf der verwalteten Datenbank bereits additiv.

`branch` wird dort aus einem ähnlichen Grund abgelehnt. `CREATE DATABASE ... TEMPLATE` schreibt gegen PGlite einen Katalogeintrag und kopiert nichts, sodass der Branch auf die Datenbank verweisen würde, von der er geklont wurde — jeder Schreibvorgang, den Sie isolieren wollten, würde in Ihrer Entwicklungsdatenbank landen. `rebase dev --docker` liefert Ihnen einen echten Server, mit dem Branches funktionieren.
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

Drei Dateien bestimmen, worauf ein Backend zugreifen kann, und dieser Befehl gibt alle drei zusammen aus:
`rebase.json` gibt an, wo sich Ihr Code befindet und wer den Server ausführt,
`config/resources.ts` gibt an, was das Projekt benötigt, und die Umgebung gibt an,
wie die einzelnen Ressourcen erreichbar sind. Alles andere — `rebase.resources.json`, das Bundle-Manifest — wird aus der mittleren Datei für Leser generiert, die Ihren Code nicht ausführen können, und wird niemals manuell geschrieben.

Ein `○` ist der Status, den man vor einem Deploy und nicht erst danach kennen sollte: deklariert, aber nicht konfiguriert. Ein `✗` bedeutet, dass die Umgebung etwas *falsch* setzt, was den Bootvorgang verweigert, anstatt in einen eingeschränkten Betrieb überzugehen.

### `rebase resources`

Was dieses Projekt laut Deklaration benötigt — die Datenbanken, Buckets, Topics und Queues, die sein Konfigurationscode anfordert, und die Crons und Funktionen, die seine Dateien definieren:

```bash
rebase resources            # list them
rebase resources --write    # regenerate rebase.resources.json
rebase resources --check    # fail if the committed graph is stale
rebase resources --json     # machine-readable
```

`rebase resources --check` ist neu — das Flag, das ein CI-Job verwendet, um fehlzuschlagen, wenn eine `rebase.resources.json` nicht mehr mit dem Konfigurationscode übereinstimmt.

Eine Ressource wird im Konfigurationscode deklariert — `database("analytics")`, `bucket("media")`, `topic("signups")`, `queue("thumbnails")` — oder ist eine Datei unter `backend/crons` oder `backend/functions` und wird niemals manuell in `rebase.resources.json` geschrieben. Letztere wird aus diesen Deklarationen generiert, damit ein Host lesen kann, was ein Projekt benötigt, ohne es bauen zu müssen. Jeder Eintrag zeichnet auf, wer ihn verwendet (`collection:events`, `property:posts.cover`, `function:report`).

Ein Backend verfügt außerdem über eine Standarddatenbank und eine Standard-Speicherquelle, die niemand deklariert. Beide werden hier aufgelistet, als `implicit` markiert und keine von beiden wird in `rebase.resources.json` geschrieben — der Host stellt sie bereit, sodass ihre Erfassung die Provisionierung von etwas anfordern würde, nach dem niemand gefragt hat.

Um zu sehen, was die Plattform für ein Projekt im Vergleich zu dem hält, was sein Code deklariert, und um eine provisionierte Datenbank zu entfernen, die der Code nicht mehr nennt, siehe `rebase cloud resources` weiter unten.

### `rebase cloud`

Alles rund um Rebase Cloud, das sich in der privaten Beta befindet. Im [Rebase Cloud Leitfaden](/docs/deployment/cloud/) erfahren Sie, worum es sich handelt und was die Beta nicht enthält.

Jede Gruppe unterstützt `--help`, und `--help` führt den Befehl niemals aus. Die meisten Befehle wirken auf das verknüpfte Projekt in `.rebase/cloud.json`; `--project <id>` operiert auf einem Projekt ohne Verknüpfung.

Drei Optionen gelten überall: `--json` für maschinenlesbare Ausgaben (auch Standard bei Weiterleitung per Pipe oder mit `REBASE_JSON=1`), `--url <origin>`, um eine bestimmte Control-Plane anzusteuern (oder `REBASE_CLOUD_URL`), und `--project, -p <id>`.

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

#### Deployen und Beobachten

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

`deploy` ohne App-Namen deployt das Backend. <span class="since-badge" data-since="0.22">Since 0.22</span> Ein Backend-Bundle-Deploy
lädt außerdem den Quellcode des Projekts hoch — was Git verfolgt, niemals eine `.env` —,
damit ein Plattform-Upgrade es neu bauen kann; `--no-source` überspringt das.
`--allow-downgrade` deployt ein Bundle, das auf einem älteren Release gebaut wurde, als das Projekt ausführt.

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

`db connect` öffnet einen lokalen Port, der die verwaltete Datenbank *ist* (kein öffentlicher Endpunkt), bis Strg-C gedrückt wird; `--reveal` fügt das Passwort hinzu. Nur für Owner oder Admin.

#### Ressourcen

Was die Plattform für das Projekt bereithält, im Vergleich zu dem, was sein Code deklariert.

```bash
rebase cloud resources                       # each database and bucket: declared? provisioned?
rebase cloud resources prune database <key>  # remove one the code no longer declares
```

Ein Deployment entfernt niemals eine provisionierte Datenbank, wenn deren Deklaration entfernt wird — das wäre ein Datenverlust durch einen Push. Sie wird beibehalten, gebunden und abgerechnet, bis jemand sie namentlich bereinigt (`prune`).

#### Compute

Was das Projekt reserviert und was das kostet.

```bash
rebase cloud compute            # the current reservation and its monthly cost
rebase cloud compute set        # change it
```

`compute set` akzeptiert `--cpu`, `--memory`, `--replicas`, `--spot`, `--scale-to-zero`, `--db-instances`, `--db-cpu`, `--db-memory`, `--storage`, `--autoscale-max`, `--autoscale-cpu-target` und `--no-autoscale`. Es gibt keine Tarifstufen: Alles wird pro Ressource abgerechnet. Siehe [Rebase Cloud](/docs/deployment/cloud/).

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

Generiert ein typisiertes Client-SDK aus Ihren Collection-Definitionen:

```bash
rebase generate-sdk
```

Erstellt TypeScript-Typen und einen typsicheren Client für alle Ihre Collections.

### `rebase doctor`

```bash
rebase doctor
```

Der Befehl, den man ausführt, wenn etwas nicht stimmt und man noch nicht weiß, woran es liegt. Er liefert Berichte und ändert niemals etwas, sodass er für jede erreichbare Datenbank sicher ist.

**Ohne Datenbank.** Diese Prüfungen laufen zuerst, da alles, was ein Projekt am Funktionieren hindert, passiert, bevor eine Tabelle verglichen werden kann:

| Prüfung | Grund |
| --- | --- |
| Node-Version | Abgleich mit dem Bereich, den die CLI deklariert. Eine zu alte Version wird nicht als "nicht unterstütztes Node" gemeldet — es ist ein Syntaxfehler innerhalb einer Abhängigkeit. |
| Paketmanager | Zwei Lockfiles in einem Projekt. Ein `npm install` in einem pnpm-Workspace schreibt `node_modules` in ein Layout um, mit dem pnpm nicht übereinstimmt, und das Symptom ist Stunden später `Cannot find module`. |
| Doppelte Slugs | Die Registry behält die zuletzt registrierte Collection bei, sodass die andere nicht als fehlend gemeldet wird — sie wird als Gewinner unter ihrem eigenen Namen bereitgestellt. |
| `.env`-Plausibilität | Ein `JWT_SECRET`, das kürzer als 32 Zeichen ist (womit der Bootvorgang in der Produktion verweigert wird), und `NODE_ENV=production` ohne `CORS_ORIGINS` oder `FRONTEND_URL`. Werte werden niemals ausgegeben. |
| `@rebasepro/*`-Versionsabweichung | Dasselbe Paket ist in verschiedenen `package.json`-Dateien des Projekts auf unterschiedliche Versionen gepinnt. Zwei Kopien brechen das Zusammenspiel von `instanceof`, was dazu führt, dass ein Type-Guard seinen eigenen Typ ablehnt. |
| Connection-Strings | Ein nicht encodiertes `=` in einem URL-Parameter, dessen Parsing die eigenen Tools von PostgreSQL verweigern — Backups und `psql` schlagen fehl, während die App weiterläuft. |
| Benutzerdefinierte Funktionen | Was jede Funktion von ihrem Host benötigt und welche davon nicht auf einer Edge-Runtime laufen würden. |

**Gegen die Datenbank**, wenn `DATABASE_URL` gesetzt ist:

| Prüfung | Grund |
| --- | --- |
| Collections → generiertes Schema | Ob `schema.generated.ts` veraltet ist. |
| Collections → Datenbank | Fehlende Tabellen, Spalten, Enums, Fremdschlüssel und Verknüpfungstabellen (Junctions). |
| Erforderliche Erweiterungen | Eine Eigenschaft `{ type: "vector" }` benötigt pgvector, welches Rebase nur dort installiert, wo ein Projekt dies deklariert hat. |
| Schema-Stempel | Ob diese Datenbank aus diesen Collections provisioniert wurde. Ein Hash, der angeben kann, dass beide nicht übereinstimmen, aber niemals, welche weiter fortgeschritten ist. |
| Collections → SDK-Typen | Ob das generierte typisierte SDK veraltet ist. |
| RLS-Policies | Ob die Policies der Datenbank den von Ihnen deklarierten `securityRules` entsprechen und ob eine Policy eine Rolle nennt, die dieser Server nicht verwenden kann. |

Ist die Datenbank nicht erreichbar, werden deren Phasen mit der Begründung als übersprungen gemeldet und der Rest läuft trotzdem durch — siehe [Fehlerbehebung](/docs/troubleshooting/).

Beendet sich mit einem Exit-Code ungleich null, wenn eine Prüfung einen Fehler findet oder wenn eine Phase nicht ausgeführt werden konnte, weil die angegebene Datenbank Verbindungen ablehnt. Eine Phase, die übersprungen wurde, weil Sie keine `DATABASE_URL` festgelegt haben, gilt nicht als Fehler.

`rebase doctor --policies` führt nur die RLS-Prüfungen durch — kein Schema-Diff, keine SDK-Typen — und blockiert im Fehlerfall ("fails closed"), was es zur idealen Variante für den Einsatz als CI-Gate gegen eine deployte Datenbank macht.

### `rebase auth`

Befehle zur Authentifizierungsverwaltung:

```bash
rebase auth reset-password --email admin@example.com --password NewPassword123!
```

### `rebase api-keys`

Verwaltet berechtigungseingeschränkte Service-API-Schlüssel — die Anmeldedaten, die ein Agent, Skript oder ein anderer Dienst verwendet, im Gegensatz zur Sitzung eines Endbenutzers:

```bash
rebase api-keys list
rebase api-keys create --name "Analytics" --permissions '[{"collection":"events","operations":["read"]}]'
rebase api-keys create --name "Full Access" --full-access --expires 90d
rebase api-keys revoke abc123-def456
```

`--permissions` nimmt ein JSON-Array von `{ collection, operations }`-Objekten entgegen, oder verwenden Sie `--full-access` für Lese-/Schreib-/Löschrechte auf allen Collections und Funktionen. `--expires` akzeptiert `7d`, `30d`, `90d`, `1y` oder ein ISO-Datum, und `--rate-limit` legt die Anfragen pro 15-Minuten-Fenster fest. Ein Schlüssel wird nur einmal bei der Erstellung angezeigt.

Schlüssel sind doppelt abgesichert: Sowohl die Berechtigungen des Schlüssels selbst als auch die Row-Level-Security der Identität, als die er agiert, greifen gleichermaßen. Ein Schlüssel kann also niemals mehr lesen, als diese Identität darf.

### `rebase skills install`

Installiert die Rebase-Referenz-Skills für Ihren KI-Coding-Assistenten. Unterstützt Cursor, Claude Code, Windsurf, Gemini CLI und Antigravity:

```bash
rebase skills install
rebase skills install --agent claude,cursor
rebase skills install --agent all
```

Die vollständige Liste und die Zielpfade der Dateien finden Sie unter [Agent Skills](/docs/ai/skills).

### `rebase telemetry`

Anonyme Erfassung von Nutzungsdaten. **`rebase init` fragt einmal pro Projekt nach, und die Abfrage ist standardmäßig auf Ja eingestellt — es wird nichts gesendet, es sei denn, Sie beantworten sie:**

```bash
rebase telemetry status
rebase telemetry show
rebase telemetry enable
rebase telemetry disable
```

`status` gibt die aktuelle Einstellung aus, `show` gibt genau das aus, was gesendet werden würde — unabhängig davon, ob das Teilen aktiviert ist, sodass Sie die Payload vor Ihrer Entscheidung einsehen können — und die beiden anderen Befehle ändern die Einstellung. Wenn Sie `init` nie ausgeführt haben, wurde auch nie etwas erfasst.

## Nächste Schritte

- **[Schemagenerierung](/docs/cli/schema/#production-workflow)** — Der Migrations-Workflow, von der Änderung einer Collection bis zur Produktion
- **[Schema as Code](/docs/architecture/schema-as-code)** — Wie die Schemagenerierung funktioniert
- **[Schnellstart](/docs/getting-started/quickstart)** — Erste Schritte
