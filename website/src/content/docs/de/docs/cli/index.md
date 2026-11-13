---
sourceHash: d0b65c1ecccde6ba
title: CLI-Referenz
sidebar_label: CLI
description: Rebase-CLI-Befehle für Projektinitialisierung, Schema-Generierung, Datenbankmigrationen und SDK-Generierung.
---

## Übersicht

Die Rebase CLI (`rebase`) verwaltet Ihr Projekt vom Scaffolding bis zum Deployment.

## Installation

```bash
pnpm add -g @rebasepro/cli
```

Oder führen Sie einen beliebigen Befehl aus, ohne ihn zu installieren: `pnpm dlx @rebasepro/cli <command>`.

## Maschinenlesbare Ausgabe

`--json` ist die entsprechende Option, und außerhalb der `cloud`-Befehlsfamilie die einzige: `rebase status`, `rebase resources`, `rebase apps list`, `rebase upgrade` und `rebase verify` geben dann genau einen JSON-Wert auf stdout aus — das Ergebnis oder ein `{"error": {"message", "code", "hint", "issues"}}`-Envelope mit einem Exit-Code ungleich null — bei **jedem** Beenden des Befehls, sodass ein aufrufender Prozess stdout bedingungslos parsen kann. Ohne diese Option wird menschenlesbarer Text ausgegeben und Fehler gehen an stderr. `rebase cloud` verwendet dasselbe Envelope und bildet die einzige Ausnahme: Es aktiviert JSON auch automatisch von selbst, wenn stdout kein TTY ist oder wenn `REBASE_JSON=1` gesetzt ist. Daher liefert `rebase cloud status | cat` JSON, während `rebase status | cat` dies nicht tut — übergeben Sie in einem Skript explizit `--json`, anstatt sich auf eine dieser Regeln zu verlassen.

## Befehle

### `rebase init`

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Initialisiert ein neues Rebase-Projekt:

```bash
rebase init [directory]
```

Richtet ein `backend/` (die Tabellen in `backend/schema/`) und ein `frontend/` (das Admin-Panel mit seinen Tabellenanpassungen in `frontend/src/cms/`) ein; `--headless` scaffoldet ausschließlich `backend/`, ohne `backend/schema/`. Unter [Projektstruktur](/docs/getting-started/project-structure/) werden beide Verzeichnisbäume dargestellt.

| Flag | Funktion |
|---|---|
| `-t, --template <preset>` | `blog`, `ecommerce` oder `blank`. Standard ist `blog` |
| `--headless` | Nur Backend — kein Admin-Panel und kein `backend/schema/`: Der Server stellt die tabelleneigenen Strukturen der Datenbank bereit. `--template` hat keine Auswirkung, da keine Tabellen mit Initialdaten befüllt werden |
| `-y, --yes` | Keine interaktiven Abfragen. **Erforderlich in Umgebungen ohne Terminal**, wie z. B. CI. Überspringt git init und die Abhängigkeitsinstallation — die interaktiven Standardwerte bejahen beides; übergeben Sie daher `--git` / `--install`, falls gewünscht |
| `-i, --install` | Installiert Abhängigkeiten nach dem Scaffolding. Ohne Flag fragt init nach (Standard: ja); mit `--yes` wird nichts installiert |
| `--no-install` | Installiert nichts und fragt nicht nach |
| `-g, --git` | Initialisiert ein Repository und erstellt den ersten Commit. Ohne Flag fragt init nach (Standard: ja); mit `--yes` wird kein Repository erstellt |
| `--database-url <url>` | Verwendet eine bestehende Datenbank anstelle der verwalteten. Es muss eine `postgres://`- oder `postgresql://`-URL sein: Alles andere wird abgelehnt, bevor eine Datei geschrieben wird, und die interaktive Abfrage fragt erneut |
| `--introspect` | Generiert `backend/schema` aus dieser Datenbank. Impliziert `--template blank` und erfordert `--install` |
| `--project <slug>` | Verknüpft das Scaffold mit einem Rebase Cloud-Projekt |
| `--setup-key <key>` | Der Einmalschlüssel zur Authentifizierung dieser Verknüpfung |
| `-a, --agent <name>` | Richtet KI-Coding-Agents ein: die [Skills](/docs/ai/skills) und den [MCP-Server](/docs/ai/mcp). Wiederholbar oder kommagetrennt — `claude`, `cursor`, `windsurf`, `gemini`, `codex`, `kiro`, `copilot` oder `all`. Ohne Flag fragt `init` nach und wählt auf dem System installierte Agents vorab aus; mit `--yes` werden keine eingerichtet |

### `rebase dev`

Startet den Entwicklungsserver:

```bash
rebase dev
```

Startet sowohl Frontend als auch Backend mit Hot Reloading und regeneriert das Drizzle-Schema sowie die SDK-Typen (`generated/sdk/`) beim Start und bei jedem Speichern unter `backend/schema/`.

Beide Ports werden aus dem Projektpfad abgeleitet, sodass mehrere Rebase-Projekte parallel laufen können. Verwenden Sie die URLs, die `rebase dev` ausgibt. Legen Sie einen festen Port fest mit `rebase dev --port 3001`.

Eine Bearbeitung von `.env` startet das Backend neu, welches die Datei wie das Admin-Panel erneut einliest. Was `rebase dev` selbst setzt, bleibt bis zum Neustart erhalten: `PORT` und `DATABASE_URL`, wenn die verwaltete Datenbank oder Docker verwendet wird.

