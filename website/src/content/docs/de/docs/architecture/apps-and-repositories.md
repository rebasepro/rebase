---
sourceHash: 4ad669042dfd8fc9
title: Apps und Repositories
sidebar_label: Apps & Repositories
description: Ein Projekt ist ein Backend plus die Apps, die damit kommunizieren, welche jeweils in ihrem eigenen Repository liegen können.
---

## Projekte und Apps

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Ein **Projekt** ist das Backend: die Datenbank, Auth, Storage, Realtime und
Funktionen. Eine **App** ist etwas, das damit kommuniziert.

| Typ | Was es ist |
| --- | --- |
| `backend` | Die Tabellen, Hooks und Funktionen, die die API definieren. Genau eine pro Projekt. |
| `static` | Ein gebautes Client-Bundle – eine SPA oder statische Website, ausgeliefert unter einem eigenen Pfad oder auf einem eigenen Hostnamen. |

Das ist die gesamte Liste. Das Admin-Panel ist eine `static`-App wie jede andere: Es wird
in Ihrem Repository mit Ihren `frontend/src/cms`-Anpassungen gebaut, weshalb
benutzerdefinierte Felder und benutzerdefinierte Ansichten vom ersten Tag an darin funktionieren.

Wer Eigentümer des Serverprozesses ist, ist eine Eigenschaft des Backends, kein separater
App-Typ:

| `runtime` | Was es bedeutet |
| --- | --- |
| `managed` | Das Runtime-Image der Plattform führt Ihr Bundle aus. Sie stellen Tabellen, Funktionen, Crons und Schemas bereit. |
| `custom` | Sie stellen den Server bereit: Ihr eigenes Dockerfile und Ihren eigenen Entrypoint. `rebase eject` richtet dies ein. |

Dies ist unabhängig davon, *wo* es läuft. Beides läuft auf Rebase Cloud und beides
lässt sich selbst hosten – das Ziel befindet sich in `.rebase/cloud.json`, nicht im Manifest.

Der entscheidende Punkt ist, wer die Liste *besitzt*. Ein Repository deklariert nur die Apps,
die es enthält; das Projekt besitzt die Menge der existierenden Apps. Zwei Repositories müssen
niemals voneinander wissen – sie müssen nur das Projekt kennen. Das macht ein
separates Frontend-Repository oder eine mobile App ganz ohne Repository-Bezug
zu einem Regelfall statt zu einem Sonderfall.

## `rebase.json`

Das Manifest deklariert die Topologie und sonst nichts. Schema, Sicherheitsregeln, Hooks
und Funktionen verbleiben in TypeScript, wo ein Typsystem sie prüfen kann.

```jsonc
{
  "rebase": "^1",
  "apps": {
    "backend": { "type": "backend", "runtime": "managed" },
    "site": {
      "type": "static",
      "root": "frontend",
      "build": "npm run build --workspace frontend",
      "output": "frontend/dist",
      "path": "/"
    },
    "admin": {
      "type": "static",
      "root": "admin",
      "build": "npm run build --workspace admin",
      "output": "admin/dist",
      "path": "/admin",
      "cms": "/admin"
    }
  }
}
```

Ein einziger Prozess liefert alles aus: die API unter `/api`, die Website unter `/`, den Admin-Bereich unter
`/admin`. Das ist das Self-Hosting-Modell und eine absolut solide Einstiegsstufe auf
Rebase Cloud.

## Festlegen, wo sich das CMS befindet

`cms` ist der URL-Pfad, unter dem eine App `<RebaseCMS>` mountet. Es ist optional, es ist
das einzige Feld hier, das beschreibt, was sich *innerhalb* einer App befindet, anstatt wo die
App liegt, und es existiert, weil nichts anderes dies ermitteln kann.

Das CMS ist eine React-Komponente in Ihrem eigenen Frontend, seine Adresse ist also eine
clientseitige Route. Es ist keine Server-Route, keine Datei im Build und nicht
von jedem anderen nicht zugeordneten Pfad unter einer SPA zu unterscheiden – eine Anfrage an
`/admin` erhält dieselbe `index.html` wie eine Anfrage an `/anything-else`. Kein
Deployment, kein laufender Server und keinerlei Probing kann daher feststellen, wo sich Ihr Admin-Panel
befindet. Wenn Sie es nicht notieren, weiß es niemand.

Wer diesen Pfad kennt, nutzt ihn:

- **Rebase Cloud** platziert einen *Open CMS*-Link im Projekt-Header und führt die
  Adresse in der Übersicht des Projekts auf – auf dem eigenen Hostnamen der App, wenn sie
  einen hat. Ohne `cms` kann die Konsole nur den Projekt-Host anbieten – was
  das CMS nur dann erreicht, wenn sich das CMS zufällig im Root-Verzeichnis davon befindet.
- **`rebase dev`** gibt die CMS-URL in seinem Start-Banner aus, wenn es sich nicht
  einfach um die Startseite des Frontends handelt.
- **`rebase apps list`** zeigt sie neben der App an, die sie ausliefert.

Drei Varianten, und alle davon sind ganz gewöhnlich.

```jsonc
// The whole app is the CMS — what `rebase init` scaffolds.
"admin": { "type": "static", "root": "frontend", "output": "frontend/dist", "path": "/", "cms": "/" }

// The CMS is one route of a bigger app, sharing its session and its client.
"web": { "type": "static", "root": "frontend", "output": "frontend/dist", "path": "/", "cms": "/admin" }

// The CMS is an app of its own, on a hostname of its own — see the next section.
"admin": { "type": "static", "root": "admin", "output": "admin/dist", "path": "https://admin.example.com", "cms": "/" }
```

Der Wert ist der Pfad, den Sie nach dem Hostnamen eingeben würden, kein relativer Pfad
zu `path`, und er muss sich innerhalb der deklarierenden App befinden – der SPA-Fallback
dieser App ist das, was dort antwortet. Es ist immer ein Pfad, selbst wenn der `path` der App
eine URL ist: Das CMS befindet sich dann auf diesem Pfad auf dem Hostnamen der App, sodass `"cms": "/"`
oben `https://admin.example.com/` bedeutet. Ein Projekt hat ein CMS; ein zweites zu deklarieren
ist ein Fehler und kein Münzwurf darüber, worauf die Konsole verlinkt.

`path` ist sowohl eine Eingabe zur **Build-Zeit** als auch für die Auslieferung. Eine unter
`/admin` gemountete App muss für `/admin` *gebaut* werden, sonst lädt `index.html` und jedes Asset
liefert einen 404-Fehler – eine weiße Seite ohne jegliche Fehlermeldung. `rebase build` übergibt den Wert als
`REBASE_APP_BASE`, was Ihr Bundler als seinen Basis-Pfad liest:

```ts
// vite.config.ts
export default defineConfig({
  base: process.env.REBASE_APP_BASE ?? "/",
  // …
});
```

und weigert sich, einen Build auszuliefern, der ihn ignoriert hat.

Ein bestehendes Projekt benötigt kein Manifest. Die CLI leitet dasselbe Layout aus der
Verzeichnisstruktur ab, und `rebase apps init` schreibt es fest, wenn Sie es
explizit wünschen:

```bash
rebase apps list      # what this repository contributes
rebase apps init      # write an inferred rebase.json
```

Die automatische Erkennung kann zwei Dinge nicht wissen, die das `rebase.json` eines Scaffolds deklariert. Sie benennt
die statische App `web`, während ein Scaffold sie `admin` nennt, und sie kann die
`cms`-Route der App nicht kennen. Der Name ändert sich nicht: Rebase Cloud hat `web` für
jedes Projekt registriert, das ohne `rebase.json` bereitgestellt wurde.
`rebase apps init --force` behält die Namen, `path` und `cms` der Apps bei, die die Datei,
die es ersetzt, deklariert, und kennzeichnet eine App, die nicht mehr gefunden wird, als entfernt.

## Eine App auf einem eigenen Hostnamen

`path` kann auch eine vollständige `https://`-URL sein, was der App einen eigenen Hostnamen
gibt:

```jsonc
{
  "rebase": "^1",
  "apps": {
    "backend": { "type": "backend", "runtime": "managed" },
    "web": {
      "type": "static",
      "root": "frontend",
      "build": "npm run build --workspace frontend",
      "output": "frontend/dist",
      "path": "/"
    },
    "admin": {
      "type": "static",
      "root": "admin",
      "build": "npm run build --workspace admin",
      "output": "admin/dist",
      "path": "https://admin.example.com",
      "cms": "/"
    }
  }
}
```

