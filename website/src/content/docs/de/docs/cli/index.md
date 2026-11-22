---
sourceHash: c5b8a13884254638
title: CLI-Referenz
sidebar_label: CLI
description: Rebase-CLI-Befehle für Projektinitialisierung, Schema-Generierung, Datenbankmigrationen und SDK-Generierung.
---

## Übersicht

Die Rebase-CLI (`rebase`) verwaltet Ihr Projekt vom Scaffolding bis zum Deployment.

## Installation

```bash
pnpm add -g @rebasepro/cli
```

Oder führen Sie einen beliebigen Befehl ohne Installation aus: `pnpm dlx @rebasepro/cli <command>`.

## Maschinenlesbare Ausgabe

`--json` ist die entsprechende Option, und außerhalb der `cloud`-Befehlsgruppe ist es die einzige: `rebase status`, `rebase resources`, `rebase apps list`, `rebase upgrade` und `rebase verify` geben dann bei **jedem** Beenden des Befehls einen einzelnen JSON-Wert auf stdout aus — das Ergebnis oder ein `{"error": {"message", "code", "hint", "issues"}}`-Envelope mit einem Exit-Code ungleich null —, sodass ein aufrufender Prozess stdout bedingungslos parsen kann. Ohne diese Option wird menschenlesbarer Text ausgegeben und Fehler gehen nach stderr. `rebase cloud` verwendet denselben Envelope und ist die einzige Ausnahme: Es schaltet JSON auch automatisch ein, wenn stdout kein TTY ist oder wenn `REBASE_JSON=1` gesetzt ist. Daher liefert `rebase cloud status | cat` JSON, während `rebase status | cat` dies nicht tut — übergeben Sie in einem Skript explizit `--json`, anstatt sich auf eine der Regeln zu verlassen.

## Befehle

### `rebase init`

Initialisiert ein neues Rebase-Projekt:

```bash
rebase init [directory]
```

Richtet ein `backend/` (die Tabellen in `backend/schema/`) und ein `frontend/` (das Admin-Panel mit seinen Tabellenanpassungen in `frontend/src/cms/`) ein; `--headless` scaffoldet ausschließlich das `backend/`, ohne `backend/schema/`. [Projektstruktur](/docs/getting-started/project-structure/) zeigt beide Verzeichnisbäume.

| Flag | Funktion |
|---|---|
| `-t, --template <preset>` | `blog`, `ecommerce` oder `blank`. Standard ist `blog` |
| `--headless` | Nur Backend — kein Admin-Panel und kein `backend/schema/`: Der Server bedient die tabelleneigenen Strukturen der Datenbank. `--template` hat keine Auswirkung, da keine Tabellen für Seeds vorhanden sind |
| `-y, --yes` | Keine interaktiven Abfragen. **Erforderlich überall dort, wo kein Terminal zum Antworten vorhanden ist**, wie z. B. in CI-Umgebungen. Überspringt Git-Initialisierung und Abhängigkeitsinstallation — die interaktiven Standardwerte bejahen beides; übergeben Sie also `--git` / `--install`, falls gewünscht |
| `-i, --install` | Installiert Abhängigkeiten nach dem Scaffolding. Ohne Flag fragt init nach (Standard: Ja); unter `--yes` wird nichts installiert |
| `--no-install` | Nichts installieren und nicht nachfragen |
| `-g, --git` | Initialisiert ein Repository und erstellt den ersten Commit. Ohne Flag fragt init nach (Standard: Ja); unter `--yes` wird kein Repository erstellt |
| `--database-url <url>` | Verwendet eine bestehende Datenbank anstelle der verwalteten. Es muss eine `postgres://`- oder `postgresql://`-URL sein: Alles andere wird abgelehnt, bevor eine Datei geschrieben wird, und die interaktive Abfrage fragt erneut nach |
| `--introspect` | Erzeugt `backend/schema` aus dieser Datenbank. Impliziert `--template blank` und erfordert `--install` |
| `--project <slug>` | Verknüpft das Scaffold mit einem Rebase-Cloud-Projekt |
| `--setup-key <key>` | Der Einmalschlüssel zur Authentifizierung dieser Verknüpfung |
| `-a, --agent <name>` | Richtet KI-Coding-Agents ein: die [Skills](/docs/ai/skills) und den [MCP-Server](/docs/ai/mcp). Wiederholbar oder kommagetrennt — `claude`, `cursor`, `windsurf`, `gemini`, `codex`, `kiro`, `copilot` oder `all`. Ohne Flag fragt `init` nach und wählt auf dem System installierte Agents vorab aus; unter `--yes` werden keine eingerichtet |

### `rebase dev`

Startet den Entwicklungsserver:

```bash
rebase dev
```

Startet sowohl Frontend als auch Backend mit Hot-Reloading und generiert das Drizzle-Schema sowie die SDK-Typen (`generated/sdk/`) beim Start und bei jedem Speichervorgang unter `backend/schema/` neu.

Beide Ports werden aus dem Projektpfad abgeleitet, sodass mehrere Rebase-Projekte parallel laufen können. Verwenden Sie die URLs, die `rebase dev` ausgibt. Legen Sie einen festen Port fest mit `rebase dev --port 3001`.

