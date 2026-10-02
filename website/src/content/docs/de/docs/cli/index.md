---
sourceHash: bf93b611a72a5f12
title: CLI-Referenz
sidebar_label: CLI
description: Rebase-CLI-Befehle für Projektinitialisierung, Schemagenerierung, Datenbankmigrationen und SDK-Generierung.
---

## Übersicht

Die Rebase CLI (`rebase`) verwaltet Ihr Projekt vom Scaffolding bis zum Deployment.

## Installation

```bash
pnpm add -g @rebasepro/cli
```

Oder führen Sie jeden Befehl aus, ohne ihn zu installieren: `pnpm dlx @rebasepro/cli <command>`.

## Maschinenlesbare Ausgabe

`--json` ist der Schalter, und außerhalb der `cloud`-Befehlsfamilie ist es der einzige: `rebase status`, `rebase resources`, `rebase apps list` und `rebase upgrade` geben dann genau einen JSON-Wert auf stdout aus — das Ergebnis oder eine `{"error": {"message", "code", "hint", "issues"}}`-Struktur bei einem Exit-Code ungleich null — und zwar bei **jedem** Beenden des Befehls, sodass ein Aufrufer stdout bedingungslos parsen kann. Ohne diesen Schalter schreiben sie menschenlesbaren Text und Fehler gehen nach stderr. `rebase cloud` verwendet dieselbe Struktur und ist die einzige Ausnahme von diesem Schalter: Es aktiviert JSON automatisch von selbst, wenn stdout kein TTY ist oder wenn `REBASE_JSON=1` gesetzt ist. Daher ist `rebase cloud status | cat` JSON, während `rebase status | cat` dies nicht ist — übergeben Sie in einem Skript explizit `--json`, anstatt sich auf eine der beiden Regeln zu verlassen.

## Befehle

### `rebase init`

Initialisiert ein neues Rebase-Projekt:

```bash
rebase init [directory]
```

Richtet die Projektstruktur mit Frontend, Backend und geteilten Packages ein.

| Flag | Funktion |
|---|---|
| `-t, --template <preset>` | `blog`, `ecommerce` oder `blank`. Standard ist `blog` |
| `--headless` | Nur Backend — kein Admin-Panel und keine Collection-Dateien. `--template` hat keine Auswirkung, da keine Collections zum Seeden vorhanden sind |
| `-y, --yes` | Niemals nachfragen. **Erforderlich überall dort, wo kein Terminal zum Antworten vorhanden ist**, wie z. B. in CI. Überspringt Git-Init und die Installation von Abhängigkeiten — die interaktiven Standardeinstellungen bejahen beides; übergeben Sie also `--git` / `--install`, wenn Sie dies wünschen |
| `-i, --install` | Abhängigkeiten nach dem Scaffolding installieren |
| `-g, --git` | Ein Repository initialisieren und den ersten Commit erstellen |
| `--database-url <url>` | Eine bestehende Datenbank anstelle der verwalteten verwenden |
| `--introspect` | Collections aus dieser Datenbank generieren. Impliziert `--template blank` und erfordert `--install` |
| `--project <slug>` | Das Scaffold mit einem Rebase Cloud-Projekt verknüpfen |
| `--setup-key <key>` | Der Einmalschlüssel zur Authentifizierung dieser Verknüpfung |
| `-a, --agent <name>` | <span class="since-badge" data-since="0.24">Seit 0.24</span> Richtet KI-Coding-Agenten ein: die [Skills](/docs/ai/skills) und den [MCP-Server](/docs/ai/mcp). Wiederholbar oder kommagetrennt — `claude`, `cursor`, `windsurf`, `gemini`, `codex`, `kiro`, `copilot` oder `all`. Ohne diesen Parameter fragt `init` nach und wählt die auf dem Rechner installierten Agenten vorab aus; unter `--yes` keine |

### `rebase dev`

Startet den Entwicklungsserver:

```bash
rebase dev
```

Startet sowohl Frontend als auch Backend mit Hot Reloading und generiert das Drizzle-Schema sowie die SDK-Typen (`generated/sdk/`) beim Start und bei jedem Speichern einer Collection neu. <span class="since-badge" data-since="0.24">Seit 0.24</span> für die SDK-Typen — in 0.23 wird nur das Schema neu generiert, und `rebase generate-sdk` müssen Sie selbst ausführen.

Beide Ports werden aus dem Pfad des Projekts abgeleitet, sodass mehrere Rebase-Projekte
nebeneinander laufen können. Verwenden Sie die URLs, die `rebase dev` ausgibt. Einen Port festlegen können Sie mit `rebase dev --port 3001`.

### `rebase build`

Baut das Projekt in ein deploybares Bundle in `dist-bundle/`:

```bash
rebase build
```

Das Bundle ist das Artefakt, das Sie deployen — das Runtime-Image lädt es, sodass kein
Anwendungs-Image selbst gebaut werden muss. Nützliche Flags:

| Flag | Auswirkung |
|------|------------|
| `--output <dir>` (oder `--out`) | Schreibt das Bundle an einen anderen Ort als `dist-bundle/` (jeweils eine App) |
| `--vendor` | Die Abhängigkeiten des Bundles immer installieren und mitliefern |
| `--no-vendor` | Niemals vendoren; der Pod installiert beim ersten Start |
| `--skip-type-check` | Typechecking überspringen (schneller, weniger sicher) |
| `--no-static` | Das Frontend nicht ins Backend-Bundle einfalten (jede statische App bekommt trotzdem ihr eigenes Bundle) |
| `--skip-static-build` | Das Frontend als bereits gebaut einfalten, ohne dessen Build-Befehl auszuführen |

Abhängigkeiten werden standardmäßig per Vendoring eingebunden, damit ein Pod-Neustart keine
35–55 Sekunden dauernde Installation durchführen muss. Ein Abhängigkeitsbaum, der auf der Festplatte über 200 MB anwächst, wird stattdessen verworfen, da das Upload-Limit komprimiert 100 MB beträgt — siehe Changelog für die Begründung.

### `rebase upgrade`

Aktualisiert jedes vom Projekt festgelegte `@rebasepro/*`-Paket auf ein Release und
installiert es anschließend mit dem im Lockfile angegebenen Paketmanager. `rebase upgrade` nimmt das
neueste Release; `--to 0.21.0` eine exakte Version ohne Registry-Lookup; `--to canary` ein
Dist-Tag. Jede Versionsfixierung in `dependencies`, `devDependencies` und
`optionalDependencies` in jeder `package.json` des Projekts behält ihr `^`
oder `~`, und nichts anderes in der Datei wird geändert. `peerDependencies` sowie
`workspace:`, `link:`, `file:`, Git- und Tag-Spezifikationen werden aufgelistet und unberührt gelassen.
Overrides in `pnpm-workspace.yaml` und `package.json` werden ebenfalls aktualisiert, aber ein `link:`- oder
`file:`-Override hat Vorrang vor jeder Versionsfixierung: Es wird gemeldet, und
`--drop-local-overrides` entfernt es. `--dry-run` schreibt nichts, `--no-install`
überspringt die Installation und `--json` gibt ein einzelnes Dokument aus.

### `rebase start`

Führt das gebaute Bundle so aus, wie ein Deployment es ausführt:

```bash
rebase start
```

Liest im Gegensatz zu `rebase dev` `PORT` und den Rest von `.env`, und zwar in dem `NODE_ENV`,
das diese Dateien festlegen. Ein gescaffoldetes `.env` enthält `development`, sodass das erste
registrierte Konto weiterhin zum Admin wird, und `rebase start` weist oben darauf hin; setzen Sie
`NODE_ENV=production` für einen Produktionsserver. `rebase start --bundle ./dist-bundle` führt ein
Bundle an einem anderen Ort aus.

