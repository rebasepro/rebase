---
sourceHash: 7fbdafd20900a251
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

Oder via `pnpm dlx` verwenden:

```bash
pnpm dlx @rebasepro/cli <command>
```

## Maschinenlesbare Ausgabe

`--json` ist die entsprechende Option, und außerhalb der `cloud`-Befehlsfamilie ist es die einzige: `rebase status`, `rebase resources` und `rebase apps list` geben dann genau einen JSON-Wert auf stdout aus — das Ergebnis oder ein `{"error": {"message", "code", "hint", "issues"}}`-Envelope mit einem Exit-Code ungleich null — bei **jedem** Beenden des Befehls, sodass ein Aufrufer stdout bedingungslos parsen kann. Ohne diese Option wird menschenlesbarer Text ausgegeben und Fehler gehen an stderr. `rebase cloud` verwendet dasselbe Envelope und bildet die einzige Ausnahme für diesen Schalter: Es aktiviert JSON auch automatisch von selbst, wenn stdout kein TTY ist oder wenn `REBASE_JSON=1` gesetzt ist. `rebase cloud status | cat` liefert also JSON, während `rebase status | cat` dies nicht tut — übergeben Sie in einem Skript explizit `--json`, anstatt sich auf eine der beiden Regeln zu verlassen.

## Befehle

### `rebase init`

Initialisieren Sie ein neues Rebase-Projekt:

```bash
rebase init [directory]
```

Richtet die Projektstruktur mit Frontend, Backend und gemeinsam genutzten Paketen ein.

| Flag | Funktion |
|---|---|
| `-t, --template <preset>` | `blog`, `ecommerce` oder `blank`. Standard: `blog` |
| `--headless` | Nur Backend — kein Admin-Panel und keine Collection-Dateien. `--template` hat keine Auswirkung, da keine Collections zum Seeden vorhanden sind |
| `-y, --yes` | Niemals nachfragen. **Erforderlich überall dort, wo kein Terminal zum Antworten vorhanden ist**, wie z. B. in CI. Überspringt Git-Init und die Installation von Abhängigkeiten — die interaktiven Standardeinstellungen bejahen beides; übergeben Sie also `--git` / `--install`, wenn Sie diese wünschen |
| `-i, --install` | Abhängigkeiten nach dem Scaffolding installieren |
| `-g, --git` | Repository initialisieren und den ersten Commit erstellen |
| `--database-url <url>` | Eine bestehende Datenbank anstelle der verwalteten verwenden |
| `--introspect` | Collections aus dieser Datenbank generieren. Impliziert `--template blank` und erfordert `--install` |
| `--project <slug>` | Das Scaffold mit einem Rebase Cloud-Projekt verknüpfen |
| `--setup-key <key>` | Der Einmalschlüssel zur Authentifizierung dieser Verknüpfung |

### `rebase dev`

Starten Sie den Entwicklungsserver:

```bash
rebase dev
```

Startet sowohl Frontend als auch Backend mit Hot-Reloading.

Beide Ports werden aus dem Projektpfad abgeleitet, sodass mehrere Rebase-Projekte
nebeneinander ausgeführt werden können. Verwenden Sie die URLs, die `rebase dev` ausgibt. Einen Port festlegen mit `rebase dev --port 3001`.

### `rebase build`

Das Projekt in ein deploybares Bundle in `dist-bundle/` bauen:

```bash
rebase build
```

Das Bundle ist das Artefakt, das Sie deployen — das Runtime-Image lädt es, sodass kein eigenes
Anwendungs-Image gebaut werden muss. Nützliche Flags:

| Flag | Auswirkung |
|------|------------|
| `--out <dir>` | Schreibt das Bundle an einen anderen Ort als `dist-bundle/` |
| `--vendor` | Abhängigkeiten des Bundles immer installieren und mitliefern |
| `--no-vendor` | Niemals vendoren; der Pod installiert beim ersten Start |
| `--skip-type-check` | Typprüfung überspringen (schneller, weniger sicher) |
| `--no-static` | Bauen des Frontends überspringen |

