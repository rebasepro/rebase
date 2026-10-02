---
sourceHash: 1cc4acaed4c60088
title: MCP Server
sidebar_label: MCP Server
description: Verbinden Sie Claude Code, Cursor, Gemini CLI oder beliebige MCP-Clients mit einem Rebase-Projekt – die 42 bereitgestellten Tools, die Anmeldedaten zur Authentifizierung und das Loopback-Gate, das zwischen einem Agenten und der Produktion steht.
---

`@rebasepro/mcp` ist ein [Model Context Protocol](https://modelcontextprotocol.io)-Server,
der einem KI-Assistenten echte Tools für ein Rebase-Projekt bereitstellt: Zeilen
lesen und schreiben, Benutzer verwalten, Migrationen ausführen, Funktionen
aufrufen und den Dev-Server steuern.

Er kommuniziert über MCP **ausschließlich via stdio**. Es gibt keinen Port und
keinen Listener – der Prozess genießt exakt dasselbe Vertrauen wie derjenige, der
ihn gestartet hat, und es gibt keinen Remote-Aufrufer, der authentifiziert werden
müsste. Das ist der sichere Teil. Die interessanten Fragen drehen sich darum, was
er tut, *sobald* er läuft – und diese Seite beantwortet sie, bevor sie Ihnen den
Konfigurationsblock zeigt.

Ein bereitgestelltes Backend kann MCP auch selbst über HTTP für die Benutzer Ihrer
Anwendung bereitstellen. Das ist ein anderer Anwendungsfall mit einem anderen
Modell für Zugangsdaten: siehe [Der Remote-Endpunkt](#the-remote-endpoint).

## Verbinden eines Clients

Der Server läuft aus Ihrem Projekt heraus: `@rebasepro/mcp` ist eine devDependency,
die jedes `rebase init`-Scaffold mit der CLI fixiert, und jeder der folgenden
Blöcke – die gesamte Integration – startet diese Kopie (`pnpm exec rebase-mcp`
oder `npx --no rebase-mcp` in einem npm-Projekt), nie eine neuere aus npm. Ein
älteres Projekt fügt ihn einmalig hinzu, mit `rebase skills install --mcp` oder
`pnpm add -D @rebasepro/mcp`.

<span class="since-badge" data-since="0.24">Seit 0.24</span> `rebase init` schreibt den Block für jeden von Ihnen ausgewählten Agenten, wenn es
[Ihre KI-Coding-Agenten einrichtet](/docs/ai/skills#set-up-by-rebase-init), wobei
alle anderen bereits in der Datei vorhandenen Server erhalten bleiben.
`rebase init --agent cursor,codex` erledigt dasselbe ohne Nachfrage.

**Claude Code** — `.mcp.json` im Stammverzeichnis Ihres Projekts. `rebase init`
schreibt diese Datei für Sie:

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

**Cursor** — dieselbe Struktur, in `.cursor/mcp.json`. Cursor löst
`${workspaceFolder}` zum Projekt-Stammverzeichnis auf:

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

**Gemini CLI** — `.gemini/settings.json`, unter demselben Schlüssel:

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

**Codex CLI** — TOML statt JSON in `.codex/config.toml` des Projekts. Codex
liest eine Projektkonfiguration erst, wenn Sie dem Projekt vertraut haben:

```toml title=".codex/config.toml"
[mcp_servers.rebase]
command = "pnpm"
args = ["exec", "rebase-mcp"]

[mcp_servers.rebase.env]
REBASE_PROJECT_DIR = "."
```

**Kiro** — `.kiro/settings/mcp.json`:

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

**GitHub Copilot in VS Code** — `.vscode/mcp.json`, unter `servers` und mit
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

**Windsurf** liest MCP-Server ausschließlich aus seiner Konfiguration auf
Benutzerebene, daher gibt es keine Projektdatei zu schreiben. Fügen Sie den
Server in dessen MCP-Einstellungen hinzu, als `"command": "pnpm"`,
`"args": ["--dir", "/absolute/path/to/your/project", "exec", "rebase-mcp"]`, mit diesem Pfad als `REBASE_PROJECT_DIR`.

Jeder MCP-Client, der einen stdio-Server starten kann, wird unterstützt; das
Schema ist stets dasselbe.

### Auf welches Verzeichnis zugegriffen wird

`REBASE_PROJECT_DIR` ist das Verzeichnis, das die `rebase.json` enthält. Es gibt
**eine einzige** Rangfolge, und sie ist in jedem Client identisch:

1. **Der Umgebungsblock** — `REBASE_PROJECT_DIR`, `REBASE_BASE_URL`,
   `REBASE_API_TOKEN`. Wenn einer dieser Werte gesetzt ist, wird das `default`-Projekt
   bei jedem Start daraus neu erstellt.
2. **Das Arbeitsverzeichnis des Servers**, wenn es eine `rebase.json` enthält. Ein
   Projekt, in dem Sie sich aktuell befinden, hat Vorrang vor allem, was in
   `~/.rebase/projects.json` gespeichert ist.
3. **Das persistierte `default`** in `~/.rebase/projects.json`, wenn weder Punkt 1
   noch Punkt 2 zutreffen.

Die automatische Erkennung (Auto-Discovery) über `.rebase/state.json` füllt in
allen drei Fällen Lücken und überschreibt niemals einen Wert, der von einer der
Quellen bereitgestellt wurde.

Die Blöcke auf Projektebene benennen das Projekt – `"."`, das Arbeitsverzeichnis
des Clients oder `${workspaceFolder}` des Editors –, da Regel 3 eine Datei liest,
die von allen Projekten auf dem Rechner gemeinsam genutzt wird. Eine Konfiguration
auf Benutzerebene, wie die von Windsurf, gibt stattdessen einen absoluten Pfad an.

## Worauf der Server zugreifen kann

Diesen Abschnitt sollten Sie lesen, bevor Sie einen Assistenten auf eine Datenbank
ansetzen, die Ihnen wichtig ist.

Der Server verwendet **ein einziges, prozessweites Anmeldedatum (ambient credential)**.
Es gibt keine Identität pro Tool und keinen Read-Only-Modus; jedes Tool nutzt
dasselbe Token, und der einzige Schalter im Paket erweitert die Reichweite (*opt-in*),
anstatt sie einzuschränken.

Welche Zugangsdaten verwendet werden (nach Priorität geordnet):

1. `REBASE_API_TOKEN` / `REBASE_TOKEN` aus der Umgebung
2. `REBASE_SERVICE_KEY`, ausgelesen aus der `.env`-Datei des Projekts
3. Der automatisch ermittelte Service-Key aus `.rebase/state.json`, während
   `rebase dev` läuft

Ein Token, das Sie für ein Projekt registrieren, **hat Vorrang vor der automatischen
Erkennung**. Die Erkennung füllt lediglich Lücken.

:::danger[Der Zero-Config-Pfad verwendet Admin-Zugangsdaten]
Optionen 2 und 3 sind der **Service-Key** – ein uneingeschränktes Admin-Geheimnis.
Das Backend löst diesen zu `uid: "service"`, `roles: ["admin"]`, `isAdmin: true`
auf. Diese Identität hält jeden [Scope](/docs/backend/roles-and-scopes/) und
erfüllt die `_default_admin_read`- / `_default_admin_write`-Richtlinien, die Rebase
in jede Collection injiziert, bei der nicht `disableDefaultPolicies` gesetzt ist.

Die ehrliche Antwort auf die Frage „Wird er immer noch durch RLS eingeschränkt?“
lautet daher: RLS *wird ausgeführt* – der Treiber stuft die Berechtigung auf die
Rolle `rebase_user` herab – und anschließend gewährt eine von Rebase selbst
geschriebene Richtlinie dieser Identität vollen Zugriff. Das Lesen jeder Zeile
jeder Collection ist das **beabsichtigte Verhalten der Standardkonfiguration**,
keine Umgehung.

Mit dem Zero-Config-Setup kann ein Agent, der diese Tools besitzt, jede Zeile
jeder Collection lesen und schreiben, alle Benutzer auflisten, beliebige Passwörter
zurücksetzen, jede Backend-Funktion aufrufen und DDL-Befehle auf der `DATABASE_URL`
ausführen, zu der das Projekt aufgelöst wird.
:::

### Stattdessen eingeschränkte Anmeldedaten verwenden

<span class="since-badge" data-since="0.24">Seit 0.24</span> Registrieren Sie einen eingeschränkten [API-Key](/docs/backend/api-keys),
und das Zwei-Stufen-Modell greift tatsächlich. Ein Service-Key läuft mit den
Rollen `["service"]`, die von den injizierten Admin-Richtlinien **nicht** genannt
werden – RLS gewährt ihm also keinerlei Zugriff, sofern keine Ihrer eigenen
Richtlinien etwas anderes besagt, und seine Scopes schränken ihn weiter ein:

```bash
rebase api-keys create -n "claude-code" \
  --scopes data:read:articles \
  --expires-in 30
```

Übergeben Sie dann den resultierenden `rk_live_…`-Key an den Server, anstatt ihn
automatisch einen Service-Key erkennen zu lassen:

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

Zwei Dinge, die dadurch **nicht** bewirkt werden, aber wichtig zu wissen sind,
bevor Sie sich darauf verlassen:

- **Es schränkt die CLI-Tools nicht ein.** `rebase_db_push`, `rebase_db_migrate`,
  `rebase_doctor` und die Branch-Tools starten die Rebase-CLI, die sich direkt über
  `DATABASE_URL` verbindet und Ihr Token überhaupt nicht sieht. Das nachfolgende
  Loopback-Gate ist die einzige Schutzbarriere vor diesen Befehlen.
- **Ein Key erreicht ein Admin-Tool nur mit dem Scope dieses Tools.** `list_users` und
  `list_roles` brauchen `users:read`; `create_user`, `update_user`, `delete_user` und
  `rebase_auth_reset_password` brauchen `users:write`; die Storage- und Cron-Tools
  brauchen den passenden `storage:*`- oder `cron:*`-Scope; `invoke_function` braucht
  `functions:invoke`. Ohne ihn antwortet der Aufruf mit `403 SCOPE_MISSING`. Selbst mit
  `users:write` kann ein Key das Konto eines Admins nicht ändern: Ein Admin hält
  `keys:read` und `keys:write`, die kein Key halten kann, und niemand darf ein Konto
  verwalten, das mehr hält als er selbst.

Ein mit `--roles admin` erstellter Key ist eine andere Sache: Er besitzt die Rollen
`["service", "admin"]`, womit dieselben Standard-Admin-Richtlinien greifen wie
beim Service-Key. Geben Sie ihm zusätzlich `--full-access`, und seine Reichweite
entspricht der des Service-Keys, abzüglich der Schlüsselverwaltung. Der Vorteil
besteht darin, dass er **pro Key widerrufen werden kann, abläuft und
ratenlimitiert ist** – all das gilt für den Service-Key nicht; dessen Rotation
erfordert die Bearbeitung der `.env` und einen Neustart des Servers.

Ausführliche Hinweise zur Berechtigungsbeschränkung von Keys finden Sie unter
[Agenten und MCP-Server](/docs/backend/api-keys#agents-and-mcp-servers).

### Eine Collection vollständig unerreichbar machen

Der Grund, warum ein Admin-Anmeldedatum alles lesen kann, ist die Basis-Richtlinie,
die Rebase in jede Collection injiziert und die dem vertrauenswürdigen Serverkontext
sowie der Rolle `admin` vollen Zugriff gewährt. Eine Collection kann diese Basis-Richtlinie
deaktivieren und die volle Verantwortung für ihr eigenes RLS übernehmen:

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

Der einzige Weg für einen Zugriff besteht nun darin, mit `patient_id` übereinzustimmen.
Die UID des Service-Keys ist der Literal-String `service`, sodass eine Owner-Regel
niemals darauf zutrifft – Lesezugriffe liefern null Zeilen zurück und Schreibzugriffe
werden von Postgres abgelehnt. Dies ist die einzige Kontrollmöglichkeit, die das
Standard-Anmeldedatum des MCP-Servers einschränkt, anstatt dessen Vollzugriff
vorauszusetzen.

Beachten Sie, dass dies eine echte RLS-Änderung ist und keine bloße Dokumentation:
Sie wird erst wirksam, wenn `rebase schema generate` und eine Migration die
Richtlinien angewendet haben. Siehe [Sicherheitsregeln (RLS)](/docs/collections/security-rules).

## Das Loopback-Gate

`rebase_project_add` akzeptiert jede beliebige `baseUrl`, und die CLI-Tools
verbinden sich mit der `DATABASE_URL`, die das Projekt angibt. Dieselbe Tool-Liste,
die eine Scratch-Datenbank auf Ihrem Laptop bearbeitet, kann daher Zeilen in der
Produktion löschen – ohne eine Hürde dazwischen, abgesehen von der Einschätzung
des Assistenten, welches Projekt gerade aktiv ist.

**Jedes Tool, das die Zielumgebung verändert, wird verweigert, es sei denn, dieses
Ziel befindet sich auf dem Loopback-Interface.** Das Gate ist als Liste derjenigen
Tools definiert, die *nicht* beschränkt sind. Neu hinzukommende Tools sind somit
standardmäßig geschützt.

- **Nicht beschränkt – Lesevorgänge:** `rebase_schema_plan`, `rebase_doctor`,
  `rebase_db_branch_list`, `rebase_db_branch_info`, `list_documents`,
  `get_document`, `list_users`, `list_roles`, `storage_list_objects`,
  `storage_get_download_url`, `cron_list_jobs`, `cron_get_job`, `cron_get_job_logs`,
  `rebase_dev_logs`.
- **Nicht beschränkt – nur lokal:** `rebase_schema_introspect`, `rebase_schema_generate`, `rebase_db_generate`,
  `rebase_generate_sdk`, die Dev-Server-Tools und die Projekt-Registry-Tools.
  Diese schreiben lokale Dateien oder lokalen Status und haben kein Remote-Ziel,
  das überprüft werden müsste.
- **Gegen `DATABASE_URL` geschützt:** die verbleibenden CLI-Tools – `rebase_db_push`,
  `rebase_db_migrate`, `rebase_db_branch_create`, `rebase_db_branch_delete`.
- **Gegen die Projekt-`baseUrl` geschützt:** die verbleibenden SDK-Tools –
  `create_document`, `update_document`, `delete_document`, `create_user`,
  `update_user`, `delete_user`, `rebase_auth_reset_password`,
  `storage_delete_object`, `cron_trigger_job`, `cron_toggle_job`,
  `invoke_function`.

Die beiden Ziele sind nicht austauschbar. CLI-Tools sehen `baseUrl` niemals. Wenn
also ein Localhost-Backend neben einer produktiven `DATABASE_URL` liegt, wird die
Prüfung gegen die Datenbank ausgeführt, nicht gegen das Backend.

Eine Verweigerung sieht wie folgt aus:

```text
Error: Refusing to run "delete_document": project "default" points at
https://api.example.com/, which is not local. Set REBASE_MCP_ALLOW_REMOTE_WRITES=true
to allow destructive tools against remote environments.
```

**Kann überhaupt kein Connection-String aufgelöst werden, werden die DB-Tools
verweigert** – ein nicht verifizierbares Ziel gilt nicht als sicher:

```text
Error: Refusing to run "rebase_db_push": no DATABASE_URL could be resolved for
project "default", so the database it would connect to cannot be verified as local.
```

Nur Loopback zählt als lokal: `localhost`, `*.localhost`, `127.0.0.0/8`, `::1`.
Private IP-Bereiche wie `10.x` und `192.168.x` zählen **nicht** dazu – diese könnten
genauso gut ein gemeinsam genutzter Staging-Cluster wie ein Laptop sein. Sie als lokal
zu behandeln, würde genau den versehentlichen Zugriff durchwinken, den das Gate
verhindern soll.

Setzen Sie `REBASE_MCP_ALLOW_REMOTE_WRITES=true`, um diesen Schutz zu deaktivieren.
Wenn Sie dies global in der Konfiguration Ihres MCP-Clients setzen, wird das Gate
für jedes Projekt entfernt, das der Server erreichen kann, nicht nur für dasjenige,
an das Sie gerade gedacht haben.

## Kennzeichnung nicht vertrauenswürdiger Daten

Zeilen, Benutzerdatensätze, Storage-Auflistungen, Cron-Jobs, Funktionsantworten
und CLI-Ausgaben werden in einem expliziten Envelope zurückgegeben:

```text
<<<UNTRUSTED_DATA source="list_documents" id="9b2f4c1e-…">>>
[ … rows … ]
<<<END_UNTRUSTED_DATA id="9b2f4c1e-…">>>
```

Alle in Ihrer Datenbank gespeicherten Daten wurden von irgendjemandem geschrieben,
und sie erreichen den Assistenten über denselben Kanal wie die Tool-Aufrufe, denen
er folgt. Der Envelope weist das Modell an, diese Daten als reinen Dateninhalt und
nicht als Instruktionen zu behandeln.

Die `id` wird für jede Antwort neu generiert, nachdem die Daten geschrieben wurden,
und nur der Endmarker mit dieser ID schließt den Block ab. Text innerhalb der Daten,
der wie ein Marker formatiert ist, wird durch ein breitenloses Leerzeichen unterbrochen,
sodass eine Zeile, die `<<<END_UNTRUSTED_DATA>>>` ausgibt, den Envelope nicht
vorzeitig beenden und den nachfolgenden Text nach außen verlagern kann.

Der [Remote-Endpunkt](#der-remote-endpunkt) umschließt seine Tool-Ergebnisse auf
dieselbe Weise und teilt dies dem Client mit; dessen `structuredContent` enthält
das reine Ergebnis.

Es handelt sich um eine Kennzeichnung, nicht um eine Sandbox. Ein Assistent mit
diesen Tools ist nur so sicher wie die Inhalte, die Sie ihn lesen lassen.

## Mehrere Projekte

Projektkonfigurationen werden in `~/.rebase/projects.json` gespeichert, und der
Server kann mehrere gleichzeitig verwalten – nützlich, wenn Sie über lokale und
entfernte Umgebungen hinweg arbeiten. Während `rebase dev` läuft, liest der Server
den aktiven Port und den Service-Key aus `.rebase/state.json` im Projektverzeichnis
aus, was den lokalen Fall zu einer Zero-Config-Lösung macht.

:::note[Die Registry hat das letzte Wort, nicht das erste]
Es gilt die oben genannte Rangfolge: Umgebungsblock, dann das Arbeitsverzeichnis,
sofern es eine `rebase.json` enthält, und schließlich das persistierte `default`.

`REBASE_PROJECT_DIR`, `REBASE_BASE_URL` und `REBASE_API_TOKEN` bauen das `default`-Projekt
**bei jedem Start** neu auf, nicht nur beim ersten. Dieser Neuaufbau betrifft den
gesamten Eintrag: Ein Token, das für das alte `projectDir` registriert war, wird
verworfen und nicht in ein Verzeichnis übernommen, für das es nie ausgestellt wurde.
Ein auf diese Weise – oder aus dem Arbeitsverzeichnis – abgeleitetes `default` wird
niemals zurück in `~/.rebase/projects.json` geschrieben, sodass der Dev-Service-Key
eines Projekts nicht fälschlicherweise für ein anderes verwendet werden kann.

`activeProject` ist persistent (sticky). Wenn also eine vorherige Sitzung
`rebase_project_switch` aufgerufen hat, richten sich die Tools nach diesem Projekt
und der Server gibt dies auf stderr aus – es sei denn, dieses Projekt ist unter einem
*anderen* Verzeichnis registriert als dem, in dem dieser Server läuft; in diesem Fall
fällt er auf `default` zurück und meldet dies. Wenn ein Assistent die falsche
Datenbank zu lesen scheint, rufen Sie zuerst `rebase_project_current` auf.
:::

Tokens werden in dieser Registry **im Klartext** gespeichert. Es handelt sich um eine
Datei in Ihrem Home-Verzeichnis, die Admin-Zugangsdaten für jedes registrierte Projekt
enthält; behandeln Sie sie entsprechend sorgfältig.

## Tool-Referenz

42 Tools in neun Gruppen: Schema & Datenbank, Schema-Planung, Dokumente, Benutzer
& Rollen, Storage, Cron, Funktionen, der Dev-Server und die Projekt-Registry.
Jedes einzelne – mit dem, was es benötigt, und ob das Gate es bei einem nicht
lokalen Ziel abweist – finden Sie in der
[MCP-Tool-Referenz](/docs/ai/mcp-tool-reference).

## Ressourcen

Neben Tools stellt der Server auch MCP-Ressourcen bereit, sodass ein Client
Projektkontext abrufen kann, ohne einen Tool-Aufruf zu verbrauchen:

| URI | Beschreibung |
|---|---|
| `rebase://collections/{name}` | TypeScript-Quellcode einer Collection-Definition |
| `rebase://schema` | Das generierte Drizzle-Schema (`schema.generated.ts`) |

Collections werden unter `app/config/collections/`, `config/collections/` oder
`collections/` im aktiven Projektverzeichnis erkannt – je nachdem, was existiert.

`rebase://schema` wird **nur dann** aufgeführt, wenn das generierte Schema existiert.
`findBackendDir` sucht unter dem aktiven Projektverzeichnis nach `backend/` und dann
nach `app/backend/` und liest `src/schema.generated.ts` aus dem Verzeichnis, das es
zuerst findet – somit funktionieren sowohl die standardmäßig generierte Struktur als
auch die dieses Monorepos. Bei einem Projekt mit abweichender Struktur oder einem, bei
dem `rebase schema generate` noch nicht ausgeführt wurde, wird die Ressource schlicht
nicht angeboten.

## Der Remote-Endpunkt

Alles oben Genannte ist ein Entwicklerwerkzeug: Es läuft auf Ihrem Rechner und
verfügt über einen Service-Key oder einen API-Key. Ein bereitgestelltes Backend kann
MCP auch selbst unter `/mcp` für die Personen bereitstellen, die Ihre Anwendung
nutzen. Ein Assistent, den eine dieser Personen verbindet, liest und schreibt das
Projekt **im Namen dieser Person**, und jeder Aufruf unterliegt deren eigener
Row-Level Security.

Die Funktion ist standardmäßig deaktiviert; beide Variablen sind erforderlich:

```bash
REBASE_MCP_ENABLED=true
REBASE_PUBLIC_URL=https://app.example.com   # this deployment's real origin
```

Ohne `REBASE_PUBLIC_URL`, ein JWT-Secret oder einen Datentreiber, der Abfragen auf
einen Benutzer beschränken kann, verweigert der Endpunkt das Einhängen (Mounting)
und gibt den Grund im Start-Log an. Keine `REBASE_ROLE` schaltet ihn ein.

- **OAuth mit Zustimmungsbildschirm (Consent Screen).** Ein Client findet den
  Autorisierungsserver über `/.well-known/oauth-protected-resource`, registriert
  sich selbst (dynamische Registrierung ist standardmäßig aktiviert;
  `REBASE_MCP_OPEN_REGISTRATION=false` beschränkt sie auf von Ihnen registrierte
  Clients) und leitet die Person zu einem Consent-Screen weiter, der sie über Ihr
  bestehendes `/auth/login` anmeldet.
- <span class="since-badge" data-since="0.24">Seit 0.24</span> **Sieben Tools, drei Scopes.** Dieselben [Scopes](/docs/backend/roles-and-scopes/),
  die jedes Credential verwendet. `data:read` bietet `list_collections`,
  `query_collection`, `count_documents` und `get_document`; `data:write` ergänzt `create_document` und
  `update_document`; `data:delete` ergänzt `delete_document`. Ein Client, der nichts
  anfordert, bekommt `data:read`. Jeder lässt sich auf eine Collection einschränken:
  `data:read:posts` listet und liest `posts` und sonst nichts. Ein Scope bestimmt,
  welche Tools angeboten werden und welche Collections sie erreichen, nicht welche
  Zeilen: Eine leere Liste kann bedeuten, dass RLS greift, und `data:write` kann
  dennoch keine Zeilen schreiben, auf die die Person keinen Zugriff hätte.
- **Vor 0.24 erteilte Grants behalten ihre Reichweite.** `mcp:read` wird als
  `data:read` gelesen und `mcp:write` als `data:write data:delete`, bei gespeicherten
  Grants und bei bereits ausgestellten Tokens.
- <span class="since-badge" data-since="0.24">Seit 0.24</span> **Auch ein API-Key funktioniert.** `/mcp` akzeptiert auch `Authorization: Bearer rk_…`,
  für einen Client, der mit einem Header statt mit einem OAuth-Flow konfiguriert ist.
  Der Key erreicht die Tools, die seine `data:*`-Scopes abdecken, als diejenige
  Identität, als die er handelt: ein
  [persönlicher Key](/docs/backend/api-keys/#personal-keys) als sein Eigentümer, ein
  Service-Key als `api-key:<id>`.
- **Das Vokabular des SDK, die Antworten von REST.** Die Tools nehmen entgegen, was
  auch das SDK entgegennimmt — `where` (`{"status": ["==", "paid"]}`), `orderBy`
  (`["created_at", "desc"]` oder `"created_at:desc"`), `limit`, `offset`,
  `searchString` und `data` für einen Schreibzugriff — und lesen über den Pfad von
  `GET /api/data/<collection>`, sodass eine Zeile so zurückkommt, wie REST sie
  ausliefert (ISO-Daten, ein `belongsTo` als sein Fremdschlüssel, z. B. `authorId`)
  und unverändert in einem Update zurückgeschickt werden kann. `query_collection`
  antwortet mit `{ data, meta }`, mit `meta.total` und `meta.hasMore`,
  `count_documents` mit `{ count }`, und `list_collections` mit dem OpenAPI-`row`-
  und `create`-Schema jeder Collection sowie `softDeleteField`, falls Zeilen in
  einen Papierkorb wandern. Wie bei REST werden ein `limit` über 1000, ein nicht
  deklariertes Argument sowie das Bearbeiten oder Löschen einer in den Papierkorb
  verschobenen Zeile (404) abgelehnt; das Setzen des Soft-Delete-Felds auf `null`
  stellt die Zeile wieder her.
- **Ein Token ausschließlich für diesen Endpunkt.** Ein MCP-Access-Token wird von
  `/api/data`, `/api/admin` und dem WebSocket abgelehnt; die Anbindung eines
  Assistenten übergibt ihm also keine reguläre Sitzung.

Eine Einschränkung: Das Trennen eines Clients (`DELETE /api/oauth/grants/:clientId`
mit der eigenen Sitzung der Person) widerruft dessen Refresh-Tokens sofort, aber ein
bereits ausgestelltes Access-Token bleibt bis zu seinem Ablauf innerhalb einer
Stunde gültig. Dieselbe Stunde begrenzt alles andere: Bei jedem Refresh werden die
Rollen der Person neu ausgelesen, und ein gelöschtes Konto oder ein Grant, der älter
ist als die letzte Passwortänderung oder Aktion „Überall abmelden“, wird abgewiesen.
Eine Herabstufung von Rechten oder eine Abmeldung erreicht einen verbundenen Client
somit innerhalb der Lebensdauer eines Access-Tokens. Eine Gast-Sitzung kann überhaupt
keine Zustimmung erteilen.

Die Routen finden Sie unter [Endpunkte](/docs/backend/endpoints/#mcp-surface) und die
Variablen unter [Konfiguration](/docs/getting-started/configuration/#mcp-surface).

## Empfohlenes Setup

- Richten Sie den Server auf ein **lokales** Projekt aus und lassen Sie
  `REBASE_MCP_ALLOW_REMOTE_WRITES` ungesetzt. Das Gate ist das wertvollste
  Sicherheitsfeature im Paket.
- Registrieren Sie für alle Remote-Umgebungen einen **eingeschränkten `rk_`-API-Key**,
  anstatt der automatischen Erkennung die Übergabe eines Service-Keys zu überlassen.
- Überprüfen Sie `rebase_project_current`, wenn die Ausgaben unerwartet aussehen.
  Das aktive Projekt ist sitzungsübergreifend gespeichert (sticky) und liegt außerhalb
  Ihres Repositories.
- Behandeln Sie `~/.rebase/projects.json` wie eine Datei für vertrauliche Zugangsdaten.
