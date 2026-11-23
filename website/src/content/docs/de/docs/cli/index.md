---
sourceHash: 4afe718897048683
title: CLI-Referenz
sidebar_label: CLI
description: Rebase-CLI-Befehle für Projektinitialisierung, Schemagenerierung, Datenbankmigrationen und SDK-Generierung.
---

## Übersicht

Die Rebase-CLI (`rebase`) verwaltet Ihr Projekt vom Scaffolding bis zum Deployment.

## Installation

```bash
pnpm add -g @rebasepro/cli
```

Oder führen Sie jeden Befehl aus, ohne ihn zu installieren: `pnpm dlx @rebasepro/cli <command>`.

## Maschinenlesbare Ausgabe

`--json` ist die Option dafür, und außerhalb der `cloud`-Befehlsfamilie ist es die einzige: `rebase status`, `rebase resources`, `rebase apps list`, `rebase upgrade` und `rebase verify` geben dann bei **jedem** Beenden des Befehls genau einen JSON-Wert auf stdout aus – das Ergebnis oder eine `{"error": {"message", "code", "hint", "issues"}}`-Hülle mit einem Exit-Code ungleich null –, sodass Aufrufer stdout bedingungslos parsen können. Ohne diese Option geben sie menschenlesbaren Text aus und Fehler gehen an stderr. `rebase cloud` verwendet dieselbe Hülle und ist die einzige Ausnahme von dieser Regel: Es schaltet JSON auch automatisch ein, wenn stdout kein TTY ist oder wenn `REBASE_JSON=1` gesetzt ist. Daher liefert `rebase cloud status | cat` JSON, während `rebase status | cat` dies nicht tut – übergeben Sie in Skripten explizit `--json`, anstatt sich auf eine dieser Regeln zu verlassen.

## Befehle

### `rebase init`

Initialisieren Sie ein neues Rebase-Projekt:

```bash
rebase init [directory]
```

Richtet ein `backend/` (die Tabellen in `backend/schema/`) und ein `frontend/` (das Admin-Panel mit seinen Tabellenanpassungen in `frontend/src/cms/`) ein; `--headless` erstellt nur das `backend/` als Gerüst, ohne `backend/schema/`. [Projektstruktur](/docs/getting-started/project-structure/) zeigt beide Verzeichnisbäume.

| Flag | Beschreibung |
|---|---|
| `-t, --template <preset>` | `blog`, `ecommerce` oder `blank`. Standard: `blog` |
| `--headless` | Nur Backend – kein Admin-Panel und kein `backend/schema/`: Der Server stellt die eigenen Tabellen der Datenbank bereit. `--template` hat keine Auswirkung, da keine Tabellen mit Beispieldaten befüllt werden müssen |
| `-y, --yes` | Niemals nachfragen. **Erforderlich überall dort, wo kein Terminal zum Antworten vorhanden ist**, wie z. B. in CI-Umgebungen. Überspringt `git init` und die Installation von Abhängigkeiten – die interaktiven Standardeinstellungen bejahen beides; übergeben Sie also `--git` / `--install`, falls Sie dies wünschen |
| `-i, --install` | Abhängigkeiten nach dem Scaffolding installieren. Ohne dieses Flag fragt init nach (Standard: Ja); unter `--yes` wird nichts installiert |
| `--no-install` | Nichts installieren und nicht nachfragen |
| `-g, --git` | Ein Repository initialisieren und den ersten Commit erstellen. Ohne dieses Flag fragt init nach (Standard: Ja); unter `--yes` wird kein Repository erstellt |
| `--database-url <url>` | Eine bestehende Datenbank anstelle der verwalteten verwenden. Es muss eine `postgres://`- oder `postgresql://`-URL sein: Alles andere wird abgelehnt, bevor eine Datei geschrieben wird, und die interaktive Eingabeaufforderung fragt erneut nach |
| `--introspect` | `backend/schema` aus dieser Datenbank generieren. Impliziert `--template blank` und erfordert `--install` |
| `--project <slug>` | Das Scaffolding mit einem Rebase-Cloud-Projekt verknüpfen |
| `--setup-key <key>` | Der Einmalschlüssel, der diese Verknüpfung authentifiziert |
| `-a, --agent <name>` | KI-Coding-Agents einrichten: die [Skills](/docs/ai/skills) und den [MCP-Server](/docs/ai/mcp). Wiederholbar oder kommagetrennt – `claude`, `cursor`, `windsurf`, `gemini`, `codex`, `kiro`, `copilot` oder `all`. Ohne dieses Flag fragt `init` nach und wählt die auf dem Rechner installierten Agents vorab aus; unter `--yes` keine |

### `rebase dev`

Starten Sie den Entwicklungsserver:

```bash
rebase dev
```

Startet sowohl Frontend als auch Backend mit Hot-Reloading und generiert das Drizzle-Schema sowie die SDK-Typen (`generated/sdk/`) beim Start und bei jedem Speichern unter `backend/schema/` neu.

Beide Ports werden aus dem Pfad des Projekts abgeleitet, sodass mehrere Rebase-Projekte nebeneinander laufen können. Verwenden Sie die URLs, die `rebase dev` ausgibt. Legen Sie einen Port mit `rebase dev --port 3001` fest.

