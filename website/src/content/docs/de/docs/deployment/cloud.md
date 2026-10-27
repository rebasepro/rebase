---
sourceHash: cbd1289dcc8b5347
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

**Mit Google, GitHub oder LinkedIn registriert?** <span class="since-badge" data-since="0.26">Seit 0.26</span> Ihr Konto hat kein Passwort, melden Sie sich also stattdessen mit einem Code an:

```bash
rebase cloud login --code --email me@example.com
```

Die Control Plane schickt Ihnen per E-Mail einen 6-stelligen Code, der zehn Minuten gültig ist, und Sie geben ihn an der Eingabeaufforderung ein. Wird `rebase cloud login` einfach in einem Terminal ausgeführt, fragt es, ob Sie Ihr Passwort oder einen Code verwenden möchten. Codes setzen voraus, dass die Control Plane E-Mails versenden kann; ist das nicht der Fall, sagt `--code` das und beendet sich mit `otp_unavailable`.

Wenn Sie die Zwei-Faktor-Authentifizierung aktiviert haben, fragt `login` anschließend nach dem Code aus Ihrer Authenticator-App oder nach einem Ihrer Wiederherstellungscodes, egal auf welchem Weg Sie sich angemeldet haben. Weder ein Anmeldecode noch ein zweiter Faktor lässt sich ohne Terminal eingeben. Erstellen Sie für ein Skript in der Konsole ein Zugriffstoken (**Settings → Access tokens**) und setzen Sie `REBASE_TOKEN`; siehe [CI und Agents](/docs/deployment/cloud-agents/#ci-and-agents).

Ein falsches Passwort wird mit `invalid_credentials` beantwortet, zusammen mit denselben zwei Wegen zur Anmeldung, da die häufigste Ursache ein Konto ist, das nie eines hatte.

`billing setup` hinterlegt einmalig eine Zahlungskarte für die Organisation. Es steht absichtlich
an erster Stelle der Sequenz: Das erste Deployment eines Projekts wird ohne hinterlegte Karte abgelehnt, und
dies erst nach dem vollständigen Upload eines Bundles zu erfahren, wäre die schlechtere Reihenfolge.

Danach listet die Seite **Billing** der Konsole die Rechnungen der Organisation auf, jeweils mit der von Stripe gehosteten Seite und dem PDF, und zeigt eine Vorschau der nächsten Rechnung jedes Projekts. `rebase cloud billing invoices` und `rebase cloud billing upcoming` geben dasselbe aus. Beides ist den Owners und Admins der Organisation vorbehalten. Wo die Plattform es anbietet, öffnet **Manage billing** das Stripe-Kundenportal für die Karte, die Rechnungsdaten und frühere Rechnungen.

Ist bereits eine Karte hinterlegt, verlangt das Anlegen eines weiteren Projekts in der Konsole keine zweite Zahlung: Das Projekt wird über diese Karte abgerechnet und deployt. Wird die Karte abgelehnt oder will die Bank die Zahlung bestätigen lassen, führt die Konsole Sie zu **Billing**, wo **Fix your card** eine andere Karte speichert und **Complete the payment** die Stripe-Rechnung öffnet.

Was ein Projekt verbraucht hat, zeigt seine Übersicht unter **Usage this month** und für alle Projekte auf einmal die Seite **Billing**: Anfragen im Verhältnis zum enthaltenen Kontingent (der Balken wird bei 80 % gelb), 5xx-Fehler, die bisherige Überschreitung und wohin sich der Monat in diesem Tempo entwickelt. Die Überschreitung wird vom selben Code berechnet, der sie an Stripe meldet, ist also das, was die Rechnung enthalten wird; sie erscheint auf der Rechnung des Folgemonats. `rebase cloud usage` gibt dasselbe aus und `rebase cloud usage org` die gesamte Organisation. Jedes Mitglied kann es lesen. Die Zahlen sagen, was sie noch nicht sehen können: Object Storage wird nicht gemessen, daher wird keine Storage-Überschreitung berechnet; solange ein Projekt zwei oder mehr App-Pods betreibt, werden seine Anfragen nicht gezählt; und ein Tag mit fehlenden Messwerten führt zu einer Untererfassung. Ein automatisch skaliertes Projekt zeigt außerdem die Pods, die es oberhalb von `--replicas` betrieben hat, in Pod-Stunden, was sie zu seinen eigenen Tarifen kosten und ob diese Plattform sie bereits berechnet. Bei einem Projekt, das von einem Agenten übernommen wurde, zählen nur die Tage ab der Übernahme: Davor gehörte das Projekt der Plattform.

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
  Something wrong? `rebase cloud rollback` puts the previous deployment back.
```

„Live“ heißt, dass die Adresse nach dem Build geantwortet hat: `/health` des Backends lieferte `ok`, und die Seite einer statischen App wurde geladen (aus diesem Deployment, wenn die Plattform sie ausliefert). Die Prüfung wartet bis zu `--live-timeout` Sekunden, standardmäßig 60; `0` überspringt sie. Antwortet eine App nicht rechtzeitig, endet das Deployment trotzdem mit Exit-Code null, weil es erfolgreich war, und die letzte Zeile sagt, welche App nicht geantwortet hat und warum. Ein fehlgeschlagenes Deployment endet stattdessen mit einer Zeile, die die App und den Grund nennt; das vollständige Build-Log zeigt `rebase cloud logs`.

Skripte übergeben `--json` und erhalten ein Objekt mit denselben Fakten – `apps`, `hosts`, `live`, `liveChecks`, `durationMs` und die Deployment-ID. Anders als der Rest von `rebase cloud` wechselt `deploy` bei Pipes nicht von selbst zu JSON.

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

<span class="since-badge" data-since="0.26">Seit 0.26</span>

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
rebase cloud logs               # the build log
rebase cloud logs --runtime -f  # what the running app prints, live, until Ctrl-C
rebase cloud status             # what the platform thinks the project is doing
```

`status` meldet `blockedOn` und `nextAction`. Wenn `blockedOn` gleich `null` ist,
arbeitet die Plattform tatsächlich und Polling ist das Richtige; wenn dort etwas
angegeben ist, wartet dieses Etwas auf Sie.

## Eine Änderung in der Vorschau ansehen

<span class="since-badge" data-since="0.26">Seit 0.26</span>

```bash
rebase cloud deploy --preview
```

Das baut und lädt exakt das hoch, was `deploy` auch hochladen würde, liefert es aber unter einer eigenen Adresse aus, etwa `https://shop--k3x9ab.rebase.website`. Die Produktion liefert weiter aus, was sie vorher ausgeliefert hat. Das Deployment gibt die Adresse der Vorschau aus, sobald der Build fertig ist.

Um eine Adresse über mehrere Deployments hinweg beizubehalten, geben Sie der Vorschau einen Namen. Wird derselbe Name erneut deployt, aktualisiert das die Vorschau:

```bash
rebase cloud deploy --preview-name new-checkout
```

Womit eine Vorschau spricht, hängt davon ab, was Sie deployt haben:

- **`rebase cloud deploy --preview`** zeigt das Backend in der Vorschau, mit seinen eingebetteten statischen Apps, so wie die Produktion sie ausführt. Es erhält ein eigenes Backend auf einer **eigenen, leeren Datenbank**, niemals der der Produktion. Ein Start gegen die Datenbank der Produktion würde das Schema und die Zugriffsregeln der Vorschau auf sie anwenden.
- **`rebase cloud deploy web --preview`** würde eine einzelne statische App für sich in der Vorschau zeigen, wobei ihre Seiten das **Produktions**-Backend aufrufen. Dafür braucht es eine Control Plane, die statische Sites eigenständig ausliefert, und Rebase Cloud tut das noch nicht: Es lehnt mit `PREVIEW_STATIC_UNSERVED` ab und veröffentlicht nichts. Zeigen Sie stattdessen das Backend in der Vorschau, das die darin eingebetteten statischen Apps ausliefert; ein Projekt ohne verwaltetes Backend lässt sich noch nicht in der Vorschau zeigen.

Eine Vorschau lädt keinen Quellcode hoch und registriert weder Apps noch Hostnamen, denn jedes davon würde das Produktionsprojekt ändern. `--source` und `--eject` lassen sich nicht mit `--preview` kombinieren. Beide bauen ein Container-Image für die Produktion.

```bash
rebase cloud previews                      # name, address, app, backend, expiry
rebase cloud logs --preview new-checkout   # its build log; -f follows a build still running
rebase cloud logs --runtime --preview new-checkout -f  # what its backend prints
rebase cloud previews delete new-checkout  # stops serving it and drops its database
```

`rebase cloud logs` ohne `--preview` zeigt immer die der Produktion.

Die Seite **Deployments** der Konsole listet dieselben Vorschauen auf und öffnet jede, zeigt ihr Build-Log oder löscht sie. Eine anzulegen bleibt ein CLI-Schritt.

Eine Vorschau läuft eine Woche nach dem letzten Deployment auf sie ab.

Wenn das Deployment fertig ist, prüft es, ob die Adresse der Vorschau antwortet, wie ein Produktions-Deployment es tut (`--live-timeout <seconds>`, `0` zum Überspringen). Das Zertifikat einer neuen Vorschau kann ein bis zwei Minuten brauchen, sodass ein erfolgreiches Deployment melden kann, dass die Adresse noch nicht antwortet.

Eine Backend-Vorschau wird wie eine App-Einheit in der Standardgröße abgerechnet (100m CPU und 384 MiB Speicher, zum Tarif Ihrer App für ihre Region und Kapazität), anteilig für die Dauer ihres Bestehens, und sie erscheint im monatlichen Angebot des Projekts in der Konsole. `rebase cloud deploy --preview` gibt dasselbe Angebot dafür aus, pro Monat (`cost` bei `--json`). Das Starten einer Vorschau setzt eine hinterlegte Karte voraus, wie bei einem Produktions-Deployment. Ein erstes Deployment, das fehlschlägt, bevor irgendetwas läuft, wird entfernt statt abgerechnet. Ein Projekt darf drei Backend-Vorschauen gleichzeitig betreiben.

Jede neue Vorschau-Adresse erhält ein eigenes TLS-Zertifikat von Let's Encrypt, das einer Domain 50 neue Zertifikate pro Woche erlaubt, geteilt mit jeder Produktions-Site darauf. Vorschauen dürfen davon 20 in beliebigen 7 Tagen verbrauchen, plattformweit. Darüber hinaus wird eine neue Vorschau abgelehnt (`429`, `preview_cert_budget`), mit dem Zeitpunkt, ab dem sie deployt werden kann; das erneute Deployen einer bereits bestehenden Vorschau zählt nie mit.

Die Datenbank einer Backend-Vorschau ist eine zweite Datenbank im Postgres der **Produktion**: eigene Daten, aber dieselbe Instanz und derselbe Datenträger. Sie ist auf 10 Verbindungen begrenzt, damit Vorschauen die der Produktion nicht aufbrauchen können, und auf 2 GB: Eine Vorschau, deren Datenbank darüber hinauswächst, wird pausiert. Ihr Backend stoppt, ihre Adresse antwortet nicht mehr, `rebase cloud previews` und die Konsole zeigen sie als `paused` mit dem Grund an, und die Owners und Admins des Projekts werden benachrichtigt (`preview.paused`). Ihre Daten bleiben bis zum Ablauf erhalten. Deployen Sie sie erneut, um sie zu starten (sie wird wieder pausiert, solange die Datenbank noch zu groß ist), oder löschen Sie sie. Eine pausierte Vorschau wird weiter abgerechnet, bis sie gelöscht wird oder abläuft. Löschen Sie Vorschauen, die Sie nicht mehr brauchen. In der Produktion installierte Extensions sind in der Datenbank einer Vorschau nicht installiert.

Vorschauen werden gerade ausgerollt. Eine Control Plane, die sie noch nicht bereitstellt, lehnt `--preview` mit `previews_unavailable` ab und deployt nichts.

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
| `rebase cloud deploy` (ein Source-Build) | Das Image, das dieser Build veröffentlicht hat |
| `rebase cloud deploy --bundle` (die Plattform-Runtime) | Das Bundle, das dieses Deployment ausgeliefert hat, auf der Runtime-Version, die das Projekt jetzt ausführt |

Statische Apps, die in das Bundle des Backends eingebettet sind (ein einfaches `rebase cloud deploy` in einem Projekt mit Backend), sind Teil dieses Bundles und werden mit ihm zurückgerollt.

Eine statische App, die allein deployt wurde (`rebase cloud deploy <app>`), lässt sich noch nicht zurückrollen. Ihr Deployment hält fest, welche App es veröffentlicht hat, aber kein Bundle, sodass die Control Plane nichts hat, woraus sie es wiederherstellen könnte. Die Lösung ist, die letzte funktionierende Version erneut zu deployen, zum Beispiel vom Commit vor dem fehlerhaften. Nach einem solchen Deployment sagt `deploy` das, statt auf `rollback` zu verweisen, und `rollback` ohne ID verweigert die Ausführung, statt das Backend, das gerade ausliefert, erneut zu deployen.

Ein Rollback erfordert also ein Deployment, das eines von beiden aufgezeichnet hat, was ein Projekt voraussetzt, das mindestens zweimal erfolgreich deployt wurde. `rebase cloud deployments` markiert diejenigen, die infrage kommen, und `--json` gibt `rollbackable` pro Zeile zusammen mit dem `image` oder `bundle` aus, das wiederhergestellt werden würde.

Zwei Arten von Deployments werden abgelehnt, und die CLI gibt an, welche: ein Deployment, das nicht erfolgreich war,
und eines aus der Zeit, bevor die Plattform dessen Artefakt aufgezeichnet hat. In beiden Fällen gibt es nichts
zu raten – ein Raten würde das ausliefern, was zuletzt gebaut oder hochgeladen wurde, während behauptet würde,
dieses wiederherzustellen – stellen Sie stattdessen die gewünschte Version bereit.

Jedes erfolgreiche Deployment endet mit dem Weg zurück (`rebase cloud rollback`), sodass er sichtbar ist, wenn ein fehlerhaftes Release bemerkt wird.

Ein Rollback fügt ein neues Deployment an, anstatt die Versionshistorie zurückzuspulen, und wartet darauf, dass die wiederhergestellte Version Anfragen bedient, bevor Erfolg gemeldet wird. Verfolgen Sie dies mit `rebase cloud logs -f`.

## Die Datenbank auf einen Zeitpunkt zurücksetzen

Eine verwaltete Datenbank lässt sich auf jede Minute innerhalb ihres Wiederherstellungsfensters zurücksetzen, über **Database → Backups** in der Konsole oder mit der CLI:
`rebase cloud db pitr status | restore --target <ISO> | cutover | discard`.
Das geschieht in zwei Schritten. Zuerst wird neben der Live-Datenbank eine wiederhergestellte Kopie bereitgestellt; Ihre App läuft weiter auf der Live-Datenbank, und der Speicher der Kopie wird abgerechnet, bis Sie den Cutover durchführen oder sie verwerfen.
Sobald die Kopie bereit ist, richtet der Cutover die App auf sie um und startet sie neu. Alles, was nach dem Zielzeitpunkt geschrieben wurde, ist nicht in der Kopie. Die ursprüngliche Datenbank bleibt als Weg zurück erhalten und rechnet weiter Speicher ab; das Zurückschalten, das Entfernen oder eine zweite Wiederherstellung läuft über den Support. Nur ein Owner oder Admin kann bereitstellen, den Cutover durchführen oder verwerfen, und die Konsole fragt vor dem Cutover nach dem Namen des Projekts.

## Ihr Konto absichern

Ihr Konsolen-Konto kann Produktionsdatenbanken, Secrets und die Abrechnung erreichen, schützen Sie es also entsprechend. Öffnen Sie **Account security** im Menü unter Ihrem Avatar in der Konsole (oder rufen Sie `/account` auf). Die Seite gehört Ihnen, nicht einer Organisation: Was Sie dort einstellen, gilt in jeder Organisation, der Sie angehören.

- **Zwei-Schritt-Verifizierung.** Aktivieren Sie sie mit einer beliebigen Authenticator-App (1Password, Google Authenticator, Authy). Die Seite zeigt einen Einrichtungsschlüssel zum Hinzufügen in der App oder einen Link, der auf einem Telefon die App mit eingetragenem Schlüssel öffnet, und fragt dann nach dem 6-stelligen Code, den die App anzeigt. Ab dann verlangt jede Anmeldung einen Code, egal ob Sie sich mit Passwort, Google oder GitHub anmelden.
- **Wiederherstellungscodes.** Beim Aktivieren erhalten Sie zehn Einmalcodes, die nur einmal angezeigt werden. Jeder meldet Sie anstelle des Authenticator-Codes an, falls Sie Ihr Telefon verlieren, speichern Sie sie also, bevor Sie den Dialog schließen. **New recovery codes** ersetzt sie, und die alten funktionieren nicht mehr. Das Deaktivieren der Zwei-Schritt-Verifizierung und das Anfordern neuer Codes verlangen beide zuerst einen Code.
- **Passwort.** Wenn Sie es ändern, werden Sie auf allen anderen Geräten abgemeldet. Ein mit Google, GitHub oder LinkedIn erstelltes Konto hat kein Passwort; die Seite bietet an, Ihnen einen Link zum Festlegen eines Passworts per E-Mail zu schicken.
- **Angemeldete Geräte.** Jeder Browser und jedes Terminal, die bei Ihrem Konto angemeldet sind, mit Adresse und Zeitpunkt der Anmeldung. Melden Sie jedes Gerät ab, das Sie nicht kennen, oder alle auf einmal.

[Zugriffstoken](/docs/deployment/cloud-agents/#ci-and-agents) sind keine Sitzungen und verlangen keinen zweiten Faktor, sodass CI auch nach dem Aktivieren weiter deployt. Widerrufen Sie ein Token, dem Sie nicht mehr vertrauen, unter **Settings → Access tokens**.

## Ihr Team einladen

**Members → Invite member** liefert einen Link zum Kopieren (per E-Mail verschickt, wenn diese Control Plane E-Mails versendet), der einmal funktioniert, 7 Tage lang gilt und für ein Konto gedacht ist, das diese Adresse verifiziert hat; niemand tritt bei, bevor er annimmt. Laden Sie einen Admin oder ein Mitglied ein und machen Sie es zum Owner, sobald es beigetreten ist. Owners und Admins sehen die Einladung unter **Pending invitations**, können sie erneut senden oder widerrufen; von einem Terminal aus <span class="since-badge" data-since="0.26">Seit 0.26</span> [`rebase cloud orgs members invite`](/docs/cli/cloud/#organizations).

## Nachvollziehen, wer was getan hat

Die Seite **Activity** der Konsole und <span class="since-badge" data-since="0.26">Seit 0.26</span> `rebase cloud activity` zeigen den Owners und Admins der Organisation, wer deployt, eine Umgebungsvariable gesetzt oder angezeigt (nur dem Namen nach, nie dem Wert), eine Domain geändert, ein Backup wiederhergestellt, ein Projekt skaliert, gestoppt oder gelöscht, die Rolle eines Mitglieds geändert oder ein Token erstellt hat, und wann. Die **Settings** eines Projekts verlinken auf dessen eigene Einträge; ein Eintrag über ein gelöschtes Projekt bleibt bestehen. Ein Skript liest sie mit einem Token, das mit `--can audit` für die Organisation erstellt wurde. Einträge werden ein Jahr lang aufbewahrt. Die Filter stehen unter [`rebase cloud`](/docs/cli/cloud/#organizations).

## CI und Agents

Ein CI-Job oder ein Agent sollte nicht Ihr Passwort enthalten. Geben Sie ihm ein Token, das auf wenige Aktionen für ein einzelnes Projekt beschränkt ist, erstellt von einem angemeldeten Terminal aus mit `rebase cloud tokens create --project shop --can deploy,logs`, und setzen Sie es als `REBASE_TOKEN`. Abrechnung, Aktivitätsprotokoll und Benachrichtigungseinstellungen einer Organisation sind eigene Capabilities (`--can billing`, `audit`, `notifications`), die ein Token nur hält, wenn sie angefordert wurden. Die Capabilities, ein GitHub-Actions-Workflow und was einer angemeldeten Person vorbehalten bleibt, stehen unter [CI und Agents](/docs/deployment/cloud-agents/#ci-and-agents).

## Ein Backend ohne Konto

<span class="since-badge" data-since="0.26">Seit 0.26</span>

`rebase cloud init --claim` gibt einer App ein Live-Backend, bevor sich irgendjemand registriert hat, und gibt eine Claim-URL aus, mit der die Person es behalten kann; ein Projekt, das innerhalb von 72 Stunden niemand übernimmt, wird gelöscht. Was das Token des nicht übernommenen Projekts darf, das `REBASE_API_TOKEN`, das es schreibt, und was die Übernahme ändert, steht unter [Ein Backend ohne Konto](/docs/deployment/cloud-agents/#a-backend-with-no-account).

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
| `--replicas` | Instanzen, die immer existieren: die Untergrenze des Autoscalers und das, was das Abonnement des Projekts monatlich berechnet |
| `--autoscale-max` | 1–16. Die Obergrenze, die erreicht werden kann. Instanzen, die der Autoscaler oberhalb von `--replicas` hinzufügt, werden pro Pod-Sekunde zu denselben Tarifen gemessen und nur dort berechnet, wo die Plattform das eingeschaltet hat; **Usage this month** sagt, welcher Fall vorliegt. `--no-autoscale` schaltet dies ab |
| `--autoscale-cpu-target` | 10–95. Die CPU-Auslastung, die der Autoscaler anstrebt, bezogen auf den Request statt auf das Limit. Leer bedeutet 70 |
| `--spot` | `true` oder `false`. Preemptible Kapazität: günstiger, wird aber ohne Vorankündigung neu gestartet |
| `--db-instances` | 1–3. `1` ist eine Einzelinstanz ohne Failover; `2` fügt ein automatisches Standby hinzu |
| `--db-cpu`, `--db-memory` | Pro Datenbankinstanz. Leer bedeutet `160m` und `1Gi` |

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
| `tokens` | Tokens für CI und Agents, jeweils auf ein Projekt beschränkt. Siehe [CI and agents](/docs/deployment/cloud-agents/#ci-and-agents) |
| `link`, `unlink`, `use`, `open` | Verknüpfen dieses Verzeichnisses mit einem Projekt, Auswählen einer Organisation, Öffnen der Konsole |
| `init`, `claim` | Mit `--claim`: ein Live-Backend ohne Konto und ein Link, um es zu übernehmen; `claim` gibt diesen Link erneut aus. Siehe [Ein Backend ohne Konto](/docs/deployment/cloud-agents/#a-backend-with-no-account) |
| `projects` | Erstellen, auflisten, prüfen, löschen |
| `deploy`, `logs`, `deployments`, `rollback`, `cancel` | Bereitstellen und überwachen |
| `previews` | Builds, die `deploy --preview` unter einer eigenen Adresse ausliefert, und deren Löschen. Siehe [Eine Änderung in der Vorschau ansehen](#eine-änderung-in-der-vorschau-ansehen) |
| `start`, `stop`, `restart` | Pausieren eines Projekts und Wiederinbetriebnahme. Ein gestopptes Projekt behält sein Abonnement, es sei denn, die Plattform berechnet gestoppte Projekte nur für Speicher und die Plattformgebühr; die **Billing**-Zeile der Konsole sagt es, wenn das der Fall ist |
| `status`, `metrics`, `debug` | Was es gerade tut und warum möglicherweise nicht |
| `cron` | Die Cron-Jobs der bereitgestellten App und deren aufgezeichnete Ausführungen, gelesen mit Ihrem `rebase cloud`-Login. Schreibgeschützt |
| `env` | Umgebungsvariablen. `list` gibt niemals Werte aus; `--secret` ist rein schreibend |
| `app-key` | Der Schlüssel, den `init --claim` als `REBASE_API_TOKEN` in `.env` geschrieben hat und der bei der Übernahme übergeben wird; `rotate` ersetzt ihn und widerruft den alten. Owners und Admins |
| `service-key` | `REBASE_SERVICE_KEY`, Admin auf der eigenen API der App: wann er zuletzt rotiert wurde; `rotate` gibt der App einen neuen. Owners und Admins |
| `domains` | Eigene Domains, hinzuzufügende DNS-Einträge und Verifizierung. Ein Projekt kann unter mehreren Domains erreichbar sein, jede für sich verifiziert; `verify` und `remove` nehmen die jeweilige Domain entgegen, was nur weggelassen werden kann, wenn es genau eine gibt (bei `verify` eine noch ausstehende). `list --json` gibt `{ projectId, tenantHost, domains: [...] }` zurück |
| `db` | Datenbank anbinden oder erstellen, Verbindung von Ihrem Rechner aus aufbauen, Backups, Restore und Point-in-Time-Recovery |
| `extensions` | Die Allowlist für Postgres-Extensions |
| `storage` | Der Bucket des Projekts |
| `resources` | Welche Datenbanken und Buckets die Plattform hält, abgeglichen mit den Deklarationen im Code |
| `compute` | Was dieses Projekt reserviert, was es kostet und wie man es anpasst |
| `usage` | In diesem Monat verbrauchte Anfragen im Verhältnis zum enthaltenen Kontingent und die bisherige Überschreitung, so wie die Rechnung sie zählt. `usage org` listet jedes Projekt der Organisation auf |
| `clusters` | Die Cluster, auf denen Tenants laufen. Nur für Plattform-Admins |
| `settings`, `orgs`, `billing` | Projekteinstellungen, Organisationen samt Mitgliedern und Einladungen, Zahlungsabwicklung |
| `activity` | Das Audit-Log der Organisation: wer deployt oder eine Umgebungsvariable (dem Namen nach), eine Domain, ein Backup, ein Mitglied oder ein Token geändert hat. Owners und Admins. Siehe [Nachvollziehen, wer was getan hat](#nachvollziehen-wer-was-getan-hat) |
| `notifications`, `webhooks` | Wohin die Ereignisse des Projekts per POST gesendet werden: Slack, Discord oder jede https-URL ([Cloud notifications](/docs/deployment/cloud-notifications/)). `webhooks` ist stillgelegt und endet mit Exit-Code 1 und dem Code `command_retired` |

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
- **Keine Branch-Deployments** und keine First-Party-GitHub-App. Deploy-Hooks –
  geheime URLs, auf die Sie einen Repository-Webhook richten – sind die unterstützte Automatisierung. [Preview-Deployments](#eine-änderung-in-der-vorschau-ansehen) werden gerade ausgerollt und über die CLI gestartet.
- **Tokens agieren als Person.** Ein [Token](/docs/deployment/cloud-agents/#ci-and-agents) wird von einem Konto erstellt
  und agiert als dieses; es gibt bisher keine organisationsgebundene Maschinenidentität. Wenn Sie
  sich stattdessen über CI anmelden, übergeben Sie `REBASE_CLOUD_EMAIL` und `REBASE_CLOUD_PASSWORD`
  aus einem Secret-Speicher – `--password` schreibt das Passwort in Ihre Shell-Historie und
  in die Prozesstabelle und weist vor der Anmeldung darauf hin. Wenn die `.rebase/cloud.json` des Repositories
  eine andere Control Plane als die plattformeigene benennt, übergeben Sie diese ebenfalls
  als `--url`: Ohne Terminal weigert sich `login`, ein Passwort an einen Host zu senden,
  der nur von der ausgecheckten Datei benannt wurde.
- **Kein öffentlicher Datenbank-Endpunkt.** Eine verwaltete Datenbank ist nicht über das
  Internet erreichbar, sodass der in der Konsole angezeigte Host die Adresse für Ihr Backend ist und
  auf Ihrem lokalen Rechner zu nichts aufgelöst werden kann. `rebase cloud db connect` öffnet einen lokalen
  Port, der diese Datenbank darstellt, getunnelt durch die Control Plane, solange
  Sie den Befehl laufen lassen – es gibt jedoch keinen permanenten Hostnamen, zu dem sich ein Drittanbieter-Dienst
  verbinden könnte. Sowohl dieser Tunnel als auch das Passwort hinter
  `rebase cloud db info --reveal` erfordern die Owner- oder Admin-Rolle der Organisation:
  dieselbe, die auch der SQL-Editor von Studio verlangt, da alle drei Zugriffe in einer
  Sitzung auf Ihren Produktionsdaten enden.
- **Deployen heißt, Code mit den Produktions-Secrets auszuführen.** Die Umgebung der App enthält
  `REBASE_SERVICE_KEY` (Admin auf der eigenen API), `DATABASE_URL` und `JWT_SECRET`, sodass Code,
  den ein Mitglied deployt, sie lesen kann, obwohl nur Owners und Admins sie in der Konsole anzeigen
  können. Laden Sie nur jemanden als Mitglied ein, dem Sie diese Werte anvertrauen würden.
- **Der Service Key lässt sich ersetzen.** <span class="since-badge" data-since="0.26">Seit 0.26</span> Die **Settings** des Projekts
  (oder `rebase cloud service-key rotate`) stellen einen neuen `REBASE_SERVICE_KEY` aus
  und starten die App damit neu. Der alte Schlüssel funktioniert, bis der Neustart
  abgeschlossen ist, und danach nicht mehr, sodass alles, was ihn kopiert hat, ab
  dann abgewiesen wird. Die Übernahme eines Projekts bewirkt dasselbe.

## Stattdessen selbst hosten

Nichts hier bedeutet einen Lock-in. Der [Self-Hosting-Leitfaden](/docs/deployment/self-hosting/)
führt das identische Image und Bundle mit `docker compose` aus, und die
[Kubernetes-Anleitung](/docs/deployment/kubernetes/) baut dieselbe Topologie über
das Helm-Chart auf.
