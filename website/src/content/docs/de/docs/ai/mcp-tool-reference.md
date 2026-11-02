---
sourceHash: c7ba0e6c6150d210
title: MCP-Tool-Referenz
sidebar_label: MCP-Tool-Referenz
description: Jedes vom Rebase-MCP-Server registrierte Tool nach Gruppen geordnet – was jedes benötigt und tut, und welche das Loopback-Gate bei einem nicht-lokalen Projekt verweigert.
---

Die Tools, die [`@rebasepro/mcp`](/docs/ai/mcp) einem Assistenten bietet. Wie die Verbindung hergestellt wird, welche Anmeldeinformationen verwendet werden und wie das [Loopback-Gate](/docs/ai/mcp#the-loopback-gate) entscheidet, was ⚠ bedeutet, erfahren Sie auf der Seite [MCP-Server](/docs/ai/mcp).

53 Tools in zehn Gruppen. Mit ⚠ markierte Tools werden bei nicht-lokalen Zielen verweigert, es sei denn, Sie deaktivieren diese Einschränkung (Opt-out).

## Schema & Datenbank (13)

Startet die Rebase-CLI im aktiven Projektverzeichnis.

| Tool | Erforderlich | Beschreibung |
|---|---|---|
| `rebase_schema_generate` | — | Drizzle-Schema aus Collection-Definitionen generieren |
| `rebase_db_push` ⚠ | — | Das Schema direkt auf die Datenbank anwenden (Dev-Shortcut) |
| `rebase_schema_introspect` | — | Live-Datenbank in Collection-Definitionen introspektieren |
| `rebase_db_generate` | — | SQL-Migrationsdateien aus Schema-Änderungen generieren |
| `rebase_db_migrate` ⚠ | — | Alle ausstehenden SQL-Migrationen ausführen |
| `rebase_generate_sdk` | — | Das vollständig typisierte TypeScript-SDK generieren |
| `rebase_doctor` | — | Drift zwischen Definitionen, generiertem Schema und der Live-Datenbank erkennen |
| `rebase_db_branch_create` ⚠ | `name` | Einen Datenbank-Branch erstellen (nur Admins) |
| `rebase_db_branch_list` | — | Datenbank-Branches auflisten (nur Admins) |
| `rebase_db_branch_delete` ⚠ | `name` | Einen Datenbank-Branch löschen (nur Admins) |
| `rebase_db_branch_info` | `name` | Branch-Informationen und -Status (nur Admins) |
| `rebase_db_branch_diff` | `name` | Was ein Branch im Vergleich zur Datenbank geändert hat, aus der er erstellt wurde – Schema, Richtlinien und Zeilen, mit Konflikten; ändert keines von beiden (nur Admins) |
| `rebase_db_branch_switch` | — | Diesen Checkout auf einen Branch oder zurück auf die Hauptdatenbank verweisen (nur Admins) |

## Schema-Planung (1)

Fragt über `POST /api/admin/schema/plan` beim Backend an, was eine Änderung bewirken würde. Keine CLI und nichts wird auf die Festplatte geschrieben – es funktioniert auf der verwalteten Entwicklungsdatenbank, was die Atlas-gestützten Befehle nicht können.

| Tool | Erforderlich | Beschreibung |
|---|---|---|
| `rebase_schema_plan` | `collectionId`, `collection` | Das SQL, das die Änderung einer Collection ausführen würde, und welche Anweisungen Daten zerstören |

## Dokumente (5)

| Tool | Erforderlich | Beschreibung |
|---|---|---|
| `list_documents` | `collection` | Zeilen auflisten, mit optionalen Parametern `limit`, `offset`, `orderBy`, `where` |
| `get_document` | `collection`, `id` | Eine einzelne Zeile nach ID abrufen |
| `create_document` ⚠ | `collection`, `data` | Eine Zeile erstellen |
| `update_document` ⚠ | `collection`, `id`, `data` | Eine Zeile aktualisieren |
| `delete_document` ⚠ | `collection`, `id` | Eine Zeile löschen |

## Benutzer & Rollen (6)

| Tool | Erforderlich | Beschreibung |
|---|---|---|
| `list_users` | — | Alle Benutzer auflisten, einschließlich Rollen |
| `create_user` ⚠ | `email` | Einen Benutzer erstellen (optional `displayName`, `password`, `roles`) |
| `update_user` ⚠ | `uid` | E-Mail, Anzeigenamen oder Rollen aktualisieren |
| `delete_user` ⚠ | `uid` | Einen Benutzer löschen |
| `list_roles` | — | Definierte Rollen auflisten |
| `rebase_auth_reset_password` ⚠ | `email` | Ein Passwort über die Admin-API zurücksetzen |

Sowohl `create_user` als auch `update_user` akzeptieren `roles`, sodass beide einen Admin erstellen können. Aus diesem Grund sind sie durch das Gate geschützt und werden nicht bloß als „additiv“ behandelt.

## Storage (3)

| Tool | Erforderlich | Beschreibung |
|---|---|---|
| `storage_list_objects` | — | Gespeicherte Objekte auflisten |
| `storage_get_download_url` | `key` | Eine temporäre signierte Download-URL und deren Ablaufzeit – keine Objekt-Metadaten |
| `storage_delete_object` ⚠ | `key` | Ein Objekt löschen |

`storage_get_download_url` wird als Leseoperation eingestuft, da es die Umgebung nicht verändert – die erzeugte signierte URL ist jedoch eine Inhaber-Berechtigung (Bearer Capability), die den Tool-Aufruf überdauert.

## Cron (5)

| Tool | Erforderlich | Beschreibung |
|---|---|---|
| `cron_list_jobs` | — | Geplante Jobs und deren Status auflisten |
| `cron_get_job` | `jobId` | Job-Details |
| `cron_get_job_logs` | `jobId` | Ausführungsprotokolle |
| `cron_trigger_job` ⚠ | `jobId` | Einen Job sofort ausführen |
| `cron_toggle_job` ⚠ | `jobId`, `enabled` | Einen Job aktivieren oder deaktivieren |

`cron_toggle_job` kann ein Backup oder einen Abrechnungs-Job stillschweigend deaktivieren – eine Änderung ohne Fehler und ohne Ausgabe, bis später etwas fehlt.

## Funktionen (1)

| Tool | Erforderlich | Beschreibung |
|---|---|---|
| `invoke_function` ⚠ | `name` | Eine [benutzerdefinierte Funktion](/docs/backend/custom-functions) mit beliebiger Methode und Payload aufrufen |

Dies ruft Code auf, den der MCP-Server noch nie gesehen hat, mit einer Methode und einem Body, die das Modell ausgewählt hat. Der Explosionsradius entspricht dem, was Ihre Funktionen tun.

## Dev-Server (3)

| Tool | Erforderlich | Beschreibung |
|---|---|---|
| `rebase_dev_start` | — | Den Dev-Server starten; kehrt sofort zurück |
| `rebase_dev_logs` | — | Aktuelle Ausgaben lesen (Standard: 50 Zeilen, 500-Zeilen-Puffer) |
| `rebase_dev_stop` | — | Den Dev-Server stoppen |

## Projekt-Registry (7)

| Tool | Erforderlich | Beschreibung |
|---|---|---|
| `rebase_project_list` | — | Registrierte Projekte auflisten und das aktive anzeigen |
| `rebase_project_switch` | `name` | Das aktive Projekt wechseln |
| `rebase_project_add` | `name` | Ein Projekt registrieren (optional `projectDir`, `baseUrl`, `token`) |
| `rebase_project_remove` | `name` | Ein Projekt entfernen (das Standardprojekt kann nicht entfernt werden) |
| `rebase_project_current` | — | Das aktive Projekt und seinen Auth-Status anzeigen |
| `rebase_project_status` | — | Health-Check des aktiven Backends durchführen |
| `rebase_project_use_cloud` | `project` | Ein Rebase-Cloud-Projekt des angemeldeten Kontos per ID, Slug oder Name über den Studio-Proxy der Konsole ansteuern |

`rebase_project_switch` ist nicht durch das Gate geschützt, da es alle anderen Aktionen neu ausrichtet, anstatt selbst Aktionen auf einem Ziel auszuführen. Ein Assistent kann daher zu einem Remote-Projekt wechseln, ohne das Gate auszulösen – er kann dort anschließend lediglich keine destruktiven Tools ausführen. `rebase_project_use_cloud` ist eine ähnliche Umschaltung: Es verweist die Daten- und Admin-Tools auf ein Produktionsprojekt, bei dem Lesezugriffe funktionieren und das Gate Schreibzugriffe verweigert.

## Rebase Cloud (9)

Führt `rebase cloud … --json` im aktiven Projektverzeichnis für das verknüpfte Projekt mit den CLI-eigenen Anmeldeinformationen aus. Siehe [Rebase Cloud](/docs/ai/mcp#rebase-cloud) dafür, worauf sie wirken und warum keines von ihnen durch das Gate geschützt ist.

| Tool | Erforderlich | Beschreibung |
|---|---|---|
| `rebase_cloud_provision` | — | Ein Live-Backend ohne Konto (`rebase cloud init --claim`): die Live-URL, die Admin-URL und eine Claim-URL (`name`, `deploy`) |
| `rebase_cloud_status` | — | URL, Status, letztes Deployment, Runtime, Datenbank, Storage und die Claim-URL des verknüpften Projekts, solange es noch nicht beansprucht wurde |
| `rebase_cloud_deploy` | — | Bereitstellen und bis zum Ende verfolgen (`app`, `bundle`, `message`, `wait`, `timeoutSeconds`, `preview`, `previewName`) |
| `rebase_cloud_logs` | — | Ein Snapshot des Runtime-Logs oder des neuesten Build-Logs (`source`, `since`, `tail`, `grep`, `level`, `previous`, `preview`). Verfolgt nicht kontinuierlich |
| `rebase_cloud_env_list` | — | Variablenschlüssel, niemals Werte (`preview`) |
| `rebase_cloud_env_set` | `key`, `value` | Eine Variable setzen; der Wert wird über stdin übergeben und niemals zurückgegeben (`secret`, `preview`) |
| `rebase_cloud_deployments_list` | — | Letzte Deployments und auf welche davon zurückgesetzt werden kann (`limit`) |
| `rebase_cloud_projects_list` | — | Jedes Projekt, das das angemeldete Konto erreichen kann, über alle seine Organisationen hinweg |
| `rebase_cloud_rollback` | — | Ein früheres erfolgreiches Deployment wieder in Betrieb nehmen (`deploymentId`) |

`rebase_cloud_provision` erstellt ein Projekt und verknüpft dieses Verzeichnis. Es liest niemals die `baseUrl` des aktiven Projekts, weshalb das Gate es nicht prüft; die CLI verweigert den Befehl in einem Verzeichnis, das bereits verknüpft ist.
