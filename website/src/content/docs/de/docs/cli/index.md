---
sourceHash: 4281e973dcdf0b86
title: CLI-Referenz
sidebar_label: CLI
description: Rebase CLI-Befehle für Projektinitialisierung, Schemagenerierung, Datenbankmigrationen und SDK-Generierung.
---

## Übersicht

Das Rebase-CLI (`rebase`) verwaltet Ihr Projekt vom Scaffolding bis zum Deployment.

## Installation

```bash
pnpm add -g @rebasepro/cli
```

Oder führen Sie jeden Befehl aus, ohne ihn zu installieren: `pnpm dlx @rebasepro/cli <command>`.

## Maschinenlesbare Ausgabe

`--json` ist die Option, und außerhalb der `cloud`-Befehlsfamilie die einzige: `rebase status`, `rebase resources`, `rebase apps list`, `rebase upgrade` und `rebase verify` geben dann bei **jeder** Beendigung des Befehls einen einzelnen JSON-Wert auf stdout aus — das Ergebnis oder ein `{"error": {"message", "code", "hint", "issues"}}`-Envelope mit einem Exit-Code ungleich null —, sodass ein Aufrufer stdout bedingungslos parsen kann. Ohne diese Option schreiben sie menschenlesbaren Text und Fehler gehen nach stderr. `rebase cloud` verwendet dasselbe Envelope und ist die einzige Ausnahme von diesem Schalter: Es aktiviert JSON auch automatisch, wenn stdout kein TTY ist oder wenn `REBASE_JSON=1` gesetzt ist. Daher liefert `rebase cloud status | cat` JSON, während `rebase status | cat` dies nicht tut — übergeben Sie in einem Skript explizit `--json`, anstatt sich auf eine dieser Regeln zu verlassen.

## Befehle

### `rebase init`

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Initialisieren Sie ein neues Rebase-Projekt:

```bash
rebase init [directory]
```

Richtet ein `backend/` (die Tabellen in `backend/schema/`) und ein `frontend/` (das Admin-Panel mit seinen Tabellenanpassungen in `frontend/src/cms/`) ein; `--headless` scaffoldet das `backend/` allein, ohne `backend/schema/`. [Projektstruktur](/docs/getting-started/project-structure/) zeigt beide Verzeichnisbäume.

| Flag | Funktion |
|---|---|
| `-t, --template <preset>` | `blog`, `ecommerce` oder `blank`. Standard: `blog` |
| `--headless` | Nur Backend — kein Admin-Panel und kein `backend/schema/`: Der Server stellt die datenbankeigenen Tabellen bereit. `--template` hat keine Auswirkung, da keine Tabellen zum Seeden vorhanden sind |
| `-y, --yes` | Niemals nachfragen. **Erforderlich überall dort, wo kein Terminal zum Antworten vorhanden ist**, wie beispielsweise in CI. Überspringt Git-Init und die Abhängigkeitsinstallation — die interaktiven Standardwerte bejahen beides, übergeben Sie also `--git` / `--install`, wenn Sie diese wünschen |
| `-i, --install` | Abhängigkeiten nach dem Scaffolding installieren. Ohne dieses Flag fragt init nach (Standard: Ja); unter `--yes` wird nichts installiert |
| `--no-install` | Nichts installieren und nicht nachfragen |
| `-g, --git` | Ein Repository initialisieren und den ersten Commit erstellen. Ohne dieses Flag fragt init nach (Standard: Ja); unter `--yes` kein Repository |
| `--database-url <url>` | Eine bestehende Datenbank anstelle der verwalteten verwenden. Es muss eine `postgres://`- oder `postgresql://`-URL sein: Alles andere wird abgelehnt, bevor eine Datei geschrieben wird, und die interaktive Eingabeaufforderung fragt erneut |
| `--introspect` | `backend/schema` aus dieser Datenbank generieren. Impliziert `--template blank` und erfordert `--install` |
| `--project <slug>` | Das Scaffold mit einem Rebase Cloud-Projekt verknüpfen |
| `--setup-key <key>` | Der Einmalschlüssel, der diese Verknüpfung authentifiziert |
| `-a, --agent <name>` | KI-Coding-Agents einrichten: die [Skills](/docs/ai/skills) und den [MCP-Server](/docs/ai/mcp). Wiederholbar oder kommagetrennt — `claude`, `cursor`, `windsurf`, `gemini`, `codex`, `kiro`, `copilot` oder `all`. Ohne dieses Flag fragt `init` nach und wählt die auf dem Rechner installierten Agents vorab aus; unter `--yes` keine |

### `rebase dev`

Starten Sie den Entwicklungsserver:

```bash
rebase dev
```

Startet sowohl das Frontend als auch das Backend mit Hot Reloading und generiert das Drizzle-Schema sowie die SDK-Typen (`generated/sdk/`) beim Start und bei jedem Speichern unter `backend/schema/` neu.

Beide Ports werden aus dem Projektpfad abgeleitet, sodass mehrere Rebase-Projekte nebeneinander ausgeführt werden können. Verwenden Sie die URLs, die `rebase dev` ausgibt. Einen Port können Sie mit `rebase dev --port 3001` festlegen.

