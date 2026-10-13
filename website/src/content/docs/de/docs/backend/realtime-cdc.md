---
sourceHash: c3a5adad80c0b11b
title: "Change Capture auf Datenbankebene (CDC)"
sidebar_label: "Change Capture auf Datenbankebene (CDC)"
---

**Change Data Capture ist standardmäßig aktiviert.** Rebase erfasst Änderungen direkt an der Datenbank und gibt Realtime-Events für **jeden bestätigten (committed) Schreibvorgang aus, unabhängig davon, wie er getätigt wurde** – REST, SDK, Studio, `psql`, ein Cron-Job in einem anderen Dienst, rohes Drizzle/SQL oder der **SQL-Editor** von Studio. Dies entspricht demselben Modell wie bei Supabase Realtime, das das Write-Ahead-Log überwacht.

Es ist keine Konfiguration erforderlich. Bei einer Datenbankverbindung, die dies unterstützt, richtet sich CDC beim Start automatisch ein (Self-Provisioning); bei einer, die dies nicht unterstützt (z. B. eine eingeschränkte Rolle, die keine Trigger erstellen kann), wechselt Rebase stillschweigend zu Realtime auf Anwendungsebene – nichts muss aktiviert werden, nichts bricht ab.

## Konfiguration

CDC wird über die Umgebungsvariable `REALTIME_CDC` gesteuert:

| Value | Behavior |
| --- | --- |
| `auto` *(Standard)* | Erfassung auf Datenbankebene aktivieren, sofern die Verbindung dies unterstützt; andernfalls **stillschweigender Fallback** auf Realtime auf Anwendungsebene. Keine Konfiguration erforderlich. |
| `trigger` | Trigger-basierte Erfassung erzwingen. Funktioniert auf jedem PostgreSQL, einschließlich Managed Instances ohne logische Replikation. Gibt eine Warnung aus (statt stillschweigend zurückzufallen), wenn die Bereitstellung fehlschlägt. |
| `wal` | Bevorzugt logische WAL-Replikation. Noch nicht integriert – fällt auf `trigger` zurück und protokolliert den aktiven Modus. |
| `off` | Nur Realtime auf Anwendungsebene. Verwenden Sie dies, um den Trigger-Overhead pro Schreibvorgang bei schreibintensiven Workloads zu vermeiden. Ein Start mit `off`, der das Schema besitzt, **entfernt** außerdem die Capture-Trigger und -Funktionen, die ein früherer Start installiert hat, und loggt, wie viele er entfernt hat; setzen Sie den Wert zurück, installiert der nächste Start sie wieder. |

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

   <span class="since-badge" data-since="0.25">Seit 0.25</span> **Upgrade.** Eine Datenbank, die von einer Version vor dem Batching instrumentiert wurde, hat einen Trigger pro Zeile; der erste Start einer neueren Version ersetzt ihn durch die Trigger pro Statement. 24 Stunden danach senden die neuen Trigger weiterhin eine Benachrichtigung pro Zeile, wie es die alten taten, sodass Instanzen der älteren Version, die während eines Rolling Deploys (oder nach einem Rollback) noch laufen, jede Zeile hören. Nach dem Fenster batchen sie. Jede Version, die batcht, liest beide Formen.
2. **Erfassung** – Ein dedizierter, ungepoolter `LISTEN`-Client pro Instanz verarbeitet `rebase_cdc`, ordnet die geänderte Tabelle wieder ihrer Collection zu und speist die Änderung in dieselbe `RealtimeService`-Pipeline ein, die von API-Mutationen verwendet wird. Wie der instanzübergreifende Listener bevorzugt er `DATABASE_DIRECT_URL` und verbindet sich automatisch wieder.
3. **RLS-sichere Zustellung** – Die rohe Zeile aus dem Änderungs-Stream wird **niemals** an Abonnenten weitergeleitet. Die Änderung wird als ungültig markiert und jedes Abonnement liest die Zeile unter seinem **eigenen** Authentifizierungskontext erneut aus. Die Filterung erfolgt daher pro Abonnent, niemals pro Publisher: Ein Client empfängt immer nur Zeilen, die seine RLS-Richtlinien zulassen.
4. **Instanzübergreifend** – Da jede Instanz jeden Commit über den Change-Stream beobachtet, *ist* CDC gleichzeitig der instanzübergreifende Kanal; der frühere mutationsbasierte `rebase_entity_changes`-Broadcast wird nicht verwendet, solange CDC aktiv ist.
5. **Deduplizierung** – Eine über die Rebase-API durchgeführte Mutation wird lokal in dem Moment zugestellt, in dem sie committet wird, und wird zudem über den Change-Stream als Echo zurückgesendet. Die Ursprungsinstanz unterdrückt ein Echo, das innerhalb des Refetch-Debounce-Fensters eintrifft (über eine kurzlebige Aufzeichnung ihrer eigenen Ausgaben), sodass ein API-Schreibvorgang normalerweise einen Frame erzeugt. Ein Echo, das später eintrifft, löst einen weiteren Refetch aus, der dieselben Zeilen erneut ausliefert: harmlos, aber ein Abonnent kann einen identischen Frame zweimal sehen.

## Anforderungen & Hinweise

- CDC erfordert einen direkten Connection-String (`DATABASE_DIRECT_URL` oder die primäre Verbindung) für den `LISTEN`-Client – Connection-Pooler im Transaktionsmodus unterstützen keine langlebigen `LISTEN`-Sitzungen.
- Trigger werden nur auf Tabellen installiert, die einer registrierten Collection zugeordnet sind. Schreibvorgänge in nicht zugeordnete Tabellen werden ignoriert.
- Eine Collection, deren Tabelle noch nicht migriert wurde, wird mit einer Warnung übersprungen, anstatt CDC für die übrigen zu blockieren.
- Natives WAL-Logical-Replication-Streaming (`wal2json`/`pgoutput`) ist geplant; derzeit fällt `REALTIME_CDC=wal` auf den triggerbasierten Pfad zurück, der eine gleichwertige Abdeckung auf Datenbankebene bietet.
