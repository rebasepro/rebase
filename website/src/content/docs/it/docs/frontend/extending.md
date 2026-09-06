---
sourceHash: 5de2aebf9af99221
title: Estendere Rebase
sidebar_label: Estendere Rebase
description: Una guida decisionale per scegliere il giusto meccanismo di estensione — plugin, slot, sovrascritture dei componenti, viste entità, azioni e altro.
---

## Panoramica

Rebase offre circa una dozzina di meccanismi di estensione — plugin, slot, sovrascritture dei componenti, viste entità, azioni, campi personalizzati e altro. Ognuno mira a un ambito diverso (a livello di app, per collezione, per entità, per proprietà) e a una parte diversa dell'UI.

Questa guida ti aiuta a scegliere il meccanismo giusto per il tuo caso d'uso, poi collega al riferimento dettagliato di ciascuno.

## Tabella Decisionale

| Voglio… | Meccanismo | Ambito | Riferimento |
|---|---|---|---|
| Sostituire la barra dell'app | `components` (`Shell.AppBar`) | app | [Sovrascrittura dei Componenti](/docs/frontend/component-overrides) |
| Sostituire la pagina di login | `components` (`Auth.LoginView`) | app | [Sovrascrittura dei Componenti](/docs/frontend/component-overrides) |
| Sostituire la home page | `components` (`HomePage`) | app | [Sovrascrittura dei Componenti](/docs/frontend/component-overrides) |
| Cambiare completamente l'aspetto del modulo di una collezione | `formView` | collezione | [sotto](#formview) |
| Scambiare un componente all'interno di una collezione | `collection.components` | collezione | [Sovrascrittura dei Componenti](/docs/frontend/component-overrides) |
| Impostare sovrascritture di componenti predefinite per tutte le collezioni | `components` (nomi con ambito collezione) | app | [Sovrascrittura dei Componenti](/docs/frontend/component-overrides) |
| Aggiungere un pulsante alla toolbar della collezione | `Actions` di collezione | collezione | [Azioni Entità](/docs/frontend/entity-actions#collection-actions) |
| Iniettare UI in uno slot della toolbar della collezione | slot `collection.actions` | app/plugin | [Slot](/docs/frontend/slots) |
| Aggiungere una colonna calcolata a una tabella | `additionalFields` | collezione | [Colonne Aggiuntive](/docs/frontend/additional-columns) |
| Aggiungere un widget di campo personalizzato per un tipo di proprietà | `propertyConfigs` | tipo di proprietà | [Campi Personalizzati](/docs/frontend/custom-fields) |
| Aggiungere una scheda entità | `entityViews` | entità | [Viste Entità](/docs/frontend/entity-views) |
| Aggiungere un'azione di riga/contesto o un pulsante entità | `entityActions` | entità | [Azioni Entità](/docs/frontend/entity-actions) |
| Iniettare UI in una posizione specifica del chrome | `slots` | app/plugin | [Slot](/docs/frontend/slots) |
| Distribuire più estensioni come una singola unità installabile | `plugins` | app | [Plugin](/docs/plugins) |

## Meccanismi in Dettaglio

### Plugin

**Ambito:** app.

Un plugin raggruppa collezioni, viste, sovrascritture dei componenti, contributi di slot, autenticazione, sorgenti dati, provider, hook e callback del ciclo di vita in una singola unità installabile. Tutti gli altri meccanismi elencati qui possono essere contribuiti tramite l'interfaccia di un plugin.

→ [Riferimento Plugin](/docs/plugins)

### Slot

**Ambito:** app (contribuito per slot).

Gli slot sono punti di estensione UI con nome distribuiti in tutto il chrome del CMS. Registri un componente React che punta al nome di uno slot, e viene renderizzato in quella posizione. Ci sono 29 slot che coprono la home page, la navigazione, le viste di collezione, i moduli, le righe entità, le dashboard e altro.

→ [Riferimento Slot](/docs/frontend/slots)

### Sovrascrittura dei Componenti (Swizzling)

**Ambito:** predefiniti a livello di app o per collezione.

Due modalità: **Eject** (sostituzione completa) o **Wrap** (aumentare l'originale).

19 nomi di componenti sovrascrivibili in due livelli:

**Solo app (7):**
- `Shell.AppBar`
- `Shell.Drawer`
- `Shell.DrawerNavigationItem`
- `Shell.DrawerNavigationGroup`
- `HomePage`
- `HomePage.CollectionCard`
- `Auth.LoginView`

**Ambito collezione (12):**
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

**Precedenza:** I `components` a livello di collezione sovrascrivono i predefiniti a livello di app per lo stesso nome di componente (spread di oggetti semplice — i valori della collezione sovrascrivono i valori globali). I nomi di componenti solo-app (`Shell.*`, `HomePage`, `Auth.*`) possono essere sovrascritti solo a livello di `<Rebase>`.

→ [Sovrascrittura dei Componenti](/docs/frontend/component-overrides)

### Viste Entità

**Ambito:** entità (aggiunge schede).

Viste personalizzate che appaiono come schede nella pagina di dettaglio dell'entità. Possono essere definite globalmente su `<Rebase>` o per collezione.

→ [Viste Entità](/docs/frontend/entity-views)

### Azioni Entità

**Ambito:** entità.

Pulsanti di azione personalizzati su singole entità (pubblica, archivia, clona, ecc.). Possono essere definiti globalmente o per collezione.

→ [Azioni Entità](/docs/frontend/entity-actions)

### `Actions` di Collezione

**Ambito:** collezione.

Componenti React a livello di toolbar che ricevono `CollectionActionsProps` (entità selezionate, controller della tabella, contesto della collezione). Renderizzati nella toolbar della collezione insieme alle azioni integrate.

**Relazione con lo slot `collection.actions`:** Entrambi sono additivi — i componenti `Actions` vengono renderizzati per primi nella toolbar, poi i contributi di slot da `collection.actions`. Non si sostituiscono a vicenda.

→ [Azioni Entità — Azioni di Collezione](/docs/frontend/entity-actions#collection-actions)

### `formView` {#formview}

**Ambito:** collezione.

Sostituisce l'intero modulo entità predefinito con un componente personalizzato. Impostato su una definizione di collezione:

```typescript
const collection = {
    slug: "products",
    admin: {
        formView: {
            Builder: MyCustomProductForm,
            includeActions: true  // show save/delete bar (default: true)
        }
    }
};

```

Usalo quando hai bisogno di un layout completamente personalizzato per l'esperienza di modifica delle entità di una collezione. Per modifiche più piccole, preferisci invece `collection.components` con la sovrascrittura `Entity.Form`.

### `additionalFields`

**Ambito:** collezione.

Colonne calcolate/virtuali visualizzate nella tabella della collezione. Queste non corrispondono a proprietà archiviate — vengono calcolate al momento del rendering.

→ [Colonne Aggiuntive](/docs/frontend/additional-columns)

### `propertyConfigs`

**Ambito:** tipo di proprietà.

Widget di campo personalizzati per tipi di proprietà specifici, che forniscono campi modulo e componenti di anteprima personalizzati.

→ [Campi Personalizzati](/docs/frontend/custom-fields)

## Riepilogo della Precedenza

- **`collection.components` prevale sui `components` globali** all'interno di quella collezione (fusione spread semplice in `DataCollectionView`).
- **Le `Actions` di collezione e lo slot `collection.actions` sono additivi** — le `Actions` vengono renderizzate per prime, poi i contributi di slot.
- **Gli `entityActions` ed `entityViews` a livello di collezione estendono (non sostituiscono) quelli globali.**
- **I contributi dei plugin vengono uniti in ordine di `key`.**
