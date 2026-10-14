---
sourceHash: d79cfc20665e2e22
title: Fortsetzbare Uploads (TUS)
sidebar_label: Fortsetzbare Uploads (TUS)
description: Der TUS-v1.0.0-Endpunkt unter /api/storage/tus — wie eine große Datei Chunk für Chunk hochgeladen wird, was jede Anfrage beantwortet, wie SDK und Admin-Panel ihn nutzen und wie er sich über Neustarts und Instanzen hinweg verhält.
---

Für das Hochladen großer Dateien oder bei instabilen Netzwerkbedingungen implementiert Rebase das offene Protokoll **TUS v1.0.0** einschließlich der Erweiterungen `Creation` und `Termination`.
Seine Limits sind die der Quelle, wie bei jedem Upload — siehe
[Wie groß eine Datei sein darf](/docs/backend/storage/#how-large-a-file-may-be).

## Warum große Dateien diesen Weg gehen

`POST /api/storage/upload` ist ein einzelner Multipart-Body, den der Server vollständig parst,
bevor er ihn speichert: das Drei- bis Fünffache der Datei in seinem Speicher (etwa 340 MB
für eine 100-MB-Datei). Ein fortsetzbarer Upload hält jeweils einen Chunk — jedes `PATCH`
liegt unter dem globalen Body-Limit, standardmäßig 10 MB — und wird von der Festplatte in den
Store geschrieben: etwa 50 MB für diese Datei und 80 MB für eine mit 400 MB. Passen Sie das Limit der
Quelle also an den Speicher des Servers an, wenn Clients `POST /api/storage/upload`
für große Dateien nutzen, und sonst nicht.

`client.storage.putObject()` und das Admin-Panel senden eine Datei über
8 MiB durch den fortsetzbaren Endpunkt, in Chunks zu 8 MiB, und setzen einen Chunk, der
unterwegs fehlschlägt, ab dem Offset fort, den der Server hält. Die Datei landet so, wie
`POST /api/storage/upload` sie speichern würde — mit demselben Schlüssel, Bucket, Typ, denselben
benutzerdefinierten Metadaten, Limits, derselben `storageAuthorize`-Prüfung und demselben `finalize`-Trigger — und der
Aufruf gibt dasselbe `{ key, bucket, storageUrl }` zurück. Kann die fortsetzbare Route
sie nicht tragen — ein Server ohne den Endpunkt, ein Chunk über dem Body-Limit des Servers
oder eine Instanz, die den Upload nicht hält (siehe
[Mehrere Instanzen betreiben](/docs/deployment/multiple-instances/#files)) —, geht die
Datei stattdessen durch `POST /api/storage/upload`, und diese Quelle sendet
auch jede spätere Datei so.

```
Client                                                   Rebase Server
  │                                                           │
  │─── POST /api/storage/tus (Upload-Length: 50000000) ──────>│ (Generates session ID)
  │<── 201 Created (Location: /api/storage/tus/uuid-abc) ────│
  │                                                           │
  │─── PATCH /api/storage/tus/uuid-abc (Upload-Offset: 0) ───>│ (Appends chunk via open/write)
  │<── 204 No Content (Upload-Offset: 1500000) ───────────────│
  │                                                           │
  │─── PATCH /api/storage/tus/uuid-abc (Upload-Offset: 1.5M) ─>│ (Upload finishes)
  │<── 204 No Content (Upload-Offset: 50000000) ──────────────│ (Copies to storage, unlinks temp)
```

## Upload-Lebenszyklus

1. **Sitzungsinitialisierung (`POST`)**: Der Client sendet die Gesamtgröße der Datei im Header `Upload-Length` und Base64-Metadaten über `Upload-Metadata`: `key` (oder `filename`), `filetype`, `bucket`, `storageId`, `collection` und `property`, so wie `POST /api/storage/upload` sie als Formularfelder annimmt, und `metadata_<name>`-Einträge, die zu den benutzerdefinierten Metadaten des Objekts werden, so wie es `metadata_<name>`-Felder tun. Der Server legt eine leere Platzhalterdatei in einem versteckten temporären Verzeichnis `.tus-uploads/` an, mit einem Eintrag über den Upload daneben (`<id>.json`: sein Schlüssel, Bucket, seine Quelle, sein Typ, seine Größe und sein Eigentümer), und gibt die Upload-URL zurück. Er antwortet außerdem mit `Rebase-Upload-Result: on-complete`: Dieser Server meldet, was er gespeichert hat, wenn der Upload abgeschlossen ist. Der Upload lebt in diesem Verzeichnis, nicht im Prozess: Ein neu gestarteter Server setzt ihn fort, und jede Instanz, die sich `STORAGE_PATH` teilt, bedient ihn — siehe [Mehrere Instanzen betreiben](/docs/deployment/multiple-instances/#files).
2. **Fortschrittsabfragen (`HEAD`)**: Wird ein Upload unterbrochen, fragt der Client die Upload-URL mit einer `HEAD`-Anfrage ab. Der Server gibt die aktuelle Byte-Position im Header `Upload-Offset` zurück.
3. **Daten anhängen (`PATCH`)**: Der Client sendet die Binärdaten ab dem zurückgegebenen Offset mit `Content-Type: application/offset+octet-stream` weiter. Der Server schreibt jeden Chunk an dem Byte-Offset in die temporäre Datei, den die Anfrage angibt und der dem Offset entsprechen muss, den der Server hält (andernfalls `409`). Es wird jeweils ein Chunk empfangen: Ein `PATCH`, der eintrifft, während ein anderer für denselben Upload noch empfangen wird — typischerweise ein Client, der einen ins Stocken geratenen Chunk erneut sendet —, wird mit `423 UPLOAD_LOCKED` beantwortet, und der Client setzt ab dem Offset fort, den `HEAD` meldet.
4. **Abschluss**: Stimmt der akkumulierte `Upload-Offset` mit der deklarierten `Upload-Length` überein, liest Rebase die fertige temporäre Datei, verpackt sie als standardmäßiges JavaScript-`File`-Objekt und speichert sie im konfigurierten Storage-Backend (lokale Festplatte oder S3). Die temporäre Datei wird anschließend gelöscht. Dieser letzte `PATCH` antwortet mit `Rebase-Upload-Result` und dem gespeicherten Objekt — `{ key, bucket, storageUrl }`, was `POST /api/storage/upload` unter `data` beantwortet — als URI-kodiertes JSON. Ein Frontend auf einem anderen Origin kann es lesen, ebenso `Location` und `Upload-Offset`, nur wenn der Server sie in `Access-Control-Expose-Headers` freigibt: Die Rebase-Runtime und das ejectete Backend tun es; ein [eigener Server](/docs/backend/custom-server/) muss es tun.
5. **Periodische Bereinigung**: Ein Hintergrund-Cleaner läuft alle **60 Sekunden** und löscht unvollständige temporäre Uploads, die vor mehr als **24 Stunden** begonnen wurden — auch solche, die ein anderer Prozess gestartet hat, gelesen aus dem Verzeichnis.

## Wer einen Upload erreichen darf

Ein Upload, den ein angemeldeter Aufrufer gestartet hat, antwortet nur diesem Aufrufer und Administratoren;
jeder andere erhält `404`, als gäbe es die ID nicht. Ein Upload ohne Sitzung hat keinen
Eigentümer, sodass seine ID eine Capability ist: Wer die Upload-URL hält, kann seinen Fortschritt lesen, daran
anhängen und ihn abbrechen. Halten Sie diese URL geheim, wie ein Download-Token. Nur ein Deployment,
das den Speicher mit `requireAuth: false` betreibt, kann einen solchen starten: Bei aktivem `requireAuth`, dem
Standard, wird ein `POST` ohne Sitzung mit `401` abgelehnt.

## Verwandte Themen

- [Storage-Konfiguration](/docs/backend/storage/) — Quellen, Limits, Endpunkte und Autorisierung
- [Mehrere Instanzen betreiben](/docs/deployment/multiple-instances/#files) — wo ein laufender Upload liegt
- [Storage-SDK](/docs/sdk/storage/) — `putObject()`, das diesen Endpunkt für Dateien über 8 MiB verwendet
