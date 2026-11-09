---
sourceHash: 950f7cd092f53f01
title: Komponenten-Overrides (Swizzling)
sidebar_label: Komponenten-Overrides
description: Überschreiben Sie Standard-UI-Komponenten mit benutzerdefinierten Implementierungen auf Anwendungs- oder Collection-Ebene.
---

## Übersicht

Rebase ermöglicht es Ihnen, Standard-UI-Komponenten durch eigene benutzerdefinierte Implementierungen zu überschreiben. Dies implementiert ein Swizzling-Modell für Komponenten im Docusaurus-Stil, das zwei Anpassungsmuster unterstützt:
- **Eject-Modus** (Standard): Ihre Komponente ersetzt die integrierte Komponente vollständig.
- **Wrap-Modus** (`wrap: true`): Ihre Komponente kapselt (wrappt) das Original. Was sie umschließt (normalerweise die integrierte Komponente), wird als `OriginalComponent`-Prop übergeben, sodass Sie sie innerhalb Ihres benutzerdefinierten Layouts bzw. Ihrer Logik rendern können.

Komponenten-Overrides können **global** auf Anwendungsebene (am `<Rebase>`-Provider) oder **lokal** auf Collection-Ebene (innerhalb einzelner Collection-Definitionen) angewendet werden.

---

## Globale Komponenten-Overrides

Um Komponenten global über Ihre gesamte Anwendung hinweg zu überschreiben, übergeben Sie ein `components`-Objekt an den Root-`<Rebase>`-Provider.

```tsx
import { Rebase } from "@rebasepro/app";
import { MyAppBar } from "./components/MyAppBar";

function App() {
    return (
        <Rebase
            client={rebaseClient}
            components={{
                // Eject Mode: Replace the default AppBar entirely
                "Shell.AppBar": { Component: MyAppBar },

                // Wrap Mode: Wrap the login view to insert branding
                "Auth.LoginView": {
                    // `OriginalComponent` is injected at runtime when `wrap: true`; the override
                    // slot's type does not model it, hence the annotation.
                    Component: (({ OriginalComponent, ...props }: {
                        OriginalComponent: React.ComponentType<Record<string, unknown>>
                    }) => (
                        <div className="login-branding-container">
                            <header className="branding-header">My Custom Brand</header>
                            <OriginalComponent {...props} />
                        </div>
                    )) as unknown as React.ComponentType<Record<string, unknown>>,
                    wrap: true
                }
            }}
        >
            {/* your app */}
            …
        </Rebase>
    );
}
```

---

## Komponenten-Overrides auf Collection-Ebene

Um Komponenten nur für eine bestimmte Collection zu überschreiben, fügen Sie ein `components`-Objekt unterhalb des `admin`-Blocks hinzu. Dies ist nützlich, um leere Zustände (Empty States), Karten oder Detailansichten für bestimmte Modelle anzupassen.

Im Standard-Scaffold wird `config/collections/` von **sowohl** dem Admin-Panel als auch dem Backend geladen, welches dieselben Dateien liest, um das Schema und die API abzuleiten. Verweisen Sie daher auf jede Komponente per **Modulpfad**, anstatt sie zu importieren. `Component` akzeptiert dieselben Formen wie `admin.Field` und `entityViews[].Builder`: einen Pfad, einen Lazy-`import()` oder die Komponente selbst.

```ts
// config/collections/products.ts
import { defineCollection } from "@rebasepro/cms-types";

export const productsCollection = defineCollection({
    name: "Products",
    slug: "products",
    table: "products",
    properties: { /* ... */ },
    admin: {
        components: {
            // Eject Mode: Replace the default entity form view
            "Entity.Form": { Component: "../../frontend/src/ProductCustomForm" },

            // Wrap Mode: Wrap the empty state to add quick links
            "Collection.EmptyState": {
                Component: "../../frontend/src/ProductsEmptyState",
                wrap: true
            }
        }
    }
});
```

