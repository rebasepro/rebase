---
sourceHash: ace00ff64a9b8e17
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

`--json` ist der Schalter, und außerhalb der `cloud`-Familie ist es der einzige: `rebase status`, `rebase resources` und `rebase apps list` geben dann genau einen JSON-Wert auf stdout aus — das Ergebnis oder eine `{"error": {"message", "code", "hint", "issues"}}`-Hülle mit einem Exit-Code ungleich null — bei **jedem** Beenden des Befehls, sodass ein Aufrufer stdout bedingungslos parsen kann. Ohne diesen Schalter schreiben sie lesbaren Text und Fehler gehen an stderr. `rebase cloud` verwendet dieselbe Hülle und ist die einzige Ausnahme von diesem Schalter: Es aktiviert JSON auch automatisch, wenn stdout kein TTY ist oder wenn `REBASE_JSON=1` gesetzt ist. Daher ist `rebase cloud status | cat` JSON, während `rebase status | cat` dies nicht ist — übergeben Sie in einem Skript explizit `--json`, anstatt sich auf eine der beiden Regeln zu verlassen.

## Befehle

### `rebase init`

Initialisiert ein neues Rebase-Projekt:

```bash
rebase init [directory]
```

Richtet die Projektstruktur mit Frontend, Backend und gemeinsam genutzten Paketen ein.

| Flag | Funktion |
|---|---|
| `-t, --template <preset>` | `blog`, `ecommerce` oder `blank`. Standard: `blog` |
| `--headless` | Nur Backend — kein Admin-Panel und keine Collection-Dateien. `--template` hat keine Auswirkung, da keine Collections für das Seeding vorhanden sind |
| `-y, --yes` | Niemals nachfragen. **Erforderlich überall dort, wo kein Terminal zum Antworten vorhanden ist**, wie z. B. in CI. Überspringt Git-Init und die Installation von Abhängigkeiten — die interaktiven Standardwerte bejahen beides, übergeben Sie also `--git` / `--install`, wenn Sie dies wünschen |
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

Startet sowohl Frontend als auch Backend mit Hot-Reloading.

Beide Ports werden aus dem Pfad des Projekts abgeleitet, sodass mehrere Rebase-Projekte
nebeneinander laufen können. Verwenden Sie die URLs, die `rebase dev` ausgibt. Pinnen Sie einen mit `rebase dev --port 3001`.

### `rebase build`

Baut das Projekt in ein deploybares Bundle in `dist-bundle/`:

```bash
rebase build
```

Das Bundle ist das Artefakt, das Sie deployen — das Runtime-Image lädt es, daher muss
kein eigenes Anwendungs-Image gebaut werden. Nützliche Flags:

| Flag | Wirkung |
|------|--------|
| `--out <dir>` | Schreibt das Bundle an einen anderen Ort als `dist-bundle/` |
| `--vendor` | Abhängigkeiten des Bundles immer installieren und mitliefern |
| `--no-vendor` | Niemals vendoren; der Pod installiert beim ersten Start |
| `--skip-type-check` | Typprüfung überspringen (schneller, weniger sicher) |
| `--no-static` | Bauen des Frontends überspringen |

Abhängigkeiten werden standardmäßig gevendort, damit ein Pod-Neustart keine
35–55-sekündige Installation erfordert. Ein Verzeichnisbaum, der auf der Festplatte über 200 MB anwächst,
wird stattdessen verworfen, da das Upload-Limit komprimiert 100 MB beträgt — siehe Changelog für die Begründung.

### `rebase start`

Führt das erstellte Bundle als Produktionsserver aus:

```bash
rebase start
```

Liest `PORT` und den Rest der `.env`, im Gegensatz zu `rebase dev`. Verweisen Sie mit `rebase start --bundle ./dist-bundle` auf ein Bundle an einem anderen Ort.

### `rebase apps list`

Zeigt die Apps an, die dieses Repository deklariert:

```bash
rebase apps list
```

Ein Repository kann mehr als eine deploybare App deklarieren — beispielsweise ein Backend und eine
Marketing-Website. Auf diese Weise sehen Sie, worauf sich `rebase build` und das Deployment auswirken.

### `rebase eject`

