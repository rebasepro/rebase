---
sourceHash: 7a427ea4f8f8b272
title: Pannelli in una pagina personalizzata
sidebar_label: Pannelli nelle tue pagine
description: "Mostra una tabella, il form di un record, un record o un singolo valore in una pagina personalizzata: CollectionPanel, RecordForm, RecordDetail, FieldValue e CollectionsProvider, senza alcuna shell di amministrazione attorno."
---

Non hai bisogno dell'intero pannello di amministrazione per mostrare una singola tabella. `<CollectionPanel>` accetta
una tabella tramite il suo slug e funziona ovunque sotto `<Rebase>` e un router
di React Router, senza la necessità di `<RebaseCMS>`, `<RebaseNavigation>` o `<RebaseShell>`:

```tsx
import { Rebase, useRebaseAuthController } from "@rebasepro/app";
import { CollectionPanel } from "@rebasepro/cms";
// Più BrowserRouter, o qualsiasi altro router, da "react-router".

export function App() {
    const authController = useRebaseAuthController({ client });

    return (
        <Rebase client={client} authController={authController}>
            <BrowserRouter>
                <MyPageLayout>
                    <CollectionPanel collection="posts"/>
                </MyPageLayout>
            </BrowserRouter>
        </Rebase>
    );
}
```

Un record si apre sopra la tua pagina, in un pannello laterale o in una finestra di dialogo, e mai tramite URL:
nessuna route di amministrazione serve la pagina, quindi `full_screen` e `split` si aprono come pannello
laterale, e `useUrlController().routesMounted` è `false` per i tuoi componenti personalizzati in quel contesto. Qualsiasi router funziona: un semplice `<BrowserRouter>`, un
`<MemoryRouter>`, o un data router. Un router è comunque richiesto. Un data router
consente inoltre a un record con modifiche non salvate di bloccare la navigazione in-app; con gli
altri router, solo il prompt del browser per l'uscita dalla pagina fornisce protezione. Avvolgi il pannello in `<RebaseAuthGate>` se la pagina
deve mostrare prima il login di Rebase.

## Cosa mostra un pannello

<span class="since-badge" data-since="0.31">Dalla versione 0.31</span>

Un pannello esegue il rendering della tabella nello stesso modo dell'admin — a partire dal descrittore fornito dal server,
insieme a qualsiasi `customizeTable` tu abbia registrato. Queste prop la restringono a ciò che
serve alla tua pagina; nessuna di esse modifica la pagina della tabella nell'admin.

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

`collection` accetta lo slug della tabella, come mostrato qui, o una collezione esterna
(`defineFirestoreCollection`) come valore; anche `path` ne specifica il nome e referenzia una
collezione annidata tramite il suo percorso completo.

- `fields` — le proprietà che vengono mostrate, in questo ordine, e nient'altro. Nella
  tabella rappresentano le colonne. Nella vista elenco, su una scheda e su una scheda kanban
  costituiscono gli elementi con cui vengono riempite le posizioni della riga — titolo, immagine, sottotitolo, stato, data,
  chip di relazione, le colonne dell'elenco —, partendo dai primi specificati; una posizione non
  coperta da alcuno di essi rimane vuota. Per questo pannello ha la precedenza su `propertiesOrder`,
  sull'ordine delle colonne salvato da un utente e su `listProperties`. La larghezza delle colonne trascinata da un utente
  viene comunque mantenuta; l'ordine è personalizzato, quindi le colonne non possono essere trascinate.