Eine statische App in `rebase.json` ohne Build-Schritt (kein `build`, und `output` entspricht ihrem `root`, wie etwa eine reine HTML-Website) wird vom Backend aus diesem Verzeichnis unter ihrem `path` bereitgestellt — genau wie `rebase start` sie aus dem Bundle bereitstellt. `FRONTEND_URL` wird darauf gesetzt (auf dem Port des Backends), damit per E-Mail versendete Links dorthin führen.
<span class="since-badge" data-since="0.35">Seit 0.35</span> Ihre [`redirects` und `cleanUrls`](/docs/architecture/redirects-and-clean-urls/) werden ebenfalls bedient, und eine App, die Redirects deklariert, benötigt keine `index.html`.
Eine App mit Build-Schritt läuft in Vite auf einem eigenen Port, und `FRONTEND_URL` entspricht dem Vite-Port.

Eine Änderung an `.env` startet das Backend neu, welches die Datei erneut einliest, ebenso wie das Admin-Panel. Werte, die `rebase dev` selbst setzt, bleiben bis zum Neustart erhalten: `PORT` sowie `DATABASE_URL`, wenn die verwaltete Datenbank oder Docker genutzt wird.

Mit `--database-url` prüft `rebase dev` zuerst, ob unter diesem Host und Port ein Dienst antwortet. Falls nicht, wird dies unter Nennung des Flags gemeldet und der Befehl mit Code `1` beendet, ohne dass etwas gestartet wurde; die Datenbankvariablen in `.env` bleiben unberührt und der Compose-Container wird nicht gestartet.

### `rebase build`

Baut das Projekt in ein deploybares Bundle in `dist-bundle/`:

```bash
rebase build
```

Das Bundle ist das Artefakt, das Sie deployen — das Runtime-Image lädt es, sodass Sie kein eigenes Anwendungs-Image bauen müssen. Nützliche Flags:

| Flag | Wirkung |
|------|---------|
| `--output <dir>` (oder `--out`) | Schreibt das Bundle an einen anderen Ort als `dist-bundle/` (jeweils eine App auf einmal) |
| `--vendor` | Installiert und liefert Abhängigkeiten des Bundles immer mit |
| `--no-vendor` | Niemals vendoren; der Pod installiert sie bei jedem Start |
| `--skip-type-check` | Überspringt die Typüberprüfung (schneller, weniger sicher) |
| `--no-static` | Das Frontend nicht in das Backend-Bundle einbinden (jede statische App erhält weiterhin ihr eigenes Bundle) |
| `--skip-static-build` | Bindet das Frontend im bereits gebauten Zustand ein, ohne dessen Build-Befehl auszuführen |

Ein Frontend — jede statische App in `rebase.json` mit einer Vite-Konfiguration —, dessen Konfiguration nicht `rebaseBackendGuard()` (aus `@rebasepro/app/vitePlugin`) verwendet, wird abgewiesen: Dies verhindert, dass Server-Code in das Browser-Bundle gelangt und dass Vite eine Backend-Datei als `data:`-URL inlined (der Build schlägt fehl und meldet sich selbst, wenn ein anderes Plugin sein `build.assetsInlineLimit` überschreibt). `frontend/src/cms/ui-config.json` wird als `entry.uiConfig` in das Bundle übernommen — die Workspace-Präsentation, die ein deploytes Backend ausliefert.

Abhängigkeiten werden standardmäßig gevendort, damit eine neue Instanz nicht 35–55 Sekunden Installationszeit benötigt. Ein Verzeichnisbaum, der auf der Festplatte mehr als 2 GB einnimmt, wird stattdessen verworfen, da das Upload-Limit komprimiert 1 GB beträgt.

Jede statische App, die das Bundle enthält, erhält neben jedem inhalts-gehashten Asset ab 1 KB — also Dateien, die ein Browser ein Jahr lang zwischenspeichert — eine Brotli- (`.br`) und eine Gzip-Kopie (`.gz`). Die Runtime liefert die Variante aus, die der Browser akzeptiert, sodass diese Dateien pro Anfrage keine Komprimierungsarbeit erfordern (inklusive des ersten Besuchs nach einem Deployment). Browser mit Brotli-Unterstützung erhalten diese Variante (etwa 11 % kleiner als Gzip beim JavaScript des Admins). Die Build-Ausgabe Ihres Frontends bleibt unverändert; nur die Kopie im Bundle ändert sich. Bei der Beispiel-App verlängert dies den Build um weniger als eine Sekunde und vergrößert das Bundle um etwa 2,4 MB.

### `rebase upgrade`

Aktualisiert jedes im Projekt festgelegte `@rebasepro/*`-Paket auf ein einheitliches Release und führt anschließend eine Installation mit dem im Lockfile angegebenen Paketmanager durch. `rebase upgrade` wählt die Version `latest`; `--to 0.21.0` eine exakte Version ohne Registry-Lookup; `--to canary` ein Dist-Tag. Jeder Eintrag in `dependencies`, `devDependencies` und `optionalDependencies` in jeder `package.json` des Projekts behält sein `^` oder `~`, und nichts anderes in der Datei ändert sich. `peerDependencies` sowie `workspace:`, `link:`, `file:`, Git- und Tag-Spezifikationen werden aufgelistet und unberührt gelassen. Overrides in `pnpm-workspace.yaml` und `package.json` werden ebenfalls aktualisiert, aber ein `link:`- oder `file:`-Override hat Vorrang vor jeder Pinning-Regel: Dies wird gemeldet, und `--drop-local-overrides` entfernt ihn. `--dry-run` schreibt nichts, `--no-install` überspringt die Installation und `--json` gibt ein einzelnes Dokument aus.

