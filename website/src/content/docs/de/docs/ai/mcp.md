---
sourceHash: 5a197121af0d5219
title: MCP-Server
sidebar_label: MCP-Server
description: Verbinden Sie Claude Code, Cursor, Gemini CLI oder beliebige MCP-Clients mit einem Rebase-Projekt – die 42 bereitgestellten Tools, die Anmeldedaten zur Authentifizierung und das Loopback-Gate zwischen Agent und Produktion.
---

`@rebasepro/mcp` ist ein [Model Context Protocol](https://modelcontextprotocol.io)-Server,
der einem KI-Assistenten echte Werkzeuge für ein Rebase-Projekt an die Hand gibt: Zeilen
lesen und schreiben, Benutzer verwalten, Migrationen ausführen, Funktionen aufrufen und
den Dev-Server steuern.

Er kommuniziert über MCP **ausschließlich via stdio**. Es gibt weder einen Port noch
einen Listener – der Prozess genießt genau so viel Vertrauen wie der Prozess, der ihn
gestartet hat, und es gibt keinen Remote-Aufrufer zu authentifizieren. Das ist der
sichere Teil. Die interessanten Fragen drehen sich alle darum, was er tut, *sobald* er
läuft, und diese Seite beantwortet sie, bevor sie Ihnen den Konfigurationsblock zeigt.

Ein bereitgestelltes Backend kann MCP auch selbst über HTTP für die Benutzer Ihrer
Anwendung bereitstellen. Das ist ein anderer Anwendungsfall mit einem anderen
Berechtigungsmodell: siehe [Der Remote-Endpunkt](#der-remote-endpunkt).

## Verbinden eines Clients

Der Server ist auf npm veröffentlicht und erfordert keinen Installationsschritt; `npx`
lädt ihn direkt herunter. Jeder der folgenden Blöcke stellt die vollständige Integration dar.

**Claude Code** – `.mcp.json` im Stammverzeichnis Ihres Projekts. `rebase init` erstellt
diese Datei automatisch für Sie:

```json title=".mcp.json"
{
  "mcpServers": {
    "rebase": {
      "command": "npx",
      "args": ["-y", "@rebasepro/mcp"],
      "env": {
        "REBASE_PROJECT_DIR": "."
      }
    }
  }
}
```

**Cursor** – dieselbe Struktur, in `.cursor/mcp.json`:

```json title=".cursor/mcp.json"
{
  "mcpServers": {
    "rebase": {
      "command": "npx",
      "args": ["-y", "@rebasepro/mcp"],
      "env": {
        "REBASE_PROJECT_DIR": "."
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
      "command": "npx",
      "args": ["-y", "@rebasepro/mcp"],
      "env": {
        "REBASE_PROJECT_DIR": "."
      }
    }
  }
}
```

**Codex CLI** – TOML statt JSON, in `~/.codex/config.toml`. Diese Konfiguration
gilt auf Benutzerebene, nicht pro Projekt; geben Sie hier also das Projektverzeichnis an:

```toml title="~/.codex/config.toml"
[mcp_servers.rebase]
command = "npx"
args = ["-y", "@rebasepro/mcp"]
env = { REBASE_PROJECT_DIR = "/absolute/path/to/your/project" }
```

**Kiro** – `.kiro/settings/mcp.json`:

```json title=".kiro/settings/mcp.json"
{
  "mcpServers": {
    "rebase": {
      "command": "npx",
      "args": ["-y", "@rebasepro/mcp"],
      "env": {
        "REBASE_PROJECT_DIR": "."
      }
    }
  }
}
```

Jeder MCP-Client, der einen stdio-Server starten kann, funktioniert; die Struktur ist identisch.

### Auf welches Verzeichnis er zugreift

`REBASE_PROJECT_DIR` ist das Verzeichnis, das die `rebase.json` enthält. Es gibt **eine**
Rangfolge, und diese ist in jedem Client identisch:

1. **Der Umgebungsblock** – `REBASE_PROJECT_DIR`, `REBASE_BASE_URL`,
   `REBASE_API_TOKEN`. Wenn eine dieser Variablen gesetzt ist, wird das `default`-Projekt
   bei jedem Start daraus neu erstellt.
2. **Das Arbeitsverzeichnis des Servers**, sofern es eine `rebase.json` enthält. Ein Projekt,
   in dem Sie sich gerade befinden, hat Vorrang vor allem, was in `~/.rebase/projects.json`
   gespeichert ist.
3. **Das persistierte `default`-Projekt** in `~/.rebase/projects.json`, wenn keines der
   ersten beiden Kriterien zutrifft.

Die automatische Erkennung über `.rebase/state.json` füllt in allen drei Fällen Lücken und
überschreibt niemals einen Wert, der von einem dieser Mechanismen bereitgestellt wurde.

Die Blöcke auf Projektebene setzen `REBASE_PROJECT_DIR` auf `"."` – das Arbeitsverzeichnis
des Clients ist das Projekt –, da Regel 3 eine Datei liest, die von jedem Projekt auf dem
Rechner geteilt wird. Der Codex-Block gilt auf Benutzerebene statt pro Projekt und gibt
daher stattdessen einen absoluten Pfad an.

## Worauf der Server zugreifen kann

Diesen Abschnitt sollten Sie lesen, bevor Sie einen Assistenten auf eine Datenbank loslassen,
die Ihnen wichtig ist.

Der Server besitzt **ein einziges übergeordnetes Credential für den gesamten Prozess**.
Es gibt keine Identität pro Tool und keinen Read-only-Modus; jedes Tool verwendet dasselbe
Token, und die einzige Option im Paket dient dazu, sich für *mehr* Reichweite zu entscheiden,
nicht für weniger.

Welches Credential das ist, in der Reihenfolge der Priorität:

1. `REBASE_API_TOKEN` / `REBASE_TOKEN` aus der Umgebung
2. `REBASE_SERVICE_KEY` ausgelesen aus der `.env`-Datei des Projekts
3. Der automatisch aus `.rebase/state.json` erkannte Service-Key, während `rebase dev`
   läuft

Ein Token, das Sie für ein Projekt registrieren, **hat Vorrang vor der automatischen Erkennung**.
Die Erkennung füllt lediglich Lücken.

:::danger[Der Zero-Config-Weg ist ein Admin-Credential]
Die Optionen 2 und 3 verwenden den **Service-Key** – ein uneingeschränktes Admin-Secret.
Das Backend löst ihn zu `uid: "service"`, `roles: ["admin"]`, `isAdmin: true` auf. Diese
Identität umgeht die Berechtigungsliste von API-Keys vollständig und erfüllt die
`_default_admin_read`- / `_default_admin_write`-Richtlinien, die Rebase in jede Collection
injiziert, bei der `disableDefaultPolicies` nicht gesetzt ist.

Die ehrliche Antwort auf die Frage „Schränkt RLS dies trotzdem ein?“ lautet daher: RLS *wird
ausgeführt* – der Treiber führt ein Downgrade auf die Rolle `rebase_user` durch –, doch
anschließend gewährt eine von Rebase selbst geschriebene Richtlinie dieser Identität vollen
Zugriff. Das Lesen jeder Zeile jeder Collection ist das **beabsichtigte Verhalten der
Standardkonfiguration**, kein Bypass.

Mit dem Zero-Config-Setup kann ein Agent, der diese Tools besitzt, jede Zeile jeder
Collection lesen und schreiben, alle Benutzer auflisten, beliebige Passwörter zurücksetzen,
jede Backend-Funktion aufrufen und DDL gegen die vom Projekt aufgelöste `DATABASE_URL` ausführen.
:::

### Stattdessen ein eingeschränktes Credential zuweisen

Registrieren Sie einen eingeschränkten [API-Key](/docs/backend/api-keys), und das
Zwei-Gate-Modell greift tatsächlich. Ein Nicht-Admin-Key läuft mit den Rollen `["service"]`,
die von den injizierten Admin-Richtlinien **nicht** genannt werden – RLS gewährt ihm also
keinerlei Rechte, es sei denn, eine Ihrer eigenen Richtlinien besagt etwas anderes, und die
Berechtigungsliste schränkt ihn weiter ein:

```bash
rebase api-keys create -n "claude-code" \
  --permissions '[{"collection":"articles","operations":["read"]}]' \
  --expires 30d
```

Übergeben Sie dann den resultierenden `rk_live_…`-Key an den Server, anstatt ihn einen
Service-Key automatisch erkennen zu lassen:

```json title=".mcp.json"
{
  "mcpServers": {
    "rebase": {
      "command": "npx",
      "args": ["-y", "@rebasepro/mcp"],
      "env": {
        "REBASE_PROJECT_DIR": "/absolute/path/to/your/project",
        "REBASE_API_TOKEN": "rk_live_..."
      }
    }
  }
}
```

Zwei Dinge, die dies **nicht** tut, die man jedoch wissen sollte, bevor man sich darauf verlässt:

- **Es schränkt die CLI-Tools nicht ein.** `rebase_db_push`, `rebase_db_migrate`,
  `rebase_doctor` und die Branch-Tools starten die Rebase-CLI, die sich über
  `DATABASE_URL` verbindet und Ihr Token überhaupt nicht sieht. Das unten beschriebene
  Loopback-Gate ist die einzige Schutzschicht vor diesen Tools.
- **Ein Nicht-Admin-Key kann die Admin-Tools nicht verwenden.** `list_users`, `create_user`,
  `update_user`, `delete_user`, `list_roles` und `rebase_auth_reset_password` erfordern
  `requireAdmin` und schlagen mit einem berechtigungseingeschränkten Key fehl. Das System
  verhält sich hier wie vorgesehen, bedeutet aber auch, dass Sie zwischen Reichweite und
  Einschränkung wählen müssen, statt beides zu erhalten.

Ein API-Key mit `admin: true` ist ein anderer Fall: Er besitzt die Rollen `["admin", "service"]`,
wodurch er dieselben Standard-Admin-Richtlinien passiert wie der Service-Key. Auf der Datenebene
entspricht seine Reichweite der des Service-Keys. Der zusätzliche Vorteil ist, dass er
**pro Key widerrufbar, befristbar und ratenbegrenzt** ist. Nichts davon gilt für den
Service-Key – dessen Rotation erfordert die Bearbeitung der `.env` und einen Neustart des Servers.

Siehe [Agents and MCP Servers](/docs/backend/api-keys#agents-and-mcp-servers) für den
vollständigen Leitfaden zur Definition von Key-Berechtigungen.

### Eine Collection vollständig unerreichbar machen

Der Grund, warum ein Admin-Credential alles lesen kann, ist die Basis-Richtlinie, die Rebase
in jede Collection injiziert und die dem vertrauenswürdigen Server-Kontext sowie der Rolle
`admin` Zugriff gewährt. Eine Collection kann sich von dieser Basis abmelden und die volle
Verantwortung für ihr eigenes RLS übernehmen:

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

Jetzt ist der einzige Zugang ein Treffer auf `patient_id`. Die uid des Service-Keys ist
der Literal-String `service`, sodass eine Eigentümer-Regel niemals darauf zutrifft –
Leseoperationen liefern null Zeilen zurück und Schreiboperationen werden von Postgres
abgelehnt. Dies ist die einzige Kontrollmöglichkeit, die das Standard-Credential des
MCP-Servers tatsächlich einschränkt, anstatt darauf zu vertrauen.

Beachten Sie, dass dies eine echte RLS-Änderung ist und keine bloße Dokumentation: Sie
wird erst wirksam, sobald `rebase schema generate` und eine Migration die Richtlinien
angewendet haben. Siehe [Security Rules (RLS)](/docs/collections/security-rules).

## Das Loopback-Gate

`rebase_project_add` akzeptiert jede beliebige `baseUrl`, und die CLI-Tools verbinden
sich mit der `DATABASE_URL`, die das Projekt deklariert. Dieselbe Liste an Tools, die eine
Test-Datenbank auf Ihrem Laptop bearbeitet, kann somit Produktionsdaten löschen – ohne dass
etwas dazwischensteht, außer dem Urteilsvermögen des Assistenten darüber, welches Projekt
gerade aktiv ist.

**Jedes Tool, das die Zielumgebung verändert, wird verweigert, es sei denn, dieses Ziel
befindet sich auf der Loopback-Schnittstelle.** Das Gate ist als Liste dessen definiert,
was *nicht* blockiert wird, sodass ein später hinzugefügtes Tool standardmäßig geschützt ist.

- **Nicht blockiert – Leseoperationen:** `rebase_schema_plan`, `rebase_doctor`,
  `rebase_db_branch_list`, `rebase_db_branch_info`, `list_documents`,
  `get_document`, `list_users`, `list_roles`, `storage_list_objects`,
  `storage_get_download_url`, `cron_list_jobs`, `cron_get_job`, `cron_get_job_logs`,
  `rebase_dev_logs`.
- **Nicht blockiert – nur lokal:** `rebase_schema_introspect`, `rebase_schema_generate`,
  `rebase_db_generate`, `rebase_generate_sdk`, die Dev-Server-Tools und die
  Projekt-Registry-Tools. Diese schreiben lokale Dateien oder lokalen Zustand und haben
  kein Remote-Ziel, das überprüft werden müsste.
- **Gegen `DATABASE_URL` abgesichert:** die verbleibenden CLI-Tools – `rebase_db_push`,
  `rebase_db_migrate`, `rebase_db_branch_create`, `rebase_db_branch_delete`.
- **Gegen die Projekt-`baseUrl` abgesichert:** die verbleibenden SDK-Tools –
  `create_document`, `update_document`, `delete_document`, `create_user`,
  `update_user`, `delete_user`, `rebase_auth_reset_password`,
  `storage_delete_object`, `cron_trigger_job`, `cron_toggle_job`,
  `invoke_function`.

Die beiden Ziele sind nicht austauschbar. CLI-Tools sehen `baseUrl` niemals; ein
Localhost-Backend neben einer Produktions-`DATABASE_URL` wird daher gegen die Datenbank
geprüft, nicht gegen das Backend.

Eine Verweigerung sieht wie folgt aus:

```text
Error: Refusing to run "delete_document": project "default" points at
https://api.example.com/, which is not local. Set REBASE_MCP_ALLOW_REMOTE_WRITES=true
to allow destructive tools against remote environments.
```

**Wenn überhaupt kein Verbindungs-String aufgelöst werden kann, werden die DB-Tools verweigert** –
ein nicht verifizierbares Ziel gilt nicht als sicher:

```text
Error: Refusing to run "rebase_db_push": no DATABASE_URL could be resolved for
project "default", so the database it would connect to cannot be verified as local.
```

Nur Loopback zählt als lokal: `localhost`, `*.localhost`, `127.0.0.0/8`, `::1`.
Private Adressbereiche wie `10.x` und `192.168.x` zählen **nicht** – dabei kann es sich
genauso gut um einen geteilten Staging-Cluster wie um einen Laptop handeln, und sie als lokal
zu behandeln, würde genau die Unfälle durchwinken, die das Gate verhindern soll.

Setzen Sie `REBASE_MCP_ALLOW_REMOTE_WRITES=true`, um diesen Schutz zu deaktivieren. Wenn Sie
dies global in Ihrer MCP-Client-Konfiguration setzen, wird das Gate für jedes Projekt entfernt,
das der Server erreichen kann – nicht nur für das, an das Sie gerade gedacht haben.

## Kennzeichnung nicht vertrauenswürdiger Daten

Zeilen, Benutzerdatensätze, Storage-Auflistungen, Cronjobs, Funktionsantworten und
CLI-Ausgaben werden in einen expliziten Umschlag (Envelope) verpackt zurückgegeben:

```text
<<<UNTRUSTED_DATA source="list_documents">>>
[ … rows … ]
<<<END_UNTRUSTED_DATA>>>
```

Alles, was in Ihrer Datenbank gespeichert ist, wurde von irgendjemandem geschrieben und
trifft auf demselben Kanal ein wie der Tool-Vertrag, dem der Assistent folgt. Der Envelope
signalisiert dem Modell, dies als passiven Inhalt und nicht als Anweisungen zu behandeln.

Es ist eine Kennzeichnung, keine Sandbox. Ein Assistent mit diesen Tools ist nur so sicher
wie der Inhalt, den Sie ihn lesen lassen.

## Mehrere Projekte

Projektkonfigurationen werden in `~/.rebase/projects.json` gespeichert, und der Server
kann mehrere gleichzeitig verwalten – nützlich, wenn Sie über lokale und entfernte
Umgebungen hinweg arbeiten. Während `rebase dev` läuft, liest der Server den aktiven Port
und den Service-Key aus `.rebase/state.json` im Projektverzeichnis, was den lokalen Fall
zu Zero-Config macht.

:::note[Die Registry hat das letzte Wort, nicht das erste]
Die Rangfolge ist die oben genannte: Umgebungsblock, dann das Arbeitsverzeichnis, wenn es
eine `rebase.json` enthält, und schließlich das persistierte `default`.

`REBASE_PROJECT_DIR`, `REBASE_BASE_URL` und `REBASE_API_TOKEN` erstellen das `default`-Projekt
**bei jedem Start** neu, nicht nur beim ersten. Diese Neuerstellung betrifft den gesamten
Eintrag: Ein Token, das für das alte `projectDir` registriert war, wird verworfen, anstatt
in ein Verzeichnis übernommen zu werden, für das es nie ausgestellt wurde. Ein auf diese
Weise – oder aus dem Arbeitsverzeichnis – abgeleitetes `default` wird niemals zurück in
`~/.rebase/projects.json` geschrieben, sodass der Entwicklungs-Service-Key eines Projekts
nicht zum Key eines anderen werden kann.

`activeProject` bleibt erhalten („sticky“). Wenn also eine vorherige Sitzung
`rebase_project_switch` aufgerufen hat, zielen Tools auf dieses Projekt, und der Server
meldet dies auf stderr – es sei denn, dieses Projekt ist unter einem *anderen* Verzeichnis
registriert als dem, in dem dieser Server ausgeführt wird; in diesem Fall greift er auf
`default` zurück und meldet dies ebenfalls. Wenn ein Assistent die falsche Datenbank zu lesen
scheint, rufen Sie zuerst `rebase_project_current` auf.
:::

Tokens werden in dieser Registry **im Klartext** gespeichert. Es handelt sich um eine Datei
in Ihrem Home-Verzeichnis, die Admin-Zugangsdaten für jedes registrierte Projekt enthält;
behandeln Sie sie entsprechend sorgsam.

## Tool-Referenz

42 Tools in neun Gruppen. Tools, die mit ⚠ markiert sind, werden für nicht-lokale Ziele
verweigert, es sei denn, Sie deaktivieren diese Sperre.

### Schema & Datenbank (12)

Startet die Rebase-CLI im aktiven Projektverzeichnis.

| Tool | Erforderlich | Beschreibung |
|---|---|---|
| `rebase_schema_generate` | — | Drizzle-Schema aus Collection-Definitionen generieren |
| `rebase_db_push` ⚠ | — | Schema direkt auf die Datenbank anwenden (Dev-Shortcut) |
| `rebase_schema_introspect` | — | Live-Datenbank introspektieren und Collection-Definitionen erstellen |
| `rebase_db_generate` | — | SQL-Migrationsdateien aus Schemaänderungen generieren |
| `rebase_db_migrate` ⚠ | — | Alle ausstehenden SQL-Migrationen ausführen |
| `rebase_generate_sdk` | — | Vollständig typisiertes TypeScript-SDK generieren |
| `rebase_doctor` | — | Abweichungen (Drift) zwischen Definitionen, generiertem Schema und der Live-Datenbank erkennen |
| `rebase_db_branch_create` ⚠ | `name` | Datenbank-Branch erstellen (nur Admins) |
| `rebase_db_branch_list` | — | Datenbank-Branches auflisten (nur Admins) |
| `rebase_db_branch_delete` ⚠ | `name` | Datenbank-Branch löschen (nur Admins) |
| `rebase_db_branch_info` | `name` | Branch-Informationen und -Status (nur Admins) |
| `rebase_db_branch_switch` | — | Diesen Checkout auf einen Branch oder zurück auf die Hauptdatenbank richten (nur Admins) |

### Schema-Planung (1)

Fragt das Backend über `POST /api/admin/schema/plan`, was eine Änderung bewirken würde.
Keine CLI und keine Schreibzugriffe auf die Festplatte – funktioniert auf der verwalteten
Entwicklungsdatenbank, was die Atlas-basierten Befehle nicht können.

| Tool | Erforderlich | Beschreibung |
|---|---|---|
| `rebase_schema_plan` | `collectionId`, `collection` | Das SQL, das die Änderung einer Collection ausführen würde, und welche Anweisungen Daten zerstören |

### Dokumente (5)

| Tool | Erforderlich | Beschreibung |
|---|---|---|
| `list_documents` | `collection` | Zeilen auflisten, mit optionalem `limit`, `offset`, `orderBy`, `where` |
| `get_document` | `collection`, `id` | Eine einzelne Zeile anhand der ID abrufen |
| `create_document` ⚠ | `collection`, `data` | Eine Zeile erstellen |
| `update_document` ⚠ | `collection`, `id`, `data` | Eine Zeile aktualisieren |
| `delete_document` ⚠ | `collection`, `id` | Eine Zeile löschen |

### Benutzer & Rollen (6)

| Tool | Erforderlich | Beschreibung |
|---|---|---|
| `list_users` | — | Alle Benutzer inklusive Rollen auflisten |
| `create_user` ⚠ | `email` | Benutzer erstellen (optional `displayName`, `password`, `roles`) |
| `update_user` ⚠ | `uid` | E-Mail, Anzeigename oder Rollen aktualisieren |
| `delete_user` ⚠ | `uid` | Benutzer löschen |
| `list_roles` | — | Definierte Rollen auflisten |
| `rebase_auth_reset_password` ⚠ | `email` | Passwort über die Admin-API zurücksetzen |

`create_user` und `update_user` akzeptieren beide `roles`, sodass beide einen Admin
erzeugen können. Aus diesem Grund sind sie geschützt, anstatt lediglich als „additiv“
behandelt zu werden.

### Storage (3)

| Tool | Erforderlich | Beschreibung |
|---|---|---|
| `storage_list_objects` | — | Gespeicherte Objekte auflisten |
| `storage_get_download_url` | `key` | Eine temporär signierte Download-URL und deren Ablaufzeit – keine Objektmetadaten |
| `storage_delete_object` ⚠ | `key` | Ein Objekt löschen |

`storage_get_download_url` ist als Leseoperation eingestuft, da sie die Umgebung nicht
verändert – aber die signierte URL, die sie erzeugt, ist eine Inhaberberechtigung
(Bearer Capability), die über den Tool-Aufruf hinaus gültig bleibt.

### Cron (5)

| Tool | Erforderlich | Beschreibung |
|---|---|---|
| `cron_list_jobs` | — | Geplante Jobs und deren Status auflisten |
| `cron_get_job` | `jobId` | Job-Details |
| `cron_get_job_logs` | `jobId` | Ausführungsprotokolle |
| `cron_trigger_job` ⚠ | `jobId` | Einen Job sofort ausführen |
| `cron_toggle_job` ⚠ | `jobId`, `enabled` | Einen Job aktivieren oder deaktivieren |

`cron_toggle_job` kann ein Backup oder einen Abrechnungsjob unbemerkt deaktivieren – eine
Änderung ohne Fehlermeldung und ohne Ausgabe, bis später etwas fehlt.

### Funktionen (1)

| Tool | Erforderlich | Beschreibung |
|---|---|---|
| `invoke_function` ⚠ | `name` | Eine [benutzerdefinierte Funktion](/docs/backend/custom-functions) mit beliebiger Methode und Payload aufrufen |

Dies ruft Code auf, den der MCP-Server nie gesehen hat, mit einer Methode und einem Body,
die das Modell gewählt hat. Sein potenzieller Schadensradius entspricht allem, was Ihre
Funktionen tun können.

### Dev-Server (3)

| Tool | Erforderlich | Beschreibung |
|---|---|---|
| `rebase_dev_start` | — | Dev-Server starten; kehrt sofort zurück |
| `rebase_dev_logs` | — | Aktuelle Ausgaben lesen (Standard: 50 Zeilen, 500-Zeilen-Puffer) |
| `rebase_dev_stop` | — | Dev-Server stoppen |

### Projekt-Registry (6)

| Tool | Erforderlich | Beschreibung |
|---|---|---|
| `rebase_project_list` | — | Registrierte Projekte auflisten und das aktive anzeigen |
| `rebase_project_switch` | `name` | Das aktive Projekt wechseln |
| `rebase_project_add` | `name` | Ein Projekt registrieren (`baseUrl`, optional `projectDir`, `token`) |
| `rebase_project_remove` | `name` | Ein Projekt entfernen (das Standardprojekt kann nicht entfernt werden) |
| `rebase_project_current` | — | Das aktive Projekt und dessen Auth-Status anzeigen |
| `rebase_project_status` | — | Health-Check für das aktive Backend durchführen |

`rebase_project_switch` ist nicht abgesichert, da es lediglich das Ziel für alles
Weitere ändert, anstatt selbst auf ein Ziel einzuwirken. Ein Assistent kann daher zu
einem Remote-Projekt wechseln, ohne das Gate auszulösen – er kann dort anschließend
nur keine destruktiven Tools ausführen.

## Ressourcen

Neben Tools stellt der Server auch MCP-Ressourcen bereit, sodass ein Client
Projektkontext abrufen kann, ohne einen Tool-Aufruf zu verbrauchen:

| URI | Beschreibung |
|---|---|
| `rebase://collections/{name}` | TypeScript-Quellcode einer Collection-Definition |
| `rebase://schema` | Das generierte Drizzle-Schema (`schema.generated.ts`) |

Collections werden aus `app/config/collections/`, `config/collections/` oder
`collections/` unterhalb des aktiven Projektverzeichnisses erkannt – je nachdem,
welches Verzeichnis existiert.

`rebase://schema` wird **nur dann** aufgeführt, wenn das generierte Schema existiert.
`findBackendDir` sucht nach `backend/` und anschließend nach `app/backend/` im aktiven
Projektverzeichnis und liest `src/schema.generated.ts` aus dem Verzeichnis, das es findet –
so funktionieren sowohl das Scaffold-Layout als auch das dieses Monorepos, und ein Projekt
mit einem alternativen Layout oder eines, auf dem `rebase schema generate` noch nicht ausgeführt
wurde, bekommt die Ressource schlichtweg nicht angeboten.

## Der Remote-Endpunkt

Alles Bisherige ist ein Entwickler-Tool: Es läuft auf Ihrem Rechner und verwendet einen
Service-Key oder einen API-Key. Ein bereitgestelltes Backend kann MCP auch selbst unter
`/mcp` für die Benutzer Ihrer Anwendung bereitstellen. Ein Assistent, den einer dieser
Benutzer verbindet, liest und schreibt das Projekt **im Namen dieser Person**, und jeder
Aufruf wird unter deren eigener Row-Level Security ausgeführt.

Es ist standardmäßig deaktiviert, und beide Variablen sind erforderlich:

```bash
REBASE_MCP_ENABLED=true
REBASE_PUBLIC_URL=https://app.example.com   # this deployment's real origin
```

Ohne `REBASE_PUBLIC_URL`, ein JWT-Secret oder einen Datentreiber, der eine Abfrage auf
einen Benutzer eingrenzen kann, verweigert der Endpunkt die Initialisierung und gibt den
Grund im Boot-Log an. Es gibt keine `REBASE_ROLE`, die ihn aktiviert.

- **OAuth mit Zustimmungsbildschirm (Consent Screen).** Ein Client findet den Autorisierungsserver
  über `/.well-known/oauth-protected-resource`, registriert sich selbst (dynamische
  Registrierung ist standardmäßig aktiviert; `REBASE_MCP_OPEN_REGISTRATION=false` beschränkt
  dies auf von Ihnen registrierte Clients) und leitet den Benutzer zu einem Zustimmungsbildschirm
  weiter, der ihn über Ihr bestehendes `/auth/login` anmeldet.
- **Sechs Tools, zwei Scopes.** `mcp:read` stellt `list_collections`,
  `query_collection` und `get_document` bereit; `mcp:write` ergänzt `create_document`,
  `update_document` und `delete_document`. Ein Scope bestimmt, welche Tools angeboten
  werden, nicht welche Zeilen: Eine leere Liste kann bedeuten, dass RLS greift, und `mcp:write`
  kann weiterhin keine Zeile schreiben, zu deren Erstellung die Person nicht berechtigt wäre.
- **Ein Token nur für diesen Endpunkt.** Ein MCP-Access-Token wird von `/api/data`,
  `/api/admin` und dem WebSocket abgelehnt; das Verbinden eines Assistenten übergibt diesem
  also keine vollständige Session.

Eine Einschränkung: Das Trennen eines Clients (`DELETE /api/oauth/grants/:clientId` mit der
eigenen Session der Person) widerruft dessen Refresh-Tokens sofort, doch ein bereits
ausgestelltes Access-Token bleibt bis zu seinem Ablauf innerhalb einer Stunde gültig.
Dieselbe Stunde begrenzt alles andere: Jede Erneuerung liest die Rollen der Person neu und
lehnt ein gelöschtes Konto ab oder eine Autorisierung, die älter ist als das letzte „Überall
abmelden“ oder die letzte Passwortänderung. Eine Herabstufung oder Abmeldung erreicht einen
verbundenen Client also innerhalb der Lebensdauer eines Access-Tokens. Eine Gast-Session
kann gar nicht zustimmen.

Die Routen finden Sie unter [Endpoints](/docs/backend/endpoints/#mcp-surface) und die
Variablen unter [Configuration](/docs/getting-started/configuration/#mcp-surface).

## Empfohlenes Setup

- Richten Sie den Server auf ein **lokales** Projekt aus und lassen Sie `REBASE_MCP_ALLOW_REMOTE_WRITES`
  ungesetzt. Das Gate ist der wertvollste Schutzmechanismus im gesamten Paket.
- Registrieren Sie für alle Remote-Umgebungen einen **eingeschränkten `rk_`-API-Key**,
  anstatt der automatischen Erkennung das Übergeben eines Service-Keys zu überlassen.
- Überprüfen Sie `rebase_project_current`, wenn eine Ausgabe unerwartet erscheint. Das aktive
  Projekt bleibt sitzungsübergreifend erhalten („sticky“) und liegt außerhalb Ihres Repositorys.
- Behandeln Sie `~/.rebase/projects.json` wie eine Datei mit vertraulichen Zugangsdaten (Secrets).
