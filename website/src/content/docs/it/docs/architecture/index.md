---
sourceHash: b58890f96ff100b4
title: Panoramica dell'architettura
sidebar_label: Architettura
description: Scopri come backend, frontend, SDK tipizzato e database di Rebase si integrano per formare un Backend-as-a-Service completo.
---

## Architettura del sistema

Rebase è una piattaforma full-stack articolata su quattro livelli:

```
┌─────────────────────────────────────────────────────────────────┐
│                        Frontend Layer                           │
│  Rebase CMS + Studio  •  Custom Views  •  Plugins  •  Your App │
│  @rebasepro/app  •  @rebasepro/ui  •  @rebasepro/studio       │
└───────────────────────────┬─────────────────────────────────────┘
                            │ HTTP + WebSocket
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                        Backend Layer                            │
│  Hono HTTP Server  •  REST API  •  Auth  •  Storage  •  WS     │
│  @rebasepro/server                                         │
└───────────────────────────┬─────────────────────────────────────┘
                            │ Drizzle ORM
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                       Database Layer                            │
│  PostgreSQL  •  Tables  •  RLS Policies  •  Realtime sync       │
└─────────────────────────────────────────────────────────────────┘
```

## Componenti chiave

### Sistema di adapter del database

Il backend viene inizializzato tramite un pattern unificato basato su adapter per database. La logica specifica del database è disaccoppiata nel rispettivo pacchetto, e l'adapter gestisce automaticamente il connection pooling, la risoluzione dello schema e l'instradamento degli eventi in tempo reale.

```typescript
import { createPostgresAdapter } from "@rebasepro/server-postgres";

database: createPostgresAdapter({
    connectionString: process.env.DATABASE_URL!
})
```

Ogni tabella viene risolta rispetto all'adapter configurato: il database predefinito o quello indicato dal relativo `database` in `backend/resources.ts`.

:::tip
`createPostgresAdapter` gestisce automaticamente il connection pooling del database, la risoluzione dello schema e la configurazione di `LISTEN/NOTIFY` in tempo reale.
:::

### Descrittori di tabella

<span class="since-badge" data-since="0.31">Dalla 0.31</span>

All'avvio, il backend compila le tabelle esportate da `backend/schema/index.ts` in
**descrittori**: ogni colonna con il suo tipo Postgres, tolleranza ai valori nulli (nullability), regole di validazione e
archiviazione, le relazioni per slug e la postura di row-level security. Un
problema in qualsiasi tabella blocca l'avvio con un `SchemaDefinitionError` che segnala
ogni errore rilevato. I descrittori sono la sorgente usata da REST, realtime, MCP e dal
documento OpenAPI, l'elemento su cui viene calcolata la versione dello schema e ciò che
`GET /api/schema/tables` fornisce al pannello di amministrazione e a Studio, oscurato in base al
chiamante. Il codice degli hook non lascia mai il server. Un backend privo di `backend/schema`
esegue invece l'introspezione del database convertendolo negli stessi descrittori.

### Servizio Realtime

La sincronizzazione in tempo reale si basa sul meccanismo nativo `LISTEN/NOTIFY` di PostgreSQL:

1. Si verifica una mutazione dei dati (insert, update, delete) — tramite l'API o qualsiasi altra operazione di scrittura sulla tabella: `psql`, un cron job, l'editor SQL
2. Un trigger sulla tabella emette una `NOTIFY` su un canale (se il trigger non può essere installato, la notifica viene emessa dal backend, solo per le scritture effettuate tramite API)
3. Il `RealtimeService` riceve la notifica
4. Trasmette la modifica in broadcast a tutti i client WebSocket connessi
5. I componenti React eseguono nuovamente il render con i nuovi dati

Per i **deployment multi-istanza** (ad es. Cloud Run con repliche multiple), ciascuna replica mantiene la propria connessione `LISTEN` verso lo stesso database, garantendo che le modifiche raggiungano i sottoscrittori di ogni replica. Dietro a un pooler in modalità transazione come PgBouncer, che non supporta `LISTEN`, imposta `DATABASE_DIRECT_URL` collegandolo direttamente al database stesso.

### Registro dello storage