Ein Projekt auf einem Prerelease (wie etwa Canary) bleibt auf diesem Kanal, es sei denn, `latest` ist neuer. Ein Dist-Tag, das eine Version zurücksetzen würde, wird abgewiesen (`downgrade_refused` unter `--json`), es sei denn, Sie übergeben `--allow-downgrade`; ein exaktes `--to` wird angewendet und als Downgrade gekennzeichnet. Ein `--dry-run` eines Upgrades, das die tatsächliche Ausführung ablehnen würde, zeigt die potenziellen Änderungen an und beendet mit Code 0; unter `--json` enthält das Dokument die Ablehnung als `wouldRefuse` (`{ code, message, hint }`).

### `rebase start`

Führt das gebaute Bundle so aus, wie es bei einem Deployment ausgeführt wird:

```bash
rebase start
```

Liest im Gegensatz zu `rebase dev` `PORT` und den Rest von `.env` in dem dort definierten `NODE_ENV` ein. Eine erzeugte `.env` enthält standardmäßig `development`, sodass der erste registrierte Account weiterhin zum Admin wird — `rebase start` weist zu Beginn darauf hin. Setzen Sie `NODE_ENV=production` für einen Produktionsserver. `rebase start --bundle ./dist-bundle` führt ein Bundle an einem anderen Pfad aus.

`rebase start` startet keine Datenbank, und die `.env` des Scaffolds enthält kein `DATABASE_URL`. Eine lokale Ausführung mit der Datenbank, die `rebase dev` nutzt, lautet daher:
`DATABASE_URL="$(rebase db url)" rebase start`.
Fehlt die Variable, wird diese Zeile vor dem Booten ausgegeben.

### `rebase apps list`

Zeigt die Apps an, die dieses Repository deklariert:

```bash
rebase apps list
```

Ein Repository kann mehr als eine deploybare App deklarieren — beispielsweise ein Backend und eine Marketing-Website. Damit sehen Sie, worauf sich `rebase build` und das Deployment auswirken.

### `rebase eject`

Übergibt die vollständige Kontrolle über den Serverprozess und dessen Image an Sie:

```bash
rebase eject
```

Schreibt den Backend-Einstiegspunkt und ein `Dockerfile` in das Projekt und stellt das Backend um, sodass das Repository sein eigenes Image baut, anstatt die vorgefertigte Runtime auszuführen. Ab diesem Zeitpunkt **greifen Runtime-Upgrades der Plattform nicht mehr**, und CORS, Auth-Verdrahtung, Storage sowie Shutdown-Handling müssen von Ihnen selbst konfiguriert werden.

Mit `rebase eject --dry-run` erhalten Sie eine Vorschau aller potenziellen Änderungen, ohne dass etwas modifiziert wird. `--force` überschreibt eine bestehende `backend/src/index.ts` oder `env.ts` und behält die aktuelle Datei als `<name>.bak` bei.

Der ejected Server behält lokale Uploads im `uploads/`-Verzeichnis des Projekts bei, egal ob aus dem Quellcode oder kompiliert ausgeführt, genau wie `rebase dev`. Er läuft in `backend/`, sodass ein relativer `STORAGE_PATH` dort von `backend/` aus aufgelöst wird.

### `rebase schema generate` / `rebase schema stale`

```bash
rebase schema generate       # backend/schema → backend/src/schema.generated.ts
rebase schema stale          # meldet Abweichungen von den Tabellen, beendet mit Exit 1 bei Differenzen
rebase schema stale --fix    # generiert die Datei stattdessen neu
```

Jeder Befehl, der das Schema liest, akzeptiert `--schema-dir <dir>` für Projekte, die es an einem anderen Ort aufbewahren; `--collections` wurde entfernt. `rebase dev` hält die Datei aktuell, sodass `stale` die Prüfung für einen Build oder CI darstellt. Siehe [Schema-Generierung](/docs/cli/schema/).

### `rebase db`

```bash
rebase db push                 # wendet die Tabellen auf die Datenbank an (Entwicklung)
rebase db generate             # schreibt eine SQL-Migrationsdatei
rebase db migrate              # wendet ausstehende Migrationen an
rebase db url                  # gibt den Connection-String aus, den dieses Projekt nutzt
rebase db pull --from <url>    # kopiert eine andere Datenbank in die lokale
rebase db backup               # pg_dump; db backups list und db restore stehen ebenfalls bereit
rebase db branch create <name> # eine Arbeitskopie erstellen; switch, list und prune ebenfalls verfügbar
rebase db stop                 # stoppt die verwaltete Entwicklungsdatenbank
rebase db reset                # löscht sie und beginnt von vorn
rebase db request-role migrate --to <role> # verlagert Anfragen auf eine andere Postgres-Rolle
rebase db provision --print    # gibt das SQL zur Einrichtung der Request-Rolle aus (für DBAs)
```

Jeder Befehl wird unter [Datenbank-Befehle](/docs/cli/database/) beschrieben, einschließlich der Reihenfolge, in der ein Befehl seine Datenbank auswählt; `push`, `generate` und `migrate` werden unter [Schema-Generierung](/docs/cli/schema/) ausführlich behandelt.

### `rebase console`

Eine Node-REPL mit geladenen Projektdaten oder ein einzelnes Snippet, das mit `-e` ausgeführt wird:

```bash
rebase console
rebase console -e "rebase.dataAsAdmin.posts.find({ limit: 5 })"
```

`rebase` (`dataAsAdmin`, `sql`, `withAuth(user)`) und `tables` (die Tabellen des Projekts, geladen aus `backend/schema`) befinden sich im Scope, und Top-Level-`await` wird unterstützt. Die Datenbank wird wie bei `rebase db push` aufgelöst, und das Öffnen der Konsole nimmt keine Änderungen an ihr vor. Mit `-e` wird das per `await` abgewartete Ergebnis als JSON auf stdout ausgegeben, und eine Exception führt zum Exit-Code `1`. Flags: `--eval`/`-e`, `--schema-dir`, `--database-url`, `--docker`. Siehe [Skripte und die Konsole](/docs/backend/scripts/).

