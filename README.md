# Car Finder – Stufe 1 (Web-App)

Schlanke Web-App: Parkposition per Knopfdruck speichern, auf der Karte anzeigen und mit Google Maps zu Fuß zurück zum Auto navigieren.

## Funktionen
- **Parken:** großer Knopf „Jetzt parken“. Die App wartet bis zu 12 s auf ein GPS-Signal mit höchstens ± 20 m und speichert dann.
- **Karte:** Karte über den ganzen Bildschirm mit Auto, eigener Position (live) und Luftlinie. Unten Parkdauer, Entfernung, geschätzter Fußweg und GPS-Genauigkeit.
- **Zu Fuß zum Auto:** öffnet Google Maps direkt im Fußgängermodus.
- **Hell / Dunkel / Automatisch:** Umschalter oben rechts. „Automatisch“ folgt der Einstellung des Handys. Die Karte wechselt mit.
- **Kurzbefehl:** App-Symbol lange drücken → „Jetzt parken“ (speichert sofort).
- **Offline:** App-Dateien werden auf dem Handy zwischengespeichert. Die Kartenkacheln brauchen Internet, die Parkposition und der Route-Knopf gehen aber auch ohne Karte.
- **Datenschutz:** Die Position wird nur lokal im Browser des Handys gespeichert (localStorage).
- **Dauerhafter Speicher:** Beim Parken bittet die App Chrome, ihre Daten nicht automatisch aufzuräumen (`navigator.storage.persist()`). Die Position bleibt also auch bei vollem Handyspeicher, beim Schließen der App und bei einem Neustart erhalten.

## Dateien
Alle Dateien liegen **ohne Unterordner** nebeneinander, damit sie sich einfach bei GitHub hochladen lassen:
```
index.html              App (HTML, CSS, JS)
manifest.webmanifest    PWA-Beschreibung (Name, Icons, Kurzbefehl)
sw.js                   Service Worker (Offline-Cache)
icon-192.png, icon-512.png, icon-maskable-512.png   App-Icons
leaflet.js, leaflet.css Kartenbibliothek Leaflet 1.9.4
```

## Veröffentlichen über GitHub Pages
1. Neues Repository anlegen, z. B. `carfinder`.
2. **Add file → Upload files**, alle 9 Dateien aus diesem Ordner markieren und hochladen → **Commit changes**.
3. Im Repository: **Settings → Pages → Source: „Deploy from a branch“ → Branch `main` / `/ (root)` → Save**.
4. Nach ca. 1 Minute läuft die App unter `https://<dein-github-name>.github.io/carfinder/`.

> Hinweis: GitHub Pages ist bei kostenlosen Konten nur für **öffentliche** Repositories verfügbar. Die Parkpositionen landen trotzdem nie im Repository, sie bleiben auf dem Handy.

## Auf dem Android-Handy installieren
1. Die Adresse in **Chrome** öffnen.
2. Standortzugriff erlauben.
3. Menü ⋮ → **„Zum Startbildschirm hinzufügen“ / „App installieren“**.
4. Danach startet Car Finder wie eine normale App, ohne Browserleiste.

## Hinweise
- Der Standort funktioniert nur über **HTTPS** (bei GitHub Pages automatisch).
- Kartenstil: CARTO Voyager (hell) bzw. Dark Matter (dunkel) auf Basis von OpenStreetMap, für private Nutzung kostenlos.
- Fußweg-Schätzung: Luftlinie × 1,3 bei ca. 4,8 km/h.

## Nächste Stufe (geplant)
Stufe 2: dieselbe App mit Capacitor als Android-App verpacken, dazu die automatische Ausstiegs-Erkennung (Activity Recognition, Bluetooth optional).
