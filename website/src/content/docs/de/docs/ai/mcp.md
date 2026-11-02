---
sourceHash: 59966953b83890cf
title: MCP-Server
sidebar_label: MCP-Server
description: Verbinden Sie Claude Code, Cursor, Gemini CLI oder einen beliebigen MCP-Client mit einem Rebase-Projekt – die 53 bereitgestellten Tools, die Anmeldedaten für die Authentifizierung und das Loopback-Gate, das zwischen einem Agenten und der Produktion steht.
---

`@rebasepro/mcp` ist ein [Model Context Protocol](https://modelcontextprotocol.io)-Server,
der einem KI-Assistenten echte Werkzeuge für ein Rebase-Projekt an die Hand gibt: Zeilen
lesen und schreiben, Benutzer verwalten, Migrationen ausführen, Funktionen aufrufen
und den Dev-Server steuern.

Er spricht MCP **ausschließlich über stdio**. Es gibt keinen Port und keinen Listener – der
Prozess genießt exakt dasselbe Vertrauen wie die Instanz, die ihn gestartet hat, und es
gibt keinen Remote-Aufrufer, der authentifiziert werden müsste. Das ist der sichere Teil.
Die interessanten Fragen drehen sich alle darum, was er tut, *sobald* er läuft, und diese
Seite beantwortet sie, bevor sie den Konfigurationsblock zeigt.

Ein bereitgestelltes Backend kann MCP auch selbst über HTTP für die Personen bereitstellen,
die Ihre Anwendung nutzen. Das ist ein anderes Szenario mit einem anderen Berechtigungsmodell:
siehe [Der Remote-MCP-Endpunkt](/docs/ai/remote-mcp/).

## Einen Client verbinden

Der Server wird aus Ihrem Projekt heraus ausgeführt: `@rebasepro/mcp` ist eine devDependency,
die jedes `rebase init`-Scaffold mit der CLI festlegt, und jeder unten stehende Block – die
gesamte Integration – startet genau diese Kopie (`pnpm exec rebase-mcp` oder `npx --no rebase-mcp`
in einem npm-Projekt), niemals eine neuere Version aus npm. Ein älteres Projekt fügt sie
einmalig mit `rebase skills install --mcp` oder `pnpm add -D @rebasepro/mcp` hinzu.

`rebase init` schreibt den Block für jeden Agenten, den Sie auswählen, wenn es
[Ihre KI-Coding-Agenten einrichtet](/docs/ai/skills#set-up-by-rebase-init), wobei alle
bereits in der Datei vorhandenen Server beibehalten werden. `rebase init --agent cursor,codex`
erledigt dasselbe ohne Nachfrage.

**Claude Code** – `.mcp.json` im Stammverzeichnis Ihres Projekts. `rebase init` schreibt diese
Datei für Sie:

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
sodass keine Projektdatei geschrieben werden muss. Fügen Sie den Server in den MCP-Einstellungen
als `"command": "pnpm"`, `"args": ["--dir", "/absoluter/pfad/zu/ihrem/projekt", "exec", "rebase-mcp"]`
hinzu, mit diesem Pfad als `REBASE_PROJECT_DIR`.

Jeder MCP-Client, der einen stdio-Server starten kann, funktioniert; der Aufbau ist derselbe.

### Auf welches Verzeichnis er sich auswirkt

`REBASE_PROJECT_DIR` ist das Verzeichnis, das `rebase.json` enthält. Es gibt **eine**
Rangfolge, und sie ist in jedem Client identisch:

1. **Der Umgebungsblock** – `REBASE_PROJECT_DIR`, `REBASE_BASE_URL`,
   `REBASE_API_TOKEN`. Wenn einer dieser Werte gesetzt ist, wird das `default`-Projekt
   bei jedem Start daraus neu aufgebaut.
2. **Das Arbeitsverzeichnis des Servers**, wenn es eine `rebase.json` enthält. Ein Projekt,
   in dem Sie sich aktuell befinden, hat Vorrang vor allem, was in `~/.rebase/projects.json`
   gespeichert ist.
3. **Der gespeicherte `default`-Eintrag** in `~/.rebase/projects.json`, wenn keines der
   ersten beiden Kriterien zutrifft.

Die automatische Erkennung aus `.rebase/state.json` füllt in allen drei Fällen Lücken und
überschreibt niemals einen Wert, der von einem von ihnen bereitgestellt wurde.

Die Blöcke auf Projektebene benennen das Projekt – `"."`, das Arbeitsverzeichnis des Clients
oder `${workspaceFolder}` des Editors –, da Regel 3 eine Datei liest, die von jedem Projekt
auf dem Rechner geteilt wird. Eine Konfiguration auf Benutzerebene, wie die von Windsurf,
gibt stattdessen einen absoluten Pfad an.

## Was der Server erreichen kann

Diesen Abschnitt sollten Sie lesen, bevor Sie einen Assistenten auf eine Datenbank ansetzen,
die Ihnen wichtig ist.

Der Server führt **ein einziges übergreifendes Anmeldedatum (Ambient Credential) für den
gesamten Prozess** mit sich. Es gibt keine Identität pro Tool und keinen Read-Only-Modus; jedes
Tool verwendet dasselbe Token, und der einzige Schalter im Paket schaltet zusätzlichen
Zugriff frei (*Opt-in*), anstatt ihn einzuschränken.

Welches Anmeldedatum das ist, in der Reihenfolge der Priorität:

1. `REBASE_API_TOKEN` aus der Umgebung. `REBASE_TOKEN` wird hier nicht gelesen:
   Es ist das Control-Plane-Token der CLI und wird niemals an die App gesendet (der
   Server gibt dies einmal auf stderr aus, wenn es das einzige gesetzte Token ist). Die
   Cloud-Tools übergeben es weiterhin an die CLI, die sie starten, welche es an die
   Control-Plane sendet.
2. `REBASE_SERVICE_KEY`, ausgelesen aus der `.env`-Datei des Projekts.
3. Der Service-Key, der während der Ausführung von `rebase dev` automatisch aus
   `.rebase/state.json` ermittelt wird.

2 und 3 sind der Schlüssel des Entwicklungs-Backends dieses Rechners, der nur verwendet wird,
wenn sich das Ziel auf dem Loopback-Interface befindet. Wenn `REBASE_BASE_URL` auf ein anderes
Ziel verweist – `rebase cloud init --claim` schreibt die Adresse des Cloud-Projekts und bis
zu einem erfolgreichen Deploy kein `REBASE_API_TOKEN` –, sendet der Server kein Token und
weist einmal auf stderr darauf hin.

Ein Token, das Sie für ein Projekt registrieren, **gewinnt immer gegenüber der automatischen
Erkennung**. Die Erkennung füllt lediglich Lücken.

:::danger[Der Zero-Config-Pfad verwendet ein Admin-Credential]
Die Optionen 2 und 3 verwenden den **Service-Key** – ein uneingeschränktes Admin-Secret. Das Backend
löst ihn zu `uid: "service"`, `roles: ["admin"]`, `isAdmin: true` auf. Diese
Identität besitzt jeden [Scope](/docs/backend/roles-and-scopes/) und erfüllt die
`_default_admin_read`- / `_default_admin_write`-Richtlinien, die Rebase in jede Collection
injiziert, bei der `disableDefaultPolicies` nicht gesetzt ist.

Die ehrliche Antwort auf die Frage „Wird er immer noch durch RLS eingeschränkt?“ lautet also:
RLS *wird ausgeführt* – der Treiber führt tatsächlich ein Downgrade auf die Rolle `rebase_user`
durch – und anschließend gewährt eine von Rebase selbst geschriebene Richtlinie dieser Identität
vollen Zugriff. Das Lesen jeder Zeile jeder Collection ist das **beabsichtigte Verhalten der
Standardkonfiguration**, keine Umgehung.

Mit dem Zero-Config-Setup kann ein Agent, der über diese Tools verfügt, jede Zeile jeder Collection
lesen und schreiben, alle Benutzer auflisten, jedes Passwort zurücksetzen, jede Backend-Funktion
aufrufen und DDL auf der vom Projekt aufgelösten `DATABASE_URL` ausführen.
:::

### Stattdessen ein eingeschränktes Credential zuweisen

Registrieren Sie einen berechtigungseingeschränkten [API-Schlüssel](/docs/backend/api-keys),
und das Zwei-Gate-Modell greift tatsächlich. Ein Service-Key läuft mit den Rollen `["service"]`,
die die injizierten Admin-Richtlinien **nicht** benennen – RLS gewährt ihm also nichts, es sei
denn, eine Ihrer eigenen Richtlinien besagt etwas anderes, und seine Scopes schränken ihn
weiter ein:

```bash
rebase api-keys create -n "claude-code" \
  --scopes data:read:articles \
  --expires-in 30
```

Übergeben Sie dann den resultierenden `rk_live_…`-Schlüssel an den Server, anstatt ihn einen
Service-Key erkennen zu lassen:

```json title=".mcp.json"
{
  "mcpServers": {
    "rebase": {
      "command": "pnpm",
      "args": ["exec", "rebase-mcp"],
      "env": {
        "REBASE_PROJECT_DIR": "/absoluter/pfad/zu/ihrem/projekt",
        "REBASE_API_TOKEN": "rk_live_..."
      }
    }
  }
}
```

Zwei Dinge, die dies **nicht** tut und die man wissen sollte, bevor man sich darauf verlässt:

- **Es schränkt die CLI-Tools nicht ein.** `rebase_db_push`, `rebase_db_migrate`,
  `rebase_doctor` und die Branch-Tools starten die Rebase-CLI, die sich über `DATABASE_URL`
  verbindet und Ihr Token überhaupt nicht sieht. Das unten beschriebene Loopback-Gate ist
  das Einzige, was davor steht.
- **Ein Schlüssel erreicht ein Admin-Tool nur mit dem entsprechenden Scope dieses Tools.**
  `list_users` und `list_roles` erfordern `users:read`; `create_user`, `update_user`,
  `delete_user` und `rebase_auth_reset_password` erfordern `users:write`; die Storage- und
  Cron-Tools erfordern den passenden `storage:*`- oder `cron:*`-Scope; `invoke_function`
  erfordert `functions:invoke`. Ohne diesen Scope antwortet der Aufruf mit `403 SCOPE_MISSING`.
  Selbst mit `users:write` kann ein Schlüssel das Konto eines Administrators nicht ändern:
  Ein Administrator besitzt `keys:read` und `keys:write`, was kein Schlüssel besitzen kann,
  und niemand darf ein Konto verwalten, das über mehr Rechte verfügt als man selbst.

Ein mit `--roles admin` erstellter Schlüssel ist eine andere Sache: Er trägt die Rollen
`["service", "admin"]`, was dieselben Standard-Admin-Richtlinien freischaltet wie der
Service-Key. Weist man ihm zusätzlich `--full-access` zu, entspricht seine Reichweite der
des Service-Keys, abzüglich der Schlüsselverwaltung. Sein Vorteil ist, dass er **pro Schlüssel
widerrufbar, ablauffähig und ratenlimitiert** ist, was auf den Service-Key alles nicht zutrifft –
dessen Rotation erfordert das Bearbeiten von `.env` und den Neustart des Servers.

Siehe [Agenten und MCP-Server](/docs/backend/api-keys#agents-and-mcp-servers) für die
vollständige Anleitung zum Scoping von Schlüsseln.

### Eine Collection komplett unerreichbar machen

Der Grund, warum ein Admin-Credential alles lesen kann, ist die Basisrichtlinie, die Rebase in
jede Collection injiziert und die dem vertrauenswürdigen Serverkontext sowie der Rolle `admin`
Zugriff gewährt. Eine Collection kann diese Baseline deaktivieren und die volle Verantwortung
für ihr eigenes RLS übernehmen:

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
    // Die injizierte Admin-/Server-Baseline entfernen — nichts ist lesbar,
    // außer dem, was die nachfolgenden Regeln erlauben.
    disableDefaultPolicies: true,
    securityRules: [
        { operations: ["select", "update"], ownerField: "patient_id" }
    ]
});
```

Jetzt besteht die einzige Zugriffsmöglichkeit darin, mit `patient_id` übereinzustimmen. Die
UID des Service-Keys ist die literale Zeichenkette `service`, sodass eine Owner-Regel niemals
auf ihn zutrifft – Lesevorgänge geben null Zeilen zurück und Schreibvorgänge werden von
Postgres abgewiesen. Dies ist die einzige Kontrolle, die das Standard-Credential des
MCP-Servers einschränkt, anstatt es als gegeben vorauszusetzen.

Denken Sie daran, dass dies eine echte RLS-Änderung ist und keine bloße Dokumentation: Sie wird
erst wirksam, wenn `rebase schema generate` und eine Migration die Richtlinien angewendet haben.
Siehe [Sicherheitsregeln (RLS)](/docs/collections/security-rules).

## Das Loopback-Gate

`rebase_project_add` akzeptiert jede `baseUrl`, und die CLI-Tools verbinden sich mit jeder
vom Projekt deklarierten `DATABASE_URL`. Dieselbe Tool-Liste, die eine Scratch-Datenbank auf
Ihrem Laptop bearbeitet, kann daher Zeilen in der Produktion löschen – ohne dass etwas
dazwischensteht, außer dem Urteilsvermögen des Assistenten darüber, welches Projekt aktiv ist.

**Jedes Tool, das die Zielumgebung verändert, wird verweigert, es sei denn, dieses Ziel
befindet sich auf der Loopback-Schnittstelle.** Das Gate ist als Liste der Aktionen definiert,
die *nicht* reglementiert sind, sodass ein später hinzugefügtes Tool standardmäßig geschützt ist.

- **Nicht reglementiert – Lesevorgänge:** `rebase_schema_plan`, `rebase_doctor`,
  `rebase_db_branch_list`, `rebase_db_branch_info`, `rebase_db_branch_diff`, `list_documents`,
  `get_document`, `list_users`, `list_roles`, `storage_list_objects`,
  `storage_get_download_url`, `cron_list_jobs`, `cron_get_job`, `cron_get_job_logs`,
  `rebase_dev_logs` sowie die Rebase-Cloud-Leseoperationen `rebase_cloud_status`,
  `rebase_cloud_logs`, `rebase_cloud_env_list`, `rebase_cloud_deployments_list`.
- **Nicht reglementiert – Rebase-Cloud-Schreibvorgänge:** `rebase_cloud_provision`,
  `rebase_cloud_deploy`, `rebase_cloud_env_set`, `rebase_cloud_rollback`.
  Das Bereitstellen (Provisioning) erstellt ein Projekt; die anderen verändern ein
  Produktionsprojekt. Keines davon läuft über `baseUrl` oder `DATABASE_URL`, was alles ist,
  was das Gate prüfen kann. Siehe [Rebase Cloud](#rebase-cloud) bezüglich der Schutzmechanismen davor.
- **Nicht reglementiert – nur lokal:** `rebase_schema_introspect`, `rebase_db_branch_switch`,
  `rebase_schema_generate`, `rebase_db_generate`, `rebase_generate_sdk`, die Dev-Server-Tools
  und die Projekt-Registry-Tools. Diese schreiben lokale Dateien oder lokalen Status und haben
  kein Remote-Ziel zu prüfen.
- **Reglementiert gegenüber `DATABASE_URL`:** die verbleibenden CLI-Tools – `rebase_db_push`,
  `rebase_db_migrate`, `rebase_db_branch_create`, `rebase_db_branch_delete`.
- **Reglementiert gegenüber der Projekt-`baseUrl`:** die verbleibenden SDK-Tools –
  `create_document`, `update_document`, `delete_document`, `create_user`,
  `update_user`, `delete_user`, `rebase_auth_reset_password`,
  `storage_delete_object`, `cron_trigger_job`, `cron_toggle_job`
  und `invoke_function`.

Die beiden Ziele sind nicht austauschbar. CLI-Tools sehen `baseUrl` niemals; daher wird ein
Localhost-Backend, das neben einer produktiven `DATABASE_URL` läuft, gegen die Datenbank
geprüft, nicht gegen das Backend.

Eine Verweigerung sieht folgendermaßen aus:

```text
Error: Refusing to run "delete_document": project "default" points at
https://api.example.com/, which is not local. Set REBASE_MCP_ALLOW_REMOTE_WRITES=true
to allow destructive tools against remote environments.
```

**Wenn überhaupt kein Verbindungs-String aufgelöst werden kann, werden die reglementierten DB-Tools verweigert.**
Ohne `DATABASE_URL` verwendet die CLI die verwaltete Entwicklungsdatenbank, was der Standard
für ein neues Projekt ist, und das Gate verweigert dort seine vier Datenbank-Tools. Die
Verweigerung erklärt den Grund und nennt funktionierende Alternativen. Sie schlägt die
Deaktivierung nicht vor:

```text
Error: Refusing to run "rebase_db_push": project "default" sets no DATABASE_URL, so the
CLI would use the managed development database (PGlite, started by `rebase dev`). You
most likely do not need this tool: the dev server applies the collections to that
database at boot, additively. After changing a collection, restart it with
rebase_dev_stop and rebase_dev_start. …
```

Über ein Terminal werden `rebase db push` und `rebase db migrate` auf dieser Datenbank ausgeführt;
lediglich die MCP-Tools werden verweigert. Ab Version 0.24 verweigert die CLI sie dort ebenfalls.

Nur Loopback gilt als lokal: `localhost`, `*.localhost`, `127.0.0.0/8`, `::1`
(und `0.0.0.0`).
Private IP-Bereiche wie `10.x` und `192.168.x` zählen **nicht** dazu – diese stellen mit
gleicher Wahrscheinlichkeit ein geteiltes Staging-Cluster wie einen Laptop dar, und sie als
lokal zu behandeln, würde genau die Unfälle durchwinken, für deren Verhinderung das Gate existiert.

Setzen Sie `REBASE_MCP_ALLOW_REMOTE_WRITES=true`, um das Gate zu deaktivieren. Wenn Sie dies
global in Ihrer MCP-Client-Konfiguration festlegen, wird das Gate für jedes Projekt entfernt,
das der Server erreichen kann – nicht nur für dasjenige, an das Sie gerade gedacht haben.

## Kennzeichnung nicht vertrauenswürdiger Daten

Zeilen, Benutzerdatensätze, Storage-Listen, Cron-Jobs, Funktionsantworten und CLI-Ausgaben
werden in einem expliziten Umschlag zurückgegeben:

```text
<<<UNTRUSTED_DATA source="list_documents" id="9b2f4c1e-…">>>
[ … rows … ]
<<<END_UNTRUSTED_DATA id="9b2f4c1e-…">>>
```

Alles, was in Ihrer Datenbank gespeichert ist, wurde von irgendjemandem geschrieben und trifft
über denselben Kanal ein wie der Tool-Vertrag, dem der Assistent folgt. Der Umschlag weist
das Modell an, den Inhalt als inerte Daten und nicht als Anweisungen zu behandeln.

Die `id` wird für jede Antwort neu generiert, nachdem die Daten geschrieben wurden, und nur
der End-Marker, der diese ID trägt, schließt den Block. Text innerhalb der Daten, der wie ein
Marker aufgebaut ist, wird durch ein Nullbreite-Leerzeichen unterbrochen, sodass eine Zeile, die
`<<<END_UNTRUSTED_DATA>>>` ausgibt, den Umschlag nicht vorzeitig beenden und nachfolgende
Inhalte nach außen verlagern kann.

Der [Remote-Endpunkt](/docs/ai/remote-mcp/) schirmt seine Tool-Ergebnisse auf die gleiche Weise
ab und teilt dies dem Client mit; sein `structuredContent` enthält das reine Ergebnis.
`list_collections` und `describe_collection` bilden die Ausnahme: Nur ein Modell liest sie,
daher werden sie einmalig im Text gesendet. Vor 0.24 enthielt die Auflistung auch eine
Kopie im `structuredContent`.

Es handelt sich um eine Kennzeichnung, nicht um eine Sandbox. Ein Assistent mit Zugriff auf
diese Tools ist nur so sicher wie der Inhalt, den Sie ihn lesen lassen.

## Mehrere Projekte

Projektkonfigurationen werden in `~/.rebase/projects.json` gespeichert, und der Server kann
mehrere gleichzeitig verwalten – nützlich, wenn Sie zwischen lokalen und Remote-Umgebungen
wechseln. Während `rebase dev` läuft, liest der Server den aktiven Port und den Service-Key
aus `.rebase/state.json` im Projektverzeichnis, was den lokalen Fall konfigurationsfrei macht.

:::note[Die Registry ist das letzte Wort, nicht das erste]
Die Rangfolge entspricht der oben beschriebenen: Umgebungsblock, dann das Arbeitsverzeichnis,
wenn es eine `rebase.json` enthält, und schließlich der gespeicherte `default`-Eintrag.

`REBASE_PROJECT_DIR`, `REBASE_BASE_URL` und `REBASE_API_TOKEN` bauen das `default`-Projekt
**bei jedem Start** neu auf, nicht nur beim ersten Mal. Dieser Neuaufbau betrifft den gesamten
Eintrag: Ein für das alte `projectDir` registriertes Token wird verworfen, anstatt in ein
Verzeichnis übernommen zu werden, für das es nie ausgestellt wurde. Ein auf diese Weise – oder
aus dem Arbeitsverzeichnis – abgeleiteter `default`-Eintrag wird niemals nach
`~/.rebase/projects.json` zurückgeschrieben, sodass der Entwicklungs-Service-Key eines Projekts
nicht zu dem eines anderen werden kann.

`activeProject` ist persistent („sticky“). Wenn also eine frühere Sitzung `rebase_project_switch`
aufgerufen hat, zielen Tools auf dieses Projekt ab und der Server gibt dies auf stderr aus – es sei
denn, dieses Projekt ist unter einem *anderen* Verzeichnis registriert als dem, in dem dieser
Server läuft; in diesem Fall fällt er auf `default` zurück und meldet dies. Wenn ein Assistent
die falsche Datenbank zu lesen scheint, rufen Sie zuerst `rebase_project_current` auf.
:::

Token werden in dieser Registry **im Klartext** gespeichert. Es handelt sich um eine Datei in
Ihrem Home-Verzeichnis, die Admin-Credentials für jedes von Ihnen registrierte Projekt enthält;
behandeln Sie sie entsprechend sorgfältig.

## Rebase Cloud

Acht Tools bringen eine App aus diesem Verzeichnis auf ein Live-Backend in
[Rebase Cloud](/docs/deployment/cloud/) und halten sie am Laufen. Jedes davon startet
`rebase cloud <command> --json` im aktiven Projektverzeichnis: derselbe Befehl, den auch
ein Mensch ausführt, sodass es keine abweichende Zweitimplementierung gibt.

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

Der typische Agenten-Workflow lautet: `rebase_cloud_provision`, dann dem Benutzer die Claim-URL
übergeben; `rebase_cloud_status`, um das Projekt zu prüfen (solange es nicht beansprucht wurde,
enthält `unclaimed` die Claim-URL und den Zeitpunkt der Löschung); `rebase_cloud_deploy`
nach einer Änderung; `rebase_cloud_logs`, wenn etwas fehlschlägt; und `rebase_cloud_rollback`,
wenn die Produktion beschädigt ist.

**Worauf sie wirken.** Auf das Projekt, mit dem das aktive Verzeichnis in `.rebase/cloud.json`
verknüpft ist. Keines von ihnen akzeptiert eine Projekt-ID oder ein Verzeichnis, sodass ein
Assistent sie nicht auf ein anderes Projekt ausrichten kann als das, mit dem das Verzeichnis
verknüpft ist. Das Wechseln des aktiven Projekts mit `rebase_project_switch` wechselt das
Verzeichnis, in dem sie ausgeführt werden.

**Wessen Berechtigung.** Was auch immer die CLI in diesem Verzeichnis auflöst: `REBASE_TOKEN`,
sofern gesetzt, dann das Token, das `rebase cloud init --claim` für ein nicht beanspruchtes
Projekt gespeichert hat, und schließlich die `rebase cloud login`-Sitzung. Im Verzeichnis dieses
nicht beanspruchten Projekts wird ein `REBASE_TOKEN`, das keinen Scope für das Projekt besitzt,
zugunsten des projekteigenen Tokens zurückgestellt. Die Control-Plane prüft jeden Aufruf wie
den der CLI; mit einem über `rebase cloud tokens create --can logs` erstellten Token kann ein
Assistent also Protokolle lesen, während die Control-Plane seine Deployments, Variablen und
Rollbacks verweigert. Fehlende oder abgelehnte Anmeldedaten werden als Fehler zurückgegeben, der
erklärt, was der Benutzer tun muss (`rebase cloud login` oder das Beanspruchen des Projekts).

**Warum das Loopback-Gate nicht greift.** Das Gate prüft die `baseUrl` der App und die
`DATABASE_URL` der CLI; diese Tools verwenden keines von beiden. Nach `rebase_cloud_provision`
zeigt `REBASE_BASE_URL` auf das neue Cloud-Projekt. Eine Reglementierung darüber würde genau
das Deployment verweigern, das für den Workflow benötigt wird. Die Bereitstellung selbst
erstellt lediglich etwas: Sie berührt weder bestehende Apps noch Datenbanken, und die CLI
verweigert sie ohnehin in einem Verzeichnis, das bereits verknüpft ist. Ein Deploy, eine
Variable und ein Rollback ändern jeweils die Produktion. Was vor ihnen schützt, sind die oben
genannten Anmeldedaten und die Tool-Genehmigung Ihres MCP-Clients. Um einen Assistenten daran
zu hindern, ein Cloud-Projekt zu ändern, setzen Sie `REBASE_TOKEN` in der Serverumgebung auf
ein Token ohne die Fähigkeiten `deploy` und `env`.

**Lesen beliebiger eigener Projekte.** Die oben genannten Tools wirken auf das verknüpfte
Projekt. Um die Daten eines anderen Projekts zu lesen – jedes Projekt in jeder Organisation,
zu der das angemeldete Konto gehört, unabhängig davon, ob es hier verknüpft ist oder nicht –,
listet `rebase_cloud_projects_list` diese auf, und `rebase_project_use_cloud` (mit ID, Slug
oder Name) richtet die Daten- und Admin-Tools darauf aus: `list_documents`, `get_document`,
`list_users`, `list_roles`, `cron_list_jobs`, `storage_list_objects`. Diese Aufrufe laufen über
den Studio-Proxy der Konsole unter Verwendung der CLI-eigenen Anmeldedaten (`rebase cloud access-token`,
das pro Aufruf gelesen und nie gespeichert wird); die Control-Plane prüft die Zugriffsberechtigung
der Person und hängt den Service-Key des Projekts auf ihrer Seite an, sodass kein Schlüssel
den Rechner erreicht. Ein Projekt mit deaktiviertem Studio wird abgewiesen, und die Option weist
darauf hin. Es ist ein Remote-Ziel wie jedes andere, sodass Tools zur Datenänderung dort verweigert
bleiben, es sei denn, `REBASE_MCP_ALLOW_REMOTE_WRITES` ist gesetzt; `rebase_project_switch`
kehrt zurück.

Jedes Tool liefert eine Momentaufnahme:

- `rebase_cloud_logs` folgt Ausgaben nie fortlaufend. Das Ergebnis enthält `nextSinceTime`;
  übergeben Sie diesen Wert als `since`, um nachfolgende Einträge zu lesen. Es gibt standardmäßig
  die letzten 200 Zeilen zurück, sofern `tail` nichts anderes angibt. `source: "build"` gibt
  stattdessen das neueste Build-Protokoll zurück.
- `rebase_cloud_deploy` verfolgt das Deployment bis zum Ende und prüft, ob die neue Version
  antwortet. `wait: false` kehrt zurück, sobald das Deployment ausgelöst wurde. Es stößt ein
  Projekt niemals eigenmächtig aus der verwalteten Runtime aus, deployt keine ältere
  Framework-Version und überspringt keine Build-Checks: Dies sind Entscheidungen des Benutzers,
  und eine Verweigerung, die eine solche erfordert, weist darauf hin.
- `rebase_cloud_rollback` übergibt `--yes`. Der Tool-Aufruf gilt als Bestätigung, da kein
  Terminal für Rückfragen zur Verfügung steht.

`rebase_cloud_env_set` schreibt den Wert in die Standardeingabe der CLI, sodass er niemals auf
einer Befehlszeile erscheint, auf der `ps` ihn anzeigen könnte, und der Wert wird aus allen
Rückgaben des Tools herausgefiltert. Sein Ergebnis gibt an, was gespeichert wurde (der Schlüssel,
ob er geheim ist, ob ein erneutes Deployment aussteht), niemals den Wert selbst.
`rebase_cloud_env_list` listet ausschließlich Schlüssel auf. Eine CLI, die älter als
`env set --stdin` ist, wird mit dem Hinweis abgelehnt, sie zu aktualisieren; der Wert wird
nicht über einen anderen Weg übermittelt.

Die Ergebnisse werden im [Umschlag für nicht vertrauenswürdige Daten](#kennzeichnung-nicht-vertrauenswürdiger-daten)
zurückgegeben, gefolgt von einer Zeile des Servers mit Hinweisen zum nächsten Schritt. Eine
Ablehnung ist ein Tool-Fehler, der den Code der CLI enthält, wie `no_project`,
`token_rejected`, `managed_project` oder `deploy_failed`. Erkennt der Server den Code,
fügt er den nächsten Schritt und anschließend die Meldung der CLI selbst hinzu. Jedes Tool
prüft seine Argumente gegen das von ihm deklarierte Schema, bevor ein Prozess gestartet wird,
und weist nicht deklarierte Argumente ab.

## Tool-Referenz

53 Tools in zehn Gruppen: Schema und Datenbank, Schema-Planung, Dokumente, Benutzer
und Rollen, Storage, Cron, Funktionen, der Dev-Server, die Projekt-Registry und
Rebase Cloud.
Jedes einzelne, inklusive seiner Anforderungen und der Information, ob das Gate es bei
einem nicht-lokalen Ziel verweigert, finden Sie in der [MCP-Tool-Referenz](/docs/ai/mcp-tool-reference).

## Ressourcen

Neben Tools stellt der Server auch MCP-Ressourcen bereit, sodass ein Client Kontext über das
Projekt abrufen kann, ohne einen Tool-Aufruf zu verbrauchen:

| URI | Beschreibung |
|---|---|
| `rebase://collections/{name}` | TypeScript-Quellcode einer Collection-Definition |
| `rebase://schema` | Das generierte Drizzle-Schema (`schema.generated.ts`) |

Collections werden unter `app/config/collections/`, `config/collections/` oder
`collections/` im aktiven Projektverzeichnis erkannt – je nachdem, welches existiert.

`rebase://schema` wird **nur dann** aufgeführt, wenn das generierte Schema existiert.
`findBackendDir` sucht nach `backend/` und danach nach `app/backend/` unterhalb des aktiven
Projektverzeichnisses und liest `src/schema.generated.ts` aus dem Verzeichnis, das es findet –
sodass sowohl das Scaffold-Layout als auch das dieses Monorepos funktionieren. Ein Projekt
mit einer abweichenden Struktur oder eines, bei dem `rebase schema generate` noch nicht
ausgeführt wurde, bekommt die Ressource schlicht nicht angeboten.

## Der Remote-Endpunkt

Ein bereitgestelltes Backend kann MCP auch selbst unter `/mcp` für die Personen bereitstellen,
die Ihre Anwendung nutzen – wobei sich jede Person als sie selbst unter ihrer eigenen
Row-Level Security verbindet. Dies wird auf einer eigenen Seite beschrieben:
[Der Remote-MCP-Endpunkt](/docs/ai/remote-mcp/).

## Empfohlene Konfiguration

- Richten Sie den Server auf ein **lokales** Projekt aus und lassen Sie
  `REBASE_MCP_ALLOW_REMOTE_WRITES` ungesetzt. Das Gate ist das wertvollste Sicherheitsfeature
  des Pakets.
- Registrieren Sie für alle Remote-Umgebungen einen **eingeschränkten `rk_`-API-Schlüssel**,
  anstatt die Erkennung einen Service-Key übergeben zu lassen.
- Prüfen Sie `rebase_project_current`, wenn eine Ausgabe unerwartet erscheint. Das aktive Projekt
  ist persistent („sticky“) und liegt außerhalb Ihres Repositories.
- Behandeln Sie `~/.rebase/projects.json` wie eine Datei für vertrauliche Zugangsdaten (Secrets).