### `rebase migrate`

Einweg-Migrationen für Strukturen, die von dieser Version nicht mehr unterstützt werden:
`rebase migrate collections-to-tables` (`config/collections` → `backend/schema` und `frontend/src/cms`) und `rebase migrate sdk-calls` (`data.collection("x")` → `data.table("x")` in Ihrem eigenen Code). Deren Flags, die geschriebenen Dateien und der Abschnitt „Vor dem Deployment prüfen“ finden sich unter [Schema-Generierung](/docs/cli/schema/#rebase-migrate).

### `rebase apps init` / `rebase apps config`

```bash
rebase apps list             # die von diesem Projekt deklarierten Apps
rebase apps init             # schreibt eine aus diesem Projekt abgeleitete rebase.json
rebase apps config <app>     # die Client-Konfiguration für eine App
```

`apps init` akzeptiert keinen Namen: Es leitet alle Apps aus dem Projekt ab, schreibt die gesamte `rebase.json` und verweigert das Überschreiben einer existierenden Datei, sofern nicht `--force` übergeben wird.

Ein Namensargument wird abgelehnt. `--force` behält Werte bei, die durch automatische Erkennung nicht ermittelt werden können: den Namen jeder App, ihren `path` und ihre `cms`-Route. Alles andere wird neu abgeleitet. Eine deklarierte App, die nicht mehr existiert, wird als entfernt gemeldet; bei einem Scaffold wird somit wieder die ursprüngliche `rebase.json` des Scaffolds geschrieben. Der Build-Befehl der statischen App verwendet den Paketmanager des Projekts.

Für ein Checkout, das nicht mit einem Cloud-Projekt verknüpft ist, meldet `apps config` die fehlende Verknüpfung (unabhängig davon, ob `rebase dev` läuft) und gibt die Backend-URL so aus, wie `rebase dev` sie bereitstellt.

### `rebase apps add admin`

```bash
rebase apps add admin                  # unter /, oder unter /admin falls eine andere App auf / liegt
rebase apps add admin --path /console  # an einem beliebigen anderen Pfad oder einer eigenen https-URL
```

Fügt das Admin-Panel zu einem Headless- oder portierten Projekt hinzu, genau wie es `rebase init` generiert hätte. Was geschrieben wird, welche Version gepinnt wird und wann der Befehl die Ausführung ablehnt: [Nachträgliches Hinzufügen eines Admin-Panels](/docs/getting-started/headless/#adding-an-admin-panel-later).

### `rebase status`

Zeigt alles an, was dieses Projekt deklariert und ob das Environment die Ressourcen tatsächlich bindet:

```bash
rebase status               # jede Ressource und die von ihr gelesenen Variablen
rebase status --json        # maschinenlesbar
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

Drei Dateien bestimmen, worauf ein Backend zugreifen kann, und dieser Befehl gibt alle drei gemeinsam aus:
`rebase.json` definiert, wo sich Ihr Code befindet und wer den Server ausführt,
`backend/resources.ts` legt fest, was das Projekt benötigt, und das Environment bestimmt, wie jede Ressource erreicht wird. Alles andere — `rebase.resources.json`, das Bundle-Manifest — wird aus der mittleren Datei für Parser generiert, die Ihren Code nicht ausführen können; Sie müssen diese niemals manuell verfassen.

Ein `○` markiert einen Zustand, den man vor einem Deployment kennen sollte: deklariert, aber nicht konfiguriert. Ein `✗` bedeutet, dass das Environment einen Wert *fehlerhaft* setzt, was den Bootvorgang abbricht, anstatt die Funktionalität herabzustufen.

Eine `rebase.resources.json`, die nicht mehr zu den Deklarationen passt, erhält eine `○`-Zeile. Wurde sie noch gar nicht geschrieben, entfällt dies: `rebase build` generiert sie bei jedem Build neu, sodass bei einem noch nie gebauten Projekt (z. B. einem frischen Scaffold) kein Handlungsbedarf besteht.

### `rebase resources`

Gibt an, welche Ressourcen das Projekt benötigt — die Datenbanken, Buckets, Topics und Queues, die `backend/resources.ts` anfordert, sowie die Crons und Funktionen aus den jeweiligen Projektdateien:

```bash
rebase resources            # auflisten
rebase resources --write    # rebase.resources.json neu generieren
rebase resources --check    # fehlschlagen, wenn der committete Graph veraltet ist
rebase resources --json     # maschinenlesbar
```

`rebase resources --check` ist das Flag für CI-Jobs, um bei einer `rebase.resources.json`, die nicht mehr mit `backend/resources.ts` übereinstimmt, einen Fehler auszulösen.
`--json` lässt sich damit kombinieren: Bei Abweichungen beendet `rebase resources --check --json` mit Exit 1 und einem Error-Envelope (`resource_graph_missing` oder `resource_graph_stale`), bei Erfolg enthält der Graph `check.status`. `--write --json` schreibt die Datei und meldet `written.changed`.

Eine Ressource wird in `backend/resources.ts` deklariert — `database("analytics")`, `bucket("media")`, `topic("signups")`, `queue("thumbnails")` — oder ist eine Datei unter `backend/crons` oder `backend/functions`. Sie wird niemals manuell in `rebase.resources.json` geschrieben; diese Datei wird aus den Deklarationen generiert, damit ein Host die Projektanforderungen ohne vorherigen Build ermitteln kann. Jeder Eintrag protokolliert, wer ihn verwendet (`table:events`, `column:posts.cover`, `function:report`).

Ein Backend verfügt zudem über eine Standard-Datenbank und eine Standard-Storage-Quelle, die niemand explizit deklariert. Beide werden hier mit dem Status `implicit` aufgeführt und nicht in `rebase.resources.json` geschrieben — der Host stellt sie bereit; ein Eintrag würde eine Bereitstellung verlangen, die niemand angefordert hat. Die Deklaration einer benannten Ressource wie `bucket("media")` lässt den Standard unverändert, sodass beide gelistet werden. Nur das Deklarieren des Standards selbst oder das Kennzeichnen eines Buckets mit `default: true` ersetzt diesen.

Wie Sie die von der Plattform für ein Projekt gehaltenen Ressourcen mit den Deklarationen im Code abgleichen und bereitgestellte Datenbanken entfernen, die im Code nicht mehr existieren, erfahren Sie unter [`rebase cloud resources`](/docs/cli/cloud#resources).

`rebase cloud` — sämtliche Befehle für Rebase Cloud: Authentifizierung, Projektverknüpfung, Deployments, Konfiguration, Datenbanken, Ressourcen, Compute und mehr — hat [eine eigene Dokumentationsseite](/docs/cli/cloud).

### `rebase generate-sdk`

```bash
rebase generate-sdk
```

Schreibt einen typisierten Client für die in `backend/schema/index.ts` exportierten Tabellen nach `generated/sdk/`, inklusive `TableName` und `tablesDictionary`; `--from <link|url>` liest stattdessen den Vertrag eines laufenden Backends aus. `--register` typisiert zusätzlich serverseitige Daten: Es schreibt die Typen und die `Register`-Deklaration nach `backend/generated/` und speichert dies in `rebase.json` (`registerDatabase`). Siehe [Typisierte serverseitige Daten](/docs/backend/typed-server-data) und [Schema-Generierung](/docs/cli/schema/#rebase-generate-sdk).

### `rebase doctor`

```bash
rebase doctor
```

Der Diagnosebefehl, wenn ein Problem vorliegt, dessen Ursache noch unklar ist. Er erstellt Berichte und nimmt niemals Änderungen vor; daher kann er gefahrlos auf jede erreichbare Datenbank angewendet werden.

**Ohne Datenbank.** Diese Prüfungen laufen zuerst, da alle Fehler, die den Start des Projekts komplett verhindern, auftreten, bevor Tabellen überhaupt verglichen werden können:

| Prüfung | Hintergrund |
| --- | --- |
| Node-Version | Abgleich mit dem von der CLI deklarierten Versionsbereich. Eine zu alte Version führt meist nicht zur Meldung „unsupported Node“, sondern zu Syntaxfehlern innerhalb einer Abhängigkeit. |
| Paketmanager | Zwei Lockfiles in einem Projekt. Ein `npm install` in einem pnpm-Workspace strukturiert `node_modules` in ein mit pnpm inkompatibles Layout um — das Symptom ist `Cannot find module` Stunden später. |
| Doppelte Slugs | Zwei Tabellen, die denselben Slug deklarieren. Das Schema kompiliert damit nicht; dieser Check benennt beide. |
| `.env`-Plausibilität | Ein `JWT_SECRET` mit weniger als 32 Zeichen (womit die Produktion den Start verweigert) sowie `NODE_ENV=production` ohne `CORS_ORIGINS` oder `FRONTEND_URL`. Werte werden niemals im Klartext ausgegeben. |
| `@rebasepro/*`-Versionsabweichungen | Dasselbe Paket ist in verschiedenen `package.json`-Dateien des Projekts auf unterschiedliche Versionen festgelegt. Zwei Kopien verhindern `instanceof`-Vergleiche untereinander, was wie ein Type Guard wirkt, der seinen eigenen Typ ablehnt. |
| Connection-Strings | Ein nicht encodiertes `=` in einem URL-Parameter, das die PostgreSQL-eigenen Tools nicht parsen können — Backups und `psql` schlagen fehl, während die App weiterläuft. |
| Custom Functions | Anforderungen einzelner Funktionen an ihren Host und Identifizierung von Funktionen, die nicht auf einer Edge-Runtime laufen würden. |

**Gegen die Datenbank** — die datenbankbezogenen Prüfungen laufen gegen die Projektdatenbank, aufgelöst wie bei `rebase db url`; bei einem frischen Scaffold ist dies die verwaltete Datenbank, die von `doctor` gestartet wird:

| Prüfung | Hintergrund |
| --- | --- |
| Tabellen → generiertes Schema | Prüft, ob `schema.generated.ts` veraltet ist. |
| Tabellen → Datenbank | Fehlende Tabellen, Spalten, Enums, Fremdschlüssel und Junction-Tabellen. |
| Erforderliche Extensions | Eine `col.vector()`-Spalte benötigt pgvector, welches Rebase nur dort installiert, wo das Projekt dies deklariert hat. |
| Schema-Stempel | Gibt an, ob diese Datenbank aus diesen Tabellen bereitgestellt wurde. Ein Hashwert, der erkennen lässt, dass beide voneinander abweichen, jedoch nicht, welche Seite neuer ist. Ein `v1:`-Stempel aus einer Runtime vor 0.31 wird einmalig gemeldet, zusammen mit dem Befehl zum Neustempeln: `rebase db push`. |
| Tabellen → SDK-Typen | Prüft, ob das generierte typisierte SDK veraltet ist. |
| RLS-Policies | Prüft, ob die Policies der Datenbank mit dem deklarierten `rls` übereinstimmen und ob eine Policy eine Rolle nennt, die dieser Server nicht nutzen kann. |

Ist die Datenbank nicht erreichbar, werden ihre Phasen unter Nennung des Grundes als übersprungen markiert und die restlichen Tests laufen weiter — siehe [Fehlerbehebung](/docs/troubleshooting/).

Beendet mit einem Code ungleich null, wenn eine Prüfung einen Fehler findet oder wenn eine Phase nicht ausgeführt werden konnte, weil die angegebene Datenbank Verbindungen ablehnt. Eine Phase, die übersprungen wurde, weil keine Datenbank ermittelt werden konnte, gilt nicht als Fehler.

`rebase doctor --policies` führt ausschließlich die RLS-Prüfungen aus — kein Schema-Diff, keine SDK-Typen — und schlägt bei Fehlern strikt fehl („fails closed“), was es ideal als CI-Gate für eine deployte Datenbank macht.

`rebase doctor --database` führt nur den Datenbank-Preflight aus: ob die Rolle für authentifizierte Anfragen existiert, eingeschränkt ist und übernommen werden kann; welche anderen Logins zu ihr wechseln dürfen; ob sich jede Rolle verbinden darf; und welche Tabellen, Grants und Policies Rebase mit anderen Rollen teilen würde. Jedes Ergebnis nennt das als Administrator auszuführende SQL, die `rls`-Einstellung, die Rebase stattdessen an die Datenbank anpasst, oder beides. Es liest den Katalog, ändert nichts und beendet bei einem fehlerhaften Befund mit Code 1. Funktioniert auch bei Headless-Projekten. Siehe [Ausführung auf einer bestehenden oder geteilten Datenbank](/docs/deployment/existing-database/).

### `rebase verify`

```bash
rebase verify
rebase verify --json
rebase verify --live
rebase verify --live --database-url postgresql://…
```

Prüft in einem schnellen Befehl für CI und Hooks von KI-Agents, ob die Tabellen bereit für das Deployment sind. Standardmäßig offline; nimmt niemals Änderungen vor.

| Schritt | Fehlerursachen |
| --- | --- |
| Tabellendefinitionen (`schema`) | `backend/schema` lädt nicht oder kompiliert nicht mit dem Loader, den das Backend nutzt: Eine Relation zu einer Tabelle, die der Index nicht exportiert, `rls: "inherit"` ohne `defaultRls`, eine Tabelle ohne Primärschlüssel — ein Befund pro Problem. Eine Tabelle ohne `rls` gehört ebenfalls dazu. |
| RLS-Abdeckung (`rls`) | Eine Tabelle mit einer Spalte `user_id`, `owner_id`, `organization_id` oder `tenant_id`, deren Regeln — eigene oder geerbte aus `defaultRls` — einer Rolle erlauben, jede Zeile ungeachtet dessen zu lesen. Wird als Warnung ausgegeben. `rls-policy-recursion`: Eine Regel, die ihre eigene Tabelle in einer Subquery liest, oder zwei Tabellen, deren Regeln sich gegenseitig lesen — Postgres verweigert das Auflösen, wodurch jedes geschützte Statement mit `42P17 infinite recursion detected in policy` fehlschlägt; der Befund nennt die gelesene Tabelle und die Lösung (Auslagern des Lesevorgangs in eine `SECURITY DEFINER`-Funktion). Ein Fehler oder eine Warnung, falls die Rekursionsschleife nicht eindeutig ist. |
| Migrations-Aktualität (`migrations`) | Eine von den Tabellen deklarierte Tabelle oder Spalte, die in keiner Datei unter `backend/drizzle/migrations` erstellt wird, oder ein entferntes Element, das von einer Migration weiterhin angelegt wird. Wird für Projekte ohne bisherige Migrationen übersprungen. |
| CMS-Anpassungen (`cms`) | Ein `customizeTable(...)` in `frontend/src/cms` (oder im `src/cms` einer statischen App in `rebase.json`), das bei statischer Analyse nicht zu den Tabellen passt — die Module werden nicht ausgeführt. `cms-unknown-table`: Der Slug gehört zu keiner Tabelle, sodass das Panel ihn ignoriert (der ähnlichste Slug wird vorgeschlagen). `cms-unknown-field`: Ein Schlüssel unter `fields` ist weder Spalte noch Relation (bei Angabe des SQL-Namens einer Spalte wird deren Key vorgeschlagen). `cms-hidden-required`: Ein im Formular ausgeblendetes Feld (`hiddenInForm`, `readOnly`, `disabled`), dessen Spalte `NOT NULL` ohne Default-Wert ist und nicht vom Server befüllt wird, wodurch das Erstellen eines Datensatzes über das Panel immer fehlschlägt; eine Warnung, falls ein `beforeSave`-Hook oder Transform das Feld befüllen könnte, stummgeschaltet durch `filledByServer`. `cms-duplicate-customization`: Ein Slug wurde doppelt angepasst. `cms-not-static` (Warnung): Ein Aufruf, dessen Slug, Optionen oder `fields` keine Literale oder `const`-Werte derselben Datei sind, weshalb keine Prüfung stattfinden konnte. `cms-ui-config-not-mounted` (Warnung): `frontend/src/cms/ui-config.json` existiert, wird `<RebaseCMS>` jedoch nicht als `uiConfig` übergeben. `cms-backend-guard-missing`: Die Vite-Konfiguration des Frontends nutzt `rebaseBackendGuard()` nicht, weshalb `rebase build` den Vorgang verweigern würde. Ein Headless-Projekt besitzt kein `frontend/src/cms` und überspringt diesen Schritt. |
| Live-RLS-Audit (`live`) | Mit `--live`: Führt den [`rls-check`](/docs/rls-check)-Katalog gegen die Projektdatenbank aus und prüft, ob jede Migration angewendet wurde. Die Datenbank wird wie bei den `db`-Befehlen aufgelöst — `--database-url`, `DATABASE_URL`, `--docker`, andernfalls die verwaltete Entwicklungsdatenbank. Eine nicht konfigurierte oder nicht antwortende Datenbank erzeugt einen Fehler und wird nicht übersprungen, da das Audit explizit angefordert wurde. Eine aus einer `access: "public"`-Regel kompilierte `USING (true)`-Lesepolicy ist eine Warnung, solange die API ein Token verlangt (`AUTH_REQUIRE`, standardmäßig aktiv) — jeder angemeldete Benutzer liest jede Zeile — und ein Fehler bei `AUTH_REQUIRE=false`, da Zeilen dann anonym zugänglich sind. |

`--json` gibt ein einzelnes Objekt aus: `{ ok, schemaDir, steps, findings, summary }`.
Jeder Schritt ist strukturiert als `{ id, title, status, detail? }` (`status` ist `passed`, `failed`, `warnings` oder `skipped`), und jeder Befund enthält `step`, `check` (ein stabiler Kebab-Case-Bezeichner), `severity`, `message` und, sofern anwendbar, `fix`, `table`, `file`, `line` sowie den punktseparierten Pfad (`path`) in die Tabelle (`posts.rls[0]`) — sodass ein Agent Fehler automatisiert beheben kann. `summary` zählt `errors` und `warnings`. `--quiet` unterdrückt alle Ausgaben, wenn alles erfolgreich durchläuft. Beendet bei Fehlern mit einem Exit-Code ungleich null; Warnungen führen nicht zum Fehlschlagen.

Ein gescaffoldetes Projekt führt diesen Befehl für Claude Code nach jeder Bearbeitung unter `backend/schema/` aus: siehe [`rebase skills install`](#rebase-skills-install).

### Befehle für eine laufende App

`rebase api`, `rebase data`, `rebase users`, `rebase cron`, `rebase logs`, `rebase functions`, `rebase rls simulate`, `rebase auth login` und `rebase storage ls|cp|rm|url|stat` interagieren über die API mit einer laufenden App: dem lokalen `rebase dev`, einem über `--url` angegebenen Server oder einem Rebase-Cloud-Projekt via `--project`. Siehe [Eine laufende App](/docs/cli/project/).

### `rebase auth`

Befehle zur Authentifizierungsverwaltung:

```bash
rebase auth reset-password --email admin@example.com --password NewPassword123!
```

### `rebase api-keys`

Verwaltung der Service-API-Keys des Projekts — die Anmeldedaten für Agents, Skripte oder externe Services im Gegensatz zur Session eines Endbenutzers:

```bash
rebase api-keys list
rebase api-keys get abc123-def456
rebase api-keys create --name "Blog CI" --scopes data:read:posts,data:write:posts --expires-in 90
rebase api-keys create --name "Ops" --full-access --roles admin --expires-at 2027-01-31
rebase api-keys revoke abc123-def456
```

`--scopes` definiert die Berechtigungen des Keys, kommagetrennt oder wiederholt angegeben; `--full-access` gewährt alle Berechtigungen des Service-Keys mit Ausnahme von `keys:*`. `--roles` fügt RLS-Rollen neben `service` hinzu, `--expires-in` akzeptiert Tage und `--expires-at` ein ISO-Datum. `rebase api-keys scopes` listet alle dem Backend bekannten Scopes auf. Ein Key wird nur einmalig im Klartext angezeigt. Es greifen sowohl die Scopes des Keys als auch die Row-Level Security der Identität, unter der er agiert. Siehe [API-Keys](/docs/backend/api-keys/).

### `rebase storage`

Wartung gespeicherter Dateien über das gesamte System hinweg, über das laufende Backend mit `REBASE_SERVICE_KEY` aus `.env`:

```bash
rebase storage orphans                         # Dateien, auf die keine Zeile verweist
rebase storage orphans --source media --delete # und Löschen dieser Dateien nach Bestätigung
rebase storage move --from "(default)" --to media --prefix avatars
rebase storage move --from "(default)" --to media --prefix avatars --delete-source
```

`orphans` liest jede Zeile jeder Tabelle im gespeicherten Zustand (einschließlich Soft-Deleted-Zeilen, unter Umgehung aller `beforeQuery`- und `afterRead`-Hooks) sowie jeden [History](/docs/backend/history/)-Eintrag, da ein Revert die referenzierten Daten wiederherstellt. Der Befehl listet die Dateien einer Quelle auf (`--source`, standardmäßig die Standardquelle), auf die kein String in diesen Datensätzen verweist: sei es ein Key, eine URL oder eine `rebase-storage:`-Referenz im Text. Dateien, die jünger als `--older-than` Stunden sind (Standard: 24), werden ignoriert, da das Admin-Panel eine Datei hochlädt, bevor die referenzierende Zeile gespeichert wird. Der Scan läuft auf dem Backend im Hintergrund, sodass auch Projekte, die zu groß für einen einzelnen Request sind (z. B. hinter einem Ingress mit Timeout), erfolgreich analysiert werden. Die CLI stößt den Scan an und zeigt den Fortschritt (gefundene Dateien, gelesene Zeilen, abgeschlossene Tabellen und Lesefehler) bis zum Abschluss an. Bei aktiver [Job Queue](/docs/backend/jobs/) läuft der Scan als `storage.orphans`-Job über die Job-Worker. Ohne Queue läuft er innerhalb des angefragten Serverprozesses (die CLI weist darauf hin): Ein Neustart dieses Prozesses bricht den Scan ab. Ein Scan entspricht einem Job-Versuch, begrenzt durch `jobs.timeoutMs` (Standard: 15 Minuten). Erhöhen Sie diesen Wert oder setzen Sie ihn auf 0 für Quellen, die mehr Zeit benötigen. `--json` gibt denselben Bericht wie zuvor aus, ergänzt um die `scanId`.

`--delete` verlangt vor dem Löschen eine Bestätigung (`--yes` überspringt die Abfrage und ist ohne Terminal Pflicht). Es werden ausschließlich Dateien aus dem unmittelbar zuvor ausgegebenen Scan gelöscht, und dies nur innerhalb von 15 Minuten nach dessen Abschluss. Es wird nichts gelöscht, solange auch nur eine Tabelle nicht gelesen werden kann: Eine Tabelle mit Read-Hooks auf einer Datenbank, deren Treiber diese nicht umgehen kann, gilt als ungelesen. Vor dem eigentlichen Löschen liest der Server alle Zeilen und History-Einträge erneut gegen die gelisteten Dateien ab. Anschließend wird jede Datei unmittelbar vor dem Löschen erneut geprüft. Eine Datei, die inzwischen von einer Zeile referenziert wird, seit dem Scan neu hochgeladen wurde oder nicht mehr existiert, bleibt erhalten und wird von der CLI als behalten aufgeführt. Dateien, die ausschließlich von Tabellen referenziert werden, die Rebase nicht verwaltet, erscheinen als ungenutzt: Prüfen Sie dies vor dem Löschen. Bei einem Backend der Version 0.25.1 oder älter führt die CLI den Scan nach dem alten Verfahren innerhalb eines einzigen Requests aus.

`move` kopiert Dateien unter `--prefix` seitenweise unter denselben Keys zu einer anderen Quelle. Eine Datei, die am Zielort bereits mit identischer Größe existiert, wird übersprungen; ein abgebrochener Kopiervorgang kann daher durch erneutes Ausführen fortgesetzt werden. `--delete-source` löscht jede Datei aus der Quelle, sobald sie am Ziel existiert, und wird verweigert, wenn beide Quellen denselben Bucket oder dasselbe Verzeichnis nutzen. Nach Abschluss listet die CLI die Quelle erneut per Durchlauf auf und nennt alle nicht verschobenen Dateien: mit `--delete-source` jede verbleibende Datei in der Quelle; ohne dieses Flag jede Datei, für die am Ziel keine größenidentische Kopie existiert. Wurden Dateien ausgelassen, beendet der Befehl mit Code 1; ein erneuter Aufruf verarbeitet diese nach. `--json` gibt diese als `notMoved` aus. Das Lesen eines Scan-Berichts erfordert `database:read`. Das Starten eines Scans, das Löschen und das Verschieben erfordern `database:write`, worüber der Service-Key verfügt.

### `rebase skills install`

Installiert die Rebase-Referenz-Skills für Ihre KI-Coding-Assistenten — für jedes oben genannte `--agent`:

```bash
rebase skills install
rebase skills install --agent claude,cursor
rebase skills install --agent all
rebase skills --hooks
```

Unter [Agent Skills](/docs/ai/skills) finden Sie die vollständige Liste sowie die Speicherorte der Dateien.

`--hooks` installiert das Claude-Code-Guardrail, das `rebase init` standardmäßig mit jedem Projekt ausliefert: `.claude/hooks/post-edit-collection.sh`, registriert als `PostToolUse`-Hook in `.claude/settings.json`. Dieses Skript führt nach jeder Bearbeitung unter `backend/schema/` oder `frontend/src/cms/` den Befehl `rebase verify --quiet` aus und meldet eventuelle Probleme direkt an den Agent zurück. Bestehende Einstellungen und Hooks bleiben erhalten. `rebase skills --hooks` installiert ausschließlich diesen Hook.

### `rebase telemetry`

Anonyme Erfassung von Nutzungsdaten, standardmäßig deaktiviert. Ein interaktives `rebase init` fragt am Ende nach, wobei die Standardantwort „Nein“ ist; es wird nichts übertragen, solange Sie nicht explizit zustimmen. Die Entscheidung gilt pro Rechner (`~/.rebase/telemetry.json`): Nach einem „Ja“ fragt `init` nicht mehr nach; nach einem „Nein“ fragt das nächste `init` erneut. Jedes Checkout erhält eine zufällige Projekt-ID, die in der git-ignorierten Datei `.rebase/telemetry-project.json` gespeichert wird.

```bash
rebase telemetry status
rebase telemetry show
rebase telemetry enable
rebase telemetry disable
```

`status` gibt die aktuelle Einstellung aus, `show` zeigt exakt den Payload, der gesendet werden würde (unabhängig davon, ob Telemetrie aktiv ist, sodass Sie die Daten vorab prüfen können), und die anderen beiden Befehle ändern den Status. Wenn Sie `init` nie ausgeführt haben, wurden zu keinem Zeitpunkt Daten erfasst.

## Nächste Schritte

- **[Schema-Generierung](/docs/cli/schema/#production-workflow)** — Der Migrations-Workflow, von Tabellenänderungen bis zur Produktion
- **[Schema as Code](/docs/architecture/schema-as-code)** — Funktionsweise der Schema-Generierung
- **[Schnellstart](/docs/getting-started/quickstart)** — Erste Schritte