Mit `--database-url` prüft `rebase dev` zuerst, ob unter diesem Host und Port eine Antwort erfolgt. Falls nicht, wird dies unter Nennung des Flags gemeldet und mit Exit-Code `1` beendet, ohne dass etwas gestartet wurde; zudem bleiben die Datenbank-Variablen in `.env` unberührt, und der Compose-Container wird niemals gestartet.

### `rebase build`

Baut das Projekt in ein deploybares Bundle in `dist-bundle/`:

```bash
rebase build
```

Das Bundle ist das Artefakt, das Sie deployen — das Runtime-Image lädt es, sodass Sie kein eigenes Anwendungs-Image erstellen müssen. Nützliche Flags:

| Flag | Wirkung |
|------|--------|
| `--output <dir>` (oder `--out`) | Schreibt das Bundle an einen anderen Ort als `dist-bundle/` (eine App nach der anderen) |
| `--vendor` | Installiert und packt die Abhängigkeiten des Bundles immer mit ein |
| `--no-vendor` | Kein Vendoring; der Pod installiert sie bei jedem Start neu |
| `--skip-type-check` | Überspringt die Typüberprüfung (schneller, weniger sicher) |
| `--no-static` | Bindet das Frontend nicht in das Backend-Bundle ein (jede statische App erhält weiterhin ihr eigenes Bundle) |
| `--skip-static-build` | Bindet das Frontend im bereits gebauten Zustand ein, ohne dessen Build-Befehl auszuführen |

<span class="since-badge" data-since="0.31">Seit 0.31</span> Ein Frontend — jede statische App aus `rebase.json` mit einer Vite-Konfiguration —, dessen Konfiguration nicht `rebaseBackendGuard()` (aus `@rebasepro/app/vitePlugin`) verwendet, wird abgelehnt: Dies stellt sicher, dass Server-Code nicht im Browser-Bundle landet, und verhindert, dass Vite eine Backend-Datei als `data:`-URL inline einbindet (es schlägt beim Build unter Nennung des eigenen Namens fehl, wenn ein anderes Plugin dessen `build.assetsInlineLimit` überschreibt). `frontend/src/cms/ui-config.json` wird als `entry.uiConfig` in das Bundle übernommen — die Workspace-Darstellung, die ein deploytes Backend ausliefert.

Abhängigkeiten werden standardmäßig per Vendoring gebündelt, damit eine neue Instanz keine Installationsdauer von 35–55 Sekunden verursacht. Ein Verzeichnisbaum, der auf der Festplatte mehr als 2 GB groß wird, wird stattdessen verworfen, da das Upload-Limit komprimiert 1 GB beträgt.

Jede statische App, die das Bundle enthält, erhält neben jedem inhaltsgehashten Asset ab 1 KB — also den Dateien, die ein Browser für ein Jahr zwischenspeichert — eine Brotli- (`.br`) und eine Gzip-Kopie (`.gz`). Die Runtime sendet die Variante, die der Browser akzeptiert, sodass diese Dateien pro Anfrage keinen Kompressionsaufwand verursachen (auch beim ersten Aufruf nach einem Deployment), und Browser, die Brotli unterstützen, erhalten dieses (ca. 11 % kleiner als Gzip beim JavaScript des Admin-Panels). Die eigene Build-Ausgabe Ihres Frontends bleibt unverändert; nur die Kopie im Bundle wird modifiziert. Bei der Beispiel-App verlängert dies den Build um weniger als eine Sekunde und vergrößert das Bundle um etwa 2,4 MB.

### `rebase upgrade`

Aktualisiert jedes im Projekt festgelegte `@rebasepro/*`-Paket auf ein einheitliches Release und installiert anschließend mit dem Paketmanager, der im Lockfile angegeben ist. `rebase upgrade` wählt die Version `latest`; `--to 0.21.0` eine exakte Version ohne Registry-Lookup; `--to canary` einen Dist-Tag. Jeder Eintrag in `dependencies`, `devDependencies` und `optionalDependencies` in jeder `package.json` des Projekts behält sein `^` oder `~`, und nichts anderes in der Datei wird geändert. `peerDependencies` sowie `workspace:`, `link:`, `file:`, Git- und Tag-Spezifikationen werden aufgelistet und unberührt gelassen. Overrides in `pnpm-workspace.yaml` und `package.json` werden ebenfalls aktualisiert, aber ein `link:`- oder `file:`-Override hat Vorrang vor jedem Versions-Pin: Dies wird gemeldet, und `--drop-local-overrides` entfernt ihn. `--dry-run` schreibt nichts, `--no-install` überspringt die Installation und `--json` gibt ein einzelnes Dokument aus.

Ein Projekt, das auf einem Vorab-Release wie Canary läuft, bleibt auf diesem Channel, es sei denn, `latest` ist neuer. Ein Dist-Tag, der einen Versions-Pin zurücksetzen würde, wird abgelehnt (`downgrade_refused` unter `--json`), es sei denn, Sie übergeben `--allow-downgrade`; ein exakter Wert mit `--to` wird angewendet und als Downgrade gekennzeichnet. Ein `--dry-run` eines Upgrades, das die tatsächliche Ausführung ablehnen würde, zeigt die potenziellen Änderungen an und beendet mit Exit-Code 0; unter `--json` enthält das Dokument die Ablehnung als `wouldRefuse` (`{ code, message, hint }`).