Abhängigkeiten werden standardmäßig per Vendoring eingebunden, damit ein Pod-Neustart nicht 35–55 Sekunden
für die Installation beansprucht. Ein Verzeichnisbaum, der auf der Festplatte über 200 MB anwächst, wird stattdessen
verworfen, da das Upload-Limit komprimiert 100 MB beträgt — siehe Changelog für die Begründung.

### `rebase start`

Das erstellte Bundle als Produktionsserver ausführen:

```bash
rebase start
```

Liest `PORT` und den Rest der `.env`, im Gegensatz zu `rebase dev`. Verweisen Sie mit `rebase start --bundle ./dist-bundle` auf ein Bundle an einem anderen Ort.

### `rebase apps list`

Die Apps anzeigen, die dieses Repository deklariert:

```bash
rebase apps list
```

Ein Repository kann mehr als eine deploybare App deklarieren — beispielsweise ein Backend und eine
Marketing-Website. Auf diese Weise sehen Sie, worauf `rebase build` und das Deployment angewendet werden.

### `rebase eject`

Die Kontrolle über den Serverprozess und sein Image übernehmen:

```bash
rebase eject
```

Schreibt den Backend-Einstiegspunkt und ein `Dockerfile` in das Projekt und stellt das
Backend um, sodass das Repository sein eigenes Image baut, anstatt die
bereitgestellte Laufzeitumgebung zu verwenden. Von da an **greifen Plattform-Runtime-Upgrades nicht mehr**,
und CORS, Auth-Verdrahtung, Storage und Herunterfahren obliegen Ihrer Konfiguration.

Vorschau mit `rebase eject --dry-run`, was auflistet, was sich ändern würde, und
nichts ändert. `--force` ersetzt ein vorhandenes `backend/src/index.ts` oder
`env.ts` und behält die aktuelle Datei als `<name>.bak` bei.

### `rebase schema generate`

Drizzle ORM-Schema aus Ihren TypeScript-Collections generieren:

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

Erstellt Migrationsdateien mit Zeitstempel in `drizzle/`, die überprüft und committet werden können.

### `rebase db migrate`

Ausstehende Datenbankmigrationen ausführen:

```bash
rebase db migrate
```

Wendet alle nicht angewendeten Migrationen auf die Datenbank an.

### `rebase db backup` / `backups` / `restore`

```bash
rebase db backup --out ./backups        # oder s3://bucket/prefix, gs://bucket/prefix
rebase db backups                       # gespeicherte Backups auflisten
rebase db restore ./backups/<file>.dump --yes
```

`backup` führt `pg_dump` aus; `restore` führt `pg_restore` aus und ist destruktiv,
erfordert daher `--yes`. `--out` akzeptiert einen lokalen Pfad oder eine Object-Storage-URL
und fällt standardmäßig auf `$BACKUP_DESTINATION` oder `./backups` zurück.

### `rebase db pull`

Eine andere Datenbank in die lokale Entwicklungsdatenbank kopieren:

```bash
rebase db pull --from postgres://…  [--anonymize]
```

`--anonymize` ersetzt personenbezogene Felder beim Import, sodass an einer Produktionskopie
lokal gearbeitet werden kann, ohne echte Kundendaten auf einen Laptop zu übertragen.

`pg_dump` entfernt Berechtigungen, sodass die Kopie mit den RLS-Policies der Quelle
und keinen der dahinter liegenden Grants ankäme — jeder Lesevorgang als `rebase_user` würde
mit `permission denied` fehlschlagen. Der Pull richtet die App-Rolle anschließend neu ein,
unter Verwendung derselben Routine, die der Bootvorgang und `rebase db push` nutzen,
sodass interne Tabellen von Rebase wie vorgesehen gesperrt bleiben.

