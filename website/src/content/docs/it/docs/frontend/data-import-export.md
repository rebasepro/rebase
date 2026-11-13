---
sourceHash: 66fc9b42bef4d463
title: Importazione ed esportazione dati
sidebar_label: Importazione ed esportazione dati
description: Importa dati da file CSV, JSON ed Excel nelle tue collezioni ed esporta i dati delle collezioni in formato CSV o JSON con campi calcolati opzionali.
---

## Panoramica

Rebase include strumenti integrati di importazione ed esportazione dei dati, accessibili direttamente dal pannello di amministrazione. L'importazione supporta file CSV, JSON ed Excel tramite una procedura guidata di mappatura delle colonne. L'esportazione supporta i formati CSV e JSON con campi calcolati opzionali.

Entrambe le funzionalità sono disponibili per ogni collezione. L'esportazione può essere configurata per ciascuna collezione mediante campi calcolati, oppure disattivata impostando `exportable: false`; l'importazione non può essere disattivata a livello di collezione.

## Importazione dei dati

### Come importare

1. Apri una collezione nel pannello di amministrazione
2. Fai clic sul pulsante **Import** nella barra degli strumenti
3. Seleziona o trascina il tuo file
4. Mappa le colonne del file sulle proprietà della collezione
5. Visualizza l'anteprima dei dati, inclusi gli eventuali valori che non possono essere convertiti
6. Fai clic su **Save data** per scrivere le righe

### Formati supportati

| Formato | Estensioni | Note |
|---------|------------|------|
| CSV | `.csv` | Rilevamento automatico dei delimitatori |
| JSON | `.json` | Richiede un array di oggetti |
| Excel | `.xlsx` | Legge il primo foglio |

### Mappatura delle colonne

La procedura guidata di importazione tenta automaticamente di associare le colonne del file alle proprietà della collezione in base al nome. Puoi regolare manualmente le mappature prima di avviare l'importazione:

- **Le corrispondenze esatte** vengono mappate automaticamente (ad es. `name` → `name`)
- **Le colonne non corrispondenti** possono essere mappate manualmente o ignorate
- **La conversione dei tipi** trasforma ciascuna cella nel tipo della proprietà a cui è mappata, ma solo se non si verifica alcuna perdita di dati (vedi sotto)

### Conversione dei tipi

Una cella viene convertita solo se il tipo della proprietà può contenere esattamente il valore indicato:

| Tipo di proprietà | Viene convertito | Non viene convertito |
|---|---|---|
| Number | `12`, `-3.5`, `10.00`, `1e3` | `02134` (uno zero iniziale andrebbe perso), numeri con più di 15 cifre significative, `1,234`, `$5.00`, `12%`, `N/A` |
| Boolean | `true`/`false`, `yes`/`no`, `y`/`n`, `1`/`0`, indipendentemente da maiuscole/minuscole | qualsiasi altra cosa |
| Date | ISO 8601 (`2024-01-05`, `2024-01-05T10:00:00Z`), date in formato testuale (`5 Jan 2024`), `05/01/2024`, secondi o millisecondi epoch | testo che non corrisponde a una data |
| Geopoint | l'oggetto generato dall'esportazione, `{"latitude": 41.9, "longitude": 12.5}`, o il relativo JSON in una cella CSV | qualsiasi altra cosa, o una coordinata non valida |
| Map senza campi dichiarati | un oggetto, o il relativo JSON in una cella CSV | qualsiasi altra cosa |
| Vector | una lista di numeri (`[0.1, 0.2]`, `0.1, 0.2`), o il valore `{"value": [0.1, 0.2]}` dell'esportazione | un elenco contenente qualsiasi elemento che non sia un numero |

Una data priva di orario corrisponde a quel giorno in UTC. Per le date scritte nel formato `05/01/2024`, l'ordine viene stabilito dalla colonna: un primo numero superiore a 12 imposta la colonna con il giorno per primo, mentre un secondo numero superiore a 12 imposta il mese per primo. Se la colonna non fornisce indicazioni univoche, la scelta si basa sulle impostazioni internazionali del browser; se contiene entrambi gli ordini, una data interpretabile in entrambi i modi non viene convertita.

