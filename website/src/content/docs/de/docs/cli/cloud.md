---
sourceHash: 98eee42b368266f4
title: rebase cloud
sidebar_label: rebase cloud
description: Die Befehlsgruppen von rebase cloud – Anmeldung, Projektverknüpfung, Deploys, Konfiguration, Organisationen, Datenbanken, Ressourcen, Compute, Storage, Webhooks, Cluster und Abrechnung.
---

Alles rund um Rebase Cloud, das sich in der Private Beta befindet. Siehe den
[Rebase Cloud-Leitfaden](/docs/deployment/cloud/) dafür, was es ist und was die Beta
nicht enthält.

Jede Gruppe reagiert auf `--help`, und `--help` führt den Befehl niemals aus. Die meisten Befehle
wirken auf das verknüpfte Projekt in `.rebase/cloud.json`; `--project <id>` operiert auf
einem Projekt ohne Verknüpfung.

Drei Optionen gelten überall: `--json` für maschinenlesbare Ausgabe (auch der
Standard bei Pipes oder mit `REBASE_JSON=1`), `--url <origin>`, um eine
bestimmte Control Plane anzusteuern (oder `REBASE_CLOUD_URL`), und `--project, -p <id>`.

## Auth

```bash
rebase cloud login      # sign in to the control plane
rebase cloud logout     # sign out
rebase cloud whoami     # the current session, or what REBASE_TOKEN may do
rebase cloud tokens create --can deploy,logs   # a token for CI, shown once
```

## Projekt-Verknüpfung

```bash
rebase cloud link         # dieses Verzeichnis mit einem Cloud-Projekt verknüpfen
rebase cloud link [url]   # oder direkt auf ein Backend: keine Control Plane, kein Login, und der Rest der Befehlsfamilie wird verweigert, bis Sie unlink ausführen
rebase cloud unlink       # die Verknüpfung entfernen
rebase cloud use [org]    # die aktive Organisation auswählen
rebase cloud open         # das Dashboard in einem Browser öffnen
```

## Projekte

```bash
rebase cloud init --claim [--name <name>]   # ein Live-Backend ohne Konto und ein Link, um es innerhalb von 72 Stunden zu übernehmen
rebase cloud projects list
rebase cloud projects create [--link]
rebase cloud projects info [id]
rebase cloud projects delete [id]
```

## Deployen und Überwachen

```bash
rebase cloud deploy [app] [--source .]   # eine App deployen und Build-Logs streamen
rebase cloud logs [--runtime] [-f]       # Build-Logs oder die des laufenden Prozesses
rebase cloud deployments list [--limit N|--all]
rebase cloud rollback [id] [-y]          # zurück zu einem erfolgreichen Deploy
rebase cloud cancel [-y]                 # den laufenden Build abbrechen
rebase cloud start | stop | restart [-y] # stop und restart erfordern -y
rebase cloud status                      # Projektstatus auf einen Blick
rebase cloud metrics                     # Live-CPU / Speicher / Festplatte
rebase cloud debug [health|logs|…]       # ein Deployment diagnostizieren, schreibgeschützt
```

`deploy` ohne App-Namen deployt das Backend. Ein Backend-Bundle-Deploy
lädt auch den Quellcode des Projekts hoch — was Git trackt, niemals eine `.env` —, sodass ein
Plattform-Upgrade es neu bauen kann; `--no-source` überspringt dies einmalig, und `cloud settings set
--platform-rebuilds off` stoppt dies und löscht die gespeicherte Kopie. `--allow-downgrade` deployt ein älteres Release.

## Konfiguration

```bash
rebase cloud env list | set | unset | reveal | pull
rebase cloud domains list | add <domain> | verify [domain] | remove <domain>
rebase cloud extensions list | enable | disable
rebase cloud settings show | set        # Name, Branch, Repo, Subdomain, Rebuilds
```

## Organisationen

```bash
rebase cloud orgs list | create | members
```

## Datenbanken

```bash
rebase cloud db list | create | info | connect | test
rebase cloud db backup list | create | restore | status | download
rebase cloud db pitr status | restore | cutover | discard
```

`db connect` öffnet einen lokalen Port, der *die* verwaltete Datenbank ist (kein öffentlicher
Endpunkt), bis Strg-C gedrückt wird; `--reveal` fügt das Passwort hinzu. Nur für Owner oder Admin.

## Ressourcen

Was die Plattform für das Projekt vorhält, im Vergleich zu dem, was ihr Code deklariert.

```bash
rebase cloud resources                       # jede Datenbank und jeder Bucket: deklariert? bereitgestellt?
rebase cloud resources prune database <key>  # eine entfernen, die der Code nicht mehr deklariert
```

Ein Deploy entfernt niemals eine bereitgestellte Datenbank, wenn ihre Deklaration wegfällt — das
wären Daten, die durch einen Push gelöscht würden. Sie wird beibehalten, gebunden und abgerechnet, bis jemand
sie namentlich bereinigt (pruned).

## Compute

Was das Projekt reserviert und was das kostet.

```bash
rebase cloud compute            # die aktuelle Reservierung und ihre monatlichen Kosten
rebase cloud compute set        # ändern
```

`compute set` akzeptiert `--cpu`, `--memory`, `--replicas`, `--spot`,
`--scale-to-zero`, `--db-instances`, `--db-cpu`, `--db-memory`,
`--storage`, `--autoscale-max`, `--autoscale-cpu-target` und `--no-autoscale`.
Es gibt keine Tarifstufen: Alles wird pro Ressource bepreist. Siehe
[Rebase Cloud](/docs/deployment/cloud/).

## Storage, Webhooks, Cluster und Abrechnung

```bash
rebase cloud storage             # Storage-Buckets auflisten
rebase cloud storage create      # Plattform-verwalteten Speicher bereitstellen
rebase cloud storage attach      # Ihren eigenen S3-kompatiblen Bucket anhängen
rebase cloud webhooks list | create | delete
rebase cloud clusters list | add | verify   # die Cluster, auf denen Mandanten laufen; `add` registriert einen aus einer Kubeconfig
rebase cloud billing             # das Abrechnungskonto und die hinterlegte Karte
rebase cloud billing setup       # eine Karte hinterlegen, einmalig, öffnet einen Browser
rebase cloud billing checkout    # eine Stripe-Sitzung für ein Projekt
```
