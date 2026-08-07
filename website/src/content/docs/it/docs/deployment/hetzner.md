---
title: Distribuzione di Rebase su Hetzner Cloud
description: Scopri come distribuire Rebase su Hetzner Cloud utilizzando Docker Compose per eccellenti prestazioni basate nell'UE e sovranità dei dati.
sidebar_label: Hetzner Cloud
---

Hetzner Cloud è ampiamente riconosciuto per offrire incredibili rapporti prestazioni/prezzo ed è una scelta eccellente per progetti che richiedono una rigorosa sovranità dei dati europea e conformità al GDPR (con data center a Norimberga, Falkenstein e Helsinki).

La distribuzione di Rebase su Hetzner è più semplice tramite Docker Compose su un'istanza cloud Ubuntu standard.

## 1. Provisioning di un Server

1. Accedi alla tua Console Hetzner Cloud.
2. Clicca su **Aggiungi Server**.
3. Scegli la tua Posizione preferita (es. **Falkenstein** o **Norimberga**).
4. Scegli un'Immagine: Seleziona **Ubuntu 24.04** o **App -> Docker CE** (questo pre-installerà Docker per te).
5. Scegli un Tipo: Un `CPX21` (3 core, 4GB RAM) o `CX32` (4 core, 8GB RAM) fornisce un'eccellente base di calcolo per l'esecuzione di Rebase + Postgres.
6. Aggiungi la tua chiave SSH e clicca su **Crea**.

## 2. SSH e Configurazione

Una volta che il tuo server è stato provisionato, recupera l'indirizzo IP pubblico.

```bash
ssh root@<your-server-ip>
```

Se non hai scelto l'immagine Docker, installa Docker e Docker Compose esplicitamente:

```bash
apt update && apt install docker.io docker-compose-v2 -y
```

## 3. Clona e Configura Rebase

Clona il tuo progetto Rebase direttamente sull'istanza del server.

```bash
git clone https://github.com/your-username/your-rebase-repo.git /opt/rebase
cd /opt/rebase
```

Rebase fornisce un `docker-compose.yml` pronto all'uso. Dovrai definire le tue variabili d'ambiente di produzione. Crea un file `.env.production`:

```bash
nano .env.production
```

Aggiungi i tuoi segreti:

```env
DATABASE_URL=postgresql://rebase_app:your_secure_db_password@postgres:5432/rebase
JWT_SECRET=generate_a_very_long_secure_random_string_here
NODE_ENV=production
```

*Assicurati di aggiornare `docker-compose.yml` se vuoi prelevare la password di Postgres da una variabile d'ambiente.*

## 4. Esegui lo Stack

Porta lo stack online utilizzando la modalità detached:

```bash
docker compose --env-file .env.production up -d --build
```

Docker costruirà il tuo backend Node.js dal `Dockerfile` locale e avvierà il container Postgres. Una volta completato, la tua app sarà in esecuzione su `http://localhost:3001` (interno al server).

## 5. Crea lo Schema del Database

All'avvio Rebase crea automaticamente **solo le tabelle di autenticazione**. Le tabelle per le tue collezioni **non** vengono create automaticamente: l'app si avvia comunque e il login funziona, quindi è facile non accorgersene, finché ogni collezione non restituisce un errore "missing table".

Su Hetzner hai già un checkout del progetto sul server (in `/opt/rebase`), quindi puoi eseguire la sincronizzazione dello schema direttamente da lì — la CLI è disponibile nel checkout anche se non è inclusa nell'immagine del container:

```bash
cd /opt/rebase && pnpm run db:push
```

Assicurati che `DATABASE_URL` punti al database di produzione (per lo stack di compose, l'istanza Postgres esposta su `localhost:5432`). Se preferisci migrazioni versionate a una sincronizzazione diretta, usa invece `pnpm run db:generate` seguito da `pnpm run db:migrate`.

## 6. Esposizione tramite Caddy o Nginx

Non dovresti mai esporre la porta 3001 direttamente a Internet senza SSL. Raccomandiamo di posizionare **Caddy** davanti alla tua istanza Rebase per provisionare automaticamente i certificati Let's Encrypt.

Installa Caddy:
```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install caddy
```

Modifica il tuo Caddyfile:
```bash
nano /etc/caddy/Caddyfile
```

Aggiungi quanto segue (sostituisci con il tuo dominio, che dovrebbe avere il suo record A che punta a questo IP Hetzner):

```caddyfile
admin.yourdomain.com {
    reverse_proxy localhost:3001
}
```

Riavvia Caddy:
```bash
systemctl restart caddy
```

Questo è tutto! La tua piattaforma Rebase è ospitata in modo sicuro interamente all'interno dell'UE.
