---
sourceHash: ed5be063323e7f6a
title: CLI-Referenz
sidebar_label: CLI
description: Rebase CLI-Befehle für Projektinitialisierung, Schema-Generierung, Datenbankmigrationen und SDK-Generierung.
---

## Übersicht

Die Rebase CLI (`rebase`) verwaltet Ihr Projekt vom Scaffolding bis zum Deployment.

## Installation

```bash
pnpm add -g @rebasepro/cli
```

Oder führen Sie einen beliebigen Befehl ohne Installation aus: `pnpm dlx @rebasepro/cli <command>`.

## Maschinenlesbare Ausgabe

`--json` ist die entsprechende Option, und außerhalb der `cloud`-Familie ist es die einzige: `rebase status`, `rebase resources`, `rebase apps list`, `rebase upgrade` und `rebase verify` geben dann bei **jedem** Beenden des Befehls einen einzelnen JSON-Wert auf stdout aus — das Ergebnis oder einen `{"error": {"message", "code", "hint", "issues"}}`-Umschlag mit einem Exit-Code ungleich null —, sodass ein Aufrufer stdout bedingungslos parsen kann. Ohne diese Option wird menschenlesbarer Text ausgegeben und Fehler gehen an stderr. `rebase cloud` verwendet denselben Umschlag und ist die einzige Ausnahme: Es schaltet JSON auch automatisch ein, wenn stdout kein TTY ist oder wenn `REBASE_JSON=1` gesetzt ist. Somit liefert `rebase cloud status | cat` JSON, während `rebase status | cat` dies nicht tut — übergeben Sie in einem Skript explizit `--json`, anstatt sich auf eine der beiden Regeln zu verlassen.

## Befehle

### `rebase init`

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Initialisiert ein neues Rebase-Projekt:

```bash
rebase init [directory]
```

Richtet ein `backend/` (die Tabellen in `backend/schema/`) und ein `frontend/` (das Admin-Panel mit seinen Tabellenanpassungen in `frontend/src/cms/`) ein; `--headless` scaffoldet das `backend/` allein, ohne `backend/schema/`. Die [Projektstruktur](/docs/getting-started/project-structure/) zeigt beide Verzeichnisbäume.

| Flag | Funktion |
|---|---|
| `-t, --template <preset>` | `blog`, `ecommerce` oder `blank`. Standard ist `blog` |
| `--headless` | Nur Backend — kein Admin-Panel und kein `backend/schema/`: Der Server stellt die eigenen Tabellen der Datenbank bereit. `--template` hat keine Auswirkung, da keine Tabellen zum Seeden vorhanden sind |
| `-y, --yes` | Niemals nachfragen. **Erforderlich überall dort, wo kein Terminal zur Beantwortung vorhanden ist**, wie z. B. in CI. Überspringt Git-Init und Dependency-Installation — die interaktiven Standardeinstellungen bejahen beides, übergeben Sie also `--git` / `--install`, wenn Sie diese wünschen |
| `-i, --install` | Installiert Abhängigkeiten nach dem Scaffolding. Ohne Flag fragt init nach (Standard: Ja); unter `--yes` wird nichts installiert |
| `--no-install` | Installiert nichts und fragt nicht nach |
| `-g, --git` | Initialisiert ein Repository und erstellt den ersten Commit. Ohne Flag fragt init nach (Standard: Ja); unter `--yes` wird kein Repository erstellt |
| `--database-url <url>` | Verwendet eine bestehende Datenbank anstelle der verwalteten. Es muss eine `postgres://`- oder `postgresql://`-URL sein: Alles andere wird abgelehnt, bevor eine Datei geschrieben wird, und die interaktive Eingabeaufforderung fragt erneut nach |
| `--introspect` | Generiert `backend/schema` aus dieser Datenbank. Impliziert `--template blank` und erfordert `--install` |
| `--project <slug>` | Verknüpft das Scaffold mit einem Rebase Cloud-Projekt |
| `--setup-key <key>` | Der Einmalschlüssel zur Authentifizierung dieser Verknüpfung |
| `-a, --agent <name>` | Richtet KI-Coding-Agenten ein: die [Skills](/docs/ai/skills) und den [MCP-Server](/docs/ai/mcp). Wiederholbar oder kommagetrennt — `claude`, `cursor`, `windsurf`, `gemini`, `codex`, `kiro`, `copilot` oder `all`. Ohne Flag fragt `init` nach und wählt die auf der Maschine installierten Agenten vorab aus; unter `--yes` keine |

### `rebase dev`

Startet den Entwicklungsserver:

```bash
rebase dev
```

Startet sowohl Frontend als auch Backend mit Hot Reloading und generiert das Drizzle-Schema sowie die SDK-Typen (`generated/sdk/`) beim Start und bei jedem Speichern unter `backend/schema/` neu.

Beide Ports werden aus dem Pfad des Projekts abgeleitet, sodass mehrere Rebase-Projekte nebeneinander laufen können. Verwenden Sie die URLs, die `rebase dev` ausgibt. Pinnen Sie einen Port mit `rebase dev --port 3001`.

Eine Bearbeitung von `.env` startet das Backend neu, welches die Datei erneut einliest, ebenso wie das Admin-Panel. Was `rebase dev` selbst setzt, bleibt bis zum Neustart erhalten: `PORT` sowie `DATABASE_URL`, wenn die verwaltete Datenbank oder Docker verwendet wird.

