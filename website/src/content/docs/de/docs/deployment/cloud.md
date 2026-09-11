---
sourceHash: 9e0f8ddeef2c5dcb
title: Rebase Cloud
sidebar_label: Rebase Cloud
description: Rebase Cloud ist dasselbe Rebase, für Sie betrieben. Was es ist, wie ein Projekt verknüpft und bereitgestellt wird und was die private Beta noch nicht enthält.
---

Rebase Cloud führt dasselbe Open-Source-Rebase aus, das Sie auch selbst hosten würden – dasselbe
veröffentlichte `rebasepro/server`-Image, dasselbe Bundle, dasselbe Postgres. Der
Unterschied liegt darin, wer es betreibt.

:::note[Private Beta]
Rebase Cloud befindet sich in der **privaten Beta**. Es betreibt heute bereits echte Tenants und
wird schrittweise freigeschaltet. [Zugang anfragen](https://rebase.pro/pricing).

Es ist kein Self-Service-Angebot; die folgenden Befehle erfordern daher ein freigeschaltetes Konto.
Alles andere auf dieser Website funktioniert auch ohne ein solches.
:::

## Was es ist

Ein Cloud-**Projekt** besteht aus drei Komponenten, die die Plattform für Sie betreibt:

| | Was Sie erhalten |
|---|---|
| **App** | Ihr Bundle, das auf dem veröffentlichten Runtime-Image läuft. Bereitstellungen sind ein Bundle-Upload, kein Container-Build |
| **Datenbank** | Ein verwaltetes PostgreSQL mit automatisierten Backups und Point-in-Time-Recovery |
| **Storage** | Ein eigener Bucket, falls Ihr Projekt Dateispeicher verwendet |

Jede Komponente wird beim ersten Deployment bereitgestellt und nach reservierten Ressourcen
statt pro Nutzerplatz abgerechnet.

**An Ihrem Projekt ändert sich nichts, um dort zu laufen.** Dasselbe Repository
lässt sich mit `docker compose` selbst hosten, und der Notausgang ist real: `rebase build`
erzeugt ein Bundle, das überall dort startet, wo das Runtime-Image ausgeführt werden kann.

## Ein Projekt verknüpfen

Aus einem Projektverzeichnis:

```bash
rebase cloud login
rebase cloud billing setup
rebase cloud projects create --name "My app" --subdomain my-app --link
```

`projects create` akzeptiert keine Positionsargumente. Name und Subdomain sind
Flags, und beide sind erforderlich – im Terminal werden sie interaktiv abgefragt, und ein
Headless-Lauf, bei dem eines davon fehlt, bricht mit `input_required` ab, anstatt einen
Wert zu erfinden. **Die Subdomain kann nachträglich nicht mehr geändert werden:** Sie ist der
`<slug>.rebase.website`-Host, unter dem das Projekt antwortet; wählen Sie sie also mit Bedacht.

`--link` verknüpft dieses Verzeichnis im selben Aufruf mit dem Projekt, sodass kein
separater `link`-Schritt erforderlich ist. Es schreibt `.rebase/cloud.json`, worin Projekt-ID
und Slug gespeichert werden. Diese Datei ist kein Geheimnis und enthält keine Anmeldedaten – diese
liegen in `~/.rebase/credentials.json`, geschrieben von `login`.

`billing setup` hinterlegt einmalig eine Zahlungskarte für die Organisation. Es steht
bewusst an erster Stelle der Abfolge: Das erste Deployment eines Projekts wird ohne Zahlungsdaten
verweigert, und dies erst nach Abschluss des Bundle-Uploads festzustellen, wäre die schlechtere Reihenfolge.

Ein bestehendes Projekt verknüpfen, ohne ein neues zu erstellen:

```bash
rebase cloud projects list
rebase cloud link --project my-app
```

## Bereitstellen

```bash
rebase cloud deploy
```

Ein einziger Befehl und kein Flag, das man sich merken müsste. Die `rebase.json` eines
Scaffolds deklariert `runtime: "managed"` für ihr Backend, und `deploy` liest diese Deklaration –
dies wird währenddessen ausgegeben (`rebase.json declares runtime: managed — deploying a
bundle`), baut die App in `dist-bundle`, lädt das Bundle hoch, führt es auf dem
veröffentlichten Runtime-Image aus und verfolgt das Deployment bis zu einem Endzustand. Der Exit-Code
ist das Ergebnis, sodass dieselbe Zeile unbeaufsichtigt in CI funktioniert.

Um ein zuvor erstelltes Artefakt auszuliefern – beispielsweise in einem CI-Job, der einmal
baut und zweimal deployt –, verweisen Sie auf das Verzeichnis, anstatt neu zu bauen:

```bash
rebase build
rebase cloud deploy --bundle-dir dist-bundle
```

Das Verlassen der verwalteten Runtime hat ein eigenes Flag, `--eject`, und nichts anderes
fordert es an: Ein Build, der ein verwaltetes Projekt auf ein Container-Image verschieben würde,
das es dann selbst verwaltet, wird abgelehnt, bis Sie dies explizit angeben. `--force` bedeutete
früher genau das, was die am schwersten umkehrbare Aktion der CLI unter denselben Begriff wie
„diese Datei überschreiben“ stellte; heute ist es eine unbekannte Option statt eines Alias,
sodass ein Skript, das sie verwendet, stattdessen stoppt.

Verfolgen Sie den Vorgang:

```bash
rebase cloud logs            # the build log
rebase cloud logs --runtime  # what the running container is printing
rebase cloud status          # what the platform thinks the project is doing
```

`status` meldet `blockedOn` und `nextAction`. Wenn `blockedOn` den Wert `null` hat, arbeitet
die Plattform tatsächlich und Polling ist das Richtige; wenn dort etwas genannt wird,
wartet dieses Etwas auf Sie.

## Rollback

```bash
rebase cloud deployments
rebase cloud rollback
```

Ein Rollback verweist das Projekt wieder auf den Stand eines früheren erfolgreichen Deployments
und baut niemals neu – der Wert eines Rollbacks liegt darin, dass ein Artefakt ausgeliefert
wird, das bereits zuvor ausgeführt wurde.

Welche Deployments dafür infrage kommen, hängt davon ab, wie das Projekt bereitgestellt wird,
und beide Varianten funktionieren:

| Art des Deployments | Was wiederhergestellt wird |
|---|---|
| `rebase cloud deploy` (ein Source-Build) | Das Image, das dieser Build veröffentlicht hat |
| `rebase cloud deploy --bundle` (die Plattform-Runtime) | Das Bundle, das dieses Deployment ausgeliefert hat, auf der Runtime-Version, die das Projekt aktuell ausführt |

Ein Rollback benötigt also ein Deployment, das eines von beiden aufgezeichnet hat, was ein
Projekt voraussetzt, das mindestens zweimal erfolgreich bereitgestellt wurde. `rebase cloud deployments`
markiert die geeigneten Deployments, und `--json` gibt pro Zeile `rollbackable` zusammen mit dem
`image` oder `bundle` aus, das wiederhergestellt werden würde.

Zwei Arten von Deployments werden abgelehnt, und die CLI nennt den Grund: ein Deployment,
das nicht erfolgreich war, und eines aus der Zeit, bevor die Plattform sein Artefakt aufgezeichnet
hat. In keinem der beiden Fälle gibt es Raum für Vermutungen – ein Raten würde das ausliefern,
was zuletzt gebaut oder hochgeladen wurde, während behauptet wird, dieses wiederherzustellen.
Stellen Sie stattdessen einfach die gewünschte Version bereit.

Ein Rollback hängt ein neues Deployment an, anstatt die Historie zurückzudrehen, und wartet,
bis die wiederhergestellte Version Anfragen verarbeitet, bevor Erfolg gemeldet wird. Verfolgen
Sie den Vorgang mit `rebase cloud logs -f`.

## Compute und was es kostet

Die Kosten eines Projekts berechnen sich nach den reservierten Ressourcen, nicht nach Tarifen.
`compute` gibt jeden Regler und das detaillierte Angebot der Control Plane dafür aus.
(`rebase cloud resources` ist etwas anderes: die Datenbanken und Buckets, die der Code deklariert,
und ob sie jeweils bereitgestellt sind – siehe [CLI-Referenz](/docs/cli/#rebase-cloud).)

```bash
rebase cloud compute
rebase cloud compute set --cpu 500m --memory 2Gi
```

| Regler | Einheit und Bedeutung |
|---|---|
| `--cpu`, `--memory` | App-Request pro Instanz, z. B. `500m` und `2Gi`. Leer bedeutet Plattformstandard – `250m` und `512Mi` |
| `--replicas` | Instanzen, die immer existieren: die Untergrenze des Autoscalers und was dem Projekt im Ruhezustand berechnet wird |
| `--autoscale-max` | 1–16. Die Obergrenze, die erreicht werden darf, und der Worst-Case-Abrechnungsbetrag. `--no-autoscale` schaltet dies aus |
| `--autoscale-cpu-target` | 10–95. Die CPU-Auslastung, die der Autoscaler anstrebt, bezogen auf den Request statt auf das Limit. Leer bedeutet 70 |
| `--spot` | `true` oder `false`. Preemptible-Kapazität: günstiger und wird ohne Vorwarnung neu gestartet |
| `--scale-to-zero` | `true` oder `false`. Nach Anfragen abgerechnete Rechenleistung, die bei Inaktivität stoppt, zum Preis eines Kaltstarts |
| `--db-mode` | `shared` (der geteilte Cluster) oder `dedicated` (ein eigener Cluster für dieses Projekt) |
| `--db-instances` | 1–3. `1` ist eine Einzelinstanz ohne Failover; `2` fügt ein automatisches Standby hinzu |
| `--db-cpu`, `--db-memory`, `--storage` | Pro Datenbankinstanz. Leer bedeutet `500m`, `2Gi` und das Standardvolumen |

Ein nicht gesetzter Regler ist nicht dasselbe wie einer, der auf denselben Wert festgelegt ist:
Ein leerer Regler folgt dem Plattformstandard und ändert sich mit diesem.

Absichtlich wird von der CLI nichts validiert – die Grenzwerte gehören zum Cluster,
auf dem ein Projekt läuft, und sie unterscheiden sich je nach Provider. Die Control Plane
weist Werte zurück, die sie nicht erfüllen kann, und benennt das Feld. Führen Sie
`rebase cloud compute` aus, um den Betrag in €/Monat vorher und nachher zu sehen; eine
Änderung wird sofort und anteilig ab heute wirksam, mit Ausnahme von Änderungen, die einen
Neustart der Datenbank erfordern – diese warten auf ein Wartungsfenster.

## Der restliche Funktionsumfang

| Befehlsgruppe | Was sie abdeckt |
|---|---|
| `login`, `logout`, `whoami` | Ihre Sitzung |
| `link`, `unlink`, `use`, `open` | Verknüpfen dieses Verzeichnisses mit einem Projekt, Auswählen einer Organisation, Öffnen der Konsole |
| `projects` | Erstellen, Auflisten, Überprüfen, Löschen |
| `deploy`, `logs`, `deployments`, `rollback`, `cancel` | Bereitstellen und Überwachen |
| `start`, `stop`, `restart` | Pausieren eines Projekts und Wiederinbetriebnahme |
| `status`, `metrics`, `debug` | Was es tut und warum es das nicht tut |
| `env` | Umgebungsvariablen. `list` gibt niemals Werte aus; `--secret` ist lesegeschützt (Write-only) |
| `domains` | Eigene Domains, hinzuzufügende DNS-Einträge und Verifizierung |
| `db` | Datenbank anhängen oder erstellen, Verbindung von Ihrem Rechner aus herstellen, Backups, Restore und Point-in-Time-Recovery |
| `extensions` | Die Postgres-Extension-Allowlist |
| `storage` | Der Bucket des Projekts |
| `resources` | Welche Datenbanken und Buckets die Plattform verwaltet, verglichen mit dem, was der Code deklariert |
| `compute` | Was dieses Projekt reserviert, was es kostet und wie man es ändert |
| `clusters` | Die Cluster, auf denen Tenants laufen. Nur für Plattform-Admins |
| `settings`, `orgs`, `webhooks`, `billing` | Projekteinstellungen, Organisationen, Deploy-Hooks, Abrechnung |

Jede Gruppe in dieser Tabelle antwortet auf `--help` mit einer eigenen Hilfeseite – einer
Nutzungszeile, ihren Flags und Beispielen – und `--help` führt den Befehl niemals aus.
Ein Test sichert den Index dieser Seiten ab, sodass eine ohne Hilfeseite hinzugefügte
Gruppe den Build fehlschlagen lässt, statt mit dem Inhaltsverzeichnis zu antworten.
`verify:docs` gleicht die Tabelle selbst mit diesem Index ab: Jede Gruppe, die die CLI
bereitstellt, erscheint hier genau einmal, sodass eine Gruppe, die ohne Zeile hinzugefügt
wird, den Build ebenfalls fehlschlagen lässt.

Wird die Ausgabe weitergeleitet, antwortet `--help` stattdessen in JSON: dieselbe
Nutzungszeile, Flags und Beispiele als lesbare Struktur statt sechzig Zeilen Terminal-Escape-Sequenzen.

## Was die Beta noch nicht enthält

Klar und deutlich formuliert, da es schlimmer ist, dies erst später herauszufinden:

- **Keine Regionsauswahl.** Derzeit läuft alles in einer einzigen Region. Das Placement-Modell
  existiert in der Plattform, aber ein Projekt kann keine Region auswählen.
  `projects create --provider` und `--region` sind nicht die Ausnahme, nach der sie
  aussehen: Sie halten fest, zu welchem der registrierten Deploy-Ziele der Control Plane
  ein Projekt gehört. Da es nur eines gibt, fallen beide standardmäßig darauf zurück, und
  keines von beiden verschiebt ein Projekt an einen anderen Ort. `rebase cloud projects create --help`
  weist ebenfalls darauf hin.
- **Kein Self-Service.** Der Zugriff wird in Batches freigeschaltet; es gibt keine
  Registrierung mit direkter Bezahlung.
- **Kein veröffentlichtes SLA** und kein SOC 2. Wenn Sie eines von beiden benötigen,
  geben Sie dies bitte bei der Zugangsbeantragung an, anstatt davon auszugehen.
- **Keine Preview- oder Branch-Deployments** und keine native GitHub-App. Deploy-Hooks –
  geheime URLs, auf die Sie einen Repository-Webhook richten – sind die unterstützte Automatisierungsmethode.
- **CI benötigt Zugangsdaten einer realen Person.** Es gibt noch kein Machine-Token;
  `rebase cloud login` erwartet eine E-Mail-Adresse und ein Passwort. Übergeben Sie diese als
  `REBASE_CLOUD_EMAIL` und `REBASE_CLOUD_PASSWORD` aus einem Secret-Speicher –
  `--password` hinterlässt das Passwort in Ihrer Shell-Historie und in der Prozesstabelle
  und warnt Sie davor, bevor Sie angemeldet werden.
- **Point-in-Time-Recovery ist nur über die CLI verfügbar.** Die Konsole zeigt Backups an;
  der gestufte PITR-Workflow lautet `rebase cloud db pitr`.
- **Kein öffentlicher Datenbank-Endpunkt.** Eine verwaltete Datenbank ist nicht über das
  Internet zugänglich, daher ist der in der Konsole angezeigte Host die Adresse für Ihr Backend
  und löst auf Ihrem Rechner zu nichts auf. `rebase cloud db connect` öffnet einen lokalen Port,
  der diese Datenbank darstellt, getunnelt über die Control Plane, solange Sie den Befehl
  laufen lassen – es gibt jedoch keinen permanenten Hostnamen, zu dem sich Drittanbieter-Dienste
  verbinden können. Dieser Tunnel und das Passwort hinter `rebase cloud db info --reveal`
  erfordern beide die Rolle „Owner“ oder „Admin“ der Organisation: dieselbe, die auch der
  SQL-Editor von Studio voraussetzt, da alle drei zu einer Sitzung auf Ihren Produktionsdaten führen.

## Alternativ selbst hosten

Nichts davon führt zu einem Lock-in. Die [Anleitung zum Self-Hosting](/docs/deployment/self-hosting/)
führt das identische Image und Bundle mit `docker compose` aus, und die
[Kubernetes-Anleitung](/docs/deployment/kubernetes/) baut dieselbe Topologie über
das Helm-Chart auf.

---
