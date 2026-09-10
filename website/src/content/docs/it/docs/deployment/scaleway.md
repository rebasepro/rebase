---
sourceHash: c543c4d920d4a2f9
title: Distribuzione di Rebase su Scaleway
description: Scopri come distribuire Rebase su Scaleway per un'infrastruttura cloud sicura basata in Francia utilizzando i Serverless Containers.
sidebar_label: Scaleway
---

Scaleway è un provider cloud europeo con sede in Francia, con datacenter a Parigi, Amsterdam e Varsavia: una scelta eccellente per le organizzazioni che danno priorità alla sovranità dei dati nell'UE.

Usa il **Managed Database** di Scaleway per Postgres e i **Serverless Containers** per il runtime.

Nulla in questa pagina è specifico di Scaleway per quanto riguarda il tuo progetto. Un deployment di Rebase è composto da due parti separabili: l'immagine di runtime pubblicata e il **bundle** prodotto da `rebase build` — e lo stesso bundle viene eseguito con Docker Compose su un portatile, su Rebase Cloud, tramite l'[Helm chart](/docs/deployment/kubernetes) e qui.

## 1. Crea un database Postgres gestito

1. Nella console di Scaleway, vai su **PostgreSQL**.
2. Fai clic su **Create a Database Instance**.
3. Scegli una regione (ad es. Parigi — `PAR1`).
4. Seleziona un tipo di nodo (**Play2-Pico** o **Pro2-XXS** funzionano bene).
5. Aggiungi un nome di database (`rebase_db`) e una password utente complessa.
6. Una volta distribuito, annota la **Connection string** (URI) dalla dashboard:
   `postgres://user:password@ip:port/rebase_db`

Se le tue collezioni dichiarano una proprietà `vector`, abilita l'estensione una volta: `CREATE EXTENSION vector;` sul database.

## 2. Compila il bundle e incorporalo in un'immagine

**Non è necessario creare un'immagine dell'applicazione partendo dal codice sorgente**. `rebase build` produce una directory `dist-bundle` contenente le tue collezioni compilate, funzioni, cron e, se il progetto dichiara un'app statica, il frontend compilato. L'immagine di runtime pubblicata la esegue:

```bash
rebase build
```

Serverless Containers scarica l'immagine da un registry, quindi incorpora il bundle in un'immagine derivata. Tre righe, e fissa esattamente ciò che viene eseguito:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.20.0
COPY dist-bundle /bundle
```

1. Vai su **Container Registry** nella console di Scaleway e crea un namespace (ad es. `rebase-apps`).
2. Accedi al registry dal tuo terminale seguendo le istruzioni mostrate.
3. Esegui la build e il push dalla radice del progetto:

```bash
docker build -t rg.fr-par.scw.cloud/rebase-apps/rebase-backend:latest .
docker push rg.fr-par.scw.cloud/rebase-apps/rebase-backend:latest
```

L'aggiornamento futuro di Rebase richiede solo una modifica a quella riga `FROM`. Il bundle rimane intatto.

## 3. Distribuisci il Serverless Container

1. Vai su **Serverless Containers**.
2. Fai clic su **Create a Container**.
3. Scegli l'immagine appena caricata.
4. Imposta la porta su **8080** — la porta su cui l'immagine di runtime è in ascolto, a meno che `PORT` non indichi diversamente.
5. Sotto Environment Variables, aggiungi:

| Key | Value |
|-----|-------|
| `DATABASE_URL` | L'URI ottenuto dal passaggio di Managed Postgres |
| `JWT_SECRET` | Una stringa casuale sicura di oltre 32 caratteri per firmare i token di autenticazione |
| `REBASE_SERVICE_KEY` | Una stringa casuale sicura di oltre 32 caratteri |
| `NODE_ENV` | `production` |
| `CORS_ORIGINS` | Il dominio del tuo frontend (ad es. `https://yourdomain.com`) |
| `FRONTEND_URL` | L'URL del tuo frontend (usato per i link nelle email e come fallback per CORS) |
| `DISABLE_SELF_REGISTRATION` | `true` |
| `REBASE_ADMIN_EMAIL` | L'indirizzo del primo amministratore, impostato **prima del primo avvio** |
| `REBASE_ADMIN_PASSWORD` | Almeno 12 caratteri |

Le ultime tre variabili definiscono l'amministratore iniziale: in produzione il primo account a registrarsi non viene promosso automaticamente, quindi nient'altro genererebbe il primo utente autenticato. Consulta [Il tuo primo amministratore](/docs/getting-started/deployment/#your-first-admin). Contrassegna i secret come variabili d'ambiente segrete anziché in chiaro.

6. Punta l'health check su `/livez`. Non su `/health`: quest'ultimo esegue un round-trip verso il database, quindi una liveness probe su di esso riavvierebbe un container altrimenti sano durante una breve instabilità del database.
7. Fai clic su **Deploy Container**.

Scaleway effettua il provisioning del container e fornisce un endpoint pubblico (ad es. `https://rebase-backend-xxxx.functions.fnc.fr-par.scw.cloud`).

*Per una rigorosa conformità dei dati, verifica che i dettagli della tua organizzazione Scaleway riflettano la tua entità aziendale europea.*

## 4. Lo schema

**Il runtime crea le tabelle mancanti all'avvio, incluse quelle delle tue collezioni.** `REBASE_MIGRATE_ON_BOOT` è impostato di default su `ensure`, che è un'operazione additiva sull'intero schema: crea tabelle, colonne e tipi enum mancanti e applica la loro sicurezza a livello di riga (RLS), quindi il primo avvio su un database vuoto inizia subito a servire le tue collezioni.

Ciò che `ensure` non fa mai è modificare elementi già esistenti: non altera il tipo di una colonna, non elimina nulla e non modifica i valori di un enum esistente, poiché il riavvio di un container non deve rimodellare uno schema come effetto collaterale di un deploy.

Due operazioni richiedono quindi ancora l'uso della CLI, eseguita da un checkout locale o da un job di CI con `DATABASE_URL` puntato verso il tuo Managed Database:

```bash
rebase db push
```

- **RLS delle tabelle di giunzione** per le relazioni molti-a-molti.
- **Qualsiasi modifica che non sia puramente additiva** — una colonna rinominata, un tipo ristretto, un campo rimosso.

L'immagine di runtime viene fornita senza la CLI, quindi questo comando non viene mai eseguito all'interno del container. Per le migrazioni con controllo di versione, esegui il commit dei file di migrazione con `rebase db generate` ed esegui invece `rebase db migrate` come passaggio di rilascio.

## Archiviazione dei file

I Serverless Containers non dispongono di un disco permanente, pertanto l'archiviazione locale dei file causerebbe una perdita silenziosa di dati e il runtime la rifiuta in produzione. Scaleway Object Storage è compatibile con S3 e si trova negli stessi datacenter:

```env
STORAGE_TYPE=s3
S3_BUCKET=my-uploads
S3_ENDPOINT=https://s3.fr-par.scw.cloud
S3_REGION=fr-par
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
```

Consulta [Storage](/docs/backend/storage) per una panoramica completa.

## Passaggi successivi

- [Deployment](/docs/getting-started/deployment) — la checklist di produzione e le regole per il primo amministratore condivise da ogni piattaforma.
- [Configurazione](/docs/getting-started/configuration) — tutte le variabili d'ambiente lette dal runtime.

---