Mit `--database-url` prüft `rebase dev` zuerst, ob unter diesem Host und Port etwas antwortet. Wenn nicht, wird dies unter Nennung des Flags gemeldet und mit `1` beendet, ohne dass etwas gestartet wurde; außerdem bleiben die Datenbanknamen in `.env` unberührt und der Compose-Container wird niemals gestartet.

### `rebase build`

Baut das Projekt in ein deploybares Bundle in `dist-bundle/`:

```bash
rebase build
```

Das Bundle ist das Artefakt, das Sie deployen — das Runtime-Image lädt es, sodass Sie kein eigenes Anwendungs-Image erstellen müssen. Nützliche Flags:

| Flag | Wirkung |
|------|---------|
| `--output <dir>` (oder `--out`) | Schreibt das Bundle an einen anderen Ort als `dist-bundle/` (eine App nach der anderen) |
| `--vendor` | Installiert und liefert die Abhängigkeiten des Bundles immer mit |
| `--no-vendor` | Niemals vendoren; der Pod installiert sie bei jedem Start |
| `--skip-type-check` | Überspringt die Typprüfung (schneller, weniger sicher) |
| `--no-static` | Bindet das Frontend nicht in das Backend-Bundle ein (jede statische App erhält dennoch ihr eigenes Bundle) |
| `--skip-static-build` | Bindet das Frontend im bereits gebauten Zustand ein, ohne dessen Build-Befehl auszuführen |

<span class="since-badge" data-since="0.31">Seit 0.31</span> Ein Frontend, dessen Vite-Konfiguration nicht `rebaseBackendGuard()` (aus `@rebasepro/app/vitePlugin`) verwendet, wird abgelehnt: Dies verhindert, dass Servercode in das Browser-Bundle gelangt. `frontend/src/cms/ui-config.json` wird als `entry.uiConfig` in das Bundle übernommen – die Workspace-Darstellung, die ein deploytes Backend bereitstellt.

Abhängigkeiten werden standardmäßig gevendort, damit eine neue Instanz nicht 35–55 Sekunden für eine Installation benötigt. Ein Verzeichnisbaum, der auf der Festplatte über 2 GB wächst, wird stattdessen verworfen, da das Upload-Limit komprimiert 1 GB beträgt.

Jede statische App, die das Bundle enthält, erhält neben jedem inhaltsgehashten Asset ab 1 KB — den Dateien, die ein Browser ein Jahr lang zwischenspeichert — eine Brotli- (`.br`) und eine Gzip- (`.gz`) Kopie. Die Runtime sendet die Variante, die der Browser akzeptiert, sodass diese Dateien keine Kompressionsarbeit pro Anfrage erfordern (auch nicht beim ersten Aufruf nach einem Deployment), und Browser, die Brotli unterstützen, erhalten dieses (ca. 11 % kleiner als Gzip beim JavaScript des Admins). Die eigene Build-Ausgabe Ihres Frontends bleibt unverändert; nur die Kopie im Bundle ändert sich. Bei der Beispiel-App verlängert dies den Build um weniger als eine Sekunde und vergrößert das Bundle um etwa 2,4 MB.

### `rebase upgrade`

Aktualisiert jedes vom Projekt festgelegte `@rebasepro/*`-Paket auf ein einheitliches Release und installiert anschließend mit dem Paketmanager, den die Lockfile vorgibt. `rebase upgrade` wählt die neueste Version; `--to 0.21.0` eine exakte Version ohne Registry-Lookup; `--to canary` einen Dist-Tag. Jede Versionsbindung in `dependencies`, `devDependencies` und `optionalDependencies` in jeder `package.json` des Projekts behält ihr `^` oder `~`, und nichts anderes in der Datei ändert sich. `peerDependencies` sowie `workspace:`, `link:`, `file:`, Git- und Tag-Spezifikationen werden aufgelistet und unberührt gelassen. Overrides in `pnpm-workspace.yaml` und `package.json` werden ebenfalls aktualisiert, aber ein `link:`- oder `file:`-Override hat Vorrang vor jeder Pinning-Regel: Dies wird gemeldet, und `--drop-local-overrides` entfernt es. `--dry-run` schreibt nichts, `--no-install` überspringt die Installation und `--json` gibt ein einzelnes Dokument aus.

Ein Projekt auf einem Vorab-Release, wie etwa einem Canary, bleibt auf seinem Kanal, es sei denn, `latest` ist neuer. Ein Dist-Tag, der eine festgelegte Version herabstufen würde, wird abgelehnt (`downgrade_refused` unter `--json`), sofern Sie nicht `--allow-downgrade` übergeben; ein exaktes `--to` wird angewendet und als Downgrade gekennzeichnet. Ein `--dry-run` eines Upgrades, das der eigentliche Lauf ablehnen würde, zeigt die potenziellen Änderungen an und beendet mit 0; unter `--json` enthält das Dokument die Ablehnung als `wouldRefuse` (`{ code, message, hint }`).

### `rebase start`

Führt das erstellte Bundle so aus, wie es bei einem Deployment ausgeführt wird:

```bash
rebase start
```

