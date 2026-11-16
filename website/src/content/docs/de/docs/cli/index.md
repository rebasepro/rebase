---
sourceHash: ab3e8ab0477304ad
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

`--json` ist der Schalter, und außerhalb der `cloud`-Befehlsfamilie ist es der einzige: `rebase status`, `rebase resources`, `rebase apps list`, `rebase upgrade` und `rebase verify` geben dann genau einen JSON-Wert auf stdout aus — das Ergebnis oder einen `{"error": {"message", "code", "hint", "issues"}}`-Umschlag bei einem Exit-Code ungleich null — und zwar bei **jedem** Beenden des Befehls, sodass ein Aufrufer stdout bedingungslos parsen kann. Ohne diesen Schalter schreiben sie menschenlesbaren Text und Fehler gehen an stderr. `rebase cloud` verwendet denselben Umschlag und ist die einzige Ausnahme von dieser Regel: Es schaltet JSON auch automatisch ein, wenn stdout kein TTY ist oder wenn `REBASE_JSON=1` gesetzt ist. Daher ist `rebase cloud status | cat` JSON, während `rebase status | cat` es nicht ist — übergeben Sie in einem Skript explizit `--json`, anstatt sich auf eine der beiden Regeln zu verlassen.

## Befehle

### `rebase init`

Initialisiert ein neues Rebase-Projekt:

```bash
rebase init [directory]
```

Richtet ein `backend/` (die Tabellen in `backend/schema/`) und ein `frontend/` (das Admin-Panel mit seinen Tabellenanpassungen in `frontend/src/cms/`) ein; `--headless` erstellt nur das Gerüst für `backend/`, ohne `backend/schema/`. [Projektstruktur](/docs/getting-started/project-structure/) zeigt beide Verzeichnisbäume.

| Flag | Funktion |
|---|---|
| `-t, --template <preset>` | `blog`, `ecommerce` oder `blank`. Standard: `blog` |
| `--headless` | Nur Backend — kein Admin-Panel und kein `backend/schema/`: Der Server stellt die eigenen Tabellen der Datenbank bereit. `--template` hat keine Auswirkung, da keine Tabellen für Seeds vorhanden sind |
| `-y, --yes` | Niemals nachfragen. **Erforderlich überall dort, wo kein Terminal zum Antworten vorhanden ist**, wie z. B. in CI. Überspringt Git-Init und die Installation von Abhängigkeiten — die interaktiven Standardeinstellungen bejahen beides, übergeben Sie also `--git` / `--install`, wenn Sie dies wünschen |
| `-i, --install` | Abhängigkeiten nach dem Scaffolding installieren. Ohne dieses Flag fragt init nach (Standard: Ja); unter `--yes` wird nichts installiert |
| `--no-install` | Nichts installieren und nicht nachfragen |
| `-g, --git` | Ein Repository initialisieren und den ersten Commit erstellen. Ohne dieses Flag fragt init nach (Standard: Ja); unter `--yes` wird kein Repository erstellt |
| `--database-url <url>` | Eine bestehende Datenbank anstelle der verwalteten verwenden. Es muss eine `postgres://`- oder `postgresql://`-URL sein: Alles andere wird abgelehnt, bevor eine Datei geschrieben wird, und die interaktive Eingabeaufforderung fragt erneut nach |
| `--introspect` | `backend/schema` aus dieser Datenbank generieren. Impliziert `--template blank` und erfordert `--install` |
| `--project <slug>` | Das Gerüst mit einem Rebase Cloud-Projekt verknüpfen |
| `--setup-key <key>` | Der Einmalschlüssel, der diese Verknüpfung authentifiziert |
| `-a, --agent <name>` | KI-Coding-Agents einrichten: die [Skills](/docs/ai/skills) und den [MCP-Server](/docs/ai/mcp). Wiederholbar oder kommagetrennt — `claude`, `cursor`, `windsurf`, `gemini`, `codex`, `kiro`, `copilot` oder `all`. Ohne dieses Flag fragt `init` nach und wählt die auf dem Rechner installierten Agents vorab aus; unter `--yes` keine |

### `rebase dev`

Startet den Entwicklungsserver:

```bash
rebase dev
```

Startet sowohl Frontend als auch Backend mit Hot Reloading und generiert das Drizzle-Schema sowie die SDK-Typen (`generated/sdk/`) beim Start und bei jedem Speichern unter `backend/schema/` neu.

Beide Ports werden aus dem Pfad des Projekts abgeleitet, sodass mehrere Rebase-Projekte nebeneinander laufen können. Verwenden Sie die URLs, die `rebase dev` ausgibt. Einen Port fest pinnen mit `rebase dev --port 3001`.

Eine Bearbeitung von `.env` startet das Backend neu, welches die Datei erneut einliest, genau wie das Admin-Panel. Was `rebase dev` selbst setzt, bleibt bis zum Neustart erhalten: `PORT` sowie `DATABASE_URL`, wenn die verwaltete Datenbank oder Docker verwendet wird.

Mit `--database-url` prüft `rebase dev` zuerst, ob unter diesem Host und Port etwas antwortet. Wenn nicht, meldet es dies unter Nennung des Flags und beendet sich mit `1`, ohne etwas gestartet zu haben; außerdem lässt es die Datenbank-Namen in `.env` unberührt und startet niemals seinen Compose-Container.

