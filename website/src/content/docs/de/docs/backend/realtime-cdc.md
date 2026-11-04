---
sourceHash: e3f0b557b79dc3c6
title: "Change Capture auf Datenbankebene (CDC)"
sidebar_label: "Change Capture auf Datenbankebene (CDC)"
description: "Realtime-Events für jeden bestätigten Schreibvorgang, gleich wie er getätigt wurde: die Capture-Trigger, die Einstellung REALTIME_CDC und was sie brauchen."
---

**Change Data Capture ist standardmäßig aktiviert.** Rebase erfasst Änderungen direkt an der Datenbank und gibt Realtime-Events für **jeden bestätigten (committed) Schreibvorgang aus, unabhängig davon, wie er getätigt wurde** – REST, SDK, Studio, `psql`, ein Cron-Job in einem anderen Dienst, rohes Drizzle/SQL oder der **SQL-Editor** von Studio. Dies entspricht demselben Modell wie bei Supabase Realtime, das das Write-Ahead-Log überwacht.

Es ist keine Konfiguration erforderlich. Bei einer Datenbankverbindung, die dies unterstützt, richtet sich CDC beim Start automatisch ein (Self-Provisioning); bei einer, die dies nicht unterstützt (z. B. eine eingeschränkte Rolle, die keine Trigger erstellen kann), wechselt Rebase stillschweigend zu Realtime auf Anwendungsebene – nichts muss aktiviert werden, nichts bricht ab.

## Konfiguration

CDC wird über die Umgebungsvariable `REALTIME_CDC` gesteuert:

| Value | Behavior |
| --- | --- |
| `auto` *(Standard)* | Erfassung auf Datenbankebene aktivieren, sofern die Verbindung dies unterstützt; andernfalls **stillschweigender Fallback** auf Realtime auf Anwendungsebene. Keine Konfiguration erforderlich. |
| `trigger` | Trigger-basierte Erfassung erzwingen. Funktioniert auf jedem PostgreSQL, einschließlich Managed Instances ohne logische Replikation. Gibt eine Warnung aus (statt stillschweigend zurückzufallen), wenn die Bereitstellung fehlschlägt. |
| `wal` | Liest Änderungen über logische Replikation aus dem Write-Ahead-Log statt über Trigger, sodass ein Schreibvorgang keinen Trigger ausführt und kein `NOTIFY` sendet. Benötigt `wal_level=logical` und eine Rolle, die replizieren darf; fällt mit einer Warnung auf `trigger` zurück, wenn eines davon fehlt. Siehe [Erfassung aus dem WAL](#erfassung-aus-dem-wal). |
| `off` | Nur Realtime auf Anwendungsebene. Verwenden Sie dies, um den Trigger-Overhead pro Schreibvorgang bei schreibintensiven Workloads zu vermeiden. Ein Start mit `off`, der das Schema besitzt, **entfernt** außerdem die Capture-Trigger und -Funktionen, die ein früherer Start installiert hat, und loggt, wie viele er entfernt hat; setzen Sie den Wert zurück, installiert der nächste Start sie wieder. |

Dieselbe Einstellung ist die
Option `realtime.cdc` des Postgres-Adapters, für einen Server, der sie im Code konfiguriert.
`REALTIME_CDC` hat, sofern gesetzt, Vorrang.

Beim Start wird eine Protokollzeile mit dem aktiven Modus ausgegeben, z. B.:

```
📡 [CDC] Realtime source = database-level change capture (mode: trigger).
   All writes now emit realtime events regardless of origin.
```

Wenn die Verbindung dies nicht unterstützt, gibt `auto` stattdessen eine Informationszeile aus und fährt mit Realtime auf Anwendungsebene fort:

```
ℹ️ [CDC] Database-level change capture unavailable (likely insufficient
   privileges to create triggers…) — using app-level realtime.
```

## Funktionsweise

1. **Automatische Bereitstellung (Self-Provisioning)** – Beim Start (im Server-/Owner-Kontext) installiert Rebase idempotente `AFTER INSERT/UPDATE/DELETE/TRUNCATE`-Trigger auf jeder verwalteten Tabelle. Sie feuern einmal pro Statement und geben Änderungsbenachrichtigungen auf dem Kanal `rebase_cdc` aus, die die geänderten Zeilen anhand ihres Schlüssels benennen – den Primärschlüssel, plus die beiden ID-Spalten bei der Verbindungstabelle einer manyToMany-Relation – und **keine andere Spalte** tragen. Ein Statement, das viele Zeilen geändert hat, benennt sie in Batches von etwa tausend Schlüsseln, sodass ein `UPDATE` über 1 Mio. Zeilen etwa 1.000 Benachrichtigungen sendet statt einer Million; ein Statement, das eine Zeile geändert hat, sendet eine Benachrichtigung, und eines, das keine geändert hat, nichts. Ein `TRUNCATE` wird als Änderung an jeder Zeile der Collection angekündigt. Eine partitionierte Tabelle behält einen Trigger pro Zeile, weil PostgreSQL einen Zeilen-Trigger auf jede Partition kopiert und ein direkt auf eine Partition ausgeführter Schreibvorgang trotzdem gesehen wird. PostgreSQL vergibt für `LISTEN` kein Privileg, sodass jede Rolle, die sich mit der Datenbank verbinden kann, diesen Kanal lesen kann; sie erfährt, welche Schlüssel sich geändert haben, niemals, was diese enthalten. Ein Schlüssel, der zu groß für das 8&nbsp;KB-`NOTIFY`-Limit von PostgreSQL ist, wird ohne Schlüssel gesendet (eine Änderung an der gesamten Collection, die jedes Listen- und Einzelzeilen-Abonnement darauf neu abruft), sodass CDC den auslösenden Schreibvorgang niemals abbrechen kann. Die Funktionen werden bei jedem bereitstellenden Start ersetzt, sodass eine Datenbank, die von einer älteren Version instrumentiert wurde – deren Trigger ganze Zeilen sendete – beim nächsten Start aktualisiert wird; ein Start mit `REALTIME_CDC=off` entfernt sie stattdessen.

   **Upgrade.** Eine Datenbank, die von einer Version vor dem Batching instrumentiert wurde, hat einen Trigger pro Zeile; der erste Start einer neueren Version ersetzt ihn durch die Trigger pro Statement. 24 Stunden danach senden die neuen Trigger weiterhin eine Benachrichtigung pro Zeile, wie es die alten taten, sodass Instanzen der älteren Version, die während eines Rolling Deploys (oder nach einem Rollback) noch laufen, jede Zeile hören. Nach dem Fenster batchen sie. Jede Version, die batcht, liest beide Formen.
2. **Erfassung** – Ein dedizierter, ungepoolter `LISTEN`-Client pro Instanz verarbeitet `rebase_cdc`, ordnet die geänderte Tabelle wieder ihrer Collection zu und speist die Änderung in dieselbe `RealtimeService`-Pipeline ein, die von API-Mutationen verwendet wird. Wie der instanzübergreifende Listener bevorzugt er `DATABASE_DIRECT_URL` und verbindet sich automatisch wieder.
3. **RLS-sichere Zustellung** – Die rohe Zeile aus dem Änderungs-Stream wird **niemals** an Abonnenten weitergeleitet. Die Änderung wird als ungültig markiert und jedes Abonnement liest die Zeile unter seinem **eigenen** Authentifizierungskontext erneut aus. Die Filterung erfolgt daher pro Abonnent, niemals pro Publisher: Ein Client empfängt immer nur Zeilen, die seine RLS-Richtlinien zulassen.
4. **Instanzübergreifend** – Da jede Instanz jeden Commit über den Change-Stream beobachtet, *ist* CDC gleichzeitig der instanzübergreifende Kanal; der frühere mutationsbasierte `rebase_entity_changes`-Broadcast wird nicht verwendet, solange CDC aktiv ist.
5. **Deduplizierung** – Eine über die Rebase-API durchgeführte Mutation plant in dem Moment, in dem sie committet wird, einen Refetch für die lokalen Abonnenten ein und wird zudem über den Change-Stream als Echo zurückgesendet. Die Ursprungsinstanz unterdrückt ein Echo, das innerhalb des Refetch-Debounce-Fensters eintrifft (über eine kurzlebige Aufzeichnung ihrer eigenen Ausgaben), sodass ein API-Schreibvorgang normalerweise einen Frame erzeugt. Ein Echo, das später eintrifft, löst einen weiteren Refetch aus, der dieselben Zeilen erneut ausliefert: harmlos, aber ein Abonnent kann einen identischen Frame zweimal sehen.

## Erfassung aus dem WAL

`REALTIME_CDC=wal` liest Änderungen über logische Replikation (das integrierte Plugin `pgoutput`) aus dem Write-Ahead-Log von PostgreSQL statt über Trigger. Ein Schreibvorgang führt dann keinen Trigger aus und sendet kein `NOTIFY`. Das zählt, sobald gleichzeitig geschrieben wird: Eine Transaktion, die `NOTIFY` aufgerufen hat, nimmt beim Commit eine Sperre für den ganzen Server und hält sie, bis die Daten auf die Platte geschrieben sind, sodass diese Commits bei Trigger-Capture nacheinander erfolgen. Gemessen auf PostgreSQL 18 mit 32 gleichzeitigen Schreibern und 1&nbsp;ms pro Flush auf die Platte, hielt Trigger-Capture Inserts auf etwa einem Zehntel der Rate, die die Erfassung aus dem WAL erreichte.

Voraussetzungen:

- `wal_level = logical` auf dem Server, was einen Neustart erfordert. Auf Amazon RDS `rds.logical_replication = 1` setzen; auf Cloud SQL `cloudsql.logical_decoding = on`.
- Eine Rolle, die replizieren darf: `ALTER ROLE <role> REPLICATION` oder das Äquivalent des Anbieters (auf RDS die Mitgliedschaft in `rds_replication`).
- Ein freier Replikations-Slot und WAL-Sender pro Serverinstanz (`max_replication_slots` und `max_wal_senders`, beide standardmäßig 10).
- Eine direkte Verbindung (`DATABASE_DIRECT_URL`): Ein Pooler überträgt das Replikationsprotokoll nicht.

Fehlt eines davon, protokolliert der Start den Grund und verwendet stattdessen Trigger-Capture.

Was ein Start tut:

- Er erstellt eine Publikation namens `rebase_cdc` und fügt ihr die Tabelle jeder Collection und jede Verbindungstabelle einer manyToMany-Relation hinzu. Tabellen werden nur hinzugefügt, sodass eine ältere Version, die während eines Rolling Deploys noch läuft, die Tabelle einer neueren Collection nicht wieder herausnehmen kann.
- Eine Tabelle ohne Primärschlüssel oder mit `REPLICA IDENTITY NOTHING` bleibt mit einer Warnung draußen: PostgreSQL verweigert `UPDATE` und `DELETE` auf einer publizierten Tabelle, die nicht sagen kann, welche Zeile sich geändert hat. Schreibvorgänge darauf, die außerhalb von Rebase erfolgen, werden nicht erfasst.
- Jede Instanz liest die Publikation über ihren eigenen **temporären** Replikations-Slot, den PostgreSQL beim Schließen der Verbindung verwirft. Eine abstürzende Instanz kann also keinen Slot hinterlassen, der WAL zurückhält, bis die Platte voll ist. Eine Wiederverbindung beginnt einen neuen Slot, und jedes Abonnement ruft neu ab, weil das, was in der Lücke committet wurde, nicht erneut abgespielt wird.
- Sobald sein Stream offen ist, entfernt ein Start, der sowohl bereitstellt als auch konsumiert, die Capture-Trigger, wie es `off` tut. Während eines Rolling Deploys weg von Trigger-Capture hören Instanzen, die es noch ausführen, Schreibvorgänge von anderswo nicht mehr, bis sie ersetzt sind; ihre eigenen Schreibvorgänge erreichen ihre Abonnenten weiterhin. Ein Prozess, der nur bereitstellt, etwa der Migrationsjob einer [aufgeteilten Bereitstellung](/docs/deployment/split-processes/), behält die Trigger für Konsumenten, die nicht streamen können und auf sie zurückfallen.

Schreibende behalten bei einer Lastspitze ihre volle Geschwindigkeit, aber ein WAL-Sender dekodiert jeden Slot, sodass Events bei dauerhaft mehreren tausend Schreibvorgängen pro Sekunde verspätet ankommen können. Eine Rolle mit `REPLICATION` kann jede Zeile einer publizierten Tabelle über einen eigenen Slot lesen; der Stream bleibt im Server, und Abonnenten lesen jede Zeile weiterhin unter ihrem eigenen RLS neu.

## Anforderungen & Hinweise

`directConnectionString` ist die Adapter-Option; unter 0.24 verwenden Sie `DATABASE_DIRECT_URL`.

- CDC erfordert einen direkten Connection-String (`DATABASE_DIRECT_URL`, das `directConnectionString` des Adapters oder die primäre Verbindung) für den `LISTEN`-Client – Connection-Pooler im Transaktionsmodus unterstützen keine langlebigen `LISTEN`-Sitzungen.
- Trigger werden nur auf Tabellen installiert, die einer registrierten Collection zugeordnet sind, sowie auf den Junction-Tabellen ihrer Many-to-many-Relationen. Schreibvorgänge in nicht zugeordnete Tabellen werden ignoriert.
- Eine Collection, deren Tabelle noch nicht migriert wurde, wird mit einer Warnung übersprungen, anstatt CDC für die übrigen zu blockieren.

## Nächste Schritte

- [Realtime & WebSocket](/docs/backend/realtime) — Abonnements, Kanäle und Presence, die diese Events speisen.
- [Realtime über Instanzen hinweg](/docs/backend/realtime-transports) — der Bus, der Änderungen zwischen Server-Prozessen trägt.