Eine statische App in `rebase.json` ohne Build-Schritt (kein `build` und `output` entspricht ihrem `root`, wie etwa eine reine HTML-Website) wird vom Backend aus diesem Verzeichnis unter ihrem `path` bereitgestellt, genau wie `rebase start` sie aus dem Bundle bereitstellt. `FRONTEND_URL` wird darauf gesetzt (auf den Port des Backends), damit per E-Mail versendete Links dort landen. Ihre [`redirects` und `cleanUrls`](/docs/architecture/redirects-and-clean-urls/) werden ebenfalls bereitgestellt, und eine App, die Weiterleitungen deklariert, benötigt keine `index.html`. Eine App mit Build-Schritt läuft in Vite auf ihrem eigenen Port, und `FRONTEND_URL` ist der von Vite.

Eine Bearbeitung von `.env` startet das Backend neu, welches die Datei erneut einliest, ebenso wie das Admin-Panel. Was `rebase dev` selbst setzt, bleibt bis zu einem Neustart erhalten: `PORT` und `DATABASE_URL`, wenn es sich um die verwaltete Datenbank oder Docker handelt.

Mit `--database-url` prüft `rebase dev` zuerst, ob unter diesem Host und Port eine Antwort erfolgt. Wenn nicht, wird dies unter Nennung des Flags gemeldet und der Befehl wird mit dem Exit-Code `1` beendet, ohne dass etwas gestartet wurde; außerdem werden die Datenbank-Namen in `.env` nicht verändert und der Compose-Container wird nicht gestartet.

### `rebase build`

Bauen Sie das Projekt zu einem deploybaren Bundle in `dist-bundle/`:

```bash
rebase build
```

Das Bundle ist das Artefakt, das Sie deployen – das Runtime-Image lädt es, sodass Sie kein eigenes Anwendungs-Image erstellen müssen. Nützliche Flags:

| Flag | Auswirkung |
|------|--------|
| `--output <dir>` (or `--out`) | Schreibt das Bundle an einen anderen Ort als `dist-bundle/` (jeweils eine App auf einmal) |
| `--vendor` | Immer die Abhängigkeiten des Bundles installieren und mit ausliefern |
| `--no-vendor` | Niemals vendoren; der Pod installiert sie bei jedem Start |
| `--skip-type-check` | Typprüfung überspringen (schneller, weniger sicher) |
| `--no-static` | Das Frontend nicht in das Backend-Bundle einbetten (jede statische App erhält weiterhin ein eigenes Bundle) |
| `--skip-static-build` | Das Frontend im bereits gebauten Zustand einbinden, ohne dessen Build-Befehl auszuführen |

Ein Frontend – jede statische App aus `rebase.json` mit einer Vite-Konfiguration –, dessen Konfiguration `rebaseBackendGuard()` (aus `@rebasepro/app/vitePlugin`) nicht verwendet, wird abgewiesen: Es sorgt dafür, dass Server-Code nicht im Browser-Bundle landet, und verhindert, dass Vite eine Backend-Datei als `data:`-URL inline einbettet (der Build schlägt unter Angabe des Plugins fehl, wenn ein anderes Plugin dessen `build.assetsInlineLimit` überschreibt). `frontend/src/cms/ui-config.json` wird als `entry.uiConfig` in das Bundle übernommen – die Workspace-Darstellung, die ein deploytes Backend bereitstellt.

Abhängigkeiten werden standardmäßig per Vendoring gebündelt, damit eine neue Instanz nicht 35–55 Sekunden für die Installation aufwenden muss. Ein Verzeichnisbaum, der auf der Festplatte mehr als 2 GB groß wird, wird stattdessen verworfen, da das Upload-Limit komprimiert 1 GB beträgt.

Jede statische App, die im Bundle enthalten ist, erhält neben jedem inhaltsgehashten Asset ab 1 KB – den Dateien, die ein Browser ein Jahr lang zwischenspeichert – eine Brotli- (`.br`) und eine Gzip-Kopie (`.gz`). Die Runtime sendet die Variante, die der Browser akzeptiert, sodass diese Dateien pro Anfrage keinen Kompressionsaufwand verursachen (auch nicht beim ersten Aufruf nach einem Deployment), und Browser, die Brotli unterstützen, erhalten dieses (rund 11 % kleiner als Gzip beim JavaScript des Admins). Die Build-Ausgabe Ihres Frontends bleibt unverändert; nur die Kopie im Bundle wird modifiziert. Bei der Beispiel-App verlängert dies den Build um weniger als eine Sekunde und vergrößert das Bundle um etwa 2,4 MB.

### `rebase upgrade`

Aktualisiert jedes vom Projekt festgelegte `@rebasepro/*`-Paket auf ein Release und installiert sie anschließend mit dem Paketmanager, der in der Lockdatei angegeben ist. `rebase upgrade` verwendet das neueste Release; `--to 0.21.0` eine exakte Version ohne Registry-Abfrage; `--to canary` ein Dist-Tag. Jeder Eintrag in `dependencies`, `devDependencies` und `optionalDependencies` in jeder `package.json` innerhalb des Projekts behält sein `^` oder `~`, und sonst ändert sich an der Datei nichts. `peerDependencies` sowie `workspace:`, `link:`, `file:`, Git- und Tag-Spezifikationen werden aufgelistet und nicht angetastet. Overrides in `pnpm-workspace.yaml` und `package.json` werden ebenfalls angepasst, aber ein `link:`- oder `file:`-Override hat Vorrang vor jedem Pin: Dies wird gemeldet, und `--drop-local-overrides` entfernt ihn. `--dry-run` schreibt nichts, `--no-install` überspringt die Installation und `--json` gibt ein einzelnes Dokument aus.

