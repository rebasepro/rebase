---
sourceHash: 16eace9fa90cc0b4
title: Bereitstellung von Rebase auf Hetzner Cloud
description: Stellen Sie ein Rebase-Projekt auf einem einzelnen Hetzner Cloud-Server mit eigener Docker Compose-Datei und Caddy für HTTPS bereit oder provisionieren Sie es mit Terraform für ein Hosting in der EU.
sidebar_label: Hetzner Cloud
---

Hetzner Cloud bietet ein außergewöhnlich gutes Preis-Leistungs-Verhältnis und ist mit Rechenzentren in Nürnberg, Falkenstein und Helsinki eine hervorragende Wahl für Projekte, die europäische Datensouveränität erfordern.

An Ihrem Projekt ist hierbei nichts Hetzner-spezifisch. Ein Rebase-Deployment besteht aus zwei trennbaren Teilen – dem veröffentlichten Runtime-Image und dem **Bundle**, das `rebase build` erzeugt – und dasselbe Bundle läuft unter Docker Compose auf einem Laptop, in der Rebase Cloud, unter dem [Helm-Chart](/docs/deployment/kubernetes) und auf einer Hetzner-Maschine. Der Wechsel zwischen ihnen ist eine Änderung der Infrastruktur, nicht der Anwendung.

Zwei Wege dorthin:

- **[Ein Server, aus Ihrem Projekt](#one-server-from-your-project):** die `docker-compose.yml`, die `rebase init` erstellt hat, auf einem manuell eingerichteten Server. Datei-Uploads verbleiben auf der Festplatte des Servers.
- **[Terraform](#terraform):** ein Modul, das den Server, die Firewall, die IP, TLS und ein Volume provisioniert, das den Host überdauert.

## One server, from your project

Ein mit `rebase init` erstelltes Projekt enthält bereits das Deployment: eine `docker-compose.yml`, die Postgres und die veröffentlichte Runtime mit Ihrem gemounteten Bundle ausführt, das Admin-Panel unter `/` und die API unter `/api` aus einem einzigen Container bereitstellt und Uploads auf einem Volume speichert. Dieser Abschnitt bringt diese Datei auf einen Server und schaltet Caddy für HTTPS davor.

### 1. Create the server

1. Klicken Sie in der Hetzner Cloud Console auf **Server hinzufügen**.
2. Wählen Sie einen **Standort**: Falkenstein, Nürnberg oder Helsinki für Datenhaltung in der EU.
3. Wählen Sie das **Ubuntu 24.04**-Image.
4. Wählen Sie einen Typ mit mindestens **2 vCPUs und 4 GB RAM**. Die Runtime, Postgres und Caddy teilen sich diese Ressourcen.
5. Aktivieren Sie **Backups**. Die Datenbank und die Uploads liegen auf der Festplatte dieses Servers, und Backups sorgen dafür, dass Daten bei einem Verlust des Servers erhalten bleiben.
6. Fügen Sie Ihren SSH-Schlüssel hinzu und erstellen Sie den Server.

Legen Sie jetzt einen A-Record für Ihre Domain – im Folgenden `app.example.com` – an, der auf die IP-Adresse des Servers zeigt. Caddy benötigt dies, um ein Zertifikat abzurufen.

### 2. Install Docker and Caddy

```bash
ssh root@<server-ip>
apt update && apt install -y docker.io docker-compose-v2 caddy
mkdir -p /opt/my-app
```

### 3. Build the bundle and copy it up

Aus Ihrem Projektverzeichnis auf Ihrem lokalen Rechner:

```bash
rebase build
rsync -a docker-compose.yml .env dist-bundle root@<server-ip>:/opt/my-app/
```

`rebase build` kompiliert Ihre Collections, Functions und Crons zusammen mit deren Abhängigkeiten und dem erstellten Admin-Panel nach `dist-bundle/`. Es muss kein separates Anwendungs-Image gebaut werden: Der Server führt das veröffentlichte Runtime-Image aus, in das dieses Verzeichnis eingebunden ist.

### 4. Make the configuration production's

Bearbeiten Sie auf dem Server `/opt/my-app/.env`. `rebase init` hat diese Datei für Ihren lokalen Laptop vorausgefüllt. Ändern Sie folgende Zeilen:

```env
CORS_ORIGINS=https://app.example.com
REBASE_ADMIN_EMAIL=you@example.com
```

Behalten Sie die generierten Werte für `DATABASE_PASSWORD`, `JWT_SECRET`, `REBASE_SERVICE_KEY` und `REBASE_ADMIN_PASSWORD` bei oder ersetzen Sie sie durch neue Werte aus `openssl rand -hex 32`. Die Compose-Datei liest sie von hier ein und bricht mit einer Meldung ab, die alle fehlenden Variablen nennt.

Die Datei übergibt dem `api`-Dienst nur die dort explizit genannten Variablen, sodass der Rest der `.env` – darunter auch `NODE_ENV=development` – die Runtime nicht erreicht. Der Dienst läuft mit `NODE_ENV=production`. Eine Variable, die in der Datei nicht aufgeführt ist, gehört in den `environment:`-Block des Dienstes.

`REBASE_ADMIN_EMAIL` und `REBASE_ADMIN_PASSWORD` definieren den ersten Administrator. In der Produktion wird das erste registrierte Konto nicht automatisch hochgestuft; stattdessen erstellt die Runtime diesen Account beim ersten Start, solange die Benutzer-Tabelle leer ist. Melden Sie sich damit an und ändern Sie das Passwort. Siehe [Ihr erster Administrator](/docs/getting-started/deployment/#your-first-admin).

Binden Sie anschließend in `/opt/my-app/docker-compose.yml` beide veröffentlichten Ports an das Loopback-Interface:

```yaml
  db:
    ports:
      - "127.0.0.1:5490:5432"
  api:
    ports:
      - "127.0.0.1:${PORT:-3001}:3001"
```

In der generierten Fassung veröffentlicht die Datei Postgres und die API auf allen Schnittstellen, was auf einem Laptop unbedenklich ist. Auf einem öffentlichen Server würde dies die Datenbank jedoch direkt ins Internet stellen, und Docker veröffentlicht Ports an `ufw` vorbei, sodass eine Firewall-Regel sie nicht blockiert. Durch `127.0.0.1` können nur noch Caddy und SSH-Tunnel darauf zugreifen.

### 5. Start it

```bash
cd /opt/my-app
docker compose up -d
```

Der erste Start erstellt alle erforderlichen Tabellen – einschließlich derer für Ihre Collections – zusammen mit deren Row-Level-Security-Richtlinien.

### 6. Terminate TLS with Caddy

Ersetzen Sie `/etc/caddy/Caddyfile` durch:

```caddyfile
app.example.com {
    reverse_proxy 127.0.0.1:3001
}
```

```bash
systemctl reload caddy
```

Caddy ruft ein Let's Encrypt-Zertifikat für die Domain ab und erneuert es automatisch. Öffnen Sie `https://app.example.com` und melden Sie sich an.

### Deploying again

Erneut bauen, das Bundle kopieren, die Runtime neu starten:

```bash
rebase build
rsync -a --delete dist-bundle/ root@<server-ip>:/opt/my-app/dist-bundle/
ssh root@<server-ip> 'cd /opt/my-app && docker compose restart api'
```

Das manuelle Kopieren eines Verzeichnisses auf einen Server ist für einen einzelnen Server in Ordnung. Darüber hinaus sollten Sie einen der Ansätze nutzen, die dies vermeiden:

- **In ein Image packen.** `FROM rebasepro/server:0.30.0`, dann `COPY --chown=node:node dist-bundle /bundle`, und Deployments einfach durch Ändern des Tags durchführen.
- **Über HTTP bereitstellen.** Setzen Sie `REBASE_BUNDLE_URL`, und die Runtime lädt das Bundle bei jedem Start herunter und entpackt es. Das unten stehende Terraform-Modul nutzt dies, und das Helm-Chart verwendet denselben Mechanismus.

## Terraform

Das Modul `terraform-hcloud-rebase` provisioniert den Server, eine Firewall, eine feste IP-Adresse und – der entscheidende Punkt – ein Volume für die Postgres-Daten, sodass ein Austausch des Hosts die Datenbank nicht zerstört. Es führt die veröffentlichte Runtime unter Docker Compose mit vorgeschaltetem Caddy aus und ruft Ihr Bundle über eine URL ab.

Das Modul befindet sich nicht in der Terraform Registry. Verwenden Sie es direkt aus dem Rebase-Repository, fixiert auf ein Release:

```hcl
module "rebase" {
  source = "git::https://github.com/rebasepro/rebase.git//infra/terraform-hcloud-rebase?ref=v0.30.0"

  domain          = "api.example.com"
  cors_origins    = ["https://app.example.com"]
  ssh_public_keys = [file(pathexpand("~/.ssh/id_ed25519.pub"))]
  admin_email     = "you@example.com"

  bundle_url      = "https://storage.example.com/bundles/app-1.4.0.tar.gz"
  runtime_version = "0.30.0" # required with bundle_url: `latest` is refused at plan

  s3_bucket            = "example-uploads"
  s3_access_key_id     = var.s3_access_key_id
  s3_secret_access_key = var.s3_secret_access_key
}
```

Ein wichtiger Punkt vor dem ersten `apply`: Der A-Record für `domain` muss bereits auf den Server verweisen, andernfalls schlägt die Let's Encrypt-Challenge von Caddy fehl. Da die IP-Adresse unabhängig vom Server erstellt wird, können Sie diese zunächst mit `terraform apply -target=module.rebase.hcloud_primary_ip.ipv4` anfordern, das DNS konfigurieren und anschließend den vollständigen Apply-Vorgang durchführen.

Die [README](https://github.com/rebasepro/rebase/tree/main/infra/terraform-hcloud-rebase) des Moduls listet alle Variablen auf.

## File storage

**Uploads können auf dem Server verbleiben.** Die Compose-Datei des Projekts speichert sie auf einem benannten Volume, das unter `/storage` eingehängt ist, und setzt `FORCE_LOCAL_STORAGE=true`. Sie überstehen Neustarts und erneute Deployments. Einen Verlust des Servers überstehen sie jedoch nicht – dafür sind die Backups von Hetzner gedacht.

Ohne diese Einstellung verweigert die Runtime in der Produktion die lokale Speicherung. Auf den meisten Container-Plattformen wird das Dateisystem bei jedem Deployment ersetzt, sodass ein lokales Backend dort zu unbemerktem Datenverlust führt. Uploads antworten dann mit `501 STORAGE_NOT_CONFIGURED`, bis ein Bucket konfiguriert ist.

Wenn der Speicherplatz einer einzelnen Festplatte nicht mehr ausreicht oder Sie einen zweiten Server betreiben, migrieren Sie Uploads zu Hetzner Object Storage. Dieser ist S3-kompatibel und befindet sich in denselben Rechenzentren. Ersetzen Sie im `environment:`-Block des `api`-Dienstes `STORAGE_PATH` und `FORCE_LOCAL_STORAGE` durch:

```yaml
      STORAGE_TYPE: s3
      S3_BUCKET: my-uploads
      S3_ENDPOINT: https://fsn1.your-objectstorage.com
      S3_REGION: fsn1
      S3_ACCESS_KEY_ID: ${S3_ACCESS_KEY_ID}
      S3_SECRET_ACCESS_KEY: ${S3_SECRET_ACCESS_KEY}
```

wobei die beiden Schlüssel in der `.env` hinterlegt werden. Bereits auf dem Volume vorhandene Dateien werden nicht automatisch verschoben: Kopieren Sie diese unter Beibehaltung ihrer Schlüssel (Keys) in den Bucket.

Das Terraform-Modul bietet dieselbe Auswahl über Variablen: einen S3-Bucket oder `force_local_storage = true`, wodurch Uploads auf dessen Daten-Volume verbleiben. Siehe [Storage](/docs/backend/storage) für alle Details.

## What boot does to your schema

Wenn `REBASE_MIGRATE_ON_BOOT` auf dem Standardwert `ensure` steht, richtet die Runtime Ihre Collection-Tabellen **und deren Row-Level-Security-Richtlinien** beim Booten additiv ein. Eine neue Collection ist beim nächsten Deployment sofort live, ohne dass zuvor ein Schema-Schritt ausgeführt werden muss.

Was der Boot-Vorgang bewusst niemals tut, sind destruktive Änderungen: Er ändert keinen Spaltentyp, löscht keine Spalten und bearbeitet keine bestehenden Enum-Werte. Ein Container-Neustart darf niemals in der Lage sein, ein Schema als Nebeneffekt umzustrukturieren.

Für eines ist daher weiterhin [`rebase db push`](/docs/architecture/schema-as-code) erforderlich: jede Änderung, die nicht rein additiv ist – eine umbenannte Spalte, ein eingeschränkter Datentyp, ein entferntes Feld. Führen Sie den Befehl aus Ihrem lokalen Repository über einen SSH-Tunnel zum Loopback-Port aus:

```bash
ssh -N -L 5490:127.0.0.1:5490 root@<server-ip>
pnpm exec rebase db push --dry-run \
  --database-url 'postgresql://rebase_app:<DATABASE_PASSWORD>@localhost:5490/rebase?sslmode=disable'
```

Prüfen Sie das SQL, das beim Dry-Run ausgegeben wird, und führen Sie den Befehl anschließend ohne `--dry-run` erneut aus. `sslmode=disable` wird verwendet, weil die Compose-Datenbank kein TLS nutzt; der SSH-Tunnel übernimmt die Verschlüsselung der Verbindung.

Ein offener Datenbank-Port im Internet führt dazu, dass Zeilen unter Umgehung der Row-Level-Security statt durch sie hindurch gelesen werden können. Belassen Sie den Port auf Loopback und verwenden Sie den Tunnel.

## Upgrading

Ändern Sie `REBASE_VERSION` in der `.env` und erstellen Sie die Runtime neu:

```bash
docker compose pull api && docker compose up -d api
```

Ihr Bundle bleibt dabei unberührt.

Die Ausnahme ist die Postgres-Hauptversion: Postgres verweigert den Start mit einem Datenverzeichnis, das von einer älteren Hauptversion geschrieben wurde. Ein solches Upgrade erfolgt daher immer über Dump und Restore, niemals direkt an Ort und Stelle.

```bash
rebase db backup --out ./backups
# recreate the volume on the new major
rebase db restore ./backups/<file>.dump
```

## Next steps

- [Deployment](/docs/getting-started/deployment) – die Checkliste für den Produktionseinsatz und die Regeln für den ersten Administrator, die für alle Plattformen gelten.
- [Self-hosting](/docs/deployment/self-hosting) – dasselbe Deployment ohne Scaffold im Hintergrund, mit einem Connection Pooler und aufgeteilten Prozessen.
- [Configuration](/docs/getting-started/configuration) – jede Umgebungsvariable, die von der Runtime gelesen wird.