Liest `PORT` und den Rest von `.env`, anders als `rebase dev`, in der darin festgelegten `NODE_ENV`. Ein gescaffoldetes `.env` steht auf `development`, sodass der erste registrierte Account weiterhin zum Admin wird, was `rebase start` zu Beginn anzeigt; setzen Sie `NODE_ENV=production` für einen Produktionsserver. `rebase start --bundle ./dist-bundle` führt ein Bundle an einem anderen Ort aus.

`rebase start` startet keine Datenbank, und das `.env` des Scaffolds enthält keine `DATABASE_URL`. Ein lokaler Lauf auf der von `rebase dev` verwendeten Datenbank lautet daher `DATABASE_URL="$(rebase db url)" rebase start`. Ohne diese Angabe gibt der Befehl diese Zeile vor dem Booten aus.

### `rebase apps list`

Zeigt die von diesem Repository deklarierten Apps an:

```bash
rebase apps list
```

Ein Repository kann mehr als eine deploybare App deklarieren — beispielsweise ein Backend und eine Marketing-Website. So sehen Sie, worauf `rebase build` und das Deployment angewendet werden.

### `rebase eject`

Übernehmen Sie die vollständige Kontrolle über den Serverprozess und sein Image:

```bash
rebase eject
```

Schreibt den Backend-Einstiegspunkt und ein `Dockerfile` in das Projekt und stellt dessen Backend um, sodass das Repository sein eigenes Image baut, anstatt die veröffentlichte Runtime zu verwenden. Von da an **greifen Plattform-Runtime-Upgrades nicht mehr**, und CORS, Auth-Verdrahtung, Storage und Shutdown liegen in Ihrer Verantwortung zur Konfiguration.

Vorschau mit `rebase eject --dry-run`, was die geplanten Änderungen auflistet, ohne etwas zu verändern. `--force` ersetzt ein vorhandenes `backend/src/index.ts` oder `env.ts` und behält die aktuelle Datei als `<name>.bak`.

Der ausgeklinkte Server speichert lokale Uploads im `uploads/`-Ordner des Projekts, unabhängig davon, ob er aus dem Quellcode oder kompiliert ausgeführt wird, genau wie `rebase dev`. Er läuft in `backend/`, sodass ein relativer `STORAGE_PATH` dort ausgehend von `backend/` gelesen wird.

### `rebase schema generate` / `rebase schema stale`

<span class="since-badge" data-since="0.31">Seit 0.31</span>

```bash
rebase schema generate       # backend/schema → backend/src/schema.generated.ts
rebase schema stale          # benennt Abweichungen von den Tabellen, Exit 1 bei Differenzen
rebase schema stale --fix    # generiert die Datei stattdessen neu
```

Jeder Befehl, der das Schema liest, akzeptiert `--schema-dir <dir>` für Projekte, die es an einem anderen Ort aufbewahren; `--collections` wurde entfernt. `rebase dev` hält die Datei aktuell, sodass `stale` die Prüfung für einen Build oder CI darstellt. Siehe [Schema-Generierung](/docs/cli/schema/).

### `rebase db`

```bash
rebase db push                 # Tabellen auf die Datenbank anwenden (Entwicklung)
rebase db generate             # SQL-Migrationsdatei schreiben
rebase db migrate              # ausstehende Migrationen anwenden
rebase db url                  # die von diesem Projekt genutzte Verbindungszeichenfolge ausgeben
rebase db pull --from <url>    # eine andere Datenbank in die lokale kopieren
rebase db backup               # pg_dump; db backups list und db restore daneben
rebase db branch create <name> # eine Arbeitskopie erstellen; auch switch, list und prune
rebase db stop                 # die verwaltete Entwicklungsdatenbank stoppen
rebase db reset                # löschen und von vorne beginnen
rebase db request-role migrate --to <role> # Anfragen auf eine andere Postgres-Rolle umstellen
rebase db provision --print    # das SQL, das die Request-Rolle einrichtet, für einen DBA
```

Jeder dieser Befehle wird unter [Datenbankbefehle](/docs/cli/database/) beschrieben, einschließlich der Reihenfolge, in der ein Befehl seine Datenbank auswählt; `push`, `generate` und `migrate` werden unter [Schema-Generierung](/docs/cli/schema/) ausführlich behandelt.

### `rebase console`

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Eine Node-REPL mit geöffneten Projektdaten oder Ausführung eines einzelnen Snippets mit `-e`:

```bash
rebase console
rebase console -e "rebase.dataAsAdmin.posts.find({ limit: 5 })"
```

`rebase` (`dataAsAdmin`, `sql`, `withAuth(user)`) und `collections` (die Tabellen des Projekts, geladen aus `backend/schema`) befinden sich im Scope, und Top-Level-`await` funktioniert. Die Datenbank wird so aufgelöst wie bei `rebase db push`, und das Öffnen verändert nichts an ihr. Mit `-e` wird das per `await` abgewartete Ergebnis als JSON auf stdout ausgegeben, und ein Fehler führt zu Exit `1`. Flags: `--eval`/`-e`, `--schema-dir`, `--database-url`, `--docker`. Siehe [Skripte und die Konsole](/docs/backend/scripts/).

