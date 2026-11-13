---
sourceHash: b16bc057fd9a76c0
title: Komponenten-Overrides (Swizzling)
sidebar_label: Komponenten-Overrides
description: Standard-UI-Komponenten durch benutzerdefinierte Implementierungen auf Anwendungs- oder Collection-Ebene überschreiben.
---

## Übersicht

Rebase ermöglicht es Ihnen, Standard-UI-Komponenten durch eigene benutzerdefinierte Implementierungen zu überschreiben. Dies implementiert ein Swizzling-Modell für Komponenten im Docusaurus-Stil, das zwei Anpassungsmuster unterstützt:
- **Eject-Modus** (Standard): Ihre Komponente ersetzt die integrierte Komponente vollständig.
- **Wrap-Modus** (`wrap: true`): Ihre Komponente umhüllt das Original. Das, was sie umhüllt (in der Regel die integrierte Komponente), wird als `OriginalComponent`-Prop übergeben, sodass Sie es innerhalb Ihres benutzerdefinierten Layouts bzw. Ihrer benutzerdefinierten Logik rendern können.

Komponenten-Overrides können **global** auf Anwendungsebene (am `<Rebase>`-Provider) oder **lokal** auf Collection-Ebene (innerhalb einzelner Collection-Definitionen) angewendet werden.

---

## Globale Komponenten-Overrides

Um Komponenten global für Ihre gesamte Anwendung zu überschreiben, übergeben Sie ein `components`-Objekt an den Root-`<Rebase>`-Provider.

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

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Um Komponenten nur für eine einzelne Tabelle zu überschreiben, übergeben Sie `components` in deren
`customizeTable`. Dies ist nützlich für den leeren Zustand (Empty State), die Karten oder das Formular einer
bestimmten Tabelle. Jede `Component` ist die Komponente selbst, importiert nach Wert:
Die Datei wird nur im Browser ausgeführt.

```tsx
// frontend/src/cms/products.tsx
import { customizeTable } from "@rebasepro/cms";
import type { products } from "../../../backend/schema/products";
import { ProductCustomForm } from "../../../../../components/ProductCustomForm";
import { ProductsEmptyState } from "../../../../../components/ProductsEmptyState";

export const productsCms = customizeTable<typeof products>("products", {
    components: {
        // Replace: the product form is drawn by your component alone.
        "Entity.Form": { Component: ProductCustomForm },
        // Wrap: your component receives the original as `OriginalComponent`.
        "Collection.EmptyState": { Component: ProductsEmptyState, wrap: true },
    },
});
```

