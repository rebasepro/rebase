---
title: MCP-Tool-Referenz
sidebar_label: MCP-Tool-Referenz
description: Jedes Tool, das der Rebase-MCP-Server registriert, nach Gruppe – was jedes einzelne benötigt und tut, und welche das Loopback-Gate bei einem nicht lokalen Projekt abweist.
---

Die Tools, die [`@rebasepro/mcp`](/docs/ai/mcp) einem Assistenten bereitstellt.
Wie er sich verbindet, welches Credential er hält und wie das
[Loopback-Gate](/docs/ai/mcp#the-loopback-gate) entscheidet, was ⚠ bedeutet,
steht auf der Seite [MCP-Server](/docs/ai/mcp).

42 Tools in neun Gruppen. Mit ⚠ markierte Tools werden bei Zielen außerhalb von
localhost abgewiesen, sofern Sie dies nicht explizit erlauben.

## Schema & Datenbank (12)

Startet die Rebase-CLI im aktiven Projektverzeichnis.

| Tool | Erforderlich | Beschreibung |
|---|---|---|
| `rebase_schema_generate` | — | Drizzle-Schema aus Collection-Definitionen generieren |
| `rebase_db_push` ⚠ | — | Schema direkt auf die Datenbank anwenden (Dev-Shortcut) |
| `rebase_schema_introspect` | — | Live-Datenbank in Collection-Definitionen introspektieren |
| `rebase_db_generate` | — | SQL-Migrationsdateien aus Schema-Änderungen generieren |
| `rebase_db_migrate` ⚠ | — | Alle ausstehenden SQL-Migrationen ausführen |
| `rebase_generate_sdk` | — | Vollständig typisiertes TypeScript-SDK generieren |
| `rebase_doctor` | — | Drift zwischen Definitionen, generiertem Schema und der Live-Datenbank erkennen |
| `rebase_db_branch_create` ⚠ | `name` | Datenbank-Branch erstellen (nur Admins) |
| `rebase_db_branch_list` | — | Datenbank-Branches auflisten (nur Admins) |
| `rebase_db_branch_delete` ⚠ | `name` | Datenbank-Branch löschen (nur Admins) |
| `rebase_db_branch_info` | `name` | Branch-Informationen und -Status (nur Admins) |
| `rebase_db_branch_switch` | — | Dieses Checkout auf einen Branch oder zurück auf die Hauptdatenbank verweisen lassen (nur Admins) |

## Schema-Planung (1)

Fragt das Backend über `POST /api/admin/schema/plan`, was eine Änderung bewirken
würde. Keine CLI und nichts wird auf die Festplatte geschrieben – funktioniert auf
der verwalteten Entwicklungsdatenbank, was die Atlas-basierten Befehle nicht können.

| Tool | Erforderlich | Beschreibung |
|---|---|---|
| `rebase_schema_plan` | `collectionId`, `collection` | Das SQL, das die Änderung einer Collection ausführen würde, und welche Anweisungen Daten zerstören |

## Dokumente (5)

| Tool | Erforderlich | Beschreibung |
|---|---|---|
| `list_documents` | `collection` | Zeilen auflisten, mit optionalem `limit`, `offset`, `orderBy`, `where` |
| `get_document` | `collection`, `id` | Einzelne Zeile anhand der ID abrufen |
| `create_document` ⚠ | `collection`, `data` | Zeile erstellen |
| `update_document` ⚠ | `collection`, `id`, `data` | Zeile aktualisieren |
| `delete_document` ⚠ | `collection`, `id` | Zeile löschen |

## Benutzer & Rollen (6)

| Tool | Erforderlich | Beschreibung |
|---|---|---|
| `list_users` | — | Alle Benutzer inklusive Rollen auflisten |
| `create_user` ⚠ | `email` | Benutzer erstellen (optional `displayName`, `password`, `roles`) |
| `update_user` ⚠ | `uid` | E-Mail, Anzeigename oder Rollen aktualisieren |
| `delete_user` ⚠ | `uid` | Benutzer löschen |
| `list_roles` | — | Definierte Rollen auflisten |
| `rebase_auth_reset_password` ⚠ | `email` | Passwort über die Admin-API zurücksetzen |

`create_user` und `update_user` akzeptieren beide `roles`, sodass beide einen
Administrator anlegen können. Aus diesem Grund sind sie durch das Gate geschützt und
werden nicht lediglich als „hinzufügend“ eingestuft.

## Storage (3)

| Tool | Erforderlich | Beschreibung |
|---|---|---|
| `storage_list_objects` | — | Gespeicherte Objekte auflisten |
| `storage_get_download_url` | `key` | Temporäre signierte Download-URL und deren Ablaufzeit – keine Objekt-Metadaten |
| `storage_delete_object` ⚠ | `key` | Ein Objekt löschen |

`storage_get_download_url` wird als Lesezugriff eingestuft, da es die Umgebung nicht
verändert – die erzeugte signierte URL ist jedoch eine Inhaberberechtigung (Bearer Capability),
die den eigentlichen Tool-Aufruf überdauert.

## Cron (5)

| Tool | Erforderlich | Beschreibung |
|---|---|---|
| `cron_list_jobs` | — | Geplante Jobs und deren Status auflisten |
| `cron_get_job` | `jobId` | Job-Details |
| `cron_get_job_logs` | `jobId` | Ausführungsprotokolle |
| `cron_trigger_job` ⚠ | `jobId` | Einen Job sofort ausführen |
| `cron_toggle_job` ⚠ | `jobId`, `enabled` | Einen Job aktivieren oder deaktivieren |

`cron_toggle_job` kann lautlos ein Backup oder einen Abrechnungs-Job deaktivieren –
eine Änderung ohne Fehlermeldung und ohne Ausgabe, bis später etwas fehlt.

## Funktionen (1)

| Tool | Erforderlich | Beschreibung |
|---|---|---|
| `invoke_function` ⚠ | `name` | Eine [benutzerdefinierte Funktion](/docs/backend/custom-functions) mit beliebiger Methode und Payload aufrufen |

Dies ruft Code auf, den der MCP-Server nie gesehen hat, mit einer vom Modell gewählten
Methode und einem entsprechenden Body. Der Auswirkungsbereich (Blast Radius) entspricht
dem, was Ihre Funktionen tun.

## Dev-Server (3)

| Tool | Erforderlich | Beschreibung |
|---|---|---|
| `rebase_dev_start` | — | Dev-Server starten; kehrt sofort zurück |
| `rebase_dev_logs` | — | Aktuelle Ausgaben lesen (Standard: 50 Zeilen, Puffer von 500 Zeilen) |
| `rebase_dev_stop` | — | Dev-Server stoppen |

## Projekt-Registry (6)

| Tool | Erforderlich | Beschreibung |
|---|---|---|
| `rebase_project_list` | — | Registrierte Projekte auflisten und das aktive anzeigen |
| `rebase_project_switch` | `name` | Aktives Projekt wechseln |
| `rebase_project_add` | `name` | Projekt registrieren (`baseUrl`, optional `projectDir`, `token`) |
| `rebase_project_remove` | `name` | Projekt entfernen (das Standardprojekt kann nicht entfernt werden) |
| `rebase_project_current` | — | Aktives Projekt und dessen Authentifizierungsstatus anzeigen |
| `rebase_project_status` | — | Health-Check für das aktive Backend durchführen |

`rebase_project_switch` ist nicht durch das Gate beschränkt, da es lediglich das
Ziel für alles Weitere ändert, anstatt selbst Aktionen auf einem Ziel auszuführen.
Ein Assistent kann daher zu einem Remote-Projekt wechseln, ohne das Gate auszulösen –
er kann dort anschließend lediglich keine destruktiven Tools ausführen.
