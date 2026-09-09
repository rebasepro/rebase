---
sourceHash: 8861ca94a0de827a
title: Rebase auf Hetzner Cloud bereitstellen
description: Stellen Sie Rebase auf Hetzner Cloud mit Terraform oder Docker Compose bereit – für exzellente Leistung in der EU und Datensouveränität.
sidebar_label: Hetzner Cloud
---

Hetzner Cloud bietet ein außergewöhnlich gutes Preis-Leistungs-Verhältnis und ist mit Rechenzentren in Nürnberg, Falkenstein und Helsinki eine hervorragende Wahl für Projekte, die europäische Datensouveränität erfordern.

Nichts an Ihrem Projekt ist hierbei Hetzner-spezifisch. Ein Rebase-Deployment besteht aus zwei trennbaren Teilen – dem veröffentlichten Runtime-Image und dem **Bundle**, das `rebase build` erzeugt – und dasselbe Bundle läuft unter Docker Compose auf einem Laptop, auf Rebase Cloud, unter dem [Helm chart](/docs/deployment/kubernetes) und auf einer Hetzner-Maschine. Der Wechsel zwischen ihnen ist eine Änderung der Infrastruktur, nicht der Anwendung.

## Der schnellste Weg: Terraform

Das Modul `terraform-hcloud-rebase` stellt den Server, eine Firewall, eine stabile IP und – der entscheidende Punkt – ein Volume für Postgres-Daten bereit, sodass ein Austausch des Hosts die Datenbank nicht zerstört.

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

Ein Punkt, den Sie vor dem ersten Apply beachten müssen: Der A-Record für `domain` muss bereits auf den Server verweisen, andernfalls schlägt Caddys Let's Encrypt-Challenge fehl. Die Adresse wird unabhängig vom Server erstellt, sodass Sie sie zuerst mit `terraform apply -target=hcloud_primary_ip.ipv4` abrufen, das DNS konfigurieren und anschließend das reguläre Apply ausführen können.

Der Rest dieser Seite beschreibt dasselbe Deployment manuell.

## 1. Einen Server bereitstellen

1. Klicken Sie in der Hetzner Cloud Console auf **Add Server**.
2. Wählen Sie einen **Standort** – Falkenstein, Nürnberg oder Helsinki für Datenhaltung in der EU.
3. Wählen Sie ein **Image**: Ubuntu 24.04.
4. Wählen Sie einen **Typ**: `CPX21` (3 vCPU / 4 GB) ist eine praktikable Mindestanforderung, `CX32` (4 vCPU / 8 GB) bietet ausreichend Reserven für die Runtime plus Postgres.
5. Fügen Sie ein **Volume** für die Datenbank hinzu. Daten auf der lokalen Festplatte des Servers gehen verloren, wenn der Server gelöscht wird.
6. Fügen Sie Ihren SSH-Schlüssel hinzu und erstellen Sie den Server.

## 2. Docker installieren

```bash
ssh root@<your-server-ip>
apt update && apt install -y docker.io docker-compose-v2
```

## 3. Bundle auf den Server übertragen

Es muss kein Anwendungs-Image gebaut werden. `rebase build` erzeugt ein `dist-bundle`-Verzeichnis, und das veröffentlichte Runtime-Image führt dieses aus:

```bash
rebase build
rsync -a dist-bundle/ root@<your-server-ip>:/opt/rebase/dist-bundle/
```

Für ein echtes Deployment sollten Sie einen der beiden Wege bevorzugen, die kein manuelles Kopieren von Dateien auf den Server erfordern:

- **In ein Image packen** – `FROM rebasepro/server:0.19.1`, dann `COPY dist-bundle /bundle`, und die Bereitstellung erfolgt durch Ändern des Tags.
- **Über HTTP bereitstellen** – setzen Sie `REBASE_BUNDLE_URL`, damit die Runtime das Bundle bei jedem Start abruft und entpackt. Genau das tut das obige Terraform-Modul, und derselbe Mechanismus wird auch im Helm-Chart verwendet.

## 4. Konfigurieren und ausführen

