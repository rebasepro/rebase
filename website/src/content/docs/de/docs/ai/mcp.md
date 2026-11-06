---
sourceHash: 6454e7e328fb09e6
title: MCP-Server
sidebar_label: MCP-Server
description: Verbinden Sie Claude Code, Cursor, Gemini CLI oder einen beliebigen MCP-Client mit einem Rebase-Projekt – die 53 bereitgestellten Tools, die Zugangsdaten für die Authentifizierung und das Loopback-Gate, das zwischen einem Agenten und der Produktion steht.
---

`@rebasepro/mcp` ist ein [Model Context Protocol](https://modelcontextprotocol.io)-Server, der einem KI-Assistenten echte Werkzeuge für ein Rebase-Projekt an die Hand gibt: Zeilen lesen und schreiben, Benutzer verwalten, Migrationen ausführen, Funktionen aufrufen, den Dev-Server steuern.

Er kommuniziert über MCP **ausschließlich via stdio**. Es gibt keinen Port und keinen Listener – der Prozess genießt genau so viel Vertrauen wie der Prozess, der ihn gestartet hat, und es gibt keinen Remote-Aufrufer zu authentifizieren. Das ist der sichere Teil. Die interessanten Fragen drehen sich alle darum, was er tut, *sobald* er läuft, und diese Seite beantwortet sie, bevor sie den Konfigurationsblock zeigt.

Ein bereitgestelltes Backend kann MCP auch selbst über HTTP für die Benutzer Ihrer Anwendung bereitstellen. Das ist etwas anderes mit einem anderen Modell für Zugangsdaten: siehe [Der Remote-MCP-Endpunkt](/docs/ai/remote-mcp/).

:::tip[Verwenden Sie Claude im Web, auf dem Desktop oder mobil?]
Fügen Sie stattdessen den [Rebase-Connector](/docs/ai/rebase-connector/) hinzu:
`https://app.rebase.pro/mcp`, einmalig für jedes Projekt, das Sie auf Rebase Cloud
oder auf Ihren eigenen Servern ausführen. Diese Seite behandelt den lokalen Server, den ein Coding-Assistent innerhalb eines Projekts startet.
:::

## Einen Client verbinden

Der Server wird aus Ihrem Projekt heraus ausgeführt: `@rebasepro/mcp` ist eine devDependency, die jedes `rebase init`-Gerüst zusammen mit der CLI fixiert, und jeder Block unten – die gesamte Integration – startet diese Kopie (`pnpm exec rebase-mcp` oder `npx --no rebase-mcp` in einem npm-Projekt), niemals eine neuere von npm. Ein älteres Projekt fügt sie einmalig mit `rebase skills install --mcp` oder `pnpm add -D @rebasepro/mcp` hinzu.

`rebase init` schreibt den Block für jeden Agenten, den Sie auswählen, wenn es [Ihre KI-Coding-Agenten einrichtet](/docs/ai/skills#set-up-by-rebase-init), wobei alle anderen bereits in der Datei vorhandenen Server beibehalten werden. `rebase init --agent cursor,codex` macht dasselbe ohne Nachfrage.

**Claude Code** – `.mcp.json` im Stammverzeichnis Ihres Projekts. `rebase init` schreibt diese Datei für Sie:

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

**Cursor** – die gleiche Struktur in `.cursor/mcp.json`. Cursor expandiert `${workspaceFolder}` zum Projektstammverzeichnis:

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

**Gemini CLI** – `.gemini/settings.json` unter demselben Schlüssel:

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

**Codex CLI** – TOML statt JSON in der `.codex/config.toml` des Projekts. Codex liest eine Projektkonfiguration erst, sobald Sie dem Projekt vertraut haben:

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

**GitHub Copilot in VS Code** – `.vscode/mcp.json` unter `servers` und mit einem expliziten Transport:

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

**Windsurf** liest MCP-Server nur aus seiner Konfiguration auf Benutzerebene, daher gibt es keine Projektdatei zu schreiben. Fügen Sie den Server in den MCP-Einstellungen als `"command": "pnpm"`, `"args": ["--dir", "/absolute/path/to/your/project", "exec", "rebase-mcp"]` hinzu, mit diesem Pfad als `REBASE_PROJECT_DIR`.

Jeder MCP-Client, der einen stdio-Server starten kann, funktioniert; die Struktur ist identisch.

### Auf welches Verzeichnis er sich bezieht

`REBASE_PROJECT_DIR` ist das Verzeichnis, das `rebase.json` enthält. Es gibt **eine** Rangfolge, und sie ist in jedem Client identisch:

1. **Der Umgebungsblock** – `REBASE_PROJECT_DIR`, `REBASE_BASE_URL`, `REBASE_API_TOKEN`. Wenn einer davon gesetzt ist, wird das `default`-Projekt bei jedem Start daraus neu erstellt.
2. **Das Arbeitsverzeichnis des Servers**, wenn es eine `rebase.json` enthält. Ein Projekt, in dem Sie sich befinden, hat Vorrang vor allem, was in `~/.rebase/projects.json` gespeichert ist.
3. **Der persistierte `default`** in `~/.rebase/projects.json`, wenn keines der ersten beiden etwas angibt.

Die automatische Erkennung aus `.rebase/state.json` füllt in allen drei Fällen Lücken und überschreibt niemals einen Wert, der von einem von ihnen bereitgestellt wurde.

Die Blöcke auf Projektebene benennen das Projekt – `"."`, das Arbeitsverzeichnis des Clients oder das `${workspaceFolder}` des Editors –, da Regel 3 eine Datei liest, die von jedem Projekt auf dem Rechner geteilt wird. Eine Konfiguration auf Benutzerebene, wie die von Windsurf, gibt stattdessen einen absoluten Pfad an.

## Worauf der Server zugreifen kann

Diesen Abschnitt sollten Sie lesen, bevor Sie einen Assistenten auf eine Datenbank ansetzen, die Ihnen wichtig ist.

Der Server verfügt über **eine allumfassende Zugangsdaten-Identität (ambient credential) für den gesamten Prozess**. Es gibt keine Identität pro Tool und keinen Nur-Lese-Modus; jedes Tool verwendet dasselbe Token, und der einzige Schalter im Paket schaltet *mehr* Zugriffsmöglichkeiten frei statt weniger.

Welche Zugangsdaten das sind, in der Reihenfolge ihrer Priorität:

1. `REBASE_API_TOKEN` aus der Umgebung. `REBASE_TOKEN` wird hier nicht gelesen: Es ist das Control-Plane-Token der CLI und wird niemals an die App gesendet (der Server weist einmalig auf stderr darauf hin, wenn es das einzige gesetzte Token ist). Die Cloud-Tools übergeben es weiterhin an die von ihnen gestartete CLI, die es an die Control Plane sendet.
2. `REBASE_SERVICE_KEY`, der aus der `.env` des Projekts ausgelesen wird.
3. Der Service-Key, der während der Ausführung von `rebase dev` automatisch aus `.rebase/state.json` ermittelt wird.

2 und 3 sind der Schlüssel des Entwicklungs-Backends dieser Maschine, der nur verwendet wird, wenn das Ziel auf Loopback liegt. Wenn `REBASE_BASE_URL` woanders hinweist – `rebase cloud init --claim` schreibt die Adresse des Cloud-Projekts und kein `REBASE_API_TOKEN`, bis ein Deployment erfolgreich war –, sendet der Server kein Token und weist einmalig auf stderr darauf hin.

Ein Token, das Sie für ein Projekt registrieren, **hat Vorrang vor der automatischen Erkennung**. Die Erkennung füllt lediglich Lücken.

:::danger[Der Zero-Config-Pfad ist eine Admin-Berechtigung]
Die Optionen 2 und 3 sind der **Service-Key** – ein uneingeschränktes Admin-Geheimnis. Das Backend löst ihn zu `uid: "service"`, `roles: ["admin"]`, `isAdmin: true` auf. Diese Identität besitzt jeden [Scope](/docs/backend/roles-and-scopes/) und erfüllt die `_default_admin_read`- / `_default_admin_write`-Richtlinien, die Rebase in jede Collection einfügt, die nicht `disableDefaultPolicies` gesetzt hat.

Die ehrliche Antwort auf „schränkt RLS ihn trotzdem ein?“ lautet also: RLS *wird ausgeführt* – der Treiber führt ein Downgrade auf die Rolle `rebase_user` durch –, und dann gewährt eine von Rebase selbst geschriebene Richtlinie dieser Identität alles. Das Lesen jeder Zeile jeder Collection ist das **beabsichtigte Verhalten der Standardkonfiguration**, kein Bypass.

Mit dem Zero-Config-Setup kann ein Agent, der diese Tools besitzt, jede Zeile jeder Collection lesen und schreiben, jeden Benutzer auflisten, jedes Passwort zurücksetzen, jede Backend-Funktion aufrufen und DDL auf jeder `DATABASE_URL` ausführen, die das Projekt auflöst.
:::

### Stattdessen eng begrenzte Zugangsdaten zuweisen

Registrieren Sie einen bereichsbezogenen (scoped) [API-Schlüssel](/docs/backend/api-keys), und das Zwei-Stufen-Modell greift tatsächlich. Ein Service-Key läuft mit den Rollen `["service"]`, welche die injizierten Admin-Richtlinien **nicht** benennen – RLS gewährt ihm also nichts, es sei denn, eine Ihrer eigenen Richtlinien besagt etwas anderes, und seine Scopes schränken ihn weiter ein:

```bash
rebase api-keys create -n "claude-code" \
  --scopes data:read:articles \
  --expires-in 30
```

Übergeben Sie dann den resultierenden `rk_live_…`-Schlüssel an den Server, anstatt ihn automatisch einen Service-Key ermitteln zu lassen:

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

- **Es schränkt die CLI-Tools nicht ein.** `rebase_db_push`, `rebase_db_migrate`, `rebase_doctor` und die Branch-Tools starten die Rebase-CLI, die sich über die `DATABASE_URL` verbindet und Ihr Token überhaupt nicht sieht. Das unten beschriebene Loopback-Gate ist das Einzige, was davor steht.
- **Ein Schlüssel erreicht ein Admin-Tool nur mit dem entsprechenden Scope des Tools.** `list_users` und `list_roles` erfordern `users:read`; `create_user`, `update_user`, `delete_user` und `rebase_auth_reset_password` erfordern `users:write`; die Storage- und Cron-Tools benötigen den passenden `storage:*`- oder `cron:*`-Scope; `invoke_function` erfordert `functions:invoke`. Ohne diesen antwortet der Aufruf mit `403 SCOPE_MISSING`. Selbst mit `users:write` kann ein Schlüssel das Konto eines Admins nicht ändern: Ein Admin besitzt `keys:read` und `keys:write`, was kein Schlüssel kann, und niemand darf ein Konto verwalten, das über mehr Berechtigungen verfügt als man selbst.

Ein mit `--roles admin` erstellter Schlüssel ist eine andere Sache: Er trägt die Rollen `["service", "admin"]`, wodurch dieselben Standard-Admin-Richtlinien wie beim Service-Key erfüllt werden. Wenn Sie ihm zusätzlich `--full-access` geben, entspricht seine Reichweite der des Service-Keys, abzüglich der Schlüsselverwaltung. Der Vorteil ist jedoch, dass er **widerrufbar, ablauffähig und pro Schlüssel ratenbegrenzt** ist – nichts davon gilt für den Service-Key; dessen Rotation erfordert die Bearbeitung der `.env` und einen Neustart des Servers.

Siehe [Agenten und MCP-Server](/docs/backend/api-keys#agents-and-mcp-servers) für den vollständigen Leitfaden zum Scoping von Schlüsseln.

### Eine Collection vollständig unerreichbar machen

Der Grund, warum eine Admin-Berechtigung alles lesen kann, ist die Basisrichtlinie, die Rebase in jede Collection einfügt und die dem vertrauenswürdigen Server-Kontext sowie der Rolle `admin` Zugriff gewährt. Eine Collection kann diese Basisrichtlinie deaktivieren und die volle Verantwortung für ihr eigenes RLS übernehmen:

```typescript
import { defineCollection } from "@rebasepro/cms-types";

export const medicalRecordsCollection = defineCollection({
    slug: "medical_records",
    name: "Medical records",
    table: "medical_records",
    properties: {
        patient_id: { name: "Patient", type: "string" },
        notes: { name: "Notes", type: "string" }
    },
    // Remove the injected admin/server baseline — nothing is readable
    // except what the rules below allow.
    disableDefaultPolicies: true,
    securityRules: [
        { operations: ["select", "update"], ownerField: "patient_id" }
    ]
});
```

Jetzt besteht die einzige Zugriffsmöglichkeit darin, mit `patient_id` übereinzustimmen. Die UID des Service-Keys ist der Literal-String `service`, daher trifft eine Owner-Regel niemals darauf zu – Lesezugriffe geben null Zeilen zurück und Schreibvorgänge werden von Postgres abgewiesen. Dies ist die einzige Kontrollinstanz, die die Standard-Zugangsdaten des MCP-Servers einschränkt, anstatt sie einfach vorauszusetzen.

Denken Sie daran, dass dies eine echte RLS-Änderung ist und keine bloße Dokumentation: Sie wird erst wirksam, wenn `rebase schema generate` und eine Migration die Richtlinien angewendet haben. Siehe [Sicherheitsregeln (RLS)](/docs/collections/security-rules).

## Das Loopback-Gate

`rebase_project_add` akzeptiert jede beliebige `baseUrl`, und die CLI-Tools verbinden sich mit der `DATABASE_URL`, die das Projekt deklariert. Dieselbe Tool-Liste, die eine Scratch-Datenbank auf Ihrem Laptop bearbeitet, kann daher Zeilen in der Produktion löschen – und dazwischen steht nichts als das Urteilsvermögen des Assistenten darüber, welches Projekt aktiv ist.

**Jedes Tool, das die Zielumgebung ändert, wird verweigert, es sei denn, dieses Ziel befindet sich auf der Loopback-Schnittstelle.** Das Gate ist als Liste dessen definiert, was *nicht* beschränkt ist, sodass ein später hinzugefügtes Tool standardmäßig geschützt ist.

- **Nicht beschränkt – Lesezugriffe:** `rebase_schema_plan`, `rebase_doctor`, `rebase_db_branch_list`, `rebase_db_branch_info`, `rebase_db_branch_diff`, `list_documents`, `get_document`, `list_users`, `list_roles`, `storage_list_objects`, `storage_get_download_url`, `cron_list_jobs`, `cron_get_job`, `cron_get_job_logs`, `rebase_dev_logs` und die Rebase Cloud-Lesezugriffe `rebase_cloud_status`, `rebase_cloud_logs`, `rebase_cloud_env_list`, `rebase_cloud_deployments_list`.
- **Nicht beschränkt – Rebase Cloud-Schreibzugriffe:** `rebase_cloud_provision`, `rebase_cloud_deploy`, `rebase_cloud_env_set`, `rebase_cloud_rollback`. Das Bereitstellen (Provisioning) erstellt ein Projekt; die anderen ändern ein Produktionsprojekt. Keines davon läuft über `baseUrl` oder `DATABASE_URL`, was alles ist, was das Gate überprüfen kann. Siehe [Rebase Cloud](#rebase-cloud) für die Mechanismen, die davorstehen.
- **Nicht beschränkt – nur lokal:** `rebase_schema_introspect`, `rebase_db_branch_switch`, `rebase_schema_generate`, `rebase_db_generate`, `rebase_generate_sdk`, die Dev-Server-Tools und die Projekt-Registry-Tools. Diese schreiben lokale Dateien oder lokalen Status und haben kein Remote-Ziel zu überprüfen.
- **Gegen `DATABASE_URL` abgesichert:** die restlichen CLI-Tools – `rebase_db_push`, `rebase_db_migrate`, `rebase_db_branch_create`, `rebase_db_branch_delete`.
- **Gegen die `baseUrl` des Projekts abgesichert:** die restlichen SDK-Tools – `create_document`, `update_document`, `delete_document`, `create_user`, `update_user`, `delete_user`, `rebase_auth_reset_password`, `storage_delete_object`, `cron_trigger_job`, `cron_toggle_job` und `invoke_function`.

Die beiden Ziele sind nicht austauschbar. CLI-Tools sehen `baseUrl` niemals; daher wird ein localhost-Backend neben einer Produktions-`DATABASE_URL` gegen die Datenbank und nicht gegen das Backend geprüft.

Eine Verweigerung sieht folgendermaßen aus:

```text
Error: Refusing to run "delete_document": project "default" points at
https://api.example.com/, which is not local. Set REBASE_MCP_ALLOW_REMOTE_WRITES=true
to allow destructive tools against remote environments.
```

**Wenn überhaupt kein Verbindungs-String aufgelöst werden kann, werden die abgesicherten DB-Tools verweigert.** Ohne `DATABASE_URL` verwendet die CLI die verwaltete Entwicklungsdatenbank, die der Standard für ein neues Projekt ist, und das Gate verweigert dort seine vier Datenbank-Tools. Die Ablehnung erklärt den Grund und nennt Alternativen. Sie schlägt kein Deaktivieren des Schutzes vor:

```text
Error: Refusing to run "rebase_db_push": project "default" sets no DATABASE_URL, so the
CLI would use the managed development database (PGlite, started by `rebase dev`). You
most likely do not need this tool: the dev server applies the collections to that
database at boot, additively. After changing a collection, restart it with
rebase_dev_stop and rebase_dev_start. …
```

Über ein Terminal werden `rebase db push` und `rebase db migrate` auf dieser Datenbank ausgeführt; lediglich die MCP-Tools werden abgewiesen. Ab Version 0.24 verweigert die CLI diese dort ebenfalls.

Nur Loopback gilt als lokal: `localhost`, `*.localhost`, `127.0.0.0/8`, `::1` (und `0.0.0.0`). Private Bereiche wie `10.x` und `192.168.x` tun dies **nicht** – dabei kann es sich genauso gut um ein geteiltes Staging-Cluster wie um einen Laptop handeln, und sie als lokal zu behandeln, würde genau das Missgeschick durchwinken, zu dessen Verhinderung das Gate existiert.

Setzen Sie `REBASE_MCP_ALLOW_REMOTE_WRITES=true`, um diesen Schutz zu deaktivieren. Wenn Sie dies global in Ihrer MCP-Client-Konfiguration setzen, wird das Gate für jedes Projekt entfernt, das der Server erreichen kann, nicht nur für dasjenige, an das Sie gerade gedacht haben.

## Kennzeichnung nicht vertrauenswürdiger Daten

Zeilen, Benutzerdatensätze, Storage-Listen, Cron-Jobs, Funktionsantworten und CLI-Ausgaben werden in einem expliziten Umschlag (Envelope) zurückgegeben:

```text
<<<UNTRUSTED_DATA source="list_documents" id="9b2f4c1e-…">>>
[ … rows … ]
<<<END_UNTRUSTED_DATA id="9b2f4c1e-…">>>
```

Alles, was in Ihrer Datenbank gespeichert ist, wurde von jemandem geschrieben, und es trifft über denselben Kanal ein wie der Tool-Vertrag, dem der Assistent folgt. Der Envelope weist das Modell an, dies als passiven Inhalt und nicht als Instruktionen zu behandeln.

Die `id` wird für jede Antwort neu erzeugt, nachdem die Daten geschrieben wurden, und nur die Endmarkierung, die diese ID trägt, schließt den Block. Text innerhalb der Daten, der wie eine Markierung aufgebaut ist, wird durch ein Nullbreite-Leerzeichen unterbrochen, sodass eine Zeile, die `<<<END_UNTRUSTED_DATA>>>` ausgibt, den Envelope nicht vorzeitig beenden und nachfolgende Inhalte nach außen verlagern kann.

Der [Remote-Endpunkt](/docs/ai/remote-mcp/) kapselt seine Tool-Ergebnisse auf die gleiche Weise ein und teilt dies dem Client mit; sein `structuredContent` enthält das reine Ergebnis. `list_collections` und `describe_collection` bilden hierbei die Ausnahme: Nur ein Modell liest diese, daher werden sie einmalig im Text gesendet. Vor Version 0.24 enthielt die Auflistung ebenfalls eine Kopie im `structuredContent`.

Es ist eine Markierung, keine Sandbox. Ein Assistent mit diesen Tools ist nur so sicher wie die Inhalte, die Sie ihn lesen lassen.

## Mehrere Projekte

Projektkonfigurationen werden in `~/.rebase/projects.json` gespeichert, und der Server kann mehrere gleichzeitig verwalten – nützlich, wenn Sie über lokale und Remote-Umgebungen hinweg arbeiten. Während `rebase dev` läuft, liest der Server den aktiven Port und den Service-Key aus `.rebase/state.json` im Projektverzeichnis, was den lokalen Anwendungsfall zur Zero-Config-Lösung macht.

:::note[Die Registry ist das letzte Wort, nicht das erste]
Es gilt die oben genannte Rangfolge: Umgebungsblock, dann das Arbeitsverzeichnis, wenn es eine `rebase.json` enthält, und schließlich der persistierte `default`.

`REBASE_PROJECT_DIR`, `REBASE_BASE_URL` und `REBASE_API_TOKEN` bauen das `default`-Projekt **bei jedem Start** neu auf, nicht nur beim ersten. Dieser Neuaufbau betrifft den gesamten Eintrag: Ein für das alte `projectDir` registriertes Token wird verworfen, anstatt in ein Verzeichnis übernommen zu werden, für das es nie ausgestellt wurde. Ein auf diese Weise – oder aus dem Arbeitsverzeichnis – abgeleitetes `default` wird niemals zurück in `~/.rebase/projects.json` geschrieben, sodass der Dev-Service-Key eines Projekts nicht zum Service-Key eines anderen werden kann.

`activeProject` ist persistent (sticky). Wenn also eine frühere Sitzung `rebase_project_switch` aufgerufen hat, zielen Tools auf dieses Projekt ab und der Server meldet dies auf stderr – es sei denn, dieses Projekt ist unter einem *anderen* Verzeichnis registriert als dem, in dem dieser Server läuft; in diesem Fall fällt er auf `default` zurück und meldet dies ebenfalls. Wenn ein Assistent scheinbar die falsche Datenbank liest, rufen Sie zuerst `rebase_project_current` auf.
:::

Token werden in dieser Registry **im Klartext** gespeichert. Es handelt sich um eine Datei in Ihrem Home-Verzeichnis, die Admin-Zugangsdaten für jedes von Ihnen registrierte Projekt enthält; behandeln Sie sie entsprechend.

## Rebase Cloud

Acht Tools bringen eine App aus diesem Verzeichnis zu einem Live-Backend auf [Rebase Cloud](/docs/deployment/cloud/) und halten sie am Laufen. Jedes davon startet `rebase cloud <command> --json` im aktiven Projektverzeichnis: derselbe Befehl, den auch ein Mensch ausführt, sodass es keine zweite Implementierung gibt, die davon abweichen könnte.

| Tool | Führt aus | Ändert das Projekt |
|---|---|---|
| `rebase_cloud_provision` | `rebase cloud init --claim` | Erstellt eines, ohne Konto |
| `rebase_cloud_status` | `rebase cloud status` | Nein |
| `rebase_cloud_deploy` | `rebase cloud deploy` | Ja |
| `rebase_cloud_logs` | `rebase cloud logs [--runtime]` | Nein |
| `rebase_cloud_env_list` | `rebase cloud env list` | Nein |
| `rebase_cloud_env_set` | `rebase cloud env set KEY --stdin` | Ja, ab dem nächsten Deploy |
| `rebase_cloud_deployments_list` | `rebase cloud deployments list` | Nein |
| `rebase_cloud_rollback` | `rebase cloud rollback --yes` | Ja |
| `rebase_cloud_projects_list` | `rebase cloud projects list --all-orgs` | Nein |

Der typische Ablauf eines Agenten ist: `rebase_cloud_provision`, dann dem Benutzer die Claim-URL übergeben; `rebase_cloud_status`, um das Projekt einzusehen (solange es noch nicht beansprucht wurde, enthält `unclaimed` die Claim-URL und den Löschzeitpunkt); `rebase_cloud_deploy` nach einer Änderung; `rebase_cloud_logs`, wenn etwas fehlschlägt; und `rebase_cloud_rollback`, wenn die Produktion beschädigt ist.

**Worauf sie wirken.** Auf das Projekt, mit dem das aktive Verzeichnis in `.rebase/cloud.json` verknüpft ist. Keines von ihnen nimmt eine Projekt-ID oder ein Verzeichnis entgegen, sodass ein Assistent sie nicht auf ein anderes Projekt als dasjenige richten kann, mit dem das Verzeichnis verknüpft ist. Das Wechseln des aktiven Projekts mit `rebase_project_switch` wechselt das Verzeichnis, in dem sie ausgeführt werden.

**Wessen Berechtigung.** Was auch immer die CLI in diesem Verzeichnis auflöst: `REBASE_TOKEN`, wenn es gesetzt ist, dann das Token, das `rebase cloud init --claim` für ein noch nicht beanspruchtes Projekt gespeichert hat, und schließlich die `rebase cloud login`-Sitzung. Im Verzeichnis eines solchen unbeanspruchten Projekts wird ein `REBASE_TOKEN`, das keinen Scope auf dem Projekt besitzt, zugunsten des projekteigenen Tokens zurückgestellt. Die Control Plane prüft jeden Aufruf wie bei der CLI: Mit einem Token, das durch `rebase cloud tokens create --can logs` erstellt wurde, kann ein Assistent Protokolle lesen, und die Control Plane verweigert dessen Deploys, Variablen und Rollbacks. Fehlende oder abgewiesene Zugangsdaten werden als Fehler zurückgegeben, der angibt, was der Benutzer tun muss (`rebase cloud login` oder das Beanspruchen des Projekts).

**Warum das Loopback-Gate nicht greift.** Das Gate überprüft die `baseUrl` der App und die `DATABASE_URL` der CLI; diese Tools verwenden keines von beiden. Nach `rebase_cloud_provision` verweist `REBASE_BASE_URL` auf das neue Cloud-Projekt, sodass eine Beschränkung darauf genau das Deployment verweigern würde, das der Ablauf erfordert. Das Bereitstellen selbst erstellt lediglich: Es berührt keine bestehende App oder Datenbank, und die CLI verweigert es in einem Verzeichnis, das bereits verknüpft ist, ohnehin. Ein Deploy, eine Variable und ein Rollback verändern jeweils die Produktion. Was davor steht, sind die oben genannten Zugangsdaten und die Tool-Genehmigung Ihres MCP-Clients. Um zu verhindern, dass ein Assistent ein Cloud-Projekt ändert, setzen Sie `REBASE_TOKEN` in der Umgebung des Servers auf ein Token ohne die Berechtigungen `deploy` und `env`.

**Lesen beliebiger Ihrer Projekte.** Die obigen Tools wirken auf das verknüpfte Projekt. Um die Daten eines anderen Projekts zu lesen – jedes Projekt in jeder Organisation, zu der das angemeldete Konto gehört, egal ob hier verknüpft oder nicht –, listet `rebase_cloud_projects_list` diese auf und `rebase_project_use_cloud` (mit einer ID, einem Slug oder einem Namen) richtet die Daten- und Admin-Tools darauf aus: `list_documents`, `get_document`, `list_users`, `list_roles`, `cron_list_jobs`, `storage_list_objects`. Diese Aufrufe laufen über den Studio-Proxy der Konsole und tragen die eigenen Zugangsdaten der CLI (`rebase cloud access-token`, pro Aufruf gelesen und nie gespeichert); die Control Plane prüft den Zugriff der Person und fügt den Service-Key des Projekts auf ihrer Seite an, sodass kein Schlüssel die lokale Maschine erreicht. Ein Projekt mit deaktiviertem Studio wird abgewiesen, und die Option weist darauf hin. Es handelt sich um ein Remote-Ziel wie jedes andere, daher bleiben Tools, die Daten ändern, dort verweigert, es sei denn, `REBASE_MCP_ALLOW_REMOTE_WRITES` ist gesetzt; `rebase_project_switch` kehrt zurück.

Jedes Tool liefert eine Momentaufnahme:

- `rebase_cloud_logs` folgt Logs nie live (kein Follow-Modus). Das Ergebnis enthält `nextSinceTime`; übergeben Sie dies als `since`, um zu lesen, was danach geschah. Es gibt standardmäßig die letzten 200 Zeilen zurück, es sei denn, `tail` gibt etwas anderes an. `source: "build"` gibt stattdessen das neueste Build-Protokoll zurück.
- `rebase_cloud_deploy` verfolgt das Deployment bis zum Ende und prüft, ob die neue Version antwortet. `wait: false` kehrt zurück, sobald das Deployment ausgelöst wurde. Es stößt ein Projekt niemals aus der verwalteten Laufzeitumgebung aus, deployt niemals ein älteres Framework-Release und überspringt niemals die Build-Prüfungen: Dies sind Entscheidungen des Benutzers, und eine Verweigerung, die eine solche erfordert, weist darauf hin.
- `rebase_cloud_rollback` übergibt `--yes`. Der Tool-Aufruf gilt als Bestätigung, da kein Terminal zur Nachfrage zur Verfügung steht.

`rebase_cloud_env_set` schreibt den Wert in die Standardeingabe der CLI, sodass er niemals auf einer Befehlszeile erscheint, auf der `ps` ihn anzeigen könnte, und der Wert wird aus allen Rückgaben des Tools herausgeschnitten. Das Ergebnis gibt an, was gespeichert wurde (der Schlüssel, ob er geheim ist, ob ein erneutes Deployment aussteht), niemals den Wert. `rebase_cloud_env_list` listet ausschließlich Schlüssel auf. Eine CLI, die älter als `env set --stdin` ist, wird mit dem Hinweis abgewiesen, sie zu aktualisieren; der Wert wird nicht auf anderem Wege übertragen.

Ergebnisse werden im [untrusted-data envelope](#kennzeichnung-nicht-vertrauenswürdiger-daten) zurückgegeben, gefolgt von einer Zeile des Servers mit Hinweisen zum nächsten Schritt. Eine Verweigerung ist ein Tool-Fehler, der den Code der CLI enthält, wie z. B. `no_project`, `token_rejected`, `managed_project` oder `deploy_failed`. Wenn der Server den Code erkennt, fügt er den nächsten Schritt hinzu, gefolgt von der eigenen Meldung der CLI. Jedes Tool prüft seine Argumente gegen das von ihm angekündigte Schema, bevor ein Prozess gestartet wird, und weist nicht deklarierte Argumente zurück.

## Tool-Referenz

53 Tools in zehn Gruppen: Schema und Datenbank, Schema-Planung, Dokumente, Benutzer und Rollen, Storage, Cron, Funktionen, der Dev-Server, die Projekt-Registry und Rebase Cloud.
Jedes einzelne, mit seinen Voraussetzungen und der Information, ob das Gate es bei einem nicht-lokalen Ziel abweist, ist in der [MCP-Tool-Referenz](/docs/ai/mcp-tool-reference) aufgeführt.

## Ressourcen

Neben Tools stellt der Server MCP-Ressourcen bereit, sodass ein Client Projektkontext abrufen kann, ohne einen Tool-Aufruf zu verbrauchen:

| URI | Beschreibung |
|---|---|
| `rebase://collections/{name}` | TypeScript-Quellcode einer Collection-Definition |
| `rebase://schema` | Das generierte Drizzle-Schema (`schema.generated.ts`) |

Collections werden unter `app/config/collections/`, `config/collections/` oder `collections/` im aktiven Projektverzeichnis erkannt – je nachdem, was existiert.

`rebase://schema` wird **nur dann** aufgeführt, wenn das generierte Schema existiert. `findBackendDir` sucht nach `backend/` und anschließend nach `app/backend/` unter dem aktiven Projektverzeichnis und liest `src/schema.generated.ts` aus dem Verzeichnis, das zuerst gefunden wird – somit funktionieren sowohl das Standard-Gerüst-Layout als auch das dieses Monorepos; ein Projekt mit einer abweichenden Struktur oder eines, bei dem `rebase schema generate` noch nicht ausgeführt wurde, sieht die angebotene Ressource schlichtweg nicht.

## Der Remote-Endpunkt

Ein bereitgestelltes Backend kann MCP unter `/mcp` auch selbst für die Benutzer Ihrer Anwendung bereitstellen, wobei sich jeder als er selbst unter seiner eigenen Row-Level-Security verbindet. Dies wird auf einer eigenen Seite beschrieben:
[Der Remote-MCP-Endpunkt](/docs/ai/remote-mcp/).

## Empfohlene Konfiguration

- Richten Sie den Server auf ein **lokales** Projekt aus und belassen Sie `REBASE_MCP_ALLOW_REMOTE_WRITES` ungesetzt. Das Gate ist das wertvollste Feature im gesamten Paket.
- Registrieren Sie für alle Remote-Zwecke einen **bereichsbezogenen (scoped) `rk_`-API-Schlüssel**, anstatt der automatischen Erkennung die Übergabe eines Service-Keys zu überlassen.
- Überprüfen Sie `rebase_project_current`, wenn die Ausgabe fehlerhaft wirkt. Das aktive Projekt ist persistent (sticky) und befindet sich außerhalb Ihres Repositories.
- Behandeln Sie `~/.rebase/projects.json` wie eine Datei für vertrauliche Schlüssel (Secrets).
