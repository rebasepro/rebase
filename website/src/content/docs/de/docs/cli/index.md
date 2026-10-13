---
sourceHash: 1e92f7f5db9fd26f
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
| `--database-url <url>` | Eine bestehende Datenbank anstelle der verwalteten verwenden. <span class="since-badge" data-since="0.25">Seit 0.25</span> Es muss eine `postgres://`- oder `postgresql://`-URL sein: Alles andere wird verweigert, bevor eine Datei geschrieben wird, und die interaktive Abfrage fragt erneut |
| `--introspect` | Collections aus dieser Datenbank generieren. Impliziert `--template blank` und erfordert `--install` |
| `--project <slug>` | Das Scaffold mit einem Rebase Cloud-Projekt verknüpfen |
| `--setup-key <key>` | Der Einmalschlüssel zur Authentifizierung dieser Verknüpfung |
| `-a, --agent <name>` | Richtet KI-Coding-Agenten ein: die [Skills](/docs/ai/skills) und den [MCP-Server](/docs/ai/mcp). Wiederholbar oder kommagetrennt — `claude`, `cursor`, `windsurf`, `gemini`, `codex`, `kiro`, `copilot` oder `all`. Ohne diesen Parameter fragt `init` nach und wählt die auf dem Rechner installierten Agenten vorab aus; unter `--yes` keine |

### `rebase dev`

Startet den Entwicklungsserver:

```bash
rebase dev
```

Startet sowohl Frontend als auch Backend mit Hot Reloading und generiert das Drizzle-Schema sowie die SDK-Typen (`generated/sdk/`) beim Start und bei jedem Speichern einer Collection neu. Unter 0.23 wird nur das Schema neu generiert, und `rebase generate-sdk` müssen Sie selbst ausführen.

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

<span class="since-badge" data-since="0.25">Seit 0.25</span> Jede statische App, die das
Bundle enthält, erhält neben jedem inhaltsgehashten Asset ab 1 KB eine Brotli-Kopie (`.br`) und eine gzip-Kopie
(`.gz`) — die Dateien, die ein Browser ein Jahr lang cacht.
Die Runtime sendet diejenige, die der Browser akzeptiert, sodass diese Dateien pro Anfrage
keine Komprimierungsarbeit kosten, auch nicht beim ersten Besuch nach einem Deploy, und
Browser, die Brotli akzeptieren, es bekommen (etwa 11 % kleiner als gzip beim
JavaScript des Admins). Die eigene Build-Ausgabe Ihres Frontends bleibt, wie sie war; nur die Kopie
im Bundle ändert sich. Bei der Beispiel-App kommt dadurch unter eine Sekunde zum Build
und etwa 2,4 MB zum Bundle hinzu.

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

<span class="since-badge" data-since="0.25">Seit 0.25</span> Ein Projekt auf einem Prerelease,
etwa einem Canary, bleibt auf seinem Kanal, es sei denn, `latest` ist neuer. Ein Dist-Tag, das
eine Versionsfixierung rückwärts verschieben würde, wird verweigert (`downgrade_refused` unter
`--json`), es sei denn, Sie übergeben `--allow-downgrade`; ein exaktes `--to` wird angewendet und
als Downgrade gekennzeichnet. Unter 0.24 nimmt `rebase upgrade` `latest` unabhängig davon.

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

`rebase start` startet keine Datenbank, und das `.env` des Scaffolds hat kein `DATABASE_URL`,
daher ist ein lokaler Lauf auf der Datenbank, die `rebase dev` verwendet,
`DATABASE_URL="$(rebase db url)" rebase start`. <span class="since-badge" data-since="0.25">Seit 0.25</span>
Ohne `DATABASE_URL` gibt es diese Zeile aus, bevor es bootet; unter 0.24 hält die Runtime mit
„DATABASE_URL: is required“ an.

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

<span class="since-badge" data-since="0.25">Seit 0.25</span> Der ausgeworfene Server hält lokale
Uploads im `uploads/` des Projekts, aus dem Quellcode gestartet oder kompiliert, wie es `rebase dev`
tut. Er läuft in `backend/`, sodass ein relatives `STORAGE_PATH` dort von `backend/` aus gelesen
wird. Unter 0.24 verwendet der kompilierte Server `backend/dist/uploads`, das der nächste Build löscht.

### `rebase schema generate`

Generiert das Drizzle-ORM-Schema aus Ihren TypeScript-Collections:

```bash
rebase schema generate
```

Dies liest Ihre Collections aus `config/collections/` und generiert `backend/src/schema.generated.ts` mit Drizzle-Tabellendefinitionen, Enums und Relationen.

### `rebase schema stale`

```bash
rebase schema stale          # name what differs from the collections, exit 1 if anything does
rebase schema stale --fix    # regenerate backend/src/schema.generated.ts instead
```

