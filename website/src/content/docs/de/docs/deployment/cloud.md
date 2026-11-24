---
sourceHash: 8292c377d5271c6f
title: Rebase Cloud
sidebar_label: Rebase Cloud
description: Rebase Cloud ist dasselbe Rebase, für Sie betrieben. Was es ist, wie ein Projekt verknüpft und bereitgestellt wird und was die Private Beta noch nicht enthält.
---

Rebase Cloud führt dasselbe Open-Source-Rebase aus, das Sie auch selbst hosten würden – dasselbe
veröffentlichte `rebasepro/server`-Image, dasselbe Bundle, dasselbe Postgres. Der
Unterschied liegt darin, wer es betreibt.

:::note[Private Beta]
Rebase Cloud befindet sich in der **Private Beta**. Es betreibt bereits heute echte Mandanten und wird in
Wellen freigeschaltet. [Zugang anfragen](https://rebase.pro/pricing).

Es ist kein Self-Service, daher erfordern die unten aufgeführten Befehle ein Konto, das freigeschaltet wurde.
Alles andere auf dieser Website funktioniert auch ohne ein solches Konto.
:::

## Was es ist

Ein Cloud-**Projekt** besteht aus drei Komponenten, die die Plattform für Sie betreibt:

| | Was Sie erhalten |
|---|---|
| **App** | Ihr Bundle, das auf dem veröffentlichten Runtime-Image läuft. Bereitstellungen (Deploys) sind ein Bundle-Upload, kein Container-Build |
| **Datenbank** | Ein verwaltetes PostgreSQL mit automatisierten Backups und Point-in-Time-Recovery |
| **Speicher** | Ein eigener Bucket auf [Rebase Storage](/docs/deployment/rebase-storage/), falls Ihr Projekt Dateispeicher verwendet |

Die App und die Datenbank werden bereitgestellt, sobald Sie das erste Mal deployen; ein Bucket erst,
wenn Sie ihn anfordern ([Dateispeicher](#dateispeicher)). Jede Komponente wird nach den reservierten Ressourcen
und nicht pro Arbeitsplatz (Seat) abgerechnet.

**An Ihrem Projekt ändert sich nichts, um dort ausgeführt zu werden.** Dasselbe Repository
kann mit `docker compose` selbst gehostet werden, und der Ausweg ist real: `rebase build`
erzeugt ein Bundle, das überall dort startet, wo das Runtime-Image läuft.

## Ein Projekt verknüpfen

Aus einem Projektverzeichnis:

```bash
rebase cloud login
rebase cloud billing setup
rebase cloud projects create --name "My app" --subdomain my-app --link
```

`login` öffnet die Konsole in Ihrem Browser und gibt einen kurzen Code aus. Überprüfen Sie,
ob die Konsole denselben Code anzeigt, und bestätigen Sie die Anmeldung dort: Das Terminal
übernimmt die Sitzung und speichert sie in `~/.rebase/credentials.json`. Wenn Sie nicht
in der Konsole angemeldet sind, melden Sie sich dort zuerst mit der von Ihnen genutzten Methode an,
einschließlich Google und GitHub. Über SSH gibt `rebase cloud login --no-browser` den Link aus,
den Sie auf Ihrem eigenen Rechner öffnen können.

`projects create` akzeptiert keine positionalen Argumente. Der Name und die Subdomain sind
Flags, und beide sind erforderlich – im Terminal werden sie abgefragt, und ein
Headless-Lauf, bei dem eines davon fehlt, bricht mit `input_required` ab, anstatt
einen Wert zu erfinden. **Die Subdomain kann nachträglich nicht mehr bearbeitet werden:** Sie ist der
`<slug>.rebase.website`-Host, unter dem das Projekt antwortet; wählen Sie sie daher mit Bedacht.

`--link` bindet dieses Verzeichnis im selben Aufruf an das Projekt, sodass kein
separater `link`-Schritt erforderlich ist. Es erstellt `.rebase/cloud.json`, worin die Projekt-ID
und der Slug gespeichert werden. Diese Datei ist kein Geheimnis und enthält nicht Ihre Anmeldedaten – diese
liegen in `~/.rebase/credentials.json`, erstellt durch `login`.

Sie wird jedoch mit dem Code committet, sodass ein geklontes Repository jede beliebige
Control-Plane angeben kann. Wenn der Host ausschließlich aus dieser Datei stammt und es sich weder
um den plattformunabhängigen Standard noch um einen handelt, bei dem Sie sich zuvor angemeldet haben, nennt
`login` diesen und fragt nach, bevor Ihre E-Mail-Adresse und Ihr Passwort dorthin gesendet werden. Ohne Terminal oder mit
`--json` bricht der Befehl mit `unknown_control_plane` ab; übergeben Sie `--url <host>` (oder setzen Sie
`REBASE_CLOUD_URL`), um sich gezielt dort anzumelden.

Um sich ohne Browser anzumelden, übergeben Sie Ihre E-Mail-Adresse: `rebase cloud login --email me@example.com`
fragt nach Ihrem Passwort. **Haben Sie sich mit Google, GitHub oder LinkedIn registriert?**
Ihr Konto besitzt kein Passwort, verwenden Sie stattdessen einen Code:

```bash
rebase cloud login --code --email me@example.com
```

Die Control-Plane sendet Ihnen per E-Mail einen 6-stelligen Code, der zehn Minuten lang gültig ist, und Sie geben
ihn an der Eingabeaufforderung ein. Bei `--email` ohne Passwort fragt `rebase cloud login`,
ob Ihr Passwort oder ein Code verwendet werden soll. Codes setzen voraus, dass die Control-Plane in der Lage ist,
E-Mails zu versenden; falls nicht, meldet `--code` dies und bricht mit `otp_unavailable` ab.

Wenn Sie die Zwei-Faktor-Authentifizierung aktiviert haben, fragt `login` anschließend nach dem Code aus
Ihrer Authentifikator-App oder einem Ihrer Wiederherstellungscodes, unabhängig von der gewählten
Anmeldemethode. Über den Browser fragt die Konsole diesen ab, wenn Sie sich dort anmelden. Weder ein Anmeldecode noch ein zweiter Faktor können ohne ein Terminal eingegeben werden.
Erstellen Sie für ein Skript ein Zugriffstoken in der Konsole (**Settings → Access tokens**)
und setzen Sie `REBASE_TOKEN`; siehe [CI und Agenten](/docs/deployment/cloud-agents/#ci-and-agents).

Ein falsches Passwort antwortet mit `invalid_credentials` und denselben beiden Optionen, da
die häufigste Ursache ein Konto ist, das nie ein Passwort besaß.

`billing setup` verknüpft eine Zahlungskarte einmalig mit der Organisation. Es steht ganz bewusst
am Anfang der Befehlsabfolge: Der erste Deploy eines Projekts wird ohne Zahlungskarte verweigert, und
dies erst nach dem vollständigen Upload eines Bundles zu erfahren, wäre die ungünstigere Reihenfolge.

Danach listet die Seite **Billing** in der Konsole die Rechnungen der Organisation auf,
jeweils mit der von Stripe gehosteten Seite und dem zugehörigen PDF, und zeigt eine Vorschau auf die nächste Rechnung jedes
Projekts. `rebase cloud billing invoices` und `rebase cloud billing upcoming`
geben dasselbe aus. Beide sind für Eigentümer und Administratoren der Organisation bestimmt. Sofern die
Plattform dies anbietet, öffnet **Manage billing** das Stripe-Kundenportal zur Verwaltung der
Karte, der Rechnungsdaten und vergangener Rechnungen.

Ist bereits eine Karte hinterlegt, erfordert das Erstellen eines weiteren Projekts in der Konsole
keine zweite Zahlung: Das Projekt wird über diese Karte abgerechnet und bereitgestellt. Wird die Karte
abgelehnt oder verlangt die Bank eine Bestätigung der Zahlung, führt Sie die Konsole zu
**Billing**, wo **Fix your card** eine andere Karte speichert und **Complete the payment**
die Stripe-Rechnung öffnet.

Wie viel ein Projekt verbraucht hat, ist in seiner Übersicht unter **Usage this month** zu sehen,
und für alle Projekte auf einmal auf der Seite **Billing**: Anfragen im Vergleich zum
enthaltenen Freikontingent (der Balken färbt sich bei 80 % gelb), 5xx-Fehler, der bisherige
Mehrverbrauch und wie sich der Monat bei diesem Tempo entwickeln wird. Der Mehrverbrauch wird durch
denselben Code berechnet, der ihn an Stripe meldet; er entspricht also genau dem, was auf der Rechnung stehen wird,
und erscheint auf der Rechnung des Folgemonats. `rebase cloud usage` gibt dasselbe aus,
und `rebase cloud usage org` für die gesamte Organisation. Jedes Mitglied kann dies einsehen. Die Angaben weisen darauf hin, was noch nicht sichtbar ist: Objektspeicher wird erfasst,
aber noch nicht abgerechnet ([Rebase Storage](/docs/deployment/rebase-storage/) nennt die
Preise); solange ein Projekt zwei oder mehr App-Pods betreibt,
werden dessen Anfragen nicht gezählt; und ein Tag mit fehlenden Messwerten zählt zu wenig. Ein
automatisch skaliertes Projekt zeigt auch die Pods, die es oberhalb von `--replicas` betrieben hat, in Pod-Stunden an,
was diese zu den jeweiligen Tarifen kosten und ob diese Plattform sie bereits in Rechnung stellt. Ein
von einem Agenten übernommenes Projekt zählt erst ab dem Tag der Übernahme: Davor
gehörte das Projekt der Plattform.

Ein bestehendes Projekt lässt sich verknüpfen, ohne ein neues zu erstellen:

```bash
rebase cloud projects list
rebase cloud link --project my-app
```

## Bereitstellen (Deploy)

```bash
rebase cloud deploy
```

Ein einziger Befehl und kein Flag, das man sich merken müsste. Das `rebase.json` eines Scaffolds deklariert
`runtime: "managed"` für sein Backend, und `deploy` liest diese Deklaration – es
weist währenddessen darauf hin (`rebase.json declares runtime: managed — deploying a bundle`),
baut die App in `dist-bundle`, lädt das Bundle hoch, führt es auf dem
veröffentlichten Runtime-Image aus und verfolgt das Deployment bis zu einem finalen Zustand. Der Exit-Code
ist das Ergebnis, sodass derselbe Befehl unbeaufsichtigt in CI funktioniert.

Am Ende wird ausgegeben, wo jede App nun erreichbar ist und ob die neue Version
dort live ist:

```text
  ✓ Deployed songbuzz in 1m 12s  (deployment fb3c7442-9937-4179-8d3c-88a106da149d)

    game     static   https://songbuzz.rebase.website      live
    backend  backend  https://songbuzz.rebase.website/api  live

  ✓ Live: the new version answers on every address above.
  Something wrong? `rebase cloud rollback` puts the previous deployment back.
```

„Live“ bedeutet, dass die Adresse nach dem Build geantwortet hat: Das `/health` eines Backends
hat `ok` zurückgegeben, und die Seite einer statischen App wurde geladen (aus diesem Deployment, wenn die
Plattform sie ausliefert). Die Prüfung wartet bis zu `--live-timeout` Sekunden, standardmäßig 60;
`0` überspringt sie. Wenn eine App nicht rechtzeitig antwortet, wird der Deploy dennoch mit dem Exit-Code
Null beendet, da die Bereitstellung erfolgreich war, und die letzte Zeile gibt an, welche App nicht
geantwortet hat und warum. Ein fehlgeschlagener Deploy endet stattdessen in einer einzigen Zeile, die die App und den
Grund nennt, zusammen mit `rebase cloud logs` für das vollständige Build-Protokoll.

Skripte übergeben `--json`, um ein einzelnes Objekt mit denselben Fakten zu erhalten – `apps`, `hosts`,
`live`, `liveChecks`, `durationMs` und die Deployment-ID. Anders als der Rest von
`rebase cloud` schaltet `deploy` bei einer Pipe nicht automatisch auf JSON um.

Was diese Laufzeitumgebung erlaubt – Pakete und native Module, Arbeitsspeicher und Instanzen,
Timeouts und Body-Größen, das Dateisystem, Secrets, Speicher und ausgehende
Netzwerkverbindungen – ist auf einer eigenen Seite beschrieben:
[Verwaltete Backend-Runtime](/docs/deployment/managed-runtime/).

Um ein Artefakt bereitzustellen, das zuvor erstellt wurde – beispielsweise in einem CI-Job, der einmal baut
und zweimal deployt –, verweisen Sie direkt auf das Verzeichnis, anstatt neu zu bauen:

```bash
rebase build
rebase cloud deploy --bundle-dir dist-bundle
```

Das Verlassen der verwalteten Runtime erfordert ein eigenes Flag, `--eject`, und nichts anderes
fordert dazu auf: Ein Build, der ein verwaltetes Projekt auf ein Container-Image verschieben würde, das dieses dann
selbst verwaltet, wird abgelehnt, bis Sie dies explizit bestätigen. Früher stand `--force` dafür, was die
am schwersten umkehrbare Aktion der CLI unter dasselbe Wort wie „diese Datei überschreiben“
stellte; es ist jetzt eine unbekannte Option statt eines Alias, sodass ein Skript, das sie verwendet,
stoppt.

### Die Syntaxprüfung vor dem Upload

Die Dateien einer statischen App werden exakt so ausgeliefert, wie sie vorliegen. Wenn deren `build` lediglich
handgeschriebene Skripte nach `output` kopiert, wurden sie von nichts geparst, und eine Datei
mit einem Tippfehler geht live und verhindert das Laden der Seite. Bevor also irgendetwas
hochgeladen wird, parst `deploy` jede `.js`-, `.mjs`- und `.cjs`-Datei im `output` jeder statischen
App sowie jedes Inline-`<script>` in deren `.html`-Dateien. Das
deckt sowohl eigenständig bereitgestellte statische Apps als auch statische Apps ab, die in das
Bundle des Backends integriert sind. Ein Syntaxfehler stoppt den Deploy unter Angabe von Datei, Zeile und Spalte:

```
✗ A syntax error in the static output, so nothing was deployed:
    web/cloud.js:42:23  Unexpected token
        42 |     return fetch("/api";
Fix it and deploy again, or pass --no-verify to deploy anyway.
```

Mit `--json` lautet der `code` des Fehlers `syntax_error`. Inline-Skripte, die ein Browser
nicht als JavaScript ausführt, werden übersprungen: JSON, Import Maps, Templates und jeder
andere Nicht-JavaScript-`type`, ein `<script src>` sowie ein Skript, das noch
ungerendertes Template-Markup wie `{{ }}` enthält. Eine `.js`-Datei besteht die Prüfung, wenn sie sich entweder
als klassisches Skript oder als Modul parsen lässt, da die Seite entscheidet, worum es sich handelt. Nichts
unterhalb von `node_modules` wird gelesen, und ebenso kein vorgefertigtes `--bundle-dir`.
`--no-verify` überspringt die Prüfung für einen einzelnen Deploy.

Beobachten Sie den Vorgang:

```bash
rebase cloud logs               # das Build-Protokoll
rebase cloud logs --runtime -f  # was die laufende App live ausgibt, bis Strg-C
rebase cloud status             # was die Plattform über den Zustand des Projekts meldet
```

`status` meldet `blockedOn` und `nextAction`. Wenn `blockedOn` gleich `null` ist,
arbeitet die Plattform regulär und Polling ist die richtige Vorgehensweise; wenn dort etwas
angegeben ist, wartet dieser Punkt auf eine Aktion von Ihnen.

Einer dieser Fälle ist `email_not_configured`: Die App hat die Anmeldung per Magic Link oder E-Mail-Code
aktiviert (`AUTH_MAGIC_LINK`, `AUTH_EMAIL_OTP`), verfügt jedoch über keinen E-Mail-Dienst, sodass
das Deployment zwar live ist, sich aber niemand darüber anmelden kann. Rebase Cloud versendet keine
E-Mails für Ihre App: Setzen Sie `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` und
`SMTP_FROM` mit `rebase cloud env set` und deployen Sie anschließend. `status` liest dies aus dem
app-eigenen `GET /api/auth/config` (dessen `unavailable`-Feld), und `deploy` gibt denselben
Hinweis im Rahmen des Live-Checks aus.

## Mehr als eine Datenbank

Deklarieren Sie jede in Ihrem Code (`database("analytics")`) und deployen Sie: Sie wird auf dem
Postgres-Server des Projekts als `DATABASE_URL__ANALYTICS` erstellt und teilt sich dessen CPU, Arbeitsspeicher,
Festplatte, Backups und Rechnung ([Details](/docs/backend/multiple-sources/#on-rebase-cloud)).

## Dateispeicher

Ein neues Projekt hat keinen Bucket: Uploads werden mit `501 STORAGE_NOT_CONFIGURED` abgewiesen,
und die Deploy-Zusammenfassung weist darauf hin, anstatt Daten auf eine Festplatte zu schreiben, die bei jedem Deploy ersetzt wird.

Richten Sie eine von zwei Arten ein und deployen Sie erneut, damit die App dies übernimmt:

```bash
# Ein Bucket, den Rebase für Sie betreibt. Die Storage-Seite der Konsole tut dasselbe.
rebase cloud storage create

# Oder Ihr eigener S3-kompatibler Bucket: AWS S3, Cloudflare R2, Backblaze B2, MinIO…
rebase cloud storage attach --bucket <name> \
  --access-key-id <id> --secret-access-key <secret> \
  --endpoint <url>        # für AWS weglassen; für MinIO --force-path-style hinzufügen

rebase cloud deploy
```

`rebase cloud storage` listet die Buckets des Projekts auf; jedes deklarierte `bucket("media")` erhält einen eigenen ([Mehrere Datenbanken und Buckets](/docs/backend/multiple-sources/#on-rebase-cloud)).
Mit eigenen Buckets binden Sie jeden einzelnen mit `--source <key>` an; ein Projekt, das den Speicher im Code konfiguriert, benötigt keines von beiden.

## Eine Änderung in der Vorschau ansehen (Preview)

```bash
rebase cloud deploy --preview
```

Dies baut und lädt genau das hoch, was auch `deploy` verarbeiten würde, stellt es jedoch unter einer
eigenen Adresse bereit, wie etwa `https://shop--k3x9ab.rebase.website`. Die Produktion liefert
weiterhin das aus, was sie zuvor ausgeliefert hat. Der Deploy gibt die Adresse der Vorschau aus, sobald der
Build abgeschlossen ist.

Um dieselbe Adresse über mehrere Deploys hinweg beizubehalten, geben Sie der Vorschau einen Namen. Ein erneuter
Deploy unter demselben Namen aktualisiert sie:

```bash
rebase cloud deploy --preview-name new-checkout
```

Womit eine Vorschau kommuniziert, hängt davon ab, was Sie bereitgestellt haben:

- **`rebase cloud deploy --preview`** zeigt eine Vorschau des Backends inklusive der darin integrierten
  statischen Apps an, genau wie die Produktion sie ausführt. Es erhält ein eigenes Backend auf einer
  **eigenen, leeren Datenbank**, niemals der Produktionsdatenbank. Ein Start gegen
  die Produktionsdatenbank würde das Schema und die Zugriffsregeln der Vorschau auf diese anwenden.
- **`rebase cloud deploy web --preview`** würde eine einzelne statische App isoliert in der
  Vorschau anzeigen, deren Seiten das **Produktions-Backend** aufrufen. Das erfordert eine Control-Plane,
  die statische Websites eigenständig ausliefert, was Rebase Cloud derzeit noch nicht unterstützt: Es
  bricht mit `PREVIEW_STATIC_UNSERVED` ab und veröffentlicht nichts. Erstellen Sie stattdessen eine Vorschau
  des Backends, das die integrierten statischen Apps bereitstellt; ein Projekt ohne
  verwaltetes Backend kann derzeit noch nicht in die Vorschau gestellt werden.

Eine Vorschau lädt keinen Quellcode hoch und registriert keine Apps oder Hostnamen, da jeder
dieser Schritte das Produktionsprojekt verändern würde. `--source` und `--eject` können nicht
mit `--preview` kombiniert werden. Beide erstellen ein Container-Image für die Produktion.

```bash
rebase cloud previews                      # Name, Adresse, App, Backend, Ablaufdatum
rebase cloud logs --preview new-checkout   # zugehöriges Build-Log; -f verfolgt einen noch laufenden Build
rebase cloud logs --runtime --preview new-checkout -f  # was das Backend der Vorschau ausgibt
rebase cloud previews delete new-checkout  # stoppt die Bereitstellung und löscht die zugehörige Datenbank
```

`rebase cloud logs` ohne `--preview` bezieht sich immer auf die Produktion.

Die Seite **Deployments** der Konsole listet dieselben Vorschauen auf und ermöglicht das Öffnen,
Anzeigen des Build-Protokolls oder Löschen der jeweiligen Vorschau. Das Erstellen bleibt ein CLI-Schritt.

Eine Vorschau läuft eine Woche nach dem letzten Deploy ab.

Nach Abschluss prüft der Deploy, ob die Adresse der Vorschau antwortet, genau wie bei einem
Produktions-Deploy (`--live-timeout <seconds>`, `0` zum Überspringen). Das Zertifikat einer neuen
Vorschau kann ein bis zwei Minuten dauern; ein erfolgreicher Deploy kann daher melden,
dass die Adresse noch nicht antwortet.

Eine Backend-Vorschau wird wie eine App-Einheit in der Standardgröße abgerechnet (100m CPU
und 384 MiB Arbeitsspeicher, zum Tarif Ihrer App für deren Region und Kapazität),
anteilig für die Dauer ihres Bestehens, und sie erscheint im monatlichen
Kostenvoranschlag des Projekts in der Konsole. `rebase cloud deploy --preview` gibt denselben
Kostenvoranschlag pro Monat dafür aus (`cost` unter `--json`). Das Starten einer Vorschau erfordert eine hinterlegte Karte,
genau wie ein Produktions-Deploy. Ein erster Deploy,
der fehlschlägt, bevor irgendetwas ausgeführt wird, wird entfernt statt abgerechnet. Ein Projekt darf
bis zu drei Backend-Vorschauen gleichzeitig ausführen.

Jede neue Vorschauadresse erhält ein eigenes TLS-Zertifikat von Let's Encrypt,
wobei pro Domain 50 neue Zertifikate pro Woche zulässig sind, geteilt mit jeder Produktionsseite
darauf. Vorschauen dürfen plattformweit maximal 20 davon innerhalb von 7 Tagen beanspruchen. Darüber
hinaus wird eine neue Vorschau abgewiesen (`429`, `preview_cert_budget`), unter Angabe des Zeitpunkts, zu dem sie
wieder bereitgestellt werden kann; das erneute Deployen einer bereits existierenden Vorschau zählt nie dazu.

Die Datenbank einer Backend-Vorschau ist eine zweite Datenbank auf dem Postgres der **Produktion**:
eigene Daten, aber dieselbe Instanz und dieselbe Festplatte. Sie ist auf 10
Verbindungen limitiert, damit Vorschauen nicht die Ressourcen der Produktion aufbrauchen, und auf 2 GB begrenzt: Eine
Vorschau, deren Datenbank darüber hinaus anwächst, wird pausiert. Ihr Backend stoppt, ihre Adresse hört auf zu
antworten, `rebase cloud previews` und die Konsole zeigen sie als `paused` mit dem
entsprechenden Grund an, und die Eigentümer sowie Administratoren des Projekts werden benachrichtigt (`preview.paused`). Ihre
Daten bleiben bis zum Ablaufdatum erhalten. Deployen Sie sie erneut, um sie zu starten (sie wird erneut pausiert,
solange die Datenbank noch zu groß ist), oder löschen Sie sie. Eine pausierte Vorschau wird weiterhin
abgerechnet, bis sie gelöscht wird oder abläuft. Löschen Sie Vorschauen, die Sie nicht mehr benötigen. Extensions, die in der Produktion installiert sind, werden nicht
in der Datenbank einer Vorschau installiert.

Previews werden schrittweise eingeführt. Eine Control-Plane, die diese noch nicht unterstützt, weist
`--preview` mit `previews_unavailable` ab und stellt nichts bereit.

## Rollback

```bash
rebase cloud deployments
rebase cloud rollback
```

Ein Rollback verweist das Projekt wieder auf den Stand, den ein früheres erfolgreiches Deployment
ausgeliefert hat, und führt niemals einen Rebuild durch – der Wert eines Rollbacks besteht darin, dass ein
Artefakt ausgeliefert wird, das bereits erfolgreich gelaufen ist.

Welche Deployments dafür infrage kommen, hängt davon ab, wie das Projekt deployt wird; beide Varianten
werden unterstützt:

| Art des Deploys | Was wiederhergestellt wird |
|---|---|
| `rebase cloud deploy` (ein Source-Build) | Das Image, das durch diesen Build veröffentlicht wurde |
| `rebase cloud deploy --bundle` (die Plattform-Runtime) | Das Bundle, das durch diesen Deploy ausgeliefert wurde, auf der Runtime-Version, die das Projekt aktuell verwendet |

Statische Apps, die in das Bundle des Backends integriert sind (ein einfaches `rebase cloud deploy` bei einem
Projekt mit Backend), sind Teil dieses Bundles und werden daher gemeinsam mit ihm zurückgerollt.

Eine isoliert bereitgestellte statische App (`rebase cloud deploy <app>`) kann derzeit noch nicht
zurückgerollt werden. Ihr Deployment speichert zwar, welche App veröffentlicht wurde, aber kein Bundle, sodass die
Control-Plane keine Grundlage hat, um sie wiederherzustellen. Die Lösung besteht darin, die letzte funktionierende
Version erneut bereitzustellen, beispielsweise aus dem Commit vor dem fehlerhaften Release. Nach einem solchen
Deploy gibt `deploy` diesen Hinweis aus, anstatt auf `rollback` zu verweisen, und ein `rollback`
ohne ID bricht ab, anstatt das derzeit aktive Backend erneut bereitzustellen.

Ein Rollback erfordert daher ein Deployment, bei dem eine dieser beiden Optionen erfasst wurde, was ein
Projekt voraussetzt, das mindestens zweimal erfolgreich bereitgestellt wurde. `rebase cloud deployments`
markiert diejenigen, die dafür infrage kommen, und `--json` gibt pro Zeile `rollbackable` zusammen
mit dem `image` oder `bundle` an, das wiederhergestellt werden würde.

Zwei Arten von Deployments werden abgewiesen, worauf die CLI explizit hinweist: ein nicht erfolgreiches
Deployment und eines aus der Zeit, bevor die Plattform die entsprechenden Artefakte erfasst hat. Es gibt in
beiden Fällen nichts zu mutmaßen – ein Raten würde dazu führen, dass der zuletzt erstellte oder hochgeladene
Stand ausgeliefert wird, während vorgegeben wird, diesen spezifischen Stand wiederherzustellen. Deployen Sie stattdessen die gewünschte Version direkt.

Jeder erfolgreiche Deploy endet mit dem Hinweis auf den Weg zurück (`rebase cloud rollback`),
sodass dieser in dem Moment parat ist, in dem ein fehlerhaftes Release bemerkt wird.

Ein Rollback hängt ein neues Deployment an, anstatt den Versionsverlauf zurückzuspulen, und wartet,
bis die wiederhergestellte Version Anfragen bedient, bevor der Erfolg gemeldet wird. Verfolgen Sie dies mit
`rebase cloud logs -f`.

## Die Datenbank auf einen bestimmten Zeitpunkt wiederherstellen

Eine verwaltete Datenbank kann auf jede beliebige Minute innerhalb ihres Wiederherstellungsfensters
zurückgesetzt werden – über **Database → Backups** in der Konsole oder über die CLI:
`rebase cloud db pitr status | restore --target <ISO> | cutover | discard`.
Dies geschieht in zwei Schritten. Zunächst wird eine wiederhergestellte Kopie neben der aktiven Datenbank bereitgestellt;
Ihre App läuft weiterhin auf der aktiven Datenbank, und der Speicherplatz der Kopie wird abgerechnet, bis
Sie den Cutover durchführen oder sie verwerfen.
Sobald die Kopie bereit ist, leitet der Cutover die App darauf um und startet sie neu.
Alles, was nach dem Zielzeitpunkt geschrieben wurde, ist in der Kopie nicht enthalten. Die ursprüngliche
Datenbank wird als Rückfallebene beibehalten und weiterhin für den Speicherplatz abgerechnet; das Zurückwechseln,
Entfernen oder ein zweiter Restore erfolgt über den Support. Nur ein Eigentümer oder Administrator
kann die Bereitstellung anstoßen, den Cutover ausführen oder die Kopie verwerfen, und die Konsole fragt vor dem Cutover
nach dem Projektnamen.

## Ihr Konto absichern

Ihr Konsolenkonto hat Zugriff auf Produktionsdatenbanken, Secrets und Abrechnungsdaten;
schützen Sie es daher entsprechend sorgfältig. Öffnen Sie **Account security** über das Menü unter Ihrem Avatar
in der Konsole (oder navigieren Sie zu `/account`). Diese Seite gehört Ihnen persönlich, nicht einer
Organisation: Die dort vorgenommenen Einstellungen gelten für jede Organisation, der Sie angehören.

- **Zweistufige Überprüfung.** Aktivieren Sie sie mit einer beliebigen Authentifikator-App (1Password,
  Google Authenticator, Authy). Die Seite zeigt einen Einrichtungsschlüssel zum manuellen Hinzufügen zur App oder einen
  Link, der die App auf einem Smartphone mit vorausgefülltem Schlüssel öffnet, und fragt anschließend nach dem
  6-stelligen Code aus der App. Von da an erfordert jede Anmeldung einen Code,
  unabhängig davon, ob Sie sich mit einem Passwort, über Google oder GitHub anmelden.
- **Wiederherstellungscodes.** Bei der Aktivierung erhalten Sie zehn Einmalcodes, die nur einmal angezeigt werden.
  Jeder davon ermöglicht Ihnen die Anmeldung anstelle des Authentifikator-Codes, sollten Sie Ihr
  Smartphone verlieren. Speichern Sie diese daher ab, bevor Sie den Dialog schließen. **New recovery codes**
  generiert neue Codes, wodurch die alten ungültig werden. Das Deaktivieren der zweistufigen Überprüfung
  sowie das Anfordern neuer Codes erfordern jeweils vorab die Eingabe eines Codes.
- **Passwort.** Eine Änderung meldet Sie auf allen anderen Geräten ab. Ein über
  Google, GitHub oder LinkedIn erstelltes Konto besitzt kein Passwort; die Seite bietet Ihnen an,
  Ihnen einen Link zum Festlegen eines Passworts per E-Mail zu senden.
- **Angemeldete Geräte.** Jeder Browser und jedes Terminal, das bei Ihrem Konto angemeldet ist,
  samt IP-Adresse und Zeitpunkt der Anmeldung. Melden Sie unbekannte Geräte gezielt ab,
  oder alle Geräte auf einmal.

[Zugriffstoken](/docs/deployment/cloud-agents/#ci-and-agents) sind keine Benutzersitzungen und erfordern keinen zweiten
Faktor, sodass CI-Pipelines auch nach der Aktivierung weiterhin deployen können. Widerrufen Sie ein Token, dem Sie nicht mehr
vertrauen, unter **Settings → Access tokens**.

## Ihr Team einladen

Über **Members → Add member** fügen Sie Personen hinzu, die bereits über ein Rebase-Konto mit einer
bestätigten E-Mail-Adresse verfügen – entweder als Administrator oder als Mitglied; ein Eigentümer kann ihnen anschließend
ebenfalls Eigentümerrechte zuweisen. Der Zugriff besteht sofort, und es wird keine E-Mail versendet. Rebase Cloud
versendet derzeit noch keine Einladungen; bitten Sie Teammitglieder ohne Konto daher, sich zuerst zu registrieren
und ihre Adresse zu bestätigen. Über das Terminal:
[`rebase cloud orgs members invite <email>`](/docs/cli/cloud/#organizations), woraufhin die CLI
darauf hinweist, falls für die angegebene Adresse kein Konto existiert.

## Cloud-Zugriff und die Benutzer Ihrer App

Hierbei sind zwei voneinander getrennte Personenkreise beteiligt, ähnlich wie bei Firebase und Supabase:

- **Cloud-Zugriff** bestimmt, wer am Projekt in Rebase Cloud arbeiten darf. Die
  Eigentümer und Administratoren einer Organisation besitzen die Rolle `admin` für jedes Projekt dieser Organisation,
  die Mitglieder die Rolle `developer`. Einem Projekt kann zudem über eine E-Mail-Einladung eine
  eigene Rolle für eine Person zugewiesen werden (`admin`, `developer` oder `viewer`), ohne
  diese zum Mitglied der Organisation zu machen. Es gilt jeweils die höherwertige Berechtigung.
  [`rebase cloud access`](/docs/cli/cloud/#project-access) verwaltet dies.
- **Die Benutzer Ihrer App** befinden sich in der app-eigenen Datenbank mit deren eigener Registrierung
  und Rollenverwaltung. Die Cloud listet oder bearbeitet diese zu keinem Zeitpunkt.

Die einzige Schnittstelle ist **Open admin panel**. Dies meldet eine Person mit `admin`-Cloud-Zugriff
im Admin-Panel der App an, abgeglichen über deren verifizierte E-Mail-Adresse: Die App
findet oder erstellt das Konto mit dieser Adresse, weist ihm die Rolle `admin` zu
und vermerkt, dass die Rolle aus Rebase Cloud stammt (in Studio unter Users & roles
entsprechend gekennzeichnet). Verliert diese Person den `admin`-Cloud-Zugriff auf das Projekt, weist Rebase
Cloud die App an, diese `admin`-Berechtigung
wieder zu entziehen, und beendet deren Sitzungen in der App. Eine manuell in der App vergebene Rolle,
einschließlich einer vor dem ersten Aufruf von „Open admin panel“ vergebenen `admin`-Rolle, bleibt erhalten, und das
Konto wird niemals gelöscht.

## Nachvollziehen, wer was getan hat

Die Seite **Activity** in der Konsole sowie `rebase cloud activity` zeigen den
Eigentümern und Administratoren der Organisation, wer wann bereitgestellt hat, eine Umgebungsvariable
gesetzt oder aufgedeckt hat (nach Name, niemals nach Wert), eine Domain geändert, ein Backup wiederhergestellt,
ein Projekt skaliert, gestoppt oder gelöscht, die Rolle eines Mitglieds geändert oder ein
Token erstellt hat. Die **Settings** eines Projekts verlinken auf dessen eigene Einträge; ein Eintrag
zu einem gelöschten Projekt bleibt erhalten. Ein Skript liest dies mit einem Token aus, das mit
`--can audit` für die Organisation erstellt wurde. Die Einträge werden ein Jahr lang aufbewahrt. Die Filter sind in
[`rebase cloud`](/docs/cli/cloud/#organizations) beschrieben.

## CI und Agenten

Ein CI-Job oder ein Agent sollte niemals Ihr persönliches Passwort verwenden. Nutzen Sie stattdessen ein Token, das auf
wenige Aktionen für ein einzelnes Projekt beschränkt ist, erstellt über ein angemeldetes Terminal mit
`rebase cloud tokens create --project shop --can deploy,logs`, und hinterlegen Sie es als
`REBASE_TOKEN`. Die Abrechnung, das Aktivitätsprotokoll und die Benachrichtigungseinstellungen
einer Organisation sind eigenständige Berechtigungen (`--can billing`, `audit`,
`notifications`), die ein Token nur erhält, wenn sie explizit angefordert werden. Die Berechtigungen, ein
GitHub Actions-Workflow und welche Rechte einer angemeldeten Person vorbehalten bleiben, finden Sie unter
[CI und Agenten](/docs/deployment/cloud-agents/#ci-and-agents).

## Ein Backend ohne Benutzerkonto

`rebase cloud init --claim` stellt einer App ein aktives Backend bereit, noch bevor sich jemand
registriert hat, und gibt eine Übernahme-URL (Claim URL) aus, über die das Projekt dauerhaft behalten werden kann; ein Projekt, das innerhalb
von 72 Stunden von niemandem übernommen wird, wird gelöscht. Welche Aktionen das Token eines nicht übernommenen Projekts
ausführen darf, welches `REBASE_API_TOKEN` es schreibt und was sich durch die Übernahme ändert, ist beschrieben unter
[Ein Backend ohne Benutzerkonto](/docs/deployment/cloud-agents/#a-backend-with-no-account).

## Compute-Ressourcen und deren Kosten

Die Abrechnung eines Projekts basiert auf den reservierten Ressourcen, nicht auf festen Tarifstufen. `compute` gibt
jeden Regler und den detaillierten Kostenvoranschlag der Control-Plane dafür aus. (`rebase cloud
resources` ist etwas anderes: die Datenbanken und Buckets, die der Code deklariert,
und ob diese jeweils bereitgestellt sind – siehe die [CLI-Referenz](/docs/cli/cloud/)).

```bash
rebase cloud compute
rebase cloud compute set --cpu 500m --memory 2Gi
```

| Regler | Einheit und Bedeutung |
|---|---|
| `--cpu`, `--memory` | App-Ressourcenanforderung (Request) pro Instanz, z. B. `500m` und `2Gi`. Leer bedeutet Plattform-Standardwert, der von der Region abhängt (siehe unten) |
| `--replicas` | Dauerhaft vorhandene Instanzen: die Untergrenze des Autoscalers und der Betrag, den das Projekt monatlich fest abrechnet |
| `--autoscale-max` | 1–16. Die Obergrenze, die erreicht werden darf. Instanzen, die der Autoscaler oberhalb von `--replicas` hinzufügt, werden pro Pod-Sekunde zu denselben Tarifen abgerechnet, und zwar nur dort, wo die Plattform dies aktiviert hat; **Usage this month** gibt Auskunft darüber. `--no-autoscale` deaktiviert dies |
| `--autoscale-cpu-target` | 10–95. Die CPU-Auslastung, die der Autoscaler anstrebt, bezogen auf den Request statt auf das Limit. Leer bedeutet 70 |
| `--spot` | `true` oder `false`. Preemptible-Kapazität: günstiger, wird jedoch ohne Vorankündigung neu gestartet |
| `--db-instances` | 1–3. `1` ist eine einzelne Instanz ohne Failover; `2` fügt eine automatische Standby-Instanz hinzu |
| `--db-cpu`, `--db-memory` | Pro Datenbankinstanz. Leer bedeutet `160m` und `1Gi` |

Ein nicht gesetzter Regler ist nicht dasselbe wie ein Regler, der fest auf denselben Wert fixiert ist: Ein nicht gesetzter Regler
folgt dem Plattform-Standard und passt sich an, wenn dieser sich ändert.

In Belgien (europe-west1) reserviert der Standard 100m CPU und 384Mi und kann kurzzeitig auf
bis zu 2 CPU und 2 GiB ansteigen; in Falkenstein und Helsinki kann der Arbeitsspeicher auf das 1,4-fache des
Requests und die CPU auf das 10-fache (maximal 1,7 vCPU) skalieren. `rebase cloud compute` zeigt die Werte Ihres
Projekts an.

Die CLI führt bewusst keine Validierung durch – die Grenzwerte hängen vom jeweiligen Cluster ab, auf dem
ein Projekt läuft, und unterscheiden sich je nach Anbieter. Die Control-Plane lehnt Werte ab,
die sie nicht bereitstellen kann, und nennt das betroffene Feld. Führen Sie `rebase cloud compute` aus, um
die Kosten in €/Monat vor und nach der Änderung einzusehen; eine Änderung wird sofort wirksam und ab heute anteilig berechnet.
Eine Datenbankänderung wird umgehend angewendet; bis sie aktiv ist, wird die bisherige Größe abgerechnet.
Ein geänderter Datenbank-CPU- oder Speicherwert bzw. eine Reduzierung der Instanzen startet die Datenbank neu
(ca. 30 Sekunden bis 3 Minuten; bestehende Verbindungen werden getrennt und neu aufgebaut): `compute set`
weist darauf hin und bittet um Bestätigung; außerhalb eines Terminals dient `--yes` als Zustimmung. Schlägt dieser
Neustart fehl, unternimmt `rebase cloud compute apply` einen erneuten Versuch.

## Die weiteren Befehle im Überblick

| Befehlsgruppe | Zuständigkeitsbereich |
|---|---|
| `login`, `logout`, `whoami`, `access-token` | Ihre Sitzung; `access-token` gibt den Bearer-Token aus, den die CLI aktuell senden würde, für Skripte und den MCP-Server |
| `tokens` | Tokens für CI und Agenten, jeweils auf ein einzelnes Projekt beschränkt. Siehe [CI und Agenten](/docs/deployment/cloud-agents/#ci-and-agents) |
| `link`, `unlink`, `use`, `open` | Verknüpfen dieses Verzeichnisses mit einem Projekt, Auswählen einer Organisation, Öffnen der Konsole |
| `connect` | Hinzufügen eines selbst gehosteten Rebase-Servers zu Ihrem Konto, damit der [Rebase Connector](/docs/ai/rebase-connector/#add-your-self-hosted-instances) in Claude diesen neben Ihren Cloud-Projekten erreicht. `--list` listet sie auf, `--remove` entfernt einen. Für Eigentümer und Administratoren |
| `init`, `claim` | Mit `--claim`: ein aktives Backend ohne Konto und ein Link zur Übernahme; `claim` gibt diesen Link erneut aus. Siehe [Ein Backend ohne Benutzerkonto](/docs/deployment/cloud-agents/#a-backend-with-no-account) |
| `projects` | Erstellen, auflisten, inspizieren, löschen |
| `deploy`, `logs`, `deployments`, `rollback`, `cancel` | Bereitstellen und überwachen |
| `deploy-hooks` | Geheime URLs, die ein Git-Host oder eine CI aufruft, um das Projekt bereitzustellen: auflisten, erstellen (die URL wird nur einmal angezeigt), widerrufen. |
| `previews` | Durch `deploy --preview` unter einer eigenen Adresse bereitgestellte Builds und deren Löschung. Siehe [Eine Änderung in der Vorschau ansehen](#eine-änderung-in-der-vorschau-ansehen-preview) |
| `sleep` | Ruhemodus bei Inaktivität: `on [--after 15m\|30m\|1h\|4h]`, `off`, `wake` und `status` (Standard). Im Ruhezustand belegt ein Projekt weder CPU noch Arbeitsspeicher und wird durch die nächste Anfrage aufgeweckt; geplante Jobs und Hintergrundaufgaben pausieren in dieser Zeit. Kann ein Projekt nicht schlafen, lehnt die Control-Plane dies ab und nennt den Grund |
| `start`, `stop`, `restart` | Pausieren eines Projekts und Wiederinbetriebnahme. Ein gestopptes Projekt behält sein Abonnement, es sei denn, die Plattform rechnet für gestoppte Projekte nur den Speicher und die Plattformgebühr ab; die Zeile **Billing** in der Konsole weist darauf hin, wenn dies zutrifft |
| `status`, `metrics`, `debug` | Was das Projekt tut und warum es eventuell nicht funktioniert |
| `alerts` | Offene Vorfälle des Projekts sowie Bestätigen oder Zurückstellen (Snooze) eines Vorfalls. |
| `cron` | Die Cron-Jobs der bereitgestellten App und deren protokollierte Ausführungen, ausgelesen über Ihr `rebase cloud`-Login. Schreibgeschützt |
| `env` | Umgebungsvariablen. `list` gibt niemals Werte aus; `--secret` ist rein schreibend |
| `app-key` | Der Schlüssel, den `init --claim` als `REBASE_API_TOKEN` in `.env` geschrieben hat und der bei der Übernahme übergeben wurde; `rotate` ersetzt ihn und widerruft den alten. Für Eigentümer und Administratoren |
| `service-key` | `REBASE_SERVICE_KEY`, Administrator-Schlüssel für die app-eigene API: wann er zuletzt rotiert wurde; `rotate` erzeugt einen neuen für die App. Für Eigentümer und Administratoren |
| `domains` | Eigene Domains, die hinzuzufügenden DNS-Einträge und deren Verifizierung. Ein Projekt kann unter mehreren Domains erreichbar sein, die jeweils separat verifiziert werden; `verify` und `remove` erwarten die jeweilige Domain als Parameter, der nur weggelassen werden darf, wenn genau eine vorhanden ist (bei `verify`: genau eine ausstehende). Jede verifizierte Domain liefert das Projekt direkt aus; `primary <domain>` wählt die kanonische Domain und `redirect <domain>` leitet eine andere Domain per 308-Redirect darauf um, wobei Pfad und Query erhalten bleiben (`--off` liefert sie wieder direkt aus) – richten Sie dies für `www.` neben einer Apex-Domain ein, da Google-Sign-in, Cookies und Passkeys an den jeweiligen Origin gebunden sind. Eine Domain, unter der eine einzelne App bereitgestellt wird (ein App-`path` mit Hostname), leitet niemals weiter. Eine Apex-Domain (`example.com`, ohne Subdomain) erfordert einen **A**-Record, da DNS dort keinen CNAME erlaubt. Diese Adresse ist der Ingress der Plattform, und es ist nicht garantiert, dass sie immer gleich bleibt: Zieht die Plattform um, zeigt ein A-Record weiterhin auf die alte Adresse. Bietet Ihr DNS-Host ALIAS, ANAME oder CNAME-Flattening an der Apex-Domain an, verweisen Sie stattdessen auf den `tenantHost` des Projekts, der automatisch mit der Plattform mitwandert. Der CNAME einer Subdomain folgt diesem bereits automatisch. `list` meldet `verified, certificate pending`, bis HTTPS mit einem echten Zertifikat antwortet. `list --json` gibt `{ projectId, tenantHost, domains: [...] }` zurück |
| `db` | Eine Datenbank anbinden oder erstellen, Verbindung vom lokalen Rechner herstellen, Backups, Wiederherstellung und Point-in-Time-Recovery |
| `guests` | Die Gastbenutzer, die durch anonyme Anmeldungen entstanden sind: zählen, einzelne löschen oder diejenigen bereinigen, die seit längerer Zeit inaktiv sind. Siehe [Gäste](/docs/cli/cloud/#guests). Für Eigentümer und Administratoren |
| `extensions` | Die Postgres-Extension-Allowlist |
| `storage` | Die Buckets des Projekts und deren Schlüssel auf [Rebase Storage](/docs/deployment/rebase-storage/) |
| `resources` | Welche Datenbanken und Buckets die Plattform vorhält, verglichen mit den Deklarationen im Code |
| `compute` | Was dieses Projekt reserviert, was es kostet und wie man es anpasst |
| `events` | Was am Backend passiert ist, chronologisch absteigend: Skalierung der App, geplante und angewendete Datenbankänderungen, Übernahme durch eine Standby-Instanz, Vergrößerung der Festplatte |
| `usage` | Im laufenden Monat verbrauchte Anfragen im Vergleich zum enthaltenen Freikontingent und der bisherige Mehrverbrauch, wie er auf der Rechnung erfasst wird. `usage org` listet alle Projekte der Organisation auf |
| `clusters` | Die Cluster, auf denen die Mandanten laufen. Nur für Plattform-Administratoren |
| `settings`, `orgs`, `access`, `billing` | Projekteinstellungen, Organisationen samt Mitgliedern und Einladungen, Zugriffsberechtigungen auf ein Projekt, Abrechnung |
| `activity` | Das Audit-Log der Organisation: wer bereitgestellt hat, eine Umgebungsvariable (nach Name), eine Domain, ein Backup, ein Mitglied oder ein Token geändert hat. Für Eigentümer und Administratoren. Siehe [Nachvollziehen, wer was getan hat](#nachvollziehen-wer-was-getan-hat) |
| `notifications` | Wohin die Events des Projekts per POST gesendet werden: Slack, Discord oder eine beliebige HTTPS-URL ([Cloud-Benachrichtigungen](/docs/deployment/cloud-notifications/)) |

Jede Gruppe in dieser Tabelle beantwortet den Parameter `--help` mit einer eigenen Seite – einer Zeile zur
Syntax, den verfügbaren Flags und Beispielen – und `--help` führt den Befehl niemals aus. Ein automatisierter
Test prüft das Verzeichnis dieser Seiten; wird eine Befehlsgruppe ohne entsprechende Hilfeseite hinzugefügt, schlägt
der Build fehl, anstatt das Inhaltsverzeichnis anzuzeigen. `verify:docs` gleicht die Tabelle selbst mit
diesem Index ab: Jede von der CLI bereitgestellte Gruppe taucht hier genau einmal auf, sodass eine ohne Tabellenzeile
hinzugefügte Gruppe den Build ebenfalls fehlschlagen lässt.

Wird der Befehl weitergeleitet (Piping), gibt `--help` stattdessen JSON aus: dieselbe Syntaxzeile,
Flags und Beispiele strukturiert lesbar statt über sechzig Zeilen mit Terminal-Escape-Sequenzen.

## Was die Beta noch nicht enthält

Keine freie Regionswahl, keine Self-Service-Registrierung, kein veröffentlichtes SLA, keine Branch-Deploys,
Tokens, die im Namen einer Person handeln, und kein öffentlicher Datenbank-Endpunkt. [Was die Beta
nicht enthält](/docs/deployment/cloud-beta-limits/) erläutert jeden dieser Punkte im Detail, inklusive
der Konsequenzen für Deploys mit Produktions-Secrets.

## Stattdessen selbst hosten

Nichts davon stellt einen Lock-in dar. Die [Anleitung zum Self-Hosting](/docs/deployment/self-hosting/)
führt das identische Image und Bundle mit `docker compose` aus, und die
[Kubernetes-Anleitung](/docs/deployment/kubernetes/) bildet dieselbe Topologie über das
Helm-Chart ab.