### `rebase apps list`

Zeigt die Apps an, die dieses Repository deklariert:

```bash
rebase apps list
```

Ein Repository kann mehr als eine deploybare App deklarieren — etwa ein Backend und eine
Marketing-Website. Auf diese Weise sehen Sie, worauf `rebase build` und das Deployment wirken.

### `rebase eject`

Übernehmen Sie die Kontrolle über den Serverprozess und sein Image:

```bash
rebase eject
```

Schreibt den Backend-Einstiegspunkt und ein `Dockerfile` in das Projekt und stellt dessen
Backend um, sodass das Repository sein eigenes Image baut, anstatt die veröffentlichte
Runtime auszuführen. Von da an **erreichen Plattform-Runtime-Upgrades das Projekt nicht mehr**,
und CORS, Auth-Verdrahtung, Storage und Shutdown müssen von Ihnen konfiguriert werden.

Vorschau mit `rebase eject --dry-run`, was auflistet, was sich ändern würde, und nichts ändert.
`--force` ersetzt eine vorhandene `backend/src/index.ts` oder `env.ts` und behält die aktuelle Datei als `<name>.bak`.

### `rebase schema generate`

Generiert das Drizzle-ORM-Schema aus Ihren TypeScript-Collections:

```bash
rebase schema generate
```

Dies liest Ihre Collections aus `config/collections/` und generiert `backend/src/schema.generated.ts` mit Drizzle-Tabellendefinitionen, Enums und Relationen.

### `rebase db push`

Überträgt Schema-Änderungen direkt in die Datenbank (nur für die Entwicklung):

```bash
rebase db push
```

:::caution
`db push` modifiziert die Datenbank direkt ohne Migrationsdateien. Verwenden Sie `db generate` + `db migrate` für die Produktion.
:::

### `rebase db generate`

Generiert SQL-Migrationsdateien aus Schema-Änderungen:

```bash
rebase db generate
```

Erstellt mit Zeitstempeln versehene Migrationsdateien in `drizzle/migrations/`, die überprüft und committed werden können.

### `rebase db migrate`

Führt ausstehende Datenbankmigrationen aus:

```bash
rebase db migrate
```

Wendet alle noch nicht angewendeten Migrationen auf die Datenbank an.

### `rebase db backup` / `backups` / `restore`

```bash
rebase db backup --out ./backups        # oder s3://bucket/prefix, gs://bucket/prefix
rebase db backups list                  # auflisten, was gespeichert ist
rebase db restore ./backups/<file>.dump --yes
```

`backup` führt `pg_dump` aus; `restore` führt `pg_restore` aus und benötigt, da destruktiv, `--yes`.
Planung, die Rollen-Datei, die mit jedem Dump mitreist, und das Restore-Verfahren finden Sie unter
[Backups und Wiederherstellung](/docs/deployment/backups/).

### `rebase db pull`

Kopiert eine andere Datenbank in die lokale Entwicklungsdatenbank:

```bash
rebase db pull --from postgres://…  [--anonymize]
```

`--anonymize` ersetzt personenbezogene Felder beim Importieren, sodass eine Produktionskopie
lokal bearbeitet werden kann, ohne echte Kundendaten auf einen Laptop zu übertragen.

`pg_dump` entfernt Berechtigungen, sodass die Kopie mit den RLS-Policies der Quelle ankommen
würde, aber ohne die dahinterliegenden Grants — jeder Lesevorgang als `rebase_user` würde
mit `permission denied` fehlschlagen. Der Pull stellt die App-Rolle anschließend neu bereit,
wobei dieselbe Routine wie beim Booten und bei `rebase db push` verwendet wird, sodass die
internen Tabellen von Rebase wie vorgesehen gesperrt bleiben.

