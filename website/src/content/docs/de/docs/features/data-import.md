---
title: Datenimport
sidebar_label: Datenimport
description: Importieren Sie Daten aus CSV-, JSON- und Excel-Dateien in Ihre Sammlungen mit Feldzuordnung und Validierung.
---

## Übersicht

Rebase unterstützt den Datenimport aus:

- **CSV**-Dateien
- **JSON**-Dateien
- **Excel** (`.xlsx`)-Dateien

Der Import-Assistent übernimmt die Spaltenzuordnung, Datentypumwandlung und Validierung.

## So importieren Sie

1. Öffnen Sie eine Sammlung im Admin-Panel
2. Klicken Sie in der Symbolleiste auf die Schaltfläche **Importieren**
3. Wählen Sie Ihre Datei aus oder ziehen Sie sie per Drag & Drop
4. Ordnen Sie Dateispalten den Sammlungseigenschaften zu
5. Zeigen Sie eine Vorschau der Daten an und beheben Sie Validierungsfehler
6. Klicken Sie auf **Importieren**, um alle Entitäten zu speichern

![Data import interface](/img/data_import.png)

## Konfiguration

Import pro Sammlung aktivieren/deaktivieren:

```typescript
const productsCollection: EntityCollection = {
    slug: "products",
    // Import is enabled by default
    // To disable:
    // importable: false
    properties: { /* ... */ }
};
```

## Nächste Schritte

- **[Datenexport](/docs/features/data-export)** — Exportieren Sie Daten nach CSV/JSON

---
