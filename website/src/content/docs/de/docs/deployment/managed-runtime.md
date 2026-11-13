---
sourceHash: 9e1445cbb512338c
title: Verwaltete Backend-Runtime
sidebar_label: Managed Runtime
description: Was ein Backend mit der Runtime „managed“ auf Rebase Cloud tun kann und was nicht – Pakete und Binärdateien, Arbeitsspeicher und CPU, Timeouts und Body-Größen, das Dateisystem, In-Memory-Zustand, Secrets, Speicher für generierte Dateien und ausgehender Netzwerkverkehr.
---

Eine Backend-App, die in `rebase.json` wie folgt deklariert ist, läuft auf der **Managed Runtime**:

```json title="rebase.json"
{
    "apps": {
        "backend": { "type": "backend", "runtime": "managed" }
    }
}
```

„Managed“ bedeutet, dass Sie ein Bundle ausliefern, kein Image. `rebase cloud deploy` baut Ihre Tabellen, `backend/functions/` und Crons in `dist-bundle`, lädt es hoch und Rebase Cloud startet es auf dem veröffentlichten `rebasepro/server`-Image. Sie schreiben niemals ein Dockerfile und können auch nicht ändern, was sich im Image befindet. Diese Seite listet auf, was damit möglich ist, damit Sie ein Feature planen können, bevor Sie es entwickeln.