Analogamente ai driver, i backend di storage vengono registrati in un apposito registro. È possibile configurare più provider di storage (locale, S3) e instradare diverse colonne di storage verso backend distinti tramite `col.storage({ source })`.

## Mappa dei pacchetti

<span class="since-badge" data-since="0.31">Dalla 0.31</span>

| Pacchetto | Ruolo | Utilizzato da |
|-----------|-------|---------------|
| `@rebasepro/types` | I builder delle tabelle (`defineTable`, `col`, `rel`), i descrittori e le interfacce condivise da ogni pacchetto | Tutti |
| `@rebasepro/server` | Inizializzazione del server backend, API REST, autenticazione, storage, WebSocket; riesporta i builder da `@rebasepro/server/schema`, un entry point che non carica codice server | Backend |
| `@rebasepro/server-postgres` | Il driver Postgres: pianificazione dello schema, migrazioni, policy RLS, realtime | Backend |
| `@rebasepro/codegen` | Generazione dell'SDK tipizzato a partire dai descrittori di tabella | Strumenti di sviluppo |
| `@rebasepro/client` | SDK tipizzato — trasporto HTTP, WebSocket, autenticazione | Frontend |
| `@rebasepro/app` | Framework React — Scaffold, controller, form, route, hook, viste di login, hook per controller di autenticazione | Frontend |
| `@rebasepro/ui` | Libreria standalone di componenti UI (Tailwind v4 + Radix) | Frontend |
| `@rebasepro/studio` | Visualizzatore ed editor di schemi, console SQL, console JS, editor RLS, browser dello storage | Frontend |
| `@rebasepro/cli` | CLI per la generazione dello schema, migrazioni del DB, generazione dell'SDK | Strumenti di sviluppo |
| `@rebasepro/forms` | Gestione leggera dello stato dei form in React | Frontend |
| `@rebasepro/plugin-ai` | Plugin di completamento automatico dei campi basato su IA | Frontend |
| `@rebasepro/cms` | Il pannello di amministrazione: una vista per tabella ricavata dai descrittori, `customizeTable`, form e routing, importazione ed esportazione CSV/JSON/Excel | Frontend |
| `@rebasepro/cms-types` | I tipi e gli helper del pannello: opzioni di `customizeTable`, opzioni dei campi, azioni sulle entità e il modello di visualizzazione di collezioni e proprietà renderizzato dal pannello (`CollectionConfig`, `StringProperty`, `CollectionCallbacks`, …) | Frontend |
| `@rebasepro/firebase` | Firestore come sorgente letta direttamente dal pannello: `defineFirestoreCollection` | Frontend |
| `@rebasepro/inference` | Inferenza dei campi da righe di esempio (la funzione "crea da un file" del pannello admin) | Frontend |

## Flusso dei dati

### Flusso di lettura
1. L'utente apre una tabella in Rebase CMS
2. L'SDK tipizzato invia `GET /api/data/:slug` + apre una sottoscrizione WebSocket
3. Il backend interroga PostgreSQL tramite Drizzle ORM
4. La risposta contiene le righe così come fornite dall'API; il pannello genera i valori dei propri form a partire dalla riga e dal descrittore della tabella
5. La risposta viene inviata al frontend, i componenti eseguono il rendering
6. Il WebSocket mantiene la vista sincronizzata in tempo reale

### Flusso di scrittura
1. L'utente modifica una riga nel form
2. L'SDK tipizzato invia `PATCH /api/data/:slug/:id`
3. Il backend valida i valori rispetto alla tabella ed esegue gli hook `beforeSave`
4. Esegue l'`UPDATE` applicando la row-level security del chiamante
5. Vengono eseguiti gli hook `afterSave`, all'interno della stessa transazione
6. Il broadcast via `NOTIFY` attiva l'aggiornamento WebSocket per tutti i client
7. Se la cronologia è abilitata, viene registrato uno snapshot

## Passaggi successivi

- **[Schema as Code](/docs/architecture/schema-as-code)** — L'approccio TypeScript-first
- **[Panoramica del backend](/docs/backend)** — Configurazione del server
- **[Tabelle](/docs/schema/)** — Definisci lo schema dei tuoi dati
