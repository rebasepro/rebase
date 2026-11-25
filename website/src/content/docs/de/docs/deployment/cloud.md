---
sourceHash: 7f18ccdd99ad1dc9
title: Rebase Cloud
sidebar_label: Rebase Cloud
description: Rebase Cloud ist dasselbe Rebase, für Sie betrieben. Was es ist, wie ein Projekt verknüpft und bereitgestellt wird und was die Private Beta noch nicht enthält.
---

Rebase Cloud führt dasselbe Open-Source-Rebase aus, das Sie auch selbst hosten würden – dasselbe
veröffentlichte `rebasepro/server`-Image, dasselbe Bundle, dasselbe Postgres. Der
Unterschied besteht darin, wer es betreibt.

:::note[Private Beta]
Rebase Cloud befindet sich in der **Private Beta**. Es betreibt bereits echte Mandanten und wird in
Batches freigeschaltet. [Zugang anfragen](https://rebase.pro/pricing).

Es ist kein Self-Service, daher erfordern die folgenden Befehle ein Konto, das freigeschaltet wurde.
Alles andere auf dieser Website funktioniert auch ohne ein solches Konto.
:::

## Was es ist

Ein Cloud-**Projekt** besteht aus drei Komponenten, die die Plattform für Sie betreibt:

| | Was Sie erhalten |
|---|---|
| **App** | Ihr Bundle, ausgeführt auf dem veröffentlichten Runtime-Image. Deployments sind ein Bundle-Upload, kein Container-Build |
| **Datenbank** | Ein verwaltetes PostgreSQL mit automatisierten Backups und Point-in-Time-Recovery |
| **Storage** | Ein eigener Bucket auf [Rebase Storage](/docs/deployment/rebase-storage/), falls Ihr Projekt Dateispeicher verwendet |

Die App und die Datenbank werden bereitgestellt, wenn Sie zum ersten Mal deployen; ein Bucket erst,
wenn Sie einen anfordern ([Dateispeicher](#dateispeicher)). Jede Ressource wird nach dem abgerechnet,
was sie reserviert, nicht pro Benutzerplatz.

**An Ihrem Projekt ändert sich nichts, um dort zu laufen.** Dasselbe Repository
kann mit `docker compose` selbst gehostet werden, und die Ausstiegsmöglichkeit ist real: `rebase build`
erzeugt ein Bundle, das überall dort startet, wo das Runtime-Image ausgeführt werden kann.

## Ein Projekt verknüpfen

Aus einem Projektverzeichnis:

```bash
rebase cloud login
rebase cloud billing setup
rebase cloud projects create --name "My app" --subdomain my-app --link
```

`login` öffnet die Konsole in Ihrem Browser und gibt einen kurzen Code aus. Überprüfen Sie, ob
die Konsole denselben Code anzeigt, und bestätigen Sie die Anmeldung dort: Das Terminal
übernimmt die Sitzung und speichert sie in `~/.rebase/credentials.json`. Wenn Sie
noch nicht in der Konsole angemeldet sind, melden Sie sich dort zuerst mit der von Ihnen genutzten Methode an,
einschließlich Google und GitHub. Über SSH gibt `rebase cloud login --no-browser` den Link aus,
den Sie auf Ihrem eigenen Rechner öffnen können.

`projects create` akzeptiert keine Positionsargumente. Der Name und die Subdomain sind
Flags, und beide sind erforderlich – auf einem Terminal werden sie abgefragt, und ein
Headless-Lauf, der eines davon auslässt, bricht mit `input_required` ab, anstatt eines zu erfinden.
**Die Subdomain kann nachträglich nicht bearbeitet werden:** Sie ist der
`<slug>.rebase.website`-Host, unter dem das Projekt antwortet; wählen Sie sie daher mit Bedacht.

`--link` bindet dieses Verzeichnis im selben Aufruf an das Projekt, sodass kein
separater `link`-Schritt erforderlich ist. Es erstellt `.rebase/cloud.json`, worin die Projekt-ID
und der Slug festgehalten werden. Diese Datei ist kein Geheimnis und enthält nicht Ihre Anmeldedaten – diese
befinden sich in `~/.rebase/credentials.json`, geschrieben von `login`.

Sie wird jedoch zusammen mit dem Code committet, sodass ein geklontes Repository jede beliebige
Control Plane angeben kann. Wenn der Host nur aus dieser Datei stammt und weder der
plattformeigene ist noch einer, bei dem Sie sich zuvor angemeldet haben, nennt `login` ihn und fragt nach,
bevor Ihre E-Mail-Adresse und Ihr Passwort dorthin gesendet werden. Ohne Terminal oder mit
`--json` bricht der Befehl mit `unknown_control_plane` ab; übergeben Sie `--url <host>` (oder setzen Sie
`REBASE_CLOUD_URL`), um sich dort gezielt anzumelden.

Um sich ohne Browser anzumelden, übergeben Sie Ihre E-Mail-Adresse: `rebase cloud login --email
me@example.com` fragt nach Ihrem Passwort. **Haben Sie sich mit Google, GitHub oder
LinkedIn registriert?** Ihr Konto hat kein Passwort, verwenden Sie stattdessen einen Code:

```bash
rebase cloud login --code --email me@example.com
```

Die Control Plane sendet Ihnen per E-Mail einen 6-stelligen Code, der zehn Minuten lang gültig ist, und Sie geben
ihn an der Eingabeaufforderung ein. Mit `--email` und ohne Passwort fragt `rebase cloud login`,
ob Sie Ihr Passwort oder einen Code verwenden möchten. Codes erfordern, dass die Control Plane E-Mails
senden kann; wenn dies nicht möglich ist, meldet `--code` dies und bricht mit `otp_unavailable` ab.

Wenn Sie die Zwei-Faktor-Authentifizierung aktiviert haben, fragt `login` anschließend nach dem Code aus
Ihrer Authentifikator-App oder einem Ihrer Wiederherstellungscodes, unabhängig davon, wie Sie sich
angemeldet haben. Über den Browser fragt die Konsole diesen bei der Anmeldung dort ab. Weder ein Anmeldecode noch ein zweiter Faktor können ohne ein Terminal eingegeben werden.
Erstellen Sie für ein Skript ein Zugriffstoken in der Konsole (**Settings → Access
tokens**) und setzen Sie `REBASE_TOKEN`; siehe [CI und Agents](/docs/deployment/cloud-agents/#ci-and-agents).

Ein falsches Passwort liefert `invalid_credentials` mit denselben zwei Anmeldeoptionen zurück, da
die häufigste Ursache ein Konto ist, das nie ein Passwort besaß.

`billing setup` hinterlegt einmalig eine Kreditkarte für die Organisation. Dies steht
absichtlich an erster Stelle der Sequenz: Das erste Deployment eines Projekts wird ohne Zahlungsart abgelehnt,
und dies erst nach Abschluss des Bundle-Uploads herauszufinden, wäre der schlechtere Ablauf.

Danach listet die Seite **Billing** in der Konsole die Rechnungen der Organisation auf,
jeweils mit der von Stripe gehosteten Seite und dem PDF, und zeigt eine Vorschau auf die nächste Rechnung für jedes
Projekt. `rebase cloud billing invoices` und `rebase cloud billing upcoming`
geben dasselbe aus. Beide richten sich an die Eigentümer und Administratoren der Organisation. Sofern die
Plattform dies anbietet, öffnet **Manage billing** das Stripe-Kundenportal für die
Kreditkarte, die Rechnungsdaten und vergangene Rechnungen.

Ist bereits eine Karte hinterlegt, erfordert das Erstellen eines weiteren Projekts in der Konsole
keine zweite Zahlung: Das Projekt wird über diese Karte abgerechnet und bereitgestellt. Wird die Karte
abgelehnt oder verlangt die Bank eine Zahlungsbestätigung, führt Sie die Konsole zu
**Billing**, wo **Fix your card** eine andere Karte speichert und **Complete the
payment** die Stripe-Rechnung öffnet.

Was ein Projekt verbraucht hat, wird in dessen Übersicht unter **Usage this month** angezeigt,
sowie für alle Projekte gleichzeitig auf der Seite **Billing**: Anfragen im Vergleich zum
enthaltenen Freikontingent (der Balken färbt sich bei 80 % gelb), 5xx-Fehler, der bisherige Mehrverbrauch
und die Hochrechnung für den Monat bei aktuellem Tempo. Der Mehrverbrauch wird von
demselben Code berechnet, der ihn an Stripe meldet, entspricht also dem Rechnungsbetrag; er
erscheint auf der Rechnung des Folgemonats. `rebase cloud usage` gibt dasselbe aus,
und `rebase cloud usage org` für die gesamte Organisation. Jedes Mitglied kann dies einsehen.
Die Zahlen weisen darauf hin, was noch nicht sichtbar ist: Objektspeicher wird gemessen, aber
noch nicht in Rechnung gestellt ([Rebase Storage](/docs/deployment/rebase-storage/) nennt die
Preise); solange ein Projekt zwei oder mehr App-Pods ausführt,
werden dessen Anfragen nicht gezählt; und ein Tag mit fehlenden Messwerten zählt zu wenig. Ein
skaliertes Projekt zeigt auch die Pods an, die über `--replicas` hinaus liefen, in Pod-Stunden,
was sie zu den eigenen Tarifen kosten und ob diese Plattform sie bereits in Rechnung stellt. Ein
von einem Agent übernommenes Projekt zählt erst ab dem Tag der Übernahme: Davor
gehörte das Projekt der Plattform.

Ein bestehendes Projekt lässt sich verknüpfen, ohne ein neues zu erstellen:

```bash
rebase cloud projects list
rebase cloud link --project my-app
```

## Deployen

```bash
rebase cloud deploy
```

Ein einziger Befehl, und kein Flag, das man sich merken müsste. Die `rebase.json` eines Scaffolds deklariert
`runtime: "managed"` für sein Backend, und `deploy` liest diese Deklaration – dies
wird währenddessen angezeigt (`rebase.json declares runtime: managed — deploying a
bundle`), baut die App in `dist-bundle`, lädt das Bundle hoch, führt es auf dem
veröffentlichten Runtime-Image aus und verfolgt das Deployment bis zum finalen Status. Der Exit-Code
ist das Ergebnis, sodass derselbe Befehl unbeaufsichtigt in CI funktioniert.

Am Ende wird angegeben, wo jede App nun erreichbar ist und ob die neue Version
dort live ist:

```text
  ✓ Deployed songbuzz in 1m 12s  (deployment fb3c7442-9937-4179-8d3c-88a106da149d)

    game     static   https://songbuzz.rebase.website      live
    backend  backend  https://songbuzz.rebase.website/api  live

  ✓ Live: the new version answers on every address above.
  Something wrong? `rebase cloud rollback` puts the previous deployment back.
```

„Live“ bedeutet, dass die Adresse nach dem Build geantwortet hat: Das `/health` eines Backends
gab `ok` zurück, und die Seite einer statischen App wurde geladen (aus diesem Deployment, wenn die
Plattform sie bereitstellt). Die Prüfung wartet bis zu `--live-timeout` Sekunden, standardmäßig
60; `0` überspringt sie. Wenn eine App nicht rechtzeitig antwortet, wird das Deployment dennoch mit Exit-Code
Null beendet, da das Deployment erfolgreich war, und die letzte Zeile gibt an, welche App nicht
geantwortet hat und warum. Ein fehlgeschlagenes Deployment endet stattdessen in einer einzigen Zeile, die die App und die
Ursache nennt, wobei `rebase cloud logs` das vollständige Build-Protokoll bereitstellt.

Skripte übergeben `--json` für ein einzelnes Objekt mit denselben Informationen – `apps`, `hosts`,
`live`, `liveChecks`, `durationMs` und die Deployment-ID. Anders als der Rest von
`rebase cloud` schaltet `deploy` bei einer Pipe nicht automatisch auf JSON um.

Was diese Laufzeitumgebung erlaubt – Pakete und native Module, Speicher und Instanzen,
Timeouts und Body-Größen, das Dateisystem, Secrets, Storage und ausgehender
Netzwerkverkehr – ist auf einer eigenen Seite beschrieben:
[Managed Backend-Runtime](/docs/deployment/managed-runtime/).

Um ein Artefakt bereitzustellen, das bereits zuvor gebaut wurde – etwa in einem CI-Job, der einmal
baut und zweimal deployt –, verweisen Sie auf das Verzeichnis, anstatt neu zu bauen:

```bash
rebase build
rebase cloud deploy --bundle-dir dist-bundle
```

Das Verlassen der verwalteten Laufzeitumgebung erfordert ein eigenes Flag, `--eject`, und wird durch nichts
anderes ausgelöst: Ein Build, der ein verwaltetes Projekt auf ein Container-Image verschieben würde, das es dann
selbst verwaltet, wird abgelehnt, bis Sie dies explizit angeben. Früher bedeutete `--force` dies, was die am
wenigsten umkehrbare Aktion der CLI unter dasselbe Wort wie „diese Datei überschreiben“ stellte;
dies ist nun eine unbekannte Option statt eines Alias, sodass ein Skript, das sie verwendet,
stoppt.

### Die Syntaxprüfung vor dem Upload

Die Dateien einer statischen App werden exakt so ausgeliefert, wie sie vorliegen. Wenn deren `build` lediglich
handgeschriebene Skripte in `output` kopiert, wurden sie von nichts geparst, und eine Datei
mit einem Tippfehler geht live und verhindert das Laden der Seite. Bevor also irgendetwas
hochgeladen wird, parst `deploy` jede `.js`-, `.mjs`- und `.cjs`-Datei im `output` jeder statischen
App sowie jedes Inline-`<script>` in deren `.html`-Dateien. Dies
umfasst sowohl separat deployte statische Apps als auch statische Apps, die in das
Bundle des Backends integriert sind. Ein Syntaxfehler stoppt das Deployment mit Angabe von Datei, Zeile und Spalte:

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
als klassisches Skript oder als Modul parsen lässt, da die Seite darüber entscheidet. Nichts
unter `node_modules` wird gelesen, und ebenso kein vorgebautes `--bundle-dir`.
`--no-verify` überspringt die Prüfung für ein einzelnes Deployment.

Den Status beobachten:

```bash
rebase cloud logs               # das Build-Protokoll
rebase cloud logs --runtime -f  # Live-Ausgabe der laufenden App bis Strg-C
rebase cloud status             # Status des Projekts laut Plattform
```

`status` gibt `blockedOn` und `nextAction` aus. Wenn `blockedOn` den Wert `null` hat,
arbeitet die Plattform regulär und Polling ist das richtige Vorgehen; wenn ein Wert angegeben
ist, wartet dieser Vorgang auf eine Aktion von Ihnen.

Einer davon ist `email_not_configured`: Die App hat die Anmeldung per Magic Link oder E-Mail-Code
aktiviert (`AUTH_MAGIC_LINK`, `AUTH_EMAIL_OTP`), verfügt jedoch über keinen E-Mail-Dienst. Das
Deployment ist somit zwar live, aber niemand kann sich anmelden. Rebase Cloud versendet keine
E-Mails für Ihre App: Setzen Sie `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` und
`SMTP_FROM` mit `rebase cloud env set` und deployen Sie anschließend. `status` liest dies aus dem
app-eigenen `GET /api/auth/config` (im Feld `unavailable`), und `deploy` gibt dies
ebenfalls im Rahmen seiner Live-Prüfung an.

## Mehr als eine Datenbank

Deklarieren Sie jede (`database("analytics")`) und deployen Sie: Sie wird auf dem Server des Projekts als
`DATABASE_URL__ANALYTICS` angelegt und teilt sich dessen Ressourcen und Abrechnung ([Details](/docs/backend/multiple-sources/#on-rebase-cloud)).

## Dateispeicher

Ein neues Projekt besitzt keinen Bucket: Uploads werden mit `501 STORAGE_NOT_CONFIGURED` abgewiesen,
und die Deployment-Zusammenfassung weist darauf hin, anstatt Daten auf eine Festplatte zu schreiben, die bei jedem Deployment ersetzt wird.

Richten Sie eine von zwei Varianten ein und deployen Sie erneut, damit die App sie übernimmt:

```bash
# Ein Bucket, den Rebase für Sie betreibt. Die Storage-Seite der Konsole macht dasselbe.
rebase cloud storage create

# Oder Ihr eigener S3-kompatibler Bucket: AWS S3, Cloudflare R2, Backblaze B2, MinIO…
rebase cloud storage attach --bucket <name> \
  --access-key-id <id> --secret-access-key <secret> \
  --endpoint <url>        # für AWS weglassen; --force-path-style für MinIO hinzufügen

rebase cloud deploy
```

`rebase cloud storage` listet die Buckets des Projekts auf; jedes deklarierte `bucket("media")`
erhält einen eigenen ([Mehrere Datenbanken und Buckets](/docs/backend/multiple-sources/#on-rebase-cloud)).
Bei eigenen Buckets binden Sie jeden
mit `--source <key>` an; wird der Speicher direkt im Code konfiguriert, ist beides nicht erforderlich.

## Eine Änderung als Vorschau testen (Preview)

```bash
rebase cloud deploy --preview
```

Dies baut und lädt exakt das hoch, was auch `deploy` verarbeiten würde, stellt es jedoch unter einer
eigenen Adresse bereit, wie etwa `https://shop--k3x9ab.rebase.website`. Die Produktionsumgebung liefert
weiterhin den bisherigen Stand aus. Das Deployment gibt die Adresse der Preview aus, sobald der
Build abgeschlossen ist.

Um dieselbe Adresse über mehrere Deployments hinweg beizubehalten, benennen Sie die Preview. Ein erneutes
Deployen unter demselben Namen aktualisiert sie:

```bash
rebase cloud deploy --preview-name new-checkout
```

Womit eine Preview kommuniziert, hängt davon ab, was Sie bereitgestellt haben:

- **`rebase cloud deploy --preview`** erstellt eine Vorschau des Backends inklusive der darin integrierten
  statischen Apps, genau wie in der Produktion. Es erhält ein eigenes Backend auf
  einer **eigenen, leeren Datenbank**, niemals auf der Produktionsdatenbank. Ein Start gegen
  die Produktionsdatenbank würde das Schema und die Zugriffsregeln der Preview auf diese anwenden.
- **`rebase cloud deploy web --preview`** würde eine einzelne statische App isoliert
  in der Vorschau anzeigen, deren Seiten das **Produktions-Backend** aufrufen. Dies erfordert eine Control Plane,
  die statische Websites eigenständig ausliefern kann, was Rebase Cloud derzeit noch nicht unterstützt: Es
  bricht mit `PREVIEW_STATIC_UNSERVED` ab und veröffentlicht nichts. Erstellen Sie stattdessen eine Vorschau des
  Backends, das die darin integrierten statischen Apps bereitstellt; ein Projekt ohne
  verwaltetes Backend kann derzeit noch nicht in die Vorschau überführt werden.

Eine Preview lädt keinen Quellcode hoch und registriert keine Apps oder Hostnames, da jeder
dieser Schritte das Produktionsprojekt verändern würde. `--source` und `--eject` können nicht
mit `--preview` kombiniert werden. Beide bauen ein Container-Image für die Produktion.

```bash
rebase cloud previews                      # Name, Adresse, App, Backend, Ablaufdatum
rebase cloud logs --preview new-checkout   # Build-Protokoll; -f folgt einem noch laufenden Build
rebase cloud logs --runtime --preview new-checkout -f  # Ausgabe des Backends
rebase cloud previews delete new-checkout  # stoppt die Bereitstellung und löscht die Datenbank
```

`rebase cloud logs` ohne `--preview` bezieht sich immer auf die Produktion.

Die Seite **Deployments** der Konsole listet dieselben Previews auf und erlaubt es, diese zu öffnen, deren
Build-Protokoll einzusehen oder sie zu löschen. Das Erstellen bleibt ein CLI-Schritt.

Eine Preview läuft eine Woche nach dem letzten Deployment darauf ab.

Nach Abschluss prüft das Deployment, ob die Adresse der Preview antwortet, genau wie bei einem
Produktions-Deployment (`--live-timeout <seconds>`, `0` zum Überspringen). Das Zertifikat einer neuen
Preview kann ein bis zwei Minuten dauern, daher kann ein erfolgreiches Deployment
melden, dass die Adresse noch nicht antwortet.

Eine Backend-Preview wird wie eine App-Einheit in der Standardgröße abgerechnet (100m CPU
und 384 MiB Arbeitsspeicher, zum Tarif Ihrer App für deren Region und Kapazität),
anteilig für die Dauer ihrer Existenz, und sie erscheint im monatlichen
Kostenvoranschlag des Projekts in der Konsole. `rebase cloud deploy --preview` gibt dieselbe Schätzung
dafür pro Monat aus (`cost` unter `--json`). Das Starten erfordert eine hinterlegte Kreditkarte, genau wie ein
Produktions-Deployment. Ein erstes Deployment, das
fehlschlägt, bevor etwas ausgeführt wird, wird entfernt und nicht berechnet. Ein Projekt darf
bis zu drei Backend-Previews gleichzeitig ausführen.

Jede neue Preview-Adresse erhält ein eigenes TLS-Zertifikat von Let's Encrypt,
das einer Domain 50 neue Zertifikate pro Woche erlaubt, geteilt mit allen Produktions-Websites
darauf. Previews dürfen plattformweit 20 davon in beliebigen 7 Tagen beanspruchen. Darüber
hinaus wird eine neue Preview abgelehnt (`429`, `preview_cert_budget`), unter Angabe des Zeitpunkts, ab dem sie
wieder bereitgestellt werden kann; das erneute Deployen einer bereits existierenden Preview zählt niemals dazu.

Die Datenbank einer Backend-Preview ist eine zweite Datenbank auf dem Postgres-Server der **Produktion**:
eigene Daten, aber dieselbe Instanz und dieselbe Festplatte. Sie ist auf 10
Verbindungen limitiert, damit Previews nicht die Ressourcen der Produktion aufbrauchen, sowie auf 2 GB: Eine
Preview, deren Datenbank diese Größe überschreitet, wird pausiert. Ihr Backend stoppt, ihre Adresse antwortet
nicht mehr, `rebase cloud previews` und die Konsole zeigen sie mit der entsprechenden Ursache als `paused` an,
und die Eigentümer und Administratoren des Projekts werden benachrichtigt (`preview.paused`). Ihre
Daten bleiben bis zum Ablauf erhalten. Deployen Sie sie erneut, um sie zu starten (sie wird erneut pausiert,
solange die Datenbank zu groß ist), oder löschen Sie sie. Eine pausierte Preview wird weiterhin
abgerechnet, bis sie gelöscht wird oder abläuft. Löschen Sie Previews, die Sie nicht mehr benötigen. Erweiterungen, die in der Produktion installiert sind, werden in der
Datenbank einer Preview nicht installiert.

Previews werden schrittweise eingeführt. Eine Control Plane, die diese noch nicht unterstützt, lehnt
`--preview` mit `previews_unavailable` ab und stellt nichts bereit.

## Rollback durchführen

```bash
rebase cloud deployments
rebase cloud rollback
```

Ein Rollback verweist das Projekt wieder auf den Stand, den ein vorheriges erfolgreiches Deployment
bereitgestellt hat, und führt niemals einen Rebuild durch – der Vorteil eines Rollbacks besteht darin, dass
ein Artefakt ausgeliefert wird, das bereits erfolgreich gelaufen ist.

Welche Deployments infrage kommen, hängt davon ab, wie das Projekt bereitgestellt wird, und beide Varianten
funktionieren:

| Art des Deployments | Was wiederhergestellt wird |
|---|---|
| `rebase cloud deploy` (ein Source-Build) | Das Image, das dieser Build veröffentlicht hat |
| `rebase cloud deploy --bundle` (die Plattform-Runtime) | Das Bundle, das dieses Deployment ausgeliefert hat, auf der Runtime-Version, die das Projekt aktuell ausführt |

Statische Apps, die in das Backend-Bundle integriert sind (ein einfaches `rebase cloud deploy` auf einem
Projekt mit Backend), sind Teil dieses Bundles und werden daher gemeinsam mit ihm zurückgesetzt.

Eine isoliert bereitgestellte statische App (`rebase cloud deploy <app>`) kann derzeit noch nicht
zurückgesetzt werden. Ihr Deployment zeichnet zwar auf, welche App veröffentlicht wurde, aber kein Bundle, sodass der
Control Plane die Grundlage für die Wiederherstellung fehlt. Die Lösung besteht darin, die letzte funktionierende
Version erneut zu deployen, beispielsweise aus dem Git-Commit vor der fehlerhaften Version. Nach einem solchen
Deployment weist `deploy` auf diesen Umstand hin, anstatt auf `rollback` zu verweisen, und ein `rollback`
ohne ID verweigert die Ausführung, anstatt das aktuell aktive Backend erneut bereitzustellen.

Ein Rollback erfordert daher ein Deployment, das eines von beiden aufgezeichnet hat, was ein
Projekt voraussetzt, das mindestens zweimal erfolgreich deployt wurde. `rebase cloud deployments`
markiert diejenigen, die infrage kommen, und `--json` meldet pro Zeile `rollbackable` zusammen
mit dem `image` oder `bundle`, das wiederhergestellt werden würde.

Zwei Arten von Deployments werden abgelehnt, und die CLI nennt den Grund: ein nicht erfolgreiches
Deployment sowie ein Deployment aus der Zeit, bevor die Plattform Artefakte aufzeichnete. In beiden Fällen
wird nichts gemutmaßt – Mutmaßungen würden bedeuten, das zuletzt Gebaute oder Hochgeladene
auszuliefern und vorzugeben, dieses Release wiederherzustellen – deployen Sie stattdessen
die gewünschte Version direkt.

Jedes erfolgreiche Deployment nennt am Ende die Option zum Zurücksetzen (`rebase cloud rollback`),
sodass dieser Befehl direkt zur Hand ist, sobald ein fehlerhaftes Release bemerkt wird.

Ein Rollback hängt ein neues Deployment an, anstatt die Historie zurückzuspulen, und wartet darauf,
dass die wiederhergestellte Version Anfragen bedient, bevor der Erfolg gemeldet wird. Verfolgen Sie dies mit
`rebase cloud logs -f`.

## Datenbank auf einen Zeitpunkt wiederherstellen (PITR)

Eine verwaltete Datenbank kann auf jede beliebige Minute innerhalb ihres Wiederherstellungsfensters
wiederhergestellt werden, entweder über **Database → Backups** in der Konsole oder über die CLI:
`rebase cloud db pitr status | restore --target <ISO> | cutover | discard`.
Dies geschieht in zwei Schritten. Zuerst wird eine wiederhergestellte Kopie neben der Produktivdatenbank bereitgestellt;
Ihre App läuft auf der Produktivdatenbank weiter, und der Speicherplatz der Kopie wird abgerechnet, bis
Sie umschalten (Cutover) oder sie verwerfen.
Sobald die Kopie bereit ist, wird die App durch das Umschalten auf die neue Datenbank verwiesen und neu gestartet.
Daten, die nach dem Zielzeitpunkt geschrieben wurden, sind in der Kopie nicht enthalten. Die ursprüngliche
Datenbank bleibt als Rückkehroption erhalten und wird weiterhin für den Speicherplatz berechnet; ein Zurückwechseln,
das Löschen oder eine zweite Wiederherstellung erfolgt über den Support. Nur ein Eigentümer oder Administrator
kann bereitstellen, umschalten oder verwerfen, und die Konsole fragt vor dem Umschalten nach dem Namen des Projekts.

## Konto absichern

Ihr Konsolenkonto hat Zugriff auf Produktionsdatenbanken, Secrets und die Abrechnung;
schützen Sie es entsprechend. Öffnen Sie **Account security** über das Menü unter Ihrem Avatar
in der Konsole (oder navigieren Sie zu `/account`). Diese Seite gehört Ihnen persönlich, nicht einer
Organisation: Einstellungen, die Sie dort vornehmen, gelten für jede Organisation, der Sie angehören.

- **Zweistufige Verifizierung (2FA).** Aktivieren Sie diese mit einer beliebigen Authentifikator-App (1Password,
  Google Authenticator, Authy). Die Seite zeigt einen Einrichtungsschlüssel zum manuellen Hinzufügen oder einen
  Link, der die App auf dem Smartphone mit bereits ausgefülltem Schlüssel öffnet, und fragt anschließend nach dem
  6-stelligen Code aus der App. Ab diesem Zeitpunkt erfordert jede Anmeldung einen Code,
  egal ob Sie sich mit Passwort, Google oder GitHub anmelden.
- **Wiederherstellungscodes.** Bei der Aktivierung erhalten Sie zehn einmalig nutzbare Codes, die nur einmal angezeigt werden.
  Jeder davon ermöglicht Ihnen die Anmeldung anstelle des Authentifikator-Codes, falls Sie Ihr
  Smartphone verlieren; speichern Sie diese daher, bevor Sie den Dialog schließen. **New recovery codes**
  ersetzt diese, und die alten Codes verlieren ihre Gültigkeit. Das Deaktivieren der zweistufigen Verifizierung
  sowie das Generieren neuer Codes erfordern jeweils vorab die Eingabe eines Codes.
- **Passwort.** Eine Änderung meldet Sie auf allen anderen Geräten ab. Ein über
  Google, GitHub oder LinkedIn erstelltes Konto hat kein Passwort; die Seite bietet an,
  Ihnen einen Link zum Festlegen eines Passworts per E-Mail zu senden.
- **Angemeldete Geräte.** Jeder Browser und jedes Terminal, das bei Ihrem Konto angemeldet ist,
  mit IP-Adresse und Anmeldezeitpunkt. Melden Sie unbekannte Geräte ab, oder alle
  Geräte auf einmal.

[Zugriffstoken](/docs/deployment/cloud-agents/#ci-and-agents) sind keine Sitzungen und erfordern keinen zweiten
Faktor, sodass CI-Pipelines nach der Aktivierung weiterhin deployen können. Widerrufen Sie Tokens, denen Sie nicht mehr
vertrauen, unter **Settings → Access tokens**.

## Team einladen

Über **Members → Add member** fügen Sie Personen hinzu, die bereits über ein Rebase-Konto mit
verifizierter E-Mail-Adresse verfügen, entweder als Administrator oder als Mitglied; ein Eigentümer kann sie
nachträglich zum Eigentümer ernennen. Sie erhalten sofort Zugriff, es wird keine E-Mail versendet. Rebase Cloud
versendet derzeit noch keine Einladungen; bitten Sie Teammitglieder ohne Konto daher, sich zuerst zu registrieren
und ihre Adresse zu bestätigen. Über das Terminal:
[`rebase cloud orgs members invite <email>`](/docs/cli/cloud/#organizations), was
darauf hinweist, falls für die Adresse kein Konto existiert.

## Cloud-Zugriff und die Benutzer Ihrer App

Es sind zwei voneinander getrennte Personenkreise beteiligt, ähnlich wie bei Firebase und Supabase:

- **Cloud-Zugriff** bestimmt, wer im Rebase Cloud-Projekt arbeiten kann. Die Eigentümer
  und Administratoren einer Organisation sind `admin` in jedem Projekt, das sie besitzt, und
  deren Mitglieder sind `developer`. Ein Projekt kann einer Person über eine E-Mail-Einladung auch eine
  eigene Rolle zuweisen (`admin`, `developer` oder `viewer`), ohne
  sie zum Mitglied der Organisation zu machen. Es gilt jeweils die höhere Berechtigung.
  [`rebase cloud access`](/docs/cli/cloud/#project-access) verwaltet dies.
- **Die Benutzer Ihrer App** befinden sich in der eigenen Datenbank der App, mit deren eigenem Registrierungsprozess
  und Rollen. Cloud listet oder bearbeitet diese niemals.

Die einzige Schnittstelle ist **Open admin panel**. Dies meldet eine Person mit `admin`-Cloud-Zugriff
im Admin-Panel der App an, abgeglichen über deren verifizierte E-Mail-Adresse: Die App
findet oder erstellt das Konto mit dieser Adresse, weist ihm die Rolle `admin` zu
und vermerkt, dass die Rolle von Rebase Cloud stammt (in Studio unter Users & roles
entsprechend markiert). Verliert diese Person den `admin`-Cloud-Zugriff auf das Projekt, fordert Rebase
Cloud die App auf, diese `admin`-Berechtigung
wieder zu entziehen, und beendet deren Sitzungen in der App. Eine manuell in der App vergebene Rolle,
einschließlich eines `admin`-Status vor dem ersten Klick auf „Open admin panel“, bleibt bestehen, und das
Konto wird niemals gelöscht.

## Nachvollziehen, wer was getan hat

Die Seite **Activity** der Konsole und `rebase cloud activity` zeigen den
Eigentümern und Administratoren der Organisation, wer bereitgestellt, eine Umgebungsvariable gesetzt oder aufgedeckt hat
(nach Name, niemals nach Wert), eine Domain geändert, ein Backup wiederhergestellt,
ein Projekt skaliert, gestoppt oder gelöscht, die Rolle eines Mitglieds geändert oder ein
Token erstellt hat – und wann dies geschah. Die **Settings** eines Projekts verlinken auf dessen eigene Einträge; ein Eintrag
zu einem gelöschten Projekt bleibt erhalten. Ein Skript kann dies mit einem Token auslesen, das mit
`--can audit` für die Organisation erstellt wurde. Einträge werden ein Jahr lang aufbewahrt. Die Filter sind dokumentiert unter
[`rebase cloud`](/docs/cli/cloud/#organizations).

## CI und Agents

Ein CI-Job oder ein Agent sollte nicht Ihr Passwort verwenden. Weisen Sie ihm ein Token zu, das auf
wenige Aktionen für ein einzelnes Projekt beschränkt ist, erstellt über ein angemeldetes Terminal mit
`rebase cloud tokens create --project shop --can deploy,logs`, und setzen Sie es als
`REBASE_TOKEN`. Die Abrechnung, das Aktivitätsprotokoll und die Benachrichtigungseinstellungen
einer Organisation sind eigene Berechtigungen (`--can billing`, `audit`,
`notifications`), die ein Token nur auf explizite Anforderung erhält. Die Berechtigungen, ein
GitHub Actions-Workflow und Details dazu, was an eine angemeldete Person gebunden bleibt, finden Sie unter
[CI und Agents](/docs/deployment/cloud-agents/#ci-and-agents).

## Ein Backend ohne Konto

`rebase cloud init --claim` stellt einer App ein Live-Backend bereit, noch bevor sich jemand
registriert hat, und gibt eine Claim-URL aus, über die die Person das Projekt übernehmen kann; ein Projekt, das innerhalb
von 72 Stunden niemand übernimmt, wird gelöscht. Was das Token des nicht übernommenen Projekts darf, das
`REBASE_API_TOKEN`, das es schreibt, und was sich durch die Übernahme ändert, ist beschrieben unter
[Ein Backend ohne Konto](/docs/deployment/cloud-agents/#a-backend-with-no-account).

## Compute-Ressourcen und deren Kosten

Die Abrechnung eines Projekts basiert auf den reservierten Ressourcen, nicht auf Tarifstufen. `compute` gibt
jeden Schieberegler und den detaillierten Kostenvoranschlag der Control Plane dafür aus. (`rebase cloud
resources` ist etwas anderes: die Datenbanken und Buckets, die der Code deklariert,
und ob diese jeweils bereitgestellt sind – siehe die [CLI-Referenz](/docs/cli/cloud/)).

```bash
rebase cloud compute
rebase cloud compute set --cpu 500m --memory 2Gi
```

| Parameter | Einheit und Bedeutung |
|---|---|
| `--cpu`, `--memory` | App-Ressourcenanforderung (Request) pro Instanz, z. B. `500m` und `2Gi`. Leer bedeutet Plattform-Standard, der von der Region abhängt (siehe unten) |
| `--replicas` | Dauerhaft vorhandene Instanzen: das Minimum des Autoscalers und der Betrag, den das Abonnement des Projekts monatlich abrechnet |
| `--autoscale-max` | 1–16. Die Obergrenze, die erreicht werden darf. Instanzen, die der Autoscaler über `--replicas` hinaus hinzufügt, werden sekundengenau pro Pod zu denselben Tarifen abgerechnet und nur dort berechnet, wo die Plattform dies aktiviert hat; **Usage this month** gibt Aufschluss darüber. `--no-autoscale` deaktiviert dies |
| `--autoscale-cpu-target` | 10–95. Die CPU-Auslastung, die der Autoscaler anstrebt, bezogen auf den Request, nicht auf das Limit. Leer bedeutet 70 |
| `--spot` | `true` oder `false`. Preemptible Kapazität: günstiger, wird jedoch ohne Vorankündigung neu gestartet |
| `--db-instances` | 1–3. `1` ist eine Einzelinstanz ohne Failover; `2` fügt eine automatische Standby-Instanz hinzu |
| `--db-cpu`, `--db-memory` | Pro Datenbankinstanz. Leer bedeutet `160m` und `1Gi` |

Ein leerer Parameter ist nicht dasselbe wie ein auf denselben Wert fixierter Parameter: Ein leerer Wert
folgt dem Standard der Plattform und ändert sich mit diesem.

In Belgien (europe-west1) reserviert der Standard 100m CPU und 384Mi und kann kurzzeitig
auf 2 CPU und 2 GiB ansteigen (Burst); in Falkenstein und Helsinki kann der Speicher auf das 1,4-Fache des
Requests und die CPU auf das 10-Fache steigen (maximal 1,7 vCPU). `rebase cloud compute` zeigt die
Werte Ihres Projekts an.

Die CLI führt bewusst keine Validierung durch – die Grenzwerte hängen vom Cluster ab, auf dem
ein Projekt läuft, und unterscheiden sich je nach Anbieter. Die Control Plane lehnt Werte ab,
die sie nicht bedienen kann, und nennt das entsprechende Feld. Führen Sie `rebase cloud compute` aus,
um den Betrag in €/Monat vorher und nachher zu sehen; eine Änderung wird sofort wirksam, anteilig ab heute berechnet.
Eine Datenbankänderung wird sofort angewendet; abgerechnet wird die bisherige Größe, bis die neue aktiv ist.
Eine neue CPU- oder Arbeitsspeicher-Konfiguration für die Datenbank oder eine Reduzierung der Instanzen startet die Datenbank neu
(ca. 30 Sekunden bis 3 Minuten; Verbindungen werden getrennt und neu aufgebaut): `compute set`
weist darauf hin und fragt nach Bestätigung; außerhalb eines Terminals dient `--yes` als Zustimmung. Schlägt dieser
Neustart fehl, unternimmt `rebase cloud compute apply` einen erneuten Versuch.

## Die weiteren Befehle

| Befehlsgruppe | Funktionsumfang |
|---|---|
| `login`, `logout`, `whoami`, `access-token` | Ihre Sitzung; `access-token` gibt das Bearer-Token aus, das die CLI aktuell senden würde, für Skripte und den MCP-Server |
| `tokens` | Tokens für CI und Agents, jeweils auf ein einzelnes Projekt beschränkt. Siehe [CI und Agents](/docs/deployment/cloud-agents/#ci-and-agents) |
| `link`, `unlink`, `use`, `open` | Verknüpfen dieses Verzeichnisses mit einem Projekt, Auswählen einer Organisation, Öffnen der Konsole |
| `connect` | Hinzufügen eines selbst gehosteten Rebase-Servers zu Ihrem Konto, damit der [Rebase-Connector](/docs/ai/rebase-connector/#add-your-self-hosted-instances) in Claude diesen neben Ihren Cloud-Projekten erreicht. `--list` zeigt sie an, `--remove` entfernt einen. Für Eigentümer und Admins |
| `init`, `claim` | Mit `--claim`: ein Live-Backend ohne Konto und ein Link zu dessen Übernahme; `claim` gibt diesen Link erneut aus. Siehe [Ein Backend ohne Konto](/docs/deployment/cloud-agents/#a-backend-with-no-account) |
| `projects` | Erstellen, auflisten, inspizieren, löschen |
| `deploy`, `logs`, `deployments`, `rollback`, `cancel` | Bereitstellen und überwachen |
| `deploy-hooks` | Geheime URLs, die ein Git-Host oder CI aufruft, um das Projekt zu deployen: auflisten, erstellen (die URL wird nur einmal angezeigt), widerrufen. |
| `previews` | Durch `deploy --preview` unter einer eigenen Adresse bereitgestellte Builds und deren Löschung. Siehe [Eine Änderung als Vorschau testen (Preview)](#eine-änderung-als-vorschau-testen-preview) |
| `sleep` | Ruhemodus bei Inaktivität: `on [--after 15m\|30m\|1h\|4h]`, `off`, `wake` und `status` (Standard). Im Ruhezustand belegt ein Projekt weder CPU noch RAM, und die nächste Anfrage weckt es auf; geplante Jobs und Hintergrundaufgaben laufen währenddessen nicht. Kann ein Projekt nicht schlafen, lehnt die Control Plane dies mit Begründung ab |
| `start`, `stop`, `restart` | Pausieren eines Projekts und Wiederinbetriebnahme. Ein gestopptes Projekt behält sein Abonnement und zahlt nur den Speicherplatz oder das monatliche Minimum, wenn der Speicherplatz weniger kostet; die Zeile **Billing** in der Konsole gibt die Kosten an |
| `status`, `metrics`, `debug` | Was das Projekt tut und warum es eventuell nicht läuft |
| `alerts` | Offene Vorfälle des Projekts sowie deren Bestätigung oder Stummschaltung. |
| `cron` | Die Cron-Jobs der deployten App und deren protokollierte Ausführungen, ausgelesen mit Ihrem `rebase cloud`-Login. Schreibgeschützt |
| `env` | Umgebungsvariablen. `list` gibt niemals Werte aus; `--secret` ist nur schreibend |
| `app-key` | Der Schlüssel, den `init --claim` als `REBASE_API_TOKEN` in `.env` geschrieben hat und der bei der Übernahme übergeben wurde; `rotate` ersetzt ihn und widerruft den alten. Für Eigentümer und Admins |
| `service-key` | `REBASE_SERVICE_KEY`, Administratorzugriff auf die eigene API der App: wann er zuletzt rotiert wurde; `rotate` weist der App einen neuen zu. Für Eigentümer und Admins |
| `domains` | Eigene Domains, die hinzuzufügenden DNS-Einträge und Verifizierung. Ein Projekt kann unter mehreren Domains antworten, die jeweils separat verifiziert werden; `verify` und `remove` nehmen die gewünschte Domain entgegen, die nur weggelassen werden kann, wenn es genau eine gibt (bei `verify` eine noch ausstehende). Jede verifizierte Domain stellt das Projekt als eigenständigen Ursprung bereit; `primary <domain>` wählt die kanonische Domain aus und `redirect <domain>` leitet eine andere mit einem 308-Statuscode darauf um, wobei Pfad und Query erhalten bleiben (`--off` liefert sie wieder direkt aus) – richten Sie dies für `www.` neben einer Apex-Domain ein, da Google-Logins, Cookies und Passkeys an den Origin gebunden sind. Eine Domain, auf der eine bestimmte App bereitgestellt wird (ein App-`path` mit Hostname), leitet niemals weiter. Eine Apex-Domain (`example.com`, ohne Subdomain) erfordert einen **A**-Record, da DNS dort keinen CNAME erlaubt. Diese Adresse ist der Ingress der Plattform und bleibt nicht garantiert immer identisch: Zieht die Plattform um, zeigt ein A-Record weiterhin auf die alte Adresse. Bietet Ihr DNS-Host ALIAS, ANAME oder CNAME-Flattening an der Apex-Domain, verweisen Sie stattdessen auf den `tenantHost` des Projekts, der der Plattform folgt. Der CNAME einer Subdomain folgt ihr ohnehin. `list` meldet `verified, certificate pending`, bis HTTPS mit einem echten Zertifikat antwortet. `list --json` gibt `{ projectId, tenantHost, domains: [...] }` zurück |
| `db` | Datenbank anbinden oder erstellen, Verbindung vom lokalen Rechner herstellen, Backups, Wiederherstellung und Point-in-Time-Recovery |
| `guests` | Die Gastbenutzer, die durch anonyme Anmeldungen entstanden sind: Anzahl ermitteln, einzelne löschen, lange inaktive bereinigen. Siehe [Gäste](/docs/cli/cloud/#guests). Für Eigentümer und Admins |
| `extensions` | Die Postgres-Erweiterungs-Allowlist |
| `storage` | Die Buckets des Projekts und deren Schlüssel auf [Rebase Storage](/docs/deployment/rebase-storage/) |
| `resources` | Welche Datenbanken und Buckets die Plattform vorhält, verglichen mit den Deklarationen im Code |
| `compute` | Was dieses Projekt reserviert, was es kostet und wie man es anpasst |
| `events` | Was im Backend passiert ist, neueste zuerst: Skalierung der App, geplante und durchgeführte Datenbankänderungen, Übernahme durch eine Standby-Instanz, Vergrößerung der Festplatte |
| `usage` | Diesen Monat verbrauchte Anfragen im Vergleich zum Freikontingent und der bisherige Mehrverbrauch gemäß Rechnungszählung. `usage org` listet jedes Projekt der Organisation auf |
| `clusters` | Die Cluster, auf denen die Mandanten laufen. Nur für Plattform-Administratoren |
| `settings`, `orgs`, `access`, `billing` | Projekteinstellungen, Organisationen samt Mitgliedern und Einladungen, Zugriffsberechtigungen für ein Projekt, Abrechnung |
| `activity` | Das Audit-Log der Organisation: wer bereitgestellt hat, Umgebungsvariablen geändert hat (nach Name), Domains, Backups, Mitglieder oder Tokens geändert hat. Für Eigentümer und Admins. Siehe [Nachvollziehen, wer was getan hat](#nachvollziehen-wer-was-getan-hat) |
| `notifications` | Wohin die Ereignisse des Projekts per POST gesendet werden: Slack, Discord oder eine beliebige HTTPS-URL ([Cloud-Benachrichtigungen](/docs/deployment/cloud-notifications/)) |

Jede Gruppe in dieser Tabelle beantwortet `--help` mit einer eigenen Hilfeseite – einer Verwendungszeile,
ihren Flags und Beispielen – und `--help` führt den Befehl niemals aus. Ein automatisierter Test prüft den
Index dieser Seiten; eine neu hinzugefügte Gruppe ohne Hilfeseite lässt daher den Build fehlschlagen,
anstatt das Inhaltsverzeichnis auszugeben. `verify:docs` gleicht die Tabelle selbst mit
diesem Index ab: Jede Gruppe, die die CLI bereitstellt, erscheint hier genau einmal, sodass eine Gruppe,
die ohne entsprechende Zeile hinzugefügt wurde, den Build ebenfalls fehlschlagen lässt.

Wird der Befehl über eine Pipe weitergeleitet, antwortet `--help` stattdessen mit JSON: dieselbe Verwendungszeile,
Flags und Beispiele als strukturierte Daten, anstatt sechzig Zeilen Terminal-Escape-Sequenzen.

## Was die Beta noch nicht enthält

Keine freie Regionswahl, keine Self-Service-Registrierung, kein veröffentlichtes SLA, keine Branch-Deployments,
Tokens, die im Namen einer Person handeln, und kein öffentlicher Datenbank-Endpunkt. [Was die Beta
nicht enthält](/docs/deployment/cloud-beta-limits/) führt jeden dieser Punkte verständlich auf,
zusammen mit den Auswirkungen eines Deployments mit Produktions-Secrets.

## Stattdessen selbst hosten

Nichts hier bedeutet einen Lock-in. Der [Leitfaden zum Self-Hosting](/docs/deployment/self-hosting/)
führt das identische Image und Bundle mit `docker compose` aus, und die
[Kubernetes-Anleitung](/docs/deployment/kubernetes/) bildet dieselbe Topologie über
das Helm-Chart ab.
