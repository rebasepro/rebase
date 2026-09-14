---
sourceHash: 387b83637f6dc883
title: Estendere Rebase
sidebar_label: Estendere Rebase
description: Una guida alle decisioni per scegliere il giusto meccanismo di estensione — plugin, slot, override di componenti, viste di entità, azioni e altro ancora.
---

## Panoramica

Rebase offre circa una dozzina di meccanismi di estensione: plugin, slot, override di componenti, viste di entità, azioni, campi personalizzati e altro ancora. Ognuno di essi si rivolge a un ambito diverso (a livello di app, per collezione, per entità, per proprietà) e a una parte diversa dell'interfaccia utente.

Questa guida ti aiuta a scegliere il meccanismo giusto per il tuo caso d'uso, rimandando poi alla documentazione di riferimento dettagliata per ciascuno.

## Tabella delle decisioni

| Voglio… | Meccanismo | Ambito | Riferimento |
|---|---|---|---|
| Sostituire l'app bar | `components` (`Shell.AppBar`) | app | [Override dei componenti](/docs/frontend/component-overrides) |
| Sostituire la pagina di login | `components` (`Auth.LoginView`) | app | [Override dei componenti](/docs/frontend/component-overrides) |
| Sostituire la home page | `components` (`HomePage`) | app | [Override dei componenti](/docs/frontend/component-overrides) |
| Modificare completamente l'aspetto del form di una collezione | `formView` | collezione | [sotto](#formview) |
| Sostituire un componente all'interno di una collezione | `collection.components` | collezione | [Override dei componenti](/docs/frontend/component-overrides) |
| Impostare gli override dei componenti predefiniti per tutte le collezioni | `components` (nomi con ambito collezione) | app | [Override dei componenti](/docs/frontend/component-overrides) |
| Aggiungere un pulsante alla barra degli strumenti della collezione | `Actions` della collezione | collezione | [Azioni delle entità](/docs/frontend/entity-actions#collection-actions) |
| Iniettare UI in uno slot della barra degli strumenti della collezione | slot `collection.actions` | app/plugin | [Slot](/docs/frontend/slots) |
| Aggiungere una colonna calcolata a una tabella | `additionalFields` | collezione | [Colonne aggiuntive](/docs/frontend/additional-columns) |
| Aggiungere un widget di campo personalizzato per un tipo di proprietà | `propertyConfigs` | tipo di proprietà | [Campi personalizzati](/docs/frontend/custom-fields) |
| Aggiungere una scheda entità | `entityViews` | entità | [Viste entità](/docs/frontend/entity-views) |
| Renderizzare le righe di una collezione in modo diverso | `admin.customViews` | collezione | [sotto](#customviews) |
| Aggiungere un'azione contestuale/di riga o un pulsante di entità | `entityActions` | entità | [Azioni delle entità](/docs/frontend/entity-actions) |
| Inserire un dato nella scheda della home page di una collezione | slot `home.card.widget` | app/plugin | [Slot](/docs/frontend/slots) |
| Iniettare UI in una posizione specifica dell'interfaccia | `slots` | app/plugin | [Slot](/docs/frontend/slots) |
| Distribuire diverse estensioni come un'unica unità installabile | `plugins` | app | [Plugin](/docs/plugins) |
| Stilizzare ciò che ho appena creato | `@rebasepro/ui` + token del tema | qualsiasi | [Stilizzazione della UI personalizzata](/docs/frontend/styling) |

:::tip[Qualunque cosa tu scelga, costruiscila usando il kit]
Ogni meccanismo descritto di seguito ti fornisce un componente React senza specificare con cosa riempirlo. Usa i componenti di `@rebasepro/ui` e i token di colore del tema invece di scrivere CSS personalizzato: una vista personalizzata è pur sempre una vista di amministrazione, e un colore hardcoded risulterà invisibile in uno dei due temi. Consulta [Stilizzazione della UI personalizzata](/docs/frontend/styling).
:::

## I meccanismi in dettaglio

### Plugin

**Ambito:** app.

Un plugin raggruppa collezioni, viste, override di componenti, contributi a slot, autenticazione, origini dati, provider, hook e callback del ciclo di vita in un'unica unità installabile. Tutti gli altri meccanismi elencati qui possono essere forniti tramite l'interfaccia di un plugin.

→ [Riferimento per i plugin](/docs/plugins)

### Slot

**Ambito:** app (forniti per slot).

Gli slot sono punti di estensione dell'interfaccia utente con nome distribuiti all'interno della struttura del CMS. Registrando un componente React associato al nome di uno slot, questo verrà renderizzato in quella posizione. Ci sono 29 slot che coprono la home page, la navigazione, le viste di collezione, i form, le righe delle entità, le dashboard e altro ancora.

→ [Riferimento per gli slot](/docs/frontend/slots)

### Override dei componenti (Swizzling)

**Ambito:** predefiniti a livello di app o per collezione.

Due modalità: **Eject** (sostituzione completa) o **Wrap** (arricchimento dell'originale).

19 nomi di componenti sovrascrivibili suddivisi in due livelli:

**Solo a livello di app (7):**
- `Shell.AppBar`
- `Shell.Drawer`
- `Shell.DrawerNavigationItem`
- `Shell.DrawerNavigationGroup`
- `HomePage`
- `HomePage.CollectionCard`
- `Auth.LoginView`

**Con ambito a livello di collezione (12):**
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

**Precedenza:** I `components` a livello di collezione sovrascrivono i valori predefiniti a livello di app per lo stesso nome di componente (un semplice object spread: i valori della collezione sovrascrivono i valori globali). I nomi dei componenti solo per app (`Shell.*`, `HomePage`, `Auth.*`) possono essere sovrascritti solo a livello di `<Rebase>`.

→ [Override dei componenti](/docs/frontend/component-overrides)

### Viste entità

**Ambito:** entità (aggiunge schede).

Viste personalizzate che appaiono come schede nella pagina di dettaglio dell'entità. Possono essere definite a livello globale su `<Rebase>` o per collezione.

→ [Viste entità](/docs/frontend/entity-views)

### Azioni delle entità

**Ambito:** entità.

Pulsanti di azione personalizzati sulle singole entità (pubblica, archivia, clona, ecc.). Possono essere definiti a livello globale o per collezione.

→ [Azioni delle entità](/docs/frontend/entity-actions)

### `Actions` di collezione

**Ambito:** collezione.

Componenti React a livello di barra degli strumenti che ricevono `CollectionActionsProps` (entità selezionate, controller della tabella, contesto della collezione). Vengono renderizzati nella barra degli strumenti della collezione insieme alle azioni integrate.

**Relazione con lo slot `collection.actions`:** Entrambi sono additivi: i componenti `Actions` vengono renderizzati per primi nella barra degli strumenti, seguiti dai contributi dello slot `collection.actions`. Non si sostituiscono a vicenda.

→ [Azioni delle entità — Azioni di collezione](/docs/frontend/entity-actions#collection-actions)

### Modalità di visualizzazione personalizzate {#customviews}

**Ambito:** collezione (aggiunge una modalità di visualizzazione).

Una mappa, un calendario, una galleria, una cronologia: un'altra rappresentazione delle *stesse righe*, offerta nel selettore di viste della collezione accanto a Lista, Tabella, Schede e Lavagna.

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

Oppure registra il componente una sola volta e identificalo tramite chiave, cosa che lo rende selezionabile anche dall'editor della collezione:

```tsx
<RebaseCMS
    collections={collections}
    collectionViews={[{ key: "map", name: "Map", icon: "Map", Builder: MapView }]}
/>
```

```ts
admin: { customViews: ["map"] }
```

`Builder` riceve il `tableController` attivo, quindi la vista eredita i filtri della collezione, la casella di ricerca, l'ordinamento, la paginazione, i controlli dei permessi e il pannello laterale dell'entità: questo è il motivo principale per dichiararne una invece di creare una `AppView`:

```tsx
function MapView({ tableController, onEntityClick }: CollectionCustomViewParams) {
    return <MapCanvas
        markers={tableController.data.map(e => e.values.location)}
        onMarkerClick={i => onEntityClick?.(tableController.data[i])}
    />;
}
```

La selezione della vista aggiorna `?__view=`, sopravvive alla ricarica della pagina e persiste per singolo utente. Dichiararne una è sufficiente per renderla disponibile: `enabledViews` deve essere configurato solo quando desideri *rimuovere le viste integrate*. In presenza di una sola voce, il selettore viene nascosto.

**Questo non è un modo per creare una vista che abbraccia più collezioni.** Una modalità di visualizzazione è un'altra rappresentazione della query di una singola collezione. Se il tuo componente ignora `tableController` e recupera quattro tabelle per conto proprio, allora dovrebbe essere una [`AppView`](/docs/frontend#custom-views): la barra degli strumenti sovrastante, con la casella di ricerca e il conteggio dei record, descriverebbe una query che il componente non esegue.

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

Da utilizzare quando hai bisogno di un layout completamente personalizzato per l'esperienza di modifica delle entità di una collezione. Per modifiche minori, è preferibile utilizzare `collection.components` con l'override di `Entity.Form`.

Il Builder viene renderizzato all'interno del form del record e riceve il relativo `formContext` attivo: scrivi con `formContext.setFieldValue`, e il pulsante Salva nella barra salverà il record. Nei casi in cui il record non può essere modificato (la vista di dettaglio in sola lettura, o un utente senza permessi di modifica), `formContext.disabled` è `true` e i tentativi di scrittura generano un errore. Imposta `includeActions: false` se il tuo Builder gestisce il salvataggio autonomamente tramite `formContext.submit()`.

### `additionalFields`

**Ambito:** collezione.

Colonne calcolate/virtuali visualizzate nella tabella della collezione. Queste non corrispondono a proprietà memorizzate, ma vengono calcolate al momento del rendering.

→ [Colonne aggiuntive](/docs/frontend/additional-columns)

### `propertyConfigs`

**Ambito:** tipo di proprietà.

Widget di campo personalizzati per tipi di proprietà specifici, che forniscono campi di form e componenti di anteprima personalizzati.

→ [Campi personalizzati](/docs/frontend/custom-fields)

## Riepilogo delle precedenze

- **`collection.components` ha la precedenza sui `components` globali** all'interno di quella collezione (semplice unione tramite spread in `DataCollectionView`).
- **Le `Actions` di collezione e lo slot `collection.actions` sono additivi**: le `Actions` vengono renderizzate per prime, seguite dai contributi dello slot.
- **`entityActions` ed `entityViews` a livello di collezione estendono (non sostituiscono) quelle globali.**
- **I contributi dei plugin vengono uniti in base all'ordine di `key`.**
