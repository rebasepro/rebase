---
slug: de/docs/changelog
title: Änderungsprotokoll
---
## [3.1.0] - 2026-02-20

- **KI-Integration**:
  - Einführung von KI-gesteuerten Funktionen zur Sammlungserstellung und Datenanreicherung.
  - Neues KI-Symbol hinzugefügt und KI-Funktionen in den Sammlungseditor integriert.
- **Kanban-Ansicht**:
  - Volle Unterstützung für Kanban-Boards mit anpassbaren Spalten.
  - Implementierung von Drag-and-Drop-Spaltenneuanordnung und optimistischen Updates.
  - Kanban-Konfigurationsoptionen hinzugefügt, einschließlich Spaltenfarben.

- **Sammlungsfunktionen**:
  - `display`-Ansicht zum Sammlungseditor hinzugefügt.
  - Drag-and-Drop-Spaltenneuanordnung in Datentabellen mit Persistenz implementiert.
  - Sammlungsableitung mit optionalen Filter- und Sortierparametern verbessert.
- **UI/UX-Verbesserungen**:
  - Umschalter für den Ansichtsmodus (Liste, Raster, Tabelle) für bessere Datenvisualisierungssteuerung hinzugefügt.
  - Implementierung von zusammenklappbaren Schubladen-Navigationsgruppen.
  - Unterstützung für bildschirmfüllendes blockierendes Modal für Cookie-Banner hinzugefügt.
  - Harmonisierung der Schaltflächenfarben und Neugestaltung der Tab-Komponenten.
  - `AutorenewIcon` durch `FindInPageIcon` für bessere Klarheit ersetzt.
  - Fließendes Scrollverhalten aktiviert.
- **Speicher**:
  - Unterstützung für vollständig qualifizierte Speicher-URLs hinzugefügt.
  - Optionen `includeBucketUrl` und `imageResize` für Dateiuploads hinzugefügt.
- **Benutzerverwaltung**:
  - Methode `updateUserFields` für direkte Firestore-Updates hinzugefügt.
- **Fehlerbehebungen**:
  - Firebase-Abhängigkeit auf v12.7.0 aktualisiert.
  - Sicherheitsupdates für Next.js (CVE-2025-66478).
  - Validierungsfehler bei Datums-Autowerte behoben.
  - Probleme mit Objektzusammenführung und lokalen Änderungen behoben.
  - Textsuche-Integration mit Typesense verbessert.
  - Layout und Styling in FormEnhanceAction behoben.

## [3.0.0] - 2025-12-01

- **Editor-Verbesserungen**:
  - Verbessertes Verhalten der Escape-Taste im Editor-Slash-Befehl
  - Verbessertes Verhalten des Vorschlagsmenüs
  - Verbesserte Handhabung von Pfadvorschlägen in Sammlungseditor-Komponenten
  - Refaktorierte Vorschläge für Root-Sammlungen
- **UI/UX-Verbesserungen**:
  - Funktion `prettifyIdentifier` hinzugefügt, um Bezeichner zu formatieren und die Lesbarkeit zu verbessern
  - Schlüsselformatierung wurde auf `prettifyIdentifier` umgestellt
  - Kleine UI-Anpassungen in der gesamten Anwendung
  - Kleine visuelle Aktualisierung der Dialoge
  - `font-mono` aus der Kartenvorschau entfernt
- **Sammlungseditor**:
  - Inline-Bearbeitung von Eigenschaften im Sammlungseditor hinzugefügt
  - Korrekturen für das Speichern von Sammlungseditor-Eigenschaften
  - Konsistentes Verhalten auf `editable`-Eigenschaften in Sammlungen und Eigenschaften angewendet
- **API-Updates**:
  - API-Server-URLs zur Verwendung neuer Endpunkte aktualisiert
- **Abhängigkeiten**:
  - Viele Abhängigkeitsupdates
  - PostCSS-Konfiguration mit Tailwind CSS und Autoprefixer hinzugefügt
- **Benutzerverwaltung**:
  - Benutzerverwaltung refaktorisiert, um `saas_uid` und `firebase_uid` konsistent zu verwenden
  - Schaltflächenstile in EnableAuthView für Konsistenz aktualisiert
  - Benutzerformulare refaktorisiert, um Layout und Zustandsverwaltung zu verbessern
