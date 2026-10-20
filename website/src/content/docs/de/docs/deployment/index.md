---
sourceHash: 7a718828c0eed5a6
title: Deployment
sidebar_label: Übersicht
description: Wo ein Rebase-Projekt ausgeführt werden kann – Rebase Cloud, Ihr eigener Server, Kubernetes oder eine verwaltete Container-Plattform – und welche Anleitung für den jeweiligen Fall relevant ist.
---

## Was Sie bereitstellen

Ein Rebase-Deployment besteht aus zwei trennbaren Teilen: dem **veröffentlichten Runtime-Image**
(`rebasepro/server`) und dem **Bundle**, das `rebase build` aus Ihrem
Projekt erzeugt. Es muss kein Anwendungs-Image gebaut werden, und ein Upgrade
von Rebase ist eine Tag-Änderung statt eines Rebuilds. Dasselbe Bundle läuft auf
einem Laptop unter Docker Compose, in der Rebase Cloud und auf jeder der unten
aufgeführten Plattformen.

Wenn dies Ihr erstes Deployment ist, lesen Sie zuerst den
[Deployment-Leitfaden](/docs/getting-started/deployment/): Er behandelt, was der
Server bereitstellt, welche Umgebung er benötigt und wie der erste
Administrator vor dem ersten Start festgelegt wird.

## Für mich betreiben

- **[Rebase Cloud](/docs/deployment/cloud/)** — dasselbe Rebase, für Sie
  betrieben: `rebase cloud deploy` aus Ihrem Projekt, eine Datenbank pro
  Projekt, Backups und TLS inklusive.
- **[Managed Backend-Runtime](/docs/deployment/managed-runtime/)** — was ein
  Backend mit `runtime: "managed"` dort tun kann: Pakete, Arbeitsspeicher,
  Timeouts, das Dateisystem, Secrets, Speicher und ausgehender Netzwerkverkehr.

## Selbst betreiben

- **[Self-Hosting](/docs/deployment/self-hosting/)** — das Runtime-Image plus
  eine Postgres-Datenbank, auf Docker Compose oder einem einfachen VPS. Beginnen
  Sie hier.
- **[Kubernetes](/docs/deployment/kubernetes/)** — das offizielle Helm-Chart mit
  einem Migrations-Job, der das Schema verwaltet.
- **[Aufteilung in mehrere Prozesse](/docs/deployment/split-processes/)** —
  ein Bundle als API, Funktionsebene und Worker, damit eine rechenintensive
  Funktion nicht mehr mit der Daten-API konkurriert.
- **[Ausführen mehrerer Instanzen](/docs/deployment/multiple-instances/)** —
  der Zustand, den jeder Prozess für sich behält, und die Einstellung, die ihn
  teilt, bevor ein zweites Replikat Traffic empfängt.

## Plattform-Anleitungen

Jede dieser Optionen besteht aus denselben zwei Teilen, angebunden an das
verwaltete Postgres und die Container-Runtime des jeweiligen Anbieters. Alle
davon können innerhalb der EU betrieben werden.

- **[Amazon Web Services](/docs/deployment/aws/)** — RDS und App Runner.
- **[Google Cloud](/docs/deployment/gcp/)** — Cloud SQL und Cloud Run.
- **[Microsoft Azure](/docs/deployment/azure/)** — Azure Database for
  PostgreSQL und Container Apps.
- **[Hetzner Cloud](/docs/deployment/hetzner/)** — Terraform oder Docker
  Compose, in Deutschland oder Finnland.
- **[Scaleway](/docs/deployment/scaleway/)** — Serverless Containers, in
  Frankreich.
- **[Railway](/docs/deployment/railway/)** — das Image und ein verwaltetes
  Postgres in einem Projekt.
- **[Fly.io](/docs/deployment/flyio/)** — weltweit oder auf EU-Regionen
  beschränkt.
