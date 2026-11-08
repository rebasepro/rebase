---
sourceHash: 8df0ef82748b614e
title: Importazione ed esportazione dati
sidebar_label: Importazione ed esportazione dati
description: Importa dati da file CSV, JSON ed Excel nelle tue collezioni ed esporta i dati delle collezioni in CSV o JSON con campi calcolati opzionali.
---

## Panoramica

Rebase include strumenti integrati di importazione ed esportazione dei dati accessibili direttamente dal pannello di amministrazione. L'importazione supporta file CSV, JSON ed Excel con una procedura guidata di mappatura delle colonne. L'esportazione supporta CSV e JSON con campi calcolati opzionali.

Entrambe le funzionalità sono disponibili per ogni collezione. L'esportazione può essere configurata per ciascuna collezione con campi calcolati oppure disattivata tramite `exportable: false`; l'importazione non può essere disattivata per singola collezione.

## Importazione dei dati

### Come importare

1. Apri una collezione nel pannello di amministrazione
2. Fai clic sul pulsante **Import** nella barra degli strumenti
3. Seleziona o trascina il file
4. Mappa le colonne del file con le proprietà della collezione
5. Visualizza l'anteprima dei dati, inclusi gli eventuali valori che non possono essere convertiti
6. Fai clic su **Save data** per scrivere le righe

### Formati supportati

| Formato | Estensioni | Note |
|---------|------------|------|
| CSV | `.csv` | Rilevamento automatico dei delimitatori |
| JSON | `.json` | Richiede un array di oggetti |
| Excel | `.xlsx` | Legge il primo foglio |

### Mappatura delle colonne

La procedura guidata di importazione tenta automaticamente di associare le colonne del file alle proprietà della collezione in base al nome. È possibile regolare manualmente le mappature prima di importare:

- Le **corrispondenze esatte** vengono mappate automaticamente (ad es. `name` → `name`)
- Le **colonne non abbinate** possono essere mappate manualmente o ignorate
- La **conversione del tipo** trasforma ciascuna cella nel tipo della proprietà a cui è mappata, ma solo quando non vi è perdita di informazioni (vedi sotto)

### Conversione dei tipi

Una cella viene convertita solo quando il tipo della proprietà può contenere esattamente il valore indicato:

| Tipo di proprietà | Converte | Non converte |
|---|---|---|
| Number | `12`, `-3.5`, `10.00`, `1e3` | `02134` (lo zero iniziale andrebbe perso), numeri con più di 15 cifre significative, `1,234`, `$5.00`, `12%`, `N/A` |
| Boolean | `true`/`false`, `yes`/`no`, `y`/`n`, `1`/`0`, indipendentemente dal maiuscolo/minuscolo | qualsiasi altra cosa |
| Date | ISO 8601 (`2024-01-05`, `2024-01-05T10:00:00Z`), date in formato esteso (`5 Jan 2024`), `05/01/2024`, secondi o millisecondi epoch | testo che non specifica una data |
| Geopoint | l'oggetto generato dall'esportazione, `{"latitude": 41.9, "longitude": 12.5}`, o il relativo JSON in una cella CSV | qualsiasi altra cosa, o una coordinata non valida |
| Map senza campi dichiarati | un oggetto, o il relativo JSON in una cella CSV | qualsiasi altra cosa |
| Vector | un elenco di numeri (`[0.1, 0.2]`, `0.1, 0.2`), o il formato dell'esportazione `{"value": [0.1, 0.2]}` | un elenco contenente elementi non numerici |

Una data senza orario corrisponde a quel giorno in UTC. Per le date scritte come `05/01/2024`, è la colonna a determinare l'ordine: se il primo numero è maggiore di 12, la colonna antepone il giorno; se il secondo numero è maggiore di 12, antepone il mese. Quando la colonna non fornisce indicazioni univoche, fa fede la lingua (locale) del browser; se la colonna presenta entrambi gli ordini, una data compatibile con entrambi non viene convertita.