`https://admin.example.com` liefert `admin` aus. Jeder andere Hostname, auf dem das Projekt
antwortet – `example.com` oder die eigene Adresse des Projekts auf Rebase Cloud –
liefert `web` aus, und `admin` ist dort überhaupt nicht erreichbar. Es handelt sich immer noch um einen
einzelnen Prozess und ein einzelnes Deployment; der Hostname entscheidet lediglich, welche App auf eine Anfrage antwortet.

Zwei Regeln entscheiden darüber:

- Eine App mit einem Hostnamen antwortet nur auf diesem Hostnamen. Eine App ohne Hostnamen
  antwortet auf jedem Hostnamen.
- Von den verbleibenden Apps gewinnt wie bisher diejenige mit dem längsten Pfad. Bei
  gleichem Pfad gewinnt die App, die den Hostnamen angibt, gegenüber derjenigen, die dies nicht tut.

Im Beispiel liegen beide Apps auf `/`, daher wählt die zweite Regel auf `admin.example.com`
`admin` aus. Deklarieren Sie den Admin-Bereich stattdessen unter `"https://admin.example.com/cms"`,
antwortet er auf diesem Hostnamen nur unter `/cms`: `admin.example.com/pricing`
geht an `web`. Ein Hostname schränkt ein, wo eine App antwortet; er übergibt der
App nicht alles auf diesem Hostnamen. Keine zwei Apps dürfen sich sowohl einen Hostnamen als auch einen
Pfad teilen.

Das Backend ist keine App, und ein Hostname verschiebt es nicht. `/api`, `/health`
und die anderen vom Backend reservierten Pfade werden auf jedem Hostnamen beantwortet,
bevor irgendeine App konsultiert wird. Daher ist `https://admin.example.com/api` dieselbe
API wie `https://example.com/api`. Eine App, die ihren eigenen Origin aufruft – das
leere `VITE_API_URL` des Scaffolds –, benötigt keine eigene API-URL und keine
CORS-Einstellung. Aus demselben Grund werden diese Pfade nach einem Hostnamen genauso abgelehnt wie
alleinstehend: `https://admin.example.com/api` ist genauso unzulässig wie
`/api`.

Alles andere bezüglich `path` gilt für den Teil nach dem Hostnamen. Die App
wird weiterhin dafür gebaut: `https://admin.example.com` wird mit
`REBASE_APP_BASE` auf `/` gesetzt gebaut, `https://admin.example.com/cms` mit `/cms/`, und
ein Bundler, der dies ignoriert, liefert Ihnen nach wie vor eine weiße Seite. `cms` ist ein Pfad auf dem
Hostnamen der App innerhalb dieses Pfadteils. Die URL muss `https://` sein und einen
Hostnamen sowie einen Pfad enthalten und sonst nichts – keinen Port, keine Query und kein Fragment. Ein bloßes
`admin.example.com` wird abgelehnt, zusammen mit der URL, die es hätte sein sollen.

Unter `rebase dev` wird nichts nach Hostnamen geroutet. Es führt die App in
`frontend/` wie gewohnt im Root-Verzeichnis eines localhost-Ports aus, und für eine App
mit einem Hostnamen gibt sein Banner zusätzlich die `https://`-Adresse aus, die sie nach dem
Deployment haben wird.

`rebase start` verhält sich anders, da es das gebaute Bundle über dieselbe
Runtime ausführt wie ein Deployment – Routing nach Hostnamen inklusive. Eine App mit einem Hostnamen
antwortet nur auf Anfragen, deren `Host`-Header dieser Hostname ist. Daher
zeigt `http://localhost:3001/` die App ohne Hostnamen, und ein Bundle, dessen einzige App
einen Hostnamen angibt, liefert dort 404 zurück. Um sie lokal zu erreichen, senden Sie den Header
selbst:

```bash
curl -H "Host: admin.example.com" http://localhost:3001/
```

oder verweisen Sie in `/etc/hosts` mit dem Hostnamen auf `127.0.0.1` und öffnen Sie
`http://admin.example.com:3001/`. Es gibt ganz bewusst keinen Query-Parameter oder
Header, der das Routing überschreibt: Ein Parameter, der lokal funktionierte, würde auch
bei einem Deployment funktionieren, und die Auswahl der App über etwas anderes als den tatsächlichen `Host`
ist genau das, was das Routing verhindern soll.

