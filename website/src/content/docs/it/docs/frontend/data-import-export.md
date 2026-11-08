---
sourceHash: 3c4991a6d78c115c
title: Importazione ed esportazione dei dati
sidebar_label: Importazione ed esportazione dei dati
description: Importa dati da file CSV, JSON ed Excel nelle tue collection ed esporta i dati delle collection in CSV o JSON con campi calcolati opzionali.
---

## Panoramica

Rebase include strumenti integrati di importazione ed esportazione dei dati accessibili direttamente dal pannello di amministrazione. L'importazione supporta file CSV, JSON ed Excel con una procedura guidata di mappatura delle colonne. L'esportazione supporta CSV e JSON con campi calcolati opzionali.

Entrambe le funzionalità sono disponibili per ogni collection. L'esportazione può essere configurata per singola collection con campi calcolati, oppure disattivata con `exportable: false`; l'importazione non può essere disattivata per collection.

## Importazione dei dati

### Come importare

1. Apri una collection nel pannello di amministrazione
2. Fai clic sul pulsante **Import** nella barra degli strumenti
3. Seleziona o trascina il tuo file (drag-and-drop)
4. Mappa le colonne del file sulle proprietà della collection
5. Visualizza l'anteprima dei dati, inclusi i valori che non possono essere convertiti
6. Fai clic su **Save data** per scrivere le righe

### Formati supportati

| Formato | Estensioni | Note |
|---------|------------|------|
| CSV | `.csv` | Rilevamento automatico dei delimitatori |
| JSON | `.json` | Richiede un array di oggetti |
| Excel | `.xlsx` | Legge il primo foglio |

### Mappatura delle colonne

La procedura guidata di importazione tenta automaticamente di associare le colonne del file alle proprietà della collection in base al nome. È possibile modificare manualmente le mappature prima di importare:

- Le **corrispondenze esatte** vengono mappate automaticamente (es. `name` → `name`)
- Le **colonne non associate** possono essere mappate manualmente o ignorate
- La **conversione del tipo** trasforma ciascuna cella nel tipo della proprietà a cui è mappata, ma solo quando non viene perso nulla (vedi sotto)

### Conversione dei tipi

Una cella viene convertita solo se il tipo della proprietà può contenere esattamente ciò che è espresso nel valore:

| Tipo di proprietà | Converte | Non converte |
|---|---|---|
| Number | `12`, `-3.5`, `10.00`, `1e3` | `02134` (uno zero iniziale andrebbe perso), numeri con più di 15 cifre significative, `1,234`, `$5.00`, `12%`, `N/A` |
| Boolean | `true`/`false`, `yes`/`no`, `y`/`n`, `1`/`0`, senza distinzione tra maiuscole e minuscole | qualsiasi altra cosa |
| Date | ISO 8601 (`2024-01-05`, `2024-01-05T10:00:00Z`), date in formato testuale (`5 Jan 2024`), `05/01/2024`, secondi o millisecondi epoch | testo che non specifica alcuna data |
| Geopoint | l'oggetto generato dall'esportazione, `{"latitude": 41.9, "longitude": 12.5}`, o il relativo JSON in una cella CSV | qualsiasi altra cosa, o una coordinata fuori intervallo |
| Map senza campi dichiarati | un oggetto, o il relativo JSON in una cella CSV | qualsiasi altra cosa |
| Vector | un elenco di numeri (`[0.1, 0.2]`, `0.1, 0.2`), o il valore esportato `{"value": [0.1, 0.2]}` | un elenco contenente qualsiasi elemento che non sia un numero |

Una data priva di orario corrisponde a quel giorno in formato UTC. Per le date scritte come `05/01/2024`, l'ordine viene stabilito dalla colonna: un primo numero superiore a 12 imposta la colonna con il giorno all'inizio, un secondo numero superiore a 12 imposta il mese all'inizio. Se una colonna non lo specifica mai, prevale l'impostazione locale del browser; se contiene entrambi gli ordini, una data che potrebbe essere interpretata in entrambi i modi non viene convertita.

Una cella vuota non rappresenta alcun valore: non imposta nulla e viene applicato il valore predefinito definito per quella proprietà.

Un file esportato da una collection viene reimportato con gli stessi valori, sia in formato CSV che JSON. Una map con campi dichiarati viene letta dedicando una colonna per campo (`address.street`), così come viene scritta dall'esportazione; qualsiasi altro valore, inclusi geopoint o mappe chiave-valore, occupa una singola colonna. Un numero epoch compreso tra -100.000.000.000 e 100.000.000.000 viene interpretato come secondi, pertanto una data compresa tra il 31 ottobre 1966 e il 3 marzo 1973 esportata come timestamp non viene ripristinata correttamente: esporta queste date come testo. Un campo orario (time-of-day) legge un numero inferiore a un giorno (86.400.000) come i millisecondi trascorsi dalla mezzanotte generati dall'esportazione.

### Valori che non possono essere importati

L'anteprima elenca ogni cella non convertibile, colonna per colonna, indicando il conteggio totale e le prime righe con il relativo motivo. Tali celle vengono lasciate vuote nelle righe importate; nulla viene trasformato in `0`, `false` o in un valore vuoto senza essere esplicitamente segnalato. Torna indietro per mappare la colonna su un'altra proprietà, oppure correggi il file e caricalo nuovamente.