Una cella vuota non rappresenta alcun valore: non imposta nulla e viene applicato il valore predefinito specificato per quella proprietà.

Un file esportato da una collezione viene reimportato con gli stessi valori, sia in CSV che in JSON. Una mappa con campi dichiarati viene letta dedicando una colonna a ciascun campo (`address.street`), così come viene scritta dall'esportazione; qualsiasi altro valore, compresi un geopoint o una mappa chiave-valore, occupa una sola colonna. Un numero epoch compreso tra -100.000.000.000 e 100.000.000.000 viene interpretato come secondi; di conseguenza, una data compresa tra il 31 ottobre 1966 e il 3 marzo 1973 esportata come timestamp non viene ripristinata: esporta queste date come testo. Un campo relativo all'ora del giorno interpreta un valore numerico inferiore a un giorno (86.400.000) come i millisecondi a partire dalla mezzanotte generati dall'esportazione.

### Valori che non possono essere importati

L'anteprima elenca per ciascuna colonna tutte le celle che non possono essere convertite, indicando il totale e mostrando i primi casi con riga e motivazione. Tali celle vengono lasciate vuote nelle righe importate; nulla viene trasformato in `0`, `false` o in un valore vuoto senza essere esplicitamente segnalato. Torna indietro per mappare la colonna a un'altra proprietà, oppure correggi il file e caricalo nuovamente.

Le regole proprie della collezione — campi obbligatori, opzioni enum, valori univoci — vengono verificate dal server durante la scrittura delle righe, in batch fino a 500 righe (in numero inferiore se le righe sono ampie, in modo che la richiesta rimanga sotto circa 1 MB). Un batch viene salvato per intero o per niente. Se una riga viene rifiutata, l'importazione si interrompe indicando la riga problematica; i batch precedenti sono già salvati e l'opzione **Retry** riprende dalla prima riga del batch rifiutato.

Una riga il cui id è già presente nella collezione aggiorna il record esistente: vengono scritte le colonne presenti nel file, mentre le altre mantengono i valori memorizzati; pertanto, un file con `id,price` aggiorna i prezzi dei prodotti esistenti senza dover ripetere i campi obbligatori. Una nuova riga richiede comunque tutti i campi obbligatori. Un batch che include sia aggiornamenti che nuove righe viene inviato come due richieste distinte: in questo modo, un'eventuale riga nuova rifiutata non annulla gli aggiornamenti salvati di quel batch; **Retry** li riscrive con gli stessi valori.

### Importazione degli utenti

Una nuova riga nella collezione degli utenti corrisponde alla creazione di un utente: la colonna `password` viene sottoposta ad hashing e mai salvata in chiaro; una riga priva di password riceve una password generata o un invito, esattamente come quando un amministratore aggiunge un utente. Poiché le password contenute in questi file sono solitamente conformi alle regole di un altro sistema, l'importazione richiede al server di ignorare la [password policy](/docs/backend/auth-endpoints/#password-policy) per queste righe. Il server acconsente solo se l'utente che effettua l'operazione è un amministratore; per chiunque altro importi utenti si applicano le regole della policy, e una password debole blocca l'importazione con l'errore `WEAK_PASSWORD`.

### Creazione di una collezione da un file

Quando crei una collezione a partire da un file, il tipo di ciascuna colonna viene dedotto dai relativi valori. Una colonna viene considerata numerica solo se tutti i valori al suo interno sono numeri o testi convertibili esattamente in numeri; di conseguenza, colonne contenenti codici di avviamento postale, codici prodotto con zeri iniziali, SKU lunghi o numeri di telefono rimangono di tipo testo. Una colonna con tipi misti (numeri e parole, booleani e numeri) diventa di tipo testo. Le celle vuote non vengono conteggiate, pertanto una colonna per lo più vuota non viene contrassegnata come obbligatoria. Una colonna di numeri interi il cui nome termina con un termine che indica una data/ora (`created_at`, `updatedAt`, `signup_date`, `timestamp`) diventa di tipo data se tutti i valori sono timestamp epoch compresi tra il 2001 e il 2103, in secondi o millisecondi; con qualsiasi altro nome o con valori differenti, rimane di tipo numerico.

