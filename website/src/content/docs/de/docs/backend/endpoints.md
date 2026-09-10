---
sourceHash: e08fbf11c0138bb1
title: Endpunkt-Index
sidebar_label: Endpunkt-Index
description: Jede HTTP-Route, die ein Rebase-Backend bereitstellt – Daten, Auth, Storage, Admin, Meta – inklusive der jeweiligen Zugriffsbeschränkung (Gate) und der Dokumentationsseite dazu.
---

Jede vom Server bereitgestellte Route in einer Tabelle, zusammen mit den Voraussetzungen für den Zugriff.

Die Pfade gehen vom standardmäßigen `basePath` `/api` aus; `REBASE_BASE_PATH` verschiebt
alle Pfade gemeinsam. `/health`, `/livez` und `/metrics` liegen bewusst außerhalb dieses Pfads,
da ein Orchestrator `/health` abfragt und den Basispfad nicht kennen müssen sollte.
`/health` wird *zusätzlich* auch darunter bereitgestellt, sodass `/api/health` identisch
antwortet, anstatt mit einem 404-Fehler zu reagieren, genau dann, wenn jemand prüft, ob der Server
erreichbar ist.

Ein Gate-Skript – `tooling/scripts/docs-verify/check-endpoint-index.mjs` – gleicht diese
Tabelle mit den im Quellcode registrierten Routen ab, sodass keine neue Schnittstelle hinzugefügt
werden kann, ohne hier aufgeführt zu werden.

## Gates (Zugriffsbeschränkungen)

| Gate | Bedeutung |
|---|---|
| **none** | Nicht authentifiziert. Jeder, der den Host erreichen kann, kann den Endpunkt aufrufen |
| **session** | Ein angemeldeter Aufrufer: ein Access-Token oder ein für die Operation gültiger API-Schlüssel |
| **admin** | Eine Admin-Sitzung, ein Service-Schlüssel oder ein API-Schlüssel mit Admin-Berechtigung |
| **RLS** | Authentifiziert, danach entscheidet die Datenbank Zeile für Zeile – siehe [Sicherheitsregeln](/docs/collections/security-rules/) |
| **dev** | Nur außerhalb der Produktionsumgebung verfügbar |

## Daten

Wird pro Collection generiert, sodass die Pfade Ihre Slugs anstelle einer festen
Liste enthalten. `:slug` ist der `slug` einer Collection.