Das Ziel ist immer die lokale Entwicklungsdatenbank dieses Projekts und kann nicht
ausgewählt werden: `--database-url` wird verweigert statt akzeptiert, sodass es keine Möglichkeit
gibt, "in die Produktion pullen" zu formulieren. `--from` ist die einzige Richtung.

### `rebase db url`

Gibt den Verbindungsstring aus, den dieses Projekt verwendet, und sonst nichts, sodass er
weitergeleitet werden kann:

```bash
rebase db url
psql "$(rebase db url)"
```

Die verwaltete Entwicklungsdatenbank ist der Fall, der dies erfordert: `.env` lässt
`DATABASE_URL` mit Absicht auskommentiert, und der Port wird aus dem Projektpfad
abgeleitet, sodass nichts auf der Festplatte ihn benennt. Wenn Sie eine eigene
`DATABASE_URL` festgelegt haben, wird genau diese ausgegeben — die Auflösungsreihenfolge ist
dieselbe, der auch jeder andere Befehl folgt. Startet die verwaltete Datenbank, falls sie
noch nicht läuft.

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
rebase db branch switch <name>     # daran arbeiten; alle späteren Befehle folgen
rebase db branch switch            # anzeigen, auf welchem Branch Sie sich befinden
rebase db branch switch --off      # zurück zur Hauptdatenbank
rebase db branch delete <name>
rebase db branch prune [--older-than 14d] [--include-dev-diff]
```

PostgreSQL kopiert oder löscht keine Datenbank, mit der noch etwas verbunden ist, und
dieses "etwas" ist üblicherweise Ihr eigenes `rebase dev`. `create` und `delete` nennen
das, was die Datenbank offen hält; `--force` trennt diese Sitzungen zuerst.

Jeder Branch ist eine vollständige Kopie auf der Festplatte, daher müssen sie aufgeräumt werden.
`prune` entfernt drei Dinge: einen Eintrag, dessen Datenbank außerhalb von Rebase gelöscht wurde,
eine Branch-Datenbank, deren Eintrag nie geschrieben wurde, und — nur mit `--older-than` — Branches,
die älter als ein von Ihnen angegebenes Alter sind. Vor dem Entfernen wird nachgefragt, es sei denn, Sie übergeben `--yes`.

`switch` speichert den Branch in `.rebase/branch.json` und bearbeitet `.env` niemals. Es
hat Vorrang vor `DATABASE_URL` in `.env` und unterliegt `--database-url` oder einer
`DATABASE_URL` in der Shell, sodass ein Flag in der Befehlszeile immer Vorrang vor einem
zuvor durchgeführten Wechsel hat. Das Löschen des Branches, auf dem Sie sich befinden, bringt
Sie zur Hauptdatenbank zurück, anstatt den Checkout auf eine nicht mehr existierende Datenbank verweisen zu lassen.

:::note[Nicht auf der verwalteten Entwicklungsdatenbank]
`push`, `generate` und `migrate` planen ihre Arbeit mit Atlas, welches eine zweite
leere Datenbank zum Vergleichen benötigt — und das verwaltete PGlite stellt genau eine bereit.
Das Ausführen dort bricht mit einer entsprechenden Meldung ab. Verweisen Sie `DATABASE_URL`
auf ein echtes PostgreSQL für den Migrations-Workflow; `rebase dev` erstellt fehlende Tabellen
auf der verwalteten Datenbank ohnehin bereits additiv.

`branch` wird dort aus einem ähnlichen Grund verweigert. `CREATE DATABASE ... TEMPLATE`
auf PGlite schreibt einen Katalogeintrag und kopiert nichts, sodass der Branch auf die Datenbank
verweisen würde, von der er geklont wurde — jeder Schreibvorgang, den Sie isolieren wollten,
würde in Ihrer Entwicklungsdatenbank landen. `rebase dev --docker` liefert Ihnen einen echten
Server, mit dem Branches funktionieren.
:::

### `rebase apps init` / `rebase apps config`

```bash
rebase apps list             # die von diesem Projekt deklarierten Apps
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
`rebase.json` gibt an, wo sich Ihr Code befindet und wer den Server betreibt,
`config/resources.ts` gibt an, was das Projekt benötigt, und die Umgebung gibt an,
wie jedes Element erreicht werden kann. Alles andere — `rebase.resources.json`, das Bundle-Manifest —
wird aus der mittleren Datei für Ausleser generiert, die Ihren Code nicht ausführen können, und wird von Ihnen niemals manuell geschrieben.

