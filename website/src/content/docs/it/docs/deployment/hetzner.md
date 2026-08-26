---
title: Distribuzione di Rebase su Hetzner Cloud
description: Distribuisci Rebase su Hetzner Cloud con Terraform o Docker Compose, per prestazioni europee eccellenti e sovranità dei dati.
sidebar_label: Hetzner Cloud
---

Hetzner Cloud offre un rapporto prestazioni-prezzo notevole ed è una scelta solida per i progetti che richiedono sovranità dei dati europea, con datacenter a Norimberga, Falkenstein ed Helsinki.

Nulla di tutto questo è specifico di Hetzner per quanto riguarda il tuo progetto. Una distribuzione Rebase è fatta di due parti separabili — l'immagine runtime pubblicata e il **bundle** prodotto da `rebase build` — e lo stesso bundle gira sotto Docker Compose su un portatile, su Rebase Cloud, sotto il [chart Helm](/docs/deployment/kubernetes) e su una macchina Hetzner. Passare dall'uno all'altro cambia l'infrastruttura, non l'applicazione.

## La via più rapida: Terraform

Il modulo `terraform-hcloud-rebase` predispone il server, un firewall, un IP stabile e — la parte che conta — un volume che contiene i dati Postgres, così sostituire l'host non distrugge il database.

```hcl
module "rebase" {
  source = "rebasepro/rebase/hcloud"

  domain          = "api.example.com"
  cors_origins    = ["https://app.example.com"]
  ssh_public_keys = [file(pathexpand("~/.ssh/id_ed25519.pub"))]

  bundle_url = "https://storage.example.com/bundles/app-1.4.0.tar.gz"

  s3_bucket            = "example-uploads"
  s3_access_key_id     = var.s3_access_key_id
  s3_secret_access_key = var.s3_secret_access_key
}
```

Una cosa deve essere corretta prima del primo apply: il record A di `domain` deve già puntare al server, altrimenti la sfida Let's Encrypt di Caddy fallisce. L'indirizzo viene creato indipendentemente dal server, quindi puoi ottenerlo prima con `terraform apply -target=hcloud_primary_ip.ipv4`, impostare il DNS e poi applicare davvero.

Il resto di questa pagina è la stessa distribuzione fatta a mano.

## 1. Creare un server

1. Nella console Hetzner Cloud, clicca su **Add Server**.
2. Scegli una **posizione** — Falkenstein, Norimberga o Helsinki per la residenza dei dati nell'UE.
3. Scegli un'**immagine**: Ubuntu 24.04.
4. Scegli un **tipo**: `CPX21` (3 vCPU / 4 GB) è la soglia praticabile, `CX32` (4 vCPU / 8 GB) è comodo per runtime più Postgres.
5. Aggiungi un **volume** per il database. I dati sul disco del server muoiono con il server.
6. Aggiungi la tua chiave SSH e crealo.

## 2. Installare Docker

```bash
ssh root@<ip-del-tuo-server>
apt update && apt install -y docker.io docker-compose-v2
```

## 3. Portare il bundle sul server

Non c'è nessuna immagine applicativa da costruire. `rebase build` produce una directory `dist-bundle`, e l'immagine runtime pubblicata la esegue:

```bash
rebase build
rsync -a dist-bundle/ root@<ip-del-tuo-server>:/opt/rebase/dist-bundle/
```

Per una distribuzione reale, sono preferibili le due forme che non richiedono di copiare file a mano:

- **Includerlo in un'immagine** — `FROM rebasepro/server:0.16.0` e poi `COPY dist-bundle /bundle`; distribuire diventa un cambio di tag.
- **Servirlo via HTTP** — imposta `REBASE_BUNDLE_URL` e il runtime scarica e scompatta il bundle a ogni avvio. È ciò che fa il modulo Terraform qui sopra, ed è lo stesso meccanismo usato dal chart Helm.

## 4. Configurare e avviare

