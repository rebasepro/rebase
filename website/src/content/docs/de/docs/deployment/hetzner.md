---
sourceHash: 23edfa071775b304
title: Rebase auf Hetzner Cloud bereitstellen
description: Stellen Sie ein Rebase-Projekt auf einem einzelnen Hetzner-Cloud-Server mit eigener Docker-Compose-Datei und Caddy für HTTPS bereit oder provisionieren Sie es mit Terraform für Hosting in der EU.
sidebar_label: Hetzner Cloud
---

Hetzner Cloud bietet ein außergewöhnlich gutes Preis-Leistungs-Verhältnis und ist mit Rechenzentren in Nürnberg, Falkenstein und Helsinki eine hervorragende Wahl für Projekte, die europäische Datensouveränität erfordern.

An Ihrem Projekt ist hier nichts Hetzner-spezifisch. Ein Rebase-Deployment besteht aus zwei trennbaren Teilen – dem veröffentlichten Runtime-Image und dem **Bundle**, das `rebase build` erzeugt – und dasselbe Bundle läuft unter Docker Compose auf einem Laptop, in Rebase Cloud, unter dem [Helm-Chart](/docs/deployment/kubernetes) und auf einer Hetzner-Instanz. Der Wechsel zwischen ihnen ist eine Änderung der Infrastruktur, nicht der Anwendung.

Zwei Wege dorthin:

- **[Ein Server, direkt aus Ihrem Projekt](#ein-server-direkt-aus-ihrem-projekt):** die `docker-compose.yml`, die `rebase init` erstellt hat, auf einem manuell angelegten Server. Datei-Uploads verbleiben auf der Festplatte des Servers.
- **[Terraform](#terraform):** ein Modul, das den Server, die Firewall, die IP, TLS und ein Volume provisioniert, welches den Host überdauert.

## Ein Server, direkt aus Ihrem Projekt

Ein Projekt aus `rebase init` enthält bereits das Deployment: eine `docker-compose.yml`, die Postgres und die veröffentlichte Runtime mit Ihrem gemounteten Bundle ausführt, das Admin-Panel unter `/` sowie die API unter `/api` aus einem Container bereitstellt und Uploads auf einem Volume speichert. Dieser Abschnitt platziert diese Datei auf einem Server und schaltet Caddy für HTTPS davor.

### 1. Server erstellen

1. In der Hetzner Cloud Console auf **Server hinzufügen** klicken.
2. Wählen Sie einen **Standort**: Falkenstein, Nürnberg oder Helsinki für Datenresidenz in der EU.
3. Wählen Sie das Image **Ubuntu 24.04**.
4. Wählen Sie einen Typ mit mindestens **2 vCPUs und 4 GB RAM**. Die Runtime, Postgres und Caddy teilen sich diese Ressourcen.
5. Aktivieren Sie **Backups**. Die Datenbank und die Uploads liegen auf der Festplatte dieses Servers, und Backups sichern Sie gegen den Verlust des Servers ab.
6. Fügen Sie Ihren SSH-Schlüssel hinzu und erstellen Sie den Server.

Legen Sie nun einen A-Record für Ihre Domain – im Folgenden `app.example.com` – an, der auf die Adresse des Servers verweist. Caddy benötigt dies, um ein Zertifikat abzurufen.

### 2. Docker und Caddy installieren

```bash
ssh root@<server-ip>
apt update && apt install -y docker.io docker-compose-v2 caddy
mkdir -p /opt/my-app
```

### 3. Bundle bauen und hochladen

Aus Ihrem Projekt auf Ihrem Rechner:

```bash
rebase build
rsync -a docker-compose.yml .env dist-bundle root@<server-ip>:/opt/my-app/
```

`rebase build` kompiliert Ihre Tabellen, Funktionen und Cronjobs zusammen mit ihren Abhängigkeiten und dem fertig gebauten Admin-Panel nach `dist-bundle/`. Es muss kein Anwendungs-Image gebaut werden: Der Server führt das veröffentlichte Runtime-Image aus, in das dieses Verzeichnis gemountet ist.

### 4. Konfiguration für die Produktion anpassen

Bearbeiten Sie auf dem Server die Datei `/opt/my-app/.env`. `rebase init` hat sie für Ihren Laptop ausgefüllt. Ändern Sie die folgenden Zeilen:

```env
CORS_ORIGINS=https://app.example.com
REBASE_ADMIN_EMAIL=you@example.com
```

Behalten Sie die generierten Werte für `DATABASE_PASSWORD`, `JWT_SECRET`, `REBASE_SERVICE_KEY` und `REBASE_ADMIN_PASSWORD` bei oder ersetzen Sie sie durch neue Werte aus `openssl rand -hex 32`. Die Compose-Datei liest sie von hier ein und stoppt mit einer Meldung, falls ein Wert fehlt.

Die Datei übergibt dem `api`-Dienst nur die dort genannten Variablen, sodass der Rest der `.env` – darunter auch `NODE_ENV=development` – die Runtime nicht erreicht. Der Dienst läuft mit `NODE_ENV=production`. Eine Variable, die in der Datei nicht aufgeführt ist, gehört in den `environment:`-Block des Dienstes.

`REBASE_ADMIN_EMAIL` und `REBASE_ADMIN_PASSWORD` bilden den ersten Administrator. In der Produktion wird das erste registrierte Konto nicht hochgestuft; stattdessen erstellt die Runtime dieses Administratorkonto beim ersten Start, solange die Benutzertabelle noch leer ist. Melden Sie sich damit an und ändern Sie das Passwort. Siehe [Ihr erster Administrator](/docs/getting-started/deployment/#your-first-admin).

Binden Sie anschließend in `/opt/my-app/docker-compose.yml` beide veröffentlichten Ports an das Loopback-Interface:

```yaml
  db:
    ports:
      - "127.0.0.1:5490:5432"
  api:
    ports:
      - "127.0.0.1:${PORT:-3001}:3001"
```

Im generierten Zustand veröffentlicht die Datei Postgres und die API auf allen Schnittstellen, was auf einem Laptop unbedenklich ist. Auf einem öffentlichen Server stellt dies die Datenbank jedoch direkt ins Internet, und Docker umgeht bei der Veröffentlichung von Ports `ufw`, sodass eine Firewall-Regel sie nicht blockiert. Mit `127.0.0.1` können nur Caddy und SSH-Tunnel darauf zugreifen.

### 5. Starten

```bash
cd /opt/my-app
docker compose up -d
```

Beim ersten Start werden alle benötigten Tabellen angelegt, einschließlich Ihrer eigenen Tabellen und deren Row-Level-Security-Richtlinien.

### 6. TLS mit Caddy terminieren

Ersetzen Sie `/etc/caddy/Caddyfile` durch:

```caddyfile
app.example.com {
    reverse_proxy 127.0.0.1:3001
}
```

```bash
systemctl reload caddy
```

Caddy fordert automatisch ein Let's-Encrypt-Zertifikat für die Domain an und erneuert es. Rufen Sie `https://app.example.com` auf und melden Sie sich an.

### Erneute Bereitstellung

Erneut bauen, Bundle kopieren, Runtime neu starten:

```bash
rebase build
rsync -a --delete dist-bundle/ root@<server-ip>:/opt/my-app/dist-bundle/
ssh root@<server-ip> 'cd /opt/my-app && docker compose restart api'
```

Das manuelle Kopieren eines Verzeichnisses auf einen Server ist für eine einzelne Instanz völlig in Ordnung. Darüber hinaus sollten Sie Ansätze wählen, die ohne diesen Schritt auskommen:

- **In ein Image packen:** `FROM rebasepro/server:0.30.1`, danach `COPY --chown=node:node dist-bundle /bundle`, und die Bereitstellung über das Ändern eines Tags durchführen.
- **Über HTTP bereitstellen:** Setzen Sie `REBASE_BUNDLE_URL`, und die Runtime lädt das Bundle bei jedem Start herunter und entpackt es. Das unten stehende Terraform-Modul verfährt so, und das Helm-Chart nutzt denselben Mechanismus.

## Terraform

Das Modul `terraform-hcloud-rebase` provisioniert den Server, eine Firewall, eine feste IP und – der entscheidende Teil – ein Volume für die Postgres-Daten, sodass ein Austausch des Hosts die Datenbank nicht zerstört. Es führt die veröffentlichte Runtime unter Docker Compose mit vorgelagertem Caddy aus und ruft Ihr Bundle über eine URL ab.

Das Modul befindet sich nicht in der Terraform Registry. Verwenden Sie es direkt aus dem Rebase-Repository, fixiert auf ein Release:

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

Ein wichtiger Punkt vor dem ersten `apply`: Der A-Record für `domain` muss bereits auf den Server verweisen, andernfalls schlägt die Let's-Encrypt-Challenge von Caddy fehl. Die Adresse wird unabhängig vom Server erstellt; Sie können sie also vorab mit `terraform apply -target=module.rebase.hcloud_primary_ip.ipv4` abrufen, den DNS-Eintrag setzen und anschließend den vollständigen Apply-Vorgang ausführen.

Die [README](https://github.com/rebasepro/rebase/tree/main/infra/terraform-hcloud-rebase) des Moduls listet alle Variablen auf.

## Dateispeicher

**Uploads können auf dem Server verbleiben.** Die Compose-Datei des Projekts speichert sie auf einem benannten Volume, das unter `/storage` gemountet ist, und setzt `FORCE_LOCAL_STORAGE=true`. Sie überstehen Neustarts und erneute Deployments. Sie überstehen jedoch nicht den Verlust des Servers – dafür sind die Hetzner-Backups da.

Ohne diese Einstellung verweigert die Runtime in der Produktion die lokale Speicherung. Auf den meisten Container-Plattformen wird das Dateisystem bei jedem Deploy ersetzt, sodass ein lokales Backend dort zu unbemerktem Datenverlust führt. Uploads antworten dann mit `501 STORAGE_NOT_CONFIGURED`, bis ein Bucket konfiguriert ist.

Wenn der Speicherplatz einer einzelnen Festplatte nicht mehr ausreicht oder Sie einen zweiten Server betreiben, migrieren Sie die Uploads zu Hetzner Object Storage. Dieser Dienst ist S3-kompatibel und befindet sich in denselben Rechenzentren. Ersetzen Sie im `environment:`-Block des `api`-Dienstes `STORAGE_PATH` und `FORCE_LOCAL_STORAGE` durch:

```yaml
      STORAGE_TYPE: s3
      S3_BUCKET: my-uploads
      S3_ENDPOINT: https://fsn1.your-objectstorage.com
      S3_REGION: fsn1
      S3_ACCESS_KEY_ID: ${S3_ACCESS_KEY_ID}
      S3_SECRET_ACCESS_KEY: ${S3_SECRET_ACCESS_KEY}
```

wobei die beiden Schlüssel in der `.env` hinterlegt werden. Dateien, die sich bereits auf dem Volume befinden, werden nicht automatisch verschoben: Kopieren Sie diese unter Beibehaltung ihrer Keys in den Bucket.

Das Terraform-Modul bietet dieselbe Wahlmöglichkeit über Variablen: einen S3-Bucket oder `force_local_storage = true`, wodurch Uploads auf dem zugehörigen Daten-Volume verbleiben. Siehe [Speicher](/docs/backend/storage) für alle Details.

## Was der Boot-Vorgang mit Ihrem Schema macht

Wenn `REBASE_MIGRATE_ON_BOOT` auf dem Standardwert `ensure` steht, provisioniert die Runtime beim Booten Ihre Tabellen **und deren Row-Level-Security-Richtlinien** additiv. Eine neue Tabelle ist beim nächsten Deploy sofort aktiv, ohne dass zuvor ein Schema-Schritt ausgeführt werden muss.

Was der Boot-Vorgang ganz bewusst niemals tut, sind destruktive Änderungen: Er ändert weder Spaltentypen noch löscht er Spalten oder bearbeitet bestehende Enum-Werte. Ein Container-Neustart darf niemals das Schema als Nebeneffekt verändern.

Für eines wird daher weiterhin [`rebase db push`](/docs/architecture/schema-as-code) benötigt: jede Änderung, die nicht rein additiv ist – eine umbenannte Spalte, ein eingeschränkter Datentyp oder ein entferntes Feld. Führen Sie den Befehl aus Ihrem lokalen Repository über einen SSH-Tunnel zum Loopback-Port aus:

```bash
ssh -N -L 5490:127.0.0.1:5490 root@<server-ip>
pnpm exec rebase db push --dry-run \
  --database-url 'postgresql://rebase_app:<DATABASE_PASSWORD>@localhost:5490/rebase?sslmode=disable'
```

Prüfen Sie das ausgegebene SQL des Testlaufs (Dry-Run) und führen Sie den Befehl anschließend ohne `--dry-run` erneut aus. `sslmode=disable` wird verwendet, weil die Compose-Datenbank kein TLS nutzt; der SSH-Tunnel übernimmt die Verschlüsselung der Verbindung.

Ein für das Internet offener Datenbank-Port führt dazu, dass Zeilen in einem Rebase-Deployment unter Umgehung der Row-Level-Security gelesen werden können, anstatt sie zu durchlaufen. Belassen Sie den Port auf Loopback und nutzen Sie den Tunnel.

## Upgrade

Ändern Sie `REBASE_VERSION` in der `.env` und erstellen Sie die Runtime neu:

```bash
docker compose pull api && docker compose up -d api
```

Ihr Bundle bleibt dabei unberührt.

Die Ausnahme ist die Postgres-Hauptversion (Major Version): Postgres verweigert den Start mit einem Datenverzeichnis, das von einer älteren Hauptversion geschrieben wurde. Daher erfordert dieses Upgrade immer einen Dump und Restore, niemals ein In-Place-Upgrade.

```bash
rebase db backup --out ./backups
# recreate the volume on the new major
rebase db restore ./backups/<file>.dump
```

## Nächste Schritte

- [Deployment](/docs/getting-started/deployment) — die Produktions-Checkliste und die Regeln für den ersten Administrator, die für jede Plattform gelten.
- [Self-Hosting](/docs/deployment/self-hosting) — dasselbe Deployment ohne vorgefertigtes Gerüst, mit Connection-Pooler und separaten Prozessen.
- [Konfiguration](/docs/getting-started/configuration) — alle Umgebungsvariablen, die von der Runtime gelesen werden.