Im Self-Hosting-Betrieb trifft der Prozess dieselbe Entscheidung anhand des `Host`-Headers
jeder Anfrage. Das Verweisen des Hostnamens auf den Server und die Bereitstellung eines Zertifikats
liegen in Ihrer Verantwortung, ebenso wie für den Haupt-Hostnamen des Projekts. Ein Reverse-Proxy
davor muss den ursprünglichen `Host` weiterleiten – Caddy tut dies standardmäßig,
nginx benötigt `proxy_set_header Host $host;`. `X-Forwarded-Host` wird nicht ausgelesen,
da jeder Client einen solchen Header senden kann.

### Auf Rebase Cloud

`rebase cloud deploy` registriert den Hostnamen im Projekt – genau das, was
`rebase cloud domains add` tut –, sodass kein separater Schritt vergessen werden kann. Was
als Nächstes passiert, hängt vom DNS ab:

- **Die Records existieren bereits.** Das Deployment verifiziert den Hostnamen und er ist
  live, sobald das Deployment abgeschlossen ist.
- **Sie existieren nicht.** Das Deployment wird fortgesetzt und gibt die beiden zu erstellenden Records aus:
  einen TXT-Record, der beweist, dass der Name Ihnen gehört, und einen CNAME, der auf das
  Projekt verweist (ein A-Record, falls der Hostname der Apex der Domain ist).

Sobald die Records veröffentlicht sind:

```bash
rebase cloud domains verify admin.example.com
```

`rebase cloud domains list` gibt die Records erneut aus, falls Sie sie verlieren. Ein
Hostname, der nicht innerhalb von 7 Tagen nach der Registrierung verifiziert wird, wird freigegeben,
und das nächste Deployment registriert ihn erneut. Sobald die
Verifizierung erfolgreich ist, stellt die Plattform das HTTPS-Zertifikat für den
Hostnamen aus; es muss nichts hochgeladen werden. Bis dahin antwortet `admin` nirgendwo, da
der einzige Hostname, auf dem es antwortet, das Projekt noch nicht erreicht – der Rest
des Projekts ist in jedem Fall live.

Die Konsole folgt der App auf ihren Hostnamen: Der Link *Open CMS* und die CMS-Adresse
in der Übersicht des Projekts lauten `https://admin.example.com/`, nicht der
Projekt-Host.

Ein Hostname, den bereits ein anderes Projekt verifiziert hat, bricht das Deployment ab, bevor irgendetwas
ausgerollt wird, ebenso wie ein Hostname unter der plattformeigenen Domain. Ein Hostname, den ein anderes
Projekt registriert und nie verifiziert hat, steht Ihnen nicht im Weg: Die Ablehnung
liefert Ihnen einen TXT-Record für Ihr Projekt, und sobald dieser existiert, übernimmt das nächste Deployment (oder
`rebase cloud domains add`) den Hostnamen. Das Hinzufügen eines Hostnamens,
den das Projekt noch nicht hat, ändert die Domains des Projekts, was ein mit
`--can deploy` erstellter Access Token nicht darf: Fügen Sie den Hostnamen aus der CI heraus einmalig mit
`rebase cloud domains add` hinzu, während Sie angemeldet sind, und das Token stellt ihn anschließend wie
jeden Hostnamen bereit, der bereits im Projekt vorhanden ist. Das Entfernen der App
aus `rebase.json` belässt den Hostnamen im Projekt registriert; entfernen Sie ihn mit
`rebase cloud domains remove admin.example.com`.

### Ein Hostname gehört zu einer App, nicht zu einer Route

Ein Hostname wird einer gesamten App zugewiesen. Er kann nicht auf eine Route innerhalb einer App zeigen. Wenn
das CMS eine Route einer einzelnen SPA ist – `web` unter `/` mit `"cms": "/admin"` –,
befindet es sich unter `/admin` auf jedem Hostnamen, auf dem das Projekt antwortet. Würde man dieser App
`https://admin.example.com` zuweisen, würde die gesamte SPA dorthin verschoben, wobei das CMS weiterhin
darunter unter `/admin` läge. Um dem CMS einen eigenen Hostnamen zu geben, machen Sie es zu einer
eigenen App mit eigenem Build, wie im obigen Beispiel.

## Apps bauen und deployen

```bash
rebase build              # every app in this repository
rebase build backend      # just the bundle
rebase build admin        # just that app's static assets
```

Das Backend wird zuerst gebaut, da der Build einer Client-App ein SDK
verwenden kann, das aus dessen Tabellen generiert wurde.