Ein `○` ist der Status, den man besser vor einem Deployment kennt als danach:
deklariert, nicht konfiguriert. Ein `✗` bedeutet, dass die Umgebung etwas *falsch* setzt,
was den Start verweigert, anstatt in einen eingeschränkten Modus überzugehen.

### `rebase resources`

Was dieses Projekt deklariertermaßen benötigt — die Datenbanken, Buckets, Topics und
Queues, die sein Konfigurationscode anfordert, und die Crons und Funktionen, die seine Dateien definieren:

```bash
rebase resources            # auflisten
rebase resources --write    # rebase.resources.json neu generieren
rebase resources --check    # fehlschlagen, wenn der committete Graph veraltet ist
rebase resources --json     # maschinenlesbar
```

`rebase resources --check` ist neu — das Flag, das ein CI-Job verwendet, um
bei einer `rebase.resources.json` fehlzuschlagen, die nicht mehr zum Konfigurationscode passt.

Eine Ressource wird im Konfigurationscode deklariert — `database("analytics")`,
`bucket("media")`, `topic("signups")`, `queue("thumbnails")` — oder ist eine Datei
unter `backend/crons` oder `backend/functions` und wird niemals manuell in
`rebase.resources.json` geschrieben, welches aus diesen Deklarationen generiert wird,
damit ein Host lesen kann, was ein Projekt benötigt, ohne es zu bauen. Jeder Eintrag
zeichnet auf, wer ihn verwendet (`collection:events`, `property:posts.cover`, `function:report`).

Ein Backend hat außerdem eine Standarddatenbank und eine Standard-Speicherquelle, die niemand
deklariert. Beide werden hier aufgelistet, als `implicit` markiert und keine von beiden wird in
`rebase.resources.json` geschrieben — der Host stellt sie bereit, sodass ihre Erfassung
etwas anfordern würde, nach dem niemand gefragt hat.

Um zu sehen, was die Plattform für ein Projekt im Vergleich zu dem vorhält, was ihr Code deklariert,
und um eine bereitgestellte Datenbank zu entfernen, die der Code nicht mehr nennt, siehe
`rebase cloud resources` weiter unten.

### `rebase cloud`

Alles rund um Rebase Cloud, das sich in der Private Beta befindet. Siehe den
[Rebase Cloud-Leitfaden](/docs/deployment/cloud/) dafür, was es ist und was die Beta
nicht enthält.

Jede Gruppe reagiert auf `--help`, und `--help` führt den Befehl niemals aus. Die meisten Befehle
wirken auf das verknüpfte Projekt in `.rebase/cloud.json`; `--project <id>` operiert auf
einem Projekt ohne Verknüpfung.

Drei Optionen gelten überall: `--json` für maschinenlesbare Ausgabe (auch der
Standard bei Pipes oder mit `REBASE_JSON=1`), `--url <origin>`, um eine
bestimmte Control Plane anzusteuern (oder `REBASE_CLOUD_URL`), und `--project, -p <id>`.

#### Auth

```bash
rebase cloud login      # sign in to the control plane
rebase cloud logout     # sign out
rebase cloud whoami     # the current session, or what REBASE_TOKEN may do
rebase cloud tokens create --can deploy,logs   # a token for CI, shown once
```

#### Projekt-Verknüpfung

