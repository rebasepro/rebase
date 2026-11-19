---
sourceHash: 42fbd65cd7d89699
title: MCP-Tool-Referenz
sidebar_label: MCP-Tool-Referenz
description: Jedes vom Rebase-MCP-Server registrierte Tool nach Gruppen geordnet – was jedes Tool benötigt und tut, und welche das Loopback-Gate bei nicht-lokalen Projekten verweigert.
---

Die Tools, die [`@rebasepro/mcp`](/docs/ai/mcp) einem Assistenten bietet. Wie die Verbindung hergestellt wird, welche Anmeldedaten verwendet werden und wie das [Loopback-Gate](/docs/ai/mcp#the-loopback-gate) entscheidet, was ⚠ bedeutet, ist auf der Seite [MCP-Server](/docs/ai/mcp) beschrieben.

53 Tools in zehn Gruppen. Mit ⚠ markierte Tools werden bei nicht-lokalen Zielen verweigert, es sei denn, Sie deaktivieren diese Einschränkung ausdrücklich (Opt-out).

Jedes Tool außerhalb der Projekt-Registry-Gruppe sowie `rebase_cloud_projects_list`, `rebase_cloud_provision` und `rebase_dev_logs` akzeptiert zudem einen optionalen Parameter `project` (ein registrierter Name oder ein Cloud-Slug bzw. eine Cloud-ID), der vor der Ausführung mit der Cloud-Verknüpfung des Sitzungsverzeichnisses abgeglichen wird. Siehe [Auf welches Projekt ein Aufruf wirkt](/docs/ai/mcp#which-project-a-call-acts-on).

## Schema & Datenbank (13)

Startet die Rebase-CLI im aktiven Projektverzeichnis.

| Tool | Erforderlich | Beschreibung |
|---|---|---|
| `rebase_schema_generate` | — | Generiert das Drizzle-Schema aus den Tabellen in `backend/schema` |
| `rebase_db_push` ⚠ | — | Wendet das Schema direkt auf die Datenbank an (Entwicklungs-Shortcut) |
| `rebase_schema_introspect` | — | Schreibt für jede Tabelle in der Live-Datenbank ein `defineTable` in `backend/schema` |
| `rebase_db_generate` | — | Generiert SQL-Migrationsdateien aus Schema-Änderungen |
| `rebase_db_migrate` ⚠ | — | Führt alle ausstehenden SQL-Migrationen aus |
| `rebase_generate_sdk` | — | Generiert das vollständig typisierte TypeScript-SDK |
| `rebase_doctor` | — | Erkennt Abweichungen (Drift) zwischen den Tabellen in `backend/schema`, dem generierten Schema und der Live-Datenbank |
| `rebase_db_branch_create` ⚠ | `name` | Erstellt einen Datenbank-Branch (nur Admins) |
| `rebase_db_branch_list` | — | Listet Datenbank-Branches auf (nur Admins) |
| `rebase_db_branch_delete` ⚠ | `name` | Löscht einen Datenbank-Branch (nur Admins) |
| `rebase_db_branch_info` | `name` | Branch-Informationen und -Status (nur Admins) |
| `rebase_db_branch_diff` | `name` | Zeigt die Änderungen eines Branches gegenüber der Ausgangsdatenbank – Schema, Policies und Zeilen inklusive Konflikten; ändert keines von beiden (nur Admins) |
| `rebase_db_branch_switch` | — | Weist diesen Checkout einem Branch zu oder wechselt zurück zur Hauptdatenbank (nur Admins) |

## Schemaplanung (1)

Fragt das Backend über `POST /api/admin/schema/plan`, welche Auswirkungen
eine Änderung hätte. Dafür ist kein CLI-Prozess nötig, und es wird nichts
auf die Festplatte geschrieben. Es funktioniert auch mit der verwalteten
Entwicklungsdatenbank.

| Tool | Erforderlich | Beschreibung |
|---|---|---|
| `rebase_schema_plan` | `patches` | Das SQL, das eine Liste von `TablePatch`-Änderungen ausführen würde, und welche Anweisungen Daten zerstören – siehe [Live-Schema-Bearbeitung](/docs/backend/live-schema-editing/#the-edits-tablepatch) |

## Zeilen (5)

Dieselben Namen, die das Remote-`/mcp` verwendet; zuvor hießen sie `list_documents`, `get_document`, `create_document`, `update_document` und `delete_document` mit einem `collection`-Argument.

| Tool | Erforderlich | Beschreibung |
|---|---|---|
| `query_table` | `table` | Liest Zeilen mit optionalem `limit`, `offset`, `orderBy`, `where`, analog zu `data.table(name).find()` |
| `get_row` | `table`, `id` | Ruft eine einzelne Zeile anhand der ID ab |
| `create_row` ⚠ | `table`, `data` | Erstellt eine Zeile |
| `update_row` ⚠ | `table`, `id`, `data` | Aktualisiert eine Zeile; es werden nur die angegebenen Spalten geändert |
| `delete_row` ⚠ | `table`, `id` | Löscht eine Zeile |

## Benutzer & Rollen (6)

| Tool | Erforderlich | Beschreibung |
|---|---|---|
| `list_users` | — | Listet alle Benutzer inklusive Rollen auf |
| `create_user` ⚠ | `email` | Erstellt einen Benutzer (optional `displayName`, `password`, `roles`) |
| `update_user` ⚠ | `uid` | Aktualisiert E-Mail, Anzeigename oder Rollen |
| `delete_user` ⚠ | `uid` | Löscht einen Benutzer |
| `list_roles` | — | Listet definierte Rollen auf |
| `rebase_auth_reset_password` ⚠ | `email` | Setzt ein Passwort über die Admin-API zurück |

Sowohl `create_user` als auch `update_user` akzeptieren `roles`, sodass beide Administratoren erstellen können. Aus diesem Grund unterliegen sie dem Gate, anstatt als bloß „additiv“ behandelt zu werden.

## Storage (3)

| Tool | Erforderlich | Beschreibung |
|---|---|---|
| `storage_list_objects` | — | Listet gespeicherte Objekte auf |
| `storage_get_download_url` | `key` | Eine temporäre, signierte Download-URL und deren Ablaufzeit – keine Objekt-Metadaten |
| `storage_delete_object` ⚠ | `key` | Löscht ein Objekt |

`storage_get_download_url` wird als Leseoperation eingestuft, da sie die Umgebung nicht verändert – die erzeugte signierte URL ist jedoch eine Inhaberberechtigung (Bearer Capability), die über den Tool-Aufruf hinaus gültig bleibt.

## Cron (5)

| Tool | Erforderlich | Beschreibung |
|---|---|---|
| `cron_list_jobs` | — | Listet geplante Jobs und deren Status auf |
| `cron_get_job` | `jobId` | Jobdetails |
| `cron_get_job_logs` | `jobId` | Ausführungsprotokolle |
| `cron_trigger_job` ⚠ | `jobId` | Führt einen Job sofort aus |
| `cron_toggle_job` ⚠ | `jobId`, `enabled` | Aktiviert oder deaktiviert einen Job |

`cron_toggle_job` kann ein Backup oder einen Abrechnungsjob lautlos deaktivieren – eine Änderung ohne Fehler und ohne Ausgabe, bis später etwas fehlt.

## Funktionen (1)

| Tool | Erforderlich | Beschreibung |
|---|---|---|
| `invoke_function` ⚠ | `name` | Ruft eine [benutzerdefinierte Funktion](/docs/backend/custom-functions) mit beliebiger Methode und Payload auf |

Dies ruft Code auf, den der MCP-Server noch nie gesehen hat, mit einer Methode und einem Body, die das Modell ausgewählt hat. Der potenzielle Schadensradius (Blast Radius) entspricht allem, was Ihre Funktionen tun.

## Dev-Server (3)

| Tool | Erforderlich | Beschreibung |
|---|---|---|
| `rebase_dev_start` | — | Startet den Dev-Server; kehrt sofort zurück |
| `rebase_dev_logs` | — | Liest die letzten Ausgaben (standardmäßig 50 Zeilen, 500-Zeilen-Puffer) |
| `rebase_dev_stop` | — | Stoppt den Dev-Server |

## Projekt-Registry (7)

| Tool | Erforderlich | Beschreibung |
|---|---|---|
| `rebase_project_list` | — | Listet registrierte Projekte auf und zeigt das aktive an |
| `rebase_project_switch` | `name` | Wechselt das aktive Projekt |
| `rebase_project_add` | `name` | Registriert ein Projekt (optional `projectDir`, `baseUrl`, `token`) |
| `rebase_project_remove` | `name` | Entfernt ein Projekt (das Standardprojekt kann nicht entfernt werden) |
| `rebase_project_current` | — | Zeigt das aktive Projekt und dessen Authentifizierungsstatus an |
| `rebase_project_status` | — | Führt eine Zustandsprüfung (Health-Check) des aktiven Backends durch |
| `rebase_project_use_cloud` | `project` | Zielt anhand von ID, Slug oder Name über den Studio-Proxy der Konsole auf ein Rebase-Cloud-Projekt des angemeldeten Kontos ab |

`rebase_project_switch` ist nicht durch das Gate geschützt, da es das Ziel aller anderen Befehle ändert, anstatt selbst Aktionen auf einem Ziel auszuführen. Ein Assistent kann daher zu einem Remote-Projekt wechseln, ohne das Gate auszulösen – er kann dort lediglich anschließend keine destruktiven Tools ausführen. `rebase_project_use_cloud` ist die gleiche Art von Umschaltung: Es richtet die Daten- und Admin-Tools auf ein Produktionsprojekt aus, bei dem Lesezugriffe funktionieren und das Gate Schreibzugriffe verweigert.

## Rebase Cloud (9)

Führt `rebase cloud … --json` im aktiven Projektverzeichnis für das verknüpfte Projekt mit den eigenen Anmeldedaten der CLI aus. Siehe [Rebase Cloud](/docs/ai/mcp#rebase-cloud) für Informationen darüber, worauf sie wirken und warum keines davon durch das Gate beschränkt ist.

| Tool | Erforderlich | Beschreibung |
|---|---|---|
| `rebase_cloud_provision` | — | Ein Live-Backend ohne Konto (`rebase cloud init --claim`): die Live-URL, die Admin-URL und eine Claim-URL (`name`, `deploy`, `confirm`). Ohne `confirm: true` wird nur ausgegeben, was getan werden würde |
| `rebase_cloud_status` | — | URL, Status, letztes Deployment, Laufzeit, Datenbank, Storage des verknüpften Projekts sowie dessen Claim-URL, solange es nicht beansprucht wurde |
| `rebase_cloud_deploy` | — | Führt ein Deployment durch und verfolgt es bis zum Ende (`app`, `bundle`, `message`, `wait`, `timeoutSeconds`, `preview`, `previewName`, `confirm`). Ein Produktions-Deployment ohne `confirm: true` gibt nur aus, was getan werden würde |
| `rebase_cloud_logs` | — | Ein Snapshot des Laufzeitprotokolls oder des neuesten Build-Protokolls (`source`, `since`, `tail`, `grep`, `level`, `previous`, `preview`). Verfolgt den Log-Stream nicht fortlaufend |
| `rebase_cloud_env_list` | — | Variablenschlüssel, niemals Werte (`preview`) |
| `rebase_cloud_env_set` | `key`, `value` | Setzt eine Variable; der Wert wird über stdin übergeben und niemals zurückgegeben (`secret`, `preview`, `confirm`). In der Produktion wird ohne `confirm: true` nur ausgegeben, was getan werden würde |
| `rebase_cloud_deployments_list` | — | Kürzliche Deployments und welche davon für einen Rollback verfügbar sind (`limit`) |
| `rebase_cloud_projects_list` | — | Jedes Projekt, auf das das angemeldete Konto über alle seine Organisationen hinweg Zugriff hat |
| `rebase_cloud_rollback` | — | Reaktiviert ein früheres erfolgreiches Deployment (`deploymentId`, `confirm`). Ohne `confirm: true` wird nur ausgegeben, was getan werden würde |

`rebase_cloud_provision` erstellt ein Projekt und verknüpft dieses Verzeichnis. Es liest niemals die `baseUrl` des aktiven Projekts aus, sodass das Gate dies nicht prüft; die CLI verweigert die Ausführung in einem Verzeichnis, das bereits verknüpft ist.