Das Ziel ist immer die lokale Entwicklungsdatenbank dieses Projekts und kann nicht
ausgewählt werden: `--database-url` wird verweigert statt akzeptiert, sodass es keine
Möglichkeit gibt, "in die Produktion zu pullen". `--from` ist die einzige Richtung.

### `rebase db url`

Gibt den Connection String aus, den dieses Projekt verwendet, und sonst nichts,
sodass er per Pipe weitergeleitet werden kann:

```bash
rebase db url
psql "$(rebase db url)"
```

Die verwaltete Entwicklungsdatenbank ist der Fall, der dies benötigt: `.env` lässt
`DATABASE_URL` absichtlich auskommentiert, und der Port wird aus dem
Projektpfad abgeleitet, sodass nichts auf der Festplatte ihn benennt. Wenn Sie eine eigene
`DATABASE_URL` festgelegt haben, wird genau diese ausgegeben — die Auflösungsreihenfolge ist
dieselbe wie bei jedem anderen Befehl. Startet die verwaltete Datenbank, falls sie noch
nicht läuft.

### `rebase db stop` / `rebase db reset`

Nur für die verwaltete Entwicklungsdatenbank:

```bash
rebase db stop     # stoppen; die Daten bleiben erhalten
rebase db reset    # löschen und von vorne beginnen
```

### `rebase db branch`

```bash
rebase db branch create <name>
rebase db branch list
rebase db branch info <name>
rebase db branch switch <name>     # daran arbeiten; jeder spätere Befehl folgt diesem
rebase db branch switch            # anzeigen, auf welchem Branch Sie sich befinden
rebase db branch switch --off      # zurück zur Hauptdatenbank
rebase db branch delete <name>
rebase db branch prune [--older-than 14d] [--include-dev-diff]
```

PostgreSQL kopiert oder löscht keine Datenbank, mit der noch etwas verbunden ist,
und das übliche "etwas" ist Ihr eigenes `rebase dev`. `create` und `delete` nennen
das, was die Datenbank offen hält; `--force` trennt diese Sitzungen zuerst.

Jeder Branch ist eine vollständige Kopie auf der Festplatte, daher müssen sie bereinigt werden. `prune` entfernt
drei Dinge: einen Eintrag, dessen Datenbank außerhalb von Rebase gelöscht wurde, eine Branch-Datenbank,
deren Eintrag nie geschrieben wurde, und — nur mit `--older-than` — Branches,
die älter als ein von Ihnen angegebenes Alter sind. Vor dem Entfernen wird nachgefragt, es sei denn, Sie übergeben `--yes`.

`switch` speichert den Branch in `.rebase/branch.json` und bearbeitet niemals `.env`. Es
hat Vorrang vor `DATABASE_URL` in `.env` und weicht gegenüber `--database-url` oder einer
`DATABASE_URL` in der Shell, sodass ein Flag auf der Befehlszeile einen zuvor durchgeführten
Switch immer übersteuert. Das Löschen des Branches, auf dem Sie sich gerade befinden, bringt Sie zur Hauptdatenbank
zurück, anstatt den Checkout auf eine Datenbank verweisen zu lassen, die nicht mehr existiert.

:::note[Nicht auf der verwalteten Entwicklungsdatenbank]
`push`, `generate` und `migrate` planen ihre Arbeit mit Atlas, welches eine zweite
leere Datenbank zum Abgleich benötigt — und das verwaltete PGlite stellt genau eine bereit.
Das Ausführen dieser Befehle dort stoppt mit einer entsprechenden Meldung. Verweisen Sie
`DATABASE_URL` für den Migrations-Workflow auf ein echtes PostgreSQL; `rebase dev` erstellt
fehlende Tabellen auf der verwalteten Instanz ohnehin additiv.

