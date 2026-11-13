---
sourceHash: 23edfa071775b304
title: Deploy di Rebase su Hetzner Cloud
description: Esegui il deploy di un progetto Rebase su un server Hetzner Cloud con il proprio file Docker Compose e Caddy per HTTPS, oppure effettua il provisioning con Terraform, per un hosting basato nell'UE.
sidebar_label: Hetzner Cloud
---

Hetzner Cloud offre un rapporto prestazioni-prezzo eccezionalmente vantaggioso ed è un'ottima scelta per i progetti che richiedono la sovranità dei dati europea, grazie ai data center situati a Norimberga, Falkenstein e Helsinki.

Non c'è nulla di specifico per Hetzner riguardo al tuo progetto. Un deployment di Rebase è composto da due parti separabili: l'immagine di runtime pubblicata e il **bundle** prodotto da `rebase build`; lo stesso bundle può essere eseguito con Docker Compose su un laptop, su Rebase Cloud, tramite l'[Helm chart](/docs/deployment/kubernetes) e su una macchina Hetzner. Passare da uno all'altro è un cambiamento di infrastruttura, non di applicazione.

Due modalità per procedere:

- **[Un solo server, dal tuo progetto](#un-solo-server-dal-tuo-progetto):** il file `docker-compose.yml` generato da `rebase init`, su un server creato manualmente. I file caricati rimangono sul disco del server.
- **[Terraform](#terraform):** un modulo che effettua il provisioning di server, firewall, IP, TLS e di un volume che sopravvive all'host.

## Un solo server, dal tuo progetto

Un progetto creato con `rebase init` include già la configurazione di deployment: un file `docker-compose.yml` che esegue Postgres e il runtime pubblicato con il bundle montato, serve il pannello di amministrazione su `/` e l'API su `/api` da un unico container, e conserva gli upload su un volume. Questa sezione spiega come collocare quel file su un server e configurare Caddy come reverse proxy per HTTPS.

### 1. Crea il server

1. Nella Hetzner Cloud Console, fai clic su **Add Server**.
2. Scegli una **Location**: Falkenstein, Norimberga o Helsinki per garantire la residenza dei dati nell'UE.
3. Scegli l'immagine **Ubuntu 24.04**.
4. Scegli una tipologia con almeno **2 vCPU e 4 GB di RAM**. Il runtime, Postgres e Caddy le condivideranno.
5. Attiva **Backups**. Il database e gli upload risiedono sul disco di questo server, e i backup sono l'unica risorsa per far fronte alla sua perdita.
6. Aggiungi la tua chiave SSH e procedi con la creazione.

Punta subito un record A per il tuo dominio — `app.example.com` nell'esempio sottostante — verso l'indirizzo IP del server. Caddy ne ha bisogno per ottenere il certificato.

### 2. Installa Docker e Caddy

```bash
ssh root@<server-ip>
apt update && apt install -y docker.io docker-compose-v2 caddy
mkdir -p /opt/my-app
```

### 3. Compila il bundle e copialo sul server

Dal tuo progetto, sul tuo computer locale:

```bash
rebase build
rsync -a docker-compose.yml .env dist-bundle root@<server-ip>:/opt/my-app/
```

`rebase build` compila le tabelle, le funzioni e i cron all'interno di `dist-bundle/`, insieme alle relative dipendenze e al pannello di amministrazione compilato. Non è necessario compilare alcuna immagine applicativa: il server esegue l'immagine di runtime pubblicata montando al suo interno tale directory.

### 4. Adatta la configurazione per la produzione

Sul server, modifica `/opt/my-app/.env`. `rebase init` lo ha precompilato per lo sviluppo in locale. Modifica queste righe:

```env
CORS_ORIGINS=https://app.example.com
REBASE_ADMIN_EMAIL=you@example.com
```

Mantieni i valori generati di `DATABASE_PASSWORD`, `JWT_SECRET`, `REBASE_SERVICE_KEY` e `REBASE_ADMIN_PASSWORD`, oppure sostituiscili con nuovi valori generati tramite `openssl rand -hex 32`. Il file Compose li leggerà da qui e si arresterà segnalando eventuali variabili mancanti.

Il file passa al servizio `api` solo le variabili dichiarate esplicitamente, quindi il resto di `.env` — compreso `NODE_ENV=development` — non raggiungerà il runtime. Il servizio viene eseguito con `NODE_ENV=production`. Qualsiasi variabile non inclusa nel file va inserita nel blocco `environment:` del servizio.

`REBASE_ADMIN_EMAIL` e `REBASE_ADMIN_PASSWORD` definiscono il primo amministratore. In produzione il primo account che si registra non viene promosso ad amministratore; il runtime crea invece questo account iniziale al primo avvio, quando la tabella utenti è ancora vuota. Accedi con queste credenziali e modifica la password. Consulta [Your first admin](/docs/getting-started/deployment/#your-first-admin).

Successivamente, in `/opt/my-app/docker-compose.yml`, associa entrambe le porte pubblicate all'interfaccia di loopback:

```yaml
  db:
    ports:
      - "127.0.0.1:5490:5432"
  api:
    ports:
      - "127.0.0.1:${PORT:-3001}:3001"
```

Nel formato generato, il file pubblica Postgres e l'API su tutte le interfacce di rete, il che su una macchina locale è innocuo. Su un server pubblico, tuttavia, questo esporrebbe il database su Internet; inoltre, Docker pubblica le porte scavalcando `ufw`, impedendo alle regole del firewall di bloccarle. Vincolandole a `127.0.0.1`, solo Caddy e i tunnel SSH potranno accedervi.

### 5. Avvia i servizi

```bash
cd /opt/my-app
docker compose up -d
```

Al primo avvio verranno create tutte le tabelle necessarie, comprese le tue, insieme alle rispettive policy di row-level security.

### 6. Termina TLS con Caddy

Sostituisci il contenuto di `/etc/caddy/Caddyfile` con:

```caddyfile
app.example.com {
    reverse_proxy 127.0.0.1:3001
}
```

```bash
systemctl reload caddy
```

Caddy richiederà e rinnoverà automaticamente un certificato Let's Encrypt per il dominio. Apri `https://app.example.com` ed esegui l'accesso.

### Deploy successivi

Ricompila, copia il bundle e riavvia il runtime:

```bash
rebase build
rsync -a --delete dist-bundle/ root@<server-ip>:/opt/my-app/dist-bundle/
ssh root@<server-ip> 'cd /opt/my-app && docker compose restart api'
```

Copiare manualmente una directory sulla macchina è sufficiente per un singolo server. Se le esigenze aumentano, prendi in considerazione approcci alternativi:

- **Includi il bundle nell'immagine.** `FROM rebasepro/server:0.30.1`, seguito da `COPY --chown=node:node dist-bundle /bundle`, distribuendo poi tramite l'aggiornamento del tag dell'immagine.
- **Distribuisci via HTTP.** Imposta `REBASE_BUNDLE_URL`: il runtime scaricherà ed estrarrà il bundle a ogni avvio. Il modulo Terraform descritto di seguito adotta questo metodo, e anche l'Helm chart sfrutta lo stesso meccanismo.

## Terraform

Il modulo `terraform-hcloud-rebase` effettua il provisioning del server, di un firewall, di un IP statico e — aspetto cruciale — di un volume dedicato ai dati di Postgres, in modo che l'eventuale sostituzione dell'host non comporti la perdita del database. Esegue il runtime pubblicato tramite Docker Compose posizionando Caddy come reverse proxy, e scarica il bundle da un URL.

Il modulo non è pubblicato sul Terraform Registry. È possibile utilizzarlo direttamente dal repository di Rebase, fissando la versione con un tag di release:

```hcl
module "rebase" {
  source = "git::https://github.com/rebasepro/rebase.git//infra/terraform-hcloud-rebase?ref=v0.30.1"

  domain          = "api.example.com"
  cors_origins    = ["https://app.example.com"]
  ssh_public_keys = [file(pathexpand("~/.ssh/id_ed25519.pub"))]
  admin_email     = "you@example.com"

  bundle_url      = "https://storage.example.com/bundles/app-1.4.0.tar.gz"
  runtime_version = "0.30.1" # required with bundle_url: `latest` is refused at plan

  s3_bucket            = "example-uploads"
  s3_access_key_id     = var.s3_access_key_id
  s3_secret_access_key = var.s3_secret_access_key
}
```

Un aspetto fondamentale da configurare prima del primo apply: il record A per `domain` deve già puntare all'indirizzo del server, altrimenti la verifica challenge di Caddy con Let's Encrypt fallirà. Poiché l'indirizzo IP viene creato indipendentemente dal server, puoi crearlo preventivamente con `terraform apply -target=module.rebase.hcloud_primary_ip.ipv4`, configurare il DNS e poi eseguire l'apply completo.

Il [README](https://github.com/rebasepro/rebase/tree/main/infra/terraform-hcloud-rebase) del modulo contiene la lista esaustiva di tutte le variabili disponibili.

## Archiviazione dei file

**I file caricati possono rimanere sul server.** Il file Compose del progetto li conserva su un volume con nome montato su `/storage` e imposta `FORCE_LOCAL_STORAGE=true`. In questo modo sopravvivono ai riavvii e ai successivi deploy. Non sopravvivono, tuttavia, alla perdita completa del server, ed è per questo che è essenziale attivare i backup di Hetzner.

Senza questa impostazione, il runtime rifiuterà l'uso dello storage locale in ambiente di produzione. Sulla maggior parte delle piattaforme basate su container, il filesystem viene ricreato a ogni deploy, trasformando uno storage locale in una perdita invisibile di dati. Di conseguenza, le richieste di upload restituiranno l'errore `501 STORAGE_NOT_CONFIGURED` fino a quando non verrà configurato un bucket.

Quando lo spazio su disco non è più sufficiente o quando viene aggiunto un secondo server, è consigliabile migrare i file su Hetzner Object Storage. Si tratta di un servizio compatibile con S3 situato negli stessi data center. Nel blocco `environment:` del servizio `api`, sostituisci `STORAGE_PATH` e `FORCE_LOCAL_STORAGE` con:

```yaml
      STORAGE_TYPE: s3
      S3_BUCKET: my-uploads
      S3_ENDPOINT: https://fsn1.your-objectstorage.com
      S3_REGION: fsn1
      S3_ACCESS_KEY_ID: ${S3_ACCESS_KEY_ID}
      S3_SECRET_ACCESS_KEY: ${S3_SECRET_ACCESS_KEY}
```

definendo le due chiavi nel file `.env`. I file già presenti sul volume locale non verranno trasferiti automaticamente: andranno copiati nel bucket mantenendo invariate le rispettive chiavi.

Il modulo Terraform offre la medesima opzione tramite variabili: è possibile indicare un bucket S3 oppure impostare `force_local_storage = true`, che manterrà i caricamenti sul volume dati dedicato. Per tutti i dettagli, consulta [Storage](/docs/backend/storage).

## Cosa fa l'avvio allo schema

Con `REBASE_MIGRATE_ON_BOOT` impostato sul valore predefinito `ensure`, all'avvio il runtime effettua il provisioning incrementale delle tue tabelle **e delle relative policy di row-level security**. Una nuova tabella sarà subito operativa al deploy successivo, senza dover eseguire preventivamente passaggi di migrazione manuali.

L'avvio non esegue mai deliberatamente operazioni distruttive: non altera il tipo di una colonna, non rimuove colonne e non modifica i valori di un enum esistente. Il riavvio di un container non deve poter modificare la struttura dello schema come effetto collaterale.

Per questo motivo, [`rebase db push`](/docs/architecture/schema-as-code) rimane necessario per qualsiasi modifica che non sia puramente incrementale, come la ridenominazione di una colonna, un tipo di dato reso più restrittivo o la rimozione di un campo. Esegui il comando dalla tua copia locale del repository tramite un tunnel SSH collegato alla porta di loopback:

```bash
ssh -N -L 5490:127.0.0.1:5490 root@<server-ip>
pnpm exec rebase db push --dry-run \
  --database-url 'postgresql://rebase_app:<DATABASE_PASSWORD>@localhost:5490/rebase?sslmode=disable'
```

Esamina l'output SQL prodotto dalla simulazione (dry run) e riesegui il comando senza l'opzione `--dry-run`. `sslmode=disable` è previsto poiché il database gestito da Compose non ha TLS attivo; è il tunnel SSH a crittografare la connessione.

Mantenere la porta del database aperta su Internet espone l'infrastruttura Rebase al rischio che i record vengano letti aggirando le policy di row-level security anziché tramite esse. Mantienila associata all'interfaccia di loopback e utilizza sempre il tunnel.

## Aggiornamento

Modifica `REBASE_VERSION` in `.env` e ricrea il servizio runtime:

```bash
docker compose pull api && docker compose up -d api
```

Il bundle rimarrà inalterato.

L'unica eccezione riguarda l'aggiornamento di major version di Postgres: Postgres rifiuta di avviarsi su una directory di dati creata da una major version precedente, pertanto questo aggiornamento deve essere gestito tramite dump e restore, mai in-place.

```bash
rebase db backup --out ./backups
# recreate the volume on the new major
rebase db restore ./backups/<file>.dump
```

## Passaggi successivi

- [Deployment](/docs/getting-started/deployment) — la checklist per la produzione e le regole sul primo amministratore valide per ogni piattaforma.
- [Self-hosting](/docs/deployment/self-hosting) — la medesima architettura senza scaffolding predefinito, con connection pooler e processi separati.
- [Configuration](/docs/getting-started/configuration) — tutte le variabili d'ambiente elaborate dal runtime.
