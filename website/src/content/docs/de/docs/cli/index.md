---
sourceHash: 0dca906999fefc66
title: CLI-Referenz
sidebar_label: CLI
description: Rebase-CLI-Befehle für die Projektinitialisierung, Schema-Generierung, Datenbankmigrationen und SDK-Generierung.
---

## Übersicht

Die Rebase-CLI (`rebase`) verwaltet Ihr Projekt vom Scaffolding bis zum Deployment.

## Installation

```bash
pnpm add -g @rebasepro/cli
```

Oder führen Sie jeden Befehl aus, ohne ihn zu installieren: `pnpm dlx @rebasepro/cli <command>`.

## Maschinenlesbare Ausgabe

`--json` ist der Schalter, und außerhalb der `cloud`-Befehlsfamilie der einzige: `rebase status`, `rebase resources`, `rebase apps list`, `rebase upgrade` und `rebase verify` geben dann genau einen JSON-Wert auf stdout aus — das Ergebnis oder einen `{"error": {"message", "code", "hint", "issues"}}`-Umschlag mit einem Exit-Code ungleich null — und zwar bei **jedem** Beenden des Befehls, sodass ein Aufrufer stdout bedingungslos parsen kann. Ohne diesen Schalter schreiben sie menschenlesbaren Text und Fehler gehen nach stderr. `rebase cloud` verwendet denselben Umschlag und bildet die einzige Ausnahme: Es schaltet JSON von selbst ein, wenn stdout kein TTY ist oder wenn `REBASE_JSON=1` gesetzt ist. Daher liefert `rebase cloud status | cat` JSON, während `rebase status | cat` dies nicht tut — übergeben Sie in einem Skript explizit `--json`, anstatt sich auf eine der Regeln zu verlassen.

## Befehle

### `rebase init`

Initialisiert ein neues Rebase-Projekt:

```bash
rebase init [directory]
```

Richtet ein `backend/` (die Tabellen in `backend/schema/`) und ein `frontend/` (das Admin-Panel mit seinen Tabellenanpassungen in `frontend/src/cms/`) ein; `--headless` erstellt nur das Gerüst für das `backend/`, ohne `backend/schema/`. [Projektstruktur](/docs/getting-started/project-structure/) zeigt beide Verzeichnisbäume.

| Flag | Beschreibung |
|---|---|
| `-t, --template <preset>` | `blog`, `ecommerce` oder `blank`. Standard ist `blog` |
| `--headless` | Nur Backend — kein Admin-Panel und kein `backend/schema/`: Der Server stellt die eigenen Tabellen der Datenbank bereit. `--template` hat keine Auswirkung, da keine Tabellen mit Beispieldaten befüllt werden |
| `-y, --yes` | Niemals nachfragen. **Erforderlich überall dort, wo kein Terminal zur Beantwortung vorhanden ist**, wie z. B. in CI. Überspringt Git-Init und die Installation von Abhängigkeiten — die interaktiven Standardeinstellungen bejahen beides, übergeben Sie also `--git` / `--install`, wenn Sie dies wünschen |
| `-i, --install` | Installiert Abhängigkeiten nach dem Scaffolding. Ohne Flag fragt init nach (Standard: Ja); unter `--yes` wird nichts installiert |
| `--no-install` | Installiert nichts und fragt nicht nach |
| `-g, --git` | Initialisiert ein Repository und erstellt den ersten Commit. Ohne Flag fragt init nach (Standard: Ja); unter `--yes` wird kein Repository erstellt |
| `--database-url <url>` | Verwendet eine bestehende Datenbank anstelle der verwalteten. Es muss eine `postgres://`- oder `postgresql://`-URL sein: Alles andere wird abgelehnt, bevor eine Datei geschrieben wird, und die interaktive Eingabeaufforderung fragt erneut nach |
| `--introspect` | Generiert `backend/schema` aus dieser Datenbank. Impliziert `--template blank` und erfordert `--install` |
| `--project <slug>` | Verknüpft das Gerüst mit einem Rebase Cloud-Projekt |
| `--setup-key <key>` | Der Einmalschlüssel, der diese Verknüpfung authentifiziert |
| `-a, --agent <name>` | Richtet KI-Coding-Agents ein: die [Skills](/docs/ai/skills) und den [MCP-Server](/docs/ai/mcp). Wiederholbar oder kommagetrennt — `claude`, `cursor`, `windsurf`, `gemini`, `codex`, `kiro`, `copilot` oder `all`. Ohne Flag fragt `init` nach und wählt auf dem System installierte Agents vorab aus; unter `--yes` keine |

### `rebase dev`

Startet den Entwicklungsserver:

```bash
rebase dev
```

Startet sowohl Frontend als auch Backend mit Hot-Reloading und generiert das Drizzle-Schema sowie die SDK-Typen (`generated/sdk/`) beim Start und bei jedem Speichern unter `backend/schema/` neu.

Beide Ports werden vom Pfad des Projekts abgeleitet, sodass mehrere Rebase-Projekte nebeneinander ausgeführt werden können. Verwenden Sie die URLs, die `rebase dev` ausgibt. Einen Port können Sie mit `rebase dev --port 3001` festlegen.

Eine statische App in `rebase.json` ohne Build-Schritt (kein `build`, und `output` ist ihr `root`, wie etwa eine reine HTML-Website) wird vom Backend aus diesem Verzeichnis unter ihrem `path` bereitgestellt, so wie `rebase start` sie aus dem Bundle bereitstellt, und `FRONTEND_URL` wird darauf gesetzt (auf dem Port des Backends), damit per E-Mail versendete Links dort landen. Eine App mit einem Build-Schritt läuft in Vite auf ihrem eigenen Port, und `FRONTEND_URL` entspricht dem von Vite.