`branch` wird dort aus einem verwandten Grund verweigert. `CREATE DATABASE ... TEMPLATE`
auf PGlite schreibt einen Katalogeintrag und kopiert nichts, sodass der Branch auf die
Datenbank verweisen würde, von der er geklont wurde — jeder Schreibvorgang, den Sie in einer Sandbox isolieren
wollten, würde in Ihrer Entwicklungsdatenbank landen. `rebase dev --docker` liefert Ihnen einen echten
Server, mit dem Branches funktionieren.
:::

### `rebase apps init` / `rebase apps config`

```bash
rebase apps list             # die Apps, die dieses Projekt deklariert
rebase apps init <name>      # eine neue App in rebase.json registrieren
rebase apps config <app>     # worauf eine App aufgelöst wird
```

### `rebase status`

Alles, was dieses Projekt deklariert, und ob die Umgebung es tatsächlich bindet:

```bash
rebase status               # jede Ressource und die Variablen, die sie liest
rebase status --json        # maschinenlesbar
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
`config/resources.ts` gibt an, was das Projekt benötigt, und die Umgebung gibt an, wie
jedes Element erreicht werden kann. Alles andere — `rebase.resources.json`, das Bundle-Manifest —
wird aus der mittleren Datei für Ausleser generiert, die Ihren Code nicht ausführen können,
und wird niemals manuell geschrieben.

Ein `○` ist der Status, über den man lieber vor einem Deployment als danach Bescheid weiß:
deklariert, nicht konfiguriert. Ein `✗` bedeutet, dass die Umgebung etwas *falsch* setzt,
was den Start verweigert, anstatt in einen reduzierten Modus überzugehen.

### `rebase resources`

Was dieses Projekt an Ressourcen deklariert — die Datenbanken, Buckets, Topics und
Queues, die sein Konfigurationscode anfordert, sowie die Crons und Funktionen, die seine Dateien definieren:

```bash
rebase resources            # auflisten
rebase resources --write    # rebase.resources.json neu generieren
rebase resources --check    # fehlschlagen, wenn der committete Graph veraltet ist
rebase resources --json     # maschinenlesbar
```

`rebase resources --check` ist neu — das Flag, das ein CI-Job verwendet, um
bei einer `rebase.resources.json` fehlzuschlagen, die nicht mehr mit dem Konfigurationscode übereinstimmt.

Eine Ressource wird im Konfigurationscode deklariert — `database("analytics")`,
`bucket("media")`, `topic("signups")`, `queue("thumbnails")` — oder ist eine Datei
unter `backend/crons` oder `backend/functions`, und wird niemals manuell in
`rebase.resources.json` geschrieben. Diese Datei wird aus jenen Deklarationen generiert, damit ein Host
lesen kann, was ein Projekt benötigt, ohne es bauen zu müssen. Jeder Eintrag dokumentiert, wer ihn nutzt
(`collection:events`, `property:posts.cover`, `function:report`).

Ein Backend verfügt außerdem über eine Standarddatenbank und eine Standard-Storage-Quelle, die niemand
deklariert. Beide werden hier aufgeführt, als `implicit` gekennzeichnet, und keine von beiden wird in
`rebase.resources.json` geschrieben — der Host stellt sie bereit; ein Eintrag würde also
die Bereitstellung von etwas anfordern, das niemand angefordert hat.

Um zu sehen, was die Plattform für ein Projekt im Vergleich zu den Deklarationen im Code vorhält,
und um eine bereitgestellte Datenbank zu entfernen, die der Code nicht mehr aufführt, siehe
`rebase cloud resources` weiter unten.

### `rebase cloud`

Alles rund um Rebase Cloud, das sich in der privaten Beta befindet. Siehe den
[Rebase Cloud Leitfaden](/docs/deployment/cloud/) für Details dazu und was die Beta
nicht enthält.

Jede Gruppe unterstützt `--help`, und `--help` führt den Befehl niemals aus. Die meisten Befehle
wirken auf das verknüpfte Projekt in `.rebase/cloud.json`; `--project <id>` operiert auf
einem Projekt, ohne es zu verknüpfen.

Drei Optionen gelten überall: `--json` für maschinenlesbare Ausgabe (auch die
Standardeinstellung bei Weiterleitung per Pipe oder mit `REBASE_JSON=1`), `--url <origin>` zur Adressierung
einer bestimmten Control Plane (oder `REBASE_CLOUD_URL`), und `--project, -p <id>`.

#### Auth

```bash
rebase cloud login      # an der Control Plane anmelden
rebase cloud logout     # abmelden
rebase cloud whoami     # die aktuelle Sitzung anzeigen
```

#### Projektverknüpfung

```bash
rebase cloud link         # dieses Verzeichnis mit einem Cloud-Projekt verknüpfen
rebase cloud link [url]   # oder direkt auf ein Backend: keine Control Plane, kein Login, und der Rest der Familie verweigert den Dienst, bis Sie unlink ausführen
rebase cloud unlink       # die Verknüpfung aufheben
rebase cloud use [org]    # die aktive Organisation auswählen
rebase cloud open         # das Dashboard im Browser öffnen
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
rebase cloud deploy [app] [--source .]   # eine App deployen und Build-Logs streamen
rebase cloud logs [--runtime] [-f]       # Build-Logs oder die des laufenden Prozesses
rebase cloud deployments list [--limit N|--all]
rebase cloud rollback [id] [-y]          # zurück zu einem erfolgreichen Deploy
rebase cloud cancel [-y]                 # den laufenden Build abbrechen
rebase cloud start | stop | restart [-y] # stop und restart erfordern -y
rebase cloud status                      # Projektstatus auf einen Blick
rebase cloud metrics                     # Live-Metriken für CPU / Arbeitsspeicher / Festplatte
rebase cloud debug [health|logs|…]       # ein Deployment diagnostizieren, schreibgeschützt
```

`deploy` ohne App-Namen deployt das Backend.

#### Konfiguration

```bash
rebase cloud env list | set | unset | reveal | pull
rebase cloud domains list | add | verify | remove
rebase cloud extensions list | enable | disable
rebase cloud settings show | set        # Name, Branch, Repo, Subdomain
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

