---
sourceHash: 11eb4597bacc7658
title: Rebase Cloud
sidebar_label: Rebase Cloud
description: Rebase Cloud ist dasselbe Rebase, für dich betrieben. Was es ist, wie ein Projekt verknüpft und bereitgestellt wird und was die Private Beta noch nicht enthält.
---

Rebase Cloud führt dasselbe Open-Source-Rebase aus, das du selbst hosten würdest – dasselbe
veröffentlichte `rebasepro/server`-Image, dasselbe Bundle, dasselbe Postgres. Der
Unterschied ist, wer es betreibt.

:::note[Private Beta]
Rebase Cloud befindet sich in der **Private Beta**. Es betreibt bereits heute echte Tenants und wird
schrittweise freigeschaltet. [Zugang anfragen](https://rebase.pro/pricing).

Es ist kein Self-Service, daher erfordern die folgenden Befehle ein Konto, das bereits freigeschaltet wurde.
Alles andere auf dieser Website funktioniert ohne Konto.
:::

## Was es ist

Ein Cloud-**Projekt** besteht aus drei Dingen, die die Plattform für dich betreibt:

| | Was du erhältst |
|---|---|
| **App** | Dein Bundle, ausgeführt auf dem veröffentlichten Runtime-Image. Deployments sind ein Bundle-Upload, kein Container-Build |
| **Datenbank** | Ein verwaltetes PostgreSQL mit automatisierten Backups und Point-in-Time Recovery |
| **Storage** | Ein eigener Bucket, falls dein Projekt Dateispeicher verwendet |

Jedes davon wird beim ersten Deployment bereitgestellt und nach reservierten Ressourcen
statt pro Benutzerplatz (Per-Seat) abgerechnet.

**An deinem Projekt ändert sich nichts, um dort zu laufen.** Dasselbe Repository
lässt sich per Self-Hosting mit `docker compose` betreiben, und der Ausstiegsweg (Escape Hatch) ist real: `rebase build`
erzeugt ein Bundle, das überall startet, wo das Runtime-Image läuft.

## Ein Projekt verknüpfen

Aus einem Projektverzeichnis heraus:

```bash
rebase cloud login
rebase cloud billing setup
rebase cloud projects create --name "My app" --subdomain my-app --link
```

`projects create` nimmt kein Positionsargument entgegen. Der Name und die Subdomain sind
Flags, und beide sind erforderlich – im Terminal werden sie abgefragt, und ein
Headless-Lauf, bei dem eines von beiden fehlt, bricht mit `input_required` ab, anstatt eines
zu erfinden. **Die Subdomain kann nachträglich nicht mehr bearbeitet werden:** Sie ist der
`<slug>.rebase.website`-Host, unter dem das Projekt erreichbar ist, wähle sie also mit Bedacht.

`--link` verknüpft dieses Verzeichnis im selben Aufruf mit dem Projekt, sodass kein
separater `link`-Schritt nötig ist. Es schreibt `.rebase/cloud.json`, worin die Projekt-ID
und der Slug gespeichert werden. Diese Datei ist kein Geheimnis und enthält keine Zugangsdaten – diese
liegen in `~/.rebase/credentials.json`, geschrieben von `login`.

`billing setup` hinterlegt einmalig eine Zahlungskarte für die Organisation. Es steht mit
Absicht an erster Stelle der Reihenfolge: Das erste Deployment eines Projekts wird ohne Zahlungskarte
verweigert, und dies erst nach dem fertigen Upload eines Bundles zu erfahren, wäre die schlechtere Reihenfolge.

Ein bestehendes Projekt verknüpfen, ohne ein neues zu erstellen:

```bash
rebase cloud projects list
rebase cloud link --project my-app
```

## Deploy

```bash
rebase cloud deploy
```

Ein einziger Befehl und keine Flags, die man sich merken müsste. Das `rebase.json` eines Scaffolds deklariert
`runtime: "managed"` für sein Backend, und `deploy` liest diese Deklaration – es
meldet dies beim Durchlauf (`rebase.json declares runtime: managed — deploying a
bundle`), baut die App nach `dist-bundle`, lädt das Bundle hoch, führt es auf dem
veröffentlichten Runtime-Image aus und verfolgt das Deployment bis zum Endzustand. Der Exit-Code
ist das Ergebnis, sodass dieselbe Zeile unbeaufsichtigt in CI funktioniert.

Um ein Artefakt auszuliefern, das zuvor gebaut wurde – etwa ein CI-Job, der einmal baut und
zweimal bereitstellt –, verweise auf das Verzeichnis, anstatt neu zu bauen:

```bash
rebase build
rebase cloud deploy --bundle-dir dist-bundle
```

Das Verlassen der Managed Runtime erfordert ein eigenes Flag, `--eject`, und nichts anderes fordert
dies an: Ein Build, der ein verwaltetes Projekt auf ein Container-Image verschieben würde, das es dann
selbst besitzt, wird abgelehnt, bis du dies explizit angibst. Früher bedeutete `--force` genau das,
wodurch die am wenigsten umkehrbare Aktion der CLI unter demselben Wort wie „diese Datei überschreiben“
lag; inzwischen ist es eine unbekannte Option statt eines Alias, sodass ein Skript, das sie verwendet,
stattdessen stoppt.

Den Vorgang beobachten:

```bash
rebase cloud logs            # the build log
rebase cloud logs --runtime  # what the running container is printing
rebase cloud status          # what the platform thinks the project is doing
```

`status` meldet `blockedOn` und `nextAction`. Wenn `blockedOn` gleich `null` ist,
arbeitet die Plattform tatsächlich und Polling ist das Richtige; wenn dort
etwas genannt wird, wartet dieses Etwas auf dich.

## Rollback

```bash
rebase cloud deployments
rebase cloud rollback
```

Ein Rollback verweist das Projekt wieder auf das, was ein früheres erfolgreiches Deployment
ausgeliefert hat, und baut niemals neu – der Wert eines Rollbacks liegt darin, dass es ein
Artefakt ausliefert, das bereits gelaufen ist.

Welche Deployments infrage kommen, hängt davon ab, wie das Projekt bereitgestellt wird, und beide Arten
funktionieren:

| Bereitstellungsart | Was wiederhergestellt wird |
|---|---|
| `rebase cloud deploy` (ein Source-Build) | Das Image, das dieser Build veröffentlicht hat |
| `rebase cloud deploy --bundle` (die Plattform-Runtime) | Das Bundle, das dieses Deployment ausgeliefert hat, auf der Runtime-Version, die das Projekt aktuell ausführt |

Ein Rollback benötigt also ein Deployment, das eines von beiden aufgezeichnet hat – was ein
Projekt voraussetzt, das mindestens zweimal erfolgreich bereitgestellt wurde. `rebase cloud deployments`
markiert diejenigen, die sich qualifizieren, und `--json` gibt `rollbackable` pro Zeile zusammen
mit dem `image` oder `bundle` aus, das wiederhergestellt werden würde.

Zwei Arten von Deployments werden abgelehnt, und die CLI gibt an, welche: eines, das nicht erfolgreich war,
und eines aus der Zeit, bevor die Plattform sein Artefakt aufgezeichnet hat. In beiden Fällen gibt es nichts
zu raten – ein Raten würde das ausliefern, was zuletzt gebaut oder hochgeladen wurde,
während behauptet wird, dieses wiederherzustellen – stelle stattdessen einfach die Version bereit,
die du möchtest.

Ein Rollback hängt ein neues Deployment an, anstatt den Verlauf zurückzuspulen, und wartet,
bis die wiederhergestellte Version Anfragen bedient, bevor Erfolg gemeldet wird. Verfolge es mit
`rebase cloud logs -f`.

## Compute und die Kosten

Ein Projekt wird nach den reservierten Ressourcen bepreist, nicht nach Tarifen. `compute` gibt
jeden Regler und das aufgeschlüsselte Angebot der Control Plane dafür aus. (`rebase cloud
resources` ist etwas anderes: die Datenbanken und Buckets, die der Code deklariert,
und ob jedes davon bereitgestellt ist – siehe die [CLI-Referenz](/docs/cli/#rebase-cloud).)

```bash
rebase cloud compute
rebase cloud compute set --cpu 500m --memory 2Gi
```

| Regler | Einheit und Bedeutung |
|---|---|
| `--cpu`, `--memory` | App-Request pro Instanz, z. B. `500m` und `2Gi`. Leer bedeutet Plattform-Standard – `250m` und `512Mi` |
| `--replicas` | Instanzen, die immer existieren: die Untergrenze des Autoscalers und das, was dem Projekt im Ruhezustand berechnet wird |
| `--autoscale-max` | 1–16. Die Obergrenze, die erreicht werden kann, und der Maximalfall der Abrechnung. `--no-autoscale` schaltet dies aus |
| `--autoscale-cpu-target` | 10–95. Die CPU-Auslastung, die der Autoscaler anstrebt, bezogen auf den Request statt auf das Limit. Leer bedeutet 70 |
| `--spot` | `true` oder `false`. Preemptible Kapazität: günstiger und ohne Vorankündigung neugestartet |
| `--scale-to-zero` | `true` oder `false`. Nach Anfragen abgerechnetes Compute, das im Leerlauf stoppt – auf Kosten eines Kaltstarts |
| `--db-instances` | 1–3. `1` ist eine Einzelinstanz ohne Failover; `2` fügt eine automatische Standby-Instanz hinzu |
| `--db-cpu`, `--db-memory`, `--storage` | Pro Datenbankinstanz. Leer bedeutet `500m`, `2Gi` und das Standard-Volume |

Ein leerer Regler ist nicht dasselbe wie einer, der auf denselben Wert festgelegt ist: Ein leerer Regler
folgt dem Plattform-Standard und ändert sich, wenn sich dieser ändert.

Von der CLI wird bewusst nichts validiert – die Limits gehören zu dem Cluster, auf dem ein
Projekt läuft, und sie unterscheiden sich je nach Provider. Die Control Plane weist einen
Wert zurück, den sie nicht einhalten kann, und benennt das Feld. Führe `rebase cloud compute` aus,
um den Betrag in €/Monat vorher und nachher zu sehen; eine Änderung wird sofort wirksam und ab heute anteilig
berechnet – mit Ausnahme einer Änderung, die die Datenbank neu startet, welche auf ein Wartungsfenster wartet.

## Der restliche Funktionsumfang

| Befehlsgruppe | Was sie abdeckt |
|---|---|
| `login`, `logout`, `whoami` | Deine Sitzung |
| `link`, `unlink`, `use`, `open` | Verknüpfen dieses Verzeichnisses mit einem Projekt, Auswählen einer Organisation, Öffnen der Konsole |
| `projects` | Erstellen, auflisten, inspizieren, löschen |
| `deploy`, `logs`, `deployments`, `rollback`, `cancel` | Ausliefern und beobachten |
| `start`, `stop`, `restart` | Ein Projekt anhalten und wieder starten |
| `status`, `metrics`, `debug` | Was es tut und warum nicht |
| `env` | Umgebungsvariablen. `list` gibt niemals Werte aus; `--secret` ist lesegeschützt (write-only) |
| `domains` | Eigene Domains, hinzuzufügende DNS-Einträge und Verifizierung |
| `db` | Datenbank anhängen oder erstellen, Verbindung vom lokalen Rechner herstellen, Backups, Wiederherstellung und Point-in-Time Recovery |
| `extensions` | Die Postgres-Extension-Allowlist |
| `storage` | Der Bucket des Projekts |
| `resources` | Welche Datenbanken und Buckets die Plattform verwaltet, abgeglichen mit den Deklarationen im Code |
| `compute` | Was dieses Projekt reserviert, was es kostet und wie man es ändert |
| `clusters` | Die Cluster, auf denen Tenants laufen. Nur für Plattform-Admins |
| `settings`, `orgs`, `webhooks`, `billing` | Projekteinstellungen, Organisationen, Deploy-Hooks, Abrechnung |

Jede Gruppe in dieser Tabelle beantwortet `--help` mit einer eigenen Seite – einer Syntaxzeile,
ihren Flags und Beispielen – und `--help` führt den Befehl niemals aus. Ein Test prüft den
Index der Seiten; wird eine Gruppe ohne eine solche Seite hinzugefügt, schlägt der Build fehl,
anstatt das Inhaltsverzeichnis auszugeben. `verify:docs` gleicht die Tabelle selbst mit diesem
Index ab: Jede von der CLI bereitgestellte Gruppe erscheint hier genau einmal, sodass eine Gruppe,
die ohne Zeile hinzugefügt wird, den Build ebenfalls fehlschlagen lässt.

Über eine Pipe aufgerufen antwortet `--help` stattdessen im JSON-Format: dieselbe Syntaxzeile,
Flags und Beispiele als strukturierte Daten zum Auslesen statt sechzig Zeilen Terminal-Escape-Sequenzen.

## Was die Beta noch nicht enthält

Klar und deutlich formuliert, denn es später herauszufinden ist ärgerlicher:

- **Keine freie Regionswahl.** Aktuell läuft alles in einer einzigen Region. Das Platzierungsmodell
  existiert zwar in der Plattform, ein Projekt kann die Region jedoch nicht frei wählen.
  `projects create --provider` und `--region` sind nicht die Ausnahme, nach der sie aussehen:
  Sie halten fest, zu welchem der registrierten Deploy-Ziele der Control Plane ein Projekt gehört.
  Da es nur eines gibt, fallen beide standardmäßig darauf zurück und keines von beiden verschiebt ein
  Projekt woandershin. `rebase cloud projects create --help` sagt dasselbe.
- **Kein Self-Service.** Der Zugang wird schrittweise in Batches gewährt; es gibt keine direkte
  Registrierung mit Bezahlung.
- **Kein veröffentlichtes SLA** und kein SOC 2. Wenn du eines davon benötigst, gib dies bei der
  Zugangsanfrage an, anstatt es vorauszusetzen.
- **Keine Preview- oder Branch-Deployments** und keine offizielle GitHub App. Deploy-Hooks –
  geheime URLs, auf die du einen Repository-Webhook verweisen lässt – sind die unterstützte Automatisierung.
- **CI benötigt Zugangsdaten einer Person.** Es gibt noch kein Machine-Token;
  `rebase cloud login` erwartet E-Mail und Passwort. Übergib diese als
  `REBASE_CLOUD_EMAIL` und `REBASE_CLOUD_PASSWORD` aus einem Secret-Store –
  `--password` schreibt das Passwort in deine Shell-Historie und in die Prozesstabelle und
  warnt davor, bevor es dich anmeldet.
- **Point-in-Time Recovery ist rein CLI-basiert.** Die Konsole zeigt Backups an; der
  gestufte PITR-Workflow lautet `rebase cloud db pitr`.
- **Kein öffentlicher Datenbank-Endpunkt.** Eine verwaltete Datenbank ist nicht für das Internet
  freigegeben; der Host, den die Konsole anzeigt, ist die interne Adresse deines Backends und
  löst auf deinem lokalen Rechner ins Leere auf. `rebase cloud db connect` öffnet einen lokalen Port
  zu dieser Datenbank, getunnelt über die Control Plane, solange der Befehl aktiv bleibt – es gibt
  jedoch keinen permanenten Hostnamen, zu dem sich ein Drittanbieter-Dienst verbinden kann. Dieser Tunnel
  sowie das Passwort hinter `rebase cloud db info --reveal` erfordern beide die Owner- oder Admin-Rolle
  der Organisation: dieselbe, die auch der SQL-Editor von Studio voraussetzt, da alle drei Zugriffe direkt
  in einer Session auf deinen Produktionsdaten enden.

## Stattdessen selbst hosten

Nichts davon bedeutet einen Lock-in. Der [Self-Hosting-Leitfaden](/docs/deployment/self-hosting/)
führt das identische Image und Bundle mit `docker compose` aus, und der
[Kubernetes-Leitfaden](/docs/deployment/kubernetes/) bildet dieselbe Topologie über
das Helm-Chart ab.

---
