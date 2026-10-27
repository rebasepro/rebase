---
sourceHash: b5b66e5876dc7d9c
title: Speicher-Autorisierung
sidebar_label: Speicher-Autorisierung
description: Entscheiden Sie mit storagePolicies und dem Hook storageAuthorize, wer jedes Speicherobjekt lesen, schreiben, löschen oder auflisten darf, und welche Speicher-Scopes ein API-Schlüssel braucht.
---

Collections werden durch Row-Level Security geschützt; ein Bucket hat kein Gegenstück
pro Objekt, daher wird der Speicher hier autorisiert. Die [Speicher-Konfiguration](/docs/backend/storage/)
behandelt die Backends selbst.

## Richtlinien

Die deklarative Form. Eine Liste von Pfadmustern, die gelesen werden, ohne dass etwas ausgeführt wird:

```ts
storagePolicies: [
    { path: "public/**", operations: ["read"], allow: "public" },
    { path: "users/:uid/**", allow: ({ params, user }) => user?.uid === params.uid }
]
```

**Ein Schlüssel, auf den keine Richtlinie zutrifft, wird abgelehnt**, es sei denn, ein `storageAuthorize`-Hook erlaubt ihn: Der Hook wird nur gefragt, wenn keine Richtlinie zugetroffen hat, und keines von beiden kann das andere einschränken. Jede Erweiterung ist eine ausdrückliche Zeile, und ein Fehler verweigert, statt zu gewähren.

Muster treffen **segmentweise zu, niemals als Teilstring** – `public/**` trifft nicht auf
`publicity/secret.png` zu:

| Muster | Trifft zu auf |
|---|---|
| `avatars/logo.png` | genau diesen Schlüssel |
| `users/*/avatar.png` | genau ein Segment an der Stelle von `*` |
| `users/:uid/**` | ein erfasstes Segment, dann den Rest – auch nichts |

`**` ist nur als letztes Segment zulässig. `:name` erfasst ein Segment und überspannt nie
ein `/`; die erfassten Werte kommen als `params` im Prädikat an.

`allow` ist `"public"` (jeder), `"authenticated"` (jeder Aufrufer mit einer uid) oder ein
Prädikat, das die erfassten Parameter, den Benutzer, die Operation und das Bucket erhält.
`operations` ist standardmäßig alle vier – `read`, `write`, `delete`, `list`.

Richtlinien erfüllen den Boot-Guard der Produktion von selbst, und ein fehlerhaftes Muster
lässt den Start scheitern statt erst den ersten Upload.

## Der Hook

`requireAuth` und `publicRead` sind *globale* Schalter: Sie entscheiden, ob ein Aufrufer angemeldet sein muss, nicht worauf dieser Aufrufer zugreifen darf. Ohne einen Autorisierungs-Hook kann **jeder authentifizierte Benutzer jeden Schlüssel lesen, den er benennen kann** – das Einzige, was die Dateien zweier Mandanten trennt, ist die Unerratbarkeit der Schlüssel, und das ist kein Zugriffskontrollmodell. Schlimmer noch: Er kann zuvor `GET /storage/list?prefix=` aufrufen, sodass die Schlüssel nicht einmal erraten werden müssen.

:::caution[Ohne Hook startet der Speicher in der Produktion nicht]
Collections werden durch Row-Level Security geschützt; der Speicher nicht. Im Bucket gibt es
kein Gegenstück pro Objekt, daher *ist* dieser Hook das Modell – und
`initializeRebaseBackend` **wirft beim Start** unter `NODE_ENV=production` einen Fehler, wenn
Speicher konfiguriert ist und keines davon gesetzt ist:

- `storageAuthorize` – ein Hook, pro Objekt. Empfohlen.
- `storagePublicRead: true` – das Bucket ist tatsächlich ein öffentliches, schreibgeschütztes CDN.
- `storageInsecureAllowAnyAuthenticated: true` – eine Single-Tenant-App, in der jedem
  angemeldeten Benutzer jede Datei anvertraut wird. So benannt, dass man es zweimal liest.

In der Entwicklung wird stattdessen eine Warnung protokolliert, sodass ein Projekt hierbei falsch
liegen und lokal bestens funktionieren kann, bis es bereitgestellt wird. Ein per Scaffold erzeugtes
Projekt bringt bereits einen Hook in `config/storage.ts` mit – lesen Sie ihn, bevor Sie ihn
ersetzen, und beachten Sie, dass er die *gemeinsame Inhaltsbibliothek* eines CMS abbildet, was nicht
dieselbe Form hat wie Dateien pro Benutzer.
:::

`storageAuthorize` ist das Speicher-Gegenstück zu den Sicherheitsregeln einer Collection und läuft auf jeder Speicher-Route nach der Authentifizierung:

```typescript no-verify
await initializeRebaseBackend({
    storage: { type: "s3", bucket: "app-files", /* ... */ },
    storageAuthorize: async ({ key, bucket, operation, user }) => {
        if (!user) return false;
        // Keys are laid out as `{teamId}/{docId}/...`
        const [teamId] = key.split("/");
        return isTeamMember(user.uid, teamId);
    }
});
```

