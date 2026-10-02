---
sourceHash: bad3ea0d4f6e00f8
title: Storage-Caching und CDNs
sidebar_label: Storage-Caching und CDNs
description: Wie Rebase gespeicherte Dateien ausliefert, damit Browser und CDNs sie zwischenspeichern können — ETags und 304er, Cache-Control je nachdem, wer ein Objekt lesen darf, Byte-Bereiche zum Spulen in Audio und Video, und was an einem vorgeschalteten CDN zu konfigurieren ist.
---

Jedes Objekt wird über den Server weitergeleitet, anstatt auf eine signierte URL
umzuleiten — eine signierte URL schlägt bei Mixed Content (eine HTTPS-Seite, ein
HTTP-MinIO) und bei Endpunkten fehl, die nur der Cluster erreichen kann. Die
Response-Header sind daher der Schlüssel für ein funktionierendes Caching.

Jede Antwort enthält ein schwaches `ETag` und `Last-Modified`, basierend auf
Größe und Änderungszeitpunkt des Objekts. Ein Client, der das Objekt bereits
besitzt, sendet `If-None-Match` und erhält ein **304 ohne Body**, sodass ein
erneutes Laden lediglich einen Roundtrip anstelle eines Transfers kostet.

`Cache-Control` richtet sich danach, wer das Objekt lesen darf:

| Objekt | Header |
|---|---|
| Unter dem Präfix `public/` oder `publicRead: true` | `public, max-age=60, stale-while-revalidate=86400, must-revalidate` |
| Alles andere | `private, max-age=60, must-revalidate` |
| Bildtransformationen | dasselbe mit `max-age=3600` |

`private` ist eine bewusste Entscheidung: Ein Objekt, für dessen Abruf
Anmeldedaten erforderlich waren, darf nicht in einem gemeinsam genutzten Cache
gespeichert werden, da ein CDN sonst die Datei eines Benutzers an den nächsten
Aufrufer ausliefern könnte. Aus demselben Grund wird `Vary: Authorization`
gesendet.

Nichts wird jemals als `immutable` markiert. Ein Storage-Schlüssel kann
überschrieben werden — das Schreiben auf einen bestehenden Schlüssel ist ein
gewöhnlicher Vorgang —, weshalb das Versprechen, niemals eine Revalidierung
vorzunehmen, dazu führen würde, dass eine ersetzte Datei bis zum Ablauf des
Fensters unsichtbar bliebe.

## Spulen in Audio und Video

Jede Objektantwort enthält `Accept-Ranges: bytes`, und eine `Range`-Anfrage
wird mit `206 Partial Content` und einem `Content-Range` beantwortet. Ohne
diesen Header gestattet ein Browser bei einem hierüber bereitgestellten
Medienelement kein Spulen — und Safari weigert sich, ein `<video>`
abzuspielen, dessen erste Antwort kein `206` ist. Bei Medieninhalten
entscheidet dies also über einen funktionierenden oder defekten Player.

- Ein Bereich pro Anfrage: `bytes=0-499`, `bytes=500-`, `bytes=-500`. Das ist
  das Format, das Browser für die Wiedergabe senden.
- Mehrere Bereiche in einem Header werden mit dem gesamten Objekt und einem
  `200` beantwortet, was stets zulässig ist. Relevante Clients senden diese
  Variante nicht.
- Ein Bereich, der hinter dem Dateiende beginnt, liefert ein `416` mit
  `Content-Range: bytes */<size>`, keine stillschweigende Auslieferung der
  gesamten Datei.
- Revalidierung hat Vorrang vor einem Bereich: Eine Anfrage, die sowohl
  `If-None-Match` als auch `Range` enthält, erhält den `304`-Status.

Bei lokalem Speicher wird nur der angeforderte Ausschnitt von der Festplatte
gelesen. Bei S3 und GCS wird das Objekt weiterhin vollständig abgerufen — ein
`StorageController` verfügt über keinen Bereichslesezugriff —, sodass die
Einsparung bei der Antwort und nicht Upstream erzielt wird.

## Ein CDN vorschalten

Da öffentliche Objekte mit `public`, einem `stale-while-revalidate`-Fenster und
einem Validator ausgeliefert werden, kann jeder reguläre Reverse-Proxy oder
jedes CDN sie ohne zusätzliche Konfiguration zwischenspeichern. Richten Sie ihn
auf den API-Origin aus und lassen Sie ihn die Header verarbeiten.

Zwei Dinge sollten am CDN selbst konfiguriert werden:

- **`Vary: Authorization` berücksichtigen** oder authentifizierte Routen
  überhaupt nicht zwischenspeichern. Ein CDN, das `Vary` ignoriert und
  `private`-Antworten zwischenspeichert, erzeugt genau das Problem, zu dessen
  Vermeidung dieser Header existiert.
- **Mit Revalidierungen rechnen.** Das kurze `max-age` führt dazu, dass das
  CDN regelmäßig nachfragt; diese Anfragen sind schlanke 304-Antworten und
  sorgen dafür, dass ein überschriebenes Objekt nicht veraltet ausgeliefert
  wird.

## Verwandte Themen

- **[Storage-Konfiguration](/docs/backend/storage/)** — die Backends, von denen diese Header ausgeliefert werden, sowie das `public/`-Präfix und `publicRead`, die ein Objekt `public` machen.
- **[Autorisierung auf Objektebene](/docs/backend/storage/#per-object-authorization)** — wer ein Objekt lesen darf, was über `public` oder `private` entscheidet.
- **[Datei-Uploads](/docs/collections/file-uploads/)** — die Collection-Properties, die Dateien speichern.
