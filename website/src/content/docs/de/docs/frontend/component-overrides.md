---
title: Komponenten-Overrides (Swizzling)
sidebar_label: Komponenten-Overrides
description: Überschreiben Sie Standard-UI-Komponenten durch benutzerdefinierte Implementierungen auf Anwendungs- oder Collection-Ebene.
---

## Überblick

Rebase erlaubt es Ihnen, Standard-UI-Komponenten durch Ihre eigenen benutzerdefinierten Implementierungen zu überschreiben. Dies implementiert ein Docusaurus-artiges Komponenten-Swizzling-Modell, das zwei Anpassungsmuster unterstützt:
- **Eject-Modus** (Standard): Ihre Komponente ersetzt die integrierte vollständig.
- **Wrap-Modus** (`wrap: true`): Ihre Komponente umschließt das Original. Die integrierte Komponente wird als `OriginalComponent`-Prop übergeben, sodass Sie sie innerhalb Ihres benutzerdefinierten Layouts/Ihrer Logik rendern können.

Komponenten-Overrides können **global** auf Anwendungsebene (auf dem `<Rebase>`-Provider) oder **lokal** auf Collection-Ebene (innerhalb einzelner Collection-Definitionen) angewendet werden.

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

Um Komponenten nur für eine bestimmte Collection zu überschreiben, fügen Sie ihrer Definition ein `components`-Objekt hinzu. Dies ist nützlich, um Leerzustände, Karten oder Detailansichten für bestimmte Modelle anzupassen.

```tsx
import { defineCollection } from "@rebasepro/admin-types";
import { ProductCustomForm } from "./components/ProductCustomForm";

const productsCollection = defineCollection({
    name: "Products",
    slug: "products",
    table: "products",
    properties: { /* ... */ },
    admin: {
        components: {
            // Eject Mode: Replace the default entity form view
            "Entity.Form": { Component: ProductCustomForm },

            // Wrap Mode: Wrap the empty state to add quick links
            "Collection.EmptyState": {
                // `OriginalComponent` is injected at runtime when `wrap: true`; the override
                    // slot's type does not model it, hence the annotation.
                    Component: (({ OriginalComponent, ...props }: {
                        OriginalComponent: React.ComponentType<Record<string, unknown>>
                    }) => (
                    <div className="empty-state-wrapper">
                        <OriginalComponent {...props} />
                        <button onClick={() => importDemoProducts()}>
                            Load Demo Products
                        </button>
                    </div>
                )) as unknown as React.ComponentType<Record<string, unknown>>,
                wrap: true
            }
        }
    }
});

```

---

## Bereiche überschreibbarer Komponenten

### App-bezogene Komponenten (`AppComponentName`)

Diese Komponenten können nur auf Ebene des Root-`<Rebase>`-Providers überschrieben werden, da sie die Struktur auf Shell-Ebene darstellen.

| Komponenten-Schlüssel | Beschreibung |
|---|---|
| `"Shell.AppBar"` | Die Kopfleiste oben auf der Seite |
| `"Shell.Drawer"` | Die einklappbare Hauptnavigations-Sidebar |
| `"Shell.DrawerNavigationItem"` | Einzelne Links innerhalb der Sidebar |
| `"Shell.DrawerNavigationGroup"` | Einklappbare Navigationsgruppen-Überschriften in der Sidebar |
| `"HomePage"` | Die Standard-Startseite im Content-Modus |
| `"HomePage.CollectionCard"` | Einzelne Collection-Karten auf der Startseite |
| `"Auth.LoginView"` | Das Overlay, das bei der Anforderung der Authentifizierung angezeigt wird |

### Collection-bezogene Komponenten (`CollectionComponentName`)

Diese Komponenten können global (als Standard für alle Collections) oder auf einzelnen Collections überschrieben werden.

| Komponenten-Schlüssel | Beschreibung |
|---|---|
| `"Collection.View"` | Die gesamte Collection-Startseite |
| `"Collection.Table"` | Die standardmäßige tabellarische Tabellenansicht |
| `"Collection.Card"` | Der Wrapper des Kartenansichts-Elements |
| `"Collection.EmptyState"` | Ansicht, die angezeigt wird, wenn eine Collection leer ist |
| `"Collection.Actions"` | Toolbar-Schaltflächen über der Tabelle/den Karten |
| `"Collection.FilterField"` | Benutzerdefiniertes Filterfeld für eine Spalte |
| `"Entity.Form"` | Das Detailformular zum Erstellen/Aktualisieren |
| `"EditView.FormActions"` | Schaltflächenleiste zum Absenden/Abbrechen des Formulars |
| `"DetailView"` | Schreibgeschützte Detailansicht |
| `"Entity.SidePanel"` | Der Seitenleisten-Container für Formular/Detail |
| `"EntityPreview"` | Inline-Vorschau des Referenz-/Relations-Chips |
| `"Entity.MissingReference"` | Wird gerendert, wenn eine referenzierte Entität fehlt |