| Feld | Beschreibung |
|-------|-------------|
| `key` | Objektschlüssel, ohne das Bucket-Präfix und von Pfadumgehungen (Traversal) bereinigt |
| `bucket` | Aufgelöstes Bucket (`"default"`, wenn nicht angegeben) |
| `operation` | `"read"`, `"write"`, `"delete"` oder `"list"` |
| `user` | `{ uid, email?, roles? }` oder `null`, wo die Route anonymen Zugriff erlaubt |
| `storageId` | Das benannte Backend, wenn die Anfrage eines ansprach – sein kanonischer Schlüssel (`storageId=%20media` ist `"media"`). Fehlt für die Standardquelle, egal wie die Anfrage sie benannt hat (kein Parameter, leer oder `(default)`) |
| `data` | Vertrauenswürdiger Lesezugriff, der **RLS umgeht** – `data.collection(slug).find(query)` / `.findById(id)`. Die Eigentümerschaft steht in einer Zeile, nicht in einem Schlüsselpräfix, daher braucht der Hook einen Leser, um „Wem gehört dieses Objekt?“ zu beantworten. Er umgeht Row-Level Security absichtlich: Dieser Hook *ist* die Autorisierungsentscheidung, und sie über einen Leser zu treffen, der bereits durch die eigenen Berechtigungen des Aufrufers eingeschränkt ist, wäre zirkulär. Absichtlich nur lesend. |

Geben Sie `false` zurück, um mit **403** abzulehnen. Auch ein geworfener Fehler lehnt ab – eine fehlgeschlagene Eigentümer-Abfrage lässt nichts durch.

Gut zu wissen:

- **Die Metadaten-Route ist der Ort, an dem der Lesezugriff tatsächlich entschieden wird.** Sie stellt das kurzlebige, pfadgebundene Download-Token aus, dem die Datei-Route vertraut, daher kontrolliert der Hook sie dort. Zwei Lesezugriffe überspringen den Hook, absichtlich. Einer, der ein solches Token mitbringt: Der Hook hat ihn genehmigt, als das Token ausgestellt wurde, nur für diesen Pfad und diese Quelle, sodass ein Hook, der jetzt ablehnen würde (eine inzwischen widerrufene Mitgliedschaft), ihn nicht stoppt, bevor das Token abläuft – `storageDownloadTokenTtl`, standardmäßig 300 Sekunden. Und ein Lesezugriff auf einen Schlüssel unter `public/` durch einen Aufrufer ohne Zugangsdaten: Das Präfix ist die Erklärung, dass jeder ihn lesen darf, anonyme Besucher und CDNs eingeschlossen. Bei dem Lesezugriff eines angemeldeten Aufrufers darauf wird der Hook weiterhin gefragt, bei dem eines anonymen nicht, sodass ein Hook einen `public/`-Schlüssel nicht privat machen kann; speichern Sie die Datei stattdessen außerhalb von `public/`. Nur diese beiden Lesezugriffe überspringen ihn: Ein Benutzer, den Ihr Auth-Adapter zufällig `public` nennt, wird wie jeder andere gefragt.
- **Ein Bucket, ein Name.** Auf S3 und GCS ist das `bucket` des Hooks immer `"default"`, auch wenn eine Anfrage das Bucket des Anbieters benennt, das dieselben Objekte erreicht.
- **Ein Pfad ist öffentlich, wenn der Schlüssel, den er benennt, es ist.** Das Präfix `public/` wird am kanonischen Schlüssel getestet, den die Route bedient – nachdem ein führendes Bucket-Segment `default/` abgelesen und `//`, `./` und ein führendes `/` weggefaltet wurden –, niemals an der URL, wie sie geschrieben wurde. `/api/storage/file/notes://public/x.txt` benennt den privaten Schlüssel `notes:/public/x.txt`, und der Schlüssel `default/public/x.txt` (erreicht als `/api/storage/file/default/default/public/x.txt`) liegt in einem Ordner namens `default`; keiner von beiden ist öffentlich. Testen Sie in einem Hook den `key`, den Sie erhalten, mit `isPublicStorageKey` aus `@rebasepro/types` – `isPublicStoragePath` liest einen clientseitigen Pfad oder eine URL und liest beide davon als öffentlich.
- **`list` wird am Präfix kontrolliert.** Auflisten ist der Weg, Schlüssel zu entdecken, von denen Ihnen niemand erzählt hat.
- **Fortsetzbare (TUS-)Uploads werden beim Erstellen kontrolliert**, sodass ein abgelehnter Upload keine temporäre Datei hinterlässt.
- Wird der Hook (und `storagePolicies`) weggelassen, bleibt keine Prüfung pro Objekt, sodass die Produktion den Start verweigert, es sei denn, `storagePublicRead` oder `storageInsecureAllowAnyAuthenticated` ist gesetzt.

## API-Schlüssel und Tokens

Eine angemeldete Person hält jeden Speicher-Scope, daher entscheiden für sie der Hook und die
obigen Richtlinien. Ein [API-Schlüssel](/docs/backend/api-keys/) braucht zusätzlich den
Speicher-Scope für die Operation, auf der Quelle, die die Anfrage benennt: `storage:read` für
Downloads, Metadaten und Auflistungen, `storage:write` für Uploads, Ordner und jeden Schritt
eines fortsetzbaren Uploads, `storage:delete` für Löschungen. Das Ziel ist die Quell-ID, und
die der Standardquelle ist `(default)`: `storage:read:(default)`, `storage:write:avatars`. Ohne
ihn lautet die Antwort `403 SCOPE_MISSING`. Mit ihm läuft der Hook weiterhin, als diejenige
Identität, als die der Schlüssel handelt.

## Nächste Schritte

- **[Speicher-Konfiguration](/docs/backend/storage/)** – Backends, Endpunkte und Limits
- **[API-Schlüssel](/docs/backend/api-keys/)** – die Scopes, die ein Schlüssel trägt
