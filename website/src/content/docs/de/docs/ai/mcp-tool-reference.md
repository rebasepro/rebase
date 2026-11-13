---
sourceHash: 50d3082d86c52ae2
title: MCP-Tool-Referenz
sidebar_label: MCP-Tool-Referenz
description: Alle vom Rebase-MCP-Server registrierten Tools nach Gruppen geordnet – was jedes einzelne benötigt und tut, und welche das Loopback-Gate bei einem nicht-lokalen Projekt verweigert.
---

Die Tools, die [`@rebasepro/mcp`](/docs/ai/mcp) einem Assistenten bereitstellt. Wie er sich verbindet,
welche Anmeldeinformationen er besitzt und wie das [Loopback-Gate](/docs/ai/mcp#the-loopback-gate)
entscheidet, was ⚠ bedeutet, erfahren Sie auf der Seite [MCP-Server](/docs/ai/mcp).

53 Tools in zehn Gruppen. Mit ⚠ markierte Tools werden bei nicht-lokalen Zielen
verweigert, sofern Sie dies nicht explizit deaktivieren.

## Schema & Datenbank (13)

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Startet die Rebase-CLI im aktiven Projektverzeichnis.

| Tool | Erforderlich | Beschreibung |
|---|---|---|
| `rebase_schema_generate` | — | Generiert das Drizzle-Schema aus den Tabellen in `backend/schema` |
| `rebase_db_push` ⚠ | — | Wendet das Schema direkt auf die Datenbank an (Entwicklungs-Shortcut) |
| `rebase_schema_introspect` | — | Schreibt für jede Tabelle in der Live-Datenbank ein `defineTable` in `backend/schema` |
| `rebase_db_generate` | — | Erzeugt SQL-Migrationsdateien aus Schemaänderungen |
| `rebase_db_migrate` ⚠ | — | Führt alle ausstehenden SQL-Migrationen aus |
| `rebase_generate_sdk` | — | Generiert das voll typisierte TypeScript-SDK |
| `rebase_doctor` | — | Erkennt Abweichungen (Drift) zwischen den Tabellen in `backend/schema`, dem generierten Schema und der Live-Datenbank |
| `rebase_db_branch_create` ⚠ | `name` | Erstellt einen Datenbank-Branch (nur Admins) |
| `rebase_db_branch_list` | — | Listet Datenbank-Branches auf (nur Admins) |
| `rebase_db_branch_delete` ⚠ | `name` | Löscht einen Datenbank-Branch (nur Admins) |
| `rebase_db_branch_info` | `name` | Branch-Informationen und -Status (nur Admins) |
| `rebase_db_branch_diff` | `name` | Zeigt an, was ein Branch im Vergleich zu der Datenbank geändert hat, von der er erstellt wurde – Schema, Richtlinien und Zeilen, einschließlich Konflikten; ändert keines von beiden (nur Admins) |
| `rebase_db_branch_switch` | — | Weist diesen Checkout einem Branch oder wieder der Hauptdatenbank zu (nur Admins) |

## Schema-Planung (1)

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Fragt das Backend über `POST /api/admin/schema/plan`, welche Auswirkungen eine Änderung hätte. Keine
CLI und keine Schreibvorgänge auf der Festplatte – dies funktioniert auf der verwalteten Entwicklungsdatenbank,
was die Atlas-basierten Befehle nicht können.

| Tool | Erforderlich | Beschreibung |
|---|---|---|
| `rebase_schema_plan` | `patches` | Das SQL, das eine Liste von `TablePatch`-Änderungen ausführen würde, und welche Anweisungen Daten zerstören – siehe [Live-Schema-Bearbeitung](/docs/backend/live-schema-editing/#the-edits-tablepatch) |

## Zeilen (5)

<span class="since-badge" data-since="0.31">Seit 0.31</span> Dieselben Namen, die auch das Remote-`/mcp` verwendet; zuvor hießen sie `list_documents`, `get_document`, `create_document`, `update_document` und `delete_document` mit einem `collection`-Argument.

| Tool | Erforderlich | Beschreibung |
|---|---|---|
| `query_table` | `table` | Zeilen lesen, mit optionalem `limit`, `offset`, `orderBy`, `where`, wie `data.table(name).find()` es tut |
| `get_row` | `table`, `id` | Eine einzelne Zeile anhand der ID abrufen |
| `create_row` ⚠ | `table`, `data` | Eine Zeile erstellen |
| `update_row` ⚠ | `table`, `id`, `data` | Eine Zeile aktualisieren; nur die angegebenen Spalten werden geändert |
| `delete_row` ⚠ | `table`, `id` | Eine Zeile löschen |

## Benutzer & Rollen (6)

| Tool | Erforderlich | Beschreibung |
|---|---|---|
| `list_users` | — | Alle Benutzer auflisten, einschließlich Rollen |
| `create_user` ⚠ | `email` | Einen Benutzer erstellen (optional `displayName`, `password`, `roles`) |
| `update_user` ⚠ | `uid` | E-Mail, Anzeigenamen oder Rollen aktualisieren |
| `delete_user` ⚠ | `uid` | Einen Benutzer löschen |
| `list_roles` | — | Definierte Rollen auflisten |
| `rebase_auth_reset_password` ⚠ | `email` | Ein Passwort über die Admin-API zurücksetzen |

Sowohl `create_user` als auch `update_user` akzeptieren `roles`, sodass beide einen
Admin erzeugen können. Aus diesem Grund sind sie geschützt (gated), anstatt nur als „additiv“ behandelt zu werden.

## Storage (3)

| Tool | Erforderlich | Beschreibung |
|---|---|---|
| `storage_list_objects` | — | Gespeicherte Objekte auflisten |
| `storage_get_download_url` | `key` | Eine temporäre signierte Download-URL und deren Ablaufzeit – keine Objekt-Metadaten |
| `storage_delete_object` ⚠ | `key` | Ein Objekt löschen |

`storage_get_download_url` wird als Lesevorgang eingestuft, da es die
Umgebung nicht verändert – aber die signierte URL, die es generiert, ist eine Inhaberberechtigung (Bearer Capability), die
den Tool-Aufruf überdauert.

## Cron (5)

| Tool | Erforderlich | Beschreibung |
|---|---|---|
| `cron_list_jobs` | — | Geplante Jobs und deren Status auflisten |
| `cron_get_job` | `jobId` | Job-Details |
| `cron_get_job_logs` | `jobId` | Ausführungsprotokolle |
| `cron_trigger_job` ⚠ | `jobId` | Einen Job sofort ausführen |
| `cron_toggle_job` ⚠ | `jobId`, `enabled` | Einen Job aktivieren oder deaktivieren |

`cron_toggle_job` kann ein Backup oder einen Abrechnungs-Job stillschweigend deaktivieren – eine Änderung
ohne Fehlermeldung und ohne Ausgabe, bis später etwas fehlt.

## Funktionen (1)

| Tool | Erforderlich | Beschreibung |
|---|---|---|
| `invoke_function` ⚠ | `name` | Eine [benutzerdefinierte Funktion](/docs/backend/custom-functions) mit beliebiger Methode und Payload aufrufen |

Dies ruft Code auf, den der MCP-Server noch nie gesehen hat, mit einer vom Modell
gewählten Methode und einem Body. Der Schadensradius entspricht dem, was Ihre Funktionen tun.

## Dev-Server (3)

| Tool | Erforderlich | Beschreibung |
|---|---|---|
| `rebase_dev_start` | — | Startet den Dev-Server; kehrt sofort zurück |
| `rebase_dev_logs` | — | Liest die letzte Ausgabe (Standard: 50 Zeilen, Puffer: 500 Zeilen) |
| `rebase_dev_stop` | — | Stoppt den Dev-Server |

## Projekt-Registry (7)

| Tool | Erforderlich | Beschreibung |
|---|---|---|
| `rebase_project_list` | — | Registrierte Projekte auflisten und das aktive anzeigen |
| `rebase_project_switch` | `name` | Das aktive Projekt wechseln |
| `rebase_project_add` | `name` | Ein Projekt registrieren (optional `projectDir`, `baseUrl`, `token`) |
| `rebase_project_remove` | `name` | Ein Projekt entfernen (das Standardprojekt kann nicht entfernt werden) |
| `rebase_project_current` | — | Das aktive Projekt und dessen Auth-Status anzeigen |
| `rebase_project_status` | — | Health-Check für das aktive Backend durchführen |
| `rebase_project_use_cloud` | `project` | Ein Rebase Cloud-Projekt des angemeldeten Kontos über ID, Slug oder Name über den Studio-Proxy der Konsole ansteuern |

`rebase_project_switch` ist nicht geschützt (nicht gated), da es das Ziel aller anderen
Aktionen ändert, anstatt selbst auf ein Ziel einzuwirken. Ein Assistent kann daher zu einem
Remote-Projekt wechseln, ohne das Gate auszulösen – er kann dort dann lediglich kein destruktives
Tool ausführen. `rebase_project_use_cloud` ist eine ähnliche Umschaltung: Es verweist die
Daten- und Admin-Tools auf ein Produktionsprojekt, bei dem Lesevorgänge funktionieren und das Gate
Schreibvorgänge verweigert.

## Rebase Cloud (9)

Führt `rebase cloud … --json` im aktiven Projektverzeichnis für das
Projekt aus, mit dem es verknüpft ist, mit den eigenen Anmeldedaten der CLI. Siehe
[Rebase Cloud](/docs/ai/mcp#rebase-cloud) für Informationen darüber, worauf sie wirken und warum
keines davon geschützt (gated) ist.

| Tool | Erforderlich | Beschreibung |
|---|---|---|
| `rebase_cloud_provision` | — | Ein Live-Backend ohne Konto (`rebase cloud init --claim`): die Live-URL, die Admin-URL und eine Claim-URL (`name`, `deploy`) |
| `rebase_cloud_status` | — | URL, Status, letztes Deployment, Runtime, Datenbank, Storage und die Claim-URL des verknüpften Projekts, solange es nicht beansprucht wurde |
| `rebase_cloud_deploy` | — | Bereitstellen und bis zum Ende verfolgen (`app`, `bundle`, `message`, `wait`, `timeoutSeconds`, `preview`, `previewName`) |
| `rebase_cloud_logs` | — | Ein Snapshot des Runtime-Logs oder das neueste Build-Log (`source`, `since`, `tail`, `grep`, `level`, `previous`, `preview`). Folgt dem Stream nicht |
| `rebase_cloud_env_list` | — | Variablenschlüssel, niemals Werte (`preview`) |
| `rebase_cloud_env_set` | `key`, `value` | Eine Variable setzen; der Wert wird über stdin übergeben und niemals zurückgegeben (`secret`, `preview`) |
| `rebase_cloud_deployments_list` | — | Letzte Deployments und zu welchen zurückgerollt werden kann (`limit`) |
| `rebase_cloud_projects_list` | — | Jedes Projekt, auf das das angemeldete Konto zugreifen kann, über alle seine Organisationen hinweg |
| `rebase_cloud_rollback` | — | Ein früheres erfolgreiches Deployment wieder in Betrieb nehmen (`deploymentId`) |

`rebase_cloud_provision` erstellt ein Projekt und verknüpft dieses Verzeichnis. Es
liest niemals die `baseUrl` des aktiven Projekts, weshalb das Gate dies nicht prüft; die CLI
verweigert den Befehl in einem Verzeichnis, das bereits verknüpft ist.
