---
sourceHash: 535999d55c2b1a7c
title: Rebase Cloud
sidebar_label: Rebase Cloud
description: Rebase Cloud ist dasselbe Rebase, für Sie betrieben. Was es ist, wie ein Projekt verknüpft und bereitgestellt wird und was die Private Beta noch nicht enthält.
---

Rebase Cloud führt dasselbe Open-Source-Rebase aus, das Sie auch selbst hosten würden – dasselbe
veröffentlichte `rebasepro/server`-Image, dasselbe Bundle, dasselbe Postgres. Der
Unterschied liegt darin, wer es betreibt.

:::note[Private Beta]
Rebase Cloud befindet sich in der **Private Beta**. Es betreibt bereits echte Mandanten und wird
schrittweise in Batches geöffnet. [Zugang anfragen](https://rebase.pro/pricing).

Es handelt sich nicht um Self-Service, daher erfordern die folgenden Befehle ein Konto, das freigeschaltet wurde.
Alles andere auf dieser Website funktioniert ohne Konto.
:::

## Was es ist

Ein Cloud-**Projekt** besteht aus drei Dingen, die die Plattform für Sie betreibt:

| | Was Sie erhalten |
|---|---|
| **App** | Ihr Bundle, ausgeführt auf dem veröffentlichten Runtime-Image. Deployments sind ein Bundle-Upload, kein Container-Build |
| **Database** | Ein verwaltetes PostgreSQL mit automatisierten Backups und Point-in-Time-Recovery |
| **Storage** | Ein eigener Bucket, falls Ihr Projekt Dateispeicher verwendet |

Jedes davon wird bei Ihrem ersten Deployment bereitgestellt, und jedes wird nach reservierten Ressourcen
statt pro Benutzerplatz (Per-Seat) abgerechnet.

**An Ihrem Projekt ändert sich nichts, um dort ausgeführt zu werden.** Dasselbe Repository
lässt sich mit `docker compose` selbst hosten, und der Notausstieg ist real: `rebase build`
erzeugt ein Bundle, das überall startet, wo das Runtime-Image ausgeführt wird.

## Ein Projekt verknüpfen

Aus einem Projektverzeichnis:

```bash
rebase cloud login
rebase cloud billing setup
rebase cloud projects create --name "My app" --subdomain my-app --link
```

`projects create` akzeptiert keine Positionsargumente. Der Name und die Subdomain sind
Flags, und beide sind erforderlich – im Terminal werden sie interaktiv abgefragt, und ein
Headless-Lauf, der eines davon auslässt, bricht mit `input_required` ab, anstatt eines zu
erfinden. **Die Subdomain kann nachträglich nicht mehr bearbeitet werden:** Sie ist der
`<slug>.rebase.website`-Host, unter dem das Projekt erreichbar ist, wählen Sie sie also mit Bedacht.

`--link` bindet dieses Verzeichnis im selben Aufruf an das Projekt, sodass kein
separater `link`-Schritt nötig ist. Es schreibt `.rebase/cloud.json`, worin die Projekt-ID
und der Slug festgehalten werden. Diese Datei ist kein Geheimnis und enthält keine Zugangsdaten – diese
befinden sich in `~/.rebase/credentials.json`, geschrieben von `login`.

`billing setup` verknüpft einmalig eine Zahlungskarte mit der Organisation. Es steht
absichtlich an erster Stelle: Das erste Deployment eines Projekts wird ohne Zahlungskarte
verweigert, und das erst nach dem Hochladen eines Bundles zu erfahren, wäre die schlechtere Reihenfolge.

Ein bestehendes Projekt lässt sich verknüpfen, ohne ein neues zu erstellen:

```bash
rebase cloud projects list
rebase cloud link --project my-app
```

## Bereitstellen

```bash
rebase cloud deploy
```

Ein einziger Befehl, und keine Flags, die man sich merken muss. Die `rebase.json` eines Scaffolds
deklariert `runtime: "managed"` für sein Backend, und `deploy` liest diese Deklaration – dies
wird bei der Ausführung angezeigt (`rebase.json declares runtime: managed — deploying a
bundle`), baut die App nach `dist-bundle`, lädt das Bundle hoch, führt es auf dem
veröffentlichten Runtime-Image aus und verfolgt das Deployment bis zu einem finalen Status. Der Exit-Code
ist das Ergebnis, sodass dieselbe Zeile unbeaufsichtigt in CI funktioniert.

Um ein Artefakt auszuliefern, das zuvor gebaut wurde – beispielsweise ein CI-Job, der einmal baut und
zweimal deployt –, verweisen Sie auf das Verzeichnis, anstatt neu zu bauen:

```bash
rebase build
rebase cloud deploy --bundle-dir dist-bundle
```

Das Verlassen der verwalteten Runtime erfordert ein eigenes Flag, `--eject`, und nichts anderes
fordert dies an: Ein Build, der ein verwaltetes Projekt auf ein Container-Image verschieben würde, das es dann
selbst besitzt, wird abgelehnt, bis Sie dies explizit angeben. Früher bedeutete `--force` dies, was die
am wenigsten umkehrbare Aktion der CLI unter dasselbe Wort wie „diese Datei überschreiben“ stellte;
heute ist es eine unbekannte Option statt eines Alias, sodass ein Skript, das dieses Flag enthält,
stattdessen stoppt.

Überwachen:

```bash
rebase cloud logs            # the build log
rebase cloud logs --runtime  # what the running container is printing
rebase cloud status          # what the platform thinks the project is doing
```

`status` gibt `blockedOn` und `nextAction` aus. Wenn `blockedOn` den Wert `null` hat,
arbeitet die Plattform tatsächlich und Polling ist der richtige Weg; wenn dort
etwas benannt wird, wartet dieses Etwas auf Sie.

## Rollback durchführen

```bash
rebase cloud deployments
rebase cloud rollback
```

Ein Rollback verweist das Projekt wieder auf das, was ein früheres erfolgreiches Deployment
ausgeliefert hat, und führt niemals einen Rebuild durch – der Wert eines Rollbacks besteht darin, dass es ein
Artefakt ausliefert, das bereits gelaufen ist.

Welche Deployments infrage kommen, hängt davon ab, wie das Projekt bereitgestellt wird, und beide Arten
funktionieren:

| Art des Deployments | Was wiederhergestellt wird |
|---|---|
| `rebase cloud deploy` (ein Source-Build) | Das Image, das dieser Build veröffentlicht hat |
| `rebase cloud deploy --bundle` (die Plattform-Runtime) | Das Bundle, das dieses Deployment ausgeliefert hat, auf der Runtime-Version, die das Projekt jetzt ausführt |

Ein Rollback erfordert also ein Deployment, das eines von beiden aufgezeichnet hat, was ein
Projekt voraussetzt, das mindestens zweimal erfolgreich bereitgestellt wurde. `rebase cloud deployments`
markiert diejenigen, die qualifiziert sind, und `--json` gibt pro Zeile `rollbackable` zusammen
mit dem `image` oder `bundle` an, das wiederhergestellt werden würde.

Zwei Arten von Deployments werden abgelehnt, und die CLI nennt den Grund: eines, das nicht erfolgreich war,
und eines aus der Zeit, bevor die Plattform sein Artefakt aufgezeichnet hat. In beiden Fällen gibt es kein
Raten – Raten würde bedeuten, das bereitzustellen, was zuletzt gebaut oder hochgeladen wurde,
während behauptet wird, dieses wiederherzustellen. Stellen Sie stattdessen die Version bereit, die Sie möchten.

Ein Rollback hängt ein neues Deployment an, anstatt die Historie zurückzuspulen, und wartet darauf,
dass die wiederhergestellte Version Anfragen bedient, bevor Erfolg gemeldet wird. Verfolgen Sie es mit
`rebase cloud logs -f`.

## Compute und was es kostet

Ein Projekt wird nach dem bepreist, was es reserviert, nicht nach Tarifen. `compute` gibt
jeden Einstellwert und das aufgeschlüsselte Angebot der Control Plane dafür aus. (`rebase cloud
resources` ist etwas anderes: die Datenbanken und Buckets, die der Code deklariert,
und ob sie jeweils bereitgestellt sind – siehe [CLI-Referenz](/docs/cli/#rebase-cloud).)

```bash
rebase cloud compute
rebase cloud compute set --cpu 500m --memory 2Gi
```

| Einstellwert | Einheit und Bedeutung |
|---|---|
| `--cpu`, `--memory` | App-Request pro Instanz, z. B. `500m` und `2Gi`. Leer bedeutet Plattform-Standard – `250m` und `512Mi` |
| `--replicas` | Instanzen, die immer existieren: die Untergrenze des Autoscalers und das, was dem Projekt im Ruhezustand berechnet wird |
| `--autoscale-max` | 1–16. Die Obergrenze, die erreicht werden darf, und der Worst-Case, der abgerechnet werden kann. `--no-autoscale` schaltet dies ab |
| `--autoscale-cpu-target` | 10–95. Die CPU-Auslastung, die der Autoscaler hält, bezogen auf den Request statt auf das Limit. Leer bedeutet 70 |
| `--spot` | `true` oder `false`. Präemptive Kapazität: günstiger und wird ohne Vorankündigung neu gestartet |
| `--scale-to-zero` | `true` oder `false`. Nach Anfragen abgerechnetes Compute, das im Leerlauf stoppt, auf Kosten eines Kaltstarts |
| `--db-mode` | `shared` (der geteilte Cluster) oder `dedicated` (ein eigener für dieses Projekt) |
| `--db-instances` | 1–3. `1` ist eine einzelne Instanz ohne Failover; `2` fügt ein automatisches Standby hinzu |
| `--db-cpu`, `--db-memory`, `--storage` | Pro Datenbankinstanz. Leer bedeutet `500m`, `2Gi` und das Standard-Volume |

Ein leerer Wert ist nicht dasselbe wie ein Wert, der fest auf dieselbe Zahl gesetzt ist: Ein leerer Wert
folgt dem Plattform-Standard und ändert sich, wenn sich dieser ändert.

Die CLI führt absichtlich keine Validierung durch – die Limits gehören zu dem Cluster, auf dem
ein Projekt läuft, und sie unterscheiden sich je nach Provider. Die Control Plane lehnt Werte ab, die
sie nicht erfüllen kann, und benennt das Feld. Führen Sie `rebase cloud compute` aus, um den Betrag
in €/Monat vor und nach der Änderung zu sehen; eine Änderung wird sofort wirksam und ab heute anteilig berechnet,
mit Ausnahme von Änderungen, die einen Neustart der Datenbank erfordern – diese warten auf ein Wartungsfenster.

## Der restliche Funktionsumfang

| Befehlsgruppe | Was sie abdeckt |
|---|---|
| `login`, `logout`, `whoami` | Ihre Sitzung |
| `link`, `unlink`, `use`, `open` | Binden dieses Verzeichnisses an ein Projekt, Auswählen einer Organisation, Öffnen der Konsole |
| `projects` | Erstellen, Auflisten, Überprüfen, Löschen |
| `deploy`, `logs`, `deployments`, `rollback`, `cancel` | Bereitstellen und Überwachen |
| `start`, `stop`, `restart` | Pausieren eines Projekts und Wiederhochfahren |
| `status`, `metrics`, `debug` | Was es tut und warum es das eventuell nicht tut |
| `env` | Umgebungsvariablen. `list` gibt niemals Werte aus; `--secret` ist schreibgeschützt (write-only) |
| `domains` | Eigene Domains, hinzuzufügende DNS-Einträge und Verifizierung |
| `db` | Datenbank anbinden oder erstellen, Verbindung von Ihrem Rechner aus herstellen, Backups, Wiederherstellung und Point-in-Time-Recovery |
| `extensions` | Die Postgres-Erweiterungs-Allowlist |
| `storage` | Der Bucket des Projekts |
| `resources` | Welche Datenbanken und Buckets die Plattform hält, abgeglichen mit den Deklarationen im Code |
| `compute` | Was dieses Projekt reserviert, was es kostet und wie man es ändert |
| `clusters` | Die Cluster, auf denen Mandanten laufen. Nur für Plattform-Admins |
| `settings`, `orgs`, `webhooks`, `billing` | Projekteinstellungen, Organisationen, Deploy-Hooks, Abrechnung |

Jede Gruppe in dieser Tabelle beantwortet `--help` mit einer eigenen Hilfeseite – einer Nutzungszeile,
ihren Flags und Beispielen – und `--help` führt den Befehl niemals aus. Ein Test überprüft den
Index dieser Seiten; wird eine Gruppe ohne eine solche Seite hinzugefügt, schlägt der Build fehl, anstatt mit
dem Inhaltsverzeichnis zu antworten. `verify:docs` gleicht die Tabelle selbst mit diesem Index ab: Jede Gruppe,
die die CLI bereitstellt, erscheint hier genau einmal; wird eine Gruppe ohne Tabellenzeile hinzugefügt, schlägt
der Build ebenfalls fehl.

Wird die Ausgabe weitergeleitet (piped), antwortet `--help` stattdessen in JSON: dieselbe Nutzungszeile,
Flags und Beispiele als lesbare Struktur statt sechzig Zeilen Terminal-Escape-Sequenzen.

## Was die Beta noch nicht enthält

Klar und deutlich formuliert, denn es später herauszufinden, ist ärgerlicher:

- **Keine Regionsauswahl.** Derzeit läuft alles in einer einzigen Region. Das Placement-Modell
  existiert in der Plattform, aber ein Projekt kann die Region nicht frei wählen.
  `projects create --provider` und `--region` sind nicht die Ausnahme, nach der sie aussehen:
  Sie halten fest, zu welchem der in der Control Plane registrierten Deploy-Targets ein Projekt gehört.
  Da es nur eines gibt, sind beide standardmäßig darauf eingestellt und keines von beiden verschiebt ein
  Projekt an einen anderen Ort. `rebase cloud projects create --help` weist ebenfalls darauf hin.
- **Kein Self-Service.** Der Zugang wird in Batches gewährt; es gibt keine Registrierung mit direkter Bezahlung.
- **Kein veröffentlichtes SLA** und kein SOC 2. Wenn Sie eines von beiden benötigen,
  geben Sie dies bitte bei Ihrer Zugangsanfrage an, anstatt davon auszugehen.
- **Keine Preview- oder Branch-Deployments** und keine First-Party-GitHub-App. Deploy-Hooks –
  geheime URLs, auf die Sie einen Repository-Webhook richten – sind die unterstützte Automatisierung.
- **CI benötigt die Zugangsdaten einer Person.** Es gibt noch keine Machine-Tokens;
  `rebase cloud login` erwartet eine E-Mail-Adresse und ein Passwort. Übergeben Sie diese als
  `REBASE_CLOUD_EMAIL` und `REBASE_CLOUD_PASSWORD` aus einem Secret-Store –
  `--password` legt das Passwort in Ihrer Shell-Historie und in der Prozesstabelle ab
  und weist darauf hin, bevor die Anmeldung erfolgt.
- **Point-in-Time-Recovery funktioniert nur über die CLI.** Die Konsole zeigt Backups an; der
  mehrstufige PITR-Workflow lautet `rebase cloud db pitr`.
- **Kein öffentlicher Datenbank-Endpunkt.** Eine verwaltete Datenbank ist nicht über das Internet
  erreichbar. Der Host, den die Konsole anzeigt, ist die Backend-Adresse dafür und löst auf Ihrem
  lokalen Rechner nicht auf. `rebase cloud db connect` öffnet einen lokalen Port, der diese Datenbank
  darstellt, getunnelt über die Control Plane, solange Sie den Befehl ausführen – es gibt jedoch keinen
  permanenten Hostnamen, zu dem ein Drittanbieter-Dienst eine Verbindung herstellen kann.

## Stattdessen selbst hosten

Nichts hier bedeutet einen Lock-in. Der [Leitfaden zum Self-Hosting](/docs/deployment/self-hosting/)
führt das identische Image und Bundle mit `docker compose` aus, und der
[Kubernetes-Leitfaden](/docs/deployment/kubernetes/) bildet dieselbe Topologie über
das Helm-Chart ab.

---
