---
sourceHash: deec6d59eab82ff5
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
import { RebaseCMS } from "@rebasepro/cms";

// The Collection Editor is automatically enabled when you provide the 
// collectionEditor configuration to your RebaseCMS component
<RebaseCMS
    collections={collections}
    collectionEditor={{
        getAuthToken: authController.getAuthToken
    }}
/>
```

### Integrierte Werkzeuge

Sie gehören zu Studio und werden **von `RebaseStudio` lazy geladen** — jedes ist ein eigener Chunk, der beim ersten Öffnen geholt wird. Einzeln importierbar sind sie nicht: `@rebasepro/studio` exportiert bewusst nur den Orchestrator, damit eine nie geöffnete Konsole nichts kostet.

| Tab | Slug | Funktion |
|-----|------|----------|
| SQL-Konsole | `sql` | Rohes SQL gegen die PostgreSQL-Datenbank ausführen und Ergebnisse als Tabelle lesen |
| JS-Konsole | `js` | JavaScript über das Rebase-SDK schreiben und ausführen |
| RLS-Richtlinien-Editor | `rls` | Row-Level-Security-Richtlinien der Tabellen prüfen und verwalten |
| Storage-Browser | `storage` | Dateien in den Storage-Backends durchsuchen, hochladen und verwalten |


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
