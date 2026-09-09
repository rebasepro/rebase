---
sourceHash: 8861ca94a0de827a
title: Distribuzione di Rebase su Hetzner Cloud
description: Esegui il deploy di Rebase su Hetzner Cloud con Terraform o Docker Compose, per prestazioni eccellenti nell'UE e sovranità dei dati.
sidebar_label: Hetzner Cloud
---

Hetzner Cloud offre un rapporto prestazioni-prezzo insolitamente vantaggioso ed è un'ottima scelta per i progetti che richiedono la sovranità dei dati europea, con data center a Norimberga, Falkenstein e Helsinki.

Nulla di ciò che riguarda il tuo progetto è specifico di Hetzner. Un deployment di Rebase è composto da due parti separabili: l'immagine runtime pubblicata e il **bundle** generato da `rebase build` — e lo stesso bundle viene eseguito con Docker Compose su un laptop, su Rebase Cloud, tramite l'[Helm chart](/docs/deployment/kubernetes) e su una macchina Hetzner. Spostarsi tra di essi è un cambio di infrastruttura, non di applicazione.

## La via più rapida: Terraform

Il modulo `terraform-hcloud-rebase` effettua il provisioning del server, di un firewall, di un IP stabile e — la parte fondamentale — di un volume che conserva i dati di Postgres, in modo che la sostituzione dell'host non distrugga il database.

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

Una cosa da verificare prima del primo apply: il record A per `domain` deve già puntare al server, altrimenti il challenge Let's Encrypt di Caddy fallirà. L'indirizzo viene creato indipendentemente dal server, quindi è possibile ottenerlo prima con `terraform apply -target=hcloud_primary_ip.ipv4`, configurare il DNS e poi eseguire l'apply completo.

Il resto di questa pagina illustra lo stesso deployment eseguito manualmente.

## 1. Eseguire il provisioning di un server

1. Nella Hetzner Cloud Console, fai clic su **Add Server**.
2. Scegli una **Location** — Falkenstein, Norimberga o Helsinki per la residenza dei dati nell'UE.
3. Scegli un'**Image**: Ubuntu 24.04.
4. Scegli un **Type**: `CPX21` (3 vCPU / 4 GB) è il minimo utilizzabile, `CX32` (4 vCPU / 8 GB) è confortevole per il runtime più Postgres.
5. Aggiungi un **Volume** per il database. I dati presenti sul disco locale del server andrebbero persi con l'eliminazione del server.
6. Aggiungi la tua chiave SSH e crealo.

## 2. Installare Docker

```bash
ssh root@<your-server-ip>
apt update && apt install -y docker.io docker-compose-v2
```

## 3. Trasferire il bundle sul server

Non c'è alcuna immagine applicativa da compilare. `rebase build` genera una directory `dist-bundle`, e l'immagine runtime pubblicata la esegue:

```bash
rebase build
rsync -a dist-bundle/ root@<your-server-ip>:/opt/rebase/dist-bundle/
```

Per un deployment di produzione, è preferibile una delle due modalità che non richiedono la copia manuale dei file sul server:

- **Incorporarlo in un'immagine** — `FROM rebasepro/server:0.19.1`, poi `COPY dist-bundle /bundle`, ed eseguire il deploy modificando un tag.
- **Distribuirlo tramite HTTP** — imposta `REBASE_BUNDLE_URL` e il runtime scaricherà ed estrarrà il bundle a ogni avvio. Questo è ciò che fa il modulo Terraform sopra citato, ed è lo stesso meccanismo utilizzato dall'Helm chart.

## 4. Configurare ed eseguire

