---
sourceHash: 9e712bfba357185d
title: Endpunkt-Index
sidebar_label: Endpunkt-Index
description: Jede HTTP-Route, die ein Rebase-Backend mountet – Daten, Authentifizierung, Speicher, Admin, Meta – mit dem jeweiligen Gate und der Seite, die sie erklärt.
---

Jede Route, die der Server mountet, in einer Tabelle, zusammen mit den Voraussetzungen, um sie zu erreichen.

Die Pfade setzen den Standard-`basePath` `/api` voraus; `REBASE_BASE_PATH` verschiebt sie
alle gemeinsam. `/health`, `/livez` und `/metrics` befinden sich absichtlich außerhalb davon,
da ein Orchestrator `/health` prüft und den Basispfad nicht kennen müssen sollte. `/health`
ist *auch* darunter gemountet, sodass `/api/health` auf dieselbe Weise antwortet, anstatt
genau in dem Moment einen 404-Fehler zurückzugeben, in dem jemand prüft, ob der Server
noch am Leben ist.

Ein Gate – `tooling/scripts/docs-verify/check-endpoint-index.mjs` – vergleicht diese
Tabelle mit den vom Quellcode registrierten Routen, sodass keine neue Schnittstelle
hinzugefügt werden kann, ohne hier aufgeführt zu sein.

## Gates

| Gate | Bedeutung |
|---|---|
| **none** | Nicht authentifiziert. Jeder, der den Host erreichen kann, kann diesen Endpunkt aufrufen |
| **session** | Ein angemeldeter Aufrufer: ein Access-Token oder ein API-Schlüssel mit Gültigkeitsbereich für die Operation |
| **admin** | Eine Admin-Sitzung, ein Service-Schlüssel oder ein API-Schlüssel mit Admin-Berechtigung |
| **RLS** | Authentifiziert, und die Datenbank entscheidet Zeile für Zeile – siehe [Security Rules](/docs/collections/security-rules/) |
| **dev** | Nur außerhalb der Produktion gemountet |

## Daten

Wird pro Collection generiert, daher enthalten die Pfade Ihre Slugs anstelle einer festen
Liste. `:slug` ist der `slug` einer Collection.