Eine Änderung an `.env` startet das Backend neu, welches die Datei wie auch das Admin-Panel neu einliest. Werte, die `rebase dev` selbst setzt, bleiben bis zum Neustart erhalten: `PORT` und `DATABASE_URL`, wenn die verwaltete Datenbank oder Docker verwendet wird.

Mit `--database-url` prüft `rebase dev` zuerst, ob unter diesem Host und Port ein Dienst antwortet. Wenn nicht, meldet es dies unter Nennung des Flags und beendet sich mit dem Exit-Code `1`, ohne etwas gestartet zu haben; zudem lässt es die Datenbank-Variablen in `.env` unberührt und startet niemals seinen Compose-Container.

### `rebase build`

Bauen Sie das Projekt zu einem deploybaren Bundle in `dist-bundle/`:

```bash
rebase build
```

Das Bundle ist das Artefakt, das Sie deployen — das Runtime-Image lädt es, sodass Sie selbst kein Anwendungs-Image bauen müssen. Nützliche Flags:

| Flag | Wirkung |
|------|---------|
| `--output <dir>` (oder `--out`) | Schreibt das Bundle an einen anderen Ort als `dist-bundle/` (eine App nach der anderen) |
| `--vendor` | Installiert und packt die Abhängigkeiten des Bundles immer mit ein |
| `--no-vendor` | Niemals vendoren; der Pod installiert sie bei jedem Start neu |
| `--skip-type-check` | Typprüfung überspringen (schneller, weniger sicher) |
| `--no-static` | Das Frontend nicht in das Backend-Bundle integrieren (jede statische App erhält weiterhin ihr eigenes Bundle) |
| `--skip-static-build` | Das Frontend im bereits gebauten Zustand integrieren, ohne seinen Build-Befehl auszuführen |

<span class="since-badge" data-since="0.31">Seit 0.31</span> Ein Frontend — jede statische App in `rebase.json` mit einer Vite-Konfiguration —, dessen Konfiguration nicht `rebaseBackendGuard()` (aus `@rebasepro/app/vitePlugin`) verwendet, wird abgelehnt: Dies verhindert, dass Servercode in das Browser-Bundle gelangt, und verhindert, dass Vite eine Backend-Datei als `data:`-URL inlined (der Build schlägt unter Angabe des Fehlers fehl, wenn ein anderes Plugin sein `build.assetsInlineLimit` ersetzt). `frontend/src/cms/ui-config.json` wird als `entry.uiConfig` in das Bundle übernommen — die Workspace-Darstellung, die ein deploytes Backend bereitstellt.

Abhängigkeiten werden standardmäßig gevendort, damit einer neuen Instanz keine Installationsdauer von 35–55 Sekunden entsteht. Ein Verzeichnisbaum, der auf der Festplatte über 2 GB anwächst, wird stattdessen verworfen, da das Upload-Limit komprimiert 1 GB beträgt.

Jede statische App, die das Bundle enthält, erhält neben jedem inhaltsgehashten Asset von 1 KB oder mehr eine Brotli- (`.br`) und eine Gzip- (`.gz`) Kopie — die Dateien, die ein Browser ein Jahr lang zwischenspeichert. Die Runtime sendet die Variante, die der Browser akzeptiert, sodass diese Dateien keine Komprimierungsarbeit pro Anfrage verursachen, einschließlich des ersten Aufrufs nach einem Deployment; Browser, die Brotli akzeptieren, erhalten dieses (bei JavaScript des Admins ca. 11 % kleiner als Gzip). Die Build-Ausgabe Ihres Frontends bleibt unverändert; nur die Kopie im Bundle ändert sich. Bei der Beispiel-App verlängert dies den Build um weniger als eine Sekunde und vergrößert das Bundle um etwa 2,4 MB.

### `rebase upgrade`

Aktualisieren Sie jedes im Projekt festgelegte `@rebasepro/*`-Paket auf ein Release und installieren Sie es anschließend mit dem Paketmanager, den die Lockfile vorgibt. `rebase upgrade` wählt die neueste Version (`latest`); `--to 0.21.0` eine exakte Version ohne Registry-Lookup; `--to canary` einen Dist-Tag. Jeder Eintrag in `dependencies`, `devDependencies` und `optionalDependencies` in jeder `package.json` des Projekts behält sein `^` oder `~`, und nichts anderes in der Datei ändert sich. `peerDependencies` sowie `workspace:`, `link:`, `file:`, Git- und Tag-Spezifikationen werden aufgelistet und unberührt gelassen. Overrides in `pnpm-workspace.yaml` und `package.json` werden ebenfalls aktualisiert, aber ein `link:`- oder `file:`-Override hat Vorrang vor jedem Pin: Dies wird gemeldet, und `--drop-local-overrides` entfernt ihn. `--dry-run` schreibt nichts, `--no-install` überspringt die Installation und `--json` gibt ein einzelnes Dokument aus.

Ein Projekt auf einem Vorab-Release, wie etwa einem Canary, bleibt auf seinem Kanal, es sei denn, `latest` ist neuer. Ein Dist-Tag, der einen Pin zurückstufen würde, wird verweigert (`downgrade_refused` unter `--json`), es sei denn, Sie übergeben `--allow-downgrade`; ein exaktes `--to` wird angewendet und als Downgrade gekennzeichnet. Ein `--dry-run` eines Upgrades, das die eigentliche Ausführung verweigern würde, zeigt, was verschoben werden würde, und beendet sich mit 0; unter `--json` enthält das Dokument die Verweigerung als `wouldRefuse` (`{ code, message, hint }`).

