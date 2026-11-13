---
sourceHash: 37c268f3d4b76c7f
title: Entity-Historie
sidebar_label: Entity-Historie
description: Verfolgen Sie jede Änderung an Ihren Entitäten mit einem vollständigen Audit-Trail – wer was wann geändert hat, sowie die vollständige Vorher-/Nachher-Entität.
---

## Übersicht

Die Entitätshistorie zeichnet bei jedem Erstellen, Aktualisieren und Löschen einen Snapshot der Entitätswerte auf. Dadurch erhalten Sie einen vollständigen Audit-Trail mit Diffs.

## Historie aktivieren

:::note[Wo dies hingehört]
**Managed Runtime** – standardmäßig aktiviert. `REBASE_HISTORY=false` in `.env` deaktiviert sie.

**Ejected** – `history: true` in `initializeRebaseBackend({ … })`. Die unten gezeigte Objektform – `{ retention }` – ist nur im Ejected-Modus verfügbar; die Umgebungsvariable ist ein Boolean.

Die vollständige Übersicht finden Sie in der [Backend-Übersicht](/docs/backend/#where-each-option-lives).
:::

### Backend

:::note[Wo dies hingehört]
**Managed Runtime:** `REBASE_HISTORY` (standardmäßig `true`; auf `false` setzen, um sie zu deaktivieren). Retention-Einstellungen haben keine Entsprechung als Umgebungsvariable – führen Sie Eject aus, um sie zu ändern.
**Ejected:** `initializeRebaseBackend({ history })` in `backend/src/index.ts`.
:::

Aktivieren Sie die Historie in `initializeRebaseBackend`:

```typescript no-verify
await initializeRebaseBackend({
    // ...
    history: true
});
```

Oder mit einer benutzerdefinierten Aufbewahrungsdauer (Retention):

```typescript
history: {
    retention: 30        // Days. Entries older than this are pruned (default: 90)
}
```

### Pro Tabelle

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Legen Sie mit `history: true` fest, welche Tabellen die Historie nachverfolgen:

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const orders = defineTable("orders", {
    columns: {
        id:     col.uuid().primaryKey().defaultRandom(),
        status: col.enum(["open", "paid", "shipped"]).notNull().default("open"),
        total:  col.numeric({ precision: 10, scale: 2 }).notNull(),
    },
    history: true,
    rls: "admin-only",
});
```

Ein View kann keine Historie nachverfolgen: er wird nie beschrieben.

## Wie es funktioniert

1. Das Backend erstellt automatisch eine `rebase.entity_history`-Tabelle.
2. Bei jedem Erstellen, Aktualisieren oder Löschen wird ein Eintrag mit folgenden Angaben aufgezeichnet:
   - Entitäts-ID und dem Slug der Tabelle (in `table_name`)
   - Den Werten der Entität nach der Änderung (`values`; bei einem Löschvorgang die Entität, die gelöscht wurde)
   - Bei einer Aktualisierung die Werte, die die geänderten Felder zuvor hatten (`previous_values`)
   - Zeitstempel und Benutzer-ID
   - Die Aktion (`create`, `update`, `delete`)
   - Ein Array von `changed_fields`, das zeigt, welche Spalten geändert wurden

Die Werte entsprechen der Zeile, wie die REST-API sie ausliefert: ihre Spalten, Datumsangaben als Zeitstempel, ein `belongsTo` als Fremdschlüssel. Dies ist es, was ein Revert zurückschreibt.

Ein Eintrag enthält niemals die Werte einer verknüpften Zeile. Das Lesen der Historie einer Zeile erfordert nur Lesezugriff auf diese Zeile, nicht auf die Zeilen, auf die sie verweist; daher wird ein `belongsTo` lediglich als Fremdschlüssel gespeichert und nichts weiter.

Einträge, die ältere Versionen über die Ansicht des Admin-Panels der Zeile aufgezeichnet haben (ein Löschvorgang hat dies früher so gespeichert), werden als die Zeile ausgeliefert und zurückgesetzt, für die sie stehen: ein `{ "__type": "date", "value" }`-Envelope als dessen Wert, eine `{ "__type": "relation" }`-Ref einer besitzenden Relation als Fremdschlüssel unter dem Namen des Schlüssels selbst, jede andere Relations-Ref als Schlüssel der verknüpften Zeile, und eine verknüpfte Zeile, die die Ref eingebettet hat, wird niemals ausgeliefert. Das Zurücksetzen eines solchen Eintrags schreibt diese einfachen Werte; eine To-Many-Liste, die er enthält, wird nicht geschrieben und in `dropped_fields` aufgeführt.

Bei einer Tabelle mit [Soft Delete](/docs/collections/soft-delete/) wird ein Löschen als `delete` und eine Wiederherstellung (die Aktualisierung, die das Soft-Delete-Feld wieder auf `null` setzt) als `update` aufgezeichnet. Die Historie einer Zeile bleibt lesbar, während sich die Zeile im Papierkorb befindet, und das Zurücksetzen auf eine Version vor dem Löschen stellt sie wieder her.

### Was `previous_values` enthält

Ein Update-Eintrag speichert in `previous_values` nur die in `changed_fields` aufgelisteten Felder. Jedes andere Feld hatte vor und nach der Änderung denselben Wert und ist daher bereits in `values` enthalten; das zweimalige Speichern der gesamten Zeile kostete bei einer Ein-Feld-Änderung an einer Zeile mit 20 Feldern 1.269 Bytes, während es jetzt 794 Bytes kostet.

Einträge, die vor Version 0.25 aufgezeichnet wurden, behalten die gesamte vorherige Zeile. Das `format` des Eintrags gibt an, um welches Format es sich handelt:

| `format` | `previous_values` bei einem Update |
|---|---|
| `1` (Einträge vor 0.25) | Die gesamte Zeile vor der Änderung |
| `2` | Nur die `changed_fields`, jeweils so, wie die gesamte Zeile sie hatte |

Die Historienansicht des Admin-Panels und ein Revert lesen beide gleichermaßen: Die Ansicht zeigt den vorherigen Wert jedes geänderten Felds, und ein Revert schreibt die `values` des ausgewählten Eintrags zurück, die in beiden Formaten vollständig sind. Um die Zeile so wiederherzustellen, wie sie vor einer Änderung mit `format: 2` war, nehmen Sie `values` und setzen Sie jedes in `previous_values` enthaltene Feld zurück.

### Diff-Tracking & strukturelle Deep Equality

Um redundante Protokolle zu vermeiden, wenn Felder gespeichert werden, sich aber keine Werte ändern, führt der `HistoryService` einen strukturellen Deep-Equality-Vergleich auf den Top-Level-Schlüsseln der alten und neuen Werte durch:
- Er ignoriert System-Metadatenfelder, die mit `__` beginnen.
- Wenn Unterschiede festgestellt werden, werden die Namen der geänderten Felder in der Spalte `changed_fields` (`text[]`) gespeichert.
- Wenn die Deep-Equality-Prüfung keinerlei Änderungen feststellt, wird das Einfügen in die Historie vollständig übersprungen.

### Bereinigung (Pruning)

Die Aufbewahrungsfrist wird an zwei Stellen durchgesetzt:
- **Nach jedem Schreibvorgang** für die geschriebene Entität: Direkt nach dem Speichern oder Löschen bereinigt der Server die Einträge dieser Entität jenseits der neuesten 200 oder solche, die älter als der Aufbewahrungszeitraum sind. Dies blockiert den Schreibvorgang nicht.
- **Einmal pro Stunde** für jede Entität: Einträge, die älter als der Aufbewahrungszeitraum sind, werden gelöscht, unabhängig davon, wozu sie gehören – einschließlich Entitäten, auf die nie wieder geschrieben wird, wie beispielsweise gelöschte Entitäten. Siehe [Mechanik des Bereinigungs-Lebenszyklus](#mechanik-des-bereinigungs-lebenszyklus).

## REST-Endpunkt

```
GET /api/data/:slug/:entityId/history
```

Gibt eine Liste von Historieeinträgen für eine bestimmte Entität zurück, sortiert nach den neuesten zuerst. <span class="since-badge" data-since="0.31">Seit 0.31</span> Einträge, die von einer Transaktion aufgezeichnet werden – ein Erstellen und das darauffolgende Update in einem einzelnen `_batch`, ein Revert und dessen Revert – werden in der Reihenfolge zurückgegeben, in der sie geschrieben wurden: Das `updated_at` jedes Eintrags liegt zeitlich nach dem vorherigen Eintrag der Zeile. Eine bestehende Datenbank erhält dies mit ihrem nächsten Bereitstellungsstart (Provisioning Boot) oder einem Durchlauf mit `REBASE_PROVISION_ONLY=true`, wodurch die Funktion `rebase.record_history` ersetzt wird; ein Deployment, das niemals bereitgestellt wird, behält bis dahin die alte Reihenfolge bei. Einträge, die davor aufgezeichnet wurden, behalten ihre Reihenfolge.

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

### Einträge werden wie Lesevorgänge ausgeliefert

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Historieeinträge werden genauso ausgeliefert wie die Zeile selbst: zuerst Feldzugriff, dann `afterRead` (global, Tabelle, Spalte), innerhalb der schreibgeschützten Transaktion des Aufrufers. Eine Spalte, die durch einen Hook oder ein `.transform({ afterRead })` maskiert wird, ist in `values` und `previous_values` maskiert; eine Spalte, die die Rollen des Aufrufers nicht lesen dürfen, wird vorenthalten und aus `changed_fields` weggelassen; Schlüssel von Spalten, die die Tabelle nicht mehr besitzt, werden vorenthalten. Wer die Zeile jetzt lesen darf, kann auch deren Historie einsehen, und `updated_by` bleibt erhalten. Ein Hook, der bei einem alten Snapshot einen Fehler wirft, schlägt für die gesamte Anfrage fehl, anstatt sie unmaskiert auszuliefern, und die Historie einer endgültig gelöschten (hard-deleted) Zeile antwortet mit 404 ("No row with id '…' in table '…'").

Der Postgres-Treiber unterstützt dies; ein benutzerdefinierter Treiber liefert die Historie durch Implementierung von `DataDriver.serveStoredRows(path, rows)` aus, und ohne dies antworten die Historien-Routen mit 501. Vor 0.31 wurden Einträge so ausgeliefert, wie sie gespeichert waren.

```
POST /api/data/:slug/:entityId/history/:historyId/revert
```

Schreibt die `values` des Eintrags über den normalen Speicherpfad zurück in die Zeile, sodass das Revert selbst als `update` aufgezeichnet wird. Die Antwort enthält die gespeicherte Zeile unter `data` und die ID des Eintrags unter `meta.reverted_from`. Ein Revert schreibt niemals eine Spalte, die der Aufrufer nicht lesen kann: diese behalten ihren aktuellen Wert.

Einträge, die von älteren Versionen geschrieben wurden, können Schlüssel enthalten, für die die Zeile keine Spalte besitzt: ein von `afterRead` berechnetes Feld (vor Version 0.24 zeichnete ein Speichervorgang die Zeile so auf, wie `afterRead` sie anzeigte) oder eine Relation, die in der Darstellungsform des Admin-Panels gespeichert wurde. Ein Revert schreibt die Spalten der Zeile und lässt diese Schlüssel aus – wobei eine besitzende Relation als ihr Fremdschlüssel zurückgeht – und nennt die ausgelassenen Felder in `meta.dropped_fields`. Ein Wert, den ein altes `afterRead` maskiert hat (`********`), besitzt eine Spalte, sodass er so zurückgeschrieben wird, wie er aufgezeichnet wurde.

## Retention-Konfiguration

| Einstellung | Standard | Beschreibung |
|---|---|---|
| `retention` | 90 | Einträge, die älter als diese Anzahl an Tagen sind, werden gelöscht. |

Jede Entität behält außerdem höchstens ihre **200** neuesten Einträge. Diese Obergrenze ist festgelegt; es gibt dafür keine Konfigurationseinstellung.

### Mechanik des Bereinigungs-Lebenszyklus

Nach jeder vom Server aufgezeichneten Änderung wird die geänderte Entität bereinigt: Ihre Einträge, die älter als der Aufbewahrungszeitraum sind, werden entfernt, danach alles jenseits der neuesten 200. Dies läuft asynchron ab und blockiert den Schreibvorgang nicht.

Ein Schreibvorgang über [`openRebase` oder `rebase console`](/docs/backend/scripts/) zeichnet seinen Historieeintrag auf, bereinigt jedoch nichts, da ein Skript die für Ihren Server konfigurierte Retention nicht kennen kann. Der Server bereinigt diese Entität beim nächsten Schreibvorgang auf sie sowie beim stündlichen Bereinigungslauf unten.

Einmal pro Stunde löscht das Backend außerdem für jede Entität alle Einträge, die älter als der Aufbewahrungszeitraum sind. Zuvor wurde die Historie einer Entität, die nie wieder beschrieben wurde – darunter jede gelöschte Entität –, überhaupt nicht bereinigt. Der Bereinigungslauf:

- läuft einmal pro Stunde auf einer Instanz der Flotte auf den Prozessen, die geplante Jobs ausführen (er beansprucht seine Stunde in `rebase.cron_claims`, genau wie ein Cron-Lauf), erstmals beim Start des Backends;
- löscht in Batches von 5.000 Einträgen mit jeweils einem Statement, bis ein Batch kleiner ausfällt, und überspringt Einträge, die von einem anderen Bereinigungslauf gehalten werden – so besteht ein erster Durchlauf über einen großen Rückstand aus vielen kurzen Löschvorgängen statt einem langen;
- liest einen Index auf `updated_at`, `idx_history_updated_at`. Auf einer vor Version 0.25 erstellten Datenbank wird dieser nach dem ersten Start im Hintergrund mit `CREATE INDEX CONCURRENTLY` aufgebaut, ohne Lese- oder Schreibvorgänge zu blockieren – etwa eine Sekunde pro 2 Millionen Einträge.

Derselbe Boot-Vorgang entfernt `idx_history_entity`, sofern vorhanden: `idx_history_time` beginnt mit denselben Spalten und deckt alle Lesevorgänge ab, die dieser bediente, sodass er jeden aufgezeichneten Änderungsvorgang nur verlangsamte. Das Entfernen wartet jeweils höchstens eine Sekunde auf die Tabellensperre, und eine Tabelle, die durchgehend von etwas belegt ist, behält den Index bis zum nächsten Start.

Die Obergrenze von 200 Einträgen pro Entität wird nur nach einem Schreibvorgang auf diese Entität angewendet.

## Nächste Schritte

- **[Tabellen-Hooks](/docs/collections/callbacks/)** — Lifecycle-Hooks
- **[Backend-Übersicht](/docs/backend)** — Vollständige Backend-Konfiguration