### `rebase migrate`

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Einweg-Migrationen von einem Layout, das dieses Release nicht mehr unterstützt: `rebase migrate collections-to-tables` (`config/collections` → `backend/schema` und `frontend/src/cms`) sowie `rebase migrate sdk-calls` (`data.collection("x")` → `data.table("x")` in Ihrem eigenen Code). Die zugehörigen Flags, geschriebenen Dateien und der Abschnitt „Vor dem Deployment prüfen“ finden sich unter [Schema-Generierung](/docs/cli/schema/#rebase-migrate).

### `rebase apps init` / `rebase apps config`

```bash
rebase apps list             # die von diesem Projekt deklarierten Apps
rebase apps init             # schreibt eine aus diesem Projekt abgeleitete rebase.json
rebase apps config <app>     # die Client-Konfiguration für eine App
```

`apps init` akzeptiert keinen Namen: Es leitet alle Apps aus dem Projekt ab, schreibt die gesamte `rebase.json` und weigert sich, eine bestehende Datei zu überschreiben, es sei denn, Sie übergeben `--force`.

Ein Namensargument wird abgelehnt. `--force` behält das bei, was die automatische Erkennung nicht aus der zu ersetzenden Datei ermitteln kann: den Namen jeder App, ihren `path` und ihre `cms`-Route. Alles andere wird erneut abgeleitet, und eine deklarierte App, die nicht mehr gefunden wird, wird als entfernt gekennzeichnet, sodass bei einem Scaffold die ursprünglich mitgelieferte `rebase.json` wiederhergestellt wird. Der Build-Befehl der statischen App verwendet den Paketmanager des Projekts.

Bei einem Checkout, der nicht mit einem Cloud-Projekt verknüpft ist, meldet `apps config`, dass keine Verknüpfung besteht (unabhängig davon, ob `rebase dev` läuft oder nicht), und gibt die Backend-URL so aus, wie `rebase dev` sie bereitstellt.

### `rebase status`

Alles, was dieses Projekt deklariert, und ob die Umgebung es tatsächlich anbindet:

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

Drei Dateien bestimmen, was ein Backend erreichen kann, und dieser Befehl gibt alle drei zusammen aus: `rebase.json` definiert, wo sich Ihr Code befindet und wer den Server ausführt, `backend/resources.ts` legt fest, was das Projekt benötigt, und die Umgebung bestimmt, wie jede Komponente erreichbar ist. Alles andere — `rebase.resources.json`, das Bundle-Manifest — wird aus der mittleren Datei für Parser generiert, die Ihren Code nicht ausführen können, und wird niemals manuell geschrieben.

Ein `○` kennzeichnet den Zustand, den man besser vor als nach einem Deployment kennen sollte: deklariert, aber nicht konfiguriert. Ein `✗` bedeutet, dass die Umgebung etwas *falsch* konfiguriert hat, was den Systemstart verweigert, anstatt in einen eingeschränkten Betrieb überzugehen.

Eine `rebase.resources.json`, die nicht mehr mit den Deklarationen übereinstimmt, erhält eine `○`-Zeile. Eine Datei, die noch gar nicht geschrieben wurde, erhält keine: `rebase build` schreibt sie bei jedem Build neu, sodass bei einem Projekt, das noch nie gebaut wurde (wie einem frischen Scaffold), kein Handlungsbedarf besteht.

### `rebase resources`

Was dieses Projekt laut Deklaration benötigt — die Datenbanken, Buckets, Topics und Queues, die `backend/resources.ts` anfordert, sowie die Crons und Funktionen, die seine Dateien definieren:

```bash
rebase resources            # auflisten
rebase resources --write    # rebase.resources.json neu generieren
rebase resources --check    # fehlschlagen, wenn der committete Graph veraltet ist
rebase resources --json     # maschinenlesbar
```

`rebase resources --check` ist das Flag, das ein CI-Job verwendet, um bei einer `rebase.resources.json` fehlzuschlagen, die nicht mehr mit `backend/resources.ts` übereinstimmt. `--json` lässt sich damit kombinieren: Bei Abweichungen beendet `rebase resources --check --json` mit Exit 1 und einem Fehlerumschlag (`resource_graph_missing` oder `resource_graph_stale`), und bei Erfolg enthält der Graph `check.status`. `--write --json` schreibt die Datei und meldet `written.changed`.

Eine Ressource wird in `backend/resources.ts` deklariert — `database("analytics")`, `bucket("media")`, `topic("signups")`, `queue("thumbnails")` — oder ist eine Datei unter `backend/crons` oder `backend/functions`. Sie wird niemals von Hand in `rebase.resources.json` geschrieben, welche aus diesen Deklarationen generiert wird, damit ein Host die Anforderungen eines Projekts ohne Build einsehen kann. Jeder Eintrag protokolliert, wer ihn verwendet (`table:events`, `column:posts.cover`, `function:report`).

Ein Backend verfügt zudem über eine Standarddatenbank und eine Standard-Storage-Quelle, die niemand deklariert. Beide werden hier mit der Kennzeichnung `implicit` aufgeführt und keine von beiden wird in `rebase.resources.json` geschrieben — der Host stellt sie bereit, sodass ihre Erfassung die Bereitstellung von etwas anfordern würde, nach dem niemand verlangt hat. Das Deklarieren einer benannten Ressource wie `bucket("media")` belässt den Standard unverändert, sodass beide aufgeführt werden. Nur das explizite Deklarieren des Standards selbst oder das Kennzeichnen eines Buckets mit `default: true` ersetzt diesen.

Um zu sehen, welche Ressourcen die Plattform für ein Projekt im Vergleich zu den Codedeklarationen vorhält, und um eine bereitgestellte Datenbank zu entfernen, die der Code nicht mehr referenziert, siehe [`rebase cloud resources`](/docs/cli/cloud#resources).

`rebase cloud` — alle Befehle für Rebase Cloud: Authentifizierung, Projektverknüpfung, Deployments, Konfiguration, Datenbanken, Ressourcen, Compute und mehr — hat [eine eigene Dokumentationsseite](/docs/cli/cloud).

### `rebase generate-sdk`

<span class="since-badge" data-since="0.31">Seit 0.31</span>

```bash
rebase generate-sdk
```

Schreibt einen typisierten Client für die Tabellen, die `backend/schema/index.ts` exportiert, nach `generated/sdk/`, mit `TableName` und `tablesDictionary`; `--from <link|url>` liest stattdessen den Vertrag eines laufenden Backends aus. `--register` typisiert zusätzlich serverseitige Daten: Es schreibt die Typen und die `Register`-Deklaration nach `backend/generated/` und hinterlegt dies in `rebase.json` (`registerDatabase`). Siehe [Typisierte serverseitige Daten](/docs/backend/typed-server-data) und [Schema-Generierung](/docs/cli/schema/#rebase-generate-sdk).

### `rebase doctor`

```bash
rebase doctor
```

Der Befehl zur Fehlerdiagnose, wenn etwas nicht funktioniert und die Ursache noch unklar ist. Er erstellt Berichte und nimmt niemals Änderungen vor, sodass er gefahrlos auf jede erreichbare Datenbank angewendet werden kann.

**Ohne Datenbank.** Diese Prüfungen laufen zuerst, da alles, was ein Projekt grundsätzlich am Funktionieren hindert, noch vor dem Tabellenabgleich auftritt:

| Prüfung | Warum |
| --- | --- |
| Node-Version | Abgleich mit dem von der CLI deklarierten Bereich. Eine zu alte Version wird nicht als „nicht unterstütztes Node“ gemeldet — sie äußert sich als Syntaxfehler innerhalb einer Dependency. |
| Paketmanager | Zwei Lockfiles in einem Projekt. Ein `npm install` in einem pnpm-Workspace formatiert `node_modules` in ein Layout um, das pnpm ablehnt; das Symptom ist Stunden später `Cannot find module`. |
| Doppelte Slugs | Zwei Tabellen, die denselben Slug deklarieren. Das Schema verweigert hierbei die Kompilierung, und diese Prüfung nennt beide. |
| `.env`-Plausibilität | Ein `JWT_SECRET`, das kürzer als 32 Zeichen ist (womit der Boot in Produktion verweigert wird), und `NODE_ENV=production` ohne `CORS_ORIGINS` oder `FRONTEND_URL`. Werte werden niemals ausgegeben. |
| Versionsunterschiede bei `@rebasepro/*` | Dasselbe Paket, das in verschiedenen `package.json`-Dateien des Projekts auf unterschiedliche Versionen gepinnt ist. Zwei Kopien brechen das Zusammenspiel via `instanceof`, was dazu führt, dass ein Type Guard seinen eigenen Typ zurückweist. |
| Verbindungszeichenfolgen | Ein unkodiertes `=` in einem URL-Parameter, das die bordeigenen Werkzeuge von PostgreSQL nicht parsen können — wodurch Backups und `psql` fehlschlagen, während die App weiterläuft. |
| Eigene Funktionen | Was jede Funktion von ihrem Host verlangt, und welche davon auf einer Edge-Runtime nicht lauffähig wären. |

**Gegen die Datenbank** — die projekteigene, aufgelöst nach der Logik von `rebase db url`; bei einem frischen Scaffold handelt es sich um die verwaltete Datenbank, die `doctor` startet:

| Prüfung | Warum |
| --- | --- |
| Tabellen → generiertes Schema | Ob `schema.generated.ts` veraltet ist. |
| Tabellen → Datenbank | Fehlende Tabellen, Spalten, Enums, Fremdschlüssel und Verknüpfungen (Junctions). |
| Erforderliche Extensions | Eine `col.vector()`-Spalte erfordert pgvector, welches Rebase nur dort installiert, wo ein Projekt dies deklariert hat. |
| Schemastempel | Ob diese Datenbank aus diesen Tabellen bereitgestellt wurde. Ein Hash, der erkennen lässt, dass beide voneinander abweichen, jedoch niemals, welche Version neuer ist. Ein `v1:`-Stempel aus einer Runtime vor 0.31 wird einmalig mit dem Hinweis auf die Neustempelung gemeldet: `rebase db push`. |
| Tabellen → SDK-Typen | Ob das generierte typisierte SDK veraltet ist. |
| RLS-Policies | Ob die Policies der Datenbank mit dem deklarierten `rls` übereinstimmen und ob eine Policy eine Rolle nennt, die dieser Server nicht verwenden kann. |

Ist die Datenbank nicht erreichbar, werden deren Phasen mit entsprechendem Grund als übersprungen markiert und der Rest läuft dennoch durch — siehe [Fehlerbehebung](/docs/troubleshooting/).

Beendet mit einem Exit-Code ungleich null, wenn eine Prüfung einen Fehler findet oder wenn eine Phase nicht ausgeführt werden konnte, weil die angegebene Datenbank Verbindungen ablehnt. Eine Phase, die übersprungen wurde, weil keine Datenbank aufgelöst werden konnte, gilt nicht als Fehler.

`rebase doctor --policies` führt nur die RLS-Prüfungen aus — kein Schemadiff, keine SDK-Typen — und schlägt im Zweifelsfall fehl („fail closed“), was es zur idealen Variante für ein CI-Gate gegen eine deployte Datenbank macht.

`rebase doctor --database` führt ausschließlich den Datenbank-Preflight aus: ob die Rolle existiert, unter der angemeldete Anfragen laufen, ob sie eingeschränkt ist und zu ihr gewechselt werden kann, welche anderen Logins zu ihr wechseln können, ob jede Rolle eine Verbindung herstellen darf und welche Tabellen, Berechtigungen und Policies Rebase mit anderen Rollen teilen würde. Jedes Ergebnis gibt das SQL an, das als Administrator auszuführen ist, die `rls`-Einstellung, die Rebase stattdessen an die Datenbank anpasst, oder beides. Es liest den Systemkatalog und ändert nichts; bei einem Fehler beendet der Befehl mit Exit 1. Funktioniert auch bei Headless-Projekten. Siehe [Betrieb auf einer bestehenden oder geteilten Datenbank](/docs/deployment/existing-database/).

### `rebase verify`

```bash
rebase verify
rebase verify --json
rebase verify --live
rebase verify --live --database-url postgresql://…
```

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Prüft in einem schnellen Befehl für CI und für Hooks von KI-Agenten, ob die Tabellen bereit für das Deployment sind. Standardmäßig offline und nimmt niemals Änderungen vor.

| Schritt | Was zum Fehlschlagen führt |
| --- | --- |
| Tabellendefinitionen (`schema`) | `backend/schema` lädt nicht oder kompiliert nicht über den Loader, den das Backend zum Booten nutzt: eine Relation zu einer Tabelle, die der Index nicht exportiert, `rls: "inherit"` ohne `defaultRls`, eine Tabelle ohne Primärschlüssel — ein Befund pro Problem. Eine Tabelle ohne `rls` ist einer davon. |
| RLS-Abdeckung (`rls`) | Eine Tabelle mit einer Spalte `user_id`, `owner_id`, `organization_id` oder `tenant_id`, deren Regeln — eigene oder das geerbte `defaultRls` — einer Rolle erlauben, jede Zeile unabhängig davon zu lesen. Eine Warnung. |
| Migrationsaktualität (`migrations`) | Eine Tabelle oder Spalte, die von den Tabellen deklariert wird, aber von keiner Datei in `backend/drizzle/migrations` erstellt wird, oder eine entfernte Tabelle/Spalte, die eine Migration weiterhin erstellt. Wird bei Projekten ohne bisherige Migrationen übersprungen. |
| CMS-Anpassungen (`cms`) | Ein `customizeTable(...)` in `frontend/src/cms` (oder im `src/cms` einer statischen App in `rebase.json`), das nicht zu den Tabellen passt, statisch ausgelesen — die Module werden nicht ausgeführt. `cms-unknown-table`: Der Slug benennt keine Tabelle, sodass das Panel ihn ignoriert (der ähnlichste Slug wird vorgeschlagen). `cms-unknown-field`: Ein Schlüssel unter `fields` ist weder eine Spalte noch eine Relation (auf den SQL-Namen einer Spalte wird mit ihrem Schlüssel geantwortet). `cms-hidden-required`: Ein aus dem Formular ausgeschlossenes Feld (`hiddenInForm`, `readOnly`, `disabled`), dessen Spalte `NOT NULL` ohne Standardwert ist und vom Server nicht befüllt wird, wodurch das Erstellen eines Eintrags über das Panel stets fehlschlägt; eine Warnung, wenn ein `beforeSave`-Hook oder eine Transformation es füllen könnte, und unterdrückt durch `filledByServer`. `cms-duplicate-customization`: Ein Slug wurde doppelt angepasst. `cms-not-static` (eine Warnung): Ein Aufruf, dessen Slug, Optionen oder `fields` keine Literale oder ein `const` derselben Datei sind, sodass darin nichts geprüft werden konnte. `cms-ui-config-not-mounted` (eine Warnung): `frontend/src/cms/ui-config.json` existiert, wird aber `<RebaseCMS>` nicht als `uiConfig` übergeben. `cms-backend-guard-missing`: Die Vite-Konfiguration des Frontends verwendet kein `rebaseBackendGuard()`, sodass `rebase build` die Ausführung verweigern würde. Ein Headless-Projekt besitzt kein `frontend/src/cms` und überspringt diesen Schritt. |
| Live-RLS-Audit (`live`) | Mit `--live`: Der [`rls-check`](/docs/rls-check)-Katalog gegen die Datenbank des Projekts und die Prüfung, ob jede Migration angewendet wurde. Die Datenbank wird wie bei den `db`-Befehlen aufgelöst — `--database-url`, `DATABASE_URL`, `--docker`, andernfalls die verwaltete Entwicklungsdatenbank. Eine nicht konfigurierte oder nicht antwortende Datenbank ist ein Fehler, kein Überspringen: Das Audit wurde explizit angefordert. Eine aus einer `access: "public"`-Regel kompilierte `USING (true)`-Lese-Policy ist eine Warnung, solange die API ein Token verlangt (`AUTH_REQUIRE`, standardmäßig aktiv) — jeder angemeldete Benutzer liest jede Zeile — und ein Fehler bei `AUTH_REQUIRE=false`, wo die Zeilen anonym zugänglich sind. |

`--json` gibt ein einzelnes Objekt aus, `{ ok, schemaDir, steps, findings, summary }`: Jeder Schritt ist `{ id, title, status, detail? }` (`status` ist `passed`, `failed`, `warnings` oder `skipped`), und jeder Befund enthält `step`, `check` (ein stabiler Kebab-Case-Bezeichner), `severity`, `message` und, sofern zutreffend, `fix`, `table`, `file`, `line` sowie den punktseparierten Pfad `path` in die Tabelle (`posts.rls[0]`) — damit ein Agent Fehler selbstständig beheben kann. `summary` zählt `errors` und `warnings`. `--quiet` gibt nichts aus, wenn alles erfolgreich durchläuft. Beendet bei einem Fehler mit einem Exit-Code ungleich null; Warnungen führen nicht zum Abbruch.

Ein gescaffoldetes Projekt führt diesen Befehl für Claude Code nach jeder Bearbeitung unter `backend/schema/` aus: siehe [`rebase skills install`](#rebase-skills-install).

### `rebase auth`

Befehle zur Authentifizierungsverwaltung:

```bash
rebase auth reset-password --email admin@example.com --password NewPassword123!
```

### `rebase api-keys`

Verwaltet die Service-API-Schlüssel des Projekts — die Anmeldedaten, die ein Agent, Skript oder ein anderer Dienst verwendet, im Gegensatz zur Sitzung eines Endbenutzers:

```bash
rebase api-keys list
rebase api-keys get abc123-def456
rebase api-keys create --name "Blog CI" --scopes data:read:posts,data:write:posts --expires-in 90
rebase api-keys create --name "Ops" --full-access --roles admin --expires-at 2027-01-31
rebase api-keys revoke abc123-def456
```

`--scopes` benennt kommagetrennt oder wiederholt die erlaubten Aktionen des Schlüssels; `--full-access` gewährt jeden Scope, den der Service-Schlüssel besitzt, mit Ausnahme von `keys:*`. `--roles` fügt neben `service` RLS-Rollen hinzu, `--expires-in` akzeptiert Tage und `--expires-at` ein ISO-Datum. `rebase api-keys scopes` listet alle Scopes auf, die dem Backend bekannt sind. Ein Schlüssel wird nur einmal angezeigt. Sowohl die Scopes des Schlüssels als auch die Row-Level-Security der Identität, als die er agiert, finden Anwendung. Siehe [API-Schlüssel](/docs/backend/api-keys/).

### `rebase storage`

Umfassende Wartung gespeicherter Dateien über das laufende Backend mit `REBASE_SERVICE_KEY` aus `.env`:

```bash
rebase storage orphans                         # Dateien, die von keiner Zeile referenziert werden
rebase storage orphans --source media --delete # und diese nach Bestätigung löschen
rebase storage move --from "(default)" --to media --prefix avatars
rebase storage move --from "(default)" --to media --prefix avatars --delete-source
```

`orphans` liest jede Zeile jeder Tabelle im gespeicherten Zustand (einschließlich Soft-Deleted-Zeilen, unter Umgehung aller `beforeQuery`- und `afterRead`-Hooks) und jeden [History](/docs/backend/history/)-Eintrag, da ein Revert dessen Inhalt wiederherstellt. Es listet die Dateien einer Quelle auf (`--source`, standardmäßig die Standardquelle), die von keinem String in diesen Datensätzen referenziert werden: weder als Schlüssel, URL noch als `rebase-storage:`-Referenz in einem Text. Dateien, die jünger als `--older-than` Stunden sind (standardmäßig 24), werden ausgelassen, da das Admin-Panel eine Datei hochlädt, bevor die referenzierende Zeile gespeichert wird. Der Scan läuft auf dem Backend im Hintergrund, sodass auch ein Projekt, das zu groß für einen einzelnen Request ist (etwa hinter einem Ingress mit Timeout), erfolgreich abgeschlossen wird. Die CLI startet den Scan und zeigt dessen Fortschritt an (aufgelistete Dateien, gelesene Zeilen, abgeschlossene Tabellen und solche, die nicht gelesen werden konnten), bis er beendet ist. Bei aktivierter [Job-Queue](/docs/backend/jobs/) ist der Scan ein `storage.orphans`-Job, den die Job-Worker verarbeiten. Ohne Queue läuft der Scan innerhalb des angefragten Serverprozesses, worauf die CLI hinweist: Ein Neustart dieses Prozesses bricht den Scan ab. Ein Scan entspricht einem Job-Versuch, begrenzt durch `jobs.timeoutMs` (standardmäßig 15 Minuten). Erhöhen Sie diesen Wert oder setzen Sie ihn für Quellen, die länger benötigen, auf 0. `--json` gibt denselben Bericht wie zuvor aus, zuzüglich seiner `scanId`.

`--delete` verlangt vor dem Löschen eine Bestätigung (`--yes` überspringt die Nachfrage und ist ohne Terminal erforderlich). Es löscht ausschließlich Dateien aus dem soeben ausgegebenen Scan und nur innerhalb von 15 Minuten nach dessen Abschluss. Es wird nichts gelöscht, solange eine Tabelle nicht gelesen werden kann: Eine Tabelle mit Read-Hooks auf einer Datenbank, deren Treiber diese nicht umgehen kann, gilt als ungelesen. Vor dem Löschen liest der Server alle Zeilen und History-Einträge erneut gegen die gelisteten Dateien ab. Anschließend prüft er jede Datei unmittelbar vor dem Löschen nochmals. Eine Datei, die inzwischen von einer Zeile referenziert wird, seit dem Scan erneut hochgeladen wurde oder bereits fehlt, bleibt erhalten, und die CLI weist sie als beibehalten aus. Dateien, die ausschließlich von Tabellen referenziert werden, die Rebase nicht bereitstellt, wirken ungenutzt: Prüfen Sie dies vor dem Löschen. Bei einem Backend von 0.25.1 oder älter scannt die CLI nach dem alten Verfahren innerhalb eines einzelnen Requests.

`move` kopiert die Dateien unter `--prefix` seitenweise unter denselben Schlüsseln in eine andere Quelle. Eine Datei, die im Ziel bereits in identischer Größe vorliegt, wird übersprungen, sodass ein abgebrochener Vorgang durch erneute Ausführung fortgesetzt werden kann; `--delete-source` löscht jede Datei aus der Quelle, sobald sie im Ziel vorhanden ist, wird jedoch abgelehnt, wenn beide Quellen denselben Bucket oder dasselbe Verzeichnis nutzen. Nach Abschluss des Verschiebens listet die CLI die Quelle mit einem erneuten Durchlauf auf und nennt jede Datei, die nicht verschoben wurde: bei `--delete-source` jede verbliebene Datei in der Quelle; ohne dieses Flag jede Datei, für die im Ziel keine Kopie identischer Größe existiert. Werden solche Dateien gefunden, beendet der Befehl mit Exit 1; ein erneuter Aufruf greift diese auf. `--json` gibt sie als `notMoved` aus. Das Lesen eines Scan-Berichts erfordert `database:read`. Das Starten eines Scans, das Löschen und das Verschieben erfordern `database:write`, was der Service-Schlüssel besitzt.

### `rebase skills install`

Installiert die Rebase-Referenz-Skills für Ihre KI-Coding-Assistenten — für jedes oben genannte `--agent`:

```bash
rebase skills install
rebase skills install --agent claude,cursor
rebase skills install --agent all
rebase skills --hooks
```

Siehe [Agent-Skills](/docs/ai/skills) für die vollständige Liste und die Speicherorte der Dateien.

`--hooks` installiert das Claude Code-Guardrail, das `rebase init` mit jedem Projekt ausliefert: `.claude/hooks/post-edit-collection.sh`, registriert als `PostToolUse`-Hook in `.claude/settings.json`. Dieser führt nach jeder Bearbeitung unter `backend/schema/` oder `frontend/src/cms/` `rebase verify --quiet` aus und meldet eventuelle Probleme direkt an den Agenten zurück. Bestehende Einstellungen und Hooks bleiben erhalten. `rebase skills --hooks` installiert ausschließlich den Hook.

### `rebase telemetry`

Anonyme Erfassung von Nutzungsdaten, deaktiviert bis zu Ihrer Zustimmung. Ein interaktives `rebase init` fragt am Ende nach; die Standardantwort ist Nein, sodass ohne ausdrückliche Zustimmung nichts übertragen wird. Die Entscheidung gilt pro Maschine (`~/.rebase/telemetry.json`): Nach einem Ja fragt `init` nicht mehr nach, nach einem Nein fragt das nächste `init` erneut. Jeder Checkout erhält eine zufällige Projekt-ID, die in der gitignorierten Datei `.rebase/telemetry-project.json` gespeichert wird.

```bash
rebase telemetry status
rebase telemetry show
rebase telemetry enable
rebase telemetry disable
```

`status` gibt die aktuelle Einstellung aus, `show` zeigt exakt die Daten, die gesendet würden — unabhängig davon, ob die Übertragung aktiviert ist, sodass Sie den Payload vorab prüfen können —, und die beiden anderen Befehle ändern die Einstellung. Wenn Sie `init` nie ausgeführt haben, wurden zu keinem Zeitpunkt Daten erfasst.

## Nächste Schritte

- **[Schema-Generierung](/docs/cli/schema/#production-workflow)** — Der Migrations-Workflow, von der Tabellenbearbeitung bis zur Produktion
- **[Schema as Code](/docs/architecture/schema-as-code)** — Funktionsweise der Schema-Generierung
- **[Schnellstart](/docs/getting-started/quickstart)** — Erste Schritte
