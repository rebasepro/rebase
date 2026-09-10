---
sourceHash: b2acba62de849f55
title: Distribuzione di Rebase su Microsoft Azure
description: Distribuisci la tua istanza di Rebase in modo sicuro su Azure utilizzando Azure Database for PostgreSQL e Azure Container Apps.
sidebar_label: Azure
---

Microsoft Azure offre integrazioni avanzate e conformità aziendale. L'architettura ottimale per eseguire Rebase su Azure utilizza **Azure Database for PostgreSQL – Flexible Server** per il livello dati e **Azure Container Apps** per il runtime.

Per garantire la conformità europea sui dati e tempi di risposta locali rapidi, effettua il provisioning delle risorse in regioni come **West Europe (Amsterdam)**, **North Europe (Irlanda)** o **France Central (Parigi)**.

Niente in questa pagina è specifico di Azure per quanto riguarda il tuo progetto. Una distribuzione di Rebase è composta da due elementi separabili: l'immagine di runtime pubblicata e il **bundle** generato da `rebase build` — e lo stesso bundle viene eseguito con Docker Compose su un portatile, su Rebase Cloud, tramite il [grafico Helm](/docs/deployment/kubernetes) e qui.

## 1. Effettua il provisioning di PostgreSQL Flexible Server

1. Dal portale di Azure, cerca e seleziona **Server di Database di Azure per PostgreSQL**.
2. Fai clic su **Crea** e seleziona **Server flessibile**.
3. Scegli il tuo Gruppo di risorse e imposta la tua area geografica dell'UE preferita.
4. Seleziona le dimensioni di Calcolo (ad es. Utilizzo generico o `B2s` con burst per distribuzioni più piccole).
5. Configura la scheda **Autenticazione** con un nome utente amministratore e una password sicura.
6. In **Rete**, assicurati che sia selezionata l'opzione "Consenti l'accesso pubblico da qualsiasi servizio Azure all'interno di Azure a questo server" in modo che la tua Container App possa connettersi, oppure configura una VNet sicura.
7. Prendi nota del nome del server e componi l'URI di connessione:
   `postgresql://your_admin:YOUR_PASSWORD@your-server-name.postgres.database.azure.com:5432/postgres`

Se le tue collection dichiarano una proprietà `vector`, abilita l'estensione una volta: Azure la subordina al parametro del server `azure.extensions`, quindi esegui `CREATE EXTENSION vector;`.

## 2. Compila il bundle e integralo in un'immagine

Non c'è **alcuna immagine applicativa da compilare dal tuo codice sorgente**. `rebase build` produce una directory `dist-bundle` con le tue collection compilate, le funzioni, i cron e — se il tuo progetto dichiara un'app statica — il tuo frontend compilato. L'immagine di runtime pubblicata lo esegue:

```bash
rebase build
```

Container Apps esegue il pull da un registro, quindi integra il bundle in un'immagine derivata. Tre righe, e fissa esattamente ciò che viene eseguito:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.20.0
COPY dist-bundle /bundle
```

1. Crea un **Registro Azure Container** (Container Registry) nella regione UE prescelta.
2. Accedi dalla tua CLI:
   ```bash
   az acr login --name YourRegistryName
   ```
3. Compila ed esegui il push, partendo dalla directory radice del progetto:
   ```bash
   docker build -t yourregistryname.azurecr.io/rebase-backend:latest .
   docker push yourregistryname.azurecr.io/rebase-backend:latest
   ```

L'aggiornamento di Rebase in futuro consisterà semplicemente nella modifica di quella riga `FROM`. Il tuo bundle rimane invariato.

## 3. Distribuisci la Container App

Azure Container Apps fornisce un ambiente per container serverless con ingresso HTTPS integrato.

1. Cerca **App contenitore** (Container Apps) nel portale e fai clic su **Crea**.
2. Crea un nuovo ambiente per App contenitore nella tua regione UE.
3. Nella scheda **Contenitore**, punta al tuo registro ACR e seleziona l'immagine `rebase-backend:latest`.
4. Imposta le **Variabili di ambiente**:

| Nome | Valore |
|------|-------|
| `DATABASE_URL` | La tua stringa di connessione ad Azure Postgres |
| `JWT_SECRET` | Una stringa casuale e sicura di oltre 32 caratteri |
| `REBASE_SERVICE_KEY` | Una stringa casuale e sicura di oltre 32 caratteri |
| `NODE_ENV` | `production` |
| `CORS_ORIGINS` | Il dominio del tuo frontend (ad es., `https://yourdomain.com`) |
| `FRONTEND_URL` | L'URL del tuo frontend (utilizzato per i link nelle email e come fallback per CORS) |
| `DISABLE_SELF_REGISTRATION` | `true` |
| `REBASE_ADMIN_EMAIL` | L'indirizzo del primo amministratore, impostato **prima del primo avvio** |
| `REBASE_ADMIN_PASSWORD` | Almeno 12 caratteri |