- `toolbar` — `"full"`, il valore predefinito; `"compact"`, che comprende la ricerca, il
  selettore della modalità di visualizzazione e Nuovo (dove l'utente ha i permessi di creazione); `"none"` (o `null`)
  per ometterla; oppure una toolbar composta dai suoi singoli elementi: `CollectionToolbar` (con `start` ed `end`),
  `CollectionSearchBar`, `CollectionFiltersButton`, `CollectionViewModeToggle`
  e `CollectionAddButton`. Questi elementi leggono il pannello in cui sono inseriti e generano un errore
  altrove. Gli slot dei plugin e l'override `Collection.Actions` risiedono nella
  toolbar predefinita.
- `onRowClick` — funzione richiamata passando la riga cliccata e il suo ID invece che aprire il pannello,
  da una riga, una scheda, una scheda kanban e dall'azione di modifica. La riga corrisponde a quella
  inviata dal server, nella stessa struttura accettata da `useRows`, `useRow` e `<FieldValue>`:
  esattamente le sue colonne, stringhe di data ISO (`YYYY-MM-DD` per una colonna di solo tipo data),
  e una relazione belongsTo indicata come la sua foreign key (`customerId`). Una relazione di cui il pannello ha caricato la
  destinazione arriva annidata sotto il proprio nome, come restituita dall'`include` REST
  (`order.customer` è la riga del cliente); è presente anche la sua foreign key. L'ID
  è la stringa con cui l'admin fa riferimento al record — la sua chiave primaria, o le parti di una
  chiave composita unite da `:::` — accettata da `highlightedIds` e
  `useSidePanel().open`. `row.id` corrisponde alla colonna `id` del record, se la
  tabella ne ha una, con il tipo di quella colonna: `5` per una chiave intera, il cui ID è
  `"5"`.
- `rowActions` — JSX personalizzato su ogni riga, scheda e scheda kanban, a cui vengono passati
  la riga e il suo ID: ad esempio "Approve", "Ship". Nella tabella rappresenta l'ultima colonna,
  sempre visibile; su una riga di elenco, una scheda e una scheda kanban si posiziona accanto alle
  azioni predefinite della collezione. Un clic su di essa non apre il record, e viene
  eseguito nuovamente il rendering in base allo stato del tuo componente, consentendo di disabilitarla con un flag come `saving`.
- `orderBy` — l'ordinamento iniziale con cui si aprono le righe, `"placed_at:desc"` o
  `["placed_at", "desc"]`. L'utente può comunque effettuare l'ordinamento in base a un'altra colonna.
- `highlightedIds` — gli ID delle righe renderizzate come selezionate, ad esempio quella che una pagina
  mostra accanto all'elenco: `highlightedIds={selected ? [selected] : []}`.
  `[]` non ne evidenzia nessuna. Senza questa prop, il pannello evidenzia l'ultima riga aperta. Gli ID
  vengono confrontati come stringhe, quindi `5` e `"5"` per una chiave intera identificano la stessa riga.
- `where` — i filtri che determinano le righe incluse, nello stesso formato accettato da `useRows`:
  `where={{ status: ["==", "pending"] }}`. I filtri impostati dall'utente su altri
  campi si combinano con esso, e i campi specificati qui non possono essere modificati o rimossi dalla
  toolbar. Segue il valore della prop, permettendo di controllarlo tramite stato da una barra delle schede o da una barra cliccata su un grafico.
  Ha la precedenza sul `fixedFilter` della collezione, campo per campo.
- `viewMode` — la modalità in cui si apre, con precedenza rispetto a quella nell'URL e all'ultima
  scelta dall'utente. L'utente può comunque cambiarla.
- `title={false}` — nessun titolo sopra il pannello, né l'intestazione propria della vista elenco.
- `updateUrl` — disattivato per impostazione predefinita: il pannello non legge né scrive i parametri
  `__view`, i filtri e l'ordinamento nell'URL della pagina.

Le `entityActions` della collezione vengono mostrate su ogni riga, scheda e scheda kanban, come
pulsanti quando dichiarate con `collapsed: false` e nel menu della riga in caso contrario — un pulsante
"Approve" su ogni scheda corrisponde a una singola azione.

Le dimensioni di un pannello si adattano alle sue righe. Senza un'altezza definita dal genitore, o con un solo
`max-height`, una collezione breve renderizza la toolbar e le righe, mentre una collezione lunga
scorre all'interno dello spazio disponibile, fino all'altezza della finestra. Assegna un'altezza per
occupare interamente lo spazio. Il layout si adatta alla larghezza del pannello stesso, non a quella della finestra: in una colonna
stretta utilizza il layout compatto, indipendentemente dallo schermo.

La proprietà `fieldOrder` in `customizeTable` della tabella riordina e non nasconde mai: un campo
omesso viene renderizzato dopo quelli specificati. Per escludere un campo dall'elenco
ovunque, imposta `hidden: true` nelle opzioni del campo; per mostrarne solo alcuni in un
singolo punto, passa `fields`.

## Il form di un singolo record

`<RecordForm>` fa lo stesso per il form di un singolo record (chiamato `EntityFormPanel`
prima della versione 0.29; tale nome continua a funzionare emettendo un warning singolo). Carica il record
tramite `id`, lo salva attraverso il data layer di `<Rebase>` come fa il form
dell'admin, e richiama `onSaved` dopo ogni salvataggio con il record salvato nella forma in cui il
server restituisce la riga, `row`, e il suo `id`. Ometti `id` per creare un nuovo
record. `onClose` viene richiamato quando il form richiede la chiusura, ad esempio dopo
che il relativo record è stato eliminato:

```tsx
<RecordForm
    collection="posts"
    id={postId}
    onSaved={({ id }) => console.log("saved", id)}
    onClose={() => navigate("/posts")}/>
```

Come `CollectionPanel`, il form e `RecordDetail` accettano una tabella tramite il suo slug
(funziona anche `path="posts"`). Tutte le tabelle fornite dal server sono accessibili a questi componenti,
sotto `<RebaseCMS>`, sotto un `CollectionsProvider`, o senza alcuno scope superiore, nel
qual caso il pannello ne include uno proprio. Una collezione esterna viene passata come
valore. Una collezione identificata da un path non fornito da alcun servizio segnala che il record non è stato trovato.

Se qualcun altro elimina il record mentre il form è aperto, il form mantiene
quanto digitato e segnala che il record è stato eliminato altrove. La sua azione "Save as new"
lo trasforma in un form per creare un nuovo record con quei valori;
`onSaved` segnala quindi il nuovo record.

Il form può mostrare
una parte del record, oppure disporlo secondo le tue esigenze. `fields` mostra solo i campi
specificati, in quell'ordine; le sezioni e il rail mantengono il loro raggruppamento. I children
sostituiscono i campi generati con il tuo JSX personalizzato, nel quale
`<FormField name="…"/>` renderizza un singolo campo con etichetta, dimensioni e regole assegnate dal
form generato:

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

`compact` è il form compatto ideale per una scheda laterale o un pannello da 350–700px: nessun rail
accanto ai campi (il relativo contenuto viene integrato nella colonna), nessun metadato del record,
controlli di altezza media e padding ridotto:
`<RecordForm collection="orders" id={orderId} fields={["status", "notes"]} compact/>`.

In entrambi i casi il form valida esclusivamente i campi visualizzati; il server continua a
verificare l'intero record. Un form che crea un record e omette un
campo obbligatorio privo di valore predefinito lo segnala all'apertura: un errore indica il
campo e il pulsante Save rimane disabilitato finché il campo non viene mostrato o non gli viene assegnato un valore predefinito.
`collectionOverrides` modifica la presentazione solo per questo form, esattamente come avviene per
`CollectionPanel`.

Ciascun form isola i propri ID DOM, consentendo a due form di coesistere nella stessa pagina. Per trovare un campo
durante i test, seleziona `[data-form-field="title"]` all'interno di
`[data-form-path="posts"]` del form.

`<RecordDetail>` è l'equivalente di sola lettura di `RecordForm`. Carica il
record tramite `id` e lo renderizza come avviene nella pagina del record dell'admin: le stesse
sezioni ed etichette, con ogni valore visualizzato nella sua anteprima, così un enum appare come
chip, una data nel rispettivo fuso orario e una relazione come titolo della relativa destinazione. Accetta
`fields` e `collectionOverrides` esattamente come il form, ed esclude i campi
che il form omette: quelli nascosti per questo record da una regola `conditions.hidden` e
quelli che l'utente autenticato non ha i permessi di visualizzare.

```tsx
import { RecordDetail } from "@rebasepro/cms";

<RecordDetail
    collection="orders"
    id={orderId}
    fields={["customer", "status", "total"]}/>
```

`<FieldValue>` renderizza un singolo valore nello stesso modo, all'interno del tuo JSX: passa il
valore così come viene restituito dal server. Una relazione belongsTo arriva come foreign key
(`order.customerId`), quindi `field="customer" value={order.customerId}` renderizza il
titolo del record correlato; specificare direttamente la foreign key, `field="customerId"`,
produce lo stesso risultato. Richiede che la tabella sia nota nel contesto superiore, tramite `<RebaseCMS>` o un
`CollectionsProvider`. Una collezione o un campo sconosciuto genera un errore
indicandone il nome.

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

I tre pannelli integrano il proprio `CollectionsProvider` quando non ne è presente uno superiore. Questo è
il componente sottostante, e puoi montarlo autonomamente per condividere un unico scope tra
più pannelli, o per usare le parti a livello inferiore (`CollectionViewBinding`,
`useSidePanel`) sotto di esso. Accetta gli stessi input di `<RebaseCMS>`:

```tsx
import { CollectionPanel, CollectionsProvider } from "@rebasepro/cms";
import { postsCms } from "./cms/posts";

const tableCustomizations = [postsCms];

<CollectionsProvider tableCustomizations={tableCustomizations}>
    <CollectionPanel collection="posts"/>
    <CollectionPanel collection="authors"/>
</CollectionsProvider>
```

`CollectionsProvider` gestisce un registro delle tabelle fornite dal server, con le tue
`tableCustomizations` e le eventuali `externalCollections`, applicando `modifyCollection`
e `injectCollections` dei tuoi plugin come nell'admin, oltre ai
pannelli laterali e ai dialog in cui si aprono i record, e alla protezione per le modifiche non salvate. Mantieni
gli array stabili: tramite una costante di modulo o `useMemo`. `tables` sostituisce le
tabelle servite con i descrittori forniti, utile per l'integrazione e i test.

## Passaggi successivi

- [Personalizzare l'admin](/docs/frontend/customizing): i punti in cui è possibile inserire un proprio
  componente e le soluzioni realizzate a partire da questi pannelli.
- [Hook](/docs/hooks): `useRows`, `useRow`, `useRowCount`, `useAggregate` e
  `useRowWrites`, le righe lette da questi pannelli e da `FieldValue`.
- [Override dei componenti](/docs/frontend/component-overrides): sostituisci la vista
  o il form renderizzato da un pannello.
