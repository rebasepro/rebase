---
sourceHash: 38a7979a6ca8b028
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

Oder führen Sie jeden Befehl ohne Installation aus: `pnpm dlx @rebasepro/cli <command>`.

## Maschinenlesbare Ausgabe

`--json` ist der Schalter, und außerhalb der `cloud`-Familie ist es der einzige: `rebase status`, `rebase resources`, `rebase apps list`, `rebase upgrade` und `rebase verify` geben dann einen einzelnen JSON-Wert auf stdout aus — das Ergebnis oder einen `{"error": {"message", "code", "hint", "issues"}}`-Envelope mit einem Exit-Code ungleich null — bei **jedem** Beenden des Befehls, sodass ein Aufrufer stdout bedingungslos parsen kann. Ohne diesen Schalter schreiben sie für Menschen lesbaren Text und Fehler gehen an stderr. `rebase cloud` verwendet denselben Envelope und ist die einzige Ausnahme von dieser Regel: Es schaltet JSON auch selbstständig ein, wenn stdout kein TTY ist oder wenn `REBASE_JSON=1` gesetzt ist. Daher ist `rebase cloud status | cat` JSON, während `rebase status | cat` dies nicht ist — übergeben Sie in einem Skript explizit `--json`, anstatt sich auf eine der beiden Regeln zu verlassen.

## Befehle

### `rebase init`

Initialisieren Sie ein neues Rebase-Projekt:

```bash
rebase init [directory]
```

Richtet ein `backend/` (die Tabellen in `backend/schema/`) und ein `frontend/` (das Admin-Panel mit seinen Tabellenanpassungen in `frontend/src/cms/`) ein; `--headless` scaffoldet nur das `backend/` ohne `backend/schema/`. Die [Projektstruktur](/docs/getting-started/project-structure/) zeigt beide Verzeichnisbäume.

| Flag | Beschreibung |
|---|---|
| `-t, --template <preset>` | `blog`, `ecommerce` oder `blank`. Standard ist `blog` |
| `--headless` | Nur Backend — kein Admin-Panel und kein `backend/schema/`: Der Server stellt die datenbankeigenen Tabellen bereit. `--template` hat keine Auswirkung, da keine Tabellen für ein Seeding vorhanden sind |
| `-y, --yes` | Niemals nachfragen. **Erforderlich überall dort, wo kein Terminal zum Antworten vorhanden ist**, wie z. B. in CI. Überspringt Git-Init und die Installation von Abhängigkeiten — die interaktiven Standardeinstellungen bejahen beides; übergeben Sie also `--git` / `--install`, falls Sie dies wünschen |
| `-i, --install` | Abhängigkeiten nach dem Scaffolding installieren. Ohne dieses Flag fragt init nach (Standard: Ja); unter `--yes` wird nichts installiert |
| `--no-install` | Nichts installieren und nicht nachfragen |
| `-g, --git` | Ein Repository initialisieren und den ersten Commit erstellen. Ohne dieses Flag fragt init nach (Standard: Ja); unter `--yes` wird kein Repository erstellt |
| `--database-url <url>` | Eine bestehende Datenbank anstelle der verwalteten verwenden. Es muss eine `postgres://`- oder `postgresql://`-URL sein: Alles andere wird abgelehnt, bevor eine Datei geschrieben wird, und die interaktive Abfrage fragt erneut nach |
| `--introspect` | `backend/schema` aus dieser Datenbank generieren. Impliziert `--template blank` und erfordert `--install` |
| `--project <slug>` | Das Scaffold mit einem Rebase-Cloud-Projekt verknüpfen |
| `--setup-key <key>` | Der Einmalschlüssel, der diese Verknüpfung authentifiziert |
| `-a, --agent <name>` | KI-Coding-Agents einrichten: die [Skills](/docs/ai/skills) und den [MCP-Server](/docs/ai/mcp). Wiederholbar oder kommagetrennt — `claude`, `cursor`, `windsurf`, `gemini`, `codex`, `kiro`, `copilot` oder `all`. Ohne dieses Flag fragt `init` nach und wählt die auf dem Rechner installierten Agents vorab aus; unter `--yes` wird keiner eingerichtet |

### `rebase dev`

Starten Sie den Entwicklungsserver:

```bash
rebase dev
```