Rebase include un file Compose specifico per questo scopo: [`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml). È la procedura standard di self-hosting — Postgres e il runtime, con il tuo bundle montato all'interno — e vale la pena leggerlo invece di limitarsi a copiarlo, poiché i commenti spiegano ogni scelta effettuata.

Crea l'ambiente previsto:

```env
POSTGRES_PASSWORD=a_long_random_string
JWT_SECRET=another_long_random_string_at_least_32_chars
REBASE_SERVICE_KEY=a_third_long_random_string_at_least_32_chars
CORS_ORIGINS=https://app.yourdomain.com
REBASE_ADMIN_EMAIL=you@yourdomain.com
REBASE_ADMIN_PASSWORD=at_least_twelve_characters
```

`REBASE_ADMIN_EMAIL` e `REBASE_ADMIN_PASSWORD` sono novità: nella versione 0.17.3
il primo account a registrarsi diventa amministratore, anche in produzione.

Tutte e sei le variabili sono obbligatorie — il file Compose le dichiara con `${VAR:?…}` e
si rifiuta di interpolare senza di esse.

Le ultime due definiscono il primo amministratore. Un database nuovo non ha utenti e,
al di fuori della produzione, il primo utente a registrarsi viene promosso ad amministratore — il che
si trasforma in una race condition dal momento in cui il server risponde su un hostname,
poiché Caddy attiva TLS prima che tu possa digitare alcunché. Quindi in produzione quella finestra viene chiusa
e l'account viene specificato qui; il runtime lo crea una sola volta, quando la tabella utenti è vuota,
e non fa nulla a ogni avvio successivo. Accedi e modifica la password.

Quindi avvia i container:

```bash
docker compose -f infra/docker/docker-compose.selfhost.yml --env-file .env up -d
```

Il runtime rimane in ascolto sulla porta 8080 all'interno della rete Compose.

`REBASE_SERVICE_KEY` scavalca la row-level security. Trattala come una credenziale di superuser del database, non come una semplice chiave API.

## 5. Terminare TLS con Caddy

Non esporre mai il runtime direttamente. Caddy esegue il provisioning automatico dei certificati Let's Encrypt; eseguirlo come ulteriore servizio Compose consente di mantenere l'intero stack in un unico file:

```yaml
  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports: ["80:80", "443:443", "443:443/udp"]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
```

Con un `Caddyfile` come segue:

```caddyfile
api.yourdomain.com {
    reverse_proxy api:8080
}
```

Fai puntare il record A del dominio al server prima di avviare Caddy, altrimenti la richiesta del certificato fallirà.

## Lo storage non è opzionale

Il runtime **si rifiuta di avviarsi in produzione** se è configurato lo storage locale, poiché il filesystem del container viene distrutto a ogni riavvio e l'uso di un backend locale in produzione equivale a una perdita silente di dati.

Hetzner Object Storage è compatibile con S3 e si trova negli stessi data center, costituendo quindi l'abbinamento naturale:

```env
STORAGE_TYPE=s3
S3_BUCKET=my-uploads
S3_ENDPOINT=https://fsn1.your-objectstorage.com
S3_REGION=fsn1
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
```

Se il tuo progetto non archivia alcun file di upload, imposta `FORCE_LOCAL_STORAGE=true` per confermarlo esplicitamente. Consulta [Storage](/docs/backend/storage) per una panoramica completa.

## Cosa fa l'avvio al tuo schema

Con `REBASE_MIGRATE_ON_BOOT` impostato sul valore predefinito `ensure`, il runtime effettua il provisioning delle tabelle delle collezioni **e delle relative policy di row-level security** all'avvio, in modalità additiva. Un primo avvio su un database vuoto le rende subito disponibili — non c'è alcun passaggio sullo schema da eseguire prima che il deployment sia operativo.

Ciò che l'avvio non fa mai deliberatamente è qualsiasi operazione distruttiva: non modifica il tipo di una colonna, non elimina una colonna e non modifica l'etichetta di un enum esistente. Il riavvio di un container non deve poter alterare uno schema come effetto collaterale.

Due aspetti richiedono quindi ancora l'esecuzione di [`rebase db push`](/docs/architecture/schema-as-code), avviato da un checkout locale o dalla CI, dove il controllo per i cambiamenti distruttivi e un backup sono accessibili:

- la RLS delle junction table per le relazioni molti-a-molti;
- qualsiasi modifica che non sia puramente additiva.

Se il modulo o il file Compose hanno associato Postgres all'interfaccia di loopback (come fanno entrambi), connettiti tramite un tunnel SSH:

```bash
ssh -N -L 5433:127.0.0.1:5432 root@<your-server-ip>
```

Una porta del database aperta su Internet è il modo in cui i record di un deployment Rebase possono venire letti aggirando la row-level security invece di passarvi attraverso.

## Aggiornamento

Modifica il tag dell'immagine e riavvia. Il tuo bundle rimane intatto e ogni progetto su quel runtime utilizzerà il nuovo motore.

L'eccezione riguarda le major version di Postgres: Postgres si rifiuta di avviarsi su una directory di dati scritta da una versione principale precedente, quindi tale aggiornamento richiede un dump e restore, mai un aggiornamento in-place.

```bash
rebase db backup --out ./backups
# recreate the volume on the new major
rebase db restore ./backups/<file>.dump
```

---
