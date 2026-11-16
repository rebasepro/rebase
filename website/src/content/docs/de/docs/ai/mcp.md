---
sourceHash: a81f3289674f6e53
title: MCP-Server
sidebar_label: MCP-Server
description: Verbinden Sie Claude Code, Cursor, Gemini CLI oder beliebige MCP-Clients mit einem Rebase-Projekt – die 53 bereitgestellten Tools, die verwendeten Anmeldedaten und das Loopback-Gate, das zwischen einem Agenten und der Produktionsumgebung steht.
---

`@rebasepro/mcp` ist ein [Model Context Protocol](https://modelcontextprotocol.io)-Server,
der einem KI-Assistenten echte Werkzeuge für ein Rebase-Projekt zur Verfügung stellt:
Zeilen lesen und schreiben, Benutzer verwalten, Migrationen ausführen, Funktionen
aufrufen und den Entwicklungsserver steuern.

Er spricht MCP **ausschließlich über stdio**. Es gibt keinen Port und keinen Listener –
der Prozess besitzt genau dasselbe Vertrauensniveau wie der Prozess, der ihn gestartet
hat, und es gibt keinen Remote-Aufrufer zu authentifizieren. Das ist der sichere Teil.
Die interessanten Fragen drehen sich darum, was er tut, *sobald* er läuft, und diese
Seite beantwortet sie, bevor sie den Konfigurationsblock zeigt.

Ein bereitgestelltes Backend kann MCP auch selbst über HTTP für die Benutzer Ihrer
Anwendung bereitstellen. Das ist ein anderes Szenario mit einem anderen Berechtigungsmodell:
siehe [Der Remote-MCP-Endpunkt](/docs/ai/remote-mcp/).

:::tip[Verwenden Sie Claude im Web, auf dem Desktop oder auf dem Smartphone?]
Fügen Sie stattdessen den [Rebase-Connector](/docs/ai/rebase-connector/) hinzu:
`https://app.rebase.pro/mcp`, einmalig für jedes Projekt, das Sie auf Rebase Cloud
oder auf Ihren eigenen Servern betreiben. Diese Seite behandelt den lokalen Server,
den ein Coding-Assistent innerhalb eines Projekts startet.
:::

## Einen Client verbinden

Der Server läuft aus Ihrem Projekt heraus: `@rebasepro/mcp` ist eine devDependency,
die jedes `rebase init`-Gerüst über die CLI festlegt, und jeder unten aufgeführte
Block – die gesamte Integration – startet genau diese Kopie (`pnpm exec rebase-mcp`
oder `npx --no rebase-mcp` in einem npm-Projekt), niemals eine neuere aus npm.
Ein älteres Projekt fügt sie einmalig mit `rebase skills install --mcp` oder
`pnpm add -D @rebasepro/mcp` hinzu.

`rebase init` schreibt den Block für jeden von Ihnen ausgewählten Agenten, wenn es
[Ihre KI-Coding-Agenten einrichtet](/docs/ai/skills#set-up-by-rebase-init), wobei alle
bereits in der Datei vorhandenen Server erhalten bleiben. `rebase init --agent cursor,codex`
macht dasselbe ohne Nachfrage.

**Claude Code** – `.mcp.json` in Ihrem Projektstammverzeichnis. `rebase init` schreibt
diese Datei für Sie:

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

**Cursor** – die gleiche Struktur in `.cursor/mcp.json`. Cursor expandiert
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
Codex liest eine Projektkonfiguration erst, wenn Sie dem Projekt vertraut haben:

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

**Windsurf** liest MCP-Server ausschließlich aus seiner Konfiguration auf Benutzerebene,
sodass keine Projektdatei geschrieben werden muss. Fügen Sie den Server in den
MCP-Einstellungen als `"command": "pnpm"`, `"args": ["--dir", "/absoluter/pfad/zu/ihrem/projekt", "exec", "rebase-mcp"]`
hinzu, mit diesem Pfad als `REBASE_PROJECT_DIR`.

Jeder MCP-Client, der einen stdio-Server starten kann, funktioniert; die Struktur ist identisch.

### Auf welches Verzeichnis er zugreift

`REBASE_PROJECT_DIR` ist das Verzeichnis, das `rebase.json` enthält. Es gibt **eine**
Rangfolge, und sie ist in jedem Client identisch:

1. **Der Umgebungsblock** – `REBASE_PROJECT_DIR`, `REBASE_BASE_URL`,
   `REBASE_API_TOKEN`. Wenn einer dieser Werte gesetzt ist, wird das `default`-Projekt
   bei jedem Start daraus neu erstellt.
2. **Das Arbeitsverzeichnis des Servers**, wenn es eine `rebase.json` enthält. Ein Projekt,
   in dem Sie sich befinden, hat Vorrang vor allem, was in `~/.rebase/projects.json`
   gespeichert ist.
3. **Der persistent gespeicherte `default`** in `~/.rebase/projects.json`, wenn weder
   Punkt 1 noch 2 etwas angeben.

Die automatische Erkennung aus `.rebase/state.json` füllt in allen drei Fällen Lücken
und überschreibt niemals einen Wert, der von einem dieser Punkte bereitgestellt wurde.

Die Konfigurationsblöcke auf Projektebene benennen das Projekt – `"."`, das Arbeitsverzeichnis
des Clients oder `${workspaceFolder}` des Editors –, da Regel 3 eine Datei liest, die
von allen Projekten auf dem Rechner geteilt wird. Eine Konfiguration auf Benutzerebene,
wie die von Windsurf, gibt stattdessen einen absoluten Pfad an.

## Was der Server erreichen kann

Diesen Abschnitt sollten Sie lesen, bevor Sie einen Assistenten auf eine Datenbank ansetzen,
die Ihnen wichtig ist.

Der Server verfügt über **eine einzige umgebende Anmeldeinformation für den gesamten Prozess**.
Es gibt keine Identität pro Tool und keinen Nur-Lese-Modus; jedes Tool verwendet denselben Token,
und der einzige Schalter im Paket schaltet *mehr* Zugriff frei statt weniger.

Welche Anmeldeinformation das ist, in der Reihenfolge ihrer Priorität:

1. `REBASE_API_TOKEN` aus der Umgebung. `REBASE_TOKEN` wird hier nicht gelesen:
   Es ist der Control-Plane-Token der CLI und wird niemals an die App gesendet (der
   Server weist einmal auf stderr darauf hin, wenn dies der einzige gesetzte Token ist).
   Die Cloud-Tools übergeben ihn weiterhin an die von ihnen gestartete CLI, die ihn an
   die Control-Plane sendet.
2. `REBASE_SERVICE_KEY`, ausgelesen aus der `.env` des Projekts.
3. Der Service-Key, der automatisch aus `.rebase/state.json` erkannt wird, während
   `rebase dev` ausgeführt wird.

2 und 3 sind die Schlüssel des lokalen Entwicklungs-Backends dieses Rechners, die nur
verwendet werden, wenn sich das Ziel auf dem Loopback-Interface befindet. Wenn `REBASE_BASE_URL`
woanders hinzeigt – `rebase cloud init --claim` schreibt die Adresse des Cloud-Projekts
und kein `REBASE_API_TOKEN`, bis ein Deployment erfolgreich ist –, sendet der Server
keinen Token und weist einmal auf stderr darauf hin.

Ein Token, den Sie für ein Projekt registrieren, **gewinnt gegenüber der automatischen Erkennung**.
Die Erkennung füllt lediglich Lücken.

:::danger[Der Zero-Config-Pfad ist eine Administrator-Berechtigung]
Die Optionen 2 und 3 stellen den **Service-Key** dar – ein unbeschränktes Admin-Geheimnis.
Das Backend löst ihn auf zu `uid: "service"`, `roles: ["admin"]`, `isAdmin: true`. Diese
Identität besitzt jeden [Scope](/docs/backend/roles-and-scopes/) und erfüllt die
`_default_admin_read`- / `_default_admin_write`-Richtlinien, die Rebase in jede Tabelle
einfügt, die nicht `defaultPolicies: false` festgelegt hat.

Die ehrliche Antwort auf die Frage „Wird er immer noch durch RLS eingeschränkt?“ lautet also:
RLS *wird ausgeführt* – der Treiber führt ein Downgrade auf die Rolle `rebase_user` durch –,
und anschließend gewährt eine von Rebase selbst verfasste Richtlinie dieser Identität vollen
Zugriff. Jede Zeile jeder Tabelle zu lesen, ist das **beabsichtigte Verhalten der Standardkonfiguration**,
keine Umgehung.

Mit dem Zero-Config-Setup kann ein Agent, der diese Tools besitzt, jede Zeile jeder Tabelle
lesen und schreiben, jeden Benutzer auflisten, jedes Passwort zurücksetzen, jede Backend-Funktion
aufrufen und DDL auf jeder `DATABASE_URL` ausführen, die das Projekt auflöst.
:::

### Stattdessen eine eingeschränkte Berechtigung vergeben

Registrieren Sie einen bereichsbezogenen [API-Schlüssel](/docs/backend/api-keys), und das
Zwei-Schranken-Modell greift tatsächlich. Ein Service-Schlüssel läuft mit den Rollen `["service"]`,
die die injizierten Admin-Richtlinien **nicht** benennen – RLS gewährt ihm also nichts, es sei
denn, eine Ihrer eigenen Richtlinien besagt etwas anderes, und seine Scopes schränken ihn
weiter ein:

```bash
rebase api-keys create -n "claude-code" \
  --scopes data:read:articles \
  --expires-in 30
```

Übergeben Sie den resultierenden `rk_live_…`-Schlüssel an den Server, anstatt ihn automatisch
einen Service-Key erkennen zu lassen:

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

Zwei Dinge, die dies **nicht** tut und die man wissen sollte, bevor man sich darauf verlässt:

- **Es schränkt die CLI-Tools nicht ein.** `rebase_db_push`, `rebase_db_migrate`,
  `rebase_doctor` und die Branch-Tools starten die Rebase-CLI, die sich mit `DATABASE_URL`
  verbindet und Ihren Token überhaupt nicht sieht. Das nachfolgende Loopback-Gate ist das
  Einzige, was davor steht.
- **Ein Schlüssel erreicht ein Admin-Tool nur mit dem entsprechenden Scope des Tools.**
  `list_users` und `list_roles` erfordern `users:read`; `create_user`, `update_user`,
  `delete_user` und `rebase_auth_reset_password` erfordern `users:write`; die Storage- und
  Cron-Tools erfordern den passenden `storage:*`- oder `cron:*`-Scope; `invoke_function`
  erfordert `functions:invoke`. Ohne diesen antwortet der Aufruf mit `403 SCOPE_MISSING`.
  Selbst mit `users:write` kann ein Schlüssel das Konto eines Administrators nicht ändern:
  Ein Administrator besitzt `keys:read` und `keys:write`, was kein Schlüssel besitzen kann,
  und niemand darf ein Konto verwalten, das über mehr Berechtigungen verfügt als man selbst.

Ein Schlüssel, der mit `--roles admin` erstellt wurde, ist eine andere Sache: Er trägt die
Rollen `["service", "admin"]`, was dieselben Standard-Admin-Richtlinien freischaltet wie
der Service-Key. Gibt man ihm zusätzlich `--full-access`, entspricht seine Reichweite der
des Service-Keys, abzüglich der Schlüsselverwaltung. Der Vorteil: Er ist **pro Schlüssel
widerrufbar, ablauffähig und ratenbegrenzt**, was auf den Service-Key nicht zutrifft – dessen
Rotation erfordert das Bearbeiten der `.env` und einen Neustart des Servers.

Siehe [Agenten und MCP-Server](/docs/backend/api-keys#agents-and-mcp-servers) für die
vollständige Anleitung zum Key-Scoping.

### Eine Tabelle vollständig unerreichbar machen

Der Grund, warum eine Admin-Berechtigung alles lesen kann, ist die Basisrichtlinie, die Rebase
in jede Tabelle einfügt und die dem vertrauenswürdigen Serverkontext und der Rolle `admin`
Zugriff gewährt. Eine Tabelle kann diese Basisrichtlinie deaktivieren und die volle Verantwortung
für ihr eigenes RLS übernehmen:

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const medicalRecords = defineTable("medical_records", {
    columns: {
        id:        col.uuid().primaryKey().defaultRandom(),
        patientId: col.text(),
        notes:     col.text(),
    },
    // Die injizierte Admin-/Server-Basisrichtlinie entfernen – nichts ist lesbar,
    // außer dem, was die folgenden Regeln erlauben.
    defaultPolicies: false,
    rls: [
        { operations: ["select", "update"], ownerField: "patientId" },
    ],
});
```

Jetzt besteht der einzige Zugang darin, `patientId` zu entsprechen. Die uid des Service-Keys
ist die Zeichenkette `service`, sodass eine Owner-Regel niemals darauf zutrifft – Lesezugriffe
geben null Zeilen zurück und Schreibzugriffe werden von Postgres abgelehnt. Dies ist die einzige
Kontrollinstanz, die die Standard-Anmeldeinformation des MCP-Servers einschränkt, anstatt sie
als gegeben hinzunehmen.

Beachten Sie, dass dies eine echte RLS-Änderung ist und keine rein dokumentarische: Sie wird
erst wirksam, wenn `rebase schema generate` und eine Migration die Richtlinien angewendet haben.
Siehe [Row-Level-Security](/docs/collections/security-rules).

## Das Loopback-Gate

`rebase_project_add` akzeptiert jede `baseUrl`, und die CLI-Tools verbinden sich mit jeder
`DATABASE_URL`, die das Projekt deklariert. Dieselbe Tool-Liste, die eine Scratch-Datenbank
auf Ihrem Laptop bearbeitet, kann daher auch Produktionszeilen löschen – ohne dass etwas
dazwischenliegt außer dem Urteilsvermögen des Assistenten darüber, welches Projekt aktiv ist.

**Jedes Tool, das die Zielumgebung verändert, wird verweigert, es sei denn, dieses Ziel
befindet sich auf dem Loopback-Interface.** Das Gate ist als Liste dessen definiert, was
*nicht* blockiert wird; ein später hinzugefügtes Tool ist somit standardmäßig geschützt.

- **Nicht geschützt – Leseoperationen:** `rebase_schema_plan`, `rebase_doctor`,
  `rebase_db_branch_list`, `rebase_db_branch_info`, `rebase_db_branch_diff`, `query_table`,
  `get_row`, `list_users`, `list_roles`, `storage_list_objects`,
  `storage_get_download_url`, `cron_list_jobs`, `cron_get_job`, `cron_get_job_logs`,
  `rebase_dev_logs` sowie die Leseoperationen von Rebase Cloud: `rebase_cloud_status`,
  `rebase_cloud_logs`, `rebase_cloud_env_list`, `rebase_cloud_deployments_list`.
- **Nicht geschützt – Rebase Cloud Schreiboperationen:** `rebase_cloud_provision`,
  `rebase_cloud_deploy`, `rebase_cloud_env_set`, `rebase_cloud_rollback`.
  Das Bereitstellen (Provisioning) erstellt ein Projekt; die anderen verändern ein
  Produktionsprojekt. Keines davon läuft über `baseUrl` oder `DATABASE_URL`, welche alles
  sind, was das Gate prüfen kann. Siehe [Rebase Cloud](#rebase-cloud) bezüglich der
  vorgeschalteten Sicherheitsmaßnahmen.
- **Nicht geschützt – nur lokal:** `rebase_schema_introspect`, `rebase_db_branch_switch`,
  `rebase_schema_generate`, `rebase_db_generate`, `rebase_generate_sdk`, die Dev-Server-Tools
  und die Projekt-Registry-Tools. Diese schreiben lokale Dateien oder lokalen Status und haben
  kein Remote-Ziel zu prüfen.
- **Geschützt gegen `DATABASE_URL`:** die restlichen CLI-Tools – `rebase_db_push`,
  `rebase_db_migrate`, `rebase_db_branch_create`, `rebase_db_branch_delete`.
- **Geschützt gegen die `baseUrl` des Projekts:** die restlichen SDK-Tools –
  `create_row`, `update_row`, `delete_row`, `create_user`,
  `update_user`, `delete_user`, `rebase_auth_reset_password`,
  `storage_delete_object`, `cron_trigger_job`, `cron_toggle_job`
  und `invoke_function`.

Die beiden Ziele sind nicht austauschbar. CLI-Tools sehen `baseUrl` niemals, daher wird ein
Localhost-Backend, das neben einer Produktions-`DATABASE_URL` liegt, gegen die Datenbank
geprüft, nicht gegen das Backend.

Eine Verweigerung sieht wie folgt aus:

```text
Error: Refusing to run "delete_row": project "default" points at
https://api.example.com/, which is not local. Set REBASE_MCP_ALLOW_REMOTE_WRITES=true
to allow destructive tools against remote environments.
```

**Wenn überhaupt kein Verbindungsstring aufgelöst werden kann, werden die geschützten DB-Tools verweigert.**
Ohne `DATABASE_URL` verwendet die CLI die verwaltete Entwicklungsdatenbank, was der Standard
für ein neues Projekt ist, und das Gate verweigert dort seine vier Datenbank-Tools. Die Ablehnung
nennt den Grund und führt Alternativen auf. Sie schlägt die Deaktivierung des Schutzes nicht vor:

```text
Error: Refusing to run "rebase_db_push": project "default" sets no DATABASE_URL, so the
CLI would use the managed development database (PGlite, started by `rebase dev`). You
most likely do not need this tool: the dev server applies the tables in backend/schema to
that database at boot, additively. After changing a table, restart it with
rebase_dev_stop and rebase_dev_start. …
```

Über ein Terminal werden `rebase db push` und `rebase db migrate` auf dieser Datenbank
tatsächlich ausgeführt; nur die MCP-Tools werden verweigert.

Nur Loopback gilt als lokal: `localhost`, `*.localhost`, `127.0.0.0/8`, `::1`
(und `0.0.0.0`).
Private Adressbereiche wie `10.x` und `192.168.x` zählen **nicht** dazu – diese stellen
ebenso wahrscheinlich einen geteilten Staging-Cluster wie einen Laptop dar, und sie als lokal
zu behandeln, würde genau das Missgeschick durchwinken, das das Gate verhindern soll.

Setzen Sie `REBASE_MCP_ALLOW_REMOTE_WRITES=true`, um diesen Schutz zu deaktivieren. Wenn Sie
dies global in Ihrer MCP-Client-Konfiguration setzen, wird das Gate für jedes Projekt entfernt,
das der Server erreichen kann, nicht nur für das, an das Sie gerade gedacht haben.

## Kennzeichnung nicht vertrauenswürdiger Daten

Zeilen, Benutzerdatensätze, Storage-Listen, Cron-Jobs, Funktionsantworten und CLI-Ausgaben
werden in einem expliziten Umschlag zurückgegeben:

```text
<<<UNTRUSTED_DATA source="query_table" id="9b2f4c1e-…">>>
[ … rows … ]
<<<END_UNTRUSTED_DATA id="9b2f4c1e-…">>>
```

Alles, was in Ihrer Datenbank gespeichert ist, wurde von irgendjemandem geschrieben und kommt
auf demselben Kanal an wie der Tool-Vertrag, den der Assistent befolgt. Der Umschlag weist
das Modell an, dies als reinen Dateninhalt und nicht als Anweisungen zu behandeln.

Die `id` wird für jede Antwort neu generiert, nachdem die Daten geschrieben wurden, und nur
der Endmarker mit dieser ID schließt den Block. Text innerhalb der Daten, der wie ein Marker
aussieht, wird durch ein breitenloses Leerzeichen unterbrochen, sodass eine Zeile, die
`<<<END_UNTRUSTED_DATA>>>` ausgibt, den Umschlag nicht vorzeitig beenden und den folgenden
Inhalt nach außen verlagern kann.

Der [Remote-Endpunkt](/docs/ai/remote-mcp/) kapselt seine Tool-Ergebnisse auf die gleiche Weise
und teilt dies dem Client mit; sein `structuredContent` enthält das reine Ergebnis.
`list_tables` und `describe_table` sind die Ausnahmen: Da sie nur von einem Modell gelesen werden,
werden sie einmalig im Text gesendet.

Es ist eine Kennzeichnung, keine Sandbox. Ein Assistent mit diesen Tools ist nur so sicher wie
die Inhalte, die Sie ihn lesen lassen.

## Mehrere Projekte

Projektkonfigurationen werden in `~/.rebase/projects.json` gespeichert, und der Server kann
mehrere gleichzeitig verwalten – nützlich, wenn Sie über lokale und Remote-Umgebungen hinweg
arbeiten. Während `rebase dev` läuft, liest der Server den aktiven Port und den Service-Key
aus `.rebase/state.json` im Projektverzeichnis, was den lokalen Fall konfigurationsfrei macht.

:::note[Die Registry ist das letzte Wort, nicht das erste]
Die Rangfolge entspricht der oben beschriebenen: Umgebungsblock, dann das Arbeitsverzeichnis,
wenn es eine `rebase.json` enthält, und schließlich der gespeicherte `default`.

`REBASE_PROJECT_DIR`, `REBASE_BASE_URL` und `REBASE_API_TOKEN` bauen das `default`-Projekt
**bei jedem Start** neu auf, nicht nur beim ersten Mal. Dieser Neuaufbau betrifft den gesamten
Eintrag: Ein für das alte `projectDir` registrierter Token wird verworfen, anstatt in ein
Verzeichnis übernommen zu werden, für das er nie ausgestellt wurde. Ein auf diese Weise – oder
aus dem Arbeitsverzeichnis – abgeleiteter `default` wird niemals zurück in `~/.rebase/projects.json`
geschrieben, sodass der Entwicklungs-Service-Key eines Projekts nicht zu dem eines anderen werden kann.

`activeProject` ist persistent. Wenn also eine frühere Sitzung `rebase_project_switch` aufgerufen
hat, zielen die Tools auf dieses Projekt ab, und der Server gibt dies auf stderr aus – es sei denn,
dieses Projekt ist unter einem *anderen* Verzeichnis registriert als dem, in dem dieser Server
ausgeführt wird; in diesem Fall fällt er auf `default` zurück und teilt dies mit. Wenn ein Assistent
die falsche Datenbank zu lesen scheint, rufen Sie zuerst `rebase_project_current` auf.
:::

Tokens werden in dieser Registry **im Klartext** gespeichert. Es handelt sich um eine Datei in
Ihrem Home-Verzeichnis, die Admin-Anmeldeinformationen für jedes von Ihnen registrierte Projekt
enthält; behandeln Sie sie entsprechend vorsichtig.

## Rebase Cloud

Acht Tools bringen eine App aus diesem Verzeichnis zu einem Live-Backend auf
[Rebase Cloud](/docs/deployment/cloud/) und halten sie am Laufen. Jedes davon startet
`rebase cloud <command> --json` im aktiven Projektverzeichnis: derselbe Befehl, den auch ein
Mensch ausführt, sodass keine zweite Implementierung existiert, die davon abweichen könnte.

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

Der typische Ablauf eines Agenten sieht so aus: `rebase_cloud_provision`, dann dem Benutzer
die Claim-URL übergeben; `rebase_cloud_status`, um das Projekt einzusehen (solange es nicht
beansprucht wurde, enthält `unclaimed` die Claim-URL und den Löschzeitpunkt); `rebase_cloud_deploy`
nach einer Änderung; `rebase_cloud_logs`, wenn etwas fehlschlägt; und `rebase_cloud_rollback`,
wenn die Produktionsumgebung beschädigt ist.

**Worauf sie wirken.** Auf das Projekt, mit dem das aktive Verzeichnis in `.rebase/cloud.json`
verknüpft ist. Keines davon akzeptiert eine Projekt-ID oder ein Verzeichnis, sodass ein Assistent
sie nicht auf ein anderes Projekt ausrichten kann als das, mit dem das Verzeichnis verknüpft ist.
Das Wechseln des aktiven Projekts mit `rebase_project_switch` wechselt das Verzeichnis, in dem sie laufen.

**Wessen Berechtigung.** Was auch immer die CLI in diesem Verzeichnis auflöst: `REBASE_TOKEN`,
wenn gesetzt, dann der Token, den `rebase cloud init --claim` für ein nicht beanspruchtes Projekt
gespeichert hat, danach die `rebase cloud login`-Sitzung. Im Verzeichnis dieses unbeanspruchten
Projekts wird ein `REBASE_TOKEN`, der keinen Scope für das Projekt besitzt, zugunsten des
projekteigenen Tokens beiseitegelegt. Die Control-Plane prüft jeden Aufruf wie bei der CLI:
Mit einem durch `rebase cloud tokens create --can logs` erstellten Token kann ein Assistent
Logs lesen, während die Control-Plane Deployments, Variablen und Rollbacks verweigert. Fehlende
oder abgelehnte Anmeldedaten werden als Fehler zurückgegeben, der beschreibt, was der Benutzer
tun muss (`rebase cloud login` oder das Beanspruchen des Projekts).

**Warum das Loopback-Gate nicht greift.** Das Gate prüft die `baseUrl` der App und die
`DATABASE_URL` der CLI; diese Tools nutzen keines von beiden. Nach `rebase_cloud_provision`
zeigt `REBASE_BASE_URL` auf das neue Cloud-Projekt; eine Prüfung darauf würde genau das
Deployment verweigern, das der Workflow benötigt. Das Provisioning selbst erstellt lediglich:
Es fasst keine existierende App oder Datenbank an, und die CLI verweigert es weiterhin in einem
Verzeichnis, das bereits verknüpft ist. Ein Deploy, eine Variable und ein Rollback verändern
jeweils die Produktion. Was davor steht, sind die oben genannten Anmeldedaten, die
Tool-Genehmigung Ihres MCP-Clients und `confirm: true`: `rebase_cloud_deploy` auf die Produktion,
`rebase_cloud_env_set` in der Produktion, `rebase_cloud_rollback` und `rebase_cloud_provision`
geben zurück, was sie tun würden, führen aber nichts aus, bis ein Aufruf dieselben Argumente
mit `confirm: true` wiederholt – was der Assistent erst sendet, nachdem der Benutzer zugestimmt hat.
Ein Preview-Deploy und eine Preview-Variable benötigen dies nicht. Um einen Assistenten daran
zu hindern, ein Cloud-Projekt zu ändern, setzen Sie `REBASE_TOKEN` in der Serverumgebung auf einen
Token ohne die Berechtigungen `deploy` und `env`.

**Beliebige Ihrer Projekte lesen.** Die obigen Tools wirken auf das verknüpfte Projekt.
Um Daten eines anderen Projekts zu lesen – jedes beliebige Projekt in jeder Organisation, zu der
das angemeldete Konto gehört, ob hier verknüpft oder nicht –, listet `rebase_cloud_projects_list`
diese auf, und `rebase_project_use_cloud` (mit ID, Slug oder Name) richtet die Daten- und
Admin-Tools darauf aus: `query_table`, `get_row`, `list_users`, `list_roles`, `cron_list_jobs`,
`storage_list_objects`. Diese Aufrufe laufen über den Studio-Proxy der Konsole unter Verwendung
der CLI-eigenen Anmeldedaten (`rebase cloud access-token`, pro Aufruf gelesen und niemals
gespeichert); die Control-Plane prüft den Benutzerzugriff und hängt den Service-Key des Projekts
auf ihrer Seite an, sodass kein Schlüssel den Rechner erreicht. Ein Projekt mit deaktiviertem
Studio wird abgewiesen, worauf der Schalter hinweist. Es handelt sich um ein Remote-Ziel wie jedes
andere, daher bleiben Tools, die Daten verändern, dort verweigert, es sei denn,
`REBASE_MCP_ALLOW_REMOTE_WRITES` ist gesetzt; `rebase_project_switch` kehrt zurück.

Jedes Tool liefert eine Momentaufnahme:

- `rebase_cloud_logs` streamt nicht fortlaufend. Das Ergebnis enthält `nextSinceTime`; übergeben
  Sie diesen Wert als `since`, um nachfolgende Logs zu lesen. Es werden standardmäßig die letzten
  200 Zeilen zurückgegeben, sofern `tail` nichts anderes festlegt. `source: "build"` gibt stattdessen
  das neueste Build-Log zurück.
- `rebase_cloud_deploy` verfolgt das Deployment bis zum Ende und prüft, ob die neue Version antwortet.
  `wait: false` kehrt zurück, sobald das Deployment ausgelöst wurde. Es stößt ein Projekt niemals
  aus der verwalteten Runtime aus, deployt keine ältere Framework-Version und überspringt keine
  Build-Prüfungen: Dies sind Entscheidungen des Benutzers, und eine Verweigerung, die eine solche
  erfordert, teilt dies mit.
- `rebase_cloud_rollback` übergibt `--yes`, sobald der Aufruf `confirm: true` enthält (siehe unten),
  da es kein Terminal für Nachfragen gibt.

`rebase_cloud_env_set` schreibt den Wert in die Standardeingabe der CLI, sodass er niemals in einer
Befehlszeile auftaucht, wo `ps` ihn anzeigen könnte, und der Wert wird aus allen Rückgaben des
Tools entfernt. Das Ergebnis gibt an, was gespeichert wurde (der Schlüssel, ob er geheim ist,
ob ein erneutes Deployment aussteht), niemals den Wert selbst. `rebase_cloud_env_list` listet
nur Schlüssel auf. Eine CLI, die älter als `env set --stdin` ist, wird mit dem Hinweis abgelehnt,
sie zu aktualisieren; der Wert wird nicht auf anderem Wege übermittelt.

Die Ergebnisse werden im [Umschlag für nicht vertrauenswürdige Daten](#kennzeichnung-nicht-vertrauenswürdiger-daten)
zurückgegeben, gefolgt von einer Zeile des Servers mit Hinweisen zum weiteren Vorgehen. Eine
Verweigerung ist ein Tool-Fehler, der den Fehlercode der CLI enthält, wie etwa `no_project`,
`token_rejected`, `managed_project` oder `deploy_failed`. Erkennt der Server den Code, fügt er
den nächsten Schritt hinzu, gefolgt von der Nachricht der CLI selbst. Jedes Tool prüft seine
Argumente gegen das von ihm definierte Schema, bevor ein Prozess gestartet wird, und weist
nicht deklarierte Argumente ab.

## Tool-Referenz

53 Tools in zehn Gruppen: Schema und Datenbank, Schemaplanung, Dokumente, Benutzer und Rollen,
Storage, Cron, Funktionen, der Entwicklungsserver, die Projekt-Registry und Rebase Cloud.
Jedes einzelne Tool, seine Voraussetzungen und ob das Gate es bei einem nicht-lokalen Ziel
verweigert, finden Sie in der [MCP-Tool-Referenz](/docs/ai/mcp-tool-reference).

## Ressourcen

Neben Tools stellt der Server MCP-Ressourcen bereit, sodass ein Client Projektkontext abrufen
kann, ohne einen Tool-Aufruf zu verbrauchen:

| URI | Beschreibung |
|---|---|
| `rebase://tables/{name}` | TypeScript-Quellcode einer Tabellendefinition (`defineTable`) |
| `rebase://schema` | Das generierte Drizzle-Schema (`schema.generated.ts`) |

Tabellendateien sind die Module des Schema-Verzeichnisses, abgesehen von dessen `index.ts`: der
Schlüssel `tables` der Backend-App in `rebase.json`, standardmäßig `backend/schema`, unter dem
aktiven Projektverzeichnis oder dessen `app/`.

`rebase://schema` wird **nur aufgelistet, wenn** das generierte Schema existiert.
`findBackendDir` sucht nach `backend/` und danach nach `app/backend/` unter dem aktiven
Projektverzeichnis und liest `src/schema.generated.ts` aus dem Verzeichnis, das zuerst gefunden
wird – somit funktionieren sowohl das Standardgerüst als auch die Struktur dieses Monorepos;
ein anders strukturiertes Projekt oder eines, auf dem noch kein `rebase schema generate`
ausgeführt wurde, bekommt die Ressource schlichtweg nicht angeboten.

## Der Remote-Endpunkt

Ein bereitgestelltes Backend kann MCP unter `/mcp` auch direkt für die Personen bereitstellen,
die Ihre Anwendung nutzen – wobei sich jeder als er selbst unter seiner eigenen Row-Level-Security
verbindet. Dies wird auf einer separaten Seite beschrieben:
[Der Remote-MCP-Endpunkt](/docs/ai/remote-mcp/).

## Empfohlene Konfiguration

- Richten Sie den Server auf ein **lokales** Projekt aus und lassen Sie `REBASE_MCP_ALLOW_REMOTE_WRITES`
  ungesetzt. Das Gate ist der wertvollste Schutzmechanismus im gesamten Paket.
- Registrieren Sie für alle Remote-Umgebungen einen **eingeschränkten `rk_`-API-Schlüssel**, anstatt
  der automatischen Erkennung die Übergabe eines Service-Keys zu überlassen.
- Prüfen Sie `rebase_project_current`, wenn Ausgaben fehlerhaft erscheinen. Das aktive Projekt ist
  persistent und liegt außerhalb Ihres Repositories.
- Behandeln Sie `~/.rebase/projects.json` wie eine Datei für vertrauliche Zugangsdaten.