Eine Bearbeitung von `.env` startet das Backend neu, wodurch die Datei wie beim Admin-Panel erneut eingelesen wird. Was `rebase dev` selbst setzt, bleibt bis zum Neustart erhalten: `PORT` und `DATABASE_URL`, wenn die verwaltete Datenbank oder Docker genutzt wird.

Mit `--database-url` prüft `rebase dev` zuerst, ob unter diesem Host und Port etwas antwortet. Wenn nicht, meldet der Befehl dies unter Nennung des Flags und beendet sich mit `1`, ohne etwas gestartet zu haben; er lässt auch die Datenbank-Variablennamen in `.env` unberührt und startet niemals seinen Compose-Container.

### `rebase build`

Baut das Projekt in ein deploybares Bundle in `dist-bundle/`:

```bash
rebase build
```

Das Bundle ist das Artefakt, das Sie deployen — das Runtime-Image lädt es, sodass Sie kein eigenes Anwendungs-Image erstellen müssen. Nützliche Flags:

| Flag | Wirkung |
|------|--------|
| `--output <dir>` (oder `--out`) | Schreibt das Bundle an einen anderen Ort als `dist-bundle/` (eine App nach der anderen) |
| `--vendor` | Installiert und liefert immer die Abhängigkeiten des Bundles mit aus |
| `--no-vendor` | Niemals vendoren; der Pod installiert sie bei jedem Start |
| `--skip-type-check` | Überspringt die Typprüfung (schneller, weniger sicher) |
| `--no-static` | Bindet das Frontend nicht in das Backend-Bundle ein (jede statische App erhält dennoch ihr eigenes Bundle) |
| `--skip-static-build` | Bindet das Frontend im bereits gebauten Zustand ein, ohne dessen Build-Befehl auszuführen |

Ein Frontend — jede statische App in `rebase.json` mit einer Vite-Konfiguration —, dessen Konfiguration nicht `rebaseBackendGuard()` (aus `@rebasepro/app/vitePlugin`) verwendet, wird abgelehnt: Dies hält Servercode aus dem Browser-Bundle fern und verhindert, dass Vite eine Backend-Datei als `data:`-URL inlined (der Build schlägt unter Angabe des Plugins fehl, wenn ein anderes Plugin sein `build.assetsInlineLimit` ersetzt). `frontend/src/cms/ui-config.json` wird als `entry.uiConfig` in das Bundle übernommen — die Workspace-Präsentation, die ein deploytes Backend bereitstellt.

Abhängigkeiten werden standardmäßig gevendort, damit eine neue Instanz nicht 35–55 Sekunden Installationszeit in Anspruch nimmt. Ein Verzeichnisbaum, der auf der Festplatte über 2 GB wächst, wird stattdessen verworfen, da das Upload-Limit komprimiert 1 GB beträgt.

Jede statische App, die das Bundle enthält, erhält neben jedem Content-gehashten Asset ab 1 KB — den Dateien, die ein Browser ein Jahr lang zwischenspeichert — eine Brotli- (`.br`) und eine Gzip-Kopie (`.gz`). Die Runtime sendet die Variante, die der Browser akzeptiert, sodass diese Dateien keine Komprimierungsarbeit pro Anfrage verursachen, einschließlich des ersten Besuchs nach einem Deployment, und Browser, die Brotli akzeptieren, dieses erhalten (bei JavaScript des Admins ca. 11 % kleiner als Gzip). Die eigene Build-Ausgabe Ihres Frontends bleibt unverändert; nur die Kopie im Bundle ändert sich. Bei der Beispiel-App verlängert dies den Build um weniger als eine Sekunde und vergrößert das Bundle um etwa 2,4 MB.

### `rebase upgrade`

Aktualisiert jedes vom Projekt festgelegte `@rebasepro/*`-Paket auf ein Release und installiert es mit dem Paketmanager, den seine Lockdatei vorsieht. `rebase upgrade` wählt die neueste Version; `--to 0.21.0` eine exakte Version ohne Registry-Lookup; `--to canary` einen Dist-Tag. Jeder Eintrag in `dependencies`, `devDependencies` und `optionalDependencies` in jeder `package.json` des Projekts behält sein `^` oder `~`, und sonst ändert sich nichts an der Datei. `peerDependencies` sowie `workspace:`, `link:`, `file:`, Git- und Tag-Spezifikationen werden aufgelistet und unberührt gelassen. Overrides in `pnpm-workspace.yaml` und `package.json` werden ebenfalls aktualisiert, aber ein `link:`- oder `file:`-Override sticht jede Versionsbindung aus: Dies wird gemeldet, und `--drop-local-overrides` entfernt ihn. `--dry-run` schreibt nichts, `--no-install` überspringt die Installation und `--json` gibt ein einzelnes Dokument aus.

Ein Projekt auf einem Vorab-Release, wie einem Canary, bleibt auf seinem Kanal, es sei denn, `latest` ist neuer. Ein Dist-Tag, der eine festgelegte Version zurückstufen würde, wird abgelehnt (`downgrade_refused` unter `--json`), es sei denn, Sie übergeben `--allow-downgrade`; ein exaktes `--to` wird angewendet und als Downgrade gekennzeichnet. Ein `--dry-run` eines Upgrades, das der eigentliche Lauf verweigern würde, zeigt, was verschoben werden würde, und beendet sich mit 0; unter `--json` enthält das Dokument die Verweigerung als `wouldRefuse` (`{ code, message, hint }`).

