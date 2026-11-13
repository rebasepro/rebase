---
sourceHash: 43fd981d241b2237
title: MCP-Server
sidebar_label: MCP-Server
description: Verbinden Sie Claude Code, Cursor, Gemini CLI oder einen beliebigen MCP-Client mit einem Rebase-Projekt – die 53 bereitgestellten Tools, die Anmeldedaten zur Authentifizierung und das Loopback-Gate, das zwischen einem Agenten und der Produktion steht.
---

`@rebasepro/mcp` ist ein [Model Context Protocol](https://modelcontextprotocol.io)-Server,
der einem KI-Assistenten echte Werkzeuge für ein Rebase-Projekt an die Hand gibt: Zeilen
lesen und schreiben, Benutzer verwalten, Migrationen ausführen, Funktionen aufrufen
und den Dev-Server steuern.

Er kommuniziert **ausschließlich über stdio** per MCP. Es gibt keinen Port und keinen
Listener – der Prozess genießt exakt so viel Vertrauen wie die Instanz, die ihn
gestartet hat, und es gibt keinen Remote-Aufrufer, der authentifiziert werden müsste.
Das ist der sichere Teil. Die interessanten Fragen drehen sich alle darum, was er tut,
*sobald* er läuft, und diese Seite beantwortet sie, bevor sie den Konfigurationsblock zeigt.

Ein bereitgestelltes Backend kann MCP auch selbst über HTTP für die Benutzer Ihrer
Anwendung bereitstellen. Das ist ein anderes Szenario mit einem anderen Berechtigungsmodell:
siehe [Der Remote-MCP-Endpunkt](/docs/ai/remote-mcp/).

:::tip[Nutzen Sie Claude im Web, auf dem Desktop oder Mobilgerät?]
Fügen Sie stattdessen den [Rebase-Connector](/docs/ai/rebase-connector/) hinzu:
`https://app.rebase.pro/mcp`, einmalig für jedes Projekt, das Sie auf Rebase Cloud
oder Ihren eigenen Servern betreiben. Diese Seite beschreibt den lokalen Server, den
ein Coding-Assistent innerhalb eines Projekts startet.
:::

## Einen Client verbinden

Der Server wird aus Ihrem Projekt heraus ausgeführt: `@rebasepro/mcp` ist eine
devDependency, die jedes `rebase init`-Gerüst fest mit der CLI koppelt. Jeder unten
aufgeführte Block – die gesamte Integration – startet genau diese Kopie
(`pnpm exec rebase-mcp` oder `npx --no rebase-mcp` in einem npm-Projekt), niemals
eine neuere Version aus npm. Ein älteres Projekt fügt ihn einmalig mit
`rebase skills install --mcp` oder `pnpm add -D @rebasepro/mcp` hinzu.

`rebase init` schreibt den Block für jeden Agenten, den Sie auswählen, wenn es
[Ihre KI-Coding-Agenten einrichtet](/docs/ai/skills#set-up-by-rebase-init), wobei
alle bereits in der Datei vorhandenen Server erhalten bleiben.
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

**Cursor** – die gleiche Struktur in `.cursor/mcp.json`. Cursor löst
`${workspaceFolder}` zum Projektstammverzeichnis auf:

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

**Codex CLI** – TOML statt JSON in der `.codex/config.toml` des Projekts.
Codex liest eine Projektkonfiguration erst, nachdem Sie das Projekt als vertrauenswürdig eingestuft haben:

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
explizitem Transport:

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

**Windsurf** liest MCP-Server ausschließlich aus seiner Konfiguration auf Benutzerebene,
sodass keine Projektdatei geschrieben werden muss. Fügen Sie den Server in den
MCP-Einstellungen als `"command": "pnpm"`,
`"args": ["--dir", "/absoluter/pfad/zu/ihrem/projekt", "exec", "rebase-mcp"]`
hinzu, mit diesem Pfad als `REBASE_PROJECT_DIR`.

Jeder MCP-Client, der einen stdio-Server starten kann, funktioniert; das Schema ist immer dasselbe.

### Auf welches Verzeichnis er zugreift

`REBASE_PROJECT_DIR` ist das Verzeichnis, das `rebase.json` enthält. Es gibt **eine**
Rangfolge, und sie ist in jedem Client identisch:

1. **Der Umgebungsblock** – `REBASE_PROJECT_DIR`, `REBASE_BASE_URL`,
   `REBASE_API_TOKEN`. Wenn einer dieser Werte gesetzt ist, wird das `default`-Projekt
   bei jedem Start daraus neu erstellt.
2. **Das Arbeitsverzeichnis des Servers**, wenn es eine `rebase.json` enthält. Ein Projekt,
   in dem Sie sich aktuell befinden, hat Vorrang vor allem, was in `~/.rebase/projects.json`
   gespeichert ist.
3. **Der gespeicherte `default`-Wert** in `~/.rebase/projects.json`, wenn keiner der
   ersten beiden Punkte zutrifft.

Die automatische Erkennung aus `.rebase/state.json` füllt Lücken in allen drei Fällen
und überschreibt niemals einen Wert, der durch einen davon bereitgestellt wurde.

Die Blöcke auf Projektebene benennen das Projekt – `"."`, das Arbeitsverzeichnis des Clients
oder `${workspaceFolder}` des Editors –, da Regel 3 eine Datei liest, die von jedem
Projekt auf dem Rechner geteilt wird. Eine Konfiguration auf Benutzerebene, wie die von
Windsurf, gibt stattdessen einen absoluten Pfad an.

## Was der Server erreichen kann

Diesen Abschnitt sollten Sie lesen, bevor Sie einen Assistenten auf eine Datenbank ansetzen,
die Ihnen wichtig ist.

Der Server führt **ein einzelnes globales Credential für den gesamten Prozess**. Es gibt
keine Identität pro Tool und keinen Nur-Lese-Modus; jedes Werkzeug verwendet dasselbe Token,
und der einzige Schalter im Paket schaltet *zusätzliche* Zugriffsrechte frei, anstatt
sie einzuschränken.

Welches Credential das ist, in der Reihenfolge der Priorität:

1. `REBASE_API_TOKEN` aus der Umgebung. `REBASE_TOKEN` wird hier nicht gelesen:
   Es ist das Control-Plane-Token der CLI und wird niemals an die App gesendet (der
   Server weist einmalig auf stderr darauf hin, wenn es das einzige gesetzte Token ist).
   Die Cloud-Tools übergeben es weiterhin an die von ihnen gestartete CLI, die es an die
   Control Plane sendet.
2. `REBASE_SERVICE_KEY`, ausgelesen aus der `.env` des Projekts.
3. Der Service-Key, der automatisch aus `.rebase/state.json` ermittelt wird, während
   `rebase dev` läuft.

2 und 3 stellen den Schlüssel des Entwicklungs-Backends dieses Rechners dar, der nur
verwendet wird, wenn sich das Ziel auf dem Loopback-Interface befindet. Wenn `REBASE_BASE_URL`
woanders hinzeigt – `rebase cloud init --claim` schreibt die Adresse des Cloud-Projekts
und kein `REBASE_API_TOKEN`, bis ein Deploy erfolgreich war –, sendet der Server kein Token
und weist einmalig auf stderr darauf hin.

Ein Token, das Sie für ein Projekt registrieren, **gewinnt gegenüber der automatischen Erkennung**.
Die Erkennung füllt lediglich Lücken.

:::danger[Der Zero-Config-Pfad nutzt ein Admin-Credential]
Die Optionen 2 und 3 verwenden den **Service-Key** – ein uneingeschränktes Admin-Geheimnis.
Das Backend löst ihn auf zu `uid: "service"`, `roles: ["admin"]`, `isAdmin: true`. Diese
Identität besitzt jeden [Scope](/docs/backend/roles-and-scopes/) und erfüllt die Richtlinien
`_default_admin_read` / `_default_admin_write`, die Rebase in jede Tabelle einfügt, die
nicht `defaultPolicies: false` gesetzt hat.

Die ehrliche Antwort auf die Frage „Wird er immer noch durch RLS eingeschränkt?“ lautet also:
RLS *wird ausgeführt* – der Treiber führt ein Downgrade auf die Rolle `rebase_user` durch –,
und dann gewährt eine von Rebase selbst erstellte Richtlinie dieser Identität vollen Zugriff.
Das Lesen jeder Zeile jeder Tabelle ist das **beabsichtigte Verhalten der Standardkonfiguration**,
keine Umgehung.

Mit dem Zero-Config-Setup kann ein Agent, der diese Tools besitzt, jede Zeile jeder Tabelle
lesen und schreiben, alle Benutzer auflisten, beliebige Passwörter zurücksetzen, jede Backend-Funktion
aufrufen und DDL-Operationen für jede `DATABASE_URL` ausführen, die das Projekt auflöst.
:::

### Stattdessen eingeschränkte Anmeldedaten vergeben

Registrieren Sie einen bereichsbezogenen [API-Schlüssel](/docs/backend/api-keys), und das
Zwei-Schranken-Modell greift tatsächlich. Ein Service-Key läuft mit den Rollen `["service"]`,
die von den eingefügten Admin-Richtlinien **nicht** genannt werden – RLS gewährt ihm also
nichts, es sei denn, eine Ihrer eigenen Richtlinien besagt etwas anderes, und seine Scopes
schränken ihn weiter ein:

```bash
rebase api-keys create -n "claude-code" \
  --scopes data:read:articles \
  --expires-in 30
```

Übergeben Sie den resultierenden `rk_live_…`-Schlüssel an den Server, anstatt ihn einen
Service-Key automatisch ermitteln zu lassen:

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

Zwei Dinge, die dies **nicht** tut – beides sollten Sie wissen, bevor Sie sich darauf verlassen:

- **Es schränkt die CLI-Tools nicht ein.** `rebase_db_push`, `rebase_db_migrate`,
  `rebase_doctor` und die Branch-Tools starten die Rebase CLI, die sich mit `DATABASE_URL`
  verbindet und Ihr Token überhaupt nicht zu Gesicht bekommt. Das unten beschriebene Loopback-Gate
  ist das Einzige, was diese Tools schützt.
- **Ein Schlüssel erreicht ein Admin-Tool nur mit dem entsprechenden Scope des Tools.**
  `list_users` und `list_roles` benötigen `users:read`; `create_user`, `update_user`,
  `delete_user` und `rebase_auth_reset_password` benötigen `users:write`; die Storage- und
  Cron-Tools benötigen den passenden `storage:*`- oder `cron:*`-Scope; `invoke_function`
  benötigt `functions:invoke`. Ohne diesen antwortet der Aufruf mit `403 SCOPE_MISSING`.
  Selbst mit `users:write` kann ein Schlüssel das Konto eines Administrators nicht ändern:
  Ein Administrator besitzt `keys:read` und `keys:write`, was kein Schlüssel besitzen kann,
  und niemand darf ein Konto verwalten, das über mehr Berechtigungen verfügt als man selbst.

Ein Schlüssel, der mit `--roles admin` erstellt wurde, ist eine andere Sache: Er trägt
die Rollen `["service", "admin"]`, was die gleichen Standard-Admin-Richtlinien freischaltet
wie der Service-Key. Wenn Sie ihm zusätzlich `--full-access` geben, entspricht seine Reichweite
der des Service-Keys, abzüglich der Schlüsselverwaltung. Der Vorteil: Er ist **widerrufbar,
kann ablaufen und wird pro Schlüssel ratelimitiert**, was auf den Service-Key alles nicht
zutrifft – um diesen zu rotieren, müssen Sie `.env` bearbeiten und den Server neu starten.

Siehe [Agenten und MCP-Server](/docs/backend/api-keys#agents-and-mcp-servers) für die
vollständige Anleitung zum Scoping von Schlüsseln.

### Eine Tabelle komplett unerreichbar machen

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Der Grund, warum ein Admin-Credential alles lesen kann, ist die Basisrichtlinie, die Rebase
in jede Tabelle einfügt und die dem vertrauenswürdigen Serverkontext und der Rolle `admin`
Zugriff gewährt. Eine Tabelle kann sich von dieser Basisrichtlinie abmelden und die volle
Verantwortung für ihr eigenes RLS übernehmen:

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const medicalRecords = defineTable("medical_records", {
    columns: {
        id:        col.uuid().primaryKey().defaultRandom(),
        patientId: col.text(),
        notes:     col.text(),
    },
    // Entfernt die eingefügte Admin/Server-Basisrichtlinie – nichts ist lesbar,
    // außer dem, was die unten stehenden Regeln erlauben.
    defaultPolicies: false,
    rls: [
        { operations: ["select", "update"], ownerField: "patientId" },
    ],
});
```

Jetzt besteht die einzige Möglichkeit zum Zugriff darin, dass `patientId` übereinstimmt.
Die UID des Service-Keys ist der Literal-String `service`, daher trifft eine Owner-Regel
niemals auf ihn zu – Leseoperationen liefern null Zeilen zurück und Schreiboperationen
werden von Postgres abgewiesen. Dies ist die einzige Steuerungsmöglichkeit, die das
Standard-Credential des MCP-Servers einschränkt, anstatt es als allmächtig vorauszusetzen.

Denken Sie daran, dass dies eine echte RLS-Änderung ist, keine rein dokumentarische:
Sie wird erst wirksam, wenn `rebase schema generate` und eine Migration die Richtlinien
angewendet haben. Siehe [Row-Level Security](/docs/collections/security-rules).

## Das Loopback-Gate

<span class="since-badge" data-since="0.31">Seit 0.31</span>

`rebase_project_add` akzeptiert jede `baseUrl`, und die CLI-Tools verbinden sich mit
der `DATABASE_URL`, die das Projekt deklariert. Dieselbe Tool-Liste, die eine Scratch-Datenbank
auf Ihrem Laptop bearbeitet, kann daher auch Produktionszeilen löschen – ohne dass etwas
anderes dazwischensteht als das Urteil des Assistenten darüber, welches Projekt gerade aktiv ist.

**Jedes Tool, das die Zielumgebung verändert, wird verweigert, es sei denn, dieses Ziel
befindet sich auf dem Loopback-Interface.** Das Gate ist als Liste dessen definiert, was
*nicht* blockiert wird, sodass ein später hinzugefügtes Werkzeug standardmäßig geschützt ist.

- **Nicht blockiert – Leseoperationen:** `rebase_schema_plan`, `rebase_doctor`,
  `rebase_db_branch_list`, `rebase_db_branch_info`, `rebase_db_branch_diff`, `query_table`,
  `get_row`, `list_users`, `list_roles`, `storage_list_objects`,
  `storage_get_download_url`, `cron_list_jobs`, `cron_get_job`, `cron_get_job_logs`,
  `rebase_dev_logs` sowie die Rebase Cloud-Leseoperationen `rebase_cloud_status`,
  `rebase_cloud_logs`, `rebase_cloud_env_list`, `rebase_cloud_deployments_list`.
- **Nicht blockiert – Rebase Cloud-Schreiboperationen:** `rebase_cloud_provision`,
  `rebase_cloud_deploy`, `rebase_cloud_env_set`, `rebase_cloud_rollback`.
  Das Provisioning erstellt ein Projekt; die anderen verändern ein Produktionsprojekt.
  Keines von ihnen läuft über `baseUrl` oder `DATABASE_URL`, was die einzigen Werte sind,
  die das Gate prüfen kann. Siehe [Rebase Cloud](#rebase-cloud) bezüglich der Sicherheitsmechanismen davor.
- **Nicht blockiert – nur lokal:** `rebase_schema_introspect`, `rebase_db_branch_switch`,
  `rebase_schema_generate`, `rebase_db_generate`, `rebase_generate_sdk`, die Dev-Server-Tools
  und die Projekt-Registry-Tools. Diese schreiben lokale Dateien oder lokalen Status und
  haben kein Remote-Ziel zu prüfen.
- **Gegen `DATABASE_URL` blockiert:** die verbleibenden CLI-Tools – `rebase_db_push`,
  `rebase_db_migrate`, `rebase_db_branch_create`, `rebase_db_branch_delete`.
- **Gegen die Projekt-`baseUrl` blockiert:** die verbleibenden SDK-Tools –
  `create_row`, `update_row`, `delete_row`, `create_user`,
  `update_user`, `delete_user`, `rebase_auth_reset_password`,
  `storage_delete_object`, `cron_trigger_job`, `cron_toggle_job`
  und `invoke_function`.

Die beiden Ziele sind nicht austauschbar. CLI-Tools sehen niemals die `baseUrl`; ein
Localhost-Backend neben einer Produktions-`DATABASE_URL` wird daher gegen die Datenbank
geprüft, nicht gegen das Backend.

Eine Verweigerung sieht folgendermaßen aus:

```text
Error: Refusing to run "delete_row": project "default" points at
https://api.example.com/, which is not local. Set REBASE_MCP_ALLOW_REMOTE_WRITES=true
to allow destructive tools against remote environments.
```

**Wenn überhaupt kein Verbindungs-String aufgelöst werden kann, werden die geschützten
DB-Tools verweigert.** Ohne `DATABASE_URL` verwendet die CLI die verwaltete Entwicklungsdatenbank,
die der Standard für ein neues Projekt ist, und das Gate verweigert dort seine vier
Datenbank-Tools. Die Verweigerung begründet dies und nennt funktionierende Alternativen.
Sie schlägt die Deaktivierung des Schutzes nicht vor:

```text
Error: Refusing to run "rebase_db_push": project "default" sets no DATABASE_URL, so the
CLI would use the managed development database (PGlite, started by `rebase dev`). You
most likely do not need this tool: the dev server applies the tables in backend/schema to
that database at boot, additively. After changing a table, restart it with
rebase_dev_stop and rebase_dev_start. …
```

Aus einem Terminal heraus werden `rebase db push` und `rebase db migrate` auf dieser
Datenbank ausgeführt; nur die MCP-Tools werden verweigert.

Nur Loopback gilt als lokal: `localhost`, `*.localhost`, `127.0.0.0/8`, `::1`
(und `0.0.0.0`).
Private IP-Bereiche wie `10.x` und `192.168.x` gelten **nicht** als lokal – dabei kann
es sich genauso gut um ein geteiltes Staging-Cluster wie um einen Laptop handeln. Sie
als lokal zu behandeln, würde genau die versehentlichen Zugriffe durchwinken, zu deren
Verhinderung das Gate existiert.

Setzen Sie `REBASE_MCP_ALLOW_REMOTE_WRITES=true`, um diesen Schutz zu deaktivieren.
Wenn Sie dies global in Ihrer MCP-Client-Konfiguration setzen, wird das Gate für jedes
Projekt entfernt, das der Server erreichen kann, nicht nur für dasjenige, an das Sie gerade gedacht haben.

## Kennzeichnung nicht vertrauenswürdiger Daten

Zeilen, Benutzerdatensätze, Storage-Listen, Cron-Jobs, Funktionsantworten und CLI-Ausgaben
werden in einem expliziten Umschlag zurückgegeben:

```text
<<<UNTRUSTED_DATA source="query_table" id="9b2f4c1e-…">>>
[ … rows … ]
<<<END_UNTRUSTED_DATA id="9b2f4c1e-…">>>
```

Alles, was in Ihrer Datenbank gespeichert ist, wurde von irgendjemandem geschrieben und
kommt über denselben Kanal wie die Tool-Definitionen, denen der Assistent folgt. Der
Umschlag weist das Modell an, dies als reinen Dateninhalt und nicht als Anweisungen zu behandeln.

Die `id` wird für jede Antwort neu generiert, nachdem die Daten geschrieben wurden,
und nur die Endmarkierung mit dieser ID schließt den Block. Text innerhalb der Daten,
der wie eine Markierung aufgebaut ist, wird durch ein breitenloses Leerzeichen unterbrochen,
sodass eine Zeile, die `<<<END_UNTRUSTED_DATA>>>` ausgibt, den Umschlag nicht vorzeitig
schließen und nachfolgende Inhalte nach außen befördern kann.

Der [Remote-Endpunkt](/docs/ai/remote-mcp/) kapselt seine Tool-Ergebnisse auf dieselbe
Weise und teilt dies dem Client mit; sein `structuredContent` enthält das reine Ergebnis.
`list_tables` und `describe_table` sind die Ausnahmen: Da sie nur von einem Modell gelesen
werden, werden sie einmalig im Text gesendet.

Es handelt sich um eine Markierung, nicht um eine Sandbox. Ein Assistent, der diese Werkzeuge
besitzt, ist nur so sicher wie die Inhalte, die Sie ihn lesen lassen.

## Mehrere Projekte

Projektkonfigurationen werden in `~/.rebase/projects.json` gespeichert, und der Server
kann mehrere gleichzeitig verwalten – nützlich, wenn Sie über lokale und entfernte Umgebungen
hinweg arbeiten. Während `rebase dev` läuft, liest der Server den aktiven Port und den
Service-Key aus `.rebase/state.json` im Projektverzeichnis, was den lokalen Fall konfigurationsfrei macht.

:::note[Die Registry hat das letzte Wort, nicht das erste]
Die Rangfolge entspricht der oben genannten: Umgebungsblock, dann das Arbeitsverzeichnis,
wenn es eine `rebase.json` enthält, und schließlich das persistierte `default`-Projekt.

`REBASE_PROJECT_DIR`, `REBASE_BASE_URL` und `REBASE_API_TOKEN` bauen das `default`-Projekt
**bei jedem Start** neu auf, nicht nur beim ersten. Dieser Neuaufbau betrifft den gesamten
Eintrag: Ein Token, das für das alte `projectDir` registriert war, wird verworfen, anstatt
in ein Verzeichnis übernommen zu werden, für das es nie ausgestellt wurde. Ein auf diese
Weise – oder aus dem Arbeitsverzeichnis – abgeleiteter `default`-Wert wird niemals nach
`~/.rebase/projects.json` zurückgeschrieben, sodass der Entwicklungs-Service-Key eines Projekts
nicht zu dem eines anderen werden kann.

`activeProject` bleibt über Sitzungen hinweg erhalten. Wenn also eine vorherige Sitzung
`rebase_project_switch` aufgerufen hat, zielen Tools auf dieses Projekt ab, worauf der
Server auf stderr hinweist – es sei denn, dieses Projekt ist unter einem *anderen* Verzeichnis
als dem registriert, in dem dieser Server läuft; in diesem Fall fällt er auf `default`
zurück und meldet dies ebenfalls. Wenn ein Assistent scheinbar die falsche Datenbank liest,
rufen Sie zuerst `rebase_project_current` auf.
:::

Tokens werden in dieser Registry **im Klartext** gespeichert. Es handelt sich um eine Datei
in Ihrem Home-Verzeichnis, die Admin-Credentials für jedes von Ihnen registrierte Projekt
enthält; behandeln Sie sie entsprechend sorgfältig.

## Rebase Cloud

Acht Tools bringen eine App aus diesem Verzeichnis auf ein Live-Backend in
[Rebase Cloud](/docs/deployment/cloud/) und halten sie am Laufen. Jedes davon führt
`rebase cloud <command> --json` im aktiven Projektverzeichnis aus: genau derselbe
Befehl, den ein Mensch ausführt, sodass es keine zweite Implementierung gibt, die davon abweichen könnte.

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

Der typische Ablauf eines Agenten ist: `rebase_cloud_provision`, dann dem Benutzer die
Claim-URL bereitstellen; `rebase_cloud_status`, um das Projekt zu prüfen (solange es
nicht beansprucht ist, enthält `unclaimed` die Claim-URL und wann es gelöscht wird);
`rebase_cloud_deploy` nach einer Änderung; `rebase_cloud_logs`, wenn sich etwas fehlerhaft
verhält; und `rebase_cloud_rollback`, wenn die Produktion beschädigt ist.

**Worauf sie wirken.** Auf das Projekt, mit dem das aktive Verzeichnis in
`.rebase/cloud.json` verknüpft ist. Keines von ihnen akzeptiert eine Projekt-ID oder ein
Verzeichnis, sodass ein Assistent sie nicht auf ein anderes Projekt ansetzen kann als das,
mit dem das Verzeichnis verknüpft ist. Ein Wechsel des aktiven Projekts mit
`rebase_project_switch` wechselt das Verzeichnis, in dem sie ausgeführt werden.

**Wessen Berechtigung.** Was auch immer die CLI in diesem Verzeichnis auflöst:
`REBASE_TOKEN`, wenn es gesetzt ist, danach das Token, das `rebase cloud init --claim`
für ein nicht beanspruchtes Projekt gespeichert hat, und schließlich die
`rebase cloud login`-Sitzung. Im Verzeichnis eines solchen nicht beanspruchten Projekts
wird ein `REBASE_TOKEN`, das keinen Scope für das Projekt besitzt, zugunsten des
projekteigenen Tokens ignoriert. Die Control Plane prüft jeden Aufruf genauso wie die
Aufrufe der CLI. Mit einem Token, das über `rebase cloud tokens create --can logs`
erstellt wurde, kann ein Assistent also Protokolle lesen, während die Control Plane
seine Deploys, Variablenänderungen und Rollbacks verweigert. Fehlende oder verweigerte
Anmeldedaten werden als Fehler zurückgegeben, der beschreibt, was der Benutzer tun
muss (`rebase cloud login` oder das Beanspruchen des Projekts).

**Warum das Loopback-Gate hier nicht greift.** Das Gate prüft die `baseUrl` der App
und die `DATABASE_URL` der CLI; diese Tools verwenden keines von beiden. Nach
`rebase_cloud_provision` zeigt `REBASE_BASE_URL` auf das neue Cloud-Projekt. Ein Blockieren
auf dieser Basis würde genau das Deployment verweigern, das der Ablauf erfordert.
Das Provisioning selbst erstellt lediglich Ressourcen: Es berührt keine bestehende App
oder Datenbank, und die CLI verweigert es in einem bereits verknüpften Verzeichnis ohnehin.
Ein Deploy, eine Umgebungsvariable und ein Rollback ändern jeweils die Produktion.
Was davor schützt, sind die oben genannten Anmeldedaten und die Tool-Bestätigung Ihres
MCP-Clients. Um zu verhindern, dass ein Assistent ein Cloud-Projekt verändert, setzen Sie
`REBASE_TOKEN` in der Umgebung des Servers auf ein Token ohne die Berechtigungen `deploy` und `env`.

**Lesen beliebiger Projekte von Ihnen.** Die oben genannten Tools wirken auf das verknüpfte
Projekt. Um die Daten eines anderen Projekts zu lesen – jedes Projekt in jeder Organisation,
zu der das angemeldete Konto gehört, egal ob hier verknüpft oder nicht –, listet
`rebase_cloud_projects_list` diese auf, und `rebase_project_use_cloud` (mit ID, Slug oder Name)
richtet die Daten- und Admin-Tools darauf aus: `query_table`, `get_row`, `list_users`,
`list_roles`, `cron_list_jobs`, `storage_list_objects`. Diese Aufrufe laufen über den
Studio-Proxy der Konsole unter Verwendung der eigenen Anmeldedaten der CLI
(`rebase cloud access-token`, das pro Aufruf gelesen und niemals gespeichert wird); die
Control Plane überprüft den Zugriff des Benutzers und hängt den Service-Key des Projekts
auf ihrer Seite an, sodass kein Schlüssel die lokale Maschine erreicht. Ein Projekt mit
deaktiviertem Studio wird verweigert, und die Fehlermeldung weist darauf hin. Es handelt
sich um ein Remote-Ziel wie jedes andere, daher bleiben Werkzeuge, die Daten verändern,
dort verweigert, es sei denn, `REBASE_MCP_ALLOW_REMOTE_WRITES` ist gesetzt;
`rebase_project_switch` schaltet zurück.

Jedes Tool liefert eine Momentaufnahme:

- `rebase_cloud_logs` streamt niemals fortlaufend. Das Ergebnis enthält `nextSinceTime`;
  übergeben Sie dies als `since` zurück, um nachfolgende Einträge zu lesen. Es gibt die letzten
  200 Zeilen zurück, sofern `tail` nichts anderes angibt. `source: "build"` gibt stattdessen
  das neueste Build-Protokoll zurück.
- `rebase_cloud_deploy` verfolgt das Deployment bis zum Ende und überprüft, ob die neue
  Version antwortet. `wait: false` kehrt zurück, sobald das Deployment angestoßen wurde.
  Es wirft ein Projekt niemals aus der verwalteten Laufzeitumgebung, deployt keine ältere
  Framework-Version und überspringt keine Build-Prüfungen: Dies sind Entscheidungen des Benutzers,
  und eine Verweigerung, die eine solche erfordert, teilt dies mit.
- `rebase_cloud_rollback` übergibt `--yes`. Der Tool-Aufruf stellt die Bestätigung dar, da
  kein Terminal für eine interaktive Nachfrage vorhanden ist.

`rebase_cloud_env_set` schreibt den Wert in die Standardeingabe der CLI, sodass er niemals
auf einer Befehlszeile erscheint, auf der `ps` ihn anzeigen könnte, und der Wert wird aus
allen Rückgaben des Tools herausgefiltert. Sein Ergebnis gibt an, was gespeichert wurde
(der Schlüssel, ob er geheim ist, ob ein Redeploy aussteht), niemals den Wert selbst.
`rebase_cloud_env_list` listet ausschließlich Schlüssel auf. Eine CLI, die älter ist als
`env set --stdin`, wird mit dem Hinweis verweigert, sie zu aktualisieren; der Wert wird
auf keinem anderen Weg übermittelt.

Die Ergebnisse werden im [Umschlag für nicht vertrauenswürdige Daten](#kennzeichnung-nicht-vertrauenswürdiger-daten)
zurückgegeben, eingeleitet durch eine Zeile des Servers mit Hinweisen zum weiteren Vorgehen.
Eine Verweigerung ist ein Tool-Fehler, der den Fehlercode der CLI enthält, wie z. B.
`no_project`, `token_rejected`, `managed_project` oder `deploy_failed`. Wenn der Server
den Code erkennt, fügt er den nächsten Handlungsschritt hinzu, gefolgt von der eigenen Meldung
der CLI. Jedes Tool validiert seine Argumente gegen das von ihm angegebene Schema, bevor
irgendein Prozess gestartet wird, und weist nicht deklarierte Argumente ab.

## Tool-Referenz

53 Tools in zehn Gruppen: Schema und Datenbank, Schemaplanung, Dokumente, Benutzer
und Rollen, Storage, Cron, Funktionen, der Dev-Server, die Projekt-Registry und
Rebase Cloud.
Jedes einzelne Tool inklusive der erforderlichen Parameter und der Information, ob
das Gate es bei einem nicht-lokalen Ziel blockiert, finden Sie in der
[MCP-Tool-Referenz](/docs/ai/mcp-tool-reference).

## Ressourcen

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Neben Tools stellt der Server MCP-Ressourcen bereit, sodass ein Client Kontext über das
Projekt abrufen kann, ohne einen Tool-Aufruf zu verbrauchen:

| URI | Beschreibung |
|---|---|
| `rebase://tables/{name}` | TypeScript-Quellcode einer Tabellendefinition (`defineTable`) |
| `rebase://schema` | Das generierte Drizzle-Schema (`schema.generated.ts`) |

Tabellendateien sind die Module des Schema-Verzeichnisses (abgesehen von dessen `index.ts`):
der Schlüssel `tables` der Backend-App in `rebase.json`, standardmäßig `backend/schema`,
unter dem aktiven Projektverzeichnis oder dessen `app/`.

`rebase://schema` wird **nur dann aufgeführt**, wenn das generierte Schema existiert.
`findBackendDir` sucht nach `backend/` und dann nach `app/backend/` unterhalb des aktiven
Projektverzeichnisses und liest `src/schema.generated.ts` aus dem Verzeichnis, das es zuerst findet.
Damit funktionieren sowohl das Standard-Scaffold-Layout als auch das dieses Monorepos;
ein Projekt mit einer abweichenden Struktur oder ein Projekt, in dem `rebase schema generate`
noch nicht ausgeführt wurde, bekommt die Ressource schlicht nicht angeboten.

## Der Remote-Endpunkt

Ein bereitgestelltes Backend kann MCP unter `/mcp` auch selbst für die Benutzer Ihrer
Anwendung bereitstellen, wobei sich jeder Benutzer als er selbst unter seiner eigenen
Row-Level Security verbindet. Dies wird auf einer eigenen Seite behandelt:
[Der Remote-MCP-Endpunkt](/docs/ai/remote-mcp/).

## Empfohlenes Setup

- Richten Sie den Server auf ein **lokales** Projekt aus und lassen Sie
  `REBASE_MCP_ALLOW_REMOTE_WRITES` ungesetzt. Das Gate ist die wertvollste Schutzfunktion
  des Pakets.
- Registrieren Sie für alle Remote-Umgebungen einen **bereichsbezogenen `rk_`-API-Schlüssel**,
  anstatt der automatischen Erkennung die Übergabe eines Service-Keys zu überlassen.
- Überprüfen Sie `rebase_project_current`, wenn Ausgaben unerwartet aussehen. Das aktive
  Projekt bleibt sitzungsübergreifend erhalten und liegt außerhalb Ihres Repositories.
- Behandeln Sie `~/.rebase/projects.json` wie eine Datei für vertrauliche Zugangsdaten (Secrets).
