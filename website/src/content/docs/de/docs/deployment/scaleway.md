---
sourceHash: a83732a379b7739b
title: Rebase auf Scaleway bereitstellen
description: Erfahren Sie, wie Sie Rebase auf Scaleway für eine sichere, französisch basierte Cloud-Infrastruktur mit Serverless-Containern bereitstellen.
sidebar_label: Scaleway
---

Scaleway ist ein führender europäischer Cloud-Anbieter mit Sitz in Frankreich und Rechenzentren in Paris, Amsterdam und Warschau. Es ist eine ausgezeichnete Wahl für Organisationen, die die EU-Datenhoheit priorisieren.

Wir empfehlen die Nutzung von Scaleway's **Managed Database** für eine zuverlässige Postgres-Unterstützung und **Serverless Containers**, um die Rebase Node.js-Anwendung dynamisch zu skalieren.

## 1. Eine verwaltete Postgres-Datenbank erstellen

Scaleways Managed Databases bieten automatische Backups und Hochverfügbarkeit.

Es gibt **kein Anwendungs-Image, das aus Ihrem Quellcode gebaut wird**. `rebase build` erzeugt ein `dist-bundle`-Verzeichnis mit Ihren kompilierten Collections, Funktionen und Crons — und, wenn Ihr Projekt eine statische App deklariert, Ihrem gebauten Frontend. Das veröffentlichte Runtime-Image führt es aus:

```bash
rebase build
```

Serverless Containers zieht aus einer Registry, backen Sie das Bundle also in ein abgeleitetes Image. Drei Zeilen, und sie fixieren genau das, was läuft:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.17.3
COPY dist-bundle /bundle
```

Ein späteres Rebase-Upgrade ist eine Änderung an dieser `FROM`-Zeile. Ihr Bundle bleibt unberührt.

1. Gehen Sie in der Scaleway Konsole zu **PostgreSQL**.
2. Klicken Sie auf **Datenbankinstanz erstellen**.
3. Wählen Sie eine Region (z.B. Paris - `PAR1`).
4. Wählen Sie einen Knotentyp (ein Standard **Play2-Pico** oder **Pro2-XXS** funktioniert gut).
5. Fügen Sie einen Datenbanknamen (`rebase_db`) hinzu und legen Sie ein unglaublich sicheres Benutzerpasswort fest.
6. Notieren Sie nach der Bereitstellung die **Verbindungszeichenfolge** (URI) vom Dashboard. Sie wird wie folgt aussehen:
   `postgres://user:password@ip:port/rebase_db`

## 2. Container erstellen und pushen

Scaleway Serverless Containers führen Standard-Docker-Images aus. Erstellen Sie zuerst das Rebase-Backend lokal und pushen Sie es in die Scaleway Container Registry.

1. Gehen Sie in der Scaleway Konsole zu **Container Registry** und erstellen Sie einen Namespace (z.B. `rebase-apps`).
2. Melden Sie sich vom lokalen Terminal aus mit den bereitgestellten Anweisungen bei der Registry an.
3. Bauen und pushen Sie aus dem Projekt-Stammverzeichnis:

```bash
docker build -t rg.fr-par.scw.cloud/rebase-apps/rebase-backend:latest .
```

4. Pushen Sie das Image:

```bash
docker push rg.fr-par.scw.cloud/rebase-apps/rebase-backend:latest
```

## 3. Serverless Container bereitstellen

Stellen Sie das Image nun vollständig serverless bereit, ohne Infrastruktur verwalten zu müssen.

1. Navigieren Sie zu **Serverless Containers**.
2. Klicken Sie auf **Container erstellen**.
3. Wählen Sie das Image aus, das Sie gerade aus der Container Registry gepusht haben.
4. Setzen Sie den Port auf **3001**.
5. Fügen Sie unter Umgebungsvariablen die folgenden sicher hinzu:

| Schlüssel | Wert |
|-----|-------|
| `DATABASE_URL` | Die URI aus Ihrem Managed Postgres-Schritt |
| `JWT_SECRET` | Eine sichere Zufallszeichenfolge mit 32+ Zeichen zum Signieren von Auth-Tokens |
| `NODE_ENV` | `production` |

6. Klicken Sie auf **Container bereitstellen**.

Scaleway wird den Container sofort bereitstellen und Ihnen eine öffentliche Endpunkt-URL zur Verfügung stellen (z.B. `https://rebase-backend-xxxx.functions.fnc.fr-par.scw.cloud`).

*Hinweis: Zur strikten Einhaltung der Datenvorschriften stellen Sie sicher, dass Ihre Scaleway Organisationsdetails Ihrer europäischen Unternehmenseinheit entsprechen.*

## 4. Datenbankschema erstellen

Beim Start erstellt Rebase automatisch **nur die Auth-Tabellen**. Die Tabellen für Ihre eigenen Collections werden **nicht** automatisch angelegt — Sie müssen das Schema einmalig gegen die Produktionsdatenbank pushen:

```bash
pnpm run db:push
```

Ohne diesen Schritt gibt jede Collection einen `missing table`-Fehler zurück. Die Falle dabei: Die App startet trotzdem und die Anmeldung funktioniert (die Auth-Tabellen existieren), sodass die Bereitstellung zunächst gesund aussieht.

Führen Sie den Befehl aus einem Projekt-Checkout oder aus CI aus, wobei `DATABASE_URL` auf die Produktionsdatenbank zeigt — **nicht** im Container, da das Produktions-Image ohne die CLI ausgeliefert wird. Die Managed Database von Scaleway ist über ihre öffentliche Verbindungszeichenfolge erreichbar; verwenden Sie diese URI (idealerweise mit einer auf Ihre IP beschränkten ACL), um die Datenbank von Ihrem Rechner aus zu erreichen.

Für versionierte Migrationen verwenden Sie stattdessen `pnpm run db:generate` und `pnpm run db:migrate`.
---