Una cella vuota equivale all'assenza di valore: non imposta nulla e viene applicato il valore predefinito specificato per tale proprietà.

Un file esportato da una collezione viene reimportato mantenendo gli stessi valori, sia in formato CSV che JSON. Una mappa con campi dichiarati viene letta allocando una colonna per campo (`address.street`), esattamente come viene scritta dall'esportazione; qualsiasi altro valore, compresi geopoint o mappe chiave-valore, occupa una sola colonna. Un numero epoch compreso tra -100.000.000.000 e 100.000.000.000 viene interpretato in secondi, pertanto una data tra il 31 ottobre 1966 e il 3 marzo 1973 esportata come timestamp non viene ripristinata: esporta tali date come testo. Un campo relativo all'ora del giorno interpreta un numero inferiore a un giorno (86.400.000) come i millisecondi trascorsi dalla mezzanotte generati dall'esportazione.

### Valori che non possono essere importati

L'anteprima elenca tutte le celle non convertibili, suddivise per colonna, indicando il totale e le prime occorrenze con riga e motivazione. Tali celle rimangono vuote nelle righe importate; nessun valore viene trasformato in `0`, `false` o in un valore vuoto senza essere segnalato. Puoi tornare indietro per mappare la colonna su un'altra proprietà oppure correggere il file e caricarlo nuovamente.

Le regole specifiche della collezione (campi obbligatori, opzioni enum, valori univoci) vengono verificate dal server durante la scrittura delle righe, in batch fino a 500 righe (in numero inferiore se le righe sono ampie, affinché ogni richiesta rimanga sotto circa 1 MB). Un batch viene salvato per intero oppure scartato completamente. Se una riga viene rifiutata, l'importazione si interrompe e ne specifica il riferimento; i batch precedenti sono già stati salvati e l'opzione **Retry** consente di riprendere dalla prima riga del batch rifiutato.

Una riga il cui id è già presente nella collezione aggiorna il record corrispondente: vengono scritte le colonne presenti nel file, mentre le altre mantengono i valori archiviati; in questo modo, un file composto da `id,price` aggiorna il prezzo dei prodotti esistenti senza dover ripetere i relativi campi obbligatori. Una nuova riga richiede comunque tutti i campi obbligatori. Un batch contenente sia aggiornamenti che nuove righe viene inviato tramite due richieste separate, pertanto una nuova riga rifiutata può lasciare comunque salvati gli aggiornamenti di quel batch; l'opzione **Retry** li riscriverà con gli stessi valori.

### Importazione degli utenti

Una nuova riga nella tabella degli utenti equivale alla creazione di un utente: una colonna `password` viene sottoposta ad hashing, mai salvata in chiaro, mentre una riga priva di password riceve una password generata automaticamente o un invito, analogamente a quando un amministratore aggiunge un utente. Poiché le password presenti in tale file sono solitamente conformi alle regole di un altro sistema, l'importazione richiede al server di ignorare la [password policy](/docs/backend/auth-endpoints/#password-policy) per queste righe. Il server autorizza l'operazione solo se l'utente corrente è un amministratore; per chiunque altro importi utenti si applicano le regole standard dei criteri di sicurezza e una password debole interrompe l'importazione con l'errore `WEAK_PASSWORD`.

### Creazione di una collezione da un file

Quando crei una collezione a partire da un file, il tipo di ciascuna colonna viene dedotto dai relativi valori. Una colonna viene considerata di tipo numerico solo se ogni suo valore è un numero o un testo esattamente convertibile in un numero; pertanto, una colonna contenente CAP, codici prodotto con zeri iniziali, SKU lunghi o numeri di telefono rimane di tipo testo. Una colonna con tipi misti (numeri e parole, booleani e numeri) diventa di tipo testo. Le celle vuote non vengono conteggiate, quindi una colonna prevalentemente vuota non viene contrassegnata come obbligatoria. Una colonna di numeri interi il cui nome termina con un termine che indica un momento temporale (`created_at`, `updatedAt`, `signup_date`, `timestamp`) viene considerata una data se ogni valore è un timestamp epoch compreso tra il 2001 e il 2103, in secondi o millisecondi; con qualsiasi altro nome o valore, rimane di tipo numerico.

