---
sourceHash: 4c2b6974a271effa
title: Deployment
sidebar_label: Übersicht
description: Wo ein Rebase-Projekt laufen kann — Rebase Cloud, Ihr eigener Server, Kubernetes oder eine verwaltete Container-Plattform — und welche Anleitung Sie dafür öffnen.
---

## Was Sie deployen

Ein Rebase-Deployment besteht aus zwei trennbaren Teilen: dem
**veröffentlichten Runtime-Image** (`rebasepro/server`) und dem **Bundle**, das
`rebase build` aus Ihrem Projekt erzeugt. Es gibt kein Anwendungs-Image zu
bauen, und ein Upgrade von Rebase ist eine Tag-Änderung statt eines Rebuilds.
Dasselbe Bundle läuft lokal unter Docker Compose, auf Rebase Cloud und auf
jeder der unten genannten Plattformen.

Wenn dies Ihr erstes Deployment ist, lesen Sie zuerst den
[Deployment-Leitfaden](/docs/getting-started/deployment/): Er beschreibt, was
der Server ausliefert, welche Umgebung er braucht und wie Sie den ersten
Administrator vor dem ersten Start festlegen.

## Für mich betreiben

- **[Rebase Cloud](/docs/deployment/cloud/)** — dasselbe Rebase, von uns
  betrieben: `rebase cloud deploy` aus Ihrem Projekt, eine Datenbank pro
  Projekt, Backups und TLS inklusive.

## Selbst betreiben

- **[Self-Hosting](/docs/deployment/self-hosting/)** — das Runtime-Image plus
  eine Postgres-Datenbank, mit Docker Compose oder auf einem einfachen VPS.
  Beginnen Sie hier.
- **[Kubernetes](/docs/deployment/kubernetes/)** — das offizielle Helm-Chart,
  mit einem Migrations-Job, der das Schema besitzt.
- **[Aufteilung in mehrere Prozesse](/docs/deployment/split-processes/)** — ein
  Bundle als API, Functions-Ebene und Worker, damit eine rechenintensive
  Function nicht mehr mit der Daten-API konkurriert.

## Plattform-Anleitungen

Jede davon besteht aus denselben zwei Teilen, verbunden mit dem verwalteten
Postgres und der Container-Laufzeit des jeweiligen Anbieters. Alle lassen sich
vollständig innerhalb der EU betreiben.

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
- **[Fly.io](/docs/deployment/flyio/)** — global oder auf EU-Regionen
  festgelegt.
