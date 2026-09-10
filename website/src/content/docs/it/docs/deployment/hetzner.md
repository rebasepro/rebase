---
sourceHash: 39e0a58a37e930cb
title: Deploy di Rebase su Hetzner Cloud
description: Esegui il deploy di Rebase su Hetzner Cloud con Terraform o Docker Compose, per prestazioni eccellenti basate nell'UE e sovranità dei dati.
sidebar_label: Hetzner Cloud
---

Hetzner Cloud offre un rapporto prestazioni-prezzo straordinario ed è un'ottima scelta per i progetti che richiedono la sovranità dei dati europea, con data center a Norimberga, Falkenstein e Helsinki.

Nulla di ciò che riguarda il tuo progetto è specifico di Hetzner. Una distribuzione di Rebase è composta da due elementi separabili: l'immagine runtime pubblicata e il **bundle** prodotto da `rebase build`; lo stesso bundle funziona con Docker Compose su un laptop, su Rebase Cloud, tramite l'[Helm chart](/docs/deployment/kubernetes) e su una macchina Hetzner. Il passaggio da uno all'altro comporta una modifica dell'infrastruttura, non dell'applicazione.

## La via più rapida: Terraform

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

Un aspetto da verificare prima della prima esecuzione di apply: il record A per `domain` deve già puntare al server, altrimenti la verifica (challenge) Let's Encrypt di Caddy fallirà. L'indirizzo viene creato indipendentemente dal server, quindi puoi ottenerlo preventivamente con `terraform apply -target=hcloud_primary_ip.ipv4`, configurare il DNS e poi applicare la configurazione completa.

Il resto di questa pagina illustra la stessa procedura di distribuzione eseguita manualmente.

## 1. Eseguire il provisioning di un server

1. Nella Hetzner Cloud Console, fai clic su **Add Server**.
2. Scegli una **Location** — Falkenstein, Norimberga o Helsinki per la residenza dei dati nell'UE.
3. Scegli un'**Image**: Ubuntu 24.04.
4. Scegli un **Type**: `CPX21` (3 vCPU / 4 GB) è un minimo praticabile, `CX32` (4 vCPU / 8 GB) è confortevole per il runtime più Postgres.
5. Aggiungi un **Volume** per il database. I dati sul disco locale del server vanno persi insieme al server.
6. Aggiungi la tua chiave SSH e procedi con la creazione.

## 2. Installare Docker

```bash
ssh root@<your-server-ip>
apt update && apt install -y docker.io docker-compose-v2
```

## 3. Trasferire il bundle sul server

Non è necessario compilare alcuna immagine dell'applicazione. `rebase build` genera una directory `dist-bundle`, e l'immagine del runtime pubblicata la esegue:

```bash
rebase build
rsync -a dist-bundle/ root@<your-server-ip>:/opt/rebase/dist-bundle/
```

Per una distribuzione in produzione reale, è preferibile una delle due modalità che non richiedono la copia manuale dei file sul server:

- **Integrarlo in un'immagine (bake-in)** — `FROM rebasepro/server:0.20.0`, poi `COPY dist-bundle /bundle`, ed eseguire il deploy modificando un tag.
- **Distribuirlo via HTTP** — imposta `REBASE_BUNDLE_URL` e il runtime scaricherà ed estrarrà il bundle a ogni avvio. Questo è quanto fa il modulo Terraform descritto sopra, ed è lo stesso meccanismo utilizzato dall'Helm chart.

## 4. Configurare ed eseguire

