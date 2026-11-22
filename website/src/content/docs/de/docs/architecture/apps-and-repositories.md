---
sourceHash: e3293eb3c0e15be1
title: Apps und Repositories
sidebar_label: Apps & Repositories
description: Ein Projekt ist ein Backend plus die Apps, die damit kommunizieren, welche jeweils in ihrem eigenen Repository liegen können.
---

## Projekte und Apps

Ein **Projekt** ist das Backend: die Datenbank, Auth, Storage, Realtime und
Functions. Eine **App** ist etwas, das damit kommuniziert.

| Typ | Was es ist |
| --- | --- |
| `backend` | Die Tabellen, Hooks und Functions, die die API definieren. Genau eines pro Projekt. |
| `static` | Ein gebautes Client-Bundle – eine SPA oder statische Website, bereitgestellt unter einem eigenen Pfad oder auf einem eigenen Hostnamen. |

Das ist die gesamte Liste. Das Admin-Panel ist eine `static` App wie jede andere: Es wird
in Ihrem Repository mit Ihren `frontend/src/cms`-Anpassungen gebaut,
weshalb benutzerdefinierte Felder und benutzerdefinierte Ansichten darin vom ersten Tag an funktionieren.

Wem der Serverprozess gehört, ist eine Eigenschaft des Backends, kein separater
App-Typ:

| `runtime` | Was es bedeutet |
| --- | --- |
| `managed` | Das Runtime-Image der Plattform führt Ihr Bundle aus. Sie stellen Tabellen, Functions, Crons und das Schema bereit. |
| `custom` | Sie stellen den Server bereit: Ihr eigenes Dockerfile und Ihren Entrypoint. `rebase eject` richtet dies ein. |

Dies ist unabhängig davon, *wo* es ausgeführt wird. Beide laufen auf Rebase Cloud und beide
können selbst gehostet werden – das Ziel befindet sich in `.rebase/cloud.json`, nicht im Manifest.

Der wichtige Teil ist, wem die Liste *gehört*. Ein Repository deklariert nur die Apps,
die es enthält; dem Projekt gehört die Menge der existierenden Apps. Zwei Repositories müssen
nie voneinander wissen – sie müssen nur das Projekt kennen. Das ist es,
was ein separates Frontend-Repository oder eine mobile App ganz ohne Repository-Beziehung
zu einem Normalfall statt zu einem Sonderfall macht.

## `rebase.json`

Das Manifest deklariert die Topologie und sonst nichts. Schema, Sicherheitsregeln, Hooks
und Functions bleiben in TypeScript, wo ein Typsystem sie überprüfen kann.

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

Ein einziger Prozess bedient alles: die API unter `/api`, die Website unter `/`, den Admin-Bereich unter
`/admin`. Das ist das Self-Hosting-Modell und ein absolut solides kleines Tier auf
Rebase Cloud.

Der `path` einer statischen App nimmt eine von zwei Formen an:

