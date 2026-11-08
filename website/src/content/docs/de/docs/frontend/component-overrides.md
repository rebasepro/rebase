---
sourceHash: f17c7d88a5f91dd1
title: Komponenten-Overrides (Swizzling)
sidebar_label: Komponenten-Overrides
description: Überschreiben Sie Standard-UI-Komponenten mit benutzerdefinierten Implementierungen auf Anwendungs- oder Collection-Ebene.
---

## Übersicht

Mit Rebase können Sie Standard-UI-Komponenten durch eigene benutzerdefinierte Implementierungen überschreiben. Dies implementiert ein Komponenten-Swizzling-Modell im Docusaurus-Stil, das zwei Anpassungsmuster unterstützt:
- **Eject-Modus** (Standard): Ihre Komponente ersetzt die integrierte Komponente vollständig.
- **Wrap-Modus** (`wrap: true`): Ihre Komponente umschließt das Original. Das, was sie umschließt (üblicherweise die integrierte Komponente), wird als `OriginalComponent`-Prop übergeben, sodass Sie es innerhalb Ihres benutzerdefinierten Layouts bzw. Ihrer benutzerdefinierten Logik rendern können.

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

Um Komponenten nur für eine bestimmte Collection zu überschreiben, fügen Sie ein `components`-Objekt unter deren `admin`-Block hinzu. Dies ist nützlich, um Empty States, Cards oder Detailansichten für bestimmte Modelle anzupassen.

Im Standard-Scaffold wird `config/collections/` **sowohl** vom Admin-Panel als auch vom Backend geladen, welches dieselben Dateien liest, um das Schema und die API abzuleiten. Verweisen Sie daher per **Modulpfad** auf jede Komponente, anstatt sie zu importieren. `Component` akzeptiert dieselben Formen wie `admin.Field` und `entityViews[].Builder`: einen Pfad, ein Lazy-`import()` oder die Komponente selbst.

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