Übernimmt die Kontrolle über den Serverprozess und dessen Image:

```bash
rebase eject
```

Schreibt den Backend-Einstiegspunkt und ein `Dockerfile` in das Projekt und stellt dessen
Backend um, sodass das Repository sein eigenes Image baut, anstatt die
veröffentlichte Runtime auszuführen. Von da an **erreichen Plattform-Runtime-Upgrades es nicht mehr**,
und CORS, Authentifizierungsverdrahtung, Speicher und Shutdown müssen von Ihnen konfiguriert werden.

Vorschau mit `rebase eject --dry-run`, was auflistet, was sich ändern würde, aber nichts ändert. `--force` ersetzt eine vorhandene `backend/src/index.ts` oder
`env.ts` und behält die aktuelle Datei als `<name>.bak`.

### `rebase schema generate`

Generiert ein Drizzle-ORM-Schema aus Ihren TypeScript-Collections:

```bash
rebase schema generate
```

Dies liest Ihre Collections aus `config/collections/` und generiert `backend/src/schema.generated.ts` mit Drizzle-Tabellendefinitionen, Enums und Relationen.

### `rebase db push`

Überträgt Schemaänderungen direkt in die Datenbank (nur Entwicklung):

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

Erstellt mit einem Zeitstempel versehene Migrationsdateien in `drizzle/`, die überprüft und committet werden können.

### `rebase db migrate`

Führt ausstehende Datenbankmigrationen aus:

```bash
rebase db migrate
```

Wendet alle nicht angewendeten Migrationen auf die Datenbank an.

### `rebase db backup` / `backups` / `restore`

```bash
rebase db backup --out ./backups        # oder s3://bucket/prefix, gs://bucket/prefix
rebase db backups                       # auflisten, was gespeichert ist
rebase db restore ./backups/<file>.dump --yes
```

`backup` führt `pg_dump` aus; `restore` führt `pg_restore` aus und ist destruktiv,
erfordert daher `--yes`. `--out` akzeptiert einen lokalen Pfad oder eine Object-Storage-URL
und verwendet standardmäßig `$BACKUP_DESTINATION` oder `./backups`.

### `rebase db pull`

Kopiert eine andere Datenbank in die lokale Entwicklungsdatenbank:

```bash
rebase db pull --from postgres://…  [--anonymize]
```

`--anonymize` ersetzt personenbezogene Felder beim Import, sodass eine Produktionskopie
lokal bearbeitet werden kann, ohne echte Kundendaten auf ein Laptop zu übertragen.

`pg_dump` entfernt Berechtigungen, sodass die Kopie mit den RLS-Richtlinien der Quelle
und keinen der dahinter liegenden Grants ankommen würde — jeder Lesevorgang als `rebase_user` würde
mit `permission denied` fehlschlagen. Der Pull richtet die App-Rolle anschließend neu ein, unter
Verwendung derselben Routine, die der Bootvorgang und `rebase db push` verwenden, sodass interne Rebase-Tabellen
wie vorgesehen entzogen bleiben.

Das Ziel ist immer die lokale Entwicklungsdatenbank dieses Projekts und kann nicht
gewählt werden: `--database-url` wird abgelehnt statt akzeptiert, sodass es keine Möglichkeit gibt,
"in Produktion ziehen" zu formulieren. `--from` ist die einzige Richtung.

### `rebase db url`

Gibt den Verbindungsstring aus, den dieses Projekt verwendet, und sonst nichts,
damit er weitergeleitet werden kann:

```bash
rebase db url
psql "$(rebase db url)"
```

Die verwaltete Entwicklungsdatenbank ist der Fall, der dies benötigt: `.env` lässt
`DATABASE_URL` absichtlich auskommentiert, und der Port wird aus dem Projektpfad
abgeleitet, sodass nichts auf der Festplatte ihn benennt. Wenn Sie eine eigene `DATABASE_URL`
festgelegt haben, wird diese ausgegeben — die Auflösungsreihenfolge ist dieselbe,
der jeder andere Befehl folgt. Sie startet die verwaltete Datenbank, falls sie
nicht bereits läuft.

### `rebase db stop` / `rebase db reset`

Nur für die verwaltete Entwicklungsdatenbank:

```bash
rebase db stop     # stoppen; die Daten bleiben erhalten
rebase db reset    # löschen und neu beginnen
```

### `rebase db branch`

```bash
rebase db branch create <name>
rebase db branch list
rebase db branch info <name>
rebase db branch switch <name>     # daran arbeiten; alle späteren Befehle folgen
rebase db branch switch            # anzeigen, auf welchem Branch Sie sich befinden
rebase db branch switch --off      # zurück zur Hauptdatenbank
rebase db branch delete <name>
rebase db branch prune [--older-than 14d] [--include-dev-diff]
```

PostgreSQL kopiert oder löscht keine Datenbank, mit der noch etwas verbunden ist, und
dieses "etwas" ist gewöhnlich Ihr eigenes `rebase dev`. `create` und `delete` nennen das,
was die Datenbank offen hält; `--force` trennt diese Sitzungen zuerst.

Jeder Branch ist eine vollständige Kopie auf der Festplatte, daher müssen sie bereinigt werden. `prune` entfernt
drei Dinge: einen Eintrag, dessen Datenbank außerhalb von Rebase gelöscht wurde, eine Branch-Datenbank,
deren Eintrag nie geschrieben wurde, und — nur mit `--older-than` — Branches,
die älter als ein von Ihnen angegebenes Alter sind. Vor dem Entfernen wird nachgefragt, es sei denn, Sie übergeben `--yes`.

`switch` trägt den Branch in `.rebase/branch.json` ein und bearbeitet niemals `.env`. Es
hat Vorrang vor `DATABASE_URL` in `.env` und unterliegt `--database-url` oder einer
`DATABASE_URL` in der Shell, sodass ein Flag auf der Befehlszeile immer Vorrang vor einem
zuvor durchgeführten Wechsel hat. Das Löschen des Branches, auf dem Sie sich befinden, bringt Sie zur Hauptdatenbank
zurück, anstatt den Checkout auf eine Datenbank verweisen zu lassen, die nicht mehr existiert.

:::note[Nicht auf der verwalteten Entwicklungsdatenbank]
`push`, `generate` und `migrate` planen ihre Arbeit mit Atlas, das eine zweite
leere Datenbank zum Abgleich benötigt — und das verwaltete PGlite stellt genau eine bereit.
Die Ausführung dort bricht mit einer entsprechenden Meldung ab. Verweisen Sie `DATABASE_URL` auf ein echtes
PostgreSQL für den Migrations-Workflow; `rebase dev` erstellt fehlende Tabellen
bereits additiv auf der verwalteten Datenbank.

`branch` wird dort aus einem ähnlichen Grund abgelehnt. `CREATE DATABASE ... TEMPLATE`
gegen PGlite schreibt einen Katalogeintrag und kopiert nichts, sodass der Branch
zu der Datenbank aufgelöst werden würde, von der er geklont wurde — jeder Schreibvorgang, den Sie isolieren wollten,
würde in Ihrer Entwicklungsdatenbank landen. `rebase dev --docker` bietet Ihnen einen echten
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

Drei Dateien entscheiden darüber, was ein Backend erreichen kann, und dieser Befehl gibt alle drei zusammen aus:
`rebase.json` gibt an, wo sich Ihr Code befindet und wer den Server ausführt,
`config/resources.ts` gibt an, was das Projekt benötigt, und die Umgebung gibt an, wie
jedes Element erreicht wird. Alles andere — `rebase.resources.json`, das Bundle-Manifest —
wird aus der mittleren Datei für Reader generiert, die Ihren Code nicht ausführen können,
und wird von Ihnen niemals manuell geschrieben.

Ein `○` ist der Status, den man vor einem Deployment kennen sollte und nicht erst danach:
deklariert, nicht konfiguriert. Ein `✗` bedeutet, dass die Umgebung etwas *falsch* setzt,
was den Bootvorgang verweigert, anstatt in einen eingeschränkten Zustand überzugehen.

### `rebase resources`

Was dieses Projekt deklariert zu benötigen — die Datenbanken, Buckets, Topics und
Queues, die sein Konfigurationscode anfordert, sowie die Crons und Funktionen, die seine Dateien definieren:

```bash
rebase resources            # auflisten
rebase resources --write    # rebase.resources.json neu generieren
rebase resources --check    # fehlschlagen, wenn der committete Graph veraltet ist
rebase resources --json     # maschinenlesbar
```

`rebase resources --check` ist neu — das Flag, das ein CI-Job verwendet, um bei einer
`rebase.resources.json` fehlzuschlagen, die nicht mehr mit dem Konfigurationscode übereinstimmt.

Eine Ressource wird im Konfigurationscode deklariert — `database("analytics")`,
`bucket("media")`, `topic("signups")`, `queue("thumbnails")` — oder ist eine Datei
unter `backend/crons` oder `backend/functions`, und wird niemals von Hand in
`rebase.resources.json` geschrieben, welches aus diesen Deklarationen generiert wird, damit ein Host
lesen kann, was ein Projekt benötigt, ohne es zu bauen. Jeder Eintrag zeichnet auf, wer ihn verwendet
(`collection:events`, `property:posts.cover`, `function:report`).

Ein Backend verfügt außerdem über eine Standarddatenbank und eine Standard-Storage-Quelle, die niemand
deklariert. Beide werden hier aufgelistet, als `implicit` markiert, und keine von beiden wird in
`rebase.resources.json` geschrieben — der Host stellt sie bereit, sodass ihre Erfassung
die Bereitstellung von etwas anfordern würde, das niemand angefordert hat.

Um zu sehen, was die Plattform für ein Projekt im Vergleich zu dem vorhält, was ihr Code deklariert,
und um eine bereitgestellte Datenbank zu entfernen, die der Code nicht mehr nennt, siehe
`rebase cloud resources` unten.

### `rebase cloud`

Alles rund um Rebase Cloud, das sich in der privaten Beta befindet. Siehe den
[Rebase Cloud Leitfaden](/docs/deployment/cloud/) für Details darüber, was es ist und was die Beta
nicht enthält.

Jede Gruppe unterstützt `--help`, und `--help` führt den Befehl niemals aus. Die meisten Befehle
beziehen sich auf das verknüpfte Projekt in `.rebase/cloud.json`; `--project <id>` operiert auf
einem Projekt ohne Verknüpfung.

Drei Optionen gelten überall: `--json` für maschinenlesbare Ausgabe (auch die
Standardeinstellung bei Weiterleitung per Pipe oder mit `REBASE_JSON=1`), `--url <origin>`, um eine
bestimmte Control Plane anzusteuern (oder `REBASE_CLOUD_URL`), und `--project, -p <id>`.

#### Authentifizierung

```bash
rebase cloud login      # bei der Control Plane anmelden
rebase cloud logout     # abmelden
rebase cloud whoami     # aktuelle Sitzung anzeigen
```

#### Projektverknüpfung

```bash
rebase cloud link         # dieses Verzeichnis mit einem Cloud-Projekt verknüpfen
rebase cloud link [url]   # oder direkt auf ein Backend: keine Control Plane, kein Login, und der Rest der Familie verweigert den Dienst, bis Sie die Verknüpfung aufheben
rebase cloud unlink       # Verknüpfung aufheben
rebase cloud use [org]    # aktive Organisation auswählen
rebase cloud open         # Dashboard im Browser öffnen
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
rebase cloud cancel [-y]                 # laufenden Build abbrechen
rebase cloud start | stop | restart [-y] # stop und restart erfordern -y
rebase cloud status                      # Projektstatus auf einen Blick
rebase cloud metrics                     # Live-Werte für CPU / Speicher / Festplatte
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
Endpunkt) bis Strg-C; `--reveal` fügt das Passwort hinzu. Nur für Owner oder Admin.

#### Ressourcen

Was die Plattform für das Projekt vorhält, verglichen mit dem, was ihr Code deklariert.

```bash
rebase cloud resources                       # jede Datenbank und jeder Bucket: deklariert? bereitgestellt?
rebase cloud resources prune database <key>  # eine entfernen, die der Code nicht mehr deklariert
```

Ein Deploy entfernt niemals eine bereitgestellte Datenbank, wenn ihre Deklaration wegfällt — das
wären Daten, die durch einen Push gelöscht würden. Sie wird beibehalten, gebunden und abgerechnet, bis jemand
sie namentlich bereinigt (`prune`).

#### Compute

Was das Projekt reserviert und was das kostet.

```bash
rebase cloud compute            # die aktuelle Reservierung und ihre monatlichen Kosten
rebase cloud compute set        # diese ändern
```

`compute set` akzeptiert `--cpu`, `--memory`, `--replicas`, `--spot`,
`--scale-to-zero`, `--db-mode`, `--db-instances`, `--db-cpu`, `--db-memory`,
`--storage`, `--autoscale-max`, `--autoscale-cpu-target` und `--no-autoscale`.
Es gibt keine Tarifstufen: Alles wird pro Ressource abgerechnet. Siehe
[Rebase Cloud](/docs/deployment/cloud/).

#### Storage, Webhooks, Cluster und Abrechnung

```bash
rebase cloud storage             # Storage-Buckets auflisten
rebase cloud storage create      # plattformverwalteten Speicher bereitstellen
rebase cloud storage attach      # eigenen S3-kompatiblen Bucket anbinden
rebase cloud webhooks list | create | delete
rebase cloud clusters list | add | verify   # Cluster, auf denen Mandanten laufen; `add` registriert einen aus einer kubeconfig
rebase cloud billing             # das Abrechnungskonto und die hinterlegte Karte
rebase cloud billing setup       # einmalig eine Karte hinterlegen, öffnet einen Browser
rebase cloud billing checkout    # eine Stripe-Sitzung für ein Projekt
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

