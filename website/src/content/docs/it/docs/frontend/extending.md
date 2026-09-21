---
sourceHash: 026e97ba1b999743
title: Estendere Rebase
sidebar_label: Estendere Rebase
description: Una guida alle decisioni per scegliere il giusto meccanismo di estensione — plugin, slot, override di componenti, viste entità, azioni e altro ancora.
---

## Panoramica

Rebase offre circa una dozzina di meccanismi di estensione — plugin, slot, override di componenti, viste entità, azioni, campi personalizzati e altro ancora. Ognuno di essi si rivolge a un ambito differente (a livello di app, per collezione, per entità, per proprietà) e a una parte diversa dell'interfaccia utente.

Questa guida ti aiuta a scegliere il meccanismo più adatto al tuo caso d'uso, rimandando poi alla documentazione dettagliata per ciascuno.

Tutto ciò che viene trattato qui riguarda il **pannello di amministrazione**. Per il server — restringere una lettura, aggiungere una route, incorporare il driver nel proprio processo, `rebase eject` — vedi [Rebase doesn't do X](/docs/backend/extending), che offre lo stesso tipo di tabella per il backend.

## Tabella decisionale

| Voglio… | Meccanismo | Ambito | Riferimento |
|---|---|---|---|
| Sostituire la barra dell'applicazione | `components` (`Shell.AppBar`) | app | [Override dei componenti](/docs/frontend/component-overrides) |
| Sostituire la pagina di login | `components` (`Auth.LoginView`) | app | [Override dei componenti](/docs/frontend/component-overrides) |
| Sostituire la home page | `components` (`HomePage`) | app | [Override dei componenti](/docs/frontend/component-overrides) |
| Modificare completamente l'aspetto del form di una collezione | `formView` | collezione | [sotto](#formview) |
| Sostituire un singolo componente all'interno di una collezione | `collection.components` | collezione | [Override dei componenti](/docs/frontend/component-overrides) |
| Impostare override dei componenti predefiniti per tutte le collezioni | `components` (nomi con ambito collezione) | app | [Override dei componenti](/docs/frontend/component-overrides) |
| Aggiungere un pulsante alla barra degli strumenti della collezione | `Actions` della collezione | collezione | [Azioni entità](/docs/frontend/entity-actions#collection-actions) |
| Iniettare UI in uno slot della barra degli strumenti della collezione | slot `collection.actions` | app/plugin | [Slot](/docs/frontend/slots) |
| Aggiungere una colonna calcolata a una tabella | `additionalFields` | collezione | [Colonne aggiuntive](/docs/frontend/additional-columns) |
| Aggiungere un widget di campo personalizzato per un tipo di proprietà | `propertyConfigs` | tipo di proprietà | [Campi personalizzati](/docs/frontend/custom-fields) |
| Aggiungere una scheda entità | `entityViews` | entità | [Viste entità](/docs/frontend/entity-views) |
| Renderizzare le righe di una collezione in modo diverso | `admin.customViews` | collezione | [sotto](#customviews) |
| Aggiungere un'azione su riga/contesto o un pulsante entità | `entityActions` | entità | [Azioni entità](/docs/frontend/entity-actions) |
| Inserire un dato numerico/grafico nella scheda della home page di una collezione | slot `home.card.widget` | app/plugin | [Slot](/docs/frontend/slots) |
| Iniettare UI in una posizione specifica del chrome | `slots` | app/plugin | [Slot](/docs/frontend/slots) |
| Distribuire diverse estensioni come un'unica unità installabile | `plugins` | app | [Plugin](/docs/plugins) |
| Applicare stili a ciò che è stato appena creato | `@rebasepro/ui` + token del tema | qualsiasi | [Stilizzazione della UI personalizzata](/docs/frontend/styling) |

:::tip[Qualunque cosa tu scelga, costruiscila usando il kit]
Ciascun meccanismo descritto di seguito fornisce un componente React senza imporre come riempirlo. Usa i componenti di `@rebasepro/ui` e i token colore del tema anziché CSS scritto a mano: una vista personalizzata è comunque una vista di amministrazione, e un colore hardcoded risulterebbe invisibile in uno dei due temi. Vedi [Stilizzazione della UI personalizzata](/docs/frontend/styling).
:::

## Meccanismi in dettaglio

### Plugin

**Ambito:** app.

Un plugin raggruppa collezioni, viste, override di componenti, contributi agli slot, autenticazione, origini dati, provider, hook e callback del ciclo di vita in una singola unità installabile. Tutti gli altri meccanismi elencati qui possono essere forniti tramite l'interfaccia di un plugin.

→ [Riferimento plugin](/docs/plugins)

### Slot

**Ambito:** app (contributo per slot).

Gli slot sono punti di estensione UI denominati e distribuiti nell'interfaccia (chrome) del CMS. Si registra un componente React indicando il nome dello slot di destinazione, e questo viene renderizzato in quella posizione. Ci sono 27 slot che coprono la home page, la navigazione, le viste collezione, i form, le righe di entità, i campi dei form e la barra dell'applicazione — e ognuno di essi viene renderizzato.

→ [Riferimento slot](/docs/frontend/slots)

### Override dei componenti (Swizzling)

**Ambito:** valori predefiniti a livello di app o per collezione.

Due modalità: **Eject** (sostituzione completa) o **Wrap** (estensione dell'originale).

19 nomi di componenti sovrascrivibili suddivisi in due livelli:

**Solo a livello di app (7):**
- `Shell.AppBar`
- `Shell.Drawer`
- `Shell.DrawerNavigationItem`
- `Shell.DrawerNavigationGroup`
- `HomePage`
- `HomePage.CollectionCard`
- `Auth.LoginView`

**Con ambito collezione (12):**
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

**Precedenza:** I `components` a livello di collezione sovrascrivono i valori predefiniti a livello di app per lo stesso nome di componente (semplice object spread — i valori della collezione sovrascrivono quelli globali). I nomi dei componenti disponibili solo a livello di app (`Shell.*`, `HomePage`, `Auth.*`) possono essere sovrascritti solo a livello di `<Rebase>`.

→ [Override dei componenti](/docs/frontend/component-overrides)

### Viste entità

**Ambito:** entità (aggiunge schede).

Viste personalizzate visualizzate come schede nella pagina di dettaglio dell'entità. Possono essere definite a livello globale su `<Rebase>` o per collezione.

→ [Viste entità](/docs/frontend/entity-views)

### Azioni entità

**Ambito:** entità.

Pulsanti di azione personalizzati sulle singole entità (pubblica, archivia, clona, ecc.). Possono essere definiti a livello globale o per collezione.

→ [Azioni entità](/docs/frontend/entity-actions)

### `Actions` della collezione

**Ambito:** collezione.

Componenti React a livello di barra degli strumenti che ricevono `CollectionActionsProps` (entità selezionate, controller della tabella, contesto della collezione). Vengono renderizzati nella barra degli strumenti della collezione accanto alle azioni predefinite.

**Relazione con lo slot `collection.actions`:** Entrambi sono additivi — i componenti `Actions` vengono renderizzati per primi nella barra degli strumenti, seguiti dai contributi dello slot `collection.actions`. Non si sostituiscono a vicenda.

→ [Azioni entità — Azioni di collezione](/docs/frontend/entity-actions#collection-actions)

### Modalità di visualizzazione personalizzate {#customviews}

**Ambito:** collezione (aggiunge una modalità di visualizzazione).

Una mappa, un calendario, una galleria, una cronologia — un'altra resa grafica de *le stesse righe*, offerta nel selettore delle viste della collezione accanto a Lista, Tabella, Card e Lavagna (Board).

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

Oppure registra il componente una sola volta e denominalo tramite chiave, operazione che lo rende selezionabile anche dall'editor della collezione:

```tsx
<RebaseCMS
    collections={collections}
    collectionViews={[{ key: "map", name: "Map", icon: "Map", Builder: MapView }]}
/>
```

```ts
admin: { customViews: ["map"] }
```

`Builder` riceve il `tableController` attivo, quindi la vista eredita i filtri della collezione, la casella di ricerca, l'ordinamento, la paginazione, i controlli dei permessi e il pannello laterale dell'entità — questo è il motivo principale per dichiararne una anziché creare una `AppView`:

```tsx
function MapView({ tableController, onEntityClick }: CollectionCustomViewParams) {
    return <MapCanvas
        markers={tableController.data.map(e => e.values.location)}
        onMarkerClick={i => onEntityClick?.(tableController.data[i])}
    />;
}
```

La selezione della vista aggiorna `?__view=`, persiste dopo il ricaricamento della pagina ed è memorizzata per singolo utente. Dichiararne una è sufficiente per renderla disponibile — `enabledViews` deve essere impostato solo quando si desidera *rimuovere le viste integrate*. In presenza di una singola voce, il selettore viene nascosto.

**Questo non è un modo per creare una vista che abbraccia più collezioni.** Una modalità di visualizzazione è una resa alternativa della query di una singola collezione. Se il tuo componente ignora `tableController` e recupera autonomamente quattro tabelle, dovrebbe essere una [`AppView`](/docs/frontend#custom-views) — la barra degli strumenti sopra di essa, con la relativa casella di ricerca e il conteggio dei record, descriverebbe una query che la vista non renderizza.

### `formView` {#formview}

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

Utilizzalo quando hai bisogno di un layout completamente personalizzato per l'esperienza di modifica delle entità di una specifica collezione. Per modifiche minori, è preferibile utilizzare `collection.components` con l'override di `Entity.Form`.

Il Builder viene renderizzato all'interno del form del record e riceve il suo `formContext` attivo: scrivi con `formContext.setFieldValue`, e il pulsante Salva nella barra salverà il record. Nei casi in cui il record non possa essere modificato — la vista di dettaglio in sola lettura, o un utente senza permessi di modifica — `formContext.disabled` è `true` e le scritture generano un errore. Imposta `includeActions: false` se il tuo Builder gestisce il salvataggio autonomamente tramite `formContext.submit()`.

### `additionalFields`

**Ambito:** collezione.

Colonne calcolate/virtuali visualizzate nella tabella della collezione. Queste non corrispondono a proprietà archiviate, ma vengono calcolate al momento del rendering.

→ [Colonne aggiuntive](/docs/frontend/additional-columns)

### `propertyConfigs`

**Ambito:** tipo di proprietà.

Widget di campo personalizzati per tipi di proprietà specifici, che forniscono campi di form e componenti di anteprima personalizzati.

→ [Campi personalizzati](/docs/frontend/custom-fields)

## Non il pannello di amministrazione

Se ciò che desideri modificare riguarda il comportamento del server anziché ciò che mostra il pannello, questa non è la pagina corretta. Il server ha una propria scaletta:

| Voglio… | Livello | Riferimento |
|---|---|---|
| Restringere le righe restituite da una lettura | callback `beforeQuery` <span class="since-badge" data-since="0.22">Da 0.22</span> | [Estendere il server](/docs/backend/extending#2-collection-callbacks) |
| Rimuovere/oscurare un valore in uscita | callback `afterRead` | [Callback](/docs/collections/callbacks) |
| Aggiungere un proprio endpoint | funzione personalizzata | [Funzioni personalizzate](/docs/backend/custom-functions) |
| Fare in modo che la ricerca trovi sottostringhe *e* ignori gli accenti | `search.mode: "hybrid"` <span class="since-badge" data-since="0.22">Da 0.22</span> | [Ricerca](/docs/backend/search) |
| Gestire direttamente il processo del server | server personalizzato, poi `rebase eject` | [Estendere il server](/docs/backend/extending) |

→ [Rebase doesn't do X](/docs/backend/extending)

## Riepilogo delle precedenze

- **`collection.components` ha la precedenza sui `components` globali** all'interno di quella collezione (semplice merge tramite spread in `DataCollectionView`).
- **Le `Actions` della collezione e lo slot `collection.actions` sono additivi** — le `Actions` vengono renderizzate per prime, seguite dai contributi dello slot.
- **`entityActions` ed `entityViews` a livello di collezione estendono (non sostituiscono) quelli globali.**
- **I contributi dei plugin vengono uniti in ordine di `key`.**
