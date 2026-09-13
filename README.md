# Schultag PWA — Testversion 0.1

„Alles, was du während eines Schultags brauchst – selbst wenn das WLAN nicht funktioniert.“

Diese erste Version ist eine installierbare Website für iPad und iPhone. Sie speichert Chat, Aufgaben, Notizen und das lokale Profil direkt im Browser. Bereits geladene App-Dateien werden über einen Service Worker offline verfügbar gehalten.

## Was in diesem Test funktioniert

- iPad-optimierte Oberfläche mit Heute, Chat, Nearby, Aufgaben und Profil
- lokaler Chatverlauf im Browser-Speicher
- eindeutige Nachrichten-IDs
- Zustände `ausstehend`, `gesendet` und `angekommen`
- automatische Übertragung wartender Nachrichten nach einer Direktverbindung
- lokale Aufgaben und Notizen
- direktes Teilen einer Aufgabe bei aktiver Verbindung
- installierbare PWA mit Manifest und Offline-Cache
- kostenloser GitHub-Pages-Workflow

## Grenze der Web-Version

Safari-Web-Apps dürfen keine Apple-Geräte automatisch über Bluetooth, Apple Peer-to-Peer-WLAN oder Wi-Fi Aware suchen. Der Test verwendet deshalb einen WebRTC-Datenkanal und manuelle Kopplungscodes. Beide Geräte müssen im selben lokalen WLAN oder persönlichen Hotspot sein. Für automatische Suche ohne vorhandenes Netz ist später eine native Swift-App erforderlich.

WebRTC verschlüsselt den Transport. Diese Testversion hat aber noch keine geprüften Schulidentitäten, keine App-eigene Ende-zu-Ende-Schlüsselverwaltung und keine verschlüsselte lokale Datenbank. Deshalb nur Testdaten verwenden.

## Direktverbindung testen

1. Die PWA auf beiden Geräten einmal von der GitHub-Pages-Adresse laden.
2. Beide Geräte mit demselben lokalen WLAN oder persönlichen Hotspot verbinden. Internetzugang ist für die eigentliche Verbindung nicht nötig.
3. Auf beiden Geräten `Nearby` öffnen.
4. Gerät A wählt `Dieses Gerät startet` und teilt den Start-Code per AirDrop.
5. Gerät B wählt `Dieses Gerät tritt bei`, fügt den Start-Code ein und erzeugt eine Antwort.
6. Gerät B teilt den Antwort-Code zurück. Gerät A fügt ihn ein und schließt die Verbindung ab.
7. Unter `Chat` eine Nachricht senden. Ohne Verbindung bleibt sie lokal ausstehend; mit Verbindung wird sie direkt übertragen und bestätigt.

## Lokal starten

Voraussetzungen: Node.js 24 und pnpm 11.

```bash
pnpm install
pnpm dev
```

Die Vorschau läuft anschließend normalerweise unter `http://localhost:3000`.

## Für GitHub Pages bauen

```bash
pnpm build
```

Die fertige statische Website liegt in `dist/client`. Der enthaltene Workflow `.github/workflows/deploy-pages.yml` baut und veröffentlicht bei jedem Push auf `main`.

In GitHub einmal unter `Settings → Pages → Source` den Eintrag `GitHub Actions` auswählen.

## Auf den Home-Bildschirm

In Safari die veröffentlichte Seite öffnen, `Teilen` antippen und `Zum Home-Bildschirm` wählen.

## Sinnvoller nächster Schritt

Nach dem Web-Test sollte eine kleine native SwiftUI-Version folgen. Für automatische Gerätesuche und Verbindungen ohne Access Point kommen auf aktuellen Apple-Systemen Network Framework mit Peer-to-Peer-WLAN beziehungsweise Wi-Fi Aware infrage. Dafür werden ein Mac mit Xcode, physische Testgeräte und App-Signierung benötigt.
