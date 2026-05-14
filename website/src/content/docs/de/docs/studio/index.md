---
title: Studio-Tools
sidebar_label: Studio
description: Rebase Studio bietet Entwickler-Tools für die visuelle Schema-Bearbeitung, SQL-Abfragen, JavaScript-Skripte, RLS-Richtlinienverwaltung und das Durchsuchen von Speichern.
---

## Übersicht

Rebase hat zwei Modi:

- **Inhaltsmodus** — Für Inhaltsredakteure und Betriebsteams. Zeigt Sammlungen und Datenverwaltung.
- **Studio-Modus** — Für Entwickler. Schaltet entwicklerorientierte Tools frei.

Wechseln Sie zwischen den Modi über den Admin-Modus-Controller oder den UI-Schalter in der App-Leiste.

## Integrierte Studio-Tools

### Sammlungs-Editor

Ein visueller Schema-Editor, mit dem Sie Sammlungen über eine Drag-and-Drop-Benutzeroberfläche erstellen und ändern können. Wenn Sie Änderungen speichern, verwendet er [ts-morph](https://ts-morph.com/), um Ihre TypeScript-Quelldateien über AST-Manipulation zu aktualisieren – wobei der gesamte vorhandene Code und die benutzerdefinierte Logik erhalten bleiben.

![Sammlungs-Editor](/img/collection_editor.png)

```tsx
import { RebaseCMS } from "@rebasepro/admin";

// The Collection Editor is automatically enabled when you provide the 
// collectionEditor configuration to your RebaseCMS component
<RebaseCMS
    collections={collections}
    collectionEditor={{
        getAuthToken: authController.getAuthToken
    }}
/>
```

### SQL-Konsole

Führen Sie rohe SQL-Abfragen für Ihre PostgreSQL-Datenbank aus und sehen Sie die Ergebnisse in einer Tabelle:

```tsx
import { SQLEditor } from "@rebasepro/studio";

{ slug: "sql", name: "SQL Console", view: <SQLEditor /> }
```

### JS-Konsole

Schreiben und Ausführen von JavaScript mit dem Rebase SDK:

```tsx
import { JSEditor } from "@rebasepro/studio";

{ slug: "js", name: "JS Console", view: <JSEditor /> }
```

### RLS-Richtlinien-Editor

Visualisieren und verwalten Sie Row Level Security-Richtlinien für Ihre PostgreSQL-Tabellen:

```tsx
import { RLSEditor } from "@rebasepro/studio";

{ slug: "rls", name: "RLS Policies", view: <RLSEditor /> }
```

### Speicher-Browser

Dateien in Ihren Speicher-Backends durchsuchen, hochladen und verwalten:

```tsx
import { StorageView } from "@rebasepro/studio";

{ slug: "storage", name: "Storage", view: <StorageView /> }
```

## Studio-Ansichten hinzufügen

Studio-Tools sind automatisch verfügbar, wenn Sie die `RebaseStudio`-Komponente in Ihre App einfügen:

```tsx
import { RebaseStudio } from "@rebasepro/studio";

export function App() {
    return (
        <Rebase client={client} authController={authController}>
            {/* Custom views are injected and studio mode is managed automatically */}
            <RebaseStudio />
            {/* ... */}
        </Rebase>
    );
}
```

Diese Ansichten erscheinen in der Seitenleisten-Navigation, wenn der Studio-Modus aktiv ist.

## Nächste Schritte

- **[Plugins](/docs/plugins)** — Erweitern Sie das Framework mit Plugins
- **[Sammlungen](/docs/collections)** — Sammlungs-Konfiguration
---