Die umschließende Komponente befindet sich zusammen mit dem Rest Ihres Frontend-Codes und erhält das, was sie umschließt, als `OriginalComponent` – die integrierte Komponente, es sei denn, Ihre App überschreibt diese ebenfalls (siehe [Wenn beide Gültigkeitsbereiche eine Komponente überschreiben](#wenn-beide-gültigkeitsbereiche-eine-komponente-überschreiben-when-both-scopes-override-a-component)):

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

Jedes Modul benötigt einen **Default-Export**. Das Collections-Vite-Plugin schreibt einen Pfad in einen Lazy-Import um, sodass die Komponente ein eigener Chunk ist und beim ersten Rendern des Overrides geladen wird. Dieses Umschreiben deckt die Dateien innerhalb des konfigurierten `collectionsDir` ab. Ein Pfad in einer Datei außerhalb davon erreicht den Admin als reiner String: Die Konsole weist darauf hin, und anstelle dessen wird die integrierte Komponente gerendert. Schreiben Sie den Lazy-Import außerhalb von `collectionsDir` selbst: `Component: () => import("../../frontend/src/ProductCustomForm")`.

Eine direkte Referenz (`Component: ProductCustomForm`) funktioniert ebenfalls, jedoch nur in einer Collection-Datei, die serverseitig von nichts geladen wird, da das Importieren der Komponente auch React und alle damit verknüpften Abhängigkeiten importiert.

### Wenn beide Gültigkeitsbereiche eine Komponente überschreiben {#when-both-scopes-override-a-component}

Unter 0.24 erhält der Wrapper einer Collection immer die integrierte Komponente, und das Override auf Anwendungsebene wird innerhalb dieser Collection übersprungen.

Die zwei Scopes lassen sich kombinieren. Das Override auf Anwendungsebene (`<Rebase components>`) wird zuerst auf die integrierte Komponente angewendet, und das der Collection (`admin.components`) wird auf das Ergebnis angewendet:

| App-Ebene | Collection-Ebene | Was innerhalb dieser Collection gerendert wird |
|---|---|---|
| beliebig | keine | was überall sonst gerendert wird: das Override auf Anwendungsebene oder die integrierte Komponente |
| keine | wrap | der Wrapper der Collection um die integrierte Komponente |
| replace oder wrap | wrap | der Wrapper der Collection um das Override auf Anwendungsebene, übergeben als `OriginalComponent` |
| beliebig | replace | die Komponente der Collection allein; sie ersetzt beide |

Eine Collection kann also etwas um eine Komponente herum hinzufügen, die Ihre App bereits anpasst, ohne diese Anpassung zu verlieren. Um die Version auf Anwendungsebene für eine einzelne Collection zu verwerfen, verwenden Sie `replace` anstelle von `wrap`.

---

## Gültigkeitsbereiche überschreibbarer Komponenten

### Komponenten mit App-Scope (`AppComponentName`)

Diese Komponenten können nur auf Ebene des Root-`<Rebase>`-Providers überschrieben werden, da sie Strukturen auf Shell-Ebene darstellen.

| Komponenten-Schlüssel | Beschreibung |
|---|---|
| `"Shell.AppBar"` | Die Kopfzeile am oberen Rand der Seite |
| `"Shell.Drawer"` | Das einklappbare Hauptnavigations-Drawer in der Seitenleiste |
| `"Shell.DrawerNavigationItem"` | Einzelne Links innerhalb der Seitenleiste |
| `"Shell.DrawerNavigationGroup"` | Einklappbare Navigationsgruppen-Header in der Seitenleiste |
| `"HomePage"` | Die Standard-Startseite im Inhaltsmodus |
| `"HomePage.CollectionCard"` | Einzelne Collection-Karten auf der Startseite |
| `"Auth.LoginView"` | Das Overlay, das angezeigt wird, wenn eine Authentifizierung erforderlich ist |

### Komponenten mit Collection-Scope (`CollectionComponentName`)

Diese Komponenten können global (als Standardwerte für alle Collections) oder für einzelne Collections überschrieben werden.

| Komponenten-Schlüssel | Beschreibung |
|---|---|
| `"Collection.View"` | Die gesamte Übersichtsseite der Collection |
| `"Collection.Table"` | Die standardmäßige tabellarische Ansicht |
| `"Collection.Card"` | Der Element-Wrapper für die Kartenansicht |
| `"Collection.EmptyState"` | Ansicht, die angezeigt wird, wenn eine Collection leer ist |
| `"Collection.Actions"` | Symbolleisten-Schaltflächen über der Tabelle/den Karten |
| `"Collection.FilterField"` | Benutzerdefinierte Filtereingabe für eine Spalte |
| `"Entity.Form"` | Das Detailformular zum Erstellen/Aktualisieren |
| `"EditView.FormActions"` | Schaltflächenleiste zum Absenden/Abbrechen des Formulars |
| `"DetailView"` | Schreibgeschützte Detailansicht |
| `"Entity.SidePanel"` | Der Seitenleisten-Container für Formular/Detailansicht |
| `"EntityPreview"` | Inline-Chip-Vorschau für Referenzen/Relationen |
| `"Entity.MissingReference"` | Wird gerendert, wenn eine referenzierte Entität fehlt |

:::note[Drei Schlüssel weichen vom `Entity.`-Muster ab]
`"DetailView"`, `"EntityPreview"` und `"EditView.FormActions"` tragen kein `Entity.`-Präfix.
`"Entity.DetailView"`, `"Entity.Preview"` und `"Entity.FormActions"` sind
nicht in der Union enthalten – sie führen zu Typfehlern, und in reinem JavaScript wird der
Override schlichtweg niemals angewendet.
:::

Ihre Ersatzkomponente erhält dieselben Props, die der integrierten Komponente übergeben wurden. Die Override-Map gibt keinen Props-Typ pro Schlüssel an – `ComponentOverride<P>` setzt für `P` standardmäßig `Record<string, unknown>` ein – typisieren Sie den Parameter daher selbst oder übergeben Sie ein Typargument, wenn die Props typgeprüft werden sollen. Einige der integrierten Komponenten exportieren einen Props-Typ, den Sie importieren und wiederverwenden können: `CollectionViewProps` (`@rebasepro/ui`); `CollectionEmptyStateProps`, `CollectionActionsProps`, `SidePanelBindingProps` und `FilterFieldBindingProps` (`@rebasepro/cms-types`); `EntityFormProps`, `EntityFormBindingProps`, `EntityFormActionsProps`, `CollectionTableBindingProps`, `DetailViewBindingProps`, `DrawerNavigationItemProps` und `DrawerNavigationGroupProps` (`@rebasepro/cms`); `LoginViewProps` (`@rebasepro/app`). Der Rest hat keinen exportierten Props-Typ – definieren Sie die Struktur, die Sie tatsächlich auslesen.

### Was ein `Collection.View`-Override berücksichtigen muss

`Collection.View` ist das, was ein `CollectionPanel` darstellt. Daher erreichen die Props des Panels Ihr Override als `CollectionViewBindingProps` (`@rebasepro/cms`), verteilt über die eigenen Props der Collection. Ein Ersatz, der diese ignoriert, beschädigt jede Seite, die die Collection einbettet. Berücksichtigen Sie mindestens folgende:

| Prop | Was der Aufrufer erwartet |
|---|---|
| `collectionOverrides` | Was der Aufrufer an der Collection ändert (ein fester Filter, eine Sortierung, der Ansichtsmodus), angewendet auf die registrierte Collection |
| `fields` | Nur diese Eigenschaften, in dieser Reihenfolge: die Spalten und woraus Zeilen der Liste und Karten befüllt werden |
| `highlightedIds` | Die IDs der Zeilen, die als ausgewählt dargestellt werden; `[]` für keine |
| `onRowClick` | Wird mit der angeklickten Zeile aufgerufen (so wie der Server sie sendet), anstatt sie zu öffnen. Das panel-eigene `onRowClick` |

Das Panel übergibt außerdem `viewMode` (der Modus, in dem geöffnet werden soll), `toolbar` (die darzustellende Symbolleiste, `null` für keine) und `title` (`false`, um keinen Titel anzuzeigen), sofern der Aufrufer diese gesetzt hat. Das integrierte `CollectionViewBinding` verarbeitet alle diese Angaben; ein Override, das es umschließt statt ersetzt, kann sie direkt durchreichen.

Um auf dem integrierten Teil aufzubauen statt bei Null anzufangen, kopieren Sie dessen Quellcode in Ihr Projekt und registrieren Sie die Kopie hier: Jeder Teil außer `Collection.View`, `DetailView` und dem Drag-and-Drop der Startseite kompiliert mit Paket-Imports. Siehe [Kopieren eines integrierten Teils](/docs/frontend/customizing#copying-a-built-in-part).

## Verwandte Themen

- [Rebase erweitern](/docs/frontend/extending/) — Erweiterungspunkte, die kein Override benötigen
- [Benutzerdefinierte Felder](/docs/frontend/custom-fields/) — Ersetzen des Editors einer einzelnen Eigenschaft anstelle einer Komponente
- [Slots](/docs/frontend/slots/) — Erweitern einer Komponente anstelle ihres Ersetzens
