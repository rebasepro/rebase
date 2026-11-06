---
sourceHash: a66e695d7d7fc2a9
title: Rebase Cloud
sidebar_label: Rebase Cloud
description: Rebase Cloud ist dasselbe Rebase, für dich betrieben. Was es ist, wie ein Projekt verknüpft und bereitgestellt wird und was die private Beta noch nicht enthält.
---

Rebase Cloud führt dasselbe Open-Source-Rebase aus, das du selbst hosten würdest – dasselbe
veröffentlichte `rebasepro/server`-Image, dasselbe Bundle, dasselbe Postgres. Der
Unterschied besteht darin, wer es betreibt.

:::note[Private Beta]
Rebase Cloud befindet sich in der **privaten Beta**. Es betreibt bereits heute echte Tenants und wird in
Batches freigeschaltet. [Zugang anfragen](https://rebase.pro/pricing).

Es ist kein Self-Service, daher erfordern die unten aufgeführten Befehle ein Konto, das bereits freigeschaltet wurde.
Alles andere auf dieser Website funktioniert auch ohne ein solches Konto.
:::

## Was es ist

Ein Cloud-**Projekt** besteht aus drei Komponenten, die die Plattform für dich betreibt:

| | Was du bekommst |
|---|---|
| **App** | Dein Bundle, ausgeführt auf dem veröffentlichten Runtime-Image. Deployments sind ein Bundle-Upload, kein Container-Build |
| **Database** | Ein verwaltetes PostgreSQL mit automatischen Backups und Point-in-Time Recovery |
| **Storage** | Ein eigener Bucket, falls dein Projekt Datei-Storage verwendet |

Jede Komponente wird beim ersten Deploy bereitgestellt und nach reservierten Ressourcen statt pro Benutzerplatz (Per-Seat) abgerechnet.

**An deinem Projekt ändert sich nichts, um dort zu laufen.** Dasselbe Repository
lässt sich mit `docker compose` selbst hosten, und die Ausweichmöglichkeit (Escape Hatch) ist echt: `rebase build`
erzeugt ein Bundle, das überall startet, wo das Runtime-Image läuft.

## Ein Projekt verknüpfen

Aus einem Projektverzeichnis:

```bash
rebase cloud login
rebase cloud billing setup
rebase cloud projects create --name "My app" --subdomain my-app --link
```

`projects create` akzeptiert keine Positionsargumente. Name und Subdomain sind
Flags, und beide sind erforderlich – im Terminal werden sie interaktiv abgefragt, und ein
Headless-Lauf, der eines davon weglässt, bricht mit `input_required` ab, anstatt einen Wert zu
erfinden. **Die Subdomain kann nachträglich nicht mehr bearbeitet werden:** Sie ist der
`<slug>.rebase.website`-Host, unter dem das Projekt antwortet; wähle sie daher mit Bedacht.

`--link` verknüpft dieses Verzeichnis im selben Aufruf mit dem Projekt, sodass kein
separater `link`-Schritt erforderlich ist. Es schreibt `.rebase/cloud.json`, worin Projekt-ID
und Slug festgehalten werden. Diese Datei ist kein Geheimnis und enthält keine Anmeldedaten – diese liegen
in `~/.rebase/credentials.json`, geschrieben von `login`.

Sie wird jedoch mit dem Code committet, sodass ein geklontes Repository jede beliebige
Control Plane benennen kann. Wenn der Host ausschließlich aus dieser Datei stammt und es sich weder um den
plattformeigenen handelt noch um einen, bei dem du dich zuvor angemeldet hast, nennt `login` ihn und fragt nach,
bevor deine E-Mail-Adresse und dein Passwort dorthin gesendet werden. Ohne Terminal oder mit
`--json` bricht der Befehl mit `unknown_control_plane` ab; übergib `--url <host>` (oder setze
`REBASE_CLOUD_URL`), um dich dort gezielt anzumelden.

**Mit Google, GitHub oder LinkedIn registriert?** Dein Konto hat kein Passwort;
melde dich stattdessen mit einem Code an:

```bash
rebase cloud login --code --email me@example.com
```

Die Control Plane sendet dir per E-Mail einen 6-stelligen Code, der zehn Minuten lang gültig ist, und du gibst
ihn bei der Eingabeaufforderung ein. Wird `rebase cloud login` einfach so in einem Terminal ausgeführt, fragt es,
ob du dein Passwort oder einen Code verwenden möchtest. Für Codes muss die Control Plane in der Lage sein, E-Mails
zu versenden; falls nicht, weist `--code` darauf hin und bricht mit `otp_unavailable` ab.

Wenn du die Zwei-Faktor-Authentifizierung aktiviert hast, fragt `login` anschließend nach dem Code aus
deiner Authentifikator-App oder nach einem deiner Wiederherstellungscodes – unabhängig davon, wie du dich
angemeldet hast. Weder ein Anmeldecode noch ein zweiter Faktor können ohne Terminal eingegeben werden.
Erstelle für Skripte ein Access-Token in der Konsole (**Settings → Access
tokens**) und setze `REBASE_TOKEN`; siehe [CI and agents](/docs/deployment/cloud-agents/#ci-and-agents).

Ein falsches Passwort antwortet mit `invalid_credentials` und denselben zwei Anmeldeoptionen, da
die häufigste Ursache ein Konto ist, das nie ein Passwort besessen hat.

`billing setup` hinterlegt einmalig eine Karte für die Organisation. Es steht bewusst an erster
Stelle der Sequenz: Das erste Deployment eines Projekts wird ohne Zahlungskarte verweigert, und
dies erst nach Abschluss des Bundle-Uploads festzustellen, ist die schlechtere Reihenfolge.

Danach listet die **Billing**-Seite der Konsole die Rechnungen der Organisation auf,
jeweils mit Stripes gehosteter Seite und PDF, und zeigt eine Vorschau auf die nächste Rechnung jedes
Projekts. `rebase cloud billing invoices` und `rebase cloud billing upcoming`
geben dasselbe aus. Beide sind für Owner und Admins der Organisation gedacht. Sofern die
Plattform dies anbietet, öffnet **Manage billing** das Stripe-Kundenportal für die
Kreditkarte, die Abrechnungsdetails und vergangene Rechnungen.

Ist bereits eine Karte hinterlegt, erfordert das Erstellen eines weiteren Projekts in der Konsole
keine zweite Zahlung: Das Projekt wird über diese Karte abgerechnet und bereitgestellt. Wird die Karte
abgelehnt oder verlangt die Bank eine Zahlungsbestätigung, führt dich die Konsole zu
**Billing**, wo **Fix your card** eine andere Karte speichert und **Complete the
payment** die Stripe-Rechnung öffnet.

Was ein Projekt verbraucht hat, wird in der Übersicht unter **Usage this month** angezeigt sowie
für alle Projekte gleichzeitig auf der Seite **Billing**: Anfragen im Vergleich zum
enthaltenen Kontingent (der Balken wird bei 80 % bernsteinfarben), 5xx-Fehler, die bisherige Überziehung
und wohin sich der Monat bei diesem Tempo entwickelt. Die Überziehung (Overage) wird durch denselben
Code berechnet, der sie an Stripe meldet; sie entspricht also dem Betrag auf der Rechnung und
erscheint auf der Rechnung des Folgemonats. `rebase cloud usage` gibt dasselbe aus,
und `rebase cloud usage org` für die gesamte Organisation. Jedes Mitglied kann dies einsehen.
Die Zahlen geben auch an, was noch nicht erfasst wird: Object Storage wird nicht gemessen,
daher wird keine Speicherüberziehung berechnet; solange ein Projekt zwei oder mehr App-Pods ausführt,
werden seine Anfragen nicht gezählt; und ein Tag mit fehlenden Stichproben zählt zu wenig. Ein
automatisch skaliertes Projekt zeigt zudem die Pods an, die es über `--replicas` hinaus ausgeführt hat (in Pod-Stunden),
was diese zu den jeweiligen Tarifen kosten und ob diese Plattform sie bereits in Rechnung stellt. Ein
von einem Agent geclaimtes Projekt zählt nur die Tage ab dem Claim: davor gehörte das Projekt der Plattform.

Ein bestehendes Projekt lässt sich verknüpfen, ohne ein neues zu erstellen:

```bash
rebase cloud projects list
rebase cloud link --project my-app
```

## Deploy

```bash
rebase cloud deploy
```

Ein einziger Befehl, und kein Flag, das man sich merken müsste. Die `rebase.json` eines Scaffolds deklariert
`runtime: "managed"` für sein Backend, und `deploy` liest diese Deklaration – dies wird
beim Durchlauf gemeldet (`rebase.json declares runtime: managed — deploying a
bundle`), baut die App nach `dist-bundle`, lädt das Bundle hoch, führt es auf dem
veröffentlichten Runtime-Image aus und verfolgt das Deployment bis zu einem Endzustand. Der Exit-Code
ist das finale Ergebnis, sodass dieselbe Zeile unbeaufsichtigt in CI funktioniert.

Am Ende wird ausgegeben, wo jede App nun antwortet und ob die neue Version
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
Plattform sie ausliefert). Die Prüfung wartet bis zu `--live-timeout` Sekunden (Standard: 60);
`0` überspringt sie. Wenn eine App nicht rechtzeitig antwortet, beendet sich das Deployment dennoch mit dem Exit-Code
0, da das Deployment erfolgreich war, und die letzte Zeile gibt an, welche App nicht geantwortet
hat und warum. Ein fehlgeschlagenes Deployment endet stattdessen mit einer Zeile, die die App und den
Grund nennt, zusammen mit dem Hinweis auf `rebase cloud logs` für das vollständige Build-Protokoll.

Skripte übergeben `--json` für ein einzelnes Objekt mit denselben Informationen – `apps`, `hosts`,
`live`, `liveChecks`, `durationMs` und der Deployment-ID. Im Gegensatz zum Rest von
`rebase cloud` wechselt `deploy` bei einer Pipe nicht automatisch zu JSON.

Was diese Runtime zulässt – Pakete und native Module, Arbeitsspeicher und Instanzen,
Timeouts und Body-Größen, das Dateisystem, Secrets, Storage und ausgehender
Netzwerkverkehr – wird auf einer eigenen Seite beschrieben:
[Managed backend runtime](/docs/deployment/managed-runtime/).

Um ein Artefakt auszuliefern, das zuvor gebaut wurde – beispielsweise in einem CI-Job, der einmal baut
und zweimal deployt –, verweise auf das Verzeichnis, anstatt neu zu bauen:

```bash
rebase build
rebase cloud deploy --bundle-dir dist-bundle
```

Das Verlassen der verwalteten Runtime erfordert ein eigenes Flag, `--eject`, und nichts anderes
fordert dies an: Ein Build, der ein verwaltetes Projekt auf ein eigenes Container-Image
umstellen würde, wird abgelehnt, solange du dies nicht explizit angibst. Früher stand `--force` dafür,
wodurch die am wenigsten umkehrbare Aktion der CLI unter demselben Wort wie „diese Datei überschreiben“
lag; mittlerweile ist dies eine unbekannte Option statt eines Alias, sodass ein Skript, das dieses Flag enthält,
stattdessen abbricht.

### Die Syntaxprüfung vor dem Upload

Die Dateien einer statischen App werden exakt so ausgeliefert, wie sie vorliegen. Wenn deren `build` lediglich
handgeschriebene Skripte nach `output` kopiert, wurden sie von nichts geparst, und eine Datei
mit einem Tippfehler geht live und verhindert das Laden der Seite. Bevor also irgendetwas
hochgeladen wird, parst `deploy` jede `.js`-, `.mjs`- und `.cjs`-Datei im `output` jeder statischen
App sowie jedes Inline-`<script>` in deren `.html`-Dateien. Dies deckt sowohl eine einzeln
bereitgestellte statische App ab als auch statische Apps, die in das Bundle des Backends integriert sind.
Ein Syntaxfehler stoppt das Deployment unter Angabe von Datei, Zeile und Spalte:

```
✗ A syntax error in the static output, so nothing was deployed:
    web/cloud.js:42:23  Unexpected token
        42 |     return fetch("/api";
Fix it and deploy again, or pass --no-verify to deploy anyway.
```

Mit `--json` lautet der `code` des Fehlers `syntax_error`. Inline-Skripte, die ein Browser
nicht als JavaScript ausführt, werden übersprungen: JSON, Import Maps, Templates und jeder
andere Nicht-JavaScript-`type`, ein `<script src>` sowie ein Skript, das noch
ungerendertes Template-Markup wie `{{ }}` enthält. Eine `.js`-Datei ist gültig, wenn sie sich entweder
als klassisches Skript oder als Modul parsen lässt, da die Seite entscheidet, worum es sich handelt. Nichts
unterhalb von `node_modules` wird gelesen, und ebenso kein vorgebautes `--bundle-dir`.
`--no-verify` überspringt die Prüfung für ein einzelnes Deployment.

Live verfolgen:

```bash
rebase cloud logs               # the build log
rebase cloud logs --runtime -f  # what the running app prints, live, until Ctrl-C
rebase cloud status             # what the platform thinks the project is doing
```

`status` meldet `blockedOn` und `nextAction`. Wenn `blockedOn` gleich `null` ist,
arbeitet die Plattform tatsächlich und Polling ist das Richtige; wenn dort etwas
angegeben ist, wartet dieses Etwas auf dich.

## Eine Änderung in der Vorschau anzeigen

```bash
rebase cloud deploy --preview
```

Dies baut und lädt genau das hoch, was auch `deploy` ausführen würde, stellt es jedoch unter einer
eigenen Adresse bereit, wie etwa `https://shop--k3x9ab.rebase.website`. Die Produktion liefert weiterhin
das aus, was sie zuvor ausgeliefert hat. Das Deployment gibt die Adresse der Preview aus, sobald der
Build abgeschlossen ist.

Um über mehrere Deployments hinweg dieselbe Adresse beizubehalten, benenne die Preview. Ein erneutes
Deployen mit demselben Namen aktualisiert sie:

```bash
rebase cloud deploy --preview-name new-checkout
```

Womit eine Preview kommuniziert, hängt davon ab, was du bereitgestellt hast:

- **`rebase cloud deploy --preview`** zeigt eine Vorschau des Backends inklusive der darin
  eingebundenen statischen Apps, genau wie in der Produktion. Es erhält ein eigenes Backend auf
  einer **eigenen leeren Datenbank**, niemals auf der Produktionsdatenbank. Ein Start gegen
  die Produktionsdatenbank würde das Schema und die Zugriffsregeln der Preview auf diese anwenden.
- **`rebase cloud deploy web --preview`** würde eine einzelne statische App isoliert
  in der Vorschau anzeigen, deren Seiten das **Produktions**-Backend aufrufen. Dafür ist eine Control Plane
  erforderlich, die statische Seiten eigenständig ausliefert, was Rebase Cloud derzeit noch nicht unterstützt:
  Der Befehl bricht mit `PREVIEW_STATIC_UNSERVED` ab und veröffentlicht nichts. Erstelle stattdessen eine Preview
  des Backends, welches die darin eingebundenen statischen Apps mitausliefert; ein Projekt ohne
  verwaltetes Backend kann derzeit noch nicht in der Vorschau angezeigt werden.

Eine Preview lädt keinen Quellcode hoch und registriert keine Apps oder Hostnames, da jede
dieser Aktionen das Produktionsprojekt verändern würde. `--source` und `--eject` können nicht
mit `--preview` kombiniert werden. Beide bauen ein Container-Image für die Produktion.

```bash
rebase cloud previews                      # name, address, app, backend, expiry
rebase cloud logs --preview new-checkout   # its build log; -f follows a build still running
rebase cloud logs --runtime --preview new-checkout -f  # what its backend prints
rebase cloud previews delete new-checkout  # stops serving it and drops its database
```

`rebase cloud logs` ohne `--preview` bezieht sich immer auf die Produktion.

Die Seite **Deployments** in der Konsole listet dieselben Previews auf und ermöglicht es, jede einzelne zu öffnen, ihr
Build-Protokoll anzuzeigen oder sie zu löschen. Das Erstellen bleibt ein CLI-Schritt.

Eine Preview läuft eine Woche nach dem letzten Deployment darauf ab.

Nach Abschluss prüft das Deployment, ob die Adresse der Preview antwortet, genau wie bei einem
Produktions-Deployment (`--live-timeout <seconds>`, `0` zum Überspringen). Das Zertifikat einer neuen
Preview kann ein bis zwei Minuten dauern; ein erfolgreiches Deployment kann daher melden,
dass die Adresse noch nicht antwortet.

Eine Backend-Preview wird wie eine App-Einheit in der Standardgröße abgerechnet (100m CPU
und 384 MiB Arbeitsspeicher zum Tarif deiner App für deren Region und Kapazität),
anteilig für die Dauer ihres Bestehens, und sie erscheint im monatlichen
Kostenvoranschlag des Projekts in der Konsole. `rebase cloud deploy --preview` gibt denselben Kostenvoranschlag
dafür pro Monat aus (`cost` unter `--json`). Das Starten einer Preview erfordert eine hinterlegte Karte, genau wie
ein Produktions-Deployment. Ein erstes Deployment, das
fehlschlägt, bevor irgendetwas ausgeführt wird, wird entfernt statt abgerechnet. Ein Projekt darf
bis zu drei Backend-Previews gleichzeitig ausführen.

Jede neue Preview-Adresse erhält ein eigenes TLS-Zertifikat von Let's Encrypt,
das pro Domain 50 neue Zertifikate pro Woche zulässt – geteilt mit jeder darauf laufenden
Produktions-Site. Previews dürfen plattformweit 20 davon innerhalb von jeweils 7 Tagen beanspruchen. Darüber
hinaus wird eine neue Preview abgelehnt (`429`, `preview_cert_budget`), unter Angabe des Zeitpunkts, ab dem sie
bereitgestellt werden kann; das erneute Bereitstellen einer bereits existierenden Preview zählt niemals dazu.

Die Datenbank einer Backend-Preview ist eine zweite Datenbank auf dem PostgreSQL der **Produktion**:
eigene Daten, aber dieselbe Instanz und dieselbe Festplatte. Sie ist auf 10
Verbindungen limitiert, damit Previews nicht die Verbindungen der Produktion aufbrauchen, sowie auf 2 GB: Eine Preview,
deren Datenbank darüber hinaus anwächst, wird pausiert. Ihr Backend stoppt, ihre Adresse antwortet
nicht mehr, `rebase cloud previews` und die Konsole zeigen sie mit dem entsprechenden Grund als `paused` an,
und die Owner und Admins des Projekts werden benachrichtigt (`preview.paused`). Ihre
Daten bleiben erhalten, bis sie abläuft. Führe ein erneutes Deployment durch, um sie zu starten (sie wird erneut pausiert,
solange die Datenbank noch zu groß ist), oder lösche sie. Eine pausierte Preview wird weiterhin
abgerechnet, bis sie gelöscht wird oder abläuft. Lösche Previews, die du nicht mehr benötigst. In der Produktion installierte
Extensions werden in der Datenbank einer Preview nicht installiert.

Previews werden schrittweise eingeführt. Eine Control Plane, die sie noch nicht unterstützt, lehnt
`--preview` mit `previews_unavailable` ab und stellt nichts bereit.

## Rollback

```bash
rebase cloud deployments
rebase cloud rollback
```

Ein Rollback verweist das Projekt wieder auf den Stand eines früheren erfolgreichen
Deployments und führt niemals einen Rebuild durch – der Wert eines Rollbacks liegt darin, dass ein
Artefakt ausgeliefert wird, das bereits gelaufen ist.

Welche Deployments dafür infrage kommen, hängt davon ab, wie das Projekt bereitgestellt wird; beide Arten
funktionieren:

| Wie es bereitgestellt wurde | Was wiederhergestellt wird |
|---|---|
| `rebase cloud deploy` (ein Source-Build) | Das Image, das dieser Build veröffentlicht hat |
| `rebase cloud deploy --bundle` (die Plattform-Runtime) | Das Bundle, das dieses Deployment ausgeliefert hat, auf der Runtime-Version, auf der das Projekt derzeit läuft |

Statische Apps, die in das Backend-Bundle integriert sind (ein einfaches `rebase cloud deploy` bei einem
Projekt mit Backend), sind Teil dieses Bundles, weshalb für sie ebenfalls das Rollback gilt.

Eine statische App, die einzeln bereitgestellt wurde (`rebase cloud deploy <app>`), kann derzeit
noch nicht zurückgerollt werden. Ihr Deployment zeichnet auf, welche App veröffentlicht wurde, aber kein Bundle,
sodass die Control Plane keine Basis hat, aus der sie wiederhergestellt werden könnte. Die Lösung besteht darin, die
letzte funktionierende Version erneut bereitzustellen, beispielsweise aus dem Commit vor der fehlerhaften Version. Nach einem
solchen Deploy weist `deploy` darauf hin, anstatt auf `rollback` zu verweisen, und ein `rollback`
ohne ID verweigert die Ausführung, anstatt das derzeit aktive Backend erneut bereitzustellen.

Ein Rollback erfordert daher ein Deployment, das eines von beiden aufgezeichnet hat – also ein
Projekt, das mindestens zweimal erfolgreich bereitgestellt wurde. `rebase cloud deployments`
markiert diejenigen, die infrage kommen, und `--json` gibt pro Zeile `rollbackable` zusammen
mit dem `image` oder `bundle` an, das wiederhergestellt werden würde.

Zwei Arten von Deployments werden abgelehnt, und die CLI weist darauf hin: ein nicht erfolgreiches Deployment
sowie ein Deployment aus der Zeit, bevor die Plattform Artefakte aufzeichnete. In beiden Fällen gibt es nichts zu
mutmaßen – Mutmaßungen würden einfach das zuletzt Gebaute oder Hochgeladene ausliefern und fälschlicherweise
behaupten, dieses wiederherzustellen; stelle stattdessen einfach die gewünschte Version bereit.

Jedes erfolgreiche Deployment endet mit der Nennung des Rückwegs (`rebase cloud rollback`),
sodass dieser in dem Moment parat steht, in dem ein fehlerhaftes Release bemerkt wird.

Ein Rollback hängt ein neues Deployment an, anstatt die Historie zurückzudrehen, und wartet darauf,
dass die wiederhergestellte Version Anfragen bedient, bevor Erfolg gemeldet wird. Du kannst dies mit
`rebase cloud logs -f` verfolgen.

## Die Datenbank auf einen bestimmten Zeitpunkt wiederherstellen

Eine verwaltete Datenbank kann auf jede beliebige Minute innerhalb ihres Wiederherstellungsfensters
wiederhergestellt werden – über **Database → Backups** in der Konsole oder über die CLI:
`rebase cloud db pitr status | restore --target <ISO> | cutover | discard`.
Dies geschieht in zwei Schritten. Zuerst wird eine wiederhergestellte Kopie neben der Produktivdatenbank bereitgestellt;
deine App läuft auf der Produktivdatenbank weiter, und der Speicher der Kopie wird abgerechnet, bis
du den Cutover durchführst oder sie verwirfst.
Sobald die Kopie bereit ist, leitet der Cutover die App auf sie um und startet
sie neu. Alles, was nach dem Zielzeitpunkt geschrieben wurde, ist in der Kopie nicht enthalten. Die ursprüngliche
Datenbank bleibt als Rückfalloption erhalten und wird weiterhin für den Speicher abgerechnet; ein Zurückwechseln,
das Entfernen oder eine zweite Wiederherstellung erfolgt über den Support. Nur ein Owner oder Admin
kann die Bereitstellung, den Cutover oder das Verwerfen durchführen, und die Konsole fragt vor dem Cutover
nach dem Namen des Projekts.

## Dein Konto absichern

Dein Konsolenkonto hat Zugriff auf Produktionsdatenbanken, Secrets und die Abrechnung;
schütze es entsprechend. Öffne **Account security** über das Menü unter deinem Avatar
in der Konsole (oder gehe zu `/account`). Die Seite gehört dir persönlich, nicht einer
Organisation: Was du dort einstellst, gilt für jede Organisation, der du angehörst.

- **Zweistufige Verifizierung.** Aktiviere sie mit einer beliebigen Authentifikator-App (1Password,
  Google Authenticator, Authy). Die Seite zeigt einen Einrichtungsschlüssel zum Hinzufügen zur App oder einen
  Link, der die App auf einem Smartphone mit vorausgefülltem Schlüssel öffnet, und fragt anschließend nach dem
  6-stelligen Code, den die App anzeigt. Ab diesem Zeitpunkt verlangt jede Anmeldung einen Code,
  egal ob du dich mit einem Passwort, Google oder GitHub anmeldest.
- **Wiederherstellungscodes.** Beim Aktivieren erhältst du zehn Einmalcodes, die einmalig angezeigt werden.
  Jeder davon meldet dich anstelle des Authentifikator-Codes an, falls du dein
  Smartphone verlierst; speichere sie daher, bevor du den Dialog schließt. **New recovery codes**
  ersetzt sie, und die alten Codes werden ungültig. Sowohl das Deaktivieren der zweistufigen Verifizierung
  als auch das Anfordern neuer Codes verlangen zuerst die Eingabe eines Codes.
- **Passwort.** Das Ändern des Passworts meldet dich auf allen anderen Geräten ab. Ein Konto,
  das mit Google, GitHub oder LinkedIn erstellt wurde, hat kein Passwort; die Seite bietet an,
  dir per E-Mail einen Link zum Festlegen eines Passworts zu senden.
- **Angemeldete Geräte.** Jeder Browser und jedes Terminal, der bzw. das bei deinem Konto angemeldet ist,
  mit Adresse und Anmeldezeitpunkt. Melde jedes Gerät ab, das du nicht
  wiedererkennst, oder melde alle auf einmal ab.

[Access tokens](/docs/deployment/cloud-agents/#ci-and-agents) sind keine Sitzungen und erfordern keinen zweiten
Faktor, sodass CI auch nach der Aktivierung weiterhin deployen kann. Widerrufe Tokens, denen du nicht mehr
vertraust, unter **Settings → Access tokens**.

## Dein Team einladen

**Members → Invite member** erzeugt einen Link zum Kopieren (wird per E-Mail versendet, sofern diese Control Plane
E-Mails verschickt), der einmalig und 7 Tage lang für ein Konto gültig ist, das diese
Adresse verifiziert hat; niemand tritt bei, bevor die Einladung nicht angenommen wurde. Lade einen Admin oder ein Mitglied ein,
und mache sie zum Owner, sobald sie beigetreten sind. Owner und Admins können Einladungen unter
**Pending invitations** einsehen, erneut senden oder widerrufen; im Terminal über [`rebase cloud orgs members invite`](/docs/cli/cloud/#organizations).

## Nachvollziehen, wer was getan hat

Die **Activity**-Seite der Konsole und `rebase cloud activity` zeigen den
Ownern und Admins der Organisation, wer wann bereitgestellt hat, eine Umgebungsvariable
gesetzt oder aufgedeckt hat (nach Name, niemals nach Wert), eine Domain geändert, ein Backup wiederhergestellt,
ein Projekt skaliert, gestoppt oder gelöscht, die Rolle eines Mitglieds geändert oder ein Token
erstellt hat. Die **Settings** eines Projekts verlinken auf dessen eigene Einträge; ein Eintrag
zu einem gelöschten Projekt bleibt erhalten. Ein Skript liest dies mit einem Token aus, das mit
`--can audit` für die Organisation erstellt wurde. Einträge werden ein Jahr lang aufbewahrt. Die Filter befinden sich in
[`rebase cloud`](/docs/cli/cloud/#organizations).

## CI and agents

Ein CI-Job oder ein Agent sollte nicht dein Passwort enthalten. Gib ihm ein Token, das auf
wenige Aktionen für ein einzelnes Projekt beschränkt ist, erstellt über ein angemeldetes Terminal mit
`rebase cloud tokens create --project shop --can deploy,logs`, und setze es als
`REBASE_TOKEN`. Die Abrechnung, das Aktivitätsprotokoll und die Benachrichtigungseinstellungen
einer Organisation sind eigene Berechtigungen (`--can billing`, `audit`,
`notifications`), die ein Token nur dann besitzt, wenn sie explizit angefordert wurden. Die Berechtigungen, ein
GitHub Actions-Workflow und was einer angemeldeten Person vorbehalten bleibt, werden unter
[CI and agents](/docs/deployment/cloud-agents/#ci-and-agents) beschrieben.

## Ein Backend ohne Konto

`rebase cloud init --claim` stellt einer App ein Live-Backend bereit, noch bevor sich jemand
registriert hat, und gibt eine Claim-URL aus, mit der die Person es behalten kann; ein Projekt, das niemand
innerhalb von 72 Stunden beansprucht, wird gelöscht. Was das Token des unbeanspruchten Projekts tun darf,
das `REBASE_API_TOKEN`, das es schreibt, und was sich durch das Claiming ändert, wird unter
[A backend with no account](/docs/deployment/cloud-agents/#a-backend-with-no-account) beschrieben.

## Compute und die anfallenden Kosten

Der Preis eines Projekts richtet sich nach den reservierten Ressourcen, nicht nach Tarifen. `compute` gibt
jeden Regler und den detaillierten Kostenvoranschlag der Control Plane dafür aus. (`rebase cloud
resources` ist etwas anderes: die Datenbanken und Buckets, die der Code deklariert,
und ob die jeweilige Ressource bereitgestellt ist – siehe [CLI reference](/docs/cli/cloud/).)

```bash
rebase cloud compute
rebase cloud compute set --cpu 500m --memory 2Gi
```

| Regler | Einheit und Bedeutung |
|---|---|
| `--cpu`, `--memory` | App-Request pro Instanz, z. B. `500m` und `2Gi`. Leer bedeutet Plattformstandard – `100m` und `384Mi`, mit Bursting auf bis zu 2 CPUs und `2Gi` |
| `--replicas` | Instanzen, die dauerhaft existieren: die Untergrenze des Autoscalers und das, was das Projekt-Abonnement monatlich abrechnet |
| `--autoscale-max` | 1–16. Die Obergrenze, die erreicht werden darf. Instanzen, die der Autoscaler über `--replicas` hinaus hinzufügt, werden sekundengenau pro Pod zu denselben Tarifen gemessen und nur dort berechnet, wo die Plattform dies aktiviert hat; **Usage this month** gibt an, wo. `--no-autoscale` schaltet dies ab |
| `--autoscale-cpu-target` | 10–95. Die CPU-Auslastung, die der Autoscaler anstrebt – bezogen auf den Request, nicht auf das Limit. Leer bedeutet 70 |
| `--spot` | `true` oder `false`. Unterbrechbare (Spot-)Kapazität: günstiger, wird jedoch ohne Vorankündigung neu gestartet |
| `--db-instances` | 1–3. `1` ist eine Einzelinstanz ohne Failover; `2` fügt eine automatische Standby-Instanz hinzu |
| `--db-cpu`, `--db-memory` | Pro Datenbankinstanz. Leer bedeutet `160m` und `1Gi` |

Ein leerer Regler ist nicht dasselbe wie ein auf denselben Wert fixierter: Ein leerer Regler
folgt dem Plattformstandard und passt sich an, wenn dieser sich ändert.

Die CLI validiert bewusst nichts – die Limits gehören zu dem Cluster, auf dem ein
Projekt läuft, und unterscheiden sich je nach Anbieter. Die Control Plane lehnt einen
Wert ab, den sie nicht erfüllen kann, und benennt das Feld. Führe `rebase cloud compute` aus, um
die Beträge in €/Monat vor und nach der Änderung zu sehen; eine Änderung wird sofort wirksam, anteilig ab heute,
mit Ausnahme von Änderungen, die einen Neustart der Datenbank erfordern, welche auf ein Wartungsfenster warten.

## Der restliche Befehlsumfang

| Befehlsgruppe | Was sie abdeckt |
|---|---|
| `login`, `logout`, `whoami`, `access-token` | Deine Sitzung; `access-token` gibt das Bearer-Token aus, das die CLI jetzt senden würde, für Skripte und den MCP-Server |
| `tokens` | Tokens für CI und Agents, jeweils beschränkt auf ein Projekt. Siehe [CI and agents](/docs/deployment/cloud-agents/#ci-and-agents) |
| `link`, `unlink`, `use`, `open` | Verknüpfen dieses Verzeichnisses mit einem Projekt, Auswählen einer Organisation, Öffnen der Konsole |
| `connect` | Einen selbst gehosteten Rebase-Server zu Ihrem Konto hinzufügen, damit der [Rebase-Connector](/docs/ai/rebase-connector/) in Claude ihn neben Ihren Cloud-Projekten erreicht. `--list` zeigt sie, `--remove` entfernt einen. Inhaber und Administratoren |
| `init`, `claim` | Mit `--claim`: Ein Live-Backend ohne Konto und ein Link, um es zu claimen; `claim` gibt diesen Link erneut aus. Siehe [A backend with no account](/docs/deployment/cloud-agents/#a-backend-with-no-account) |
| `projects` | Erstellen, auflisten, inspizieren, löschen |
| `deploy`, `logs`, `deployments`, `rollback`, `cancel` | Bereitstellen und Überwachen |
| `previews` | Builds, die unter ihrer eigenen Adresse durch `deploy --preview` bereitgestellt werden, sowie deren Löschung. Siehe [Preview a change](#eine-änderung-in-der-vorschau-anzeigen) |
| `start`, `stop`, `restart` | Pausieren eines Projekts und dessen Wiederaufnahme. Ein gestopptes Projekt behält sein Abonnement, es sei denn, die Plattform berechnet für gestoppte Projekte nur Speicher und Plattformgebühr; die **Billing**-Zeile der Konsole weist darauf hin, wenn dies der Fall ist |
| `status`, `metrics`, `debug` | Was es gerade tut und warum es das nicht tut |
| `cron` | Die Cron-Jobs der bereitgestellten App und deren aufgezeichnete Ausführungen, ausgelesen mit deinem `rebase cloud`-Login. Schreibgeschützt |
| `env` | Umgebungsvariablen. `list` gibt niemals Werte aus; `--secret` ist Write-only |
| `app-key` | Der Schlüssel, den `init --claim` als `REBASE_API_TOKEN` in `.env` geschrieben hat und der beim Claim übergeben wird; `rotate` ersetzt ihn und widerruft den alten. Für Owner und Admins |
| `service-key` | `REBASE_SERVICE_KEY`, Administrator auf der app-eigenen API: Wann er zuletzt rotiert wurde; `rotate` weist der App einen neuen zu. Für Owner und Admins |
| `domains` | Eigene Domains, hinzuzufügende DNS-Einträge und Verifizierung. Ein Projekt kann unter mehreren Domains antworten, jede für sich verifiziert; `verify` und `remove` nehmen die Domain entgegen, auf die eingewirkt werden soll, was nur dann weggelassen werden darf, wenn es genau eine gibt (bei `verify` eine noch ausstehende). `list --json` gibt `{ projectId, tenantHost, domains: [...] }` zurück |
| `db` | Datenbank anbinden oder erstellen, Verbindung von deinem Rechner aus herstellen, Backups, Wiederherstellung und Point-in-Time Recovery |
| `guests` | Die Gastbenutzer, die durch anonyme Anmeldungen hinterlassen wurden: zählen, einzelne löschen, diejenigen bereinigen, die seit geraumer Zeit nicht mehr aktiv waren. Siehe [Guests](/docs/cli/cloud/#guests). Für Owner und Admins |
| `extensions` | Die Postgres-Erweiterungs-Allowlist |
| `storage` | Der Bucket des Projekts |
| `resources` | Welche Datenbanken und Buckets die Plattform hält, im Abgleich mit dem, was der Code deklariert |
| `compute` | Was dieses Projekt reserviert, was es kostet und wie man es ändert |
| `usage` | Diesen Monat verbrauchte Anfragen im Vergleich zum enthaltenen Kontingent und die bisherige Überziehung, wie sie auf der Rechnung gezählt wird. `usage org` listet alle Projekte der Organisation auf |
| `clusters` | Die Cluster, auf denen Tenants laufen. Nur für Plattform-Admins |
| `settings`, `orgs`, `billing` | Projekteinstellungen, Organisationen und deren Mitglieder und Einladungen, Bezahlung |
| `activity` | Das Audit-Protokoll der Organisation: Wer ein Deployment durchgeführt hat, eine Umgebungsvariable (nach Name), eine Domain, ein Backup, ein Mitglied oder ein Token geändert hat. Für Owner und Admins. Siehe [See who did what](#nachvollziehen-wer-was-getan-hat) |
| `notifications`, `webhooks` | Wohin die Events des Projekts per POST gesendet werden: Slack, Discord oder eine beliebige https-URL ([Cloud notifications](/docs/deployment/cloud-notifications/)). `webhooks` ist veraltet und beendet sich mit Statuscode 1 und dem Code `command_retired` |

Jede Gruppe in dieser Tabelle beantwortet `--help` mit einer eigenen Hilfeseite – einer Nutzungszeile,
ihren Flags und Beispielen – und `--help` führt den Befehl niemals aus. Ein Test prüft den
Index dieser Seiten ab; eine Gruppe, die ohne eine solche Seite hinzugefügt wird, lässt den Build fehlschlagen,
anstatt mit dem Inhaltsverzeichnis zu antworten. `verify:docs` gleicht die Tabelle selbst mit
diesem Index ab: Jede Gruppe, die die CLI bereitstellt, erscheint hier genau einmal, sodass eine Gruppe,
die ohne Tabellenzeile hinzugefügt wurde, den Build ebenfalls fehlschlagen lässt.

In einer Pipe gibt `--help` stattdessen JSON aus: dieselbe Nutzungszeile, dieselben Flags und Beispiele
als strukturierte Daten zum Auslesen statt sechzig Zeilen Terminal-Escape-Sequenzen.

## Was die Beta noch nicht enthält

Klar und deutlich formuliert, da es schlimmer ist, dies erst später herauszufinden:

- **Keine freie Regionswahl.** Derzeit läuft alles in einer einzigen Region. Das Platzierungsmodell
  existiert in der Plattform, ein Projekt kann die Region jedoch nicht frei wählen.
  `projects create --provider` und `--region` sind nicht die Ausnahme, nach der sie aussehen:
  Sie erfassen, zu welchem der registrierten Deployment-Ziele der Control Plane ein
  Projekt gehört. Da es nur eines gibt, fallen beide standardmäßig darauf zurück und keines von beiden verschiebt ein
  Projekt woanders hin. `rebase cloud projects create --help` weist auf dasselbe hin.
- **Kein Self-Service.** Der Zugang wird in Batches freigeschaltet; es gibt kein direktes Registrieren und Bezahlen.
- **Kein veröffentlichtes SLA** und kein SOC 2. Wenn du eines davon benötigst, gib dies bei der
  Zugangsanfrage an, anstatt davon auszugehen.
- **Keine Branch-Deployments** und keine First-Party-GitHub-App. Deploy-Hooks – geheime URLs,
  auf die ein Repository-Webhook verweist – sind die unterstützte Automatisierungsmethode. [Preview
  deploys](#eine-änderung-in-der-vorschau-anzeigen) werden schrittweise ausgerollt und über die CLI gestartet.
- **Tokens agieren als Person.** Ein [Token](/docs/deployment/cloud-agents/#ci-and-agents) wird von einem Konto
  ausgestellt und agiert in dessen Namen; es gibt noch keine organisationsbezogene Maschinenidentität. Wenn du dich
  stattdessen aus einer CI anmeldest, übergib `REBASE_CLOUD_EMAIL` und `REBASE_CLOUD_PASSWORD`
  aus einem Secret-Store – `--password` schreibt das Passwort in deine Shell-Historie und
  in die Prozesstabelle und weist darauf hin, bevor es dich anmeldet. Wenn die Datei `.rebase/cloud.json` des Repositories
  eine andere Control Plane als die plattformeigene benennt, übergib diese ebenfalls als `--url`: Ohne Terminal
  verweigert `login` das Senden eines Passworts an einen Host, der ausschließlich in der ausgecheckten Datei genannt wurde.
- **Kein öffentlicher Datenbank-Endpunkt.** Eine verwaltete Datenbank ist nicht für das
  Internet freigegeben. Der in der Konsole angezeigte Host ist daher die interne Adresse deines Backends
  und löst auf deinem lokalen Rechner zu nichts auf. `rebase cloud db connect` öffnet einen lokalen
  Port zu dieser Datenbank, getunnelt über die Control Plane, solange
  du den Befehl laufen lässt – es gibt jedoch keinen permanenten Hostnamen, zu dem sich ein Dienst eines Drittanbieters
  verbinden könnte. Dieser Tunnel sowie das Passwort hinter
  `rebase cloud db info --reveal` erfordern beide die Rolle des Owners oder Admins der Organisation:
  dieselbe Rolle, die auch der SQL-Editor des Studios verlangt, da alle drei Zugriffe in einer
  Sitzung auf deinen Produktionsdaten enden.
- **Ein Deployment bedeutet das Ausführen von Code mit Produktions-Secrets.** Die Umgebung der
  App enthält `REBASE_SERVICE_KEY` (Administrator auf der app-eigenen API),
  `DATABASE_URL` und `JWT_SECRET`, sodass Code, den ein Mitglied bereitstellt, diese auslesen kann,
  obwohl nur Owner und Admins sie in der Konsole aufdecken können. Lade nur Personen
  als Mitglieder ein, denen du diese Werte anvertrauen würdest.
- **Der Service Key kann ersetzt werden.** In den **Settings** des Projekts
  (oder per `rebase cloud service-key rotate`) wird ein neuer `REBASE_SERVICE_KEY` generiert
  und die App damit neu gestartet. Der alte Schlüssel funktioniert noch, bis der Neustart
  abgeschlossen ist, und danach nicht mehr; jeder Zugriff mit dem alten Schlüssel wird ab
  diesem Zeitpunkt abgewiesen. Das Claimen eines Projekts bewirkt dasselbe.

## Stattdessen Self-Hosting

Nichts hier bedeutet einen Lock-in. Der [Self-Hosting-Leitfaden](/docs/deployment/self-hosting/)
führt das identische Image und Bundle mit `docker compose` aus, und der
[Kubernetes-Leitfaden](/docs/deployment/kubernetes/) bildet dieselbe Topologie aus
dem Helm-Chart ab.