Der Befehl, der ausgeführt werden sollte, wenn etwas nicht stimmt und Sie noch nicht wissen, was es ist. Er
berichtet und ändert niemals etwas, sodass er für jede Datenbank sicher ist, die Sie
erreichen können.

**Ohne eine Datenbank.** Diese Prüfungen laufen zuerst, da alles, was ein Projekt daran hindert,
überhaupt zu funktionieren, geschieht, bevor eine Tabelle verglichen werden kann:

| Prüfung | Warum |
| --- | --- |
| Node-Version | Gegen den Bereich, den die CLI deklariert. Ein zu altes Node wird nicht als "nicht unterstütztes Node" gemeldet — es äußert sich als Syntaxfehler innerhalb einer Abhängigkeit. |
| Paketmanager | Zwei Lockfiles in einem Projekt. `npm install` in einem pnpm-Workspace schreibt `node_modules` in ein Layout um, mit dem pnpm nicht übereinstimmt; das Symptom ist `Cannot find module` Stunden später. |
| Doppelte Slugs | Die Registry behält die zuletzt registrierte Collection bei, sodass die andere nicht als fehlend gemeldet wird — sie wird als Gewinner unter ihrem eigenen Namen bereitgestellt. |
| `.env`-Plausibilität | Ein `JWT_SECRET`, das kürzer als 32 Zeichen ist (woraufhin die Produktion den Start verweigert), und `NODE_ENV=production` mit weder `CORS_ORIGINS` noch `FRONTEND_URL`. Werte werden niemals ausgegeben. |
| `@rebasepro/*`-Versionsabweichung | Dasselbe Paket ist in verschiedenen Versionen über die `package.json`-Dateien des Projekts hinweg fixiert. Zwei Kopien unterbrechen `instanceof` zwischen ihnen, was als Type Guard fehlschlägt, der seinen eigenen Typ ablehnt. |
| Verbindungsstrings | Ein nicht encodiertes `=` in einem URL-Parameter, dessen Parsing die PostgreSQL-eigenen Tools verweigern — Backups und `psql` brechen ab, während die App weiter funktioniert. |
| Benutzerdefinierte Funktionen | Was jede Funktion von ihrem Host benötigt und welche davon nicht auf einer Edge-Runtime laufen würden. |

**Gegen die Datenbank**, wenn `DATABASE_URL` gesetzt ist:

