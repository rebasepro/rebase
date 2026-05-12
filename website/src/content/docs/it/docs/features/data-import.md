---
title: Importazione Dati
sidebar_label: Importazione Dati
slug: docs/features/data-import
description: Importa dati da file CSV, JSON ed Excel nelle tue collezioni con mappatura e validazione dei campi.
---

## Panoramica

Rebase supporta l'importazione di dati da:

- file **CSV**
- file **JSON**
- file **Excel** (`.xlsx`)

La procedura guidata di importazione gestisce la mappatura delle colonne, la coercizione dei tipi di dati e la validazione.

## Come Importare

1. Apri una collezione nel pannello di amministrazione
2. Clicca sul pulsante **Importa** nella barra degli strumenti
3. Seleziona o trascina il tuo file
4. Mappa le colonne del file alle proprietà della collezione
5. Visualizza un'anteprima dei dati e risolvi eventuali errori di validazione
6. Clicca su **Importa** per salvare tutte le entità

![Interfaccia di importazione dati](/img/data_import.png)

## Configurazione

Abilita/disabilita l'importazione per collezione:

```typescript
const productsCollection: EntityCollection = {
    slug: "products",
    // Import is enabled by default
    // To disable:
    // importable: false
    properties: { /* ... */ }
};
```

## Prossimi Passi

- **[Esportazione Dati](/docs/features/data-export)** — Esporta dati in CSV/JSON

---
