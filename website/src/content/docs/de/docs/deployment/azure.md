---
sourceHash: 80f640adab500773
title: Bereitstellung von Rebase auf Microsoft Azure
description: Stellen Sie Ihre Rebase-Instanz sicher auf Azure mithilfe von Azure Database for PostgreSQL und Azure Container Apps bereit.
sidebar_label: Azure
---

Microsoft Azure bietet enge Integrationen und Enterprise-Compliance. Die optimale Architektur für den Betrieb von Rebase auf Azure nutzt **Azure Database for PostgreSQL – Flexible Server** für die Datenschicht und **Azure Container Apps** für die Runtime.

Um europäische Datenschutz-Compliance und schnelle lokale Antwortzeiten zu gewährleisten, stellen Sie Ihre Ressourcen in Regionen wie **West Europe (Amsterdam)**, **North Europe (Irland)** oder **France Central (Paris)** bereit.

Nichts auf dieser Seite bezüglich Ihres Projekts ist Azure-spezifisch. Ein Rebase-Deployment besteht aus zwei trennbaren Teilen – dem veröffentlichten Runtime-Image und dem **Bundle**, das `rebase build` erzeugt – und dasselbe Bundle läuft unter Docker Compose auf einem Laptop, in der Rebase Cloud, unter dem [Helm-Chart](/docs/deployment/kubernetes) und hier.

## 1. PostgreSQL Flexible Server bereitstellen

1. Suchen und wählen Sie im Azure-Portal **Azure Database for PostgreSQL servers** aus.
2. Klicken Sie auf **Erstellen** und wählen Sie **Flexible Server**.
3. Wählen Sie Ihre Ressourcengruppe und legen Sie Ihre bevorzugte EU-Region fest.
4. Wählen Sie Ihre Computegröße (z. B. General Purpose oder Burstable `B2s` für kleinere Deployments).
5. Richten Sie den Reiter **Authentifizierung** mit einem Admin-Benutzernamen und einem sicheren Passwort ein.
6. Stellen Sie unter **Netzwerk** sicher, dass „Allow public access from any Azure service within Azure to this server“ aktiviert ist, damit sich Ihre Container App verbinden kann, oder konfigurieren Sie ein sicheres VNet.
7. Notieren Sie sich Ihren Servernamen und stellen Sie die Verbindungs-URI zusammen:
   `postgresql://your_admin:YOUR_PASSWORD@your-server-name.postgres.database.azure.com:5432/postgres`

Wenn Ihre Tabellen eine `col.vector()`-Spalte deklarieren, aktivieren Sie die Extension einmalig: Azure schützt dies hinter dem Serverparameter `azure.extensions`, danach `CREATE EXTENSION vector;`.

## 2. Das Bundle erstellen und in ein Image einbinden

Es gibt **kein Anwendungs-Image, das aus Ihrem Quellcode gebaut werden muss**. `rebase build` erzeugt ein `dist-bundle`-Verzeichnis mit Ihren kompilierten Tabellen, Funktionen, Crons und – falls Ihr Projekt eine statische App deklariert – Ihrem gebauten Frontend. Das veröffentlichte Runtime-Image führt es aus:

```bash
rebase build
```

Container Apps zieht Images aus einer Registry; betten Sie das Bundle daher in ein abgeleitetes Image ein. Drei Zeilen genügen, um exakt zu fixieren, was ausgeführt wird:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.30.1
COPY dist-bundle /bundle
```

1. Erstellen Sie eine **Container Registry** in Ihrer gewählten EU-Region.
2. Melden Sie sich über Ihre CLI an:
   ```bash
   az acr login --name YourRegistryName
   ```
3. Bauen und pushen Sie aus dem Projektstammverzeichnis:
   ```bash
   docker build -t yourregistryname.azurecr.io/rebase-backend:latest .
   docker push yourregistryname.azurecr.io/rebase-backend:latest
   ```

Ein späteres Upgrade von Rebase erfordert lediglich eine Änderung dieser `FROM`-Zeile. Ihr Bundle bleibt unberührt.

## 3. Die Container App bereitstellen

Azure Container Apps bietet eine serverlose Container-Umgebung mit integriertem HTTPS-Ingress.

1. Suchen Sie im Portal nach **Container Apps** und klicken Sie auf **Erstellen**.
2. Erstellen Sie eine neue Container Apps-Umgebung in Ihrer EU-Region.
3. Verweisen Sie im Reiter **Container** auf Ihre ACR-Registry und wählen Sie das Image `rebase-backend:latest` aus.
4. Legen Sie die **Umgebungsvariablen** fest:

| Name | Wert |
|------|-------|
| `DATABASE_URL` | Ihre Azure-Postgres-Verbindungszeichenfolge |
| `JWT_SECRET` | Eine sichere, zufällige Zeichenfolge mit mindestens 32 Zeichen |
| `REBASE_SERVICE_KEY` | Eine sichere, zufällige Zeichenfolge mit mindestens 32 Zeichen |
| `NODE_ENV` | `production` |
| `CORS_ORIGINS` | Ihre Frontend-Domain (z. B. `https://yourdomain.com`) |
| `FRONTEND_URL` | Ihre Frontend-URL (wird für E-Mail-Links und CORS-Fallback verwendet) |
| `DISABLE_SELF_REGISTRATION` | `true` |
| `REBASE_ADMIN_EMAIL` | Die Adresse des ersten Administrators, festgelegt **vor dem ersten Start** |
| `REBASE_ADMIN_PASSWORD` | Mindestens 12 Zeichen |