### `rebase build`

Baut das Projekt in ein deploybares Bundle in `dist-bundle/`:

```bash
rebase build
```

Das Bundle ist das Artefakt, das Sie deployen — das Runtime-Image lädt es, sodass Sie kein eigenes Anwendungs-Image erstellen müssen. Nützliche Flags:

| Flag | Wirkung |
|------|--------|
| `--output <dir>` (oder `--out`) | Schreibt das Bundle an einen anderen Ort als `dist-bundle/` (eine App nach der anderen) |
| `--vendor` | Immer die Abhängigkeiten des Bundles installieren und mitliefern |
| `--no-vendor` | Niemals vendoren; der Pod installiert sie bei jedem Start |
| `--skip-type-check` | Typprüfung überspringen (schneller, weniger sicher) |
| `--no-static` | Das Frontend nicht in das Backend-Bundle einbinden (jede statische App erhält weiterhin ihr eigenes Bundle) |
| `--skip-static-build` | Das Frontend als bereits gebaut einbinden, ohne dessen Build-Befehl auszuführen |

Ein Frontend — jede statische App aus `rebase.json` mit einer Vite-Konfiguration —, dessen Konfiguration nicht `rebaseBackendGuard()` (aus `@rebasepro/app/vitePlugin`) verwendet, wird abgelehnt: Dies hält Servercode aus dem Browser-Bundle fern und verhindert, dass Vite eine Backend-Datei als `data:`-URL inline einbindet (es schlägt beim Build fehl und benennt sich selbst, wenn ein anderes Plugin sein `build.assetsInlineLimit` ersetzt). `frontend/src/cms/ui-config.json` wird als `entry.uiConfig` in das Bundle übernommen – die Workspace-Präsentation, die ein bereitgestelltes Backend ausliefert.

Abhängigkeiten werden standardmäßig gebündelt (gevendort), damit eine neue Instanz nicht 35–55 Sekunden für die Installation aufbringen muss. Ein Verzeichnisbaum, der auf der Festplatte über 2 GB anwächst, wird stattdessen verworfen, da das Upload-Limit komprimiert 1 GB beträgt.

Jede statische App, die das Bundle enthält, erhält eine Brotli- (`.br`) und eine Gzip- (`.gz`) Kopie neben jedem inhaltsgehashten Asset von 1 KB oder mehr — den Dateien, die ein Browser ein Jahr lang im Cache speichert. Die Runtime sendet die Variante, die der Browser akzeptiert, sodass diese Dateien keine Komprimierungsarbeit pro Anfrage kosten, einschließlich des ersten Besuchs nach einem Deployment. Browser, die Brotli unterstützen, erhalten dieses (bei den JavaScript-Dateien des Admins etwa 11 % kleiner als Gzip). Die Build-Ausgabe Ihres Frontends bleibt unverändert; nur die Kopie im Bundle ändert sich. Bei der Beispiel-App verlängert dies den Build um weniger als eine Sekunde und vergrößert das Bundle um etwa 2,4 MB.

### `rebase upgrade`

Aktualisiert jedes vom Projekt festgelegte `@rebasepro/*`-Paket auf ein gemeinsames Release und installiert dann mit dem Paketmanager, den die Lockfile vorgibt. `rebase upgrade` wählt die Version `latest`; `--to 0.21.0` eine exakte Version ohne Registry-Lookup; `--to canary` einen Dist-Tag. Jedes Pinning in `dependencies`, `devDependencies` und `optionalDependencies` in jeder `package.json` des Projekts behält sein `^` oder `~`, und nichts anderes in der Datei ändert sich. `peerDependencies` sowie `workspace:`, `link:`, `file:`, Git- und Tag-Spezifikationen werden aufgelistet und unberührt gelassen. Overrides in `pnpm-workspace.yaml` und `package.json` werden ebenfalls aktualisiert, aber ein `link:`- oder `file:`-Override hat Vorrang vor jedem Pin: Dies wird gemeldet, und `--drop-local-overrides` entfernt es. `--dry-run` schreibt nichts, `--no-install` überspringt die Installation und `--json` gibt ein einzelnes Dokument aus.

Ein Projekt, das auf einem Vorab-Release wie Canary basiert, bleibt auf diesem Channel, es sei denn, `latest` ist neuer. Ein Dist-Tag, der ein Pinning herabstufen würde, wird abgelehnt (`downgrade_refused` unter `--json`), es sei denn, Sie übergeben `--allow-downgrade`; ein exaktes `--to` wird angewendet und als Downgrade gekennzeichnet. Ein `--dry-run` eines Upgrades, das der reale Lauf ablehnen würde, zeigt an, was geändert werden würde, und beendet sich mit 0. Unter `--json` enthält das Dokument die Ablehnung als `wouldRefuse` (`{ code, message, hint }`).

### `rebase start`

Führt das erstellte Bundle so aus, wie es bei einem Deployment ausgeführt wird:

```bash
rebase start
```

Liest im Gegensatz zu `rebase dev` den `PORT` und den Rest von `.env` in der darin festgelegten `NODE_ENV` aus. Eine generierte `.env` enthält `development`, sodass das erste registrierte Konto weiterhin zum Administrator wird, was `rebase start` ganz oben anzeigt; setzen Sie `NODE_ENV=production` für einen Produktionsserver. `rebase start --bundle ./dist-bundle` führt ein Bundle an einem anderen Ort aus.

