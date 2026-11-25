---
sourceHash: c4c752011dc403fc
title: MCP-Server
sidebar_label: MCP-Server
description: Verbinden Sie Claude Code, Cursor, die Gemini-CLI oder einen beliebigen MCP-Client mit einem Rebase-Projekt – die 53 bereitgestellten Tools, die Zugangsdaten für die Authentifizierung und das Loopback-Gate, das zwischen einem Agenten und der Produktionsumgebung steht.
---

`@rebasepro/mcp` ist ein [Model Context Protocol](https://modelcontextprotocol.io)-Server,
der einem KI-Assistenten echte Werkzeuge für ein Rebase-Projekt an die Hand gibt:
Zeilen lesen und schreiben, Benutzer verwalten, Migrationen ausführen, Funktionen
aufrufen, den Dev-Server steuern.

Er kommuniziert über MCP **ausschließlich per stdio**. Es gibt keinen Port und
keinen Listener – der Prozess genießt genau so viel Vertrauen wie der Prozess,
der ihn gestartet hat, und es gibt keinen entfernten Aufrufer zu authentifizieren.
Das ist der sichere Teil. Die interessanten Fragen drehen sich alle darum, was
er tut, *sobald* er läuft, und diese Seite beantwortet sie, bevor sie Ihnen den
Konfigurationsblock zeigt.

Ein bereitgestelltes Backend kann MCP auch selbst über HTTP für die Benutzer Ihrer
Anwendung bereitstellen. Das ist etwas anderes mit einem anderen
Berechtigungsmodell: siehe [Der Remote-MCP-Endpunkt](/docs/ai/remote-mcp/).

:::tip[Verwenden Sie Claude im Web, auf dem Desktop oder mobil?]
Fügen Sie stattdessen den [Rebase-Connector](/docs/ai/rebase-connector/) hinzu:
`https://app.rebase.pro/mcp`, einmalig, für jedes Projekt, das Sie auf Rebase Cloud
oder Ihren eigenen Servern betreiben. Diese Seite behandelt den lokalen Server,
den ein Programmierassistent innerhalb eines Projekts startet.
:::

## Einen Client verbinden

Der Server läuft aus Ihrem Projekt heraus: `@rebasepro/mcp` ist eine devDependency,
die jedes `rebase init`-Gerüst zusammen mit der CLI fixiert, und jeder Block
unten – die gesamte Integration – startet genau diese Kopie (`pnpm exec rebase-mcp`
oder `npx --no rebase-mcp` in einem npm-Projekt), niemals eine neuere von npm. Ein
älteres Projekt fügt sie einmalig mit `rebase skills install --mcp` oder
`pnpm add -D @rebasepro/mcp` hinzu.

`rebase init` schreibt den Block für jeden Agenten, den Sie auswählen, wenn es
[Ihre KI-Coding-Agenten einrichtet](/docs/ai/skills#set-up-by-rebase-init), wobei
alle anderen Server, die sich bereits in der Datei befinden, beibehalten werden.
`rebase init --agent cursor,codex` erledigt dasselbe ohne Nachfrage.

**Claude Code** – `.mcp.json` im Stammverzeichnis Ihres Projekts. `rebase init`
erstellt diese Datei für Sie:

```json title=".mcp.json"
{
  "mcpServers": {
    "rebase": {
      "command": "pnpm",
      "args": ["exec", "rebase-mcp"],
      "env": {
        "REBASE_PROJECT_DIR": "."
      }
    }
  }
}
```

**Cursor** – die gleiche Struktur, in `.cursor/mcp.json`. Cursor erweitert
`${workspaceFolder}` zum Projektstammverzeichnis:

```json title=".cursor/mcp.json"
{
  "mcpServers": {
    "rebase": {
      "command": "pnpm",
      "args": ["exec", "rebase-mcp"],
      "env": {
        "REBASE_PROJECT_DIR": "${workspaceFolder}"
      }
    }
  }
}
```

**Gemini CLI** – `.gemini/settings.json`, unter demselben Schlüssel:

```json title=".gemini/settings.json"
{
  "mcpServers": {
    "rebase": {
      "command": "pnpm",
      "args": ["exec", "rebase-mcp"],
      "env": {
        "REBASE_PROJECT_DIR": "."
      }
    }
  }
}
```

**Codex CLI** – TOML statt JSON, in der `.codex/config.toml` des Projekts.
Codex liest eine Projektkonfiguration erst, nachdem Sie dem Projekt vertraut haben:

```toml title=".codex/config.toml"
[mcp_servers.rebase]
command = "pnpm"
args = ["exec", "rebase-mcp"]

[mcp_servers.rebase.env]
REBASE_PROJECT_DIR = "."
```

**Kiro** – `.kiro/settings/mcp.json`:

```json title=".kiro/settings/mcp.json"
{
  "mcpServers": {
    "rebase": {
      "command": "pnpm",
      "args": ["exec", "rebase-mcp"],
      "env": {
        "REBASE_PROJECT_DIR": "."
      }
    }
  }
}
```

**GitHub Copilot in VS Code** – `.vscode/mcp.json`, unter `servers` und mit
einem expliziten Transport:

```json title=".vscode/mcp.json"
{
  "servers": {
    "rebase": {
      "type": "stdio",
      "command": "pnpm",
      "args": ["exec", "rebase-mcp"],
      "env": {
        "REBASE_PROJECT_DIR": "${workspaceFolder}"
      }
    }
  }
}
```

**Windsurf** liest MCP-Server nur aus seiner benutzerspezifischen Konfiguration,
daher gibt es keine Projektdatei zu schreiben. Fügen Sie den Server in den MCP-Einstellungen
als `"command": "pnpm"`, `"args": ["--dir", "/absolute/path/to/your/project", "exec", "rebase-mcp"]`
hinzu, mit diesem Pfad als `REBASE_PROJECT_DIR`.

Jeder MCP-Client, der einen stdio-Server starten kann, funktioniert; der Aufbau
ist derselbe.

### Auf welches Verzeichnis er wirkt

`REBASE_PROJECT_DIR` ist das Verzeichnis, das `rebase.json` enthält. Es gibt **eine**
Rangfolge, und sie ist in jedem Client gleich:

1. **Der Umgebungsblock** – `REBASE_PROJECT_DIR`, `REBASE_BASE_URL`,
   `REBASE_API_TOKEN`. Wenn einer von ihnen gesetzt ist, wird das `default`-Projekt
   bei jedem Start daraus neu erstellt.
2. **Das Arbeitsverzeichnis des Servers**, wenn es eine `rebase.json` enthält. Ein
   Projekt, in dem Sie sich gerade befinden, hat Vorrang vor allem, was in
   `~/.rebase/projects.json` gespeichert ist.
3. **Das persistierte `default`** in `~/.rebase/projects.json`, wenn keines der
   ersten beiden Angaben macht.

Die automatische Erkennung (Auto-Discovery) aus `.rebase/state.json` füllt in allen
drei Fällen Lücken und überschreibt niemals einen Wert, der von einer dieser Quellen
bereitgestellt wurde.

Die Blöcke auf Projektebene benennen das Projekt – `"."`, das Arbeitsverzeichnis des
Clients oder `${workspaceFolder}` des Editors –, da Regel 3 eine Datei liest, die von
allen Projekten auf dem Rechner gemeinsam genutzt wird. Eine benutzerspezifische
Konfiguration wie die von Windsurf gibt stattdessen einen absoluten Pfad an.

## Was der Server erreichen kann

Diesen Abschnitt sollten Sie lesen, bevor Sie einen Assistenten auf eine Datenbank
ansetzen, die Ihnen wichtig ist.

Der Server verfügt über **einen einzigen allgegenwärtigen Berechtigungsnachweis für den
gesamten Prozess**. Es gibt keine Identität pro Tool und keinen Nur-Lese-Modus; jedes
Tool verwendet dasselbe Token, und der einzige Schalter im Paket schaltet zusätzlichen
Zugriff *frei* statt ihn einzuschränken.

Welcher Berechtigungsnachweis das ist, in der Reihenfolge der Priorität:

1. `REBASE_API_TOKEN` aus der Umgebung. `REBASE_TOKEN` wird hier nicht gelesen:
   Es handelt sich um das Control-Plane-Token der CLI und wird niemals an die App
   gesendet (der Server gibt dies einmalig auf stderr aus, wenn es das einzige gesetzte
   Token ist). Die Cloud-Tools übergeben es weiterhin an die von ihnen gestartete
   CLI, die es an die Control Plane sendet.
2. `REBASE_SERVICE_KEY`, ausgelesen aus der `.env` des Projekts
3. Der Service-Key, der automatisch aus `.rebase/state.json` erkannt wird, während
   `rebase dev` läuft

2 und 3 sind der Schlüssel des Entwicklungs-Backends dieser Maschine, der nur
verwendet wird, wenn das Ziel auf Loopback liegt. Wenn `REBASE_BASE_URL` auf ein
anderes Ziel verweist – `rebase cloud init --claim` schreibt die Adresse des
Cloud-Projekts und kein `REBASE_API_TOKEN`, bis ein Deploy erfolgreich war –,
sendet der Server kein Token und gibt dies einmalig auf stderr aus.

Ein Token, das Sie für ein Projekt registrieren, **hat Vorrang vor der automatischen
Erkennung**. Die Erkennung füllt lediglich Lücken.

:::danger[Der Zero-Config-Pfad ist ein Admin-Berechtigungsnachweis]
Option 2 und 3 sind der **Service-Key** – ein uneingeschränktes Admin-Secret. Das Backend
löst ihn zu `uid: "service"`, `roles: ["admin"]`, `isAdmin: true` auf. Diese
Identität besitzt jeden [Scope](/docs/backend/roles-and-scopes/) und erfüllt die
`_default_admin_read` / `_default_admin_write`-Policies, die Rebase in jede
Tabelle injiziert, für die nicht `defaultPolicies: false` festgelegt ist.

Die ehrliche Antwort auf die Frage „Wird er immer noch durch RLS eingeschränkt?“
lautet daher: RLS *wird ausgeführt* – der Treiber wechselt zwar zur Rolle
`rebase_user` –, aber eine von Rebase selbst verfasste Policy gewährt dieser
Identität vollen Zugriff auf alles. Das Lesen jeder Zeile jeder Tabelle ist das
**beabsichtigte Verhalten der Standardkonfiguration**, kein Bypass.

Mit dem Zero-Config-Setup kann ein Agent, der diese Tools besitzt, jede Zeile
jeder Tabelle lesen und schreiben, alle Benutzer auflisten, beliebige Passwörter
zurücksetzen, jede Backend-Funktion aufrufen und DDL auf der vom Projekt
aufgelösten `DATABASE_URL` ausführen.
:::

### Stattdessen einen eingeschränkten Berechtigungsnachweis vergeben

Registrieren Sie einen bereichsbezogenen (scoped) [API-Schlüssel](/docs/backend/api-keys),
und das Zwei-Gate-Modell greift tatsächlich. Ein Service-Key läuft mit den Rollen
`["service"]`, die von den injizierten Admin-Policies **nicht** benannt werden –
RLS gewährt ihm also nichts, es sei denn, eine Ihrer eigenen Policies legt etwas
anderes fest, und seine Scopes schränken ihn weiter ein:

```bash
rebase api-keys create -n "claude-code" \
  --scopes data:read:articles \
  --expires-in 30
```

Übergeben Sie dann den resultierenden `rk_live_…`-Schlüssel an den Server, anstatt
ihn automatisch einen Service-Key ermitteln zu lassen:

```json title=".mcp.json"
{
  "mcpServers": {
    "rebase": {
      "command": "pnpm",
      "args": ["exec", "rebase-mcp"],
      "env": {
        "REBASE_PROJECT_DIR": "/absolute/path/to/your/project",
        "REBASE_API_TOKEN": "rk_live_..."
      }
    }
  }
}
```

Zwei Dinge, die dies **nicht** tut und die man wissen sollte, bevor man sich darauf
verlässt:

- **Es schränkt die CLI-Tools nicht ein.** `rebase_db_push`, `rebase_db_migrate`,
  `rebase_doctor` und die Branch-Tools starten die Rebase-CLI, die sich über
  `DATABASE_URL` verbindet und Ihr Token überhaupt nicht sieht. Das Loopback-Gate
  weiter unten ist das Einzige, was diese absichert.
- **Ein Schlüssel erreicht ein Admin-Tool nur mit dem entsprechenden Scope des Tools.**
  `list_users` und `list_roles` erfordern `users:read`; `create_user`, `update_user`,
  `delete_user` und `rebase_auth_reset_password` erfordern `users:write`; die Storage-
  und Cron-Tools benötigen den passenden `storage:*`- oder `cron:*`-Scope; `invoke_function`
  erfordert `functions:invoke`. Ohne diesen antwortet der Aufruf mit `403 SCOPE_MISSING`.
  Selbst mit `users:write` kann ein Schlüssel das Konto eines Administrators nicht
  ändern: Ein Administrator besitzt `keys:read` und `keys:write`, was kein Schlüssel
  besitzen kann, und niemand darf ein Konto verwalten, das über mehr Berechtigungen
  verfügt als man selbst.

Ein mit `--roles admin` erstellter Schlüssel ist eine andere Sache: Er trägt die Rollen
`["service", "admin"]`, womit er dieselben Standard-Admin-Policies erfüllt wie der
Service-Key. Wenn Sie ihm zusätzlich `--full-access` geben, entspricht seine Reichweite
der des Service-Keys, abzüglich der Schlüsselverwaltung. Der Vorteil ist, dass er
**widerrufbar, ablauffähig und pro Schlüssel ratenbegrenzt (rate-limited)** ist – nichts
davon trifft auf den Service-Key zu, dessen Rotation das Bearbeiten von `.env` und einen
Neustart des Servers erfordert.

Siehe [Agenten und MCP-Server](/docs/backend/api-keys#agents-and-mcp-servers) für
die vollständige Anleitung zum Scoping von Schlüsseln.

### Eine Tabelle vollständig unerreichbar machen

Der Grund, warum ein Admin-Berechtigungsnachweis alles lesen kann, ist die
Baseline-Policy, die Rebase in jede Tabelle einschleust und die dem vertrauenswürdigen
Serverkontext sowie der `admin`-Rolle Zugriff gewährt. Eine Tabelle kann diese
Baseline deaktivieren und die volle Verantwortung für ihr eigenes RLS übernehmen:

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const medicalRecords = defineTable("medical_records", {
    columns: {
        id:        col.uuid().primaryKey().defaultRandom(),
        patientId: col.text(),
        notes:     col.text(),
    },
    // Remove the injected admin/server baseline — nothing is readable
    // except what the rules below allow.
    defaultPolicies: false,
    rls: [
        { operations: ["select", "update"], ownerField: "patientId" },
    ],
});
```

Nun besteht die einzige Zugriffsmöglichkeit darin, mit `patientId` übereinzustimmen.
Die UID des Service-Keys ist der Literal-String `service`, sodass eine Owner-Regel
niemals darauf zutrifft – Lesevorgänge geben null Zeilen zurück und Schreibvorgänge
werden von Postgres abgelehnt. Dies ist die einzige Kontrollmöglichkeit, die den
Standard-Berechtigungsnachweis des MCP-Servers einschränkt, anstatt ihn einfach
vorauszusetzen.

Denken Sie daran, dass dies eine echte RLS-Änderung ist und keine bloße Dokumentation:
Sie wird erst wirksam, wenn `rebase schema generate` und eine Migration die
Policies angewendet haben. Siehe [Row-Level Security](/docs/collections/security-rules).

## Das Loopback-Gate

`rebase_project_add` akzeptiert jede beliebige `baseUrl`, und die CLI-Tools
verbinden sich mit der `DATABASE_URL`, die das Projekt deklariert. Dieselbe Liste
von Tools, die eine Test-Datenbank auf Ihrem Laptop bearbeitet, kann daher Zeilen
in der Produktionsdatenbank löschen – ohne dass etwas dazwischensteht außer dem
Urteilsvermögen des Assistenten darüber, welches Projekt gerade aktiv ist.

**Jedes Tool, das die Zielumgebung verändert, wird verweigert, es sei denn, dieses
Ziel befindet sich auf der Loopback-Schnittstelle.** Das Gate ist als Liste dessen
definiert, was *nicht* abgesichert ist, sodass ein später hinzugefügtes Tool standardmäßig
geschützt ist.

- **Nicht abgesichert – Lesevorgänge:** `rebase_schema_plan`, `rebase_doctor`,
  `rebase_db_branch_list`, `rebase_db_branch_info`, `rebase_db_branch_diff`, `query_table`,
  `get_row`, `list_users`, `list_roles`, `storage_list_objects`,
  `storage_get_download_url`, `cron_list_jobs`, `cron_get_job`, `cron_get_job_logs`,
  `rebase_dev_logs` sowie die Rebase Cloud-Leseoperationen `rebase_cloud_status`,
  `rebase_cloud_logs`, `rebase_cloud_env_list`, `rebase_cloud_deployments_list`.
- **Nicht abgesichert – Rebase Cloud-Schreibvorgänge:** `rebase_cloud_provision`,
  `rebase_cloud_deploy`, `rebase_cloud_env_set`, `rebase_cloud_rollback`.
  Die Bereitstellung (Provisioning) erstellt ein Projekt; die anderen ändern ein
  Produktionsprojekt. Keines davon läuft über `baseUrl` oder `DATABASE_URL`, was
  alles ist, was das Gate prüfen kann. Siehe [Rebase Cloud](#rebase-cloud) dazu,
  wie diese abgesichert sind.
- **Nicht abgesichert – nur lokal:** `rebase_schema_introspect`, `rebase_db_branch_switch`,
  `rebase_schema_generate`, `rebase_db_generate`, `rebase_generate_sdk`, die
  Dev-Server-Tools und die Projekt-Registry-Tools. Diese schreiben lokale Dateien
  oder lokalen Zustand und haben kein Remote-Ziel zu prüfen.
- **Gegen `DATABASE_URL` abgesichert:** die verbleibenden CLI-Tools – `rebase_db_push`,
  `rebase_db_migrate`, `rebase_db_branch_create`, `rebase_db_branch_delete`.
- **Gegen die Projekt-`baseUrl` abgesichert:** die verbleibenden SDK-Tools –
  `create_row`, `update_row`, `delete_row`, `create_user`,
  `update_user`, `delete_user`, `rebase_auth_reset_password`,
  `storage_delete_object`, `cron_trigger_job`, `cron_toggle_job`
  und `invoke_function`.

Die beiden Ziele sind nicht austauschbar. CLI-Tools sehen `baseUrl` nie, daher wird
ein Localhost-Backend neben einer produktiven `DATABASE_URL` gegen die Datenbank
geprüft, nicht gegen das Backend.

Eine Verweigerung sieht folgendermaßen aus:

```text
Error: Refusing to run "delete_row": project "default" points at
https://api.example.com/, which is not local. Set REBASE_MCP_ALLOW_REMOTE_WRITES=true
to allow destructive tools against remote environments.
```

**Wenn überhaupt kein Verbindungs-String aufgelöst werden kann, werden die geschützten
DB-Tools verweigert.** Ohne `DATABASE_URL` verwendet die CLI die verwaltete
Entwicklungsdatenbank, was der Standard für ein neues Projekt ist, und das Gate
verweigert seine vier Datenbank-Tools dort. Die Verweigerung begründet dies und
nennt Alternativen, die stattdessen funktionieren. Sie schlägt kein Deaktivieren des
Schutzes (Opt-out) vor:

```text
Error: Refusing to run "rebase_db_push": project "default" sets no DATABASE_URL, so the
CLI would use the managed development database (PGlite, started by `rebase dev`). You
most likely do not need this tool: the dev server applies the tables in backend/schema to
that database at boot, additively. After changing a table, restart it with
rebase_dev_stop and rebase_dev_start. …
```

Im Terminal laufen `rebase db push` und `rebase db migrate` auf dieser Datenbank;
nur die MCP-Tools werden verweigert.

Nur Loopback gilt als lokal: `localhost`, `*.localhost`, `127.0.0.0/8`, `::1`
(und `0.0.0.0`). Private IP-Bereiche wie `10.x` und `192.168.x` zählen **nicht**
dazu – diese sind genauso wahrscheinlich ein geteiltes Staging-Cluster wie ein
Laptop, und sie als lokal zu behandeln, würde genau das Missgeschick durchwinken,
das durch das Gate verhindert werden soll.

Setzen Sie `REBASE_MCP_ALLOW_REMOTE_WRITES=true`, um diesen Schutz zu deaktivieren.
Wenn Sie dies global in der Konfiguration Ihres MCP-Clients festlegen, wird das
Gate für jedes Projekt entfernt, das der Server erreichen kann – nicht nur für
dasjenige, an das Sie gerade gedacht haben.

## Markierung nicht vertrauenswürdiger Daten

Zeilen, Benutzerdatensätze, Storage-Listen, Cronjobs, Funktionsantworten und
CLI-Ausgaben werden in einem expliziten Umschlag (Envelope) zurückgegeben:

```text
<<<UNTRUSTED_DATA source="query_table" id="9b2f4c1e-…">>>
[ … rows … ]
<<<END_UNTRUSTED_DATA id="9b2f4c1e-…">>>
```

Alles, was in Ihrer Datenbank gespeichert ist, wurde von jemandem geschrieben,
und es trifft über denselben Kanal ein wie der Tool-Vertrag, dem der Assistent
folgt. Der Umschlag weist das Modell an, dies als passiven Inhalt und nicht als
Anweisungen zu behandeln.

Die `id` wird für jede Antwort nach dem Schreiben der Daten neu generiert, und nur
der Endmarker mit dieser ID schließt den Block ab. Text innerhalb der Daten, der
wie ein Marker aufgebaut ist, wird durch ein breitenloses Leerzeichen (Zero-Width Space)
unterbrochen, sodass eine Zeile, die `<<<END_UNTRUSTED_DATA>>>` ausgibt, den
Umschlag nicht vorzeitig beenden und nachfolgende Inhalte nach außen verlagern kann.

Der [Remote-Endpunkt](/docs/ai/remote-mcp/) kapselt seine Tool-Ergebnisse auf
die gleiche Weise ein und teilt dies dem Client mit; sein `structuredContent`
enthält das reine Ergebnis. `list_tables` und `describe_table` sind die Ausnahmen:
Da nur ein Modell sie liest, werden sie einmalig im Text gesendet.

Es handelt sich um eine Markierung, nicht um eine Sandbox. Ein Assistent mit diesen
Werkzeugen ist nur so sicher wie die Inhalte, die Sie ihn lesen lassen.

## Mehrere Projekte

Projektkonfigurationen werden in `~/.rebase/projects.json` gespeichert, und der
Server kann mehrere gleichzeitig verwalten – nützlich, wenn Sie über lokale und
entfernte Umgebungen hinweg arbeiten. Während `rebase dev` läuft, liest der Server
den aktiven Port und den Service-Key aus `.rebase/state.json` im Projektverzeichnis
aus, was den lokalen Fall konfigurationsfrei macht.

:::note[Die Registry hat das letzte Wort, nicht das erste]
Die Rangfolge entspricht der oben beschriebenen: Umgebungsblock, dann das
Arbeitsverzeichnis, wenn es eine `rebase.json` enthält, und schließlich das
persistierte `default`.

`REBASE_PROJECT_DIR`, `REBASE_BASE_URL` und `REBASE_API_TOKEN` erstellen das
`default`-Projekt **bei jedem Start** neu, nicht nur beim ersten. Die Neuerstellung
betrifft den gesamten Eintrag: Ein Token, das für das alte `projectDir` registriert
war, wird verworfen, anstatt in ein Verzeichnis übernommen zu werden, für das es nie
ausgestellt wurde. Ein auf diese Weise – oder aus dem Arbeitsverzeichnis –
abgeleitetes `default` wird niemals zurück in `~/.rebase/projects.json` geschrieben,
sodass der Dev-Service-Key eines Projekts nicht zum Schlüssel eines anderen werden kann.

`activeProject` ist persistent („sticky“). Wenn also eine frühere Sitzung
`rebase_project_switch` aufgerufen hat, zielen Tools auf dieses Projekt ab, und
der Server meldet dies auf stderr – es sei denn, dieses Projekt ist unter einem
*anderen* Verzeichnis registriert als dem, in dem dieser Server ausgeführt wird; in
diesem Fall fällt er auf `default` zurück und meldet dies ebenfalls. Wenn ein
Assistent die falsche Datenbank zu lesen scheint, rufen Sie zuerst
`rebase_project_current` auf.
:::

### Auf welches Projekt ein Aufruf wirkt

`activeProject` gilt rechnerweit, und oft wird ein Server einmalig für den gesamten
Rechner installiert. Daher löst jedes Tool, das auf ein Projekt einwirkt (alle außer
den `rebase_project_*`-Registry-Tools, `rebase_cloud_projects_list`, `rebase_cloud_provision`
und `rebase_dev_logs`), sein Projekt **pro Aufruf** auf und akzeptiert ein optionales
`project`: den Namen eines registrierten Projekts oder einen Rebase Cloud-Slug oder
eine -ID. Der Aufruf wird anhand der Cloud-Verknüpfung (`.rebase/cloud.json`) des
Verzeichnisses geprüft, in dem die Sitzung arbeitet: die erste [Root](https://modelcontextprotocol.io/specification/latest/client/roots)
des Clients, andernfalls das Arbeitsverzeichnis des Servers.

| Der Aufruf | Das Sitzungsverzeichnis | Ergebnis |
|---|---|---|
| benennt ein Projekt | ist mit demselben Projekt verknüpft | wird darauf ausgeführt |
| benennt ein Projekt | ist mit einem anderen Projekt verknüpft | **verweigert**, nichts wird ausgeführt |
| benennt kein Projekt | ist mit einem Projekt verknüpft, das aktive jedoch nicht | **verweigert**, nichts wird ausgeführt |
| benennt kein Projekt | ist verknüpft; das aktive Projekt ist ein lokales an anderer Stelle | wird auf dem verknüpften Projekt ausgeführt |
| benennt kein Projekt | ist nicht verknüpft | wird auf dem aktiven Projekt ausgeführt; ein *Schreibvorgang* in ein Cloud-Projekt, das von einer früheren Sitzung ausgewählt wurde, erfordert die Angabe des Projekts |

Eine Verweigerung benennt beide Projekte. `rebase_project_current` meldet das
Verzeichnis und die Verknüpfung der Sitzung unter `session`. `rebase_cloud_env_set`
und `rebase_cloud_rollback` übergeben das aufgelöste Projekt mit `--project` an die
CLI; `rebase_cloud_deploy` liefert das Verzeichnis aus, in dem es ausgeführt wird,
und wird daher verweigert, wenn die Verknüpfung dieses Verzeichnisses auf ein anderes
Projekt zeigt.

Token werden in dieser Registry **im Klartext** gespeichert. Es handelt sich um eine
Datei in Ihrem Benutzerverzeichnis, die Admin-Berechtigungsnachweise für jedes von
Ihnen registrierte Projekt enthält; behandeln Sie sie entsprechend.

## Rebase Cloud

Acht Tools bringen eine App aus diesem Verzeichnis zu einem Live-Backend auf
[Rebase Cloud](/docs/deployment/cloud/) und halten sie am Laufen. Jedes davon startet
`rebase cloud <command> --json` im aktiven Projektverzeichnis: exakt derselbe
Befehl, den auch ein Mensch ausführt, sodass es keine abweichende zweite
Implementierung gibt.

| Tool | Führt aus | Ändert das Projekt |
|---|---|---|
| `rebase_cloud_provision` | `rebase cloud init --claim` | Erstellt eines, ohne Account |
| `rebase_cloud_status` | `rebase cloud status` | Nein |
| `rebase_cloud_deploy` | `rebase cloud deploy` | Ja |
| `rebase_cloud_logs` | `rebase cloud logs [--runtime]` | Nein |
| `rebase_cloud_env_list` | `rebase cloud env list` | Nein |
| `rebase_cloud_env_set` | `rebase cloud env set KEY --stdin` | Ja, ab dem nächsten Deploy |
| `rebase_cloud_deployments_list` | `rebase cloud deployments list` | Nein |
| `rebase_cloud_rollback` | `rebase cloud rollback --yes` | Ja |
| `rebase_cloud_projects_list` | `rebase cloud projects list --all-orgs` | Nein |

Der typische Ablauf eines Agenten sieht so aus: `rebase_cloud_provision`, dann
dem Benutzer die Claim-URL übergeben; `rebase_cloud_status`, um das Projekt zu
inspizieren (solange es nicht beansprucht wurde, enthält `unclaimed` die Claim-URL
und wann es gelöscht wird); `rebase_cloud_deploy` nach einer Änderung; `rebase_cloud_logs`,
wenn sich etwas fehlerhaft verhält; und `rebase_cloud_rollback`, wenn die
Produktion beschädigt ist.

**Worauf sie wirken.** Das Projekt, zu dem der Aufruf aufgelöst wird, wie unter
[Which project a call acts on](#auf-welches-projekt-ein-aufruf-wirkt) beschrieben: das
`project`-Argument, geprüft gegen die Verknüpfung des Sitzungsverzeichnisses, oder
diese Verknüpfung, oder das aktive Projekt. Ein Aufruf, der ein Projekt nennt, mit
dem das Sitzungsverzeichnis nicht verknüpft ist, wird verweigert, bevor überhaupt
ein Prozess gestartet wird.

**Wessen Berechtigung.** Was auch immer die CLI in diesem Verzeichnis auflöst:
`REBASE_TOKEN`, wenn es gesetzt ist, dann das Token, das `rebase cloud init --claim`
für ein nicht beanspruchtes Projekt gespeichert hat, und schließlich die
`rebase cloud login`-Sitzung. Im Verzeichnis eines solchen nicht beanspruchten
Projekts wird ein `REBASE_TOKEN`, das über keinen Scope für das Projekt verfügt,
zugunsten des projekteigenen Tokens zurückgestellt. Die Control Plane prüft jeden
Aufruf genauso wie die der CLI: Mit einem über `rebase cloud tokens create --can logs`
erstellten Token kann ein Assistent Logs lesen, und die Control Plane verweigert
dessen Deploys, Variablenänderungen und Rollbacks. Fehlende oder abgewiesene
Berechtigungsnachweise werden als Fehler zurückgemeldet, der angibt, was der
Benutzer tun muss (`rebase cloud login` oder das Beanspruchen des Projekts).

**Warum das Loopback-Gate nicht greift.** Das Gate prüft die `baseUrl` der App und
die `DATABASE_URL` der CLI; diese Tools nutzen keines von beiden. Nach
`rebase_cloud_provision` zeigt `REBASE_BASE_URL` auf das neue Cloud-Projekt; eine
Absicherung darüber würde genau das Deployment verweigern, das für den Ablauf
erforderlich ist. Das Provisioning selbst erstellt lediglich: Es greift weder auf
eine bestehende App noch auf eine bestehende Datenbank zu, und die CLI verweigert
es in einem Verzeichnis, das bereits verknüpft ist, ohnehin. Ein Deploy, eine
Variable und ein Rollback ändern jeweils die Produktion. Was davor geschaltet ist,
sind der obige Berechtigungsnachweis, die Tool-Genehmigung Ihres MCP-Clients und
`confirm: true`: `rebase_cloud_deploy` in die Produktion, `rebase_cloud_env_set` in
der Produktion, `rebase_cloud_rollback` und `rebase_cloud_provision` geben an, was
sie tun würden, und führen nichts aus, bis ein Aufruf dieselben Argumente mit
`confirm: true` wiederholt – was der Assistent erst sendet, nachdem der Benutzer
zugestimmt hat. Ein Preview-Deploy und eine Preview-Variable benötigen dies nicht.
Um einen Assistenten daran zu hindern, ein Cloud-Projekt zu ändern, setzen Sie
`REBASE_TOKEN` in der Umgebung des Servers auf ein Token ohne die Berechtigungen
`deploy` und `env`.

**Jedes Ihrer Projekte lesen.** Die oben genannten Tools wirken auf das verknüpfte
Projekt. Um die Daten eines anderen Projekts zu lesen – jedes Projekt in jeder
Organisation, zu der der angemeldete Account gehört, ob hier verknüpft oder nicht –,
listet `rebase_cloud_projects_list` diese auf und `rebase_project_use_cloud` (mit
ID, Slug oder Name) richtet die Daten- und Admin-Tools darauf aus: `query_table`,
`get_row`, `list_users`, `list_roles`, `cron_list_jobs`, `storage_list_objects`.
Diese Aufrufe laufen über den Studio-Proxy der Konsole unter Verwendung des
CLI-eigenen Berechtigungsnachweises (`rebase cloud access-token`, pro Aufruf gelesen
und niemals gespeichert); die Control Plane prüft die Zugriffsberechtigung des
Benutzers und hängt den Service-Key des Projekts serverseitig an, sodass kein
Schlüssel auf die Maschine gelangt. Ein Projekt mit deaktiviertem Studio wird
verweigert, und der Schalter weist darauf hin. Es handelt sich um ein Remote-Ziel
wie jedes andere, daher bleiben Tools, die Daten ändern, dort verweigert, es sei
denn, `REBASE_MCP_ALLOW_REMOTE_WRITES` ist gesetzt; `rebase_project_switch` wechselt
zurück.

Jedes Tool liefert eine Momentaufnahme:

- `rebase_cloud_logs` streamt nicht kontinuierlich („follows“ nicht). Das Ergebnis
  enthält `nextSinceTime`; übergeben Sie dies als `since`, um nachfolgende Einträge
  zu lesen. Es gibt die letzten 200 Zeilen zurück, sofern `tail` nichts anderes
  angibt. `source: "build"` gibt stattdessen das neueste Build-Log zurück.
- `rebase_cloud_deploy` verfolgt das Deployment bis zum Ende und prüft, ob die
  neue Version antwortet. `wait: false` kehrt zurück, sobald das Deployment
  ausgelöst wurde. Es wirft ein Projekt niemals aus der verwalteten Runtime aus,
  stellt kein älteres Framework-Release bereit und überspringt keine Build-Prüfungen:
  Dies sind Entscheidungen des Benutzers, und eine Verweigerung, die eine solche
  erfordert, weist darauf hin.
- `rebase_cloud_rollback` übergibt `--yes`, sobald der Aufruf `confirm: true`
  enthält (siehe unten), da es kein Terminal für Rückfragen gibt.

`rebase_cloud_env_set` schreibt den Wert in die Standardeingabe der CLI, sodass
er niemals in einer Befehlszeile erscheint, wo `ps` ihn anzeigen könnte, und der
Wert wird aus allen Rückgaben des Tools herausgefiltert. Das Ergebnis gibt an,
was gespeichert wurde (der Schlüssel, ob er geheim ist, ob ein erneutes Deployment
aussteht), niemals den Wert selbst. `rebase_cloud_env_list` listet nur Schlüssel
auf. Eine CLI, die älter ist als `env set --stdin`, wird mit dem Hinweis verweigert,
sie zu aktualisieren; der Wert wird nicht auf anderem Weg übertragen.

Ergebnisse werden im [Umschlag für nicht vertrauenswürdige Daten](#markierung-nicht-vertrauenswürdiger-daten)
zurückgegeben, gefolgt von einer Zeile des Servers mit Hinweisen zum nächsten Schritt.
Eine Verweigerung ist ein Tool-Fehler, der den Code der CLI enthält, wie z. B.
`no_project`, `token_rejected`, `managed_project` oder `deploy_failed`. Wenn der
Server den Code erkennt, fügt er den nächsten Schritt hinzu, gefolgt von der
eigenen Meldung der CLI. Jedes Tool prüft seine Argumente gegen das von ihm
deklarierte Schema, bevor ein Prozess gestartet wird, und weist nicht deklarierte
Argumente ab.

## Tool-Referenz

53 Tools in zehn Gruppen: Schema und Datenbank, Schemaplanung, Dokumente,
Benutzer und Rollen, Storage, Cron, Funktionen, Dev-Server, Projekt-Registry
und Rebase Cloud.
Jedes einzelne Tool mitsamt seinen Voraussetzungen und der Information, ob das
Gate es bei einem nicht-lokalen Ziel verweigert, finden Sie in der
[MCP-Tool-Referenz](/docs/ai/mcp-tool-reference).

## Ressourcen

Neben Tools stellt der Server auch MCP-Ressourcen bereit, sodass ein Client
Projektkontext abrufen kann, ohne einen Tool-Aufruf zu verbrauchen:

| URI | Beschreibung |
|---|---|
| `rebase://tables/{name}` | TypeScript-Quellcode einer Tabellendefinition (`defineTable`) |
| `rebase://schema` | Das generierte Drizzle-Schema (`schema.generated.ts`) |

Tabellendateien sind die Module des Schema-Verzeichnisses (abgesehen von dessen
`index.ts`): der Schlüssel `tables` der Backend-App in `rebase.json`,
standardmäßig `backend/schema`, unterhalb des aktiven Projektverzeichnisses
oder dessen `app/`.

`rebase://schema` wird **nur dann** aufgeführt, wenn das generierte Schema
existiert. `findBackendDir` sucht unter dem aktiven Projektverzeichnis nach
`backend/` und dann nach `app/backend/` und liest `src/schema.generated.ts` aus
dem Verzeichnis, das es findet – somit funktionieren sowohl das Standard-Gerüst-Layout
als auch dieses Monorepo; ein anders strukturiertes Projekt oder ein Projekt,
in dem `rebase schema generate` noch nicht ausgeführt wurde, bekommt die Ressource
schlicht nicht angeboten.

## Skills

Der Server stellt über die MCP-Skills-Erweiterung auch die 24
[Rebase-Agent-Skills](/docs/ai/skills/) bereit. Ein Client mit Protokollrevision
2026-07-28 oder neuer lädt einen Skill bei Bedarf. In Claude Code lauten diese
`/rebase:rebase-tables` usw. Ohne `@rebasepro/agent-skills` startet der Server
ohne sie und weist auf stderr darauf hin.

## Der Remote-Endpunkt

Ein bereitgestelltes Backend kann MCP auch selbst unter `/mcp` für die Benutzer
Ihrer Anwendung bereitstellen, wobei sich jeder als er selbst unter seiner
eigenen Row-Level Security verbindet. Dies wird auf einer eigenen Seite beschrieben:
[Der Remote-MCP-Endpunkt](/docs/ai/remote-mcp/).

## Empfohlene Einrichtung

- Richten Sie den Server auf ein **lokales** Projekt aus und lassen Sie
  `REBASE_MCP_ALLOW_REMOTE_WRITES` ungesetzt. Das Gate ist der mit Abstand
  wertvollste Bestandteil des Pakets.
- Registrieren Sie für alle Remote-Ziele einen **bereichsbezogenen (scoped) `rk_`-API-Schlüssel**,
  anstatt zuzulassen, dass die automatische Erkennung einen Service-Key übergibt.
- Prüfen Sie `rebase_project_current`, wenn eine Ausgabe fehlerhaft aussieht. Das
  aktive Projekt bleibt persistent bestehen („sticky“) und befindet sich außerhalb
  Ihres Repositories.
- Behandeln Sie `~/.rebase/projects.json` wie eine Datei mit vertraulichen Secrets.