- **Projektkonfiguration**:
  - Projektkonfigurationsbehandlung aktualisiert, um den Teststatus zu berücksichtigen
  - Initialer Ladebildschirm hinzugefügt
- **Fehlerbehebungen**:
  - Home-DND-Probleme behoben
  - Vorschau lokaler Änderungen in Zeilenaktionen behoben
  - Diff lokaler Änderungen behoben
  - Fehler behoben, bei dem Datumsfelder beim Tippen und beim Auswählen von Nullwerten in Datumsfiltern den Fokus verloren
  - UI-Glitch bei Auswahl-Enum-Filtern behoben
  - Vollbild-Entitätsansichten mit kodierten Zeichen in der ID behoben
- **Speicher & Bilder**:
  - Neue Funktionen zur Bildgrößenänderung hinzugefügt
  - Interne Komprimierungsbibliothek durch compressor.js ersetzt
  - Verbesserte Fehlermeldung, wenn Firebase Storage wahrscheinlich nicht aktiviert ist
- **Datenanreicherung**:
  - Kosmetische Anpassungen der Datenanreicherung
- **Formularbehandlung**:
  - Anzeige von Pre-Save-Fehlern in der Tabellenansicht
  - Verbesserter Fehlerfokus beim Speichern von Formularen mit Fehlern und Feedback
  - Debouncing bei Wertänderungen in Formex
  - `initialTouched` zum Formex-Controller hinzugefügt
  - Die Art und Weise geändert, wie "dirty values" im lokalen Speicher persistiert werden
- **Lokale Änderungen**:
  - `enableLocalChangesBackup` zu Sammlungen hinzugefügt, sodass Benutzer die lokale Kopie ungespeicherter Entitäten im Browser deaktivieren können
  - Lokale Änderungen so geändert, dass sie manuell angewendet werden können
  - Löschen der Anzeige für ungespeicherte Änderungen, wenn die Funktion in Sammlungen nicht aktiviert ist
- **Entitätshistorie**:
  - Ein sauberer Typ zum Entitätshistorie-Plugin hinzugefügt

## [3.0.0-rc.4] - 2025-11-25

- Benutzerformulare refaktorisiert, um Layout und Zustandsverwaltung zu verbessern
- Projektkonfigurationsbehandlung aktualisiert, um den Teststatus zu berücksichtigen
- Viele Abhängigkeitsupdates

## [3.0.0-rc.3] - 2025-11-07

- Anzeige von Pre-Save-Fehlern in der Tabellenansicht
- Home-DND-Probleme behoben
- Neue Funktionen zur Bildgrößenänderung hinzugefügt und interne Komprimierungsbibliothek durch compressor.js ersetzt
- Verbesserte Fehlermeldung, wenn Firebase Storage wahrscheinlich nicht aktiviert ist
- Kleine visuelle Aktualisierung der Dialoge
- Inline-Bearbeitung von Eigenschaften im Sammlungseditor hinzugefügt
- Korrekturen für das Speichern von Sammlungseditor-Eigenschaften und die Anwendung konsistenten Verhaltens auf `editable`-Eigenschaften in Sammlungen und Eigenschaften
- UI-Glitch bei Auswahl-Enum-Filtern behoben
- Fehler behoben, bei dem Datumsfelder beim Tippen und beim Auswählen von Nullwerten in Datumsfiltern den Fokus verloren
- Vorschau lokaler Änderungen in Zeilenaktionen behoben
- `font-mono` aus der Kartenvorschau entfernt
- Diff lokaler Änderungen behoben
- Ein sauberer Typ zum Entitätshistorie-Plugin hinzugefügt
- Lokale Änderungen so geändert, dass sie manuell angewendet werden können
- `enableLocalChangesBackup` zu Sammlungen hinzugefügt, sodass Benutzer die lokale Kopie ungespeicherter Entitäten im Browser deaktivieren können
- Debouncing bei Wertänderungen in Formex und `initialTouched` zum Formex-Controller hinzugefügt
- Die Art und Weise geändert, wie "dirty values" im lokalen Speicher persistiert werden
- Verbesserter Fehlerfokus beim Speichern von Formularen mit Fehlern und Feedback

