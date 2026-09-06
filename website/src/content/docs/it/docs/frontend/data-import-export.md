---
sourceHash: 31f58d9db3601b8c
title: Importazione ed Esportazione dei Dati
sidebar_label: Importazione ed Esportazione dei Dati
description: Importa dati da file CSV, JSON ed Excel nelle tue collezioni, ed esporta i dati delle collezioni in CSV o JSON con campi calcolati opzionali.
---

## Panoramica

Rebase include strumenti integrati di importazione ed esportazione dei dati accessibili direttamente dal pannello di amministrazione. L'importazione supporta file CSV, JSON ed Excel con una procedura guidata di mappatura delle colonne. L'esportazione supporta CSV e JSON con campi calcolati opzionali.

Entrambe le funzionalità sono abilitate per impostazione predefinita su tutte le collezioni e possono essere configurate o disabilitate per collezione.

## Importazione dei Dati

### Come Importare

1. Apri una collezione nel pannello di amministrazione
2. Fai clic sul pulsante **Importa** nella toolbar
3. Seleziona o trascina e rilascia il tuo file
4. Mappa le colonne del file alle proprietà della collezione
5. Anteprima dei dati e risoluzione di eventuali errori di validazione
6. Fai clic su **Importa** per salvare tutte le entità

### Formati Supportati

| Formato | Estensioni | Note |
|--------|-----------|-------|
| CSV | `.csv` | Rileva automaticamente i delimitatori |
| JSON | `.json` | Si aspetta un array di oggetti |
| Excel | `.xlsx` | Legge il primo foglio |

### Mappatura delle Colonne

La procedura guidata di importazione tenta automaticamente di far corrispondere le colonne del file alle proprietà della collezione per nome. Puoi regolare le mappature manualmente prima di importare:

- Le **corrispondenze esatte** vengono mappate automaticamente (ad es. `name` → `name`)
- Le **colonne non corrispondenti** possono essere mappate manualmente o saltate
- La **coercizione dei tipi** gestisce la conversione stringa-a-numero, stringa-a-booleano e il parsing delle date

### Validazione

Prima di importare, la procedura guidata valida tutte le righe rispetto alle definizioni delle proprietà della tua collezione:

- I campi obbligatori devono essere presenti
- I valori enum devono corrispondere alle opzioni definite
- I tipi di dati devono essere compatibili (ad es. un valore di testo per un campo numerico viene segnalato)
- Gli errori di validazione vengono mostrati per riga così puoi correggerli prima di importare

### Configurazione dell'Importazione

L'importazione è abilitata per impostazione predefinita. Per disabilitarla su una collezione specifica, usa il sotto-oggetto `admin`:

```typescript
import { defineCollection } from "@rebasepro/cms-types";

const productsCollection = defineCollection({
    slug: "products",
    table: "products",
    name: "Products",
    properties: { /* ... */ },
    // Import is enabled by default
});
```

## Esportazione dei Dati

### Come Esportare

1. Apri una collezione nel pannello di amministrazione
2. Applica facoltativamente dei filtri per esportare un sottoinsieme di dati
3. Fai clic sul pulsante **Esporta** nella toolbar
4. Scegli il formato: **CSV** o **JSON**
5. Il file viene scaricato immediatamente

### Formati di Esportazione

| Formato | Descrizione |
|--------|-------------|
| CSV | Valori separati da virgola, compatibile con Excel e Google Sheets |
| JSON | Array di oggetti, utile per il consumo programmatico |

### Filtraggio Prima dell'Esportazione

Qualsiasi filtro attivo nella vista della collezione viene applicato all'esportazione. Questo ti consente di esportare solo un sottoinsieme dei tuoi dati:

- Applica filtri di colonna o termini di ricerca nella vista della collezione
- Fai clic su **Esporta** — vengono incluse solo le righe filtrate

### Configurazione dell'Esportazione

L'esportazione è abilitata per impostazione predefinita. Puoi configurarla con campi calcolati aggiuntivi:

```typescript
import { defineCollection } from "@rebasepro/cms-types";

const productsCollection = defineCollection({
    slug: "products",
    table: "products",
    name: "Products",
    properties: { /* ... */ },
    admin: {
        exportable: true            // Enable (default: true)
    }
});

```

Per disabilitare l'esportazione:

```typescript
import { defineCollection } from "@rebasepro/cms-types";
const productsCollection = defineCollection({
    slug: "products",
    table: "products",
    name: "Products",
    properties: { /* ... */ },
    admin: {
        exportable: false
    }
});

```

### Aggiungere Campi Calcolati

Usa l'oggetto `ExportConfig` per aggiungere colonne calcolate personalizzate alle tue esportazioni. Queste colonne non esistono nel database — vengono calcolate al momento dell'esportazione:

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

Ogni voce di `additionalFields` ha:

| Proprietà | Tipo | Descrizione |
|----------|------|-------------|
| `key` | `string` | Nome della colonna nell'esportazione |
| `builder` | `({ entity, context }) => string \| Promise<string>` | Funzione che calcola il valore |

La funzione `builder` riceve l'`entity` corrente e il `RebaseContext` (che include l'utente autenticato), così puoi calcolare i valori basandoti sia sui dati sia sui permessi.

### Campi Calcolati Asincroni

La funzione `builder` può essere asincrona, il che è utile quando il valore calcolato richiede una ricerca nel database o una chiamata API:

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

## Prossimi Passi

- **[Collezioni](/docs/collections)** — Definisci il tuo modello di dati
- **[Panoramica del Frontend](/docs/frontend)** — Pannello di amministrazione e componenti UI
- **[SDK Client](/docs/sdk)** — Accesso programmatico ai dati
