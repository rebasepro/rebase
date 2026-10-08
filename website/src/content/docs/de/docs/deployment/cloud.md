---
sourceHash: 406fc1b9cadefefb
title: Rebase Cloud
sidebar_label: Rebase Cloud
description: Rebase Cloud ist dasselbe Rebase, für Sie betrieben. Was es ist, wie ein Projekt verknüpft und bereitgestellt wird und was die Private Beta noch nicht enthält.
---

Rebase Cloud führt dasselbe Open-Source-Rebase aus, das Sie auch selbst hosten würden – dasselbe veröffentlichte `rebasepro/server`-Image, dasselbe Bundle, dasselbe Postgres. Der Unterschied besteht darin, wer es betreibt.

:::note[Private Beta]
Rebase Cloud befindet sich in der **Private Beta**. Es betreibt bereits heute echte Tenants und wird schrittweise freigeschaltet. [Zugang anfragen](https://rebase.pro/pricing).

Es ist kein Self-Service, daher erfordern die folgenden Befehle ein Konto, das freigeschaltet wurde. Alles andere auf dieser Website funktioniert ohne ein solches Konto.
:::

## Was es ist

Ein Cloud-**Projekt** besteht aus drei Komponenten, die die Plattform für Sie betreibt:

| | Was Sie erhalten |
|---|---|
| **App** | Ihr Bundle, ausgeführt auf dem veröffentlichten Runtime-Image. Deployments sind ein Bundle-Upload, kein Container-Build |
| **Database** | Ein verwaltetes PostgreSQL mit automatisierten Backups und Point-in-Time-Recovery |
| **Storage** | Ein eigener Bucket, falls Ihr Projekt Dateispeicher nutzt |

Jede Komponente wird beim ersten Deployment bereitgestellt und danach abgerechnet, was sie reserviert, statt pro Benutzer.

**An Ihrem Projekt ändert sich nichts, um dort zu laufen.** Dasselbe Repository lässt sich per Self-Hosting mit `docker compose` betreiben, und die Ausstiegsoption (Escape Hatch) ist real: `rebase build` erzeugt ein Bundle, das überall dort startet, wo das Runtime-Image ausgeführt werden kann.

## Ein Projekt verknüpfen

Aus einem Projektverzeichnis heraus:

```bash
rebase cloud login
rebase cloud billing setup
rebase cloud projects create --name "My app" --subdomain my-app --link
```

`projects create` nimmt kein Positionsargument entgegen. Der Name und die Subdomain sind Flags, und beide sind erforderlich – im Terminal werden sie abgefragt, und ein Headless-Lauf, bei dem eines von beiden fehlt, bricht mit `input_required` ab, anstatt eines zu erfinden. **Die Subdomain kann nachträglich nicht mehr geändert werden:** Sie ist der `<slug>.rebase.website`-Host, unter dem das Projekt erreichbar ist; wählen Sie sie daher mit Bedacht.

`--link` verknüpft dieses Verzeichnis im selben Aufruf mit dem Projekt, sodass kein separater `link`-Schritt nötig ist. Es schreibt `.rebase/cloud.json`, worin die Projekt-ID und der Slug gespeichert werden. Diese Datei ist kein Geheimnis und enthält nicht Ihre Anmeldedaten – diese liegen in `~/.rebase/credentials.json`, geschrieben von `login`.

Sie wird jedoch mit dem Code committet, sodass ein geklontes Repository jede beliebige Control Plane benennen kann. Wenn der Host nur aus dieser Datei stammt und weder der eigene der Plattform ist noch einer, bei dem Sie sich zuvor angemeldet haben, nennt `login` ihn und fragt nach, bevor Ihre E-Mail-Adresse und Ihr Passwort dorthin gesendet werden. Ohne Terminal oder mit `--json` bricht es mit `unknown_control_plane` ab; übergeben Sie `--url <host>` (oder setzen Sie `REBASE_CLOUD_URL`), um sich bewusst dort anzumelden.

`billing setup` verknüpft einmalig eine Zahlungskarte mit der Organisation. Es steht absichtlich an erster Stelle: Das erste Deployment eines Projekts wird ohne Zahlungskarte verweigert, und dies erst nach dem vollständigen Upload eines Bundles zu erfahren, wäre die schlechtere Reihenfolge.

Ein bestehendes Projekt verknüpfen, ohne ein neues zu erstellen:

```bash
rebase cloud projects list
rebase cloud link --project my-app
```

## Deployen

```bash
rebase cloud deploy
```

Ein Befehl und kein Flag, das man sich merken muss. Die `rebase.json` eines Scaffolds deklariert `runtime: "managed"` für sein Backend, und `deploy` liest diese Deklaration – dies wird im Ablauf ausgegeben (`rebase.json declares runtime: managed — deploying a bundle`), baut die App in `dist-bundle`, lädt das Bundle hoch, führt es auf dem veröffentlichten Runtime-Image aus und verfolgt das Deployment bis zum finalen Status. Der Exit-Code liefert das Ergebnis, sodass dieselbe Zeile unbeaufsichtigt in CI funktioniert.

Um ein Artefakt auszuliefern, das bereits zuvor gebaut wurde – beispielsweise ein CI-Job, der einmal baut und zweimal deployt –, verweisen Sie auf das Verzeichnis, anstatt neu zu bauen:

```bash
rebase build
rebase cloud deploy --bundle-dir dist-bundle
```

Das Verlassen der Managed Runtime erfordert ein eigenes Flag, `--eject`, und nichts anderes fordert dies an: Ein Build, der ein Managed-Projekt auf ein Container-Image verschieben würde, das es dann selbst verwaltet, wird verweigert, bis Sie dies explizit angeben. Früher bedeutete `--force` genau das, wodurch die am schwersten umkehrbare Aktion der CLI unter demselben Begriff wie „diese Datei überschreiben“ lief; mittlerweile ist dies eine unbekannte Option statt eines Alias, sodass ein Skript, das sie enthält, stattdessen abbricht.

Verfolgen Sie den Vorgang:

```bash
rebase cloud logs            # the build log
rebase cloud logs --runtime  # what the running container is printing
rebase cloud status          # what the platform thinks the project is doing
```

`status` meldet `blockedOn` und `nextAction`. Wenn `blockedOn` `null` ist, arbeitet die Plattform tatsächlich und Polling ist der richtige Weg; wenn dort etwas angegeben ist, wartet dieses Etwas auf Sie.

## Rollback

```bash
rebase cloud deployments
rebase cloud rollback
```

Ein Rollback verweist das Projekt wieder auf das, was ein früheres erfolgreiches Deployment ausgeliefert hat, und baut niemals neu – der Wert eines Rollbacks liegt darin, dass ein Artefakt ausgeliefert wird, das bereits gelaufen ist.

Welche Deployments infrage kommen, hängt davon ab, wie das Projekt deployt wird, und beide Varianten funktionieren:

| Wie deployt wurde | Was wiederhergestellt wird |
|---|---|
| `rebase cloud deploy` (ein Source-Build) | Das Image, das dieser Build veröffentlicht hat |
| `rebase cloud deploy --bundle` (die Plattform-Runtime) | Das Bundle, das dieses Deployment ausgeliefert hat, auf der Runtime-Version, die das Projekt aktuell ausführt |

Ein Rollback erfordert also ein Deployment, das eines von beiden aufgezeichnet hat, was ein Projekt voraussetzt, das mindestens zweimal erfolgreich deployt wurde. `rebase cloud deployments` markiert diejenigen, die infrage kommen, und `--json` gibt `rollbackable` pro Zeile zusammen mit dem `image` oder `bundle` aus, das wiederhergestellt werden würde.

Zwei Arten von Deployments werden abgewiesen, und die CLI gibt an, welche: eines, das nicht erfolgreich war, und eines aus der Zeit, bevor die Plattform sein Artefakt aufgezeichnet hat. In keinem der beiden Fälle gibt es Raum für Vermutungen – Raten würde bedeuten, das auszuliefern, was zuletzt gebaut oder hochgeladen wurde, während behauptet wird, dieses hier wiederherzustellen – deployen Sie stattdessen die gewünschte Version.

Ein Rollback fügt ein neues Deployment an, anstatt die Versionshistorie zurückzuspulen, und wartet darauf, dass die wiederhergestellte Version Anfragen bedient, bevor Erfolg gemeldet wird. Verfolgen Sie dies mit `rebase cloud logs -f`.

## CI und Agenten

<span class="since-badge" data-since="0.24">Seit 0.24</span> Ein CI-Job oder ein Agent sollte nicht Ihr Passwort mit sich führen. Geben Sie ihm stattdessen ein Token: einen Schlüssel, der als Ihr Konto handelt, beschränkt auf wenige Aktionen in einem Projekt. Erstellen Sie es in einem angemeldeten Terminal:

```bash
rebase cloud tokens create --project shop --can deploy,logs --expires-in 90
```

Das Token wird einmal ausgegeben, als Zeile `export REBASE_TOKEN=rk_live_…`. Ist `REBASE_TOKEN` gesetzt, authentifiziert sich jeder `rebase cloud`-Befehl damit statt mit Ihrer Anmeldung und liest oder schreibt nie die gespeicherte Sitzung. Speichern Sie es in GitHub Actions als Repository-Secret und stellen Sie es unter diesem Namen bereit:

```yaml title=".github/workflows/deploy.yml"
name: Deploy
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 11
      - uses: actions/setup-node@v4
        with:
          node-version: 22.x
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec rebase cloud deploy --project shop
        env:
          REBASE_TOKEN: ${{ secrets.REBASE_TOKEN }}
```

`--can` nimmt eine oder mehrere Fähigkeiten, kommagetrennt oder wiederholt:

| Fähigkeit | Was das Token darf |
|---|---|
| `deploy` | Das Projekt deployen und seinen Builds folgen: `deploy`, `deployments` |
| `logs` | Build- und Laufzeit-Logs sowie Live-Metriken lesen: `logs`, `metrics` |
| `env` | Umgebungsvariablen lesen und ändern, Secrets eingeschlossen |
| `database` | `db list`, `db info` und `db connect`, einschließlich des Datenbankpassworts |
| `backups` | Backups auflisten, erstellen, prüfen und herunterladen sowie das Point-in-Time-Fenster lesen |

Intern ist ein Token ein [persönlicher API-Schlüssel](/docs/backend/api-keys/#personal-keys) auf der Control Plane. Jede Fähigkeit wird zu einigen [Scopes](/docs/backend/roles-and-scopes/): `deploy` für `shop` hält `project:deploy:<id>` mit der ID des Projekts, dazu die Daten- und Funktions-Scopes, die die Deploy-Befehle aufrufen. Das Token hält nie mehr, als Ihr Konto im Moment der Verwendung hält, und verliert daher alles, was Ihr Konto verliert.

Zwei Dinge bleiben bei einer angemeldeten Person:

- **Tokens verwalten.** `rebase cloud tokens list`, `create` und `revoke <id>` brauchen Ihre `rebase cloud login`-Sitzung. Ein Token kann keine Tokens auflisten, erstellen oder widerrufen, denn ein Token, das Tokens erzeugen könnte, könnte seinen eigenen Nachfolger erzeugen.
- **Wiederherstellen.** Keine Fähigkeit erlaubt das Wiederherstellen eines Backups oder `restore` und `cutover` einer Point-in-Time-Wiederherstellung. Alte Daten über eine laufende Datenbank zu legen, bleibt einem angemeldeten Owner oder Admin vorbehalten.

`rebase cloud whoami` zeigt bei gesetztem Token, was es darf und für welches Projekt. `rebase cloud tokens revoke <id> --yes` stoppt es sofort.

## Compute und die Kosten

Der Preis eines Projekts richtet sich nach den reservierten Ressourcen, nicht nach einem Tarif. `compute` gibt jeden Einstellwert und das aufgeschlüsselte Preisangebot der Control Plane dafür aus. (`rebase cloud resources` ist etwas anderes: die Datenbanken und Buckets, die der Code deklariert, und ob jede davon bereitgestellt ist – siehe [CLI-Referenz](/docs/cli/#rebase-cloud).)

```bash
rebase cloud compute
rebase cloud compute set --cpu 500m --memory 2Gi
```

| Einstellwert | Einheit und Bedeutung |
|---|---|
| `--cpu`, `--memory` | App-Request pro Instanz, z. B. `500m` und `2Gi`. Leer bedeutet Plattformstandard – `250m` und `512Mi` |
| `--replicas` | Instanzen, die immer existieren: die Untergrenze des Autoscalers und das, was dem Projekt im Ruhezustand berechnet wird |
| `--autoscale-max` | 1–16. Die Obergrenze, die erreicht werden kann, und der Maximalbetrag, der berechnet werden kann. `--no-autoscale` schaltet dies ab |
| `--autoscale-cpu-target` | 10–95. Die CPU-Auslastung, die der Autoscaler anstrebt, bezogen auf den Request und nicht auf das Limit. Leer bedeutet 70 |
| `--spot` | `true` oder `false`. Preemptible Kapazität: günstiger und wird ohne Vorankündigung neu gestartet |
| `--scale-to-zero` | `true` oder `false`. Nach Anfragen abgerechnetes Compute, das im Leerlauf stoppt, auf Kosten eines Kaltstarts |
| `--db-instances` | 1–3. `1` ist eine einzelne Instanz ohne Failover; `2` fügt eine automatische Standby-Instanz hinzu |
| `--db-cpu`, `--db-memory`, `--storage` | Pro Datenbankinstanz. Leer bedeutet `500m`, `2Gi` und das Standard-Volume |

Ein leerer Einstellwert ist nicht dasselbe wie ein Wert, der auf dieselbe Zahl festgelegt ist: Ein leerer Wert folgt dem Plattformstandard und ändert sich, wenn dieser sich ändert.

Absichtlich wird von der CLI nichts validiert – die Grenzwerte gehören zu dem Cluster, auf dem ein Projekt ausgeführt wird, und sie unterscheiden sich je nach Anbieter. Die Control Plane weist einen Wert zurück, den sie nicht einhalten kann, und nennt das entsprechende Feld. Führen Sie `rebase cloud compute` aus, um die €/Monat vor und nach der Änderung zu sehen; eine Änderung wird sofort angewendet und ab heute anteilig berechnet, mit Ausnahme von Änderungen, die einen Neustart der Datenbank erfordern, welcher auf ein Wartungsfenster wartet.

## Der Rest des Funktionsumfangs

| Befehlsgruppe | Was sie abdeckt |
|---|---|
| `login`, `logout`, `whoami` | Ihre Sitzung |
| `tokens` | Tokens für CI und Agenten, jedes auf ein Projekt beschränkt. Siehe [CI und Agenten](#ci-und-agenten) |
| `link`, `unlink`, `use`, `open` | Verknüpfen dieses Verzeichnisses mit einem Projekt, Auswählen einer Organisation, Öffnen der Konsole |
| `projects` | Erstellen, auflisten, inspizieren, löschen |
| `deploy`, `logs`, `deployments`, `rollback`, `cancel` | Ausliefern und beobachten |
| `start`, `stop`, `restart` | Pausieren eines Projekts und Wiederherstellen |
| `status`, `metrics`, `debug` | Was es tut und warum es das eventuell nicht tut |
| `cron` | Die Cron-Jobs der bereitgestellten App und ihre aufgezeichneten Läufe, gelesen mit Ihrem `rebase cloud`-Login. Nur lesend |
| `env` | Umgebungsvariablen. `list` gibt niemals Werte aus; `--secret` ist write-only |
| `domains` | Eigene Domains, hinzuzufügende DNS-Einträge und Verifizierung. Ein Projekt kann unter mehreren erreichbar sein, jede einzeln verifiziert; `verify` und `remove` erwarten die Domain, auf die sie wirken sollen, die nur weggelassen werden darf, wenn es genau eine gibt (bei `verify` eine, die noch aussteht). `list --json` gibt `{ projectId, tenantHost, domains: [...] }` zurück |
| `db` | Datenbank anhängen oder erstellen, Verbindung von Ihrem Rechner aus aufbauen, Backups, Wiederherstellung und Point-in-Time-Recovery |
| `extensions` | Die Allowlist für Postgres-Extensions |
| `storage` | Der Bucket des Projekts |
| `resources` | Welche Datenbanken und Buckets die Plattform verwaltet, im Abgleich mit dem, was der Code deklariert |
| `compute` | Was dieses Projekt reserviert, was es kostet und wie man es ändert |
| `clusters` | Die Cluster, auf denen Tenants laufen. Nur für Plattform-Admins |
| `settings`, `orgs`, `webhooks`, `billing` | Projekteinstellungen, Organisationen, Deploy-Hooks, Abrechnung |

Jede Gruppe in dieser Tabelle antwortet auf `--help` mit einer eigenen Hilfeseite – einer Nutzungszeile, ihren Flags und Beispielen – und `--help` führt den Befehl niemals aus. Ein Test überwacht den Index dieser Seiten, sodass eine hinzugefügte Gruppe ohne Hilfeseite den Build fehlschlagen lässt, anstatt mit dem Inhaltsverzeichnis zu antworten. `verify:docs` gleicht die Tabelle selbst mit diesem Index ab: Jede Gruppe, die die CLI bereitstellt, erscheint hier genau einmal, sodass eine Gruppe, die ohne Zeile hinzugefügt wird, ebenfalls den Build fehlschlagen lässt.

Über eine Pipe weitergeleitet (`piped`), antwortet `--help` stattdessen im JSON-Format: dieselbe Nutzungszeile, dieselben Flags und Beispiele als lesbare Datenstruktur statt sechzig Zeilen Terminal-Escape-Sequenzen.

## Was die Beta noch nicht enthält

Klar ausgesprochen, da es schlimmer ist, es erst später zu erfahren:

- **Keine Regionsauswahl.** Aktuell läuft alles in einer einzigen Region. Das Platzierungsmodell existiert in der Plattform, aber ein Projekt kann die Region nicht frei wählen. `projects create --provider` und `--region` sind nicht die Ausnahme, nach der sie aussehen: Sie erfassen, zu welchem der registrierten Deploy-Targets der Control Plane ein Projekt gehört. Da es nur eines gibt, verwenden beide standardmäßig dieses, und keines von beiden verschiebt ein Projekt woandershin. `rebase cloud projects create --help` weist ebenfalls darauf hin.
- **Kein Self-Service.** Der Zugriff wird in Batches gewährt; es gibt keine Registrierung mit direkter Bezahlung.
- **Kein veröffentlichtes SLA** und kein SOC 2. Wenn Sie eines davon benötigen, geben Sie dies bei der Zugriffsanfrage an, anstatt es vorauszusetzen.
- **Keine Preview- oder Branch-Deployments** und keine offizielle GitHub-App. Deploy-Hooks – geheime URLs, auf die Sie einen Webhook Ihres Repositories richten – sind die unterstützte Automatisierung.
- **Tokens handeln als Person.** Ein [Token](#ci-und-agenten) wird von einem Konto erstellt und handelt als dieses; eine Maschinenidentität, die der Organisation gehört, gibt es noch nicht. Wenn Sie sich stattdessen aus der CI anmelden, übergeben Sie `REBASE_CLOUD_EMAIL` und `REBASE_CLOUD_PASSWORD` aus einem Secret-Store – `--password` schreibt das Passwort in Ihre Shell-Historie und in die Prozesstabelle und weist Sie vor dem Anmelden darauf hin. Wenn die `.rebase/cloud.json` des Repositorys eine andere Control Plane als die eigene der Plattform benennt, übergeben Sie diese ebenfalls als `--url`: Ohne Terminal weigert sich `login`, ein Passwort an einen Host zu senden, den nur die ausgecheckte Datei benannt hat.
- **Point-in-Time-Recovery ist nur über die CLI verfügbar.** Die Konsole zeigt Backups an; der gestufte PITR-Workflow erfolgt über `rebase cloud db pitr`.
- **Kein öffentlicher Datenbank-Endpunkt.** Eine verwaltete Datenbank ist nicht für das Internet freigegeben. Der in der Konsole angezeigte Host ist die Adresse für Ihr Backend und kann auf Ihrem lokalen Rechner nicht aufgelöst werden. `rebase cloud db connect` öffnet einen lokalen Port zu dieser Datenbank, getunnelt über die Control Plane, solange Sie den Befehl laufen lassen – es gibt jedoch keinen permanenten Hostnamen, mit dem sich ein Drittanbieterdienst verbinden kann. Dieser Tunnel sowie das Passwort hinter `rebase cloud db info --reveal` erfordern beide die Rolle „Owner“ oder „Admin“ der Organisation: dieselbe Berechtigung, die auch der SQL-Editor von Studio verlangt, da alle drei letztlich zu einer Session auf Ihren Produktionsdaten führen.

## Stattdessen selbst hosten

Nichts davon bedeutet einen Lock-in. Der [Self-Hosting-Leitfaden](/docs/deployment/self-hosting/) führt das identische Image und Bundle mit `docker compose` aus, und der [Kubernetes-Leitfaden](/docs/deployment/kubernetes/) bildet dieselbe Topologie über das Helm-Chart ab.
