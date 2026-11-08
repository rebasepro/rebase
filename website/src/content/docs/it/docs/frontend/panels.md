---
sourceHash: 99297021573eef28
title: Pannelli in una pagina personalizzata
sidebar_label: Pannelli nelle proprie pagine
description: "Mostra una collezione, il form di un record, un record o un singolo valore in una pagina personalizzata: CollectionPanel, EntityFormPanel, RecordDetail, FieldValue e CollectionsProvider, senza alcuna shell admin attorno."
---

Su 0.24
`CollectionPanel` accetta solo un `path` registrato e renderizza "Collection not
found" all'esterno dell'albero admin completo, mentre `EntityFormPanel` e
`CollectionsProvider` non esistono.

Non hai bisogno dell'intera interfaccia di amministrazione per mostrare una singola tabella. `<CollectionPanel>` accetta
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
nessuna route admin gestisce la pagina, quindi `full_screen` e `split` si aprono come pannello
laterale, e `useUrlController().routesMounted` è `false` per i tuoi componenti interni. Qualsiasi router è supportato: un semplice `<BrowserRouter>`, un
`<MemoryRouter>` o un data router. Un router è comunque obbligatorio. Un data router
permette inoltre a un record con modifiche non salvate di bloccare la navigazione in-app; con gli
altri router, solo il prompt di uscita dalla pagina del browser funge da protezione. Avvolgi il pannello in `<RebaseAuthGate>` se la pagina
deve mostrare prima il login di Rebase.

## Cosa mostra un pannello

<span class="since-badge" data-since="0.29">Da 0.29</span>
Un pannello disegna la collezione esattamente come fa l'admin. Queste prop lo restringono a ciò di cui
la tua pagina ha bisogno; nessuna di esse modifica la pagina nativa della collezione.

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

`collection` accetta il nome della collezione, come in questo esempio, oppure la collezione stessa come
valore (`collection={ordersCollection}`); anche `path` permette di identificarla, e indirizza una
subcollection tramite il suo percorso completo.

- `fields` — le proprietà che mostra, in questo ordine e nient'altro. Nella
  tabella corrispondono alle colonne. Nella vista a elenco, su una scheda e su una scheda kanban,
  rappresentano gli elementi con cui riempire le varie posizioni della riga — titolo, immagine, sottotitolo, stato, data,
  chip di relazione, le colonne dell'elenco — a partire dai primi definiti; una posizione che nessuno
  di essi riempie rimane vuota. Per questo pannello ha la priorità su `propertiesOrder`, sull'ordine
  delle colonne salvato dall'utente e su `listProperties`. La larghezza delle colonne ridimensionata da un utente viene
  comunque preservata; l'ordine è gestito da te, pertanto le colonne non sono trascinabili.