| Methode | Pfad | Gate | Mehr |
|---|---|---|---|
| `GET` | `/api/data/collections` | session | [REST-API](/docs/backend/api/) |
| `GET` | `/api/data/:slug` | RLS | [Abfragen](/docs/backend/api/#filtering) |
| `POST` | `/api/data/:slug` | RLS | [REST-API](/docs/backend/api/) |
| `GET` | `/api/data/:slug/count` | RLS | [Abfragen](/docs/backend/api/#filtering) |
| `GET` | `/api/data/:slug/aggregate` | RLS | [REST-API](/docs/backend/api/#rest-endpoints) |
| `GET` | `/api/data/:slug/:id` | RLS | [REST-API](/docs/backend/api/) |
| `PATCH` | `/api/data/:slug/:id` | RLS | [REST-API](/docs/backend/api/) |
| `PUT` | `/api/data/:slug/:id` | RLS | Veralteter Alias für `PATCH` – identischer partieller Schreibzugriff, antwortet mit `Deprecation: true` |
| `DELETE` | `/api/data/:slug/:id` | RLS | [REST-API](/docs/backend/api/) |
| `POST` | `/api/data/:slug/bulk` | RLS | Mehrere Zeilen einfügen, optional mit Upsert – [REST-API](/docs/backend/api/) |
| `PATCH` | `/api/data/:slug/bulk` | RLS | Mehrere Zeilen anhand der ID aktualisieren – [REST-API](/docs/backend/api/) |
| `POST` | `/api/data/:slug/bulk/delete` | RLS | Mehrere Zeilen anhand der ID löschen – [REST-API](/docs/backend/api/) |
| `POST` | `/api/data/_batch` | RLS | Collections-übergreifend in einer einzigen Transaktion schreiben – [Schreiben über REST](/docs/backend/writes/#cross-collection-batches) |
| `GET` | `/api/data/:slug/:id/history` | RLS | [Entitäts-Historie](/docs/backend/history/) |
| `POST` | `/api/data/:slug/:id/history/:historyId/revert` | RLS | [Entitäts-Historie](/docs/backend/history/) |

Zählen und Aggregation sind eigenständige Routen, die vor `/:id` registriert werden,
damit `aggregate` nicht als Entitäts-ID interpretiert wird. `?select=` und `?groupBy=` sind
deren Parameter, wobei `select` bei `/aggregate` erforderlich ist.

Volltextsuche, Vektorsuche, Einbindung von Relationen und Feldauswahl *sind* Query-Parameter
unter `GET /api/data/:slug` und keine separaten Routen – `search`,
`vector_search`, `include`, `fields`. Siehe [REST-API](/docs/backend/api/).

Ein Projekt, das keine Collections deklariert und keine introspeziert, gibt unter diesem Präfix
einheitlich `404 NO_COLLECTIONS` zurück. Siehe [Nur Backend](/docs/getting-started/headless/).

## Auth

| Methode | Pfad | Gate | Mehr |
|---|---|---|---|
| `POST` | `/api/auth/register` | none | [Authentifizierung](/docs/backend/authentication/) |
| `POST` | `/api/auth/login` | none | [Auth-Endpunkte](/docs/backend/auth-endpoints/) |
| `POST` | `/api/auth/refresh` | none (ein Refresh-Token) | [Auth-Endpunkte](/docs/backend/auth-endpoints/) |
| `POST` | `/api/auth/logout` | session | [Auth-Endpunkte](/docs/backend/auth-endpoints/) |
| `GET` | `/api/auth/me` | session | [Auth-Endpunkte](/docs/backend/auth-endpoints/) |
| `PATCH` | `/api/auth/me` | session | [Auth-Endpunkte](/docs/backend/auth-endpoints/) |
| `GET` | `/api/auth/sessions` | session | [Auth-Endpunkte](/docs/backend/auth-endpoints/) |
| `DELETE` | `/api/auth/sessions` | session | Widerruft jede andere Sitzung |
| `DELETE` | `/api/auth/sessions/:id` | session | Widerruft eine einzelne Sitzung |
| `POST` | `/api/auth/forgot-password` | none | [Authentifizierung](/docs/backend/authentication/) |
| `POST` | `/api/auth/reset-password` | none (ein Reset-Token) | [Authentifizierung](/docs/backend/authentication/) |
| `POST` | `/api/auth/change-password` | session | [Authentifizierung](/docs/backend/authentication/) |
| `POST` | `/api/auth/send-verification` | session | [Authentifizierung](/docs/backend/authentication/) |
| `GET` | `/api/auth/verify-email` | none (ein Verifizierungs-Token) | [Authentifizierung](/docs/backend/authentication/) |
| `POST` | `/api/auth/magic-link` | none | [Authentifizierung](/docs/backend/authentication/) |
| `POST` | `/api/auth/magic-link/verify` | none (ein Link-Token) | [Authentifizierung](/docs/backend/authentication/) |
| `POST` | `/api/auth/otp` | none | Einmal-Codes per E-Mail |
| `POST` | `/api/auth/otp/verify` | none (ein Code) | Einmal-Codes per E-Mail |
| `POST` | `/api/auth/anonymous` | none | Gastsitzungen. Deaktiviert, außer `ALLOW_ANONYMOUS` ist gesetzt |
| `POST` | `/api/auth/anonymous/link` | session (ein Gast) | Wandelt einen Gast in ein reguläres Konto um |
| `POST` | `/api/auth/find-user` | session | Deaktiviert, außer `AUTH_ALLOW_USER_LOOKUP` ist gesetzt – stellt eine Angriffsfläche für Enumeration dar |
| `POST` | `/api/auth/:provider` | none | Einer pro konfiguriertem OAuth/OIDC-Provider |
| `POST` | `/api/auth/link/:provider` | session | Verknüpft einen Provider mit dem angemeldeten Konto |
| `POST` | `/api/auth/mfa/enroll` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/verify` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `GET` | `/api/auth/mfa/factors` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `DELETE` | `/api/auth/mfa/unenroll` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/challenge` | none (ein laufender Login) | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/challenge/verify` | none (eine Challenge-ID) | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `GET` | `/.well-known/jwks.json` | none | Das öffentliche JWKS, wenn [asymmetrische Signierung](/docs/backend/auth-endpoints/#asymmetric-tokens-and-jwks) konfiguriert ist |

## Admin

Alles unter `/api/admin` erfordert eine Admin-Sitzung, einen Service-Schlüssel oder einen
API-Schlüssel mit Admin-Berechtigung. Nicht nur eine einzelne Berechtigung: Ein auf eine Collection
beschränkter Schlüssel hat auf keinen dieser Endpunkte Zugriff.

| Methode | Pfad | Gate | Mehr |
|---|---|---|---|
| `POST` | `/api/admin/bootstrap` | none, und nur solange kein Admin existiert | In Produktion verweigert – siehe [Bootstrap des ersten Benutzers](/docs/backend/authentication/#first-user-bootstrap) |
| `GET` | `/api/admin/users` | admin | Benutzerverwaltung |
| `POST` | `/api/admin/users` | admin | Benutzerverwaltung |
| `GET` | `/api/admin/users/:uid` | admin | Benutzerverwaltung |
| `PUT` | `/api/admin/users/:uid` | admin | Benutzerverwaltung |
| `DELETE` | `/api/admin/users/:uid` | admin | Benutzerverwaltung |
| `POST` | `/api/admin/users/:uid/reset-password` | admin | Erstellt ein temporäres Passwort |
| `GET` | `/api/admin/roles` | admin | Die vom Projekt deklarierten Rollen |
| `GET` | `/api/admin/api-keys` | admin | [API-Schlüssel](/docs/backend/api-keys/) |
| `POST` | `/api/admin/api-keys` | admin | Der Klartext-Schlüssel wird nur einmalig bei der Erstellung zurückgegeben |
| `GET` | `/api/admin/api-keys/:id` | admin | [API-Schlüssel](/docs/backend/api-keys/) |
| `PUT` | `/api/admin/api-keys/:id` | admin | [API-Schlüssel](/docs/backend/api-keys/) |
| `DELETE` | `/api/admin/api-keys/:id` | admin | [API-Schlüssel](/docs/backend/api-keys/) |
| `GET` | `/api/admin/cron` | admin | [Cron-Jobs](/docs/backend/cron-jobs/) |
| `GET` | `/api/admin/cron/:id` | admin | [Cron-Jobs](/docs/backend/cron-jobs/) |
| `PUT` | `/api/admin/cron/:id` | admin | Einen Job aktivieren oder deaktivieren |
| `GET` | `/api/admin/cron/:id/logs` | admin | [Cron-Jobs](/docs/backend/cron-jobs/) |
| `POST` | `/api/admin/cron/:id/trigger` | admin | Einen Job jetzt ausführen |
| `GET` | `/api/admin/backups` | admin | Backup-Übersicht |
| `GET` | `/api/admin/backups/download` | admin | Streamt ein Backup |
| `GET` | `/api/admin/logs` | admin | Der Puffer der jüngsten Logs |
| `GET` | `/api/admin/logs/latest` | admin | Die neuesten Log-Einträge |
| `GET` | `/api/admin/logs/stream` | admin | Server-Sent Events (SSE) |
| `GET` | `/api/admin/rls-audit` | admin | Das jüngste Ergebnis des geplanten Audits |
| `GET` | `/api/admin/schema/status` | admin | [Live-Schema-Bearbeitung](/docs/backend/live-schema-editing/) |
| `POST` | `/api/admin/schema/plan` | admin | Plant eine Änderung; wendet sie niemals an |
| `POST` | `/api/admin/schema/apply` | admin | Deaktiviert, außer `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` ist gesetzt |
| `GET` | `/api/admin/schema-editor/status` | admin | Ob der Editor verfügbar ist, und der Grund, falls nicht |
| `POST` | `/api/admin/schema-editor/collection/save` | admin | [Studio](/docs/studio/) – schreibt den Collection-Quellcode neu |
| `POST` | `/api/admin/schema-editor/collection/delete` | admin | [Studio](/docs/studio/) |
| `POST` | `/api/admin/schema-editor/property/save` | admin | [Studio](/docs/studio/) |
| `POST` | `/api/admin/schema-editor/property/delete` | admin | [Studio](/docs/studio/) |
| `GET` | `/api/admin/dev/emails` | dev | E-Mails, die vom Entwicklungs-Transport abgefangen statt gesendet wurden |

`/api/admin/cron`, `/api/admin/logs` und `/api/admin/schema-editor` werden
auch unter ihren Pfaden aus Versionen vor 0.17 ohne das `/admin`-Segment bereitgestellt.
Diese Aliase sind für Projekte gedacht, die noch nicht migriert wurden; neuer Code sollte
gegen den kanonischen Pfad geschrieben werden.

## Storage

| Methode | Pfad | Gate | Mehr |
|---|---|---|---|
| `POST` | `/api/storage/upload` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `GET` | `/api/storage/file/*` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `DELETE` | `/api/storage/file/*` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `GET` | `/api/storage/metadata/*` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `GET` | `/api/storage/list` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `POST` | `/api/storage/folder` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `GET` | `/api/storage/sources` | session | Die benannten Storage-Quellen, die dieses Backend bereitstellt |
| `POST` | `/api/storage/tus` | session + `storageAuthorize` | Fortsetzbare Uploads: Erstellung |
| `GET` | `/api/storage/tus/:id` | Eigentümer des Uploads | Fortsetzbare Uploads: Offset |
| `PATCH` | `/api/storage/tus/:id` | Eigentümer des Uploads | Fortsetzbare Uploads: Anhängen |
| `DELETE` | `/api/storage/tus/:id` | Eigentümer des Uploads | Fortsetzbare Uploads: Abbrechen |

Ein Deployment ohne konfigurierten Speicher beantwortet dieses Präfix mit einem `501`-Status,
der die benötigte Variable nennt, anstatt mit 404 zu reagieren, als ob die Funktion gar nicht existieren würde.

## Funktionen

| Methode | Pfad | Gate | Mehr |
|---|---|---|---|
| beliebig | `/api/functions/<name>` | wie von der Funktion deklariert | [Benutzerdefinierte Funktionen](/docs/backend/custom-functions/) |

Eine Route pro Datei unter `backend/functions/`, sodass die Pfade aus Ihrem
Projekt stammen. `GET /api/functions` listet diese **nicht** auf: Eine Übersicht
der benutzerdefinierten Endpunkte eines Deployments ist nicht öffentlich.

## Meta und Betrieb

| Methode | Pfad | Gate | Mehr |
|---|---|---|---|
| `GET` | `/livez` | none | Reine Liveness-Prüfung: Läuft dieser Prozess? Berührt die Datenbank nicht, weshalb dies der Probe-Pfad ist, den ein Container verwenden sollte – `RUNTIME_LIVENESS_PATH` |
| `GET` | `/health`, `/api/health` | none | Liveness und Readiness. Meldet jede konfigurierte Datenquelle, nicht nur die Standardquelle |
| `GET` | `/api/docs` | none (admin in Produktion) | Das OpenAPI-3.0-Dokument |
| `GET` | `/api/swagger` | none | Swagger UI. Nur in der Entwicklung, außer `REBASE_ENABLE_SWAGGER` ist gesetzt |
| `GET` | `/api/meta/schema-version` | none | Der Schema-Hash, aus dem dieses Backend erstellt wurde, und sonst nichts |
| `GET` | `/api/meta/contract` | admin | Der vollständige Collection-Vertrag für `rebase generate-sdk --from`. `404`, wenn keine Authentifizierung konfiguriert ist |
| `GET` | `/metrics` | `REBASE_METRICS_TOKEN`, falls gesetzt | Prometheus-Metriken, wenn `REBASE_METRICS=true` |
| `GET` | `/metrics/history` | `REBASE_METRICS_TOKEN`, falls gesetzt | Die aufgezeichneten Zeitreihen hinter den Studio-Diagrammen. `501` auf einer Laufzeitumgebung ohne Backend |

WebSocket-Verbindungen erfolgen als HTTP-Upgrade auf demselben Server und nicht über
einen eigenen Pfad – siehe [Echtzeit](/docs/backend/realtime/).

## Verwandte Themen

- [REST-API](/docs/backend/api/) – Die Datenrouten im Detail: Filter, Sortierung, Paginierung, Fehler
- [Auth-Endpunkte](/docs/backend/auth-endpoints/) – Request- und Response-Formate für die obige Auth-Tabelle
- [Umgebung & Konfiguration](/docs/getting-started/configuration/) – Die Variablen, die steuern, welche dieser Endpunkte bereitgestellt werden

---
