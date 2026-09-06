---
sourceHash: 4d7e2205e3aed6fc
title: Rebase auf Railway bereitstellen
description: Stellen Sie Rebase mühelos mit der nativ von Railway unterstützten Dockerfile-Analyse bereit. Behalten Sie den Fokus auf die EU bei.
sidebar_label: Railway
---

Railway ist eine unglaublich beliebte moderne PaaS (Platform as a Service), die den Aufwand des DevOps minimiert. Es erkennt automatisch das Rebase Node Framework und erstellt es nahtlos.

Zusätzlich unterstützt Railway vollständig europäische Bereitstellungsregionen (Amsterdam), was bedeutet, dass Sie weiterhin strenge regionale Hosting-Konformität genießen.

## 1. Projekt & EU-Region erstellen
1. Melden Sie sich bei Ihrem [Railway-Konto](https://railway.app/) an.
2. Klicken Sie auf **Neues Projekt**.
3. Gehen Sie zu **Einstellungen -> Standardregion** und stellen Sie diese explizit auf **Europa (Amsterdam)** ein. (Wenn Sie dies *nach* der Erstellung von Diensten tun, müssen Sie diese möglicherweise manuell migrieren).

## 2. PostgreSQL bereitstellen
1. Klicken Sie in Ihrem Projekt auf **Neu** -> **Datenbank** -> **PostgreSQL hinzufügen**.
2. Warten Sie einige Sekunden, bis die Datenbank bereitgestellt ist.
3. Standardmäßig stellt Railway eine interne Variable namens `DATABASE_URL` bereit. Klicken Sie auf das Postgres-Widget -> **Variablen**, um diese Verbindungszeichenfolge zu finden.

## 3. Rebase-Code bereitstellen
1. Klicken Sie auf **Neu** -> **GitHub-Repo**.
2. Wählen Sie Ihr Rebase-Repository aus.
3. Railway erkennt das Repository sofort und sucht nach einer `Dockerfile`. Warten Sie, bis der erste Build beginnt.

:::caution
Es gibt **kein Anwendungs-Image, das aus Ihrem Quellcode gebaut wird**. `rebase build` erzeugt ein `dist-bundle`-Verzeichnis mit Ihren kompilierten Collections, Funktionen und Crons — und, wenn Ihr Projekt eine statische App deklariert, Ihrem gebauten Frontend. Das veröffentlichte Runtime-Image führt es aus:

```bash
rebase build
```

Railway zieht aus einer Registry, backen Sie das Bundle also in ein abgeleitetes Image. Drei Zeilen, und sie fixieren genau das, was läuft:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.17.3
COPY dist-bundle /bundle
```

Ein späteres Rebase-Upgrade ist eine Änderung an dieser `FROM`-Zeile. Ihr Bundle bleibt unberührt.
:::

## 4. Umgebungsvariablen festlegen
Der erste Build könnte fehlschlagen, da die Konfiguration vollständig fehlt. Lassen Sie uns das beheben.

1. Klicken Sie auf die neue Rebase GitHub Dienstkarte.
2. Gehen Sie zur Registerkarte **Variablen**.
3. Klicken Sie auf **Neue Variable** und fügen Sie hinzu:
   - `JWT_SECRET`: Generieren Sie einen sicheren, zufälligen String mit 32+ Zeichen.
   - `NODE_ENV`: Setzen Sie auf `production`.
4. Klicken Sie auf **Variable referenzieren** und wählen Sie `DATABASE_URL` aus dem bereitgestellten PostgreSQL-Dienst aus. Railway injiziert die interne Postgres-URL zur Laufzeit sicher.

## 5. Die Domain freigeben
1. Navigieren Sie in der Rebase-Dienstkarte zur Registerkarte **Einstellungen**.
2. Scrollen Sie nach unten zu **Netzwerk**.
3. Unter **Öffentliches Netzwerk** klicken Sie auf **Domain generieren**. Railway stellt eine Test-URL der Form `.up.railway.app` bereit. Sie können hier auch sicher eine benutzerdefinierte Domain anhängen.

Railway wird automatisch und sicher neu aufbauen. Ihre in der EU gehostete Plattform ist nun vollständig live!

## 6. Datenbankschema erstellen

Beim Start erstellt Rebase automatisch **nur die Auth-Tabellen**. Die Tabellen für Ihre eigenen Collections werden **nicht** automatisch angelegt — Sie müssen das Schema einmalig gegen die Produktionsdatenbank pushen:

```bash
pnpm run db:push
```

Ohne diesen Schritt gibt jede Collection einen `missing table`-Fehler zurück. Die Falle dabei: Die App startet trotzdem und die Anmeldung funktioniert (die Auth-Tabellen existieren), sodass die Bereitstellung zunächst gesund aussieht.

Führen Sie den Befehl aus einem Projekt-Checkout oder aus CI aus, wobei `DATABASE_URL` auf die Produktionsdatenbank zeigt — **nicht** im Container, da das Produktions-Image ohne die CLI ausgeliefert wird. Verwenden Sie die öffentliche Verbindungszeichenfolge Ihres Railway-Postgres-Dienstes (Postgres-Widget → **Variablen** → **Public Networking**), um die Datenbank von Ihrem Rechner aus zu erreichen.

Für versionierte Migrationen verwenden Sie stattdessen `pnpm run db:generate` und `pnpm run db:migrate`.

---