- `toolbar` — `"full"`, il valore predefinito; `"compact"`, che include la ricerca, il
  selettore della modalità di visualizzazione e Nuovo (dove l'utente ha i permessi di creazione); `"none"` (o `null`)
  per ometterla; oppure una toolbar composta dai suoi singoli elementi: `CollectionToolbar` (con `start` ed `end`),
  `CollectionSearchBar`, `CollectionFiltersButton`, `CollectionViewModeToggle`
  e `CollectionAddButton`. Questi componenti leggono il pannello in cui sono inseriti e generano un errore
  in qualunque altro contesto. Gli slot dei plugin e l'override `Collection.Actions` risiedono nella
  toolbar predefinita.
- `onRowClick` — invocato con la riga cliccata e il suo id invece di aprire il pannello del record,
  sia da una riga, da una scheda, da una scheda kanban o dall'azione di modifica. La riga corrisponde
  a quella restituita dal server, con la stessa struttura accettata da `useRows`, `useRow` e `<FieldValue>`:
  esattamente le sue colonne, stringhe di date in formato ISO (`YYYY-MM-DD` per colonne solo data),
  e una relazione belongsTo rappresentata dalla sua foreign key (`customerId`). Una relazione di cui il pannello ha caricato la
  destinazione arriva annidata sotto il suo nome, come restituito da un `include` in REST
  (`order.customer` è la riga del cliente); anche la relativa foreign key è presente. L'id
  è la stringa con cui l'admin identifica il record — la sua chiave primaria, o le parti di una
  chiave composta unite da `:::` — accettata da `highlightedIds` e
  `useSidePanel().open`. `row.id` rappresenta la colonna `id` del record, se presente
  nella tabella, con il tipo effettivo di quella colonna: `5` per una chiave intera, il cui id normalizzato è
  `"5"`.
- `rowActions` — elementi JSX personalizzati per ogni riga, scheda e scheda kanban, a cui vengono passati
  la riga e il suo id: ad esempio un pulsante "Approva" o "Spedisci". Nella tabella corrisponde all'ultima colonna,
  sempre visibile; nella riga di una lista, su una scheda e su una scheda kanban si posiziona accanto alle
  azioni native della collezione. Il click su di essa non apre il record e si
  aggiorna seguendo lo stato del componente, consentendo ad esempio a un flag `saving` di disabilitarla.
- `orderBy` — l'ordinamento iniziale delle righe, `"placed_at:desc"` oppure
  `["placed_at", "desc"]`. L'utente ha comunque la possibilità di ordinare per un'altra colonna.
- `highlightedIds` — gli id delle righe renderizzate come selezionate, ad esempio quella mostrata
  accanto alla lista: `highlightedIds={selected ? [selected] : []}`.
  Il valore `[]` non ne seleziona nessuna. In assenza della prop, il pannello evidenzia l'ultima riga aperta. Gli id
  sono confrontati come stringhe, quindi il valore intero `5` e la stringa `"5"` identificano la stessa riga.
- `where` — i filtri sulle righe da includere, nello stesso formato accettato da `useRows`:
  `where={{ status: ["==", "pending"] }}`. I filtri impostati dall'utente su altri
  campi vengono combinati con questo, mentre i campi definiti qui non possono essere modificati o rimossi
  dalla toolbar. La prop è reattiva, quindi una barra a schede o il click su un grafico possono
  pilotarla direttamente dallo stato. Ha priorità sul `fixedFilter` della collezione,
  campo per campo.
- `viewMode` — la modalità iniziale di visualizzazione, con priorità rispetto a quella nell'URL e all'ultima
  scelta dall'utente. La selezione manuale rimane comunque possibile.
- `title={false}` — nasconde il titolo sopra il pannello e l'intestazione predefinita della vista a lista.
- `updateUrl` — disattivato per impostazione predefinita: il pannello non legge né scrive i parametri
  `__view`, i filtri e l'ordinamento nell'URL della pagina.

Le `entityActions` della collezione vengono renderizzate su ogni riga, scheda e scheda kanban: sotto forma
di pulsanti se definite con `collapsed: false`, oppure nel menu della riga in caso contrario — un pulsante
"Approva" su ciascuna scheda corrisponde a una singola action.

Un pannello adatta le proprie dimensioni alle righe che contiene. Senza un'altezza definita dal componente genitore, o con una semplice
`max-height`, una collezione corta disegna la toolbar e le righe, mentre una più lunga
abilita lo scroll all'interno dello spazio disponibile, fino all'altezza della finestra. Imposta un'altezza fissa se
desideri riempirla. Il layout si adatta alla larghezza del pannello stesso e non a quella della finestra: in una
colonna stretta adotterà la visualizzazione compatta, indipendentemente dalla risoluzione dello schermo.

`propertiesOrder` riordina gli elementi senza mai nasconderli: una proprietà esclusa viene renderizzata
dopo quelle indicate esplicitamente. Per nasconderne una ovunque, imposta `admin.hideFromCollection`
su di essa; per mostrare solo alcuni campi in un contesto specifico, usa la prop `fields`.

## Form per un singolo record

`<EntityFormPanel>` offre la stessa flessibilità per il form di un singolo record. Carica il record
tramite `id`, lo salva attraverso il layer dati di `<Rebase>` esattamente come fa il
form dell'admin, e chiama `onSaved` dopo ogni salvataggio passando il record salvato nello stesso formato
restituito dal server, `row`, e il rispettivo `id`. Ometti `id` per creare un nuovo
record. `onClose` viene invocato quando il form richiede l'uscita, ad esempio dopo
l'eliminazione del record:

```tsx
<EntityFormPanel
    collection={postsCollection}
    id={postId}
    onSaved={({ id }) => console.log("saved", id)}
    onClose={() => navigate("/posts")}/>
```

Come per `CollectionPanel`, sia il form sia `RecordDetail` possono fare riferimento a una collezione
registrata indicando semplicemente il suo nome, senza dover passare l'oggetto di configurazione:
`<EntityFormPanel collection="posts" id={postId}/>` (è supportato anche `path="posts"`). All'interno di `<RebaseCMS>` o di un
`CollectionsProvider` in cui è registrata, non serve altro. Se non è presente alcun provider superiore,
passa la collezione come valore, come visto sopra, e il pannello fornirà il proprio contesto; indicare
un path non registrato restituirà un messaggio indicante che il record non è stato trovato.

Se un altro utente elimina il record mentre il form è aperto, quest'ultimo mantiene
i dati inseriti notificando che il record è stato eliminato altrove. L'azione "Salva come nuovo"
lo converte in un form di creazione per un nuovo record con quei valori;
`onSaved` restituirà quindi i dettagli del nuovo record.

<span class="since-badge" data-since="0.29">Da 0.29</span> Il form può mostrare solo una
porzione del record o disporre i campi con un layout su misura. `fields` visualizza solo i campi
elencati, nell'ordine specificato; le sezioni e la barra laterale mantengono il loro raggruppamento. I children
sostituiscono i campi autogenerati con il tuo JSX personalizzato, all'interno del quale
`<FormField name="…"/>` renderizza un singolo campo con etichetta, dimensioni e regole stabilite
dal form generato:

```tsx
import { EntityFormPanel, FormField } from "@rebasepro/cms";

<EntityFormPanel collection="orders" id={orderId}>
    <div className="grid grid-cols-2 gap-4">
        <FormField name="customer"/>
        <FormField name="status"/>
    </div>
    <FormField name="notes"/>
</EntityFormPanel>
```

`compact` offre un layout denso ideale per schede laterali o pannelli di larghezza compresa tra 350 e 700px: elimina la barra
laterale (i cui elementi vengono integrati nella colonna principale), omette i metadati del record,
utilizza controlli ad altezza media e riduce i padding:
`<EntityFormPanel collection="orders" id={orderId} fields={["status", "notes"]} compact/>`.

In entrambi i casi, il form convalida esclusivamente i campi visibili; la validazione dell'intero
record viene comunque eseguita dal server. Se un form di creazione omette un campo
obbligatorio privo di valore di default, mostrerà un avviso all'apertura: un errore identificherà il
campo e il salvataggio rimarrà bloccato finché il campo non verrà visualizzato o provvisto di un valore di default.
`collectionOverrides` permette di personalizzare la configurazione della collezione solo per questo form, con le stesse modalità previste per
`CollectionPanel`.

Ciascun form applica uno scope ai propri id DOM, rendendo possibile la coesistenza di più form nella stessa pagina. Per individuare un campo
all'interno di un test, puoi selezionare `[data-form-field="title"]` dentro il selettore
`[data-form-path="posts"]` del form.

<span class="since-badge" data-since="0.29">Da 0.29</span>
`<RecordDetail>` è l'equivalente in sola lettura di `EntityFormPanel`. Carica il
record tramite `id` e lo renderizza come la pagina record dell'admin: le stesse
sezioni ed etichette, formattando ogni valore con la relativa preview (un enum appare come
chip, una data con il proprio fuso orario e una relazione con il titolo del record collegato). Supporta
`fields` e `collectionOverrides` esattamente come il form, escludendo i campi
omessi da quest'ultimo: quelli nascosti per il record corrente tramite una regola `conditions.hidden` e
quelli che l'utente autenticato non ha il permesso di visualizzare.

```tsx
import { RecordDetail } from "@rebasepro/cms";

<RecordDetail
    collection="orders"
    id={orderId}
    fields={["customer", "status", "total"]}/>
```

`<FieldValue>` renderizza un singolo valore nello stesso modo, all'interno del tuo JSX: è sufficiente passargli il
valore nel formato restituito dal server. Una relazione belongsTo viene gestita tramite la sua foreign key
(`order.customerId`), pertanto `field="customer" value={order.customerId}` mostra il
titolo del record collegato; specificare la foreign key direttamente, tramite `field="customerId"`,
produce il medesimo risultato. Richiede che la collezione sia registrata a un livello superiore nell'albero, tramite `<RebaseCMS>`
o un `CollectionsProvider`. L'uso di una collezione o di un campo non riconosciuti genera un errore
esplicativo.

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

## Più pannelli all'interno dello stesso scope

I tre pannelli istanziano automaticamente un proprio `CollectionsProvider` qualora non ne trovino uno sopra di essi. Questo è
il componente sottostante che puoi montare esplicitamente per condividere un unico scope tra
più pannelli, oppure per impiegare elementi a più basso livello (`CollectionViewBinding`,
`useSidePanel`). All'interno di questo provider, un pannello può fare riferimento alla propria collezione indicando il `path`:

```tsx
import { CollectionPanel, CollectionsProvider } from "@rebasepro/cms";

const collections = [postsCollection, authorsCollection];

<CollectionsProvider collections={collections}>
    <CollectionPanel collection="posts"/>
    <CollectionPanel collection="authors"/>
</CollectionsProvider>
```

`CollectionsProvider` mantiene un registro delle collezioni fornite, applicando i metodi
`modifyCollection` e `injectCollections` definiti nei tuoi plugin proprio come nell'admin,
oltre a gestire i pannelli laterali e i dialog di apertura dei record e il controllo
delle modifiche non salvate. Assicurati che l'array `collections` mantenga un riferimento stabile: una costante a livello di modulo
o il ricorso a `useMemo`.

## Approfondimenti

- [Personalizzare l'admin](/docs/frontend/customizing): i punti in cui è possibile
  inserire componenti personalizzati e i pattern realizzabili a partire da questi pannelli.
- [Hook](/docs/hooks): `useRows`, `useRow`, `useRowCount`, `useAggregate` e
  `useRowWrites`, le funzioni per accedere ai dati letti da questi pannelli e da `FieldValue`.
- [Override dei componenti](/docs/frontend/component-overrides): sostituisci la vista
  o il form renderizzati da un pannello.
