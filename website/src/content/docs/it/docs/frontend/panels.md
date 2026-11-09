---
sourceHash: e40c0f481cca1bc9
title: Pannelli in una tua pagina
sidebar_label: Pannelli nelle tue pagine
description: "Mostra una collezione, il form di un record, un record o un singolo valore in una tua pagina: CollectionPanel, RecordForm, RecordDetail, FieldValue e CollectionsProvider, senza la shell di amministrazione circostante."
---

Nella versione 0.24
`CollectionPanel` accetta solo un `path` registrato e restituisce "Collection not
found" al di fuori dell'albero di amministrazione completo, mentre `EntityFormPanel` e
`CollectionsProvider` non esistono.

Non serve l'intera interfaccia di amministrazione per mostrare una tabella. `<CollectionPanel>` accetta
la collezione come valore e funziona ovunque sotto `<Rebase>` e un router React
Router, senza `<RebaseCMS>`, `<RebaseNavigation>` o `<RebaseShell>`:

```tsx
import { Rebase, useRebaseAuthController } from "@rebasepro/app";
import { CollectionPanel } from "@rebasepro/cms";
import { postsCollection } from "../config/collections/posts";
// Plus BrowserRouter, or any other router, from "react-router".

export function App() {
    const authController = useRebaseAuthController({ client });

    return (
        <Rebase client={client} authController={authController}>
            <BrowserRouter>
                <MyPageLayout>
                    <CollectionPanel collection={postsCollection}/>
                </MyPageLayout>
            </BrowserRouter>
        </Rebase>
    );
}
```

Un record si apre sopra la tua pagina, in un pannello laterale o in una finestra di dialogo, e mai tramite URL:
nessuna route di amministrazione gestisce la pagina, quindi `full_screen` e `split` si aprono come
pannello laterale, e `useUrlController().routesMounted` è `false` per i tuoi componenti
presenti. Funziona con qualsiasi router: un semplice `<BrowserRouter>`, un
`<MemoryRouter>` o un data router. Un router è comunque richiesto. Un data router
consente inoltre a un record con modifiche non salvate di bloccare la navigazione interna all'app; sotto
gli altri tipi di router, solo la finestra di avviso di uscita dalla pagina del browser fornisce protezione. Esegui il wrapping del pannello in `<RebaseAuthGate>` se la pagina
deve mostrare prima la schermata di accesso di Rebase.

## Cosa mostra un pannello

Un pannello renderizza la collezione esattamente come fa l'amministrazione. Queste prop la restringono a ciò
di cui la tua pagina ha bisogno; nessuna di esse modifica la pagina della collezione stessa.

```tsx
import { CollectionPanel } from "@rebasepro/cms";
import { Button } from "@rebasepro/ui";

<CollectionPanel
    collection="orders"
    viewMode="table"
    fields={["number", "customer", "status", "total"]}
    where={{ status: ["==", "pending"] }}
    orderBy="placed_at:desc"
    toolbar="compact"
    rowActions={(order, id) => (
        <Button size="small" onClick={() => update("orders", id, { status: "shipped" })}>Ship</Button>
    )}
    onRowClick={(order, id) => setSelected(id)}
    className="max-h-[480px]"/>
```

`collection` accetta il nome della collezione, come in questo esempio, o la collezione stessa come
valore (`collection={ordersCollection}`); anche `path` la identifica, e indirizza una
sottocollezione tramite il suo percorso completo.

- `fields` — le proprietà che mostra, in questo ordine, e nient'altro. Nella
  tabella rappresentano le colonne. Nella lista, su una card e su una card kanban
  sono gli elementi con cui vengono popolati gli spazi della riga (titolo, immagine, sottotitolo, stato, data,
  chip di relazione, colonne della lista), a partire dai primi elencati; uno spazio che nessuno
  di essi popola rimane vuoto. Per questo pannello ha la precedenza su `propertiesOrder`,
  sull'ordine delle colonne salvato dall'utente e su `listProperties`. La larghezza delle colonne modificata tramite trascinamento dall'utente
  viene comunque mantenuta; l'ordine è personalizzato, quindi le colonne non sono trascinabili.