`db connect` öffnet einen lokalen Port, der die verwaltete Datenbank *ist* (kein öffentlicher
Endpunkt), bis Strg-C gedrückt wird; `--reveal` fügt das Passwort hinzu. Nur für Owner oder Admin.

#### Ressourcen

Was die Plattform für das Projekt vorhält, verglichen mit dem, was der Code deklariert.

```bash
rebase cloud resources                       # jede Datenbank und jedes Bucket: Deklariert? Bereitgestellt?
rebase cloud resources prune database <key>  # eine Datenbank entfernen, die der Code nicht mehr deklariert
```

Ein Deployment entfernt niemals eine bereitgestellte Datenbank, wenn deren Deklaration entfällt — das
wäre ein Datenverlust durch einen Push. Sie wird beibehalten, gebunden und abgerechnet, bis jemand
sie namentlich per Prune bereinigt.

#### Compute

Was das Projekt reserviert und was dies kostet.

```bash
rebase cloud compute            # die aktuelle Reservierung und ihre monatlichen Kosten
rebase cloud compute set        # Reservierung ändern
```

`compute set` akzeptiert `--cpu`, `--memory`, `--replicas`, `--spot`,
`--scale-to-zero`, `--db-instances`, `--db-cpu`, `--db-memory`,
`--storage`, `--autoscale-max`, `--autoscale-cpu-target` und `--no-autoscale`.
Es gibt keine Tarifstufen: Alles wird pro Ressource abgerechnet. Siehe
[Rebase Cloud](/docs/deployment/cloud/).

#### Storage, Webhooks, Cluster und Abrechnung

