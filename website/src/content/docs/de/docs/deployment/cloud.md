---
sourceHash: 4b05c04581ef0b7d
title: Rebase Cloud
sidebar_label: Rebase Cloud
description: Rebase Cloud ist dasselbe Rebase, für Sie betrieben. Was es ist, wie ein Projekt verknüpft und bereitgestellt wird und was die private Beta noch nicht enthält.
---

Rebase Cloud führt dasselbe Open-Source-Rebase aus, das Sie selbst hosten würden – dasselbe
veröffentlichte `rebasepro/server`-Image, dasselbe Bundle, dasselbe Postgres. Der
Unterschied liegt darin, wer es betreibt.

:::note[Private Beta]
Rebase Cloud befindet sich in der **privaten Beta**. Es betreibt bereits echte Mandanten und wird in
Wellen freigeschaltet. [Zugang anfragen](https://rebase.pro/pricing).

Es ist kein Self-Service, daher erfordern die folgenden Befehle ein Konto, das freigeschaltet wurde.
Alles andere auf dieser Website funktioniert ohne eines.
:::

## Was es ist

Ein Cloud-**Projekt** besteht aus drei Komponenten, die die Plattform für Sie betreibt:

| | Was Sie erhalten |
|---|---|
| **App** | Ihr Bundle, ausgeführt auf dem veröffentlichten Runtime-Image. Deployments sind ein Bundle-Upload, kein Container-Build |
| **Datenbank** | Ein verwaltetes PostgreSQL mit automatisierten Backups und Point-in-Time-Recovery |
| **Storage** | Ein eigener Bucket, falls Ihr Projekt Dateispeicher verwendet |

Jede Komponente wird beim ersten Deployment bereitgestellt und nach den reservierten Ressourcen
statt pro Benutzer abgerechnet.

**An Ihrem Projekt ändert sich nichts, um dort zu laufen.** Dasselbe Repository
kann mit `docker compose` selbst gehostet werden, und der Ausstiegsweg ist real: `rebase build`
erzeugt ein Bundle, das überall dort startet, wo das Runtime-Image läuft.

## Ein Projekt verknüpfen

Aus einem Projektverzeichnis heraus:

```bash
rebase cloud login
rebase cloud billing setup
rebase cloud projects create --name "My app" --subdomain my-app --link
```

`login` öffnet die Konsole in Ihrem Browser und gibt einen kurzen Code aus. Überprüfen Sie,
dass die Konsole denselben Code anzeigt, und bestätigen Sie die Anmeldung dort: Das Terminal
übernimmt die Sitzung und schreibt sie in `~/.rebase/credentials.json`. Wenn Sie nicht in
der Konsole angemeldet sind, melden Sie sich dort zuerst mit Ihrem bevorzugten Dienst an,
einschließlich Google und GitHub. Über SSH gibt `rebase cloud login --no-browser` den Link aus,
den Sie auf Ihrem eigenen Rechner öffnen können.

`projects create` akzeptiert kein Positionsargument. Der Name und die Subdomain sind
Flags, und beide sind erforderlich – im Terminal werden sie abgefragt, und ein
Headless-Durchlauf, bei dem eines fehlt, wird mit `input_required` beendet, anstatt
eines zu erfinden. **Die Subdomain kann nachträglich nicht bearbeitet werden:** Sie ist der
`<slug>.rebase.website`-Host, unter dem das Projekt antwortet; wählen Sie sie also mit Bedacht.

`--link` verknüpft dieses Verzeichnis im selben Aufruf mit dem Projekt, sodass kein
separater `link`-Schritt erforderlich ist. Es schreibt `.rebase/cloud.json`, worin Projekt-ID
und Slug festgehalten werden. Diese Datei ist kein Geheimnis und enthält nicht Ihre Zugangsdaten – diese
befinden sich in `~/.rebase/credentials.json`, geschrieben von `login`.

Sie wird jedoch mit dem Code committet, sodass ein geklontes Repository jede beliebige
Control Plane benennen kann. Wenn der Host ausschließlich aus dieser Datei stammt und es
weder der plattform-eigene ist noch einer, bei dem Sie sich zuvor angemeldet haben, nennt
`login` ihn und fragt nach, bevor Ihre E-Mail-Adresse und Ihr Passwort dorthin gesendet werden. Ohne
Terminal oder mit `--json` wird dies mit `unknown_control_plane` verweigert; übergeben Sie `--url <host>`
(oder setzen Sie `REBASE_CLOUD_URL`), um sich dort gezielt anzumelden.

Um sich ohne Browser anzumelden, übergeben Sie Ihre E-Mail-Adresse: `rebase cloud login --email
me@example.com` fragt nach Ihrem Passwort. **Mit Google, GitHub oder
LinkedIn registriert?** Ihr Konto hat kein Passwort, verwenden Sie stattdessen einen Code:

```bash
rebase cloud login --code --email me@example.com
```

Die Control Plane sendet Ihnen einen 6-stelligen Code per E-Mail, der zehn Minuten gültig ist, und Sie geben
ihn an der Eingabeaufforderung ein. Mit `--email` und ohne Passwort fragt `rebase cloud login`,
ob Ihr Passwort oder ein Code verwendet werden soll. Codes erfordern, dass die Control Plane E-Mails
senden kann; falls nicht, weist `--code` darauf hin und bricht mit `otp_unavailable` ab.

Wenn Sie die Zwei-Faktor-Authentifizierung aktiviert haben, fragt `login` anschließend nach dem Code aus
Ihrer Authentifikator-App oder einem Ihrer Wiederherstellungscodes, unabhängig davon, wie Sie sich angemeldet
haben. Über den Browser fragt die Konsole bei der Anmeldung danach. Weder ein Anmeldecode noch ein zweiter
Faktor können ohne Terminal eingegeben werden. Erstellen Sie für ein Skript ein Zugriffstoken in der Konsole
(**Settings → Access tokens**) und setzen Sie `REBASE_TOKEN`; siehe [CI und Agenten](/docs/deployment/cloud-agents/#ci-and-agents).

Ein falsches Passwort antwortet mit `invalid_credentials` und denselben zwei Anmeldeoptionen, da
die häufigste Ursache ein Konto ist, das nie ein Passwort hatte.

`billing setup` hinterlegt einmalig eine Karte für die Organisation. Es steht ganz bewusst an
erster Stelle: Das erste Deployment eines Projekts wird ohne Karte verweigert, und dies erst
nach Abschluss des Bundle-Uploads festzustellen, wäre die schlechtere Reihenfolge.

Danach listet die Seite **Billing** der Konsole die Rechnungen der Organisation auf, jeweils
mit Stripes gehosteter Seite und PDF, und zeigt eine Vorschau auf die nächste Rechnung jedes
Projekts. `rebase cloud billing invoices` und `rebase cloud billing upcoming` geben dasselbe aus.
Beides ist für Eigentümer und Administratoren der Organisation gedacht. Wo die Plattform es anbietet,
öffnet **Manage billing** das Stripe-Kundenportal für die Karte, die Rechnungsdetails und vergangene Rechnungen.

Ist bereits eine Karte hinterlegt, erfordert das Erstellen eines weiteren Projekts in der Konsole
keine zweite Zahlung: Das Projekt wird über diese Karte abgerechnet und bereitgestellt. Wird die Karte
abgelehnt oder verlangt die Bank eine Zahlungsbestätigung, führt die Konsole Sie zu **Billing**, wo
**Fix your card** eine andere Karte speichert und **Complete the payment** Stripes Rechnung öffnet.

Was ein Projekt verbraucht hat, wird in dessen Übersicht unter **Usage this month** angezeigt sowie
für alle Projekte gleichzeitig auf der Seite **Billing**: Anfragen im Vergleich zum enthaltenen
Kontingent (der Balken wird bei 80 % gelb), 5xx-Fehler, die bisherigen Mehrkosten und die voraussichtliche
Entwicklung des Monats bei diesem Tempo. Die Mehrkosten werden von demselben Code berechnet, der sie
an Stripe meldet, entsprechen also genau dem, was auf der Rechnung stehen wird; sie erscheinen auf der
Rechnung des Folgemonats. `rebase cloud usage` gibt dasselbe aus, und `rebase cloud usage org` für
die gesamte Organisation. Jedes Mitglied kann dies einsehen. Die Zahlen weisen auf Einschränkungen hin:
Objektspeicher wird noch nicht gemessen, daher fallen hierfür keine Mehrkosten an; solange ein Projekt
zwei oder mehr App-Pods ausführt, werden dessen Anfragen nicht gezählt; und ein Tag mit fehlenden
Messwerten führt zu einer Untererfassung. Ein automatisch skaliertes Projekt zeigt zudem die Pods an,
die es über `--replicas` hinaus ausgeführt hat (in Pod-Stunden), was diese zu den eigenen Tarifen kosten
und ob die Plattform sie bereits in Rechnung stellt. Ein von einem Agenten beanspruchtes Projekt zählt
erst ab dem Tag der Beanspruchung: Davor gehörte das Projekt der Plattform.

Ein bestehendes Projekt lässt sich ohne Neuerstellung verknüpfen:

```bash
rebase cloud projects list
rebase cloud link --project my-app
```

## Bereitstellen (Deploy)

```bash
rebase cloud deploy
```

Ein einziger Befehl, und kein Flag, das man sich merken müsste. Die `rebase.json` eines Scaffolds
deklariert `runtime: "managed"` für sein Backend, und `deploy` liest diese Deklaration – dies wird
beim Durchlauf gemeldet (`rebase.json declares runtime: managed — deploying a bundle`), baut die App
in `dist-bundle`, lädt das Bundle hoch, führt es auf dem veröffentlichten Runtime-Image aus und
verfolgt das Deployment bis zu einem finalen Zustand. Der Exit-Code ist das Ergebnis, sodass
dieselbe Zeile unbeaufsichtigt in CI funktioniert.

Am Ende wird ausgegeben, wo jede App nun erreichbar ist und ob die neue Version dort live ist:

```text
  ✓ Deployed songbuzz in 1m 12s  (deployment fb3c7442-9937-4179-8d3c-88a106da149d)

    game     static   https://songbuzz.rebase.website      live
    backend  backend  https://songbuzz.rebase.website/api  live

  ✓ Live: the new version answers on every address above.
  Something wrong? `rebase cloud rollback` puts the previous deployment back.
```

„Live“ bedeutet, dass die Adresse nach dem Build geantwortet hat: Das `/health` eines Backends
hat `ok` zurückgegeben, und die Seite einer statischen App wurde geladen (aus diesem Deployment,
wenn die Plattform sie ausliefert). Die Überprüfung wartet bis zu `--live-timeout` Sekunden, standardmäßig
60; `0` überspringt sie. Wenn eine App nicht rechtzeitig antwortet, wird das Deployment dennoch mit
Code 0 beendet, da die Bereitstellung erfolgreich war, und die letzte Zeile gibt an, welche App nicht
geantwortet hat und warum. Ein fehlgeschlagenes Deployment endet stattdessen in einer einzigen Zeile,
die die App und den Grund nennt, mit dem Hinweis auf `rebase cloud logs` für das vollständige Build-Log.

Skripte übergeben `--json` für ein einzelnes Objekt mit denselben Informationen – `apps`, `hosts`,
`live`, `liveChecks`, `durationMs` und die Deployment-ID. Anders als der Rest von `rebase cloud`
wechselt `deploy` bei Pipes nicht automatisch zu JSON.

Was diese Runtime zulässt – Pakete und native Module, Arbeitsspeicher und Instanzen,
Timeouts und Body-Größen, das Dateisystem, Secrets, Storage und ausgehender
Netzwerkverkehr – ist auf einer eigenen Seite beschrieben:
[Managed Backend Runtime](/docs/deployment/managed-runtime/).

Um ein Artefakt auszuliefern, das bereits früher gebaut wurde – beispielsweise ein CI-Job, der einmal
baut und zweimal bereitstellt –, verweisen Sie auf das Verzeichnis, anstatt neu zu bauen:

```bash
rebase build
rebase cloud deploy --bundle-dir dist-bundle
```

Das Verlassen der verwalteten Runtime erfolgt über ein eigenes Flag, `--eject`, und nichts anderes
fordert dazu auf: Ein Build, der ein verwaltetes Projekt auf ein Container-Image verschieben würde,
das es dann selbst verwaltet, wird verweigert, bis Sie dies explizit angeben. Früher bedeutete `--force`
dies, wodurch die am schwersten umkehrbare Aktion der CLI unter demselben Wort lag wie „diese Datei
überschreiben“; es ist jetzt eine unbekannte Option statt eines Alias, sodass ein Skript, das es enthält,
stattdessen abbricht.

### Die Syntaxprüfung vor dem Upload

Die Dateien einer statischen App werden exakt so ausgeliefert, wie sie sind. Wenn deren `build` lediglich
handgeschriebene Skripte nach `output` kopiert, hat nichts sie geparst, und eine Datei mit einem
Tippfehler geht live und verhindert das Laden der Seite. Bevor also etwas hochgeladen wird, parst
`deploy` jede `.js`-, `.mjs`- und `.cjs`-Datei im `output` jeder statischen App sowie jedes Inline-`<script>`
in deren `.html`-Dateien. Das deckt sowohl einzeln bereitgestellte statische Apps ab als auch statische
Apps, die in das Bundle des Backends integriert sind. Ein Syntaxfehler stoppt das Deployment unter Angabe
von Datei, Zeile und Spalte:

```
✗ A syntax error in the static output, so nothing was deployed:
    web/cloud.js:42:23  Unexpected token
        42 |     return fetch("/api";
Fix it and deploy again, or pass --no-verify to deploy anyway.
```

Mit `--json` lautet der `code` des Fehlers `syntax_error`. Inline-Skripte, die ein Browser nicht als
JavaScript ausführt, werden übersprungen: JSON, Import Maps, Templates und jeder andere Nicht-JavaScript-`type`,
ein `<script src>` sowie Skripte, die noch ungerendertes Template-Markup wie `{{ }}` enthalten. Eine
`.js`-Datei besteht die Prüfung, wenn sie sich entweder als klassisches Skript oder als Modul parsen
lässt, da die Seite entscheidet, worum es sich handelt. Nichts unterhalb von `node_modules` wird gelesen,
und ebenso wenig ein vorgefertigtes `--bundle-dir`. `--no-verify` überspringt die Prüfung für ein einzelnes
Deployment.

Überwachung:

```bash
rebase cloud logs               # das Build-Log
rebase cloud logs --runtime -f  # was die laufende App live ausgibt, bis Strg-C
rebase cloud status             # was die Plattform über den Status des Projekts meldet
```

`status` meldet `blockedOn` und `nextAction`. Wenn `blockedOn` den Wert `null` hat, arbeitet die
Plattform wie erwartet und Polling ist das Richtige; wenn dort etwas angegeben ist, wartet dieses
Etwas auf Sie.

## Eine Änderung als Vorschau bereitstellen (Preview)

```bash
rebase cloud deploy --preview
```

Dies baut und lädt genau das hoch, was auch `deploy` hochladen würde, stellt es jedoch unter einer
eigenen Adresse bereit, wie z. B. `https://shop--k3x9ab.rebase.website`. Die Produktion liefert
weiterhin das aus, was sie zuvor ausgeliefert hat. Das Deployment gibt die Vorschauadresse aus,
sobald der Build abgeschlossen ist.

Um eine feste Adresse über mehrere Deployments hinweg beizubehalten, benennen Sie die Preview. Ein erneutes
Deployment unter demselben Namen aktualisiert sie:

```bash
rebase cloud deploy --preview-name new-checkout
```

Womit eine Preview kommuniziert, hängt davon ab, was Sie bereitgestellt haben:

- **`rebase cloud deploy --preview`** erstellt eine Vorschau des Backends inklusive der integrierten
  statischen Apps, genau wie in der Produktion. Es erhält ein eigenes Backend auf einer **eigenen,
  leeren Datenbank**, niemals der Produktionsdatenbank. Ein Start gegen die Produktionsdatenbank
  würde das Schema und die Zugriffsregeln der Preview auf diese anwenden.
- **`rebase cloud deploy web --preview`** würde eine einzelne statische App isoliert in die Vorschau
  bringen, deren Seiten das **Produktions-Backend** aufrufen. Das erfordert eine Control Plane,
  die statische Websites eigenständig ausliefert, was Rebase Cloud derzeit noch nicht unterstützt:
  Es verweigert dies mit `PREVIEW_STATIC_UNSERVED` und veröffentlicht nichts. Stellen Sie stattdessen
  eine Vorschau des Backends bereit, das die integrierten statischen Apps ausliefert; ein Projekt
  ohne verwaltetes Backend kann derzeit noch nicht in die Vorschau gebracht werden.

Eine Preview lädt keinen Quellcode hoch und registriert keine Apps oder Hostnamen, da dies jeweils
das Produktionsprojekt verändern würde. `--source` und `--eject` können nicht mit `--preview`
kombiniert werden. Beide bauen ein Container-Image für die Produktion.

```bash
rebase cloud previews                      # Name, Adresse, App, Backend, Ablaufzeit
rebase cloud logs --preview new-checkout   # das Build-Log; -f verfolgt einen noch laufenden Build
rebase cloud logs --runtime --preview new-checkout -f  # was das Backend ausgibt
rebase cloud previews delete new-checkout  # stoppt die Bereitstellung und löscht die Datenbank
```

`rebase cloud logs` ohne `--preview` bezieht sich immer auf die Produktion.

Die Seite **Deployments** der Konsole listet dieselben Previews auf und ermöglicht das Öffnen,
Anzeigen des Build-Logs oder Löschen der einzelnen Previews. Das Erstellen bleibt ein CLI-Schritt.

Eine Preview läuft eine Woche nach dem letzten Deployment ab.

Nach Abschluss prüft das Deployment, ob die Vorschauadresse antwortet, genau wie bei einem
Produktions-Deployment (`--live-timeout <seconds>`, `0` zum Überspringen). Das Zertifikat einer
neuen Preview kann ein bis zwei Minuten dauern, sodass ein erfolgreiches Deployment melden kann,
dass die Adresse noch nicht antwortet.

Eine Backend-Preview wird wie eine App-Einheit in der Standardgröße abgerechnet (100m CPU
und 384 MiB Arbeitsspeicher, zum Tarif Ihrer App für deren Region und Kapazität), anteilig für
die Dauer ihres Bestehens, und erscheint im monatlichen Kostenvoranschlag des Projekts in der
Konsole. `rebase cloud deploy --preview` gibt denselben Kostenvoranschlag dafür pro Monat aus
(`cost` unter `--json`). Das Starten einer Preview erfordert eine hinterlegte Karte, genau wie ein
Produktions-Deployment. Ein erstes Deployment, das fehlschlägt, bevor irgendetwas läuft, wird
entfernt statt in Rechnung gestellt. Ein Projekt darf bis zu drei Backend-Previews gleichzeitig ausführen.

Jede neue Vorschauadresse erhält ein eigenes TLS-Zertifikat von Let's Encrypt. Let's Encrypt erlaubt
einer Domain 50 neue Zertifikate pro Woche, geteilt mit allen Produktionsseiten darauf. Previews
dürfen innerhalb von 7 Tagen plattformweit 20 davon beanspruchen. Darüber hinaus wird eine neue
Preview verweigert (`429`, `preview_cert_budget`), unter Angabe des Zeitpunkts, ab dem sie wieder
bereitgestellt werden kann; das erneute Bereitstellen einer bereits existierenden Preview zählt nie dazu.

Die Datenbank einer Backend-Preview ist eine zweite Datenbank auf dem Postgres der **Produktion**:
eigene Daten, aber dieselbe Instanz und dieselbe Festplatte. Sie ist auf 10 Verbindungen limitiert,
damit Previews nicht die Verbindungen der Produktion aufbrauchen, und auf 2 GB: Eine Preview, deren
Datenbank darüber hinaus anwächst, wird pausiert. Ihr Backend stoppt, ihre Adresse antwortet nicht
mehr, `rebase cloud previews` und die Konsole zeigen sie mit dem entsprechenden Grund als `paused` an,
und die Eigentümer und Administratoren des Projekts werden benachrichtigt (`preview.paused`). Ihre
Daten bleiben bis zum Ablauf erhalten. Stellen Sie sie erneut bereit, um sie zu starten (sie wird erneut
pausiert, solange die Datenbank noch zu groß ist), oder löschen Sie sie. Eine pausierte Preview wird
weiterhin abgerechnet, bis sie gelöscht wird oder abläuft. Löschen Sie Previews, die Sie nicht mehr
benötigen. In der Produktion installierte Extensions werden in der Datenbank einer Preview nicht installiert.

Previews werden schrittweise eingeführt. Eine Control Plane, die sie noch nicht unterstützt, verweigert
`--preview` mit `previews_unavailable` und stellt nichts bereit.

## Rollback

```bash
rebase cloud deployments
rebase cloud rollback
```

Ein Rollback verweist das Projekt wieder auf den Stand eines früheren erfolgreichen Deployments und
baut niemals neu – der Wert eines Rollbacks liegt darin, dass ein Artefakt ausgeliefert wird, das
bereits erfolgreich gelaufen ist.

Welche Deployments infrage kommen, hängt davon ab, wie das Projekt bereitgestellt wurde; beide Arten
funktionieren:

| Art der Bereitstellung | Was wiederhergestellt wird |
|---|---|
| `rebase cloud deploy` (ein Quellcode-Build) | Das von diesem Build veröffentlichte Image |
| `rebase cloud deploy --bundle` (die Plattform-Runtime) | Das von diesem Deployment ausgelieferte Bundle auf der Runtime-Version, die das Projekt jetzt ausführt |

Statische Apps, die in das Bundle des Backends integriert sind (ein einfaches `rebase cloud deploy`
auf einem Projekt mit Backend), sind Teil dieses Bundles und werden daher mit diesem zurückgesetzt.

Eine isoliert bereitgestellte statische App (`rebase cloud deploy <app>`) kann derzeit noch nicht
zurückgesetzt werden. Ihr Deployment protokolliert, welche App veröffentlicht wurde, aber kein Bundle,
sodass der Control Plane die Grundlage für eine Wiederherstellung fehlt. Die Lösung besteht darin,
die letzte funktionierende Version erneut bereitzustellen, beispielsweise aus dem Commit vor dem
fehlerhaften. Nach einem solchen Deployment weist `deploy` hierauf hin, anstatt auf `rollback` zu
verweisen, und `rollback` ohne ID verweigert die Ausführung, anstatt das ausliefernde Backend erneut
bereitzustellen.

Ein Rollback erfordert daher ein Deployment, das eines von beiden protokolliert hat, was ein Projekt
voraussetzt, das mindestens zweimal erfolgreich bereitgestellt wurde. `rebase cloud deployments` markiert
diejenigen, die infrage kommen, und `--json` gibt `rollbackable` pro Zeile zusammen mit dem `image`
oder `bundle` an, das wiederhergestellt werden würde.

Zwei Arten von Deployments werden abgewiesen, und die CLI nennt den Grund: eines, das nicht erfolgreich
war, und eines aus der Zeit, bevor die Plattform sein Artefakt protokolliert hat. In beiden Fällen gibt
es keinen Raum für Vermutungen – Vermutungen würden das ausliefern, was zuletzt gebaut oder hochgeladen
wurde, während behauptet wird, dieses wiederherzustellen –, stellen Sie stattdessen die gewünschte Version bereit.

Jedes erfolgreiche Deployment endet mit der Nennung des Rückwegs (`rebase cloud rollback`), sodass
er in dem Moment sichtbar ist, in dem ein fehlerhaftes Release bemerkt wird.

Ein Rollback fügt ein neues Deployment an, anstatt die Historie zurückzuspulen, und wartet, bis die
wiederhergestellte Version Anfragen bedient, bevor der Erfolg gemeldet wird. Verfolgen Sie dies mit
`rebase cloud logs -f`.

## Die Datenbank auf einen bestimmten Zeitpunkt wiederherstellen (PITR)

Eine verwaltete Datenbank kann auf jede beliebige Minute innerhalb ihres Wiederherstellungsfensters
zurückgesetzt werden, über **Database → Backups** in der Konsole oder über die CLI:
`rebase cloud db pitr status | restore --target <ISO> | cutover | discard`.
Dies geschieht in zwei Schritten. Zunächst wird eine wiederhergestellte Kopie neben der Live-Datenbank
bereitgestellt; Ihre App läuft auf der Live-Datenbank weiter, und der Speicherplatz der Kopie wird
in Rechnung gestellt, bis Sie umschalten (Cutover) oder sie verwerfen.
Sobald die Kopie bereit ist, verweist das Umschalten die App auf diese und startet sie neu. Alles,
was nach dem Zielzeitpunkt geschrieben wurde, ist in der Kopie nicht enthalten. Die ursprüngliche
Datenbank bleibt als Rückweg erhalten und wird weiterhin für den Speicher abgerechnet; das Zurückwechseln,
Entfernen oder ein zweiter Wiederherstellungsvorgang erfolgt über den Support. Nur ein Eigentümer
oder Administrator kann die Bereitstellung, das Umschalten oder das Verwerfen durchführen, und die
Konsole fragt vor dem Umschalten nach dem Namen des Projekts.

## Schützen Sie Ihr Konto

Ihr Konsolenkonto hat Zugriff auf Produktionsdatenbanken, Secrets und die Abrechnung; schützen
Sie es entsprechend. Öffnen Sie **Account security** über das Menü unter Ihrem Avatar in der
Konsole (oder gehen Sie zu `/account`). Diese Seite gehört Ihnen, nicht einer Organisation: Was Sie
dort festlegen, gilt für jede Organisation, der Sie angehören.

- **Zwei-Schritt-Verifizierung.** Aktivieren Sie diese mit einer beliebigen Authentifikator-App
  (1Password, Google Authenticator, Authy). Die Seite zeigt einen Einrichtungsschlüssel zum
  Hinzufügen in die App oder einen Link, der die App auf einem Smartphone mit vorausgefülltem
  Schlüssel öffnet, und fragt anschließend nach dem 6-stelligen Code aus der App. Von da an
  erfordert jede Anmeldung einen Code, unabhängig davon, ob Sie sich mit Passwort, Google oder
  GitHub anmelden.
- **Wiederherstellungscodes.** Bei der Aktivierung erhalten Sie zehn einmalig verwendbare Codes,
  die einmalig angezeigt werden. Jeder davon ermöglicht die Anmeldung anstelle des Authentifikator-Codes,
  falls Sie Ihr Smartphone verlieren; speichern Sie diese also, bevor Sie den Dialog schließen.
  **New recovery codes** ersetzt sie, und die alten Codes werden ungültig. Sowohl das Deaktivieren
  der Zwei-Schritt-Verifizierung als auch das Generieren neuer Codes erfordern zunächst die Eingabe
  eines Codes.
- **Passwort.** Eine Änderung meldet Sie auf allen anderen Geräten ab. Ein über Google, GitHub
  oder LinkedIn erstelltes Konto hat kein Passwort; die Seite bietet an, Ihnen einen Link zum
  Festlegen eines Passworts per E-Mail zu senden.
- **Angemeldete Geräte.** Jeder Browser und jedes Terminal, das bei Ihrem Konto angemeldet ist,
  mit Adresse und Anmeldezeitpunkt. Melden Sie unbekannte Geräte ab, oder alle Geräte auf einmal.

[Zugriffstoken](/docs/deployment/cloud-agents/#ci-and-agents) sind keine Sitzungen und verlangen
keinen zweiten Faktor, sodass CI nach der Aktivierung weiterhin bereitstellen kann. Widerrufen Sie
ein Token, dem Sie nicht mehr vertrauen, unter **Settings → Access tokens**.

## Laden Sie Ihr Team ein

**Members → Invite member** liefert einen Link zum Kopieren (wird per E-Mail versendet, sofern
diese Control Plane E-Mails verschickt), der einmalig und für 7 Tage für ein Konto gültig ist,
das diese Adresse verifiziert hat; der Beitritt erfolgt erst nach Annahme. Laden Sie einen Administrator
oder ein Mitglied ein, und ernennen Sie sie nach dem Beitritt zum Eigentümer. Eigentümer und
Administratoren können die Einladung unter **Pending invitations** einsehen, erneut senden oder
widerrufen; im Terminal über [`rebase cloud orgs members invite`](/docs/cli/cloud/#organizations).

## Nachvollziehen, wer was getan hat

Die Seite **Activity** der Konsole sowie `rebase cloud activity` zeigen den Eigentümern und
Administratoren der Organisation, wer wann bereitgestellt hat, Umgebungsvariablen gesetzt oder
aufgedeckt hat (nach Name, niemals nach Wert), eine Domain geändert, ein Backup wiederhergestellt,
ein Projekt in der Größe verändert, gestoppt oder gelöscht, die Rolle eines Mitglieds geändert
oder ein Token erstellt hat. Die **Settings** eines Projekts verlinken auf dessen eigene Einträge;
Einträge zu einem gelöschten Projekt bleiben erhalten. Ein Skript liest diese mit einem Token aus,
das mit `--can audit` für die Organisation erstellt wurde. Einträge werden ein Jahr lang aufbewahrt.
Die Filter finden sich unter [`rebase cloud`](/docs/cli/cloud/#organizations).

## CI und Agenten

Ein CI-Job oder ein Agent sollte nicht Ihr Passwort enthalten. Vergeben Sie ein Token, das auf
wenige Aktionen für ein einzelnes Projekt beschränkt ist, erstellt von einem angemeldeten Terminal
mit `rebase cloud tokens create --project shop --can deploy,logs`, und setzen Sie es als
`REBASE_TOKEN`. Abrechnung, Aktivitätsprotokoll und Benachrichtigungseinstellungen einer Organisation
sind eigenständige Berechtigungen (`--can billing`, `audit`, `notifications`), die ein Token nur
auf explizite Anforderung enthält. Die Berechtigungen, ein GitHub Actions-Workflow und welche Rechte
einer angemeldeten Person vorbehalten bleiben, finden sich unter
[CI und Agenten](/docs/deployment/cloud-agents/#ci-and-agents).

## Ein Backend ohne Konto

`rebase cloud init --claim` stellt einer App ein Live-Backend bereit, bevor sich jemand registriert
hat, und gibt eine Claim-URL aus, über die die Person es behalten kann; ein Projekt, das innerhalb
von 72 Stunden niemand beansprucht, wird gelöscht. Was das Token des unbeanspruchten Projekts darf,
das `REBASE_API_TOKEN`, das es schreibt, und was sich durch die Beanspruchung ändert, ist beschrieben unter
[Ein Backend ohne Konto](/docs/deployment/cloud-agents/#a-backend-with-no-account).

## Compute-Ressourcen und Kosten

Der Preis eines Projekts richtet sich nach den reservierten Ressourcen, nicht nach Tarifen.
`compute` gibt jede Einstellung und den detaillierten Kostenvoranschlag der Control Plane dafür aus.
(`rebase cloud resources` ist etwas anderes: die im Code deklarierten Datenbanken und Buckets
sowie deren Bereitstellungsstatus – siehe die [CLI-Referenz](/docs/cli/cloud/).)

```bash
rebase cloud compute
rebase cloud compute set --cpu 500m --memory 2Gi
```

| Einstellung | Einheit und Bedeutung |
|---|---|
| `--cpu`, `--memory` | App-Anforderung pro Instanz, z. B. `500m` und `2Gi`. Leer bedeutet Plattformstandard – `100m` und `384Mi`, mit Bursts bis zu 2 CPU und `2Gi` |
| `--replicas` | Instanzen, die immer existieren: die Untergrenze des Autoscalers und das, was das Abonnement des Projekts monatlich abrechnet |
| `--autoscale-max` | 1–16. Die Obergrenze, die erreicht werden darf. Instanzen, die der Autoscaler über `--replicas` hinaus hinzufügt, werden pro Pod-Sekunde zu denselben Tarifen abgerechnet und nur dort berechnet, wo die Plattform dies aktiviert hat; **Usage this month** zeigt dies an. `--no-autoscale` schaltet es ab |
| `--autoscale-cpu-target` | 10–95. Die CPU-Auslastung, die der Autoscaler anstrebt, bezogen auf den angeforderten Wert (Request) statt auf das Limit. Leer bedeutet 70 |
| `--spot` | `true` oder `false`. Preemptible Kapazität: günstiger und wird ohne Vorankündigung neu gestartet |
| `--db-instances` | 1–3. `1` ist eine Einzelinstanz ohne Failover; `2` fügt ein automatisches Standby hinzu |
| `--db-cpu`, `--db-memory` | Pro Datenbankinstanz. Leer bedeutet `160m` und `1Gi` |

Eine leere Einstellung ist nicht dasselbe wie eine, die auf denselben Wert festgelegt ist: Eine
leere Einstellung folgt dem Plattformstandard und ändert sich mit diesem.

Von der CLI wird bewusst nichts validiert – die Limits gehören zu dem Cluster, auf dem ein
Projekt läuft, und unterscheiden sich je nach Anbieter. Die Control Plane lehnt einen Wert ab,
den sie nicht erfüllen kann, und benennt das Feld. Führen Sie `rebase cloud compute` aus, um
den monatlichen Betrag vor und nach der Änderung zu sehen; eine Änderung gilt sofort und wird
ab heute anteilig berechnet, mit Ausnahme von Änderungen, die einen Neustart der Datenbank
erfordern – diese warten auf ein Wartungsfenster.

## Der restliche Funktionsumfang

| Befehlsgruppe | Was sie abdeckt |
|---|---|
| `login`, `logout`, `whoami`, `access-token` | Ihre Sitzung; `access-token` gibt den Bearer aus, den die CLI jetzt senden würde, für Skripte und den MCP-Server |
| `tokens` | Tokens für CI und Agenten, jeweils auf ein Projekt beschränkt. Siehe [CI und Agenten](/docs/deployment/cloud-agents/#ci-and-agents) |
| `link`, `unlink`, `use`, `open` | Verknüpfen dieses Verzeichnisses mit einem Projekt, Auswählen einer Organisation, Öffnen der Konsole |
| `connect` | Hinzufügen eines selbst gehosteten Rebase-Servers zu Ihrem Konto, damit der [Rebase-Connector](/docs/ai/rebase-connector/#add-your-self-hosted-instances) in Claude diesen neben Ihren Cloud-Projekten erreicht. `--list` zeigt sie an, `--remove` entfernt einen. Eigentümer und Admins |
| `init`, `claim` | Mit `--claim`: ein Live-Backend ohne Konto und ein Link, um es zu beanspruchen; `claim` gibt diesen Link erneut aus. Siehe [Ein Backend ohne Konto](/docs/deployment/cloud-agents/#a-backend-with-no-account) |
| `projects` | Erstellen, Auflisten, Überprüfen, Löschen |
| `deploy`, `logs`, `deployments`, `rollback`, `cancel` | Bereitstellen und Überwachen |
| `deploy-hooks` | Geheime URLs, die ein Git-Host oder CI aufruft, um das Projekt bereitzustellen: auflisten, erstellen (die URL wird einmalig angezeigt), widerrufen. |
| `previews` | Builds, die von `deploy --preview` unter einer eigenen Adresse bereitgestellt werden, und deren Löschung. Siehe [Eine Änderung als Vorschau bereitstellen](#eine-änderung-als-vorschau-bereitstellen-preview) |
| `start`, `stop`, `restart` | Pausieren eines Projekts und Wiederhochfahren. Ein gestopptes Projekt behält sein Abonnement, es sei denn, die Plattform berechnet für gestoppte Projekte nur Speicherplatz und Plattformgebühr; die Zeile **Billing** der Konsole weist darauf hin, falls dies der Fall ist |
| `status`, `metrics`, `debug` | Was es tut und warum es das eventuell nicht tut |
| `alerts` | Die offenen Vorfälle des Projekts sowie das Bestätigen oder Zurückstellen eines Vorfalls. |
| `cron` | Die Cron-Jobs der bereitgestellten App und deren aufgezeichnete Ausführungen, ausgelesen mit Ihrem `rebase cloud`-Login. Schreibgeschützt |
| `env` | Umgebungsvariablen. `list` gibt niemals Werte aus; `--secret` ist lesegeschützt (Write-only) |
| `app-key` | Der Schlüssel, den `init --claim` als `REBASE_API_TOKEN` in `.env` geschrieben hat und der bei der Beanspruchung übergeben wird; `rotate` ersetzt ihn und widerruft den alten. Eigentümer und Admins |
| `service-key` | `REBASE_SERVICE_KEY`, Admin-Rechte auf der API der App selbst: wann er zuletzt rotiert wurde; `rotate` weist der App einen neuen zu. Eigentümer und Admins |
| `domains` | Eigene Domains, die hinzuzufügenden DNS-Einträge und Verifizierung. Ein Projekt kann unter mehreren Domains erreichbar sein, die jeweils separat verifiziert werden; `verify` und `remove` akzeptieren die betreffende Domain, die nur weggelassen werden darf, wenn genau eine vorhanden ist (bei `verify` eine noch ausstehende). Jede verifizierte Domain liefert das Projekt direkt aus; `primary <domain>` wählt die kanonische Domain und `redirect <domain>` leitet eine andere mit 308 dorthin weiter, Pfad und Query bleiben erhalten (`--off` liefert sie wieder direkt aus) – tun Sie dies für `www.` neben einer Apex-Domain, da Google-Anmeldung, Cookies und Passkeys pro Origin gelten. Eine Domain, auf der eine bestimmte App bereitgestellt wird (ein App-`path` mit Hostname), leitet niemals weiter. `list --json` gibt `{ projectId, tenantHost, domains: [...] }` zurück |
| `db` | Datenbank anbinden oder erstellen, Verbindung von Ihrem Rechner aus herstellen, Backups, Wiederherstellung und Point-in-Time-Recovery |
| `guests` | Gastbenutzer, die durch anonyme Anmeldungen zurückgeblieben sind: zählen, einzelne löschen, lange inaktive bereinigen. Siehe [Gäste](/docs/cli/cloud/#guests). Eigentümer und Admins |
| `extensions` | Die Allowlist für Postgres-Extensions |
| `storage` | Der Bucket des Projekts |
| `resources` | Welche Datenbanken und Buckets die Plattform vorhält, im Vergleich zu dem, was der Code deklariert |
| `compute` | Was dieses Projekt reserviert, was es kostet und wie man es ändert |
| `events` | Ereignisse im Backend, die neuesten zuerst: Skalierung der App, geplante und angewendete Datenbankänderungen, Übernahme durch ein Standby, Vergrößerung der Festplatte |
| `usage` | Verbrauchte Anfragen in diesem Monat im Vergleich zum enthaltenen Kontingent und bisherige Mehrkosten gemäß Rechnungszählung. `usage org` listet alle Projekte der Organisation auf |
| `clusters` | Die Cluster, auf denen die Mandanten laufen. Nur für Plattform-Admins |
| `settings`, `orgs`, `billing` | Projekteinstellungen, Organisationen und deren Mitglieder und Einladungen, Bezahlung |
| `activity` | Das Audit-Log der Organisation: wer bereitgestellt hat, eine Umgebungsvariable (nach Name), eine Domain, ein Backup, ein Mitglied oder ein Token geändert hat. Eigentümer und Admins. Siehe [Nachvollziehen, wer was getan hat](#nachvollziehen-wer-was-getan-hat) |
| `notifications` | Wohin die Ereignisse des Projekts per POST gesendet werden: Slack, Discord oder jede beliebige HTTPS-URL ([Cloud-Benachrichtigungen](/docs/deployment/cloud-notifications/)) |

Jede Gruppe in dieser Tabelle antwortet auf `--help` mit einer eigenen Hilfeseite – Verwendungszeile,
Flags und Beispiele – und `--help` führt den Befehl niemals aus. Ein Test überwacht den Index
dieser Seiten; eine ohne Seite hinzugefügte Gruppe führt zum Fehlschlagen des Builds, anstatt das
Inhaltsverzeichnis anzuzeigen. `verify:docs` bindet die Tabelle selbst an diesen Index: Jede von
der CLI verarbeitete Gruppe erscheint hier genau einmal, sodass eine Gruppe ohne Tabellenzeile
ebenfalls zum Fehlschlagen des Builds führt.

Über eine Pipe antwortet `--help` stattdessen in JSON: dieselbe Verwendungszeile, Flags und Beispiele
als lesbare Datenstruktur statt sechzig Zeilen Terminal-Escape-Sequenzen.

## Was die Beta noch nicht enthält

Klar ausgesprochen, da es schlechter ist, dies erst später festzustellen:

- **Keine freie Regionswahl.** Alles läuft derzeit in einer einzigen Region. Das Placement-Modell
  existiert in der Plattform, ein Projekt kann die Region jedoch noch nicht wählen.
  `projects create --provider` und `--region` sind nicht die Ausnahme, nach der sie aussehen: Sie
  halten fest, zu welchem der registrierten Deployment-Ziele der Control Plane ein Projekt gehört.
  Da es nur eines gibt, fallen beide standardmäßig darauf zurück, und keines von beiden verschiebt
  ein Projekt an einen anderen Ort. `rebase cloud projects create --help` weist auf dasselbe hin.
- **Kein Self-Service.** Der Zugang wird in Wellen gewährt; es gibt keine direkte Registrierung mit Bezahlung.
- **Kein veröffentlichtes SLA** und kein SOC 2. Wenn Sie eines davon benötigen, geben Sie dies bei
  der Zugangsanfrage an, anstatt es vorauszusetzen.
- **Keine Branch-Deployments** und keine offizielle GitHub-App. Deploy-Hooks – geheime URLs, auf die
  ein Repository-Webhook verweist – sind die unterstützte Automatisierung. [Preview-Deployments](#eine-änderung-als-vorschau-bereitstellen-preview)
  werden schrittweise eingeführt und über die CLI gestartet.
- **Tokens handeln im Namen einer Person.** Ein [Token](/docs/deployment/cloud-agents/#ci-and-agents)
  wird von einem Benutzerkonto ausgestellt und handelt in dessen Namen; es gibt noch keine organisationsbezogene
  Maschinenidentität. Wenn Sie sich stattdessen über CI anmelden, übergeben Sie `REBASE_CLOUD_EMAIL`
  und `REBASE_CLOUD_PASSWORD` aus einem Secret-Store – `--password` schreibt das Passwort in Ihre
  Shell-Historie und in die Prozesstabelle und warnt davor, bevor es Sie anmeldet. Wenn die
  `.rebase/cloud.json` des Repositories eine andere Control Plane als die plattform-eigene benennt,
  übergeben Sie diese ebenfalls als `--url`: Ohne Terminal weigert sich `login`, ein Passwort an
  einen Host zu senden, der nur durch die ausgecheckte Datei benannt wurde.
- **Kein öffentlicher Datenbank-Endpunkt.** Eine verwaltete Datenbank ist nicht über das Internet
  zugänglich, sodass der in der Konsole angezeigte Host die interne Adresse Ihres Backends dafür ist
  und auf Ihrem Rechner ins Leere läuft. `rebase cloud db connect` öffnet einen lokalen Port, der
  über die Control Plane getunnelt wird und diese Datenbank darstellt, solange Sie ihn laufen lassen – aber
  es gibt keinen dauerhaften Hostnamen, mit dem sich ein Drittanbieterdienst verbinden könnte. Dieser
  Tunnel sowie das Passwort hinter `rebase cloud db info --reveal` erfordern beide die Rolle des
  Eigentümers oder Administrators der Organisation: dieselbe, die auch der SQL-Editor von Studio verlangt,
  da alle drei zu einer Sitzung auf Ihren Produktionsdaten führen.
- **Deployment bedeutet Codeausführung mit Produktions-Secrets.** Die Umgebung der App enthält
  `REBASE_SERVICE_KEY` (Admin-Rechte auf der eigenen API), `DATABASE_URL` und `JWT_SECRET`, sodass
  Code, den ein Mitglied bereitstellt, diese auslesen kann, auch wenn nur Eigentümer und Administratoren
  sie in der Konsole einsehen dürfen. Laden Sie nur Personen als Mitglieder ein, denen Sie diese
  Werte anvertrauen würden.
- **Der Service-Key kann ersetzt werden.** In den **Settings** des Projekts
  (oder über `rebase cloud service-key rotate`) kann ein neuer `REBASE_SERVICE_KEY` generiert
  und die App damit neu gestartet werden. Der alte Schlüssel funktioniert noch bis zum Abschluss
  des Neustarts und danach nicht mehr, sodass alle Stellen, die ihn kopiert haben, ab diesem
  Zeitpunkt abgewiesen werden. Die Beanspruchung eines Projekts verhält sich genauso.

## Stattdessen selbst hosten

Nichts hier bedeutet einen Lock-in. Der [Leitfaden zum Self-Hosting](/docs/deployment/self-hosting/)
führt das identische Image und Bundle mit `docker compose` aus, und der
[Kubernetes-Leitfaden](/docs/deployment/kubernetes/) bildet dieselbe Topologie über das Helm-Chart ab.