Rebase include un file Compose esattamente per questo: [`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml). È la ricetta canonica di self-hosting — Postgres e il runtime, con il tuo bundle montato — e vale la pena leggerla anziché copiarla, perché i suoi commenti spiegano ogni scelta.

Crea l'ambiente che si aspetta:

```env
POSTGRES_PASSWORD=una_stringa_lunga_e_casuale
JWT_SECRET=un_altra_stringa_lunga_di_almeno_32_caratteri
REBASE_SERVICE_KEY=una_terza_stringa_lunga_di_almeno_32_caratteri
CORS_ORIGINS=https://app.tuodominio.com
```

Poi avvia:

```bash
docker compose -f infra/docker/docker-compose.selfhost.yml --env-file .env up -d
```

Il runtime ascolta sulla porta 8080 all'interno della rete Compose.

`REBASE_SERVICE_KEY` aggira la sicurezza a livello di riga. Trattala come una credenziale da superutente del database, non come una chiave API.

## 5. Terminare TLS con Caddy

Non esporre mai il runtime direttamente. Caddy ottiene i certificati Let's Encrypt automaticamente; eseguirlo come un altro servizio Compose tiene l'intero stack in un solo file:

```yaml
  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports: ["80:80", "443:443", "443:443/udp"]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
```

Con un `Caddyfile` così:

```caddyfile
api.tuodominio.com {
    reverse_proxy api:8080
}
```

Punta il record A di quel dominio al server prima di avviare Caddy, altrimenti la richiesta del certificato fallisce.

## Lo storage non è opzionale

Il runtime **rifiuta di avviarsi in produzione** con lo storage locale configurato, perché il filesystem del container viene distrutto a ogni riavvio e un backend locale in produzione è perdita silenziosa di dati.

Hetzner Object Storage è compatibile con S3 e si trova negli stessi datacenter, quindi è l'abbinamento naturale:

```env
STORAGE_TYPE=s3
S3_BUCKET=my-uploads
S3_ENDPOINT=https://fsn1.your-objectstorage.com
S3_REGION=fsn1
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
```

Se il tuo progetto non memorizza alcun file, imposta `FORCE_LOCAL_STORAGE=true` per riconoscerlo esplicitamente. Vedi [Storage](/docs/backend/storage) per il quadro completo.

## Cosa fa l'avvio al tuo schema

Con `REBASE_MIGRATE_ON_BOOT` al suo valore predefinito `ensure`, il runtime predispone le tabelle delle tue collection **e le loro policy di sicurezza a livello di riga** all'avvio, in modo additivo. Un primo avvio su un database vuoto le serve già — non c'è nessun passaggio di schema da eseguire prima che la distribuzione funzioni.

Ciò che l'avvio deliberatamente non fa mai è qualcosa di distruttivo: non altera il tipo di una colonna, non elimina colonne e non modifica un'etichetta enum esistente. Il riavvio di un container non deve poter rimodellare uno schema come effetto collaterale.

Due cose richiedono quindi ancora [`rebase db push`](/docs/architecture/schema-as-code), eseguito da un checkout o dalla CI, dove il controllo sui cambiamenti distruttivi e un backup sono a portata di mano:

- la RLS delle tabelle di giunzione per le relazioni molti-a-molti;
- qualsiasi modifica che non sia puramente additiva.

Se il modulo o il file Compose hanno legato Postgres al loopback — entrambi lo fanno — raggiungilo tramite un tunnel SSH:

```bash
ssh -N -L 5433:127.0.0.1:5432 root@<ip-del-tuo-server>
```

Una porta di database aperta su internet è il modo in cui le righe di una distribuzione Rebase finiscono per essere lette aggirando la sicurezza a livello di riga anziché attraversarla.

## Aggiornamento

Cambia il tag dell'immagine e riavvia. Il tuo bundle resta intatto, e ogni progetto su quel runtime prende il nuovo motore.

L'eccezione è la versione major di Postgres: Postgres rifiuta di avviarsi su una directory dati scritta da una major precedente, quindi quell'aggiornamento è sempre dump e restore, mai in loco.

```bash
rebase db backup --out ./backups
# ricreare il volume sulla nuova major
rebase db restore ./backups/<file>.dump
```