`rebase start` startet keine Datenbank, und die `.env` des Scaffolds enthält keine `DATABASE_URL`. Ein lokaler Lauf auf der von `rebase dev` genutzten Datenbank lautet daher `DATABASE_URL="$(rebase db url)" rebase start`. Wenn keine vorhanden ist, gibt der Befehl diese Zeile vor dem Booten aus.

### `rebase apps list`

Zeigt die Apps an, die dieses Repository deklariert:

```bash
rebase apps list
```

Ein Repository kann mehr als eine deploybare App deklarieren — beispielsweise ein Backend und eine Marketing-Website. So sehen Sie, worauf sich `rebase build` und das Deployment auswirken.

### `rebase eject`

Übernehmen Sie die volle Kontrolle über den Serverprozess und dessen Image:

```bash
rebase eject
```

Schreibt den Backend-Einstiegspunkt und ein `Dockerfile` in das Projekt und stellt dessen Backend um, sodass das Repository sein eigenes Image baut, anstatt die veröffentlichte Runtime auszuführen. Von da an **greifen Plattform-Runtime-Upgrades nicht mehr**, und CORS, Auth-Verdrahtung, Speicher und Shutdown müssen von Ihnen selbst konfiguriert werden.

Erstellen Sie eine Vorschau mit `rebase eject --dry-run`, wodurch aufgelistet wird, was sich ändern würde, ohne Änderungen vorzunehmen. `--force` ersetzt eine vorhandene `backend/src/index.ts` oder `env.ts` und behält die aktuelle Datei als `<name>.bak` bei.

Der ausgeklinkte (ejected) Server speichert lokale Uploads im Verzeichnis `uploads/` des Projekts, unabhängig davon, ob er aus dem Quellcode oder kompiliert ausgeführt wird, genau wie `rebase dev`. Er läuft in `backend/`, daher wird ein relativer `STORAGE_PATH` dort von `backend/` aus gelesen.

### `rebase schema generate` / `rebase schema stale`

```bash
rebase schema generate       # backend/schema → backend/src/schema.generated.ts
rebase schema stale          # benennt Abweichungen von den Tabellen, Exit 1 bei Abweichungen
rebase schema stale --fix    # generiert die Datei stattdessen neu
```

Jeder Befehl, der das Schema liest, akzeptiert `--schema-dir <dir>` für Projekte, die es an einem anderen Ort aufbewahren; `--collections` wurde entfernt. `rebase dev` hält die Datei aktuell, daher ist `stale` die Prüfung für einen Build oder CI. Siehe [Schemagenerierung](/docs/cli/schema/).

### `rebase db`

```bash
rebase db push                 # Tabellen auf die Datenbank anwenden (Entwicklung)
rebase db generate             # eine SQL-Migrationsdatei schreiben
rebase db migrate              # ausstehende Migrationen anwenden
rebase db url                  # den von diesem Projekt verwendeten Verbindungsstring ausgeben
rebase db pull --from <url>    # eine andere Datenbank in die lokale kopieren
rebase db backup               # pg_dump; db backups list und db restore stehen ebenfalls bereit
rebase db branch create <name> # eine Arbeitskopie erstellen; auch switch, list und prune sind verfügbar
rebase db stop                 # die verwaltete Entwicklungsdatenbank stoppen
rebase db reset                # diese löschen und von vorne beginnen
rebase db request-role migrate --to <role> # Anfragen auf eine andere Postgres-Rolle umstellen
rebase db provision --print    # das SQL zur Einrichtung der Request-Rolle, für einen DBA
```

Jeder dieser Befehle wird unter [Datenbankbefehle](/docs/cli/database/) beschrieben, einschließlich der Reihenfolge, in der ein Befehl seine Datenbank auswählt; `push`, `generate` und `migrate` werden unter [Schemagenerierung](/docs/cli/schema/) ausführlich behandelt.

### `rebase console`

Eine Node-REPL mit geöffneten Projektdaten oder Ausführung eines einzelnen Snippets mit `-e`:

```bash
rebase console
rebase console -e "rebase.dataAsAdmin.posts.find({ limit: 5 })"
```

`rebase` (`dataAsAdmin`, `sql`, `withAuth(user)`) und `tables` (die Tabellen des Projekts, geladen aus `backend/schema`) befinden sich im Scope, und Top-Level-`await` funktioniert. Die Datenbank wird so aufgelöst, wie `rebase db push` sie auflöst, und das Öffnen der Konsole ändert nichts daran. Mit `-e` wird das per `await` abgewartete Ergebnis als JSON auf stdout ausgegeben, und bei Fehlern beendet sich der Prozess mit `1`. Flags: `--eval`/`-e`, `--schema-dir`, `--database-url`, `--docker`. Siehe [Skripte und die Konsole](/docs/backend/scripts/).

### `rebase migrate`

