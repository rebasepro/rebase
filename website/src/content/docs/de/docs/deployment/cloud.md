---
sourceHash: a32dc82ba7002b52
title: Rebase Cloud
sidebar_label: Rebase Cloud
description: Rebase Cloud ist dasselbe Rebase, für Sie betrieben. Was es ist, wie ein Projekt verknüpft und bereitgestellt wird und was die Private Beta noch nicht enthält.
---

Rebase Cloud führt dasselbe Open-Source-Rebase aus, das Sie auch selbst hosten würden – dasselbe
veröffentlichte `rebasepro/server`-Image, dasselbe Bundle, dasselbe Postgres. Der
Unterschied besteht darin, wer es betreibt.

:::note[Private Beta]
Rebase Cloud befindet sich in der **Private Beta**. Es betreibt bereits echte Mandanten und wird schrittweise
in Batches freigeschaltet. [Zugang anfragen](https://rebase.pro/pricing).

Es ist kein Self-Service, daher erfordern die folgenden Befehle ein Konto, das freigeschaltet wurde.
Alles andere auf dieser Website funktioniert ohne ein solches Konto.
:::

## Was es ist

Ein Cloud-**Projekt** besteht aus drei Komponenten, die die Plattform für Sie betreibt:

| | Was Sie erhalten |
|---|---|
| **App** | Ihr Bundle, das auf dem veröffentlichten Runtime-Image läuft. Bereitstellungen sind Bundle-Uploads, keine Container-Builds |
| **Datenbank** | Ein verwaltetes PostgreSQL mit automatisierten Backups und Point-in-Time-Recovery |
| **Storage** | Ein eigener Bucket, falls Ihr Projekt Dateispeicher verwendet |

Jede Komponente wird bei der ersten Bereitstellung bereitgestellt und nach den
reservierten Ressourcen anstelle von Arbeitsplätzen (Per-Seat) abgerechnet.

**An Ihrem Projekt ändert sich nichts, um dort zu laufen.** Dasselbe Repository
kann mit `docker compose` selbst gehostet werden, und der Notausstieg ist real: `rebase build`
erzeugt ein Bundle, das überall dort startet, wo das Runtime-Image läuft.

## Ein Projekt verknüpfen

Aus einem Projektverzeichnis:

```bash
rebase cloud login
rebase cloud billing setup
rebase cloud projects create --name "My app" --subdomain my-app --link
```

`projects create` akzeptiert keine Positionsargumente. Der Name und die Subdomain sind
Flags, und beide sind erforderlich – in einem Terminal werden sie abgefragt, und ein
Headless-Durchlauf, der eines davon auslässt, bricht mit `input_required` ab, anstatt
eines zu erfinden. **Die Subdomain kann nachträglich nicht mehr bearbeitet werden:** Sie ist der
`<slug>.rebase.website`-Host, unter dem das Projekt erreichbar ist, wählen Sie sie also mit Bedacht.

`--link` verknüpft dieses Verzeichnis im selben Aufruf mit dem Projekt, sodass kein
separater `link`-Schritt erforderlich ist. Es schreibt `.rebase/cloud.json`, worin die Projekt-ID
und der Slug festgehalten werden. Diese Datei ist kein Geheimnis und enthält nicht Ihre Anmeldedaten – diese
befinden sich in `~/.rebase/credentials.json`, geschrieben von `login`.

Sie wird jedoch mit dem Code committet, sodass ein geklontes Repository jede beliebige
Control Plane benennen kann. Wenn der Host ausschließlich aus dieser Datei stammt und es sich weder um den
plattformeigenen Host noch um einen handelt, bei dem Sie sich zuvor angemeldet haben, nennt `login` ihn und fragt
nach, bevor Ihre E-Mail-Adresse und Ihr Passwort dorthin gesendet werden. Ohne Terminal oder mit
`--json` wird dies mit `unknown_control_plane` verweigert; übergeben Sie `--url <host>` (oder setzen Sie
`REBASE_CLOUD_URL`), um sich dort gezielt anzumelden.

`billing setup` verknüpft einmalig eine Karte mit der Organisation. Es steht bewusst an
erster Stelle der Abfolge: Das erste Deployment eines Projekts wird ohne Zahlungsart abgelehnt, und
dies erst nach Abschluss des Bundle-Uploads festzustellen, ist die schlechtere Reihenfolge.

Ein bestehendes Projekt lässt sich verknüpfen, ohne ein neues zu erstellen:

```bash
rebase cloud projects list
rebase cloud link --project my-app
```

## Bereitstellen (Deploy)

```bash
rebase cloud deploy
```

Ein einziger Befehl und kein Flag, das man sich merken muss. Die `rebase.json` eines Scaffolds deklariert
`runtime: "managed"` für ihr Backend, und `deploy` liest diese Deklaration – dies wird beim
Ausführen gemeldet (`rebase.json declares runtime: managed — deploying a
bundle`), baut die App in `dist-bundle`, lädt das Bundle hoch, führt es auf dem
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
[Managed Backend Runtime](/docs/deployment/managed-runtime/).

Um ein Artefakt auszuliefern, das zuvor gebaut wurde – etwa bei einem CI-Job, der einmal baut
und zweimal bereitstellt –, verweisen Sie auf das Verzeichnis, anstatt neu zu bauen:

```bash
rebase build
rebase cloud deploy --bundle-dir dist-bundle
```

Das Verlassen der verwalteten Runtime erfolgt über ein eigenes Flag, `--eject`, und nichts anderes
fordert dazu auf: Ein Build, der ein verwaltetes Projekt auf ein Container-Image verschieben würde, das es dann
selbst verwaltet, wird verweigert, bis Sie dies explizit angeben. Früher bedeutete `--force` dies, was die
am wenigsten umkehrbare Aktion der CLI unter dasselbe Wort wie „diese Datei überschreiben“
stellte; es ist jetzt eine unbekannte Option statt eines Alias, sodass ein Skript, das es enthält,
stattdessen stoppt.

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
rebase cloud logs            # das Build-Log
rebase cloud logs --runtime  # die Ausgabe des laufenden Containers
rebase cloud status          # was die Plattform glaubt, dass das Projekt gerade tut
```

`status` gibt `blockedOn` und `nextAction` aus. Wenn `blockedOn` den Wert `null` hat,
arbeitet die Plattform tatsächlich und Polling ist die richtige Vorgehensweise; wenn dort etwas
angegeben ist, wartet dieses Etwas auf Sie.

## Rollback

```bash
rebase cloud deployments
rebase cloud rollback
```

Ein Rollback verweist das Projekt wieder auf den Stand eines früheren erfolgreichen Deployments
und baut niemals neu – der Wert eines Rollbacks besteht darin, dass ein
Artefakt ausgeliefert wird, das bereits gelaufen ist.

Welche Deployments dafür infrage kommen, hängt davon ab, wie das Projekt bereitgestellt wurde; beide Arten
funktionieren:

| Art der Bereitstellung | Was wiederhergestellt wird |
|---|---|
| `rebase cloud deploy` (ein Source-Build) | Das Image, das dieser Build veröffentlicht hat |
| `rebase cloud deploy --bundle` (die Plattform-Runtime) | Das Bundle, das dieses Deployment ausgeliefert hat, auf der Runtime-Version, die das Projekt jetzt ausführt |

Statische Apps, die in das Bundle des Backends eingebettet sind (ein einfaches `rebase cloud deploy` in einem Projekt mit Backend), sind Teil dieses Bundles und werden mit ihm zurückgerollt.

Eine statische App, die allein deployt wurde (`rebase cloud deploy <app>`), lässt sich noch nicht zurückrollen. Ihr Deployment hält fest, welche App es veröffentlicht hat, aber kein Bundle, sodass die Control Plane nichts hat, woraus sie es wiederherstellen könnte. Die Lösung ist, die letzte funktionierende Version erneut zu deployen, zum Beispiel vom Commit vor dem fehlerhaften. Nach einem solchen Deployment sagt `deploy` das, statt auf `rollback` zu verweisen.

Ein Rollback erfordert also ein Deployment, das eines von beiden aufgezeichnet hat, was ein Projekt voraussetzt, das mindestens zweimal erfolgreich deployt wurde. `rebase cloud deployments` markiert diejenigen, die infrage kommen, und `--json` gibt `rollbackable` pro Zeile zusammen mit dem `image` oder `bundle` aus, das wiederhergestellt werden würde.

Zwei Arten von Deployments werden abgelehnt, und die CLI nennt den Grund: ein Deployment, das nicht erfolgreich war,
und eines aus der Zeit, bevor die Plattform sein Artefakt aufgezeichnet hat. In beiden Fällen gibt es nichts
zu raten – ein Raten würde das ausliefern, was zuletzt gebaut oder hochgeladen
wurde, während behauptet wird, dieses wiederherzustellen – stellen Sie stattdessen die gewünschte Version bereit.

Jedes erfolgreiche Deployment endet mit dem Weg zurück (`rebase cloud rollback`), sodass er sichtbar ist, wenn ein fehlerhaftes Release bemerkt wird.

Ein Rollback fügt ein neues Deployment an, anstatt die Versionshistorie zurückzuspulen, und wartet darauf, dass die wiederhergestellte Version Anfragen bedient, bevor Erfolg gemeldet wird. Verfolgen Sie dies mit `rebase cloud logs -f`.

## CI und Agenten

Ein CI-Job oder ein Agent sollte nicht Ihr Passwort enthalten. Vergeben Sie
stattdessen ein Token: einen Schlüssel, der als Ihr Konto agiert, eingeschränkt auf wenige Aktionen für ein
einzelnes Projekt. Erstellen Sie es über ein angemeldetes Terminal:

```bash
rebase cloud tokens create --project shop --can deploy,logs --expires-in 90
```

Das Token wird einmalig ausgegeben, als eine Zeile der Form `export REBASE_TOKEN=rk_live_…`. Wenn
`REBASE_TOKEN` gesetzt ist, authentifiziert sich jeder `rebase cloud`-Befehl damit anstelle
Ihrer Anmeldung und liest oder schreibt niemals die gespeicherte Sitzung. In GitHub Actions
speichern Sie es als Repository-Secret und stellen es unter diesem Namen bereit:

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

`--can` akzeptiert eine oder mehrere Capabilities, kommagetrennt oder wiederholt:

| Capability | Was das Token tun darf |
|---|---|
| `deploy` | Das Projekt bereitstellen und seine Builds verfolgen: `deploy`, `deployments` |
| `logs` | Build- und Runtime-Logs sowie Live-Metriken lesen: `logs`, `metrics` |
| `env` | Umgebungsvariablen lesen und ändern, einschließlich Secrets |
| `database` | `db list`, `db info` und `db connect`, was das Datenbankpasswort beinhaltet |
| `backups` | Backups auflisten, erstellen, inspizieren und herunterladen sowie das Point-in-Time-Fenster lesen |

Unter der Haube ist ein Token ein [persönlicher API-Schlüssel](/docs/backend/api-keys/#personal-keys)
auf der Control Plane. Jede Capability wird zu einigen wenigen
[Scopes](/docs/backend/roles-and-scopes/): `deploy` für `shop` besitzt
`project:deploy:<id>` mit der ID des Projekts sowie die Daten- und Funktions-Scopes,
die die Deploy-Befehle aufrufen. Das Token besitzt niemals mehr Rechte als Ihr Konto im Moment
der Nutzung, verliert also auch alles, was Ihr Konto verliert.

Zwei Dinge verbleiben bei einer angemeldeten Person:

- **Tokens verwalten.** `rebase cloud tokens list`, `create` und `revoke <id>` erfordern
  Ihre `rebase cloud login`-Sitzung. Ein Token kann keine Tokens auflisten, erstellen oder
  widerrufen, da ein Token, das Tokens erzeugen könnte, seinen eigenen Nachfolger erzeugen könnte.
- **Wiederherstellung.** Keine Capability gewährt eine Backup-Wiederherstellung oder ein Point-in-Time-`restore`
  und `-cutover`. Das Überschreiben einer Produktivdatenbank mit alten Daten bleibt einer
  angemeldeten Eigentümerin bzw. einem angemeldeten Eigentümer oder Admin vorbehalten.

`rebase cloud whoami` mit gesetztem Token zeigt an, was es tun darf und für welches
Projekt. `rebase cloud tokens revoke <id> --yes` sperrt es sofort.

## Compute und Kosten

Der Preis eines Projekts bemisst sich an den reservierten Ressourcen, nicht an einem Tarifmodell (Tier). `compute` gibt
jeden Regler und das aufgeschlüsselte Angebot der Control Plane dafür aus. (`rebase cloud
resources` ist etwas anderes: die Datenbanken und Buckets, die der Code deklariert,
und ob die einzelnen Ressourcen bereitgestellt sind – siehe die [CLI-Referenz](/docs/cli/cloud/).)

```bash
rebase cloud compute
rebase cloud compute set --cpu 500m --memory 2Gi
```

| Regler | Einheit und Bedeutung |
|---|---|
| `--cpu`, `--memory` | App-Anforderung pro Instanz, z. B. `500m` und `2Gi`. Leer bedeutet Plattform-Standard – `250m` und `512Mi` |
| `--replicas` | Instanzen, die immer existieren: das Minimum des Autoscalers und das, was dem Projekt im Ruhezustand berechnet wird |
| `--autoscale-max` | 1–16. Die Obergrenze, die erreicht werden darf, und der maximale Abrechnungsfall. `--no-autoscale` deaktiviert dies |
| `--autoscale-cpu-target` | 10–95. Die CPU-Auslastung, die der Autoscaler anstrebt, bezogen auf den Request statt auf das Limit. Leer bedeutet 70 |
| `--spot` | `true` oder `false`. Preemptible-Kapazität: günstiger und ohne Vorankündigung neu gestartet |
| `--scale-to-zero` | `true` oder `false`. Nach Anfragen abgerechnetes Compute, das im Leerlauf stoppt, auf Kosten eines Kaltstarts |
| `--db-instances` | 1–3. `1` ist eine Einzelinstanz ohne Failover; `2` fügt ein automatisches Standby hinzu |
| `--db-cpu`, `--db-memory`, `--storage` | Pro Datenbankinstanz. Leer bedeutet `500m`, `2Gi` und das Standard-Volume |

Ein leerer Regler ist nicht dasselbe wie einer, der auf dieselbe Zahl fixiert ist: Ein leerer Regler
folgt dem Plattform-Standard und ändert sich, wenn sich dieser ändert.

Die CLI validiert bewusst nichts – die Limits gehören zum Cluster, auf dem ein
Projekt läuft, und unterscheiden sich je nach Provider. Die Control Plane lehnt einen
Wert ab, den sie nicht erfüllen kann, und benennt das Feld. Führen Sie `rebase cloud compute` aus,
um die €/Monat vor und nach der Änderung zu sehen; eine Änderung wird sofort angewendet, anteilig ab heute,
außer bei einer Änderung, die die Datenbank neu startet – diese wartet auf ein Wartungsfenster.

## Die restlichen Befehle

| Befehlsgruppe | Was sie abdeckt |
|---|---|
| `login`, `logout`, `whoami` | Ihre Sitzung |
| `tokens` | Tokens für CI und Agenten, jeweils auf ein Projekt begrenzt. Siehe [CI und Agenten](#ci-und-agenten) |
| `link`, `unlink`, `use`, `open` | Verknüpfen dieses Verzeichnisses mit einem Projekt, Auswählen einer Organisation, Öffnen der Konsole |
| `projects` | Erstellen, auflisten, inspizieren, löschen |
| `deploy`, `logs`, `deployments`, `rollback`, `cancel` | Ausliefern und Überwachen |
| `start`, `stop`, `restart` | Pausieren eines Projekts und Wiederinbetriebnahme |
| `status`, `metrics`, `debug` | Was es tut und warum es das eventuell nicht tut |
| `cron` | Die Cron-Jobs der bereitgestellten App und deren aufgezeichnete Ausführungen, gelesen mit Ihrem `rebase cloud`-Login. Schreibgeschützt |
| `env` | Umgebungsvariablen. `list` gibt niemals Werte aus; `--secret` ist Write-Only |
| `domains` | Eigene Domains, hinzuzufügende DNS-Einträge und Verifizierung. Ein Projekt kann über mehrere erreichbar sein, die jeweils separat verifiziert werden; `verify` und `remove` nehmen die Domain entgegen, auf die eingewirkt werden soll, was nur weggelassen werden darf, wenn es nur eine gibt (bei `verify` eine noch ausstehende). `list --json` gibt `{ projectId, tenantHost, domains: [...] }` zurück |
| `db` | Datenbank anbinden oder erstellen, Verbindung vom lokalen Rechner aus herstellen, Backups, Wiederherstellung und Point-in-Time-Recovery |
| `extensions` | Die Postgres-Erweiterungs-Allowlist |
| `storage` | Der Bucket des Projekts |
| `resources` | Welche Datenbanken und Buckets die Plattform vorhält, verglichen mit dem, was der Code deklariert |
| `compute` | Was dieses Projekt reserviert, was es kostet und wie es geändert wird |
| `clusters` | Die Cluster, auf denen die Mandanten laufen. Nur für Plattform-Admins |
| `settings`, `orgs`, `webhooks`, `billing` | Projekteinstellungen, Organisationen, Deploy-Hooks, Abrechnung |

Jede Gruppe in dieser Tabelle beantwortet `--help` mit einer eigenen Hilfeseite – einer Nutzungszeile,
ihren Flags und Beispielen – und `--help` führt den Befehl niemals aus. Ein Test überwacht den
Index dieser Seiten, sodass eine Gruppe, die ohne eine solche hinzugefügt wird, den Build fehlschlagen lässt,
anstatt mit dem Inhaltsverzeichnis zu antworten. `verify:docs` gleicht die Tabelle selbst mit
diesem Index ab: Jede Gruppe, die die CLI bereitstellt, erscheint hier genau einmal, sodass eine Gruppe,
die ohne Tabellenzeile hinzugefügt wird, den Build ebenfalls fehlschlagen lässt.

Wird der Befehl weitergeleitet (Piping), antwortet `--help` stattdessen in JSON: dieselbe Nutzungszeile, dieselben Flags und Beispiele
als strukturierte Daten zum Lesen statt sechzig Zeilen Terminal-Escape-Sequenzen.

## Was die Beta nicht enthält

Klar ausgesprochen, da es schlechter ist, dies erst später zu erfahren:

- **Keine Regionsauswahl.** Alles läuft derzeit in einer einzigen Region. Das Placement-Modell
  existiert in der Plattform, aber ein Projekt kann keine Region auswählen.
  `projects create --provider` und `--region` sind nicht die Ausnahme, nach der sie aussehen:
  Sie zeichnen auf, zu welchem der registrierten Deploy-Targets der Control Plane ein
  Projekt gehört, und davon gibt es eines. Beide verwenden daher standardmäßig dieses und keines von beiden
  verschiebt ein Projekt woanders hin. `rebase cloud projects create --help` sagt dasselbe.
- **Kein Self-Service.** Der Zugang wird in Batches gewährt; es gibt keine Registrierung mit direkter Bezahlung.
- **Kein veröffentlichtes SLA** und kein SOC 2. Wenn Sie eines davon benötigen, geben Sie dies
  bei der Zugriffsanfrage an, anstatt es vorauszusetzen.
- **Keine Preview- oder Branch-Deployments** und keine native GitHub-App. Deploy-Hooks –
  geheime URLs, auf die Sie einen Repository-Webhook richten – sind die unterstützte Automatisierung.
- **Tokens agieren als Person.** Ein [Token](#ci-und-agenten) wird von einem Konto erzeugt
  und agiert als dieses; es gibt noch keine organisationsbezogene Maschinenidentität. Wenn Sie
  sich stattdessen über CI anmelden, übergeben Sie `REBASE_CLOUD_EMAIL` und `REBASE_CLOUD_PASSWORD`
  aus einem Secret-Store – `--password` legt das Passwort in Ihrer Shell-Historie und
  in der Prozesstabelle ab und weist darauf hin, bevor es Sie anmeldet. Wenn die Datei `.rebase/cloud.json`
  des Repositorys eine andere Control Plane als die plattformeigene benennt, übergeben Sie
  diese ebenfalls als `--url`: Ohne Terminal weigert sich `login`, ein Passwort an einen Host
  zu senden, der nur von der ausgecheckten Datei benannt wurde.
- **Point-in-Time-Recovery ist CLI-only.** Die Konsole zeigt Backups; der mehrstufige
  PITR-Workflow lautet `rebase cloud db pitr`.
- **Kein öffentlicher Datenbank-Endpunkt.** Eine verwaltete Datenbank ist nicht für das
  Internet freigegeben, daher ist der in der Konsole angezeigte Host die Backend-Adresse dafür und
  löst auf Ihrem lokalen Rechner zu nichts auf. `rebase cloud db connect` öffnet einen lokalen
  Port zu dieser Datenbank, getunnelt über die Control Plane, solange
  Sie den Befehl laufen lassen – es gibt jedoch keinen permanenten Hostnamen, mit dem sich ein
  Dienst eines Drittanbieters verbinden könnte. Dieser Tunnel und das Passwort hinter
  `rebase cloud db info --reveal` erfordern beide die Rolle des Eigentümers oder Admins der Organisation:
  dieselbe, die auch der SQL-Editor von Studio anfordert, da alle drei Wege bei einer
  Sitzung auf Ihren Produktionsdaten enden.

## Stattdessen selbst hosten

Nichts hier ist ein Lock-in. Der [Leitfaden zum Self-Hosting](/docs/deployment/self-hosting/)
führt das identische Image und Bundle mit `docker compose` aus, und der
[Kubernetes-Leitfaden](/docs/deployment/kubernetes/) bildet dieselbe Topologie über
das Helm-Chart ab.