Eine umhüllende Komponente erhält das, was sie umhüllt, als `OriginalComponent`: die
integrierte Komponente, es sei denn, Ihre App überschreibt sie ebenfalls (siehe
[Wenn beide Gültigkeitsbereiche eine Komponente überschreiben](#wenn-beide-gültigkeitsbereiche-eine-komponente-überschreiben)):

```tsx
// frontend/src/components/ProductsEmptyState.tsx
import React from "react";

export function ProductsEmptyState({ OriginalComponent, ...props }: {
    OriginalComponent: React.ComponentType<Record<string, unknown>>
}) {
    return (
        <div className="empty-state-wrapper">
            <OriginalComponent {...props} />
            <a href="/docs/import">Import your first products</a>
        </div>
    );
}
```

Ein String-Pfad oder ein Lazy-`() => import(…)`-Thunk in `Component` löst beim Laden des
Moduls einen Fehler aus, zusammen mit dem Hinweis, was stattdessen zu schreiben ist.

### Wenn beide Gültigkeitsbereiche eine Komponente überschreiben

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Die beiden Gültigkeitsbereiche werden kombiniert. Der Override auf Anwendungsebene (`<Rebase components>`) wird zuerst auf die integrierte Komponente angewendet, und der Override der Tabelle (`components` in `customizeTable`) wird auf das Ergebnis angewendet:

| Anwendungsebene | Collection-Ebene | Was innerhalb dieser Collection gerendert wird |
|---|---|---|
| beliebig | keine | was überall sonst gerendert wird: der Override auf Anwendungsebene oder die integrierte Komponente |
| keine | wrap | der Wrapper der Collection um die integrierte Komponente |
| replace oder wrap | wrap | der Wrapper der Collection um den Override auf Anwendungsebene, übergeben als `OriginalComponent` |
| beliebig | replace | nur die Komponente der Collection; sie ersetzt beide |

Eine Collection kann also etwas um eine Komponente herum hinzufügen, die Ihre App bereits anpasst, ohne diese Anpassung zu verlieren. Um die Version auf Anwendungsebene für eine einzelne Collection zu verwerfen, verwenden Sie replace statt wrap.

---

## Gültigkeitsbereiche überschreibbarer Komponenten

### Komponenten mit App-Gültigkeitsbereich (`AppComponentName`)

Diese Komponenten können nur auf Ebene des Root-`<Rebase>`-Providers überschrieben werden, da sie die Struktur auf Shell-Ebene darstellen.

| Komponenten-Schlüssel | Beschreibung |
|---|---|
| `"Shell.AppBar"` | Die Kopfleiste oben auf der Seite |
| `"Shell.Drawer"` | Die einklappbare Haupt-Sidebar-Navigationsleiste (Drawer) |
| `"Shell.DrawerNavigationItem"` | Einzelne Links innerhalb der Sidebar |
| `"Shell.DrawerNavigationGroup"` | Einklappbare Navigationsgruppen-Header in der Sidebar |
| `"HomePage"` | Die Standard-Startseite im Inhaltsmodus |
| `"HomePage.CollectionCard"` | Einzelne Collection-Karten auf der Startseite |
| `"Auth.LoginView"` | Das Overlay, das bei Authentifizierungsanfragen angezeigt wird |

### Komponenten mit Collection-Gültigkeitsbereich (`CollectionComponentName`)

Diese Komponenten können global überschrieben werden (und fungieren als Standardwerte für alle Collections) oder für einzelne Collections.

| Komponenten-Schlüssel | Beschreibung |
|---|---|
| `"Collection.View"` | Die gesamte Landingpage der Collection |
| `"Collection.Table"` | Die standardmäßige tabellarische Tabellenblattansicht |
| `"Collection.Card"` | Der Element-Wrapper für die Kartenansicht |
| `"Collection.EmptyState"` | Ansicht, die angezeigt wird, wenn eine Collection leer ist |
| `"Collection.Actions"` | Toolbar-Schaltflächen über der Tabelle/den Karten |
| `"Collection.FilterField"` | Benutzerdefinierte Filtereingabe für eine Spalte |
| `"Entity.Form"` | Das Detailformular zum Erstellen/Aktualisieren |
| `"EditView.FormActions"` | Buttonleiste zum Absenden/Abbrechen des Formulars |
| `"DetailView"` | Schreibgeschützte Detailansicht |
| `"Entity.SidePanel"` | Der Seitenbereich-Container (Side Panel) für Formular/Details |
| `"EntityPreview"` | Inline-Vorschau für Referenzen/Relationen (Chip) |
| `"Entity.MissingReference"` | Wird gerendert, wenn eine referenzierte Entität fehlt |

:::note[Drei Schlüssel weichen vom `Entity.`-Muster ab]
`"DetailView"`, `"EntityPreview"` und `"EditView.FormActions"` besitzen kein `Entity.`-Präfix.
`"Entity.DetailView"`, `"Entity.Preview"` und `"Entity.FormActions"` sind nicht in der Union
enthalten — sie führen zu einem Typfehler, und in reinem JavaScript wird der Override schlicht
niemals angewendet.
:::

Ihre Ersatzkomponente erhält dieselben Props, die der integrierten Komponente übergeben wurden. Die
Override-Map gibt nicht für jeden Schlüssel einen Props-Typ vor — `ComponentOverride<P>` setzt
standardmäßig `P` auf `Record<string, unknown>` — typisieren Sie den Parameter also selbst oder
übergeben Sie ein Typargument, wenn die Props typüberprüft werden sollen. Einige der integrierten
Komponenten exportieren einen Props-Typ, den Sie importieren und wiederverwenden können:
`CollectionViewProps` (`@rebasepro/ui`); `CollectionEmptyStateProps`, `CollectionActionsProps`,
`SidePanelBindingProps` und `FilterFieldBindingProps` (`@rebasepro/cms-types`); `EntityFormProps`,
`EntityFormBindingProps`, `EntityFormActionsProps`, `CollectionTableBindingProps`,
`DetailViewBindingProps`, `DrawerNavigationItemProps` und `DrawerNavigationGroupProps`
(`@rebasepro/cms`); `LoginViewProps` (`@rebasepro/app`). Für die übrigen Komponenten gibt es keinen
exportierten Props-Typ — definieren Sie die Struktur (Shape), die Sie tatsächlich auslesen.

### Was ein `Collection.View`-Override berücksichtigen muss

`Collection.View` ist das, was ein `CollectionPanel` zeichnet, sodass die Props des Panels Ihren
Override als `CollectionViewBindingProps` (`@rebasepro/cms`) erreichen, verteilt (spread) über die
collectionspezifischen Props. Ein Ersatz, der diese ignoriert, beschädigt jede Seite, die die
Collection einbettet. Berücksichtigen Sie mindestens folgende Props:

| Prop | Was der Aufrufer erwartet |
|---|---|
| `collectionOverrides` | Was der Aufrufer an der Collection ändert (ein fester Filter, eine Sortierung, der Ansichtsmodus), angewendet auf die registrierte Collection |
| `fields` | Nur diese Eigenschaften in dieser Reihenfolge: die Spalten und die Daten, aus denen Listenzeilen und Karten befüllt werden |
| `highlightedIds` | Die IDs der Zeilen, die als ausgewählt dargestellt werden; `[]` für keine |
| `onRowClick` | Wird mit der angeklickten Zeile (wie vom Server gesendet) und deren ID aufgerufen, anstatt sie zu öffnen. Das panel-eigene `onRowClick` |

Das Panel übergibt außerdem `viewMode` (den Modus, in dem geöffnet werden soll), `toolbar` (die
anzuzeigende Toolbar, `null` für keine) und `title` (`false`, um keinen Titel anzuzeigen), sofern vom
Aufrufer gesetzt. Die integrierte `CollectionViewBinding` verarbeitet alle davon; ein Override, der sie
umhüllt, anstatt sie zu ersetzen, kann sie direkt durchreichen.

Um auf dem integrierten Baustein aufzubauen, anstatt bei null anzufangen, kopieren Sie dessen Quellcode
in Ihr Projekt und registrieren Sie die Kopie hier: Bis auf `Collection.View`, `DetailView` und das
Drag-and-Drop der Startseite kompiliert jeder Baustein mit Paket-Imports. Siehe
[Kopieren eines integrierten Teils](/docs/frontend/customizing#copying-a-built-in-part).

## Verwandte Themen

- [Rebase erweitern](/docs/frontend/extending/) — die Erweiterungspunkte, die keinen Override erfordern
- [Benutzerdefinierte Felder](/docs/frontend/custom-fields/) — das Ersetzen des Editors einer einzelnen Eigenschaft anstelle einer Komponente
- [Slots](/docs/frontend/slots/) — das Ergänzen einer Komponente anstelle ihres Ersetzens
