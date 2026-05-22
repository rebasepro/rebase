---
slug: docs/changelog
title: Changelog
---
# Changelog

## [0.1.2] - 2026-05-15

### Miglioramenti

- **Rimossa la dipendenza da `lodash`** — Sostituito `lodash/cloneDeep` con un'utilità personalizzata `deepClone` in `@rebasepro/utils`. Questo elimina la dipendenza esterna e risolve il problema del fallimento di `npx create-rebase-app` dovuto alla mancanza di `lodash` a runtime.
- **Nuova utilità `deepClone`** — Una funzione leggera di clonazione profonda che preserva i riferimenti a funzioni e le istanze di classi (Date, GeoPoint, ecc.), progettata specificamente per gli oggetti collezione di Rebase.

### CI e Strumenti

- **Pipeline di rilascio automatizzata** — Nuovo flusso di lavoro di GitHub Actions (`Publish Stable Release`) che gestisce l'incremento di versione, la pubblicazione su npm e la creazione del rilascio su GitHub con un solo clic dalla scheda Actions.
- **Script di rilascio locale** — `pnpm release:patch`, `pnpm release:minor`, `pnpm release:major` per eseguire i rilasci dalla riga di comando con la stessa pipeline.
- **Rilasci Canary** — Ogni push su `main` pubblica una versione canary su npm (tag di distribuzione `@canary`).

### Correzioni

- Corretti i test dell'utility di navigazione per garantire la firma di chiamata corretta con il parametro opzionale di opzioni `undefined`.
- Aggiornate le descrizioni dei pacchetti per riflettere l'architettura basata su Postgres.

---

## [0.1.0] - 2025-05-14

🎉 **Primo rilascio pubblico di Rebase** — un CMS headless open source e pannello di amministrazione per Postgres.

### Punti Chiave

- **Pannello di Amministrazione Completo** — Viste a foglio di calcolo, schede, elenchi e tabelle per gestire i tuoi dati con modifica in linea, filtraggio, ordinamento e ricerca.
- **Backend PostgreSQL** — Supporto Postgres di prima classe con Drizzle ORM, introspezione dello schema e migrazioni automatiche.
- **Autenticazione** — Autenticazione integrata con email/password, Google OAuth e accesso anonimo. Controllo degli accessi basato sui ruoli con permessi personalizzabili.
- **Storage** — Archiviazione file compatibile con S3 con ridimensionamento delle immagini, caricamento drag-and-drop e gestione dei metadati.
- **Studio** — Editor SQL, editor di politiche RLS, visualizzatore di schemi, editor JS/TS, cron job ed esploratore di API.
- **CLI** — `npx create-rebase-app` per creare la struttura di un nuovo progetto in pochi secondi. Supporta sia npm che pnpm.
- **Generatore di SDK** — Genera automaticamente SDK TypeScript completamente tipizzati a partire dalle definizioni delle tue collezioni.
- **Server MCP** — Server Model Context Protocol per la gestione del database assistita dall'IA.
- **Plugin** — Plugin di arricchimento dati e analisi per estendere l'esperienza amministrativa.
- **Libreria di Componenti UI** — Un set completo di componenti React accessibili e personalizzabili basati sulle primitive Radix.
- **Supporto Firebase** — Adattatori opzionali di autenticazione e origine dati Firebase/Firestore.
- **Supporto MongoDB** — Adattatore opzionale di origine dati MongoDB.

### Pacchetti

| Pacchetto | Descrizione |
|---|---|
| `@rebasepro/types` | Definizioni dei tipi TypeScript principali |
| `@rebasepro/utils` | Funzioni di utilità condivise |
| `@rebasepro/common` | Moduli comuni condivisi tra i pacchetti |
| `@rebasepro/formex` | Libreria leggera di gestione dei moduli |
| `@rebasepro/ui` | Libreria di componenti React |
| `@rebasepro/core` | Logica CMS principale e controller |
| `@rebasepro/client` | Livello di accesso ai dati lato client |
| `@rebasepro/client-postgresql` | Adattatore client PostgreSQL |
| `@rebasepro/client-firebase` | Adattatore client Firebase/Firestore |
| `@rebasepro/server-core` | Framework server e middleware |
| `@rebasepro/server-postgresql` | Adattatore server PostgreSQL con Drizzle |
| `@rebasepro/server-mongodb` | Adattatore server MongoDB |
| `@rebasepro/auth` | Controller e viste di autenticazione |
| `@rebasepro/admin` | Interfaccia completa del pannello di amministrazione |
| `@rebasepro/studio` | Editor SQL, strumenti per lo schema e utilità per gli sviluppatori |
| `@rebasepro/cli` | CLI per la creazione e la gestione dei progetti |
| `@rebasepro/sdk-generator` | Generazione di codice SDK TypeScript |
| `@rebasepro/mcp-server` | Server MCP per integrazioni di IA |
| `@rebasepro/schema-inference` | Introspezione e inferenza dello schema del database |
| `@rebasepro/plugin-data-enhancement` | Plugin di arricchimento dei dati basato sull'IA |
| `@rebasepro/plugin-insights` | Plugin di arricchimento e approfondimenti |