| `path` | Wo die App antwortet |
| --- | --- |
| `"/"`, `"/admin"` | Unter diesem Pfad auf jedem Hostnamen, auf dem das Projekt bereitgestellt wird. |
| `"https://www.example.com"`, `"https://admin.example.com/cms"` | Nur auf diesem Hostnamen, unter dem Pfad dahinter. Siehe [Eine App auf einem eigenen Hostnamen](#eine-app-auf-einem-eigenen-hostnamen). |

Die URL-Form ist die Methode, mit der ein Projekt mit einer Website pro Domain, wie beispielsweise ein Vercel- oder
Netlify-Projekt pro Domain, zu einem einzigen Rebase-Projekt wird: eine statische App pro
Hostname, die alle über dasselbe Deployment bereitgestellt werden.

## Angeben, wo sich das CMS befindet

`cms` ist der URL-Pfad, an dem eine App `<RebaseCMS>` einbindet. Es ist optional, es ist
das einzige Feld hier, das beschreibt, was sich *in* einer App befindet, anstatt wo die
App liegt, und es existiert, weil nichts anderes dies herausfinden kann.

Das CMS ist eine React-Komponente in Ihrem eigenen Frontend, seine Adresse ist also eine
clientseitige Route. Es ist keine Server-Route, keine Datei im Build und nicht
unterscheidbar von jedem anderen nicht übereinstimmenden Pfad unter einer SPA – eine Anfrage an
`/admin` erhält dasselbe `index.html` wie eine Anfrage an `/anything-else`. Kein
Deployment, kein laufender Server und keine Menge an Überprüfungen kann also feststellen, wo sich Ihr Admin-Panel
befindet. Wenn Sie es nicht notieren, weiß es niemand.

Was es weiß, nutzt es auch:

- **Rebase Cloud** platziert einen *Open CMS*-Link in der Kopfzeile des Projekts und listet die
  Adresse in der Übersicht des Projekts auf – auf dem eigenen Hostnamen der App, sofern sie
  einen hat. Ohne `cms` kann die Konsole nur den Projekt-Host anbieten – welcher
  das CMS nur erreicht, wenn das CMS zufällig im Root-Verzeichnis davon liegt.
- **`rebase dev`** gibt die CMS-URL im Start-Banner aus, wenn es nicht
  einfach die Startseite des Frontends ist.
- **`rebase apps list`** zeigt es neben der App an, die es bereitstellt.

Drei Formen, und alle davon sind gewöhnlich.

```jsonc
// The whole app is the CMS — what `rebase init` scaffolds.
"admin": { "type": "static", "root": "frontend", "output": "frontend/dist", "path": "/", "cms": "/" }

// The CMS is one route of a bigger app, sharing its session and its client.
"web": { "type": "static", "root": "frontend", "output": "frontend/dist", "path": "/", "cms": "/admin" }

// The CMS is an app of its own, on a hostname of its own — see the next section.
"admin": { "type": "static", "root": "admin", "output": "admin/dist", "path": "https://admin.example.com", "cms": "/" }
```

Der Wert ist der Pfad, den Sie nach dem Hostnamen eingeben würden, kein relativer Pfad
zu `path`, und er muss innerhalb der App liegen, die ihn deklariert – das SPA-Fallback
dieser App ist das, was dort antwortet. Es ist immer ein Pfad, selbst wenn der `path` der App
eine URL ist: Das CMS befindet sich dann auf diesem Pfad auf dem Hostnamen der App, `"cms": "/"`
oben bedeutet also `https://admin.example.com/`. Ein Projekt hat genau ein CMS; ein zweites
zu deklarieren ist ein Fehler statt ein Münzwurf darüber, auf welches die Konsole verlinkt.

`path` ist sowohl eine **Build-Time**- als auch eine Serving-Eingabe. Eine unter
`/admin` eingebundene App muss für `/admin` *gebaut* werden, andernfalls lädt `index.html` und jedes Asset
erzeugt einen 404-Fehler – eine weiße Seite ohne Fehlermeldung. `rebase build` übergibt den Wert als
`REBASE_APP_BASE`, den Ihr Bundler als Basispfad liest:

```ts
// vite.config.ts
export default defineConfig({
  base: process.env.REBASE_APP_BASE ?? "/",
  // …
});
```

und weigert sich, einen Build auszuliefern, der dies ignoriert hat.

Ein bestehendes Projekt benötigt keines. Die CLI leitet dasselbe Layout aus der
Verzeichnisstruktur ab, und `rebase apps init` schreibt es auf, wenn Sie es
explizit haben möchten:

```bash
rebase apps list      # what this repository contributes
rebase apps init      # write an inferred rebase.json
```

Die automatische Erkennung kann zwei Dinge nicht wissen, die das `rebase.json` eines Scaffolds deklariert. Sie benennt
die statische App `web`, wo ein Scaffold sie `admin` nennt, und sie kann die
`cms`-Route der App nicht kennen. Der Name ändert sich nicht: Rebase Cloud hat `web` für
jedes Projekt registriert, das ohne `rebase.json` bereitgestellt wurde.
`rebase apps init --force` behält die Namen, `path`, `cms`, `routes`,
`frameAncestors`, <span class="since-badge" data-since="0.35">Seit 0.35</span> `redirects` und `cleanUrls` der Apps bei, die die zu ersetzende Datei
deklariert, und kennzeichnet eine App, die nicht mehr gefunden wird, als entfernt.

## Eine App auf einem eigenen Hostnamen

`path` kann auch eine vollständige `https://`-URL sein, was der App einen eigenen
Hostnamen gibt:

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

`https://admin.example.com` bedient `admin`. Jeder andere Hostname, auf dem das Projekt
antwortet – `example.com` oder die eigene Adresse des Projekts auf Rebase Cloud –
bedient `web`, und `admin` ist dort überhaupt nicht erreichbar. Es ist immer noch ein
einziger Prozess und ein einziges Deployment; der Hostname entscheidet lediglich, welche App eine Anfrage beantwortet.

Zwei Regeln entscheiden darüber:

- Eine App mit einem Hostnamen antwortet nur auf diesem Hostnamen. Eine App ohne Hostnamen
  antwortet auf jedem Hostnamen.
- Von den verbleibenden Apps gewinnt diejenige mit dem längsten Pfad, wie schon immer. Bei
  gleichem Pfad gewinnt die App, die den Hostnamen angibt, gegenüber derjenigen, die dies nicht tut.

Im Beispiel liegen beide Apps auf `/`, daher wählt auf `admin.example.com` die zweite Regel
`admin`. Deklarieren Sie den Admin stattdessen unter `"https://admin.example.com/cms"`,
antwortet er nur unter `/cms` auf diesem Hostnamen: `admin.example.com/pricing`
geht an `web`. Ein Hostname schränkt ein, wo eine App antwortet; er übergibt der
App nicht automatisch alles auf diesem Hostnamen. Keine zwei Apps dürfen sich sowohl einen Hostnamen als auch einen
Pfad teilen.

Das Backend ist keine App, und ein Hostname verschiebt es nicht. `/api`, `/health`
und die anderen vom Backend reservierten Pfade werden beantwortet, bevor irgendeine App
konsultiert wird, und zwar auf jedem Hostnamen, sodass `https://admin.example.com/api` dieselbe
API wie `https://example.com/api` ist. Eine App, die ihren eigenen Origin aufruft – die
leere `VITE_API_URL` des Scaffolds –, benötigt keine eigene API-URL und keine
CORS-Einstellung. Aus demselben Grund werden diese Pfade nach einem Hostnamen genauso abgelehnt
wie alleinstehend: `https://admin.example.com/api` ist nicht gültiger als
`/api`.

Alles andere bezüglich `path` gilt für den Teil nach dem Hostnamen. Die App
wird weiterhin dafür gebaut: `https://admin.example.com` wird gebaut mit
`REBASE_APP_BASE` gesetzt auf `/`, `https://admin.example.com/cms` mit `/cms/`, und
ein Bundler, der dies ignoriert, liefert weiterhin eine weiße Seite. `cms` ist ein Pfad auf dem
Hostnamen der App innerhalb dieses Pfadteils. Die URL muss `https://` sein und einen
Hostnamen sowie einen Pfad enthalten und sonst nichts – keinen Port, Query-Parameter oder Fragment. Ein reines
`admin.example.com` wird abgelehnt, mit dem Hinweis auf die URL, die es hätte sein sollen.

Unter `rebase dev` wird nichts nach Hostnamen geroutet. Es führt die App in
`frontend/` an der Root eines Localhost-Ports aus, wie bisher, und für eine App
mit einem Hostnamen gibt das Banner auch die `https://`-Adresse aus, die sie
nach dem Deployment haben wird.

`rebase start` verhält sich anders, da es das gebaute Bundle durch dieselbe
Runtime ausführt wie ein Deployment – einschließlich Hostname-Routing. Eine App mit einem Hostnamen
antwortet nur auf Anfragen, deren `Host`-Header dieser Hostname ist, sodass
`http://localhost:3001/` die App ohne Hostnamen anzeigt, und ein Bundle, dessen einzige App
einen Hostnamen deklariert, dort mit 404 antwortet. Um sie lokal zu erreichen, senden Sie den Header
selbst mit:

```bash
curl -H "Host: admin.example.com" http://localhost:3001/
```

oder leiten Sie den Hostnamen in `/etc/hosts` auf `127.0.0.1` um und öffnen Sie
`http://admin.example.com:3001/`. Es gibt bewusst keinen Query-Parameter oder
Header, der das Routing überschreibt: Einer, der lokal funktionierte, würde auch
gegen ein Deployment funktionieren, und die Auswahl der App anhand von etwas anderem als dem echten `Host` ist
genau das, was das Routing verhindern soll.

Im Self-Hosting-Modus trifft der Prozess dieselbe Entscheidung anhand des `Host`-Headers
jeder Anfrage. Den Hostnamen auf den Server zu verweisen und ihm ein Zertifikat zuzuweisen,
liegt in Ihrer Verantwortung, genau wie beim Haupt-Hostnamen des Projekts, und ein Reverse-Proxy
davor muss den ursprünglichen `Host` weiterleiten – Caddy tut dies standardmäßig,
nginx benötigt `proxy_set_header Host $host;`. `X-Forwarded-Host` wird nicht gelesen,
da jeder Client diesen senden kann.

### Auf Rebase Cloud

`rebase cloud deploy` registriert den Hostnamen im Projekt – was auch
`rebase cloud domains add` tut –, sodass kein separater Schritt vergessen werden kann. Was
als Nächstes passiert, hängt vom DNS ab:

- **Die Records existieren bereits.** Das Deployment verifiziert den Hostnamen, und er ist
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
und das nächste Deployment registriert ihn erneut. Wenn die
Verifizierung erfolgreich ist, stellt die Plattform das HTTPS-Zertifikat für den
Hostnamen aus; es muss nichts hochgeladen werden. Bis dahin antwortet `admin` nirgendwo, da
der einzige Hostname, auf dem es antwortet, das Projekt noch nicht erreicht – der Rest
des Projekts ist in jedem Fall live.

Die Konsole folgt der App auf ihren Hostnamen: Der *Open CMS*-Link und die CMS-Adresse
in der Übersicht des Projekts lauten `https://admin.example.com/`, nicht der
Projekt-Host.

Ein Hostname, den ein anderes Projekt verifiziert hat, lässt das Deployment fehlschlagen, bevor etwas
ausgerollt wird, ebenso wie ein Hostname unter der plattform-eigenen Domain. Ein Hostname, den ein anderes
Projekt registriert und nie verifiziert hat, steht Ihnen nicht im Weg: Die Ablehnung
gibt Ihnen einen TXT-Record für Ihr Projekt, und sobald dieser existiert, übernimmt das nächste Deployment (oder
`rebase cloud domains add`) den Hostnamen. Das Hinzufügen eines Hostnamens,
den das Projekt noch nicht hat, ändert die Domains des Projekts, was ein Zugriffstoken,
das mit `--can deploy` erstellt wurde, nicht tun darf: Fügen Sie den Hostnamen von CI aus einmal mit
`rebase cloud domains add` hinzu, während Sie angemeldet sind, und das Token deployt ihn dann wie
jeden Hostnamen, der sich bereits im Projekt befindet. Das Entfernen der App
aus `rebase.json` belässt den Hostnamen im Projekt registriert; entfernen Sie ihn mit
`rebase cloud domains remove admin.example.com`.

### Ein Hostname gehört zu einer App, nicht zu einer Route

Ein Hostname wird einer gesamten App zugewiesen. Er kann nicht auf eine Route innerhalb einer App verweisen. Wenn
das CMS eine Route einer einzelnen SPA ist – `web` auf `/` mit `"cms": "/admin"` –,
befindet es sich unter `/admin` auf jedem Hostnamen, auf dem das Projekt antwortet. Würde man dieser App
`https://admin.example.com` zuweisen, würde die gesamte SPA dorthin verschoben, wobei das CMS weiterhin
unter `/admin` darunter läge. Um dem CMS einen eigenen Hostnamen zu geben, machen Sie es zu einer
eigenen App mit eigenem Build, wie im obigen Beispiel.

## Eine Function unter einem Pfad auf einer App bereitstellen

Eine benutzerdefinierte Function antwortet unter `/api/functions/<name>`, und eine statische App kann
`/api` nicht beanspruchen. Eine Publishing-Website benötigt einige Pfade, die kein Build enthalten kann – eine
Sitemap und einen Feed, die die neuesten Beiträge auflisten, eine aus der
Datenbank gerenderte Seite. `routes` liefert die Antwort einer Function unter einem Pfad auf der
eigenen Adresse der App aus:

```jsonc
"site": {
  "type": "static",
  "root": "site",
  "output": "site/dist",
  "path": "https://www.example.com",
  "routes": [
    { "path": "/sitemap.xml", "function": "sitemap" },
    { "path": "/feed.xml", "function": "feed" },
    { "path": "/blog/*", "function": "blog" }
  ]
}
```

`https://www.example.com/sitemap.xml` ist dann das, was `functions/sitemap.ts`
zurückgibt, mit eigenem `Content-Type`, Status und Headern. Alles andere auf
dem Hostnamen ist der Build der Website, wie zuvor.

- **Exakt oder Wildcard.** `/sitemap.xml` passt nur auf diesen Pfad. `/blog/*`
  passt auf `/blog` und jeden Pfad darunter und übergibt der Function den Rest:
  `/blog/hello` erreicht die Route `/:slug` der Function, wobei `slug` auf
  `hello` gesetzt ist, und `/blog` erreicht deren Route `/`.
- **Die Function sieht einen ganz normalen Aufruf.** Die Anfrage erreicht sie so, als wäre sie
  an `/api/functions/<name>` gestellt worden, durch dieselbe Authentifizierung, Scope-Prüfungen,
  Rate-Limits und Timeouts. Ihre Methode, Header, Body und Query-String werden
  durchgereicht, ebenso wie `Host`, sodass `new URL(c.req.url).origin` der Origin
  der Website ist – woraus die absoluten URLs einer Sitemap aufgebaut sind. Die Function antwortet
  weiterhin auch unter `/api/functions/<name>`.
- **Die spezifischste Route gewinnt**: ein exakter Pfad vor jeder Wildcard und eine
  längere Wildcard vor einer kürzeren. Eine Route gewinnt auch gegenüber einer Datei mit
  demselben Pfad im Build, sodass ein veraltetes `public/sitemap.xml` sie nicht verdecken kann.
- **Nur dort, wo die App antwortet.** Eine Route gilt für Anfragen, die die App selbst
  beantworten würde – auf ihrem Hostnamen, sofern sie einen hat, und nicht unter dem Pfad
  einer anderen App. `rebase.json` wird abgelehnt, wenn eine Route dort liegt, wo eine andere App antwortet.
- **Innerhalb der App und niemals des Backends.** Der Pfad einer Route ist absolut,
  innerhalb des `path` der App, und darf nicht unter `/api`, `/health`, `/healthz`,
  `/livez`, `/readyz` oder `/metrics` liegen, noch ein Segment enthalten, das mit `.` beginnt. Eine
  Wildcard darf nicht die gesamte App abdecken, was ihren Build unbedient lassen würde.

Routes werden von dem Backend-Prozess bedient, in den die App integriert ist, da
dort die Functions ausgeführt werden: `rebase build` und `rebase cloud deploy` integrieren jede
statische App in das Bundle des Backends, und der Build schlägt fehl, wenn eine Route eine
Function benennt, die das Backend nicht hat. Eine statische App, die für sich allein bereitgestellt wird, hat keine
Functions zum Aufrufen, daher verweigert `rebase cloud deploy` eine mit Routes, und die
Runtime weigert sich, ein reines statisches Bundle zu starten, das solche deklariert.

Eine geroutete Antwort, die keine `Content-Security-Policy` sendet, erhält die der App selbst,
sodass die Origins in ihren [`frameAncestors`](/docs/deployment/self-hosting/#letting-another-origin-frame-an-app)
eine serverseitig gerenderte Seite ebenso einbetten (frame) können wie den Rest der Website.

Unter `rebase dev` wird die App von ihrem eigenen Dev-Server bedient, der nichts
von den Routes weiß; rufen Sie die Function dort unter `/api/functions/<name>` auf oder testen Sie
die Routes gegen einen Build mit `rebase start`.

## Redirects und Clean URLs

<span class="since-badge" data-since="0.35">Seit 0.35</span>

Eine statische App akzeptiert `redirects` (`{ "from": "/blog/:slug", "to": "/posts/:slug" }`,
auch zu einer anderen Domain) und `cleanUrls: true` (`/x` bedient `x.html`). Siehe
[Redirects and clean URLs](/docs/architecture/redirects-and-clean-urls/), wo auch beschrieben wird,
wie eine `vercel.json` auf `rebase.json` abgebildet wird.

## Apps bauen und deployen

```bash
rebase build              # every app in this repository
rebase build backend      # just the bundle
rebase build admin        # just that app's static assets
```

Das Backend wird zuerst gebaut, da der Build einer Client-App ein SDK verwenden kann,
das aus seinen Tabellen generiert wurde.

## Mehrere Repositories

Das Monorepo bleibt der Standard: Ein Repository mit einem Backend und einem Admin-Panel
ist das Einfachste, was funktioniert, und `rebase init` richtet dies ein. Das Aufteilen ist
ein Folgeschritt, keine Voraussetzung.

In einem separaten Frontend-Repository benötigen Sie zwei Dinge – ein Manifest, das deklariert,
was dieses Repository beiträgt, und eine Verknüpfung zum Projekt:

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
pro Checkout, wie ein Git-Remote. Das Manifest wird committet; der Link nicht.

## Typisierte Clients ohne die Tabellen

Dies ist der Mechanismus, der Multi-Repo ermöglicht. Ein Repository, das keine
Tabellen enthält, generiert sein typisiertes SDK aus dem Projekt selbst:

```bash
rebase generate-sdk --from link
rebase generate-sdk --from https://api.example.com --token $REBASE_SERVICE_KEY
```

Die CLI ruft `/api/meta/contract` ab und liest dessen `tables` – die kompilierten
Deskriptoren inklusive Relationszielen, die der Typgenerator benötigt, um zu
entscheiden, ob ein Fremdschlüssel ein String oder eine Zahl ist – und erzeugt exakt dieselbe
Ausgabe, die er aus dem lokalen Quellcode erzeugt hätte.

Der Contract-Endpunkt benötigt den Scope `schema:read`, über den ein Admin verfügt. Er
beschreibt jede Tabelle,
Spalte und Relation im Projekt, einschließlich derer, die keine Sicherheitsregel jemals
offenlegen würde; dies ist eine Übersicht der Datenbank, keine öffentliche API-Dokumentation.

## Drift erkennen

Das Aufteilen von Repositories kostet Sie eine Sache, die erwähnenswert ist: Eine Schema-Änderung und das
Frontend, das sie verwendet, landen nicht mehr im selben Commit. Das Backend kann eine
Änderung ausrollen, die einen Client blockiert oder beschädigt, der gegen die alte Struktur gebaut wurde.

Jedes generierte SDK zeichnet das Schema auf, aus dem es entstanden ist:

```ts
// generated/sdk/schema.meta.ts — generated
export const SCHEMA_VERSION = "v1:c5d97d0f96b7f87a";
```

Und jedes Projekt veröffentlicht sein aktuelles Schema ohne Authentifizierung, da ein
Versionsstempel nichts über das Schema verrät, für das er steht:

```bash
curl -s https://api.example.com/api/meta/schema-version
# {"schemaVersion":"v1:c5d97d0f96b7f87a","runtime":{"version":"0.34.2","contract":1}}
```

Der Vergleich der beiden in CI verwandelt eine unbemerkte Diskrepanz in eine fehlgeschlagene Prüfung. Der Stempel
ändert sich, wenn sich die generierten Typen ändern könnten – eine neue Eigenschaft, eine geänderte
Relation – und bewusst *nicht*, wenn sich ein Hook, eine Sicherheitsregel oder ein Icon
ändert, sodass kein falscher Alarm ausgelöst wird.

## Client-Konfiguration

```bash
rebase apps config web
```

Gibt aus, was ein Client benötigt, um das Projekt zu erreichen. Es gibt niemals ein Secret aus: Die
API-URL und die öffentlich nutzbare Identität einer App sind dafür gedacht, innerhalb eines Client-Bundles
ausgeliefert zu werden, und alles, was dort nicht sicher ist, gehört nicht in eine Ausgabe, die
am Ende in einer committeten `.env` landet.

## Verwandte Themen

- [Runtime & Bundles](/docs/architecture/runtime-and-bundles/) – was `rebase build` erzeugt und was es startet
- [Split Processes](/docs/deployment/split-processes/) – Ausführen eines Bundles als mehrere Prozesse
- [CLI Commands](/docs/cli/) – `rebase apps` und der Rest