Die umschließende Komponente (Wrapper-Komponente) befindet sich zusammen mit dem Rest Ihres Frontend-Codes und erhält das, was sie umschließt, als `OriginalComponent` – die integrierte Komponente, es sei denn, Ihre App überschreibt sie ebenfalls (siehe [Wenn beide Scopes eine Komponente überschreiben](#wenn-beide-scopes-eine-komponente-überschreiben)):

```tsx
// frontend/src/ProductsEmptyState.tsx
import type React from "react";

export default function ProductsEmptyState({ OriginalComponent, ...props }: {
    OriginalComponent: React.ComponentType<Record<string, unknown>>
}) {
    return (
        <div className="empty-state-wrapper">
            <OriginalComponent {...props} />
            <button onClick={() => importDemoProducts()}>
                Load Demo Products
            </button>
        </div>
    );
}
```

Jedes Modul benötigt einen **Standardexport** (`default export`). Das Vite-Plugin für Collections schreibt einen Pfad in einen Lazy-Import um, sodass die Komponente einen eigenen Chunk bildet und beim ersten Rendern des Overrides geladen wird. Dieses Umschreiben deckt die Dateien innerhalb des konfigurierten `collectionsDir` ab. Ein Pfad in einer Datei außerhalb davon erreicht den Admin als reiner String: Die Konsole weist darauf hin, und die integrierte Komponente wird an ihrer Stelle gerendert. Schreiben Sie außerhalb von `collectionsDir` den Lazy-Import selbst: `Component: () => import("../../frontend/src/ProductCustomForm")`.

Eine direkte Referenz (`Component: ProductCustomForm`) funktioniert ebenfalls, jedoch nur in einer Collection-Datei, die vom Server nicht geladen wird, da der Import der Komponente auch React und alles, was es nach sich zieht, importiert.

### Wenn beide Scopes eine Komponente überschreiben

Die beiden Scopes lassen sich kombinieren. Der Override auf Anwendungsebene (`<Rebase components>`) wird zuerst auf die integrierte Komponente angewendet, und der Override der Collection (`admin.components`) wird auf das Ergebnis angewendet:

| Anwendungsebene | Collection-Ebene | Was innerhalb dieser Collection gerendert wird |
|---|---|---|
| beliebig | keine | was überall sonst gerendert wird: der Override auf Anwendungsebene oder die integrierte Komponente |
| keine | wrap | der Wrapper der Collection um die integrierte Komponente |
| replace oder wrap | wrap | der Wrapper der Collection um den Override auf Anwendungsebene, übergeben als `OriginalComponent` |
| beliebig | replace | nur die Komponente der Collection; sie ersetzt beide |

Eine Collection kann somit eine Komponente umschließen, die Ihre App bereits anpasst, ohne dass diese Anpassung verloren geht. Um die Version auf Anwendungsebene für eine bestimmte Collection zu verwerfen, verwenden Sie replace anstelle von wrapping.

---

## Scopes überschreibbarer Komponenten

### Komponenten mit App-Scope (`AppComponentName`)

Diese Komponenten können nur auf Ebene des Root-`<Rebase>`-Providers überschrieben werden, da sie die Struktur auf Shell-Ebene darstellen.

| Komponenten-Schlüssel | Beschreibung |
|---|---|
| `"Shell.AppBar"` | Die Kopfzeile (Header-Leiste) oben auf der Seite |
| `"Shell.Drawer"` | Die einklappbare Haupt-Sidebar-Navigationsleiste (Drawer) |
| `"Shell.DrawerNavigationItem"` | Einzelne Links innerhalb der Sidebar |
| `"Shell.DrawerNavigationGroup"` | Einklappbare Navigationsgruppen-Überschriften in der Sidebar |
| `"HomePage"` | Die Standard-Landingpage im Content-Modus |
| `"HomePage.CollectionCard"` | Einzelne Collection-Karten auf der Startseite |
| `"Auth.LoginView"` | Das Overlay, das bei einer Authentifizierungsanforderung angezeigt wird |

### Komponenten mit Collection-Scope (`CollectionComponentName`)

Diese Komponenten können global überschrieben werden (und fungieren als Standardwerte für alle Collections) oder auf Ebene einzelner Collections.

| Komponenten-Schlüssel | Beschreibung |
|---|---|
| `"Collection.View"` | Die gesamte Collection-Landingpage |
| `"Collection.Table"` | Die standardmäßige tabellarische Tabellenkalkulationsansicht |
| `"Collection.Card"` | Der Item-Wrapper der Kartenansicht |
| `"Collection.EmptyState"` | Ansicht, die angezeigt wird, wenn eine Collection leer ist |
| `"Collection.Actions"` | Toolbar-Buttons über der Tabelle/den Karten |
| `"Collection.FilterField"` | Benutzerdefinierte Filtereingabe für eine Spalte |
| `"Entity.Form"` | Das Detailformular zum Erstellen/Aktualisieren |
| `"EditView.FormActions"` | Button-Leiste zum Absenden/Abbrechen des Formulars |
| `"DetailView"` | Schreibgeschützte Detailansicht |
| `"Entity.SidePanel"` | Der Seitenpanel-Container für Formular/Detail |
| `"EntityPreview"` | Inline-Chip-Vorschau für Referenzen/Relationen |
| `"Entity.MissingReference"` | Wird gerendert, wenn eine referenzierte Entität fehlt |

:::note[Drei Schlüssel weichen vom `Entity.`-Muster ab]
`"DetailView"`, `"EntityPreview"` und `"EditView.FormActions"` besitzen kein `Entity.`-Präfix.
`"Entity.DetailView"`, `"Entity.Preview"` und `"Entity.FormActions"` sind
nicht in der Union enthalten – sie führen zu Typfehlern, und in reinem JavaScript wird der Override
schlichtweg nie angewendet.
:::

Ihr Ersatz erhält dieselben Props, die der integrierten Komponente übergeben wurden. Die
Override-Map benennt keinen Props-Typ pro Schlüssel – `ComponentOverride<P>` setzt für
`P` standardmäßig `Record<string, unknown>` ein – typisieren Sie den Parameter daher selbst
oder übergeben Sie ein Typargument, wenn die Props typgeprüft werden sollen. Einige der integrierten
Komponenten exportieren jedoch einen Props-Typ, den Sie importieren und wiederverwenden können:
`CollectionViewProps` (`@rebasepro/ui`); `CollectionEmptyStateProps`, `CollectionActionsProps`,
`SidePanelBindingProps` und `FilterFieldBindingProps` (`@rebasepro/cms-types`); `EntityFormProps`,
`EntityFormBindingProps`, `EntityFormActionsProps`, `CollectionTableBindingProps`,
`DetailViewBindingProps`, `DrawerNavigationItemProps` und `DrawerNavigationGroupProps` (`@rebasepro/cms`);
`LoginViewProps` (`@rebasepro/app`). Die übrigen besitzen keinen exportierten Props-Typ – definieren
Sie die Typstruktur so, wie Sie sie tatsächlich auslesen.

### Was ein `Collection.View`-Override berücksichtigen muss

`Collection.View` ist das, was ein `CollectionPanel` zeichnet, sodass die Props des Panels
Ihren Override als `CollectionViewBindingProps` (`@rebasepro/cms`) erreichen, verteilt über
die eigenen Props der Collection. Ein Ersatz, der diese ignoriert, beschädigt jede Seite,
die die Collection einbettet. Berücksichtigen Sie mindestens folgende:

| Prop | Was der Aufrufer erwartet |
|---|---|
| `collectionOverrides` | Was der Aufrufer an der Collection ändert (ein fester Filter, eine Sortierung, der Ansichtsmodus), angewendet auf die registrierte Collection |
| `fields` | Nur diese Eigenschaften in dieser Reihenfolge: die Spalten und woraus Listenzeilen und Karten befüllt werden |
| `highlightedIds` | Die IDs der Zeilen, die als ausgewählt dargestellt werden; `[]` für keine |
| `onRowClick` | Wird mit der angeklickten Zeile (wie vom Server gesendet) und deren ID aufgerufen, anstatt sie zu öffnen. Das panel-eigene `onRowClick` |

Das Panel übergibt außerdem `viewMode` (der Modus, in dem geöffnet werden soll), `toolbar`
(die zu rendernde Toolbar, `null` für keine) und `title` (`false`, um keinen Titel darzustellen),
sofern der Aufrufer diese gesetzt hat. Das integrierte `CollectionViewBinding` verarbeitet alle
davon; ein Override, der es umschließt (wrappt), anstatt es zu ersetzen, kann sie direkt durchreichen.

Um mit dem integrierten Teil zu beginnen, anstatt bei null anzufangen, kopieren Sie dessen
Quellcode in Ihr Projekt und registrieren Sie die Kopie hier: Jeder Teil außer `Collection.View`,
`DetailView` und dem Drag-and-Drop der Startseite kompiliert mit Paket-Imports.
Siehe [Kopieren eines integrierten Teils](/docs/frontend/customizing#copying-a-built-in-part).

## Verwandte Themen

- [Rebase erweitern](/docs/frontend/extending/) — die Erweiterungspunkte, die keinen Override erfordern
- [Benutzerdefinierte Felder](/docs/frontend/custom-fields/) — Ersetzen des Editors einer einzelnen Eigenschaft statt einer ganzen Komponente
- [Slots](/docs/frontend/slots/) — Erweitern einer Komponente, anstatt sie zu ersetzen
