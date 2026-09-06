---
sourceHash: 936afac32ad9dc9d
title: Rebase auf AWS bereitstellen
description: Stellen Sie Ihre Rebase-Instanz sicher auf Amazon Web Services bereit, unter Nutzung von RDS und AWS App Runner, mit einem starken Fokus auf Europa.
sidebar_label: AWS
---

Amazon Web Services (AWS) bietet unglaubliche Skalierbarkeit und Sicherheit auf Unternehmensniveau. Für eine Rebase-Produktionsbereitstellung empfehlen wir, die Architektur zu entkoppeln, indem **Amazon RDS** für die PostgreSQL-Datenbank und **AWS App Runner** (oder ECS Fargate) für das Node.js-Backend verwendet werden.

Um eine strikte europäische Datenkonformität zu gewährleisten, stellen Sie sicher, dass Sie vollständig innerhalb einer EU-Region operieren, wie z.B. **eu-central-1 (Frankfurt)**, **eu-west-1 (Irland)** oder **eu-west-3 (Paris)**.

## 1. Amazon RDS (PostgreSQL) bereitstellen

1. Navigieren Sie zur **RDS**-Konsole in Ihrer ausgewählten EU-Region.
2. Klicken Sie auf **Datenbank erstellen** und wählen Sie **Standard erstellen**.
3. Wählen Sie die **PostgreSQL**-Engine.
4. Wählen Sie unter Vorlagen **Produktion** oder **Kostenlose Stufe/Entwicklung** je nach Ihrer Last.
5. Erstellen Sie einen Master-Benutzernamen (z.B. `rebase_admin`) und generieren Sie ein sicheres Master-Passwort.
6. Stellen Sie unter Konnektivität sicher, dass die Datenbank innerhalb einer **VPC** platziert ist, auf die Ihre zukünftige App Runner-Instanz sicher zugreifen kann (oder machen Sie sie öffentlich zugänglich, wenn Sie die eingehenden IP-Bereiche streng kontrollieren).
7. Notieren Sie nach der Bereitstellung die **Endpoint-Endpunktadresse** und stellen Sie Ihre URI zusammen:
   `postgresql://rebase_admin:YOUR_PASSWORD@YOUR_ENDPOINT:5432/postgres`

## 2. Image zu ECR (Elastic Container Registry) pushen

AWS App Runner zieht direkt von ECR.

Es gibt **kein Anwendungs-Image, das aus Ihrem Quellcode gebaut wird**. `rebase build` erzeugt ein `dist-bundle`-Verzeichnis mit Ihren kompilierten Collections, Funktionen und Crons — und, wenn Ihr Projekt eine statische App deklariert, Ihrem gebauten Frontend. Das veröffentlichte Runtime-Image führt es aus:

```bash
rebase build
```

App Runner zieht aus einer Registry, backen Sie das Bundle also in ein abgeleitetes Image. Drei Zeilen, und sie fixieren genau das, was läuft:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.17.3
COPY dist-bundle /bundle
```

Ein späteres Rebase-Upgrade ist eine Änderung an dieser `FROM`-Zeile. Ihr Bundle bleibt unberührt.

1. Navigieren Sie zu **Elastic Container Registry** und erstellen Sie ein neues privates Repository namens `rebase-backend`.
2. Rufen Sie die von AWS in der Konsole bereitgestellten Push-Befehle ab (die die Docker-Authentifizierung handhaben).
3. Bauen und pushen Sie aus dem Projekt-Stammverzeichnis:
   ```bash
   docker build -t rebase-backend .
   ```
4. Taggen Sie es und pushen Sie es in Ihr neu erstelltes ECR-Repository.

## 3. Bereitstellen via AWS App Runner

App Runner ist der einfachste Weg, Container auf AWS auszuführen, ohne Orchestratoren verwalten zu müssen.

1. Navigieren Sie zu **AWS App Runner** und klicken Sie auf **Service erstellen**.
2. Wählen Sie **Container-Registry** und dann **Amazon ECR**.
3. Durchsuchen und wählen Sie Ihr `rebase-backend`-Image aus.
4. Stellen Sie unter **Service-Einstellungen** den Port auf **3001** ein.
5. Fügen Sie die erforderlichen Umgebungsvariablen unter der Konfigurationsregisterkarte hinzu:
   
| Key | Value |
|-----|-------|
| `DATABASE_URL` | Ihre RDS-Verbindungszeichenfolge |
| `JWT_SECRET` | Ein sicherer, zufällig generierter Hash (32+ Zeichen) |
| `NODE_ENV` | `production` |

6. (Optional) Wenn Ihre RDS-Instanz streng privat ist, konfigurieren Sie die **benutzerdefinierte VPC**-Netzwerkkonfiguration in App Runner, damit der Container sicher mit der Datenbank kommunizieren kann.
7. Klicken Sie auf **Erstellen & bereitstellen**.

AWS übernimmt die TLS-Terminierung (stellt standardmäßig eine `https`-URL bereit) und startet den Rebase-Server.

## 4. Datenbankschema erstellen

Beim Start erstellt Rebase automatisch **nur die Auth-Tabellen**. Die Tabellen für Ihre eigenen Collections werden **nicht** automatisch angelegt — Sie müssen das Schema einmalig gegen die Produktionsdatenbank pushen:

```bash
pnpm run db:push
```

Ohne diesen Schritt gibt jede Collection einen `missing table`-Fehler zurück. Die Falle dabei: Die App startet trotzdem und die Anmeldung funktioniert (die Auth-Tabellen existieren), sodass die Bereitstellung zunächst gesund aussieht.

Führen Sie den Befehl aus einem Projekt-Checkout oder aus CI aus, wobei `DATABASE_URL` auf die Produktionsdatenbank zeigt — **nicht** im Container, da das Produktions-Image ohne die CLI ausgeliefert wird. Da RDS in der Regel innerhalb einer VPC liegt, verbinden Sie sich über einen Bastion-Host (oder eine vorübergehend autorisierte öffentliche IP), um die Produktionsdatenbank von Ihrem Rechner aus zu erreichen.

Für versionierte Migrationen verwenden Sie stattdessen `pnpm run db:generate` und `pnpm run db:migrate`.
---
