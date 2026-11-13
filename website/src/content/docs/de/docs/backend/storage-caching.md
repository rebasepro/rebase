---
sourceHash: 5711b13e11b0b4c4
title: Speicher-Caching und CDNs
sidebar_label: Speicher-Caching und CDNs
description: Wie Rebase gespeicherte Dateien bereitstellt, damit Browser und CDNs sie cachen können – ETags und 304s, Cache-Control basierend darauf, wer ein Objekt lesen darf, Byte-Ranges zum Spulen in Audio und Video, und was auf einem vorgeschalteten CDN konfiguriert werden sollte.
---

Jedes Objekt wird über den Server per Proxy geleitet, anstatt auf eine signierte
URL weitergeleitet zu werden – eine signierte URL führt bei Mixed Content (eine
HTTPS-Seite, ein HTTP-MinIO) und bei Endpunkten, die nur der Cluster erreichen
kann, zu Fehlern. Daher sorgen die Response-Header dafür, dass das Caching funktioniert.

Jede Antwort enthält ein schwaches `ETag` und `Last-Modified`, die aus der Größe
und der Änderungszeit des Objekts generiert werden. Ein Client, der das Objekt
bereits besitzt, sendet `If-None-Match` und erhält **304 ohne Body**, sodass ein
erneuter Ladevorgang nur einen Roundtrip anstelle eines Transfers kostet.

`Cache-Control` hängt davon ab, wer das Objekt lesen darf:

| Objekt | Header |
|---|---|
| Unter dem Präfix `public/` oder `publicRead: true` | `public, max-age=60, stale-while-revalidate=86400, must-revalidate` |
| Alles andere | `private, max-age=60, must-revalidate` |
| Bildtransformationen | dasselbe, mit `max-age=3600` |

`private` ist beabsichtigt: Ein Objekt, für dessen Abruf Anmeldedaten erforderlich
waren, darf nicht in einem geteilten Cache (Shared Cache) gespeichert werden, da
ein CDN sonst die Datei eines Benutzers an den nächsten Aufrufer ausliefern könnte.
`Vary: Authorization` wird aus demselben Grund gesendet.

Nichts wird jemals als `immutable` markiert. Ein Storage-Key kann überschrieben
werden – das Schreiben auf einen bestehenden Schlüssel ist ein gewöhnlicher
Vorgang –, daher würde das Versprechen, niemals zu revalidieren, eine ersetzte
Datei unsichtbar machen, bis das Zeitfenster abgelaufen ist.

## Spulen in Audio und Video

Jede Objekt-Antwort enthält `Accept-Ranges: bytes`, und eine `Range`-Anfrage wird
mit `206 Partial Content` und einem `Content-Range` beantwortet. Ohne dies bietet
ein Browser bei einem von hier bereitgestellten Medienelement kein Spulen an – und
Safari weigert sich, ein `<video>` abzuspielen, dessen erste Antwort kein `206`
ist –, für Medien ist dies also der Unterschied zwischen einem funktionierenden
und einem fehlerhaften Player.

- Ein Bereich pro Anfrage: `bytes=0-499`, `bytes=500-`, `bytes=-500`. Das ist es,
  was Browser für die Wiedergabe senden.
- Mehrere Bereiche in einem Header werden mit dem gesamten Objekt und einem `200`
  beantwortet, was stets zulässig ist. Relevante Clients senden diese nicht.
- Ein Bereich, der hinter dem Dateiende beginnt, resultiert in einem `416` mit
  `Content-Range: bytes */<size>`, nicht in einer stillschweigenden Auslieferung
  der gesamten Datei.
- Revalidierung hat Vorrang vor einem Bereich: Eine Anfrage, die sowohl
  `If-None-Match` als auch `Range` enthält, erhält den `304`.

Es werden nur die angeforderten Bytes gelesen – bei lokalem Speicher von der
Festplatte und bei S3 sowie GCS über einen Ranged Read – und jedes Objekt wird
direkt beim Lesen an den Client gestreamt, anstatt zuvor im Arbeitsspeicher
gehalten zu werden. Die Bereitstellung eines großen Videos kostet den Server
somit genauso viel Speicher wie die Bereitstellung eines Thumbnails. Eine
Revalidierung, die in einem `304`, einem `HEAD`, einem `416` oder einer gecachten
Bildwiedergabe endet, wird anhand der Metadaten des Objekts beantwortet, ohne
dass dessen Bytes überhaupt gelesen werden.

Ein benutzerdefinierter `StorageController` erreicht dasselbe durch die
Implementierung der optionalen Methoden `statObject` und `getObjectStream`. Ein
Controller ohne diese Methoden wird über `getObject` bedient, wodurch bei jeder
Anfrage das gesamte Objekt gelesen wird, einschließlich Ranges.

## Ein CDN vorschalten

Da öffentliche Objekte `public` sind – mit einem `stale-while-revalidate`-Fenster
und einem Validator –, kann jeder gewöhnliche Reverse-Proxy oder jedes CDN sie
ohne zusätzliche Konfiguration cachen. Richten Sie ihn einfach auf den
API-Origin aus und lassen Sie ihn die Header berücksichtigen.

Zwei Dinge, die auf dem CDN selbst konfiguriert werden sollten:

- **`Vary: Authorization` berücksichtigen** oder authentifizierte Routen überhaupt
  nicht cachen. Ein CDN, das `Vary` ignoriert und `private`-Antworten cacht, ist
  genau der Fehlerfall, den dieser Header verhindern soll.
- **Mit Revalidierung rechnen.** Das kurze `max-age` bedeutet, dass das CDN
  regelmäßig nachfragt; diese Anfragen sind kostengünstige 304s, und sie
  verhindern, dass ein überschriebenes Objekt veraltet ausgeliefert wird.

## Verwandte Themen

- [Storage Configuration](/docs/backend/storage/) – die Backends, von denen diese Header ausgeliefert werden, sowie das Präfix `public/` und `publicRead`, die ein Objekt öffentlich (`public`) machen.
- [Per-object authorization](/docs/backend/storage-authorization/) – wer ein Objekt lesen darf, was die Entscheidung zwischen `public` und `private` bestimmt.
- [File uploads](/docs/collections/file-uploads/) – die Storage-Spalten, die Dateien enthalten, und wie das Panel sie hochlädt.