#### PostgreSQL-Projekt auf Rebase 0.35 aktualisieren

Führen Sie im Projektverzeichnis unter Linux, macOS oder Windows die CLI von Rebase
0.35 aus. Sie ersetzt `@ariga/atlas` im PostgreSQL-Backend durch
`@stokaro/ptah-compat`. Migrationsdateien, `atlas.sum` und erfasste Revisionen
bleiben erhalten.

```bash
pnpm dlx @rebasepro/cli@0.35.0 upgrade --to 0.35.0 # version-pin: ignore
```

### `rebase start`

Führt das erstellte Bundle so aus, wie es bei einem Deployment ausgeführt wird:

```bash
rebase start
```

Liest im Gegensatz zu `rebase dev` den `PORT` und den Rest von `.env` in dem dort gesetzten `NODE_ENV` aus. Ein generiertes `.env` steht auf `development`, daher wird der erste registrierte Account weiterhin zum Admin, und `rebase start` meldet dies oben; setzen Sie `NODE_ENV=production` für einen Produktionsserver. `rebase start --bundle ./dist-bundle` führt ein Bundle an einem anderen Ort aus.

`rebase start` startet keine Datenbank, und das `.env` des Scaffolds enthält keine `DATABASE_URL`. Ein lokaler Lauf auf der von `rebase dev` verwendeten Datenbank lautet daher `DATABASE_URL="$(rebase db url)" rebase start`. Ohne diese Angabe wird diese Zeile vor dem Booten ausgegeben.

### `rebase apps list`

Zeigt die Apps an, die dieses Repository deklariert:

```bash
rebase apps list
```

Ein Repository kann mehr als eine deploybare App deklarieren – beispielsweise ein Backend und eine Marketing-Website. So sehen Sie, worauf sich `rebase build` und das Deployment auswirken werden.

### `rebase eject`

Übernehmen Sie die Kontrolle über den Serverprozess und sein Image:

```bash
rebase eject
```

Schreibt den Backend-Einstiegspunkt und eine `Dockerfile` in das Projekt und stellt dessen Backend um, sodass das Repository sein eigenes Image baut, anstatt die veröffentlichte Runtime auszuführen. Von da an **erreichen Plattform-Runtime-Upgrades das Projekt nicht mehr**, und CORS, Auth-Verdrahtung, Storage und Shutdown müssen von Ihnen selbst konfiguriert werden.

Sehen Sie sich die Vorschau mit `rebase eject --dry-run` an, was auflistet, was sich ändern würde, und nichts verändert. `--force` ersetzt ein vorhandenes `backend/src/index.ts` oder `env.ts` und behält die aktuelle Datei als `<name>.bak`.

Der ausgekoppelte ("ejected") Server speichert lokale Uploads im `uploads/`-Ordner des Projekts, unabhängig davon, ob er aus dem Quellcode oder kompiliert ausgeführt wird, genau wie `rebase dev`. Er läuft in `backend/`, daher wird ein relativer `STORAGE_PATH` dort ausgehend von `backend/` gelesen.

### `rebase schema generate` / `rebase schema stale`

```bash
rebase schema generate       # backend/schema → backend/src/schema.generated.ts
rebase schema stale          # benennt Abweichungen von den Tabellen, Exit 1 falls vorhanden
rebase schema stale --fix    # generiert die Datei stattdessen neu
```

Jeder Befehl, der das Schema liest, akzeptiert `--schema-dir <dir>` für Projekte, die es an anderer Stelle aufbewahren; `--collections` wurde entfernt. `rebase dev` hält die Datei aktuell, daher ist `stale` die Prüfung für einen Build oder CI. Siehe [Schema-Generierung](/docs/cli/schema/).

### `rebase db`

```bash
rebase db push                 # Tabellen auf die Datenbank anwenden (Entwicklung)
rebase db generate             # eine SQL-Migrationsdatei schreiben
rebase db migrate              # ausstehende Migrationen anwenden
rebase db url                  # den von diesem Projekt verwendeten Connection-String ausgeben
rebase db pull --from <url>    # eine andere Datenbank in die lokale kopieren
rebase db backup               # pg_dump; db backups list und db restore daneben
rebase db branch create <name> # eine Arbeitskopie erstellen; auch switch, list und prune
rebase db stop                 # die verwaltete Entwicklungsdatenbank stoppen
rebase db reset                # sie löschen und von vorne beginnen
rebase db request-role migrate --to <role> # Anfragen auf eine andere Postgres-Rolle umstellen
rebase db provision --print    # das SQL, das die Request-Rolle einrichtet, für einen DBA
```

Jeder Befehl wird unter [Datenbank-Befehle](/docs/cli/database/) beschrieben, zusammen mit der Reihenfolge, in der ein Befehl seine Datenbank auswählt; `push`, `generate` und `migrate` werden unter [Schema-Generierung](/docs/cli/schema/) ausführlich behandelt.

### `rebase console`

Eine Node-REPL mit geöffneten Projektdaten oder ein einzelnes Codefragment, das mit `-e` ausgeführt wird:

```bash
rebase console
rebase console -e "rebase.dataAsAdmin.posts.find({ limit: 5 })"
```

