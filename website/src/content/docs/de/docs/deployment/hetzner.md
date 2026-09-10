---
sourceHash: 39e0a58a37e930cb
title: Bereitstellung von Rebase auf Hetzner Cloud
description: Stellen Sie Rebase auf Hetzner Cloud mit Terraform oder Docker Compose bereit, für exzellente Performance und Datensouveränität in der EU.
sidebar_label: Hetzner Cloud
---

Hetzner Cloud bietet ein außergewöhnlich gutes Preis-Leistungs-Verhältnis und ist eine hervorragende Wahl für Projekte, die europäische Datensouveränität benötigen, mit Rechenzentren in Nürnberg, Falkenstein und Helsinki.

Nichts an Ihrem Projekt ist hierbei Hetzner-spezifisch. Ein Rebase-Deployment besteht aus zwei voneinander trennbaren Teilen – dem veröffentlichten Runtime-Image und dem **Bundle**, das `rebase build` erzeugt – und dasselbe Bundle läuft unter Docker Compose auf einem Laptop, in der Rebase Cloud, unter dem [Helm-Chart](/docs/deployment/kubernetes) und auf einem Hetzner-Server. Der Wechsel dazwischen ist eine Änderung der Infrastruktur, nicht der Anwendung.

## Der schnellste Weg: Terraform

Das Modul `terraform-hcloud-rebase` stellt den Server, eine Firewall, eine feste IP-Adresse und – der entscheidende Teil – ein Volume bereit, das Postgres-Daten speichert, sodass das Ersetzen des Hosts die Datenbank nicht zerstört.

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

Eines muss vor dem ersten Apply beachtet werden: Der A-Record für `domain` muss bereits auf den Server verweisen, andernfalls schlägt Caddys Let's-Encrypt-Challenge fehl. Die Adresse wird unabhängig vom Server erstellt, sodass Sie sie zuerst mit `terraform apply -target=hcloud_primary_ip.ipv4` abrufen, das DNS konfigurieren und anschließend das vollständige Apply ausführen können.

Der Rest dieser Seite beschreibt dasselbe Deployment manuell.

## 1. Einen Server bereitstellen

1. Klicken Sie in der Hetzner Cloud Console auf **Server hinzufügen**.
2. Wählen Sie einen **Standort** – Falkenstein, Nürnberg oder Helsinki für Datenhaltung in der EU.
3. Wählen Sie ein **Image**: Ubuntu 24.04.
4. Wählen Sie einen **Typ**: `CPX21` (3 vCPU / 4 GB) ist eine funktionierende Untergrenze, `CX32` (4 vCPU / 8 GB) ist angenehm für die Runtime plus Postgres.
5. Fügen Sie ein **Volume** für die Datenbank hinzu. Daten auf der eigenen Festplatte des Servers gehen mit dem Server verloren.
6. Fügen Sie Ihren SSH-Schlüssel hinzu und erstellen Sie den Server.

## 2. Docker installieren

```bash
ssh root@<your-server-ip>
apt update && apt install -y docker.io docker-compose-v2
```

## 3. Das Bundle auf den Server übertragen

Es muss kein Anwendungs-Image gebaut werden. `rebase build` erzeugt ein `dist-bundle`-Verzeichnis, und das veröffentlichte Runtime-Image führt dieses aus:

```bash
rebase build
rsync -a dist-bundle/ root@<your-server-ip>:/opt/rebase/dist-bundle/
```

Bevorzugen Sie für ein echtes Deployment eine der beiden Varianten, die kein manuelles Kopieren von Dateien auf den Server erfordern:

- **In ein Image einbinden** – `FROM rebasepro/server:0.20.0`, dann `COPY dist-bundle /bundle`, und das Deployment erfolgt über die Änderung eines Tags.
- **Über HTTP bereitstellen** – setzen Sie `REBASE_BUNDLE_URL`, und die Runtime lädt das Bundle bei jedem Start herunter und entpackt es. Genau das tut das obige Terraform-Modul, und denselben Mechanismus nutzt auch das Helm-Chart.

## 4. Konfigurieren und starten

