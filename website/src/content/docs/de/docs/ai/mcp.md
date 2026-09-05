---
title: MCP-Server
sidebar_label: MCP-Server
description: Verbinden Sie Claude Code, Cursor, die Gemini CLI oder einen beliebigen MCP-Client mit einem Rebase-Projekt – die 41 bereitgestellten Tools, die Anmeldedaten für die Authentifizierung und das Loopback-Gate, das zwischen einem Agenten und der Produktion steht.
---

`@rebasepro/mcp` ist ein [Model Context Protocol](https://modelcontextprotocol.io)-Server,
der einem KI-Assistenten echte Tools für ein Rebase-Projekt bereitstellt: Zeilen
lesen und schreiben, Benutzer verwalten, Migrationen ausführen, Funktionen
aufrufen und den Dev-Server steuern.

Er kommuniziert über MCP **ausschließlich über stdio**. Es gibt keinen Port und
keinen Listener – der Prozess ist exakt so vertrauenswürdig wie der Prozess, der
ihn gestartet hat, und es gibt keinen Remote-Aufrufer, der authentifiziert werden
müsste. Das ist der sichere Teil. Die interessanten Fragen drehen sich darum, was
er tut, *sobald* er läuft, und diese Seite beantwortet sie, bevor sie den
Konfigurationsblock zeigt.

## Einen Client verbinden

Der Server ist auf npm veröffentlicht und erfordert keinen Installationsschritt;
`npx` lädt ihn herunter.

Für **Claude Code** fügen Sie ihn zu `.mcp.json` im Stammverzeichnis Ihres
Projekts hinzu:

```json title=".mcp.json"
{
  "mcpServers": {
    "rebase": {
      "command": "npx",
      "args": ["-y", "@rebasepro/mcp"],
      "env": {
        "REBASE_PROJECT_DIR": "/absolute/path/to/your/project"
      }
    }
  }
}
```

**Cursor** verwendet dieselbe Struktur in `.cursor/mcp.json` und **Gemini CLI** in
`.gemini/settings.json`. Jeder MCP-Client, der einen stdio-Server starten kann,
funktioniert – der obige Block ist die gesamte Integration.

`REBASE_PROJECT_DIR` sollte das Verzeichnis sein, das `rebase.json` enthält. Wenn
Sie es weglassen, verwendet der Server sein Arbeitsverzeichnis, also dasjenige,
in dem der Client ihn gestartet hat.

### Konfiguration

| Variable | Standardwert | Beschreibung |
|---|---|---|
| `REBASE_PROJECT_DIR` | `process.cwd()` | Projekt-Root – wird verwendet, um Collections, `.env` und den Status des Dev-Servers zu finden |
| `REBASE_BASE_URL` | `http://localhost:3001` | Backend-URL |
| `REBASE_API_TOKEN` / `REBASE_TOKEN` | *(leer)* | Das für jeden API-Aufruf verwendete Token |
| `REBASE_MCP_ALLOW_REMOTE_WRITES` | `false` | Destruktive Tools vom Loopback-Gate ausnehmen |

Der Server lädt beim Start `.env` aus `$REBASE_PROJECT_DIR/.env` oder
`$REBASE_PROJECT_DIR/app/.env`.

## Was der Server erreichen kann

Diesen Abschnitt sollten Sie lesen, bevor Sie einen Assistenten auf eine
Datenbank ansetzen, die Ihnen wichtig ist.

Der Server verfügt über **einen einzigen umgebenden Berechtigungsnachweis für den gesamten Prozess**.
Es gibt keine Identität pro Tool und keinen Read-Only-Modus; jedes Tool
verwendet dasselbe Token, und der einzige Schalter im Paket schaltet *mehr*
Zugriff frei statt weniger.

Welcher Berechtigungsnachweis das ist, in der Reihenfolge der Priorität:

1. `REBASE_API_TOKEN` / `REBASE_TOKEN` aus der Umgebung
2. `REBASE_SERVICE_KEY`, ausgelesen aus der `.env` des Projekts
3. Der Service-Schlüssel, der automatisch aus `.rebase/state.json` ermittelt
   wird, während `rebase dev` läuft

Ein Token, das Sie für ein Projekt registrieren, **hat Vorrang vor der automatischen Erkennung**.
Die Erkennung füllt nur eine Lücke.

:::danger[Der Zero-Config-Pfad ist ein Admin-Berechtigungsnachweis]
Die Optionen 2 und 3 sind der **Service-Schlüssel** – ein unbeschränktes Admin-Secret.
Das Backend löst ihn zu `uid: "service"`, `roles: ["admin"]`, `isAdmin: true` auf.
Diese Identität überspringt die Berechtigungsliste des API-Schlüssels vollständig
und erfüllt die `_default_admin_read` / `_default_admin_write`-Richtlinien, die
Rebase in jede Collection einfügt, für die nicht `disableDefaultPolicies` gesetzt
ist.

Die ehrliche Antwort auf die Frage „Schränkt RLS dies noch ein?“ lautet also:
RLS *wird ausgeführt* – der Treiber stuft auf die Rolle `rebase_user` herab – und
dann gewährt eine von Rebase selbst geschriebene Richtlinie dieser Identität
alles. Das Lesen jeder Zeile jeder Collection ist das **beabsichtigte Verhalten
der Standardkonfiguration**, keine Umgehung.

Mit dem Zero-Config-Setup kann ein Agent, der über diese Tools verfügt, jede Zeile
jeder Collection lesen und schreiben, jeden Benutzer auflisten, jedes Passwort
zurücksetzen, jede Backend-Funktion aufrufen und DDL für die aufgelöste
`DATABASE_URL` des Projekts ausführen.
:::

### Stattdessen einen eingeschränkten Berechtigungsnachweis vergeben

Registrieren Sie einen bereichsbezogenen [API-Schlüssel](/docs/backend/api#api-keys),
und das Zwei-Gate-Modell greift wirklich. Ein Nicht-Admin-Schlüssel läuft mit den
Rollen `["service"]`, die von den injizierten Admin-Richtlinien **nicht** benannt
werden – RLS gewährt ihm also nichts, es sei denn, eine Ihrer eigenen
Richtlinien legt etwas anderes fest, und die Berechtigungsliste schränkt ihn
weiter ein:

```bash
rebase api-keys create -n "claude-code" \
  --permissions '[{"collection":"articles","operations":["read"]}]' \
  --expires 30d
```

Übergeben Sie den resultierenden `rk_live_…`-Schlüssel an den Server, anstatt
ihn automatisch einen Service-Schlüssel erkennen zu lassen:

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

Zwei Dinge, die dies **nicht** tut und die Sie wissen sollten, bevor Sie sich
darauf verlassen:

- **Es schränkt die CLI-Tools nicht ein.** `rebase_db_push`, `rebase_db_migrate`,
  `rebase_doctor` und die Branch-Tools starten die Rebase CLI, die sich mit
  `DATABASE_URL` verbindet und Ihr Token überhaupt nicht sieht. Das nachfolgende
  Loopback-Gate ist das Einzige, was davor steht.
- **Ein Nicht-Admin-Schlüssel kann die Admin-Tools nicht verwenden.** `list_users`,
  `create_user`, `update_user`, `delete_user`, `list_roles` und
  `rebase_auth_reset_password` liegen hinter `requireAdmin` und schlagen mit
  einem bereichsbezogenen Schlüssel fehl. Das System funktioniert so wie
  vorgesehen, bedeutet aber, dass Sie sich zwischen Reichweite und Einschränkung
  entscheiden müssen, anstatt beides zu bekommen.

Ein API-Schlüssel mit `admin: true` ist eine andere Sache: Er trägt die Rollen
`["admin", "service"]`, was dieselben Standard-Admin-Richtlinien freischaltet wie
der Service-Schlüssel. Auf der Datenebene entspricht seine Reichweite der des
Service-Schlüssels. Der Vorteil ist jedoch, dass er **widerrufbar, befristbar und
pro Schlüssel ratenbegrenzt** ist, was auf den Service-Schlüssel alles nicht
zutrifft – dessen Rotation erfordert die Bearbeitung der `.env` und einen Neustart
des Servers.

Siehe [Agenten und MCP-Server](/docs/backend/api#agents-and-mcp-servers) für die
vollständige Anleitung zum Scopen von Schlüsseln.

### Eine Collection vollständig unerreichbar machen

Der Grund, warum ein Admin-Berechtigungsnachweis alles liest, ist die
Basis-Richtlinie, die Rebase in jede Collection injiziert und die den
vertrauenswürdigen Server-Kontext sowie die Rolle `admin` gewährt. Eine
Collection kann diese Baseline abwählen und die volle Verantwortung für ihr
eigenes RLS übernehmen:

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
    // Injektierte Admin-/Server-Baseline entfernen – nichts ist lesbar,
    // außer dem, was die nachstehenden Regeln erlauben.
    disableDefaultPolicies: true,
    securityRules: [
        { operations: ["select", "update"], ownerField: "patient_id" }
    ]
});
```

Jetzt ist der einzige Zugriffsweg eine Übereinstimmung mit `patient_id`. Die uid
des Service-Schlüssels ist der Literal-String `service`, sodass eine Owner-Regel
niemals übereinstimmt – Leseoperationen geben null Zeilen zurück und
Schreiboperationen werden von Postgres abgelehnt. Dies ist die einzige
Kontrollmöglichkeit, die den Standard-Berechtigungsnachweis des MCP-Servers
tatsächlich einschränkt, anstatt ihn als gegeben vorauszusetzen.

Denken Sie daran, dass dies eine echte RLS-Änderung ist, keine rein
dokumentarische: Sie wird erst wirksam, wenn `rebase schema generate` und eine
Migration die Richtlinien angewendet haben. Siehe
[Sicherheitsregeln (RLS)](/docs/collections/security-rules).

## Das Loopback-Gate

`rebase_project_add` akzeptiert jede `baseUrl`, und die CLI-Tools verbinden sich
mit der vom Projekt deklarierten `DATABASE_URL`. Dieselbe Tool-Liste, die eine
Testdatenbank auf Ihrem Laptop bearbeitet, kann daher auch Produktionszeilen
löschen – dazwischen steht nichts außer dem Urteilsvermögen des Assistenten
darüber, welches Projekt aktiv ist.

**Jedes Tool, das die Zielumgebung verändert, wird verweigert, es sei denn,
dieses Ziel befindet sich auf der Loopback-Schnittstelle.** Das Gate ist als
Liste derjenigen Tools formuliert, die *nicht* reguliert werden, sodass ein
später hinzugefügtes Tool standardmäßig geschützt ist.

- **Nicht reguliert – Lesezugriffe:** `rebase_schema_plan`, `rebase_schema_introspect`, `rebase_doctor`,
  `rebase_db_branch_list`, `rebase_db_branch_info`, `list_documents`,
  `get_document`, `list_users`, `list_roles`, `storage_list_objects`,
  `storage_get_metadata`, `cron_list_jobs`, `cron_get_job`, `cron_get_job_logs`,
  `rebase_dev_logs`.
- **Nicht reguliert – nur lokal:** `rebase_schema_generate`, `rebase_db_generate`,
  `rebase_generate_sdk`, die Dev-Server-Tools und die Projekt-Registry-Tools.
  Diese schreiben lokale Dateien oder lokalen Status und haben kein Remote-Ziel
  zu überprüfen.
- **Gegen `DATABASE_URL` reguliert:** die verbleibenden CLI-Tools –
  `rebase_db_push`, `rebase_db_migrate`, `rebase_db_branch_create`,
  `rebase_db_branch_delete`.
- **Gegen die `baseUrl` des Projekts reguliert:** die verbleibenden SDK-Tools –
  `create_document`, `update_document`, `delete_document`, `create_user`,
  `update_user`, `delete_user`, `rebase_auth_reset_password`,
  `storage_delete_object`, `cron_trigger_job`, `cron_toggle_job`,
  `invoke_function`.

Die beiden Ziele sind nicht austauschbar. CLI-Tools sehen `baseUrl` niemals,
sodass ein Localhost-Backend neben einer produktiven `DATABASE_URL` gegen die
Datenbank und nicht gegen das Backend geprüft wird.

Eine Ablehnung sieht wie folgt aus:

```text
Error: Refusing to run "delete_document": project "default" points at
https://api.example.com/, which is not local. Set REBASE_MCP_ALLOW_REMOTE_WRITES=true
to allow destructive tools against remote environments.
```

**Wenn überhaupt keine Verbindungszeichenfolge aufgelöst werden kann, werden die
DB-Tools verweigert** – ein nicht verifizierbares Ziel ist kein sicheres Ziel:

```text
Error: Refusing to run "rebase_db_push": no DATABASE_URL could be resolved for
project "default", so the database it would connect to cannot be verified as local.
```

Nur Loopback gilt als lokal: `localhost`, `*.localhost`, `127.0.0.0/8`, `::1`.
Private IP-Bereiche wie `10.x` und `192.168.x` zählen **nicht** dazu – diese
sind genauso wahrscheinlich ein gemeinsam genutzter Staging-Cluster wie ein
Laptop, und sie als lokal zu behandeln, würde genau den Unfall durchwinken, den
das Gate verhindern soll.

Setzen Sie `REBASE_MCP_ALLOW_REMOTE_WRITES=true`, um das Gate zu deaktivieren.
Wenn Sie dies global in Ihrer MCP-Client-Konfiguration setzen, wird das Gate für
jedes Projekt entfernt, das der Server erreichen kann, nicht nur für dasjenige,
an das Sie gerade gedacht haben.

## Kennzeichnung nicht vertrauenswürdiger Daten (Untrusted-Data Marking)

Zeilen, Benutzerdatensätze, Storage-Listen, Cronjobs, Funktionsantworten und
CLI-Ausgaben werden in einen expliziten Umschlag eingebettet zurückgegeben:

```text
<<<UNTRUSTED_DATA source="list_documents">>>
[ … rows … ]
<<<END_UNTRUSTED_DATA>>>
```

Alles, was in Ihrer Datenbank gespeichert ist, wurde von irgendjemandem
geschrieben, und es trifft über denselben Kanal ein wie der Tool-Vertrag, dem
der Assistent folgt. Der Umschlag weist das Modell an, dies als inerten Inhalt
und nicht als Anweisungen zu behandeln.

Es ist eine Kennzeichnung, keine Sandbox. Ein Assistent mit diesen Tools ist nur
so sicher wie der Inhalt, den Sie ihn lesen lassen.

## Mehrere Projekte

Projektkonfigurationen werden in `~/.rebase/projects.json` gespeichert, und der
Server kann mehrere gleichzeitig verwalten – nützlich, wenn Sie über lokale und
Remote-Umgebungen hinweg arbeiten. Während `rebase dev` läuft, liest der Server
den aktiven Port und den Service-Schlüssel aus `.rebase/state.json` im
Projektverzeichnis, was den lokalen Anwendungsfall zum Zero-Config-Erlebnis macht.

:::note[Der Umgebungsblock hat Vorrang vor der Registry]
`REBASE_PROJECT_DIR`, `REBASE_BASE_URL` und `REBASE_API_TOKEN` bauen das Projekt
`default` **bei jedem Start** neu auf, nicht nur beim ersten. Der Neuaufbau
betrifft den gesamten Eintrag: Ein Token, das für das alte `projectDir`
registriert wurde, wird verworfen statt in ein Verzeichnis übernommen zu werden,
für das es nie ausgestellt wurde.

Der persistierte `default` wird nur verwendet, wenn die Client-Konfiguration
keine der drei Variablen setzt. `activeProject` bleibt weiterhin bestehen: Hat
eine frühere Sitzung `rebase_project_switch` aufgerufen, richten sich die Tools
auf dieses Projekt, und der Server meldet das auf stderr. Wenn ein Assistent die
falsche Datenbank zu lesen scheint, rufe zuerst `rebase_project_current` auf.
:::

Tokens werden in dieser Registry **im Klartext** gespeichert. Es handelt sich um
eine Datei in Ihrem Home-Verzeichnis, die Admin-Anmeldedaten für jedes von Ihnen
registrierte Projekt enthält; behandeln Sie sie entsprechend.

## Tool-Referenz

41 Tools in acht Gruppen. Mit ⚠ markierte Tools werden bei nicht-lokalen Zielen
verweigert, sofern Sie dies nicht explizit erlauben.

### Schema & Datenbank (12)

Starten die Rebase CLI im aktiven Projektverzeichnis.

| Tool | Erforderlich | Beschreibung |
|---|---|---|
| `rebase_schema_plan` | — | Zeigt das SQL, das `rebase_db_push` ausführen würde, ohne etwas davon auszuführen |
| `rebase_schema_generate` | — | Drizzle-Schema aus Collection-Definitionen generieren |
| `rebase_db_push` ⚠ | — | Schema direkt auf die Datenbank anwenden (Dev-Abkürzung) |
| `rebase_schema_introspect` | — | Live-Datenbank in Collection-Definitionen introspektieren |
| `rebase_db_generate` | — | SQL-Migrationsdateien aus Schema-Änderungen generieren |
| `rebase_db_migrate` ⚠ | — | Alle ausstehenden SQL-Migrationen ausführen |
| `rebase_generate_sdk` | — | Vollständig typisiertes TypeScript-SDK generieren |
| `rebase_doctor` | — | Drift zwischen Definitionen, generiertem Schema und der Live-Datenbank erkennen |
| `rebase_db_branch_create` ⚠ | `name` | Einen Datenbank-Branch erstellen (nur Admins) |
| `rebase_db_branch_list` | — | Datenbank-Branches auflisten (nur Admins) |
| `rebase_db_branch_delete` ⚠ | `name` | Einen Datenbank-Branch löschen (nur Admins) |
| `rebase_db_branch_info` | `name` | Branch-Informationen und -Status (nur Admins) |

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
| `list_users` | — | Alle Benutzer auflisten, einschließlich Rollen |
| `create_user` ⚠ | `email` | Einen Benutzer erstellen (optional `displayName`, `password`, `roles`) |
| `update_user` ⚠ | `uid` | E-Mail, Anzeigenamen oder Rollen aktualisieren |
| `delete_user` ⚠ | `uid` | Einen Benutzer löschen |
| `list_roles` | — | Definierte Rollen auflisten |
| `rebase_auth_reset_password` ⚠ | `email` | Ein Passwort über die Admin-API zurücksetzen |

`create_user` und `update_user` akzeptieren beide `roles`, sodass beide einen
Admin erstellen können. Aus diesem Grund werden sie durch das Gate geschützt und
nicht bloß als „additiv“ behandelt.

### Storage (3)

| Tool | Erforderlich | Beschreibung |
|---|---|---|
| `storage_list_objects` | — | Gespeicherte Objekte auflisten |
| `storage_get_metadata` | `key` | Metadaten plus eine temporäre signierte Download-URL |
| `storage_delete_object` ⚠ | `key` | Ein Objekt löschen |

`storage_get_metadata` wird als Lesezugriff klassifiziert, da es die Umgebung
nicht verändert – aber die signierte URL, die es erzeugt, ist eine
Inhaberberechtigung (Bearer Capability), die den Tool-Aufruf überdauert.

### Cron (5)

| Tool | Erforderlich | Beschreibung |
|---|---|---|
| `cron_list_jobs` | — | Geplante Jobs und deren Status auflisten |
| `cron_get_job` | `jobId` | Job-Details |
| `cron_get_job_logs` | `jobId` | Ausführungsprotokolle |
| `cron_trigger_job` ⚠ | `jobId` | Einen Job sofort ausführen |
| `cron_toggle_job` ⚠ | `jobId`, `enabled` | Einen Job aktivieren oder deaktivieren |

`cron_toggle_job` kann ein Backup oder einen Abrechnungsjob stillschweigend
deaktivieren – eine Änderung ohne Fehler und ohne Ausgabe, bis später etwas
fehlt.

### Funktionen (1)

| Tool | Erforderlich | Beschreibung |
|---|---|---|
| `invoke_function` ⚠ | `name` | Eine [benutzerdefinierte Funktion](/docs/backend/custom-functions) mit beliebiger Methode und Payload aufrufen |

Dies ruft Code auf, den der MCP-Server noch nie gesehen hat, mit einer Methode
und einem Body, die das Modell gewählt hat. Sein Schadensradius entspricht dem,
was Ihre Funktionen tun.

### Dev-Server (3)

| Tool | Erforderlich | Beschreibung |
|---|---|---|
| `rebase_dev_start` | — | Dev-Server starten; kehrt sofort zurück |
| `rebase_dev_logs` | — | Kürzliche Ausgaben lesen (Standard: 50 Zeilen, 500-Zeilen-Puffer) |
| `rebase_dev_stop` | — | Dev-Server stoppen |

### Projekt-Registry (6)

| Tool | Erforderlich | Beschreibung |
|---|---|---|
| `rebase_project_list` | — | Registrierte Projekte auflisten und das aktive anzeigen |
| `rebase_project_switch` | `name` | Das aktive Projekt wechseln |
| `rebase_project_add` | `name` | Ein Projekt registrieren (`baseUrl`, optional `projectDir`, `token`) |
| `rebase_project_remove` | `name` | Ein Projekt entfernen (das Standardprojekt kann nicht entfernt werden) |
| `rebase_project_current` | — | Das aktive Projekt und seinen Auth-Status anzeigen |
| `rebase_project_status` | — | Health-Check des aktiven Backends durchführen |

`rebase_project_switch` wird nicht durch das Gate reguliert, da es lediglich das
Ziel für alles andere ändert, anstatt selbst auf ein Ziel einzuwirken. Ein
Assistent kann daher zu einem Remote-Projekt wechseln, ohne das Gate auszulösen –
er kann dort lediglich anschließend kein destruktives Tool ausführen.

## Ressourcen

Neben Tools stellt der Server auch MCP-Ressourcen bereit, sodass ein Client
Projektkontext abrufen kann, ohne einen Tool-Aufruf zu verbrauchen:

| URI | Beschreibung |
|---|---|
| `rebase://collections/{name}` | TypeScript-Quellcode einer Collection-Definition |
| `rebase://schema` | Das generierte Drizzle-Schema (`schema.generated.ts`) |

Collections werden aus `app/config/collections/`, `config/collections/` oder
`collections/` unterhalb des aktiven Projektverzeichnisses ermittelt – je
nachdem, welches Verzeichnis existiert.

`rebase://schema` wird **nur dann** aufgeführt, wenn sich das generierte Schema
exakt unter `app/backend/src/schema.generated.ts` befindet. Das ist ein
einzelner, fest codierter Pfad ohne Fallbacks; ein Projekt mit abweichender
Struktur – oder eines, auf dem `rebase schema generate` noch nicht ausgeführt
wurde – bekommt die Ressource einfach nicht angeboten. Wenn sie fehlt und Sie sie
erwartet haben, überprüfen Sie den Pfad, bevor Sie den Schluss ziehen, dass der
Server fehlerhaft ist.

## Empfohlenes Setup

- Richten Sie den Server auf ein **lokales** Projekt aus und lassen Sie
  `REBASE_MCP_ALLOW_REMOTE_WRITES` ungesetzt. Das Gate ist der wertvollste
  Bestandteil des Pakets.
- Registrieren Sie für Remote-Umgebungen einen **bereichsbezogenen `rk_`-API-Schlüssel**,
  anstatt die Erkennung automatisch einen Service-Schlüssel übergeben zu lassen.
- Überprüfen Sie `rebase_project_current`, wenn die Ausgabe fehlerhaft wirkt. Das
  aktive Projekt bleibt persistent erhalten und befindet sich außerhalb Ihres
  Repositorys.
- Behandeln Sie `~/.rebase/projects.json` wie eine Datei mit geheimen Schlüsseln (Secrets).

---