Die Zahlen hier stammen von der Runtime und der Plattform im aktuellen Zustand. Einige sind Stellschrauben, die Sie anpassen können, und diese Seite gibt an, welche das sind. Die wenigen Dinge, die noch nicht zugesichert sind, sind [am Ende](#noch-nicht-zugesichert) aufgeführt.

## Auf einen Blick

| Frage | Antwort |
|---|---|
| Node-Version | Node 22 auf Debian slim, `linux`/`x64` |
| npm-Pakete | Ja, aus der öffentlichen Registry oder einer privaten. Werden beim Bereitstellen (Deploy) im Bundle installiert |
| Native Module (`.node`, node-gyp) | Nein. `rebase cloud deploy` lehnt das Bundle ab |
| WebAssembly | Ja |
| Child-Prozesse starten | Ja, für eine `linux`/`x64`-Binärdatei, die ein npm-Paket mitbringt. Siehe [Binärdateien](#binärdateien-und-child-prozesse) |
| Arbeitsspeicher und CPU | Pro Projekt über `rebase cloud compute` konfigurierbar. Siehe [Compute](#compute-und-instanzen) |
| Instanzen | Standardmäßig 1, immer aktiv (always on). Sie können bis zu 5 festlegen oder den Autoscaler auf bis zu 16 skalieren lassen |
| Funktions-Timeout | 30 Sekunden, danach `504 FUNCTION_TIMEOUT`. Konfigurierbar bis zu 10 Minuten |
| Request-Body | 10 MiB, danach `413`. Konfigurierbar bis zu den 64 MiB, die der Edge-Layer akzeptiert |
| Beschreibbares Dateisystem | Ja, aber es ist temporär und gehört zu einer einzelnen Instanz |
| Zustand auf Modulebene (ein `Map`-Cache) | Bleibt zwischen Requests auf einer Instanz erhalten. Geht bei jedem Deploy und Neustart verloren und wird nicht zwischen Instanzen geteilt |
| Umgebungsvariablen und Secrets | `rebase cloud env set`, werden beim nächsten Deploy angewendet |
| Dateispeicher | Ein Bucket pro Projekt, bereitgestellt durch Ihr Backend unter `/api/storage/file/…` |
| Ausgehender HTTP-Verkehr | Ja, auf den Ports 80 und 443 (sowie 465, 587, 993 für E-Mail). Andere Ports sind blockiert. Eine feste ausgehende IP: `207.175.138.15` |

## Code und Pakete

**Node und das Image.** Das Runtime-Image basiert auf `node:22-slim` (Debian) und Ihr Bundle läuft auf `linux`/`x64` als Nicht-Root-Benutzer. Ihre `tsconfig` und die Node-Version auf Ihrem Rechner ändern daran nichts.

**Abhängigkeiten.** `rebase cloud deploy` installiert die in Ihren `package.json`-Dateien deklarierten Abhängigkeiten für `linux`/`x64` in das Bundle und lädt sie mit hoch, sodass eine neue Instanz nichts mehr installieren muss. Ein Bundle, das zusammen mit ihnen das Upload-Limit von 1 GB überschreiten würde, wird ohne sie hochgeladen, worauf beim Deployment hingewiesen wird: Jede Instanz installiert sie dann beim Starten mittels `npm ci` (oder `npm install` ohne Lockfile). Aus dieser Installationsweise ergeben sich vier Punkte:

- **Install-Skripte werden niemals ausgeführt.** Die Installation verwendet `--ignore-scripts`. Ein Paket, das eine Binärdatei herunterlädt oder in `postinstall` etwas baut, wird ohne diesen Schritt installiert.
- **Es werden nur Registry-Versionen installiert.** Eine `file:`-, `link:`-, `git+…`- oder `github:`-Abhängigkeit führt zu einem Build-Fehler, da die Runtime über keine Quelle verfügt, um sie aufzulösen.
- **Einige Pakete stammen aus dem Image, nicht von Ihnen.** `@rebasepro/server`, `@rebasepro/types`, `@rebasepro/client`, `@rebasepro/common`, `@rebasepro/utils`, `hono`, `@hono/node-server` und `zod` werden aus den Abhängigkeiten des Bundles entfernt und die im Image vorhandenen Kopien verlinkt, sodass Ihre Version davon nicht zum Tragen kommt. Andere `@rebasepro/*`-Pakete, wie z. B. der Datenbanktreiber, werden ganz normal wie jede Abhängigkeit aus Ihrer `package.json` installiert. `typescript` und `tsx` werden ebenfalls entfernt; sie sind Build-Tools.
- **Private Pakete erfordern eine `.npmrc`.** `rebase build` kopiert die `.npmrc` des Projekts (und `backend/.npmrc`) in das Bundle, sodass die Installation dieselben Registry-Einstellungen wie Ihr Rechner verwendet. Jede Zugangsdaten-Angabe darin muss eine Referenz auf eine Umgebungsvariable sein, niemals das Token selbst; ein Literal-Token führt zu einem Build-Fehler, da das Bundle zusammen mit Ihrem Code hochgeladen wird:

  ```ini title=".npmrc"
  @acme:registry=https://npm.pkg.github.com
  //npm.pkg.github.com/:_authToken=${NPM_TOKEN}
  ```

  ```bash
  rebase cloud env set NPM_TOKEN=ghp_… --secret
  ```

Der Bundle-Upload ist im komprimierten Zustand auf 1 GB begrenzt.

**Native Module werden abgelehnt.** Ein Paket, das eine kompilierte `.node`-Binärdatei enthält, kann auf der Managed Runtime nicht geladen werden. `rebase build` warnt davor und `rebase cloud deploy` bricht vor dem Upload ab:

```text no-verify
This bundle depends on native modules (sharp), which the managed runtime cannot run
```

Die Prüfung sucht nach bekannten nativen Paketen (`sharp`, `canvas`, `bcrypt`, `argon2`, `sqlite3`, `better-sqlite3`, `re2`, `sodium-native`, `pg-native`, …), nach `binding.gyp` oder `gypfile`, nach Install-Skripten, die `node-gyp` oder `prebuild` aufrufen, und nach `.node`-Dateien. Der [Deployment-Leitfaden](/docs/getting-started/deployment/#native-modules-on-the-managed-runtime) listet die üblichen Umgehungsmöglichkeiten auf. Die Kurzfassung: Erledigen Sie die Arbeit zur Build-Zeit, rufen Sie einen externen Dienst auf oder stellen Sie mit `runtime: "custom"` bereit.

**WebAssembly funktioniert.** Ein Paket, das eine `.wasm`-Datei mitbringt und sie über JavaScript lädt, ist kein natives Modul und wird von Node 22 ausgeführt. Dies wurde im Basis-Image der Runtime unter den Sicherheitseinstellungen des Pods mit `esbuild-wasm` getestet. Beachten Sie das [Speicherlimit](#compute-und-instanzen), falls das Modul groß ist, wie etwa ein Sprach- oder ML-Modell.

### Binärdateien und Child-Prozesse

`child_process` funktioniert. Das Image selbst enthält nur sehr wenig Ausführbares: `node`, `npm`, `sh`, `tar` und die PostgreSQL-Client-Tools (`pg_dump`, `pg_restore`). Es gibt kein `ffmpeg`, kein ImageMagick, kein Python und keinen Compiler, und Sie können keine Systempakete hinzufügen, da es kein Dockerfile gibt und der Prozess nicht als Root läuft.

Eine Binärdatei, die ein npm-Paket **in seinem eigenen Tarball** mitführt, wird mit dem Paket installiert und ausgeführt. Sie muss für `linux`/`x64` gegen glibc (Debian) gebaut sein und läuft als unprivilegierter Benutzer ohne Linux-Capabilities. Dies wurde mit `@esbuild/linux-x64` im Basis-Image der Runtime getestet. Eine Binärdatei, die ein Paket in `postinstall` *herunterlädt*, wird nie bereitgestellt, da Install-Skripte nicht ausgeführt werden; Pakete wie `ffmpeg-static` funktionieren auf diese Weise.

Wenn ein Feature eine Binärdatei benötigt, verwenden Sie eine gehostete API für diese Aufgabe oder wechseln Sie für das Backend zu `runtime: "custom"`, wo Sie Ihr eigenes Image bauen.

## Compute und Instanzen

Jedes Projekt läuft in seinen eigenen Pods. Arbeitsspeicher und CPU gelten pro Instanz und werden über die [Compute-Stellschrauben](/docs/deployment/cloud/#compute-and-what-it-costs) konfiguriert:

```bash
rebase cloud compute                              # what the project reserves now
rebase cloud compute set --cpu 500m --memory 1Gi
```

Ein Projekt, für das nie eine Stellschraube konfiguriert wurde, läuft als Burstable-Pod: Es reserviert `100m` CPU und `384Mi` Arbeitsspeicher und kann kurzzeitig auf bis zu 2 CPUs und 2 GiB ansteigen (Bursten). Ein manuell konfigurierter Request behält dieses Verhältnis zwischen Request und Limit bei. Führen Sie `rebase cloud compute` aus, um zu sehen, was für Ihr Projekt eingestellt ist.

Instanzen:

- **Standardmäßig eine, immer aktiv.** `--replicas` legt eine feste Anzahl zwischen 1 und 5 fest. Das Backend wird niemals auf Null herunterskaliert.
- **Autoscaling ist optional (Opt-in).** `--autoscale-max` setzt eine Obergrenze von bis zu 16 fest und `--autoscale-cpu-target` (Standardwert 70) definiert die CPU-Auslastung, die der Autoscaler anstrebt.
- **Deploys erfolgen rollierend (Rolling Updates).** Eine neue Instanz startet und wird bereit (ready), bevor die alte gestoppt wird, sodass für kurze Zeit zwei Versionen gleichzeitig Anfragen bedienen.

`--spot` ist standardmäßig deaktiviert; Spot-Instanzen sind günstiger, werden jedoch ohne Vorankündigung neu gestartet.

## Arbeitsspeicher und Zustand auf Modulebene

Ein Wert auf Modulebene, wie `const cache = new Map()` am Anfang einer Funktionsdatei, verbleibt im Node-Prozess. Er überdauert aufeinanderfolgende Requests auf derselben Instanz. Er geht verloren, sobald dieser Prozess beendet wird:

- bei **jedem Deploy**, da jedes Deployment neue Instanzen startet;
- wenn eine **Umgebungsvariable** geändert und bereitgestellt wird;
- wenn eine Instanz neu gestartet, neu geplant (rescheduled) oder (mit `--spot`) zurückgefordert wird.

Bei mehr als einer Instanz verfügt jede über eine eigene Kopie, sodass zwei Requests unterschiedliche Caches sehen können.

Nutzen Sie eine `Map` auf Modulebene als Cache, dessen Verlust verschmerzbar ist: Er beschleunigt den nächsten Request, sollte jedoch nicht die einzige Kopie von Daten sein. Speichern Sie alles, dessen Erstellung Ressourcen gekostet hat – wie generierte Audiodaten oder eine teure API-Antwort –, in der Datenbank oder im [Storage](#speicher-für-generierte-dateien). Für Clients, die Sie nur einmal instanziieren, wie ein API-SDK, verwenden Sie `lazyResource`, damit der Client bei der ersten Verwendung aus der Umgebung des Requests initialisiert wird. Siehe [Konfiguration und Secrets](/docs/backend/custom-functions/#configuration-and-secrets).

[Ausführen mehrerer Instanzen](/docs/deployment/multiple-instances/) listet den Zustand auf, den Rebase selbst pro Prozess vorhält, wie z. B. Rate-Limit-Zähler und Echtzeitkanäle.

## Das Dateisystem

Das Dateisystem des Containers ist beschreibbar und `/tmp` funktioniert. Doch alles, was dorthin geschrieben wird:

- gehört zu einer einzelnen Instanz und andere Instanzen können nicht darauf zugreifen;
- wird gelöscht, wenn die Instanz stoppt, also spätestens beim nächsten Deploy;
- teilt sich ein flüchtiges Speicherlimit (Ephemeral Storage) von 6 GiB mit dem Bundle und den installierten `node_modules`. Eine Instanz, die dieses Limit überschreitet, wird beendet (evicted).

Nutzen Sie es für temporäre Arbeitsdateien während eines einzelnen Requests. Verwenden Sie es nicht als deploy-übergreifenden Cache oder als Speicher für Uploads. Aus diesem Grund ist [`STORAGE_TYPE=local` in der Produktion auch deaktiviert](/docs/backend/storage/#environment-variables).

## Requests

| Limit | Standard | Ändern mit |
|---|---|---|
| Funktions-Timeout | 30 s, danach `504` mit dem Code `FUNCTION_TIMEOUT` | `REBASE_FUNCTIONS_TIMEOUT_MS` (`0` deaktiviert es) |
| Warten auf Ihre Instanz am Edge | 10 Minuten zwischen Lese- oder Schreibvorgängen | Fest vorgegeben |
| Request-Body, `/api/*`-Routen ohne eigenes Limit | 10 MiB, danach `413 PAYLOAD_TOO_LARGE` | `REBASE_MAX_BODY_SIZE`, in Bytes |
| Request-Body am Edge | 64 MiB | Fest vorgegeben |
| Einzelne Datei über `POST /api/storage/upload` | 50 MB | `STORAGE_MAX_FILE_SIZE` |
| Anonyme Aufrufe an `/api/functions/*` | 3000 pro IP alle 15 Minuten | `rateLimit.anonymousFunctions` |

Einige Details:

- **Das Timeout entbindet den Aufrufer, bricht aber nicht automatisch die Arbeit ab.** Nach 30 Sekunden erhält der Aufrufer einen `504` und `getSignal(c)` wird abgebrochen (aborted). Übergeben Sie dieses Signal an `fetch` und alles andere, was ein AbortSignal akzeptiert, damit auch die Hintergrundarbeit stoppt. Siehe [Timeouts und Rate-Limits](/docs/backend/custom-functions/#timeouts-and-rate-limits).
- **Der Edge wartet länger als die Runtime.** Der Ingress vor Ihren Instanzen wartet bis zu 10 Minuten. Das Limit, auf das ein Request stößt, ist also das der Runtime, welche mit JSON antwortet und das Signal abbricht. Erhöhen Sie `REBASE_FUNCTIONS_TIMEOUT_MS` bis zu diesem Wert. Für Aufgaben, die länger dauern oder ein Deployment überstehen müssen (eine Instanz leert laufende Verbindungen für 15 Sekunden), antworten Sie sofort und führen Sie die Arbeit in einem [Job](/docs/backend/jobs/) aus.
- **Uploads über 64 MiB** erfordern den fortsetzbaren Upload (TUS), bei dem die Datei in Chunks übertragen wird. `client.storage.putObject()` wechselt ab 8 MiB automatisch dazu.
- **Response-Größe.** Weder die Runtime noch der Edge setzen ein Limit für die Response-Größe. Eine große Response wird jedoch im Arbeitsspeicher gehalten, wenn Ihr Handler sie am Stück erzeugt; streamen Sie sie daher oder liefern Sie sie aus dem Storage aus.

## Umgebungsvariablen und Secrets

Konfigurieren Sie sie über die CLI oder in der Konsole. In `rebase.json` gibt es dafür kein Feld.

```bash
rebase cloud env set TTS_API_URL=https://api.example.com/v1/speech
rebase cloud env set TTS_API_KEY=sk-… --secret   # write-only: never shown again
rebase cloud env list                            # names only, never values
rebase cloud deploy                              # applies the change
```

- **Änderungen werden beim nächsten Deploy wirksam.** Laufende Instanzen behalten die Werte, mit denen sie gestartet wurden. `set` und `unset` weisen Sie darauf hin (`Pending redeploy`).
- **Limits:** Bis zu 100 Variablen pro Projekt, 32 KiB pro Wert und insgesamt 256 KiB. Namen folgen dem Muster `[A-Za-z_][A-Za-z0-9_]*`.
- **Einige Namen sind reserviert.** Die Plattform setzt `DATABASE_URL`, `DATABASE_DIRECT_URL`, `DATABASE_READ_URL`, `JWT_SECRET`, `REBASE_SERVICE_KEY`, `PORT` sowie `NODE_ENV` selbst und legt fest, wie der Prozess ausgeführt wird (`REBASE_ROLE`, `TRUSTED_PROXY_HOPS`, …). Der Versuch, einen dieser Namen zu setzen, wird verweigert und die Fehlermeldung listet alle reservierten Variablen auf.
- **`CORS_ORIGINS` basiert auf Ihren Domains.** Die Plattform setzt dies auf den Host des Projekts und dessen verifizierte [Custom-Domains](/docs/deployment/cloud/#the-rest-of-the-surface). Ein von Ihnen gesetzter Wert für `CORS_ORIGINS` wird dieser Liste hinzugefügt, falls ein Frontend von woanders gehostet wird: `rebase cloud env set CORS_ORIGINS=https://app.example.org`.
- **Die Storage-Variablen sind Standardwerte.** Die Plattform setzt die `STORAGE_*`- und `S3_*`-Variablen für ihren Bucket, wobei ein von Ihnen definierter Wert Vorrang hat.
- **Build-Zeit-Namen werden abgelehnt.** `VITE_`-, `NEXT_PUBLIC_`-, `PUBLIC_`- und `REACT_APP_`-Variablen sind für Frontends zur Build-Zeit gedacht; das Backend bekommt sie nie rechtzeitig zu sehen. Mit `--force` wird eine solche Variable dennoch gespeichert.

Lesen Sie Variablen in einer Funktion immer innerhalb des Handlers aus, niemals am Anfang der Datei:

```typescript
import { defineFunction, requireEnv } from "@rebasepro/server/functions";

export default defineFunction((app) => {
    app.get("/status", async (c) => {
        const endpoint = requireEnv(c, "TTS_API_URL");   // throws a clear error if unset
        return c.json({ configured: Boolean(endpoint) });
    });
});
```

Ein `process.env`-Aufruf auf Modulebene, der leer zurückkehrt, führt dazu, dass die gesamte Datei nicht geladen werden kann und deren Routen mit `404` antworten. Siehe [Konfiguration und Secrets](/docs/backend/custom-functions/#configuration-and-secrets).

## Speicher für generierte Dateien

Ein Cloud-Projekt erhält Dateispeicher, sobald Sie ihn anlegen:

```bash
rebase cloud storage create   # a managed bucket and its credentials
rebase cloud deploy           # the running backend gets the credentials at deploy
```

Oder verknüpfen Sie das Projekt über `rebase cloud storage attach` mit einem bereits vorhandenen Bucket (S3, R2, MinIO oder einem beliebigen S3-kompatiblen Bucket). Ohne eine dieser Optionen antworten Uploads mit `501 STORAGE_NOT_CONFIGURED`. Weitere Buckets werden in `backend/resources.ts` deklariert; siehe [Mehrere Buckets](/docs/backend/storage/#several-buckets).

Ein Deployment mit Storage wird abgelehnt, bis im Projekt definiert ist, wer Dateien lesen und schreiben darf. Die Vorlage `backend/storage.ts` exportiert hierfür einen `storageAuthorize`-Hook. Siehe [Objektbasierte Autorisierung](/docs/backend/storage-authorization/).

**Wie Dateien ausgeliefert werden.** Ihr Backend stellt jede Datei unter `GET /api/storage/file/<key>` bereit. Es liest das Objekt aus dem Bucket und streamt es inklusive `Content-Type`, Range-Requests und Caching-Headern. Es gibt keine direkte Bucket-URL, die herausgegeben werden könnte.

- Ein Key unter **`public/`** wird für jeden ohne Token unter einer unveränderlichen URL bereitgestellt. Nutzen Sie dies für Dateien, die jeder Besucher laden darf, wie etwa generierte Audios für ein öffentliches Spiel.
- Jeder andere Key ist privat. Ein Client fragt unter `/api/storage/metadata/<key>` eine Download-URL mit Token an, das standardmäßig 300 Sekunden gültig ist (`STORAGE_DOWNLOAD_TOKEN_TTL`, konfigurierbar bis zu einer Woche).

Schreiben Sie aus einer Funktion heraus mit `rebase.storage` (Standard-Bucket) oder `rebase.bucket(…)` (ein benannter Bucket). Ihr `storageAuthorize`-Hook entscheidet weiterhin, ob der Schreibvorgang zulässig ist.

Bildtransformationen (`?width=`, `?format=`) erfordern `sharp`. Da dies ein natives Modul ist und sich nicht im Managed-Image befindet, liefert eine Transformationsanfrage auf der Managed Runtime das Originalbild aus.

### Beispiel: Generiertes Audio cachen

Eine Funktion, die Text über eine gehostete API in Sprache umwandelt, jedes Ergebnis einmalig speichert und es anschließend aus dem Storage ausliefert. Die `Map` erspart bei einer warmen Instanz lediglich den Storage-Lookup; der Bucket dient als eigentlicher Cache, sodass bei einem Deploy nichts verloren geht.

```typescript
import { defineFunction, getSignal, requireEnv } from "@rebasepro/server/functions";

const known = new Map<string, true>(); // per instance, lost on deploy: that is fine

export default defineFunction((app, { rebase }) => {
    app.get("/voice/:id", async (c) => {
        const id = c.req.param("id").replace(/[^a-z0-9-]/gi, "");
        const key = `public/voices/${id}.mp3`;
        const url = `/api/storage/file/${key}`;

        if (known.has(key)) return c.redirect(url);
        const storage = rebase.storage;
        if (!storage) return c.json({ error: "Storage is not configured" }, 501);

        const listed = await storage.listObjects(key, { maxResults: 1 });
        if (listed.items.some(item => item.fullPath === key)) {
            known.set(key, true);
            return c.redirect(url);
        }

        const text = c.req.query("text") ?? "";
        const response = await fetch(requireEnv(c, "TTS_API_URL"), {
            method: "POST",
            headers: {
                authorization: `Bearer ${requireEnv(c, "TTS_API_KEY")}`,
                "content-type": "application/json"
            },
            body: JSON.stringify({ text }),
            signal: getSignal(c)
        });
        if (!response.ok) return c.json({ error: "Speech service failed" }, 502);

        const file = new File([await response.arrayBuffer()], `${id}.mp3`, { type: "audio/mpeg" });
        await storage.putObject({ file, key });
        known.set(key, true);
        return c.redirect(url);
    });
});
```

Die Route ist öffentlich, wie jede Route in `backend/functions/`, solange Sie sie nicht absichern. In der Praxis sollte geprüft werden, wer neue Audios generieren darf, damit niemand Ihr Budget für die Speech-API aufbrauchen kann.

## Ausgehendes Netzwerk

Funktionen können externe Dienste aufrufen. Ausgehende Verbindungen von Ihren Instanzen zu beliebigen Internetadressen sind ausschließlich auf folgenden TCP-Ports zulässig:

| Port | Verwendung |
|---|---|
| 80, 443 | HTTP und HTTPS |
| 465, 587 | E-Mail-Versand über SMTP mit TLS oder STARTTLS |
| 993 | IMAP über TLS |

Alles andere ist blockiert. Das betrifft Port 25, unverschlüsseltes IMAP sowie Datenbanken oder Caches auf eigenen Ports: Redis auf 6379 oder MongoDB auf 27017 außerhalb von Rebase Cloud können nicht erreicht werden. Die Cloud-Metadatenadresse (`169.254.169.254`) ist ebenfalls blockiert.

Die einzige Ausnahme ist Ihre eigene Datenbank. Wenn das Projekt eine eigene PostgreSQL-Datenbank mitbringt (BYODB), erlaubt jedes Deploy auch Verbindungen zum Host dieser Datenbank auf dem Port aus dem Connection-String – und zu nichts anderem auf diesem Port. Der Host wird beim Deploy zu seinen IP-Adressen aufgelöst; falls Ihr Provider die Datenbank auf eine andere Adresse umzieht, müssen Sie erneut deployen. Die Datenbank muss Verbindungen aus dem Internet annehmen: Die App verbindet sich direkt über den Connection-String. Die SSH-Bastion-Einstellungen werden nur für den Verbindungstest genutzt, nicht von der bereitgestellten App.

Die Plattform schaltet keinen Proxy dazwischen und erzwingt kein ausgehendes Rate-Limit; die von Ihnen aufgerufenen Dienste haben jedoch ihre eigenen Limits. Übergeben Sie `getSignal(c)` an `fetch`, damit ein Aufruf abgebrochen wird, wenn das Zeitlimit des Requests überschritten ist.

Der gesamte ausgehende Datenverkehr erfolgt über **eine feste IP-Adresse: `207.175.138.15`**. Fügen Sie diese zur Allowlist eines Drittanbieters hinzu, falls dieser danach verlangt. Die Adresse wird von allen Projekten auf Rebase Cloud geteilt. Ein Eintrag in einer Allowlist beweist daher nur, dass der Aufrufer auf Rebase Cloud läuft, nicht jedoch, dass es sich um Ihr spezifisches Projekt handelt: Authentifizieren Sie sich beim Dienst also weiterhin zusätzlich mit einem API-Schlüssel.

## Starten und Herunterfahren

- **Kaltstart (Cold Start).** Eine neue Instanz lädt das Bundle herunter und entpackt es, bevor sie Anfragen bedienen kann. Ein großer Abhängigkeitsbaum verlangsamt daher jedes Hochskalieren. Wurde ein Bundle ohne Abhängigkeiten hochgeladen, müssen diese ebenfalls installiert werden, was zusätzlich 40 bis 60 Sekunden dauert. Die Plattform wartet bis zu 300 Sekunden darauf, dass eine Instanz betriebsbereit ist.
- **Health-Checks.** Die Plattform prüft `/livez` (der Prozess läuft) und `/health` (die Datenbank ist erreichbar). Beide Endpunkte werden von der Runtime bereitgestellt, Sie müssen sie also nicht selbst implementieren.
- **Herunterfahren.** Bei einem Deploy oder Neustart nimmt die Instanz keine neuen Requests mehr an, wartet 5 Sekunden, damit der Datenverkehr umgeleitet werden kann, und empfängt anschließend ein `SIGTERM`. Bereits laufende Requests haben bis zu 15 Sekunden Zeit, um abgeschlossen zu werden. An `waitUntil` übergebene Promises erhalten davon bis zu 5 Sekunden. Promises, die nicht an `waitUntil` übergeben wurden, werden verworfen. Siehe [Hintergrundaufgaben](/docs/backend/custom-functions/#background-work).

## Wann „Managed“ nicht die richtige Wahl ist

Wechseln Sie für das Backend zu `"runtime": "custom"`, wenn Folgendes benötigt wird:

- ein natives Modul oder eine System-Binärdatei, die von keinem npm-Paket mitgeliefert wird (wie `sharp`, ImageMagick oder eine lokale Speech-Engine);
- Systempakete oder ein anderes Basis-Image;
- eine langlebige Verbindung zu einem Dienst außerhalb der erlaubten Ports.

Eine Custom-Runtime baut Ihr eigenes Dockerfile, und Sie verwalten das Image fortan selbst. Mit `rebase cloud deploy --eject` führen Sie diesen Wechsel durch. Siehe [Rebase Cloud](/docs/deployment/cloud/#deploy).

## Noch nicht zugesichert

- **Log-Historie.** `rebase cloud logs --runtime` liest Logs von den aktuell laufenden Instanzen und `rebase cloud debug logs --previous` aus dem letzten Durchlauf einer Instanz, die neu gestartet wurde. Ausgaben einer Instanz, die durch ein Deploy ersetzt wurde, gehen verloren. Schreiben Sie alles, was Sie aufbewahren müssen, in die Datenbank oder an einen eigenen Logging-Dienst.
- **Scale-to-Zero** wird nicht angeboten. Jedes Backend betreibt zu jeder Zeit mindestens eine Instanz.

## Verwandte Seiten

- [Rebase Cloud](/docs/deployment/cloud/): Verknüpfung, Deployment, Compute-Stellschrauben und was die Beta nicht enthält
- [Custom Functions](/docs/backend/custom-functions/): Schreiben der Routen in `backend/functions/`
- [Runtime und Bundles](/docs/architecture/runtime-and-bundles/): Was ein Bundle ist und wie die Runtime es startet
- [Storage](/docs/backend/storage/): Buckets, Endpunkte, Größenlimits und Zugriffsregeln
- [Ausführen mehrerer Instanzen](/docs/deployment/multiple-instances/): Der Zustand, den Rebase pro Prozess vorhält
