---
sourceHash: de4684f207c4a8fd
title: Rebase Cloud
sidebar_label: Rebase Cloud
description: Rebase Cloud ist dasselbe Rebase, für Sie betrieben. Was es ist, wie ein Projekt verknüpft und bereitgestellt wird und was die Private Beta noch nicht enthält.
---

Rebase Cloud führt dasselbe Open-Source-Rebase aus, das Sie auch selbst hosten würden – dasselbe
veröffentlichte `rebasepro/server`-Image, dasselbe Bundle, dasselbe Postgres. Der
Unterschied liegt darin, wer es betreibt.

:::note[Private Beta]
Rebase Cloud befindet sich in der **Private Beta**. Es betreibt bereits echte Tenants und wird
schrittweise freigeschaltet. [Zugang anfragen](https://rebase.pro/pricing).

Es ist kein Self-Service-Angebot; die folgenden Befehle erfordern daher ein Konto, das
bereits freigeschaltet wurde. Alles andere auf dieser Website funktioniert ohne Konto.
:::

## Was es ist

Ein Cloud-**Projekt** besteht aus drei Komponenten, die die Plattform für Sie betreibt:

| | Was Sie erhalten |
|---|---|
| **App** | Ihr Bundle, ausgeführt auf dem veröffentlichten Runtime-Image. Deployments sind Bundle-Uploads, keine Container-Builds |
| **Datenbank** | Ein verwaltetes PostgreSQL mit automatisierten Backups und Point-in-Time-Recovery |
| **Speicher** | Ein eigener Bucket, falls Ihr Projekt Dateispeicher nutzt |

Jede Komponente wird beim ersten Deployment bereitgestellt und nach reservierten
Ressourcen statt pro Benutzer (Seat) abgerechnet.

**An Ihrem Projekt ändert sich nichts, um dort zu laufen.** Dasselbe Repository
kann per `docker compose` selbst gehostet werden, und der Notausstieg ist real: `rebase build`
erzeugt ein Bundle, das überall dort startet, wo das Runtime-Image ausgeführt werden kann.

## Ein Projekt verknüpfen

Aus einem Projektverzeichnis:

```bash
rebase cloud login
rebase cloud billing setup
rebase cloud projects create --name "My app" --subdomain my-app --link
```

`login` öffnet die Konsole im Browser und gibt einen kurzen Code aus. Prüfen Sie,
ob die Konsole denselben Code anzeigt, und bestätigen Sie die Anmeldung dort: Das Terminal
übernimmt die Sitzung und speichert sie in `~/.rebase/credentials.json`. Wenn Sie
noch nicht in der Konsole angemeldet sind, melden Sie sich dort zuerst an (u. a. via Google
oder GitHub). Über SSH gibt `rebase cloud login --no-browser` den Link aus,
den Sie auf Ihrem eigenen Rechner öffnen können.

`projects create` nimmt keine Positionsargumente entgegen. Name und Subdomain sind
Flags und beide erforderlich – im Terminal werden sie abgefragt, und eine
Headless-Ausführung, bei der eines davon fehlt, bricht mit `input_required` ab, anstatt
eines zu erfinden. **Die Subdomain kann nachträglich nicht mehr geändert werden:** Sie bildet den
`<slug>.rebase.website`-Host, unter dem das Projekt erreichbar ist; wählen Sie sie daher mit Bedacht.

`--link` verknüpft dieses Verzeichnis im selben Aufruf mit dem Projekt, sodass kein
separater `link`-Schritt nötig ist. Es erstellt `.rebase/cloud.json`, worin Projekt-ID
und Slug festgehalten werden. Diese Datei enthält keine Geheimnisse und keine Zugangsdaten –
letztere liegen in `~/.rebase/credentials.json`, geschrieben von `login`.

Die Datei wird jedoch mit dem Code committet, sodass ein geklontes Repository jede
Control-Plane benennen kann. Wenn der Host ausschließlich aus dieser Datei stammt und
weder die plattform-eigene Control-Plane noch eine ist, an der Sie sich zuvor angemeldet haben,
nennt `login` diesen und fragt nach, bevor E-Mail und Passwort dorthin gesendet werden. Ohne Terminal
oder mit `--json` verweigert der Befehl dies mit `unknown_control_plane`; übergeben Sie `--url <host>`
(oder setzen Sie `REBASE_CLOUD_URL`), um sich dort gezielt anzumelden.

Um sich ohne Browser anzumelden, übergeben Sie Ihre E-Mail-Adresse: `rebase cloud login --email
me@example.com` fragt nach Ihrem Passwort. **Haben Sie sich mit Google, GitHub oder
LinkedIn registriert?** Ihr Konto besitzt kein Passwort, verwenden Sie stattdessen einen Code:

```bash
rebase cloud login --code --email me@example.com
```

Die Control-Plane sendet Ihnen per E-Mail einen 6-stelligen Code, der zehn Minuten lang gültig ist,
und Sie geben ihn bei der Eingabeaufforderung ein. Mit `--email` und ohne Passwort fragt
`rebase cloud login`, ob Sie ein Passwort oder einen Code verwenden möchten. Codes setzen voraus, dass
die Control-Plane E-Mails versenden kann; ist dies nicht der Fall, meldet `--code` dies und bricht mit `otp_unavailable` ab.

Wenn Sie die Zwei-Faktor-Authentifizierung aktiviert haben, fragt `login` anschließend nach dem Code aus
Ihrer Authentifikator-App oder einem Ihrer Wiederherstellungscodes – unabhängig davon, wie Sie sich
angemeldet haben. Im Browser fragt die Konsole bei der dortigen Anmeldung danach. Weder ein Anmeldecode noch ein zweiter Faktor können ohne Terminal eingegeben werden.
Für Skripte erstellen Sie ein Zugriffstoken in der Konsole (**Settings → Access
tokens**) und setzen `REBASE_TOKEN`; siehe [CI und Agents](/docs/deployment/cloud-agents/#ci-and-agents).

Ein falsches Passwort liefert `invalid_credentials` mit denselben beiden Anmeldeoptionen zurück, da
die häufigste Ursache ein Konto ist, das nie ein Passwort besaß.

`billing setup` hinterlegt einmalig eine Zahlungskarte für die Organisation. Dies steht bewusst
am Anfang: Das erste Deployment eines Projekts wird ohne hinterlegte Karte verweigert,
und dies erst nach dem Hochladen eines Bundles zu erfahren, wäre die schlechtere Reihenfolge.

Danach listet die Seite **Billing** in der Konsole die Rechnungen der Organisation auf –
jeweils mit Stripes gehosteter Seite und PDF – und zeigt eine Vorschau auf die nächste Rechnung jedes
Projekts. `rebase cloud billing invoices` und `rebase cloud billing upcoming`
geben dasselbe aus. Beides steht Inhabern und Admins der Organisation zur Verfügung. Wo die
Plattform es anbietet, öffnet **Manage billing** das Stripe-Kundenportal zur Verwaltung
der Karte, der Rechnungsdaten und vergangener Rechnungen.

Ist bereits eine Karte hinterlegt, erfordert das Erstellen eines weiteren Projekts in der Konsole
keine erneute Zahlung: Das Projekt wird über diese Karte abgerechnet und bereitgestellt. Wird die Karte
abgelehnt oder verlangt die Bank eine Zahlungsbestätigung, führt die Konsole Sie zu
**Billing**, wo **Fix your card** eine andere Karte speichert und **Complete the
payment** Stripes Rechnung öffnet.

Was ein Projekt verbraucht hat, ist in seiner Übersicht unter **Usage this month**
sowie für alle Projekte gesammelt auf der Seite **Billing** ersichtlich: Anfragen im Verhältnis
zum enthaltenen Kontingent (der Balken färbt sich bei 80 % gelb), 5xx-Fehler, bisherige
Mehrkosten und wohin der Monat bei aktuellem Tempo steuert. Die Mehrkosten werden mit
demselben Code berechnet, der sie an Stripe meldet; sie entsprechen somit dem späteren Rechnungsbetrag
und erscheinen auf der Rechnung des Folgemonats. `rebase cloud usage` gibt dasselbe aus,
und `rebase cloud usage org` für die gesamte Organisation. Jedes Mitglied kann dies einsehen.
Die Zahlen spiegeln wider, was derzeit noch nicht erfasst wird: Objektspeicher wird nicht gemessen,
daher fallen keine Speicher-Mehrkosten an; solange ein Projekt zwei oder mehr App-Pods betreibt,
werden dessen Anfragen nicht gezählt; und ein Tag mit ausgefallenen Messungen zählt zu wenig. Ein
automatisch skaliertes Projekt zeigt zudem die Pods an, die oberhalb von `--replicas` liefen (in Pod-Stunden),
was sie zu den eigenen Tarifen kosten und ob diese Plattform sie bereits in Rechnung stellt. Ein
von einem Agent übernommenenes Projekt (Claim) zählt erst ab dem Tag der Übernahme: Davor
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

Ein einziger Befehl ohne Flags, die man sich merken müsste. Die `rebase.json` eines Scaffolds deklariert
`runtime: "managed"` für das Backend, und `deploy` liest diese Deklaration aus – dies
wird währenddessen angezeigt (`rebase.json declares runtime: managed — deploying a
bundle`), baut die App in `dist-bundle`, lädt das Bundle hoch, führt es auf dem
veröffentlichten Runtime-Image aus und verfolgt das Deployment bis zum finalen Status. Der Exit-Code
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

"Live" bedeutet, dass die Adresse nach dem Build geantwortet hat: `/health` eines Backends
hat `ok` zurückgegeben, und die Seite einer statischen App wurde geladen (aus diesem Deployment, wenn die
Plattform sie ausliefert). Die Prüfung wartet bis zu `--live-timeout` Sekunden (standardmäßig 60);
`0` überspringt sie. Wenn eine App nicht rechtzeitig antwortet, beendet sich das Deployment dennoch mit Exit-Code
0, da die Bereitstellung erfolgreich war; die letzte Zeile besagt, welche App nicht
geantwortet hat und warum. Ein fehlgeschlagenes Deployment endet stattdessen in einer einzigen Zeile, die die App und den
Grund nennt, während `rebase cloud logs` das vollständige Build-Log liefert.

Skripte übergeben `--json` für ein einzelnes Objekt mit denselben Informationen – `apps`, `hosts`,
`live`, `liveChecks`, `durationMs` und der Deployment-ID. Anders als der Rest von
`rebase cloud` schaltet `deploy` bei einer Pipe nicht automatisch auf JSON um.

Was diese Runtime zulässt – Pakete und native Module, Speicher und Instanzen,
Timeouts und Body-Größen, das Dateisystem, Secrets, Storage und ausgehender
Netzwerkverkehr – ist auf einer eigenen Seite dokumentiert:
[Managed backend runtime](/docs/deployment/managed-runtime/).

Um ein zuvor erstelltes Artefakt bereitzustellen – etwa in einem CI-Job, der einmal baut
und zweimal deployt –, verweisen Sie direkt auf das Verzeichnis, anstatt neu zu bauen:

```bash
rebase build
rebase cloud deploy --bundle-dir dist-bundle
```

Das Verlassen der Managed Runtime erfordert ein eigenes Flag, `--eject`, und wird durch nichts
anderes ausgelöst: Ein Build, der ein verwaltetes Projekt auf ein eigenes Container-Image
umstellen würde, wird verweigert, solange Sie dies nicht explizit angeben. Früher diente `--force`
dazu, wodurch die am schwersten umkehrbare Aktion der CLI unter demselben Wort wie "diese Datei
überschreiben" lag; dies ist nun eine unbekannte Option statt eines Alias, sodass ein Skript mit diesem
Flag stattdessen abbricht.

### Die Syntaxprüfung vor dem Upload

Dateien einer statischen App werden exakt so ausgeliefert, wie sie vorliegen. Wenn deren `build` lediglich
handgeschriebene Skripte nach `output` kopiert, wurden sie von nichts geparst; eine Datei
mit einem Tippfehler ginge live und würde das Laden der Seite verhindern. Bevor also irgendetwas
hochgeladen wird, parst `deploy` jede `.js`-, `.mjs`- und `.cjs`-Datei im `output` jeder statischen
App sowie jedes Inline-`<script>` in deren `.html`-Dateien. Dies deckt sowohl eigenständig
bereitgestellte statische Apps ab als auch statische Apps, die im Bundle des Backends zusammengefasst
sind. Ein Syntaxfehler stoppt das Deployment unter Angabe von Datei, Zeile und Spalte:

```
✗ A syntax error in the static output, so nothing was deployed:
    web/cloud.js:42:23  Unexpected token
        42 |     return fetch("/api";
Fix it and deploy again, or pass --no-verify to deploy anyway.
```

Mit `--json` lautet der Fehler-`code` `syntax_error`. Inline-Skripte, die ein Browser
nicht als JavaScript ausführt, werden übersprungen: JSON, Import Maps, Templates und alle
anderen Nicht-JavaScript-`type`s, ein `<script src>` sowie Skripte, die noch
ungerendertes Template-Markup wie `{{ }}` enthalten. Eine `.js`-Datei ist gültig, wenn sie sich entweder
als klassisches Skript oder als Modul parsen lässt, da die Seite entscheidet, was zutrifft. Unter
`node_modules` wird nichts gelesen, ebenso wenig in einem vorgefertigten `--bundle-dir`.
`--no-verify` überspringt die Prüfung für ein einzelnes Deployment.

Überwachung:

```bash
rebase cloud logs               # das Build-Log
rebase cloud logs --runtime -f  # Live-Ausgabe der laufenden App bis Strg-C
rebase cloud status             # Status des Projekts aus Sicht der Plattform
```

`status` meldet `blockedOn` und `nextAction`. Wenn `blockedOn` `null` ist,
arbeitet die Plattform regulär und Polling ist das richtige Vorgehen; wenn dort etwas
angegeben ist, wartet dieser Vorgang auf eine Aktion von Ihnen.

## Eine Änderung als Preview bereitstellen

```bash
rebase cloud deploy --preview
```

Dies baut und lädt genau das hoch, was `deploy` hochladen würde, stellt es aber unter
einer eigenen Adresse bereit, z. B. `https://shop--k3x9ab.rebase.website`. Die Produktion liefert
weiterhin das aus, was sie zuvor ausgeliefert hat. Das Deployment gibt nach Abschluss des Builds
die Preview-Adresse aus.

Um eine feste Adresse über mehrere Deployments hinweg beizubehalten, benennen Sie die Preview. Ein erneutes
Deployment unter demselben Namen aktualisiert sie:

```bash
rebase cloud deploy --preview-name new-checkout
```

Womit eine Preview kommuniziert, hängt davon ab, was Sie bereitgestellt haben:

- **`rebase cloud deploy --preview`** erstellt eine Vorschau des Backends samt eingebetteten
  statischen Apps, genau wie in der Produktion. Es erhält ein eigenes Backend mit einer
  **eigenen leeren Datenbank**, niemals der Produktionsdatenbank. Ein Start gegen die
  Produktionsdatenbank würde das Schema und die Zugriffsregeln der Preview auf diese anwenden.
- **`rebase cloud deploy web --preview`** würde eine einzelne statische App isoliert bereitstellen,
  wobei deren Seiten das **Produktions**-Backend aufrufen. Dies setzt eine Control-Plane voraus,
  die statische Websites eigenständig ausliefern kann, was Rebase Cloud derzeit noch nicht unterstützt:
  Der Aufruf wird mit `PREVIEW_STATIC_UNSERVED` abgelehnt und nichts veröffentlicht. Erstellen Sie stattdessen
  eine Preview des Backends, welches die eingebetteten statischen Apps mitausliefert; ein Projekt
  ohne Managed Backend kann derzeit noch nicht als Preview bereitgestellt werden.

Eine Preview lädt keinen Quellcode hoch und registriert keine Apps oder Hostnamen, da dies
jeweils das Produktionsprojekt verändern würde. `--source` und `--eject` können nicht mit
`--preview` kombiniert werden. Beide bauen ein Container-Image für die Produktion.

```bash
rebase cloud previews                      # Name, Adresse, App, Backend, Ablaufdatum
rebase cloud logs --preview new-checkout   # Build-Log; -f folgt einem noch laufenden Build
rebase cloud logs --runtime --preview new-checkout -f  # Konsolenausgabe des Backends
rebase cloud previews delete new-checkout  # Beendet die Bereitstellung und löscht die Datenbank
```

`rebase cloud logs` ohne `--preview` bezieht sich immer auf die Produktion.

Die Seite **Deployments** in der Konsole listet dieselben Previews auf und erlaubt es, jede einzelne zu öffnen,
deren Build-Log einzusehen oder sie zu löschen. Das Erstellen bleibt ein CLI-Schritt.

Eine Preview läuft eine Woche nach dem letzten Deployment ab.

Nach Abschluss prüft das Deployment, ob die Preview-Adresse antwortet, genau wie bei einem
Produktions-Deployment (`--live-timeout <Sekunden>`, `0` zum Überspringen). Das Zertifikat einer neuen
Preview kann ein bis zwei Minuten in Anspruch nehmen, sodass ein erfolgreiches Deployment melden kann,
dass die Adresse noch nicht antwortet.

Eine Backend-Preview wird wie eine App-Einheit in der Standardgröße abgerechnet (100m CPU
und 384 MiB RAM, zum Tarif Ihrer App für deren Region und Kapazität),
anteilig für die Dauer ihres Bestehens, und erscheint im monatlichen Kostenvoranschlag
des Projekts in der Konsole. `rebase cloud deploy --preview` gibt dieselbe Schätzung
pro Monat aus (`cost` unter `--json`). Das Starten erfordert eine hinterlegte Karte, genau wie ein
Produktions-Deployment. Ein erstes Deployment, das fehlschlägt, bevor irgendetwas läuft,
wird entfernt statt berechnet. Ein Projekt darf bis zu drei Backend-Previews gleichzeitig betreiben.

Jede neue Preview-Adresse erhält ein eigenes TLS-Zertifikat von Let's Encrypt,
das pro Domain 50 neue Zertifikate pro Woche erlaubt – geteilt mit allen Produktionsseiten
darauf. Previews dürfen plattformweit bis zu 20 davon innerhalb von 7 Tagen beanspruchen.
Darüber hinaus wird eine neue Preview abgelehnt (`429`, `preview_cert_budget`) unter Angabe des Zeitpunkts,
ab dem sie bereitgestellt werden kann; das erneute Bereitstellen einer bestehenden Preview zählt dabei nie mit.

Die Datenbank einer Backend-Preview ist eine zweite Datenbank auf der **Produktions**-Postgres-Instanz:
eigene Daten, aber dieselbe Instanz und dieselbe Festplatte. Sie ist auf 10
Verbindungen limitiert, damit Previews die Produktion nicht erschöpfen, sowie auf 2 GB: Wächst
die Datenbank einer Preview darüber hinaus, wird sie pausiert. Ihr Backend stoppt, ihre Adresse
antwortet nicht mehr, `rebase cloud previews` und die Konsole zeigen sie mit Grund als `paused` an,
und die Inhaber und Admins des Projekts werden benachrichtigt (`preview.paused`). Ihre
Daten bleiben bis zum Ablauf erhalten. Deployen Sie sie erneut, um sie zu starten (sie wird erneut pausiert,
solange die Datenbank zu groß ist), oder löschen Sie sie. Eine pausierte Preview wird weiterhin
abgerechnet, bis sie gelöscht wird oder abläuft. Löschen Sie Previews, die Sie nicht mehr benötigen. Auf der
Produktion installierte Extensions werden in der Datenbank einer Preview nicht installiert.

Previews werden schrittweise eingeführt. Eine Control-Plane, die sie noch nicht unterstützt, verweigert
`--preview` mit `previews_unavailable` und stellt nichts bereit.

## Rollback durchführen

```bash
rebase cloud deployments
rebase cloud rollback
```

Ein Rollback setzt das Projekt wieder auf den Stand eines früheren erfolgreichen Deployments,
ohne jemals neu zu bauen – der Wert eines Rollbacks besteht darin, ein Artefakt bereitzustellen,
das bereits nachweislich gelaufen ist.

Welche Deployments dafür infrage kommen, hängt von der Deployment-Methode des Projekts ab; beide Arten
werden unterstützt:

| Wie bereitgestellt wurde | Was wiederhergestellt wird |
|---|---|
| `rebase cloud deploy` (ein Source-Build) | Das Image, das dieser Build veröffentlicht hat |
| `rebase cloud deploy --bundle` (die Plattform-Runtime) | Das Bundle, das dieses Deployment ausgeliefert hat, auf der Runtime-Version, die das Projekt aktuell nutzt |

Statische Apps, die im Bundle des Backends zusammengefasst sind (ein einfaches `rebase cloud deploy` bei
einem Projekt mit Backend), sind Teil dieses Bundles und werden daher mit zurückgesetzt.

Eine isoliert bereitgestellte statische App (`rebase cloud deploy <app>`) kann derzeit noch nicht
zurückgesetzt werden. Ihr Deployment zeichnet zwar auf, welche App veröffentlicht wurde, aber kein Bundle,
sodass der Control-Plane die Grundlage zur Wiederherstellung fehlt. Die Lösung besteht darin, die letzte funktionierende
Version erneut bereitzustellen, beispielsweise aus dem Commit vor dem fehlerhaften Stand. Nach einem solchen
Deployment weist `deploy` darauf hin, anstatt auf `rollback` zu verweisen, und `rollback`
ohne ID bricht ab, anstatt das aktuell aktive Backend erneut bereitzustellen.

Ein Rollback erfordert daher ein Deployment, das eines der beiden Artefakte aufgezeichnet hat – sprich
ein Projekt, das mindestens zweimal erfolgreich bereitgestellt wurde. `rebase cloud deployments`
markiert berechtigte Deployments, und `--json` meldet für jede Zeile `rollbackable` zusammen
mit dem `image` oder `bundle`, das wiederhergestellt werden würde.

Zwei Arten von Deployments werden abgelehnt (die CLI nennt den jeweiligen Grund): Deployments, die nicht erfolgreich
waren, und solche aus der Zeit, bevor die Plattform Artefakte aufgezeichnet hat. In beiden Fällen wird
nichts erraten – Erraten würde bedeuten, das zuletzt Gebaute oder Hochgeladene bereitzustellen und vorzugeben,
dieses Deployment wiederherzustellen –, deployen Sie stattdessen die gewünschte Version direkt.

Jedes erfolgreiche Deployment schließt mit dem Hinweis auf den Rückweg ab (`rebase cloud rollback`),
sodass dieser sofort im Blickfeld ist, sobald ein fehlerhaftes Release bemerkt wird.

Ein Rollback hängt ein neues Deployment an, anstatt die Historie zurückzuspulen, und wartet,
bis die wiederhergestellte Version Anfragen bedient, bevor der Erfolg gemeldet wird. Verfolgen Sie dies mit
`rebase cloud logs -f`.

## Datenbank auf einen Zeitpunkt wiederherstellen (PITR)

Eine verwaltete Datenbank kann auf jede beliebige Minute innerhalb ihres Wiederherstellungsfensters
zurückgesetzt werden – über **Database → Backups** in der Konsole oder per CLI:
`rebase cloud db pitr status | restore --target <ISO> | cutover | discard`.
Dies geschieht in zwei Schritten. Zunächst wird eine wiederhergestellte Kopie neben der Live-Datenbank
bereitgestellt; Ihre App läuft auf der Live-Datenbank weiter, und der Speicher der Kopie wird berechnet,
bis Sie den Cutover durchführen oder sie verwerfen.
Sobald die Kopie bereit ist, verknüpft der Cutover die App mit dieser und startet sie neu.
Alles, was nach dem Zielzeitpunkt geschrieben wurde, ist in der Kopie nicht enthalten. Die ursprüngliche
Datenbank bleibt als Rückfallebene erhalten und wird speicherseitig weiter abgerechnet; ein Zurückwechseln,
Entfernen oder ein zweiter Wiederherstellungslauf erfolgt über den Support. Nur Inhaber oder Admins
können bereitstellen, den Cutover ausführen oder verwerfen; die Konsole fragt vor dem Cutover
nach dem Projektnamen.

## Ihr Konto absichern

Ihr Konsolenkonto hat Zugriff auf Produktionsdatenbanken, Secrets und Abrechnungsdaten –
schützen Sie es entsprechend. Öffnen Sie **Account security** über das Menü unter Ihrem Avatar
in der Konsole (oder navigieren Sie zu `/account`). Diese Seite gehört Ihnen, nicht einer
Organisation: Einstellungen dort gelten für jede Organisation, der Sie angehören.

- **Zweistufige Überprüfung.** Aktivieren Sie diese mit einer beliebigen Authentifikator-App (1Password,
  Google Authenticator, Authy). Die Seite zeigt einen Einrichtungsschlüssel zum manuellen Hinzufügen oder einen
  Link, der die App auf dem Smartphone mit ausgefülltem Schlüssel öffnet, und fragt anschließend nach dem
  6-stelligen Code aus der App. Fortan erfordert jede Anmeldung einen Code – unabhängig davon,
  ob Sie sich mit Passwort, Google oder GitHub anmelden.
- **Wiederherstellungscodes.** Bei der Aktivierung erhalten Sie zehn einmalig nutzbare Codes, die nur einmal
  angezeigt werden. Jeder davon ermöglicht die Anmeldung anstelle des Authentifikator-Codes, sollten Sie Ihr
  Smartphone verlieren. Speichern Sie diese, bevor Sie den Dialog schließen. **New recovery codes**
  generiert neue Codes, wodurch die alten ungültig werden. Das Deaktivieren der zweistufigen Überprüfung
  sowie das Anfordern neuer Codes erfordern jeweils vorab einen Code.
- **Passwort.** Das Ändern des Passworts meldet Sie auf allen anderen Geräten ab. Ein über
  Google, GitHub oder LinkedIn erstelltes Konto hat kein Passwort; die Seite bietet an,
  Ihnen einen Link zum Festlegen eines Passworts per E-Mail zu senden.
- **Angemeldete Geräte.** Zeigt jeden Browser und jedes Terminal an, das an Ihrem Konto angemeldet ist,
  inklusive IP-Adresse und Anmeldezeitpunkt. Melden Sie unbekannte Geräte ab – oder alle auf einmal.

[Zugriffstoken](/docs/deployment/cloud-agents/#ci-and-agents) sind keine Sitzungen und erfordern keinen
zweiten Faktor; CI-Deployments laufen nach der Aktivierung also unterbrechungsfrei weiter. Widerrufen Sie Token,
denen Sie nicht mehr vertrauen, unter **Settings → Access tokens**.

## Ihr Team einladen

**Members → Invite member** erzeugt einen Link zum Kopieren (oder per E-Mail versendet, sofern diese
Control-Plane E-Mails verschickt), der einmalig und 7 Tage lang für ein Konto gültig ist, das diese
Adresse verifiziert hat. Niemand tritt bei, bevor die Einladung angenommen wurde. Laden Sie Admins oder Mitglieder ein
und ernennen Sie sie nach dem Beitritt bei Bedarf zum Inhaber. Inhaber und Admins können Einladungen unter
**Pending invitations** einsehen, erneut senden oder widerrufen; im Terminal via [`rebase cloud orgs members invite`](/docs/cli/cloud/#organizations).

## Nachvollziehen, wer was getan hat

Die Seite **Activity** in der Konsole sowie `rebase cloud activity` zeigen Inhabern
und Admins der Organisation, wer wann ein Deployment durchgeführt, eine Umgebungsvariable gesetzt
oder eingesehen hat (nach Name, niemals nach Wert), Domains geändert, Backups wiederhergestellt,
Projekte skaliert, gestoppt oder gelöscht, Mitgliederrollen geändert oder Token erstellt hat.
Die **Settings** eines Projekts verlinken auf die jeweils eigenen Einträge; Einträge zu gelöschten
Projekten bleiben erhalten. Ein Skript liest das Protokoll mit einem Token aus, das mit `--can audit`
für die Organisation erstellt wurde. Einträge werden ein Jahr lang aufbewahrt. Filteroptionen finden sich unter
[`rebase cloud`](/docs/cli/cloud/#organizations).

## CI und Agents

Ein CI-Job oder Agent sollte nicht Ihr Passwort nutzen. Weisen Sie ihm stattdessen ein Token zu, das auf
wenige Aktionen für ein einzelnes Projekt beschränkt ist. Erstellen Sie es in einem angemeldeten Terminal mit
`rebase cloud tokens create --project shop --can deploy,logs` und setzen Sie es als
`REBASE_TOKEN`. Abrechnung, Aktivitätsprotokoll und Benachrichtigungseinstellungen einer Organisation
sind eigenständige Berechtigungen (`--can billing`, `audit`, `notifications`), die ein Token nur erhält,
wenn sie explizit angefordert werden. Die Berechtigungen, ein GitHub-Actions-Workflow und was ausschließlich
angemeldeten Personen vorbehalten bleibt, sind beschrieben unter [CI und Agents](/docs/deployment/cloud-agents/#ci-and-agents).

## Ein Backend ohne Benutzerkonto

`rebase cloud init --claim` stattet eine App mit einem Live-Backend aus, noch bevor sich jemand
registriert hat, und gibt eine Claim-URL aus, über die das Projekt dauerhaft übernommen werden kann;
ein Projekt, das niemand innerhalb von 72 Stunden beansprucht, wird gelöscht. Welche Rechte das Token des
unbeanspruchten Projekts besitzt, was im generierten `REBASE_API_TOKEN` steht und was die Übernahme ändert,
erfahren Sie unter [Ein Backend ohne Benutzerkonto](/docs/deployment/cloud-agents/#a-backend-with-no-account).

## Compute-Ressourcen und Kosten

Die Abrechnung eines Projekts basiert auf den reservierten Ressourcen, nicht auf pauschalen Tiers. `compute`
gibt alle Stellschrauben und den detaillierten Kostenvoranschlag der Control-Plane dafür aus. (`rebase cloud
resources` ist etwas anderes: die im Code deklarierten Datenbanken und Buckets sowie deren
Bereitstellungsstatus – siehe die [CLI-Referenz](/docs/cli/cloud/).)

```bash
rebase cloud compute
rebase cloud compute set --cpu 500m --memory 2Gi
```

| Parameter | Einheit und Bedeutung |
|---|---|
| `--cpu`, `--memory` | App-Request pro Instanz, z. B. `500m` und `2Gi`. Leer bedeutet Plattformstandard – `100m` und `384Mi`, mit Bursting auf bis zu 2 CPU und `2Gi` |
| `--replicas` | Dauerhaft aktive Instanzen: die Untergrenze des Autoscalers und die Basis für die monatliche Abrechnung |
| `--autoscale-max` | 1–16. Die Obergrenze, die erreicht werden darf. Instanzen, die der Autoscaler oberhalb von `--replicas` hinzufügt, werden sekundengenau pro Pod zu denselben Tarifen abgerechnet – und nur dort, wo die Plattform dies aktiviert hat; **Usage this month** gibt Aufschluss darüber. `--no-autoscale` schaltet die Autoskalierung ab |
| `--autoscale-cpu-target` | 10–95. Die CPU-Auslastung, die der Autoscaler anstrebt – bezogen auf den Request, nicht auf das Limit. Leer bedeutet 70 |
| `--spot` | `true` oder `false`. Preemptible-Kapazität: günstiger, wird jedoch ohne Vorankündigung neu gestartet |
| `--db-instances` | 1–3. `1` ist eine Einzelinstanz ohne Failover; `2` ergänzt ein automatisches Standby |
| `--db-cpu`, `--db-memory` | Pro Datenbankinstanz. Leer bedeutet `160m` und `1Gi` |

Ein leerer Wert ist nicht dasselbe wie ein fest auf denselben Betrag eingestellter Wert: Ein leerer
Wert folgt dem Standard der Plattform und ändert sich automatisch mit diesem.

Die CLI validiert diese Werte bewusst nicht – die Limits hängen vom Cluster ab, auf dem das
Projekt läuft, und variieren je nach Provider. Die Control-Plane lehnt Werte ab, die sie nicht bedienen
kann, und nennt das entsprechende Feld. Führen Sie `rebase cloud compute` aus, um die €/Monat vor
und nach der Änderung zu sehen; Anpassungen gelten sofort und anteilig ab heute – mit Ausnahme von Änderungen,
die einen Neustart der Datenbank erfordern, welcher im nächsten Wartungsfenster erfolgt.

## Der restliche Funktionsumfang

| Befehlsgruppe | Zuständigkeitsbereich |
|---|---|
| `login`, `logout`, `whoami`, `access-token` | Ihre Sitzung; `access-token` gibt den Bearer-Token aus, den die CLI aktuell senden würde (für Skripte und den MCP-Server) |
| `tokens` | Token für CI und Agents, jeweils auf ein Projekt eingegrenzt. Siehe [CI und Agents](/docs/deployment/cloud-agents/#ci-and-agents) |
| `link`, `unlink`, `use`, `open` | Verknüpfen dieses Verzeichnisses mit einem Projekt, Auswahl einer Organisation, Öffnen der Konsole |
| `connect` | Hinzufügen eines selbst gehosteten Rebase-Servers zu Ihrem Konto, damit der [Rebase-Connector](/docs/ai/rebase-connector/#add-your-self-hosted-instances) in Claude diesen neben Ihren Cloud-Projekten erreicht. `--list` listet sie auf, `--remove` entfernt sie. Inhaber und Admins |
| `init`, `claim` | Mit `--claim`: Ein Live-Backend ohne Konto und ein Link zur Übernahme; `claim` gibt diesen Link erneut aus. Siehe [Ein Backend ohne Benutzerkonto](/docs/deployment/cloud-agents/#a-backend-with-no-account) |
| `projects` | Erstellen, Auflisten, Inspizieren, Löschen |
| `deploy`, `logs`, `deployments`, `rollback`, `cancel` | Bereitstellen und Überwachen |
| `previews` | Durch `deploy --preview` unter eigener Adresse bereitgestellte Builds und deren Löschung. Siehe [Eine Änderung als Preview bereitstellen](#eine-änderung-als-preview-bereitstellen) |
| `start`, `stop`, `restart` | Pausieren und Fortsetzen eines Projekts. Ein gestopptes Projekt behält sein Abonnement, es sei denn, die Plattform stellt gestoppten Projekten nur Speicher und die Plattformgebühr in Rechnung; die Zeile **Billing** in der Konsole weist darauf hin, wenn dies zutrifft |
| `status`, `metrics`, `debug` | Was das Projekt tut und warum eventuell nicht |
| `cron` | Cron-Jobs der bereitgestellten App und deren aufgezeichnete Ausführungen, abrufbar mit Ihrem `rebase cloud`-Login. Schreibgeschützt |
| `env` | Umgebungsvariablen. `list` gibt niemals Werte aus; `--secret` ist Write-Only |
| `app-key` | Der Schlüssel, den `init --claim` als `REBASE_API_TOKEN` in die `.env` geschrieben hat und der bei der Übernahme übergeben wurde; `rotate` ersetzt ihn und widerruft den alten. Inhaber und Admins |
| `service-key` | `REBASE_SERVICE_KEY`, Admin-Rechte für die API der App: Wann er zuletzt rotiert wurde; `rotate` weist der App einen neuen zu. Inhaber und Admins |
| `domains` | Eigene Domains, hinzuzufügende DNS-Einträge und Verifizierung. Ein Projekt kann über mehrere Domains erreichbar sein, die jeweils separat verifiziert werden; `verify` und `remove` erwarten die Ziel-Domain, die nur weggelassen werden darf, wenn genau eine existiert (für `verify`: eine noch ausstehende). `list --json` gibt `{ projectId, tenantHost, domains: [...] }` zurück |
| `db` | Datenbank anbinden oder erstellen, Verbindung vom lokalen Rechner herstellen, Backups, Wiederherstellung und Point-in-Time-Recovery |
| `guests` | Gastbenutzer, die durch anonyme Anmeldungen entstanden sind: zählen, einzelne löschen oder lange inaktive bereinigen. Siehe [Guests](/docs/cli/cloud/#guests). Inhaber und Admins |
| `extensions` | Die Allowlist für Postgres-Extensions |
| `storage` | Der Bucket des Projekts |
| `resources` | Welche Datenbanken und Buckets die Plattform verwaltet, verglichen mit den Deklarationen im Code |
| `compute` | Welche Ressourcen dieses Projekt reserviert, was sie kosten und wie sie angepasst werden |
| `events` | Chronologische Ereignisse des Backends (neueste zuerst): Skalierung der App, geplante und angewendete Datenbankänderungen, Standby-Übernahme, Speichervergrößerung |
| `usage` | Diesen Monat verbrauchte Anfragen im Verhältnis zum Inklusivvolumen und bisherige Mehrkosten laut Rechnungslogik. `usage org` listet alle Projekte der Organisation auf |
| `clusters` | Die Cluster, auf denen Tenants laufen. Nur für Plattform-Admins |
| `settings`, `orgs`, `billing` | Projekteinstellungen, Organisationen samt Mitgliedern und Einladungen, Zahlungsmodalitäten |
| `activity` | Das Audit-Log der Organisation: Wer ein Deployment durchgeführt, eine Umgebungsvariable (nach Name), eine Domain, ein Backup, ein Mitglied oder ein Token geändert hat. Inhaber und Admins. Siehe [Nachvollziehen, wer was getan hat](#nachvollziehen-wer-was-getan-hat) |
| `notifications`, `webhooks` | Wohin Ereignisse des Projekts per POST gesendet werden: Slack, Discord oder eine beliebige HTTPS-URL ([Cloud-Benachrichtigungen](/docs/deployment/cloud-notifications/)). `webhooks` ist veraltet und bricht mit Exit-Code 1 und dem Code `command_retired` ab |

Jede Gruppe in dieser Tabelle beantwortet `--help` mit einer eigenen Hilfeseite – Syntax,
Flags und Beispiele –, wobei `--help` den eigentlichen Befehl niemals ausführt. Ein Test prüft
den Index dieser Seiten, sodass eine neu hinzugefügte Gruppe ohne Hilfeseite den Build fehlschlagen lässt,
anstatt das Inhaltsverzeichnis anzuzeigen. `verify:docs` gleicht die Tabelle selbst mit
diesem Index ab: Jede von der CLI bereitgestellte Gruppe erscheint hier genau einmal; eine Gruppe
ohne Tabellenzeile lässt den Build ebenfalls fehlschlagen.

Wird der Befehl über eine Pipe weitergeleitet, gibt `--help` stattdessen JSON aus: dieselbe Syntaxzeile,
Flags und Beispiele strukturiert aufbereitet, statt sechzig Zeilen voller Terminal-Escape-Sequenzen.

## Was die Beta noch nicht enthält

Klar formuliert, da spätere Überraschungen ärgerlicher sind:

- **Keine freie Regionswahl.** Derzeit läuft alles in einer einzigen Region. Das Placement-Modell
  ist in der Plattform zwar angelegt, Projekte können ihre Region jedoch noch nicht wählen.
  `projects create --provider` und `--region` sind keine Ausnahme: Sie halten lediglich fest,
  zu welchem der registrierten Deploy-Targets der Control-Plane ein Projekt gehört. Da es derzeit
  nur eines gibt, fallen beide standardmäßig darauf zurück, und keines von beiden verschiebt ein Projekt
  an einen anderen Ort. `rebase cloud projects create --help` bestätigt dies.
- **Kein Self-Service.** Der Zugang wird schrittweise vergeben; es gibt kein direktes "Registrieren und Bezahlen".
- **Kein garantiertes SLA** und kein SOC 2. Falls Sie eines davon benötigen, teilen Sie uns dies
  bei der Zugangsbeantragung direkt mit, anstatt davon auszugehen.
- **Keine Branch-Deployments** und keine native GitHub-App. Deploy-Hooks – geheime URLs,
  auf die Sie einen Repository-Webhook richten – sind der empfohlene Weg zur Automatisierung. [Preview-Deployments](#eine-änderung-als-preview-bereitstellen)
  werden schrittweise ausgerollt und über die CLI gestartet.
- **Token agieren als Person.** Ein [Token](/docs/deployment/cloud-agents/#ci-and-agents) wird durch ein Konto
  ausgestellt und handelt in dessen Namen; es gibt noch keine organisationsweiten Maschinenidentitäten. Falls Sie
  sich stattdessen aus CI anmelden, übergeben Sie `REBASE_CLOUD_EMAIL` und `REBASE_CLOUD_PASSWORD`
  aus einem Secret-Store – `--password` hinterlässt das Passwort in Ihrer Shell-History und
  in der Prozesstabelle und warnt entsprechend vor der Anmeldung. Wenn die `.rebase/cloud.json`
  des Repositorys eine andere Control-Plane als die plattform-eigene nennt, übergeben Sie diese zusätzlich
  über `--url`: Ohne Terminal weigert sich `login`, ein Passwort an einen Host zu senden,
  der ausschließlich in der ausgecheckten Datei angegeben ist.
- **Kein öffentlicher Datenbank-Endpunkt.** Eine verwaltete Datenbank ist nicht über das Internet
  erreichbar; der in der Konsole angezeigte Host ist die interne Adresse für Ihr Backend und
  kann auf Ihrem lokalen Rechner nicht aufgelöst werden. `rebase cloud db connect` öffnet einen lokalen
  Port, der über die Control-Plane getunnelt wird, solange der Befehl aktiv bleibt – es gibt
  jedoch keinen permanenten Hostnamen, mit dem sich Drittanbieter-Dienste verbinden könnten. Sowohl dieser
  Tunnel als auch das Passwort hinter `rebase cloud db info --reveal` erfordern die Inhaber- oder Admin-Rolle
  der Organisation: dieselbe Berechtigung, die auch der SQL-Editor von Studio verlangt, da alle drei
  Wege direkt zu einer Sitzung auf Ihren Produktionsdaten führen.
- **Deployen bedeutet Codeausführung mit Produktions-Secrets.** Die Umgebung der App
  enthält `REBASE_SERVICE_KEY` (Admin-Rechte auf der eigenen API),
  `DATABASE_URL` und `JWT_SECRET`. Von einem Mitglied bereitgestellter Code kann diese Werte
  daher auslesen, auch wenn nur Inhaber und Admins sie in der Konsole im Klartext einsehen dürfen. Laden Sie
  nur Personen als Mitglieder ein, denen Sie diese Werte anvertrauen würden.
- **Der Service-Key kann ausgetauscht werden.** Die **Settings** des Projekts
  (oder `rebase cloud service-key rotate`) erstellen einen neuen `REBASE_SERVICE_KEY`
  und starten die App damit neu. Der alte Schlüssel bleibt gültig, bis der Neustart
  abgeschlossen ist, und verfällt danach sofort; alle Systeme, die den alten Schlüssel kopiert haben,
  werden ab diesem Zeitpunkt abgewiesen. Die Übernahme eines Projekts (Claim) führt dieselbe Rotation durch.

## Stattdessen selbst hosten

Nichts hier bindet Sie unwiderruflich an die Plattform (kein Lock-in). Der [Leitfaden zum Self-Hosting](/docs/deployment/self-hosting/)
betreibt dasselbe Image und Bundle mittels `docker compose`, und der
[Kubernetes-Leitfaden](/docs/deployment/kubernetes/) bildet dieselbe Topologie über
das Helm-Chart ab.
