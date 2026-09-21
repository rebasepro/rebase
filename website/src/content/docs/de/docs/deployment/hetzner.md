---
sourceHash: 07bac8e87682b53f
title: Rebase auf Hetzner Cloud bereitstellen
description: Stellen Sie Rebase mit Terraform oder Docker Compose auf Hetzner Cloud bereit – für exzellente Performance und Datensouveränität in der EU.
sidebar_label: Hetzner Cloud
---

Hetzner Cloud bietet ein außergewöhnlich gutes Preis-Leistungs-Verhältnis und ist eine starke Wahl für Projekte, die europäische Datensouveränität erfordern, mit Rechenzentren in Nürnberg, Falkenstein und Helsinki.

Nichts an Ihrem Projekt hier ist Hetzner-spezifisch. Ein Rebase-Deployment besteht aus zwei trennbaren Teilen – dem veröffentlichten Runtime-Image und dem **Bundle**, das `rebase build` erzeugt. Dasselbe Bundle läuft unter Docker Compose auf einem Laptop, in der Rebase Cloud, unter dem [Helm-Chart](/docs/deployment/kubernetes) sowie auf einer Hetzner-Instanz. Ein Wechsel dazwischen ist eine Änderung der Infrastruktur, nicht der Anwendung.

## Der schnellste Weg: Terraform

Das Modul `terraform-hcloud-rebase` stellt den Server, eine Firewall, eine statische IP und – der entscheidende Punkt – ein Volume für Postgres-Daten bereit, sodass der Austausch des Hosts die Datenbank nicht zerstört.

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

Eine Sache muss vor dem ersten Ausführen (`terraform apply`) stimmen: Der A-Record für `domain` muss bereits auf den Server verweisen, andernfalls schlägt die Let's-Encrypt-Challenge von Caddy fehl. Die Adresse wird unabhängig vom Server erstellt, sodass Sie sie zuerst mit `terraform apply -target=hcloud_primary_ip.ipv4` abrufen, den DNS-Eintrag setzen und anschließend den vollständigen Apply-Befehl ausführen können.

Der Rest dieser Seite beschreibt dasselbe Deployment manuell.

## 1. Einen Server bereitstellen

1. Klicken Sie in der Hetzner Cloud Console auf **Server hinzufügen**.
2. Wählen Sie einen **Standort** – Falkenstein, Nürnberg oder Helsinki für Datenhaltung in der EU.
3. Wählen Sie ein **Image**: Ubuntu 24.04.
4. Wählen Sie einen **Typ**: `CPX21` (3 vCPU / 4 GB) ist eine solide Basis, `CX32` (4 vCPU / 8 GB) ist komfortabel für die Runtime plus Postgres.
5. Fügen Sie ein **Volume** für die Datenbank hinzu. Daten auf der lokalen Festplatte des Servers gehen mit dem Server verloren.
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

Für ein produktives Deployment empfiehlt sich einer der beiden Ansätze, bei denen keine Dateien manuell auf den Server kopiert werden müssen:

- **In ein Image einbinden** – `FROM rebasepro/server:0.22.0`, dann `COPY dist-bundle /bundle`, und die Bereitstellung durch Ändern eines Tags durchführen.
- **Über HTTP bereitstellen** – setzen Sie `REBASE_BUNDLE_URL`, und die Runtime lädt das Bundle bei jedem Start herunter und entpackt es. Genau das tut das obige Terraform-Modul, und derselbe Mechanismus wird auch vom Helm-Chart verwendet.

## 4. Konfigurieren und ausführen