### `rebase start`

Führen Sie das gebaute Bundle so aus, wie ein Deployment es ausführt:

```bash
rebase start
```

Liest `PORT` und den Rest von `.env`, anders als `rebase dev`, in dem `NODE_ENV`, das dort gesetzt ist. Ein gescaffoldetes `.env` steht auf `development`, daher wird der erste registrierte Account weiterhin zum Admin, was `rebase start` zu Beginn anzeigt; setzen Sie `NODE_ENV=production` für einen Produktionsserver. `rebase start --bundle ./dist-bundle` führt ein Bundle an einem anderen Ort aus.

`rebase start` startet keine Datenbank, und das `.env` des Scaffolds enthält kein `DATABASE_URL`. Eine lokale Ausführung mit der Datenbank, die `rebase dev` verwendet, lautet daher:
`DATABASE_URL="$(rebase db url)" rebase start`.
Wird keine angegeben, gibt der Befehl diese Zeile vor dem Booten aus.

### `rebase apps list`

Zeigen Sie die Apps an, die dieses Repository deklariert:

```bash
rebase apps list
```

Ein Repository kann mehr als eine deploybare App deklarieren — beispielsweise ein Backend und eine Marketing-Website. So sehen Sie, worauf sich `rebase build` und das Deployment auswirken werden.

### `rebase eject`

Übernehmen Sie die vollständige Kontrolle über den Serverprozess und sein Image:

```bash
rebase eject
```

Schreibt den Backend-Einstiegspunkt und ein `Dockerfile` in das Projekt und stellt dessen Backend um, sodass das Repository sein eigenes Image baut, anstatt die veröffentlichte Runtime auszuführen. Von da an **erreichen Plattform-Runtime-Upgrades das Projekt nicht mehr**, und CORS, Auth-Verdrahtung, Storage und Shutdown liegen in Ihrer Verantwortung.

Vorschau mit `rebase eject --dry-run`, was auflistet, was sich ändern würde, und nichts verändert. `--force` ersetzt ein vorhandenes `backend/src/index.ts` oder `env.ts` und behält die aktuelle Datei als `<name>.bak` bei.

Der ausgeworfene Server speichert lokale Uploads im `uploads/`-Ordner des Projekts, egal ob aus dem Quellcode oder kompiliert ausgeführt, genau wie `rebase dev`. Er wird in `backend/` ausgeführt, daher wird ein relativer `STORAGE_PATH` dort ausgehend von `backend/` gelesen.

### `rebase schema generate` / `rebase schema stale`

<span class="since-badge" data-since="0.31">Seit 0.31</span>

```bash
rebase schema generate       # backend/schema → backend/src/schema.generated.ts
rebase schema stale          # listet Unterschiede zu den Tabellen auf, Exit 1 bei Abweichungen
rebase schema stale --fix    # generiert die Datei stattdessen neu
```

Jeder Befehl, der das Schema liest, akzeptiert `--schema-dir <dir>` für Projekte, die es an einem anderen Ort aufbewahren; `--collections` wurde entfernt. `rebase dev` hält die Datei aktuell, daher ist `stale` die Prüfung für einen Build oder CI. Siehe [Schemagenerierung](/docs/cli/schema/).

### `rebase db`

```bash
rebase db push                 # Tabellen auf die Datenbank anwenden (Entwicklung)
rebase db generate             # eine SQL-Migrationsdatei schreiben
rebase db migrate              # ausstehende Migrationen anwenden
rebase db url                  # den von diesem Projekt verwendeten Connection-String ausgeben
rebase db pull --from <url>    # eine andere Datenbank in die lokale kopieren
rebase db backup               # pg_dump; db backups list und db restore stehen daneben zur Verfügung
rebase db branch create <name> # eine Arbeitskopie erstellen; wechseln, auflisten und löschen ebenfalls möglich
rebase db stop                 # die verwaltete Entwicklungsdatenbank anhalten
rebase db reset                # sie löschen und von vorne beginnen
rebase db request-role migrate --to <role> # Anfragen auf eine andere Postgres-Rolle umstellen
rebase db provision --print    # das SQL zur Einrichtung der Anfragerolle für einen DBA ausgeben
```

Jeder Befehl wird unter [Datenbankbefehle](/docs/cli/database/) beschrieben, einschließlich der Reihenfolge, in der ein Befehl seine Datenbank auswählt; `push`, `generate` und `migrate` werden ausführlich unter [Schemagenerierung](/docs/cli/schema/) behandelt.

### `rebase console`

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Eine Node-REPL mit geöffneten Projektdaten oder Ausführung eines einzelnen Snippets mit `-e`:

```bash
rebase console
rebase console -e "rebase.dataAsAdmin.posts.find({ limit: 5 })"
```

`rebase` (`dataAsAdmin`, `sql`, `withAuth(user)`) und `collections` (die Tabellen des Projekts, geladen aus `backend/schema`) befinden sich im Scope, und Top-Level-`await` funktioniert. Die Datenbank wird so aufgelöst wie bei `rebase db push`, und das Öffnen ändert nichts an ihr. Mit `-e` wird das per Await abgewartete Ergebnis als JSON auf stdout ausgegeben, und ein Fehler führt zu Exit `1`. Flags: `--eval`/`-e`, `--schema-dir`, `--database-url`, `--docker`. Siehe [Skripte und die Konsole](/docs/backend/scripts/).

