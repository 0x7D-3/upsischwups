# Schultag PWA — Testversion 0.4

„Alles, was du während eines Schultags brauchst – selbst wenn das WLAN nicht funktioniert.“

Schultag ist ein kostenloser Local-First-Prototyp für iPad und iPhone. Profile, Kontakte, Nachrichten, Aufgaben, Notizen, kryptografische Schlüssel und wartende Pakete liegen pro Konto getrennt in IndexedDB. Nach dem ersten vollständigen Laden hält der Service Worker alle App-Dateien für den Offline-Start vor.

## Was in diesem Test funktioniert

- mehrere lokale Konten mit eigener dauerhafter Datenablage und persönlicher, aus den öffentlichen Schlüsseln abgeleiteter ID
- einmalige Profileinrichtung und lokale Anmeldung mit einer 4- bis 8-stelligen PIN
- Kontaktkarten, die nur einmal per AirDrop, Kopieren oder einem anderen Kanal ausgetauscht werden müssen
- dauerhaft gespeicherte Kontakte mit frei bearbeitbaren richtigen Anzeigenamen
- Ende-zu-Ende verschlüsselte und signierte Textnachrichten
- lokale Warteschlange mit den Zuständen `ausstehend`, `unterwegs` und `angekommen`
- signierte Zustellbestätigungen
- verschlüsseltes Store-and-Forward: ein verbundenes Gerät kann ein unlesbares Paket begrenzt zwischenspeichern und später weiterreichen
- automatischer Austausch aller fehlenden Pakete und Bestätigungen nach einer WebRTC-Verbindung
- Hausaufgaben mit Fach und Abgabedatum erstellen, abhaken und verschlüsselt teilen
- vollständige NRW-Oberstufen-Fächerliste sowie eigene Schulfächer
- getrennte Fachnotizen; von jeder Aufgabe kann direkt der passende Notizbereich geöffnet werden
- passwortverschlüsselte Konto-Backups einschließlich ID und privater Schlüssel
- installierbare PWA mit vollständigem Offline-App-Cache
- kostenloser GitHub-Pages-Workflow

## Wichtige Grenze der PWA

Safari-Web-Apps können andere Apple-Geräte nicht selbstständig über Bluetooth, Apple Peer-to-Peer-WLAN oder Wi-Fi Aware suchen. Eine PWA darf außerdem nicht dauerhaft im Hintergrund Verbindungen halten. Deshalb gilt für diesen Prototyp:

- Beide Geräte müssen die App geöffnet haben.
- Sie müssen sich im selben lokalen WLAN oder persönlichen Hotspot befinden. Der Hotspot benötigt für den anschließenden Datenaustausch keinen Internetzugang.
- Für jede neue Sitzung wird ein WebRTC-Start- und Antwortcode ausgetauscht.
- Kontaktkarte und persönliche ID bleiben dagegen dauerhaft gespeichert und müssen nur einmal ausgetauscht werden.
- Store-and-Forward passiert beim späteren manuellen Verbinden; es ist kein automatisch funktes Mesh.

Für automatische Gerätesuche und echte Direktverbindungen ohne vorhandenes Netz ist später eine native, signierte Swift-App nötig.

## Test mit iPhone und iPad

1. Öffne die veröffentlichte Seite auf beiden Geräten einmal vollständig in Safari.
2. Tippe auf `Teilen → Zum Home-Bildschirm` und starte danach die installierte App.
3. Richte auf jedem Gerät einmalig ein Profil mit vollständigem Namen, Stufe, Schule und lokaler PIN ein.
4. Teile die jeweilige Kontaktkarte per AirDrop und füge sie auf dem anderen Gerät ein. Das ist nur einmal nötig.
5. Verbinde beide Geräte mit demselben WLAN oder persönlichen Hotspot.
6. Öffne auf beiden Geräten `Nearby`. Gerät A erstellt den Start-Code, Gerät B erzeugt daraus den Antwort-Code, Gerät A übernimmt die Antwort.
7. Sende im Chat eine Nachricht. Ohne aktive Verbindung bleibt sie verschlüsselt in der Warteschlange; nach der nächsten Kopplung wird sie automatisch übertragen und bestätigt.

Um Store-and-Forward zu testen, werden drei getrennte Konten auf drei Browser-Installationen beziehungsweise Geräten benötigt: A erstellt eine Nachricht an C, A verbindet sich zunächst mit B und später B mit C. B sieht nur das verschlüsselte Paket. Die Bestätigung kann auf demselben Weg zu A zurückwandern.

## Datensicherheit im Prototyp

Nachrichten und geteilte Aufgaben werden vor der Weitergabe mit einem einmaligen P-256-Schlüsselpaar und AES-GCM verschlüsselt und vom Absender mit ECDSA signiert. Relaisgeräte erhalten keinen Klartext. Die lokale PIN sperrt die Benutzeroberfläche, verschlüsselt aber nicht die gesamte Browserdatenbank. Deshalb schützt das Gerätepasswort weiterhin den lokalen Zugriff.

Safari kann Website-Daten unter besonderen Umständen entfernen. Unter `Profil` kann dauerhafter Speicher angefragt werden; zusätzlich sollten wichtige Konten regelmäßig als passwortverschlüsseltes Backup exportiert werden. Ohne dieses Backup ist eine gelöschte persönliche ID nicht wiederherstellbar.

## Lokal starten

Voraussetzungen: Node.js 22.13 oder neuer und pnpm 11.

```bash
pnpm install
pnpm dev
```

Die Vorschau läuft anschließend normalerweise unter `http://localhost:3000`.

## Prüfen und für GitHub Pages bauen

```bash
pnpm exec tsc --noEmit
pnpm build
```

Die fertige statische Website liegt in `dist/client`. Beim Build wird der Service Worker aus der vollständigen Asset-Liste erzeugt. Der Workflow `.github/workflows/deploy-pages.yml` baut und veröffentlicht bei jedem Push auf `main`.

## Nächste sinnvolle Schritte

- QR-Codes für Kontaktkarten und WebRTC-Sitzungscodes
- Ablaufanzeige und manuelles Löschen einzelner Relaispakete
- Konfliktauflösung für gemeinsam bearbeitete Aufgaben
- echte native SwiftUI-Test-App mit Network Framework und automatischer Nearby-Erkennung
