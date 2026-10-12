---
sourceHash: 4952ad745ea2bab4
title: Entitätshistorie
sidebar_label: Entitätshistorie
description: Verfolgen Sie jede Änderung an Ihren Entitäten mit einem vollständigen Audit-Trail – wer hat was wann geändert, inklusive vollständigem Vorher-/Nachher-Zustand.
---

## Übersicht

Die Entitätshistorie zeichnet bei jedem Erstellen, Aktualisieren und Löschen einen Snapshot der Entitätswerte auf. Dadurch erhalten Sie einen vollständigen Audit-Trail mit Diffs.

## Historie aktivieren

:::note[Wo dies hingehört]
**Managed Runtime** – standardmäßig aktiviert. `REBASE_HISTORY=false` in der `.env` deaktiviert sie.

**Ejected** – `history: true` in `initializeRebaseBackend({ … })`. Die unten gezeigte Objektform – `{ retention }` – ist nur im Ejected-Modus verfügbar; die Umgebungsvariable ist ein Boolean.

Die vollständige Zuordnung finden Sie in der [Backend-Übersicht](/docs/backend/#where-each-option-lives).
:::

### Backend

:::note[Wo dies hingehört]
**Managed Runtime:** `REBASE_HISTORY` (standardmäßig `true`; auf `false` setzen, um sie zu deaktivieren). Retention-Einstellungen haben keine Entsprechung als Umgebungsvariable – führen Sie ein Eject durch, um sie zu ändern.
**Ejected:** `initializeRebaseBackend({ history })` in `backend/src/index.ts`.
:::

Aktivieren Sie die Historie in `initializeRebaseBackend`:

```typescript no-verify
await initializeRebaseBackend({
    // ...
    history: true
});
```

Oder mit einem benutzerdefinierten Aufbewahrungszeitraum (Retention Period):

```typescript
history: {
    retention: 30        // Days. Entries older than this are pruned (default: 90)
}
```

### Pro Collection

Legen Sie fest, welche Collections eine Historie aufzeichnen sollen:

```typescript
import { defineCollection } from "@rebasepro/cms-types";
const ordersCollection = defineCollection({
    slug: "orders",
    name: "Orders",
    table: "orders",
    history: true,       // Enable for this collection
    properties: { /* ... */ }
});
```

## Funktionsweise

1. Das Backend erstellt automatisch eine Tabelle `rebase.entity_history`.
2. Bei jedem Erstellen, Aktualisieren oder Löschen wird ein Eintrag aufgezeichnet mit:
   - Der Entitäts-ID und dem Collection-Slug (in `table_name`)
   - Den Werten der Entität nach der Änderung (`values`; bei einem Löschen die
     Entität, die gelöscht wurde)
   - Bei einem Update dem, was die geänderten Felder davor enthielten (`previous_values`)
   - Zeitstempel und Benutzer-ID
   - Der Aktion (`create`, `update`, `delete`)
   - Einem Array aus `changed_fields`, das zeigt, welche Spalten geändert wurden

Die Werte sind die Zeile, so wie die REST-API sie liefert: ihre Spalten, Daten als Zeitstempel, eine `belongsTo`-Relation als ihr Fremdschlüssel. Das ist es, was ein Revert zurückschreibt.

Ein Eintrag enthält nie die Werte einer verknüpften Zeile. Um die Historie einer Zeile zu lesen,
genügt Lesezugriff auf diese Zeile, nicht auf die Zeilen, auf die sie zeigt; deshalb wird eine
Relation als Referenz gespeichert – `{ "__type": "relation", "id", "path" }` – und nicht mehr.
Einträge, die ältere Versionen mit eingebetteter verknüpfter Zeile aufgezeichnet haben (ein Löschen
speicherte früher die Sicht des Admin-Panels auf die Zeile), werden genauso ausgeliefert: Der
History-Endpunkt entfernt die eingebetteten Werte, bevor er antwortet.

Bei einer Collection mit [Soft Delete](/docs/collections/soft-delete/) wird ein Löschen als `delete` aufgezeichnet und eine Wiederherstellung (das Update, das das Soft-Delete-Feld wieder auf `null` setzt) als `update`. Die Historie einer Zeile bleibt lesbar, während sich die Zeile im Papierkorb befindet, und ein Revert auf eine Version von vor dem Löschen stellt sie wieder her.

### Was `previous_values` enthält

<span class="since-badge" data-since="0.25">Seit 0.25</span> Ein Update-Eintrag
behält in `previous_values` nur die Felder, die in `changed_fields` aufgeführt sind. Jedes
andere Feld hatte vor und nach der Änderung denselben Wert und steht deshalb bereits in
`values`; die ganze Zeile doppelt zu speichern kostete bei einer Ein-Feld-Änderung an einer
Zeile mit 20 Feldern 1.269 Bytes, wo es jetzt 794 sind.

Vor 0.25 aufgezeichnete Einträge behalten die ganze vorherige Zeile. Das `format` des
Eintrags sagt, welche es ist:

| `format` | `previous_values` bei einem Update |
|---|---|
| `1` (Einträge von vor 0.25) | Die ganze Zeile vor der Änderung |
| `2` | Nur die `changed_fields`, jedes so, wie die ganze Zeile es hatte |

Die Historienansicht des Admins und ein Revert lesen beide gleichermaßen: Die Ansicht zeigt den
vorherigen Wert jedes geänderten Felds, und ein Revert schreibt die `values` des gewählten
Eintrags zurück, die in beiden Formaten vollständig sind. Um die Zeile so wiederherzustellen,
wie sie vor einer `format: 2`-Änderung war, nehmen Sie `values` und setzen jedes Feld zurück,
das `previous_values` enthält.

### Diff-Tracking & strukturelle Deep Equality

Um redundante Protokolle zu vermeiden, wenn Felder gespeichert werden, sich aber keine Werte ändern, führt der `HistoryService` einen strukturellen Deep-Equality-Vergleich auf den Top-Level-Schlüsseln der alten und neuen Werte durch:
- Er ignoriert System-Metadaten-Eigenschaften, die mit `__` beginnen.
- Wenn Unterschiede festgestellt werden, werden die Namen der geänderten Eigenschaften in der Spalte `changed_fields` (`text[]`) gespeichert.
- Wenn die Deep-Equality-Prüfung keinerlei Änderungen feststellt, wird das Einfügen in die Historie vollständig übersprungen.

### Pruning

Die Aufbewahrung wird an zwei Stellen durchgesetzt:
- **Nach jedem Schreibvorgang**, für die geschriebene Entität: Direkt nachdem sie gespeichert
  oder gelöscht wurde, entfernt der Server die Einträge dieser Entität, die über die neuesten
  200 hinausgehen oder älter als der Aufbewahrungszeitraum sind. Der Schreibvorgang wird dadurch
  nicht aufgehalten.
- <span class="since-badge" data-since="0.25">Seit 0.25</span> **Einmal pro Stunde**,
  für jede Entität: Einträge, die älter als der Aufbewahrungszeitraum sind, werden gelöscht,
  unabhängig davon, wozu sie gehören — auch bei Entitäten, in die nie wieder geschrieben
  wird, etwa gelöschten. Siehe [Pruning-Lebenszyklusmechanik](#pruning-lebenszyklusmechanik).

## REST-Endpunkt

```
GET /api/data/:slug/:entityId/history
```

Gibt eine Liste von Historie-Einträgen für eine bestimmte Entität zurück, absteigend nach Aktualität sortiert:

```json
{
    "data": [
        {
            "id": "5b0e7c2e-…",
            "table_name": "orders",
            "entity_id": "123",
            "action": "update",
            "changed_fields": ["status"],
            "values": { "status": "shipped", "total": 99.99 },
            "previous_values": { "status": "pending" },
            "updated_by": "admin-user-id",
            "updated_at": "2025-01-15T10:30:00Z",
            "format": 2
        }
    ],
    "meta": { "total": 1, "limit": 20, "offset": 0, "hasMore": false }
}
```

```
POST /api/data/:slug/:entityId/history/:historyId/revert
```

Schreibt die `values` des Eintrags über den normalen Speicherpfad in die Zeile zurück, sodass der
Revert selbst als `update` aufgezeichnet wird. Die Antwort enthält die gespeicherte Zeile unter `data`
und in `meta.reverted_from` die ID des Eintrags.

Von älteren Versionen geschriebene Einträge können Schlüssel enthalten, für die die Zeile keine Spalte
hat: ein Feld, das ein `afterRead` berechnet hat (vor 0.24 zeichnete ein Speichern die Zeile so auf,
wie `afterRead` sie zeigte), oder eine Relation, die als Sicht des Admin-Panels auf sie gespeichert
wurde. Ein Revert schreibt die Spalten der Zeile und lässt diese Schlüssel weg, wobei eine besitzende
Relation als ihr Fremdschlüssel zurückgeht, und nennt in `meta.dropped_fields`, was er weggelassen hat.
Ein Wert, den ein altes `afterRead` maskiert hat (`********`), hat eine Spalte und wird daher so
zurückgeschrieben, wie er aufgezeichnet wurde.

## Retention-Konfiguration

| Einstellung | Standard | Beschreibung |
|-------------|----------|--------------|
| `retention` | 90 | Einträge, die älter als diese Anzahl an Tagen sind, werden gelöscht. |

Jede Entität behält zudem höchstens ihre neuesten **200** Einträge. Diese Obergrenze ist fest vorgegeben; es gibt dafür keine Einstellung.

### Pruning-Lebenszyklusmechanik

Nach jeder aufgezeichneten Änderung wird die geänderte Entität bereinigt: Ihre Einträge, die älter als der Aufbewahrungszeitraum sind, werden gelöscht, danach alles, was über ihre neuesten 200 hinausgeht. Das läuft asynchron und hält den Schreibvorgang nicht auf.

<span class="since-badge" data-since="0.25">Seit 0.25</span> Einmal pro Stunde löscht das Backend zusätzlich jeden Eintrag, der älter als der Aufbewahrungszeitraum ist, von jeder Entität. Zuvor wurde die Historie einer Entität, in die nie wieder geschrieben wurde — jeder gelöschten —, überhaupt nicht bereinigt. Der Durchlauf:

- läuft pro Stunde auf einer Instanz der Flotte, auf den Prozessen, die die geplanten Jobs ausführen (er beansprucht seine Stunde in `rebase.cron_claims`, wie es eine Cron-Ausführung tut), zum ersten Mal beim Start des Backends;
- löscht in Batches von 5.000 Einträgen, je eine Anweisung, bis ein Batch kürzer ausfällt, und überspringt Einträge, die ein anderer Durchlauf hält — ein erster Durchlauf über einen großen Rückstand besteht also aus vielen kurzen Löschvorgängen, nicht aus einem langen;
- liest einen Index auf `updated_at`, `idx_history_updated_at`. In einer vor 0.25 erstellten Datenbank wird er nach dem ersten Start im Hintergrund aufgebaut, per `CREATE INDEX CONCURRENTLY`, ohne Lese- oder Schreibzugriffe zu blockieren — etwa eine Sekunde pro 2 Millionen Einträge.

Derselbe Start entfernt `idx_history_entity`, wo er existiert: `idx_history_time` beginnt mit denselben Spalten und bedient jeden Lesezugriff, den er bediente, sodass er nur jede aufgezeichnete Änderung verlangsamte. Das Entfernen wartet jeweils höchstens eine Sekunde auf die Sperre der Tabelle, und eine Tabelle, die etwas durchgehend hält, behält den Index bis zum nächsten Start.

Die Obergrenze von 200 Einträgen pro Entität wird nur nach einem Schreibvorgang auf diese Entität angewendet.

## Nächste Schritte

- **[Entity Callbacks](/docs/collections/callbacks)** – Lifecycle-Hooks
- **[Backend Overview](/docs/backend)** – Vollständige Backend-Konfiguration