Rebase fornisce un file Compose appositamente per questo: [`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml). Si tratta della ricetta canonica di self-hosting — Postgres e il runtime, con il bundle montato all'interno — e vale la pena leggerlo anziché limitarsi a copiarlo, poiché i commenti spiegano ogni singola scelta.

Crea l'ambiente previsto:

```env
POSTGRES_PASSWORD=a_long_random_string
JWT_SECRET=another_long_random_string_at_least_32_chars
REBASE_SERVICE_KEY=a_third_long_random_string_at_least_32_chars
CORS_ORIGINS=https://app.yourdomain.com
REBASE_ADMIN_EMAIL=you@yourdomain.com
REBASE_ADMIN_PASSWORD=at_least_twelve_characters
```

`REBASE_ADMIN_EMAIL` e `REBASE_ADMIN_PASSWORD` sono nuove: nella 0.17.3
il primo account a registrarsi diventa amministratore, anche in produzione.

Tutte e sei sono obbligatorie: il file Compose le dichiara con `${VAR:?…}` e
rifiuta l'interpolazione in loro assenza.

Le ultime due definiscono il primo amministratore. Un database appena creato non ha utenti e,
al di fuori della produzione, il primo utente a registrarsi viene promosso ad amministratore: il che crea una race condition non appena la macchina risponde a un hostname, dato che Caddy attiva TLS prima che tu abbia digitato qualsiasi cosa. In produzione, quindi, questa finestra temporale viene chiusa e l'account viene specificato qui; il runtime lo crea una sola volta, mentre la tabella utenti è vuota, e non compie alcuna azione ai successivi avvii. Accedi e modifica la password.

Quindi avvialo:

```bash
docker compose -f infra/docker/docker-compose.selfhost.yml --env-file .env up -d
```

Il runtime è in ascolto sulla porta 8080 all'interno della rete Compose.

`REBASE_SERVICE_KEY` ignora la row-level security. Trattala come la credenziale di un superutente del database, non come una semplice chiave API.

## 5. Terminare TLS con Caddy

Non esporre mai direttamente il runtime. Caddy richiede e gestisce automaticamente i certificati Let's Encrypt; eseguirlo come ulteriore servizio Compose consente di mantenere l'intero stack in un unico file:

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

Il runtime **si rifiuta di avviarsi in produzione** se è configurato lo storage locale, poiché il filesystem del container viene distrutto a ogni riavvio e un backend locale in produzione equivale a una perdita silenziosa di dati.

Hetzner Object Storage è compatibile con S3 e si trova negli stessi data center, rappresentando quindi l'abbinamento naturale:

```env
STORAGE_TYPE=s3
S3_BUCKET=my-uploads
S3_ENDPOINT=https://fsn1.your-objectstorage.com
S3_REGION=fsn1
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
```

Se il tuo progetto non gestisce alcun file caricato, imposta `FORCE_LOCAL_STORAGE=true` per confermarlo esplicitamente. Consulta [Storage](/docs/backend/storage) per una panoramica completa.

## Cosa fa l'avvio allo schema

Con `REBASE_MIGRATE_ON_BOOT` impostato sul valore predefinito `ensure`, all'avvio il runtime effettua il provisioning delle tabelle delle collezioni **e delle relative policy di row-level security** in modo additivo. Un primo avvio su un database vuoto le rende subito disponibili: non è necessario eseguire alcun passaggio preliminare sullo schema prima che il deploy sia funzionante.

Ciò che l'avvio deliberatamente non fa mai è compiere azioni distruttive: non modifica il tipo di una colonna, non elimina colonne né modifica i valori di un enum esistente. Il riavvio di un container non deve poter alterare lo schema come effetto collaterale.

Due operazioni richiedono quindi ancora l'esecuzione di [`rebase db push`](/docs/architecture/schema-as-code), lanciato da una copia locale del repository o dalla CI, dove il controllo per i cambiamenti distruttivi e un backup siano a portata di mano:

- la RLS sulle junction table per le relazioni molti-a-molti;
- qualsiasi modifica che non sia puramente additiva.

Se il modulo o il file Compose collegano Postgres all'interfaccia di loopback — come fanno entrambi —, raggiungilo tramite un tunnel SSH:

```bash
ssh -N -L 5433:127.0.0.1:5432 root@<your-server-ip>
```

Una porta del database esposta a Internet è il modo in cui una distribuzione Rebase rischia di farsi leggere i record aggirando la row-level security invece di passarvi attraverso.

## Aggiornamento

Modifica il tag dell'immagine e riavvia. Il tuo bundle rimane intatto e ogni progetto su quel runtime utilizzerà il nuovo motore.

L'eccezione riguarda le major release di Postgres: Postgres rifiuta di avviarsi a partire da una directory di dati scritta da una versione major precedente, pertanto tale aggiornamento richiede un dump e un restore, mai un aggiornamento sul posto (in place).

```bash
rebase db backup --out ./backups
# recreate the volume on the new major
rebase db restore ./backups/<file>.dump
```

---
