---
sourceHash: 073c10d60856c91c
title: Rebase Cloud
sidebar_label: Rebase Cloud
description: Rebase Cloud ist das gleiche Rebase, für Sie betrieben. Was es ist, wie ein Projekt verknüpft und bereitgestellt wird und was die Private Beta noch nicht enthält.
---

Rebase Cloud führt dasselbe Open-Source-Rebase aus, das Sie auch selbst hosten würden – dasselbe
veröffentlichte `rebasepro/server`-Image, dasselbe Bundle, dasselbe Postgres. Der
Unterschied liegt darin, wer es betreibt.

:::note[Private Beta]
Rebase Cloud befindet sich in der **Private Beta**. Es betreibt bereits echte Mandanten und wird in
Schüben geöffnet. [Zugang anfragen](https://rebase.pro/pricing).

Es handelt sich nicht um Self-Service; die folgenden Befehle erfordern daher ein Konto, das
bereits freigeschaltet wurde. Alles andere auf dieser Website funktioniert auch ohne Konto.
:::

## Was es ist

Ein Cloud-**Projekt** besteht aus drei Komponenten, die die Plattform für Sie betreibt:

| | Was Sie erhalten |
|---|---|
| **App** | Ihr Bundle, das auf dem veröffentlichten Runtime-Image läuft. Deployments sind Bundle-Uploads, keine Container-Builds |
| **Datenbank** | Ein verwaltetes PostgreSQL mit automatisierten Backups und Point-in-Time-Recovery |
| **Storage** | Ein eigener Bucket, falls Ihr Projekt Dateispeicher verwendet |

Jede Komponente wird beim ersten Deployment bereitgestellt und nach der reservierten
Kapazität abgerechnet, nicht pro Arbeitsplatz (Seat).

**An Ihrem Projekt ändert sich nichts, um dort zu laufen.** Dasselbe Repository
kann mit `docker compose` selbst gehostet werden, und der Notausstieg ist real: `rebase build`
erzeugt ein Bundle, das überall dort startet, wo das Runtime-Image ausgeführt werden kann.

## Ein Projekt verknüpfen

Aus einem Projektverzeichnis:

```bash
rebase cloud login
rebase cloud billing setup
rebase cloud projects create --name "My app" --subdomain my-app --link
```

`login` öffnet die Konsole im Browser und gibt einen kurzen Code aus. Vergewissern Sie sich, dass
die Konsole denselben Code anzeigt, und bestätigen Sie die Anmeldung dort: Das Terminal
übernimmt die Sitzung und speichert sie in `~/.rebase/credentials.json`. Falls Sie nicht in
der Konsole angemeldet sind, melden Sie sich dort zuerst mit Ihrem bevorzugten Dienst an,
einschließlich Google und GitHub. Über SSH gibt `rebase cloud login --no-browser` den Link
aus, den Sie auf Ihrem eigenen Rechner öffnen können.

`projects create` akzeptiert keine Positionsargumente. Der Name und die Subdomain sind
Flags, und beide sind erforderlich – im Terminal werden sie abgefragt, und ein
Headless-Durchlauf, bei dem eines davon fehlt, wird mit `input_required` beendet, anstatt
eines zu erfinden. **Die Subdomain kann nachträglich nicht mehr geändert werden:** Es ist der
Host `<slug>.rebase.website`, unter dem das Projekt erreichbar ist, wählen Sie ihn also mit Bedacht.

`--link` verknüpft dieses Verzeichnis im selben Aufruf mit dem Projekt, sodass kein
separater `link`-Schritt erforderlich ist. Es erstellt `.rebase/cloud.json`, worin Projekt-ID
und Slug gespeichert sind. Diese Datei ist kein Geheimnis und enthält keine Zugangsdaten – diese
liegen in `~/.rebase/credentials.json`, erstellt durch `login`.

Die Datei wird jedoch mit dem Code committet, sodass ein geklontes Repository jede beliebige
Control-Plane angeben kann. Wenn der Host ausschließlich aus dieser Datei stammt und es sich weder
um den plattformweiten Standard noch um einen Host handelt, bei dem Sie sich zuvor angemeldet haben,
nennt `login` diesen und fragt nach, bevor Ihre E-Mail-Adresse und Ihr Passwort dorthin gesendet werden.
Ohne Terminal oder mit `--json` bricht der Befehl mit `unknown_control_plane` ab; übergeben Sie
`--url <host>` (oder setzen Sie `REBASE_CLOUD_URL`), um sich gezielt dort anzumelden.

Um sich ohne Browser anzumelden, übergeben Sie Ihre E-Mail: `rebase cloud login --email
me@example.com` fragt nach Ihrem Passwort. **Haben Sie sich über Google, GitHub oder
LinkedIn registriert?** Ihr Konto besitzt kein Passwort, verwenden Sie daher stattdessen einen Code:

```bash
rebase cloud login --code --email me@example.com
```

Die Control-Plane sendet Ihnen per E-Mail einen 6-stelligen Code, der zehn Minuten lang gültig ist,
und Sie geben ihn bei der Eingabeaufforderung ein. Bei Verwendung von `--email` ohne Passwort fragt
`rebase cloud login`, ob Sie Ihr Passwort oder einen Code verwenden möchten. Codes setzen voraus,
dass die Control-Plane E-Mails versenden kann; ist dies nicht der Fall, meldet `--code` dies und
bricht mit `otp_unavailable` ab.

Wenn Sie die Zwei-Faktor-Authentifizierung aktiviert haben, fragt `login` anschließend nach dem Code
aus Ihrer Authentifikator-App oder einem Ihrer Wiederherstellungscodes, unabhängig von der gewählten
Anmeldemethode. Im Browser fragt die Konsole bei der Anmeldung danach. Weder ein Anmeldecode noch
ein zweiter Faktor können ohne Terminal eingegeben werden. Erstellen Sie für Skripte ein
Zugriffstoken in der Konsole (**Settings → Access tokens**) und setzen Sie `REBASE_TOKEN`; siehe
[CI und Agents](/docs/deployment/cloud-agents/#ci-and-agents).

Ein falsches Passwort liefert `invalid_credentials` mit denselben beiden Zugangsmöglichkeiten, da
die häufigste Ursache ein Konto ist, das nie ein Passwort besessen hat.

`billing setup` hinterlegt einmalig eine Zahlungskarte für die Organisation. Es steht absichtlich
an erster Stelle der Abfolge: Das erste Deployment eines Projekts wird ohne hinterlegte Karte
abgelehnt, und dies erst nach Abschluss des Bundle-Uploads festzustellen, ist die schlechtere Reihenfolge.

Danach listet die **Billing**-Seite der Konsole die Rechnungen der Organisation auf – jeweils mit
Stripes gehosteter Seite und PDF – und zeigt eine Vorschau auf die nächste Rechnung für jedes
Projekt. `rebase cloud billing invoices` und `rebase cloud billing upcoming` geben dasselbe aus.
Beide sind für Inhaber und Admins der Organisation gedacht. Sofern von der Plattform angeboten,
öffnet **Manage billing** das Stripe-Kundenportal zur Verwaltung von Karte, Rechnungsdaten und
bisherigen Rechnungen.

Ist bereits eine Karte hinterlegt, ist beim Erstellen eines weiteren Projekts in der Konsole keine
zweite Zahlung erforderlich: Das Projekt wird über diese Karte abgerechnet und bereitgestellt. Wird
die Karte abgelehnt oder verlangt die Bank eine Zahlungsbestätigung, leitet Sie die Konsole zu
**Billing** weiter, wo Sie unter **Fix your card** eine andere Karte speichern und über
**Complete the payment** die Stripe-Rechnung aufrufen können.

Die bisherige Nutzung eines Projekts wird in dessen Übersicht unter **Usage this month** angezeigt
und auf der Seite **Billing** für alle Projekte gleichzeitig aufgeführt: Anfragen im Vergleich zum
enthaltenen Freikontingent (der Balken färbt sich ab 80 % gelb), 5xx-Fehler, die bisherigen
Mehrkosten (Overage) und wie sich der Monat bei gleichbleibender Nutzung entwickelt. Die Mehrkosten
werden von demselben Code berechnet, der sie an Stripe meldet; sie entsprechen somit dem späteren
Rechnungsbetrag und erscheinen auf der Rechnung des Folgemonats. `rebase cloud usage` gibt dasselbe
aus, und `rebase cloud usage org` für die gesamte Organisation. Jedes Mitglied kann dies einsehen.
Die Zahlen spiegeln wider, was derzeit noch nicht erfasst wird: Objektspeicher wird nicht gemessen,
daher fallen keine Speicher-Mehrkosten an; läuft ein Projekt mit zwei oder mehr App-Pods, werden
dessen Anfragen nicht gezählt; und ein Tag mit ausgefallenen Messungen führt zu Untererfassungen.
Ein automatisch skaliertes Projekt zeigt auch die Pods an, die oberhalb von `--replicas` liefen,
in Pod-Stunden, die Kosten gemäß den eigenen Tarifen und ob diese Plattform sie bereits abrechnet.
Ein von einem Agenten übernommenes (claimed) Projekt zählt erst ab dem Tag der Übernahme: Davor
gehörte das Projekt der Plattform.

Ein bestehendes Projekt kann verknüpft werden, ohne ein neues zu erstellen:

```bash
rebase cloud projects list
rebase cloud link --project my-app
```

## Bereitstellen (Deploy)

```bash
rebase cloud deploy
```

Ein einziger Befehl, und kein Flag, das man sich merken müsste. Die `rebase.json` eines Scaffolds
deklariert `runtime: "managed"` für das Backend, und `deploy` liest diese Deklaration – dies wird
während des Vorgangs bestätigt (`rebase.json declares runtime: managed — deploying a bundle`),
baut die App in `dist-bundle`, lädt das Bundle hoch, führt es auf dem veröffentlichten Runtime-Image
aus und verfolgt das Deployment bis zum finalen Status. Der Exit-Code ist das Ergebnis, sodass
dieselbe Zeile unbeaufsichtigt in CI funktioniert.

Am Ende wird ausgegeben, wo jede App nun erreichbar ist und ob die neue Version dort live ist:

```text
  ✓ Deployed songbuzz in 1m 12s  (deployment fb3c7442-9937-4179-8d3c-88a106da149d)

    game     static   https://songbuzz.rebase.website      live
    backend  backend  https://songbuzz.rebase.website/api  live

  ✓ Live: the new version answers on every address above.
  Something wrong? `rebase cloud rollback` puts the previous deployment back.
```

"Live" bedeutet, dass die Adresse nach dem Build geantwortet hat: Das `/health` eines Backends
hat `ok` zurückgegeben, und die Seite einer statischen App wurde geladen (aus diesem Deployment,
sobald die Plattform sie ausliefert). Die Prüfung wartet bis zu `--live-timeout` Sekunden,
standardmäßig 60; `0` überspringt sie. Antwortet eine App nicht rechtzeitig, endet der
Deploy-Befehl dennoch mit Exit-Code 0, da das Deployment erfolgreich war; die letzte Zeile gibt
an, welche App nicht geantwortet hat und warum. Ein fehlgeschlagenes Deployment endet stattdessen
in einer einzelnen Zeile mit Nennung von App und Ursache; mit `rebase cloud logs` kann das
vollständige Build-Protokoll eingesehen werden.

Skripte übergeben `--json`, um ein einzelnes Objekt mit denselben Daten zu erhalten – `apps`,
`hosts`, `live`, `liveChecks`, `durationMs` und die Deployment-ID. Im Gegensatz zu den anderen
Befehlen von `rebase cloud` schaltet `deploy` bei einer Pipe nicht automatisch auf JSON um.

Welche Möglichkeiten diese Runtime bietet – Pakete und native Module, Speicher und Instanzen,
Timeouts und Body-Größen, das Dateisystem, Secrets, Storage und ausgehender Netzwerkverkehr – wird
auf einer eigenen Seite beschrieben:
[Verwaltete Backend-Runtime](/docs/deployment/managed-runtime/).

Um ein zuvor erstelltes Artefakt auszuliefern – beispielsweise in einem CI-Job, der einmal baut
und zweimal deployt –, verweisen Sie auf das Verzeichnis, anstatt neu zu bauen:

```bash
rebase build
rebase cloud deploy --bundle-dir dist-bundle
```

Das Verlassen der verwalteten Runtime erfordert ein eigenes Flag, `--eject`, und wird durch nichts
anderes ausgelöst: Ein Build, der ein verwaltetes Projekt auf ein Container-Image umstellen würde,
das es anschließend selbst verwaltet, wird abgelehnt, solange Sie dies nicht ausdrücklich anweisen.
Früher bedeutete `--force` diesen Schritt, wodurch die am schwersten umkehrbare Aktion der CLI
demselben Wort wie "diese Datei überschreiben" zugeordnet war; dies ist nun eine unbekannte Option
statt eines Alias, sodass ein Skript, das sie verwendet, stattdessen stoppt.

### Die Syntaxprüfung vor dem Upload

Dateien einer statischen App werden exakt so ausgeliefert, wie sie sind. Wenn deren `build`
lediglich handgeschriebene Skripte in `output` kopiert, wurden sie von keinem Parser geprüft,
sodass eine Datei mit einem Tippfehler live geht und das Laden der Seite verhindert. Daher parst
`deploy` vor jedem Upload jede `.js`-, `.mjs`- und `.cjs`-Datei im `output` jeder statischen App
sowie jedes Inline-`<script>` in den `.html`-Dateien. Dies gilt sowohl für eigenständig
bereitgestellte statische Apps als auch für statische Apps, die in das Backend-Bundle integriert
sind. Ein Syntaxfehler stoppt das Deployment unter Angabe von Datei, Zeile und Spalte:

```
✗ A syntax error in the static output, so nothing was deployed:
    web/cloud.js:42:23  Unexpected token
        42 |     return fetch("/api";
Fix it and deploy again, or pass --no-verify to deploy anyway.
```

Bei `--json` lautet der Fehler-`code` `syntax_error`. Inline-Skripte, die ein Browser nicht als
JavaScript ausführt, werden übersprungen: JSON, Import Maps, Templates und alle anderen
Nicht-JavaScript-`type`s, ein `<script src>` sowie ein Skript, das noch ungerenderte Template-Syntax
wie `{{ }}` enthält. Eine `.js`-Datei besteht die Prüfung, wenn sie sich entweder als klassisches
Skript oder als Modul parsen lässt, da die Seite darüber entscheidet. Unter `node_modules` wird
nichts gelesen, ebenso wenig bei einem vorgefertigten `--bundle-dir`. `--no-verify` überspringt
die Prüfung für ein einzelnes Deployment.

Überwachung:

```bash
rebase cloud logs               # das Build-Protokoll
rebase cloud logs --runtime -f  # Live-Ausgabe der laufenden App bis Strg-C
rebase cloud status             # Status des Projekts laut Plattform
```

`status` gibt `blockedOn` und `nextAction` aus. Wenn `blockedOn` den Wert `null` hat, arbeitet
die Plattform wie vorgesehen und Polling ist der richtige Weg; wird dort etwas genannt, wartet
dieser Punkt auf eine Aktion Ihrerseits.

Ein mögliches Problem ist `email_not_configured`: Die App hat die Anmeldung per Magic-Link oder
E-Mail-Code aktiviert (`AUTH_MAGIC_LINK`, `AUTH_EMAIL_OTP`), verfügt aber über keinen E-Mail-Dienst.
Das Deployment ist somit zwar live, aber niemand kann sich anmelden. Rebase Cloud versendet keine
E-Mails für Ihre App: Setzen Sie `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` und `SMTP_FROM`
mit `rebase cloud env set` und führen Sie anschließend das Deployment durch. `status` liest dies
über das app-eigene `GET /api/auth/config` (Feld `unavailable`) aus, und `deploy` weist im Rahmen
seines Live-Checks ebenfalls darauf hin.

## Vorschau einer Änderung (Preview)

```bash
rebase cloud deploy --preview
```

Dies baut und lädt exakt das hoch, was auch `deploy` verarbeiten würde, liefert es jedoch unter
einer eigenen Adresse aus, wie etwa `https://shop--k3x9ab.rebase.website`. Die Produktionsumgebung
liefert weiterhin den vorherigen Stand aus. Nach Abschluss des Builds gibt das Deployment die
Adresse der Preview aus.

Um über mehrere Deployments hinweg dieselbe Adresse beizubehalten, vergeben Sie einen Namen für
die Preview. Ein erneutes Deployment unter demselben Namen aktualisiert sie:

```bash
rebase cloud deploy --preview-name new-checkout
```

Womit eine Preview kommuniziert, hängt davon ab, was bereitgestellt wurde:

- **`rebase cloud deploy --preview`** erstellt eine Vorschau des Backends inklusive der integrierten
  statischen Apps, genau wie in der Produktion. Es erhält ein eigenes Backend auf einer **eigenen,
  leeren Datenbank** – niemals auf der Produktionsdatenbank. Ein Start gegen die Produktionsdatenbank
  würde das Schema und die Zugriffsregeln der Preview auf diese anwenden.
- **`rebase cloud deploy web --preview`** würde eine einzelne statische App isoliert in der Vorschau
  zeigen, deren Seiten das **Produktions-Backend** aufrufen. Dies erfordert eine Control-Plane, die
  statische Websites eigenständig ausliefern kann, was Rebase Cloud derzeit noch nicht unterstützt:
  Der Vorgang wird mit `PREVIEW_STATIC_UNSERVED` abgelehnt und es wird nichts veröffentlicht. Erstellen
  Sie stattdessen eine Vorschau des Backends, welches die integrierten statischen Apps bereitstellt; ein
  Projekt ohne verwaltetes Backend kann derzeit nicht in der Vorschau bereitgestellt werden.

Eine Preview lädt keinen Quellcode hoch und registriert keine Apps oder Hostnamen, da jede dieser
Aktionen das Produktionsprojekt verändern würde. `--source` und `--eject` können nicht mit
`--preview` kombiniert werden. Beide erstellen ein Container-Image für die Produktion.

```bash
rebase cloud previews                      # Name, Adresse, App, Backend, Ablaufdatum
rebase cloud logs --preview new-checkout   # Build-Protokoll; -f folgt einem noch laufenden Build
rebase cloud logs --runtime --preview new-checkout -f  # Ausgabe des Preview-Backends
rebase cloud previews delete new-checkout  # beendet die Bereitstellung und löscht die Datenbank
```

`rebase cloud logs` ohne `--preview` bezieht sich immer auf die Produktionsumgebung.

Die Seite **Deployments** der Konsole listet dieselben Previews auf und ermöglicht das Öffnen,
Anzeigen des Build-Protokolls oder Löschen der jeweiligen Preview. Das Erstellen bleibt ein CLI-Schritt.

Eine Preview läuft eine Woche nach dem letzten Deployment ab.

Nach Abschluss prüft das Deployment, ob die Adresse der Preview antwortet, genau wie bei einem
Produktions-Deployment (`--live-timeout <seconds>`, `0` zum Überspringen). Die Ausstellung des
Zertifikats einer neuen Preview kann ein bis zwei Minuten in Anspruch nehmen, sodass ein an sich
erfolgreiches Deployment zunächst melden kann, dass die Adresse noch nicht erreichbar ist.

Eine Backend-Preview wird wie eine App-Einheit in der Standardgröße abgerechnet (100m CPU und
384 MiB RAM, basierend auf dem Tarif Ihrer App für deren Region und Kapazität), anteilig für die
Dauer ihres Bestehens, und erscheint im monatlichen Kostenvoranschlag des Projekts in der Konsole.
`rebase cloud deploy --preview` gibt dieselbe Schätzung pro Monat aus (`cost` unter `--json`).
Das Starten erfordert eine hinterlegte Karte, wie auch ein Produktions-Deployment. Ein erstes
Deployment, das fehlschlägt, bevor irgendetwas ausgeführt wird, wird entfernt statt in Rechnung
gestellt. Ein Projekt darf bis zu drei Backend-Previews gleichzeitig ausführen.

Jede neue Preview-Adresse erhält ein eigenes TLS-Zertifikat von Let's Encrypt. Let's Encrypt erlaubt
einer Domain 50 neue Zertifikate pro Woche, geteilt mit allen Produktionsseiten darauf. Previews
dürfen plattformweit bis zu 20 davon innerhalb von 7 Tagen beanspruchen. Darüber hinaus wird eine
neue Preview abgelehnt (`429`, `preview_cert_budget`) unter Angabe des Zeitpunkts, ab dem sie wieder
bereitgestellt werden kann; das erneute Bereitstellen einer bereits existierenden Preview wird hierbei
nicht mitgezählt.

Die Datenbank einer Backend-Preview ist eine zweite Datenbank auf dem Postgres-Server der
**Produktion**: eigene Daten, aber dieselbe Instanz und derselbe Datenträger. Sie ist auf 10
Verbindungen beschränkt, damit Previews die Ressourcen der Produktion nicht aufbrauchen können,
sowie auf 2 GB: Wächst die Datenbank einer Preview darüber hinaus, wird sie pausiert. Ihr Backend
stoppt, ihre Adresse antwortet nicht mehr, `rebase cloud previews` und die Konsole zeigen sie als
`paused` mit dem entsprechenden Grund an, und die Inhaber und Admins des Projekts werden benachrichtigt
(`preview.paused`). Ihre Daten bleiben bis zum Ablauf erhalten. Führen Sie das Deployment erneut
aus, um sie wieder zu starten (sie wird erneut pausiert, solange die Datenbank noch zu groß ist),
oder löschen Sie sie. Eine pausierte Preview wird bis zu ihrer Löschung oder ihrem Ablauf weiterhin
abgerechnet. Löschen Sie Previews, die Sie nicht mehr benötigen. In der Produktionsdatenbank
installierte Extensions werden in der Preview-Datenbank nicht installiert.

Previews werden schrittweise eingeführt. Eine Control-Plane, die diese noch nicht unterstützt,
lehnt `--preview` mit `previews_unavailable` ab und stellt nichts bereit.

## Rollback

```bash
rebase cloud deployments
rebase cloud rollback
```

Ein Rollback verweist das Projekt wieder auf den Stand eines früheren erfolgreichen Deployments
und baut diesen niemals neu – der Wert eines Rollbacks liegt darin, ein Artefakt auszuliefern,
das bereits erfolgreich gelaufen ist.

Welche Deployments dafür infrage kommen, hängt von der Deployment-Art des Projekts ab; beide
Arten werden unterstützt:

| Art des Deployments | Was wiederhergestellt wird |
|---|---|
| `rebase cloud deploy` (Source-Build) | Das Image, das dieser Build veröffentlicht hat |
| `rebase cloud deploy --bundle` (Plattform-Runtime) | Das Bundle, das dieses Deployment ausgeliefert hat, auf der Runtime-Version, die das Projekt aktuell ausführt |

Statische Apps, die in das Backend-Bundle integriert sind (ein einfaches `rebase cloud deploy`
auf einem Projekt mit Backend), sind Teil dieses Bundles und werden daher gemeinsam mit ihm
zurückgesetzt.

Eine statische App, die isoliert bereitgestellt wurde (`rebase cloud deploy <app>`), kann derzeit
noch nicht per Rollback zurückgesetzt werden. Ihr Deployment zeichnet zwar auf, welche App
veröffentlicht wurde, speichert jedoch kein Bundle, sodass der Control-Plane die Grundlage für
die Wiederherstellung fehlt. Die Lösung besteht darin, die letzte funktionierende Version erneut
bereitzustellen, beispielsweise aus dem Commit vor der fehlerhaften Änderung. Nach einem solchen
Deployment weist `deploy` hierauf hin, anstatt `rollback` zu empfehlen, und ein `rollback` ohne
ID bricht ab, anstatt das derzeit aktive Backend erneut bereitzustellen.

Ein Rollback setzt somit ein Deployment voraus, bei dem eines von beiden aufgezeichnet wurde –
was bedeutet, dass das Projekt mindestens zweimal erfolgreich bereitgestellt worden sein muss.
`rebase cloud deployments` markiert die qualifizierten Versionen, und `--json` gibt pro Zeile
`rollbackable` zusammen mit dem wiederherzustellenden `image` oder `bundle` aus.

Zwei Arten von Deployments werden abgelehnt, was die CLI auch entsprechend meldet: Deployments,
die nicht erfolgreich waren, und solche, die vor Beginn der Artefakt-Aufzeichnung durch die
Plattform stattgefunden haben. In beiden Fällen wird nicht geraten – Raten würde bedeuten,
das zuletzt gebaute oder hochgeladene Artefakt auszuliefern und fälschlicherweise als das
gewählte auszugeben. Stellen Sie stattdessen die gewünschte Version direkt bereit.

Jedes erfolgreiche Deployment schließt mit dem Hinweis auf den Weg zurück (`rebase cloud rollback`),
sodass dieser sofort im Blickfeld ist, falls ein fehlerhafter Release bemerkt wird.

Ein Rollback fügt ein neues Deployment an, anstatt die Historie zurückzuspulen, und wartet,
bis die wiederhergestellte Version Anfragen bedient, bevor der Erfolg gemeldet wird. Sie können
den Ablauf mit `rebase cloud logs -f` verfolgen.

## Datenbank auf einen bestimmten Zeitpunkt wiederherstellen (Point-in-Time-Recovery)

Eine verwaltete Datenbank kann auf jede beliebige Minute innerhalb ihres Wiederherstellungsfensters
zurückgesetzt werden – entweder über **Database → Backups** in der Konsole oder per CLI:
`rebase cloud db pitr status | restore --target <ISO> | cutover | discard`.
Dies geschieht in zwei Schritten. Zunächst wird eine wiederhergestellte Kopie neben der
Live-Datenbank bereitgestellt; Ihre App läuft auf der Live-Datenbank weiter, und der Speicher
der Kopie wird berechnet, bis Sie umschalten (cutover) oder die Kopie verwerfen (discard).
Sobald die Kopie bereit ist, wird die App durch das Umschalten auf die neue Datenbank verwiesen
und neu gestartet. Daten, die nach dem Zielzeitpunkt geschrieben wurden, sind in der Kopie nicht
enthalten. Die ursprüngliche Datenbank bleibt als Rückfallebene erhalten und wird speicherseitig
weiter abgerechnet; das Zurückwechseln, das endgültige Entfernen oder eine zweite Wiederherstellung
erfolgen über den Support. Nur Inhaber oder Admins können Instanzen bereitstellen, umschalten
oder verwerfen, und die Konsole erfordert vor dem Umschalten die Eingabe des Projektnamens.

## Konto absichern

Ihr Konsolenkonto hat Zugriff auf Produktionsdatenbanken, Secrets und die Abrechnung; schützen
Sie es entsprechend. Öffnen Sie **Account security** über das Menü unter Ihrem Avatar in der
Konsole (oder navigieren Sie zu `/account`). Diese Seite gehört Ihnen persönlich, nicht einer
Organisation: Einstellungen, die Sie hier vornehmen, gelten für jede Organisation, der Sie angehören.

- **Zwei-Faktor-Authentifizierung (2FA).** Aktivieren Sie diese mit einer beliebigen
  Authentifikator-App (1Password, Google Authenticator, Authy). Die Seite zeigt einen
  Setup-Schlüssel zum Eintragen in die App oder einen Link, der die App auf dem Smartphone mit
  bereits ausgefülltem Schlüssel öffnet. Anschließend wird der 6-stellige Code abgefragt, den
  die App anzeigt. Ab diesem Zeitpunkt verlangt jede Anmeldung einen Code, unabhängig davon,
  ob Sie sich mit Passwort, Google oder GitHub anmelden.
- **Wiederherstellungscodes.** Bei der Aktivierung erhalten Sie zehn einmalig verwendbare Codes,
  die nur ein einziges Mal angezeigt werden. Jeder Code ermöglicht Ihnen die Anmeldung anstelle des
  Authentifikator-Codes, falls Sie Ihr Telefon verlieren; sichern Sie diese daher, bevor Sie den
  Dialog schließen. **New recovery codes** ersetzt die bestehenden Codes, wodurch die alten ungültig
  werden. Sowohl das Deaktivieren der 2FA als auch das Generieren neuer Codes erfordert zunächst
  die Eingabe eines gültigen Codes.
- **Passwort.** Eine Änderung des Passworts meldet Sie auf allen anderen Geräten ab. Ein über
  Google, GitHub oder LinkedIn erstelltes Konto besitzt kein Passwort; die Seite bietet an, Ihnen
  einen Link zum Setzen eines Passworts per E-Mail zu senden.
- **Angemeldete Geräte.** Zeigt alle Browser und Terminals an, die bei Ihrem Konto angemeldet sind,
  inklusive IP-Adresse und Anmeldezeitpunkt. Melden Sie unbekannte Geräte gezielt oder alle
  Geräte auf einmal ab.

[Zugriffstoken](/docs/deployment/cloud-agents/#ci-and-agents) stellen keine Sitzungen dar und erfordern
keinen zweiten Faktor; CI-Pipelines können daher auch nach Aktivierung der 2FA unterbrechungsfrei
deployen. Widerrufen Sie Token, denen Sie nicht mehr vertrauen, unter **Settings → Access tokens**.

## Team einladen

Unter **Members → Add member** fügen Sie Personen hinzu, die bereits über ein Rebase-Konto mit
bestätigter E-Mail-Adresse verfügen – entweder als Admin oder als Mitglied. Ein Inhaber kann
ihnen nachträglich Inhaberrechte zuweisen. Eingeladene Personen haben sofort Zugriff; es wird
keine E-Mail versendet. Da Rebase Cloud derzeit noch keine Einladungs-E-Mails verschickt, bitten
Sie Teammitglieder ohne Konto, sich vorab zu registrieren und ihre E-Mail-Adresse zu bestätigen.
Im Terminal: [`rebase cloud orgs members invite <email>`](/docs/cli/cloud/#organizations), was
eine entsprechende Meldung ausgibt, falls für die Adresse noch kein Konto existiert.

## Nachvollziehen, wer was getan hat

Die Seite **Activity** der Konsole sowie `rebase cloud activity` zeigen Inhabern und Admins der
Organisation, wer ein Deployment durchgeführt, eine Umgebungsvariable gesetzt oder aufgedeckt
(nach Name, niemals nach Wert), eine Domain geändert, ein Backup wiederhergestellt, die Größe
eines Projekts geändert, ein Projekt gestoppt oder gelöscht, die Rolle eines Mitglieds geändert
oder ein Token erstellt hat – und wann dies geschah. Die **Settings** eines Projekts verlinken
auf dessen spezifische Einträge; Einträge zu gelöschten Projekten bleiben erhalten. Ein Skript
kann diese Daten über ein Token auslesen, das mit `--can audit` für die Organisation erstellt
wurde. Einträge werden ein Jahr lang aufbewahrt. Die Filter finden Sie unter
[`rebase cloud`](/docs/cli/cloud/#organizations).

## CI und Agents

Ein CI-Job oder Agent sollte niemals Ihr persönliches Passwort verwenden. Erteilen Sie stattdessen
ein Token, das auf wenige Aktionen für ein bestimmtes Projekt beschränkt ist. Erstellen Sie es
über ein angemeldetes Terminal mit `rebase cloud tokens create --project shop --can deploy,logs`
und setzen Sie es als `REBASE_TOKEN`. Abrechnung, Aktivitätsprotokoll und Benachrichtigungseinstellungen
einer Organisation sind separate Berechtigungen (`--can billing`, `audit`, `notifications`),
die ein Token nur auf ausdrückliche Anforderung erhält. Die Berechtigungen, ein GitHub-Actions-Workflow
sowie die Abgrenzung zu Rechten angemeldeter Personen werden unter
[CI und Agents](/docs/deployment/cloud-agents/#ci-and-agents) beschrieben.

## Ein Backend ohne Konto

`rebase cloud init --claim` stattet eine App mit einem Live-Backend aus, noch bevor sich jemand
registriert hat, und gibt eine Claim-URL aus, über die das Projekt dauerhaft übernommen werden kann;
ein Projekt, das niemand innerhalb von 72 Stunden übernimmt, wird gelöscht. Welche Aktionen das
Token des nicht übernommenen Projekts ausführen darf, was es als `REBASE_API_TOKEN` schreibt und
was sich durch die Übernahme ändert, ist unter
[Ein Backend ohne Konto](/docs/deployment/cloud-agents/#a-backend-with-no-account) beschrieben.

## Compute und Kosten

Die Abrechnung eines Projekts richtet sich nach den reservierten Ressourcen, nicht nach Tarifen (Tiers).
`compute` gibt alle Stellschrauben und den detaillierten Kostenvoranschlag der Control-Plane dafür aus.
(`rebase cloud resources` dient einem anderen Zweck: Es zeigt die im Code deklarierten Datenbanken und
Buckets und ob diese bereitgestellt sind – siehe die [CLI-Referenz](/docs/cli/cloud/).)

```bash
rebase cloud compute
rebase cloud compute set --cpu 500m --memory 2Gi
```

| Parameter | Einheit und Bedeutung |
|---|---|
| `--cpu`, `--memory` | App-Ressourcenanforderung (Request) pro Instanz, z. B. `500m` und `2Gi`. Leer bedeutet Plattform-Standard – `100m` und `384Mi`, mit Burst-Möglichkeit bis zu 2 CPU und `2Gi` |
| `--replicas` | Dauerhaft aktive Instanzen: Die Untergrenze des Autoscalers und die Basis für die monatliche Abrechnung des Projekts |
| `--autoscale-max` | 1–16. Die Obergrenze, die erreicht werden darf. Instanzen, die der Autoscaler oberhalb von `--replicas` hinzufügt, werden sekundengenau pro Pod zu denselben Tarifen abgerechnet, und zwar nur dort, wo die Plattform dies aktiviert hat; **Usage this month** gibt Aufschluss darüber. `--no-autoscale` deaktiviert die Autoskalierung |
| `--autoscale-cpu-target` | 10–95. Die CPU-Auslastung, die der Autoscaler anstrebt – bezogen auf den Request, nicht auf das Limit. Standardwert (leer) ist 70 |
| `--spot` | `true` oder `false`. Preemptible Kapazität: Günstiger, kann jedoch ohne Vorankündigung neu gestartet werden |
| `--db-instances` | 1–3. `1` bedeutet eine einzelne Instanz ohne Failover; `2` fügt eine automatische Standby-Instanz hinzu |
| `--db-cpu`, `--db-memory` | Pro Datenbankinstanz. Standardwert (leer) ist `160m` und `1Gi` |

Ein nicht gesetzter Parameter ist nicht gleichbedeutend mit einem fest auf denselben Wert gesetzten:
Ein leerer Parameter folgt dem Standard der Plattform und ändert sich automatisch mit diesem.

Die CLI führt bewusst keine Validierung durch – die Grenzwerte werden vom jeweiligen Cluster
bestimmt, auf dem das Projekt läuft, und variieren je nach Provider. Die Control-Plane weist
nicht erfüllbare Werte unter Nennung des betroffenen Feldes zurück. Führen Sie `rebase cloud compute`
aus, um die monatlichen Kosten (€/Monat) vor und nach der Änderung einzusehen; Änderungen greifen
sofort und werden ab dem aktuellen Tag anteilig berechnet – mit Ausnahme von Änderungen, die einen
Neustart der Datenbank erfordern, welcher erst im Wartungsfenster stattfindet.

## Der restliche Funktionsumfang

| Befehlsgruppe | Zuständigkeitsbereich |
|---|---|
| `login`, `logout`, `whoami`, `access-token` | Ihre Sitzung; `access-token` gibt das Bearer-Token aus, das die CLI aktuell senden würde, nützlich für Skripte und den MCP-Server |
| `tokens` | Token für CI und Agents, jeweils auf ein einzelnes Projekt begrenzt. Siehe [CI und Agents](/docs/deployment/cloud-agents/#ci-and-agents) |
| `link`, `unlink`, `use`, `open` | Verknüpfen dieses Verzeichnisses mit einem Projekt, Auswahl einer Organisation, Öffnen der Konsole |
| `connect` | Hinzufügen eines selbst gehosteten Rebase-Servers zu Ihrem Konto, sodass der [Rebase-Connector](/docs/ai/rebase-connector/#add-your-self-hosted-instances) in Claude diesen neben Ihren Cloud-Projekten erreicht. `--list` listet sie auf, `--remove` entfernt einen. Nur für Inhaber und Admins |
| `init`, `claim` | Mit `--claim`: Ein Live-Backend ohne Konto und ein Link zu dessen Übernahme; `claim` gibt diesen Link erneut aus. Siehe [Ein Backend ohne Konto](/docs/deployment/cloud-agents/#a-backend-with-no-account) |
| `projects` | Erstellen, auflisten, prüfen, löschen |
| `deploy`, `logs`, `deployments`, `rollback`, `cancel` | Bereitstellen und Überwachen |
| `deploy-hooks` | Geheime URLs, die ein Git-Host oder eine CI aufruft, um das Projekt bereitzustellen: auflisten, erstellen (URL wird nur einmal angezeigt), widerrufen. |
| `previews` | Vorschau-Builds, die von `deploy --preview` unter einer eigenen Adresse bereitgestellt werden, sowie deren Löschung. Siehe [Vorschau einer Änderung](#vorschau-einer-änderung-preview) |
| `start`, `stop`, `restart` | Pausieren eines Projekts und Wiederaufnahme. Ein gestopptes Projekt behält sein Abonnement, es sei denn, die Plattform berechnet für gestoppte Projekte lediglich Speicher und Plattformgebühr; die Zeile **Billing** in der Konsole weist darauf hin, falls dies der Fall ist |
| `status`, `metrics`, `debug` | Aktuelle Aktivitäten und Diagnose bei Problemen |
| `alerts` | Offene Vorfälle des Projekts sowie deren Bestätigung (Acknowledge) oder Stummschaltung (Snooze). |
| `cron` | Cron-Jobs der bereitgestellten App und deren aufgezeichnete Ausführungen, ausgelesen über Ihr `rebase cloud`-Login. Schreibgeschützt |
| `env` | Umgebungsvariablen. `list` gibt niemals Werte aus; `--secret` ist Write-Only |
| `app-key` | Der Schlüssel, den `init --claim` als `REBASE_API_TOKEN` in die `.env` geschrieben hat und der bei der Übernahme übergeben wurde; `rotate` ersetzt ihn und erklärt den alten für ungültig. Inhaber und Admins |
| `service-key` | `REBASE_SERVICE_KEY`, Admin-Rechte für die app-eigene API: Wann er zuletzt rotiert wurde; `rotate` generiert einen neuen. Inhaber und Admins |
| `domains` | Eigene Domains, hinzuzufügende DNS-Einträge und Verifizierung. Ein Projekt kann über mehrere Domains erreichbar sein, die jeweils einzeln verifiziert werden; `verify` und `remove` erwarten die zu bearbeitende Domain als Argument, was nur weggelassen werden kann, wenn genau eine existiert (bei `verify`: genau eine noch ausstehende). Jede verifizierte Domain liefert das Projekt direkt aus; `primary <domain>` legt die kanonische Domain fest und `redirect <domain>` leitet Anfragen einer anderen Domain mit Statuscode 308 dorthin weiter, unter Beibehaltung von Pfad und Query (`--off` liefert sie wieder direkt aus) – dies empfiehlt sich für `www.` neben einer Apex-Domain, da Google-Anmeldung, Cookies und Passkeys pro Origin gelten. Eine Domain, auf der eine bestimmte App bereitgestellt wird (ein App-`path` mit Hostname), wird niemals weitergeleitet. Eine Apex-Domain (`example.com`, ohne Subdomain) erfordert einen **A**-Record, da DNS dort keinen CNAME erlaubt. Diese Adresse ist der Ingress der Plattform und bleibt nicht garantiert immer identisch: Zieht die Plattform um, zeigt ein A-Record weiterhin auf die alte Adresse. Bietet Ihr DNS-Anbieter ALIAS-, ANAME- oder CNAME-Flattening auf Apex-Ebene, verweisen Sie mit dem Apex stattdessen auf den `tenantHost` des Projekts, der automatisch mit der Plattform wandert. Der CNAME einer Subdomain folgt diesem ohnehin. `list` meldet `verified, certificate pending`, bis HTTPS mit einem echten Zertifikat antwortet. `list --json` liefert `{ projectId, tenantHost, domains: [...] }` |
| `db` | Datenbank anbinden oder erstellen, Verbindung vom lokalen Rechner herstellen, Backups, Wiederherstellung und Point-in-Time-Recovery |
| `guests` | Gastbenutzer, die durch anonyme Anmeldungen entstanden sind: Zählen, einzelne löschen, alte bereinigen. Siehe [Gäste](/docs/cli/cloud/#guests). Inhaber und Admins |
| `extensions` | Die Postgres-Extension-Allowlist |
| `storage` | Der Bucket des Projekts |
| `resources` | Welche Datenbanken und Buckets die Plattform vorhält, verglichen mit den Deklarationen im Code |
| `compute` | Ressourcenreservierung dieses Projekts, Kosten und Änderungsmöglichkeiten |
| `events` | Chronologische Backend-Ereignisse (neueste zuerst): Skalierung der App, geplante und durchgeführte Datenbankänderungen, Übernahme durch eine Standby-Instanz, Vergrößerung des Datenträgers |
| `usage` | Im laufenden Monat genutzte Anfragen im Verhältnis zum Freikontingent und die bisher aufgelaufenen Mehrkosten laut Rechnungslogik. `usage org` listet alle Projekte der Organisation auf |
| `clusters` | Die Cluster, auf denen die Mandanten laufen. Nur für Plattform-Admins |
| `settings`, `orgs`, `billing` | Projekteinstellungen, Organisationen samt Mitgliedern und Einladungen, Zahlungsabwicklung |
| `activity` | Audit-Log der Organisation: Wer ein Deployment durchgeführt, eine Umgebungsvariable (nach Name), eine Domain, ein Backup, ein Mitglied oder ein Token geändert hat. Inhaber und Admins. Siehe [Nachvollziehen, wer was getan hat](#nachvollziehen-wer-was-getan-hat) |
| `notifications` | Endpunkte, an die Ereignisse des Projekts per POST gesendet werden: Slack, Discord oder beliebige HTTPS-URLs ([Cloud-Benachrichtigungen](/docs/deployment/cloud-notifications/)) |

Jede Gruppe in dieser Tabelle antwortet auf `--help` mit einer eigenen Hilfeseite – inklusive
Verwendungszeile, Flags und Beispielen; `--help` führt den Befehl niemals aus. Ein automatisierter
Test prüft die Vollständigkeit dieser Liste: Eine hinzugefügte Gruppe ohne Eintrag führt zum Fehlschlag
des Builds, statt ein Inhaltsverzeichnis auszugeben. `verify:docs` gleicht die Tabelle selbst mit diesem
Index ab: Jede Gruppe, die die CLI verarbeitet, taucht hier genau einmal auf, sodass auch eine
fehlende Tabellenzeile den Build fehlschlagen lässt.

Wird der Befehl über eine Pipe weitergeleitet, antwortet `--help` stattdessen mit JSON: dieselbe
Verwendungszeile, Flags und Beispiele als strukturierte Daten anstelle von Terminal-Escape-Sequenzen.

## Was die Beta noch nicht enthält

Offen dargelegt, da böse Überraschungen im Nachhinein vermieden werden sollen:

- **Keine freie Regionswahl.** Alles läuft derzeit in einer einzigen Region. Das Platzierungsmodell
  ist in der Plattform zwar angelegt, ein Projekt kann seine Region jedoch nicht frei wählen.
  `projects create --provider` und `--region` sind keine Ausnahme, auch wenn es so aussieht: Sie
  erfassen lediglich, zu welchem der in der Control-Plane registrierten Deployment-Ziele ein
  Projekt gehört. Da es derzeit nur eines gibt, fallen beide auf diesen Standard zurück und
  verschieben das Projekt nicht. `rebase cloud projects create --help` bestätigt dies.
- **Kein Self-Service.** Der Zugriff wird in Batches gewährt; es gibt keine direkte Registrierung
  mit Sofortzahlung.
- **Kein garantiertes SLA** und kein SOC 2. Benötigen Sie eines von beiden, teilen Sie dies bitte
  bereits bei der Anfrage mit, anstatt davon auszugehen.
- **Keine Branch-Deployments** und keine offizielle GitHub-App. Deploy-Hooks – geheime URLs,
  die über Webhooks eines Repositories aufgerufen werden – sind die offiziell unterstützte
  Automatisierung. [Preview-Deployments](#vorschau-einer-änderung-preview) werden schrittweise
  eingeführt und über die CLI initiiert.
- **Token agieren im Namen einer Person.** Ein [Token](/docs/deployment/cloud-agents/#ci-and-agents) wird
  von einem Benutzerkonto ausgestellt und agiert mit dessen Rechten; es gibt derzeit noch keine
  organisationsweiten Maschinen-Identitäten. Melden Sie sich stattdessen aus einer CI an, übergeben Sie
  `REBASE_CLOUD_EMAIL` und `REBASE_CLOUD_PASSWORD` aus einem Secret-Store – `--password` hinterlässt
  das Passwort im Shell-Verlauf sowie in der Prozesstabelle und weist vor der Anmeldung auch darauf hin.
  Gibt die `.rebase/cloud.json` des Repositories eine andere Control-Plane als die Standard-Plattform
  an, übergeben Sie diese ebenfalls über `--url`: Ohne interaktives Terminal verweigert `login` das
  Senden eines Passworts an einen Host, der ausschließlich in einer ausgecheckten Datei hinterlegt ist.
- **Kein öffentlicher Datenbank-Endpunkt.** Eine verwaltete Datenbank ist nicht über das Internet
  erreichbar. Der in der Konsole angezeigte Host ist lediglich die interne Adresse für Ihr Backend
  und kann auf Ihrem lokalen Rechner nicht aufgelöst werden. `rebase cloud db connect` öffnet einen
  lokalen Port zur Datenbank, der über die Control-Plane getunnelt wird, solange der Befehl aktiv
  bleibt – es existiert jedoch kein permanenter Hostname, zu dem sich externe Drittanbieterdienste
  verbinden könnten. Um SQL-Befehle ohne lokalen Postgres-Client auszuführen, öffnet
  `rebase cloud db query "<sql>"` oder `rebase cloud db query --file file.sql` denselben Tunnel
  für eine einzelne Abfrage, führt den Text als zusammenhängendes Skript aus (Abbruch beim ersten
  Fehler) und gibt die Ergebnisse der einzelnen Anweisungen aus (`--json` für Skripte). Sowohl dieser
  Tunnel als auch das Passwort hinter `rebase cloud db info --reveal` erfordern die Rolle Inhaber oder
  Admin in der Organisation: dieselbe Berechtigung, die auch der SQL-Editor von Studio voraussetzt,
  da alle drei Wege vollen Zugriff auf Ihre Produktionsdaten ermöglichen.
- **Deployen bedeutet, Code mit den Produktions-Secrets auszuführen.** Die Umgebung der App
  enthält `REBASE_SERVICE_KEY` (Admin-Rechte für die eigene API), `DATABASE_URL` und `JWT_SECRET`.
  Von Mitgliedern bereitgestellter Code kann diese Werte daher auslesen, auch wenn nur Inhaber und
  Admins sie in der Konsole aufdecken dürfen. Laden Sie daher nur Personen als Mitglieder ein,
  denen Sie diese sensiblen Werte anvertrauen würden.
- **Der Service-Key kann ausgetauscht werden.** Die **Settings** des Projekts (oder
  `rebase cloud service-key rotate`) generieren einen neuen `REBASE_SERVICE_KEY` und starten
  die App damit neu. Der alte Schlüssel bleibt nur bis zum Abschluss des Neustarts gültig; alle
  späteren Zugriffe mit der alten Kopie werden abgewiesen. Die Übernahme eines Projekts (Claiming)
  führt denselben Vorgang durch.

## Stattdessen selbst hosten

Nichts hier bindet Sie fest an die Plattform (kein Lock-in). Der
[Leitfaden zum Self-Hosting](/docs/deployment/self-hosting/) führt das identische Image und Bundle
mit `docker compose` aus, und die [Kubernetes-Anleitung](/docs/deployment/kubernetes/) baut dieselbe
Topologie über das Helm-Chart auf.
