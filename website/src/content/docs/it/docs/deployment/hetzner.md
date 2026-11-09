---
sourceHash: 1ce958efc53ce606
title: Deploy di Rebase su Hetzner Cloud
description: Effettua il deploy di un progetto Rebase su un singolo server Hetzner Cloud con il relativo file Docker Compose e Caddy per HTTPS, oppure eseguine il provisioning con Terraform, per un hosting basato nell'UE.
sidebar_label: Hetzner Cloud
---

Hetzner Cloud offre un rapporto prestazioni-prezzo straordinariamente vantaggioso ed è un'ottima scelta per i progetti che richiedono la sovranità dei dati europea, grazie ai data center situati a Norimberga, Falkenstein ed Helsinki.

Non c'è nulla di specifico per Hetzner nel tuo progetto. Un deploy di Rebase è composto da due parti separabili: l'immagine di runtime pubblicata e il **bundle** prodotto da `rebase build`. Lo stesso bundle viene eseguito tramite Docker Compose su un portatile, su Rebase Cloud, tramite l'[Helm chart](/docs/deployment/kubernetes) e su una macchina Hetzner. Il passaggio da una soluzione all'altra rappresenta una modifica dell'infrastruttura, non dell'applicazione.

Due modi per configurarlo:

- **[Un solo server, partendo dal tuo progetto](#un-solo-server-partendo-dal-tuo-progetto):** il file `docker-compose.yml` generato da `rebase init`, su un server creato manualmente. I file caricati rimangono sul disco del server.
- **[Terraform](#terraform):** un modulo che effettua il provisioning di server, firewall, IP, TLS e di un volume che sopravvive all'host.

## Un solo server, partendo dal tuo progetto

Un progetto creato con `rebase init` include già la configurazione per il deploy: un file `docker-compose.yml` che esegue Postgres e il runtime pubblicato con il bundle montato al suo interno, serve il pannello di amministrazione su `/` e l'API su `/api` da un unico container, e conserva gli upload su un volume. Questa sezione spiega come posizionare questo file su un server e configurare Caddy come reverse proxy per HTTPS.

### 1. Crea il server

1. Nella console di Hetzner Cloud, fai clic su **Add Server**.
2. Scegli una **Location**: Falkenstein, Norimberga o Helsinki per la residenza dei dati nell'UE.
3. Scegli l'immagine **Ubuntu 24.04**.
4. Scegli una tipologia con almeno **2 vCPU e 4 GB di RAM**. Il runtime, Postgres e Caddy li condivideranno.
5. Abilita i **Backup**. Il database e i file caricati risiedono sul disco di questo server, e i backup sono ciò che ti permette di ripristinarli in caso di guasto.
6. Aggiungi la tua chiave SSH e crea il server.

Punta subito un record A per il tuo dominio — di seguito `app.example.com` — verso l'indirizzo del server. Caddy ne ha bisogno per ottenere il certificato.

### 2. Installa Docker e Caddy

```bash
ssh root@<server-ip>
apt update && apt install -y docker.io docker-compose-v2 caddy
mkdir -p /opt/my-app
```

### 3. Compila il bundle e copialo sul server

Dalla cartella del tuo progetto, sulla tua macchina:

```bash
rebase build
rsync -a docker-compose.yml .env dist-bundle root@<server-ip>:/opt/my-app/
```

`rebase build` compila le tue collection, funzioni e cron job all'interno di `dist-bundle/`, insieme alle loro dipendenze e al pannello di amministrazione compilato. Non c'è alcuna immagine dell'applicazione da compilare: il server esegue l'immagine di runtime pubblicata con quella directory montata al suo interno.

### 4. Configura l'ambiente per la produzione

Sul server, modifica `/opt/my-app/.env`. `rebase init` lo ha precompilato per il tuo computer locale. Modifica queste righe:

```env
CORS_ORIGINS=https://app.example.com
REBASE_ADMIN_EMAIL=you@example.com
```

Mantieni i valori generati per `DATABASE_PASSWORD`, `JWT_SECRET`, `REBASE_SERVICE_KEY` e `REBASE_ADMIN_PASSWORD`, oppure sostituiscili con nuovi valori generati tramite `openssl rand -hex 32`. Il file Compose li legge da qui e si arresta segnalando eventuali valori mancanti.

Il file passa al servizio `api` solo le variabili dichiarate esplicitamente, quindi il resto di `.env` — compreso `NODE_ENV=development` — non raggiunge il runtime. Il servizio viene eseguito con `NODE_ENV=production`. Una variabile non inclusa nell'elenco va inserita nel blocco `environment:` del servizio.

`REBASE_ADMIN_EMAIL` e `REBASE_ADMIN_PASSWORD` definiscono il primo amministratore. In produzione, il primo account che si registra non viene promosso automaticamente; pertanto, il runtime crea questo account al primo avvio, quando la tabella degli utenti è ancora vuota. Accedi con queste credenziali e cambia la password. Consulta [Il tuo primo amministratore](/docs/getting-started/deployment/#your-first-admin).

Successivamente, in `/opt/my-app/docker-compose.yml`, associa entrambe le porte pubblicate all'interfaccia di loopback:

```yaml
  db:
    ports:
      - "127.0.0.1:5490:5432"
  api:
    ports:
      - "127.0.0.1:${PORT:-3001}:3001"
```

Così come viene generato, il file pubblica Postgres e l'API su tutte le interfacce di rete, il che su un portatile è innocuo. Su un server pubblico, però, questo esporrebbe il database su internet, e Docker pubblica le porte scavalcando `ufw`, impedendo alle regole del firewall di bloccarle. Con `127.0.0.1`, solo Caddy e i tunnel SSH potranno raggiungerle.

### 5. Avvia i servizi

```bash
cd /opt/my-app
docker compose up -d
```

Al primo avvio vengono create tutte le tabelle necessarie, comprese quelle delle tue collection, insieme alle relative policy di row-level security.

### 6. Configura TLS con Caddy

Sostituisci il contenuto di `/etc/caddy/Caddyfile` con:

```caddyfile
app.example.com {
    reverse_proxy 127.0.0.1:3001
}
```

```bash
systemctl reload caddy
```

Caddy ottiene un certificato Let's Encrypt per il dominio e lo rinnova automaticamente. Apri `https://app.example.com` ed effettua l'accesso.

### Deploy successivi

Riesegui la build, copia il bundle e riavvia il runtime:

```bash
rebase build
rsync -a --delete dist-bundle/ root@<server-ip>:/opt/my-app/dist-bundle/
ssh root@<server-ip> 'cd /opt/my-app && docker compose restart api'
```

Copiare manualmente una directory su una macchina va bene per un singolo server. Oltre questa scala, conviene utilizzare una delle modalità che non richiedono questo passaggio:

- **Includilo in un'immagine.** Usa `FROM rebasepro/server:0.29.1`, poi `COPY --chown=node:node dist-bundle /bundle`, ed effettua il deploy aggiornando semplicemente il tag.
- **Servilo via HTTP.** Imposta `REBASE_BUNDLE_URL`: il runtime scaricherà ed estrarrà il bundle a ogni avvio. Il modulo Terraform descritto di seguito adotta questo approccio, e l'Helm chart sfrutta lo stesso meccanismo.

## Terraform

Il modulo `terraform-hcloud-rebase` effettua il provisioning del server, di un firewall, di un IP statico e — la parte fondamentale — di un volume per i dati di Postgres, in modo che la sostituzione dell'host non comporti la perdita del database. Esegue il runtime pubblicato tramite Docker Compose con Caddy come reverse proxy, e scarica il bundle da un URL.

Il modulo non è presente sul Terraform Registry. Utilizzalo direttamente dal repository di Rebase, bloccato a una specifica release:

```hcl
module "rebase" {
  source = "git::https://github.com/rebasepro/rebase.git//infra/terraform-hcloud-rebase?ref=v0.28.2"

  domain          = "api.example.com"
  cors_origins    = ["https://app.example.com"]
  ssh_public_keys = [file(pathexpand("~/.ssh/id_ed25519.pub"))]
  admin_email     = "you@example.com"

  bundle_url      = "https://storage.example.com/bundles/app-1.4.0.tar.gz"
  runtime_version = "0.29.1" # required with bundle_url: `latest` is refused at plan

  s3_bucket            = "example-uploads"
  s3_access_key_id     = var.s3_access_key_id
  s3_secret_access_key = var.s3_secret_access_key
}
```

Un aspetto essenziale prima del primo apply: il record A per `domain` deve già puntare al server, altrimenti la verifica Let's Encrypt di Caddy fallirà. L'indirizzo IP viene creato indipendentemente dal server, quindi puoi crearlo per primo con `terraform apply -target=module.rebase.hcloud_primary_ip.ipv4`, configurare il DNS e poi eseguire l'apply completo.

Il file [README](https://github.com/rebasepro/rebase/tree/main/infra/terraform-hcloud-rebase) del modulo elenca tutte le variabili disponibili.

## Storage dei file

**I file caricati possono rimanere sul server.** Il file Compose del progetto li conserva su un volume con nome, montato in `/storage`, e imposta `FORCE_LOCAL_STORAGE=true`. In questo modo sopravvivono ai riavvii e ai nuovi deploy. Non sopravvivono però alla perdita del server: è a questo che servono i backup di Hetzner.

Senza tale impostazione, il runtime rifiuta lo storage locale in produzione. Sulla maggior parte delle piattaforme basate su container il filesystem viene ricreato a ogni deploy, quindi l'uso di un backend locale comporterebbe una perdita silente di dati. In tal caso, i caricamenti restituiranno `501 STORAGE_NOT_CONFIGURED` fino a quando non verrà configurato un bucket.

Quando lo spazio su un singolo disco non è più sufficiente, o si aggiunge un secondo server, trasferisci i file su Hetzner Object Storage. È compatibile con S3 e si trova negli stessi data center. Nel blocco `environment:` del servizio `api`, sostituisci `STORAGE_PATH` e `FORCE_LOCAL_STORAGE` con:

```yaml
      STORAGE_TYPE: s3
      S3_BUCKET: my-uploads
      S3_ENDPOINT: https://fsn1.your-objectstorage.com
      S3_REGION: fsn1
      S3_ACCESS_KEY_ID: ${S3_ACCESS_KEY_ID}
      S3_SECRET_ACCESS_KEY: ${S3_SECRET_ACCESS_KEY}
```

inserendo le due chiavi nel file `.env`. I file già presenti sul volume non vengono trasferiti automaticamente: copiali nel bucket, mantenendo le rispettive chiavi.

Il modulo Terraform offre la stessa scelta tramite variabili: un bucket S3 oppure `force_local_storage = true`, che conserva gli upload sul proprio volume dati. Consulta [Storage](/docs/backend/storage) per una panoramica completa.

## Cosa accade allo schema all'avvio

Quando `REBASE_MIGRATE_ON_BOOT` è impostato sul valore predefinito `ensure`, il runtime effettua all'avvio il provisioning delle tabelle delle tue collection **e delle relative policy di row-level security**, in modo puramente incrementale. Una nuova collection è subito disponibile al deploy successivo, senza dover eseguire prima passaggi manuali sullo schema.

Ciò che l'avvio non fa mai, intenzionalmente, sono operazioni distruttive: non altera il tipo di una colonna, non elimina colonne e non modifica i valori di un enum esistente. Il riavvio di un container non deve poter alterare lo schema come effetto collaterale.

Per questo motivo, c'è un'operazione che richiede ancora l'uso di [`rebase db push`](/docs/architecture/schema-as-code): qualsiasi modifica che non sia strettamente additiva — una colonna rinominata, un tipo di dato ristretto, un campo rimosso. Eseguila dalla tua copia locale del codice, tramite un tunnel SSH verso la porta di loopback:

```bash
ssh -N -L 5490:127.0.0.1:5490 root@<server-ip>
pnpm exec rebase db push --dry-run \
  --database-url 'postgresql://rebase_app:<DATABASE_PASSWORD>@localhost:5490/rebase?sslmode=disable'
```

Controlla l'SQL generato dalla dry run, quindi riesegui il comando senza `--dry-run`. Il parametro `sslmode=disable` è necessario perché il database Compose non utilizza TLS; la connessione è già cifrata dal tunnel.

Una porta del database esposta su internet consente di aggirare le policy di row-level security anziché passarvi attraverso. Mantienila legata all'interfaccia di loopback e utilizza il tunnel.

## Aggiornamento

Modifica `REBASE_VERSION` in `.env` e ricrea il runtime:

```bash
docker compose pull api && docker compose up -d api
```

Il tuo bundle rimarrà inalterato.

L'eccezione riguarda i cambi di major version di Postgres: Postgres rifiuta l'avvio su una directory di dati scritta da una versione principale precedente, pertanto tale aggiornamento richiede una procedura di dump e restore, mai sul posto.

```bash
rebase db backup --out ./backups
# recreate the volume on the new major
rebase db restore ./backups/<file>.dump
```

## Passaggi successivi

- [Deploy](/docs/getting-started/deployment) — la checklist per la produzione e le regole per il primo amministratore comuni a tutte le piattaforme.
- [Self-hosting](/docs/deployment/self-hosting) — la stessa architettura di deploy senza scaffolding aggiuntivo, con connection pooler e processi separati.
- [Configurazione](/docs/getting-started/configuration) — tutte le variabili d'ambiente lette dal runtime.