Le regole della collection stessa — campi obbligatori, opzioni enum, valori univoci — vengono verificate dal server durante la scrittura delle righe, in batch composti da un massimo di 500 righe (in numero inferiore se le righe sono ampie, affinché la richiesta rimanga al di sotto di circa 1 MB). Ciascun batch viene salvato per intero oppure non viene salvato affatto. Se una riga viene rifiutata, l'importazione si arresta e ne indica il riferimento; i batch precedenti risultano già salvati e **Retry** riprende dalla prima riga del batch rifiutato.

Una riga il cui id è già presente nella collection comporta l'aggiornamento del record corrispondente: le colonne contenute nel file vengono scritte, mentre le altre mantengono i valori già memorizzati; in questo modo un file con `id,price` consente di aggiornare i prezzi dei prodotti esistenti senza dover specificare nuovamente i campi obbligatori. Una nuova riga richiede comunque tutti i campi obbligatori. Un batch che combina aggiornamenti e nuove righe viene inviato tramite due richieste separate, così che una nuova riga rifiutata possa lasciare salvati gli aggiornamenti di quel batch; **Retry** li riscrive con i medesimi valori.

### Importazione degli utenti

Una nuova riga nella collection degli utenti corrisponde alla creazione di un utente: la colonna `password` viene cifrata tramite hash e mai salvata in chiaro; una riga priva di password riceve una password generata o un invito, esattamente come quando un amministratore aggiunge un utente. Poiché le password contenute in file di questo tipo sono state solitamente impostate secondo le regole di un altro sistema, l'importazione richiede al server di ignorare la [password policy](/docs/backend/auth-endpoints/#password-policy) per queste righe. Il server acconsente solo se l'operazione viene eseguita da un amministratore; qualsiasi altro utente che importa dati è vincolato alla policy, e una password debole interrompe l'importazione con l'errore `WEAK_PASSWORD`.

### Creazione di una collection da un file

Quando crei una collection a partire da un file, il tipo di ciascuna colonna viene dedotto dai suoi valori. Una colonna viene considerata numerica solo se ogni valore al suo interno è un numero o un testo che può essere convertito esattamente in esso; di conseguenza, una colonna contenente CAP, codici prodotto con zeri iniziali, SKU lunghi o numeri di telefono rimane di tipo testo. Una colonna con tipi misti (numeri e parole, booleani e numeri) diventa di tipo testo. Le celle vuote non vengono conteggiate, quindi una colonna prevalentemente vuota non viene contrassegnata come obbligatoria. Una colonna di numeri interi il cui nome termina con un termine indicante un timestamp temporale (`created_at`, `updatedAt`, `signup_date`, `timestamp`) viene considerata una data se ogni valore è un timestamp epoch compreso tra il 2001 e il 2103, in secondi o millisecondi; con qualsiasi altro nome o valore diverso, rimane un numero.

### Configurazione dell'importazione

L'importazione è disponibile in ogni collection. Non esiste alcuna impostazione a livello di singola collection per disattivarla.

## Esportazione dei dati

### Come esportare

1. Apri una collection nel pannello di amministrazione
2. Facoltativamente, applica dei filtri per esportare un sottoinsieme di dati
3. Fai clic sul pulsante **Export** nella barra degli strumenti
4. Scegli il formato: **CSV** o **JSON**
5. Il file verrà scaricato immediatamente

### Formati di esportazione

| Formato | Descrizione |
|---------|-------------|
| CSV | Valori separati da virgola, compatibili con Excel e Google Sheets |
| JSON | Array di oggetti, utile per l'elaborazione a livello di codice |

### Filtrare prima dell'esportazione

Tutti i filtri attivi nella visualizzazione della collection vengono applicati all'esportazione. In questo modo puoi esportare solo un sottoinsieme dei tuoi dati:

- Applica filtri sulle colonne o termini di ricerca nella vista della collection
- Fai clic su **Export** — verranno incluse solo le righe filtrate

### Configurazione dell'esportazione

L'esportazione è disponibile su ogni collection a meno che non venga disattivata. Viene gestita tramite `admin.exportable`: `exportable: false` rimuove il pulsante **Export**, mentre un oggetto `ExportConfig` lo mantiene e consente di aggiungere colonne calcolate, come spiegato di seguito.

### Aggiunta di campi calcolati

Utilizza l'oggetto `ExportConfig` per aggiungere colonne calcolate personalizzate alle tue esportazioni. Queste colonne non esistono nel database, ma vengono generate al momento dell'esportazione:

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
                    builder: ({ row }) => {
                        return `https://mystore.com/products/${String(row.id)}`;
                    }
                }
            ]
        }
    }
});

```

Ogni elemento in `additionalFields` prevede:

| Proprietà | Tipo | Descrizione |
|-----------|------|-------------|
| `key` | `string` | Nome della colonna nell'esportazione |
| `builder` | `({ row, context }) => string \| Promise<string>` | Funzione che calcola il valore |

La funzione `builder` riceve ogni record esportato come `row`, nella struttura restituita dal server (date sotto forma di stringhe ISO, un belongsTo come colonna di chiave esterna, `id` compreso), e il `RebaseContext` (che include l'utente autenticato), consentendoti di calcolare i valori in base sia ai dati che ai permessi.

### Campi calcolati asincroni

La funzione `builder` può essere asincrona, il che risulta utile quando il valore calcolato necessita di una query al database o di una chiamata API:

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

- **[Collections](/docs/collections)** — Definisci il tuo modello dati
- **[Panoramica del frontend](/docs/frontend)** — Pannello di amministrazione e componenti UI
- **[Typed SDK](/docs/sdk)** — Accesso ai dati a livello programmatico
