---
sourceHash: 0664758f56d33104
title: Deploy di Rebase su Scaleway
description: Scopri come distribuire Rebase su Scaleway per un'infrastruttura cloud sicura basata in Francia utilizzando i Serverless Containers.
sidebar_label: Scaleway
---

Scaleway è un cloud provider europeo con sede in Francia, con datacenter a Parigi, Amsterdam e Varsavia — una scelta eccellente per le organizzazioni che danno priorità alla sovranità dei dati nell'UE.

Usa il **Managed Database** di Scaleway per Postgres e i **Serverless Containers** per il runtime.

Nulla in questa pagina è specifico di Scaleway per quanto riguarda il tuo progetto. Un deployment di Rebase è composto da due parti separabili — l'immagine di runtime pubblicata e il **bundle** prodotto da `rebase build` — e lo stesso bundle viene eseguito con Docker Compose su un computer portatile, su Rebase Cloud, tramite l'[Helm chart](/docs/deployment/kubernetes) e qui.

## 1. Crea un database Postgres gestito

1. Nella console di Scaleway, vai su **PostgreSQL**.
2. Clicca su **Create a Database Instance**.
3. Scegli una regione (es. Parigi — `PAR1`).
4. Seleziona un tipo di nodo (**Play2-Pico** o **Pro2-XXS** vanno bene).
5. Aggiungi un nome per il database (`rebase_db`) e una password utente complessa.
6. Una volta distribuito, prendi nota della **Connection string** (URI) dalla dashboard:
   `postgres://user:password@ip:port/rebase_db`

Se le tue tabelle dichiarano una colonna `col.vector()`, abilita l'estensione una volta sul database: `CREATE EXTENSION vector;`.

## 2. Compila il bundle e integralo in un'immagine

Non c'è **nessuna immagine dell'applicazione da compilare dal codice sorgente**. `rebase build` produce una directory `dist-bundle` contenente tabelle, funzioni, cron compilati e — se il progetto dichiara un'app statica — il frontend compilato. L'immagine di runtime pubblicata la esegue:

```bash
rebase build
```

I Serverless Containers effettuano il pull da un registry, quindi integra il bundle in un'immagine derivata. Tre righe, e definisce esattamente cosa viene eseguito:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.30.1
COPY dist-bundle /bundle
```

1. Vai su **Container Registry** nella console di Scaleway e crea un namespace (es. `rebase-apps`).
2. Esegui l'accesso al registry dal tuo terminale seguendo le istruzioni mostrate.
3. Esegui il build e il push dalla radice del progetto:

```bash
docker build -t rg.fr-par.scw.cloud/rebase-apps/rebase-backend:latest .
docker push rg.fr-par.scw.cloud/rebase-apps/rebase-backend:latest
```

Aggiornare Rebase in seguito richiederà solo una modifica a quella riga `FROM`. Il tuo bundle rimarrà intatto.

## 3. Distribuisci il Serverless Container

1. Vai su **Serverless Containers**.
2. Clicca su **Create a Container**.
3. Scegli l'immagine che hai appena caricato.
4. Imposta la porta su **8080** — la porta su cui l'immagine di runtime è in ascolto, a meno che `PORT` non indichi diversamente.
5. Sotto Environment Variables, aggiungi:

| Chiave | Valore |
|-----|-------|
| `DATABASE_URL` | L'URI ottenuto dal passaggio del database Postgres gestito |
| `JWT_SECRET` | Una stringa casuale sicura di oltre 32 caratteri per la firma dei token di autenticazione |
| `REBASE_SERVICE_KEY` | Una stringa casuale sicura di oltre 32 caratteri |
| `NODE_ENV` | `production` |
| `CORS_ORIGINS` | Il dominio del tuo frontend (es., `https://yourdomain.com`) |
| `FRONTEND_URL` | L'URL del tuo frontend (usato per i link nelle email e come fallback per CORS) |
| `DISABLE_SELF_REGISTRATION` | `true` |
| `REBASE_ADMIN_EMAIL` | L'indirizzo del primo amministratore, impostato **prima del primo avvio** |
| `REBASE_ADMIN_PASSWORD` | Almeno 12 caratteri |

Le ultime tre servono a fare in modo che questo deployment abbia un amministratore: in produzione il primo account che si registra non viene promosso, quindi nient'altro crea il primo chiamante autenticato. Vedi [Il tuo primo admin](/docs/getting-started/deployment/#your-first-admin). Contrassegna i secret come variabili d'ambiente segrete anziché in chiaro.

6. Punta l'health check su `/livez`. Non `/health`: quest'ultimo esegue un round-trip verso il database, quindi una liveness probe su di esso riavvierebbe un container altrimenti integro durante un breve singhiozzo del database.
7. Clicca su **Deploy Container**.

Scaleway effettuerà il provisioning del container e fornirà un endpoint pubblico (es. `https://rebase-backend-xxxx.functions.fnc.fr-par.scw.cloud`).

*Per una rigorosa conformità dei dati, verifica che i dettagli della tua Organization in Scaleway riflettano la tua entità aziendale europea.*

## 4. Lo schema

<span class="since-badge" data-since="0.31">Dalla 0.31</span>

**Il runtime crea le tabelle mancanti all'avvio, incluse quelle dichiarate da `backend/schema`.** `REBASE_MIGRATE_ON_BOOT` è impostato di default su `ensure`, che è additivo per l'intero schema: crea le tabelle, le colonne e i tipi enum mancanti e applica la loro sicurezza a livello di riga (row-level security), consentendo al primo avvio su un database vuoto di iniziare subito a servire le tue tabelle.

Ciò che `ensure` non fa mai è modificare elementi già esistenti: non altera il tipo di una colonna, non elimina nulla e non modifica le etichette di un enum esistente, poiché il riavvio di un container non deve rimodellare uno schema come effetto collaterale di un deploy.

C'è quindi un aspetto che richiede ancora l'uso della CLI, eseguita da un checkout locale o da un job di CI con `DATABASE_URL` puntato verso il tuo Managed Database:

```bash
rebase db push
```

Qualsiasi modifica che non sia puramente additiva — una colonna rinominata, un tipo ristretto, un campo rimosso.

L'immagine di runtime viene fornita senza la CLI, quindi questo comando non viene mai eseguito all'interno del container. Per le migrazioni con controllo di versione, fai il commit dei file di migrazione con `rebase db generate` ed esegui invece `rebase db migrate` come passaggio della release.

## Archiviazione dei file

I Serverless Containers non dispongono di un disco permanente, pertanto l'archiviazione locale dei file causa una perdita silenziosa dei dati e il runtime la rifiuta in produzione. Scaleway Object Storage è compatibile con S3 e si trova negli stessi datacenter:

```env
STORAGE_TYPE=s3
S3_BUCKET=my-uploads
S3_ENDPOINT=https://s3.fr-par.scw.cloud
S3_REGION=fr-par
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
```

Vedi [Storage](/docs/backend/storage) per una panoramica completa.

## Passaggi successivi

- [Deployment](/docs/getting-started/deployment) — la checklist per la produzione e le regole relative al primo amministratore condivise da tutte le piattaforme.
- [Configurazione](/docs/getting-started/configuration) — tutte le variabili d'ambiente lette dal runtime.