Le ultime tre variabili definiscono il modo in cui questa distribuzione ottiene un amministratore: in produzione il primo account a registrarsi non viene promosso ad admin, quindi nient'altro genererà il primo utente autenticato. Consulta [Il tuo primo amministratore](/docs/getting-started/deployment/#your-first-admin). Salva i secret come secret di Container Apps e fai riferimento a essi, anziché usarli come semplici valori di ambiente.

5. Nella scheda **Ingresso** (Ingress), abilita l'ingresso.
6. Imposta la porta di destinazione su **8080** — la porta su cui l'immagine di runtime è in ascolto, a meno che `PORT` non specifichi diversamente.
7. Punta il probe di integrità a `/livez`. Non a `/health`: quest'ultimo esegue un ciclo completo (round-trip) sul database, quindi un probe di liveness su di esso riavvierebbe un container altrimenti integro durante una breve interruzione temporanea del database.
8. Completa la creazione. Azure effettua il provisioning del container e fornisce un URL dell'applicazione protetto da TLS.

## 4. Lo schema

**Il runtime crea le tabelle mancanti all'avvio, incluse quelle delle tue collection.** `REBASE_MIGRATE_ON_BOOT` è impostato di default su `ensure`, che è un'operazione additiva sull'intero schema — crea le tabelle, le colonne e i tipi enum mancanti e applica la loro sicurezza a livello di riga (RLS) — in modo che il primo avvio a fronte di un server vuoto si attivi rendendo operative le tue collection.

Ciò che `ensure` non fa mai è modificare qualcosa che esiste già: non modifica il tipo di una colonna, non rimuove nulla né altera i valori di un enum esistente, poiché il riavvio di un container non deve modificare lo schema come effetto collaterale di una distribuzione.

Di conseguenza, due operazioni richiedono ancora la CLI, eseguita da un checkout locale o da un job di CI con `DATABASE_URL` puntato al tuo Flexible Server (aggiungi una regola del firewall che consenta l'IP del tuo client, se necessario):

```bash
rebase db push
```

- **RLS delle junction table** per le relazioni molti-a-molti.
- **Qualsiasi modifica che non sia puramente additiva** — una colonna rinominata, un tipo con ambito ristretto, un campo rimosso.

L'immagine di runtime viene distribuita senza la CLI, quindi questo comando non viene mai eseguito all'interno del container. Per le migrazioni con controllo di versione, effettua il commit dei file di migrazione con `rebase db generate` ed esegui invece `rebase db migrate` come passaggio di rilascio.

## Archiviazione dei file

Le repliche di Container Apps non dispongono di un disco persistente, pertanto l'archiviazione locale dei file comporta una perdita silenziosa di dati e il runtime la rifiuta in produzione. Crea un account Azure Storage e utilizza la sua interfaccia compatibile con S3, oppure un bucket compatibile con S3 nella stessa regione, impostando `STORAGE_TYPE=s3` — consulta [Storage](/docs/backend/storage).

## Passaggi successivi

- [Distribuzione](/docs/getting-started/deployment) — la checklist per la produzione e le regole per il primo amministratore comuni a tutte le piattaforme.
- [Configurazione](/docs/getting-started/configuration) — tutte le variabili di ambiente lette dal runtime.

---
