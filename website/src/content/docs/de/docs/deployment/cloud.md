---
sourceHash: a6cdd8811eca0897
title: Rebase Cloud
sidebar_label: Rebase Cloud
description: Rebase Cloud ist dasselbe Rebase, für Sie betrieben. Was es ist, wie ein Projekt verknüpft und bereitgestellt wird und was die Private Beta noch nicht enthält.
---

Rebase Cloud führt dasselbe Open-Source-Rebase aus, das Sie selbst hosten würden – dasselbe veröffentlichte `rebasepro/server`-Image, dasselbe Bundle, dasselbe Postgres. Der Unterschied besteht darin, wer es betreibt.

:::note[Private beta]
Rebase Cloud befindet sich in der **Private Beta**. Es betreibt bereits heute echte Mandanten und wird schrittweise freigeschaltet. [Zugang anfragen](https://rebase.pro/pricing).

Es handelt sich nicht um Self-Service, daher erfordern die folgenden Befehle ein freigeschaltetes Konto. Alles andere auf dieser Website funktioniert auch ohne.
:::

## Was es ist

Ein Cloud-**Projekt** besteht aus drei Dingen, die die Plattform für Sie betreibt:

| | Was Sie erhalten |
|---|---|
| **App** | Ihr Bundle, ausgeführt auf dem veröffentlichten Runtime-Image. Deployments sind ein Bundle-Upload, kein Container-Build |
| **Database** | Ein verwaltetes PostgreSQL mit automatisierten Backups und Point-in-Time-Recovery |
| **Storage** | Ein eigenes Bucket, falls Ihr Projekt Dateispeicher verwendet |

Die App und die Datenbank werden beim ersten Deployment bereitgestellt; ein Bucket erst dann, wenn Sie eines anfordern ([File storage](#dateispeicher)). Jede Ressource wird nach den reservierten Kapazitäten abgerechnet, nicht pro Benutzerplatz.

**An Ihrem Projekt ändert sich nichts, um dort ausgeführt zu werden.** Dasselbe Repository kann mit `docker compose` selbst gehostet werden, und der Ausstiegsweg (Escape Hatch) ist real: `rebase build` erzeugt ein Bundle, das überall startet, wo das Runtime-Image ausgeführt werden kann.

## Ein Projekt verknüpfen

Aus einem Projektverzeichnis heraus:

```bash
rebase cloud login
rebase cloud billing setup
rebase cloud projects create --name "My app" --subdomain my-app --link
```

`login` öffnet die Konsole in Ihrem Browser und gibt einen kurzen Code aus. Überprüfen Sie, ob die Konsole denselben Code anzeigt, und bestätigen Sie die Anmeldung dort: Das Terminal übernimmt die Sitzung und schreibt sie in `~/.rebase/credentials.json`. Wenn Sie nicht in der Konsole angemeldet sind, melden Sie sich dort zuerst an (u. a. per Google oder GitHub). Über SSH gibt `rebase cloud login --no-browser` den Link aus, den Sie auf Ihrem eigenen Rechner öffnen können.

`projects create` nimmt kein Positionsargument entgegen. Der Name und die Subdomain sind Flags, und beide sind erforderlich – im Terminal werden sie abgefragt, und eine Headless-Ausführung, die eines davon auslässt, bricht mit `input_required` ab, anstatt einen Wert zu erfinden. **Die Subdomain kann nachträglich nicht mehr bearbeitet werden:** Sie ist der `<slug>.rebase.website`-Host, unter dem das Projekt erreichbar ist; wählen Sie sie also mit Bedacht.

`--link` verknüpft dieses Verzeichnis im selben Aufruf mit dem Projekt, sodass kein separater `link`-Schritt erforderlich ist. Es schreibt `.rebase/cloud.json`, worin die Projekt-ID und der Slug gespeichert werden. Diese Datei ist kein Geheimnis und enthält keine Anmeldedaten – diese befinden sich in `~/.rebase/credentials.json`, geschrieben von `login`.

Sie wird jedoch mit dem Code committet, sodass ein geklontes Repository jede beliebige Control Plane benennen kann. Wenn der Host ausschließlich aus dieser Datei stammt und weder der eigene der Plattform ist noch einer, bei dem Sie sich zuvor angemeldet haben, nennt `login` diesen und fragt nach, bevor Ihre E-Mail-Adresse und Ihr Passwort dorthin gesendet werden. Ohne Terminal oder mit `--json` bricht der Befehl mit `unknown_control_plane` ab; übergeben Sie `--url <host>` (oder setzen Sie `REBASE_CLOUD_URL`), um sich dort gezielt anzumelden.

Um sich ohne Browser anzumelden, übergeben Sie Ihre E-Mail-Adresse: `rebase cloud login --email me@example.com` fragt nach Ihrem Passwort. **Haben Sie sich mit Google, GitHub oder LinkedIn registriert?** Ihr Konto hat kein Passwort, verwenden Sie daher stattdessen einen Code:

```bash
rebase cloud login --code --email me@example.com
```

Die Control Plane sendet Ihnen per E-Mail einen 6-stelligen Code, der zehn Minuten lang gültig ist, und Sie geben ihn an der Eingabeaufforderung ein. Bei Verwendung von `--email` ohne Passwort fragt `rebase cloud login`, ob Sie Ihr Passwort oder einen Code verwenden möchten. Codes setzen voraus, dass die Control Plane E-Mails versenden kann; ist dies nicht der Fall, weist `--code` darauf hin und bricht mit `otp_unavailable` ab.

Wenn Sie die Zwei-Faktor-Authentifizierung aktiviert haben, fragt `login` anschließend nach dem Code aus Ihrer Authentifikator-App oder einem Ihrer Wiederherstellungscodes – unabhängig davon, wie Sie sich angemeldet haben. Im Browser fragt die Konsole bei der Anmeldung danach. Weder ein Anmeldecode noch ein zweiter Faktor können ohne Terminal eingegeben werden. Erstellen Sie für Skripte ein Zugriffstoken in der Konsole (**Einstellungen → Zugriffstoken**) und setzen Sie `REBASE_TOKEN`; siehe [CI and agents](/docs/deployment/cloud-agents/#ci-and-agents).

Ein falsches Passwort liefert `invalid_credentials` zusammen mit denselben beiden Anmeldeoptionen, da die häufigste Ursache ein Konto ist, das nie ein Passwort besaß.

`billing setup` hinterlegt einmalig eine Zahlungskarte für die Organisation. Es steht bewusst an erster Stelle in der Reihenfolge: Das erste Deployment eines Projekts wird ohne hinterlegte Karte abgelehnt, und dies erst nach dem vollständigen Upload eines Bundles zu erfahren, wäre die ungünstigere Reihenfolge.

Danach listet die Seite **Abrechnung** in der Konsole die Rechnungen der Organisation auf – jeweils mit Stripes gehosteter Seite und PDF – und zeigt eine Vorschau auf die nächste Rechnung jedes Projekts. `rebase cloud billing invoices` und `rebase cloud billing upcoming` geben dasselbe aus. Beide sind für die Eigentümer und Administratoren der Organisation bestimmt. Sofern von der Plattform angeboten, öffnet **Abrechnung verwalten** das Stripe-Kundenportal für die Karte, die Rechnungsdaten und vergangene Rechnungen.

Wenn bereits eine Karte hinterlegt ist, erfordert das Erstellen eines weiteren Projekts in der Konsole keine erneute Zahlung: Das Projekt wird über diese Karte abgerechnet und bereitgestellt. Wird die Karte abgelehnt oder verlangt die Bank eine Zahlungsbestätigung, führt die Konsole Sie zu **Abrechnung**, wo **Karte korrigieren** eine andere Karte speichert und **Zahlung abschließen** die Stripe-Rechnung öffnet.

Was ein Projekt verbraucht hat, wird in dessen Übersicht unter **Nutzung diesen Monat** angezeigt sowie für alle Projekte gleichzeitig auf der Seite **Abrechnung**: Anfragen im Vergleich zum enthaltenen Kontingent (der Balken wird bei 80 % bernsteinfarben), 5xx-Fehler, die bisherigen Mehrkosten (Overage) und wohin sich der Monat bei diesem Tempo entwickelt. Die Mehrkosten werden von demselben Code berechnet, der sie an Stripe meldet, entsprechen also genau dem späteren Rechnungsbetrag; sie erscheinen auf der Rechnung des Folgemonats. `rebase cloud usage` gibt dasselbe aus und `rebase cloud usage org` für die gesamte Organisation. Jedes Mitglied kann dies einsehen. Die Zahlen weisen darauf hin, was sie noch nicht erfassen können: Objektspeicher wird nicht gemessen, daher fallen keine Speicher-Mehrkosten an; solange ein Projekt zwei oder mehr App-Pods betreibt, werden dessen Anfragen nicht gezählt; und ein Tag mit fehlenden Messwerten zählt zu wenig. Ein automatisch skaliertes Projekt zeigt zudem die Pods an, die über `--replicas` hinaus liefen, in Pod-Stunden, was diese zu den jeweiligen Tarifen kosten und ob diese Plattform sie bereits in Rechnung stellt. Ein von einem Agenten beanspruchtes (claimed) Projekt zählt erst ab dem Tag des Claims: Davor gehörte das Projekt der Plattform.

Ein bestehendes Projekt lässt sich verknüpfen, ohne ein neues zu erstellen:

```bash
rebase cloud projects list
rebase cloud link --project my-app
```

## Bereitstellen

```bash
rebase cloud deploy
```

Ein einziger Befehl und kein Flag, das man sich merken müsste. Die `rebase.json` eines Scaffolds deklariert `runtime: "managed"` für sein Backend, und `deploy` liest diese Deklaration – dies wird während des Vorgangs gemeldet (`rebase.json declares runtime: managed — deploying a bundle`), baut die App nach `dist-bundle`, lädt das Bundle hoch, führt es auf dem veröffentlichten Runtime-Image aus und verfolgt das Deployment bis zu einem finalen Zustand. Der Exit-Code liefert das Ergebnis, sodass dieselbe Zeile unbeaufsichtigt in CI funktioniert.

Am Ende wird ausgegeben, unter welchen Adressen jede App nun erreichbar ist und ob die neue Version dort live ist:

```text
  ✓ Deployed songbuzz in 1m 12s  (deployment fb3c7442-9937-4179-8d3c-88a106da149d)

    game     static   https://songbuzz.rebase.website      live
    backend  backend  https://songbuzz.rebase.website/api  live

  ✓ Live: the new version answers on every address above.
  Something wrong? `rebase cloud rollback` puts the previous deployment back.
```

„Live“ bedeutet, dass die Adresse nach dem Build geantwortet hat: `/health` eines Backends gab `ok` zurück und die Seite einer statischen App wurde geladen (aus diesem Deployment, wenn die Plattform sie ausliefert). Die Prüfung wartet bis zu `--live-timeout` Sekunden, standardmäßig 60; `0` überspringt sie. Wenn eine App nicht rechtzeitig antwortet, wird das Deployment dennoch mit Exit-Code 0 beendet, da das Deployment erfolgreich war, und die letzte Zeile gibt an, welche App nicht geantwortet hat und warum. Ein fehlgeschlagenes Deployment endet stattdessen mit einer einzelnen Zeile, die die App und den Grund nennt, wobei `rebase cloud logs` das vollständige Build-Protokoll liefert.

Skripte übergeben `--json` für ein einzelnes Objekt mit denselben Informationen – `apps`, `hosts`, `live`, `liveChecks`, `durationMs` und der Deployment-ID. Anders als der Rest von `rebase cloud` schaltet `deploy` nicht automatisch auf JSON um, wenn die Ausgabe weitergeleitet wird.

Was diese Runtime erlaubt – Pakete und native Module, Arbeitsspeicher und Instanzen, Timeouts und Body-Größen, das Dateisystem, Secrets, Storage und ausgehender Netzwerkverkehr – wird auf einer eigenen Seite beschrieben:
[Managed backend runtime](/docs/deployment/managed-runtime/).

Um ein zuvor erstelltes Artefakt bereitzustellen – etwa in einem CI-Job, der einmal baut und zweimal deployt –, verweisen Sie auf das Verzeichnis, anstatt neu zu bauen:

```bash
rebase build
rebase cloud deploy --bundle-dir dist-bundle
```

Das Verlassen der verwalteten Runtime erfolgt über ein eigenes Flag, `--eject`, und wird durch nichts anderes angefordert: Ein Build, der ein verwaltetes Projekt auf ein Container-Image umstellen würde, das es dann selbst verwaltet, wird abgelehnt, bis Sie dies explizit angeben. Früher bedeutete `--force` dies, was die am wenigsten umkehrbare Aktion der CLI unter dasselbe Wort wie „diese Datei überschreiben“ stellte; es ist jetzt eine unbekannte Option statt eines Alias, sodass ein Skript, das es enthält, stattdessen stoppt.

### Die Syntaxprüfung vor dem Upload

Die Dateien einer statischen App werden genau so ausgeliefert, wie sie sind. Wenn deren `build` lediglich handgeschriebene Skripte nach `output` kopiert, wurden sie von nichts geparst, und eine Datei mit einem Tippfehler geht live und verhindert das Laden der Seite. Bevor etwas hochgeladen wird, parst `deploy` daher jede `.js`-, `.mjs`- und `.cjs`-Datei im `output` jeder statischen App sowie jedes Inline-`<script>` in deren `.html`-Dateien. Dies deckt sowohl eigenständig bereitgestellte statische Apps ab als auch statische Apps, die in das Backend-Bundle integriert sind. Ein Syntaxfehler stoppt das Deployment unter Angabe von Datei, Zeile und Spalte:

```
✗ A syntax error in the static output, so nothing was deployed:
    web/cloud.js:42:23  Unexpected token
        42 |     return fetch("/api";
Fix it and deploy again, or pass --no-verify to deploy anyway.
```

Bei `--json` lautet der `code` des Fehlers `syntax_error`. Inline-Skripte, die ein Browser nicht als JavaScript ausführt, werden übersprungen: JSON, Import Maps, Templates und jeder andere Nicht-JavaScript-`type`, ein `<script src>` sowie Skripte, die noch ungerendertes Template-Markup wie `{{ }}` enthalten. Eine `.js`-Datei besteht die Prüfung, wenn sie sich entweder als klassisches Skript oder als Modul parsen lässt, da die Seite entscheidet, was zutrifft. Unter `node_modules` wird nichts gelesen, ebenso wenig wie ein vorgefertigtes `--bundle-dir`. `--no-verify` überspringt die Prüfung für ein einzelnes Deployment.

Beobachten:

```bash
rebase cloud logs               # the build log
rebase cloud logs --runtime -f  # what the running app prints, live, until Ctrl-C
rebase cloud status             # what the platform thinks the project is doing
```

`status` meldet `blockedOn` und `nextAction`. Wenn `blockedOn` den Wert `null` hat, arbeitet die Plattform tatsächlich und Polling ist das Richtige; wenn dort etwas angegeben ist, wartet dieses Etwas auf Sie.

Ein möglicher Wert ist `email_not_configured`: Die App hat die Anmeldung per Magic-Link oder E-Mail-Code aktiviert (`AUTH_MAGIC_LINK`, `AUTH_EMAIL_OTP`), verfügt jedoch über keinen E-Mail-Dienst, sodass das Deployment zwar live ist, sich aber niemand darüber anmelden kann. Rebase Cloud versendet keine E-Mails für Ihre App: Setzen Sie `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` und `SMTP_FROM` mit `rebase cloud env set` und führen Sie anschließend ein Deployment durch. `status` liest dies aus dem app-eigenen `GET /api/auth/config` (dessen `unavailable`-Feld) aus, und `deploy` meldet dasselbe unter seinem Live-Check.

## Dateispeicher

Ein neues Projekt hat kein Bucket: Uploads werden mit `501 STORAGE_NOT_CONFIGURED` abgelehnt, worauf die Deployment-Zusammenfassung hinweist, anstatt auf eine Festplatte geschrieben zu werden, die bei jedem Deployment ersetzt wird.

Weisen Sie ihm eine von zwei Arten zu und führen Sie das Deployment erneut aus, damit die App dies übernimmt:

```bash
# A bucket Rebase runs for you. The console's Storage page does the same.
rebase cloud storage create

# Or your own S3-compatible bucket: AWS S3, Cloudflare R2, Backblaze B2, MinIO…
rebase cloud storage attach --bucket <name> \
  --access-key-id <id> --secret-access-key <secret> \
  --endpoint <url>        # omit for AWS; add --force-path-style for MinIO

rebase cloud deploy
```

`rebase cloud storage` listet die Buckets des Projekts auf. Ein Projekt mit mehreren bindet jedes über `--source <key>` an; ein Projekt, das den Speicher im Code konfiguriert, benötigt keines von beidem.

## Vorschau einer Änderung

```bash
rebase cloud deploy --preview
```

Dies baut und lädt genau das hoch, was auch `deploy` verarbeiten würde, stellt es jedoch unter einer eigenen Adresse bereit, wie z. B. `https://shop--k3x9ab.rebase.website`. Die Produktionsumgebung liefert weiterhin das aus, was sie zuvor ausgeliefert hat. Das Deployment gibt die Adresse der Preview aus, sobald der Build abgeschlossen ist.

Um dieselbe Adresse über mehrere Deployments hinweg beizubehalten, benennen Sie die Preview. Ein erneutes Deployment mit demselben Namen aktualisiert sie:

```bash
rebase cloud deploy --preview-name new-checkout
```

Womit eine Preview kommuniziert, hängt davon ab, was Sie bereitgestellt haben:

- **`rebase cloud deploy --preview`** erstellt eine Vorschau des Backends einschließlich der integrierten statischen Apps, genau wie in der Produktion. Es erhält ein eigenes Backend mit einer **eigenen, leeren Datenbank**, niemals der Produktionsdatenbank. Ein Start gegen die Produktionsdatenbank würde das Schema und die Zugriffsregeln der Preview auf diese anwenden.
- **`rebase cloud deploy web --preview`** würde eine Vorschau einer einzelnen statischen App für sich allein erstellen, deren Seiten das **Produktions-Backend** aufrufen. Dafür wird eine Control Plane benötigt, die statische Websites eigenständig ausliefert – das unterstützt Rebase Cloud derzeit noch nicht: Es bricht mit `PREVIEW_STATIC_UNSERVED` ab und veröffentlicht nichts. Erstellen Sie stattdessen eine Vorschau des Backends, welches die darin integrierten statischen Apps ausliefert; ein Projekt ohne verwaltetes Backend kann derzeit noch nicht in der Vorschau bereitgestellt werden.

Eine Preview lädt keinen Quellcode hoch und registriert weder Apps noch Hostnamen, da jedes davon das Produktionsprojekt verändern würde. `--source` und `--eject` können nicht mit `--preview` kombiniert werden. Beide erstellen ein Container-Image für die Produktion.

```bash
rebase cloud previews                      # name, address, app, backend, expiry
rebase cloud logs --preview new-checkout   # its build log; -f follows a build still running
rebase cloud logs --runtime --preview new-checkout -f  # what its backend prints
rebase cloud previews delete new-checkout  # stops serving it and drops its database
```

`rebase cloud logs` ohne `--preview` bezieht sich immer auf die Produktion.

Die Seite **Deployments** in der Konsole listet dieselben Previews auf und ermöglicht das Öffnen, Einsehen des Build-Protokolls oder Löschen jeder einzelnen davon. Das Erstellen bleibt ein CLI-Schritt.

Eine Preview läuft eine Woche nach dem letzten Deployment darauf ab.

Nach Abschluss prüft das Deployment, ob die Adresse der Preview antwortet, genau wie bei einem Produktions-Deployment (`--live-timeout <seconds>`, `0` zum Überspringen). Das Zertifikat einer neuen Preview kann ein bis zwei Minuten dauern, sodass ein erfolgreiches Deployment melden kann, dass die Adresse noch nicht antwortet.

Eine Backend-Preview wird wie eine App-Einheit in der Standardgröße abgerechnet (100m CPU und 384 MiB Arbeitsspeicher, zum Tarif Ihrer App für deren Region und Kapazität), anteilig für die Dauer ihres Bestehens, und erscheint im monatlichen Kostenvoranschlag des Projekts in der Konsole. `rebase cloud deploy --preview` gibt denselben Kostenvoranschlag pro Monat dafür aus (`cost` unter `--json`). Zum Starten ist wie bei einem Produktions-Deployment eine hinterlegte Zahlungskarte erforderlich. Ein erstes Deployment, das fehlschlägt, bevor etwas ausgeführt wird, wird entfernt statt berechnet. Ein Projekt darf bis zu drei Backend-Previews gleichzeitig ausführen.

Jede neue Preview-Adresse erhält ein eigenes TLS-Zertifikat von Let's Encrypt, das für eine Domain 50 neue Zertifikate pro Woche zulässt – geteilt mit jeder Produktions-Site darauf. Previews dürfen plattformweit bis zu 20 davon innerhalb von 7 Tagen beanspruchen. Darüber hinaus wird eine neue Preview abgelehnt (`429`, `preview_cert_budget`), unter Angabe des Zeitpunkts, ab dem sie wieder bereitgestellt werden kann; ein erneutes Deployment einer bereits bestehenden Preview zählt nie dagegen.

Die Datenbank einer Backend-Preview ist eine zweite Datenbank auf dem Postgres der **Produktion**: eigene Daten, aber dieselbe Instanz und dieselbe Festplatte. Sie ist auf 10 Verbindungen beschränkt, sodass Previews nicht die Verbindungen der Produktion aufbrauchen können, sowie auf 2 GB: Eine Preview, deren Datenbank darüber hinaus wächst, wird pausiert. Ihr Backend stoppt, ihre Adresse antwortet nicht mehr, `rebase cloud previews` und die Konsole zeigen sie als `paused` mit dem entsprechenden Grund an, und die Eigentümer und Administratoren des Projekts werden benachrichtigt (`preview.paused`). Ihre Daten bleiben bis zum Ablauf erhalten. Führen Sie erneut ein Deployment durch, um sie zu starten (sie wird erneut pausiert, solange die Datenbank noch zu groß ist), oder löschen Sie sie. Eine pausierte Preview wird weiterhin abgerechnet, bis sie gelöscht wird oder abläuft. Löschen Sie Previews, die Sie nicht mehr benötigen. Extensions, die in der Produktion installiert sind, werden in der Datenbank einer Preview nicht installiert.

Previews werden schrittweise eingeführt. Eine Control Plane, die sie noch nicht unterstützt, lehnt `--preview` mit `previews_unavailable` ab und stellt nichts bereit.

## Rollback

```bash
rebase cloud deployments
rebase cloud rollback
```

Ein Rollback verweist das Projekt wieder auf den Stand eines früheren erfolgreichen Deployments und baut niemals neu – der Wert eines Rollbacks besteht darin, dass ein Artefakt ausgeliefert wird, das bereits erfolgreich gelaufen ist.

Welche Deployments dafür infrage kommen, hängt davon ab, wie das Projekt bereitgestellt wird – beide Arten funktionieren:

| Art des Deployments | Was wiederhergestellt wird |
|---|---|
| `rebase cloud deploy` (ein Source-Build) | Das Image, das dieser Build veröffentlicht hat |
| `rebase cloud deploy --bundle` (die Plattform-Runtime) | Das Bundle, das dieses Deployment ausgeliefert hat, auf der Runtime-Version, die das Projekt aktuell ausführt |

Statische Apps, die in das Backend-Bundle integriert sind (ein einfaches `rebase cloud deploy` bei einem Projekt mit Backend), sind Teil dieses Bundles und werden daher mit zurückgesetzt.

Eine eigenständig bereitgestellte statische App (`rebase cloud deploy <app>`) kann derzeit noch nicht zurückgerollt werden. Ihr Deployment zeichnet auf, welche App veröffentlicht wurde, jedoch kein Bundle, sodass die Control Plane keine Grundlage hat, aus der sie wiederhergestellt werden könnte. Die Lösung besteht darin, die letzte funktionierende Version erneut bereitzustellen, beispielsweise aus dem Commit vor dem fehlerhaften. Nach einem solchen Deployment weist `deploy` darauf hin, anstatt auf `rollback` zu verweisen, und `rollback` ohne ID bricht ab, anstatt das aktuell laufende Backend erneut bereitzustellen.

Ein Rollback benötigt also ein Deployment, das eines von beiden aufgezeichnet hat, was ein Projekt voraussetzt, das mindestens zweimal erfolgreich bereitgestellt wurde. `rebase cloud deployments` kennzeichnet die qualifizierten Einträge, und `--json` gibt pro Zeile `rollbackable` zusammen mit dem `image` oder `bundle` aus, das wiederhergestellt werden würde.

Zwei Arten von Deployments werden abgelehnt, und die CLI nennt den Grund: eines, das nicht erfolgreich war, und eines aus der Zeit, bevor die Plattform Artefakte aufzeichnete. In beiden Fällen wird nicht geraten – Raten würde bedeuten, das zuletzt Gebaute oder Hochgeladene auszuliefern und fälschlicherweise zu behaupten, dieses wiederherzustellen. Stellen Sie stattdessen die gewünschte Version explizit bereit.

Jedes erfolgreiche Deployment endet mit dem Hinweis auf den Weg zurück (`rebase cloud rollback`), sodass dieser genau in dem Moment sichtbar ist, in dem ein fehlerhaftes Release bemerkt wird.

Ein Rollback hängt ein neues Deployment an, anstatt die Historie zurückzuspulen, und wartet, bis die wiederhergestellte Version Anfragen bedient, bevor der Erfolg gemeldet wird. Verfolgen Sie dies mit `rebase cloud logs -f`.

## Die Datenbank zu einem bestimmten Zeitpunkt wiederherstellen

Eine verwaltete Datenbank kann auf jede beliebige Minute innerhalb ihres Wiederherstellungsfensters zurückgesetzt werden – über **Datenbank → Backups** in der Konsole oder über die CLI:
`rebase cloud db pitr status | restore --target <ISO> | cutover | discard`.
Dies geschieht in zwei Schritten. Zuerst wird eine wiederhergestellte Kopie neben der Produktivdatenbank bereitgestellt; Ihre App läuft auf der Produktivdatenbank weiter, und der Speicher der Kopie wird abgerechnet, bis Sie umschalten oder sie verwerfen.
Sobald die Kopie bereit ist, lenkt das Umschalten (Cutover) die App darauf um und startet sie neu. Alles, was nach dem Zielzeitpunkt geschrieben wurde, ist in der Kopie nicht enthalten. Die ursprüngliche Datenbank bleibt als Rückfallebene erhalten und wird speicherseitig weiter abgerechnet; das Zurückwechseln, Entfernen oder ein zweites Wiederherstellen erfolgt über den Support. Nur ein Eigentümer oder Administrator kann stagen, umschalten oder verwerfen, und die Konsole verlangt den Projektnamen zur Bestätigung vor dem Cutover.

## Ihr Konto absichern

Ihr Konsolenkonto hat Zugriff auf Produktionsdatenbanken, Secrets und Abrechnungsdaten – schützen Sie es entsprechend. Öffnen Sie **Kontosicherheit** über das Menü unter Ihrem Avatar in der Konsole (oder gehen Sie zu `/account`). Diese Seite gehört Ihnen persönlich, nicht einer Organisation: Was Sie dort festlegen, gilt in jeder Organisation, der Sie angehören.

- **Zwei-Schritt-Verifizierung.** Aktivieren Sie sie mit einer beliebigen Authentifikator-App (1Password, Google Authenticator, Authy). Die Seite zeigt einen Einrichtungsschlüssel zum Hinzufügen zur App oder einen Link, der die App auf einem Telefon mit bereits eingetragenem Schlüssel öffnet, und fragt anschließend nach dem 6-stelligen Code aus der App. Von da an verlangt jede Anmeldung einen Code, egal ob Sie sich mit Passwort, Google oder GitHub anmelden.
- **Wiederherstellungscodes.** Bei der Aktivierung erhalten Sie zehn Einmalcodes, die nur einmal angezeigt werden. Jeder davon ermöglicht Ihnen die Anmeldung anstelle des Authentifikator-Codes, falls Sie Ihr Telefon verlieren; speichern Sie diese daher, bevor Sie den Dialog schließen. **Neue Wiederherstellungscodes** ersetzt sie, und die alten verlieren ihre Gültigkeit. Sowohl das Deaktivieren der Zwei-Schritt-Verifizierung als auch das Anfordern neuer Codes verlangen zuerst die Eingabe eines aktuellen Codes.
- **Passwort.** Eine Änderung meldet Sie auf allen anderen Geräten ab. Ein mit Google, GitHub oder LinkedIn erstelltes Konto hat kein Passwort; die Seite bietet an, Ihnen einen Link per E-Mail zu senden, um eines festzulegen.
- **Angemeldete Geräte.** Jeder Browser und jedes Terminal, das bei Ihrem Konto angemeldet ist, mit Adresse und Anmeldezeitpunkt. Melden Sie unbekannte Geräte oder alle auf einmal ab.

[Access tokens](/docs/deployment/cloud-agents/#ci-and-agents) sind keine Sitzungen und verlangen keinen zweiten Faktor, sodass CI nach der Aktivierung weiterhin bereitstellen kann. Widerrufen Sie Tokens, denen Sie nicht mehr vertrauen, unter **Einstellungen → Zugriffstoken**.

## Ihr Team einladen

**Mitglieder → Mitglied hinzufügen** fügt jemanden hinzu, der bereits ein Rebase-Konto mit verifizierter E-Mail-Adresse besitzt, entweder als Administrator oder als Mitglied; ein Eigentümer kann die Person später zum Eigentümer ernennen. Der Zugriff besteht sofort und es wird keine E-Mail versendet. Rebase Cloud verschickt derzeit noch keine Einladungen; bitten Sie Teammitglieder ohne Konto daher, sich zuerst zu registrieren und ihre Adresse zu verifizieren. Über das Terminal:
[`rebase cloud orgs members invite <email>`](/docs/cli/cloud/#organizations), was darauf hinweist, wenn für die Adresse kein Konto existiert.

## Cloud-Zugriff und die Benutzer Ihrer App

<span class="since-badge" data-since="0.35">Seit 0.35</span>

Dabei sind zwei getrennte Benutzerkreise beteiligt, ähnlich wie bei Firebase und Supabase:

- **Cloud-Zugriff** bestimmt, wer in Rebase Cloud am Projekt arbeiten kann. Eigentümer und Administratoren einer Organisation besitzen die Rolle `admin` für jedes Projekt der Organisation, deren Mitglieder die Rolle `developer`. Ein Projekt kann einer Person per E-Mail-Einladung auch eine eigene Rolle zuweisen (`admin`, `developer` oder `viewer`), ohne sie zum Mitglied der Organisation zu machen. Die jeweils höhere Berechtigung gilt.
  [`rebase cloud access`](/docs/cli/cloud/#project-access) verwaltet dies.
- **Die Benutzer Ihrer App** liegen in der datenbankeigenen Benutzerverwaltung der App, mit deren Registrierung und Rollen. Cloud listet oder bearbeitet diese niemals.

Die einzige Brücke bildet **Admin-Panel öffnen**. Es meldet eine Person mit `admin`-Cloud-Zugriff im Admin-Panel der App an, abgeglichen über deren verifizierte E-Mail-Adresse: Die App findet oder erstellt das Konto mit dieser Adresse, weist ihm die Rolle `admin` zu und vermerkt, dass die Rolle von Rebase Cloud stammt (in Studio unter Benutzer & Rollen gekennzeichnet). Verliert diese Person den `admin`-Cloud-Zugriff auf das Projekt, fordert Rebase Cloud die App auf, diese `admin`-Berechtigung wieder zu entziehen, und beendet deren Sitzungen in der App. Eine manuell in der App vergebene Rolle – einschließlich eines vor dem ersten „Admin-Panel öffnen“ bestehenden `admin`-Status – bleibt erhalten, und das Konto wird niemals gelöscht.

## Nachvollziehen, wer was getan hat

Die Seite **Aktivität** der Konsole und `rebase cloud activity` zeigen den Eigentümern und Administratoren der Organisation, wer ein Deployment durchgeführt, eine Umgebungsvariable gesetzt oder aufgedeckt (nach Name, nie nach Wert), eine Domain geändert, ein Backup wiederhergestellt, die Größe eines Projekts geändert, ein Projekt gestoppt oder gelöscht, die Rolle eines Mitglieds geändert oder ein Token erstellt hat – und wann dies geschah. Die **Einstellungen** eines Projekts verlinken auf dessen eigene Einträge; ein Eintrag zu einem gelöschten Projekt bleibt erhalten. Ein Skript kann dies mit einem Token auslesen, das mit `--can audit` für die Organisation erstellt wurde. Einträge werden ein Jahr lang aufbewahrt. Die Filter finden Sie in
[`rebase cloud`](/docs/cli/cloud/#organizations).

## CI und Agenten

Ein CI-Job oder ein Agent sollte nicht Ihr Passwort enthalten. Vergeben Sie stattdessen ein Token, das auf wenige Aktionen für ein einzelnes Projekt beschränkt ist – erstellt über ein angemeldetes Terminal mit
`rebase cloud tokens create --project shop --can deploy,logs` – und setzen Sie es als
`REBASE_TOKEN`. Abrechnung, Aktivitätsprotokoll und Benachrichtigungseinstellungen einer Organisation sind eigenständige Berechtigungen (`--can billing`, `audit`,
`notifications`), die ein Token nur erhält, wenn sie explizit angefordert werden. Die Berechtigungen, ein GitHub-Actions-Workflow und was bei einer angemeldeten Person verbleibt, finden Sie unter
[CI and agents](/docs/deployment/cloud-agents/#ci-and-agents).

## Ein Backend ohne Konto

`rebase cloud init --claim` stellt einer App ein Live-Backend bereit, noch bevor sich jemand registriert hat, und gibt eine Claim-URL aus, über die das Projekt übernommen werden kann; ein Projekt, das niemand innerhalb von 72 Stunden beansprucht, wird gelöscht. Welche Aktionen das Token des unbeanspruchten Projekts ausführen darf, was im geschriebenen `REBASE_API_TOKEN` steht und was sich durch das Claiming ändert, erfahren Sie unter
[A backend with no account](/docs/deployment/cloud-agents/#a-backend-with-no-account).

## Compute und die Kosten

Die Abrechnung eines Projekts richtet sich nach den reservierten Ressourcen, nicht nach Tarifen. `compute` gibt alle Stellschrauben und den detaillierten Kostenvoranschlag der Control Plane dafür aus. (`rebase cloud resources` ist etwas anderes: die Datenbanken und Buckets, die der Code deklariert, und ob diese jeweils bereitgestellt sind – siehe [CLI reference](/docs/cli/cloud/).)

```bash
rebase cloud compute
rebase cloud compute set --cpu 500m --memory 2Gi
```

| Parameter | Einheit und Bedeutung |
|---|---|
| `--cpu`, `--memory` | App-Request pro Instanz, z. B. `500m` und `2Gi`. Leer bedeutet Plattform-Standard, abhängig von der Region (siehe unten) |
| `--replicas` | Instanzen, die dauerhaft existieren: die Untergrenze des Autoscalers und was das Abonnement des Projekts monatlich abrechnet |
| `--autoscale-max` | 1–16. Die Obergrenze, die erreicht werden darf. Instanzen, die der Autoscaler über `--replicas` hinaus hinzufügt, werden pro Pod-Sekunde zu denselben Tarifen gemessen und nur dort berechnet, wo die Plattform dies aktiviert hat; **Nutzung diesen Monat** zeigt dies an. `--no-autoscale` deaktiviert dies |
| `--autoscale-cpu-target` | 10–95. Die CPU-Auslastung, die der Autoscaler anstrebt – bezogen auf den Request, nicht auf das Limit. Leer bedeutet 70 |
| `--spot` | `true` oder `false`. Preemptible Kapazität: günstiger, wird jedoch ohne Vorankündigung neu gestartet |
| `--db-instances` | 1–3. `1` ist eine Einzelinstanz ohne Failover; `2` ergänzt ein automatisches Standby |
| `--db-cpu`, `--db-memory` | Pro Datenbankinstanz. Leer bedeutet `160m` und `1Gi` |

Ein leerer Parameter ist nicht dasselbe wie ein auf dieselbe Zahl festgelegter: Ein leerer Parameter folgt dem Plattform-Standard und ändert sich mit diesem.

In Belgien (europe-west1) reserviert der Standard 100m CPU und 384Mi mit möglichem Burst auf 2 CPU und 2 GiB; in Falkenstein und Helsinki kann der Arbeitsspeicher auf das 1,4-Fache des Requests und die CPU auf das 10-Fache (maximal 1,7 vCPU) ansteigen. `rebase cloud compute` zeigt die Werte Ihres Projekts.

Von der CLI wird bewusst nichts vorab validiert – die Limits gehören zum Cluster, auf dem ein Projekt läuft, und unterscheiden sich je nach Provider. Die Control Plane lehnt Werte ab, die sie nicht erfüllen kann, und benennt das Feld. Führen Sie `rebase cloud compute` aus, um die €/Monat vor und nach der Änderung zu sehen; eine Änderung gilt ab sofort, anteilig ab heute. Eine Datenbankänderung wird sofort angewendet; die Abrechnung erfolgt bis zur Fertigstellung zur bisherigen Größe. Eine neue Datenbank-CPU oder ein neuer Arbeitsspeicher bzw. weniger Instanzen starten die Datenbank neu (dauert ca. 30 Sekunden bis 3 Minuten; Verbindungen werden getrennt und neu aufgebaut): `compute set` weist darauf hin und fragt nach, außerhalb eines Terminals gilt `--yes` als Zustimmung. Schlägt dieser Neustart fehl, versucht `rebase cloud compute apply` es erneut.

## Der restliche Funktionsumfang

| Befehlsgruppe | Was sie abdeckt |
|---|---|
| `login`, `logout`, `whoami`, `access-token` | Ihre Sitzung; `access-token` gibt das Bearer-Token aus, das die CLI aktuell senden würde – für Skripte und den MCP-Server |
| `tokens` | Tokens für CI und Agenten, jeweils auf ein Projekt beschränkt. Siehe [CI and agents](/docs/deployment/cloud-agents/#ci-and-agents) |
| `link`, `unlink`, `use`, `open` | Verknüpfen dieses Verzeichnisses mit einem Projekt, Auswählen einer Organisation, Öffnen der Konsole |
| `connect` | Hinzufügen eines selbst gehosteten Rebase-Servers zu Ihrem Konto, damit der [Rebase connector](/docs/ai/rebase-connector/#add-your-self-hosted-instances) in Claude diesen neben Ihren Cloud-Projekten erreicht. `--list` zeigt sie an, `--remove` entfernt einen. Eigentümer und Administratoren |
| `init`, `claim` | Mit `--claim`: Ein Live-Backend ohne Konto sowie ein Link, um es zu beanspruchen; `claim` gibt diesen Link erneut aus. Siehe [A backend with no account](/docs/deployment/cloud-agents/#a-backend-with-no-account) |
| `projects` | Erstellen, auflisten, inspizieren, löschen |
| `deploy`, `logs`, `deployments`, `rollback`, `cancel` | Bereitstellen und Überwachen |
| `deploy-hooks` | Geheime URLs, die ein Git-Host oder CI aufruft, um das Projekt bereitzustellen: auflisten, erstellen (die URL wird einmalig angezeigt), widerrufen. |
| `previews` | Builds, die über `deploy --preview` unter einer eigenen Adresse bereitgestellt werden, sowie deren Löschung. Siehe [Preview a change](#vorschau-einer-änderung) |
| `sleep` | Ruhezustand bei Inaktivität: `on [--after 15m\|30m\|1h\|4h]`, `off`, `wake` und `status` (Standard). Im Ruhezustand belegt ein Projekt weder CPU noch Speicher, und die nächste Anfrage weckt es auf; geplante Jobs und Hintergrundaufgaben laufen währenddessen nicht. Kann ein Projekt nicht in den Ruhezustand versetzt werden, lehnt die Control Plane dies ab und nennt den Grund |
| `start`, `stop`, `restart` | Pausieren eines Projekts und Wiederherstellen. Ein gestopptes Projekt behält sein Abonnement, es sei denn, die Plattform berechnet für gestoppte Projekte nur den Speicher und die Plattformgebühr; die Zeile **Abrechnung** in der Konsole weist darauf hin, falls dies zutrifft |
| `status`, `metrics`, `debug` | Was es tut und warum es etwas nicht tut |
| `alerts` | Die offenen Incidents des Projekts sowie deren Bestätigung oder Stummschaltung. |
| `cron` | Die Cron-Jobs der bereitgestellten App und deren aufgezeichnete Ausführungen, ausgelesen mit Ihrem `rebase cloud`-Login. Schreibgeschützt |
| `env` | Umgebungsvariablen. `list` gibt niemals Werte aus; `--secret` ist schreibgeschützt |
| `app-key` | Der Schlüssel, den `init --claim` als `REBASE_API_TOKEN` in `.env` geschrieben hat und der beim Claim übergeben wurde; `rotate` ersetzt ihn und widerruft den alten. Eigentümer und Administratoren |
| `service-key` | `REBASE_SERVICE_KEY`, Administrator-Schlüssel für die app-eigene API: wann er zuletzt rotiert wurde; `rotate` weist der App einen neuen zu. Eigentümer und Administratoren |
| `domains` | Eigene Domains, hinzuzufügende DNS-Einträge und Verifizierung. Ein Projekt kann unter mehreren Domains erreichbar sein, die jeweils separat verifiziert werden; `verify` und `remove` erwarten die jeweilige Domain, die nur weggelassen werden kann, wenn nur eine vorhanden ist (bei `verify` eine noch ausstehende). Jede verifizierte Domain liefert das Projekt direkt aus; `primary <domain>` wählt die kanonische aus und `redirect <domain>` leitet eine andere mit 308 dorthin weiter, wobei Pfad und Query erhalten bleiben (`--off` liefert sie wieder direkt aus) – tun Sie dies für `www.` neben einer Apex-Domain, da Google-Sign-in, Cookies und Passkeys pro Origin gelten. Eine Domain, unter der eine App bereitgestellt wird (ein App-`path` mit einem Hostnamen), leitet niemals weiter. Eine Apex-Domain (`example.com`, ohne Subdomain) erfordert einen **A**-Record, da DNS dort keinen CNAME erlaubt. Diese Adresse ist der Ingress der Plattform und bleibt nicht garantiert immer gleich: Zieht die Plattform um, zeigt ein A-Record weiterhin auf die alte Adresse. Bietet Ihr DNS-Host ALIAS, ANAME oder CNAME-Flattening an der Apex-Domain an, verweisen Sie mit der Apex-Domain stattdessen auf den `tenantHost` des Projekts, der der Plattform folgt. Der CNAME einer Subdomain folgt ihr ohnehin. `list` meldet `verified, certificate pending`, bis HTTPS mit einem echten Zertifikat antwortet. `list --json` gibt `{ projectId, tenantHost, domains: [...] }` zurück |
| `db` | Datenbank anbinden oder erstellen, Verbindung von Ihrem Rechner aus herstellen, Backups, Restore und Point-in-Time-Recovery |
| `guests` | Die Gastbenutzer, die durch anonyme Anmeldungen entstanden sind: zählen, einzelne löschen, lange inaktive bereinigen. Siehe [Guests](/docs/cli/cloud/#guests). Eigentümer und Administratoren |
| `extensions` | Die Postgres-Extension-Allowlist |
| `storage` | Das Bucket des Projekts |
| `resources` | Welche Datenbanken und Buckets die Plattform verwaltet, im Abgleich mit den Deklarationen im Code |
| `compute` | Was dieses Projekt an Ressourcen reserviert, was es kostet und wie man es ändert |
| `events` | Was mit dem Backend geschehen ist, neueste zuerst: App-Skalierung, geplante und angewendete Datenbankänderungen, Übernahme durch ein Standby, Vergrößerung der Festplatte |
| `usage` | In diesem Monat verbrauchte Anfragen im Vergleich zum enthaltenen Kontingent und bisherige Mehrkosten laut Rechnungszählung. `usage org` listet jedes Projekt der Organisation auf |
| `clusters` | Die Cluster, auf denen die Mandanten laufen. Nur Plattform-Administratoren |
| `settings`, `orgs`, `access`, `billing` | Projekteinstellungen, Organisationen sowie deren Mitglieder und Einladungen, wer Zugriff auf ein Projekt hat, Zahlung |
| `activity` | Das Audit-Protokoll der Organisation: wer bereitgestellt hat, eine Umgebungsvariable (nach Name), eine Domain, ein Backup, ein Mitglied oder ein Token geändert hat. Eigentümer und Administratoren. Siehe [See who did what](#nachvollziehen-wer-was-getan-hat) |
| `notifications` | Wohin die Ereignisse des Projekts per POST gesendet werden: Slack, Discord oder eine beliebige https-URL ([Cloud notifications](/docs/deployment/cloud-notifications/)) |

Jede Gruppe in dieser Tabelle beantwortet `--help` mit einer eigenen Hilfeseite – einer Verwendungszeile, ihren Flags und Beispielen – und `--help` führt den Befehl niemals aus. Ein Test überwacht den Index dieser Seiten, sodass eine neu hinzugefügte Gruppe ohne Hilfeseite den Build fehlschlagen lässt, anstatt das Inhaltsverzeichnis auszugeben. `verify:docs` gleicht die Tabelle selbst mit diesem Index ab: Jede von der CLI verarbeitete Gruppe erscheint hier genau einmal; eine ohne Tabellenzeile hinzugefügte Gruppe führt somit ebenfalls zu einem fehlerhaften Build.

Wird die Ausgabe weitergeleitet, antwortet `--help` stattdessen in JSON: dieselbe Verwendungszeile, Flags und Beispiele als lesbare Struktur anstelle von sechzig Zeilen Terminal-Escape-Sequenzen.

## Was die Beta noch nicht enthält

Keine freie Regionswahl, keine Self-Service-Registrierung, kein veröffentlichtes SLA, keine Branch-Deployments, keine Tokens, die als Person agieren, und kein öffentlicher Datenbank-Endpunkt. [What the beta does not include](/docs/deployment/cloud-beta-limits/) führt jeden Punkt detailliert aus, einschließlich der Bedeutung von Deployments mit Produktions-Secrets.

## Stattdessen selbst hosten

Nichts hier bedeutet einen Lock-in. Der [Leitfaden für Self-Hosting](/docs/deployment/self-hosting/) führt das identische Image und Bundle mit `docker compose` aus, und der [Kubernetes guide](/docs/deployment/kubernetes/) bildet dieselbe Topologie über das Helm-Chart ab.