| Prüfung | Warum |
| --- | --- |
| Collections → generiertes Schema | Ob `schema.generated.ts` veraltet ist. |
| Collections → Datenbank | Fehlende Tabellen, Spalten, Enums, Fremdschlüssel und Zwischentabellen (Junctions). |
| Erforderliche Erweiterungen | Eine Eigenschaft `{ type: "vector" }` erfordert pgvector, welches Rebase nur dort installiert, wo ein Projekt es deklariert hat. |
| Schema-Stempel | Ob diese Datenbank aus diesen Collections bereitgestellt wurde. Ein Hash, sodass gemeldet werden kann, dass beide voneinander abweichen, aber niemals, welches voraus ist. |
| Collections → SDK-Typen | Ob das generierte typisierte SDK veraltet ist. |
| RLS-Richtlinien | Ob die Richtlinien der Datenbank mit den von Ihnen deklarierten `securityRules` übereinstimmen und ob eine Richtlinie eine Rolle nennt, die dieser Server nicht verwenden kann. |

Wenn die Datenbank nicht erreichbar ist, werden ihre Phasen als übersprungen mit Angabe des
Grundes gemeldet und der Rest läuft trotzdem — siehe [Fehlerbehebung](/docs/troubleshooting/).

Beendet mit einem Exit-Code ungleich null, wenn eine Prüfung einen Fehler findet oder wenn eine Phase nicht ausgeführt
werden konnte, weil die angegebene Datenbank Verbindungen ablehnt. Eine Phase, die übersprungen wurde,
weil Sie keine `DATABASE_URL` festgelegt haben, ist kein Fehler.

`rebase doctor --policies` führt nur die RLS-Prüfungen aus — kein Schema-Diff, keine
SDK-Typen — und schlägt restriktiv fehl ("fails closed"), was es zur idealen Variante für ein CI-Gate gegen eine
deployte Datenbank macht.

### `rebase auth`

Befehle zur Authentifizierungsverwaltung:

```bash
rebase auth reset-password --email admin@example.com --password NewPassword123!
```

### `rebase api-keys`

Verwaltet berechtigungseingeschränkte Service-API-Schlüssel — die Anmeldedaten, die ein Agent, Skript oder ein anderer
Dienst verwendet, im Gegensatz zur Sitzung eines Endbenutzers:

```bash
rebase api-keys list
rebase api-keys create --name "Analytics" --permissions '[{"collection":"events","operations":["read"]}]'
rebase api-keys create --name "Full Access" --full-access --expires 90d
rebase api-keys revoke abc123-def456
```

`--permissions` nimmt ein JSON-Array von `{ collection, operations }`-Objekten entgegen, oder verwenden Sie
`--full-access` für Lesen/Schreiben/Löschen auf jeder Collection und Funktion. `--expires`
akzeptiert `7d`, `30d`, `90d`, `1y` oder ein ISO-Datum, und `--rate-limit` legt Anfragen
pro 15-Minuten-Fenster fest. Ein Schlüssel wird nur einmal angezeigt, und zwar bei der Erstellung.

Schlüssel sind doppelt abgesichert: Sowohl die eigenen Berechtigungen des Schlüssels als auch die Row-Level Security
der Identität, als die er agiert, greifen, sodass ein Schlüssel niemals mehr lesen kann als diese Identität.

### `rebase skills install`

Installiert die Rebase-Referenz-Skills für Ihren KI-Coding-Assistenten. Unterstützt
Cursor, Claude Code, Windsurf, Gemini CLI und Antigravity:

```bash
rebase skills install
rebase skills install --agent claude,cursor
rebase skills install --agent all
```

Siehe [Agent Skills](/docs/ai/skills) für die vollständige Liste und den Speicherort der Dateien.

### `rebase telemetry`

Anonyme Erfassung von Nutzungsdaten. **`rebase init` fragt einmal pro Projekt nach, und die Eingabeaufforderung
ist standardmäßig auf "Ja" gesetzt — es wird nichts gesendet, es sei denn, Sie antworten darauf:**

```bash
rebase telemetry status
rebase telemetry show
rebase telemetry enable
rebase telemetry disable
```

`status` gibt die aktuelle Einstellung aus, `show` gibt genau das aus, was gesendet werden würde —
unabhängig davon, ob das Teilen aktiviert ist oder nicht, sodass Sie die Payload vor der Entscheidung einsehen können — und
die anderen beiden ändern die Einstellung. Wenn Sie `init` nie ausgeführt haben, wurde nie etwas erfasst.

## Migrations-Workflow

Der typische Arbeitsablauf für Schemaänderungen:

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