### Configurazione dell'importazione

L'importazione è disponibile per ogni collezione. Non esiste un'impostazione per disattivarla a livello di singola collezione.

## Esportazione dei dati

### Come esportare

1. Apri una collezione nel pannello di amministrazione
2. Facoltativamente, applica dei filtri per esportare un sottoinsieme di dati
3. Fai clic sul pulsante **Export** nella barra degli strumenti
4. Scegli il formato: **CSV** o **JSON**
5. Il download del file viene avviato immediatamente

### Formati di esportazione

| Formato | Descrizione |
|---------|-------------|
| CSV | Valori separati da virgola, compatibili con Excel e Google Fogli |
| JSON | Array di oggetti, ideale per l'elaborazione a livello di codice |

### Filtrare prima dell'esportazione

Tutti i filtri attivi nella vista della collezione vengono applicati anche all'esportazione. Questo ti consente di esportare solo un sottoinsieme dei tuoi dati:

- Applica i filtri per colonna o i termini di ricerca nella vista della collezione
- Fai clic su **Export** — verranno incluse solo le righe filtrate

### Configurazione dell'esportazione

L'esportazione è disponibile su ogni collezione a meno che non venga disattivata. Viene configurata tramite `admin.exportable`: `exportable: false` rimuove il pulsante **Export**, mentre un oggetto `ExportConfig` lo mantiene e permette di aggiungere colonne calcolate, come illustrato di seguito.

### Aggiunta di campi calcolati

Utilizza l'oggetto `ExportConfig` per aggiungere colonne calcolate personalizzate alle tue esportazioni. Queste colonne non esistono nel database, ma vengono calcolate al momento dell'esportazione:

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
                    builder: ({ row }) => {
                        const price = Number(row.price ?? 0);
                        const cost = Number(row.cost ?? 0);
                        return String(price - cost);
                    }
                },
                {
                    key: "full_url",
                    builder: ({ id }) => {
                        return `https://mystore.com/products/${id}`;
                    }
                }
            ]
        }
    }
});

```

Ciascuna voce di `additionalFields` prevede:

| Proprietà | Tipo | Descrizione |
|-----------|------|-------------|
| `key` | `string` | Nome della colonna nell'esportazione |
| `builder` | `({ row, id, context }) => string \| Promise<string>` | Funzione che calcola il valore |

La funzione `builder` riceve ciascun record esportato come `row`, con la struttura inviata dal server (date come stringhe ISO, le relazioni belongsTo rappresentate dalla colonna della foreign key, `id` presente solo se la tabella include tale colonna), l'`id` del record a parte (la chiave primaria sotto forma di stringa, con le parti di una chiave composta unite da `:::`) e il `RebaseContext` (che include l'utente autenticato), consentendoti di calcolare i valori in base sia ai dati che ai permessi.

### Campi calcolati asincroni

La funzione `builder` può essere asincrona, caratteristica utile quando il valore calcolato richiede una query al database o una chiamata API:

```typescript
exportable: {
    additionalFields: [
        {
            key: "author_name",
            builder: async ({ row, context }) => {
                const author = await context.data.users.findById(String(row.authorId));
                // `context.data` returns the row itself: its columns are on it.
                return String(author?.displayName ?? "Unknown");
            }
        }
    ]
}
```

## Passaggi successivi

- **[Collezioni](/docs/collections)** — Definisci il tuo modello dati
- **[Panoramica frontend](/docs/frontend)** — Pannello di amministrazione e componenti UI
- **[Typed SDK](/docs/sdk)** — Accesso programmatico ai dati
