---
sourceHash: 1baf8e8f2454a5fe
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
5. Visualizza l'anteprima dei dati, inclusi eventuali valori che non possono essere convertiti
6. Fai clic su **Save data** per scrivere le righe

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
- La **conversione dei tipi** trasforma ogni cella nel tipo della proprietà a cui è mappata, ma solo quando non si perde nulla (vedi sotto)

### Conversione dei tipi

Una cella viene convertita solo quando il tipo della proprietà può contenere esattamente ciò che dice:

| Tipo di proprietà | Converte | Non converte |
|---|---|---|
| Numero | `12`, `-3.5`, `10.00`, `1e3` | `02134` (uno zero iniziale andrebbe perso), numeri con più di 15 cifre significative, `1,234`, `$5.00`, `12%`, `N/A` |
| Booleano | `true`/`false`, `yes`/`no`, `y`/`n`, `1`/`0`, in qualsiasi maiuscola/minuscola | qualsiasi altra cosa |
| Data | ISO 8601 (`2024-01-05`, `2024-01-05T10:00:00Z`), date scritte per intero (`5 Jan 2024`), `05/01/2024`, secondi o millisecondi epoch | testo che non indica alcuna data |

Una data senza orario è quel giorno in UTC. Per le date scritte come `05/01/2024`, è la colonna a decidere l'ordine: un primo numero superiore a 12 rende la colonna giorno-prima, un secondo numero superiore a 12 la rende mese-prima. Quando una colonna non lo indica mai, decide la locale del browser, e quando contiene entrambi gli ordini, una data che entrambi gli ordini potrebbero leggere non viene convertita.

Una cella vuota non è un valore: non imposta nulla, e si applica il default scelto per quella proprietà.

### Valori che non possono essere importati

L'anteprima elenca ogni cella che non si converte, per colonna, con il numero di celle e le prime per riga e motivo. Quelle celle vengono lasciate vuote nelle righe importate; nulla viene trasformato in `0`, `false` o un valore vuoto senza essere elencato. Torna indietro per mappare la colonna su un'altra proprietà, oppure correggi il file e caricalo di nuovo.

Le regole della collezione stessa — campi obbligatori, opzioni enum, valori unici — vengono verificate dal server mentre le righe vengono scritte, 25 righe alla volta. Se una riga viene rifiutata, l'importazione si interrompe e la indica; le righe precedenti sono già salvate, e **Retry** riprende dalla riga rifiutata.

### Creare una collezione da un file

Quando crei una collezione da un file, il tipo di ogni colonna viene inferito dai suoi valori. Una colonna è un numero solo se ogni valore al suo interno è un numero o un testo che si converte esattamente in uno, quindi una colonna di codici postali, codici prodotto con zeri iniziali, SKU lunghi o numeri di telefono resta testo. Una colonna che mescola tipi (numeri e parole, booleani e numeri) è testo. Le celle vuote non contano, quindi una colonna per lo più vuota non viene contrassegnata come obbligatoria.

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
- **[SDK tipizzato](/docs/sdk)** — Accesso ai dati a livello programmatico