### Configurazione dell'importazione

L'importazione è disponibile in ogni collezione. Non esiste un'impostazione a livello di collezione per disattivarla.

## Esportazione dei dati

### Come esportare

1. Apri una collezione nel pannello di amministrazione
2. Facoltativamente, applica dei filtri per esportare un sottoinsieme di dati
3. Fai clic sul pulsante **Export** nella barra degli strumenti
4. Scegli il formato: **CSV** o **JSON**
5. Il download del file si avvia immediatamente

### Formati di esportazione

| Formato | Descrizione |
|---------|-------------|
| CSV | Valori separati da virgola, compatibili con Excel e Google Fogli |
| JSON | Array di oggetti, utile per l'integrazione programmatica |

### Filtraggio prima dell'esportazione

Tutti i filtri attivi nella visualizzazione della collezione vengono applicati all'esportazione. In questo modo puoi esportare solo un sottoinsieme dei tuoi dati:

- Applica filtri di colonna o termini di ricerca nella vista della collezione
- Fai clic su **Export** — verranno incluse unicamente le righe filtrate

### Configurazione dell'esportazione

<span class="since-badge" data-since="0.31">Dalla versione 0.31</span>

L'esportazione è disponibile su ogni collezione, a meno che non venga disattivata. Viene configurata tramite la proprietà `exportable` in `customizeTable`: impostare `exportable: false` rimuove il pulsante **Export**, mentre un oggetto `ExportConfig` lo mantiene e consente di aggiungere colonne calcolate.

### Aggiunta di campi calcolati

<span class="since-badge" data-since="0.31">Dalla versione 0.31</span>

La proprietà `additionalFields` aggiunge colonne non presenti nella tabella; ciascuna di esse viene calcolata al momento dell'esportazione e può essere asincrona:

```tsx
// frontend/src/cms/products.tsx
import { customizeTable } from "@rebasepro/cms";
import type { products } from "../../../backend/schema/products";

export const productsCms = customizeTable<typeof products>("products", {
    exportable: {
        additionalFields: [
            {
                key: "computed_margin",
                builder: ({ row }) => String(Number(row.price ?? 0) - Number(row.cost ?? 0))
            },
            {
                key: "full_url",
                builder: ({ id }) => `https://mystore.com/products/${id}`
            },
            {
                key: "author_name",
                builder: async ({ row, context }) => {
                    const author = await context.data.users.findById(String(row.authorId));
                    // `context.data` returns the row itself: its columns are on it.
                    return String(author?.displayName ?? "Unknown");
                }
            }
        ]
    },
});
```

Ciascuna voce di `additionalFields` presenta:

| Proprietà | Tipo | Descrizione |
|-----------|------|-------------|
| `key` | `string` | Nome della colonna nell'esportazione |
| `builder` | `({ row, id, context }) => string \| Promise<string>` | Funzione che calcola il valore |

La funzione `builder` riceve ciascun record esportato come `row`, nella struttura inviata dal server (date come stringhe ISO, una relazione belongsTo rappresentata dalla colonna della chiave esterna), l'`id` del record associato (la sua chiave primaria come stringa, con le parti di una chiave composita unite da `:::`), e l'oggetto `RebaseContext` (che include l'utente autenticato), consentendo di calcolare i valori in base sia ai dati che ai permessi.

## Passaggi successivi

- **[Tabelle nel CMS](/docs/collections)** — Cosa mostra il pannello per ciascuna tabella
- **[Panoramica frontend](/docs/frontend)** — Pannello di amministrazione e componenti UI
- **[Typed SDK](/docs/sdk)** — Accesso programmatico ai dati