### `rebase start`

Führt das erstellte Bundle so aus, wie es bei einem Deployment ausgeführt wird:

```bash
rebase start
```

Liest `PORT` und den Rest von `.env` ein — anders als `rebase dev` in der dort gesetzten `NODE_ENV`. Eine gescaffoldete `.env` steht auf `development`, daher wird der erste registrierte Account weiterhin zum Admin, was `rebase start` ganz oben meldet; setzen Sie `NODE_ENV=production` für einen Produktionsserver. `rebase start --bundle ./dist-bundle` führt ein Bundle an einem anderen Ort aus.

`rebase start` startet keine Datenbank, und die `.env` des Scaffolds enthält keine `DATABASE_URL`. Ein lokaler Lauf mit der von `rebase dev` genutzten Datenbank lautet daher `DATABASE_URL="$(rebase db url)" rebase start`. Ohne Angabe gibt der Befehl vor dem Start genau diese Zeile aus.

### `rebase apps list`

Zeigt die Apps an, die dieses Repository deklariert:

```bash
rebase apps list
```

Ein Repository kann mehr als eine deploybare App deklarieren — beispielsweise ein Backend und eine Marketing-Website. So sehen Sie, worauf sich `rebase build` und das Deployment auswirken.

### `rebase eject`

Übernimmt die vollständige Kontrolle über den Serverprozess und sein Image:

```bash
rebase eject
```

Schreibt den Backend-Einstiegspunkt und ein `Dockerfile` in das Projekt und stellt dessen Backend um, sodass das Repository sein eigenes Image baut, anstatt die vorgefertigte Runtime auszuführen. Von da an **greifen Plattform-Runtime-Upgrades nicht mehr**, und CORS, Authentifizierungsverdrahtung, Storage und Shutdown müssen von Ihnen konfiguriert werden.

Mit `rebase eject --dry-run` können Sie eine Vorschau anzeigen; es listet auf, was sich ändern würde, ändert jedoch nichts. `--force` ersetzt eine vorhandene `backend/src/index.ts` oder `env.ts` und sichert die aktuelle Datei als `<name>.bak`.

Der ausgeklinkte Server speichert lokale Uploads weiterhin im Verzeichnis `uploads/` des Projekts, egal ob aus dem Quellcode oder kompiliert ausgeführt, genau wie `rebase dev`. Er läuft in `backend/`, sodass ein relativer `STORAGE_PATH` dort ausgehend von `backend/` gelesen wird.

### `rebase schema generate` / `rebase schema stale`

<span class="since-badge" data-since="0.31">Seit 0.31</span>

```bash
rebase schema generate       # backend/schema → backend/src/schema.generated.ts
rebase schema stale          # benennt Abweichungen von den Tabellen, Exit-Code 1 bei Abweichungen
rebase schema stale --fix    # regeneriert die Datei stattdessen
```

Jeder Befehl, der das Schema liest, akzeptiert `--schema-dir <dir>` für Projekte, die es an einem anderen Ort ablegen; `--collections` wurde entfernt. `rebase dev` hält die Datei aktuell, sodass `stale` zur Überprüfung in einem Build oder CI dient. Siehe [Schema-Generierung](/docs/cli/schema/).

### `rebase db`

```bash
rebase db push                 # wendet die Tabellen auf die Datenbank an (Entwicklung)
rebase db generate             # schreibt eine SQL-Migrationsdatei
rebase db migrate              # wendet ausstehende Migrationen an
rebase db url                  # gibt den Connection-String aus, den dieses Projekt nutzt
rebase db pull --from <url>    # kopiert eine andere Datenbank in die lokale
rebase db backup               # pg_dump; db backups list und db restore stehen daneben zur Verfügung
rebase db branch create <name> # eine Arbeitskopie erstellen; auch switch, list und prune sind möglich
rebase db stop                 # stoppt die verwaltete Entwicklungsdatenbank
rebase db reset                # löscht sie und startet von vorn
rebase db request-role migrate --to <role> # verlegt Anfragen auf eine andere Postgres-Rolle
rebase db provision --print    # das SQL, das die Request-Rolle einrichtet, für einen DBA
```

Jeder dieser Befehle wird unter [Datenbank-Befehle](/docs/cli/database/) beschrieben, einschließlich der Reihenfolge, in der ein Befehl seine Datenbank auswählt; `push`, `generate` und `migrate` werden unter [Schema-Generierung](/docs/cli/schema/) ausführlich behandelt.

### `rebase console`

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Eine Node-REPL mit Zugriff auf die Projektdaten oder Ausführung eines einzelnen Snippets mit `-e`:

```bash
rebase console
rebase console -e "rebase.dataAsAdmin.posts.find({ limit: 5 })"
```

`rebase` (`dataAsAdmin`, `sql`, `withAuth(user)`) und `tables` (die Tabellen des Projekts, geladen aus `backend/schema`) befinden sich im Scope, und Top-Level-`await` wird unterstützt. Die Datenbank wird genauso aufgelöst wie bei `rebase db push`, und das Öffnen der Konsole ändert nichts an den Daten. Mit `-e` wird das per `await` abgewartete Ergebnis als JSON auf stdout ausgegeben; bei einem Fehler bricht der Befehl mit Exit-Code `1` ab. Flags: `--eval`/`-e`, `--schema-dir`, `--database-url`, `--docker`. Siehe [Skripte und die Konsole](/docs/backend/scripts/).

