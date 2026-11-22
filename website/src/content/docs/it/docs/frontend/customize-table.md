---
sourceHash: 43be070662fffefd
title: customizeTable
sidebar_label: customizeTable
description: "customizeTable specifica in che modo la collection di una tabella differisce da ciò che il CMS deduce: etichette, icona, viste, kanban, slot di visualizzazione, layout dei moduli, azioni e opzioni per campo con componenti React importati per valore. Ogni opzione, con il rispettivo tipo ed effetto."
---

Se utilizzi il CMS, ogni tabella fornita dal backend ha già una collection nel
pannello, derivata dalla tabella stessa (vedi
[come le tabelle diventano collection](/docs/collections/)). `customizeTable` specifica
cosa dovrebbe differire, e nient'altro. Risiede nel frontend, insieme al resto
del tuo codice React, quindi un campo personalizzato è un componente che importi come qualsiasi altro.

```tsx
// frontend/src/cms/posts.tsx
import { customizeTable, updateRecord } from "@rebasepro/cms";
import type { posts } from "../../../backend/schema/posts";
import { CustomMarkdownEditor } from "../../../../../components/CustomMarkdownEditor";

export const postsCms = customizeTable<typeof posts>("posts", {
    name: "Blog Posts",
    singularName: "Blog Post",
    icon: "FileText",
    group: "Content",

    defaultViewMode: "cards",
    enabledViews: ["table", "cards", "kanban"],
    kanban: { columnField: "status", orderField: "__order" },

    display: {
        title: "title",
        image: "heroImage",
        status: "status",
        date: "publishDate",
    },

    fields: {
        status: {
            enumLabels: {
                draft:        { label: "Draft", color: "gray" },
                needs_review: { label: "Needs Review", color: "orange" },
                published:    { label: "Published", color: "green" },
                archived:     { label: "Archived", color: "red" },
            },
        },
        title:   { multiline: true },
        content: { Field: CustomMarkdownEditor },
        orgId:   { hidden: true },
        __order: { hidden: true, disabled: true },
    },

    entityActions: [
        {
            key: "publish",
            name: "Publish",
            icon: "Send",
            collapsed: false,
            isEnabled: ({ row }) => row?.status !== "published",
            onClick: ({ id, context }) =>
                updateRecord(context, "posts", id, { status: "published", publishDate: new Date().toISOString() }, "Published"),
        },
    ],
});
```