### `rebase migrate`

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Einmalige Migrationen von einem Layout, das dieses Release nicht mehr liest:
`rebase migrate collections-to-tables` (`config/collections` → `backend/schema` und `frontend/src/cms`) und `rebase migrate sdk-calls` (`data.collection("x")` → `data.table("x")` in Ihrem eigenen Code). Deren Flags, was sie schreiben und der Abschnitt „Vor dem Deployment überprüfen“ finden sich unter [Schemagenerierung](/docs/cli/schema/#rebase-migrate).

### `rebase apps init` / `rebase apps config`

```bash
rebase apps list             # die von diesem Projekt deklarierten Apps
rebase apps init             # eine aus diesem Projekt abgeleitete rebase.json schreiben
rebase apps config <app>     # die Client-Konfiguration für eine App
```

`apps init` nimmt keinen Namen entgegen: Es leitet jede App aus dem Projekt ab, schreibt die gesamte `rebase.json` und verweigert das Überschreiben einer vorhandenen Datei, es sei denn, Sie übergeben `--force`.

Ein Namensargument wird abgelehnt. `--force` behält bei, was die Ableitung aus der ersetzten Datei nicht ermitteln kann: den Namen jeder App, ihren `path` und ihre `cms`-Route. Alles andere wird erneut abgeleitet, und eine deklarierte App, die nicht mehr gefunden wird, wird als entfernt gemeldet, sodass bei einem Scaffold die mitgelieferte `rebase.json` wiederhergestellt wird. Der Build-Befehl der statischen App verwendet den Paketmanager des Projekts.

Für ein Checkout, das nicht mit einem Cloud-Projekt verknüpft ist, meldet `apps config`, dass es nicht verknüpft ist (unabhängig davon, ob `rebase dev` läuft), und gibt die Backend-URL so an, wie `rebase dev` sie bereitstellt.

### `rebase status`

Alles, was dieses Projekt deklariert, und ob die Umgebung es tatsächlich bindet:

```bash
rebase status               # jede Ressource und die Variablen, die sie liest
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

Drei Dateien bestimmen, was ein Backend erreichen kann, und dieser Befehl gibt alle drei zusammen aus:
`rebase.json` gibt an, wo sich Ihr Code befindet und wer den Server ausführt,
`backend/resources.ts` legt fest, was das Projekt benötigt, und die Umgebung bestimmt, wie jedes Element erreicht werden kann. Alles andere — `rebase.resources.json`, das Bundle-Manifest — wird aus der mittleren Datei für Ausleser generiert, die Ihren Code nicht ausführen können; Sie schreiben dies niemals selbst.

Ein `○` ist der Status, den man besser vor als nach einem Deployment kennen sollte: deklariert, aber nicht konfiguriert. Ein `✗` bedeutet, dass die Umgebung etwas *falsch* setzt, was das Booten verweigert, anstatt in einen eingeschränkten Modus zu wechseln.

Eine `rebase.resources.json`, die nicht mehr mit den Deklarationen übereinstimmt, erhält eine `○`-Zeile. Eine Datei, die noch nicht geschrieben wurde, erhält keine: `rebase build` schreibt sie bei jedem Build, sodass ein Projekt, das noch nie gebaut wurde (wie ein frisches Scaffold), nichts zu beheben hat.

### `rebase resources`

Was dieses Projekt laut Deklaration benötigt — die Datenbanken, Buckets, Topics und Queues, die `backend/resources.ts` anfordert, sowie die Crons und Funktionen, die seine Dateien definieren:

```bash
rebase resources            # auflisten
rebase resources --write    # rebase.resources.json neu generieren
rebase resources --check    # fehlschlagen, wenn der eingecheckte Graph veraltet ist
rebase resources --json     # maschinenlesbar
```

`rebase resources --check` ist das Flag, das ein CI-Job verwendet, um bei einer `rebase.resources.json` fehlzuschlagen, die nicht mehr mit `backend/resources.ts` übereinstimmt.
`--json` lässt sich damit kombinieren: Bei Abweichungen beendet sich `rebase resources --check --json` mit dem Exit-Code 1 und einem Fehler-Envelope (`resource_graph_missing` oder `resource_graph_stale`), und bei Erfolg enthält der Graph `check.status`. `--write --json` schreibt die Datei und meldet `written.changed`.

Eine Ressource wird in `backend/resources.ts` deklariert — `database("analytics")`, `bucket("media")`, `topic("signups")`, `queue("thumbnails")` — oder ist eine Datei unter `backend/crons` oder `backend/functions`. Sie wird niemals manuell in `rebase.resources.json` geschrieben, welche aus diesen Deklarationen generiert wird, damit ein Host auslesen kann, was ein Projekt benötigt, ohne es bauen zu müssen. Jeder Eintrag protokolliert, wer ihn verwendet (`table:events`, `column:posts.cover`, `function:report`).

Ein Backend verfügt zudem über eine Standarddatenbank und eine Standard-Speicherquelle, die niemand deklariert. Beide werden hier aufgeführt, als `implicit` markiert und keine von beiden wird in `rebase.resources.json` geschrieben — der Host stellt sie bereit, daher würde ihre Erfassung die Bereitstellung von etwas anfordern, das niemand verlangt hat. Das Deklarieren einer benannten Ressource, wie z. B. `bucket("media")`, lässt die Standardressource unverändert bestehen, sodass beide aufgeführt werden. Nur das Deklarieren des Standards selbst oder das Markieren eines Buckets mit `default: true` ersetzt diesen.

Um zu sehen, was die Plattform für ein Projekt im Vergleich zu dem vorhält, was der Code deklariert, und um eine bereitgestellte Datenbank zu entfernen, die der Code nicht mehr nennt, siehe [`rebase cloud resources`](/docs/cli/cloud#resources).

`rebase cloud` — alle Befehle für Rebase Cloud: Authentifizierung, Projektverknüpfung, Deployments, Konfiguration, Datenbanken, Ressourcen, Compute und mehr — hat [eine eigene Seite](/docs/cli/cloud).

### `rebase generate-sdk`

<span class="since-badge" data-since="0.31">Seit 0.31</span>

```bash
rebase generate-sdk
```

Schreibt einen typisierten Client für die Tabellen, die `backend/schema/index.ts` exportiert, nach `generated/sdk/`, mit `TableName` und `tablesDictionary`; `--from <link|url>` liest stattdessen den Vertrag eines laufenden Backends aus. `--register` typisiert auch serverseitige Daten: Es schreibt die Typen und die `Register`-Deklaration nach `backend/generated/` und hinterlegt dies in `rebase.json` (`registerDatabase`). Siehe [Typisierte serverseitige Daten](/docs/backend/typed-server-data) und [Schemagenerierung](/docs/cli/schema/#rebase-generate-sdk).

### `rebase doctor`

```bash
rebase doctor
```

Der Befehl, den Sie ausführen, wenn etwas nicht stimmt und Sie noch nicht wissen, woran es liegt. Er analysiert und ändert niemals etwas, sodass er für jede erreichbare Datenbank sicher ist.

**Ohne Datenbank.** Diese Prüfungen laufen zuerst, da alles, was ein Projekt gänzlich an der Ausführung hindert, eintritt, bevor eine Tabelle verglichen werden kann:

| Prüfung | Grund |
| --- | --- |
| Node-Version | Abgleich mit dem vom CLI deklarierten Bereich. Eine zu alte Version wird nicht als „nicht unterstütztes Node“ gemeldet — sie äußert sich als Syntaxfehler innerhalb einer Abhängigkeit. |
| Paketmanager | Zwei Lockfiles in einem Projekt. `npm install` in einem pnpm-Workspace schreibt `node_modules` in ein Layout um, mit dem pnpm nicht kompatibel ist; das Symptom ist Stunden später `Cannot find module`. |
| Doppelte Slugs | Zwei Tabellen, die denselben Slug deklarieren. Das Schema verweigert die Kompilierung, und diese Prüfung nennt beide. |
| `.env`-Plausibilität | Ein `JWT_SECRET`, das kürzer als 32 Zeichen ist (woraufhin die Produktion den Start verweigert), und `NODE_ENV=production` ohne `CORS_ORIGINS` oder `FRONTEND_URL`. Werte werden niemals ausgegeben. |
| Versionsunterschiede bei `@rebasepro/*` | Dasselbe Paket, das in verschiedenen `package.json`-Dateien des Projekts auf unterschiedliche Versionen festgelegt ist. Zwei Kopien beschädigen `instanceof` untereinander, was dazu führt, dass ein Type Guard seinen eigenen Typ ablehnt. |
| Connection-Strings | Ein nicht kodiertes `=` in einem URL-Parameter, dessen Parsing die eigenen Werkzeuge von PostgreSQL verweigern — Backups und `psql` schlagen fehl, während die App weiterläuft. |
| Benutzerdefinierte Funktionen | Was jede Funktion von ihrem Host benötigt und welche davon auf einer Edge-Runtime nicht laufen würden. |

**Gegen die Datenbank** — die projekteigene Datenbank, aufgelöst so wie `rebase db url` sie auflöst; bei einem frischen Scaffold ist dies die verwaltete Datenbank, die `doctor` startet:

| Prüfung | Grund |
| --- | --- |
| Tabellen → generiertes Schema | Ob `schema.generated.ts` veraltet ist. |
| Tabellen → Datenbank | Fehlende Tabellen, Spalten, Enums, Fremdschlüssel und Verknüpfungstabellen. |
| Erforderliche Erweiterungen | Eine `col.vector()`-Spalte benötigt pgvector, was Rebase nur dort installiert, wo ein Projekt es deklariert hat. |
| Schema-Stempel | Ob diese Datenbank aus diesen Tabellen bereitgestellt wurde. Ein Hash, der anzeigen kann, dass beide voneinander abweichen, aber niemals, welche Version weiter ist. Ein `v1:`-Stempel aus einer Runtime vor 0.31 wird einmalig gemeldet, mit dem Befehl zur Neuerstellung: `rebase db push`. |
| Tabellen → SDK-Typen | Ob das generierte typisierte SDK veraltet ist. |
| RLS-Richtlinien | Ob die Richtlinien der Datenbank mit dem deklarierten `rls` übereinstimmen und ob eine Richtlinie eine Rolle nennt, die dieser Server nicht verwenden kann. |

Ist die Datenbank nicht erreichbar, werden ihre Phasen als übersprungen mit Angabe des Grundes ausgewiesen und der Rest läuft weiter — siehe [Fehlerbehebung](/docs/troubleshooting/).

Beendet sich mit einem Exit-Code ungleich null, wenn eine Prüfung einen Fehler findet oder wenn eine Phase nicht ausgeführt werden konnte, weil die angegebene Datenbank Verbindungen ablehnt. Eine Phase, die übersprungen wurde, weil keine Datenbank aufgelöst werden konnte, gilt nicht als Fehler.

`rebase doctor --policies` führt nur die RLS-Prüfungen aus — kein Schema-Diff, keine SDK-Typen — und schlägt restriktiv fehl (Fail-Closed), was es zur idealen Variante als CI-Gate gegen eine deployte Datenbank macht.

`rebase doctor --database` führt nur den Datenbank-Preflight aus: ob die Rolle, unter der authentifizierte Anfragen laufen, existiert, eingeschränkt ist und zu ihr gewechselt werden kann, welche anderen Logins zu ihr wechseln können, ob jede Rolle eine Verbindung herstellen darf und welche Tabellen, Berechtigungen und Richtlinien Rebase mit anderen Rollen teilen würde. Jedes Ergebnis nennt das SQL, das als Administrator auszuführen ist, die `rls`-Einstellung, die Rebase stattdessen an die Datenbank anpasst, oder beides. Der Befehl liest den Katalog und ändert nichts; er beendet sich mit 1, wenn ein Befund ein Fehler ist. Er funktioniert auch bei einem Headless-Projekt. Siehe [Ausführung auf einer bestehenden oder geteilten Datenbank](/docs/deployment/existing-database/).

### `rebase verify`

```bash
rebase verify
rebase verify --json
rebase verify --live
rebase verify --live --database-url postgresql://…
```

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Prüft in einem schnellen Befehl für CI und für Hooks eines KI-Agents, ob die Tabellen bereit für das Deployment sind. Standardmäßig offline, und ändert niemals etwas.

| Schritt | Was zum Fehlschlagen führt |
| --- | --- |
| Tabellendefinitionen (`schema`) | `backend/schema` lädt nicht oder kompiliert nicht über den Loader, mit dem das Backend bootet: eine Relation zu einer Tabelle, die der Index nicht exportiert, `rls: "inherit"` ohne `defaultRls`, eine Tabelle ohne Primärschlüssel — ein Befund pro Problem. Eine Tabelle ohne `rls` ist einer davon. |
| RLS-Abdeckung (`rls`) | Eine Tabelle mit einer Spalte `user_id`, `owner_id`, `organization_id` oder `tenant_id`, deren Regeln — eigene oder das geerbte `defaultRls` — einer Rolle erlauben, jede Zeile unabhängig davon zu lesen. Eine Warnung. |
| Migrations-Aktualität (`migrations`) | Eine von den Tabellen deklarierte Tabelle oder Spalte, die von keiner Datei in `backend/drizzle/migrations` erstellt wird, oder eine von ihnen entfernte Spalte/Tabelle, die eine Migration immer noch erstellt. Wird für ein Projekt übersprungen, das noch keine Migrationen hat. |
| CMS-Anpassungen (`cms`) | Ein `customizeTable(...)` in `frontend/src/cms` (oder im `src/cms` einer statischen App in `rebase.json`), das nicht mit den Tabellen übereinstimmt, statisch gelesen — die Module werden nicht ausgeführt. `cms-unknown-table`: Der Slug nennt keine Tabelle, daher ignoriert das Panel ihn (der ähnlichste Slug wird vorgeschlagen). `cms-unknown-field`: Ein Schlüssel unter `fields` ist weder eine Spalte noch eine Relation (der SQL-Name einer Spalte wird mit ihrem Schlüssel beantwortet). `cms-hidden-required`: Ein aus dem Formular ausgeschlossenes Feld (`hiddenInForm`, `readOnly`, `disabled`), dessen Spalte `NOT NULL` ohne Standardwert ist und vom Server nicht befüllt wird, sodass das Erstellen eines Datensatzes über das Panel immer fehlschlägt; eine Warnung, wenn ein `beforeSave`-Hook oder eine Transformation es befüllen könnte, und stummgeschaltet durch `filledByServer`. `cms-duplicate-customization`: Ein Slug wurde zweimal angepasst. `cms-not-static` (eine Warnung): Ein Aufruf, dessen Slug, Optionen oder `fields` keine Literale oder ein `const` derselben Datei sind, sodass darin nichts geprüft wurde. `cms-ui-config-not-mounted` (eine Warnung): `frontend/src/cms/ui-config.json` existiert, wird aber `<RebaseCMS>` nicht als `uiConfig` übergeben. `cms-backend-guard-missing`: Die Vite-Konfiguration des Frontends verwendet `rebaseBackendGuard()` nicht, weshalb `rebase build` dies verweigern würde. Ein Headless-Projekt hat kein `frontend/src/cms` und überspringt diesen Schritt. |
| Live-RLS-Audit (`live`) | Mit `--live`: Der [`rls-check`](/docs/rls-check)-Katalog gegen die Projektdatenbank und ob jede Migration angewendet wurde. Die Datenbank wird so aufgelöst wie bei den `db`-Befehlen — `--database-url`, `DATABASE_URL`, `--docker`, andernfalls die verwaltete Entwicklungsdatenbank. Eine Datenbank, die nicht konfiguriert ist oder nicht antwortet, ist ein Fehler, kein Überspringen: Das Audit wurde explizit angefordert. Eine aus einer `access: "public"`-Regel kompilierte `USING (true)`-Lese-Richtlinie ist eine Warnung, solange die API ein Token verlangt (`AUTH_REQUIRE`, standardmäßig aktiviert) — jeder angemeldete Benutzer liest jede Zeile — und ein Fehler bei `AUTH_REQUIRE=false`, wo die Zeilen anonym sind. |

`--json` gibt ein einzelnes Objekt aus: `{ ok, schemaDir, steps, findings, summary }`:
Jeder Schritt ist `{ id, title, status, detail? }` (`status` ist `passed`, `failed`, `warnings` oder `skipped`), und jeder Befund enthält `step`, `check` (ein stabiler Kebab-Case-Typ), `severity`, `message` und, sofern zutreffend, `fix`, `table`, `file`, `line` sowie den punktierten Pfad (`path`) in die Tabelle (`posts.rls[0]`) — damit ein Agent reparieren kann, was er beschädigt hat. `summary` zählt `errors` und `warnings`. `--quiet` gibt nichts aus, wenn alles erfolgreich durchläuft. Beendet sich bei einem Fehler mit einem Exit-Code ungleich null; Warnungen führen nicht zum Fehlschlagen.

Ein gescaffoldetes Projekt führt dies nach jeder Bearbeitung unter `backend/schema/` für Claude Code aus: siehe [`rebase skills install`](#rebase-skills-install).

### `rebase auth`

Befehle zur Authentifizierungsverwaltung:

```bash
rebase auth reset-password --email admin@example.com --password NewPassword123!
```

### `rebase api-keys`

Verwalten Sie die Service-API-Schlüssel des Projekts — die Anmeldedaten, die ein Agent, Skript oder ein anderer Dienst verwendet, im Gegensatz zur Sitzung eines Endbenutzers:

```bash
rebase api-keys list
rebase api-keys get abc123-def456
rebase api-keys create --name "Blog CI" --scopes data:read:posts,data:write:posts --expires-in 90
rebase api-keys create --name "Ops" --full-access --roles admin --expires-at 2027-01-31
rebase api-keys revoke abc123-def456
```

`--scopes` gibt an, was der Schlüssel tun darf, kommagetrennt oder wiederholt; `--full-access` verleiht ihm jeden Scope, den der Service-Schlüssel besitzt, außer `keys:*`. `--roles` fügt RLS-Rollen neben `service` hinzu, `--expires-in` akzeptiert Tage und `--expires-at` ein ISO-Datum. `rebase api-keys scopes` listet jeden Scope auf, den das Backend kennt. Ein Schlüssel wird nur einmal angezeigt. Sowohl die Scopes des Schlüssels als auch die Row-Level Security der Identität, als die er agiert, finden Anwendung. Siehe [API-Schlüssel](/docs/backend/api-keys/).

### `rebase storage`

Umfassende Wartung gespeicherter Dateien über das laufende Backend mit `REBASE_SERVICE_KEY` aus `.env`:

```bash
rebase storage orphans                         # Dateien, die von keiner Zeile referenziert werden
rebase storage orphans --source media --delete # und diese nach Bestätigung löschen
rebase storage move --from "(default)" --to media --prefix avatars
rebase storage move --from "(default)" --to media --prefix avatars --delete-source
```

`orphans` liest jede Zeile jeder Tabelle im gespeicherten Zustand (einschließlich Soft-Deleted-Zeilen, unter Umgehung aller `beforeQuery`- und `afterRead`-Hooks) und jeden [History](/docs/backend/history/)-Eintrag, da ein Revert dessen Inhalt wiederherstellt. Es listet die Dateien einer Quelle auf (`--source`, die Standardquelle, wenn weggelassen), die von keinem String in diesen Einträgen genannt werden: ein Schlüssel, eine URL, eine `rebase-storage:`-Referenz in einem Text. Dateien, die neuer als `--older-than` Stunden sind (standardmäßig 24), werden ausgelassen, da das Admin-Panel eine Datei hochlädt, bevor die Zeile gespeichert wird, die sie referenziert. Der Scan läuft im Hintergrund auf dem Backend, sodass auch ein Projekt fertiggestellt werden kann, das zu groß ist, um innerhalb eines einzelnen Requests gescannt zu werden (hinter einem Ingress mit Timeout). Das CLI startet den Scan und zeigt dann dessen Fortschritt an (aufgelistete Dateien, gelesene Zeilen, abgeschlossene Tabellen und eventuell nicht lesbare Tabellen), bis er beendet ist. Bei aktivierter [Job-Queue](/docs/backend/jobs/) ist der Scan ein `storage.orphans`-Job, den die Job-Worker ausführen. Ohne diese läuft der Scan innerhalb des angefragten Serverprozesses, worauf das CLI hinweist: Ein Neustart dieses Prozesses bricht den Scan ab. Ein Scan entspricht einem Job-Versuch, begrenzt durch `jobs.timeoutMs` (standardmäßig 15 Minuten). Erhöhen Sie diesen Wert oder setzen Sie ihn auf 0 für Quellen, die länger benötigen. `--json` gibt denselben Bericht wie zuvor aus, ergänzt um die `scanId`.

`--delete` fragt vor dem Löschen nach (`--yes` überspringt die Nachfrage und ist ohne Terminal erforderlich). Es löscht nur aus dem gerade ausgegebenen Scan und nur innerhalb von 15 Minuten nach dessen Abschluss. Es wird nichts gelöscht, solange eine Tabelle nicht gelesen werden kann: Eine Tabelle mit Read-Hooks auf einer Datenbank, deren Treiber diese nicht umgehen kann, gilt als ungelesen. Vor dem Löschen liest der Server jede Zeile und jeden History-Eintrag erneut gegen die aufgelisteten Dateien ab. Anschließend fragt er jede Datei unmittelbar vor dem Löschen erneut ab. Eine Datei, die jetzt von einer Zeile referenziert wird, die seit dem Scan erneut hochgeladen wurde oder die bereits verschwunden ist, wird beibehalten, und das CLI führt sie als beibehalten auf. Dateien, die nur von Tabellen referenziert werden, die Rebase nicht bedient, sehen ungenutzt aus: Prüfen Sie dies vor dem Löschen. Bei einem Backend der Version 0.25.1 oder älter scannt das CLI auf die alte Weise innerhalb einer einzelnen Anfrage.

`move` kopiert die Dateien unter `--prefix` seitenweise unter denselben Schlüsseln zu einer anderen Quelle. Eine Datei, die das Ziel bereits mit derselben Größe enthält, wird übersprungen, sodass ein abgebrochener Verschiebevorgang durch erneutes Ausführen fortgesetzt werden kann; `--delete-source` löscht jede Datei aus der Quelle, sobald das Ziel sie enthält, und wird verweigert, wenn beide Quellen denselben Bucket oder dasselbe Verzeichnis nutzen. Sobald der Vorgang abgeschlossen ist, durchläuft das CLI die Quelle erneut und listet jede Datei auf, die nicht verschoben wurde: mit `--delete-source` jede Datei, die sich noch in der Quelle befindet; ohne dieses Flag jede Datei, von der das Ziel keine Kopie derselben Größe besitzt. Werden solche Dateien gefunden, beendet sich der Befehl mit Exit 1; ein erneuter Aufruf nimmt diese Dateien wieder auf. `--json` gibt sie als `notMoved` aus. Das Lesen des Scan-Berichts erfordert `database:read`. Das Starten eines Scans, das Löschen und das Verschieben erfordern `database:write`, worüber der Service-Schlüssel verfügt.

### `rebase skills install`

Installieren Sie die Rebase-Referenz-Skills für Ihre KI-Coding-Assistenten — jedes oben genannte `--agent`:

```bash
rebase skills install
rebase skills install --agent claude,cursor
rebase skills install --agent all
rebase skills --hooks
```

Siehe [Agent Skills](/docs/ai/skills) für die vollständige Liste und die Speicherorte der geschriebenen Dateien.

`--hooks` installiert das Claude Code Guardrail, das `rebase init` mit jedem Projekt ausliefert: `.claude/hooks/post-edit-collection.sh`, registriert als `PostToolUse`-Hook in `.claude/settings.json`, welcher nach jeder Bearbeitung unter `backend/schema/` oder `frontend/src/cms/` den Befehl `rebase verify --quiet` ausführt und jedes Problem an den Agent zurückgibt. Bestehende Einstellungen und Hooks bleiben erhalten. `rebase skills --hooks` installiert den Hook separat.

### `rebase telemetry`

Anonyme Erfassung von Nutzungsdaten, deaktiviert bis zu Ihrer Zustimmung. Ein interaktives `rebase init` fragt am Ende nach, wobei die Standardantwort Nein ist; es wird also nichts geteilt, es sei denn, Sie stimmen ausdrücklich zu. Die Antwort gilt pro Rechner (`~/.rebase/telemetry.json`): Nach einem Ja fragt `init` nie wieder nach, und nach einem Nein fragt das nächste `init` erneut. Jedes Checkout erhält eine zufällige Projekt-ID, die in der gitignorierten Datei `.rebase/telemetry-project.json` gespeichert wird.

```bash
rebase telemetry status
rebase telemetry show
rebase telemetry enable
rebase telemetry disable
```

`status` gibt die aktuelle Einstellung aus, `show` zeigt exakt, was gesendet werden würde — unabhängig davon, ob das Teilen aktiviert ist, sodass Sie die Daten vor Ihrer Entscheidung einsehen können —, und die anderen beiden Befehle ändern die Einstellung. Wenn Sie `init` nie ausgeführt haben, wurden zu keinem Zeitpunkt Daten erfasst.

## Nächste Schritte

- **[Schemagenerierung](/docs/cli/schema/#production-workflow)** — Der Migrations-Workflow, von der Tabellenbearbeitung bis zur Produktion
- **[Schema as Code](/docs/architecture/schema-as-code)** — Wie die Schemagenerierung funktioniert
- **[Schnellstart](/docs/getting-started/quickstart)** — Erste Schritte
