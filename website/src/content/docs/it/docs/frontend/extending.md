---
sourceHash: 6517ed25b1776f7e
title: Estendere Rebase
sidebar_label: Estendere Rebase
description: Una guida decisionale per scegliere il giusto meccanismo di estensione — plugin, slot, override di componenti, viste entità, azioni e altro ancora.
---

## Panoramica

Rebase offre circa una dozzina di meccanismi di estensione: plugin, slot, override di componenti, viste entità, azioni, campi personalizzati e altro ancora. Ciascuno si rivolge a un ambito diverso (a livello di app, per collezione, per entità, per proprietà) e a una parte diversa dell'interfaccia utente.

Questa guida ti aiuta a scegliere il meccanismo giusto per il tuo caso d'uso, rimandando poi alla documentazione dettagliata per ciascuno.

:::tip[Inizia con il modello, non con l'elenco]
Ogni meccanismo descritto di seguito è essenzialmente la stessa cosa: un componente React posizionato in un punto preciso. [Customizing the Admin](/docs/frontend/customizing) spiega questo modello in una sola pagina — elementi costitutivi, hook, posizioni — con ricette testate per un singleton di impostazioni, impostazioni per utente, un'azione di massa, una vista calendario, una dashboard e una schermata di login personalizzata. Leggilo prima; torna qui per scegliere la posizione.
:::

Tutto ciò che trovi qui riguarda il **pannello di amministrazione**. Per il server — restringere una lettura,
aggiungere una route, incorporare il driver nel proprio processo, `rebase eject` — consulta
[Rebase doesn't do X](/docs/backend/extending), che è lo stesso tipo di tabella
per il backend.

## Tabella decisionale

| Voglio… | Meccanismo | Ambito | Riferimento |
|---|---|---|---|
| Sostituire la barra dell'app | `components` (`Shell.AppBar`) | app | [Component Overrides](/docs/frontend/component-overrides) |
| Sostituire la pagina di login | `components` (`Auth.LoginView`) | app | [Component Overrides](/docs/frontend/component-overrides) |
| Sostituire la home page | `components` (`HomePage`) | app | [Component Overrides](/docs/frontend/component-overrides) |
| Modificare completamente l'aspetto del form di una collezione | `formView` | collection | [più sotto](#formview) |
| Sostituire un componente all'interno di una collezione | `admin.components` | collection | [Component Overrides](/docs/frontend/component-overrides) |
| Impostare gli override di componenti predefiniti per tutte le collezioni | `components` (nomi con ambito di collezione) | app | [Component Overrides](/docs/frontend/component-overrides) |
| Aggiungere un pulsante alla barra degli strumenti della collezione | `Actions` della collezione | collection | [Entity Actions](/docs/frontend/entity-actions#collection-actions) |
| Iniettare UI in uno slot della barra degli strumenti della collezione | slot `collection.actions` | app/plugin | [Slots](/docs/frontend/slots) |
| Aggiungere una colonna calcolata a una tabella | `additionalFields` | collection | [Additional Columns](/docs/frontend/additional-columns) |
| Aggiungere un widget di campo personalizzato per un tipo di proprietà | `propertyConfigs` | property type | [Custom Fields](/docs/frontend/custom-fields) |
| Aggiungere una scheda entità | `entityViews` | entity | [Entity Views](/docs/frontend/entity-views) |
| Eseguire il rendering delle righe di una collezione in modo diverso | `admin.customViews` | collection | [più sotto](#modalità-di-visualizzazione-personalizzate) |
| Aggiungere un'azione di riga/contesto o un pulsante entità | `entityActions` | entity | [Entity Actions](/docs/frontend/entity-actions) |
| Inserire un dato nella scheda di una collezione nella home page | slot `home.card.widget` | app/plugin | [Slots](/docs/frontend/slots) |
| Iniettare UI in una posizione specifica del chrome dell'interfaccia | `slots` | app/plugin | [Slots](/docs/frontend/slots) |
| Distribuire più estensioni come un'unica unità installabile | `plugins` | app | [Plugins](/docs/plugins) |
| Applicare lo stile a ciò che ho appena creato | `@rebasepro/ui` + token del tema | qualsiasi | [Styling Custom UI](/docs/frontend/styling) |

:::tip[Qualunque cosa tu scelga, costruiscila usando il kit]
Ogni meccanismo descritto di seguito ti fornisce un componente React e non impone come
riempirlo. Usa i componenti `@rebasepro/ui` e i token di colore del tema invece del
CSS scritto a mano: una vista personalizzata rimane comunque una vista del pannello di amministrazione,
e un colore hardcoded risulterà invisibile in uno dei due temi. Consulta
[Styling Custom UI](/docs/frontend/styling).
:::

## Dettaglio dei meccanismi

### Plugin

**Ambito:** app.

Un plugin raggruppa collezioni iniettate o modificate, viste, contributi di slot, wrapper di campi, provider, hook e callback del ciclo di vita in un'unica unità installabile. Gli override dei componenti, le viste entità, le azioni entità e `propertyConfigs` non sono campi dei plugin: vanno configurati su `<Rebase>` o sulla collezione.

→ [Riferimento per i plugin](/docs/plugins)

### Slot

**Ambito:** app (contribuito per-slot).

Gli slot sono punti di estensione UI nominati, distribuiti in tutta la struttura (chrome) del CMS. Registri un componente React specificando il nome di uno slot ed esso verrà renderizzato in quella posizione. Ci sono 27 slot che coprono la home page, la navigazione, le viste collezione, i form, le righe delle entità, i campi dei form e la barra dell'applicazione — e ciascuno di essi viene renderizzato.

→ [Riferimento per gli slot](/docs/frontend/slots)

### Override dei componenti (Swizzling)

**Ambito:** predefiniti a livello di app o per collezione.

Due modalità: **Eject** (sostituzione completa) o **Wrap** (estensione dell'originale).

19 nomi di componenti sostituibili suddivisi in due livelli:

**Solo a livello di app (7):**
- `Shell.AppBar`
- `Shell.Drawer`
- `Shell.DrawerNavigationItem`
- `Shell.DrawerNavigationGroup`
- `HomePage`
- `HomePage.CollectionCard`
- `Auth.LoginView`

**Con ambito di collezione (12):**
- `Collection.View`
- `Collection.Table`
- `Collection.Card`
- `Collection.EmptyState`
- `Collection.Actions`
- `Collection.FilterField`
- `Entity.Form`
- `EditView.FormActions`
- `DetailView`
- `Entity.SidePanel`
- `EntityPreview`
- `Entity.MissingReference`

**Precedenza:** I `components` a livello di collezione hanno la precedenza sui predefiniti a livello di app per lo stesso nome di componente: una sostituzione a livello di collezione sostituisce entrambi, mentre un override a livello di collezione con `wrap: true` avvolge quello a livello di app. I nomi dei componenti solo a livello di app (`Shell.*`, `HomePage`, `Auth.*`) possono essere sovrascritti solo al livello di `<Rebase>`.

→ [Component Overrides](/docs/frontend/component-overrides)

### Viste entità

**Ambito:** entità (aggiunge schede).

Viste personalizzate visualizzate come schede nella pagina di dettaglio dell'entità. Definite per collezione, oppure registrate una sola volta in `<Rebase entityViews>` (o `<RebaseCMS entityViews>`) e richiamate tramite `key` nel campo `admin.entityViews` di una collezione.

→ [Entity Views](/docs/frontend/entity-views)

### Azioni entità

**Ambito:** entità.

Pulsanti di azione personalizzati sulle singole entità (pubblica, archivia, clona, ecc.). Definiti per collezione, oppure registrati una sola volta in `<Rebase entityActions>` (o `<RebaseCMS entityActions>`) e richiamati tramite `key` nel campo `admin.entityActions` di una collezione.

→ [Entity Actions](/docs/frontend/entity-actions)

### `Actions` della collezione

**Ambito:** collezione.

Componenti React a livello di barra degli strumenti che ricevono `CollectionActionsProps` (entità selezionate, controller della tabella, contesto della collezione). Vengono renderizzati nella barra degli strumenti della collezione insieme alle azioni integrate.

**Relazione con lo slot `collection.actions`:** Entrambi sono additivi — i componenti `Actions` vengono renderizzati per primi nella barra degli strumenti, seguiti dai contributi dello slot da `collection.actions`. Non si sostituiscono a vicenda.

→ [Entity Actions — Collection Actions](/docs/frontend/entity-actions#collection-actions)

### Modalità di visualizzazione personalizzate
**Ambito:** collezione (aggiunge una modalità di visualizzazione).

Una mappa, un calendario, una galleria, una timeline: un altro modo di renderizzare *le stesse righe*,
offerto nel selettore di visualizzazione della collezione accanto a List, Table, Cards e Board.

```ts
// collection config
admin: {
    customViews: [
        { key: "map", name: "Map", icon: "Map", Builder: MapView }
    ],
    enabledViews: ["table", "map"],
    defaultViewMode: "map"
}
```

Oppure registra il componente una volta sola e referenzialo tramite chiave, il che lo rende anche
selezionabile dall'editor di collezione:

```tsx
<RebaseCMS
    collections={collections}
    collectionViews={[{ key: "map", name: "Map", icon: "Map", Builder: MapView }]}
/>
```

```ts
admin: { customViews: ["map"] }
```

`Builder` riceve il `tableController` attivo, quindi la vista eredita i filtri
della collezione, la casella di ricerca, l'ordinamento, la paginazione, i controlli dei permessi
e il pannello laterale dell'entità — questo è l'intero motivo per dichiararne uno invece di
creare una `AppView`:

```tsx
function MapView({ tableController, onRowClick }: CollectionCustomViewParams) {
    return <MapCanvas
        markers={tableController.rows.map(row => row.location)}
        onMarkerClick={i => onRowClick?.(tableController.rows[i])}
    />;
}
```

Le righe sono quelle restituite dal server, con la stessa struttura restituita da `useRows`: date come stringhe ISO,
un belongsTo come colonna di chiave esterna, e una relazione caricata dalla vista annidata
sotto il proprio nome. Una riga ha una colonna `id` solo se la sua tabella la possiede; il suo id si trova
accanto, `tableController.ids[i]` per `tableController.rows[i]`.
`highlightedIds` sono gli id delle righe che la vista visualizza come selezionate, e
anche `selectionController` gestisce id e righe:

```tsx
import type { CollectionCustomViewParams } from "@rebasepro/cms-types";
import { Card, Typography } from "@rebasepro/ui";

function CardsView({ tableController, highlightedIds, onRowClick }: CollectionCustomViewParams) {
    return <div className="grid grid-cols-3 gap-4 p-4">
        {tableController.rows.map((row, i) => {
            const id = tableController.ids[i];
            return <Card key={id}
                className={highlightedIds?.includes(id) ? "p-4 ring-2 ring-primary" : "p-4"}
                onClick={() => onRowClick?.(row)}>
                <Typography variant="subtitle2">{String(row.title ?? id)}</Typography>
            </Card>;
        })}
    </div>;
}
```

La selezione della vista aggiorna `?__view=`, sopravvive alla ricarica della pagina e persiste per utente.
Dichiararne una è sufficiente per renderla disponibile — `enabledViews` va configurato solo quando
desideri *rimuovere quelle integrate*. Se è presente una sola voce, il selettore viene nascosto.

**Questo non è un modo per creare una vista che abbraccia più collezioni.** Una modalità di visualizzazione
è un altro modo di renderizzare la query di una singola collezione. Se il tuo componente ignora
`tableController` ed effettua il fetch autonomo di quattro tabelle diverse, dovrebbe essere piuttosto una
[`AppView`](/docs/frontend#custom-views) — altrimenti la barra degli strumenti sovrastante, con la casella di ricerca
e il conteggio dei record, descriverebbe una query che la vista in realtà non renderizza.

### `formView`
**Ambito:** collezione.

Sostituisce l'intero form predefinito dell'entità con un componente personalizzato. Si imposta nella definizione di una collezione:

```typescript
const collection = {
    slug: "products",
    admin: {
        formView: {
            Builder: MyCustomProductForm,
            includeActions: true  // Save and Discard in the bar (default: true)
        }
    }
};

```

Da utilizzare quando hai bisogno di un layout completamente personalizzato per l'esperienza di modifica dell'entità di una collezione. Per modifiche più circoscritte, è preferibile utilizzare `admin.components` con l'override di `Entity.Form`.

Il Builder viene renderizzato all'interno del form del record e riceve il suo `formContext` attivo: scrivi con `formContext.setFieldValue`, e il pulsante Salva della barra memorizzerà il record. Nei casi in cui il record non può essere modificato — la vista di dettaglio in sola lettura o un utente privo di permessi di modifica — `formContext.disabled` è `true` e i tentativi di scrittura generano un errore. Imposta `includeActions: false` se il tuo Builder gestisce il salvataggio in autonomia tramite `formContext.submit()`.

### `additionalFields`

**Ambito:** collezione.

Colonne calcolate/virtuali visualizzate nella tabella della collezione. Non corrispondono a proprietà memorizzate sul database: vengono calcolate al momento del rendering.

→ [Additional Columns](/docs/frontend/additional-columns)

### `propertyConfigs`

**Ambito:** tipo di proprietà.

Widget di campo personalizzati per specifici tipi di proprietà, che forniscono campi form e componenti di anteprima personalizzati.

→ [Custom Fields](/docs/frontend/custom-fields)

## Non il pannello di amministrazione

Se ciò che desideri modificare è il comportamento del server anziché ciò che mostra
il pannello, questa non è la pagina giusta. Il server ha una propria gerarchia:

| Voglio… | Livello | Riferimento |
|---|---|---|
| Restringere quali righe restituisce una lettura | callback `beforeQuery` | [Extending the server](/docs/backend/extending#2-collection-callbacks) |
| Oscurare un valore in uscita | callback `afterRead` | [Callbacks](/docs/collections/callbacks) |
| Aggiungere un endpoint personalizzato | funzione personalizzata | [Custom Functions](/docs/backend/custom-functions) |
| Fare in modo che la ricerca trovi sottostringhe *e* ignori gli accenti | `search.mode: "hybrid"` | [Search](/docs/backend/search) |
| Gestire direttamente il processo del server | server personalizzato, poi `rebase eject` | [Extending the server](/docs/backend/extending) |

→ [Rebase doesn't do X](/docs/backend/extending)

## Riepilogo delle precedenze

- **L'opzione `admin.components` di una collezione ha la precedenza sui `components` globali** all'interno di quella collezione. Una sostituzione a livello di collezione sostituisce entrambi; un override con `wrap: true` a livello di collezione avvolge l'override globale se presente. Consulta [Component Overrides](/docs/frontend/component-overrides#when-both-scopes-override-a-component).
- **Le `Actions` della collezione e lo slot `collection.actions` sono additivi** — `Actions` viene renderizzato per primo, seguito dai contributi dello slot.
- **`entityActions` ed `entityViews` a livello di app fungono da registro, non da impostazioni predefinite:** una collezione li visualizza solo se il proprio `admin.entityActions` / `admin.entityViews` specifica la relativa `key`.
- **I plugin vengono applicati nell'ordine dell'array `plugins`**, non per `key`. I contributi agli slot vengono renderizzati in base al loro `order` (il valore più basso per primo, 50 come valore predefinito), e i casi di parità mantengono tale ordine. I wrapper di campo provenienti da più plugin si compongono in quell'ordine, con quello del primo plugin posizionato più all'interno. Consulta [Plugins](/docs/plugins#field-wrappers-from-several-plugins).