Passa il risultato a `<RebaseCMS tableCustomizations={[postsCms]}/>`; vedi
[la panoramica del frontend](/docs/frontend/#rebasecms-props).

:::note[Provieni da collections?]
Queste sono le opzioni di presentazione del vecchio blocco `admin`, al livello
principale e sotto alcuni nuovi nomi (`fieldOrder`, `listFields`, `previewFields`,
`fields`, `kanban.columnField`, `kanban.orderField`). L'utilizzo di un vecchio nome genera un errore
indicando quello nuovo.
:::

## Dove risiedono i file

```text
frontend/src/cms/
├── index.ts        # export const tableCustomizations = [postsCms, …]
├── posts.tsx       # customizeTable("posts", …)
└── events.ts       # defineFirestoreCollection(…), for Firestore
```

I nomi sono una convenzione. Ciò che conta è che i risultati raggiungano
`<RebaseCMS tableCustomizations>`. Una tabella priva di file viene mostrata come derivata.

Il frontend importa solo il **tipo** della tabella: `import type { posts }`. Un'importazione
di tipo viene cancellata durante la generazione del bundle, quindi hook e codice server in
`backend/schema` non raggiungono mai il browser. Un'importazione per valore da `backend/` nel
codice frontend è l'unica cosa da non scrivere mai. Il backend non importa mai nulla
dal frontend.

## Lo slug e il tipo

Il primo argomento è lo slug della tabella: il nome con cui è stata definita, o lo
`slug` che le è stato assegnato. Con la tabella come argomento di tipo, lo slug, ogni chiave
che denomina un campo e ogni valore enum vengono verificati a fronte della tabella:

| Verificato a fronte di `typeof posts` | Un errore è |
|---|---|
| il primo argomento | un errore di tipo a meno che non sia lo slug della tabella |
| chiavi di `fields` | una chiave di colonna o un nome di relazione |
| voci di `fieldOrder`, `listFields`, `form` | un campo, un percorso puntato al suo interno (`"seo.title"`), `subcollection:<relation>`, o la chiave di un campo aggiuntivo |
| `display`, `sort`, `fixedFilter`, `defaultFilter`, `filterPresets` | un campo o un percorso al suo interno |
| `kanban.columnField` | una colonna contenente un set chiuso di stringhe (`col.enum([...])`, o `.oneOf([...])`) |
| `kanban.orderField` | una colonna di testo |
| `enumLabels`, `enumOrder` | valori che la colonna può contenere; una colonna senza un set chiuso non accetta nessuno dei due |
| opzioni di campo | quelle del tipo della colonna: `multiline` su una colonna di testo, `format` su un numero |
| `entityActions[].onClick` e simili | `row` è l'`InferRow` della tabella |

`defineTable("blog_posts", { slug: "posts", … })` viene personalizzata come
`customizeTable<typeof posts>("posts", …)`: sempre un solo argomento di tipo. Senza
l'argomento di tipo, `customizeTable("posts", { … })` accetta le stesse opzioni,
tipizzate in modo debole.

## Cosa viene rifiutato e cosa viene ignorato

`customizeTable` controlla ciò che il compilatore non può vedere durante il caricamento del modulo,
e genera un errore suggerendo cosa scrivere:

- un'opzione sconosciuta, con la più vicina opzione nota, o con il nuovo nome di una vecchia
  opzione `admin`;
- un componente fornito come percorso stringa, un thunk lazy `() => import(…)` o qualsiasi elemento
  che non sia un componente React;
- un'azione di entità priva di `name` o `onClick`, una vista personalizzata priva di
  `Builder`, un `kanban` privo di `columnField`, un `referenceTo` che non è uno slug;
- `fields` all'interno degli `overrides` di una relazione: ridefinisci lo stile della tabella di destinazione con il suo
  proprio `customizeTable`.

```text
customizeTable("posts"): unknown options:
  - `propertiesOrder` — it is `fieldOrder` now
  - `iconn` — did you mean `icon`?
```

Il risultato è immutabile (frozen). Il passaggio di due personalizzazioni dello stesso slug a
`<RebaseCMS>` genera un errore: quale delle due prevale dipenderebbe dall'ordine di importazione.

Ciò che il server fornisce può differire da ciò rispetto a cui hai scritto il codice. Una colonna potrebbe essere
nascosta a questo chiamante (vedi [accesso ai campi](/docs/collections/field-access/)),
oppure la tabella potrebbe essere cambiata nel frattempo. Questo non è un errore a runtime. In
fase di sviluppo il pannello stampa un avviso per ogni discrepanza e la ignora:

- una personalizzazione il cui slug non corrisponde a nessuna tabella servita viene ignorata;
- un campo, una voce di colonna, uno slot di visualizzazione, una voce di modulo o un campo kanban non
  forniti dalla tabella vengono rimossi;
- un'opzione non applicabile al tipo di campo (`format` su una colonna di testo,
  `enumLabels` su un campo senza set chiuso) viene ignorata.

Il resto della personalizzazione viene comunque applicato.

## Opzioni di tabella

Ogni chiave è facoltativa. Una chiave omessa mantiene ciò che il pannello ha dedotto.

### Identità e navigazione

| Opzione | Tipo | Effetto |
|---|---|---|
| `name` | `string` | L'etichetta plurale: drawer, intestazione di pagina. Altrimenti dedotta dal nome della tabella. |
| `singularName` | `string` | L'etichetta di un singolo record. |
| `description` | `string` | Mostrata sotto l'intestazione e sulla scheda iniziale. |
| `metadata` | `Record<string, unknown>` | I tuoi dati personalizzati, uniti ai `metadata` della tabella. |
| `icon` | `string \| ReactNode` | Il nome di un'icona Lucide (`"FileText"`) o un elemento. |
| `group` | `string` | Il gruppo di navigazione. |
| `hideFromNavigation` | `boolean` | Non presente nel drawer. Raggiungibile comunque tramite URL e come target di riferimento. |
| `hideFromEntityViews` | `boolean` | Non offerta come scheda sui record delle tabelle ad essa collegate. |

