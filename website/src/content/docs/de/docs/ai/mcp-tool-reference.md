---
sourceHash: 53d5e75acc2383a2
title: MCP-Tool-Referenz
sidebar_label: MCP-Tool-Referenz
description: Alle Tools, die der Rebase-MCP-Server registriert, nach Gruppen – was jedes Tool benötigt und tut, und welche davon das Loopback-Gate bei nicht-lokalen Projekten verweigert.
---

Die Tools, die [`@rebasepro/mcp`](/docs/ai/mcp) einem Assistenten bietet. Wie er sich verbindet, welche Anmeldedaten er besitzt und wie das [Loopback-Gate](/docs/ai/mcp#the-loopback-gate) entscheidet, was ⚠ bedeutet, ist auf der Seite [MCP-Server](/docs/ai/mcp) beschrieben.

53 Tools in zehn Gruppen. Mit ⚠ markierte Tools werden bei nicht-lokalen Zielen verweigert, es sei denn, Sie entscheiden sich dagegen (Opt-out).

## Schema & Datenbank (13)

Führt die Rebase-CLI im aktiven Projektverzeichnis aus.

| Tool | Erforderlich | Beschreibung |
|---|---|---|
| `rebase_schema_generate` | — | Generiert das Drizzle-Schema aus den Tabellen in `backend/schema` |
| `rebase_db_push` ⚠ | — | Wendet das Schema direkt auf die Datenbank an (Entwicklungs-Shortcut) |
| `rebase_schema_introspect` | — | Schreibt ein `defineTable` in `backend/schema` für jede Tabelle, die die Live-Datenbank enthält |
| `rebase_db_generate` | — | Generiert SQL-Migrationsdateien aus Schemaänderungen |
| `rebase_db_migrate` ⚠ | — | Führt alle ausstehenden SQL-Migrationen aus |
| `rebase_generate_sdk` | — | Generiert das vollständig typisierte TypeScript-SDK |
| `rebase_doctor` | — | Erkennt Abweichungen (Drift) zwischen den Tabellen in `backend/schema`, dem generierten Schema und der Live-Datenbank |
| `rebase_db_branch_create` ⚠ | `name` | Erstellt einen Datenbank-Branch (nur Admins) |
| `rebase_db_branch_list` | — | Listet Datenbank-Branches auf (nur Admins) |
| `rebase_db_branch_delete` ⚠ | `name` | Löscht einen Datenbank-Branch (nur Admins) |
| `rebase_db_branch_info` | `name` | Branch-Informationen und -Status (nur Admins) |
| `rebase_db_branch_diff` | `name` | Was ein Branch gegenüber der Datenbank geändert hat, von der er erstellt wurde – Schema, Richtlinien und Zeilen, einschließlich Konflikten; ändert keines von beiden (nur Admins) |
| `rebase_db_branch_switch` | — | Richtet diesen Checkout auf einen Branch oder zurück auf die Hauptdatenbank aus (nur Admins) |

## Schemaplanung (1)

Fragt das Backend über `POST /api/admin/schema/plan`, was eine Änderung bewirken würde. Keine CLI und nichts wird auf die Festplatte geschrieben – es funktioniert auf der verwalteten Entwicklungsdatenbank, was die Atlas-basierten Befehle nicht können.

| Tool | Erforderlich | Beschreibung |
|---|---|---|
| `rebase_schema_plan` | `patches` | Das SQL, das eine Liste von `TablePatch`-Änderungen ausführen würde, und welche Anweisungen Daten zerstören – siehe [Live-Schemabearbeitung](/docs/backend/live-schema-editing/#the-edits-tablepatch) |

## Zeilen (5)

Dieselben Namen, die das Remote-`/mcp` verwendet; zuvor hießen sie `list_documents`, `get_document`, `create_document`, `update_document` und `delete_document` mit einem `collection`-Argument.

| Tool | Erforderlich | Beschreibung |
|---|---|---|
| `query_table` | `table` | Zeilen lesen, mit optionalem `limit`, `offset`, `orderBy`, `where`, wie es `data.table(name).find()` tut |
| `get_row` | `table`, `id` | Eine einzelne Zeile anhand der ID abrufen |
| `create_row` ⚠ | `table`, `data` | Eine Zeile erstellen |
| `update_row` ⚠ | `table`, `id`, `data` | Eine Zeile aktualisieren; nur die angegebenen Spalten werden geändert |
| `delete_row` ⚠ | `table`, `id` | Eine Zeile löschen |

## Benutzer & Rollen (6)

| Tool | Erforderlich | Beschreibung |
|---|---|---|
| `list_users` | — | Alle Benutzer auflisten, einschließlich Rollen |
| `create_user` ⚠ | `email` | Einen Benutzer erstellen (optional `displayName`, `password`, `roles`) |
| `update_user` ⚠ | `uid` | E-Mail, Anzeigename oder Rollen aktualisieren |
| `delete_user` ⚠ | `uid` | Einen Benutzer löschen |
| `list_roles` | — | Definierte Rollen auflisten |
| `rebase_auth_reset_password` ⚠ | `email` | Ein Passwort über die Admin-API zurücksetzen |

`create_user` und `update_user` akzeptieren beide `roles`, sodass beide einen Admin erzeugen können. Aus diesem Grund werden sie vom Gate abgefangen, anstatt lediglich als „additiv“ behandelt zu werden.

## Storage (3)

| Tool | Erforderlich | Beschreibung |
|---|---|---|
| `storage_list_objects` | — | Gespeicherte Objekte auflisten |
| `storage_get_download_url` | `key` | Eine temporäre signierte Download-URL und deren Ablaufzeit – keine Objektmetadaten |
| `storage_delete_object` ⚠ | `key` | Ein Objekt löschen |

`storage_get_download_url` wird als Leseoperation eingestuft, da sie die Umgebung nicht verändert – aber die erzeugte signierte URL ist eine Inhaberberechtigung (Bearer Capability), die den Tool-Aufruf überdauert.

## Cron (5)

| Tool | Erforderlich | Beschreibung |
|---|---|---|
| `cron_list_jobs` | — | Geplante Jobs und deren Status auflisten |
| `cron_get_job` | `jobId` | Jobdetails |
| `cron_get_job_logs` | `jobId` | Ausführungsprotokolle |
| `cron_trigger_job` ⚠ | `jobId` | Einen Job sofort ausführen |
| `cron_toggle_job` ⚠ | `jobId`, `enabled` | Einen Job aktivieren oder deaktivieren |

`cron_toggle_job` kann ein Backup oder einen Abrechnungsjob lautlos deaktivieren – eine Änderung ohne Fehler und ohne Ausgabe, bis später etwas fehlt.

## Funktionen (1)

| Tool | Erforderlich | Beschreibung |
|---|---|---|
| `invoke_function` ⚠ | `name` | Eine [benutzerdefinierte Funktion](/docs/backend/custom-functions) mit beliebiger Methode und Payload aufrufen |

Dies ruft Code auf, den der MCP-Server noch nie gesehen hat, mit einer Methode und einem Body, die das Modell ausgewählt hat. Der Wirkungsbereich (Blast Radius) entspricht allem, was Ihre Funktionen tun.

## Dev-Server (3)

| Tool | Erforderlich | Beschreibung |
|---|---|---|
| `rebase_dev_start` | — | Den Dev-Server starten; kehrt sofort zurück |
| `rebase_dev_logs` | — | Aktuelle Ausgaben lesen (Standard 50 Zeilen, 500-Zeilen-Puffer) |
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
| `rebase_project_use_cloud` | `project` | Ein Rebase-Cloud-Projekt des angemeldeten Kontos nach ID, Slug oder Name über den Studio-Proxy der Konsole ansteuern |

`rebase_project_switch` wird nicht durch das Gate eingeschränkt, da es lediglich das Ziel für alles andere ändert, anstatt selbst Aktionen auf einem Ziel auszuführen. Ein Assistent kann daher zu einem Remote-Projekt wechseln, ohne das Gate auszulösen – er kann dort dann lediglich keine destruktiven Tools ausführen. `rebase_project_use_cloud` ist die gleiche Art von Umschaltung: Es richtet die Daten- und Admin-Tools auf ein Produktionsprojekt aus, bei dem Leseoperationen funktionieren und das Gate Schreiboperationen verweigert.

## Rebase Cloud (9)

Führt `rebase cloud … --json` im aktiven Projektverzeichnis für das verknüpfte Projekt mit den CLI-eigenen Anmeldedaten aus. Unter [Rebase Cloud](/docs/ai/mcp#rebase-cloud) erfahren Sie, worauf sie einwirken und warum keines davon durch das Gate eingeschränkt wird.

| Tool | Erforderlich | Beschreibung |
|---|---|---|
| `rebase_cloud_provision` | — | Ein Live-Backend ohne Konto (`rebase cloud init --claim`): die Live-URL, die Admin-URL und eine Claim-URL (`name`, `deploy`, `confirm`). Ohne `confirm: true` gibt es nur an, was es tun würde |
| `rebase_cloud_status` | — | URL, Status, letztes Deployment, Runtime, Datenbank, Storage des verknüpften Projekts sowie dessen Claim-URL, solange es noch nicht beansprucht wurde |
| `rebase_cloud_deploy` | — | Bereitstellen und bis zum Ende verfolgen (`app`, `bundle`, `message`, `wait`, `timeoutSeconds`, `preview`, `previewName`, `confirm`). Ein Produktions-Deploy ohne `confirm: true` gibt nur an, was es tun würde |
| `rebase_cloud_logs` | — | Ein Snapshot des Runtime-Logs oder das neueste Build-Log (`source`, `since`, `tail`, `grep`, `level`, `previous`, `preview`). Folgt niemals live |
| `rebase_cloud_env_list` | — | Variablenschlüssel, niemals Werte (`preview`) |
| `rebase_cloud_env_set` | `key`, `value` | Eine Variable setzen; der Wert wird über stdin übergeben und niemals zurückgegeben (`secret`, `preview`, `confirm`). In der Produktion gibt es ohne `confirm: true` nur an, was es tun würde |
| `rebase_cloud_deployments_list` | — | Kürzliche Deployments und welche davon für ein Rollback infrage kommen (`limit`) |
| `rebase_cloud_projects_list` | — | Jedes Projekt, auf das das angemeldete Konto über alle seine Organisationen hinweg zugreifen kann |
| `rebase_cloud_rollback` | — | Ein früheres erfolgreiches Deployment wieder in Betrieb nehmen (`deploymentId`, `confirm`). Ohne `confirm: true` gibt es nur an, was es tun würde |

`rebase_cloud_provision` erstellt ein Projekt und verknüpft dieses Verzeichnis. Es liest niemals die `baseUrl` des aktiven Projekts, sodass das Gate dies nicht prüft; die CLI verweigert den Befehl in einem Verzeichnis, das bereits verknüpft ist.
