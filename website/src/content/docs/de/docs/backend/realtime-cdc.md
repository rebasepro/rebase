---
sourceHash: 5f05a6b3c8a0e4b3
title: Datenbank-Änderungserfassung
sidebar_label: Datenbank-Änderungserfassung
description: "Echtzeit-Events für jeden committeten Schreibvorgang, unabhängig davon, wie er durchgeführt wurde: die Capture-Trigger, die REALTIME_CDC-Einstellung und was dafür erforderlich ist."
---

**Change Data Capture ist standardmäßig aktiviert.** Rebase erfasst Änderungen auf Datenbankebene und sendet Echtzeit-Events für **jeden committeten Schreibvorgang, unabhängig davon, wie er durchgeführt wurde** – REST, SDK, Studio, `psql`, ein Cron-Job in einem anderen Dienst, direktes Drizzle/SQL oder der **SQL-Editor** von Studio. Dies entspricht dem gleichen Modell wie Supabase Realtime, das das Write-Ahead-Log ausliest.

Es ist keine Konfiguration erforderlich. Bei einer Datenbankverbindung, die dies unterstützt, richtet sich CDC beim Start automatisch ein; bei einer, die dies nicht unterstützt (z. B. eine eingeschränkte Rolle, die keine Trigger erstellen kann), weicht Rebase stillschweigend auf Echtzeit auf Anwendungsebene aus – nichts muss aktiviert werden, nichts bricht ab.

## Konfiguration

CDC wird über die Umgebungsvariable `REALTIME_CDC` gesteuert:

| Wert | Verhalten |
| --- | --- |
| `auto` *(Standard)* | Aktiviert die Erfassung auf Datenbankebene, wenn die Verbindung dies unterstützt; fällt andernfalls **stillschweigend** auf Echtzeit auf Anwendungsebene zurück. Zero-Config. |
| `trigger` | Erzwingt triggerbasierte Erfassung. Funktioniert auf jedem PostgreSQL, einschließlich verwalteter Instanzen ohne logische Replikation. Gibt eine Warnung aus (statt stillschweigend zurückzufallen), wenn die Bereitstellung fehlschlägt. |
| `wal` | Liest Änderungen aus dem Write-Ahead-Log über logische Replikation anstelle von Triggern, sodass ein Schreibvorgang keinen Trigger ausführt und kein `NOTIFY` sendet. Erfordert `wal_level=logical` und eine Rolle mit Replikationsberechtigung; fällt mit einer Warnung auf `trigger` zurück, wenn eines davon fehlt. Siehe [Erfassung über das WAL](#erfassung-über-das-wal). |
| `off` | Nur Echtzeit auf Anwendungsebene. Verwenden Sie dies, um den Trigger-Overhead pro Schreibvorgang bei schreibintensiven Workloads zu vermeiden. Ein Start mit `off`, der Eigentümer des Schemas ist, **entfernt** auch die Capture-Trigger und -Funktionen, die bei einem früheren Start installiert wurden, und protokolliert, wie viele entfernt wurden; entfernen Sie die Variable, und der nächste Start installiert sie wieder. |

Dieselbe Einstellung ist die Option `realtime.cdc` des Postgres-Adapters für Server, die dies im Code konfigurieren. `REALTIME_CDC` hat Vorrang, wenn gesetzt.

Beim Start sehen Sie eine Protokollzeile, die den aktiven Modus angibt, z. B.:

```
📡 [CDC] Realtime source = database-level change capture (mode: trigger).
   All writes now emit realtime events regardless of origin.
```

Wenn die Verbindung dies nicht unterstützt, protokolliert `auto` stattdessen eine Informationszeile und fährt mit Echtzeit auf Anwendungsebene fort:

```
ℹ️ [CDC] Database-level change capture unavailable (likely insufficient
   privileges to create triggers…) — using app-level realtime.
```

## Funktionsweise

1. **Automatische Bereitstellung (Self-Provisioning)** – Beim Start (Server-/Owner-Kontext) installiert Rebase idempotente `AFTER INSERT/UPDATE/DELETE/TRUNCATE`-Trigger auf jeder verwalteten Tabelle. Diese werden einmal pro Statement ausgelöst und senden Änderungsbenachrichtigungen über den Kanal `rebase_cdc`, die die geänderten Zeilen anhand ihres Schlüssels benennen – dem Primärschlüssel sowie den beiden ID-Spalten für eine Many-to-Many-Verknüpfungstabelle – und **keine weiteren Spalten** enthalten. Ein Statement, das viele Zeilen geändert hat, benennt diese in Batches von etwa tausend Schlüsseln, sodass ein `UPDATE` über 1 Million Zeilen etwa 1.000 Benachrichtigungen anstelle von einer Million sendet; ein Statement, das eine Zeile geändert hat, sendet eine Benachrichtigung, und eines, das keine geändert hat, sendet nichts. Ein `TRUNCATE` wird als Änderung jeder Zeile der Tabelle angekündigt. Eine partitionierte Tabelle behält einen Trigger pro Zeile, da PostgreSQL einen Zeilen-Trigger auf jede Partition kopiert und ein Schreibvorgang direkt auf eine Partition somit dennoch erfasst wird. PostgreSQL erfordert keine speziellen Berechtigungen für `LISTEN`, sodass jede Rolle, die sich mit der Datenbank verbinden kann, diesen Kanal abhören kann; sie erfährt, welche Schlüssel sich geändert haben, niemals deren Inhalt. Ein Schlüssel, der für das 8&nbsp;KB-Limit von `NOTIFY` in PostgreSQL zu groß ist, wird ohne Schlüssel gesendet (eine Änderung der gesamten Tabelle, die jedes Listen- und Einzelzeilen-Abonnement darauf neu abruft), sodass CDC den auslösenden Schreibvorgang niemals abbrechen kann. Die Funktionen werden bei jedem bereitstellenden Start ersetzt, sodass eine von einer älteren Version instrumentierte Datenbank – deren Trigger ganze Zeilen gesendet hat – beim nächsten Start auf den neuesten Stand gebracht wird; ein Start mit `REALTIME_CDC=off` entfernt sie stattdessen.

   **Aktualisierung.** Eine Datenbank, die von einer Version vor der Batch-Verarbeitung instrumentiert wurde, verfügt über einen Trigger pro Zeile; der erste Start einer neueren Version ersetzt diesen durch die Trigger pro Statement. Danach senden die neuen Trigger 24 Stunden lang weiterhin eine Benachrichtigung pro Zeile, wie es die alten getan haben, sodass Instanzen der älteren Version, die während eines Rolling Deploys (oder nach einem Rollback) noch laufen, jede Zeile mitbekommen. Nach diesem Zeitfenster verarbeiten sie im Batch. Jede Version mit Batch-Unterstützung liest beide Formate.
2. **Erfassung** – Ein dedizierter, ungepoolter `LISTEN`-Client pro Instanz konsumiert `rebase_cdc`, bildet die geänderte Tabelle auf die von ihr bediente Tabelle zurück und leitet die Änderung in dieselbe `RealtimeService`-Pipeline ein, die auch von API-Mutationen genutzt wird. Wie der instanzübergreifende Listener bevorzugt er `DATABASE_DIRECT_URL` und verbindet sich automatisch wieder.
3. **RLS-sichere Auslieferung** – Die Rohzeile aus dem Änderungsstream wird **niemals** an Abonnenten weitergeleitet. Die Änderung wird als ungültig markiert und jedes Abonnement liest die Zeile unter seinem **eigenen** Authentifizierungskontext erneut aus. Die Filterung erfolgt daher pro Abonnent, niemals pro Publisher: Ein Client erhält immer nur Zeilen, die seine RLS-Richtlinien zulassen.
4. **Instanzübergreifend** – Da jede Instanz jeden Commit über den Änderungsstream beobachtet, *ist* CDC gleichzeitig der instanzübergreifende Kanal; der veraltete pro-Mutation-Broadcast `rebase_entity_changes` wird nicht verwendet, solange CDC aktiv ist.
5. **Deduplizierung** – Eine über die Rebase-API durchgeführte Mutation plant sofort nach dem Commit einen erneuten Abruf für die lokalen Abonnenten und wird gleichzeitig über den Änderungsstream widergespiegelt. Die Ursprungsinstanz unterdrückt ein Echo, das innerhalb des Refetch-Debounce-Zeitfensters eintrifft (ein kurzlebiger Datensatz ihrer eigenen Ausgaben), sodass ein API-Schreibvorgang normalerweise genau einen Frame erzeugt. Ein Echo, das später eintrifft, löst einen weiteren Neuabruf aus, der dieselben Zeilen erneut liefert: harmlos, aber ein Abonnent kann dadurch zweimal einen identischen Frame sehen.

## Erfassung über das WAL

`REALTIME_CDC=wal` liest Änderungen aus dem Write-Ahead-Log von PostgreSQL über logische Replikation (das integrierte `pgoutput`-Plugin) anstelle von Triggern. Ein Schreibvorgang führt dann keinen Trigger aus und sendet kein `NOTIFY`, was bei gleichzeitigen Schreibvorgängen entscheidend ist: Eine Transaktion, die `NOTIFY` aufgerufen hat, belegt beim Commit eine Sperre für den gesamten Server und hält diese während des Disk-Flushs, sodass diese Commits bei der Trigger-Erfassung nacheinander ausgeführt werden. Gemessen unter PostgreSQL 18 mit 32 parallelen Schreibern und einem Disk-Flush von 1&nbsp;ms drosselte die Trigger-Erfassung Inserts auf etwa ein Zehntel der Rate, die mit der WAL-Erfassung erreicht wurde.

Es erfordert:

- `wal_level = logical` auf dem Server, was einen Neustart erfordert. Setzen Sie auf Amazon RDS `rds.logical_replication = 1`; auf Cloud SQL `cloudsql.logical_decoding = on`.
- Eine Rolle mit Replikationsberechtigung: `ALTER ROLE <role> REPLICATION` oder das Äquivalent des Hosters (auf RDS die Mitgliedschaft in `rds_replication`).
- Einen freien Replikations-Slot und WAL-Sender pro Serverinstanz (`max_replication_slots` und `max_wal_senders`, standardmäßig jeweils 10).
- Eine direkte Verbindung (`DATABASE_DIRECT_URL`): Ein Pooler unterstützt das Replikationsprotokoll nicht.

Wenn eine dieser Voraussetzungen fehlt, protokolliert der Startvorgang den Grund und verwendet stattdessen die Trigger-Erfassung.

Was beim Start passiert:

- Es wird eine Publication namens `rebase_cdc` erstellt und jede bediente Tabelle sowie jede Many-to-Many-Verknüpfungstabelle hinzugefügt. Tabellen werden grundsätzlich nur hinzugefügt, sodass eine ältere Version, die während eines Rolling Deploys noch aktiv ist, Tabellen einer neueren Version nicht wieder entfernen kann.
- Eine Tabelle ohne Primärschlüssel oder mit `REPLICA IDENTITY NOTHING` wird mit einer Warnung ausgelassen: PostgreSQL verweigert `UPDATE` und `DELETE` auf einer publizierten Tabelle, die nicht angeben kann, welche Zeile geändert wurde. Schreibvorgänge darauf, die außerhalb von Rebase getätigt werden, werden nicht erfasst.
- Jede Instanz streamt die Publication über ihren eigenen **temporären** Replikations-Slot, den PostgreSQL beim Schließen der Verbindung verwirft. Dadurch kann eine abstürzende Instanz keinen Slot hinterlassen, der das WAL blockiert, bis die Festplatte voll ist. Ein erneutes Verbinden startet einen neuen Slot, und jedes Abonnement führt einen Neuabruf durch, da Commits während der Unterbrechung nicht erneut abgespielt werden.
- Sobald der Stream geöffnet ist, entfernt ein Startvorgang, der sowohl bereitstellt als auch konsumiert, die Capture-Trigger, genau wie `off`. Während eines Rolling Deploys weg von der Trigger-Erfassung hören Instanzen, auf denen sie noch läuft, keine an anderer Stelle vorgenommenen Schreibvorgänge mehr, bis sie ersetzt werden; ihre eigenen Schreibvorgänge erreichen weiterhin ihre Abonnenten. Ein Prozess, der nur bereitstellt, wie beispielsweise der Migrationsjob eines [Split Deployments](/docs/deployment/split-processes/), behält die Trigger für Consumer bei, die nicht streamen können und auf diese zurückfallen.

Schreibende Prozesse behalten bei Lastspitzen ihre volle Geschwindigkeit bei, da jedoch ein einziger WAL-Sender jeden Slot decodiert, können Events bei dauerhaft mehr als mehreren tausend Schreibvorgängen pro Sekunde verzögert eintreffen. Eine Rolle mit `REPLICATION` kann jede Zeile einer veröffentlichten Tabelle über einen eigenen Slot lesen; der Stream verbleibt innerhalb des Servers, und Abonnenten lesen jede Zeile weiterhin unter ihrem eigenen RLS neu aus.

## Anforderungen & Hinweise

- CDC erfordert einen direkten Verbindungs-String (`DATABASE_DIRECT_URL`, `directConnectionString` des Adapters oder die primäre Verbindung) für den `LISTEN`-Client – Verbindungspooler im Transaktionsmodus unterstützen keine langlebigen `LISTEN`-Sitzungen.
- Trigger werden nur auf den Tabellen installiert, die das Backend bedient, sowie auf den Verknüpfungstabellen ihrer Many-to-Many-Beziehungen. Schreibvorgänge auf nicht zugeordneten Tabellen werden ignoriert.
- Eine bediente Tabelle, die noch nicht erstellt wurde, wird mit einer Warnung übersprungen, anstatt CDC für die übrigen Tabellen zu blockieren.

## Nächste Schritte

- [Realtime & WebSocket](/docs/backend/realtime) – Abonnements, Channels und Presence, die von diesen Events gespeist werden.
- [Realtime über Instanzen hinweg](/docs/backend/realtime-transports) – der Bus, der Änderungen zwischen Serverprozessen überträgt.