### `rebase migrate`

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Einweg-Migrationen von einem Layout, das von diesem Release nicht mehr unterstützt wird: `rebase migrate collections-to-tables` (`config/collections` → `backend/schema` und `frontend/src/cms`) sowie `rebase migrate sdk-calls` (`data.collection("x")` → `data.table("x")` in Ihrem eigenen Code). Deren Flags, was sie schreiben und der Abschnitt „Vor dem Deployment prüfen“ finden sich unter [Schema-Generierung](/docs/cli/schema/#rebase-migrate).

### `rebase apps init` / `rebase apps config`

```bash
rebase apps list             # die Apps, die dieses Projekt deklariert
rebase apps init             # schreibt eine aus diesem Projekt abgeleitete rebase.json
rebase apps config <app>     # die Client-Konfiguration für eine App
```

`apps init` erfordert keinen Namen: Es leitet alle Apps aus dem Projekt ab und schreibt die gesamte `rebase.json`. Es weigert sich, eine bestehende Datei zu überschreiben, sofern nicht `--force` übergeben wird.

Ein Namensargument wird abgelehnt. `--force` behält bei, was eine automatische Erkennung nicht aus der zu ersetzenden Datei ableiten kann: den Namen jeder App, ihren `path` und ihre `cms`-Route. Alles andere wird erneut abgeleitet, und eine zuvor deklarierte App, die nicht mehr gefunden wird, wird als entfernt aufgeführt; bei einem Scaffold wird somit wieder die ursprüngliche `rebase.json` des Scaffolds geschrieben. Der Build-Befehl der statischen App verwendet den Paketmanager des Projekts.

Bei einem Checkout, der nicht mit einem Cloud-Projekt verknüpft ist, meldet `apps config`, dass keine Verknüpfung besteht (unabhängig davon, ob `rebase dev` läuft oder nicht), und gibt die Backend-URL so aus, wie `rebase dev` sie bereitstellt.

### `rebase status`

Alles, was dieses Projekt deklariert, und ob die Umgebung es tatsächlich bindet:

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

Drei Dateien bestimmen, was ein Backend erreichen kann, und dieser Befehl gibt alle drei zusammen aus: `rebase.json` definiert, wo sich Ihr Code befindet und wer den Server ausführt, `backend/resources.ts` legt fest, was das Projekt benötigt, und das Environment bestimmt, wie jede Ressource erreichbar ist. Alles andere — `rebase.resources.json`, das Bundle-Manifest — wird aus der mittleren Datei für Ausleseprozesse generiert, die Ihren Code nicht direkt ausführen können; Sie müssen dies niemals manuell schreiben.

Ein `○` kennzeichnet den Zustand, den man besser vor als nach einem Deployment kennen sollte: deklariert, aber nicht konfiguriert. Ein `✗` bedeutet, dass das Environment etwas *falsch* setzt, was den Boot-Vorgang verhindert, anstatt die Funktionalität nur herabzustufen.

Eine `rebase.resources.json`, die nicht mehr mit den Deklarationen übereinstimmt, erhält eine Zeile mit `○`. Eine Datei, die noch gar nicht geschrieben wurde, erhält dies nicht: `rebase build` schreibt sie bei jedem Build neu; ein Projekt, das noch nie gebaut wurde (z. B. ein frisches Scaffold), erfordert somit keine Korrektur.

### `rebase resources`

Was dieses Projekt laut Deklaration benötigt — die Datenbanken, Buckets, Topics und Queues, die `backend/resources.ts` anfordert, sowie die Crons und Funktionen, die seine Dateien definieren:

```bash
rebase resources            # listet sie auf
rebase resources --write    # regeneriert rebase.resources.json
rebase resources --check    # schlägt fehl, wenn der committete Graph veraltet ist
rebase resources --json     # maschinenlesbar
```

`rebase resources --check` ist das Flag, das ein CI-Job verwendet, um bei einer `rebase.resources.json`, die nicht mehr mit `backend/resources.ts` übereinstimmt, fehlzuschlagen. Es lässt sich mit `--json` kombinieren: Bei Abweichungen bricht `rebase resources --check --json` mit Exit-Code 1 und einem Fehler-Envelope ab (`resource_graph_missing` oder `resource_graph_stale`), bei Erfolg enthält der Graph `check.status`. `--write --json` schreibt die Datei und meldet `written.changed`.

Eine Ressource wird in `backend/resources.ts` deklariert — z. B. `database("analytics")`, `bucket("media")`, `topic("signups")`, `queue("thumbnails")` — oder ist eine Datei unter `backend/crons` bzw. `backend/functions`. Sie wird niemals manuell in `rebase.resources.json` geschrieben; diese Datei wird aus den Deklarationen generiert, damit ein Host die Anforderungen eines Projekts lesen kann, ohne es bauen zu müssen. Jeder Eintrag protokolliert, wer die Ressource verwendet (`table:events`, `column:posts.cover`, `function:report`).

Ein Backend verfügt zudem über eine Standarddatenbank und eine Standard-Storage-Quelle, die niemand explizit deklariert. Beide werden hier mit der Kennzeichnung `implicit` aufgeführt und keine von beiden wird in `rebase.resources.json` geschrieben — der Host stellt sie bereit; ein Festhalten würde die Bereitstellung von etwas anfordern, das niemand explizit angefordert hat. Die Deklaration einer benannten Ressource, wie z. B. `bucket("media")`, belässt den Standard unverändert, sodass beide aufgeführt werden. Nur das Deklarieren des Standards selbst oder das Kennzeichnen eines Buckets mit `default: true` ersetzt ihn.

Um abzugleichen, was die Plattform für ein Projekt vorhält im Vergleich zu dem, was dessen Code deklariert, und um eine bereitgestellte Datenbank zu entfernen, die der Code nicht mehr nennt, siehe [`rebase cloud resources`](/docs/cli/cloud#resources).

`rebase cloud` — alle Befehle für Rebase Cloud: Authentifizierung, Projektverknüpfung, Deployments, Konfiguration, Datenbanken, Ressourcen, Compute und mehr — hat [eine eigene Seite](/docs/cli/cloud).

### `rebase generate-sdk`

<span class="since-badge" data-since="0.31">Seit 0.31</span>

```bash
rebase generate-sdk
```

Schreibt einen typisierten Client für die Tabellen, die `backend/schema/index.ts` exportiert, nach `generated/sdk/`, inklusive `TableName` und `tablesDictionary`; `--from <link|url>` liest stattdessen den Vertrag eines laufenden Backends aus. `--register` typisiert zusätzlich serverseitige Daten: Es schreibt die Typen und die `Register`-Deklaration nach `backend/generated/` und hinterlegt dies in `rebase.json` (`registerDatabase`). Siehe [Typisierte serverseitige Daten](/docs/backend/typed-server-data) und [Schema-Generierung](/docs/cli/schema/#rebase-generate-sdk).

### `rebase doctor`

```bash
rebase doctor
```

Der Befehl, den man ausführt, wenn etwas nicht stimmt und die Ursache noch unbekannt ist. Er analysiert und ändert niemals etwas, sodass er für jede erreichbare Datenbank sicher angewendet werden kann.

**Ohne Datenbank.** Diese Prüfungen laufen zuerst, da alle Probleme, die das Projekt vollständig am Starten hindern, auftreten, bevor Tabellen verglichen werden können:

| Prüfung | Grund |
| --- | --- |
| Node-Version | Abgleich mit dem von der CLI deklarierten Bereich. Eine veraltete Version wird nicht als „nicht unterstütztes Node“ gemeldet — sie äußert sich als Syntaxfehler innerhalb einer Abhängigkeit. |
| Paketmanager | Zwei Lockfiles in einem Projekt. `npm install` in einem pnpm-Workspace schreibt `node_modules` in ein Layout um, mit dem pnpm nicht kompatibel ist; das Symptom ist Stunden später `Cannot find module`. |
| Doppelte Slugs | Zwei Tabellen, die denselben Slug deklarieren. Das Schema bricht beim Kompilieren ab; diese Prüfung nennt beide. |
| Plausibilität der `.env` | Ein `JWT_SECRET` mit weniger als 32 Zeichen (womit der Produktionsstart verweigert wird) sowie `NODE_ENV=production` ohne `CORS_ORIGINS` oder `FRONTEND_URL`. Werte werden niemals im Klartext ausgegeben. |
| Versionsunterschiede bei `@rebasepro/*` | Dasselbe Paket ist in verschiedenen `package.json`-Dateien des Projekts auf unterschiedliche Versionen festgelegt. Zwei Kopien führen dazu, dass `instanceof` zwischen ihnen fehlschlägt, da ein Type Guard seinen eigenen Typ zurückweist. |
| Connection-Strings | Ein nicht encodiertes `=` in einem URL-Parameter, das die eigenen Tools von PostgreSQL nicht parsen können — Backups und `psql` schlagen fehl, während die App weiterläuft. |
| Eigene Funktionen | Was jede Funktion von ihrem Host benötigt und welche davon nicht auf einer Edge-Runtime lauffähig wären. |

**Gegen die Datenbank** — die projekteigene Datenbank, aufgelöst wie bei `rebase db url`; bei einem frischen Scaffold ist dies die verwaltete Datenbank, die von `doctor` gestartet wird:

| Prüfung | Grund |
| --- | --- |
| Tabellen → generiertes Schema | Ob `schema.generated.ts` veraltet ist. |
| Tabellen → Datenbank | Fehlende Tabellen, Spalten, Enums, Fremdschlüssel und Zwischentabellen (Junctions). |
| Erforderliche Extensions | Eine `col.vector()`-Spalte erfordert pgvector, welches Rebase nur dort installiert, wo ein Projekt dies deklariert hat. |
| Schema-Stempel | Ob diese Datenbank aus diesen Tabellen bereitgestellt wurde. Ein Hash-Wert, der feststellen kann, dass beide Seiten voneinander abweichen, aber nicht, welche weiter fortgeschritten ist. Ein `v1:`-Stempel aus einer Runtime vor Version 0.31 wird einmalig zusammen mit dem Befehl zur Neuerstellung gemeldet: `rebase db push`. |
| Tabellen → SDK-Typen | Ob das generierte typisierte SDK veraltet ist. |
| RLS-Policies | Ob die Policies der Datenbank mit dem deklarierten `rls` übereinstimmen und ob eine Policy eine Rolle nennt, die dieser Server nicht nutzen kann. |

Ist die Datenbank nicht erreichbar, werden ihre Phasen unter Nennung des Grundes als übersprungen gemeldet, und der Rest wird dennoch ausgeführt — siehe [Fehlerbehebung](/docs/troubleshooting/).

Beendet mit Exit-Code ungleich null, wenn eine Prüfung einen Fehler findet oder wenn eine Phase nicht ausgeführt werden konnte, weil die angegebene Datenbank Verbindungen ablehnt. Eine Phase, die übersprungen wurde, weil keine Datenbank aufgelöst werden konnte, gilt nicht als Fehler.

`rebase doctor --policies` führt ausschließlich die RLS-Prüfungen aus — kein Schema-Diff, keine SDK-Typen — und schlägt bei Unstimmigkeiten fehl (fail-closed), womit es sich ideal als CI-Gate gegen eine deployte Datenbank eignet.

`rebase doctor --database` führt nur den Datenbank-Preflight durch: ob die Rolle, unter der authentifizierte Anfragen laufen, existiert, eingeschränkt ist und zu ihr gewechselt werden kann; welche anderen Logins zu ihr wechseln können; ob sich jede Rolle verbinden darf; und welche Tabellen, Berechtigungen und Policies Rebase mit anderen Rollen teilen würde. Jedes Ergebnis nennt das SQL, das als Administrator auszuführen ist, die `rls`-Einstellung, die Rebase stattdessen an die Datenbank anpasst, oder beides. Es liest den Katalog aus, ändert nichts und beendet mit Exit-Code 1, wenn ein Befund einen Fehler darstellt. Funktioniert auch bei einem Headless-Projekt. Siehe [Betrieb auf einer bestehenden oder geteilten Datenbank](/docs/deployment/existing-database/).

### `rebase verify`

```bash
rebase verify
rebase verify --json
rebase verify --live
rebase verify --live --database-url postgresql://…
```

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Prüft in einem schnellen Befehl für CI und für Hooks von KI-Agents, ob die Tabellen bereit für den Produktiveinsatz sind. Standardmäßig offline und ändert niemals Daten.

| Schritt | Was zum Fehlschlagen führt |
| --- | --- |
| Tabellendefinitionen (`schema`) | `backend/schema` lädt nicht oder kompiliert nicht über den Loader, aus dem das Backend startet: eine Relation zu einer Tabelle, die der Index nicht exportiert, `rls: "inherit"` ohne `defaultRls`, eine Tabelle ohne Primärschlüssel — ein Befund pro Problem. Eine Tabelle ohne `rls` gehört dazu. |
| RLS-Abdeckung (`rls`) | Eine Tabelle mit einer Spalte `user_id`, `owner_id`, `organization_id` oder `tenant_id`, deren Regeln — eigene oder das geerbte `defaultRls` — einer Rolle erlauben, jede Zeile unabhängig davon zu lesen. Eine Warnung. |
| Migrationsaktualität (`migrations`) | Eine Tabelle oder Spalte, die von den Tabellendefinitionen deklariert wird, aber von keiner Datei in `backend/drizzle/migrations` erstellt wird, oder eine entfernte Tabelle/Spalte, die eine Migration weiterhin erstellt. Wird bei Projekten ohne bisherige Migrationen übersprungen. |
| CMS-Anpassungen (`cms`) | Ein Aufruf von `customizeTable(...)` in `frontend/src/cms` (oder im `src/cms` einer statischen App in `rebase.json`), der statisch gelesen nicht zu den Tabellen passt — die Module werden nicht ausgeführt. `cms-unknown-table`: Der Slug nennt keine Tabelle, sodass das Panel ihn ignoriert (der ähnlichste Slug wird vorgeschlagen). `cms-unknown-field`: Ein Schlüssel unter `fields` ist weder Spalte noch Relation (beim SQL-Namen einer Spalte wird der entsprechende Schlüssel zurückgegeben). `cms-hidden-required`: Ein im Formular ausgeblendetes Feld (`hiddenInForm`, `readOnly`, `disabled`), dessen Spalte `NOT NULL` ohne Standardwert ist und vom Server nicht befüllt wird, wodurch das Erstellen eines Datensatzes über das Panel immer fehlschlägt; eine Warnung, falls ein `beforeSave`-Hook oder eine Transformation das Feld füllen könnte, stummgeschaltet durch `filledByServer`. `cms-duplicate-customization`: Ein Slug wurde doppelt angepasst. `cms-not-static` (eine Warnung): Ein Aufruf, dessen Slug, Optionen oder `fields` keine Literale oder `const` aus derselben Datei sind, sodass die Inhalte nicht geprüft werden konnten. `cms-ui-config-not-mounted` (eine Warnung): `frontend/src/cms/ui-config.json` existiert, wird aber nicht an `<RebaseCMS>` als `uiConfig` übergeben. `cms-backend-guard-missing`: Die Vite-Konfiguration des Frontends nutzt `rebaseBackendGuard()` nicht, weshalb `rebase build` den Vorgang ablehnen würde. Ein Headless-Projekt besitzt kein `frontend/src/cms` und überspringt diesen Schritt. |
| Live-RLS-Audit (`live`) | Mit `--live`: Der [`rls-check`](/docs/rls-check)-Katalog gegen die Projektdatenbank und Prüfung, ob jede Migration angewendet wurde. Die Datenbank wird wie bei den `db`-Befehlen aufgelöst — `--database-url`, `DATABASE_URL`, `--docker`, ansonsten die verwaltete Entwicklungsdatenbank. Eine Datenbank, die nicht konfiguriert ist oder nicht antwortet, ist ein Fehler, kein Überspringen: Das Audit wurde explizit angefordert. Eine aus einer Regel `access: "public"` kompilierte `USING (true)`-Read-Policy ist eine Warnung, solange die API ein Token verlangt (`AUTH_REQUIRE`, standardmäßig aktiviert) — jeder angemeldete Benutzer liest jede Zeile — und ein Fehler bei `AUTH_REQUIRE=false`, wodurch Zeilen anonym zugänglich sind. |

`--json` gibt ein einzelnes Objekt aus: `{ ok, schemaDir, steps, findings, summary }`: Jeder Schritt besteht aus `{ id, title, status, detail? }` (`status` ist `passed`, `failed`, `warnings` oder `skipped`), und jeder Befund liefert `step`, `check` (ein stabiler Kebab-Case-Bezeichner), `severity`, `message` und, sofern zutreffend, `fix`, `table`, `file`, `line` sowie den punktseparierten Pfad (`path`) in die Tabelle (`posts.rls[0]`) — sodass ein Agent Fehler selbstständig beheben kann. `summary` zählt `errors` und `warnings`. `--quiet` gibt bei Erfolg nichts aus. Beendet mit Exit-Code ungleich null bei Fehlern; Warnungen führen nicht zum Fehlschlagen.

Ein gescaffoldetes Projekt führt diesen Befehl für Claude Code nach jeder Bearbeitung unter `backend/schema/` aus: siehe [`rebase skills install`](#rebase-skills-install).

### `rebase auth`

Befehle zur Authentifizierungsverwaltung:

```bash
rebase auth reset-password --email admin@example.com --password NewPassword123!
```

### `rebase api-keys`

Verwaltet die Service-API-Schlüssel des Projekts — die Anmeldedaten, die ein Agent, Skript oder ein anderer Dienst anstelle einer Endbenutzer-Sitzung verwendet:

```bash
rebase api-keys list
rebase api-keys get abc123-def456
rebase api-keys create --name "Blog CI" --scopes data:read:posts,data:write:posts --expires-in 90
rebase api-keys create --name "Ops" --full-access --roles admin --expires-at 2027-01-31
rebase api-keys revoke abc123-def456
```

`--scopes` gibt kommagetrennt oder wiederholt an, was der Schlüssel tun darf; `--full-access` gewährt ihm jeden Scope des Service-Keys mit Ausnahme von `keys:*`. `--roles` fügt RLS-Rollen neben `service` hinzu, `--expires-in` akzeptiert Tage und `--expires-at` ein ISO-Datum. `rebase api-keys scopes` listet alle Scopes auf, die dem Backend bekannt sind. Ein Schlüssel wird nur einmalig angezeigt. Es greifen sowohl die Scopes des Schlüssels als auch die Row-Level Security der Identität, unter der er agiert. Siehe [API-Schlüssel](/docs/backend/api-keys/).

### `rebase storage`

Vollständige Wartung gespeicherter Dateien über das laufende Backend mit `REBASE_SERVICE_KEY` aus der `.env`:

```bash
rebase storage orphans                         # Dateien, auf die keine Zeile verweist
rebase storage orphans --source media --delete # und Löschen nach Bestätigung
rebase storage move --from "(default)" --to media --prefix avatars
rebase storage move --from "(default)" --to media --prefix avatars --delete-source
```

`orphans` liest jede Zeile jeder Tabelle im gespeicherten Zustand (einschließlich Soft-Deleted-Zeilen, unter Umgehung aller `beforeQuery`- und `afterRead`-Hooks) sowie jeden [History](/docs/backend/history/)-Eintrag, da ein Revert den vorherigen Inhalt wiederherstellt. Es listet die Dateien einer Quelle (`--source`, standardmäßig die Standardquelle) auf, die in keinem dieser Datensätze per String referenziert werden: als Schlüssel, URL oder `rebase-storage:`-Referenz im Text. Dateien, die neuer als `--older-than` Stunden sind (Standard: 24), werden ausgelassen, da das Admin-Panel eine Datei hochlädt, bevor die referenzierende Zeile gespeichert wird. Der Scan läuft im Backend im Hintergrund, sodass auch ein Projekt fertiggestellt werden kann, das zu groß ist, um innerhalb einer einzigen Anfrage gescannt zu werden (z. B. hinter einem Ingress mit Timeout). Die CLI startet den Scan und zeigt den Fortschritt (aufgelistete Dateien, gelesene Zeilen, abgeschlossene Tabellen und eventuell nicht lesbare Tabellen) bis zum Abschluss an. Bei aktivierter [Job-Queue](/docs/backend/jobs/) ist der Scan ein `storage.orphans`-Job, der von den Job-Workern ausgeführt wird. Ohne Job-Queue läuft der Scan innerhalb des angefragten Serverprozesses, worauf die CLI hinweist: Ein Neustart dieses Prozesses stoppt den Scan. Ein Scan entspricht einem Job-Versuch, begrenzt durch `jobs.timeoutMs` (Standard: 15 Minuten). Erhöhen Sie diesen Wert oder setzen Sie ihn auf 0 für Quellen, die mehr Zeit benötigen. `--json` gibt denselben Bericht wie bisher aus, ergänzt um die `scanId`.

`--delete` erfordert eine Bestätigung vor dem Löschen (`--yes` überspringt die Abfrage und ist ohne Terminal zwingend erforderlich). Es löscht ausschließlich aus dem soeben ausgegebenen Scan und nur innerhalb von 15 Minuten nach dessen Abschluss. Nichts wird gelöscht, solange eine Tabelle nicht gelesen werden kann: Eine Tabelle mit Read-Hooks auf einer Datenbank, deren Treiber diese nicht übersteuern kann, gilt als ungelesen. Vor dem Löschen liest der Server alle Zeilen und History-Einträge erneut gegen die gelisteten Dateien ab. Anschließend wird jede Datei unmittelbar vor dem Löschen nochmals überprüft. Eine Datei, die inzwischen von einer Zeile referenziert wird, seit dem Scan erneut hochgeladen wurde oder nicht mehr existiert, wird beibehalten, und die CLI weist sie als beibehalten aus. Dateien, die ausschließlich von Tabellen referenziert werden, die Rebase nicht bereitstellt, erscheinen als ungenutzt: Prüfen Sie dies vor dem Löschen. Bei einem Backend der Version 0.25.1 oder älter scannt die CLI nach dem alten Verfahren innerhalb eines einzigen Requests.

`move` kopiert die Dateien unter `--prefix` seitenweise unter denselben Schlüsseln in eine andere Quelle. Eine Datei, die am Ziel bereits in identischer Größe vorhanden ist, wird übersprungen, sodass ein unterbrochener Kopiervorgang durch erneutes Ausführen fortgesetzt werden kann; `--delete-source` löscht jede Datei aus der Quelle, sobald das Ziel sie enthält, und wird abgelehnt, wenn beide Quellen denselben Bucket oder dasselbe Verzeichnis nutzen. Nach Abschluss des Verschiebens durchsucht die CLI die Quelle erneut und listet alle Dateien auf, die nicht verschoben wurden: mit `--delete-source` alle verbliebenen Dateien in der Quelle; ohne dieses Flag alle Dateien, für die am Ziel keine Kopie identischer Größe existiert. Existiert eine solche Datei, bricht der Befehl mit Exit-Code 1 ab; ein erneuter Lauf verarbeitet diese Dateien. `--json` gibt sie als `notMoved` aus. Das Lesen eines Scan-Berichts erfordert `database:read`. Das Starten eines Scans, das Löschen und das Verschieben erfordern `database:write`, worüber der Service-Key verfügt.

### `rebase skills install`

Installiert die Rebase-Referenz-Skills für Ihre KI-Coding-Assistenten — für jeden oben genannten Wert unter `--agent`:

```bash
rebase skills install
rebase skills install --agent claude,cursor
rebase skills install --agent all
rebase skills --hooks
```

Unter [Agent Skills](/docs/ai/skills) finden Sie die vollständige Liste sowie die Speicherorte der geschriebenen Dateien.

`--hooks` installiert das Claude Code-Guardrail, das `rebase init` standardmäßig mit jedem Projekt ausliefert: `.claude/hooks/post-edit-collection.sh`, registriert als `PostToolUse`-Hook in `.claude/settings.json`, welcher `rebase verify --quiet` nach jeder Bearbeitung unter `backend/schema/` oder `frontend/src/cms/` ausführt und eventuelle Probleme direkt an den Agent zurückgibt. Bestehende Einstellungen und Hooks bleiben erhalten. `rebase skills --hooks` installiert ausschließlich den Hook.

### `rebase telemetry`

Anonyme Erfassung von Nutzungsdaten — standardmäßig deaktiviert, bis Sie zustimmen. Ein interaktives `rebase init` fragt am Ende nach; die Abfrage ist standardmäßig auf Nein voreingestellt, sodass nichts geteilt wird, sofern Sie nicht explizit mit Ja antworten. Die Entscheidung gilt pro Rechner (`~/.rebase/telemetry.json`): Nach einem Ja fragt `init` nicht mehr nach, nach einem Nein fragt das nächste `init` erneut. Jeder Checkout erhält eine zufällige Projekt-ID, die in der git-ignorierten Datei `.rebase/telemetry-project.json` gespeichert wird.

```bash
rebase telemetry status
rebase telemetry show
rebase telemetry enable
rebase telemetry disable
```

`status` gibt die aktuelle Einstellung aus, `show` zeigt exakt an, was gesendet werden würde — unabhängig davon, ob die Datenübertragung aktiviert ist, sodass Sie die Payload vor einer Entscheidung prüfen können —, und die beiden anderen Befehle ändern die Einstellung. Wenn Sie `init` noch nie ausgeführt haben, wurden zu keinem Zeitpunkt Daten erfasst.

## Nächste Schritte

- **[Schema-Generierung](/docs/cli/schema/#production-workflow)** — Der Migrations-Workflow von der Tabellenbearbeitung bis zur Produktion
- **[Schema as Code](/docs/architecture/schema-as-code)** — Wie die Schema-Generierung funktioniert
- **[Schnellstart](/docs/getting-started/quickstart)** — Erste Schritte mit Rebase