Rebase liefert genau hierfür eine Compose-Datei mit: [`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml). Sie ist die kanonische Vorlage für das Self-Hosting – Postgres und die Runtime mit eingehängtem Bundle – und es lohnt sich, sie durchzulesen, anstatt sie nur zu kopieren, da die Kommentare jede Entscheidung erläutern.

Erstellen Sie die Umgebungskonfiguration, die erwartet wird:

```env
POSTGRES_PASSWORD=a_long_random_string
JWT_SECRET=another_long_random_string_at_least_32_chars
REBASE_SERVICE_KEY=a_third_long_random_string_at_least_32_chars
CORS_ORIGINS=https://app.yourdomain.com
REBASE_ADMIN_EMAIL=you@yourdomain.com
REBASE_ADMIN_PASSWORD=at_least_twelve_characters
```

`REBASE_ADMIN_EMAIL` und `REBASE_ADMIN_PASSWORD` sind neu: Bis Version 0.17.3 wurde der erste registrierte Account automatisch zum Administrator – auch in der Produktionsumgebung.

Alle sechs Variablen sind erforderlich – die Compose-Datei deklariert sie mit `${VAR:?…}` und verweigert die Variablenersetzung ohne sie.

Die letzten beiden Variablen definieren den ersten Administrator. Eine frische Datenbank enthält keine Benutzer, und außerhalb der Produktion wird die erste Registrierung zum Admin befördert – was zu einer Race Condition wird, sobald diese Instanz unter einem Hostnamen erreichbar ist, da Caddy TLS bereitstellt, noch bevor Sie etwas eingegeben haben. In der Produktion wird dieses Zeitfenster daher geschlossen und der Account stattdessen hier festgelegt; die Runtime erstellt ihn einmalig, solange die Benutzertabelle leer ist, und unternimmt bei jedem nachfolgenden Start nichts weiter. Melden Sie sich an und ändern Sie das Passwort.

Starten Sie den Stack anschließend:

```bash
docker compose -f infra/docker/docker-compose.selfhost.yml --env-file .env up -d
```

Die Runtime lauscht auf Port 8080 innerhalb des Compose-Netzwerks.

`REBASE_SERVICE_KEY` umgeht die Row-Level-Security. Behandeln Sie diesen Schlüssel wie die Zugangsdaten eines Datenbank-Superusers, nicht wie einen API-Schlüssel.

## 5. TLS mit Caddy terminieren

Exponieren Sie die Runtime niemals direkt. Caddy stellt Let's-Encrypt-Zertifikate automatisch bereit; wird Caddy als weiterer Compose-Dienst betrieben, bleibt der gesamte Stack in einer einzigen Datei:

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

Leiten Sie den A-Record dieser Domain auf den Server weiter, bevor Sie Caddy starten, andernfalls schlägt die Zertifikatsanforderung fehl.

## Storage ist nicht optional

Die Runtime **verweigert den Start in der Produktion**, wenn lokaler Speicher konfiguriert ist, da das Dateisystem des Containers bei jedem Neustart zerstört wird und ein lokales Backend in der Produktion zu stillem Datenverlust führt.

Hetzner Object Storage ist S3-kompatibel und befindet sich in denselben Rechenzentren, womit es die ideale Ergänzung darstellt:

```env
STORAGE_TYPE=s3
S3_BUCKET=my-uploads
S3_ENDPOINT=https://fsn1.your-objectstorage.com
S3_REGION=fsn1
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
```

Falls Ihr Projekt keinerlei Uploads speichert, setzen Sie `FORCE_LOCAL_STORAGE=true`, um dies explizit zu bestätigen. Siehe [Storage](/docs/backend/storage) für alle Details.

## Was der Boot-Vorgang mit Ihrem Schema macht

Wenn `REBASE_MIGRATE_ON_BOOT` auf dem Standardwert `ensure` steht, richtet die Runtime Ihre Collection-Tabellen **und deren Row-Level-Security-Policies** beim Start additiv ein. Nach dem ersten Start mit einer leeren Datenbank sind diese sofort verfügbar – es ist kein Schema-Schritt erforderlich, bevor das Deployment einsatzbereit ist.

Was der Boot-Vorgang ganz bewusst niemals tut, sind destruktive Änderungen: Er ändert weder Spaltentypen noch löscht er Spalten oder bearbeitet bestehende Enum-Werte. Ein Container-Neustart darf niemals als Nebeneffekt das Schema umgestalten können.

Zwei Dinge erfordern daher weiterhin [`rebase db push`](/docs/architecture/schema-as-code), ausgeführt aus einem lokalen Checkout oder der CI, wo Absicherungen gegen destruktive Änderungen und Backups griffbereit sind:

- RLS für Junction-Tabellen bei Many-to-Many-Relationen;
- jede Änderung, die nicht rein additiv ist.

Wenn das Modul oder die Compose-Datei Postgres an das Loopback-Interface gebunden hat – was beide tun –, greifen Sie über einen SSH-Tunnel darauf zu:

```bash
ssh -N -L 5433:127.0.0.1:5432 root@<your-server-ip>
```

Über einen für das Internet offenen Datenbank-Port werden bei einem Rebase-Deployment Datensätze unter Umgehung der Row-Level-Security statt über diese ausgelesen.

## Upgrades

Ändern Sie das Image-Tag und starten Sie neu. Ihr Bundle bleibt unberührt, und jedes Projekt auf dieser Runtime übernimmt die neue Engine.

Die Ausnahme ist die Major-Version von Postgres: Postgres weigert sich, mit einem Datenverzeichnis zu starten, das von einer älteren Major-Version geschrieben wurde. Daher erfolgt ein solches Upgrade immer per Dump und Restore, niemals In-Place.

```bash
rebase db backup --out ./backups
# recreate the volume on the new major
rebase db restore ./backups/<file>.dump
```
