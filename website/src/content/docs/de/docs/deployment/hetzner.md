---
title: Rebase auf Hetzner Cloud bereitstellen
description: Erfahren Sie, wie Sie Rebase auf Hetzner Cloud mithilfe von Docker Compose bereitstellen, um exzellente EU-basierte Leistung und Datenhoheit zu gewährleisten.
sidebar_label: Hetzner Cloud
---

Hetzner Cloud ist weithin bekannt für sein unglaubliches Preis-Leistungs-Verhältnis und eine Top-Wahl für Projekte, die strenge europäische Datenhoheit und GDPR-Konformität erfordern (mit Rechenzentren in Nürnberg, Falkenstein und Helsinki).

Die Bereitstellung von Rebase auf Hetzner erfolgt am einfachsten über Docker Compose auf einer Standard-Ubuntu-Cloud-Instanz.

## 1. Server bereitstellen

1. Melden Sie sich bei Ihrer Hetzner Cloud Konsole an.
2. Klicken Sie auf **Server hinzufügen**.
3. Wählen Sie Ihren bevorzugten Standort (z.B. **Falkenstein** oder **Nürnberg**).
4. Wählen Sie ein Image: Wählen Sie **Ubuntu 24.04** oder **App -> Docker CE** (dies installiert Docker für Sie vor).
5. Wählen Sie einen Typ: Ein `CPX21` (3 Kerne, 4 GB RAM) oder `CX32` (4 Kerne, 8 GB RAM) bietet eine ausgezeichnete Basiskapazität für den Betrieb von Rebase + Postgres.
6. Fügen Sie Ihren SSH-Schlüssel hinzu und klicken Sie auf **Erstellen**.

## 2. SSH und Einrichtung

Sobald Ihr Server bereitgestellt ist, rufen Sie die öffentliche IP-Adresse ab.

```bash
ssh root@<your-server-ip>
```

Wenn Sie das Docker-Image nicht gewählt haben, installieren Sie Docker und Docker Compose explizit:

```bash
apt update && apt install docker.io docker-compose-v2 -y
```

## 3. Rebase klonen und konfigurieren

Klonen Sie Ihr Rebase-Projekt direkt auf die Serverinstanz. 

```bash
git clone https://github.com/your-username/your-rebase-repo.git /opt/rebase
cd /opt/rebase
```

Rebase stellt standardmäßig eine `docker-compose.yml` bereit. Sie müssen Ihre Produktionsumgebungsvariablen definieren. Erstellen Sie eine `.env.production` Datei:

```bash
nano .env.production
```

Fügen Sie Ihre Geheimnisse hinzu:

```env
DATABASE_URL=postgresql://rebase_app:your_secure_db_password@postgres:5432/rebase
JWT_SECRET=generate_a_very_long_secure_random_string_here
NODE_ENV=production
```

*Stellen Sie sicher, dass Sie `docker-compose.yml` aktualisieren, wenn Sie das Postgres-Passwort aus einer Umgebungsvariablen abrufen möchten.*

## 4. Den Stack ausführen

Bringen Sie den Stack im Detached-Modus online:

```bash
docker compose --env-file .env.production up -d --build
```

Docker erstellt Ihr Node.js-Backend aus dem lokalen `Dockerfile` und startet den Postgres-Container. Nach Abschluss läuft Ihre App auf `http://localhost:3001` (intern auf dem Server).

## 5. Datenbankschema erstellen

Beim Start erstellt Rebase automatisch **nur die Auth-Tabellen**. Die Tabellen für Ihre eigenen Collections werden **nicht** automatisch angelegt — Sie müssen das Schema einmalig gegen die Produktionsdatenbank pushen:

```bash
pnpm run db:push
```

Ohne diesen Schritt gibt jede Collection einen `missing table`-Fehler zurück. Die Falle dabei: Die App startet trotzdem und die Anmeldung funktioniert (die Auth-Tabellen existieren), sodass die Bereitstellung zunächst gesund aussieht.

Führen Sie den Befehl aus einem Projekt-Checkout aus, wobei `DATABASE_URL` auf die Produktionsdatenbank zeigt — **nicht** im App-Container, da das Produktions-Image ohne die CLI ausgeliefert wird. Da Sie das Projekt bereits nach `/opt/rebase` geklont haben, führen Sie ihn direkt auf dem Server aus diesem Checkout aus (mit `DATABASE_URL`, das auf den Postgres-Container zeigt).

Für versionierte Migrationen verwenden Sie stattdessen `pnpm run db:generate` und `pnpm run db:migrate`.

## 6. Über Caddy oder Nginx verfügbar machen

Sie sollten Port 3001 niemals direkt und ohne SSL dem Internet aussetzen. Wir empfehlen, **Caddy** vor Ihre Rebase-Instanz zu stellen, um Let's Encrypt-Zertifikate automatisch bereitzustellen.

Caddy installieren:
```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install caddy
```

Bearbeiten Sie Ihre Caddyfile:
```bash
nano /etc/caddy/Caddyfile
```

Fügen Sie Folgendes hinzu (ersetzen Sie dies durch Ihre Domain, deren A-Record auf diese Hetzner IP zeigen sollte):

```caddyfile
admin.yourdomain.com {
    reverse_proxy localhost:3001
}
```

Caddy neu starten:
```bash
systemctl restart caddy
```

Das war's! Ihre Rebase-Plattform wird sicher und vollständig innerhalb der EU gehostet.

---