## [3.0.0-rc.2] - 2025-10-16

- **Benutzerverwaltung in Rebase Core**: Benutzerverwaltungsfunktionen direkt in Rebase Core integriert, wodurch die selbstgehosteten Optionen erweitert werden.
- **Benutzerfelder als String-Werte**: Volle Unterstützung für Benutzerfelder als String-Werte implementiert, was die Flexibilität bei der Benutzerdatenverarbeitung verbessert.
- **TipTap V3 Migration**: Markdown-Editor auf TipTap V3 migriert für verbesserte Leistung und Funktionen.
- **Tailwind 4 Retrofit**: Mehrere Anpassungen zur Unterstützung des Tailwind 4 Retrofits, wodurch die Styling-Infrastruktur modernisiert wird.
- **Login-Verbesserungen**:
  - Cloud-E-Mail-Login implementiert
  - E-Mail- und Passwort-Authentifizierung zu Cloud SaaS hinzugefügt
  - Login-Analyseereignisse hinzugefügt
  - Demo-Login-Layout behoben
- **Website-Updates**:
  - Astro-Landingpage hinzugefügt (WIP)
  - Website-Migrationsupdates
  - Bilder migriert
  - Inline-Website-CSS
  - Webdesign-Updates
  - Anpassungen der Sicherheitsseite
- **Startseiten-Verbesserungen**:
  - Speicherung des zusammengeklappten Zustands der Startseite im lokalen Speicher
  - Versuch, die Gruppenumbenennung auf der Startseite zu beheben
  - Einige Drag-and-Drop-Änderungen rückgängig gemacht
- **Fehlerbehebungen**:
  - Editor SSR (Server-Side Rendering) Unterstützung behoben
  - Import von Referenzen mit sekundären Datenbanken behoben
  - Unterstützung für sekundäre Datenbankreferenzen behoben
  - SaaS-Berechtigungsansicht behoben
  - Filtereingabe für Zahlen behoben, wenn der Wert 0 ist
  - Besseres Fehlermanagement für Doctor (Diagnosetool)
- **UI/UX**:
  - Erzwingen der Schaltfläche für die übergeordnete Sammlung entfernt
- **Abhängigkeiten**: Vorlagen-Abhängigkeiten aktualisiert
- **Dokumentation**:
  - Dokumentation für benutzerdefinierte Symbole in Sammlungen verbessert
  - Authentifizierungsdokumentation hinzugefügt
  - Abschnitt mit Sicherheitsinformationen hinzugefügt

## [3.0.0-rc.1] - 2025-09-25

- **Firebase 12 Upgrade**: Auf Firebase 12 aktualisiert für verbesserte Leistung und Funktionen.
- **Historie-Plugin-Verbesserungen**:
  - Verfolgung vorheriger Werte zum Historie-Plugin hinzugefügt
  - Programmatische Erstellung von Historie-Einträgen hinzugefügt
- **Referenz-Eigenschaften-Verbesserungen**:
  - Referenz als String-Feld-Konfiguration hinzugefügt
  - Zusätzliche Spalten, die in der Referenzauswahl nicht angezeigt wurden, behoben
  - Fehler behoben, bei dem Referenz-Eigenschaften mit fehlendem Pfad, aber mit einem benutzerdefinierten Feld nicht korrekt gerendert wurden
- **UI-Updates**:
  - Standard-SaaS-Symbol aktualisiert
  - Schaltflächenfarben aktualisiert
  - Startseitenbereiche zusammengeklappt
  - Kleine Web-Updates und Algolia DocSearch entfernt
- **Fehlerbehebungen**:
  - Problem mit Google Cloud-Login behoben
  - Fehler beim Zurückkehren aus der Abonnementansicht behoben
  - Speichern des letzten Projekts behoben
  - TipTap-Importe behoben
  - Korrektes Übergeben von gclid an die App behoben
  - Website CLS (Cumulative Layout Shift) behoben
- **CLI**: npm-Anweisungen zu CLI hinzugefügt
- **Abhäng
