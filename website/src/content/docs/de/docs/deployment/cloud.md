---
sourceHash: f4b78a4be285c361
title: Rebase Cloud
sidebar_label: Rebase Cloud
description: Rebase Cloud ist dasselbe Rebase, für Sie betrieben. Was es ist, wie ein Projekt verknüpft und bereitgestellt wird und was die private Beta noch nicht enthält.
---

Rebase Cloud führt dasselbe Open-Source-Rebase aus, das Sie selbst hosten würden – dasselbe
veröffentlichte `rebasepro/server`-Image, dasselbe Bundle, dasselbe Postgres. Der
Unterschied liegt darin, wer es betreibt.

:::note[Private Beta]
Rebase Cloud befindet sich in der **privaten Beta**. Es betreibt bereits heute echte Mandanten und wird schrittweise geöffnet. [Zugang anfragen](https://rebase.pro/pricing).

Es ist kein Self-Service-Angebot, daher erfordern die folgenden Befehle ein Konto, das bereits freigeschaltet wurde.
Alles andere auf dieser Website funktioniert auch ohne ein solches Konto.
:::

## Was es ist

Ein Cloud-**Projekt** besteht aus drei Komponenten, die die Plattform für Sie betreibt:

| | Was Sie erhalten |
|---|---|
| **App** | Ihr Bundle, ausgeführt auf dem veröffentlichten Runtime-Image. Deployments sind ein Bundle-Upload, kein Container-Build |
| **Datenbank** | Ein verwaltetes PostgreSQL mit automatisierten Backups und Point-in-Time-Recovery |
| **Storage** | Ein eigener Bucket, falls Ihr Projekt Dateispeicher verwendet |

Jede Komponente wird beim ersten Deployment bereitgestellt und jeweils nach den reservierten Ressourcen statt pro Benutzer abgerechnet.

**An Ihrem Projekt ändert sich nichts, um dort ausgeführt zu werden.** Dasselbe Repository
lässt sich mit `docker compose` selbst hosten, und der Ausstiegsweg ist real: `rebase build`
erzeugt ein Bundle, das überall startet, wo das Runtime-Image läuft.

## Projekt verknüpfen

Aus einem Projektverzeichnis:

```bash
rebase cloud login
rebase cloud billing setup
rebase cloud projects create --name "My app" --subdomain my-app --link
```

`projects create` akzeptiert keine Positionsargumente. Der Name und die Subdomain sind
Flags, und beide sind erforderlich – im Terminal werden sie abgefragt, und ein
Headless-Durchlauf, bei dem eines davon fehlt, bricht mit `input_required` ab, anstatt
einen Wert zu erfinden. **Die Subdomain kann nachträglich nicht mehr bearbeitet werden:** Sie ist der
`<slug>.rebase.website`-Host, unter dem das Projekt erreichbar ist, wählen Sie sie also mit Bedacht.

`--link` verknüpft dieses Verzeichnis im selben Aufruf mit dem Projekt, sodass kein
separater `link`-Schritt erforderlich ist. Es schreibt `.rebase/cloud.json`, worin die Projekt-ID
und der Slug gespeichert werden. Diese Datei ist kein Geheimnis und enthält nicht Ihre Anmeldedaten – diese
liegen in `~/.rebase/credentials.json`, geschrieben von `login`.

Sie wird jedoch mit dem Code committet, sodass ein geklontes Repository jede beliebige
Control Plane benennen kann. Wenn der Host ausschließlich aus dieser Datei stammt und es weder der
plattformeigene ist noch einer, bei dem Sie sich zuvor angemeldet haben, nennt `login` ihn und fragt nach,
bevor Ihre E-Mail-Adresse und Ihr Passwort dorthin gesendet werden. Ohne Terminal oder mit
`--json` verweigert der Befehl die Ausführung mit `unknown_control_plane`; übergeben Sie `--url <host>` (oder setzen Sie
`REBASE_CLOUD_URL`), um sich dort gezielt anzumelden.

`billing setup` hinterlegt einmalig eine Zahlungskarte für die Organisation. Es steht absichtlich
an erster Stelle der Sequenz: Das erste Deployment eines Projekts wird ohne hinterlegte Karte abgelehnt, und
dies erst nach dem vollständigen Upload eines Bundles zu erfahren, wäre die schlechtere Reihenfolge.

Ein bestehendes Projekt verknüpfen, ohne ein neues zu erstellen:

```bash
rebase cloud projects list
rebase cloud link --project my-app
```

## Bereitstellen

```bash
rebase cloud deploy
```

Ein einziger Befehl und kein Flag, das man sich merken muss. Die `rebase.json` eines Scaffolds deklariert
`runtime: "managed"` für ihr Backend, und `deploy` liest diese Deklaration – dies wird
beim Durchlauf ausgegeben (`rebase.json declares runtime: managed — deploying a
bundle`), baut die App nach `dist-bundle`, lädt das Bundle hoch, führt es auf dem
veröffentlichten Runtime-Image aus und verfolgt das Deployment bis zu einem finalen Status. Der Exit-Code
ist das Ergebnis, sodass dieselbe Zeile unbeaufsichtigt in CI funktioniert.

Am Ende sagt es, unter welcher Adresse jede App jetzt antwortet und ob die neue Version dort live ist:

```text
  ✓ Deployed songbuzz in 1m 12s  (deployment fb3c7442-9937-4179-8d3c-88a106da149d)

    game     static   https://songbuzz.rebase.website      live
    backend  backend  https://songbuzz.rebase.website/api  live

  ✓ Live: the new version answers on every address above.
```

„Live“ heißt, dass die Adresse nach dem Build geantwortet hat: `/api/health` des Backends lieferte `ok`, und die Seite einer statischen App wurde geladen (aus diesem Deployment, wenn die Plattform sie ausliefert). Die Prüfung wartet bis zu `--live-timeout` Sekunden, standardmäßig 60; `0` überspringt sie. Antwortet eine App nicht rechtzeitig, endet das Deployment trotzdem mit Exit-Code null, weil es erfolgreich war, und die letzte Zeile sagt, welche App nicht geantwortet hat und warum. Ein fehlgeschlagenes Deployment endet stattdessen mit einer Zeile, die die App und den Grund nennt; das vollständige Build-Log zeigt `rebase cloud logs`.

Skripte übergeben `--json` und erhalten ein Objekt mit denselben Fakten – `apps`, `hosts`, `live`, `liveChecks`, `durationMs` und die Deployment-ID. Anders als der Rest von `rebase cloud` wechselt `deploy` bei Pipes nicht von selbst zu JSON.

Um ein Artefakt auszuliefern, das bereits zuvor gebaut wurde – beispielsweise ein CI-Job, der einmal baut und zweimal deployt –, verweisen Sie auf das Verzeichnis, anstatt neu zu bauen:

Was diese Runtime zulässt – Pakete und native Module, Speicher und Instanzen,
Timeouts und Body-Größen, das Dateisystem, Secrets, Storage und ausgehender
Netzwerkverkehr – wird auf einer eigenen Seite beschrieben:
[Managed backend runtime](/docs/deployment/managed-runtime/).

Um ein Artefakt auszuliefern, das bereits zuvor gebaut wurde – etwa ein CI-Job, der einmal baut
und zweimal deployt –, verweisen Sie auf das Verzeichnis, anstatt neu zu bauen:

```bash
rebase build
rebase cloud deploy --bundle-dir dist-bundle
```

Das Verlassen der verwalteten Runtime erfordert ein eigenes Flag, `--eject`, und nichts anderes fragt
danach: Ein Build, der ein verwaltetes Projekt auf ein Container-Image verschieben würde, das es dann
selbst verwaltet, wird verweigert, bis Sie dies explizit angeben. Früher bedeutete `--force` dies, womit die
am wenigsten umkehrbare Aktion der CLI unter demselben Wort wie „diese Datei überschreiben“ stand;
mittlerweile ist dies eine unbekannte Option statt eines Alias, sodass ein Skript, das sie verwendet,
stoppt.

### Die Syntaxprüfung vor dem Upload

Die Dateien einer statischen App werden genau so ausgeliefert, wie sie sind. Wenn ihr `build` nur handgeschriebene Skripte nach `output` kopiert, hat sie niemand geparst, und eine Datei mit einem Tippfehler geht live und verhindert, dass die Seite lädt. Deshalb parst `deploy` vor jedem Upload jede `.js`-, `.mjs`- und `.cjs`-Datei im `output` jeder statischen App, dazu jedes Inline-`<script>` in ihren `.html`-Dateien. Das gilt für eine statische App, die allein deployt wird, ebenso wie für statische Apps, die in das Bundle des Backends eingebettet werden. Ein Syntaxfehler stoppt das Deployment mit Datei, Zeile und Spalte:

```
✗ A syntax error in the static output, so nothing was deployed:
    web/cloud.js:42:23  Unexpected token
        42 |     return fetch("/api";
Fix it and deploy again, or pass --no-verify to deploy anyway.
```

Mit `--json` ist der `code` des Fehlers `syntax_error`. Inline-Skripte, die ein Browser nicht als JavaScript ausführt, werden übersprungen: JSON, Import Maps, Templates und jeder andere Nicht-JavaScript-`type`, ein `<script src>` sowie ein Skript, das noch ungerendertes Template-Markup wie `{{ }}` enthält. Eine `.js`-Datei besteht die Prüfung, wenn sie sich als klassisches Skript oder als Modul parsen lässt, denn das entscheidet die Seite. Nichts unter `node_modules` wird gelesen, ebenso wenig ein vorgebautes `--bundle-dir`. `--no-verify` überspringt die Prüfung für ein Deployment.

Verfolgen Sie den Vorgang:

```bash
rebase cloud logs            # the build log
rebase cloud logs --runtime  # what the running container is printing
rebase cloud status          # what the platform thinks the project is doing
```

`status` meldet `blockedOn` und `nextAction`. Wenn `blockedOn` gleich `null` ist,
arbeitet die Plattform tatsächlich und Polling ist das Richtige; wenn dort etwas
angegeben ist, wartet dieses Etwas auf Sie.

## Rollback

```bash
rebase cloud deployments
rebase cloud rollback
```

Ein Rollback verweist das Projekt wieder auf den Stand, den ein vorheriges erfolgreiches Deployment
ausgeliefert hat, und baut niemals neu – der Wert eines Rollbacks besteht darin, dass es ein
Artefakt ausliefert, das bereits erfolgreich gelaufen ist.

Welche Deployments infrage kommen, hängt davon ab, wie das Projekt bereitgestellt wird, und beide Varianten
funktionieren:

| Art der Bereitstellung | Was wiederhergestellt wird |
|---|---|
| `rebase cloud deploy` (a source build) | Das Image, das dieser Build veröffentlicht hat |
| `rebase cloud deploy --bundle` (the platform runtime) | Das Bundle, das dieses Deployment ausgeliefert hat, auf der Runtime-Version, die das Projekt jetzt ausführt |

Statische Apps, die in das Bundle des Backends eingebettet sind (ein einfaches `rebase cloud deploy` in einem Projekt mit Backend), sind Teil dieses Bundles und werden mit ihm zurückgerollt.

Eine statische App, die allein deployt wurde (`rebase cloud deploy <app>`), lässt sich noch nicht zurückrollen. Ihr Deployment hält fest, welche App es veröffentlicht hat, aber kein Bundle, sodass die Control Plane nichts hat, woraus sie es wiederherstellen könnte. Die Lösung ist, die letzte funktionierende Version erneut zu deployen, zum Beispiel vom Commit vor dem fehlerhaften. Nach einem solchen Deployment sagt `deploy` das, statt auf `rollback` zu verweisen.

Ein Rollback erfordert also ein Deployment, das eines von beiden aufgezeichnet hat, was ein Projekt voraussetzt, das mindestens zweimal erfolgreich deployt wurde. `rebase cloud deployments` markiert diejenigen, die infrage kommen, und `--json` gibt `rollbackable` pro Zeile zusammen mit dem `image` oder `bundle` aus, das wiederhergestellt werden würde.

Zwei Arten von Deployments werden abgelehnt, und die CLI gibt an, welche: ein Deployment, das nicht erfolgreich war,
und eines aus der Zeit, bevor die Plattform dessen Artefakt aufgezeichnet hat. In beiden Fällen gibt es nichts
zu raten – ein Raten würde das ausliefern, was zuletzt gebaut oder hochgeladen wurde, während behauptet würde,
dieses wiederherzustellen – stellen Sie stattdessen die gewünschte Version bereit.

Jedes erfolgreiche Deployment endet mit dem Weg zurück (`rebase cloud rollback`), sodass er sichtbar ist, wenn ein fehlerhaftes Release bemerkt wird.

Ein Rollback fügt ein neues Deployment an, anstatt die Versionshistorie zurückzuspulen, und wartet darauf, dass die wiederhergestellte Version Anfragen bedient, bevor Erfolg gemeldet wird. Verfolgen Sie dies mit `rebase cloud logs -f`.

## CI und Agents

Ein CI-Job oder ein Agent sollte nicht Ihr Passwort enthalten. Geben Sie ihm stattdessen ein
Token: einen Schlüssel, der als Ihr Konto agiert, eingeschränkt auf wenige Aktionen für ein einzelnes
Projekt. Erstellen Sie ihn von einem angemeldeten Terminal aus:

```bash
rebase cloud tokens create --project shop --can deploy,logs --expires-in 90
```

Das Token wird einmalig ausgegeben, als eine Zeile `export REBASE_TOKEN=rk_live_…`. Wenn
`REBASE_TOKEN` gesetzt ist, authentifiziert sich jeder `rebase cloud`-Befehl damit anstelle
Ihres Logins und liest oder schreibt niemals die gespeicherte Sitzung. Speichern Sie es in GitHub Actions
als Repository-Secret und stellen Sie es unter diesem Namen bereit:

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

`--can` akzeptiert eine oder mehrere Berechtigungen (Capabilities), kommagetrennt oder wiederholt:

| Capability | Was das Token tun darf |
|---|---|
| `deploy` | Das Projekt deployen und dessen Builds verfolgen: `deploy`, `deployments` |
| `logs` | Build- und Runtime-Logs sowie Live-Metriken lesen: `logs`, `metrics` |
| `env` | Umgebungsvariablen lesen und ändern, einschließlich Secrets |
| `database` | `db list`, `db info` und `db connect`, was das Datenbankpasswort beinhaltet |
| `backups` | Backups auflisten, erstellen, prüfen und herunterladen sowie das Point-in-Time-Fenster einsehen |

Unter der Haube ist ein Token ein [persönlicher API-Schlüssel](/docs/backend/api-keys/#personal-keys)
auf der Control Plane. Jede Capability wird zu einigen
[Scopes](/docs/backend/roles-and-scopes/): `deploy` für `shop` enthält
`project:deploy:<id>` mit der ID des Projekts sowie die Daten- und Funktions-Scopes,
die die Deploy-Befehle aufrufen. Das Token verfügt zu keinem Zeitpunkt über mehr Rechte als Ihr Konto im Moment
der Verwendung, verliert also auch alles, was Ihr Konto verliert.

Zwei Dinge bleiben einer angemeldeten Person vorbehalten:

- **Verwalten von Tokens.** `rebase cloud tokens list`, `create` und `revoke <id>` erfordern
  Ihre `rebase cloud login`-Sitzung. Ein Token kann keine Tokens auflisten, erstellen oder widerrufen,
  da ein Token, das Tokens generieren könnte, seinen eigenen Nachfolger generieren könnte.
- **Wiederherstellen.** Keine Capability gewährt die Wiederherstellung eines Backups oder ein Point-in-Time-`restore`
  und -`cutover`. Das Überschreiben einer produktiven Datenbank mit alten Daten bleibt einer
  angemeldeten Person mit Owner- oder Admin-Rolle vorbehalten.

`rebase cloud whoami` bei gesetztem Token zeigt an, was dieses tun darf und für welches
Projekt. `rebase cloud tokens revoke <id> --yes` widerruft es sofort.

## Compute und Kosten

Der Preis eines Projekts richtet sich nach den reservierten Ressourcen, nicht nach Tarifen (Tiers). `compute` gibt
jeden Regler und die detaillierte Aufstellung der Control Plane dafür aus. (`rebase cloud
resources` ist etwas anderes: die im Code deklarierten Datenbanken und Buckets
und ob sie jeweils bereitgestellt sind – siehe die [CLI reference](/docs/cli/cloud/).)

```bash
rebase cloud compute
rebase cloud compute set --cpu 500m --memory 2Gi
```

| Parameter | Einheit und Bedeutung |
|---|---|
| `--cpu`, `--memory` | App-Request pro Instanz, z. B. `500m` und `2Gi`. Leer bedeutet Plattform-Standard – `100m` und `384Mi`, mit Bursting auf bis zu 2 CPU und `2Gi` |
| `--replicas` | Instanzen, die immer existieren: die Untergrenze des Autoscalers und das, was dem Projekt im Ruhezustand berechnet wird |
| `--autoscale-max` | 1–16. Die Obergrenze, die erreicht werden kann, und der Worst-Case-Abrechnungsbetrag. `--no-autoscale` schaltet dies ab |
| `--autoscale-cpu-target` | 10–95. Die CPU-Auslastung, die der Autoscaler anstrebt, bezogen auf den Request statt auf das Limit. Leer bedeutet 70 |
| `--spot` | `true` oder `false`. Preemptible Kapazität: günstiger, wird aber ohne Vorankündigung neu gestartet |
| `--db-instances` | 1–3. `1` ist eine Einzelinstanz ohne Failover; `2` fügt ein automatisches Standby hinzu |
| `--db-cpu`, `--db-memory`, `--storage` | Pro Datenbankinstanz. Leer bedeutet `500m`, `2Gi` und das Standard-Volume |

Ein leerer Parameter ist nicht dasselbe wie ein auf denselben Wert festgelegter: Ein leerer Parameter
folgt dem Plattformstandard und ändert sich mit diesem.

Von der CLI wird absichtlich nichts validiert – die Limits gehören zum Cluster, auf dem ein
Projekt läuft, und unterscheiden sich je nach Anbieter. Die Control Plane lehnt einen
Wert ab, den sie nicht bedienen kann, und benennt das Feld. Führen Sie `rebase cloud compute` aus, um
den Betrag in €/Monat vor und nach der Änderung zu sehen; eine Änderung wird sofort anteilig ab heute wirksam,
außer bei Änderungen, die die Datenbank neu starten – diese warten auf ein Wartungsfenster.

## Der restliche Funktionsumfang

| Befehlsgruppe | Was sie abdeckt |
|---|---|
| `login`, `logout`, `whoami` | Ihre Sitzung |
| `tokens` | Tokens für CI und Agents, jeweils auf ein Projekt beschränkt. Siehe [CI and agents](#ci-und-agents) |
| `link`, `unlink`, `use`, `open` | Verknüpfen dieses Verzeichnisses mit einem Projekt, Auswählen einer Organisation, Öffnen der Konsole |
| `projects` | Erstellen, auflisten, prüfen, löschen |
| `deploy`, `logs`, `deployments`, `rollback`, `cancel` | Bereitstellen und überwachen |
| `start`, `stop`, `restart` | Pausieren eines Projekts und Wiederinbetriebnahme |
| `status`, `metrics`, `debug` | Was es gerade tut und warum möglicherweise nicht |
| `cron` | Die Cron-Jobs der bereitgestellten App und deren aufgezeichnete Ausführungen, gelesen mit Ihrem `rebase cloud`-Login. Schreibgeschützt |
| `env` | Umgebungsvariablen. `list` gibt niemals Werte aus; `--secret` ist rein schreibend |
| `domains` | Eigene Domains, hinzuzufügende DNS-Einträge und Verifizierung. Ein Projekt kann unter mehreren Domains erreichbar sein, jede für sich verifiziert; `verify` und `remove` nehmen die jeweilige Domain entgegen, was nur weggelassen werden kann, wenn es genau eine gibt (bei `verify` eine noch ausstehende). `list --json` gibt `{ projectId, tenantHost, domains: [...] }` zurück |
| `db` | Datenbank anbinden oder erstellen, Verbindung von Ihrem Rechner aus aufbauen, Backups, Restore und Point-in-Time-Recovery |
| `extensions` | Die Allowlist für Postgres-Extensions |
| `storage` | Der Bucket des Projekts |
| `resources` | Welche Datenbanken und Buckets die Plattform hält, abgeglichen mit den Deklarationen im Code |
| `compute` | Was dieses Projekt reserviert, was es kostet und wie man es anpasst |
| `clusters` | Die Cluster, auf denen Tenants laufen. Nur für Plattform-Admins |
| `settings`, `orgs`, `webhooks`, `billing` | Projekteinstellungen, Organisationen, Deploy-Hooks, Zahlungsabwicklung |

Jede Gruppe in dieser Tabelle beantwortet `--help` mit einer eigenen Hilfeseite – einer Nutzungszeile,
ihren Flags und Beispielen – und `--help` führt den Befehl niemals aus. Ein Test prüft den
Index der Seiten, sodass eine neu hinzugefügte Gruppe ohne Hilfeseite den Build fehlschlagen lässt, anstatt
mit dem Inhaltsverzeichnis zu antworten. `verify:docs` gleicht die Tabelle selbst mit
diesem Index ab: Jede von der CLI bereitgestellte Gruppe erscheint hier genau einmal, sodass eine Gruppe,
die ohne Tabellenzeile hinzugefügt wird, den Build ebenfalls fehlschlagen lässt.

In einer Pipe gibt `--help` stattdessen JSON aus: dieselbe Nutzungszeile, Flags und Beispiele
als lesbare Struktur anstelle von sechzig Zeilen Terminal-Escape-Sequenzen.

## Was die Beta noch nicht enthält

Klar ausgedrückt, denn es erst später herauszufinden, ist ärgerlicher:

- **Keine freie Regionswahl.** Aktuell läuft alles in einer einzigen Region. Das Platzierungsmodell
  existiert in der Plattform, aber ein Projekt kann keine Region auswählen.
  `projects create --provider` und `--region` sind nicht die Ausnahme, nach der sie aussehen:
  Sie zeichnen auf, zu welchem der registrierten Deploy-Ziele der Control Plane ein
  Projekt gehört. Da es derzeit nur eines gibt, fallen beide auf diesen Standard zurück und keines verschiebt
  ein Projekt an einen anderen Ort. `rebase cloud projects create --help` sagt dasselbe.
- **Kein Self-Service.** Der Zugang wird in Batches gewährt; es gibt keine Registrierung mit direkter Bezahlung.
- **Kein veröffentlichtes SLA** und kein SOC 2. Wenn Sie eines davon benötigen, geben Sie dies bei der
  Zugangsanfrage an, anstatt davon auszugehen.
- **Keine Preview- oder Branch-Deployments** und keine First-Party-GitHub-App. Deploy-Hooks –
  geheime URLs, auf die Sie einen Repository-Webhook richten – sind die unterstützte Automatisierung.
- **Tokens agieren als Person.** Ein [Token](#ci-und-agents) wird von einem Konto erstellt
  und agiert als dieses; es gibt bisher keine organisationsgebundene Maschinenidentität. Wenn Sie
  sich stattdessen über CI anmelden, übergeben Sie `REBASE_CLOUD_EMAIL` und `REBASE_CLOUD_PASSWORD`
  aus einem Secret-Speicher – `--password` schreibt das Passwort in Ihre Shell-Historie und
  in die Prozesstabelle und weist vor der Anmeldung darauf hin. Wenn die `.rebase/cloud.json` des Repositories
  eine andere Control Plane als die plattformeigene benennt, übergeben Sie diese ebenfalls
  als `--url`: Ohne Terminal weigert sich `login`, ein Passwort an einen Host zu senden,
  der nur von der ausgecheckten Datei benannt wurde.
- **Point-in-Time-Recovery ist nur über die CLI verfügbar.** Die Konsole zeigt Backups an; der gestufte
  PITR-Workflow läuft über `rebase cloud db pitr`.
- **Kein öffentlicher Datenbank-Endpunkt.** Eine verwaltete Datenbank ist nicht über das
  Internet erreichbar, sodass der in der Konsole angezeigte Host die Adresse für Ihr Backend ist und
  auf Ihrem lokalen Rechner zu nichts aufgelöst werden kann. `rebase cloud db connect` öffnet einen lokalen
  Port, der diese Datenbank darstellt, getunnelt durch die Control Plane, solange
  Sie den Befehl laufen lassen – es gibt jedoch keinen permanenten Hostnamen, zu dem sich ein Drittanbieter-Dienst
  verbinden könnte. Sowohl dieser Tunnel als auch das Passwort hinter
  `rebase cloud db info --reveal` erfordern die Owner- oder Admin-Rolle der Organisation:
  dieselbe, die auch der SQL-Editor von Studio verlangt, da alle drei Zugriffe in einer
  Sitzung auf Ihren Produktionsdaten enden.

## Stattdessen selbst hosten

Nichts hier bedeutet einen Lock-in. Der [Self-Hosting-Leitfaden](/docs/deployment/self-hosting/)
führt das identische Image und Bundle mit `docker compose` aus, und die
[Kubernetes-Anleitung](/docs/deployment/kubernetes/) baut dieselbe Topologie über
das Helm-Chart auf.