Startet sowohl Frontend als auch Backend mit Hot-Reloading und generiert das Drizzle-Schema sowie die SDK-Typen (`generated/sdk/`) beim Start und bei jedem Speichern unter `backend/schema/` neu. Das gestartete Backend stellt auch den [Remote-MCP-Endpunkt](/docs/ai/remote-mcp/) unter `/mcp` ohne weiteren Konfigurationsaufwand bereit, es sei denn, eine `REBASE_MCP_ENABLED`-Zeile in der Shell oder in `.env` bestimmt etwas anderes; die `MCP:`-Zeile des Banners gibt die URL aus, und [`rebase mcp connect`](/docs/cli/project/#rebase-mcp) verbindet einen KI-Client damit.

Beide Ports werden aus dem Pfad des Projekts abgeleitet, sodass mehrere Rebase-Projekte parallel laufen können. Verwenden Sie die URLs, die `rebase dev` ausgibt. Fixieren Sie einen Port mit `rebase dev --port 3001`.

Eine statische App in `rebase.json` ohne Build-Schritt (kein `build`, und `output` ist ihr `root`, wie etwa eine reine HTML-Website) wird vom Backend aus diesem Verzeichnis unter ihrem `path` bereitgestellt, so wie `rebase start` sie aus dem Bundle ausliefert, und `FRONTEND_URL` wird darauf gesetzt (auf dem Port des Backends), damit per E-Mail versendete Links dort landen. Ihre [`redirects` und `cleanUrls`](/docs/architecture/redirects-and-clean-urls/) werden ebenfalls bereitgestellt, und eine App, die Weiterleitungen deklariert, benötigt keine `index.html`. Eine App mit einem Build läuft in Vite auf ihrem eigenen Port, und `FRONTEND_URL` ist die von Vite.

Eine Änderung an `.env` startet das Backend neu, das die Datei erneut einliest, ebenso wie das Admin-Panel. Was `rebase dev` selbst festlegt, bleibt bis zum Neustart erhalten: `PORT` sowie `DATABASE_URL`, wenn die verwaltete Datenbank oder Docker verwendet wird.

Mit `--database-url` prüft `rebase dev` zuerst, ob unter diesem Host und Port etwas antwortet. Wenn nicht, wird dies unter Nennung des Flags gemeldet und mit `1` beendet, ohne dass etwas gestartet wurde; die `.env`-Namen der Datenbank bleiben ebenfalls unberührt und der Compose-Container wird niemals gestartet.

### `rebase build`

Erstellen Sie das Projekt als deploybares Bundle in `dist-bundle/`:

```bash
rebase build
```

Das Bundle ist das Artefakt, das Sie deployen — das Runtime-Image lädt es, sodass Sie kein eigenes Anwendungs-Image erstellen müssen. Nützliche Flags:

| Flag | Wirkung |
|------|---------|
| `--output <dir>` (oder `--out`) | Das Bundle an einen anderen Ort als `dist-bundle/` schreiben (jeweils eine App auf einmal) |
| `--vendor` | Die Abhängigkeiten des Bundles immer installieren und mitliefern |
| `--no-vendor` | Niemals vendoren; der Pod installiert sie bei jedem Start |
| `--skip-type-check` | Typprüfung überspringen (schneller, weniger sicher) |
| `--no-static` | Das Frontend nicht in das Backend-Bundle einbinden (jede statische App erhält weiterhin ihr eigenes Bundle) |
| `--skip-static-build` | Das Frontend im bereits erstellten Zustand einbinden, ohne dessen Build-Befehl auszuführen |

Ein Frontend — jede statische App in `rebase.json` mit einer Vite-Konfiguration —, dessen Konfiguration nicht `rebaseBackendGuard()` (aus `@rebasepro/app/vitePlugin`) verwendet, wird abgelehnt: Dies hält Servercode aus dem Browser-Bundle fern und verhindert, dass Vite eine Backend-Datei als `data:`-URL inline einbettet (der Build schlägt unter Angabe des Plugins fehl, wenn ein anderes Plugin dessen `build.assetsInlineLimit` überschreibt). `frontend/src/cms/ui-config.json` wird als `entry.uiConfig` in das Bundle übernommen – die Workspace-Darstellung, die ein deploytes Backend bereitstellt.

Abhängigkeiten werden standardmäßig im Bundle mitgeliefert (vendored), damit eine neue Instanz nicht 35–55 Sekunden für die Installation aufwenden muss. Ein Verzeichnisbaum, der auf der Festplatte mehr als 2 GB groß wird, wird stattdessen verworfen, da das Upload-Limit komprimiert 1 GB beträgt.

Jede statische App, die das Bundle enthält, erhält neben jedem Content-gehashten Asset ab 1 KB — den Dateien, die ein Browser ein Jahr lang zwischenspeichert — eine Brotli- (`.br`) und eine Gzip-Kopie (`.gz`). Die Runtime sendet die Variante, die der Browser akzeptiert, sodass diese Dateien keinen Komprimierungsaufwand pro Anfrage verursachen (inklusive des ersten Aufrufs nach einem Deployment), und Browser, die Brotli unterstützen, erhalten dieses (bei dem JavaScript des Admin-Panels etwa 11 % kleiner als Gzip). Die eigene Build-Ausgabe Ihres Frontends bleibt unverändert; nur die Kopie im Bundle ändert sich. Bei der Beispiel-App verlängert dies den Build um weniger als eine Sekunde und vergrößert das Bundle um etwa 2,4 MB.

### `rebase upgrade`

Aktualisiert jedes im Projekt festgelegte `@rebasepro/*`-Paket auf ein bestimmtes Release und installiert es anschließend mit dem Paketmanager, der durch das Lockfile bestimmt wird. `rebase upgrade` nimmt das neueste; `--to 0.21.0` eine exakte Version ohne Registry-Abfrage; `--to canary` ein Dist-Tag. Jeder Eintrag in `dependencies`, `devDependencies` und `optionalDependencies` in jeder `package.json` des Projekts behält sein `^` oder `~`, und sonst ändert sich nichts in der Datei. `peerDependencies` sowie `workspace:`, `link:`, `file:`, Git- und Tag-Spezifikationen werden aufgelistet und nicht angetastet. Overrides in `pnpm-workspace.yaml` und `package.json` werden ebenfalls angepasst, aber ein `link:`- oder `file:`-Override hat Vorrang vor jedem Pin: Dies wird gemeldet und mit `--drop-local-overrides` entfernt. `--dry-run` schreibt nichts, `--no-install` überspringt die Installation und `--json` gibt ein einzelnes Dokument aus.

Ein Projekt mit einem Vorab-Release (Prerelease), wie z. B. Canary, bleibt auf seinem Kanal, es sei denn, `latest` ist neuer. Ein Dist-Tag, das einen Versions-Pin zurücksetzen würde, wird abgelehnt (`downgrade_refused` unter `--json`), es sei denn, Sie übergeben `--allow-downgrade`; ein exaktes `--to` wird angewendet und als Downgrade gekennzeichnet. Ein `--dry-run` eines Upgrades, das die tatsächliche Ausführung ablehnen würde, zeigt an, was geändert werden würde, und beendet mit 0; unter `--json` enthält das Dokument die Ablehnung als `wouldRefuse` (`{ code, message, hint }`). Sobald es installiert ist, aktualisiert es auch die [Agent-Skills](/docs/ai/skills/#updating-the-skills) des Projekts über die neue CLI (`skills` im `--json`-Dokument). Andere Befehle enden mit einer Zeile auf stderr, wenn ein neueres Release verfügbar ist; [`REBASE_NO_UPDATE_CHECK=1`](/docs/getting-started/configuration/) blendet dies aus.

### `rebase start`

Führen Sie das erstellte Bundle so aus, wie es bei einem Deployment ausgeführt wird:

```bash
rebase start
```

Liest `PORT` und den Rest von `.env`, anders als `rebase dev`, in dem dort festgelegten `NODE_ENV`. Ein generiertes `.env` steht auf `development`, daher wird der erste registrierte Account weiterhin zum Admin, worauf `rebase start` ganz oben hinweist; setzen Sie für einen Produktionsserver `NODE_ENV=production`. `rebase start --bundle ./dist-bundle` führt ein Bundle an einem anderen Ort aus.

`rebase start` startet keine Datenbank, und das `.env` des Scaffolds enthält kein `DATABASE_URL`. Eine lokale Ausführung mit der Datenbank, die `rebase dev` nutzt, lautet daher: `DATABASE_URL="$(rebase db url)" rebase start`. Ohne Angabe wird diese Zeile vor dem Booten ausgegeben.

### `rebase apps list`

Zeigt die Apps an, die dieses Repository deklariert:

```bash
rebase apps list
```

Ein Repository kann mehr als eine deploybare App deklarieren – beispielsweise ein Backend und eine Marketing-Website. So sehen Sie, worauf `rebase build` und das Deployment angewendet werden.

### `rebase eject`

Übernehmen Sie die volle Kontrolle über den Server-Prozess und dessen Image:

```bash
rebase eject
```

Schreibt den Backend-Einstiegspunkt und eine `Dockerfile` in das Projekt und stellt das Backend um, sodass das Repository ein eigenes Image baut, anstatt die veröffentlichte Runtime auszuführen. Von da an **greifen Plattform-Runtime-Upgrades nicht mehr**, und Sie sind selbst für die Konfiguration von CORS, Auth-Anbindung, Storage und Shutdown verantwortlich.

Zeigen Sie eine Vorschau mit `rebase eject --dry-run` an, was auflistet, was sich ändern würde, aber nichts verändert. `--force` ersetzt eine vorhandene `backend/src/index.ts` oder `env.ts` und behält die aktuelle Datei als `<name>.bak`.

Der ausgeworfene (ejected) Server speichert lokale Uploads im `uploads/`-Verzeichnis des Projekts, unabhängig davon, ob er aus dem Quellcode oder kompiliert ausgeführt wird, genau wie `rebase dev`. Er läuft in `backend/`, daher wird ein relativer `STORAGE_PATH` dort ausgehend von `backend/` gelesen.

### `rebase schema generate` / `rebase schema stale`

```bash
rebase schema generate       # backend/schema → backend/src/schema.generated.ts
rebase schema stale          # name what differs from the tables, exit 1 if anything does
rebase schema stale --fix    # regenerate the file instead
```

Jeder Befehl, der das Schema liest, akzeptiert `--schema-dir <dir>` für Projekte, die es an einem anderen Ort aufbewahren; `--collections` wurde entfernt. `rebase dev` hält die Datei aktuell, daher ist `stale` die Prüfung für einen Build oder CI. Siehe [Schemagenerierung](/docs/cli/schema/).

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

Jeder Befehl wird unter [Datenbank-Befehle](/docs/cli/database/) beschrieben, einschließlich der Reihenfolge, in der ein Befehl seine Datenbank auswählt; `push`, `generate` und `migrate` werden unter [Schemagenerierung](/docs/cli/schema/) ausführlich behandelt.

### `rebase console`

Eine Node-REPL mit geöffneten Projektdaten oder ein einzelnes Snippet, das mit `-e` ausgeführt wird:

```bash
rebase console
rebase console -e "rebase.dataAsAdmin.posts.find({ limit: 5 })"
```

`rebase` (`dataAsAdmin`, `sql`, `withAuth(user)`) und `tables` (die Tabellen des Projekts, geladen aus `backend/schema`) befinden sich im Scope, und Top-Level-`await` funktioniert. Die Datenbank wird genauso aufgelöst wie bei `rebase db push`, und das Öffnen verändert nichts daran. Mit `-e` wird das per `await` abgewartete Ergebnis als JSON auf stdout ausgegeben, und ein geworfener Fehler (throw) beendet mit `1`. Flags: `--eval`/`-e`, `--schema-dir`, `--database-url`, `--docker`. Siehe [Skripte und die Konsole](/docs/backend/scripts/).

### `rebase migrate`

Einweg-Migrationen von einem Layout, das dieses Release nicht mehr unterstützt: `rebase migrate collections-to-tables` (`config/collections` → `backend/schema` und `frontend/src/cms`) und `rebase migrate sdk-calls` (`data.collection("x")` → `data.table("x")` in Ihrem eigenen Code). Deren Flags, was sie schreiben und der Abschnitt „Vor dem Deployment prüfen“ finden sich unter [Schemagenerierung](/docs/cli/schema/#rebase-migrate).

### `rebase apps init` / `rebase apps config`

```bash
rebase apps list             # the apps this project declares
rebase apps init             # write a rebase.json inferred from this project
rebase apps config <app>     # the client configuration for one app
```

`apps init` nimmt keinen Namen entgegen: Es leitet jede App aus dem Projekt ab und schreibt die gesamte `rebase.json`. Es weigert sich, eine vorhandene Datei zu überschreiben, es sei denn, Sie übergeben `--force`.

Ein Namensargument wird abgelehnt. `--force` behält bei, was die Ableitung aus der zu ersetzenden Datei nicht wissen kann: den Namen jeder App, ihren `path` und ihre `cms`-Route. Alles andere wird erneut abgeleitet, und eine deklarierte App, die nicht mehr gefunden wird, wird als entfernt gemeldet; bei einem Scaffold wird also die ursprüngliche `rebase.json` wiederhergestellt. Der Build-Befehl der statischen App verwendet den Paketmanager des Projekts.

Bei einem Checkout, der nicht mit einem Cloud-Projekt verknüpft ist, meldet `apps config`, dass keine Verknüpfung vorliegt (unabhängig davon, ob `rebase dev` läuft), und gibt die URL des Backends so an, wie `rebase dev` sie bereitstellt.

### `rebase apps add admin`

```bash
rebase apps add admin                  # at /, or at /admin when another app is at /
rebase apps add admin --path /console  # anywhere else, or an https URL of its own
```

Fügt das Admin-Panel zu einem Headless- oder portierten Projekt hinzu, genau wie `rebase init` es erstellt hätte. Was geschrieben wird, welche Version festgeschrieben wird und wann es abgelehnt wird: [Admin-Panel nachträglich hinzufügen](/docs/getting-started/headless/#adding-an-admin-panel-later).

### `rebase status`

Alles, was dieses Projekt deklariert, und ob die Umgebung es tatsächlich anbindet:

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

Drei Dateien bestimmen, worauf ein Backend zugreifen kann, und dieser Befehl gibt alle drei zusammen aus: `rebase.json` gibt an, wo sich Ihr Code befindet und wer den Server ausführt, `backend/resources.ts` gibt an, was das Projekt benötigt, und die Umgebung gibt an, wie jede Ressource erreichbar ist. Alles andere — `rebase.resources.json`, das Bundle-Manifest — wird aus der mittleren Datei für Parser generiert, die Ihren Code nicht ausführen können, und wird niemals manuell geschrieben.

Ein `○` ist der Zustand, über den man lieber vor statt nach einem Deployment Bescheid wissen sollte: deklariert, aber nicht konfiguriert. Ein `✗` bedeutet, dass die Umgebung etwas *falsch* setzt, was das Booten verweigert, anstatt in einen fehlerhaften Zustand zu verfallen.

Eine `rebase.resources.json`, die nicht mehr mit den Deklarationen übereinstimmt, erhält eine `○`-Zeile. Eine Datei, die noch nicht geschrieben wurde, erhält keine: `rebase build` schreibt sie bei jedem Build, sodass ein Projekt, das noch nie gebaut wurde (wie ein frisches Scaffold), nichts zu korrigieren hat.

### `rebase resources`

Was dieses Projekt laut Deklaration benötigt — die Datenbanken, Buckets, Topics und Queues, die `backend/resources.ts` anfordert, sowie die Crons und Funktionen, die seine Dateien definieren:

```bash
rebase resources            # list them
rebase resources --write    # regenerate rebase.resources.json
rebase resources --check    # fail if the committed graph is stale
rebase resources --json     # machine-readable
```

`rebase resources --check` ist das Flag, das ein CI-Job verwendet, um bei einer `rebase.resources.json` fehlzuschlagen, die nicht mehr mit `backend/resources.ts` übereinstimmt. `--json` lässt sich damit kombinieren: Bei Abweichungen beendet `rebase resources --check --json` mit 1 und einem Fehler-Envelope (`resource_graph_missing` oder `resource_graph_stale`), und bei Erfolg enthält der Graph `check.status`. `--write --json` schreibt die Datei und meldet `written.changed`.

Eine Ressource wird in `backend/resources.ts` deklariert — `database("analytics")`, `bucket("media")`, `topic("signups")`, `queue("thumbnails")` — oder ist eine Datei unter `backend/crons` oder `backend/functions` und wird niemals manuell in `rebase.resources.json` geschrieben, welche aus diesen Deklarationen generiert wird, damit ein Host ohne Build lesen kann, was ein Projekt benötigt. Jeder Eintrag zeichnet auf, wer ihn verwendet (`table:events`, `column:posts.cover`, `function:report`).

Ein Backend hat außerdem eine Standarddatenbank und eine Standard-Storage-Quelle, die niemand deklariert. Beide werden hier aufgeführt, als `implicit` gekennzeichnet und nicht in `rebase.resources.json` geschrieben — der Host stellt sie bereit; ein Eintrag würde also das Bereitstellen von etwas anfordern, das niemand angefordert hat. Das Deklarieren einer benannten Ressource, wie z. B. `bucket("media")`, belässt den Standard unverändert, sodass beide aufgelistet werden. Nur das Deklarieren des Standards selbst oder das Kennzeichnen eines Buckets mit `default: true` ersetzt diesen.

Um zu sehen, was die Plattform für ein Projekt im Vergleich zu den Code-Deklarationen bereithält, und um eine bereitgestellte Datenbank zu entfernen, die der Code nicht mehr nennt, siehe [`rebase cloud resources`](/docs/cli/cloud#resources).

`rebase cloud` — alle Befehle für Rebase Cloud: Authentifizierung, Projektverknüpfung, Deployments, Konfiguration, Datenbanken, Ressourcen, Compute und mehr — hat [eine eigene Seite](/docs/cli/cloud).

### `rebase generate-sdk`

```bash
rebase generate-sdk
```

Schreibt einen typisierten Client für die von `backend/schema/index.ts` exportierten Tabellen nach `generated/sdk/`, mit `TableName` und `tablesDictionary`; `--from <link|url>` liest stattdessen den Vertrag eines laufenden Backends. `--register` typisiert auch serverseitige Daten: Es schreibt die Typen und die `Register`-Deklaration nach `backend/generated/` und hinterlegt dies in `rebase.json` (`registerDatabase`). Siehe [Typisierte serverseitige Daten](/docs/backend/typed-server-data) und [Schemagenerierung](/docs/cli/schema/#rebase-generate-sdk).

### `rebase doctor`

```bash
rebase doctor
```

Der Befehl, den man ausführt, wenn etwas nicht stimmt und man noch nicht weiß, was es ist. Er liefert Berichte und ändert niemals etwas, sodass er für jede erreichbare Datenbank sicher ist.

**Ohne Datenbank.** Diese Prüfungen laufen zuerst, da alles, was ein Projekt komplett am Funktionieren hindert, passiert, bevor eine Tabelle überhaupt verglichen werden kann:

| Prüfung | Warum |
| --- | --- |
| Node-Version | Abgleich mit dem von der CLI deklarierten Versionsbereich. Eine zu alte Version wird nicht als „nicht unterstütztes Node“ gemeldet, sondern führt zu einem Syntaxfehler innerhalb einer Abhängigkeit. |
| Paketmanager | Zwei Lockfiles in einem Projekt. Ein `npm install` in einem pnpm-Workspace schreibt `node_modules` in ein Layout um, das mit pnpm inkompatibel ist, und das Symptom ist Stunden später `Cannot find module`. |
| Doppelte Slugs | Zwei Tabellen, die denselben Slug deklarieren. Das Schema verweigert die Kompilierung, und dies benennt beide. |
| `.env`-Plausibilität | Ein `JWT_SECRET`, das kürzer als 32 Zeichen ist (womit die Produktion den Start verweigert), und `NODE_ENV=production` ohne `CORS_ORIGINS` oder `FRONTEND_URL`. Werte werden niemals ausgegeben. |
| `@rebasepro/*`-Versionsabweichungen | Dasselbe Paket ist in verschiedenen `package.json`-Dateien des Projekts auf unterschiedliche Versionen festgelegt. Zwei Kopien beschädigen `instanceof` untereinander, was dazu führt, dass ein Type Guard seinen eigenen Typ zurückweist. |
| Verbindungs-Strings | Ein nicht-kodiertes `=` in einem URL-Parameter, dessen Parsing die PostgreSQL-eigenen Tools verweigern — Backups und `psql` schlagen fehl, während die App weiterläuft. |
| Eigene Funktionen | Was jede Funktion von ihrem Host benötigt und welche davon auf einer Edge-Runtime nicht laufen würden. |

**Gegen die Datenbank** — die datenbankeigene des Projekts, aufgelöst wie von `rebase db url`; bei einem frischen Scaffold ist dies die verwaltete Datenbank, die von `doctor` gestartet wird:

| Prüfung | Warum |
| --- | --- |
| Tabellen → generiertes Schema | Ob `schema.generated.ts` veraltet ist. |
| Tabellen → Datenbank | Fehlende Tabellen, Spalten, Enums, Fremdschlüssel und Zwischentabellen (Junctions). |
| Erforderliche Extensions | Eine `col.vector()`-Spalte benötigt pgvector, was Rebase nur dort installiert, wo ein Projekt dies deklariert hat. |
| Schema-Stempel | Ob diese Datenbank aus diesen Tabellen bereitgestellt wurde. Ein Hash, der aussagt, ob die beiden nicht übereinstimmen, aber nie, welches weiter ist. Ein `v1:`-Stempel aus einer Runtime vor 0.31 wird einmal gemeldet, mit dem Re-Stempel-Befehl: `rebase db push`. |
| Tabellen → SDK-Typen | Ob das generierte typisierte SDK veraltet ist. |
| RLS-Policies | Ob die Policies der Datenbank mit dem deklarierten `rls` übereinstimmen und ob eine Policy eine Rolle nennt, die dieser Server nicht verwenden kann. |

Wenn die Datenbank nicht erreichbar ist, werden ihre Phasen als übersprungen mit dem jeweiligen Grund gemeldet und der Rest läuft weiter — siehe [Fehlerbehebung](/docs/troubleshooting/).

Wird mit einem Status ungleich null beendet, wenn eine Prüfung einen Fehler findet oder wenn eine Phase nicht ausgeführt werden konnte, weil die angegebene Datenbank Verbindungen ablehnt. Eine Phase, die übersprungen wurde, weil keine Datenbank aufgelöst werden konnte, gilt nicht als Fehler.

`rebase doctor --policies` führt nur die RLS-Prüfungen aus — kein Schema-Diff, keine SDK-Typen — und verhält sich im Zweifel restriktiv (fails closed), was es zur idealen Form für ein CI-Gate gegen eine deployte Datenbank macht.

`rebase doctor --database` führt nur den Datenbank-Preflight aus: ob die Rolle, unter der Anfragen angemeldeter Benutzer laufen, existiert, eingeschränkt ist und zu ihr gewechselt werden kann, welche anderen Logins zu ihr wechseln können, ob sich jede Rolle verbinden darf und welche Tabellen, Grants und Policies Rebase mit anderen Rollen teilen würde. Jeder Befund nennt das SQL, das als Administrator auszuführen ist, die `rls`-Einstellung, die Rebase stattdessen an die Datenbank anpasst, oder beides. Es liest den Katalog und ändert nichts, und beendet mit 1, wenn ein Befund ein Fehler ist. Dies funktioniert auch bei einem Headless-Projekt. Siehe [Ausführung auf einer bestehenden oder geteilten Datenbank](/docs/deployment/existing-database/).

### `rebase verify`

```bash
rebase verify
rebase verify --json
rebase verify --live
rebase verify --live --database-url postgresql://…
```

Prüft in einem schnellen Befehl für CI und für Hooks eines KI-Agents, ob die Tabellen sicher für das Release sind. Standardmäßig offline und ändert niemals etwas.

| Schritt | Was zum Fehlschlagen führt |
| --- | --- |
| Tabellendefinitionen (`schema`) | `backend/schema` lädt nicht oder kompiliert nicht über den Loader, von dem aus das Backend bootet: eine Relation zu einer Tabelle, die der Index nicht exportiert, `rls: "inherit"` ohne `defaultRls`, eine Tabelle ohne Primärschlüssel — ein Befund pro Problem. Eine Tabelle ohne `rls` gehört dazu. |
| RLS-Abdeckung (`rls`) | Eine Tabelle mit einer Spalte `user_id`, `owner_id`, `organization_id` oder `tenant_id`, deren Regeln — die eigenen oder das geerbte `defaultRls` — einer Rolle erlauben, jede Zeile ungeachtet dessen zu lesen. Eine Warnung. `rls-policy-recursion`: eine Regel, die ihre eigene Tabelle in einer Unterabfrage liest, oder zwei Tabellen, deren Regeln sich gegenseitig lesen, was Postgres nicht auflösen kann, sodass jedes dadurch geschützte Statement mit `42P17 infinite recursion detected in policy` fehlschlägt; der Befund nennt die gelesene Tabelle und den Fix (das Verschieben des Lesevorgangs in eine `SECURITY DEFINER`-Funktion). Ein Fehler, oder eine Warnung, wenn die Schleife nicht sicher ist. |
| Migrations-Aktualität (`migrations`) | Eine Tabelle oder Spalte, die die Tabellen deklarieren, die von keiner Datei in `backend/drizzle/migrations` erstellt wird, oder eine verworfene, die eine Migration immer noch erstellt. Wird bei Projekten ohne bisherige Migrationen übersprungen. |
| CMS-Anpassungen (`cms`) | Ein `customizeTable(...)` in `frontend/src/cms` (oder `src/cms` einer statischen App in `rebase.json`), das nicht zu den Tabellen passt, statisch gelesen — die Module werden nicht ausgeführt. `cms-unknown-table`: Der Slug nennt keine Tabelle, daher ignoriert das Panel ihn (der ähnlichste Slug wird vorgeschlagen). `cms-unknown-field`: Ein Schlüssel unter `fields` ist weder eine Spalte noch eine Relation (der SQL-Name einer Spalte wird mit ihrem Schlüssel beantwortet). `cms-hidden-required`: Ein im Formular ausgeblendetes Feld (`hiddenInForm`, `readOnly`, `disabled`), dessen Spalte `NOT NULL` ist, ohne Standardwert und ohne serverseitige Befüllung, sodass das Erstellen eines Datensatzes über das Panel immer fehlschlägt; eine Warnung, wenn ein `beforeSave`-Hook oder eine Transform-Funktion dies füllen könnte, stummgeschaltet durch `filledByServer`. `cms-duplicate-customization`: Ein Slug wurde doppelt angepasst. `cms-not-static` (eine Warnung): Ein Aufruf, dessen Slug, Optionen oder `fields` keine Literale oder `const` aus derselben Datei sind, sodass darin nichts überprüft wurde. `cms-ui-config-not-mounted` (eine Warnung): `frontend/src/cms/ui-config.json` existiert, wird aber `<RebaseCMS>` nicht als `uiConfig` übergeben. `cms-backend-guard-missing`: Die Vite-Konfiguration des Frontends verwendet `rebaseBackendGuard()` nicht, sodass `rebase build` sie ablehnen würde. Ein Headless-Projekt hat kein `frontend/src/cms` und überspringt diesen Schritt. |
| Live-RLS-Audit (`live`) | Mit `--live`: der [`rls-check`](/docs/rls-check)-Katalog gegen die Projektdatenbank und die Prüfung, ob jede Migration angewendet wurde. Die Datenbank wird wie bei den `db`-Befehlen aufgelöst — `--database-url`, `DATABASE_URL`, `--docker`, andernfalls die verwaltete Entwicklungsdatenbank. Eine Datenbank, die nicht konfiguriert ist oder nicht antwortet, ist ein Fehler, kein Überspringen: Das Audit wurde explizit angefordert. Eine `USING (true)`-Read-Policy, die aus einer `access: "public"`-Regel kompiliert wurde, ist eine Warnung, solange die API ein Token erfordert (`AUTH_REQUIRE`, standardmäßig aktiviert) — jeder angemeldete Benutzer liest jede Zeile — und ein Fehler bei `AUTH_REQUIRE=false`, wo die Zeilen anonym lesbar sind. |

`--json` gibt ein einzelnes Objekt aus: `{ ok, schemaDir, steps, findings, summary }`. Jeder Schritt ist `{ id, title, status, detail? }` (`status` ist `passed`, `failed`, `warnings` oder `skipped`), und jeder Befund enthält `step`, `check` (eine feste kebab-case-Art), `severity`, `message` und, sofern zutreffend, `fix`, `table`, `file`, `line` sowie den punktierten `path` in die Tabelle (`posts.rls[0]`) — sodass ein Agent reparieren kann, was beschädigt wurde. `summary` zählt `errors` und `warnings`. `--quiet` gibt nichts aus, wenn alles erfolgreich ist. Beendet bei einem Fehler mit einem Status ungleich null; Warnungen führen nicht zum Fehlschlagen.

Ein über Scaffolding erstelltes Projekt führt diesen Befehl für Claude Code nach jeder Bearbeitung unter `backend/schema/` aus: siehe [`rebase skills install`](#rebase-skills-install).

### Befehle für eine laufende Anwendung

`rebase api`, `rebase data`, `rebase users`, `rebase cron`, `rebase logs`, `rebase functions`, `rebase rls simulate`, `rebase auth login` und `rebase storage ls|cp|rm|url|stat` wirken über deren API auf eine laufende Anwendung: das lokale `rebase dev`, einen über `--url` angegebenen Server oder ein Rebase-Cloud-Projekt mit `--project`. Siehe [Eine laufende Anwendung](/docs/cli/project/).

### `rebase auth`

Befehle zur Authentifizierungsverwaltung:

```bash
rebase auth reset-password --email admin@example.com --password NewPassword123!
```

### `rebase api-keys`

Verwalten Sie die Service-API-Schlüssel des Projekts — die Anmeldedaten, die ein Agent, Skript oder ein anderer Dienst im Gegensatz zur Sitzung eines Endbenutzers verwendet:

```bash
rebase api-keys list
rebase api-keys get abc123-def456
rebase api-keys create --name "Blog CI" --scopes data:read:posts,data:write:posts --expires-in 90
rebase api-keys create --name "Ops" --full-access --roles admin --expires-at 2027-01-31
rebase api-keys revoke abc123-def456
```

`--scopes` gibt an, was der Schlüssel tun darf, kommagetrennt oder wiederholt angegeben; `--full-access` gewährt ihm jeden Scope, den der Service-Schlüssel besitzt, außer `keys:*`. `--roles` fügt RLS-Rollen neben `service` hinzu, `--expires-in` akzeptiert Tage und `--expires-at` ein ISO-Datum. `rebase api-keys scopes` listet alle Scopes auf, die dem Backend bekannt sind. Ein Schlüssel wird nur einmal angezeigt. Sowohl die Scopes des Schlüssels als auch die Row-Level Security der Identität, als die er agiert, finden Anwendung. Siehe [API-Schlüssel](/docs/backend/api-keys/).

### `rebase storage`

Gesamtspeicher-Wartung gespeicherter Dateien über das laufende Backend mit `REBASE_SERVICE_KEY` aus `.env`:

```bash
rebase storage orphans                         # files no row names
rebase storage orphans --source media --delete # and delete them, after asking
rebase storage move --from "(default)" --to media --prefix avatars
rebase storage move --from "(default)" --to media --prefix avatars --delete-source
```

`orphans` liest jede Zeile jeder Tabelle im gespeicherten Zustand (einschließlich als gelöscht markierter („soft-deleted“) Zeilen, vorbei an allen `beforeQuery`- und `afterRead`-Hooks) und jeden [Historien](/docs/backend/history/)-Eintrag, da ein Revert dessen Inhalt wiederherstellt. Es listet die Dateien einer Quelle auf (`--source`, standardmäßig die Standardquelle), die von keiner Zeichenkette darin referenziert werden: weder als Schlüssel, URL noch als `rebase-storage:`-Referenz in einem Text. Dateien, die neuer als `--older-than` Stunden sind (standardmäßig 24), werden ausgelassen, da das Admin-Panel eine Datei hochlädt, bevor die Zeile gespeichert wird, die sie referenziert. Der Scan läuft auf dem Backend im Hintergrund, sodass auch ein zu großes Projekt, dessen Prüfung innerhalb eines einzelnen Requests (hinter einem Ingress mit Timeout) scheitern würde, abgeschlossen werden kann. Die CLI startet den Scan und zeigt den Fortschritt an (gelistete Dateien, gelesene Zeilen, erledigte Tabellen sowie Tabellen, die nicht gelesen werden konnten), bis er abgeschlossen ist. Bei aktivierter [Job-Queue](/docs/backend/jobs/) ist der Scan ein `storage.orphans`-Job, der von den Job-Workern ausgeführt wird. Ohne Job-Queue läuft der Scan innerhalb des angefragten Serverprozesses, worauf die CLI hinweist: Ein Neustart dieses Prozesses stoppt den Scan. Ein Scan entspricht einem Job-Versuch, begrenzt durch `jobs.timeoutMs` (standardmäßig 15 Minuten). Erhöhen Sie diesen Wert oder setzen Sie ihn auf 0 für Quellen, die mehr Zeit benötigen. `--json` gibt denselben Bericht wie zuvor aus, ergänzt um die `scanId`.

`--delete` fragt vor dem Löschen nach (`--yes` überspringt die Abfrage und ist ohne Terminal erforderlich). Es löscht nur Dateien aus dem soeben ausgegebenen Scan und nur innerhalb von 15 Minuten nach dessen Abschluss. Es wird nichts gelöscht, solange eine Tabelle nicht gelesen werden kann: Eine Tabelle mit Read-Hooks auf einer Datenbank, deren Treiber nicht an ihnen vorbeilesen kann, gilt als ungelesen. Vor dem Löschen liest der Server jede Zeile und jeden Historien-Eintrag erneut im Abgleich mit den aufgelisteten Dateien. Anschließend prüft er jede Datei unmittelbar vor dem Löschen noch einmal. Eine Datei, die mittlerweile von einer Zeile referenziert wird, seit dem Scan erneut hochgeladen wurde oder nicht mehr existiert, wird behalten, und die CLI führt sie als behalten auf. Dateien, die nur von Tabellen referenziert werden, die Rebase nicht bedient, sehen ungenutzt aus: Prüfen Sie dies vor dem Löschen. Bei einem Backend von 0.25.1 oder früher scannt die CLI auf die alte Weise innerhalb eines einzelnen Requests.

`move` kopiert die Dateien unter `--prefix` seitenweise unter denselben Schlüsseln zu einer anderen Quelle. Eine Datei, die am Zielort bereits in identischer Größe existiert, wird übersprungen, sodass ein abgebrochener Verschiebevorgang durch erneutes Ausführen fortgesetzt werden kann; `--delete-source` löscht jede Datei aus der Quelle, sobald das Ziel sie enthält, wird jedoch verweigert, wenn beide Quellen denselben Bucket oder dasselbe Verzeichnis verwenden. Sobald der Verschiebevorgang abgeschlossen ist, durchsucht die CLI die Quelle erneut und listet jede Datei auf, die nicht verschoben wurde: mit `--delete-source` jede Datei, die sich noch in der Quelle befindet; ohne dieses Flag jede Datei, für die am Zielort keine Kopie gleicher Größe existiert. Der Befehl beendet mit 1, falls eine solche Datei vorhanden ist, und ein erneutes Ausführen greift diese wieder auf. `--json` gibt diese als `notMoved` aus. Das Lesen des Berichts eines Scans erfordert `database:read`. Das Starten eines Scans, Löschen und Verschieben erfordern `database:write`, worüber der Service-Schlüssel verfügt.

### `rebase skills install`

Installieren Sie die Rebase-Referenz-Skills für Ihre KI-Coding-Assistenten — für jeden oben genannten `--agent`:

```bash
rebase skills install
rebase skills install --agent claude,cursor
rebase skills install --agent all
rebase skills --hooks
```

Siehe [Agent-Skills](/docs/ai/skills) für die vollständige Liste und die Speicherorte der Dateien.

`--hooks` installiert das Claude-Code-Guardrail, das `rebase init` mit jedem Projekt ausliefert: `.claude/hooks/post-edit-collection.sh`, registriert als `PostToolUse`-Hook in `.claude/settings.json`, welcher nach jeder Bearbeitung unter `backend/schema/` oder `frontend/src/cms/` `rebase verify --quiet` ausführt und eventuelle Probleme an den Agent zurückgibt. Bestehende Einstellungen und Hooks bleiben erhalten. `rebase skills --hooks` installiert ausschließlich den Hook.

### `rebase telemetry`

Anonyme Weitergabe von Nutzungsdaten, deaktiviert, bis Sie zustimmen. Ein interaktives `rebase init` fragt am Ende nach, und die Standardauswahl ist Nein, sodass nichts geteilt wird, es sei denn, Sie antworten mit Ja. Die Antwort gilt pro Rechner (`~/.rebase/telemetry.json`): Nach einem Ja fragt `init` nie wieder, nach einem Nein fragt das nächste `init` erneut. Jeder Checkout erhält eine zufällige Projekt-ID, die in der Git-ignorierten Datei `.rebase/telemetry-project.json` gespeichert wird.

```bash
rebase telemetry status
rebase telemetry show
rebase telemetry enable
rebase telemetry disable
```

`status` gibt die aktuelle Einstellung aus, `show` zeigt genau das an, was gesendet werden würde — unabhängig davon, ob das Teilen aktiviert ist, sodass Sie die Payload vor der Entscheidung einsehen können —, und die anderen beiden ändern die Einstellung. Wenn Sie `init` noch nie ausgeführt haben, wurden zu keinem Zeitpunkt Daten erfasst.

## Nächste Schritte

- **[Schemagenerierung](/docs/cli/schema/#production-workflow)** — Der Migrations-Workflow, von der Tabellenbearbeitung bis zur Produktion
- **[Schema as Code](/docs/architecture/schema-as-code)** — Wie die Schemagenerierung funktioniert
- **[Schnellstart](/docs/getting-started/quickstart)** — Erste Schritte