`rebase` (`dataAsAdmin`, `sql`, `withAuth(user)`) und `tables` (die aus `backend/schema` geladenen Tabellen des Projekts) befinden sich im Scope, und Top-Level-`await` funktioniert. Die Datenbank wird so aufgelöst, wie `rebase db push` sie auflöst, und das Öffnen ändert nichts an ihr. Mit `-e` wird das erwartete Ergebnis als JSON auf stdout ausgegeben, und ein Fehler führt zum Exit-Code `1`. Flags: `--eval`/`-e`, `--schema-dir`, `--database-url`, `--docker`. Siehe [Skripte und die Konsole](/docs/backend/scripts/).

### `rebase migrate`

Einweg-Migrationen von einem Layout, das dieses Release nicht mehr liest:
`rebase migrate collections-to-tables` (`config/collections` → `backend/schema` und `frontend/src/cms`) und `rebase migrate sdk-calls` (`data.collection("x")` → `data.table("x")` in Ihrem eigenen Code). Deren Flags, was sie schreiben und der Abschnitt "Vor dem Deployment prüfen" sind unter [Schema-Generierung](/docs/cli/schema/#rebase-migrate) zu finden.

### `rebase apps init` / `rebase apps config`

```bash
rebase apps list             # die von diesem Projekt deklarierten Apps
rebase apps init             # eine aus diesem Projekt abgeleitete rebase.json schreiben
rebase apps config <app>     # die Client-Konfiguration für eine App
```

`apps init` nimmt keinen Namen entgegen: Es leitet jede App aus dem Projekt ab, schreibt die gesamte `rebase.json` und verweigert das Ersetzen einer vorhandenen Datei, sofern Sie nicht `--force` übergeben.

Ein Namensargument wird abgelehnt. `--force` behält bei, was die Ableitung aus der ersetzten Datei nicht wissen kann: den Namen jeder App, ihren `path` und ihre `cms`-Route. Alles andere wird erneut abgeleitet, und eine deklarierte App, die nicht mehr gefunden wird, wird als entfernt gekennzeichnet, sodass bei einem Scaffold die `rebase.json` wiederhergestellt wird, die mit dem Scaffold ausgeliefert wurde. Der Build-Befehl der statischen App verwendet den Paketmanager des Projekts.

Bei einem Checkout, der nicht mit einem Cloud-Projekt verknüpft ist, meldet `apps config`, dass keine Verknüpfung besteht (unabhängig davon, ob `rebase dev` läuft oder nicht), und gibt die Backend-URL so an, wie `rebase dev` sie bereitstellt.

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

Drei Dateien bestimmen, was ein Backend erreichen kann, und dieser Befehl gibt alle drei zusammen aus: `rebase.json` gibt an, wo sich Ihr Code befindet und wer den Server ausführt, `backend/resources.ts` deklariert, was das Projekt benötigt, und die Umgebung gibt an, wie jedes Element erreicht werden kann. Alles andere — `rebase.resources.json`, das Bundle-Manifest — wird aus der mittleren Datei für Ausleser generiert, die Ihren Code nicht ausführen können, und wird von Ihnen niemals manuell geschrieben.

Ein `○` markiert den Zustand, den man besser vor als nach einem Deployment kennen sollte: deklariert, nicht konfiguriert. Ein `✗` bedeutet, dass die Umgebung etwas *falsch* setzt, was den Systemstart verweigert, anstatt in einen reduzierten Modus überzugehen.

Eine `rebase.resources.json`, die nicht mehr mit den Deklarationen übereinstimmt, erhält eine `○`-Zeile. Eine, die noch nicht geschrieben wurde, tut dies nicht: `rebase build` schreibt sie bei jedem Build, sodass ein Projekt, das noch nie gebaut wurde (wie ein frischer Scaffold), nichts zu beheben hat.

### `rebase resources`

Was dieses Projekt an Ressourcen deklariert — die Datenbanken, Buckets, Topics und Queues, die `backend/resources.ts` anfordert, sowie die Crons und Funktionen, die seine Dateien definieren:

```bash
rebase resources            # auflisten
rebase resources --write    # rebase.resources.json neu generieren
rebase resources --check    # fehlschlagen, wenn der committete Graph veraltet ist
rebase resources --json     # maschinenlesbar
```

`rebase resources --check` ist das Flag, das ein CI-Job verwendet, um bei einer `rebase.resources.json` fehlzuschlagen, die nicht mehr mit `backend/resources.ts` übereinstimmt. `--json` lässt sich damit kombinieren: Bei Abweichungen beendet sich `rebase resources --check --json` mit Exit-Code 1 und einem Fehler-Umschlag (`resource_graph_missing` oder `resource_graph_stale`), und bei Erfolg enthält der Graph `check.status`. `--write --json` schreibt die Datei und meldet `written.changed`.

Eine Ressource wird in `backend/resources.ts` deklariert — `database("analytics")`, `bucket("media")`, `topic("signups")`, `queue("thumbnails")` — oder ist eine Datei unter `backend/crons` oder `backend/functions`. Sie wird niemals manuell in `rebase.resources.json` geschrieben, da diese Datei aus jenen Deklarationen generiert wird, damit ein Host auslesen kann, was ein Projekt benötigt, ohne es bauen zu müssen. Jeder Eintrag zeichnet auf, wer ihn verwendet (`table:events`, `column:posts.cover`, `function:report`).

Ein Backend verfügt außerdem über eine Standarddatenbank und eine Standard-Storage-Quelle, die niemand deklariert. Beide werden hier aufgeführt, als `implicit` markiert und keine von beiden wird in `rebase.resources.json` geschrieben — der Host stellt sie bereit, sodass ihre Erfassung das Provisionieren von etwas anfordern würde, nach dem niemand gefragt hat. Das Deklarieren einer benannten Ressource wie `bucket("media")` belässt den Standard dort, wo er ist, sodass beide aufgeführt werden. Nur das Deklarieren des Standards selbst oder das Markieren eines Buckets mit `default: true` ersetzt diesen.

Um zu sehen, was die Plattform für ein Projekt im Vergleich zu dem vorhält, was ihr Code deklariert, und um eine provisionierte Datenbank zu entfernen, die der Code nicht mehr nennt, siehe [`rebase cloud resources`](/docs/cli/cloud#resources).

`rebase cloud` — jeder Befehl für Rebase Cloud: Authentifizierung, Projektverknüpfung, Deployments, Konfiguration, Datenbanken, Ressourcen, Compute und mehr — hat [eine eigene Seite](/docs/cli/cloud).

### `rebase generate-sdk`

```bash
rebase generate-sdk
```

Schreibt einen typisierten Client für die von `backend/schema/index.ts` exportierten Tabellen nach `generated/sdk/`, mit `TableName` und `tablesDictionary`; `--from <link|url>` liest stattdessen den Vertrag eines laufenden Backends. `--register` typisiert auch serverseitige Daten: Es schreibt die Typen und die `Register`-Deklaration nach `backend/generated/` und vermerkt dies in `rebase.json` (`registerDatabase`). Siehe [Typisierte serverseitige Daten](/docs/backend/typed-server-data) und [Schema-Generierung](/docs/cli/schema/#rebase-generate-sdk).

### `rebase doctor`

```bash
rebase doctor
```

Der Befehl, den Sie ausführen sollten, wenn etwas nicht stimmt und Sie noch nicht wissen, was es ist. Er berichtet nur und ändert niemals etwas, sodass er für jede Datenbank, die Sie erreichen können, sicher ist.

**Ohne Datenbank.** Diese Prüfungen laufen zuerst, da alles, was ein Projekt daran hindert, überhaupt zu funktionieren, passiert, bevor eine Tabelle verglichen werden kann:

| Prüfung | Warum |
| --- | --- |
| Node-Version | Abgleich mit dem Bereich, den die CLI deklariert. Eine zu alte Version wird nicht als "nicht unterstütztes Node" gemeldet — sie äußert sich als Syntaxfehler innerhalb einer Abhängigkeit. |
| Paketmanager | Zwei Lockdateien in einem Projekt. `npm install` in einem pnpm-Workspace schreibt `node_modules` in ein Layout um, mit dem pnpm nicht übereinstimmt; das Symptom ist Stunden später `Cannot find module`. |
| Doppelte Slugs | Zwei Tabellen, die denselben Slug deklarieren. Das Schema verweigert die Kompilierung, und dies benennt beide. |
| `.env`-Plausibilität | Ein `JWT_SECRET`, das kürzer als 32 Zeichen ist (wodurch die Produktion den Start verweigert), und `NODE_ENV=production` ohne `CORS_ORIGINS` oder `FRONTEND_URL`. Werte werden niemals ausgegeben. |
| Versionsabweichung bei `@rebasepro/*` | Dasselbe Paket ist in verschiedenen `package.json`-Dateien des Projekts auf unterschiedliche Versionen festgelegt. Zwei Kopien beschädigen `instanceof` zwischen ihnen, was als Type-Guard fehlschlägt und seinen eigenen Typ ablehnt. |
| Connection-Strings | Ein nicht-encodetes `=` in einem URL-Parameter, dessen Parsing die PostgreSQL-eigenen Tools verweigern — Backups und `psql` schlagen fehl, während die App weiter funktioniert. |
| Eigene Funktionen | Was jede Funktion von ihrem Host benötigt und welche davon auf einer Edge-Runtime nicht laufen würden. |

**Gegen die Datenbank** — die eigene des Projekts, aufgelöst wie von `rebase db url`; bei einem frischen Scaffold ist dies die verwaltete Datenbank, die `doctor` startet:

| Prüfung | Warum |
| --- | --- |
| Tabellen → generiertes Schema | Ob `schema.generated.ts` veraltet ist. |
| Tabellen → Datenbank | Fehlende Tabellen, Spalten, Enums, Fremdschlüssel und Verknüpfungen (Junctions). |
| Erforderliche Extensions | Eine `col.vector()`-Spalte benötigt pgvector, das Rebase nur dort installiert, wo ein Projekt es deklariert hat. |
| Schema-Stamp | Ob diese Datenbank aus diesen Tabellen provisioniert wurde. Ein Hash, der aussagt, dass beide nicht übereinstimmen, aber nie, welches weiter fortgeschritten ist. Ein `v1:`-Stamp von einer Runtime vor 0.31 wird einmalig gemeldet, zusammen mit dem Befehl zur Neuerstellung: `rebase db push`. |
| Tabellen → SDK-Typen | Ob das generierte typisierte SDK veraltet ist. |
| RLS-Policies | Ob die Policies der Datenbank mit dem von Ihnen deklarierten `rls` übereinstimmen und ob eine Policy eine Rolle nennt, die dieser Server nicht verwenden kann. |

Ist die Datenbank nicht erreichbar, werden deren Phasen als übersprungen mit Angabe des Grundes gemeldet und der Rest läuft weiter — siehe [Fehlerbehebung](/docs/troubleshooting/).

Beendet sich mit einem Exit-Code ungleich null, wenn eine Prüfung einen Fehler findet oder wenn eine Phase nicht ausgeführt werden konnte, weil die angegebene Datenbank Verbindungen ablehnt. Eine Phase, die übersprungen wurde, weil keine Datenbank aufgelöst werden konnte, gilt nicht als Fehler.

`rebase doctor --policies` führt nur die RLS-Prüfungen aus — kein Schema-Diff, keine SDK-Typen — und schlägt im Zweifelsfall fehl ("fails closed"), was es zur idealen Variante als CI-Gate gegen eine deployte Datenbank macht.

`rebase doctor --database` führt nur den Datenbank-Preflight aus: ob die Rolle, unter der authentifizierte Anfragen laufen, existiert, eingeschränkt ist und zu ihr gewechselt werden kann; welche anderen Logins zu ihr wechseln können; ob jede Rolle eine Verbindung herstellen darf; und welche Tabellen, Grants und Policies Rebase mit anderen Rollen teilen würde. Jeder Befund nennt das SQL, das als Administrator ausgeführt werden muss, die `rls`-Einstellung, die Rebase stattdessen an die Datenbank anpasst, oder beides. Der Befehl liest den Katalog, ändert nichts und beendet sich mit 1, wenn ein Befund ein Fehler ist. Er funktioniert auch bei einem Headless-Projekt. Siehe [Ausführung auf einer bestehenden oder geteilten Datenbank](/docs/deployment/existing-database/).

### `rebase verify`

```bash
rebase verify
rebase verify --json
rebase verify --live
rebase verify --live --database-url postgresql://…
```

Prüft in einem schnellen Befehl für CI und für Hooks von KI-Agents, ob die Tabellen sicher für das Release sind. Standardmäßig offline und ändert niemals etwas.

| Schritt | Was ihn fehlschlagen lässt |
| --- | --- |
| Tabellendefinitionen (`schema`) | `backend/schema` lädt nicht oder kompiliert nicht über den Loader, von dem aus das Backend bootet: eine Relation zu einer Tabelle, die der Index nicht exportiert, `rls: "inherit"` ohne `defaultRls`, eine Tabelle ohne Primärschlüssel — ein Befund pro Problem. Eine Tabelle ohne `rls` ist eines davon. |
| RLS-Abdeckung (`rls`) | Eine Tabelle mit einer Spalte `user_id`, `owner_id`, `organization_id` oder `tenant_id`, deren Regeln — die eigenen oder das geerbte `defaultRls` — einer Rolle erlauben, jede Zeile ungeachtet dessen zu lesen. Eine Warnung. `rls-policy-recursion`: eine Regel, die ihre eigene Tabelle in einer Unterabfrage liest, oder zwei Tabellen, deren Regeln sich gegenseitig lesen, was Postgres nicht expandieren kann, sodass jede geschützte Anweisung mit `42P17 infinite recursion detected in policy` fehlschlägt; der Befund benennt die gelesene Tabelle und den Fix, nämlich das Verschieben des Lesevorgangs in eine `SECURITY DEFINER`-Funktion. Ein Fehler oder eine Warnung, wenn die Schleife nicht sicher ist. |
| Migrations-Aktualität (`migrations`) | Eine von den Tabellen deklarierte Tabelle oder Spalte, die keine Datei in `backend/drizzle/migrations` erstellt, oder eine gelöschte, die eine Migration immer noch erstellt. Wird bei einem Projekt ohne bisherige Migrationen übersprungen. |
| CMS-Anpassungen (`cms`) | Ein `customizeTable(...)` in `frontend/src/cms` (oder dem `src/cms` einer statischen App in `rebase.json`), das nicht zu den Tabellen passt, statisch gelesen — die Module werden nicht ausgeführt. `cms-unknown-table`: Der Slug nennt keine Tabelle, daher ignoriert das Panel ihn (der ähnlichste Slug wird vorgeschlagen). `cms-unknown-field`: Ein Schlüssel unter `fields` ist weder eine Spalte noch eine Relation (der SQL-Name einer Spalte wird mit ihrem Schlüssel beantwortet). `cms-hidden-required`: Ein vom Formular ferngehaltenes Feld (`hiddenInForm`, `readOnly`, `disabled`), dessen Spalte `NOT NULL` ohne Standardwert ist und vom Server nicht befüllt wird, sodass das Erstellen eines Datensatzes über das Panel immer fehlschlägt; eine Warnung, wenn ein `beforeSave`-Hook oder Transform es möglicherweise füllt, und unterdrückt durch `filledByServer`. `cms-duplicate-customization`: Ein Slug wurde zweimal angepasst. `cms-not-static` (eine Warnung): Ein Aufruf, dessen Slug, Optionen oder `fields` keine Literale oder ein `const` derselben Datei sind, sodass darin nichts geprüft wurde. `cms-ui-config-not-mounted` (eine Warnung): `frontend/src/cms/ui-config.json` existiert, wird aber `<RebaseCMS>` nicht als `uiConfig` übergeben. `cms-backend-guard-missing`: Die Vite-Konfiguration des Frontends verwendet `rebaseBackendGuard()` nicht, daher würde `rebase build` sie ablehnen. Ein Headless-Projekt hat kein `frontend/src/cms` und überspringt diesen Schritt. |
| Live-RLS-Audit (`live`) | Mit `--live`: Der [`rls-check`](/docs/rls-check)-Katalog gegen die Datenbank des Projekts und die Prüfung, ob jede Migration angewendet wurde. Die Datenbank wird so aufgelöst wie bei den `db`-Befehlen — `--database-url`, `DATABASE_URL`, `--docker`, ansonsten die verwaltete Entwicklungsdatenbank. Eine Datenbank, die nicht konfiguriert ist oder nicht antwortet, ist ein Fehler, kein Überspringen: Das Audit wurde explizit angefordert. Eine aus einer `access: "public"`-Regel kompilierte `USING (true)`-Lese-Policy ist eine Warnung, solange die API ein Token verlangt (`AUTH_REQUIRE`, standardmäßig aktiv) — jeder angemeldete Benutzer liest jede Zeile — und ein Fehler bei `AUTH_REQUIRE=false`, wo die Zeilen anonym sind. |

`--json` gibt ein einzelnes Objekt aus, `{ ok, schemaDir, steps, findings, summary }`: Jeder Schritt ist `{ id, title, status, detail? }` (`status` ist `passed`, `failed`, `warnings` oder `skipped`), und jeder Befund enthält `step`, `check` (ein stabiler Kebab-Case-Typ), `severity`, `message` und, falls zutreffend, `fix`, `table`, `file`, `line` sowie den gepunkteten `path` in die Tabelle (`posts.rls[0]`) — sodass ein Agent reparieren kann, was er beschädigt hat. `summary` zählt `errors` und `warnings`. `--quiet` gibt nichts aus, wenn alles erfolgreich durchläuft. Beendet sich bei einem Fehler ungleich null; Warnungen führen nicht zum Fehlschlagen.

Ein gescaffoldetes Projekt führt diesen Befehl für Claude Code nach jeder Bearbeitung unter `backend/schema/` aus: siehe [`rebase skills install`](#rebase-skills-install).

### Befehle für eine laufende App

`rebase api`, `rebase data`, `rebase users`, `rebase cron`, `rebase logs`, `rebase functions`, `rebase rls simulate`, `rebase auth login` und `rebase storage ls|cp|rm|url|stat` agieren über die API auf eine laufende App: das lokale `rebase dev`, einen Server, den Sie mit `--url` angeben, oder ein Rebase Cloud-Projekt mit `--project`. Siehe [Eine laufende App](/docs/cli/project/).

### `rebase auth`

Befehle zur Authentifizierungsverwaltung:

```bash
rebase auth reset-password --email admin@example.com --password NewPassword123!
```

### `rebase api-keys`

Verwaltet die Service-API-Schlüssel des Projekts — die Anmeldedaten, die ein Agent, ein Skript oder ein anderer Dienst verwendet, im Gegensatz zur Sitzung eines Endbenutzers:

```bash
rebase api-keys list
rebase api-keys get abc123-def456
rebase api-keys create --name "Blog CI" --scopes data:read:posts,data:write:posts --expires-in 90
rebase api-keys create --name "Ops" --full-access --roles admin --expires-at 2027-01-31
rebase api-keys revoke abc123-def456
```

`--scopes` benennt kommagetrennt oder wiederholt, was der Schlüssel tun darf; `--full-access` gewährt ihm jeden Scope, den der Service-Key besitzt, mit Ausnahme von `keys:*`. `--roles` fügt RLS-Rollen neben `service` hinzu, `--expires-in` akzeptiert Tage und `--expires-at` ein ISO-Datum. `rebase api-keys scopes` listet alle Scopes auf, die dem Backend bekannt sind. Ein Schlüssel wird einmalig angezeigt. Sowohl die Scopes des Schlüssels als auch die Row-Level Security der Identität, als die er agiert, finden Anwendung. Siehe [API-Schlüssel](/docs/backend/api-keys/).

### `rebase storage`

Gesamtspeicher-Wartung gespeicherter Dateien über das laufende Backend mit `REBASE_SERVICE_KEY` aus `.env`:

```bash
rebase storage orphans                         # Dateien, die von keiner Zeile referenziert werden
rebase storage orphans --source media --delete # und nach Bestätigung löschen
rebase storage move --from "(default)" --to media --prefix avatars
rebase storage move --from "(default)" --to media --prefix avatars --delete-source
```

`orphans` liest jede Zeile jeder Tabelle so aus, wie sie gespeichert ist (einschließlich Soft-Deleted-Zeilen, unter Umgehung aller `beforeQuery`- und `afterRead`-Hooks) sowie jeden [History](/docs/backend/history/)-Eintrag, da ein Revert dessen Inhalt wiederherstellt. Es listet die Dateien einer Quelle auf (`--source`, standardmäßig die Standardquelle), die von keinem String in diesen Datensätzen benannt werden: ein Schlüssel, eine URL, eine `rebase-storage:`-Referenz in einem Text. Dateien, die neuer als `--older-than` Stunden sind (standardmäßig 24), werden ausgelassen, da das Admin-Panel eine Datei hochlädt, bevor die Zeile gespeichert wird, die sie referenziert. Der Scan läuft im Hintergrund auf dem Backend, sodass auch ein Projekt fertiggestellt werden kann, das zu groß ist, um innerhalb einer einzelnen Anfrage gescannt zu werden (hinter einem Ingress, der ein Timeout auslösen würde). Die CLI startet ihn und zeigt dann seinen Fortschritt an (aufgelistete Dateien, gelesene Zeilen, abgeschlossene Tabellen und solche, die nicht gelesen werden konnten), bis er abgeschlossen ist. Bei aktiver [Job-Queue](/docs/backend/jobs/) ist der Scan ein `storage.orphans`-Job, den die Job-Worker ausführen. Ohne diese läuft der Scan innerhalb des angefragten Serverprozesses, und die CLI weist darauf hin: Ein Neustart dieses Prozesses stoppt den Scan. Ein Scan ist ein einzelner Job-Versuch, begrenzt durch `jobs.timeoutMs` (standardmäßig 15 Minuten). Erhöhen Sie diesen Wert oder setzen Sie ihn auf 0 für Quellen, die länger benötigen. `--json` gibt denselben Bericht wie zuvor aus, zuzüglich seiner `scanId`.

`--delete` fragt vor dem Löschen nach (`--yes` überspringt die Frage und ist ohne Terminal erforderlich). Es löscht nur aus dem gerade ausgegebenen Scan und nur innerhalb von 15 Minuten nach dessen Abschluss. Es wird nichts gelöscht, solange eine Tabelle nicht gelesen werden kann: Eine Tabelle mit Read-Hooks auf einer Datenbank, deren Treiber diese nicht umgehen kann, gilt als ungelesen. Bevor etwas gelöscht wird, liest der Server jede Zeile und jeden History-Eintrag erneut gegen die aufgelisteten Dateien ab. Anschließend fragt er jede Datei unmittelbar vor dem Löschen erneut ab. Eine Datei, die jetzt von einer Zeile referenziert wird, die seit dem Scan erneut hochgeladen wurde oder die bereits verschwunden ist, wird beibehalten, und die CLI führt sie als beibehalten auf. Dateien, die nur von Tabellen referenziert werden, die Rebase nicht bereitstellt, wirken ungenutzt: Prüfen Sie dies vor dem Löschen. Bei einem Backend von 0.25.1 oder früher scannt die CLI auf die alte Weise innerhalb einer einzelnen Anfrage.

`move` kopiert die Dateien unter `--prefix` seitenweise unter denselben Schlüsseln zu einer anderen Quelle. Eine Datei, die das Ziel bereits in derselben Größe enthält, wird übersprungen, sodass ein unterbrochener Vorgang durch erneutes Ausführen fortgesetzt werden kann; `--delete-source` löscht jede Datei aus der Quelle, sobald das Ziel sie enthält, und wird verweigert, wenn beide Quellen im selben Bucket oder Verzeichnis speichern. Sobald das Verschieben abgeschlossen ist, listet die CLI die Quelle mit einem erneuten Durchlauf wieder auf und benennt jede Datei, die beim Vorgang nicht verschoben wurde: mit `--delete-source` jede Datei, die sich noch in der Quelle befindet; ohne dieses Flag jede Datei, von der das Ziel keine Kopie derselben Größe besitzt. Der Befehl beendet sich mit 1, falls eine solche Datei vorhanden ist, und ein erneutes Ausführen desselben Verschiebevorgangs greift diese auf. `--json` gibt diese als `notMoved` aus. Das Lesen des Berichts eines Scans erfordert `database:read`. Das Starten eines Scans, Löschen und Verschieben erfordert `database:write`, worüber der Service-Key verfügt.

### `rebase skills install`

Installiert die Rebase-Referenz-Skills für Ihre KI-Coding-Assistenten — jedes oben genannte `--agent`:

```bash
rebase skills install
rebase skills install --agent claude,cursor
rebase skills install --agent all
rebase skills --hooks
```

Unter [Agent-Skills](/docs/ai/skills) finden Sie die vollständige Liste und die Speicherorte der geschriebenen Dateien.

`--hooks` installiert das Claude Code Guardrail, das `rebase init` mit jedem Projekt ausliefert: `.claude/hooks/post-edit-collection.sh`, registriert als `PostToolUse`-Hook in `.claude/settings.json`, welcher `rebase verify --quiet` nach jeder Bearbeitung unter `backend/schema/` oder `frontend/src/cms/` ausführt und jedes Problem an den Agenten zurückgibt. Bestehende Einstellungen und Hooks bleiben erhalten. `rebase skills --hooks` installiert ausschließlich den Hook.

### `rebase telemetry`

Anonyme Nutzungsdatenerfassung, standardmäßig deaktiviert, bis Sie zustimmen. Ein interaktives `rebase init` fragt am Ende nach, wobei die Eingabeaufforderung standardmäßig auf "Nein" steht; es wird also nichts geteilt, es sei denn, Sie antworten mit "Ja". Die Entscheidung gilt pro Rechner (`~/.rebase/telemetry.json`): Nach einem "Ja" fragt `init` nie wieder nach, nach einem "Nein" fragt das nächste `init` erneut nach. Jeder Checkout erhält eine zufällige Projekt-ID, die in seiner git-ignorierten `.rebase/telemetry-project.json` gespeichert wird.

```bash
rebase telemetry status
rebase telemetry show
rebase telemetry enable
rebase telemetry disable
```

`status` gibt die aktuelle Einstellung aus, `show` gibt exakt das aus, was gesendet werden würde — unabhängig davon, ob das Teilen aktiviert ist, sodass Sie die Nutzdaten vor Ihrer Entscheidung prüfen können — und die beiden anderen ändern die Einstellung. Wenn Sie `init` nie ausgeführt haben, wurden zu keinem Zeitpunkt Daten erfasst.

## Nächste Schritte

- **[Schema-Generierung](/docs/cli/schema/#production-workflow)** — Der Migrations-Workflow, von der Tabellenänderung bis zur Produktion
- **[Schema as Code](/docs/architecture/schema-as-code)** — Wie die Schema-Generierung funktioniert
- **[Schnellstart](/docs/getting-started/quickstart)** — Erste Schritte