Rebase liefert genau dafür eine Compose-Datei mit: [`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml). Sie ist das kanonische Rezept für das Self-Hosting – Postgres und die Runtime mit eingehängtem Bundle – und es lohnt sich, sie durchzulesen, anstatt sie nur zu kopieren, da die Kommentare jede Entscheidung erklären.

Erstellen Sie die erwartete Umgebungskonfiguration:

```env
POSTGRES_PASSWORD=a_long_random_string
JWT_SECRET=another_long_random_string_at_least_32_chars
REBASE_SERVICE_KEY=a_third_long_random_string_at_least_32_chars
CORS_ORIGINS=https://app.yourdomain.com
REBASE_ADMIN_EMAIL=you@yourdomain.com
REBASE_ADMIN_PASSWORD=at_least_twelve_characters
```

`REBASE_ADMIN_EMAIL` und `REBASE_ADMIN_PASSWORD` sind neu: Unter 0.17.3 wird der erste registrierte Account zum Administrator, auch in der Produktion.

Alle sechs Variablen sind erforderlich – die Compose-Datei deklariert sie mit `${VAR:?…}` und verweigert die Interpolation ohne sie.

Die letzten beiden definieren den ersten Administrator. Eine neue Datenbank hat keine Benutzer, und außerhalb der Produktion wird die erste Registrierung zum Admin befördert – was zu einer Race Condition wird, sobald der Server unter einem Hostnamen erreichbar ist, da Caddy TLS bereitstellt, bevor Sie überhaupt etwas eingetippt haben. In der Produktion wird dieses Zeitfenster daher geschlossen und der Account stattdessen hier definiert; die Runtime erstellt ihn einmalig, solange die Benutzertabelle leer ist, und unternimmt bei jedem nachfolgenden Start nichts weiter. Melden Sie sich an und ändern Sie das Passwort.

Starten Sie anschließend den Stack:

```bash
docker compose -f infra/docker/docker-compose.selfhost.yml --env-file .env up -d
```

Die Runtime lauscht auf Port 8080 innerhalb des Compose-Netzwerks.

`REBASE_SERVICE_KEY` umgeht Row-Level Security. Behandeln Sie ihn wie die Anmeldedaten eines Datenbank-Superusers, nicht wie einen API-Schlüssel.

## 5. TLS mit Caddy terminieren

Geben Sie die Runtime niemals direkt frei. Caddy stellt Let's Encrypt-Zertifikate automatisch bereit; wenn Sie Caddy als weiteren Compose-Dienst betreiben, bleibt der gesamte Stack in einer einzigen Datei:

```yaml
  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports: ["80:80", "443:443", "443:443/udp"]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
```

Mit einem `Caddyfile` wie folgt:

```caddyfile
api.yourdomain.com {
    reverse_proxy api:8080
}
```

Lassen Sie den A-Record dieser Domain auf den Server verweisen, bevor Sie Caddy starten, da die Zertifikatsanforderung andernfalls fehlschlägt.

## Storage ist nicht optional

Die Runtime **verweigert den Start in der Produktion**, wenn lokaler Speicher konfiguriert ist, da das Dateisystem des Containers bei jedem Neustart zerstört wird und ein lokales Backend in der Produktion zu stillem Datenverlust führt.

Hetzner Object Storage ist S3-kompatibel und befindet sich in denselben Rechenzentren, womit es die naheliegende Wahl ist:

```env
STORAGE_TYPE=s3
S3_BUCKET=my-uploads
S3_ENDPOINT=https://fsn1.your-objectstorage.com
S3_REGION=fsn1
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
```

Wenn Ihr Projekt überhaupt keine Uploads speichert, setzen Sie `FORCE_LOCAL_STORAGE=true`, um dies explizit zu bestätigen. Siehe [Storage](/docs/backend/storage) für den vollständigen Überblick.

## Was der Start mit Ihrem Schema macht

Wenn `REBASE_MIGRATE_ON_BOOT` auf dem Standardwert `ensure` steht, richtet die Runtime beim Start Ihre Collection-Tabellen **und deren Row-Level-Security-Richtlinien** additiv ein. Nach dem ersten Start gegen eine leere Datenbank stehen diese direkt zur Verfügung – es ist kein separater Schemaschritt erforderlich, bevor das Deployment funktioniert.

Was beim Start ganz bewusst niemals ausgeführt wird, sind destruktive Änderungen: Es werden keine Spaltentypen geändert, Spalten gelöscht oder bestehende Enum-Werte bearbeitet. Ein Container-Neustart darf niemals das Schema als Nebeneffekt umgestalten.

Zwei Dinge erfordern daher weiterhin [`rebase db push`](/docs/architecture/schema-as-code), ausgeführt aus einem Checkout oder der CI, wo die Freigabe für destruktive Änderungen und ein Backup greifbar sind:

- RLS auf Verknüpfungstabellen (Junction Tables) für Many-to-Many-Relationen;
- jede Änderung, die nicht rein additiv ist.

Wenn das Modul oder die Compose-Datei Postgres an Loopback gebunden hat – was beide tun –, erreichen Sie es über einen SSH-Tunnel:

```bash
ssh -N -L 5433:127.0.0.1:5432 root@<your-server-ip>
```

Über einen für das Internet offenen Datenbank-Port werden bei einem Rebase-Deployment Datensätze unter Umgehung der Row-Level Security gelesen, statt durch sie hindurch.

## Upgrades

Ändern Sie das Image-Tag und starten Sie neu. Ihr Bundle bleibt unberührt, und jedes Projekt auf dieser Runtime übernimmt die neue Engine.

Die Ausnahme ist die Postgres-Hauptversion (Major Version): Postgres verweigert den Start mit einem Datenverzeichnis, das von einer älteren Hauptversion geschrieben wurde; dieses Upgrade erfordert daher Dump und Restore, niemals In-Place.

```bash
rebase db backup --out ./backups
# recreate the volume on the new major
rebase db restore ./backups/<file>.dump
```

---