```bash
rebase cloud link         # dieses Verzeichnis mit einem Cloud-Projekt verknüpfen
rebase cloud link [url]   # oder direkt auf ein Backend: keine Control Plane, kein Login, und der Rest der Befehlsfamilie wird verweigert, bis Sie unlink ausführen
rebase cloud unlink       # die Verknüpfung entfernen
rebase cloud use [org]    # die aktive Organisation auswählen
rebase cloud open         # das Dashboard in einem Browser öffnen
```

#### Projekte

```bash
rebase cloud projects list
rebase cloud projects create [--link]
rebase cloud projects info [id]
rebase cloud projects delete [id]
```

#### Deployen und Überwachen

```bash
rebase cloud deploy [app] [--source .]   # eine App deployen und Build-Logs streamen
rebase cloud logs [--runtime] [-f]       # Build-Logs oder die des laufenden Prozesses
rebase cloud deployments list [--limit N|--all]
rebase cloud rollback [id] [-y]          # zurück zu einem erfolgreichen Deploy
rebase cloud cancel [-y]                 # den laufenden Build abbrechen
rebase cloud start | stop | restart [-y] # stop und restart erfordern -y
rebase cloud status                      # Projektstatus auf einen Blick
rebase cloud metrics                     # Live-CPU / Speicher / Festplatte
rebase cloud debug [health|logs|…]       # ein Deployment diagnostizieren, schreibgeschützt
```

`deploy` ohne App-Namen deployt das Backend. Ein Backend-Bundle-Deploy
lädt auch den Quellcode des Projekts hoch — was Git trackt, niemals eine `.env` —, sodass ein
Plattform-Upgrade es neu bauen kann; `--no-source` überspringt dies einmalig, und `cloud settings set
--platform-rebuilds off` stoppt dies und löscht die gespeicherte Kopie. `--allow-downgrade` deployt ein älteres Release.

#### Konfiguration