Über die letzten drei Einstellungen erhält dieses Deployment überhaupt erst einen Administrator: In der Produktion wird das erste registrierte Konto nicht automatisch hochgestuft, sodass andernfalls kein erster angemeldeter Aufrufer existieren würde. Siehe [Ihr erster Admin](/docs/getting-started/deployment/#your-first-admin). Speichern Sie die Secrets als Container Apps Secrets und referenzieren Sie diese, anstatt sie als einfache Umgebungsvariablen anzugeben.

5. Aktivieren Sie im Reiter **Ingress** den Ingress.
6. Setzen Sie den Zielport auf **8080** – den Port, auf dem das Runtime-Image lauscht, sofern `PORT` nichts anderes festlegt.
7. Richten Sie den Health Probe auf `/livez` aus. Nicht auf `/health`: Dieser führt einen Datenbank-Roundtrip durch, sodass ein Liveness-Probe darauf bei einem kurzen Schluckauf der Datenbank einen ansonsten fehlerfreien Container neu starten würde.
8. Schließen Sie die Erstellung ab. Azure stellt den Container bereit und stellt Ihnen eine mit TLS gesicherte Anwendungs-URL zur Verfügung.

## 4. Das Schema

<span class="since-badge" data-since="0.31">Seit 0.31</span>

**Die Runtime erstellt fehlende Tabellen beim Booten, einschließlich derer, die `backend/schema` deklariert.** `REBASE_MIGRATE_ON_BOOT` ist standardmäßig auf `ensure` gesetzt, was über das gesamte Schema hinweg additiv ist – es erstellt fehlende Tabellen, Spalten und Enum-Typen und wendet deren Row-Level Security an – sodass der erste Start gegen einen leeren Server direkt Ihre Collections bereitstellt.

Was `ensure` niemals tut, ist das Ändern bestehender Strukturen: Es ändert keinen Spaltentyp, löscht nichts und bearbeitet keine Labels vorhandener Enums, da ein Neustart des Containers ein Schema nicht als Nebeneffekt eines Deployments umstrukturieren darf.

Eine Sache erfordert daher weiterhin die CLI, ausgeführt aus einem Checkout oder einem CI-Job, bei dem `DATABASE_URL` auf Ihren Flexible Server zeigt (fügen Sie bei Bedarf eine Firewall-Regel hinzu, die Ihre Client-IP zulässt):

```bash
rebase db push
```

Jede Änderung, die nicht rein additiv ist – eine umbenannte Spalte, ein eingeschränkter Typ, ein entferntes Feld.

Das Runtime-Image wird ohne die CLI ausgeliefert, daher wird dies niemals innerhalb des Containers ausgeführt. Für versionierte Migrationen committen Sie Migrationsdateien mit `rebase db generate` und führen stattdessen `rebase db migrate` als Release-Schritt aus.

## Dateispeicher

Container Apps-Replikate besitzen keinen dauerhaften Speicher (persistent disk), daher führt lokaler Dateispeicher zu schleichendem Datenverlust, und die Runtime verweigert diesen in der Produktion. Azure Blob Storage unterstützt die S3-API nicht direkt; verwenden Sie daher ein S3-kompatibles Bucket in derselben Region mit `STORAGE_TYPE=s3` und dessen `S3_ENDPOINT` – siehe [Speicher](/docs/backend/storage).

## Nächste Schritte

- [Deployment](/docs/getting-started/deployment) – die Produktions-Checkliste und die Regeln für den ersten Administrator, die für jede Plattform gelten.
- [Konfiguration](/docs/getting-started/configuration) – jede Umgebungsvariable, die von der Runtime gelesen wird.