`rebase dev` hält die Datei von selbst aktuell, dies ist also die Prüfung für einen Build
oder einen CI-Schritt. Siehe [Schema-Generierung](/docs/cli/schema/#rebase-schema-stale).

### `rebase db`

```bash
rebase db push                 # apply the collections to the database (development)
rebase db generate             # write a SQL migration file
rebase db migrate              # apply the pending migrations
rebase db url                  # print the connection string this project uses
rebase db pull --from <url>    # copy another database into the local one
rebase db backup               # pg_dump; db backups list and db restore beside it
rebase db branch create <name> # a copy to work on; switch, list and prune it too
rebase db stop                 # stop the managed development database
rebase db reset                # delete it and start over
```

Jeder davon steht unter [Datenbank-Befehle](/docs/cli/database/), mit der Reihenfolge, in der ein
Befehl seine Datenbank wählt; `push`, `generate` und `migrate` werden ausführlich unter
[Schema-Generierung](/docs/cli/schema/) behandelt.

### `rebase console`

<span class="since-badge" data-since="0.25">Seit 0.25</span>

Eine Node-REPL mit geöffneten Projektdaten, oder ein einzelnes Snippet, das mit `-e` ausgeführt wird:

```bash
rebase console
rebase console -e "rebase.dataAsAdmin.posts.find({ limit: 5 })"
```

`rebase` (`dataAsAdmin`, `sql`, `withAuth(user)`) und `collections` sind im Geltungsbereich,
und `await` auf oberster Ebene funktioniert. Die Datenbank wird so aufgelöst, wie
`rebase db push` sie auflöst, und das Öffnen verändert nichts an ihr. Mit `-e` wird das
abgewartete Ergebnis als JSON auf stdout ausgegeben, und ein Fehler beendet mit `1`. Flags:
`--eval`/`-e`, `--collections`/`-c`, `--database-url`, `--docker`. Siehe
[Skripte und die Konsole](/docs/backend/scripts/).

### `rebase apps init` / `rebase apps config`

```bash
rebase apps list             # the apps this project declares
rebase apps init             # write a rebase.json inferred from this project
rebase apps config <app>     # the client configuration for one app
```

`apps init` nimmt keinen Namen: Es leitet jede App aus dem Projekt ab, schreibt die gesamte
`rebase.json` und weigert sich, eine vorhandene zu ersetzen, es sei denn, Sie übergeben
`--force`.

<span class="since-badge" data-since="0.25">Seit 0.25</span> Ein Namensargument wird verweigert.
`--force` behält, was die Ableitung nicht wissen kann, aus der Datei, die es ersetzt: den Namen
jeder App, ihren `path` und ihre `cms`-Route. Alles andere wird neu abgeleitet, und eine
deklarierte App, die es nicht mehr findet, wird als entfernt benannt, sodass es bei einem Scaffold
die `rebase.json` zurückschreibt, die das Scaffold mitgeliefert hat. Der Build-Befehl der
statischen App verwendet den Paketmanager des Projekts. Unter 0.24 wird der Name ignoriert, und
`--force` schreibt die reine Ableitung: Die statische App wird zu `web`, gebaut mit
`npm run build --workspace frontend`.

<span class="since-badge" data-since="0.25">Seit 0.25</span> Für einen Checkout, der nicht mit
einem Cloud-Projekt verknüpft ist, gibt `apps config` die URL des Backends so an, wie
`rebase dev` sie bereitstellt. Unter 0.24 gibt es `http://localhost:3001` aus.

### `rebase status`

Alles, was dieses Projekt deklariert, und ob die Umgebung es tatsächlich bindet:

```bash
rebase status               # every resource, and the variables it reads
rebase status --json        # machine-readable
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
rebase resources            # list them
rebase resources --write    # regenerate rebase.resources.json
rebase resources --check    # fail if the committed graph is stale
rebase resources --json     # machine-readable
```

`rebase resources --check` ist das Flag, das ein CI-Job verwendet, um bei einer
`rebase.resources.json` fehlzuschlagen, die nicht mehr zum Konfigurationscode passt.
<span class="since-badge" data-since="0.25">Seit 0.25</span> `--json` lässt sich damit kombinieren:
Bei Abweichung beendet sich `rebase resources --check --json` mit 1 und einer Fehlerstruktur
(`resource_graph_missing` oder `resource_graph_stale`), und bei Erfolg trägt der Graph
`check.status`. `--write --json` schreibt die Datei und meldet `written.changed`. Unter 0.24 gab
`--json` den Graphen aus und ignorierte beide Flags.

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
[`rebase cloud resources`](/docs/cli/cloud#resources).

`rebase cloud` — alle Befehle für Rebase Cloud: Anmeldung, Projektverknüpfung, Deploys, Konfiguration, Datenbanken, Ressourcen, Compute und mehr — hat [eine eigene Seite](/docs/cli/cloud).

### `rebase generate-sdk`

Generiert ein typisiertes SDK aus Ihren Collection-Definitionen:

```bash
rebase generate-sdk
```

Erstellt TypeScript-Typen und einen typsicheren Client für alle Ihre Collections.

`--register` typisiert auch serverseitige Daten: Es schreibt die Typen und die
`Register`-Deklaration nach `config/generated/` und merkt sich die Wahl in
`rebase.json` (`registerDatabase`), sodass spätere Läufe, `rebase dev` und frische Klone
sie aktuell halten.
Siehe [Typisierte serverseitige Daten](/docs/backend/typed-server-data).

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

Verwaltet die Service-API-Keys des Projekts — die Zugangsdaten, die ein Agent, Skript oder ein
anderer Dienst verwendet, im Gegensatz zur Sitzung eines Endbenutzers:

```bash
rebase api-keys list
rebase api-keys get abc123-def456
rebase api-keys create --name "Blog CI" --scopes data:read:posts,data:write:posts --expires-in 90
rebase api-keys create --name "Ops" --full-access --roles admin --expires-at 2027-01-31
rebase api-keys revoke abc123-def456
```

`--scopes` nennt, was der Schlüssel darf, kommagetrennt oder wiederholt; `--full-access`
gibt ihm jeden Scope, den der Service-Key hält, außer `keys:*`. `--roles` fügt RLS-Rollen neben
`service` hinzu, `--expires-in` nimmt Tage und `--expires-at` ein ISO-Datum.
`rebase api-keys scopes` listet jeden Scope, den das Backend kennt. Ein Schlüssel wird einmal angezeigt.
Sowohl die Scopes des Schlüssels als auch die Row-Level Security
der Identität, als die er agiert, greifen. Siehe [API-Schlüssel](/docs/backend/api-keys/).

### `rebase storage`

<span class="since-badge" data-since="0.25">Seit 0.25</span> Wartung des gesamten Speichers
gespeicherter Dateien, über das laufende Backend mit
`REBASE_SERVICE_KEY` aus `.env`:

```bash
rebase storage orphans                         # files no row names
rebase storage orphans --source media --delete # and delete them, after asking
rebase storage move --from "(default)" --to media --prefix avatars
rebase storage move --from "(default)" --to media --prefix avatars --delete-source
```

`orphans` liest jede Zeile jeder Collection, soft-gelöschte Zeilen eingeschlossen, und
listet die Dateien einer Quelle (`--source`, bei Weglassen die Standardquelle) auf,
die kein String in irgendeiner Zeile nennt: ein Schlüssel, eine URL, eine `rebase-storage:`-Referenz in
einem Text. Dateien, die neuer sind als `--older-than` Stunden (standardmäßig 24), bleiben außen vor,
weil das Admin-Panel eine Datei hochlädt, bevor die Zeile gespeichert wird, die sie nennt.
`--delete` fragt vor dem Löschen nach (`--yes` überspringt die Frage und ist ohne Terminal
erforderlich), der Server findet die Dateien zuvor erneut, und nichts wird
gelöscht, solange eine Collection nicht gelesen werden kann. Dateien, die nur Ihre eigenen Tabellen
außerhalb von Collections nennen, wirken ungenutzt: Prüfen Sie vor dem Löschen.

`move` kopiert die Dateien unter `--prefix` seitenweise unter denselben Schlüsseln in eine andere Quelle.
Eine Datei, die das Ziel bereits mit derselben Größe hält, wird übersprungen,
sodass ein abgebrochenes Verschieben durch erneutes Ausführen fortgesetzt wird; `--delete-source` löscht jede
Datei aus der Quelle, sobald das Ziel sie hält. Beide brauchen `database:read`, und
Löschen oder Verschieben `database:write`, was der Service-Key hält.

### `rebase skills install`

Installiert die Rebase-Referenz-Skills für Ihre KI-Coding-Assistenten — jedes `--agent` von oben:

```bash
rebase skills install
rebase skills install --agent claude,cursor
rebase skills install --agent all
```

Siehe [Agent Skills](/docs/ai/skills) für die vollständige Liste und die Speicherorte der geschriebenen Dateien.

### `rebase telemetry`

Anonyme Nutzungsdatenübermittlung, aus, bis Sie Ja sagen. Ein interaktives `rebase init` fragt am
Ende nach, und die Abfrage steht standardmäßig auf Nein, sodass nichts geteilt wird, wenn Sie nicht
mit Ja antworten. Die Antwort gilt pro Rechner (`~/.rebase/telemetry.json`): Nach einem Ja fragt
`init` nie wieder, und nach einem Nein fragt das nächste `init` erneut. Jeder Checkout erhält eine
zufällige Projekt-ID, gespeichert in seiner per Gitignore ausgeschlossenen
`.rebase/telemetry-project.json`. <span class="since-badge" data-since="0.25">Seit 0.25</span>
Unter 0.24 steht die Abfrage standardmäßig auf Ja, und die Projekt-ID ändert sich bei jedem
Neustart von `rebase dev`.

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
