---
sourceHash: 2e2dfa451a30f422
title: Importazione ed esportazione dati
sidebar_label: Importazione ed esportazione dati
description: Importa dati da file CSV, JSON ed Excel nelle tue collezioni ed esporta i dati delle collezioni in CSV o JSON con campi calcolati opzionali.
---

## Panoramica

Rebase include strumenti integrati di importazione ed esportazione dei dati accessibili direttamente dal pannello di amministrazione. L'importazione supporta file CSV, JSON ed Excel con una procedura guidata di mappatura delle colonne. L'esportazione supporta CSV e JSON con campi calcolati opzionali.

Entrambe le funzionalità sono disponibili per ogni collezione. L'esportazione può essere configurata per singola collezione con campi calcolati; nessuna delle due può essere disattivata per collezione.

## Importazione dei dati

### Come importare

1. Apri una collezione nel pannello di amministrazione
2. Fai clic sul pulsante **Import** nella barra degli strumenti
3. Seleziona o trascina il tuo file
4. Mappa le colonne del file con le proprietà della collezione
5. Visualizza l'anteprima dei dati e risolvi eventuali errori di convalida
6. Fai clic su **Import** per salvare tutte le entità

### Formati supportati

| Formato | Estensioni | Note |
|---------|------------|------|
| CSV | `.csv` | Rileva automaticamente i delimitatori |
| JSON | `.json` | Richiede un array di oggetti |
| Excel | `.xlsx` | Legge il primo foglio |

### Mappatura delle colonne

La procedura guidata di importazione tenta automaticamente di associare le colonne del file alle proprietà della collezione in base al nome. È possibile modificare manualmente le mappature prima dell'importazione:

- Le **corrispondenze esatte** vengono mappate automaticamente (ad es. `name` → `name`)
- Le **colonne non associate** possono essere mappate manualmente o ignorate
- La **coercizione dei tipi** gestisce la conversione da stringa a numero, da stringa a booleano e il parsing delle date

### Convalida

Prima dell'importazione, la procedura guidata convalida tutte le righe rispetto alle definizioni delle proprietà della collezione:

- I campi obbligatori devono essere presenti
- I valori enum devono corrispondere alle opzioni definite
- I tipi di dati devono essere compatibili (ad es. un valore di testo per un campo numerico viene segnalato)
- Gli errori di convalida vengono mostrati riga per riga per consentire di correggerli prima dell'importazione

### Configurazione dell'importazione

L'importazione è disponibile per ogni collezione. Non esiste un'impostazione per singola collezione
che consenta di disattivarla.

## Esportazione dei dati

### Come esportare

1. Apri una collezione nel pannello di amministrazione
2. Facoltativamente, applica dei filtri per esportare un sottoinsieme di dati
3. Fai clic sul pulsante **Export** nella barra degli strumenti
4. Scegli il formato: **CSV** o **JSON**
5. Il file viene scaricato immediatamente

### Formati di esportazione

| Formato | Descrizione |
|---------|-------------|
| CSV | Valori separati da virgola, compatibili con Excel e Google Sheets |
| JSON | Array di oggetti, utile per l'elaborazione a livello di codice |

### Filtraggio prima dell'esportazione

Tutti i filtri attivi nella visualizzazione della collezione vengono applicati all'esportazione. Questo ti consente di esportare solo un sottoinsieme dei tuoi dati:

- Applica filtri di colonna o termini di ricerca nella visualizzazione della collezione
- Fai clic su **Export** — verranno incluse solo le righe filtrate

### Configurazione dell'esportazione

L'esportazione è disponibile per ogni collezione. Si configura tramite `admin.exportable`: assegna
un oggetto `ExportConfig` per aggiungere colonne calcolate, come illustrato di seguito. Il tipo accetta anche un valore booleano,
ma non viene letto dal sistema — `exportable: false` non rimuove il pulsante **Export**.

### Aggiunta di campi calcolati

Usa l'oggetto `ExportConfig` per aggiungere colonne calcolate personalizzate alle tue esportazioni. Queste colonne non esistono nel database: vengono calcolate al momento dell'esportazione:

```typescript
import { defineCollection } from "@rebasepro/cms-types";

const productsCollection = defineCollection({
    slug: "products",
    table: "products",
    name: "Products",
    properties: { /* ... */ },
    admin: {
        exportable: {
            additionalFields: [
                {
                    key: "computed_margin",
                    builder: ({ entity }) => {
                        const price = entity.values.price as number;
                        const cost = entity.values.cost as number;
                        return String(price - cost);
                    }
                },
                {
                    key: "full_url",
                    builder: ({ entity }) => {
                        return `https://mystore.com/products/${entity.id}`;
                    }
                }
            ]
        }
    }
});

```

Ogni voce di `additionalFields` include:

| Proprietà | Tipo | Descrizione |
|-----------|------|-------------|
| `key` | `string` | Nome della colonna nell'esportazione |
| `builder` | `({ entity, context }) => string \| Promise<string>` | Funzione che calcola il valore |

La funzione `builder` riceve l'entità (`entity`) corrente e il `RebaseContext` (che include l'utente autenticato), consentendo di calcolare i valori in base sia ai dati che ai permessi.

### Campi calcolati asincroni

La funzione `builder` può essere asincrona, opzione utile quando il valore calcolato richiede una ricerca nel database o una chiamata API:

```typescript
exportable: {
    additionalFields: [
        {
            key: "author_name",
            builder: async ({ entity, context }) => {
                const author = await context.data.users.findById(
                    entity.values.authorId as string
                );
                return author?.values.displayName ?? "Unknown";
            }
        }
    ]
}
```

## Passaggi successivi

- **[Collezioni](/docs/collections)** — Definisci il tuo modello di dati
- **[Panoramica frontend](/docs/frontend)** — Pannello di amministrazione e componenti UI
- **[SDK client](/docs/sdk)** — Accesso ai dati a livello programmatico
