---
sourceHash: a04d0760ffb715cb
title: Erfassung von Datenbankänderungen
sidebar_label: Erfassung von Datenbankänderungen
description: "Echtzeit-Events für jeden bestätigten Schreibvorgang, egal wie er erfolgte: die Erfassungs-Trigger, die Einstellung REALTIME_CDC und deren Voraussetzungen."
---

**Change Data Capture (CDC) ist standardmäßig aktiviert.** Rebase erfasst Änderungen direkt auf Datenbankebene und gibt Echtzeit-Events für **jeden bestätigten Schreibvorgang aus, unabhängig davon, wie er ausgeführt wurde** – REST, SDK, Studio, `psql`, ein Cron-Job in einem anderen Dienst, direktes Drizzle/SQL oder der **SQL-Editor** von Studio. Dies entspricht demselben Modell wie das Verfolgen des Write-Ahead-Logs durch Supabase Realtime.

Es ist keine Konfiguration erforderlich. Bei einer Datenbankverbindung, die dies unterstützt, richtet sich CDC beim Start automatisch ein; bei einer Verbindung, die dies nicht unterstützt (z. B. eine eingeschränkte Rolle, die keine Trigger erstellen kann), wechselt Rebase stillschweigend zu Echtzeit auf Anwendungsebene – nichts muss manuell aktiviert werden, nichts schlägt fehl.

## Konfiguration

CDC wird über die Umgebungsvariable `REALTIME_CDC` gesteuert:

| Wert | Verhalten |
| --- | --- |
| `auto` *(Standard)* | Liest Änderungen aus dem WAL, sofern die Datenbank dies zulässt, nutzt andernfalls die Erfassungs-Trigger und fällt ansonsten auf Echtzeit auf Anwendungsebene zurück. Jeder Fallback ist ein informativer Log-Eintrag, keine Warnung. Zero-Config. Siehe [Erfassung aus dem WAL](#erfassung-aus-dem-wal). |
| `trigger` | Erzwingt die Trigger-basierte Erfassung. Funktioniert auf jedem PostgreSQL, einschließlich verwalteter Instanzen ohne logische Replikation. Gibt eine Warnung aus (anstatt stillschweigend zurückzufallen), falls die Einrichtung fehlschlägt. |
| `wal` | Liest Änderungen aus dem Write-Ahead-Log über logische Replikation anstelle von Triggern, sodass ein Schreibvorgang keinen Trigger ausführt und kein `NOTIFY` sendet. Erfordert `wal_level=logical` und eine Rolle mit Replikationsberechtigung; fällt mit einer Warnung auf `trigger` zurück, wenn eines davon fehlt. Siehe [Erfassung aus dem WAL](#erfassung-aus-dem-wal). |
| `off` | Nur Echtzeit auf Anwendungsebene. Nutzen Sie dies, um den Trigger-Overhead pro Schreibvorgang bei schreibintensiven Workloads zu vermeiden. Ein Start mit `off`, der Eigentümer des Schemas ist, **entfernt** auch die von einem früheren Start installierten Erfassungs-Trigger und -Funktionen und protokolliert, wie viele entfernt wurden; wird die Variable entfernt, installiert der nächste Start sie wieder. |

Dieselbe Einstellung entspricht
der Option `realtime.cdc` des Postgres-Adapters für einen Server, der dies im
Code konfiguriert. Wenn `REALTIME_CDC` gesetzt ist, hat es Vorrang.

Beim Start sehen Sie eine Protokollzeile, die den aktiven Modus angibt, z. B.:

```
📡 [CDC] Realtime source = database-level change capture (mode: trigger).
   All writes now emit realtime events regardless of origin.
```

Wenn die Verbindung dies nicht unterstützt, gibt `auto` stattdessen eine Informationszeile aus und fährt mit Echtzeit auf Anwendungsebene fort:

```
ℹ️ [CDC] Database-level change capture unavailable (likely insufficient
   privileges to create triggers…) — using app-level realtime.
```

## Funktionsweise

1. **Automatische Bereitstellung (Self-provisioning)** – Beim Start (Server-/Owner-Kontext) installiert Rebase idempotente `AFTER INSERT/UPDATE/DELETE/TRUNCATE`-Trigger auf jeder verwalteten Tabelle. Diese werden einmal pro Anweisung (Statement) ausgelöst und senden Änderungsbenachrichtigungen über den Kanal `rebase_cdc`, welche die geänderten Zeilen anhand ihres Schlüssels benennen – der Primärschlüssel plus die beiden ID-Spalten für eine Many-to-Many-Verbindungstabelle – und **keine weiteren Spalten** enthalten. Eine Anweisung, die viele Zeilen geändert hat, benennt diese in Batches von etwa tausend Schlüsseln, sodass ein `UPDATE` über 1 Million Zeilen etwa 1.000 Benachrichtigungen anstelle von einer Million sendet; eine Anweisung, die eine Zeile geändert hat, sendet eine Benachrichtigung, und eine, die keine geändert hat, sendet nichts. Ein `TRUNCATE` wird als Änderung für jede Zeile der Tabelle angekündigt. Eine partitionierte Tabelle behält einen Trigger pro Zeile, da PostgreSQL einen Zeilen-Trigger auf jede Partition kopiert und ein direkt auf eine Partition ausgeführter Schreibvorgang somit weiterhin erfasst wird. PostgreSQL erfordert keine Berechtigungen für `LISTEN`, sodass jede Rolle, die sich mit der Datenbank verbinden kann, diesen Kanal lesen kann; sie erfährt, welche Schlüssel sich geändert haben, jedoch niemals deren Inhalt. Ein Schlüssel, der zu groß für das 8-KB-`NOTIFY`-Limit von PostgreSQL ist, wird ohne Schlüssel gesendet (eine Änderung der gesamten Tabelle, die jedes Listen- und Einzelzeilen-Abonnement daraufhin neu abruft), sodass CDC niemals den auslösenden Schreibvorgang abbrechen kann. Die Funktionen werden bei jedem Start, der die Bereitstellung vornimmt, ersetzt, sodass eine Datenbank, die von einer älteren Version instrumentiert wurde – deren Trigger ganze Zeilen gesendet hat –, durch den nächsten Start aktualisiert wird; ein Start mit `REALTIME_CDC=off` entfernt sie stattdessen.

   **Upgrades.** Eine Datenbank, die von einer Version vor der Batch-Verarbeitung instrumentiert wurde, verfügt über einen Trigger pro Zeile; der erste Start einer neueren Version ersetzt diesen durch die Trigger pro Anweisung. Für 24 Stunden danach senden die neuen Trigger weiterhin eine Benachrichtigung pro Zeile, wie es die alten getan haben, sodass Instanzen der älteren Version, die während eines Rolling Deploys (oder nach einem Rollback) noch laufen, jede Zeile mitbekommen. Nach diesem Zeitfenster verarbeiten sie in Batches. Jede Version, die Batches unterstützt, kann beide Formate lesen.
2. **Erfassung** – Ein dedizierter, ungepoolter `LISTEN`-Client pro Instanz verarbeitet `rebase_cdc`, ordnet die geänderte Tabelle wieder der von ihr bedienten Tabelle zu und speist die Änderung in dieselbe `RealtimeService`-Pipeline ein, die auch von API-Mutationen verwendet wird. Wie der instanzübergreifende Listener bevorzugt er `DATABASE_DIRECT_URL` und stellt die Verbindung automatisch wieder her.
3. **RLS-sichere Auslieferung** – Die Rohdaten der Zeile aus dem Änderungs-Stream werden **niemals** an Abonnenten weitergeleitet. Die Änderung wird als ungültig markiert und jedes Abonnement liest die Zeile unter seinem **eigenen** Authentifizierungskontext erneut ein. Die Filterung erfolgt daher pro Abonnent, niemals pro Publisher: Ein Client erhält immer nur die Zeilen, die seine RLS-Richtlinien (Row-Level Security) zulassen.
4. **Instanzübergreifend** – Da jede Instanz jeden Commit über den Änderungs-Stream beobachtet, *ist* CDC gleichzeitig der instanzübergreifende Kanal; der veraltete Broadcast `rebase_entity_changes` pro Mutation wird nicht verwendet, solange CDC aktiv ist.
5. **Deduplizierung** – Eine über die Rebase-API durchgeführte Mutation plant sofort nach dem Commit einen erneuten Abruf für die lokalen Abonnenten und wird gleichzeitig über den Änderungs-Stream zurückgeworfen (Echo). Die Ursprungsinstanz unterdrückt ein Echo, das innerhalb des Debounce-Fensters für den erneuten Abruf eintrifft (ein kurzlebiger Datensatz ihrer eigenen Aussendungen), sodass ein API-Schreibvorgang normalerweise einen Frame erzeugt. Ein Echo, das später eintrifft, löst einen weiteren Neuabruf aus, der dieselben Zeilen erneut liefert: harmlos, aber ein Abonnent kann dadurch einen identischen Frame zweimal sehen.

## Erfassung aus dem WAL

`REALTIME_CDC=wal` sowie `auto`, wo immer die Datenbank dies zulässt, liest Änderungen aus dem Write-Ahead-Log von PostgreSQL über die logische Replikation (das integrierte Plugin `pgoutput`) anstelle von Triggern. Ein Schreibvorgang führt dann keinen Trigger aus und sendet kein `NOTIFY`, was bei gleichzeitigen Schreibvorgängen von Bedeutung ist: Eine Transaktion, die `NOTIFY` aufgerufen hat, belegt beim Commit eine Sperre für den gesamten Server und hält diese während des Schreibens auf die Festplatte (Disk Flush), sodass diese Commits bei der Trigger-Erfassung nacheinander erfolgen. Gemessen auf PostgreSQL 18 mit 32 gleichzeitigen Schreibern und einem Disk Flush von 1&nbsp;ms hielt die Trigger-Erfassung die Inserts auf etwa einem Zehntel der Rate, die die WAL-Erfassung erreichte.

Voraussetzungen:

- `wal_level = logical` auf dem Server, was einen Neustart erfordert. Auf Amazon RDS setzen Sie `rds.logical_replication = 1`; auf Cloud SQL `cloudsql.logical_decoding = on`.
- Eine Rolle mit Replikationsberechtigung: `ALTER ROLE <role> REPLICATION` oder das Äquivalent des Hosters (auf RDS die Mitgliedschaft in `rds_replication`).
- Ein freier Replikations-Slot und WAL-Sender pro Serverinstanz (`max_replication_slots` und `max_wal_senders`, standardmäßig jeweils 10).
- Eine direkte Verbindung (`DATABASE_DIRECT_URL`): Ein Pooler unterstützt das Replikationsprotokoll nicht.

Wenn einer dieser Punkte fehlt, protokolliert der Start den Grund und verwendet stattdessen die Trigger-Erfassung: eine Warnung unter `wal`, eine Informationszeile unter `auto`, da die meisten Datenbanken nicht für logisches Decoding eingerichtet sind und dies dort das erwartete Ergebnis ist.

Was ein Start durchführt:

- Er erstellt eine Publikation namens `rebase_cdc` und fügt ihr jede bediente Tabelle sowie jede Many-to-Many-Verbindungstabelle hinzu. Tabellen werden grundsätzlich nur hinzugefügt, sodass eine ältere Version, die während eines Rolling Deploys noch ausgeführt wird, die Tabelle einer neueren Version nicht wieder entfernen kann.
- Eine Tabelle ohne Primärschlüssel oder mit `REPLICA IDENTITY NOTHING` wird mit einer Warnung ausgelassen: PostgreSQL verweigert `UPDATE` und `DELETE` auf einer veröffentlichten Tabelle, die nicht angeben kann, welche Zeile geändert wurde. Schreibvorgänge darauf, die außerhalb von Rebase vorgenommen werden, werden nicht erfasst.
- Jede Instanz streamt die Publikation über ihren eigenen **temporären** Replikations-Slot, den PostgreSQL verwirft, wenn die Verbindung geschlossen wird. So kann eine abstürzende Instanz keinen Slot hinterlassen, der WAL-Daten ansammelt, bis die Festplatte voll ist. Eine erneute Verbindung startet einen neuen Slot, und jedes Abonnement wird neu abgerufen, da Daten, die in der Zwischenzeit bestätigt wurden, nicht erneut wiedergegeben werden.
- Sobald ihr Stream geöffnet ist, entfernt ein Start, der sowohl bereitstellt als auch konsumiert, die Erfassungs-Trigger wie bei `off`, jedoch nur, wenn keine andere Instanz mehr darauf lauscht. Eine Instanz, die auf die Trigger-Erfassung zurückgefallen ist (weil sie beispielsweise keinen freien Replikations-Slot gefunden hat), oder eine ältere Version, die während eines Rolling Deploys noch läuft, würde andernfalls keine Schreibvorgänge mehr mitbekommen, die an anderer Stelle getätigt wurden. Jede Echtzeitverbindung benennt sich selbst in `application_name` (`rebase-realtime:<instance>:cdc`, `:wal` oder `:entity`), sodass der Start `pg_stat_activity` abliest, um zu sehen, wer noch lauscht. Die Verbindung einer älteren Version, die kein Suffix enthält, gilt als lauschend. Solange jemand lauscht oder wenn die Prüfung nicht durchgeführt werden kann, bleiben die Trigger bestehen und werden auf dem neuesten Stand gehalten. Alle fünf Minuten prüft die Instanz erneut und entfernt sie, sobald niemand mehr lauscht. Ein Prozess, der nur bereitstellt, wie der Migrationsjob eines [Split Deployments](/docs/deployment/split-processes/), behält die Trigger für Konsumenten bei, die nicht streamen können und auf diese zurückfallen.

Schreibende Prozesse behalten bei Lastspitzen ihre volle Geschwindigkeit bei, aber ein WAL-Sender decodiert jeden Slot einzeln. Daher können Events bei dauerhaft mehr als mehreren tausend Schreibvorgängen pro Sekunde verzögert eintreffen. Eine Rolle mit `REPLICATION` kann jede Zeile einer veröffentlichten Tabelle über einen eigenen Slot lesen; der Stream verbleibt innerhalb des Servers, und Abonnenten lesen jede Zeile weiterhin unter ihren eigenen RLS-Bedingungen neu ein.

## Anforderungen & Hinweise

- CDC erfordert einen direkten Verbindungsstring (`DATABASE_DIRECT_URL`, die Option `directConnectionString` des Adapters oder die primäre Verbindung) für den `LISTEN`-Client – Verbindungspooler im Transaktionsmodus unterstützen keine langlebigen `LISTEN`-Sitzungen.
- Trigger werden nur auf den Tabellen installiert, die das Backend bedient, sowie auf den Verbindungstabellen ihrer Many-to-Many-Beziehungen. Schreibvorgänge auf nicht zugeordnete Tabellen werden ignoriert.
- Eine bediente Tabelle, die noch nicht erstellt wurde, wird mit einer Warnung übersprungen, anstatt CDC für die übrigen Tabellen zu blockieren.

## Nächste Schritte

- [Realtime & WebSocket](/docs/backend/realtime) – Abonnements, Kanäle und Presence, die von diesen Events gespeist werden.
- [Instanzübergreifende Echtzeit](/docs/backend/realtime-transports) – der Bus, der Änderungen zwischen Serverprozessen überträgt.
