---
sourceHash: e0ed23817228dbd2
title: MCP-Server
sidebar_label: MCP-Server
description: Verbinden Sie Claude Code, Cursor, Gemini CLI oder beliebige MCP-Clients mit einem Rebase-Projekt – die 53 bereitgestellten Tools, die verwendeten Anmeldedaten und das Loopback-Gate, das zwischen einem Agenten und der Produktionsumgebung steht.
---

`@rebasepro/mcp` ist ein [Model Context Protocol](https://modelcontextprotocol.io)-Server,
der einem KI-Assistenten echte Werkzeuge für ein Rebase-Projekt zur Verfügung stellt: Zeilen
lesen und schreiben, Benutzer verwalten, Migrationen ausführen, Funktionen aufrufen, den Dev-Server
steuern.

Er kommuniziert via MCP **ausschließlich über stdio**. Es gibt keinen Port und keinen Listener –
der Prozess besitzt genau denselben Vertrauensstatus wie derjenige, der ihn gestartet hat, und es
gibt keinen Remote-Aufrufer zu authentifizieren. Das ist der sichere Teil. Die interessanten Fragen
drehen sich alle darum, was er tut, *sobald* er läuft, und diese Seite beantwortet sie, bevor sie
den Konfigurationsblock zeigt.

Ein bereitgestelltes Backend kann MCP auch selbst über HTTP für die Personen bereitstellen, die
Ihre Anwendung nutzen. Das ist ein anderes Szenario mit einem anderen Berechtigungsmodell:
siehe [Der Remote-MCP-Endpunkt](/docs/ai/remote-mcp/).

:::tip[Nutzen Sie Claude im Web, auf dem Desktop oder mobil?]
Fügen Sie stattdessen den [Rebase-Connector](/docs/ai/rebase-connector/) hinzu:
`https://app.rebase.pro/mcp`, einmalig, für jedes Projekt, das Sie auf Rebase Cloud
oder Ihren eigenen Servern betreiben. Diese Seite beschreibt den lokalen Server, den ein
Coding-Assistent innerhalb eines Projekts startet.
:::

## Verbinden eines Clients

Der Server läuft aus Ihrem Projekt heraus: `@rebasepro/mcp` ist eine devDependency, die jedes
`rebase init`-Gerüst fest mit der CLI verknüpft, und jeder nachfolgende Block – die gesamte
Integration – startet genau diese Kopie (`pnpm exec rebase-mcp` oder `npx --no rebase-mcp`
in einem npm-Projekt), niemals eine neuere Version von npm. Ein älteres Projekt fügt sie einmalig
mit `rebase skills install --mcp` oder `pnpm add -D @rebasepro/mcp` hinzu.

`rebase init` schreibt den Block für jeden Agenten, den Sie auswählen, wenn es
[Ihre KI-Coding-Agenten einrichtet](/docs/ai/skills#set-up-by-rebase-init), wobei alle
bereits in der Datei vorhandenen Server erhalten bleiben. `rebase init --agent cursor,codex`
erledigt dasselbe ohne Nachfrage.

**Claude Code** – `.mcp.json` in Ihrem Projekt-Root. `rebase init` schreibt diese
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

**Cursor** – die gleiche Struktur, in `.cursor/mcp.json`. Cursor expandiert
`${workspaceFolder}` zum Projekt-Root:

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

**Windsurf** liest MCP-Server nur aus seiner Konfiguration auf Benutzerebene, daher gibt es
keine Projektdatei zu schreiben. Fügen Sie den Server in den MCP-Einstellungen als `"command": "pnpm"`,
`"args": ["--dir", "/absolute/path/to/your/project", "exec", "rebase-mcp"]` hinzu, mit diesem Pfad als `REBASE_PROJECT_DIR`.

Jeder MCP-Client, der einen stdio-Server starten kann, funktioniert; das Schema ist stets dasselbe.

### Auf welches Verzeichnis er wirkt

`REBASE_PROJECT_DIR` ist das Verzeichnis, das die Datei `rebase.json` enthält. Es gibt **eine**
Rangfolge, und sie ist in jedem Client identisch:

1. **Der Umgebungsblock** – `REBASE_PROJECT_DIR`, `REBASE_BASE_URL`,
   `REBASE_API_TOKEN`. Wenn einer von ihnen gesetzt ist, wird das `default`-Projekt
   bei jedem Start daraus neu erstellt.
2. **Das Arbeitsverzeichnis des Servers**, sofern es eine `rebase.json` enthält. Ein Projekt,
   in dem Sie sich aktuell befinden, hat Vorrang vor allem, was in `~/.rebase/projects.json` gespeichert ist.
3. **Der persistierte `default`** in `~/.rebase/projects.json`, wenn keines der
   ersten beiden eine Angabe macht.

Die automatische Erkennung aus `.rebase/state.json` füllt in allen drei Fällen Lücken und
überschreibt niemals einen Wert, der von einem der vorgenannten bereitgestellt wurde.

Die Blöcke auf Projektebene benennen das Projekt – `"."`, das Arbeitsverzeichnis des Clients
oder das `${workspaceFolder}` des Editors –, da Regel 3 eine Datei liest, die von jedem Projekt
auf dem Rechner geteilt wird. Eine Konfiguration auf Benutzerebene, wie etwa bei Windsurf,
gibt stattdessen einen absoluten Pfad an.

## Worauf der Server zugreifen kann

Diesen Abschnitt sollten Sie lesen, bevor Sie einen Assistenten auf eine Datenbank ansetzen,
die Ihnen wichtig ist.

Der Server verfügt über **einen einzigen Anmeldedatensatz für den gesamten Prozess**. Es gibt keine
Identität pro Tool und keinen Read-Only-Modus; jedes Tool verwendet denselben Token, und der
einzige Schalter im Paket schaltet zusätzlichen Zugriff *frei*, anstatt ihn einzuschränken.

Welcher Anmeldedatensatz das ist, in der Reihenfolge der Priorität:

1. `REBASE_API_TOKEN` aus der Umgebung. `REBASE_TOKEN` wird hier nicht gelesen:
   Es ist das Control-Plane-Token der CLI und wird niemals an die App gesendet (der
   Server meldet dies einmal auf stderr, wenn es das einzige gesetzte Token ist). Die Cloud-Tools
   übergeben es weiterhin an die von ihnen gestartete CLI, welche es an die Control Plane sendet.
2. `REBASE_SERVICE_KEY`, ausgelesen aus der `.env`-Datei des Projekts.
3. Der Service-Key, der aus `.rebase/state.json` automatisch erkannt wird, während `rebase dev`
   läuft.

2 und 3 sind der Schlüssel des Dev-Backends dieses Rechners, der nur verwendet wird, wenn das Ziel
auf dem Loopback liegt. Wenn `REBASE_BASE_URL` woanders hinzeigt – `rebase cloud init --claim`
schreibt die Adresse des Cloud-Projekts und kein `REBASE_API_TOKEN`, bis ein Deploy
erfolgreich ist –, sendet der Server kein Token und meldet dies einmalig auf stderr.

Ein Token, das Sie für ein Projekt registrieren, **gewinnt gegenüber der automatischen Erkennung**.
Die Erkennung füllt lediglich Lücken.

:::danger[Der Zero-Config-Pfad ist eine Admin-Berechtigung]
Die Optionen 2 und 3 entsprechen dem **Service-Key** – einem unbeschränkten Admin-Secret. Das Backend
löst ihn zu `uid: "service"`, `roles: ["admin"]`, `isAdmin: true` auf. Diese
Identität besitzt jeden [Scope](/docs/backend/roles-and-scopes/) und erfüllt die
`_default_admin_read`- / `_default_admin_write`-Richtlinien, die Rebase in
jede Tabelle einfügt, die nicht `defaultPolicies: false` gesetzt hat.

Die ehrliche Antwort auf die Frage „Schränkt RLS dies noch ein?“ lautet also: RLS *wird ausgeführt* – der
Treiber wechselt zwar auf die Rolle `rebase_user` herunter –, aber anschließend gewährt eine von Rebase
selbst verfasste Policy dieser Identität alles. Das Lesen jeder Zeile jeder
Tabelle ist das **beabsichtigte Verhalten der Standardkonfiguration**, keine
Umgehung.

Mit dem Zero-Config-Setup kann ein Agent, der diese Tools hält, jede Zeile jeder Tabelle
lesen und schreiben, jeden Benutzer auflisten, jedes Passwort zurücksetzen, jede Backend-Funktion
aufrufen und DDL-Operationen gegen die von dem Projekt aufgelöste `DATABASE_URL` ausführen.
:::

### Stattdessen eingeschränkte Anmeldedaten vergeben

Registrieren Sie einen berechtigungseingeschränkten [API-Key](/docs/backend/api-keys), und das
Zwei-Schranken-Modell greift tatsächlich. Ein Service-Key läuft mit den Rollen `["service"]`, die von den
injizierten Admin-Policies **nicht** benannt werden – RLS gewährt ihm also nichts, es sei denn, eine
Ihrer eigenen Policies legt etwas anderes fest, und seine Scopes schränken ihn weiter ein:

```bash
rebase api-keys create -n "claude-code" \
  --scopes data:read:articles \
  --expires-in 30
```

Übergeben Sie den resultierenden `rk_live_…`-Schlüssel an den Server, anstatt ihn
einen Service-Key automatisch erkennen zu lassen:

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

Zwei Dinge, die dies **nicht** tut und die man kennen sollte, bevor man sich darauf verlässt:

- **Es schränkt die CLI-Tools nicht ein.** `rebase_db_push`, `rebase_db_migrate`,
  `rebase_doctor` und die Branch-Tools starten die Rebase CLI, welche sich mit
  `DATABASE_URL` verbindet und Ihr Token überhaupt nicht zu Gesicht bekommt. Das unten beschriebene
  Loopback-Gate ist die einzige Schranke vor diesen Tools.
- **Ein Schlüssel erreicht ein Admin-Tool nur mit dem entsprechenden Scope des Tools.** `list_users` und
  `list_roles` benötigen `users:read`; `create_user`, `update_user`, `delete_user` und
  `rebase_auth_reset_password` benötigen `users:write`; die Storage- und Cron-Tools
  benötigen den passenden Scope `storage:*` bzw. `cron:*`; `invoke_function` benötigt
  `functions:invoke`. Ohne
  diesen antwortet der Aufruf mit `403 SCOPE_MISSING`. Selbst mit `users:write` kann ein Schlüssel das
  Konto eines Admins nicht ändern: Ein Admin besitzt `keys:read` und `keys:write`, was kein
  Schlüssel besitzen kann, und niemand darf ein Konto verwalten, das über mehr Rechte verfügt als man selbst.

Ein mit `--roles admin` erstellter Schlüssel ist ein anderer Fall: Er trägt die Rollen
`["service", "admin"]`, was dieselben standardmäßigen Admin-Policies erfüllt wie der Service-Key.
Gibt man ihm zusätzlich `--full-access`, entspricht seine Reichweite der des Service-Keys,
abzüglich der Schlüsselverwaltung. Sein Vorteil ist, dass er **pro Schlüssel widerrufbar, ablauffähig und
ratenbegrenzt** ist, was auf den Service-Key nicht zutrifft – diesen zu rotieren bedeutet,
die `.env` zu bearbeiten und den Server neu zu starten.

Siehe [Agenten und MCP-Server](/docs/backend/api-keys#agents-and-mcp-servers) für die
vollständige Anleitung zum Scoping von Schlüsseln.

### Eine Tabelle gänzlich unzugänglich machen

Der Grund, warum eine Admin-Berechtigung alles lesen kann, ist die Basis-Policy, die Rebase
in jede Tabelle injiziert und die dem vertrauenswürdigen Serverkontext und der
`admin`-Rolle Zugriff gewährt. Eine Tabelle kann diese Basis-Policy abwählen und die volle
Verantwortung für ihr eigenes RLS übernehmen:

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const medicalRecords = defineTable("medical_records", {
    columns: {
        id:        col.uuid().primaryKey().defaultRandom(),
        patientId: col.text(),
        notes:     col.text(),
    },
    // Entfernt die injizierte Admin-/Server-Basis – nichts ist lesbar,
    // außer das, was die folgenden Regeln erlauben.
    defaultPolicies: false,
    rls: [
        { operations: ["select", "update"], ownerField: "patientId" },
    ],
});
```

Jetzt ist der einzige Zugang ein Treffer auf `patientId`. Die UID des Service-Keys ist der
Literal-String `service`, weshalb eine Owner-Regel niemals darauf zutrifft – Lesezugriffe liefern null
Zeilen und Schreibzugriffe werden von Postgres abgewiesen. Dies ist die eine Kontrollmöglichkeit, die
die Standardberechtigung des MCP-Servers einschränkt, anstatt sie einfach vorauszusetzen.

Beachten Sie, dass dies eine echte RLS-Änderung ist, keine rein dokumentarische: Sie wird
erst wirksam, nachdem `rebase schema generate` und eine Migration die Policies angewendet haben. Siehe
[Row-Level Security](/docs/collections/security-rules).

## Das Loopback-Gate

`rebase_project_add` akzeptiert jede beliebige `baseUrl`, und die CLI-Tools verbinden sich mit
der `DATABASE_URL`, die das Projekt deklariert. Dieselbe Tool-Liste, die eine Scratch-Datenbank
auf Ihrem Laptop bearbeitet, kann daher Zeilen in der Produktion löschen – ohne dass etwas dazwischen
stünde außer dem Urteilsvermögen des Assistenten darüber, welches Projekt aktiv ist.

**Jedes Tool, das die Zielumgebung verändert, wird verweigert, es sei denn, dieses Ziel befindet sich
auf dem Loopback-Interface.** Das Gate ist als Liste derjenigen Tools definiert, die *nicht*
beschränkt sind, sodass ein später hinzugefügtes Tool standardmäßig geschützt ist.

- **Nicht beschränkt – Lesevorgänge:** `rebase_schema_plan`, `rebase_doctor`,
  `rebase_db_branch_list`, `rebase_db_branch_info`, `rebase_db_branch_diff`, `query_table`,
  `get_row`, `list_users`, `list_roles`, `storage_list_objects`,
  `storage_get_download_url`, `cron_list_jobs`, `cron_get_job`, `cron_get_job_logs`,
  `rebase_dev_logs` sowie die Lese-Tools für Rebase Cloud: `rebase_cloud_status`,
  `rebase_cloud_logs`, `rebase_cloud_env_list`, `rebase_cloud_deployments_list`.
- **Nicht beschränkt – Rebase Cloud Schreibvorgänge:** `rebase_cloud_provision`,
  `rebase_cloud_deploy`, `rebase_cloud_env_set`, `rebase_cloud_rollback`.
  Das Provisioning erstellt ein Projekt; die anderen verändern ein Produktionsprojekt. Keines
  von ihnen läuft über `baseUrl` oder `DATABASE_URL`, was alles ist, was das Gate
  überprüfen kann. Siehe [Rebase Cloud](#rebase-cloud) bezüglich der Schutzmechanismen davor.
- **Nicht beschränkt – nur lokal:** `rebase_schema_introspect`, `rebase_db_branch_switch`, `rebase_schema_generate`, `rebase_db_generate`,
  `rebase_generate_sdk`, die Dev-Server-Tools und die Projekt-Registry-Tools.
  Diese schreiben lokale Dateien oder lokalen State und haben kein Remote-Ziel zu prüfen.
- **Beschränkt über `DATABASE_URL`:** die restlichen CLI-Tools – `rebase_db_push`,
  `rebase_db_migrate`, `rebase_db_branch_create`, `rebase_db_branch_delete`.
- **Beschränkt über die `baseUrl` des Projekts:** die restlichen SDK-Tools –
  `create_row`, `update_row`, `delete_row`, `create_user`,
  `update_user`, `delete_user`, `rebase_auth_reset_password`,
  `storage_delete_object`, `cron_trigger_job`, `cron_toggle_job`
  und `invoke_function`.

Die beiden Ziele sind nicht austauschbar. CLI-Tools sehen `baseUrl` nie, weshalb ein
Localhost-Backend neben einer Produktions-`DATABASE_URL` gegen die Datenbank und nicht
gegen das Backend geprüft wird.

Eine Verweigerung sieht wie folgt aus:

```text
Error: Refusing to run "delete_row": project "default" points at
https://api.example.com/, which is not local. Set REBASE_MCP_ALLOW_REMOTE_WRITES=true
to allow destructive tools against remote environments.
```

**Wenn überhaupt kein Verbindungs-String aufgelöst werden kann, werden die beschränkten DB-Tools verweigert.**
Ohne `DATABASE_URL` verwendet die CLI die verwaltete Entwicklungsdatenbank, was der
Standard für ein neues Projekt ist, und das Gate verweigert seine vier Datenbank-Tools
dort. Die Verweigerung nennt den Grund und zeigt auf, was stattdessen funktioniert. Sie schlägt
den Opt-out nicht vor:

```text
Error: Refusing to run "rebase_db_push": project "default" sets no DATABASE_URL, so the
CLI would use the managed development database (PGlite, started by `rebase dev`). You
most likely do not need this tool: the dev server applies the tables in backend/schema to
that database at boot, additively. After changing a table, restart it with
rebase_dev_stop and rebase_dev_start. …
```

Aus einem Terminal heraus
laufen `rebase db push` und `rebase db migrate` auf dieser Datenbank; lediglich die MCP-Tools
werden verweigert.

Nur Loopback gilt als lokal: `localhost`, `*.localhost`, `127.0.0.0/8`, `::1`
(und `0.0.0.0`).
Private Adressbereiche wie `10.x` und `192.168.x` zählen **nicht** dazu – diese sind genauso gut
ein geteilter Staging-Cluster wie ein Laptop, und sie als lokal zu behandeln, würde genau
das Versehen ermöglichen, das das Gate verhindern soll.

Setzen Sie `REBASE_MCP_ALLOW_REMOTE_WRITES=true`, um diesen Schutz zu deaktivieren. Wenn Sie dies global
in Ihrer MCP-Client-Konfiguration setzen, wird das Gate für jedes erreichbare Projekt
des Servers entfernt, nicht nur für dasjenige, an das Sie gerade gedacht haben.

## Kennzeichnung nicht vertrauenswürdiger Daten

Zeilen, Benutzerdatensätze, Storage-Listen, Cronjobs, Funktionsantworten und CLI-Ausgaben
werden in einem expliziten Umschlag zurückgegeben:

```text
<<<UNTRUSTED_DATA source="query_table" id="9b2f4c1e-…">>>
[ … rows … ]
<<<END_UNTRUSTED_DATA id="9b2f4c1e-…">>>
```

Alles, was in Ihrer Datenbank gespeichert ist, wurde von irgendjemandem geschrieben und trifft über
denselben Kanal ein wie der Tool-Vertrag, dem der Assistent folgt. Die Umhüllung signalisiert
dem Modell, dies als inerten Inhalt und nicht als Handlungsanweisung zu behandeln.

Die `id` wird für jede Antwort nach dem Schreiben der Daten frisch generiert, und
nur der Endmarker mit dieser ID schließt den Block ab. Text innerhalb der Daten,
der wie ein Marker formatiert ist, wird durch ein Nullbreite-Leerzeichen unterbrochen, sodass eine Zeile,
die `<<<END_UNTRUSTED_DATA>>>` ausgibt, den Umschlag nicht vorzeitig beenden und den nachfolgenden Inhalt
nach außen verlagern kann.

Der [Remote-Endpunkt](/docs/ai/remote-mcp/) kapselt seine Tool-Ergebnisse auf dieselbe
Weise ein und teilt dies dem Client mit; sein `structuredContent` überträgt das einfache Ergebnis.
`list_tables` und
`describe_table` sind die Ausnahmen: Da sie nur von einem Modell gelesen werden, werden sie
einmalig im Text gesendet.

Es ist eine Kennzeichnung, keine Sandbox. Ein Assistent mit diesen Tools ist nur so sicher
wie der Inhalt, den Sie ihn lesen lassen.

## Mehrere Projekte

Projektkonfigurationen werden in `~/.rebase/projects.json` gespeichert, und der Server
kann mehrere gleichzeitig verwalten – nützlich, wenn Sie über lokale und entfernte
Umgebungen hinweg arbeiten. Während `rebase dev` läuft, liest der Server den aktiven Port und
den Service-Key aus `.rebase/state.json` im Projektverzeichnis, was den lokalen Fall
ohne Konfiguration ermöglicht.

:::note[Die Registry hat das letzte Wort, nicht das erste]
Die Rangfolge ist die oben genannte: Umgebungsblock, dann das Arbeitsverzeichnis,
wenn es eine `rebase.json` enthält, und danach der persistierte `default`.

`REBASE_PROJECT_DIR`, `REBASE_BASE_URL` und `REBASE_API_TOKEN` bauen das
`default`-Projekt **bei jedem Start** neu auf, nicht nur beim ersten Mal. Der Neuaufbau betrifft
den gesamten Eintrag: Ein Token, das für das alte `projectDir` registriert war, wird verworfen,
anstatt in ein Verzeichnis mitgenommen zu werden, für das es nie ausgestellt wurde. Ein auf diese
Weise – oder aus dem Arbeitsverzeichnis – abgeleiteter `default` wird nie nach
`~/.rebase/projects.json` zurückgeschrieben, sodass der Dev-Service-Key eines Projekts nicht zum
Schlüssel eines anderen werden kann.

`activeProject` ist persistent; wenn also eine vorherige Sitzung
`rebase_project_switch` aufgerufen hat, zielen Tools auf dieses Projekt und der Server meldet dies auf
stderr – es sei denn, dieses Projekt ist unter einem *anderen* Verzeichnis registriert als dem,
in dem dieser Server läuft. In diesem Fall fällt er auf `default` zurück und meldet dies. Wenn ein
Assistent aus der falschen Datenbank zu lesen scheint, rufen Sie zuerst
`rebase_project_current` auf.
:::

### Auf welches Projekt ein Aufruf wirkt

`activeProject` gilt rechnerweit, und oft wird ein Server einmalig für die gesamte Maschine installiert. Daher bestimmt jedes Tool, das auf ein Projekt einwirkt (alle außer den `rebase_project_*`-Registry-Tools, `rebase_cloud_projects_list`, `rebase_cloud_provision` und `rebase_dev_logs`), sein Projekt **pro Aufruf** und nimmt ein optionales `project` entgegen: den Namen eines registrierten Projekts oder einen Rebase Cloud Slug bzw. eine ID. Der Aufruf wird gegen den Cloud-Link (`.rebase/cloud.json`) des Verzeichnisses geprüft, in dem die Sitzung arbeitet: der erste [Root](https://modelcontextprotocol.io/specification/latest/client/roots) des Clients, andernfalls das Arbeitsverzeichnis des Servers.

| Der Aufruf | Das Verzeichnis der Sitzung | Ergebnis |
|---|---|---|
| nennt ein Projekt | ist mit demselben Projekt verknüpft | wird darauf ausgeführt |
| nennt ein Projekt | ist mit einem anderen Projekt verknüpft | **verweigert**, nichts wird ausgeführt |
| nennt kein Projekt | ist mit einem Projekt verknüpft, das aktive Projekt jedoch nicht | **verweigert**, nichts wird ausgeführt |
| nennt kein Projekt | ist verknüpft; das aktive Projekt ist ein lokales Projekt woanders | wird auf dem verknüpften Projekt ausgeführt |
| nennt kein Projekt | ist nicht verknüpft | wird auf dem aktiven Projekt ausgeführt; ein *Schreibvorgang* auf ein Cloud-Projekt, das eine frühere Sitzung ausgewählt hat, erfordert die Nennung des Projekts |

Eine Verweigerung benennt beide Projekte. `rebase_project_current` meldet das Verzeichnis und den Link der Sitzung unter `session`. `rebase_cloud_env_set` und `rebase_cloud_rollback` übergeben das aufgelöste Projekt mit `--project` an die CLI; `rebase_cloud_deploy` liefert das Verzeichnis aus, in dem es ausgeführt wird, weshalb es verweigert wird, wenn der Link dieses Verzeichnisses ein anderes Projekt ist.

Tokens werden in dieser Registry **im Klartext** gespeichert. Es ist eine Datei in Ihrem
Benutzerverzeichnis, die Admin-Anmeldedaten für jedes von Ihnen registrierte Projekt enthält; behandeln
Sie sie entsprechend.

## Rebase Cloud

Acht Tools bringen eine App aus diesem Verzeichnis zu einem Live-Backend auf
[Rebase Cloud](/docs/deployment/cloud/) und halten sie am Laufen. Jedes startet
`rebase cloud <command> --json` im aktiven Projektverzeichnis: derselbe
Befehl, den auch ein Mensch ausführt, sodass es keine abweichende zweite Implementierung gibt.

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

Der typische Agenten-Ablauf ist: `rebase_cloud_provision`, dann dem Benutzer die
Claim-URL übergeben; `rebase_cloud_status`, um das Projekt einzusehen (solange es nicht beansprucht wurde,
enthält `unclaimed` die Claim-URL und das Löschdatum); `rebase_cloud_deploy`
nach einer Änderung; `rebase_cloud_logs`, wenn etwas fehlschlägt; und
`rebase_cloud_rollback`, wenn die Produktion beschädigt ist.

**Worauf sie wirken.** Das Projekt, zu dem der Aufruf aufgelöst wird, wie beschrieben in
[Auf welches Projekt ein Aufruf wirkt](#auf-welches-projekt-ein-aufruf-wirkt): das Argument
`project`, abgeglichen mit der Verknüpfung des Sitzungsverzeichnisses, oder diese Verknüpfung, oder
das aktive Projekt. Ein Aufruf, der ein Projekt nennt, mit dem das Sitzungsverzeichnis nicht
verknüpft ist, wird verweigert, bevor etwas gestartet wird.

**Wessen Berechtigung.** Was immer die CLI in diesem Verzeichnis auflöst: `REBASE_TOKEN`,
wenn gesetzt, dann das Token, das `rebase cloud init --claim` für ein
nicht beanspruchtes Projekt gespeichert hat, und schließlich die `rebase cloud login`-Sitzung. Im Verzeichnis
dieses nicht beanspruchten Projekts wird ein `REBASE_TOKEN`, das keinen Scope auf dem Projekt besitzt,
zugunsten des projekteigenen Tokens beiseite gelegt. Die Control Plane
prüft jeden Aufruf genauso wie die der CLI. Mit einem durch
`rebase cloud tokens create --can logs` erstellten Token kann ein Assistent also Protokolle lesen, während die
Control Plane Deploys, Variablen und Rollbacks verweigert. Fehlende oder verweigerte Anmeldedaten
werden als Fehler zurückgegeben, der erklärt, was der Benutzer tun muss (`rebase cloud login` oder Beanspruchen des Projekts).

**Warum das Loopback-Gate hier nicht greift.** Das Gate prüft die `baseUrl` der App und
die `DATABASE_URL` der CLI; diese Tools nutzen keines von beiden. Nach `rebase_cloud_provision`
zeigt `REBASE_BASE_URL` auf das neue Cloud-Projekt, sodass eine Beschränkung darauf genau
das Deploy verweigern würde, das der Ablauf benötigt. Das Provisioning selbst erstellt lediglich: Es greift
keine bestehende App oder Datenbank an, und die CLI verweigert es in einem Verzeichnis, das
bereits verknüpft ist, ohnehin. Ein Deploy, eine Variable und ein Rollback verändern
jeweils die Produktion. Was davorsteht, sind die oben genannten Anmeldedaten, die Tool-Bestätigung
Ihres MCP-Clients und `confirm: true`: `rebase_cloud_deploy` in die Produktion,
`rebase_cloud_env_set` in der Produktion, `rebase_cloud_rollback` und
`rebase_cloud_provision` geben an, was sie tun würden, und tun nichts, bis ein Aufruf
dieselben Argumente mit `confirm: true` wiederholt – was der Assistent erst sendet,
nachdem der Benutzer zustimmt. Ein Preview-Deploy und eine Preview-Variable benötigen dies nicht. Um einen Assistenten daran zu hindern, ein Cloud-Projekt
zu verändern, setzen Sie `REBASE_TOKEN` in der Umgebung des Servers auf ein Token ohne die
Berechtigungen `deploy` und `env`.

**Lesen beliebiger Ihrer Projekte.** Die obigen Tools wirken auf das verknüpfte Projekt.
Um die Daten eines anderen Projekts zu lesen – jedes beliebige Projekt in jeder Organisation, der das
angemeldete Konto angehört, ob hier verknüpft oder nicht –, listet `rebase_cloud_projects_list` diese auf
und `rebase_project_use_cloud` (mit ID, Slug oder Name) richtet die Daten- und
Admin-Tools darauf aus: `query_table`, `get_row`, `list_users`, `list_roles`,
`cron_list_jobs`, `storage_list_objects`. Diese Aufrufe laufen über den Studio-Proxy der
Konsole und tragen die eigene Berechtigung der CLI (`rebase cloud access-token`, das pro Aufruf
gelesen und nie gespeichert wird); die Control Plane prüft die Zugriffsrechte der Person und
hängt den Service-Key des Projekts auf ihrer Seite an, sodass kein Schlüssel den Rechner erreicht.
Ein Projekt mit deaktiviertem Studio wird verweigert, worauf der Schalter hinweist. Es ist ein
Remote-Ziel wie jedes andere, weshalb Tools, die Daten ändern, dort verweigert bleiben,
es sei denn, `REBASE_MCP_ALLOW_REMOTE_WRITES` ist gesetzt; `rebase_project_switch` wechselt
wieder zurück.

Jedes Tool liefert eine Momentaufnahme:

- `rebase_cloud_logs` streamt nicht kontinuierlich. Sein Ergebnis liefert `nextSinceTime`; übergeben Sie
  dieses als `since`, um nachfolgende Einträge zu lesen. Es liefert standardmäßig die letzten 200 Zeilen,
  sofern `tail` nichts anderes angibt. `source: "build"` liefert stattdessen das neueste Build-Log.
- `rebase_cloud_deploy` verfolgt das Deployment bis zum Ende und überprüft, ob die neue
  Version antwortet. `wait: false` kehrt zurück, sobald das Deployment ausgelöst wurde.
  Es wirft ein Projekt niemals aus der verwalteten Laufzeitumgebung, deployt kein älteres Framework-Release
  und überspringt keine Build-Prüfungen: Dies sind Entscheidungen des Benutzers, und eine
  Verweigerung, die eine solche erfordert, teilt dies mit.
- `rebase_cloud_rollback` übergibt `--yes`, sobald der Aufruf `confirm: true` enthält
  (siehe unten), da es kein Terminal gibt, an dem nachgefragt werden könnte.

`rebase_cloud_env_set` schreibt den Wert in die Standardeingabe der CLI, sodass er
niemals in einer Befehlszeile auftaucht, wo `ps` ihn anzeigen könnte, und der Wert wird aus
allen Rückgaben des Tools herausgefiltert. Sein Ergebnis zeigt an, was gespeichert wurde (der Schlüssel, ob
er geheim ist, ob ein Re-Deploy aussteht), niemals den Wert selbst. `rebase_cloud_env_list`
listet ausschließlich Schlüssel auf. Eine CLI, die älter als `env set --stdin` ist, wird mit dem Hinweis
verweigert, sie zu aktualisieren; der Wert wird nicht auf anderem Weg übertragen.

Ergebnisse werden im [Umschlag für nicht vertrauenswürdige Daten](#kennzeichnung-nicht-vertrauenswürdiger-daten)
zurückgegeben, gefolgt von einer Zeile des Servers mit Hinweisen zum weiteren Vorgehen. Eine Verweigerung ist ein Tool-Fehler,
der den Code der CLI enthält, wie etwa `no_project`, `token_rejected`,
`managed_project` oder `deploy_failed`. Erkennt der Server den Code,
ergänzt er den nächsten Schritt, gefolgt von der Meldung der CLI selbst. Jedes Tool validiert seine Argumente
gegen das von ihm definierte Schema, bevor ein Prozess gestartet wird, und weist nicht
deklarierte Argumente ab.

## Tool-Referenz

53 Tools in zehn Gruppen: Schema und Datenbank, Schema-Planung, Dokumente, Benutzer
und Rollen, Storage, Cron, Funktionen, der Dev-Server, die Projekt-Registry und
Rebase Cloud.
Jedes einzelne, inklusive seiner Voraussetzungen und ob das Gate es bei einem nicht-lokalen
Ziel verweigert, ist in der [MCP-Tool-Referenz](/docs/ai/mcp-tool-reference) aufgeführt.

## Ressourcen

Neben Tools stellt der Server MCP-Ressourcen bereit, damit ein Client Projektkontext
abrufen kann, ohne einen Tool-Aufruf zu verbrauchen:

| URI | Beschreibung |
|---|---|
| `rebase://tables/{name}` | TypeScript-Quellcode einer Tabellendefinition (`defineTable`) |
| `rebase://schema` | Das generierte Drizzle-Schema (`schema.generated.ts`) |

Tabellendateien sind die Module des Schema-Verzeichnisses, abgesehen von seiner `index.ts`: der
Schlüssel `tables` der Backend-App in `rebase.json`, standardmäßig `backend/schema`,
unterhalb des aktiven Projektverzeichnisses oder dessen `app/`.

`rebase://schema` wird **nur dann** aufgeführt, wenn das generierte Schema existiert.
`findBackendDir` sucht nach `backend/` und danach nach `app/backend/` unter dem aktiven
Projektverzeichnis und liest `src/schema.generated.ts` aus dem Verzeichnis, das zuerst gefunden wird –
somit funktionieren sowohl das Standardgerüst als auch das Layout dieses Monorepos, und ein Projekt mit einem
dritten Aufbau oder eines, auf dem noch kein `rebase schema generate` ausgeführt wurde, bekommt
die Ressource schlichtweg nicht angeboten.

## Der Remote-Endpunkt

Ein bereitgestelltes Backend kann MCP unter `/mcp` auch selbst für die Benutzer
Ihrer Anwendung bereitstellen, wobei sich jeder als er selbst unter seiner eigenen Row-Level
Security verbindet. Dies wird auf einer eigenen Seite beschrieben:
[Der Remote-MCP-Endpunkt](/docs/ai/remote-mcp/).

## Empfohlenes Setup

- Richten Sie den Server auf ein **lokales** Projekt aus und lassen Sie `REBASE_MCP_ALLOW_REMOTE_WRITES`
  ungesetzt. Das Gate ist der wertvollste Schutz im gesamten Paket.
- Registrieren Sie für alle Remote-Umgebungen einen **eingeschränkten `rk_`-API-Key**, anstatt
  der Erkennung die Übergabe eines Service-Keys zu überlassen.
- Überprüfen Sie `rebase_project_current`, wenn die Ausgaben unerwartet wirken. Das aktive Projekt ist
  persistent und liegt außerhalb Ihres Repositories.
- Behandeln Sie `~/.rebase/projects.json` wie eine Datei für geheime Zugangsdaten.
