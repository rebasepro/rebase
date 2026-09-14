---
sourceHash: 93d4b39a9822643d
title: Deploy di Rebase su Hetzner Cloud
description: Esegui il deploy di Rebase su Hetzner Cloud con Terraform o Docker Compose, per prestazioni eccellenti basate nell'UE e sovranità dei dati.
sidebar_label: Hetzner Cloud
---

Hetzner Cloud offre un rapporto prestazioni-prezzo straordinariamente vantaggioso ed è un'ottima scelta per i progetti che richiedono la sovranità dei dati europea, con data center a Norimberga, Falkenstein e Helsinki.

Non c'è nulla di specifico per Hetzner riguardo al tuo progetto. Una distribuzione di Rebase è composta da due parti separabili: l'immagine di runtime pubblicata e il **bundle** prodotto da `rebase build`; lo stesso bundle viene eseguito con Docker Compose su un laptop, su Rebase Cloud, tramite l'[Helm chart](/docs/deployment/kubernetes) e su un'istanza Hetzner. Spostarsi tra di essi è un cambio di infrastruttura, non di applicazione.

## Il percorso più rapido: Terraform

Il modulo `terraform-hcloud-rebase` effettua il provisioning del server, di un firewall, di un IP stabile e — la parte fondamentale — di un volume per i dati di Postgres, in modo che la sostituzione dell'host non distrugga il database.

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

Una cosa da verificare prima del primo apply: il record A per `domain` deve già puntare al server, altrimenti la verifica (challenge) di Let's Encrypt di Caddy fallirà. L'indirizzo viene creato indipendentemente dal server, quindi puoi ottenerlo prima con `terraform apply -target=hcloud_primary_ip.ipv4`, configurare il DNS e poi eseguire l'apply regolarmente.

Il resto di questa pagina illustra lo stesso deploy eseguito manualmente.

## 1. Effettuare il provisioning di un server

1. Nella Console Hetzner Cloud, fai clic su **Add Server**.
2. Scegli una **Location** — Falkenstein, Norimberga o Helsinki per la residenza dei dati nell'UE.
3. Scegli un'**Image**: Ubuntu 24.04.
4. Scegli un **Type**: `CPX21` (3 vCPU / 4 GB) è una base di partenza adeguata, `CX32` (4 vCPU / 8 GB) è confortevole per il runtime più Postgres.
5. Aggiungi un **Volume** per il database. I dati presenti sul disco locale del server andrebbero persi con l'eliminazione del server.
6. Aggiungi la tua chiave SSH e crealo.

## 2. Installare Docker

```bash
ssh root@<your-server-ip>
apt update && apt install -y docker.io docker-compose-v2
```

## 3. Trasferire il bundle sul server

Non è necessario compilare un'immagine dell'applicazione. `rebase build` genera una directory `dist-bundle`, che viene eseguita dall'immagine di runtime pubblicata:

```bash
rebase build
rsync -a dist-bundle/ root@<your-server-ip>:/opt/rebase/dist-bundle/
```

Per una distribuzione in ambiente reale, prediligi uno dei due approcci che non richiedono la copia manuale dei file sul server:

- **Includilo in un'immagine** — `FROM rebasepro/server:0.21.0` seguito da `COPY dist-bundle /bundle`, e distribuisci aggiornando un tag.
- **Distribuiscilo via HTTP** — imposta `REBASE_BUNDLE_URL` e il runtime scaricherà ed estrarrà il bundle a ogni avvio. È ciò che fa il modulo Terraform descritto sopra ed è lo stesso meccanismo utilizzato dall'Helm chart.

## 4. Configurare ed eseguire