| Methode | Pfad | Gate | Mehr |
|---|---|---|---|
| `GET` | `/api/data/collections` | session | [REST API](/docs/backend/api/) |
| `GET` | `/api/data/:slug` | RLS | [Abfragen](/docs/backend/api/#filtering) |
| `POST` | `/api/data/:slug` | RLS | [REST API](/docs/backend/api/) |
| `GET` | `/api/data/:slug/count` | RLS | [Abfragen](/docs/backend/api/#filtering) |
| `GET` | `/api/data/:slug/aggregate` | RLS | [REST API](/docs/backend/api/#rest-endpoints) |
| `GET` | `/api/data/:slug/:id` | RLS | [REST API](/docs/backend/api/) |
| `PATCH` | `/api/data/:slug/:id` | RLS | [REST API](/docs/backend/api/) |
| `PUT` | `/api/data/:slug/:id` | RLS | Veralteter Alias von `PATCH` – derselbe partielle Schreibvorgang, antwortet mit `Deprecation: true` |
| `DELETE` | `/api/data/:slug/:id` | RLS | [REST API](/docs/backend/api/) |
| `POST` | `/api/data/:slug/bulk` | RLS | Mehrere Zeilen einfügen, optional mit Upsert – [REST API](/docs/backend/api/) |
| `PATCH` | `/api/data/:slug/bulk` | RLS | Mehrere Zeilen anhand der ID aktualisieren – [REST API](/docs/backend/api/) |
| `POST` | `/api/data/:slug/bulk/delete` | RLS | Mehrere Zeilen anhand der ID löschen – [REST API](/docs/backend/api/) |
| `POST` | `/api/data/_batch` | RLS | Collections-übergreifend in einer Transaktion schreiben – [Writing over REST](/docs/backend/writes/#cross-collection-batches) |
| `GET` | `/api/data/:slug/:id/history` | RLS | [Entity History](/docs/backend/history/) |
| `POST` | `/api/data/:slug/:id/history/:historyId/revert` | RLS | [Entity History](/docs/backend/history/) |

Zählen und Aggregation sind eigene Routen, die vor `/:id` registriert werden,
damit `aggregate` nicht als Entity-ID interpretiert wird. `?select=` und `?groupBy=` sind
deren Parameter, und `select` ist bei `/aggregate` erforderlich.

Volltextsuche, Vektorsuche, Einbindung von Relationen und Feldauswahl *sind* Query-Parameter
auf `GET /api/data/:slug` und keine Routen – `search`,
`vector_search`, `include`, `fields`. Siehe [REST API](/docs/backend/api/).

Ein Projekt, das keine Collections deklariert und keine introspeziert, liefert für dieses Präfix
ein einzelnes `404 NO_COLLECTIONS` aus. Siehe [Backend only](/docs/getting-started/headless/).

## Auth

| Methode | Pfad | Gate | Mehr |
|---|---|---|---|
| `GET` | `/api/auth/config` | none | Was der Anmeldebildschirm anbieten kann: Registrierung, Passwort-Reset, Magic Link, E-Mail-Codes, Gast-Anmeldung, OAuth-Provider und ob das Einrichten des ersten Admins aussteht |
| `POST` | `/api/auth/register` | none | [Authentifizierung](/docs/backend/authentication/) |
| `POST` | `/api/auth/login` | none | [Auth-Endpunkte](/docs/backend/auth-endpoints/) |
| `POST` | `/api/auth/refresh` | none (ein Refresh-Token) | [Auth-Endpunkte](/docs/backend/auth-endpoints/) |
| `POST` | `/api/auth/logout` | session | [Auth-Endpunkte](/docs/backend/auth-endpoints/) |
| `GET` | `/api/auth/me` | session | [Auth-Endpunkte](/docs/backend/auth-endpoints/) |
| `PATCH` | `/api/auth/me` | session | [Auth-Endpunkte](/docs/backend/auth-endpoints/) |
| `GET` | `/api/auth/sessions` | session | [Auth-Endpunkte](/docs/backend/auth-endpoints/) |
| `DELETE` | `/api/auth/sessions` | session | Widerruft jede andere Sitzung |
| `DELETE` | `/api/auth/sessions/:id` | session | Widerruft eine |
| `POST` | `/api/auth/forgot-password` | none | [Authentifizierung](/docs/backend/authentication/) |
| `POST` | `/api/auth/reset-password` | none (ein Reset-Token) | [Authentifizierung](/docs/backend/authentication/) |
| `POST` | `/api/auth/change-password` | session | [Authentifizierung](/docs/backend/authentication/) |
| `POST` | `/api/auth/send-verification` | session | [Authentifizierung](/docs/backend/authentication/) |
| `GET` | `/api/auth/verify-email` | none (ein Verifizierungs-Token) | [Authentifizierung](/docs/backend/authentication/) |
| `POST` | `/api/auth/magic-link` | none | [Authentifizierung](/docs/backend/authentication/) |
| `POST` | `/api/auth/magic-link/verify` | none (ein Link-Token) | [Authentifizierung](/docs/backend/authentication/) |
| `POST` | `/api/auth/otp` | none | Einmalcodes per E-Mail |
| `POST` | `/api/auth/otp/verify` | none (ein Code) | Einmalcodes per E-Mail |
| `POST` | `/api/auth/anonymous` | none | Gastsitzungen. Deaktiviert, außer wenn `ALLOW_ANONYMOUS` |
| `POST` | `/api/auth/anonymous/link` | session (ein Gast) | Wandelt einen Gast in ein Konto um |
| `POST` | `/api/auth/find-user` | session | Deaktiviert, außer wenn `AUTH_ALLOW_USER_LOOKUP` – stellt eine Angriffsfläche für Enumeration dar |
| `POST` | `/api/auth/:provider` | none | Einer pro konfiguriertem OAuth/OIDC-Provider |
| `POST` | `/api/auth/link/:provider` | session | Verknüpft einen Provider mit dem angemeldeten Konto |
| `POST` | `/api/auth/mfa/enroll` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/verify` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `GET` | `/api/auth/mfa/factors` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `DELETE` | `/api/auth/mfa/unenroll` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/challenge` | none (eine laufende Anmeldung) | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/challenge/verify` | none (eine Challenge-ID) | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `GET` | `/.well-known/jwks.json` | none | Das öffentliche JWKS, wenn [asymmetrische Signierung](/docs/backend/auth-endpoints/#asymmetric-tokens-and-jwks) konfiguriert ist |

## Admin

Alles unter `/api/admin` erfordert eine Admin-Sitzung, einen Service-Schlüssel oder
einen API-Schlüssel mit Admin-Berechtigung. Nicht ein einzelnes Privileg reicht aus:
Ein Schlüssel, dessen Gültigkeitsbereich auf eine Collection beschränkt ist, hat auf nichts davon Zugriff.

| Methode | Pfad | Gate | Mehr |
|---|---|---|---|
| `POST` | `/api/admin/bootstrap` | none, und nur solange kein Admin existiert | In der Produktion verweigert – siehe [First User Bootstrap](/docs/backend/authentication/#first-user-bootstrap) |
| `GET` | `/api/admin/users` | admin | Benutzerverwaltung |
| `POST` | `/api/admin/users` | admin | Benutzerverwaltung |
| `GET` | `/api/admin/users/:uid` | admin | Benutzerverwaltung |
| `PUT` | `/api/admin/users/:uid` | admin | Benutzerverwaltung |
| `DELETE` | `/api/admin/users/:uid` | admin | Benutzerverwaltung |
| `POST` | `/api/admin/users/:uid/reset-password` | admin | Gibt ein temporäres Passwort aus |
| `GET` | `/api/admin/roles` | admin | Die Rollen, die das Projekt deklariert |
| `GET` | `/api/admin/api-keys` | admin | [API-Schlüssel](/docs/backend/api-keys/) |
| `POST` | `/api/admin/api-keys` | admin | Der Klartext-Schlüssel wird nur einmalig bei der Erstellung zurückgegeben |
| `GET` | `/api/admin/api-keys/:id` | admin | [API-Schlüssel](/docs/backend/api-keys/) |
| `PUT` | `/api/admin/api-keys/:id` | admin | [API-Schlüssel](/docs/backend/api-keys/) |
| `DELETE` | `/api/admin/api-keys/:id` | admin | [API-Schlüssel](/docs/backend/api-keys/) |
| `GET` | `/api/admin/cron` | admin | [Cron Jobs](/docs/backend/cron-jobs/) |
| `GET` | `/api/admin/cron/:id` | admin | [Cron Jobs](/docs/backend/cron-jobs/) |
| `PUT` | `/api/admin/cron/:id` | admin | Einen Job aktivieren oder deaktivieren |
| `GET` | `/api/admin/cron/:id/logs` | admin | [Cron Jobs](/docs/backend/cron-jobs/) |
| `POST` | `/api/admin/cron/:id/trigger` | admin | Einen Job jetzt ausführen |
| `GET` | `/api/admin/backups` | admin | Backup-Inventar |
| `GET` | `/api/admin/backups/download` | admin | Streamt ein Backup |
| `GET` | `/api/admin/logs` | admin | Der Puffer der letzten Protokolle |
| `GET` | `/api/admin/logs/latest` | admin | Die neuesten Einträge |
| `GET` | `/api/admin/logs/stream` | admin | Server-Sent Events |
| `GET` | `/api/admin/rls-audit` | admin | Das jüngste Ergebnis des geplanten Audits |
| `GET` | `/api/admin/schema/status` | admin | [Live-Schema-Bearbeitung](/docs/backend/live-schema-editing/) |
| `POST` | `/api/admin/schema/plan` | admin | Plant eine Änderung; wendet sie niemals an |
| `POST` | `/api/admin/schema/apply` | admin | Deaktiviert, außer wenn `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` |
| `GET` | `/api/admin/schema-editor/status` | admin | Ob der Editor verfügbar ist, und der Grund, falls nicht |
| `POST` | `/api/admin/schema-editor/collection/save` | admin | [Studio](/docs/studio/) – schreibt den Collection-Quellcode neu |
| `POST` | `/api/admin/schema-editor/collection/delete` | admin | [Studio](/docs/studio/) |
| `POST` | `/api/admin/schema-editor/property/save` | admin | [Studio](/docs/studio/) |
| `POST` | `/api/admin/schema-editor/property/delete` | admin | [Studio](/docs/studio/) |
| `GET` | `/api/admin/dev/emails` | dev | E-Mails, die der Entwicklungs-Transport abgefangen hat, anstatt sie zu senden |
| `DELETE` | `/api/admin/dev/emails` | dev | Leert das erfasste Postfach |

`/api/admin/cron`, `/api/admin/logs` und `/api/admin/schema-editor` werden auch
unter ihren Pfaden vor Version 0.17 ohne das `/admin`-Segment bereitgestellt. Diese Aliase
sind für Projekte gedacht, die noch nicht umgestellt wurden; schreiben Sie neuen Code gegen den kanonischen Pfad.

## Speicher

| Methode | Pfad | Gate | Mehr |
|---|---|---|---|
| `POST` | `/api/storage/upload` | session + `storageAuthorize` | [Speicher](/docs/backend/storage/) |
| `GET` | `/api/storage/file/*` | session + `storageAuthorize` | [Speicher](/docs/backend/storage/) |
| `DELETE` | `/api/storage/file/*` | session + `storageAuthorize` | [Speicher](/docs/backend/storage/) |
| `GET` | `/api/storage/metadata/*` | session + `storageAuthorize` | [Speicher](/docs/backend/storage/) |
| `GET` | `/api/storage/list` | session + `storageAuthorize` | [Speicher](/docs/backend/storage/) |
| `POST` | `/api/storage/folder` | session + `storageAuthorize` | [Speicher](/docs/backend/storage/) |
| `GET` | `/api/storage/sources` | session | Die benannten Speicherquellen, die dieses Backend bedient |
| `OPTIONS` | `/api/storage/tus` | none | Fortsetzbare Uploads: die TUS-Versionen und -Erweiterungen, die dieser Server unterstützt |
| `POST` | `/api/storage/tus` | session + `storageAuthorize` | Fortsetzbare Uploads: Erstellung |
| `GET` | `/api/storage/tus/:id` | Eigentümer des Uploads | Fortsetzbare Uploads: Offset |
| `PATCH` | `/api/storage/tus/:id` | Eigentümer des Uploads | Fortsetzbare Uploads: Anhängen |
| `DELETE` | `/api/storage/tus/:id` | Eigentümer des Uploads | Fortsetzbare Uploads: Abbrechen |

Ein Deployment, für das kein Speicher konfiguriert ist, antwortet bei diesem Präfix mit
einem `501` und nennt die Variable, die es benötigt, anstatt einen 404-Fehler auszugeben,
als ob das Feature gar nicht existieren würde.

## Funktionen

| Methode | Pfad | Gate | Mehr |
|---|---|---|---|
| any | `/api/functions/<name>` | was auch immer die Funktion deklariert | [Benutzerdefinierte Funktionen](/docs/backend/custom-functions/) |

Eine Route pro Datei unter `backend/functions/`, die Pfade stammen also aus Ihrem
Projekt. `GET /api/functions` listet diese **nicht** auf: Eine Übersicht über die
benutzerdefinierten Endpunkte eines Deployments ist nicht öffentlich.

## Meta und Betrieb

| Methode | Pfad | Gate | Mehr |
|---|---|---|---|
| `GET` | `/livez` | none | Reine Liveness: Läuft dieser Prozess? Berührt nicht die Datenbank und ist daher der Probe-Pfad, den ein Container verwenden sollte – `RUNTIME_LIVENESS_PATH` |
| `GET` | `/health`, `/api/health` | none | Liveness und Readiness. Meldet jede konfigurierte Datenquelle, nicht nur die Standardquelle |
| `GET` | `/api/docs` | none (admin in der Produktion) | Das OpenAPI-3.0-Dokument |
| `GET` | `/api/swagger` | none | Swagger UI. Nur in der Entwicklung, außer wenn `REBASE_ENABLE_SWAGGER` |
| `GET` | `/api/meta/schema-version` | none | Der Schema-Hash, aus dem dieses Backend erstellt wurde, und sonst nichts |
| `GET` | `/api/meta/contract` | admin | Der vollständige Collection-Vertrag für `rebase generate-sdk --from`. `404`, wenn keine Authentifizierung konfiguriert ist |
| `GET` | `/metrics` | `REBASE_METRICS_TOKEN`, wenn gesetzt | Prometheus-Metriken, wenn `REBASE_METRICS=true` |
| `GET` | `/metrics/history` | `REBASE_METRICS_TOKEN`, wenn gesetzt | Die aufgezeichneten Zeitreihen hinter den Studio-Diagrammen. `501` auf einer Runtime ohne Backend |

WebSocket-Verbindungen erfolgen als HTTP-Upgrade auf demselben Server und nicht über
einen eigenen Pfad – siehe [Realtime](/docs/backend/realtime/).

## MCP-Schnittstelle

Wird nur gemountet, wenn `REBASE_MCP_ENABLED=true` ist, was auch
`REBASE_PUBLIC_URL` erfordert – siehe
[Konfiguration](/docs/getting-started/configuration/#mcp-surface). Standardmäßig
deaktiviert: Keine `REBASE_ROLE` aktiviert dies, da dadurch Drittanbietersoftware
Zugriff auf das Projekt gewährt wird, was eine Entscheidung ist, die ein Mensch treffen muss.

Die `.well-known`-Dokumente befinden sich am **Origin**, nicht unter `basePath`: RFC 8414
und RFC 9728 definieren diese Pfade relativ zum Origin, und ein Client ruft sie ab,
bevor er ein Token besitzt.

| Methode | Pfad | Gate | Mehr |
|---|---|---|---|
| `GET` | `/.well-known/oauth-protected-resource` | none | RFC-9728-Metadaten, die diese Ressource und ihren Autorisierungsserver benennen. Wird auch in der Form mit Pfad-Suffix bereitgestellt |
| `GET` | `/.well-known/oauth-authorization-server` | none | RFC-8414-Metadaten: die Endpunkte, Grant-Typen und PKCE-Methoden, die dieses Deployment unterstützt |
| `POST` | `/mcp` | OAuth-Bearer | Der MCP-Protokoll-Endpunkt. Agiert **als der angemeldete Benutzer**, sodass jeder Lese- und Schreibvorgang denselben RLS-Regeln unterliegt |
| `GET` | `/mcp` | OAuth-Bearer | Antwortet mit `405` und `Allow: POST, DELETE`: Dieser Server öffnet keinen server-initiierten Stream. Das Token wird zuerst überprüft, sodass ein fehlendes oder abgelaufenes Token stattdessen eine `401`-Challenge erhält |
| `DELETE` | `/mcp` | none | Antwortet mit `204`. Der Endpunkt hält keine Sitzung aufrecht, daher gibt es nichts zu beenden |
| `POST` | `/api/oauth/register` | ratenbegrenzt | Dynamische Client-Registrierung nach RFC 7591. Wird verweigert, wenn `REBASE_MCP_OPEN_REGISTRATION=false` |
| `GET` | `/api/oauth/authorize` | session | Der Zustimmungsbildschirm, zu dem ein Client weitergeleitet wird |
| `POST` | `/api/oauth/authorize/decision` | session | Die Antwort des Nutzers darauf – genehmigen oder ablehnen |
| `POST` | `/api/oauth/token` | Client Credentials + PKCE | Tauscht einen Autorisierungscode aus oder aktualisiert ein Token |
| `POST` | `/api/oauth/revoke` | Client Credentials | Token-Widerruf nach RFC 7009 |
| `GET` | `/api/oauth/grants` | session | Welche Clients dieser Benutzer autorisiert hat |
| `DELETE` | `/api/oauth/grants/:clientId` | session | Zieht eine Autorisierung zurück, sodass eine Person eine Zustimmung ohne einen Administrator rückgängig machen kann |

## Verwandte Themen

- [REST API](/docs/backend/api/) – die Datenrouten im Detail: Filter, Sortierung, Paginierung, Fehler
- [Auth-Endpunkte](/docs/backend/auth-endpoints/) – Request- und Response-Formate für die obige Authentifizierungstabelle
- [Umgebung & Konfiguration](/docs/getting-started/configuration/) – die Variablen, die bestimmen, welche davon gemountet werden