## Mehrere Repositories

Das Monorepo bleibt der Standard: Ein Repository mit einem Backend und einem Admin-Panel
ist die einfachste funktionierende Lösung, und `rebase init` richtet genau das ein. Die Aufteilung ist
der nächste Entwicklungsschritt, keine Voraussetzung.

In einem separaten Frontend-Repository benötigen Sie zwei Dinge – ein Manifest, das deklariert,
was dieses Repository beiträgt, und einen Link zum Projekt:

```jsonc
// rebase.json
{
  "rebase": "^1",
  "apps": {
    "marketing": {
      "type": "static",
      "root": ".",
      "build": "npm run build",
      "output": "dist"
    }
  }
}
```

```bash
rebase cloud link https://api.example.com   # a self-hosted project
rebase cloud link                           # or pick a Rebase Cloud project
```

Der Link wird in `.rebase/cloud.json` geschrieben und wird **nicht committet** – er gilt
pro Checkout, ähnlich wie ein Git-Remote. Das Manifest wird committet; der Link nicht.

## Typisierte Clients ohne die Tabellen

Dies ist der Mechanismus, der Multi-Repo-Setups ermöglicht. Ein Repository, das keine
Tabellen enthält, generiert sein typisiertes SDK direkt aus dem Projekt:

```bash
rebase generate-sdk --from link
rebase generate-sdk --from https://api.example.com --token $REBASE_SERVICE_KEY
```

Die CLI ruft `/api/meta/contract` ab und liest dessen `tables` aus – die kompilierten
Deskriptoren inklusive Relationszielen, die der Typgenerator benötigt, um zu
entscheiden, ob ein Fremdschlüssel ein String oder eine Zahl ist – und erzeugt exakt
dieselbe Ausgabe, die sie auch aus lokalen Quelldateien generiert hätte.

Der Contract-Endpunkt erfordert den Scope `schema:read`, über den Administratoren verfügen. Er
beschreibt jede Tabelle,
Spalte und Relation im Projekt, einschließlich derer, die keine Sicherheitsregel jemals
offenlegen würde; das ist eine Karte der Datenbank, keine öffentliche API-Dokumentation.

## Schema-Drift erkennen

Die Aufteilung von Repositories hat einen nennenswerten Nachteil: Eine Schemaänderung und das
Frontend, das sie verwendet, landen nicht mehr im selben Commit. Das Backend kann eine
Änderung deployen, die einen Client ins Leere laufen lässt, der gegen die alte Struktur gebaut wurde.

Jedes generierte SDK zeichnet das Schema auf, aus dem es stammt:

```ts
// generated/sdk/schema.meta.ts — generated
export const SCHEMA_VERSION = "v1:c5d97d0f96b7f87a";
```

Und jedes Projekt veröffentlicht sein aktuelles Schema ohne Authentifizierung, da ein
Versionsstempel nichts über das Schema verrät, für das er steht:

```bash
curl -s https://api.example.com/api/meta/schema-version
# {"schemaVersion":"v1:c5d97d0f96b7f87a","runtime":{"version":"0.30.1","contract":1}}
```

Ein Vergleich der beiden Werte in der CI verwandelt eine unbemerkte Diskrepanz in einen fehlgeschlagenen Check. Der Stempel
ändert sich, wenn sich die generierten Typen ändern könnten – eine neue Eigenschaft, eine geänderte
Relation – und ganz bewusst *nicht*, wenn sich ein Hook, eine Sicherheitsregel oder ein Icon
ändert, damit kein falscher Alarm ausgelöst wird.

## Client-Konfiguration

```bash
rebase apps config web
```

Gibt aus, was ein Client benötigt, um das Projekt zu erreichen. Es gibt niemals Secrets aus: Die
API-URL und die veröffentlichbare Identität einer App sind dafür gedacht, innerhalb eines Client-Bundles
ausgeliefert zu werden, und alles, was dort nicht sicher ist, gehört nicht in eine Ausgabe, die
letztlich in einer committeten `.env`-Datei landet.

## Verwandte Themen

- [Runtime & Bundles](/docs/architecture/runtime-and-bundles/) – was `rebase build` erzeugt und was es startet
- [Split Processes](/docs/deployment/split-processes/) – Ausführen eines Bundles als mehrere Prozesse
- [CLI Commands](/docs/cli/) – `rebase apps` und der Rest