```bash
rebase cloud env list | set | unset | reveal | pull
rebase cloud domains list | add <domain> | verify [domain] | remove <domain>
rebase cloud extensions list | enable | disable
rebase cloud settings show | set        # Name, Branch, Repo, Subdomain, Rebuilds
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

`db connect` öffnet einen lokalen Port, der *die* verwaltete Datenbank ist (kein öffentlicher
Endpunkt), bis Strg-C gedrückt wird; `--reveal` fügt das Passwort hinzu. Nur für Owner oder Admin.

#### Ressourcen

Was die Plattform für das Projekt vorhält, im Vergleich zu dem, was ihr Code deklariert.

```bash
rebase cloud resources                       # jede Datenbank und jeder Bucket: deklariert? bereitgestellt?
rebase cloud resources prune database <key>  # eine entfernen, die der Code nicht mehr deklariert
```

Ein Deploy entfernt niemals eine bereitgestellte Datenbank, wenn ihre Deklaration wegfällt — das
wären Daten, die durch einen Push gelöscht würden. Sie wird beibehalten, gebunden und abgerechnet, bis jemand
sie namentlich bereinigt (pruned).

#### Compute

Was das Projekt reserviert und was das kostet.

```bash
rebase cloud compute            # die aktuelle Reservierung und ihre monatlichen Kosten
rebase cloud compute set        # ändern
```

`compute set` akzeptiert `--cpu`, `--memory`, `--replicas`, `--spot`,
`--scale-to-zero`, `--db-instances`, `--db-cpu`, `--db-memory`,
`--storage`, `--autoscale-max`, `--autoscale-cpu-target` und `--no-autoscale`.
Es gibt keine Tarifstufen: Alles wird pro Ressource bepreist. Siehe
[Rebase Cloud](/docs/deployment/cloud/).

#### Storage, Webhooks, Cluster und Abrechnung

```bash
rebase cloud storage             # Storage-Buckets auflisten
rebase cloud storage create      # Plattform-verwalteten Speicher bereitstellen
rebase cloud storage attach      # Ihren eigenen S3-kompatiblen Bucket anhängen
rebase cloud webhooks list | create | delete
rebase cloud clusters list | add | verify   # die Cluster, auf denen Mandanten laufen; `add` registriert einen aus einer Kubeconfig
rebase cloud billing             # das Abrechnungskonto und die hinterlegte Karte
rebase cloud billing setup       # eine Karte hinterlegen, einmalig, öffnet einen Browser
rebase cloud billing checkout    # eine Stripe-Sitzung für ein Projekt
```

### `rebase generate-sdk`

Generiert ein typisiertes SDK aus Ihren Collection-Definitionen:

```bash
rebase generate-sdk
```

Erstellt TypeScript-Typen und einen typsicheren Client für alle Ihre Collections.

### `rebase doctor`

```bash
rebase doctor
```

Der Befehl, den man ausführt, wenn etwas nicht stimmt und man noch nicht weiß, was es ist. Er
berichtet und ändert niemals etwas, sodass er für jede Datenbank, die Sie
erreichen können, sicher ist.

**Ohne Datenbank.** Diese Prüfungen laufen zuerst, da alles, was ein Projekt
daran hindert, überhaupt zu funktionieren, passiert, bevor eine Tabelle verglichen werden kann:

| Prüfung | Warum |
| --- | --- |
| Node-Version | Abgleich mit dem Bereich, den die CLI deklariert. Zu alt wird nicht als "nicht unterstütztes Node" gemeldet — es ist ein Syntaxfehler innerhalb einer Abhängigkeit. |
| Paketmanager | Zwei Lockfiles in einem Projekt. `npm install` in einem pnpm-Workspace schreibt `node_modules` in ein Layout um, dem pnpm widerspricht, und das Symptom ist `Cannot find module` Stunden später. |
| Doppelte Slugs | Die Registry behält die zuletzt registrierte Collection, sodass die andere nicht als fehlend gemeldet wird — sie wird als Sieger unter ihrem eigenen Namen ausgeliefert. |
| `.env`-Plausibilität | Ein `JWT_SECRET`, das kürzer als 32 Zeichen ist (woraufhin die Produktion den Start verweigert), und `NODE_ENV=production` mit weder `CORS_ORIGINS` noch `FRONTEND_URL`. Werte werden niemals ausgegeben. |
| `@rebasepro/*`-Versionsabweichung | Dasselbe Paket, das in verschiedenen `package.json`-Dateien des Projekts auf unterschiedliche Versionen festgelegt ist. Zwei Kopien brechen `instanceof` zwischen ihnen, was als Type Guard fehlschlägt, der seinen eigenen Typ ablehnt. |
| Verbindungsstrings | Ein nicht-kodiertes `=` in einem URL-Parameter, das die bordeigenen Tools von PostgreSQL nicht parsen können — Backups und `psql` schlagen fehl, während die App weiterläuft. |
| Benutzerdefinierte Funktionen | Was jede Funktion von ihrem Host benötigt und welche davon nicht auf einer Edge-Runtime laufen würden. |

**Gegen die Datenbank**, wenn `DATABASE_URL` gesetzt ist:

| Prüfung | Warum |
| --- | --- |
| Collections → generiertes Schema | Ob `schema.generated.ts` veraltet ist. |
| Collections → Datenbank | Fehlende Tabellen, Spalten, Enums, Fremdschlüssel und Junction-Tabellen. |
| Erforderliche Extensions | Eine `{ type: "vector" }`-Eigenschaft benötigt pgvector, welches Rebase nur dort installiert, wo ein Projekt es deklariert hat. |
| Schema-Stempel | Ob diese Datenbank aus diesen Collections bereitgestellt wurde. Ein Hash, sodass ausgesagt werden kann, dass beide nicht übereinstimmen, aber niemals, welches voraus ist. |
| Collections → SDK-Typen | Ob das generierte typisierte SDK veraltet ist. |
| RLS-Policies | Ob die Policies der Datenbank mit den von Ihnen deklarierten `securityRules` übereinstimmen und ob eine Policy eine Rolle benennt, die dieser Server nicht verwenden kann. |

Wenn die Datenbank nicht erreichbar ist, werden ihre Phasen mit der
Begründung als übersprungen gemeldet und der Rest läuft trotzdem weiter — siehe [Fehlerbehebung](/docs/troubleshooting/).

Beendet mit einem Exit-Code ungleich null, wenn eine Prüfung einen Fehler findet oder wenn eine Phase nicht ausgeführt werden konnte,
weil die angegebene Datenbank Verbindungen ablehnt. Eine Phase, die übersprungen wurde, weil
Sie keine `DATABASE_URL` angegeben haben, gilt nicht als Fehler.

`rebase doctor --policies` führt nur die RLS-Prüfungen aus — kein Schema-Diff, keine SDK-Typen —
und schlägt im Zweifelsfall fehl ("fails closed"), was es zur geeigneten Form für ein CI-Gate gegen eine
deployte Datenbank macht.

### `rebase auth`

Befehle zur Authentifizierungsverwaltung:

```bash
rebase auth reset-password --email admin@example.com --password NewPassword123!
```

### `rebase api-keys`

<span class="since-badge" data-since="0.24">Seit 0.24</span> Verwaltet die Service-API-Keys des Projekts — die Zugangsdaten, die ein Agent, Skript oder ein
anderer Dienst verwendet, im Gegensatz zur Sitzung eines Endbenutzers:

```bash
rebase api-keys list
rebase api-keys create --name "Blog CI" --scopes data:read:posts,data:write:posts --expires-in 90
rebase api-keys create --name "Ops" --full-access --roles admin --expires-at 2027-01-31
rebase api-keys revoke abc123-def456
```

`--scopes` nennt, was der Schlüssel darf, kommagetrennt oder wiederholt; `--full-access`
gibt ihm jeden Scope, den der Service-Key hält, außer `keys:*`. `--roles` fügt RLS-Rollen neben
`service` hinzu, `--expires-in` nimmt Tage und `--expires-at` ein ISO-Datum.
`rebase api-keys scopes` listet jeden Scope, den das Backend kennt. Ein Schlüssel wird einmal angezeigt.

Schlüssel sind doppelt abgesichert: Sowohl die Scopes des Schlüssels als auch die Row-Level Security
der Identität, als die er agiert, greifen. Siehe [API-Schlüssel](/docs/backend/api-keys/).

### `rebase skills install`

Installiert die Rebase-Referenz-Skills für Ihre KI-Coding-Assistenten — jedes `--agent` von oben:

```bash
rebase skills install
rebase skills install --agent claude,cursor
rebase skills install --agent all
```

Siehe [Agent Skills](/docs/ai/skills) für die vollständige Liste und die Speicherorte der geschriebenen Dateien.

### `rebase telemetry`

Anonyme Nutzungsdatenübermittlung. **`rebase init` fragt einmal pro Projekt nach, und die Abfrage
ist standardmäßig auf "Ja" gesetzt — es wird nichts gesendet, es sei denn, Sie beantworten sie:**

```bash
rebase telemetry status
rebase telemetry show
rebase telemetry enable
rebase telemetry disable
```

`status` gibt die aktuelle Einstellung aus, `show` gibt exakt das aus, was gesendet werden würde —
unabhängig davon, ob die Freigabe aktiviert ist oder nicht, damit Sie die Nutzlast vor einer Entscheidung einsehen können —, und
die beiden anderen ändern die Einstellung. Wenn Sie `init` nie ausgeführt haben, wurde nie etwas erfasst.

## Nächste Schritte

- **[Schemagenerierung](/docs/cli/schema/#production-workflow)** — Der Migrations-Workflow, von der Collection-Änderung bis zur Produktion
- **[Schema as Code](/docs/architecture/schema-as-code)** — Wie die Schemagenerierung funktioniert
- **[Schnellstart](/docs/getting-started/quickstart)** — Erste Schritte
