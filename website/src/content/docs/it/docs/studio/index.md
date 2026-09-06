---
sourceHash: deec6d59eab82ff5
title: Strumenti Studio
sidebar_label: Studio
description: Rebase Studio fornisce strumenti per sviluppatori per la modifica visiva dello schema, query SQL, scripting JavaScript, gestione delle policy RLS e navigazione dello storage.
---

## Panoramica

Rebase ha due modalità:

- **Modalità Contenuto** — Per editor di contenuti e team operativi. Mostra le collezioni e la gestione dei dati.
- **Modalità Studio** — Per gli sviluppatori. Sblocca gli strumenti rivolti agli sviluppatori.

Passa da una modalità all'altra utilizzando il controller della modalità admin o l'interruttore dell'interfaccia utente nella barra dell'app.

## Strumenti Studio Integrati

### Editor di Collezioni

Un editor di schema visuale che ti permette di creare e modificare collezioni tramite un'interfaccia utente drag-and-drop. Quando salvi le modifiche, utilizza [ts-morph](https://ts-morph.com/) per aggiornare i tuoi file sorgente TypeScript tramite manipolazione AST — preservando tutto il codice esistente e la logica personalizzata.

![Editor di collezioni](/img/collection_editor.png)

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

### Strumenti integrati

Fanno parte di Studio e vengono **caricati in modo lazy da `RebaseStudio`** — ognuno è un chunk separato, scaricato la prima volta che lo apri. Non sono importabili singolarmente: `@rebasepro/studio` esporta deliberatamente solo l'orchestratore, così una console che non apri mai non costa nulla.

| Scheda | Slug | Cosa fa |
|--------|------|---------|
| Console SQL | `sql` | Eseguire SQL grezzo sul database PostgreSQL e leggere i risultati in tabella |
| Console JS | `js` | Scrivere ed eseguire JavaScript tramite l'SDK di Rebase |
| Editor delle policy RLS | `rls` | Ispezionare e gestire le policy di Row Level Security delle tabelle |
| Browser dello storage | `storage` | Sfogliare, caricare e gestire i file nei backend di storage |


## Aggiunta di Viste Studio

Gli strumenti Studio sono automaticamente disponibili quando includi il componente `RebaseStudio` all'interno della tua app:

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

Queste viste appaiono nella navigazione della barra laterale quando la modalità Studio è attiva.

## Passi Successivi

- **[Plugin](/docs/plugins)** — Estendi il framework con i plugin
- **[Collezioni](/docs/collections)** — Configurazione delle collezioni
