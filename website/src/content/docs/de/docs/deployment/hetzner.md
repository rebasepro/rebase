---
title: Rebase auf Hetzner Cloud bereitstellen
description: Rebase mit Terraform oder Docker Compose auf Hetzner Cloud bereitstellen — für exzellente EU-Performance und Datenhoheit.
sidebar_label: Hetzner Cloud
---

Hetzner Cloud bietet ein ungewöhnlich gutes Preis-Leistungs-Verhältnis und ist eine starke Wahl für Projekte, die europäische Datenhoheit benötigen, mit Rechenzentren in Nürnberg, Falkenstein und Helsinki.

An Ihrem Projekt ist dabei nichts Hetzner-spezifisch. Eine Rebase-Bereitstellung besteht aus zwei trennbaren Teilen — dem veröffentlichten Runtime-Image und dem **Bundle**, das `rebase build` erzeugt — und dasselbe Bundle läuft unter Docker Compose auf einem Laptop, in der Rebase Cloud, unter dem [Helm-Chart](/docs/deployment/kubernetes) und auf einer Hetzner-Maschine. Ein Wechsel dazwischen ändert die Infrastruktur, nicht die Anwendung.

## Der schnellste Weg: Terraform

Das Modul `terraform-hcloud-rebase` erstellt Server, Firewall, eine feste IP und — der entscheidende Teil — ein Volume für die Postgres-Daten, sodass ein Ersetzen des Hosts die Datenbank nicht zerstört.

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

Eines muss vor dem ersten Apply stimmen: Der A-Record für `domain` muss bereits auf den Server zeigen, sonst schlägt die Let's-Encrypt-Anfrage von Caddy fehl. Die Adresse wird unabhängig vom Server erstellt, Sie können sie also vorab mit `terraform apply -target=hcloud_primary_ip.ipv4` ermitteln, DNS setzen und dann regulär anwenden.

Der Rest dieser Seite beschreibt dieselbe Bereitstellung von Hand.

## 1. Server erstellen

1. Klicken Sie in der Hetzner Cloud Console auf **Server hinzufügen**.
2. Wählen Sie einen **Standort** — Falkenstein, Nürnberg oder Helsinki für EU-Datenhaltung.
3. Wählen Sie als **Image** Ubuntu 24.04.
4. Wählen Sie einen **Typ**: `CPX21` (3 vCPU / 4 GB) ist die praktikable Untergrenze, `CX32` (4 vCPU / 8 GB) ist komfortabel für Runtime und Postgres.
5. Fügen Sie ein **Volume** für die Datenbank hinzu. Daten auf der Systemplatte des Servers sterben mit dem Server.
6. Hinterlegen Sie Ihren SSH-Key und erstellen Sie den Server.

## 2. Docker installieren

```bash
ssh root@<ihre-server-ip>
apt update && apt install -y docker.io docker-compose-v2
```

## 3. Das Bundle auf den Server bringen

Es gibt kein Anwendungs-Image zu bauen. `rebase build` erzeugt ein Verzeichnis `dist-bundle`, und das veröffentlichte Runtime-Image führt es aus:

```bash
rebase build
rsync -a dist-bundle/ root@<ihre-server-ip>:/opt/rebase/dist-bundle/
```

Für eine echte Bereitstellung sind die beiden Varianten vorzuziehen, die kein manuelles Kopieren erfordern:

- **In ein Image backen** — `FROM rebasepro/server:0.16.0`, dann `COPY dist-bundle /bundle`; die Bereitstellung ist dann ein Tag-Wechsel.
- **Über HTTP ausliefern** — `REBASE_BUNDLE_URL` setzen; die Runtime lädt und entpackt das Bundle bei jedem Start. Genau das tut das Terraform-Modul oben, und es ist derselbe Mechanismus, den das Helm-Chart nutzt.

## 4. Konfigurieren und starten