### Viste

| Opzione | Tipo | Effetto |
|---|---|---|
| `defaultViewMode` | `ViewMode` | La vista su cui atterra un visitatore: `"list"`, `"table"`, `"cards"`, `"kanban"` o la chiave di una vista personalizzata. In caso contrario, `"list"`. |
| `enabledViews` | `ViewMode[]` | Le viste offerte nel selettore. |
| `kanban` | `{ columnField, orderField? }` | La bacheca: la colonna in base a cui raggruppare e la colonna di testo in cui memorizzare le chiavi di ordinamento. Vedi [Modalità di visualizzazione](/docs/frontend/view-modes/#kanban). |
| `customViews` | `(string \| TableCustomView)[]` | Ulteriori modalità per visualizzare le righe: `{ key, name, Builder }`, o la chiave di una registrata su `<RebaseCMS collectionViews>`. |
| `defaultSize` | `"xs" \| "s" \| "m" \| "l" \| "xl"` | L'altezza predefinita delle righe. |

`kanban` accetta due chiavi:

| Chiave | Tipo | Effetto |
|---|---|---|
| `columnField` | chiave di colonna | La colonna da cui derivano le colonne della bacheca: un `col.enum([...])` o `.oneOf([...])` di stringhe. |
| `orderField` | chiave di colonna di testo | Dove viene memorizzata la posizione di una scheda all'interno della sua colonna, come chiave di ordinamento frazionario. Senza di essa, l'ordine si azzera a ogni lettura. |

### Colonne e slot

| Opzione | Tipo | Effetto |
|---|---|---|
| `fieldOrder` | `TableColumnId[]` | L'ordine in cui i campi vengono disegnati. I campi omessi seguono a ruota, quindi nulla scompare. |
| `listFields` | `TableColumnId[]` | Le colonne della tabella e della vista elenco: i campi che visualizzano, e nessun altro. La tabella li ordina secondo `fieldOrder` (o l'ordine verso cui il visitatore li trascina) se presente, altrimenti secondo `listFields`. I campi esclusi rimangono comunque sul record. |
| `previewFields` | `TableFieldKey[]` | I campi mostrati quando un record di questa tabella viene referenziato da un'altra. |
| `display` | `TableDisplay` | Ciò che riempie `title`, `subtitle`, `image`, `status`, `date` e `tags` di un record: un percorso di campo o un resolver. Vedi [slot di visualizzazione](/docs/frontend/view-modes/#display-slots). |
| `additionalFields` | `TableAdditionalField[]` | Colonne calcolate della tabella. Non presenti sul record a meno che `form.sections` o `form.sidebar` non ne specifichino una. Vedi [Colonne aggiuntive](/docs/frontend/additional-columns/). |
| `hideIdFromCollection` | `boolean` | Nasconde la colonna id. |

Una colonna calcolata accetta:

| Chiave | Tipo | Effetto |
|---|---|---|
| `key` | `string` | Identifica la colonna. Indicala in `fieldOrder` come `"total" as AdditionalFieldKey`. |
| `name` | `string` | L'intestazione. |
| `width` | `number` | La larghezza, in pixel. |
| `Builder` | `(props) => ReactNode` | Esegue il rendering della cella a partire da `{ row, id, context }`. |
| `dependencies` | percorso o percorsi di campo | I campi la cui modifica attiva nuovamente il rendering della cella. |
| `value` | `(props) => string \| number` | Il valore della cella, per l'esportazione. Può essere asincrono. |

### Valori predefiniti per le query

| Opzione | Tipo | Effetto |
|---|---|---|
| `sort` | `OrderBySpec` | L'ordinamento predefinito: `["publishDate", "desc"]`, o più chiavi in sequenza. |
| `fixedFilter` | `FilterValues` | Un filtro che il visitatore non può modificare. |
| `defaultFilter` | `FilterValues` | Il filtro iniziale per il visitatore. |
| `filterPresets` | `FilterPreset[]` | Filtri rapidi con un clic nella barra degli strumenti: `{ label?, filterValues, sort? }`. |
| `pagination` | `boolean \| number` | Carica a pagine (`true`, o la dimensione della pagina), o tutto in una volta (`false`). |

Vedi [Filtri e ordinamento](/docs/frontend/view-modes/#filters-presets-and-sort).

### Comportamento

| Opzione | Tipo | Effetto |
|---|---|---|
| `inlineEditing` | `boolean` | Modifica le celle direttamente nella tabella. |
| `selectionEnabled` | `boolean` | Le righe possono essere selezionate. |
| `selectionController` | `SelectionController` | Una selezione gestita all'esterno della vista (`useSelectionController`). |
| `exportable` | `boolean \| ExportConfig` | Indica se la barra degli strumenti offre l'esportazione e le relative colonne aggiuntive. Vedi [Importazione ed esportazione](/docs/frontend/data-import-export/). |
| `openEntityMode` | `"side_panel" \| "full_screen" \| "split" \| "dialog"` | Modalità di apertura di un record. |
| `defaultEntityAction` | `"view" \| "edit"` | Se fare clic su un record lo apre in visualizzazione o in modifica. |
| `sideDialogWidth` | `number \| string` | La larghezza del pannello laterale in cui si apre un record. |
| `defaultSelectedView` | `string \| DefaultSelectedViewBuilder` | La scheda su cui si apre un record. |

### Modulo

| Opzione | Tipo | Effetto |
|---|---|---|
| `form` | `{ sidebar?, sections?, showRecordMeta? }` | Sezioni e la barra laterale (rail) accanto al modulo. Vedi [Layout del modulo](/docs/frontend/form-layout/). |
| `formView` | `{ Builder, includeActions? }` | Un componente che sostituisce il modulo generato. `includeActions` mantiene Salva e Annulla nella barra del record. |
| `formAutoSave` | `boolean` | Salva durante la digitazione del visitatore. |
| `alwaysApplyDefaultValues` | `boolean` | Compila i valori predefiniti dichiarati nei campi vuoti di un record memorizzato quando viene aperto. |
| `includeJsonView` | `boolean` | Aggiunge una scheda con il record in formato JSON. |
| `localChangesBackup` | `"manual_apply" \| "auto_apply" \| false` | Mantiene le modifiche non salvate nella memoria locale (local storage). |
| `hideIdFromForm` | `boolean` | Nasconde l'id dal modulo. |

`form` accetta:

| Chiave | Tipo | Effetto |
|---|---|---|
| `sidebar` | id dei campi | I campi estratti nella barra laterale accanto al modulo. |
| `sections` | sezioni | Le sezioni della colonna principale, descritte di seguito. |
| `showRecordMeta` | `boolean` | Mostra l'id e i timestamp del record nella barra laterale. |

Ciascuna sezione accetta:

| Chiave | Tipo | Effetto |
|---|---|---|
| `key` | `string` | Identifica la sezione; funge anche da `id` per il suo ancoraggio. |
| `title` | `string` | L'intestazione. Nessuna se omessa. |
| `fields` | id dei campi | I campi nella sezione, in ordine. |
| `collapsed` | `boolean` | Inizia compressa (chiusa). |
| `collapsible` | `boolean` | Può essere compressa. |
| `readVariant` | `"grid" \| "summary"` | Come viene visualizzata la sezione quando il record viene mostrato anziché modificato. |

### Azioni, viste e override

| Opzione | Tipo | Effetto |
|---|---|---|
| `entityActions` | `(string \| TableEntityAction)[]` | Azioni su un record. Un oggetto, oppure la chiave di uno registrato su `<RebaseCMS entityActions>`. Vedi [Azioni di entità](/docs/frontend/entity-actions/). |
| `disableDefaultActions` | `("edit" \| "copy" \| "delete")[]` | Azioni predefinite non offerte da questa tabella. |
| `resetPasswordAction` | `false \| TableEntityAction` | Solo per la tabella di autenticazione (`defineAuthTable`): `false` rimuove l'azione integrata di reimpostazione della password, un'azione la sostituisce (offerta indipendentemente da ciò che supporta l'adapter di autenticazione: il backend è tuo). Ignorata, con un avviso, su qualsiasi altra tabella. |
| `entityViews` | `(string \| TableEntityView)[]` | Schede aggiuntive su un record. Vedi [Viste di entità](/docs/frontend/entity-views/). |
| `Actions` | `Component[]` | Componenti visualizzati nella barra degli strumenti della collection. |
| `components` | `TableComponentOverrides` | Override dei componenti con ambito di collection, ciascuno formato da `{ Component, wrap? }`. Vedi [Override dei componenti](/docs/frontend/component-overrides/#collection-level-component-overrides). |
| `browserCallbacks` | `CollectionCallbacks` | Callback eseguiti nel pannello dopo gli hook del server. Solo per la presentazione: vengono inviati a ciascun visitatore e non proteggono nulla. Vedi [Hook di React](/docs/hooks/). |
| `fields` | `TableFields` | Opzioni per campo, con chiave per colonna o relazione. Sotto. |

## Opzioni di campo

`fields.<key>` accetta le opzioni applicabili a ogni campo, oltre a quelle specifiche del tipo
della colonna. [Campi](/docs/collections/properties/) mostra ciascuna opzione insieme al widget che
modifica.

### Ogni campo

| Opzione | Tipo | Effetto |
|---|---|---|
| `name` | `string` | L'etichetta. Altrimenti dedotta dalla chiave (`publishDate` → "Publish Date"). |
| `description` | `string` | Testo di aiuto sotto il campo. |
| `hidden` | `boolean` | Escluso dalle viste tabella, elenco e schede, e dal record: sia dal relativo modulo che dalla vista in sola lettura. Viene comunque letto e scritto dall'API. |
| `hiddenInForm` | `boolean` | Escluso dal record (dal relativo modulo e dalla vista in sola lettura). Rimane presente nelle viste. |
| `disabled` | `boolean \| { disabledMessage?, clearOnDisabled? }` | Il controllo è disabilitato (in grigio). `disabledMessage` ne spiega il motivo accanto; `clearOnDisabled` cancella il valore quando viene disabilitato. |
| `readOnly` | `boolean` | Il valore viene visualizzato come testo, senza alcun controllo di input. |
| `Field` | `Component` | Sostituisce il controllo del modulo. Il componente stesso. Vedi [Campi personalizzati](/docs/frontend/custom-fields/). |
| `Preview` | `Component` | Sostituisce la modalità di visualizzazione del valore all'esterno del modulo. |
| `Filter` | `Component` | Sostituisce il controllo del filtro per questo campo. |
| `columnWidth` | `number` | La larghezza della colonna nella tabella, in pixel. |
| `filledByServer` | `boolean` | Un hook del server lo compila alla creazione: il modulo consente la creazione del record senza di esso. |
| `span` | `1 \| 2 \| 3 \| 4` | Quante delle quattro colonne della griglia del modulo occupa. |
| `customProps` | `unknown` | Passato invariato ai tuoi `Field` e `Preview`. |
| `filterOperators` | `WhereFilterOp[]` | Restringe gli operatori di filtro disponibili. `[]` disattiva il filtraggio per il campo. |
| `propertyConfig` | `string` | La chiave di un tipo di campo registrato su `<Rebase propertyConfigs>`. |
| `conditions` | `PropertyConditions` | Regole JSON-logic che nascondono, disabilitano o rendono obbligatorio il campo in base ai valori del record. Solo per il modulo. Vedi [condizioni](/docs/collections/validation-and-conditions/#conditional-fields). |
| `dynamicProps` | `(props) => options \| undefined` | Restituisce le opzioni di campo applicabili al momento, in base al record in corso di modifica. Solo per il modulo. |
| `metadata` | `Record<string, unknown>` | I tuoi dati personalizzati. |

### Colonne di testo e uuid

| Opzione | Tipo | Effetto |
|---|---|---|
| `multiline` | `boolean` | Un campo di input multilinea, che si espande con il contenuto. |
| `markdown` | `boolean` | Un editor markdown con anteprima. |
| `previewAsTag` | `boolean` | Visualizzato come chip anziché come testo. |
| `clearable` | `boolean` | Aggiunge un controllo che imposta il valore su `null`. |
| `urlPreview` | `PreviewType \| boolean` | Come viene visualizzata l'anteprima di un URL nel valore: `"image"`, `"video"`, `"audio"`, `"file"`, oppure `true` per un link. |
| `referenceTo` | `string` | La colonna contiene la chiave di un record in un'altra collection, su qualsiasi origine dati: viene visualizzata e selezionata come riferimento allo slug di tale collection. Vedi [Firestore](/docs/frontend/firebase/#from-a-table-to-firestore). |

### Colonne con un set chiuso di valori

Un `col.enum([...])`, un `.oneOf([...])`, o un array di uno di essi:

| Opzione | Tipo | Effetto |
|---|---|---|
| `enumLabels` | `{ [value]?: string \| EnumLabel }` | Etichette per alcuni dei valori. I valori esclusi mantengono l'etichetta e il colore dedotti. |
| `enumOrder` | `value[]` | L'ordine con cui i valori vengono presentati e le colonne del kanban disegnate. Altrimenti, l'ordine originale della colonna. |
| `previewAsTag` | `boolean` | Su un `col.enum()`: visualizzato come chip. |
| `clearable` | `boolean` | Su un `col.enum()`: aggiunge un controllo che imposta il valore su `null`. |

Un `EnumLabel` accetta:

| Chiave | Tipo | Effetto |
|---|---|---|
| `label` | `string` | Il testo sul chip e nel menu a discesa. |
| `color` | `ColorKey \| ColorScheme` | Una chiave colore per il chip (`"green"`, `"orangeDark"`) o uno schema `{ color, text }`. Un valore che ne è privo mantiene il colore iniziale assegnato. |
| `disabled` | `boolean` | Mostrato, ma non selezionabile. |

### Colonne numeriche

| Opzione | Tipo | Effetto |
|---|---|---|
| `clearable` | `boolean` | Aggiunge un controllo che imposta il valore su `null`. |
| `format` | `NumberFormatOptions` | Scrive il numero come valuta, percentuale o con decimali fissi. |

`format` accetta `style` (`"decimal"`, `"currency"`, `"percent"`), `currency` (un
codice ISO, obbligatorio con `"currency"`), `locale` (altrimenti quello dell'utente),
`minimumFractionDigits`, `maximumFractionDigits` e `notation`
(`"standard"` o `"compact"`, che scrive `12000` come `12K`). Modifica ciò che viene
visualizzato, mai ciò che viene memorizzato.

### Colonne di data, timestamp e ora

| Opzione | Tipo | Effetto |
|---|---|---|
| `clearable` | `boolean` | Aggiunge un controllo che imposta il valore su `null`. |
| `mode` | `"date" \| "date_time"` | Seleziona e mostra solo il giorno, o giorno e ora. Altrimenti dedotto dal tipo della colonna. |
| `timezone` | `string` | Il fuso orario IANA in cui il valore viene visualizzato e selezionato (`"Europe/Madrid"`). Altrimenti quello dell'utente. |

### Colonne vettoriali

| Opzione | Tipo | Effetto |
|---|---|---|
| `clearable` | `boolean` | Aggiunge un controllo che imposta il valore su `null`. |

### Colonne di archiviazione (storage)

| Opzione | Tipo | Effetto |
|---|---|---|
| `storage` | `StorageCustomization` | Le funzioni di caricamento eseguite nel browser. |
| `clearable` | `boolean` | Aggiunge un controllo che imposta il valore su `null`. |
| `urlPreview` | `PreviewType \| boolean` | Come viene visualizzata l'anteprima dell'URL memorizzato. |

`storage` accetta unicamente funzioni; le opzioni serializzabili rimangono su
`col.storage({ … })` (vedi [Caricamento di file](/docs/collections/file-uploads/)):

| Chiave | Firma | Effetto |
|---|---|---|
| `path` | `(context) => string` | La cartella in cui viene caricato un file, sostituendo il template `path` della colonna. |
| `fileName` | `(context) => string \| Promise<string>` | Il nome del file memorizzato, sostituendo il template `fileName` della colonna. |
| `processFile` | `(file) => Promise<File>` | Trasforma un file prima che venga caricato. |
| `postProcess` | `(pathOrUrl) => Promise<string>` | Trasforma il percorso o l'URL memorizzato prima che venga scritto nella colonna. |
| `previewUrl` | `(fileName) => string` | L'URL a cui visualizzare l'anteprima di un file memorizzato. |

### Colonne array

| Opzione | Tipo | Effetto |
|---|---|---|
| `expanded` | `boolean` | Ogni elemento aperto al caricamento. |
| `minimalistView` | `boolean` | Elementi senza cornice né intestazione. |
| `sortable` | `boolean` | Gli elementi possono essere riordinati tramite trascinamento. |
| `canAddElements` | `boolean` | Gli elementi possono essere aggiunti. |
| `of` | opzioni di campo | Le opzioni di ciascun elemento. |
| `storage` | `StorageCustomization` | Le funzioni di caricamento, per `col.storage().multiple()`. |

`enumLabels` ed `enumOrder` definiti su un array si applicano ai suoi elementi.

### Colonne JSON

| Opzione | Tipo | Effetto |
|---|---|---|
| `expanded` | `boolean` | I campi del documento sono aperti al caricamento. |
| `minimalistView` | `boolean` | I campi del documento senza la loro cornice. |
| `spreadChildren` | `boolean` | I campi del documento sono disposti come se appartenessero direttamente al record. |
| `keyValue` | `boolean` | Modificato come coppie chiave/valore libere. |
| `previewFields` | `string[]` | Le chiavi del documento nominate nel riepilogo su una riga, in questo ordine. |
| `fields` | `{ [key]: opzioni di campo }` | Le opzioni di ciascuna chiave del documento. |
| `fieldOrder` | `string[]` | L'ordine in cui sono visualizzate le chiavi del documento. |
| `of` | opzioni di campo | Le opzioni di ciascun elemento, per un documento che è una lista. |
| `oneOf` | `{ [variant]: opzioni di campo }` | Le opzioni di ciascuna variante di un blocco tipizzato (`json.oneOf`). |

Con `col.jsonb().$type<T>()` o una forma `json.object({…})`, `fields` e `fieldOrder`
sono tipizzati dalle chiavi del documento. Vedi [Array e JSON](/docs/collections/arrays-and-maps/).

In una cella di tabella, in una riga di elenco o in una scheda, un documento JSON occupa una sola riga: le sue prime
quattro chiavi di primo livello (o i suoi `previewFields`), etichettate con il loro `name`, ciascuna
con il rispettivo valore quando si tratta di un testo breve, un numero o un sì/no, `3 items` per una
lista e `4 fields` per un oggetto annidato, che non viene espanso. Una lista di
documenti è rappresentata dal suo conteggio. L'intero documento è presente sul record e nell'editor
espandibile della cella. Per una riga più leggibile, elenca le chiavi rilevanti in
`previewFields`, oppure assegna al campo un componente `Preview`.

### Relazioni

| Opzione | Tipo | Effetto |
|---|---|---|
| `previewFields` | `string[]` | I campi della destinazione mostrati nel chip per una riga correlata. Ne possono rientrare al massimo tre. |
| `defaultValue` | `EntityRelation \| EntityRelation[]` | La riga o le righe correlate con cui inizia il modulo di un nuovo record: `new EntityRelation(id, "<target slug>")` (`EntityRelation` da `@rebasepro/cms-types`), o un elenco per una relazione to-many. Scritto solo al salvataggio del modulo. Il valore predefinito intrinseco di una colonna è definito con `.default()` sulla colonna stessa. |
| `widget` | `"select" \| "dialog"` | Modalità di selezione di una riga correlata. |
| `fixedFilter` | `FilterValues` | Propone solo le righe che superano questo filtro. |
| `includeId` | `boolean` | Mostra l'id della riga correlata nelle anteprime. |
| `includeEntityLink` | `boolean` | Mostra un link per aprire la riga correlata. |
| `renderInForm` | `boolean` | Disegna inoltre una relazione to-many come selettore nel modulo, accanto alla sua scheda. |
| `overrides` | opzioni di tabella senza `fields` | Modalità di presentazione della destinazione nella scheda di questa relazione. |

Vedi [Relazioni nel pannello](/docs/collections/relations-in-the-admin-panel/).

## Personalizzazioni, `ui-config.json` e preferenze

Ciò che il pannello mostra per una tabella è composto secondo un ordine fisso, dove ogni livello si sovrappone
a quello precedente:

1. **La collection derivata**: ciò che il pannello ricava dalla tabella fornita
   dal server.
2. **Codice**: i risultati di `customizeTable` passati come `tableCustomizations`.
3. **`frontend/src/cms/ui-config.json`**: la presentazione del workspace,
   passata come `uiConfig`. È un file nel frontend, modificato a mano (o dal
   tuo agente), che viene quindi revisionato e distribuito insieme ad esso.
4. **Preferenze del workspace**: ciò che un amministratore salva su un deployment, nella
   tabella `rebase.ui_preferences` tramite
   [`/api/admin/ui-config`](/docs/backend/endpoints/). La loro scrittura richiede
   `schema:write`.
5. **Preferenze utente**: le larghezze di colonna, i cambi di vista e le
   colonne nascoste personalizzate del singolo utente. Conservate nel browser quando non si è autenticati.

Uno scheletro di `App.tsx` include già il collegamento al file:

```tsx
import { RebaseCMS } from "@rebasepro/cms";
import { tableCustomizations } from "./cms";
import uiConfig from "./cms/ui-config.json";

export const Admin = () => <RebaseCMS tableCustomizations={tableCustomizations} uiConfig={uiConfig} />;
```

Le preferenze contengono solo la presentazione: etichette, icona, modalità di visualizzazione, ordine delle colonne,
colonne nascoste, etichette e colori degli enum, kanban e valori predefiniti delle query. Nessun dato relativo
allo schema finisce lì; questi ultimi risiedono in `backend/schema`.

`rebase build` include `frontend/src/cms/ui-config.json` nel bundle
(`entry.uiConfig`), consentendo anche a un backend distribuito di conoscerlo: `GET /api/admin/ui-config`
lo fornisce come `shipped` insieme ai livelli di workspace e utente, e le viste MCP
e `describe_table` integrano gli stessi tre livelli — il file, il workspace e
quello specifico del chiamante (nessuno nel caso di una chiave API) — in modo che un agente veda le etichette, l'ordine,
le colonne nascoste e le etichette enum che un utente vede nel pannello.

`rebase verify` analizza ogni chiamata a `customizeTable` in `frontend/src/cms` a fronte
delle tabelle, senza eseguirla: individua una personalizzazione per una tabella o un
campo inesistente, una colonna obbligatoria nascosta dal modulo, una tabella
personalizzata due volte, un `ui-config.json` non passato ad alcun `<RebaseCMS>` e una configurazione
Vite priva di `rebaseBackendGuard()`. Vedi [`rebase verify`](/docs/cli/#rebase-verify).

## Passaggi successivi

- [Come le tabelle diventano collection](/docs/collections/): ciò che il pannello deduce prima di tutto questo
- [Campi](/docs/collections/properties/): widget e opzioni per ciascun tipo di colonna
- [Modalità di visualizzazione](/docs/frontend/view-modes/): tabella, schede, kanban, slot di visualizzazione, filtri
- [Azioni di entità](/docs/frontend/entity-actions/): `entityActions` e `updateRecord`
- [Firestore insieme a Postgres](/docs/frontend/firebase/): `externalCollections` e riferimenti tra motori di database
