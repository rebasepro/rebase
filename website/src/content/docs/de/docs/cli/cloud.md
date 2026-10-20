---
sourceHash: 729b9c62d06bd093
title: rebase cloud
sidebar_label: rebase cloud
description: Die Befehlsgruppen für Rebase Cloud im CLI – Auth, Projektverknüpfung, Deployments, Konfiguration, Organisationen, Datenbanken, Ressourcen, Compute, Storage, Webhooks, Cluster und Abrechnung.
---

Alles rund um Rebase Cloud, das sich in der Private Beta befindet. Im
[Rebase Cloud-Leitfaden](/docs/deployment/cloud/) erfahren Sie, was es ist und was
die Beta nicht enthält.

Jede Gruppe unterstützt `--help`, und `--help` führt den Befehl niemals aus. Die meisten
Befehle beziehen sich auf das verknüpfte Projekt in `.rebase/cloud.json`; `--project <id>`
operiert auf einem Projekt ohne Verknüpfung.

Drei Optionen gelten überall: `--json` für maschinenlesbare Ausgabe (auch der
Standard bei Pipes, außer für `deploy`, oder mit `REBASE_JSON=1`), `--url <origin>`, um eine
bestimmte Control Plane anzusteuern (oder `REBASE_CLOUD_URL`), und `--project, -p <id>`.

## Auth

```bash
rebase cloud login      # sign in to the control plane
rebase cloud logout     # sign out
rebase cloud whoami     # the current session, or what REBASE_TOKEN may do
rebase cloud tokens create --can deploy,logs   # a token for CI, shown once
```

## Projektverknüpfung

```bash
rebase cloud link         # link this directory to a cloud project
rebase cloud link [url]   # or straight at a backend: no control plane, no login, and the rest of the family refuses until you unlink
rebase cloud unlink       # remove the link
rebase cloud use [org]    # select the active organization
rebase cloud open         # open the dashboard in a browser
```

## Projekte

```bash
rebase cloud projects list
rebase cloud projects create [--link]
rebase cloud projects info [id]
rebase cloud projects delete [id]
```

## Deployen und Überwachen

```bash
rebase cloud deploy [app] [--source .]   # deploy an app and stream build logs
rebase cloud logs [--runtime] [-f]       # build logs, or the running process's
rebase cloud deployments list [--limit N|--all]
rebase cloud rollback [id] [-y]          # back to a successful deploy
rebase cloud cancel [-y]                 # cancel the in-flight build
rebase cloud start | stop | restart [-y] # stop and restart need -y
rebase cloud status                      # one-glance project status
rebase cloud metrics                     # live CPU / memory / disk
rebase cloud debug [health|logs|…]       # diagnose a deployment, read-only
```

`deploy` ohne App-Namen deployt das Backend. Ein Backend-Bundle-Deploy
lädt auch den Quellcode des Projekts hoch – das, was Git verfolgt, niemals eine `.env` –,
damit ein Plattform-Upgrade ihn neu bauen kann; `--no-source` überspringt dies
einmalig, und `cloud settings set --platform-rebuilds off` deaktiviert dies und löscht
die gespeicherte Kopie. `--allow-downgrade` deployt ein älteres Release.

Ein verfolgtes `deploy` endet mit einer Zusammenfassung: jede ausgelieferte App mit ihrer URL, die Deployment-ID, die Dauer und ob die neue Version dort antwortet. Es wartet bis zu `--live-timeout` Sekunden (Standard 60; `0` überspringt die Prüfung) darauf, dass `/api/health` des Backends und die Adresse jeder statischen App antworten. Ein fehlgeschlagenes Deployment endet mit einer Zeile, die die App und den Grund nennt, und beendet sich mit einem Fehlercode. Die Zusammenfassung erscheint auch bei Pipes; `--json` (oder `REBASE_JSON=1`) gibt stattdessen ein Objekt mit `apps`, `hosts`, `live`, `liveChecks` und `durationMs` aus.

Vor dem Upload parst `deploy` das JavaScript jeder statischen App, die es ausliefert: die `.js`/`.mjs`/`.cjs`-Dateien in ihrem `output` und die Inline-`<script>`-Blöcke in ihrem HTML. Ein Syntaxfehler stoppt das Deployment mit `file:line:column` (Code `syntax_error` unter `--json`), und `--no-verify` überspringt die Prüfung. Ein erfolgreiches Deployment endet mit dem Weg zurück, `rebase cloud rollback`. Eine allein deployte statische App lässt sich noch nicht zurückrollen; siehe [Rollback](/docs/deployment/cloud#roll-back).

## Konfiguration

```bash
rebase cloud env list | set | unset | reveal | pull
rebase cloud domains list | add <domain> | verify [domain] | remove <domain>
rebase cloud extensions list | enable | disable
rebase cloud settings show | set        # name, branch, repo, subdomain, rebuilds
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

`db connect` öffnet einen lokalen Port, der die verwaltete Datenbank *ist* (kein
öffentlicher Endpunkt), bis Strg+C gedrückt wird; `--reveal` zeigt das Passwort an. Nur für
Owner oder Admins.

## Ressourcen

Was die Plattform für das Projekt vorhält, im Vergleich zu dem, was sein Code deklariert.

```bash
rebase cloud resources                       # each database and bucket: declared? provisioned?
rebase cloud resources prune database <key>  # remove one the code no longer declares
```

Ein Deploy entfernt niemals eine bereitgestellte Datenbank, wenn deren Deklaration entfällt –
das wären Daten, die durch einen Push gelöscht würden. Die Plattform behält, bindet und
berechnet sie, bis sie jemand namentlich bereinigt.

## Compute

Was das Projekt reserviert und was das kostet.

```bash
rebase cloud compute            # the current reservation and its monthly cost
rebase cloud compute set        # change it
```

`compute set` akzeptiert `--cpu`, `--memory`, `--replicas`, `--spot`,
`--db-instances`, `--db-cpu`, `--db-memory`,
`--storage`, `--autoscale-max`, `--autoscale-cpu-target` und `--no-autoscale`.
`--scale-to-zero` wurde eingestellt: Jedes Backend führt mindestens eine Instanz aus,
daher wird `true` abgelehnt und `false` mit einer Warnung ignoriert. Es gibt keine
Tarifstufen: Alles wird pro Ressource abgerechnet. Siehe
[Rebase Cloud](/docs/deployment/cloud/).

## Storage, Webhooks, Cluster und Abrechnung

```bash
rebase cloud storage             # list storage buckets
rebase cloud storage create      # provision platform-managed storage
rebase cloud storage attach      # attach your own S3-compatible bucket
rebase cloud webhooks list | create | delete
rebase cloud clusters list | add | verify   # the clusters tenants run on; `add` registers one from a kubeconfig
rebase cloud billing             # the billing account and card on file
rebase cloud billing setup       # attach a card, one-time, opens a browser
rebase cloud billing checkout    # a Stripe session for one project
```