Ein Projekt auf einem Vorab-Release, wie etwa einem Canary, bleibt auf seinem Kanal, es sei denn, `latest` ist neuer. Ein Dist-Tag, das ein Paket auf eine ältere Version zurückstufen würde, wird abgelehnt (`downgrade_refused` unter `--json`), es sei denn, Sie übergeben `--allow-downgrade`; ein exaktes `--to` wird angewendet und als Downgrade gekennzeichnet. Ein `--dry-run` eines Upgrades, das die tatsächliche Ausführung ablehnen würde, zeigt an, was geändert werden würde, und beendet sich mit 0; unter `--json` enthält das Dokument die Ablehnung als `wouldRefuse` (`{ code, message, hint }`). Nach der Installation aktualisiert der Befehl auch die [Agent-Skills](/docs/ai/skills/#updating-the-skills) des Projekts über die neue CLI (`skills` im `--json`-Dokument). Andere Befehle enden mit einer Zeile auf stderr, wenn ein neueres Release verfügbar ist; [`REBASE_NO_UPDATE_CHECK=1`](/docs/getting-started/configuration/) blendet dies aus.

### `rebase start`

Führen Sie das gebaute Bundle so aus, wie es bei einem Deployment ausgeführt wird:

```bash
rebase start
```

Liest `PORT` und den Rest von `.env`, anders als `rebase dev`, in der Umgebung (`NODE_ENV`), die dort definiert ist. Eine neu erstellte `.env` enthält `development`, sodass das erste registrierte Konto weiterhin zum Administrator wird, was `rebase start` zu Beginn ausgibt; setzen Sie `NODE_ENV=production` für einen Produktionsserver. `rebase start --bundle ./dist-bundle` führt ein Bundle an einem anderen Pfad aus.

`rebase start` startet keine Datenbank, und die `.env` des Scaffolding-Projekts enthält keine `DATABASE_URL`. Eine lokale Ausführung mit der Datenbank, die `rebase dev` nutzt, lautet daher `DATABASE_URL="$(rebase db url)" rebase start`. Ist keine URL vorhanden, wird diese Zeile vor dem Booten ausgegeben.

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

Schreibt den Backend-Einstiegspunkt und ein `Dockerfile` in das Projekt und stellt das Backend um, sodass das Repository ein eigenes Image baut, anstatt die veröffentlichte Runtime auszuführen. Von da an **greifen Plattform-Runtime-Upgrades nicht mehr**, und Sie sind selbst für die Konfiguration von CORS, Auth-Verdrahtung, Speicher und Server-Shutdown verantwortlich.

Erstellen Sie eine Vorschau mit `rebase eject --dry-run`, was auflistet, was geändert werden würde, und nichts verändert. `--force` ersetzt ein vorhandenes `backend/src/index.ts` oder `env.ts` und sichert die aktuelle Datei als `<name>.bak`.

Der ausgeworfene (ejected) Server speichert lokale Uploads im `uploads/`-Verzeichnis des Projekts, egal ob aus dem Quellcode oder kompiliert ausgeführt, genau wie `rebase dev`. Er läuft in `backend/`, sodass ein relativer `STORAGE_PATH` dort ausgehend von `backend/` gelesen wird.

### `rebase schema generate` / `rebase schema stale`

```bash
rebase schema generate       # backend/schema → backend/src/schema.generated.ts
rebase schema stale          # name what differs from the tables, exit 1 if anything does
rebase schema stale --fix    # regenerate the file instead
```

Jeder Befehl, der das Schema liest, akzeptiert `--schema-dir <dir>` für Projekte, die es an einem anderen Ort ablegen; `--collections` wurde entfernt. `rebase dev` hält die Datei aktuell, daher ist `stale` die Prüfung für einen Build oder CI. Siehe [Schemagenerierung](/docs/cli/schema/).

### `rebase db`

```bash
rebase db push                 # apply the tables to the database (development)
rebase db generate             # write a SQL migration file
rebase db migrate              # apply the pending migrations
rebase db url                  # print the connection string this project uses
rebase db pull --from <url>    # copy another database into the local one
rebase db backup               # pg_dump; db backups list and db restore beside it
rebase db branch create <name> # a copy to work on; switch, list and prune it too
rebase db stop                 # stop the managed development database
rebase db reset                # delete it and start over
rebase db request-role migrate --to <role> # move requests to another Postgres role
rebase db provision --print    # the SQL that sets up the request role, for a DBA
```

Jeder Befehl wird unter [Datenbank-Befehle](/docs/cli/database/) beschrieben, zusammen mit der Reihenfolge, in der ein Befehl seine Datenbank auswählt; `push`, `generate` und `migrate` werden unter [Schemagenerierung](/docs/cli/schema/) ausführlich behandelt.

### `rebase console`

Eine Node-REPL mit geladenen Projektdaten oder ein einzelnes Snippet, das mit `-e` ausgeführt wird:

```bash
rebase console
rebase console -e "rebase.dataAsAdmin.posts.find({ limit: 5 })"
```

`rebase` (`dataAsAdmin`, `sql`, `withAuth(user)`) und `tables` (die Tabellen des Projekts, geladen aus `backend/schema`) befinden sich im Scope, und Top-Level-`await` wird unterstützt. Die Datenbank wird so aufgelöst wie bei `rebase db push`, und das Öffnen verändert an ihr nichts. Mit `-e` wird das per Await abgewartete Ergebnis als JSON auf stdout ausgegeben, und bei einer Exception beendet sich der Prozess mit `1`. Flags: `--eval`/`-e`, `--schema-dir`, `--database-url`, `--docker`. Siehe [Skripte und die Konsole](/docs/backend/scripts/).

### `rebase migrate`

Einweg-Migrationen von einem Layout, das dieses Release nicht mehr unterstützt: `rebase migrate collections-to-tables` (`config/collections` → `backend/schema` und `frontend/src/cms`) und `rebase migrate sdk-calls` (`data.collection("x")` → `data.table("x")` in Ihrem eigenen Code). Deren Flags, was sie schreiben und der Abschnitt „Vor dem Deployment prüfen“ finden sich unter [Schemagenerierung](/docs/cli/schema/#rebase-migrate).

### `rebase apps init` / `rebase apps config`

```bash
rebase apps list             # the apps this project declares
rebase apps init             # write a rebase.json inferred from this project
rebase apps config <app>     # the client configuration for one app
```

`apps init` nimmt keinen Namen entgegen: Es leitet jede App aus dem Projekt ab und schreibt die gesamte `rebase.json`. Das Ersetzen einer bestehenden Datei wird abgelehnt, es sei denn, Sie übergeben `--force`.

Ein Namensargument wird zurückgewiesen. `--force` behält das bei, was die automatische Erkennung nicht aus der zu ersetzenden Datei ableiten kann: den Namen jeder App, ihren `path` und ihre `cms`-Route. Alles andere wird erneut abgeleitet, und eine deklarierte App, die nicht mehr gefunden wird, wird als entfernt gemeldet; bei einem Scaffold-Projekt wird somit die ursprüngliche `rebase.json` wiederhergestellt. Der Build-Befehl der statischen App verwendet den Paketmanager des Projekts.

Für ein Checkout, das nicht mit einem Cloud-Projekt verknüpft ist, meldet `apps config`, dass keine Verknüpfung besteht (unabhängig davon, ob `rebase dev` läuft), und gibt die URL des Backends so an, wie `rebase dev` sie bereitstellt.

### `rebase apps add admin`

```bash
rebase apps add admin                  # at /, or at /admin when another app is at /
rebase apps add admin --path /console  # anywhere else, or an https URL of its own
```

Fügt das Admin-Panel zu einem Headless- oder portierten Projekt hinzu, genau wie `rebase init` es angelegt hätte. Was dabei geschrieben wird, welche Version festgeschrieben wird und wann der Vorgang abgelehnt wird: [Nachträgliches Hinzufügen eines Admin-Panels](/docs/getting-started/headless/#adding-an-admin-panel-later).

### `rebase status`

Alles, was dieses Projekt deklariert, und ob die Umgebung es tatsächlich bindet:

```bash
rebase status               # every resource, and the variables it reads
rebase status --json        # machine-readable
```

```
  backend  ·  managed  Rebase's runtime boots your bundle
  declared in  backend/resources.ts
  configured by  .env

  buckets
  ✓ media  s3 · account:minio
      ✓ S3_BUCKET__MEDIA
      ✓ S3_ACCESS_KEY_ID__MINIO (shared, for S3_ACCESS_KEY_ID__MEDIA)
  ○ exports  s3
      · S3_BUCKET__EXPORTS not set
      └ declared, not configured — uploads here answer 501 STORAGE_SOURCE_NOT_CONFIGURED
```

Drei Dateien bestimmen, worauf ein Backend zugreifen kann, und dieser Befehl gibt alle drei zusammen aus: `rebase.json` gibt an, wo sich Ihr Code befindet und wer den Server betreibt, `backend/resources.ts` legt fest, was das Projekt benötigt, und die Umgebung bestimmt, wie die einzelnen Ressourcen erreichbar sind. Alles andere – `rebase.resources.json`, das Bundle-Manifest – wird für Leser, die Ihren Code nicht ausführen können, aus der mittleren Datei generiert und wird von Ihnen nie manuell geschrieben.

Ein `○` kennzeichnet den Zustand, den man besser vor als nach einem Deployment kennen sollte: deklariert, aber nicht konfiguriert. Ein `✗` bedeutet, dass die Umgebung etwas *falsch* konfiguriert hat, was den Start verweigert, anstatt in einen eingeschränkten Modus zu wechseln.

Eine `rebase.resources.json`, die nicht mehr mit den Deklarationen übereinstimmt, erhält eine `○`-Zeile. Eine Datei, die noch gar nicht geschrieben wurde, erhält keine: `rebase build` schreibt sie bei jedem Build neu, sodass bei einem Projekt, das noch nie gebaut wurde (wie einem frischen Scaffold), nichts behoben werden muss.

### `rebase resources`

Was dieses Projekt laut Deklaration benötigt – die Datenbanken, Buckets, Topics und Queues, die `backend/resources.ts` anfordert, sowie die Crons und Funktionen, die in seinen Dateien definiert sind:

```bash
rebase resources            # list them
rebase resources --write    # regenerate rebase.resources.json
rebase resources --check    # fail if the committed graph is stale
rebase resources --json     # machine-readable
```

`rebase resources --check` ist das Flag, das ein CI-Job verwendet, um bei einer `rebase.resources.json`, die nicht mehr zu `backend/resources.ts` passt, fehlzuschlagen. `--json` lässt sich damit kombinieren: Bei Abweichungen beendet sich `rebase resources --check --json` mit Exit-Code 1 und einer Fehler-Hülle (`resource_graph_missing` oder `resource_graph_stale`), und bei Erfolg enthält der Graph `check.status`. `--write --json` schreibt die Datei und meldet `written.changed`.

Eine Ressource wird in `backend/resources.ts` deklariert – `database("analytics")`, `bucket("media")`, `topic("signups")`, `queue("thumbnails")` – oder ist eine Datei unter `backend/crons` oder `backend/functions`, und wird niemals manuell in `rebase.resources.json` geschrieben. Letztere wird aus diesen Deklarationen generiert, damit ein Host auslesen kann, was ein Projekt benötigt, ohne es bauen zu müssen. Jeder Eintrag hält fest, wer die Ressource verwendet (`table:events`, `column:posts.cover`, `function:report`).

Ein Backend verfügt zudem über eine Standard-Datenbank und eine Standard-Speicherquelle, die niemand explizit deklariert. Beide werden hier mit der Kennzeichnung `implicit` aufgeführt, und keine von beiden wird in `rebase.resources.json` geschrieben – der Host stellt sie bereit; ein Eintrag würde also die Bereitstellung von etwas verlangen, das niemand angefordert hat. Das Deklarieren einer benannten Ressource wie `bucket("media")` belässt die Standardressource unverändert, sodass beide aufgeführt werden. Nur das Deklarieren der Standardressource selbst oder das Markieren eines Buckets mit `default: true` ersetzt diese.

Um zu sehen, was die Plattform für ein Projekt im Vergleich zu den Code-Deklarationen vorhält, und um eine bereitgestellte Datenbank zu entfernen, die der Code nicht mehr nennt, siehe [`rebase cloud resources`](/docs/cli/cloud#resources).

`rebase cloud` – alle Befehle für Rebase Cloud: Authentifizierung, Projektverknüpfung, Deployments, Konfiguration, Datenbanken, Ressourcen, Compute und mehr – hat [eine eigene Seite](/docs/cli/cloud).

### `rebase generate-sdk`

```bash
rebase generate-sdk
```

Schreibt einen typisierten Client für die Tabellen, die `backend/schema/index.ts` exportiert, nach `generated/sdk/`, mit `TableName` und `tablesDictionary`; `--from <link|url>` liest stattdessen den Vertrag eines laufenden Backends. `--register` typisiert zusätzlich serverseitige Daten: Es schreibt die Typen und die `Register`-Deklaration nach `backend/generated/` und vermerkt dies in `rebase.json` (`registerDatabase`). Siehe [Typisierte serverseitige Daten](/docs/backend/typed-server-data) und [Schemagenerierung](/docs/cli/schema/#rebase-generate-sdk).

### `rebase doctor`

```bash
rebase doctor
```

Der Befehl, den man ausführt, wenn etwas nicht stimmt und man noch nicht weiß, woran es liegt. Er liefert Berichte und nimmt keinerlei Änderungen vor, sodass er gefahrlos auf jede erreichbare Datenbank angewendet werden kann.

**Ohne Datenbank.** Diese Prüfungen laufen zuerst ab, da alles, was ein Projekt komplett am Starten hindert, auftritt, bevor eine Tabelle verglichen werden kann:

| Prüfung | Grund |
| --- | --- |
| Node version | Prüft gegen den von der CLI deklarierten Versionsbereich. Eine veraltete Version wird nicht als „nicht unterstütztes Node“ gemeldet – sie äußert sich als Syntaxfehler innerhalb einer Abhängigkeit. |
| Package managers | Zwei Lockdateien in einem Projekt. `npm install` in einem pnpm-Workspace schreibt `node_modules` in ein Layout um, mit dem pnpm nicht kompatibel ist, und das Symptom ist Stunden später `Cannot find module`. |
| Duplicate slugs | Zwei Tabellen deklarieren denselben Slug. Das Schema lässt sich damit nicht kompilieren, und diese Prüfung nennt beide. |
| `.env` sanity | Ein `JWT_SECRET` mit weniger als 32 Zeichen (womit die Produktionsumgebung den Start verweigert) und `NODE_ENV=production` ohne `CORS_ORIGINS` oder `FRONTEND_URL`. Werte werden niemals ausgegeben. |
| `@rebasepro/*` version skew | Dasselbe Paket ist in verschiedenen `package.json`-Dateien des Projekts auf unterschiedliche Versionen festgelegt. Zwei Kopien brechen das Zusammenspiel mit `instanceof`, was dazu führt, dass ein Type Guard seinen eigenen Typ ablehnt. |
| Connection strings | Ein unkodiertes `=` in einem URL-Parameter, dessen Parsing die PostgreSQL-eigenen Tools verweigern – sodass Backups und `psql` fehlschlagen, während die App weiterläuft. |
| Custom functions | Was jede Funktion von ihrem Host benötigt und welche davon nicht auf einer Edge-Runtime laufen würden. |

**Gegen die Datenbank** – die projekteigene Datenbank, aufgelöst wie bei `rebase db url`; bei einem frischen Scaffold ist dies die verwaltete Datenbank, die von `doctor` gestartet wird:

| Prüfung | Grund |
| --- | --- |
| Tables → generated schema | Ob `schema.generated.ts` veraltet ist. |
| Tables → database | Fehlende Tabellen, Spalten, Enums, Fremdschlüssel und Zwischentabellen (Junctions). |
| Required extensions | Eine `col.vector()`-Spalte benötigt pgvector, was Rebase nur dort installiert, wo ein Projekt dies deklariert hat. |
| Schema stamp | Ob diese Datenbank aus diesen Tabellen bereitgestellt wurde. Ein Hashwert, der mitteilt, dass beide nicht übereinstimmen, aber nie, welcher Stand weiter fortgeschritten ist. Ein `v1:`-Stempel aus einer Runtime vor 0.31 wird einmal gemeldet, zusammen mit dem Befehl zur Aktualisierung des Stempels: `rebase db push`. |
| Tables → SDK types | Ob das generierte typisierte SDK veraltet ist. |
| RLS policies | Ob die Policies der Datenbank mit dem von Ihnen deklarierten `rls` übereinstimmen und ob eine Policy eine Rolle nennt, die dieser Server nicht verwenden kann. |

Ist die Datenbank nicht erreichbar, werden die entsprechenden Phasen mit Begründung als übersprungen gemeldet, und der Rest wird trotzdem ausgeführt – siehe [Fehlerbehebung](/docs/troubleshooting/).

Beendet sich mit einem Exit-Code ungleich null, wenn eine Prüfung einen Fehler findet oder wenn eine Phase nicht ausgeführt werden konnte, weil die angegebene Datenbank Verbindungen verweigert. Eine Phase, die übersprungen wurde, weil keine Datenbank aufgelöst werden konnte, gilt nicht als Fehler.

`rebase doctor --policies` führt nur die RLS-Prüfungen aus – kein Schema-Diff, keine SDK-Typen – und schlägt im Zweifel fehl (fails closed), was es zur idealen Variante für ein CI-Gate gegen eine deployte Datenbank macht.

`rebase doctor --database` führt nur den Datenbank-Preflight aus: ob die Rolle, unter der authentifizierte Anfragen laufen, existiert, eingeschränkt ist und zu ihr gewechselt werden kann, welche anderen Logins zu ihr wechseln können, ob sich jede Rolle verbinden darf und welche Tabellen, Grants und Policies Rebase mit anderen Rollen teilen würde. Jeder Befund nennt das SQL, das als Administrator auszuführen ist, die `rls`-Einstellung, die Rebase stattdessen an die Datenbank anpasst, oder beides. Der Befehl liest den Systemkatalog, ändert nichts und beendet sich mit 1, wenn ein Befund einen Fehler darstellt. Er funktioniert auch bei einem Headless-Projekt. Siehe [Ausführung auf einer bestehenden oder geteilten Datenbank](/docs/deployment/existing-database/).

### `rebase verify`

```bash
rebase verify
rebase verify --json
rebase verify --live
rebase verify --live --database-url postgresql://…
```

Prüft in einem schnellen Befehl für CI und für Hooks von KI-Agents, ob die Tabellen bereit für den Produktiveinsatz sind. Standardmäßig offline und ändert niemals etwas.

| Schritt | Was zum Fehlschlagen führt |
| --- | --- |
| Table definitions (`schema`) | `backend/schema` lädt nicht oder kompiliert nicht über den Loader, aus dem das Backend bootet: eine Relation zu einer Tabelle, die der Index nicht exportiert, `rls: "inherit"` ohne `defaultRls`, eine Tabelle ohne Primärschlüssel – ein Befund pro Problem. Eine Tabelle ohne `rls` ist einer davon. |
| RLS coverage (`rls`) | Eine Tabelle mit einer Spalte `user_id`, `owner_id`, `organization_id` oder `tenant_id`, deren Regeln – ihre eigenen oder das geerbte `defaultRls` – einer Rolle erlauben, ungeachtet dessen jede Zeile zu lesen. Eine Warnung. `rls-policy-recursion`: eine Regel, die ihre eigene Tabelle in einer Unterabfrage liest, oder zwei Tabellen, deren Regeln sich gegenseitig lesen, was Postgres nicht auflösen kann, sodass jedes dadurch geschützte Statement mit `42P17 infinite recursion detected in policy` fehlschlägt; der Befund nennt die gelesene Tabelle und den Fix (Auslagern des Lesevorgangs in eine `SECURITY DEFINER`-Funktion). Ein Fehler bzw. eine Warnung, wenn die Rekursion nicht eindeutig feststeht. |
| Migration freshness (`migrations`) | Eine von den Tabellen deklarierte Tabelle oder Spalte, die von keiner Datei in `backend/drizzle/migrations` erstellt wird, oder eine entfernte Tabelle/Spalte, die eine Migration weiterhin erstellt. Wird für Projekte übersprungen, die noch keine Migrationen haben. |
| CMS customizations (`cms`) | Ein `customizeTable(...)` in `frontend/src/cms` (oder im `src/cms` einer statischen App in `rebase.json`), das nicht mit den Tabellen übereinstimmt, statisch gelesen – die Module werden nicht ausgeführt. `cms-unknown-table`: Der Slug nennt keine Tabelle, daher ignoriert das Panel ihn (der ähnlichste Slug wird vorgeschlagen). `cms-unknown-field`: Ein Schlüssel unter `fields` ist weder eine Spalte noch eine Relation (der SQL-Name einer Spalte wird mit ihrem Schlüssel beantwortet). `cms-hidden-required`: Ein im Formular ausgeblendetes Feld (`hiddenInForm`, `readOnly`, `disabled`), dessen Spalte `NOT NULL` ohne Standardwert ist und vom Server nicht befüllt wird, sodass das Erstellen eines Datensatzes über das Panel immer fehlschlägt; eine Warnung, wenn ein `beforeSave`-Hook oder eine Transformation es befüllen könnte, und stummgeschaltet durch `filledByServer`. `cms-duplicate-customization`: Ein Slug wurde doppelt angepasst. `cms-not-static` (eine Warnung): Ein Aufruf, dessen Slug, Optionen oder `fields` keine Literale oder `const` aus derselben Datei sind, sodass darin nichts geprüft werden konnte. `cms-ui-config-not-mounted` (eine Warnung): `frontend/src/cms/ui-config.json` existiert, wird aber `<RebaseCMS>` nicht als `uiConfig` übergeben. `cms-backend-guard-missing`: Die Vite-Konfiguration des Frontends verwendet `rebaseBackendGuard()` nicht, weshalb `rebase build` dies verweigern würde. Ein Headless-Projekt besitzt kein `frontend/src/cms` und überspringt diesen Schritt. |
| Live RLS audit (`live`) | Mit `--live`: der [`rls-check`](/docs/rls-check)-Katalog gegen die Datenbank des Projekts und die Prüfung, ob jede Migration angewendet wurde. Die Datenbank wird so aufgelöst wie bei den `db`-Befehlen – `--database-url`, `DATABASE_URL`, `--docker`, andernfalls die verwaltete Entwicklungsdatenbank. Eine Datenbank, die nicht konfiguriert ist oder nicht antwortet, führt zu einem Fehler, nicht zu einem Überspringen: Das Audit wurde explizit angefordert. Eine aus einer `access: "public"`-Regel kompilierte `USING (true)`-Lese-Policy ist eine Warnung, solange die API ein Token erfordert (`AUTH_REQUIRE`, standardmäßig aktiv) – jeder angemeldete Benutzer liest jede Zeile – und ein Fehler bei `AUTH_REQUIRE=false`, wo die Zeilen anonym zugänglich sind. |

`--json` gibt ein einzelnes Objekt aus: `{ ok, schemaDir, steps, findings, summary }`. Jeder Schritt ist `{ id, title, status, detail? }` (`status` ist `passed`, `failed`, `warnings` oder `skipped`), und jeder Befund enthält `step`, `check` (ein stabiler Typ in Kebab-Case), `severity`, `message` und, sofern zutreffend, `fix`, `table`, `file`, `line` sowie den punktierten `path` in die Tabelle (`posts.rls[0]`) – sodass ein Agent reparieren kann, was er beschädigt hat. `summary` zählt `errors` und `warnings`. `--quiet` gibt nichts aus, wenn alles erfolgreich durchläuft. Beendet sich bei einem Fehler mit einem Exit-Code ungleich null; Warnungen führen nicht zum Fehlschlagen.

Ein über Scaffolding erstelltes Projekt führt dies für Claude Code nach jeder Änderung unter `backend/schema/` aus: siehe [`rebase skills install`](#rebase-skills-install).

### Befehle für eine laufende App

`rebase api`, `rebase data`, `rebase users`, `rebase cron`, `rebase logs`, `rebase functions`, `rebase rls simulate`, `rebase auth login` und `rebase storage ls|cp|rm|url|stat` interagieren über deren API mit einer laufenden App: dem lokalen `rebase dev`, einem über `--url` angegebenen Server oder einem Rebase-Cloud-Projekt mit `--project`. Siehe [Eine laufende App](/docs/cli/project/).

### `rebase auth`

Befehle zur Authentifizierungsverwaltung:

```bash
rebase auth reset-password --email admin@example.com --password NewPassword123!
```

### `rebase api-keys`

Verwalten Sie die Service-API-Schlüssel des Projekts – die Anmeldeinformationen, die ein Agent, Skript oder ein anderer Dienst im Gegensatz zur Sitzung eines Endbenutzers verwendet:

```bash
rebase api-keys list
rebase api-keys get abc123-def456
rebase api-keys create --name "Blog CI" --scopes data:read:posts,data:write:posts --expires-in 90
rebase api-keys create --name "Ops" --full-access --roles admin --expires-at 2027-01-31
rebase api-keys revoke abc123-def456
```

`--scopes` benennt kommagetrennt oder wiederholt, was der Schlüssel tun darf; `--full-access` gewährt ihm jeden Scope, den der Service-Schlüssel besitzt, mit Ausnahme von `keys:*`. `--roles` fügt RLS-Rollen neben `service` hinzu, `--expires-in` akzeptiert Tage und `--expires-at` ein ISO-Datum. `rebase api-keys scopes` listet jeden Scope auf, den das Backend kennt. Ein Schlüssel wird nur einmal angezeigt. Sowohl die Scopes des Schlüssels als auch die Row-Level Security der Identität, als die er agiert, finden Anwendung. Siehe [API-Schlüssel](/docs/backend/api-keys/).

### `rebase storage`

Speicherweite Wartung gespeicherter Dateien über das laufende Backend mit `REBASE_SERVICE_KEY` aus `.env`:

```bash
rebase storage orphans                         # files no row names
rebase storage orphans --source media --delete # and delete them, after asking
rebase storage move --from "(default)" --to media --prefix avatars
rebase storage move --from "(default)" --to media --prefix avatars --delete-source
```

`orphans` liest jede Zeile jeder Tabelle so, wie sie gespeichert ist (einschließlich als gelöscht markierter (soft-deleted) Zeilen und unter Umgehung jedes `beforeQuery`- und `afterRead`-Hooks) sowie jeden [Historien-Eintrag](/docs/backend/history/), da ein Revert dessen Inhalt wiederherstellt. Es listet die Dateien einer Speicherquelle auf (`--source`, standardmäßig die Standardquelle), die von keiner Zeichenkette in diesen Datensätzen referenziert werden: weder als Schlüssel, URL noch als `rebase-storage:`-Referenz in einem Text. Dateien, die neuer als `--older-than` Stunden sind (standardmäßig 24), werden ausgelassen, da das Admin-Panel eine Datei hochlädt, bevor die Zeile, die sie referenziert, gespeichert wird. Der Scan läuft im Backend im Hintergrund, sodass auch ein Projekt fertiggestellt werden kann, das zu groß ist, um innerhalb einer einzelnen Anfrage geprüft zu werden (hinter einem Ingress mit Timeout). Die CLI startet den Scan und zeigt dann dessen Fortschritt an (aufgelistete Dateien, gelesene Zeilen, abgeschlossene Tabellen und eventuell nicht lesbare), bis er beendet ist. Bei aktivierter [Job-Queue](/docs/backend/jobs/) ist der Scan ein `storage.orphans`-Job, den die Job-Worker ausführen. Ohne Queue läuft der Scan innerhalb des angefragten Serverprozesses, worauf die CLI hinweist: Ein Neustart dieses Prozesses bricht den Scan ab. Ein Scan ist ein Job-Versuch, begrenzt durch `jobs.timeoutMs` (standardmäßig 15 Minuten). Erhöhen Sie diesen Wert oder setzen Sie ihn auf 0 für Quellen, die mehr Zeit benötigen. `--json` gibt denselben Bericht wie zuvor aus, ergänzt um dessen `scanId`.

`--delete` fragt vor dem Löschen nach (`--yes` überspringt die Abfrage und ist ohne Terminal erforderlich). Es löscht nur Dateien aus dem soeben ausgegebenen Scan und nur innerhalb von 15 Minuten nach dessen Abschluss. Es wird nichts gelöscht, solange eine Tabelle nicht gelesen werden kann: Eine Tabelle mit Read-Hooks auf einer Datenbank, deren Treiber diese Hooks nicht umgehen kann, gilt als ungelesen. Vor jedem Löschvorgang liest der Server jede Zeile und jeden Historien-Eintrag erneut im Abgleich mit den aufgelisteten Dateien. Anschließend fragt er jede Datei unmittelbar vor dem Löschen erneut ab. Eine Datei, die inzwischen von einer Zeile referenziert wird, seit dem Scan erneut hochgeladen wurde oder nicht mehr existiert, wird behalten, und die CLI führt sie als behalten auf. Dateien, die ausschließlich von Tabellen referenziert werden, die Rebase nicht bereitstellt, wirken ungenutzt: Prüfen Sie dies vor dem Löschen. Bei einem Backend der Version 0.25.1 oder älter führt die CLI den Scan auf die alte Weise innerhalb einer einzigen Anfrage durch.

`move` kopiert die Dateien unter `--prefix` seitenweise unter denselben Schlüsseln in eine andere Quelle. Eine Datei, die am Zielort bereits in identischer Größe vorhanden ist, wird übersprungen, sodass ein unterbrochener Verschiebevorgang durch erneutes Ausführen fortgesetzt werden kann; `--delete-source` löscht jede Datei aus der Quelle, sobald das Ziel sie enthält, und wird verweigert, wenn beide Quellen denselben Bucket oder dasselbe Verzeichnis verwenden. Sobald der Verschiebevorgang abgeschlossen ist, durchsucht die CLI die Quelle erneut und nennt jede Datei, die nicht verschoben wurde: mit `--delete-source` jede Datei, die sich noch in der Quelle befindet; ohne dieses Flag jede Datei, von der am Zielort keine Kopie identischer Größe existiert. Werden solche Dateien gefunden, beendet sich der Befehl mit Exit-Code 1; ein erneuter Aufruf greift diese Dateien wieder auf. `--json` gibt sie als `notMoved` aus. Das Lesen eines Scan-Berichts erfordert `database:read`. Das Starten eines Scans, Löschen und Verschieben erfordert `database:write`, worüber der Service-Schlüssel verfügt.

### `rebase skills install`

Installieren Sie die Rebase-Referenz-Skills für Ihre KI-Coding-Assistenten – für jeden oben genannten `--agent`:

```bash
rebase skills install
rebase skills install --agent claude,cursor
rebase skills install --agent all
rebase skills --hooks
```

Siehe [Agent-Skills](/docs/ai/skills) für die vollständige Liste und den Speicherort der Dateien.

`--hooks` installiert die Schutzfunktion (Guardrail) für Claude Code, die `rebase init` mit jedem Projekt ausliefert: `.claude/hooks/post-edit-collection.sh`, registriert als `PostToolUse`-Hook in `.claude/settings.json`. Dieses Skript führt nach jeder Änderung unter `backend/schema/` oder `frontend/src/cms/` den Befehl `rebase verify --quiet` aus und übergibt eventuelle Probleme an den Agent zurück. Bestehende Einstellungen und Hooks bleiben erhalten. `rebase skills --hooks` installiert nur diesen Hook.

### `rebase telemetry`

Anonyme Übermittlung von Nutzungsdaten, deaktiviert, bis Sie zustimmen. Ein interaktives `rebase init` fragt am Ende nach, und die Standardantwort lautet Nein; es wird also nichts geteilt, es sei denn, Sie stimmen ausdrücklich zu. Die Entscheidung gilt pro Rechner (`~/.rebase/telemetry.json`): Nach einem Ja fragt `init` nie wieder nach, nach einem Nein fragt das nächste `init` erneut. Jedes Checkout erhält eine zufällige Projekt-ID, die in der gitignorierten `.rebase/telemetry-project.json` gespeichert wird.

```bash
rebase telemetry status
rebase telemetry show
rebase telemetry enable
rebase telemetry disable
```

`status` gibt die aktuelle Einstellung aus, `show` zeigt exakt, was gesendet werden würde – unabhängig davon, ob die Datenübermittlung aktiviert ist, sodass Sie die Nutzlast vor Ihrer Entscheidung prüfen können –, und die anderen beiden Befehle ändern die Einstellung. Wenn Sie `init` nie ausgeführt haben, wurden zu keinem Zeitpunkt Daten erfasst.

## Nächste Schritte

- **[Schemagenerierung](/docs/cli/schema/#production-workflow)** — Der Migrations-Workflow, von der Tabellenbearbeitung bis zur Produktion
- **[Schema as Code](/docs/architecture/schema-as-code)** — Wie die Schemagenerierung funktioniert
- **[Schnellstart](/docs/getting-started/quickstart)** — Erste Schritte