Rebase fornisce un file Compose proprio per questo scopo: [`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml). È la procedura canonica per il self-hosting — Postgres e il runtime, con il bundle montato all'interno — e vale la pena leggerlo invece di limitarsi a copiarlo, poiché i commenti spiegano ogni singola scelta.

Crea l'ambiente previsto:

```env
POSTGRES_PASSWORD=a_long_random_string
JWT_SECRET=another_long_random_string_at_least_32_chars
REBASE_SERVICE_KEY=a_third_long_random_string_at_least_32_chars
CORS_ORIGINS=https://app.yourdomain.com
REBASE_ADMIN_EMAIL=you@yourdomain.com
REBASE_ADMIN_PASSWORD=at_least_twelve_characters
```

`REBASE_ADMIN_EMAIL` e `REBASE_ADMIN_PASSWORD` sono nuovi: nella versione 0.17.3
il primo account a registrarsi diventa amministratore, anche in produzione.

Tutte e sei le variabili sono obbligatorie: il file Compose le dichiara con `${VAR:?…}` e
rifiuta l'interpolazione se sono assenti.

Le ultime due definiscono il primo amministratore. Un database nuovo non ha utenti e,
al di fuori della produzione, la prima registrazione viene promossa ad amministratore — creando
una race condition nel momento in cui la macchina risponde su un hostname, dato che Caddy
attiva TLS prima ancora che tu possa digitare qualcosa. Di conseguenza, in produzione questa
finestra viene chiusa e l'account viene specificato qui; il runtime lo crea una sola volta,
quando la tabella degli utenti è vuota, e non fa nulla a ogni avvio successivo. Accedi e
modifica la password.

Quindi avvia i servizi:

```bash
docker compose -f infra/docker/docker-compose.selfhost.yml --env-file .env up -d
```

Il runtime rimane in ascolto sulla porta 8080 all'interno della rete Compose.

`REBASE_SERVICE_KEY` bypassa la row-level security. Trattala come una credenziale da superuser del database, non come una semplice chiave API.

## 5. Terminare TLS con Caddy

Non esporre mai direttamente il runtime. Caddy effettua il provisioning dei certificati Let's Encrypt automaticamente; eseguirlo come ulteriore servizio Compose consente di mantenere l'intero stack in un unico file:

```yaml
  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports: ["80:80", "443:443", "443:443/udp"]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
```

Con un `Caddyfile` simile a:

```caddyfile
api.yourdomain.com {
    reverse_proxy api:8080
}
```

Fai puntare il record A del dominio al server prima di avviare Caddy, altrimenti la richiesta del certificato fallirà.

## Lo storage non è opzionale

Il runtime **si rifiuta di avviarsi in produzione** se è configurato lo storage locale, poiché il filesystem del container viene distrutto a ogni riavvio e un backend locale in produzione causerebbe una perdita silenziosa di dati.

L'Object Storage di Hetzner è compatibile con S3 e risiede negli stessi data center, rappresentando quindi l'abbinamento naturale:

```env
STORAGE_TYPE=s3
S3_BUCKET=my-uploads
S3_ENDPOINT=https://fsn1.your-objectstorage.com
S3_REGION=fsn1
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
```

Se il tuo progetto non gestisce alcun caricamento di file, imposta `FORCE_LOCAL_STORAGE=true` per confermarlo esplicitamente. Consulta [Storage](/docs/backend/storage) per il quadro completo.

## Cosa comporta l'avvio per il tuo schema

Con `REBASE_MIGRATE_ON_BOOT` impostato sul valore predefinito `ensure`, il runtime effettua il provisioning delle tabelle delle collezioni **e delle relative policy di row-level security** all'avvio, in modalità incrementale. Al primo avvio su un database vuoto, il sistema le rende subito disponibili: non c'è alcun passaggio di schema da eseguire prima che il deploy sia funzionante.

Ciò che la procedura di avvio evita deliberatamente è qualsiasi operazione distruttiva: non modifica il tipo di una colonna, non elimina colonne né modifica i valori di un enum esistente. Il riavvio di un container non deve poter alterare lo schema come effetto collaterale.

Due cose richiedono quindi ancora l'esecuzione di [`rebase db push`](/docs/architecture/schema-as-code), avviato da un checkout locale o dalla CI, dove il controllo per i cambiamenti distruttivi e un backup siano a portata di mano:

- la RLS delle tabelle di giunzione per le relazioni molti-a-molti;
- qualsiasi modifica che non sia puramente additiva.

Se il modulo o il file Compose hanno associato Postgres all'interfaccia di loopback (come fanno entrambi), connettiti tramite un tunnel SSH:

```bash
ssh -N -L 5433:127.0.0.1:5432 root@<your-server-ip>
```

Lasciare aperta verso Internet la porta del database è il modo in cui le righe di un deploy Rebase finiscono per essere lette eludendo la row-level security anziché passando attraverso di essa.

## Aggiornamento

Aggiorna il tag dell'immagine e riavvia. Il tuo bundle rimane invariato e ogni progetto basato su tale runtime utilizzerà il nuovo motore.

L'eccezione è la versione major di Postgres: Postgres si rifiuta di avviarsi su una directory di dati creata da una versione major precedente, pertanto tale aggiornamento richiede una procedura di dump e restore, mai sul posto (in place).

```bash
rebase db backup --out ./backups
# recreate the volume on the new major
rebase db restore ./backups/<file>.dump
```