Einweg-Migrationen von Layouts, die von diesem Release nicht mehr unterstützt werden:
`rebase migrate collections-to-tables` (`config/collections` → `backend/schema` und `frontend/src/cms`) und `rebase migrate sdk-calls` (`data.collection("x")` → `data.table("x")` in Ihrem eigenen Code). Deren Flags, was sie schreiben und der Abschnitt „Vor dem Deployment prüfen“ finden sich unter [Schemagenerierung](/docs/cli/schema/#rebase-migrate).

### `rebase apps init` / `rebase apps config`

```bash
rebase apps list             # die von diesem Projekt deklarierten Apps
rebase apps init             # eine aus diesem Projekt abgeleitete rebase.json schreiben
rebase apps config <app>     # die Client-Konfiguration für eine App
```

`apps init` akzeptiert keinen Namen: Es leitet jede App aus dem Projekt ab, schreibt die gesamte `rebase.json` und weigert sich, eine bestehende Datei zu überschreiben, es sei denn, Sie übergeben `--force`.

Ein Namensargument wird abgelehnt. `--force` behält bei, was die automatische Erkennung aus der ersetzten Datei nicht wissen kann: den Namen jeder App, ihren `path` und ihre `cms`-Route. Alles andere wird erneut abgeleitet, und eine deklarierte App, die nicht mehr gefunden wird, wird als entfernt gekennzeichnet, sodass bei einem Gerüst wieder die `rebase.json` geschrieben wird, mit der das Gerüst ausgeliefert wurde. Der Build-Befehl der statischen App verwendet den Paketmanager des Projekts.

Bei einem Checkout, der nicht mit einem Cloud-Projekt verknüpft ist, meldet `apps config`, dass keine Verknüpfung besteht (unabhängig davon, ob `rebase dev` ausgeführt wird oder nicht), und gibt die URL des Backends so an, wie `rebase dev` sie bereitstellt.

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

Drei Dateien bestimmen, was ein Backend erreichen kann, und dieser Befehl gibt alle drei zusammen aus: `rebase.json` gibt an, wo sich Ihr Code befindet und wer den Server betreibt, `backend/resources.ts` legt fest, was das Projekt benötigt, und die Umgebung gibt an, wie die einzelnen Komponenten erreichbar sind. Alles andere — `rebase.resources.json`, das Bundle-Manifest — wird aus der mittleren Datei für Ausleseprozesse generiert, die Ihren Code nicht ausführen können; Sie schreiben diese Datei nie selbst.

Ein `○` markiert den Zustand, den man besser vor als nach einem Deployment kennen sollte: deklariert, aber nicht konfiguriert. Ein `✗` bedeutet, dass die Umgebung etwas *falsch* setzt, was den Bootvorgang verhindert, anstatt die Funktionalität nur herabzusetzen.

Eine `rebase.resources.json`, die nicht mehr mit den Deklarationen übereinstimmt, erhält eine `○`-Zeile. Eine Datei, die noch gar nicht geschrieben wurde, erhält keine: `rebase build` schreibt sie bei jedem Build, sodass ein Projekt, das noch nie gebaut wurde (z. B. ein frisches Gerüst), nichts zu korrigieren hat.

### `rebase resources`

Was dieses Projekt laut Deklaration benötigt — die Datenbanken, Buckets, Topics und Queues, die `backend/resources.ts` anfordert, sowie die Cronjobs und Funktionen, die seine Dateien definieren:

```bash
rebase resources            # auflisten
rebase resources --write    # rebase.resources.json neu generieren
rebase resources --check    # fehlschlagen, wenn der committete Graph veraltet ist
rebase resources --json     # maschinenlesbar
```

`rebase resources --check` ist das Flag, das ein CI-Job verwendet, um fehlzuschlagen, wenn `rebase.resources.json` nicht mehr mit `backend/resources.ts` übereinstimmt. `--json` lässt sich damit kombinieren: Bei Abweichungen beendet sich `rebase resources --check --json` mit Exit-Code 1 und einem Fehlerumschlag (`resource_graph_missing` oder `resource_graph_stale`), und bei Erfolg enthält der Graph `check.status`. `--write --json` schreibt die Datei und meldet `written.changed`.

Eine Ressource wird in `backend/resources.ts` deklariert — `database("analytics")`, `bucket("media")`, `topic("signups")`, `queue("thumbnails")` — oder ist eine Datei unter `backend/crons` oder `backend/functions`. Sie wird niemals manuell in `rebase.resources.json` geschrieben, da diese Datei aus diesen Deklarationen generiert wird, damit ein Host auslesen kann, was ein Projekt benötigt, ohne es bauen zu müssen. Jeder Eintrag dokumentiert, wer ihn verwendet (`table:events`, `column:posts.cover`, `function:report`).

Ein Backend verfügt außerdem über eine Standarddatenbank und eine Standard-Speicherquelle, die niemand explizit deklariert. Beide werden hier mit der Kennzeichnung `implicit` aufgeführt und keine von beiden wird in `rebase.resources.json` geschrieben — der Host stellt sie bereit, sodass ein Eintrag dazu führen würde, dass etwas bereitgestellt wird, was niemand angefordert hat. Die Deklaration einer benannten Ressource, wie z. B. `bucket("media")`, belässt den Standard unverändert, sodass beide aufgeführt werden. Nur die Deklaration des Standards selbst oder das Markieren eines Buckets mit `default: true` ersetzt diesen.

Um zu sehen, was die Plattform für ein Projekt im Vergleich zu den Deklarationen im Code vorhält, und um eine bereitgestellte Datenbank zu entfernen, die der Code nicht mehr nennt, siehe [`rebase cloud resources`](/docs/cli/cloud#resources).

`rebase cloud` — alle Befehle für Rebase Cloud: Authentifizierung, Projektverknüpfung, Deployments, Konfiguration, Datenbanken, Ressourcen, Compute und mehr — hat [eine eigene Seite](/docs/cli/cloud).

### `rebase generate-sdk`

```bash
rebase generate-sdk
```

Schreibt einen typisierten Client für die Tabellen, die `backend/schema/index.ts` exportiert, nach `generated/sdk/`, mit `TableName` und `tablesDictionary`; `--from <link|url>` liest stattdessen den Vertrag eines laufenden Backends. `--register` typisiert auch serverseitige Daten: Es schreibt die Typen und die `Register`-Deklaration nach `backend/generated/` und vermerkt dies in `rebase.json` (`registerDatabase`). Siehe [Typisierte serverseitige Daten](/docs/backend/typed-server-data) und [Schemagenerierung](/docs/cli/schema/#rebase-generate-sdk).

### `rebase doctor`

```bash
rebase doctor
```

Der Befehl, den man ausführt, wenn etwas nicht stimmt und man noch nicht weiß, was es ist. Er berichtet nur und ändert niemals etwas, sodass er bedenkenlos auf jede erreichbare Datenbank angewendet werden kann.

**Ohne Datenbank.** Diese Prüfungen laufen zuerst, da alles, was ein Projekt komplett am Starten hindert, auftritt, bevor überhaupt eine Tabelle verglichen werden kann:

| Prüfung | Grund |
| --- | --- |
| Node-Version | Abgleich mit dem von der CLI deklarierten Bereich. Eine zu alte Version wird nicht als „nicht unterstütztes Node“ gemeldet, sondern äußert sich als Syntaxfehler innerhalb einer Abhängigkeit. |
| Paketmanager | Zwei Lockfiles in einem Projekt. `npm install` in einem pnpm-Workspace schreibt `node_modules` in ein Layout um, das pnpm nicht erwartet; das Symptom ist Stunden später ein `Cannot find module`. |
| Doppelte Slugs | Zwei Tabellen deklarieren denselben Slug. Das Schema bricht beim Kompilieren ab, und diese Prüfung nennt beide. |
| `.env`-Plausibilität | Ein `JWT_SECRET`, das kürzer als 32 Zeichen ist (womit die Produktion den Start verweigert), und `NODE_ENV=production` ohne `CORS_ORIGINS` oder `FRONTEND_URL`. Werte werden niemals ausgegeben. |
| Versionsunterschiede bei `@rebasepro/*` | Dasselbe Paket ist über die `package.json`-Dateien des Projekts hinweg auf unterschiedliche Versionen festgelegt. Zwei Kopien beschädigen `instanceof` untereinander, was dazu führt, dass ein Type Guard seinen eigenen Typ zurückweist. |
| Verbindungsstrings | Ein nicht-encodiertes `=` in einem URL-Parameter, dessen Parsing die PostgreSQL-eigenen Werkzeuge verweigern — Backups und `psql` schlagen fehl, während die App weiterläuft. |
| Benutzerdefinierte Funktionen | Was jede Funktion von ihrem Host benötigt und welche davon nicht auf einer Edge-Runtime laufen würden. |

**Gegen die Datenbank** — die projekteigene Datenbank, aufgelöst wie von `rebase db url`; bei einem frischen Gerüst ist dies die verwaltete Datenbank, die `doctor` startet:

| Prüfung | Grund |
| --- | --- |
| Tabellen → generiertes Schema | Ob `schema.generated.ts` veraltet ist. |
| Tabellen → Datenbank | Fehlende Tabellen, Spalten, Enums, Fremdschlüssel und Junctions. |
| Erforderliche Extensions | Eine `col.vector()`-Spalte benötigt pgvector, welches Rebase nur dort installiert, wo ein Projekt dies deklariert hat. |
| Schema-Stempel | Ob diese Datenbank aus diesen Tabellen bereitgestellt wurde. Ein Hash, der aussagt, dass beide nicht übereinstimmen, aber nie, welche Version neuer ist. Ein `v1:`-Stempel aus einer Runtime vor Version 0.31 wird einmalig gemeldet, zusammen mit dem Befehl zur Neuerstellung: `rebase db push`. |
| Tabellen → SDK-Typen | Ob das generierte typisierte SDK veraltet ist. |
| RLS-Richtlinien | Ob die Richtlinien der Datenbank mit dem deklarierten `rls` übereinstimmen und ob eine Richtlinie eine Rolle nennt, die dieser Server nicht verwenden kann. |

Ist die Datenbank nicht erreichbar, werden deren Phasen unter Angabe des Grundes als übersprungen gemeldet und der Rest läuft weiter — siehe [Fehlerbehebung](/docs/troubleshooting/).

Beendet sich mit einem Exit-Code ungleich null, wenn eine Prüfung einen Fehler findet oder wenn eine Phase nicht ausgeführt werden konnte, weil die angegebene Datenbank Verbindungen ablehnt. Eine Phase, die übersprungen wurde, weil keine Datenbank ermittelt werden konnte, gilt nicht als Fehler.

`rebase doctor --policies` führt nur die RLS-Prüfungen durch — kein Schema-Diff, keine SDK-Typen — und schlägt bei Fehlern strikt fehl (Fail-Closed). Daher eignet es sich ideal als CI-Gate gegen eine Produktivdatenbank.

`rebase doctor --database` führt nur den Datenbank-Preflight aus: ob die Rolle existiert, unter der angemeldete Anfragen laufen, ob sie eingeschränkt ist und zu ihr gewechselt werden kann, welche anderen Logins zu ihr wechseln dürfen, ob jede Rolle eine Verbindung herstellen darf und welche Tabellen, Grants und Richtlinien Rebase mit anderen Rollen teilen würde. Jedes Ergebnis nennt das SQL, das als Administrator auszuführen ist, die `rls`-Einstellung, die Rebase stattdessen an die Datenbank anpasst, oder beides. Es liest den Katalog, ändert nichts und beendet sich mit 1, wenn ein Befund ein Fehler ist. Dies funktioniert auch bei einem Headless-Projekt. Siehe [Ausführung auf einer bestehenden oder geteilten Datenbank](/docs/deployment/existing-database/).

### `rebase verify`

```bash
rebase verify
rebase verify --json
rebase verify --live
rebase verify --live --database-url postgresql://…
```

Prüft in einem schnellen Befehl für CI und für Hooks von KI-Agents, ob die Tabellen sicher für das Deployment sind. Standardmäßig offline, und ändert niemals etwas.

| Schritt | Was zum Fehlschlagen führt |
| --- | --- |
| Tabellendefinitionen (`schema`) | `backend/schema` lädt nicht oder kompiliert nicht über den Loader, von dem das Backend bootet: Eine Relation zu einer Tabelle, die der Index nicht exportiert, `rls: "inherit"` ohne `defaultRls`, eine Tabelle ohne Primärschlüssel — ein Befund pro Problem. Eine Tabelle ohne `rls` ist einer davon. |
| RLS-Abdeckung (`rls`) | Eine Tabelle mit einer Spalte `user_id`, `owner_id`, `organization_id` oder `tenant_id`, deren Regeln — eigene oder das geerbte `defaultRls` — einer Rolle erlauben, jede Zeile ungeachtet dessen zu lesen. Eine Warnung. `rls-policy-recursion`: Eine Regel, die ihre eigene Tabelle in einer Unterabfrage liest, oder zwei Tabellen, deren Regeln sich gegenseitig lesen, was Postgres nicht auflösen kann, sodass jedes dadurch geschützte Statement mit `42P17 infinite recursion detected in policy` fehlschlägt; der Befund nennt die gelesene Tabelle und die Lösung (Auslagern des Lesevorgangs in eine `SECURITY DEFINER`-Funktion). Ein Fehler oder eine Warnung, wenn die Schleife nicht eindeutig feststeht. |
| Aktualität der Migrationen (`migrations`) | Eine von den Tabellen deklarierte Tabelle oder Spalte, die von keiner Datei in `backend/drizzle/migrations` erstellt wird, oder eine gelöschte, die von einer Migration immer noch erstellt wird. Wird für Projekte übersprungen, die noch keine Migrationen haben. |
| CMS-Anpassungen (`cms`) | Ein `customizeTable(...)` in `frontend/src/cms` (oder im `src/cms` einer statischen App in `rebase.json`), das statisch ausgelesen nicht zu den Tabellen passt — die Module werden nicht ausgeführt. `cms-unknown-table`: Der Slug nennt keine Tabelle, daher ignoriert das Panel ihn (der ähnlichste Slug wird vorgeschlagen). `cms-unknown-field`: Ein Schlüssel unter `fields` ist weder eine Spalte noch eine Relation (der SQL-Name einer Spalte wird mit ihrem Schlüssel beantwortet). `cms-hidden-required`: Ein im Formular ausgeblendetes Feld (`hiddenInForm`, `readOnly`, `disabled`), dessen Spalte `NOT NULL` ohne Standardwert ist und vom Server nicht befüllt wird, sodass das Erstellen eines Datensatzes über das Panel immer fehlschlägt; eine Warnung, wenn ein `beforeSave`-Hook oder Transform es möglicherweise füllt, und unterdrückt durch `filledByServer`. `cms-duplicate-customization`: Ein Slug wurde zweimal angepasst. `cms-not-static` (eine Warnung): Ein Aufruf, dessen Slug, Optionen oder `fields` keine Literale oder `const` in derselben Datei sind, sodass nichts darin geprüft werden konnte. `cms-ui-config-not-mounted` (eine Warnung): `frontend/src/cms/ui-config.json` existiert, wird `<RebaseCMS>` jedoch nicht als `uiConfig` übergeben. `cms-backend-guard-missing`: Die Vite-Konfiguration des Frontends verwendet `rebaseBackendGuard()` nicht, weshalb `rebase build` dies verweigern würde. Ein Headless-Projekt hat kein `frontend/src/cms` und überspringt diesen Schritt. |
| Live-RLS-Audit (`live`) | Mit `--live`: Der [`rls-check`](/docs/rls-check)-Katalog gegen die Datenbank des Projekts und Prüfung, ob jede Migration angewendet wurde. Die Datenbank wird wie bei den `db`-Befehlen aufgelöst — `--database-url`, `DATABASE_URL`, `--docker`, andernfalls die verwaltete Entwicklungsdatenbank. Eine Datenbank, die nicht konfiguriert ist oder nicht antwortet, führt zu einem Fehler, nicht zu einem Überspringen: Das Audit wurde explizit angefordert. Eine aus einer `access: "public"`-Regel kompilierte `USING (true)`-Lese-Richtlinie ist eine Warnung, solange die API ein Token verlangt (`AUTH_REQUIRE`, standardmäßig aktiviert) — jeder angemeldete Benutzer liest jede Zeile — und ein Fehler bei `AUTH_REQUIRE=false`, wo die Zeilen anonym zugänglich sind. |

`--json` gibt ein einzelnes Objekt aus: `{ ok, schemaDir, steps, findings, summary }`. Jeder Schritt besteht aus `{ id, title, status, detail? }` (`status` ist `passed`, `failed`, `warnings` oder `skipped`), und jeder Befund enthält `step`, `check` (ein stabiler Kebab-Case-Typ), `severity`, `message` und, sofern zutreffend, `fix`, `table`, `file`, `line` und den durch Punkte getrennten `path` in die Tabelle (`posts.rls[0]`) — damit ein Agent reparieren kann, was er beschädigt hat. `summary` zählt `errors` und `warnings`. `--quiet` gibt nichts aus, wenn alles erfolgreich durchläuft. Beendet sich bei einem Fehler mit einem Exit-Code ungleich null; Warnungen führen nicht zum Fehlschlagen.

Ein per Scaffold erstelltes Projekt führt dies nach jeder Bearbeitung unter `backend/schema/` für Claude Code aus: siehe [`rebase skills install`](#rebase-skills-install).

### Befehle für eine laufende App

`rebase api`, `rebase data`, `rebase users`, `rebase cron`, `rebase logs`, `rebase functions`, `rebase rls simulate`, `rebase auth login` und `rebase storage ls|cp|rm|url|stat` wirken über deren API auf eine laufende Anwendung: das lokale `rebase dev`, einen mit `--url` angegebenen Server oder ein Rebase Cloud-Projekt mit `--project`. Siehe [Eine laufende App](/docs/cli/project/).

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

`--scopes` benennt kommagetrennt oder wiederholt, was der Schlüssel tun darf; `--full-access` verleiht ihm jeden Scope, den der Service-Schlüssel besitzt, außer `keys:*`. `--roles` fügt RLS-Rollen neben `service` hinzu, `--expires-in` akzeptiert Tage und `--expires-at` ein ISO-Datum. `rebase api-keys scopes` listet jeden Scope auf, den das Backend kennt. Ein Schlüssel wird nur einmal angezeigt. Sowohl die Scopes des Schlüssels als auch die Row-Level Security der Identität, als die er agiert, finden Anwendung. Siehe [API-Schlüssel](/docs/backend/api-keys/).

### `rebase storage`

Umfassende Wartung gespeicherter Dateien über das laufende Backend mit `REBASE_SERVICE_KEY` aus `.env`:

```bash
rebase storage orphans                         # Dateien, die von keiner Zeile referenziert werden
rebase storage orphans --source media --delete # und diese nach Bestätigung löschen
rebase storage move --from "(default)" --to media --prefix avatars
rebase storage move --from "(default)" --to media --prefix avatars --delete-source
```

`orphans` liest jede Zeile jeder Tabelle im gespeicherten Zustand (einschließlich Soft-Deleted-Zeilen, unter Umgehung aller `beforeQuery`- und `afterRead`-Hooks) und jeden [History](/docs/backend/history/)-Eintrag, da ein Revert dessen Inhalt wiederherstellt. Es listet die Dateien einer Quelle auf (`--source`, standardmäßig die Standardquelle, wenn weggelassen), die von keinem String in diesen Datensätzen referenziert werden: weder als Schlüssel noch als URL oder als `rebase-storage:`-Referenz in einem Text. Dateien, die neuer als `--older-than` Stunden sind (standardmäßig 24), werden ausgelassen, da das Admin-Panel eine Datei hochlädt, bevor die Zeile gespeichert wird, die sie referenziert. Der Scan läuft im Hintergrund auf dem Backend, sodass auch ein Projekt, das zu groß ist, um innerhalb eines einzelnen Requests gescannt zu werden (hinter einem Ingress mit Timeout), erfolgreich abgeschlossen wird. Die CLI startet den Scan und zeigt dann den Fortschritt an (aufgelistete Dateien, gelesene Zeilen, abgeschlossene Tabellen und solche, die nicht gelesen werden konnten), bis er beendet ist. Bei aktivierter [Job-Queue](/docs/backend/jobs/) ist der Scan ein `storage.orphans`-Job, den die Job-Worker ausführen. Ohne diese läuft der Scan innerhalb des angefragten Serverprozesses, worauf die CLI hinweist: Ein Neustart dieses Prozesses stoppt den Scan. Ein Scan entspricht einem Job-Versuch, begrenzt durch `jobs.timeoutMs` (standardmäßig 15 Minuten). Erhöhen Sie diesen Wert oder setzen Sie ihn auf 0 für Quellen, die länger benötigen. `--json` gibt denselben Bericht wie zuvor aus, ergänzt um die `scanId`.

`--delete` fragt vor dem Löschen nach (`--yes` überspringt die Abfrage und ist ohne Terminal erforderlich). Es löscht nur auf Basis des gerade ausgegebenen Scans und nur innerhalb von 15 Minuten nach dessen Abschluss. Es wird nichts gelöscht, solange eine Tabelle nicht gelesen werden kann: Eine Tabelle mit Read-Hooks auf einer Datenbank, deren Treiber diese nicht umgehen kann, gilt als ungelesen. Vor dem Löschen liest der Server jede Zeile und jeden History-Eintrag erneut gegen die aufgelisteten Dateien ab. Anschließend fragt er unmittelbar vor dem Löschen jede Datei nochmals ab. Eine Datei, die inzwischen von einer Zeile referenziert wird, die seit dem Scan erneut hochgeladen wurde oder die nicht mehr existiert, wird beibehalten, und die CLI führt sie als beibehalten auf. Dateien, die nur von Tabellen referenziert werden, die Rebase nicht verwaltet, wirken ungenutzt: Prüfen Sie dies vor dem Löschen. Bei einem Backend der Version 0.25.1 oder älter scannt die CLI nach der alten Methode innerhalb einer einzigen Anfrage.

`move` kopiert die Dateien unter `--prefix` seitenweise unter denselben Schlüsseln in eine andere Quelle. Eine Datei, die am Zielort bereits in gleicher Größe vorhanden ist, wird übersprungen, sodass ein abgebrochener Verschiebevorgang durch erneutes Ausführen fortgesetzt werden kann. `--delete-source` löscht jede Datei aus der Quelle, sobald das Ziel sie enthält, und wird verweigert, wenn beide Quellen denselben Bucket oder dasselbe Verzeichnis verwenden. Sobald der Verschiebevorgang abgeschlossen ist, listet die CLI die Quelle erneut durch einen frischen Durchlauf auf und nennt jede Datei, die nicht verschoben wurde: mit `--delete-source` jede Datei, die noch in der Quelle verblieben ist; ohne dieses Flag jede Datei, von der das Ziel keine Kopie mit gleicher Größe besitzt. Der Befehl beendet sich mit 1, wenn eine solche Datei existiert; ein erneutes Ausführen greift diese auf. `--json` gibt diese als `notMoved` aus. Das Lesen des Scan-Berichts erfordert `database:read`. Das Starten eines Scans, das Löschen und das Verschieben erfordern `database:write`, worüber der Service-Schlüssel verfügt.

### `rebase skills install`

Installiert die Rebase-Referenz-Skills für Ihre KI-Coding-Assistenten — jedes oben genannte `--agent`:

```bash
rebase skills install
rebase skills install --agent claude,cursor
rebase skills install --agent all
rebase skills --hooks
```

Siehe [Agent Skills](/docs/ai/skills) für die vollständige Liste und die Speicherorte der geschriebenen Dateien.

`--hooks` installiert das Claude Code-Guardrail, das `rebase init` mit jedem Projekt ausliefert: `.claude/hooks/post-edit-collection.sh`, registriert als `PostToolUse`-Hook in `.claude/settings.json`. Dieser führt nach jeder Bearbeitung unter `backend/schema/` oder `frontend/src/cms/` den Befehl `rebase verify --quiet` aus und meldet etwaige Probleme an den Agent zurück. Bestehende Einstellungen und Hooks bleiben erhalten. `rebase skills --hooks` installiert ausschließlich den Hook.

### `rebase telemetry`

Anonyme Erfassung von Nutzungsdaten, standardmäßig deaktiviert, bis Sie zustimmen. Ein interaktives `rebase init` fragt am Ende nach, und die Vorgabe ist „Nein“, sodass nichts geteilt wird, es sei denn, Sie stimmen ausdrücklich zu. Die Antwort gilt pro Maschine (`~/.rebase/telemetry.json`): Nach einem „Ja“ fragt `init` nie wieder nach, nach einem „Nein“ fragt das nächste `init` erneut nach. Jeder Checkout erhält eine zufällige Projekt-ID, die in der git-ignorierten Datei `.rebase/telemetry-project.json` gespeichert wird.

```bash
rebase telemetry status
rebase telemetry show
rebase telemetry enable
rebase telemetry disable
```

`status` gibt die aktuelle Einstellung aus, `show` gibt exakt das aus, was gesendet werden würde — unabhängig davon, ob das Teilen aktiviert ist, sodass Sie die Nutzlast vor Ihrer Entscheidung prüfen können — und die beiden anderen Befehle ändern die Einstellung. Wenn Sie `init` noch nie ausgeführt haben, wurden zu keinem Zeitpunkt Daten erfasst.

## Nächste Schritte

- **[Schemagenerierung](/docs/cli/schema/#production-workflow)** — Der Migrations-Workflow, von der Tabellenbearbeitung bis zur Produktion
- **[Schema as Code](/docs/architecture/schema-as-code)** — Funktionsweise der Schemagenerierung
- **[Schnellstart](/docs/getting-started/quickstart)** — Erste Schritte