```bash
rebase cloud storage             # Storage-Buckets auflisten
rebase cloud storage create      # plattformverwalteten Speicher bereitstellen
rebase cloud storage attach      # ein eigenes S3-kompatibles Bucket anbinden
rebase cloud webhooks list | create | delete
rebase cloud clusters list | add | verify   # Cluster, auf denen Mandanten laufen; `add` registriert einen aus einer kubeconfig
rebase cloud billing             # das Abrechnungskonto und die hinterlegte Karte
rebase cloud billing setup       # einmalig eine Karte hinterlegen, öffnet einen Browser
rebase cloud billing checkout    # eine Stripe-Sitzung für ein Projekt
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

Der Befehl, der ausgeführt werden sollte, wenn etwas nicht stimmt und Sie noch nicht wissen, was. Er
erstellt einen Bericht und ändert niemals etwas, sodass er für jede erreichbare Datenbank
sicher ausgeführt werden kann.

**Ohne Datenbank.** Diese Prüfungen laufen zuerst, da alles, was ein Projekt
am Funktionieren hindert, passiert, bevor eine Tabelle verglichen werden kann:

| Prüfung | Grund |
| --- | --- |
| Node-Version | Abgleich mit dem Bereich, den das CLI deklariert. Eine zu alte Version wird nicht als „nicht unterstütztes Node“ gemeldet — sie äußert sich als Syntaxfehler innerhalb einer Abhängigkeit. |
| Paketmanager | Zwei Lockfiles in einem Projekt. `npm install` in einem pnpm-Workspace schreibt `node_modules` in ein Layout um, das nicht zu pnpm passt; das Symptom ist `Cannot find module` Stunden später. |
| Doppelte Slugs | Die Registry behält die zuletzt registrierte Collection bei, sodass die andere nicht als fehlend gemeldet wird — sie wird als Gewinner unter ihrem eigenen Namen ausgeliefert. |
| `.env`-Plausibilität | Ein `JWT_SECRET` mit weniger als 32 Zeichen (mit dem die Produktion den Start verweigert) und `NODE_ENV=production` ohne `CORS_ORIGINS` oder `FRONTEND_URL`. Werte werden niemals ausgegeben. |
| `@rebasepro/*` Versionsabweichung | Dasselbe Paket ist in verschiedenen `package.json`-Dateien des Projekts auf unterschiedliche Versionen gepinnt. Zwei Kopien stören `instanceof` untereinander, was als Type Guard fehlschlägt, der seinen eigenen Typ abweist. |
| Connection Strings | Ein nicht-enkodiertes `=` in einem URL-Parameter, dessen Parsing die PostgreSQL-eigenen Tools verweigern — Backups und `psql` schlagen fehl, während die App weiterläuft. |
| Eigene Funktionen | Was jede Funktion von ihrem Host benötigt und welche davon nicht auf einer Edge-Runtime laufen würden. |

**Gegen die Datenbank**, wenn `DATABASE_URL` gesetzt ist:

| Prüfung | Grund |
| --- | --- |
| Collections → generiertes Schema | Ob `schema.generated.ts` veraltet ist. |
| Collections → Datenbank | Fehlende Tabellen, Spalten, Enums, Fremdschlüssel und Zwischentabellen (Junctions). |
| Erforderliche Extensions | Eine Eigenschaft `{ type: "vector" }` erfordert pgvector, welches Rebase nur dort installiert, wo ein Projekt es deklariert hat. |
| Schemastempel | Ob diese Datenbank aus diesen Collections bereitgestellt wurde. Ein Hash, der besagt, dass beide nicht übereinstimmen, aber nie, welche Version weiter vorn liegt. |
| Collections → SDK-Typen | Ob das generierte typisierte SDK veraltet ist. |
| RLS-Policies | Ob die Policies der Datenbank mit den von Ihnen deklarierten `securityRules` übereinstimmen und ob eine Policy eine Rolle benennt, die dieser Server nicht verwenden kann. |

Ist die Datenbank nicht erreichbar, werden deren Phasen mit Angabe des Grundes als übersprungen
gemeldet und der Rest läuft weiter — siehe [Fehlerbehebung](/docs/troubleshooting/).

Gibt einen Exit-Code ungleich null zurück, wenn eine Prüfung einen Fehler findet oder wenn eine Phase nicht
ausgeführt werden konnte, weil die angegebene Datenbank Verbindungen ablehnt. Eine Phase, die übersprungen wurde,
weil Sie keine `DATABASE_URL` festgelegt haben, gilt nicht als Fehler.

`rebase doctor --policies` führt nur die RLS-Prüfungen durch — kein Schema-Diff, keine SDK-Typen —
und schlägt im Zweifelsfall fehl (fail-closed), was es zur idealen Variante für ein CI-Gate gegen eine
bereitgestellte Datenbank macht.

### `rebase auth`

Befehle zur Authentifizierungsverwaltung:

```bash
rebase auth reset-password --email admin@example.com --password NewPassword123!
```

### `rebase api-keys`

Geltungsbereichsbezogene (scoped) Service-API-Schlüssel verwalten — die Anmeldedaten, die ein Agent, Skript oder ein anderer
Dienst verwendet, im Gegensatz zur Sitzung eines Endbenutzers:

```bash
rebase api-keys list
rebase api-keys create --name "Analytics" --permissions '[{"collection":"events","operations":["read"]}]'
rebase api-keys create --name "Full Access" --full-access --expires 90d
rebase api-keys revoke abc123-def456
```

`--permissions` nimmt ein JSON-Array von `{ collection, operations }`-Objekten entgegen, oder verwenden Sie
`--full-access` für Lese-/Schreib-/Löschrechte auf alle Collections und Funktionen. `--expires`
akzeptiert `7d`, `30d`, `90d`, `1y` oder ein ISO-Datum, und `--rate-limit` legt die Anfragen
pro 15-Minuten-Fenster fest. Ein Schlüssel wird nur einmal angezeigt: bei der Erstellung.

Schlüssel sind doppelt abgesichert: Sowohl die eigenen Berechtigungen des Schlüssels als auch die Row-Level-Security
der Identität, als die er agiert, greifen, sodass ein Schlüssel niemals mehr lesen kann als diese Identität.

### `rebase skills install`

Installieren Sie die Rebase-Referenz-Skills für Ihren KI-Coding-Assistenten. Unterstützt
Cursor, Claude Code, Windsurf, Gemini CLI und Antigravity:

```bash
rebase skills install
rebase skills install --agent claude,cursor
rebase skills install --agent all
```

Siehe [Agent Skills](/docs/ai/skills) für die vollständige Liste und Speicherorte der Dateien.

### `rebase telemetry`

Anonyme Erfassung von Nutzungsdaten. **`rebase init` fragt einmal pro Projekt nach, und die Abfrage
ist standardmäßig auf „Ja“ gesetzt — es wird nichts gesendet, es sei denn, Sie beantworten sie:**

```bash
rebase telemetry status
rebase telemetry show
rebase telemetry enable
rebase telemetry disable
```

`status` gibt die aktuelle Einstellung aus, `show` gibt genau das aus, was gesendet werden würde —
unabhängig davon, ob das Teilen aktiviert ist, sodass Sie die Nutzdaten vor der Entscheidung prüfen können — und
die anderen beiden Befehle ändern die Einstellung. Wenn Sie `init` nie ausgeführt haben, wurde auch nie etwas erfasst.

## Migrations-Workflow

Der typische Ablauf bei Schemaänderungen:

```bash
# 1. Bearbeiten Sie Ihre Collection in config/collections/
# 2. Generieren Sie das Drizzle-Schema
rebase schema generate

# 3. Generieren Sie die SQL-Migration
rebase db generate

# 4. Überprüfen Sie das generierte SQL in drizzle/

# 5. Wenden Sie die Migration an
rebase db migrate
```

## Nächste Schritte

- **[Schema as Code](/docs/architecture/schema-as-code)** — Wie die Schemagenerierung funktioniert
- **[Schnellstart](/docs/getting-started/quickstart)** — Erste Schritte

---