- `toolbar` — `"full"`, il valore predefinito; `"compact"`, che comprende la ricerca, il selettore
  della modalità di visualizzazione e Nuovo (dove l'utente ha i permessi di creazione); `"none"` (o `null`)
  per nessuna barra; oppure una barra composta dalle sue parti: `CollectionToolbar` (con `start` ed `end`),
  `CollectionSearchBar`, `CollectionFiltersButton`, `CollectionViewModeToggle`
  e `CollectionAddButton`. Questi componenti leggono il pannello in cui sono renderizzati e generano
  un errore altrove. Gli slot dei plugin e l'override di `Collection.Actions` risiedono nella
  toolbar predefinita.
- `onRowClick` — funzione richiamata con la riga cliccata e il suo id invece di farla
  aprire dal pannello, da una riga, una card, una card kanban e dall'azione di modifica. La riga è
  quella inviata dal server, nello stesso formato accettato da `useRows`, `useRow` e `<FieldValue>`:
  esattamente le sue colonne, stringhe di data ISO (`YYYY-MM-DD` per una colonna
  di sola data) e una relazione belongsTo come foreign key (`customerId`). Una relazione di cui il pannello ha caricato la
  destinazione arriva nidificata sotto il proprio nome, come restituita dall'`include` REST
  (`order.customer` è la riga del cliente); è presente anche la sua foreign key. L'id
  è la stringa con cui l'amministrazione fa riferimento al record — la sua chiave primaria, oppure le parti di una
  chiave composta unite da `:::` — accettata da `highlightedIds` e
  `useSidePanel().open`. `row.id` è la colonna `id` del record, se la tabella
  ne ha una, con il tipo di quella colonna: `5` per una chiave intera, il cui id è
  `"5"`.
- `rowActions` — il tuo JSX personalizzato su ogni riga, card e card kanban, a cui vengono passati
  la riga e il suo id: un "Approva", uno "Spedisci". Nella tabella corrisponde all'ultima colonna,
  sempre visibile; su una riga della lista, una card e una card kanban si posiziona accanto alle
  azioni proprie della collezione. Un clic su di essa non apre il record, e viene
  renderizzata nuovamente con lo stato del tuo componente, in modo che un flag `saving` possa disabilitarla.
- `orderBy` — l'ordine in cui si aprono le righe, `"placed_at:desc"` o
  `["placed_at", "desc"]`. L'utente può comunque ordinare in base a un'altra colonna.
- `highlightedIds` — gli id delle righe renderizzate come selezionate, ad esempio quella che una pagina
  mostra accanto alla lista: `highlightedIds={selected ? [selected] : []}`.
  `[]` non ne evidenzia nessuna. Senza questa prop, il pannello evidenzia l'ultima riga aperta. Gli id
  vengono confrontati come stringhe, quindi il valore `5` di una chiave intera e `"5"` corrispondono alla stessa riga.
- `where` — quali righe include, nel formato accettato da `useRows`:
  `where={{ status: ["==", "pending"] }}`. I filtri impostati dall'utente su altri
  campi si combinano con essa, mentre i campi definiti al suo interno non possono essere modificati o cancellati
  dalla toolbar. Segue la prop, quindi può essere controllata tramite stato da una barra di schede o da una barra di grafico cliccata.
  Ha la precedenza sul `fixedFilter` della collezione, campo per campo.
- `viewMode` — la modalità in cui si apre, con priorità rispetto a quella presente nell'URL e all'ultima
  scelta dall'utente. È comunque possibile cambiare modalità.
- `title={false}` — nessun titolo sopra il pannello, né l'intestazione specifica della vista a lista.
- `updateUrl` — disattivato per impostazione predefinita: il pannello non legge né scrive i
  parametri `__view`, di filtro e di ordinamento della pagina.

Le `entityActions` della collezione vengono renderizzate su ogni riga, card e card kanban, come
pulsanti se dichiarate con `collapsed: false` e nel menu della riga in caso contrario — un pulsante
"Approva" su ogni card rappresenta una singola azione.

Le dimensioni di un pannello si adattano alle sue righe. Senza un'altezza definita dal genitore, o con un semplice
`max-height`, una collezione corta disegna la propria toolbar e le righe, mentre una lunga
scorre all'interno dello spazio a disposizione, fino all'altezza della finestra. Assegna un'altezza per
riempirla. Il layout si adatta alla propria larghezza, non a quella della finestra: in una colonna
stretta usa il suo layout compatto, indipendentemente dallo schermo.

`propertiesOrder` riordina e non nasconde mai: una proprietà esclusa viene renderizzata
dopo quelle indicate. Per nasconderne una ovunque, imposta `admin.hideFromCollection`
su di essa; per mostrarne solo alcune in un punto specifico, passa `fields`.

## Il form di un record

`<RecordForm>` fa lo stesso per il form di un singolo record (prima della 0.29 era chiamato `EntityFormPanel`;
quel nome funziona ancora generando un avviso una sola volta). Carica il record
tramite `id`, lo salva attraverso il data layer di `<Rebase>` come fa il form nativo
dell'amministrazione e richiama `onSaved` dopo ogni salvataggio passando il record salvato esattamente come
il server restituisce la riga, `row`, e il suo `id`. Ometti `id` per creare un
record. `onClose` viene chiamata quando il form richiede di essere chiuso, ad esempio dopo
che il relativo record è stato eliminato:

```tsx
<RecordForm
    collection={postsCollection}
    id={postId}
    onSaved={({ id }) => console.log("saved", id)}
    onClose={() => navigate("/posts")}/>
```

Come `CollectionPanel`, il form e `RecordDetail` accettano una collezione
registrata tramite il suo nome, senza dover fornire un oggetto di configurazione:
`<RecordForm collection="posts" id={postId}/>` (funziona anche `path="posts"`). Sotto `<RebaseCMS>` o un
`CollectionsProvider` che la registra, questo è tutto ciò di cui hanno bisogno. Senza alcuno scope
a monte, passa la collezione come valore, come in questo esempio, e il pannello fornirà il proprio; una collezione
indicata con un percorso non registrato da alcunché segnalerà che il record non è stato trovato.

Se qualcun altro elimina il record mentre il form è aperto, il form mantiene
quanto digitato e segnala che il record è stato eliminato altrove. La sua azione "Salva come nuovo"
lo trasforma in un form che crea un nuovo record con quei valori;
`onSaved` notificherà quindi il nuovo record.

Il form può mostrare
parte di un record, o disporlo secondo le tue esigenze. `fields` mostra solo i campi
indicati, in quell'ordine; le sezioni e la barra laterale (rail) mantengono il loro raggruppamento. I children
sostituiscono i campi generati con il tuo JSX personalizzato, in cui
`<FormField name="…"/>` renderizza un campo con l'etichetta, la dimensione e le regole assegnategli
dal form generato:

```tsx
import { RecordForm, FormField } from "@rebasepro/cms";

<RecordForm collection="orders" id={orderId}>
    <div className="grid grid-cols-2 gap-4">
        <FormField name="customer"/>
        <FormField name="status"/>
    </div>
    <FormField name="notes"/>
</RecordForm>
```

`compact` è il form denso ideale per una scheda laterale o un pannello da 350–700px: nessuna barra laterale (rail)
accanto ai campi (il contenuto confluisce nella colonna), nessun metadato del record,
controlli ad altezza media e spaziatura ridotta:
`<RecordForm collection="orders" id={orderId} fields={["status", "notes"]} compact/>`.

In entrambi i casi il form convalida solo i campi che mostra; il server continua a
verificare l'intero record. Un form che crea un record e omette un
campo obbligatorio senza un valore predefinito lo segnala all'apertura: un errore indica il
campo e il Salvataggio rimane bloccato finché il campo non viene mostrato o non gli viene assegnato un valore predefinito.
`collectionOverrides` modifica la collezione solo per questo form, come avviene per
`CollectionPanel`.

Ciascun form isola i propri ID DOM, consentendo a due form di condividere la stessa pagina. Per trovare un campo
tramite un test, seleziona `[data-form-field="title"]` all'interno dell'attributo
`[data-form-path="posts"]` del form.

`<RecordDetail>` è il corrispondente in sola lettura di `RecordForm`. Carica il
record tramite `id` e lo renderizza come fa la pagina del record dell'amministrazione:
le stesse sezioni ed etichette, con ogni valore visualizzato come anteprima, in modo che un enum appaia come
un chip, una data nel proprio fuso orario e una relazione come titolo della destinazione. Accetta
`fields` e `collectionOverrides` come il form, ed esclude i campi che il
form tralascia: quelli nascosti da una regola `conditions.hidden` per questo record, e
quelli che l'utente autenticato non ha i permessi di leggere.

```tsx
import { RecordDetail } from "@rebasepro/cms";

<RecordDetail
    collection="orders"
    id={orderId}
    fields={["customer", "status", "total"]}/>
```

`<FieldValue>` renderizza un singolo valore nello stesso modo, all'interno del tuo JSX: forniscigli il
valore così come viene inviato dal server. Una relazione belongsTo arriva come la sua foreign key
(`order.customerId`), quindi `field="customer" value={order.customerId}` renderizza il
titolo del record correlato; indicare direttamente la foreign key, `field="customerId"`,
produce lo stesso risultato. Richiede che la collezione sia registrata a monte, tramite `<RebaseCMS>`
o un `CollectionsProvider`. Una collezione o un campo sconosciuti generano un errore
che ne indica il nome.

```tsx
import { useRows } from "@rebasepro/app";
import { FieldValue } from "@rebasepro/cms";

function OrderList() {
    const { rows } = useRows("orders", { limit: 20 });
    return rows.map(order => (
        <div key={String(order.id)} className="flex gap-4">
            <FieldValue collection="orders" field="customer" value={order.customerId}/>
            <FieldValue collection="orders" field="status" value={order.status}/>
            <FieldValue collection="orders" field="placedAt" value={order.placedAt}/>
        </div>
    ));
}
```

## Più pannelli in un unico scope

I tre pannelli integrano il proprio `CollectionsProvider` quando non ne è presente uno a monte. Questo è
il livello sottostante, e puoi montarlo autonomamente per condividere uno scope tra
diversi pannelli, o per utilizzare i componenti di livello inferiore (`CollectionViewBinding`,
`useSidePanel`) al suo interno. Al suo interno, un pannello può identificare la propria collezione tramite `path`:

```tsx
import { CollectionPanel, CollectionsProvider } from "@rebasepro/cms";

const collections = [postsCollection, authorsCollection];

<CollectionsProvider collections={collections}>
    <CollectionPanel collection="posts"/>
    <CollectionPanel collection="authors"/>
</CollectionsProvider>
```

`CollectionsProvider` gestisce un registro delle collezioni fornite, con le proprietà
dei plugin `modifyCollection` e `injectCollections` applicate come nell'amministrazione,
oltre ai pannelli laterali e alle finestre di dialogo in cui si aprono i record, nonché la protezione
per le modifiche non salvate. Mantieni stabile l'array `collections`: usa una costante di modulo,
o `useMemo`.

## Passaggi successivi

- [Personalizzazione dell'amministrazione](/docs/frontend/customizing): dove collocare un tuo
  componente e le ricette realizzate a partire da questi pannelli.
- [Hook](/docs/hooks): `useRows`, `useRow`, `useRowCount`, `useAggregate` e
  `useRowWrites`, le righe lette da questi pannelli e da `FieldValue`.
- [Override dei componenti](/docs/frontend/component-overrides): sostituisci la vista
  o il form renderizzato da un pannello.