Rebase liefert genau dafür eine Compose-Datei mit: [`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml). Sie ist das kanonische Self-Hosting-Rezept — Postgres und die Runtime, mit eingehängtem Bundle — und es lohnt sich, sie zu lesen statt zu kopieren, denn ihre Kommentare erklären jede Entscheidung.

Legen Sie die erwartete Umgebung an:

```env
POSTGRES_PASSWORD=eine_lange_zufaellige_zeichenkette
JWT_SECRET=eine_weitere_lange_zeichenkette_mit_mindestens_32_zeichen
REBASE_SERVICE_KEY=eine_dritte_lange_zeichenkette_mit_mindestens_32_zeichen
CORS_ORIGINS=https://app.ihredomain.com
```

Dann starten:

```bash
docker compose -f infra/docker/docker-compose.selfhost.yml --env-file .env up -d
```

Die Runtime lauscht innerhalb des Compose-Netzwerks auf Port 8080.

`REBASE_SERVICE_KEY` umgeht Row-Level Security. Behandeln Sie ihn wie ein Datenbank-Superuser-Passwort, nicht wie einen API-Schlüssel.

## 5. TLS mit Caddy terminieren

Exponieren Sie die Runtime niemals direkt. Caddy stellt Let's-Encrypt-Zertifikate automatisch aus; als weiterer Compose-Service bleibt der gesamte Stack in einer Datei:

```yaml
  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports: ["80:80", "443:443", "443:443/udp"]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
```

Mit folgendem `Caddyfile`:

```caddyfile
api.ihredomain.com {
    reverse_proxy api:8080
}
```

Richten Sie den A-Record dieser Domain auf den Server, bevor Sie Caddy starten, sonst schlägt die Zertifikatsanfrage fehl.

## Storage ist nicht optional

Die Runtime **verweigert den Start in Produktion**, wenn lokaler Storage konfiguriert ist: Das Container-Dateisystem wird bei jedem Neustart zerstört, und ein lokales Backend in Produktion bedeutet stillen Datenverlust.

Hetzner Object Storage ist S3-kompatibel und steht in denselben Rechenzentren — die natürliche Ergänzung:

```env
STORAGE_TYPE=s3
S3_BUCKET=my-uploads
S3_ENDPOINT=https://fsn1.your-objectstorage.com
S3_REGION=fsn1
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
```

Wenn Ihr Projekt überhaupt keine Uploads speichert, setzen Sie `FORCE_LOCAL_STORAGE=true`, um das ausdrücklich zu bestätigen. Siehe [Storage](/docs/backend/storage) für das vollständige Bild.

## Was der Boot mit Ihrem Schema macht

Mit `REBASE_MIGRATE_ON_BOOT` auf dem Standardwert `ensure` legt die Runtime Ihre Collection-Tabellen **und deren Row-Level-Security-Policies** beim Start additiv an. Ein erster Start gegen eine leere Datenbank liefert sie bereits aus — es gibt keinen Schema-Schritt, der vor der Bereitstellung nötig wäre.

Was der Boot bewusst nie tut, ist Destruktives: Er ändert keinen Spaltentyp, löscht keine Spalte und bearbeitet kein bestehendes Enum-Label. Ein Container-Neustart darf ein Schema nicht als Nebenwirkung umformen.

Zwei Dinge brauchen daher weiterhin [`rebase db push`](/docs/architecture/schema-as-code), ausgeführt aus einem Checkout oder aus CI, wo der Destructive-Change-Gate und ein Backup in Reichweite sind:

- Junction-Table-RLS für Many-to-Many-Relationen;
- jede Änderung, die nicht rein additiv ist.

Wenn Modul oder Compose-Datei Postgres an Loopback gebunden haben — beide tun das — erreichen Sie es über einen SSH-Tunnel:

```bash
ssh -N -L 5433:127.0.0.1:5432 root@<ihre-server-ip>
```

Ein zum Internet offener Datenbank-Port ist der Weg, auf dem die Zeilen einer Rebase-Bereitstellung an der Row-Level Security vorbei gelesen werden statt durch sie hindurch.

## Aktualisieren

Ändern Sie den Image-Tag und starten Sie neu. Ihr Bundle bleibt unberührt, und jedes Projekt auf dieser Runtime erhält die neue Engine.

Die Ausnahme ist die Postgres-Hauptversion: Postgres verweigert den Start gegen ein Datenverzeichnis, das von einer älteren Hauptversion geschrieben wurde. Dieses Upgrade ist immer Dump und Restore, nie in-place.

```bash
rebase db backup --out ./backups
# Volume auf der neuen Hauptversion neu anlegen
rebase db restore ./backups/<datei>.dump
```