Rebase liefert genau dafür eine Compose-Datei mit: [`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml). Sie ist das kanonische Self-Hosting-Rezept – Postgres und die Runtime mit eingehängtem Bundle – und es lohnt sich, sie zu lesen, anstatt sie nur zu kopieren, da ihre Kommentare jede Entscheidung erklären.

Erstellen Sie die Umgebungsvariablen, die sie erwartet:

```env
POSTGRES_PASSWORD=a_long_random_string
JWT_SECRET=another_long_random_string_at_least_32_chars
REBASE_SERVICE_KEY=a_third_long_random_string_at_least_32_chars
CORS_ORIGINS=https://app.yourdomain.com
REBASE_ADMIN_EMAIL=you@yourdomain.com
REBASE_ADMIN_PASSWORD=at_least_twelve_characters
```

`REBASE_ADMIN_EMAIL` und `REBASE_ADMIN_PASSWORD` sind neu: Unter 0.17.3 wurde der erste registrierte Account zum Administrator, auch in der Produktion.

Alle sechs sind erforderlich – die Compose-Datei deklariert sie mit `${VAR:?…}` und verweigert die Interpolation ohne sie.

Die letzten beiden bestimmen den ersten Administrator. Eine frische Datenbank enthält keine Benutzer, und außerhalb der Produktion wird die erste Registrierung zum Administrator befördert – was zu einer Race Condition führt, sobald dieser Server unter einem Hostnamen erreichbar ist, da Caddy TLS bereitstellt, noch bevor Sie etwas eingetippt haben. In der Produktion wird dieses Zeitfenster daher geschlossen und der Account stattdessen hier definiert; die Runtime erstellt ihn einmalig, solange die Benutzertabelle leer ist, und unternimmt bei jedem späteren Start nichts mehr. Melden Sie sich an und ändern Sie das Passwort.

Starten Sie den Stack anschließend:

```bash
docker compose -f infra/docker/docker-compose.selfhost.yml --env-file .env up -d
```

Die Runtime lauscht auf Port 8080 innerhalb des Compose-Netzwerks.

`REBASE_SERVICE_KEY` umgeht die Row-Level Security. Behandeln Sie ihn wie die Anmeldedaten eines Datenbank-Superusers, nicht wie einen API-Schlüssel.

## 5. TLS mit Caddy terminieren

Stellen Sie die Runtime niemals direkt ins Netz. Caddy bezieht Let's-Encrypt-Zertifikate automatisch; wenn Sie es als weiteren Compose-Service ausführen, bleibt der gesamte Stack in einer einzigen Datei:

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
api.yourdomain.com {
    reverse_proxy api:8080
}
```

Leiten Sie den A-Record dieser Domain auf den Server um, bevor Sie Caddy starten, andernfalls schlägt die Zertifikatsanforderung fehl.

## Storage ist nicht optional

Die Runtime **verweigert den Start im Produktivbetrieb**, wenn lokaler Speicher konfiguriert ist, da das Dateisystem des Containers bei jedem Neustart zerstört wird und ein lokales Backend in der Produktion zu unbemerktem Datenverlust führt.

Hetzner Object Storage ist S3-kompatibel und befindet sich in denselben Rechenzentren, womit es die naheliegende Ergänzung darstellt:

```env
STORAGE_TYPE=s3
S3_BUCKET=my-uploads
S3_ENDPOINT=https://fsn1.your-objectstorage.com
S3_REGION=fsn1
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
```

Falls Ihr Projekt überhaupt keine Uploads speichert, setzen Sie `FORCE_LOCAL_STORAGE=true`, um dies explizit zu bestätigen. Siehe [Storage](/docs/backend/storage) für alle Details.

## Was beim Starten mit Ihrem Schema geschieht

Wenn `REBASE_MIGRATE_ON_BOOT` auf dem Standardwert `ensure` steht, richtet die Runtime Ihre Collection-Tabellen **und deren Row-Level-Security-Policies** beim Start additiv ein. Bei einem ersten Start mit einer leeren Datenbank ist diese sofort einsatzbereit – es muss kein vorheriger Schema-Schritt ausgeführt werden, damit das Deployment funktioniert.

Was beim Booten ganz bewusst niemals geschieht, sind destruktive Änderungen: Es werden keine Spaltentypen geändert, keine Spalten gelöscht und keine bestehenden Enum-Werte bearbeitet. Ein Container-Neustart darf niemals in der Lage sein, ein Schema als Nebeneffekt umzugestalten.

Zwei Dinge erfordern daher weiterhin [`rebase db push`](/docs/architecture/schema-as-code), ausgeführt aus einem lokalen Checkout oder der CI, wo die Freigabe für destruktive Änderungen und ein Backup in Reichweite sind:

- RLS für Zwischentabellen (Junction Tables) bei Many-to-Many-Beziehungen;
- jede Änderung, die nicht rein additiv ist.

Wenn das Modul oder die Compose-Datei Postgres an das Loopback-Interface gebunden hat – was beide tun –, greifen Sie über einen SSH-Tunnel darauf zu:

```bash
ssh -N -L 5433:127.0.0.1:5432 root@<your-server-ip>
```

Ein zum Internet hin offener Datenbankport führt dazu, dass Zeilen in einem Rebase-Deployment an der Row-Level Security vorbei statt durch sie hindurch gelesen werden.

## Upgrades

Ändern Sie das Image-Tag und starten Sie neu. Ihr Bundle bleibt unberührt, und jedes Projekt auf dieser Runtime übernimmt die neue Engine.

Die Ausnahme ist die Postgres-Hauptversion: Postgres verweigert den Start mit einem Datenverzeichnis, das von einer älteren Hauptversion geschrieben wurde, sodass dieses Upgrade immer über Dump und Restore und niemals In-Place erfolgt.

```bash
rebase db backup --out ./backups
# recreate the volume on the new major
rebase db restore ./backups/<file>.dump
```

---
