"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

export type AppLanguage = "de" | "en";

const STORAGE_KEY = "onvifscanner.lang";

const EXACT_DE_TO_EN: Record<string, string> = {
  // Navigation & Footer
  "Monitore": "Monitors",
  "Scanner": "Scanner",
  "Wiedergabe": "Playback",
  "Speicher": "Storage",
  "Aufnahmen": "Recordings",
  "Lokale Kameraüberwachung": "Local Camera Surveillance",
  "Lokale Kameraüberwachung, Erkennung und NVR-Aufzeichnung.": "Local camera surveillance, discovery, and NVR recording.",
  "Live-Kameraansicht, Raster & Aufnahmesteuerung": "Live camera view, grid & recording control",
  "Netzwerk nach ONVIF & RTSP Kameras durchsuchen": "Scan network for ONVIF & RTSP cameras",
  "Video-Archiv durchsuchen, Player & Downloads": "Browse video archive, player & downloads",
  "Festplatten, NAS, Speicherziele & Quotas": "Drives, NAS, storage targets & quotas",
  "Zur Startseite / Monitore": "Go to Home / Monitors",
  "Einstellungen": "Settings",
  "Mobile Schnellnavigation": "Mobile quick navigation",

  // ConnectionWatcher & VersionStatus
  "Verbindung verloren": "Connection lost",
  "Der Server (ONVIFscanner) wird gerade neu gestartet oder ist offline.": "The server (ONVIFscanner) is restarting or currently offline.",
  "Bitte habe einen Moment Geduld, die Verbindung wird automatisch wiederhergestellt, sobald das System erreichbar ist.": "Please wait a moment, the connection will be restored automatically as soon as the system is reachable.",
  "Update verfügbar": "Update available",
  "prüft…": "checking…",
  "Prüfung nicht möglich": "Check unavailable",
  "aktuell": "up to date",
  "Klicken für Update-Details": "Click for update details",
  "1-Klick Update starten": "Start 1-Click Update",
  "Oder manuell im Terminal:": "Or manually in terminal:",
  "✓ Kopiert!": "✓ Copied!",
  "📋 Kopieren": "📋 Copy",
  "Versionsprüfung momentan nicht möglich.": "Version check currently unavailable.",
  "Die App läuft normal weiter. Beim nächsten Seitenaufruf wird automatisch erneut geprüft.": "The app continues to run normally. It will check again automatically on next page load.",
  "Installation ist aktuell.": "Installation is up to date.",
  "Geprüft gegen GitHub.": "Checked against GitHub.",
  "Geprüft gegen GitHub. Aktualisierung läuft im Hintergrund…": "Checked against GitHub. Background check running…",
  "Update läuft": "Update in progress",
  "Diese Seite geöffnet lassen. Sie lädt nach dem Neustart automatisch neu.": "Keep this page open. It will reload automatically after restart.",

  // Settings Modal & AuthGate
  "Globale Einstellungen": "Global Settings",
  "Sprache / Language": "Language / Sprache",
  "App-Zugriffsschutz (Passwort / PIN)": "App Access Protection (Password / PIN)",
  "Aktiv": "Active",
  "Schützt die gesamte Weboberfläche und alle Kamera-APIs vor unbefugtem Zugriff im Netzwerk.": "Protects the entire web interface and all camera APIs against unauthorized network access.",
  "Neues Passwort / PIN (mind. 4 Zeichen)": "New Password / PIN (min. 4 chars)",
  "Passwort deaktivieren": "Disable password",
  "Abmelden (Session beenden)": "Log out (End session)",
  "Zugriff geschützt": "Access Protected",
  "Bitte gib das App-Passwort oder die PIN ein, um fortzufahren.": "Please enter the app password or PIN to continue.",
  "Passwort / PIN": "Password / PIN",
  "Prüfe…": "Verifying…",
  "Entsperren": "Unlock",
  "Falsches Passwort": "Invalid password",
  "Verbindungsfehler zum Server": "Server connection error",
  "Push-Benachrichtigungen (ntfy)": "Push Notifications (ntfy)",
  "Trage deinen ntfy-Server und das Topic ein. Push wird anschließend für jede gewünschte Kamera einzeln in deren Bearbeiten-Dialog aktiviert. Bei Bewegungen wird nach Möglichkeit ein aktuelles Kamerabild mitgesendet. Ohne Server wird ntfy.sh verwendet.": "Enter your ntfy server and topic. Push notifications can then be enabled individually for each camera in its edit dialog. When motion is detected, a current snapshot is attached if available. Defaults to ntfy.sh if server is left empty.",
  "mein-geheimes-topic-123": "my-secret-topic-123",
  "Testnachricht senden": "Send test notification",
  "Online-/Offline-Meldungen": "Online / Offline Alerts",
  "Sendet über ntfy eine Nachricht, wenn eine Kamera offline oder wieder online geht. Gilt für alle gespeicherten Kameras.": "Sends an ntfy notification whenever a camera goes offline or comes back online. Applies to all saved cameras.",
  "Speicher & System": "Storage & System",
  "Automatischer Cleanup": "Automatic Cleanup",
  "Löscht alte Aufnahmen automatisch, wenn der Speicherplatz knapp wird.": "Automatically deletes old recordings when disk space runs low.",
  "Abbrechen": "Cancel",
  "Speichern": "Save",
  "Einstellungen gespeichert!": "Settings saved!",
  "Fehler beim Speichern.": "Failed to save.",
  "Fehler beim Laden der Einstellungen.": "Failed to load settings.",
  "Bitte zuerst ein ntfy-Topic eingeben.": "Please enter an ntfy topic first.",
  "Testnachricht wurde erfolgreich gesendet.": "Test notification sent successfully.",

  // Camera Wall (page.tsx) & Standalone Fragments
  "Spalten": "Columns",
  "Sekunden": "Seconds",
  "Minuten": "Minutes",
  "Tage": "Days",
  "Kamera": "Camera",
  "Kameras": "Cameras",
  "Kamera(s)": "camera(s)",
  "Aufnahme(n)": "recording(s)",
  "Aufnahme(n) von": "recording(s) from",
  "Aufnahme(n) markiert": "recording(s) selected",
  "Alle stoppen": "Stop all",
  "Alle laufenden Aufnahmen beenden": "Stop all active recordings",
  "Archiv ↗": "Archive ↗",
  "Zum Video-Archiv wechseln": "Open video archive",
  "Alle bei Bewegung": "All on Motion",
  "Bewegungsaufnahme für alle Kameras starten": "Start motion recording for all cameras",
  "Bewegungsaufnahme für alle Kameras aktivieren": "Enable motion recording for all cameras",
  "Alle aktiven Aufnahmen stoppen": "Stop all active recordings",
  "Raster:": "Grid:",
  "Intervall:": "Interval:",
  "Manuell": "Manual",
  "Refresh": "Refresh",
  "Alle Kamerabilder jetzt aktualisieren": "Refresh all camera snapshots now",
  "Live stoppen": "Stop Live",
  "Alle Live": "All Live",
  "Live": "Live",
  "Laden": "Loading",
  "Lädt": "Loading",
  "Lädt…": "Loading…",
  "Protokoll": "Activity Log",
  "Log": "Log",
  "Bewegungen und Online-/Offline-Wechsel anzeigen": "View motion events and online/offline status changes",
  "Vollbild beenden": "Exit Fullscreen",
  "Vollbild-Überwachungsmodus": "Fullscreen monitor mode",
  "▣ Fokus": "▣ Focus",
  "▣ Vollbild": "▣ Fullscreen",
  "◉ Bedienung": "◉ Controls",
  "◎ Bedienung": "◎ Controls",
  "Kamera-Bedienung ausblenden": "Hide camera controls",
  "Kamera-Bedienung einblenden": "Show camera controls",
  "Fokusmodus schließen": "Exit focus mode",
  "Noch keine Kamera gespeichert": "No cameras saved yet",
  "Starte einen Scan und speichere einzelne Kameras oder die gesamte Ergebnisliste für die Monitore.": "Run a network scan and save individual cameras or the entire result list to your monitors.",
  "Scanner öffnen": "Open Scanner",
  "Ungruppiert": "Ungrouped",
  "Kamera ist offline": "Camera is offline",
  "Zugangsdaten benötigt": "Credentials required",
  "Bild wird geladen…": "Loading image…",
  "Verbindung fehlgeschlagen": "Connection failed",
  "Noch kein Bild": "No image yet",
  "Keine Bild- oder Stream-URL vorhanden": "No snapshot or stream URL configured",
  "Live-Fehler": "Live error",
  "Live-Stream stoppen": "Stop live stream",
  "Live-Stream starten": "Start live stream",
  "Live-Stream beenden": "Stop live stream",
  "PTZ-Kamerasteuerung (Schwenken/Neigen/Zoomen)": "PTZ camera control (Pan/Tilt/Zoom)",
  "PTZ-Kamerasteuerung": "PTZ camera control",
  "Bewegt…": "Moving…",
  "Nach oben neigen": "Tilt up",
  "Nach unten neigen": "Tilt down",
  "Nach links schwenken": "Pan left",
  "Nach rechts schwenken": "Pan right",
  "Bewegung stoppen": "Stop movement",
  "Herauszoomen": "Zoom out",
  "Hineinzoomen": "Zoom in",
  "Zoom zurücksetzen": "Reset zoom",
  "Zweifach vergrößern": "Zoom 2x",
  "Kameraname und Einstellungen bearbeiten": "Edit camera name and settings",
  "Kamera bearbeiten": "Edit Camera",
  "Vollbild schließen": "Close fullscreen",
  "Kameraaktionen": "Camera Actions",
  "Kameraaktionen schließen": "Close camera actions",
  "Aufnahme stoppen": "Stop recording",
  "Aufnahme starten": "Start recording",
  "Aufnahme Start": "Start Recording",
  "🔴 Aufnahme starten": "🔴 Start recording",
  "⏹️ Aufnahme stoppen": "⏹️ Stop recording",
  "Aufnahmen öffnen": "Open recordings",
  "Bearbeiten": "Edit",
  "← Vor": "← Prev",
  "Zurück →": "Next →",
  "Von Monitoren entfernen": "Remove from monitors",
  "🗑 Von den Monitoren entfernen": "🗑 Remove from monitors",
  "Kamera-Protokoll": "Camera Activity Log",
  "Bewegungen sowie Online- und Offline-Wechsel": "Motion events and online/offline status changes",
  "Protokoll schließen": "Close log",
  "Alle Kameras": "All Cameras",
  "Alle Ereignisse": "All Events",
  "Nur Bewegungen": "Motion Only",
  "Nur Offline": "Offline Only",
  "Nur Online": "Online Only",
  "↻ Aktualisieren": "↻ Refresh",
  "Für diesen Filter sind noch keine Ereignisse gespeichert.": "No events recorded for this filter yet.",
  "Bewegung": "Motion",
  "Bewegungen": "Motion Events",
  "Offline": "Offline",
  "Online": "Online",
  "Kamera-UI öffnen ↗": "Open Camera UI ↗",
  "Schließen": "Close",
  "Anzeigename": "Display Name",
  "Gruppe (z. B. Garten, Haus)": "Group (e.g. Garden, Front Door)",
  "Snapshot-URLs": "Snapshot URLs",
  "(erste erreichbare URL wird genutzt)": "(first reachable URL is used)",
  "Aktive Bild-Quelle": "Active Image Source",
  "Stream-URLs": "Stream URLs",
  "(RTSP-Stream für Live & NVR)": "(RTSP stream for Live & NVR)",
  "Zugangsdaten": "Credentials",
  "Werden lokal auf diesem Server gespeichert.": "Stored locally on this server.",
  "Benutzername": "Username",
  "Benutzer": "Username",
  "Passwort": "Password",
  "Passwort ausblenden": "Hide password",
  "Passwort anzeigen": "Show password",
  "Verbergen": "Hide",
  "Anzeigen": "Show",
  "Name im Bild (Overlay)": "On-Screen Name (Overlay)",
  "Oben Links": "Top Left",
  "Oben Rechts": "Top Right",
  "Unten Links": "Bottom Left",
  "Unten Rechts": "Bottom Right",
  "Aufnahme-Strategie": "Recording Strategy",
  "Aus": "Off",
  "Es wird nichts aufgezeichnet.": "Nothing is recorded.",
  "Nur Bewegung – immer": "Motion only – always",
  "Rund um die Uhr nur erkannte Bewegungen speichern.": "Save only detected motion events 24/7.",
  "Daueraufnahme – immer": "Continuous – always",
  "Rund um die Uhr ohne Unterbrechung aufzeichnen.": "Record continuously 24/7 without interruption.",
  "Nur Bewegung – im Zeitfenster": "Motion only – scheduled",
  "Im Zeitfenster Bewegungen speichern, außerhalb nichts.": "Save motion events during schedule window, nothing outside.",
  "Daueraufnahme – im Zeitfenster": "Continuous – scheduled",
  "Im Zeitfenster dauerhaft aufzeichnen, außerhalb nichts.": "Record continuously during schedule window, nothing outside.",
  "Im Zeitfenster Bewegung, sonst dauerhaft": "Motion during schedule, continuous otherwise",
  "Im Zeitfenster Speicher sparen, außerhalb lückenlos aufzeichnen.": "Save storage during schedule window, record continuously outside.",
  "Im Zeitfenster dauerhaft, sonst Bewegung": "Continuous during schedule, motion otherwise",
  "Im Zeitfenster lückenlos aufzeichnen, außerhalb nur Bewegungen.": "Record continuously during schedule window, motion only outside.",
  "Speicherziel:": "Storage Target:",
  "Standard-Speicherziel": "Default Storage Target",
  "Ziel-Speichermedium": "Target Storage Medium",
  "Zeitfenster": "Schedule Window",
  "Die gewählte Aufnahme-Strategie wechselt an diesen Tagen automatisch am Anfang und Ende des Zeitfensters.": "The selected recording strategy switches automatically on these days at the start and end of the schedule window.",
  "Die Strategie wechselt automatisch an den gewählten Tagen. Änderungen werden spätestens innerhalb einer Minute aktiv.": "The strategy switches automatically on the selected days. Changes take effect within one minute.",
  "Von": "From",
  "Bis": "To",
  "So": "Su",
  "Mo": "Mo",
  "Di": "Tu",
  "Mi": "We",
  "Do": "Th",
  "Fr": "Fr",
  "Sa": "Sa",
  "Empfindlichkeit im Zeitfenster": "Sensitivity during schedule",
  "Bewegungsempfindlichkeit:": "Motion Sensitivity:",
  "Bewegungsempfindlichkeit": "Motion Sensitivity",
  "Weniger Fehlalarme": "Fewer false alarms",
  "Erkennt kleinere Bewegungen": "Detects smaller movements",
  "Kleinere Bewegungen": "Smaller movements",
  "Bewegungsbereiche maskieren": "Mask Motion Zones",
  "Male beliebig geformte rote Bereiche ins Bild. Diese Bildteile werden ignoriert.": "Paint red zones onto the image. Motion in these areas will be ignored.",
  "Malen": "Paint",
  "Radieren": "Erase",
  "Leeren": "Clear",
  "Noch kein Vorschaubild geladen. Die Maske kann trotzdem eingezeichnet werden.": "No preview image loaded yet. You can still draw the mask.",
  "Wischen markiert Bereiche.": "Drag to mark ignored zones.",
  "Wischen entfernt markierte Bereiche.": "Drag to erase marked zones.",
  "Lokale KI-Objekterkennung": "Local AI Object Detection",
  "Nur Bewegungen mit den ausgewählten Objektarten erzeugen Ereignisse. Schlägt die Prüfung fehl, wird kein ungefilterter Alarm ausgelöst.": "Only motion containing the selected object classes will trigger events.",
  "Personen": "People",
  "Fahrzeuge": "Vehicles",
  "Fahrzeuge/Fahrräder": "Vehicles / Bikes",
  "Tiere": "Animals",
  "Person": "Person",
  "Fahrzeug": "Vehicle",
  "Tier": "Animal",
  "Objekt": "Object",
  "Objekte": "Objects",
  "Mindest-Sicherheit": "Minimum Confidence",
  "Fahrzeuge und Kennzeichen lokal erkennen": "Local Vehicle & License Plate Recognition",
  "Prüft bestätigte Bewegungen auf Fahrzeuge und liest sichtbare Kennzeichen lokal per OCR aus. Rot maskierte Bildbereiche werden dabei ebenfalls ignoriert.": "Checks confirmed motion for vehicles and reads visible license plates locally via OCR. Red masked zones are ignored.",
  "Vorlauf:": "Pre-roll:",
  "Vorlauf": "Pre-roll",
  "Nachlauf:": "Post-roll:",
  "Nachlauf": "Post-roll",
  "Segmentlänge:": "Segment Length:",
  "Segmentlänge": "Segment Length",
  "5 Minuten": "5 Minutes",
  "15 Minuten": "15 Minutes",
  "15 Minuten (Standard)": "15 Minutes (Default)",
  "30 Minuten": "30 Minutes",
  "60 Minuten": "60 Minutes",
  "Push-Benachrichtigung": "Push Notification",
  "Meldet Bewegungen dieser Kamera mit aktuellem Bild über das global konfigurierte ntfy-Topic.": "Sends motion alerts with a current snapshot via the globally configured ntfy topic.",
  "Speichern & Bild testen": "Save & Test Image",
  "Archiv leeren": "Clear Archive",

  // Scanner Page
  "Netzwerk-Scanner": "Network Scanner",
  "ONVIF & RTSP Kameras im lokalen Netzwerk automatisch erkennen": "Automatically discover ONVIF & RTSP cameras on your local network",
  "Weniger Optionen": "Fewer Options",
  "Erweiterte Optionen": "Advanced Options",
  "IP-Bereich / Subnetz": "IP Range / Subnet",
  "z. B. 192.168.1.0/24": "e.g. 192.168.1.0/24",
  "Netz:": "Net:",
  "Suche": "Search",
  "Scannen": "Scan",
  "Sucht…": "Scanning…",
  "Scan läuft…": "Scan running…",
  "Scan starten": "Start Scan",
  "Scan stoppen": "Stop Scan",
  "Scan startet…": "Starting scan…",
  "Scan abgebrochen.": "Scan cancelled.",
  "Scan wird gestoppt...": "Stopping scan...",
  "+ Weitere Zugangsdaten": "+ More Credentials",
  "− Weitere Zugangsdaten schließen": "− Hide Additional Credentials",
  "Weitere Zugangsdaten": "Additional Credentials",
  "Eine Kombination pro Zeile als": "One combination per line as",
  "Benutzer:Passwort": "username:password",
  ". Nur ein Passwort verwendet den Benutzer aus dem Hauptfeld.": ". Entering only a password uses the username from the main field.",
  "Eine Kombination pro Zeile als Benutzer:Passwort. Nur ein Passwort verwendet den Benutzer aus dem Hauptfeld.": "One combination per line as username:password. Entering only a password uses the username from the main field.",
  "bereits gespeichert und ausgeblendet": "already saved and hidden",
  "Ports (kommagetrennt)": "Ports (comma-separated)",
  "Gleichzeitige Anfragen": "Concurrent Requests",
  "Vorschaubilder": "Thumbnails",
  "Tiefenanalyse (ONVIF)": "Deep Probe (ONVIF)",
  "Logins in Stream-URLs": "Embed Logins in Stream URLs",
  "Ausführliches Log": "Verbose Log",
  "Ergebnisse": "Results",
  "Alle neuen zu Monitore": "Add All New to Monitors",
  "Monitore öffnen": "Open Monitors",
  "Auto: Aus": "Auto: Off",
  "Warte auf Eingabe": "Waiting for input",
  "Noch kein Scan ausgeführt": "No scan run yet",
  "Starte oben den Suchlauf, um Geräte zu finden.": "Start a scan above to discover cameras.",
  "Noch keine neue Kamera gefunden": "No new cameras found yet",
  "Keine neuen Kameras gefunden": "No new cameras found",
  "Der Scan läuft weiter. Neue Kameras erscheinen sofort an dieser Stelle.": "Scan is still running. New cameras will appear here immediately.",
  "Alle gefundenen Kameras sind bereits gespeichert oder im gewählten Bereich wurde keine neue Kamera erkannt.": "All discovered cameras are already saved or no new cameras were found in the selected range.",
  "Gespeicherte Kameras unter Monitore ansehen": "View saved cameras in Monitors",
  "Stream kopieren": "Copy Stream",
  "Kein Hostname": "No hostname",
  "In die Zwischenablage kopiert!": "Copied to clipboard!",
  "Kein Bild": "No Image",
  "Digest nötig": "Digest Auth",
  "Auth nötig": "Auth Required",
  "Aufklappen": "Expand",
  "Kopieren": "Copy",
  "Zu Monitoren hinzufügen": "Add to Monitors",
  "Alle zu Monitoren hinzufügen": "Add All to Monitors",
  "Gespeichert": "Saved",
  "Tabelle": "Table",
  "Kacheln": "Grid",
  "Liste": "List",
  "Karten": "Cards",

  // Playback / Wiedergabe & Recordings Page
  "Wiedergabe & Vorfall-Prüfung": "Playback & Incident Review",
  "Tageszusammenfassung": "Daily Summary",
  "Ereignisse": "Events",
  "Ereignis": "Event",
  "Ereignisse ·": "events ·",
  "Erkennung": "Detection",
  "Erkennungen": "Detections",
  "Zeitleiste": "Timeline",
  "Fokus auf erste Bewegung": "Focus on first motion",
  "Jetzt": "Now",
  "Zeitleiste auf die aktuelle Uhrzeit setzen": "Jump timeline to current time",
  "Video-Spur": "Video Track",
  "Blaue Video-Spur ein- oder ausblenden": "Show or hide blue video track",
  "Klicke auf die Zeitleiste zum Abspielen oder Vorfall-Prüfen": "Click timeline to play or inspect incident",
  "24h Übersicht:": "24h Overview:",
  "Klicke auf die 24h-Leiste, um das Zoom-Fenster zu verschieben": "Click the 24h bar to move the zoom window",
  "Filter (z.B. 11:25)...": "Filter (e.g. 11:25)...",
  "Alle Tageszeiten": "All Times of Day",
  "Keine Ereignisse für den gewählten Filter gefunden.": "No events found for the selected filter.",
  "Clip konnte nicht erstellt werden": "Clip could not be created",
  "Bewegungsaufnahme war nicht aktiv": "Motion recording was not active",
  "Clip wird erstellt …": "Creating clip …",
  "Zeitleiste auf diese Minute zoomen": "Zoom timeline to this minute",
  "Lade archivierte Videosegmente...": "Loading archived video segments...",
  "Keine Aufnahmen gefunden": "No recordings found",
  "Für den gewählten Filter wurden keine Aufnahmen gefunden. Wähle ein anderes Datum oder 'Alle Tage'.": "No recordings found for the selected filter. Select another date or 'All Days'.",
  "Zur Aufnahme-Konfiguration": "Go to Recording Settings",
  "Alle auf dieser Seite auswählen": "Select all on this page",
  "Nach Kameraname sortieren": "Sort by camera name",
  "Aufnahmezeit": "Recording Time",
  "Nach Aufnahmezeit sortieren": "Sort by recording time",
  "Nach Anzahl der Bewegungen sortieren": "Sort by motion count",
  "Größe": "Size",
  "Nach Dateigröße sortieren": "Sort by file size",
  "Speicherort": "Storage",
  "Nach Speicherort sortieren": "Sort by storage location",
  "Dateiname": "Filename",
  "Nach Dateiname sortieren": "Sort by filename",
  "Aktionen": "Actions",
  "Diese Kamera zeichnet aktuell auf": "This camera is currently recording",
  "Keine": "None",
  "Clip herunterladen": "Download clip",
  "Löschen": "Delete",
  "Keine Bewegung registriert": "No motion recorded",
  "Speicher:": "Storage:",
  "Zeige": "Show",
  "25 pro Seite": "25 per page",
  "50 pro Seite": "50 per page",
  "100 pro Seite": "100 per page",
  "Aufnahmen nach Kamera filtern": "Filter recordings by camera",
  "Kamera-Auswahl schließen": "Close camera selection",
  "Erneut versuchen": "Try again",
  "Keine Bewegungserkennung für diesen Clip registriert": "No motion detection recorded for this clip",
  "(Klicke auf eine Marke, um genau dorthin zu springen)": "(Click a marker to jump directly to that moment)",
  "Klicke auf den Zeitstrahl zum Springen": "Click timeline to seek",
  "Genaue Zeitpunkte:": "Exact timestamps:",
  "Doppeltippen links/rechts: 10 Sek. · Halten: schnell spulen": "Double-tap left/right: 10s · Hold: fast-forward",
  "⋯ Optionen": "⋯ Options",
  "Vorheriger Clip": "Previous clip",
  "Vorheriger": "Previous",
  "Zur vorherigen Bewegung springen (Taste P)": "Jump to previous motion (Key P)",
  "Vorh. Bew.": "Prev Motion",
  "Zur nächsten Bewegung springen (Taste N oder M)": "Jump to next motion (Key N or M)",
  "Nächste Bew.": "Next Motion",
  "Nächster Clip": "Next clip",
  "Nächster": "Next",
  "Diesen Clip von der Festplatte löschen": "Delete this clip from disk",
  "Diesen Clip löschen": "Delete this clip",
  "Auto-Play aktiv: Nächster Clip startet automatisch": "Auto-play active: next clip starts automatically",
  "Auto-Play deaktiviert": "Auto-play disabled",
  "Tempo:": "Speed:",
  "Vollbild (Taste F)": "Fullscreen (Key F)",
  "Schließen (Taste Esc)": "Close (Key Esc)",
  "Schließen (Esc)": "Close (Esc)",
  "Nur Aufnahmen mit erkannter Bewegung anzeigen": "Show only recordings with detected motion",
  "Nach Speicherort filtern": "Filter by storage location",
  "Nach Dateigröße filtern": "Filter by file size",
  "Kompakte Listenansicht": "Compact list view",
  "Kartenansicht": "Card view",
  "Datumsfilter aufheben": "Clear date filter",
  "Ereignisquelle wird geprüft": "Checking event source",
  "ONVIF-Ereignisse nicht unterstützt": "ONVIF events not supported",
  "Ereignisquelle gestört": "Event source error",
  "Ereignisquelle noch unbekannt": "Event source unknown",
  "Analyse": "Analytics",
  "Kamera-Auswertung": "Camera Analytics",
  "Kamera-Aktivitätsauswertung": "Camera Activity Analytics",
  "Bewegungserkennungen": "Motion Detections",
  "Rangliste der meist-aktiven Kameras, Spitzenzeiten und Erkennung von Fehlalarmen (z. B. Wind/Pflanzen).": "Ranking of most active cameras, peak hours, and false alarm detection (e.g. wind/plants).",
  "Neu laden": "Reload",
  "Aufnahme": "Recording",
  "Aufnahmesteuerung": "Recording Control",
  "Aufnahme-Kalender": "Recording Calendar",
  "Blaue Markierungen zeigen Tage mit vorhandenen Aufnahmen.": "Blue markers indicate days with available recordings.",
  "Kalender wird geladen…": "Loading calendar…",
  "Alle Kameras anzeigen": "Show all cameras",
  "Kalender": "Calendar",
  "Vorheriger Monat": "Previous month",
  "Nächster Monat": "Next month",
  "Monat auswählen": "Select month",
  "Keine Aufnahmen": "No recordings",
  "Ausgewählter Tag": "Selected Day",
  "Alle Tage": "All Days",
  "Alle Tage anzeigen": "Show all days",
  "An diesem Tag sind keine Aufnahmen vorhanden.": "No recordings available on this day.",
  "Wähle einen Tag im Kalender aus.": "Select a day in the calendar.",
  "Suche...": "Search...",
  "Kamera suchen...": "Search camera...",
  "Kamera auswählen": "Select camera",
  "Ganzer Tag (00–24 Uhr)": "All Day (00–24h)",
  "🌅 Vormittag (06–12 Uhr)": "🌅 Morning (06–12h)",
  "☀️ Nachmittag (12–18 Uhr)": "☀️ Afternoon (12–18h)",
  "🌙 Abend (18–24 Uhr)": "🌙 Evening (18–24h)",
  "🌌 Nacht (00–06 Uhr)": "🌌 Night (00–06h)",
  "⚙️ Eigene Uhrzeit...": "⚙️ Custom Time...",
  "Nur Bewegung": "Motion Only",
  "Alle Speicherorte": "All Storage Locations",
  "Unter 25 MB": "Under 25 MB",
  "Ab 500 MB": "Over 500 MB",
  "Kamera A–Z": "Camera A–Z",
  "Kamera Z–A": "Camera Z–A",
  "Meiste Bewegungen": "Most Motion",
  "Wenigste Bewegungen": "Least Motion",
  "Speicherort A–Z": "Storage A–Z",
  "Speicherort Z–A": "Storage Z–A",
  "Dateiname A–Z": "Filename A–Z",
  "Dateiname Z–A": "Filename Z–A",
  "Auswahl aufheben": "Clear selection",
  "Wird gelöscht...": "Deleting...",
  "Ausgewählte löschen": "Delete selected",
  "Heute": "Today",
  "Gestern": "Yesterday",
  "Letzte 7 Tage": "Last 7 Days",
  "Letzte 30 Tage": "Last 30 Days",
  "Gesamt (Alle)": "All Time",
  "Gesamte Bewegungen": "Total Motion Events",
  "🥇 Aktivste Kamera": "🥇 Most Active Camera",
  "Keine Aktivität": "No activity",
  "Spitzen-Uhrzeit (Peak)": "Peak Hour",
  "Tagesverlauf (Erkennungen nach Uhrzeit 0:00 – 23:00 Uhr)": "Daily Distribution (Detections by Hour 0:00 – 23:00)",
  "Kamera-Rangliste (Meist-aktive zuerst)": "Camera Ranking (Most active first)",
  "Klicke auf eine Kamera zum direkten Filtern": "Click a camera to filter directly",
  "Lade Auswertung...": "Loading analytics...",
  "Keine Kameras oder Bewegungserkennungen in diesem Zeitraum vorhanden.": "No cameras or motion detections found in this period.",
  "Aufnahmen filtern": "Filter Recordings",
  "🌿 Weboberfläche": "🌿 Web UI",
  "Empfindlichkeit in Kamera senken ➔": "Lower sensitivity in camera ➔",
  "Keine Bewegung erkannt": "No motion detected",
  "Smartphone-Video wird vorbereitet": "Preparing mobile video",
  "Der Clip wird einmalig in ein kompatibles Format umgewandelt.": "Converting clip once into a compatible format.",
  "Video ist bereit": "Video is ready",
  "Video starten": "Start Video",
  "Das Video konnte auch im Smartphone-Modus nicht geladen werden.": "The video could not be loaded even in mobile compatibility mode.",
  "Abspielen": "Play",
  "Pause": "Pause",
  "Neueste zuerst": "Newest first",
  "Älteste zuerst": "Oldest first",
  "Größte zuerst": "Largest first",
  "Kleinste zuerst": "Smallest first",
  "Alle Größen": "All Sizes",
  "Empfindlichkeit alle…": "Sensitivity for all…",
  "Wiedergabe ➔": "Playback ➔",
  "Speicher zuweisen...": "Assign storage...",
  "Segmentdauer setzen...": "Set segment length...",
  "Empfindlichkeit setzen…": "Set sensitivity…",
  "Aufnahmen dieser Kameras löschen": "Delete recordings of selected cameras",
  "Lade Kameras & Einstellungen...": "Loading cameras & settings...",
  "Keine Kameras gefunden": "No cameras found",
  "Es wurden noch keine Kameras angelegt. Führe einen Scan aus, um Kameras hinzuzufügen.": "No cameras added yet. Run a scan to discover and add cameras.",
  "Zum Scanner": "Go to Scanner",
  "ZEITPAUSE": "SCHEDULE PAUSE",

  // Storage Page
  "Zurück zu Aufnahmen": "Back to Recordings",
  "Speichermedien": "Storage Media",
  "Aktualisieren": "Refresh",
  "Speichermedium anbinden": "Add Storage Target",
  "Automatische Bereinigungs-Strategie & Notfall-Schutz": "Automatic Retention Policy & Emergency Protection",
  "Aktiv (Prüfung alle 15 Min.)": "Active (Checks every 15 min)",
  "Der integrierte Hintergrund-Wächter schützt Ihre Festplatte vollautomatisch vor Überfüllung und hält Ihr System sauber:": "The built-in background guardian automatically protects your drives from filling up and keeps your system clean:",
  "Bereinigung läuft...": "Cleaning up...",
  "Jetzt prüfen & bereinigen": "Check & Clean Now",
  "1. Alter-Limit (Retention)": "1. Age Limit (Retention)",
  "Aufnahmen, die älter als die konfigurierten Tage (z.B. 14 Tage) sind, werden automatisch gelöscht.": "Recordings older than the configured days (e.g. 14 days) are deleted automatically.",
  "2. Speicher-Puffer (Notfall)": "2. Free Space Buffer (Emergency)",
  "Fällt der freie Speicher unter den Puffer (z.B. 10 GB), werden sukzessive die ältesten Segmente gelöscht.": "If free space drops below the buffer (e.g. 10 GB), the oldest segments are deleted first.",
  "3. Ordner-Hygiene": "3. Folder Hygiene",
  "Leere Kamera- und Datumsordner werden nach dem Löschen der Clips automatisch entfernt.": "Empty camera and date folders are removed automatically after clips are deleted.",
  "Hintergrund-Wächter bereit (nächste Prüfung in Kürze).": "Background guardian ready (next check shortly).",
  "Letzter Wächter-Lauf:": "Last guardian run:",
  "Zuletzt freigegeben:": "Last freed:",
  "Lade Speichermedien und Laufwerkskapazitäten...": "Loading storage media and drive capacities...",
  "Keine Speichermedien eingerichtet": "No storage media configured",
  "Binde ein lokales Verzeichnis, eine externe Festplatte oder ein Netzlaufwerk an, um Kameras aufzeichnen zu lassen.": "Connect a local directory, external drive, or network share to record camera streams.",
  "Erstes Speichermedium anbinden": "Add First Storage Target",
  "Standard-Speicher": "Default Storage",
  "Offline / Fehler": "Offline / Error",
  "Aufbewahrungszeit:": "Retention Period:",
  "Unbegrenzt": "Unlimited",
  "Puffer-Schwelle:": "Free Space Buffer:",
  "Deaktiviert": "Disabled",
  "Kameras zugewiesen:": "Assigned Cameras:",
  "Schreibrechte:": "Write Permissions:",
  "✓ Vorhanden": "✓ Granted",
  "✗ Verweigert": "✗ Denied",
  "Keine Schreibrechte:": "No write permissions:",
  "Der Server-Benutzer darf nicht in diesen Ordner schreiben.": "The server user does not have write access to this folder.",
  "Repariere Berechtigungen...": "Fixing permissions...",
  "Schreibrechte jetzt per Klick reparieren": "Fix write permissions with 1 click",
  "Als Standard": "Set Default",
  "Jetzt bereinigen": "Clean Now",
  "Neues Speichermedium anbinden": "Connect New Storage Target",
  "Netzlaufwerk (SMB / NAS)": "Network Share (SMB / NAS)",
  "NFS Freigabe": "NFS Share",
  "Manueller Pfad": "Manual Path",
  "Gefundene Festplatten, USB-Laufwerke und gemountete Verzeichnisse auf diesem Host:": "Discovered drives, USB storage, and mounted directories on this host:",
  "Keine externen Laufwerke gefunden. Nutze den Reiter „Netzlaufwerk (SMB / NAS)“ oder „Manueller Pfad“.": "No external drives found. Use the 'Network Share (SMB / NAS)' or 'Manual Path' tab.",
  "Bereits hinterlegt": "Already configured",
  "Auswählen": "Select",
  "Netzlaufwerk ohne Terminal einbinden": "Mount network share without terminal",
  "Der LXC bindet die Freigabe (Synology, QNAP, TrueNAS, Windows) automatisch mit Schreibrechten ein.": "Automatically mounts the share (Synology, QNAP, TrueNAS, Windows) with write permissions.",
  "Server / IP": "Server / IP",
  "Freigabename": "Share Name",
  "Lokaler Mount-Pfad": "Local Mount Path",
  "Zugangsdaten (SMB)": "Credentials (SMB)",
  "Gast wenn leer": "Guest if empty",
  "Aufbewahrungszeit (Tage)": "Retention Period (Days)",
  "0 = Unbegrenzt": "0 = Unlimited",
  "Min. freier Puffer (GB)": "Min. Free Buffer (GB)",
  "Beim Container-Start automatisch einhängen (/etc/fstab)": "Auto-mount on container start (/etc/fstab)",
  "Als Standard-Speicherziel für neue Kameras festlegen": "Set as default storage target for new cameras",
  "Als Standard-Speicherziel festlegen": "Set as default storage target",
  "Wird eingehängt...": "Mounting...",
  "Netzlaufwerk jetzt einbinden": "Mount Network Share Now",
  "NFS-Freigabe automatisch einbinden": "Mount NFS share automatically",
  "Direktes Linux-Mounten über NFSv3/v4 – besonders schnell und zuverlässig.": "Direct Linux mount via NFSv3/v4 – fast and reliable.",
  "Export-Pfad (auf dem NAS)": "Export Path (on NAS)",
  "NFS-Freigabe jetzt einbinden": "Mount NFS Share Now",
  "Name des Speichermediums": "Storage Target Name",
  "Vollständiger Ordnerpfad auf dem Host": "Full Directory Path on Host",
  "Prüfe...": "Checking...",
  "Pfad testen": "Test Path",
  "Ordner automatisch anlegen, falls er noch nicht existiert": "Create directory automatically if it does not exist",
  "Pfad erfolgreich geprüft & beschreibbar!": "Path verified & writable!",
  "Prüfung fehlgeschlagen:": "Verification failed:",
  "Wird angebunden...": "Connecting...",
  "Speicherziel anpassen": "Edit Storage Target",
  "Pfad": "Path",
  "Bereinigungsregeln & Festplattenschutz": "Retention Rules & Disk Protection",
  "Nie": "Never",
  "Notfall-Puffer:": "Emergency Buffer:",
  "Aktiviert (Aufnahmen auf dieses Ziel zulassen)": "Enabled (allow recordings to this target)",
  "Änderungen speichern": "Save Changes",
  "Lokaler Speicher": "Local Storage",
  "Lokaler Speicher (Standard)": "Local Storage (Default)",
  "Standard": "Default",
  "Belegt:": "Used:",
  "Belegt": "Used",
  "von": "of",
  "% belegt": "% used",
  "%belegt": "% used",
  "Freier Speicher:": "Free space:",
  "Freier Speicher": "Free space",
  "NVR-Clips:": "NVR Clips:",
  "Kapazität:": "Capacity:",
  "Frei:": "Free:",
  "· Frei:": "· Free:",
};

const GERMAN_MONTH_MAP: Record<string, string> = {
  januar: "January",
  februar: "February",
  märz: "March",
  maerz: "March",
  april: "April",
  mai: "May",
  juni: "June",
  juli: "July",
  august: "August",
  september: "September",
  oktober: "October",
  november: "November",
  dezember: "December",
};

const GERMAN_WEEKDAY_MAP: Record<string, string> = {
  mo: "Mon",
  di: "Tue",
  mi: "Wed",
  do: "Thu",
  fr: "Fri",
  sa: "Sat",
  so: "Sun",
};

const PATTERN_REPLACEMENTS: Array<[RegExp, string]> = [
  [/^(\d+)\s+Spalten$/i, "$1 Columns"],
  [/^(\d+)\s+Sekunden$/i, "$1 Seconds"],
  [/^(\d+)\s+Minuten$/i, "$1 Minutes"],
  [/^(\d+)\s+Tage$/i, "$1 Days"],
  [/^(\d+)\s+Kamera\(s\)$/i, "$1 Camera(s)"],
  [/^Kameras\s*\((\d+)\)$/i, "Cameras ($1)"],
  [/^(\d+)\s+Ereignisse$/i, "$1 Events"],
  [/^(\d+)\s+Ereignis$/i, "$1 Event"],
  [/^(\d+)\s+Ereignisse\s*·\s*(\d+)\s+Objekte$/i, "$1 events · $2 objects"],
  [/^Ereignis-Chronik für\s+(.+)$/i, "Event Log for $1"],
  [/^Keine Bewegungsereignisse für\s+(.+)\s+erfasst\.$/i, "No motion events recorded for $1."],
  [/^(\d+)\s+neue Kamera\(s\)(.*)$/i, "$1 new camera(s)$2"],
  [/^✓\s*(\d+)\s+bereits gespeichert und ausgeblendet$/i, "✓ $1 already saved and hidden"],
  [/^(\d+)\s+weitere Logins$/i, "$1 additional logins"],
  [/^(\d+)\s+von\s+(\d+)\s+aufnehmend$/i, "$1 of $2 recording"],
  [/^Alle\s+\((\d+)\)$/i, "All ($1)"],
  [/^🔴\s*Aktiv\s*\((\d+)\)$/i, "🔴 Active ($1)"],
  [/^Pausiert\s*\((\d+)\)$/i, "Paused ($1)"],
  [/^Alle\s+(\d+)\s+markieren$/i, "Select all $1"],
  [/^Aktionen für\s+(\d+)\s+markierte Kamera\(s\):$/i, "Actions for $1 selected camera(s):"],
  [/^(\d+)\s+Aufnahme\(n\)\s+markiert$/i, "$1 recording(s) selected"],
  [/^(\d+)\s+Aufnahme\(n\)\s+von\s+(\d+)\s+Kamera\(s\)$/i, "$1 recording(s) from $2 camera(s)"],
  [/^(\d+)\s+Clips im Monat$/i, "$1 clips this month"],
  [/^(\d+)\s+REC aktiv$/i, "$1 REC active"],
  [/^(\d+)%\s*belegt$/i, "$1% used"],
  [/^%\s*belegt$/i, "% used"],
  [/^Belegt:\s*(.+)\s+von\s+(.+)$/i, "Used: $1 of $2"],
  [/^Freier Speicher:\s*(.+)\s+von\s+(.+)$/i, "Free space: $1 of $2"],
  [/^Freier Speicher:\s*(.+)$/i, "Free space: $1"],
  [/^Freier Speicher:$/i, "Free space:"],
  [/^Belegt:$/i, "Used:"],
  [/^Min\.\s*(\d+)\s*GB\s*frei$/i, "Min. $1 GB free"],
  [/^Erkannte Laufwerke\s*\((\d+)\)$/i, "Detected Drives ($1)"],
  [/^Neue Version verfügbar:\s*(.+)$/i, "New version available: $1"],
  [/^Aktionen für\s+(.+)$/i, "Actions for $1"],
  [/^Live-Stream\s+(.+)$/i, "Live Stream $1"],
  [/^Kennzeichen\s+(.+)$/i, "Plate $1"],
  [/^(\d+)\s+Erkennungen? registriert$/i, "$1 detection(s) recorded"],
  [/^in\s+(\d+)\s+von\s+(\d+)\s+Kameras$/i, "across $1 of $2 cameras"],
  [/^(\d+)\s+Bewegungen? im Clip:?$/i, "$1 motion event(s) in clip:"],
  [/^(\d+)\s+Bewegungen?:?$/i, "$1 motion event(s):"],
  [/^Spitze:\s*(\d+)\s*in 1 Stunde$/i, "Peak: $1 in 1 hour"],
  [/^Kamera gefunden:\s*(.+)$/i, "Camera found: $1"],
  [/^Auflösung:\s*(.+)$/i, "Resolution: $1"],
  [/^Gerät:\s*(.+)$/i, "Device: $1"],
  [/^Alle anzeigen\s*\((\d+)\)$/i, "Show all ($1)"],
  [/^von\s+(\d+)\s+Segmenten$/i, "of $1 segments"],
  [/^Seite\s+(\d+)\s*\/\s*(\d+)$/i, "Page $1 / $2"],
  [/^(\d{1,2}:\d{2}(?::\d{2})?)\s+Uhr$/i, "$1"],
  [/^\(bei\s+(.+)\)$/i, "(at $1)"],
  [/^✓\s*Ereignisse aktiv\s*\((.+)\)$/i, "✓ Events active ($1)"],
  [/^letzte Bewegung\s+(.+)$/i, "last motion $1"],
  [/^(.+)\s+zurückrollen$/i, "Scroll back $1"],
  [/^(.+)\s+vorrollen$/i, "Scroll forward $1"],
  [/^(.+)\s+Zeitbereich anzeigen$/i, "Show $1 window"],
  [/^Abspielen ab\s+(.+)\s+Uhr$/i, "Play from $1"],
  [/^Lokaler Speicher\s*\((.+)\)$/i, "Local Storage ($1)"],
  [/^Lokaler Speicher$/i, "Local Storage"],
];

export function translateText(input: string, lang: AppLanguage): string {
  if (lang === "de" || !input) return input;
  const trimmed = input.trim();
  if (!trimmed) return input;

  const exact = EXACT_DE_TO_EN[trimmed];
  if (exact) {
    return input.replace(trimmed, exact);
  }

  // German month + year (e.g. "Oktober 2026")
  const monthMatch = trimmed.match(/^(Januar|Februar|März|Maerz|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember)\s+(\d{4})$/i);
  if (monthMatch) {
    const enMonth = GERMAN_MONTH_MAP[monthMatch[1].toLowerCase()];
    if (enMonth) {
      return input.replace(trimmed, `${enMonth} ${monthMatch[2]}`);
    }
  }

  // German short weekday + date (e.g. "Fr., 16.10.2026")
  const weekdayMatch = trimmed.match(/^(Mo|Di|Mi|Do|Fr|Sa|So)\.?,\s*(\d{2}\.\d{2}\.\d{4})$/i);
  if (weekdayMatch) {
    const enDay = GERMAN_WEEKDAY_MAP[weekdayMatch[1].toLowerCase()];
    if (enDay) {
      return input.replace(trimmed, `${enDay}, ${weekdayMatch[2]}`);
    }
  }

  for (const [regex, replacement] of PATTERN_REPLACEMENTS) {
    if (regex.test(trimmed)) {
      return input.replace(trimmed, trimmed.replace(regex, replacement));
    }
  }

  return input;
}

type LanguageContextValue = {
  lang: AppLanguage;
  setLang: (lang: AppLanguage) => void;
  toggleLang: () => void;
  t: (de: string, en: string) => string;
  tr: (text: string) => string;
};

const LanguageContext = createContext<LanguageContextValue>({
  lang: "de",
  setLang: () => {},
  toggleLang: () => {},
  t: (de) => de,
  tr: (text) => text,
});

export function useLanguage() {
  return useContext(LanguageContext);
}

const originalTextMap = new WeakMap<Text, { de: string; en: string }>();
const originalAttrMap = new WeakMap<Element, Record<string, { de: string; en: string }>>();
const TRANSLATABLE_ATTRS = ["title", "placeholder", "aria-label"] as const;

function applyDomTranslations(root: Node, lang: AppLanguage) {
  if (typeof document === "undefined") return;

  const processTextNode = (node: Text) => {
    const parent = node.parentElement;
    if (!parent) return;
    const tag = parent.tagName;
    if (tag === "SCRIPT" || tag === "STYLE" || tag === "CODE" || tag === "TEXTAREA") return;

    const current = node.nodeValue ?? "";
    if (!current.trim()) return;

    const record = originalTextMap.get(node);
    if (lang === "en") {
      const baseDe = record && current === record.en ? record.de : current;
      const translated = translateText(baseDe, "en");
      if (translated !== baseDe) {
        originalTextMap.set(node, { de: baseDe, en: translated });
        if (node.nodeValue !== translated) {
          node.nodeValue = translated;
        }
      }
    } else if (record && current === record.en) {
      node.nodeValue = record.de;
    }
  };

  const processElementAttrs = (el: Element) => {
    let attrRecord = originalAttrMap.get(el);
    for (const attr of TRANSLATABLE_ATTRS) {
      const val = el.getAttribute(attr);
      if (!val || !val.trim()) continue;
      const saved = attrRecord?.[attr];
      if (lang === "en") {
        const baseDe = saved && val === saved.en ? saved.de : val;
        const translated = translateText(baseDe, "en");
        if (translated !== baseDe) {
          if (!attrRecord) {
            attrRecord = {};
            originalAttrMap.set(el, attrRecord);
          }
          attrRecord[attr] = { de: baseDe, en: translated };
          if (val !== translated) {
            el.setAttribute(attr, translated);
          }
        }
      } else if (saved && val === saved.en) {
        el.setAttribute(attr, saved.de);
      }
    }
  };

  if (root.nodeType === Node.TEXT_NODE) {
    processTextNode(root as Text);
    return;
  }

  if (root.nodeType === Node.ELEMENT_NODE) {
    processElementAttrs(root as Element);
  }

  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT
  );

  let current = walker.nextNode();
  while (current) {
    if (current.nodeType === Node.TEXT_NODE) {
      processTextNode(current as Text);
    } else if (current.nodeType === Node.ELEMENT_NODE) {
      processElementAttrs(current as Element);
    }
    current = walker.nextNode();
  }
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<AppLanguage>("de");
  const langRef = useRef<AppLanguage>("de");

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY) as AppLanguage | null;
      if (saved === "de" || saved === "en") {
        setLangState(saved);
        langRef.current = saved;
        document.documentElement.lang = saved;
      } else if (navigator.language && !navigator.language.toLowerCase().startsWith("de")) {
        setLangState("en");
        langRef.current = "en";
        document.documentElement.lang = "en";
      }
    } catch {}
  }, []);

  const setLang = useCallback((next: AppLanguage) => {
    setLangState(next);
    langRef.current = next;
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
      document.documentElement.lang = next;
    } catch {}
  }, []);

  const toggleLang = useCallback(() => {
    setLang(langRef.current === "de" ? "en" : "de");
  }, [setLang]);

  const t = useCallback(
    (de: string, en: string) => (lang === "en" ? en : de),
    [lang]
  );

  const tr = useCallback(
    (text: string) => translateText(text, lang),
    [lang]
  );

  useEffect(() => {
    if (typeof document === "undefined" || !document.body) return;
    applyDomTranslations(document.body, lang);

    if (lang !== "en") return;

    let rafId: number | null = null;
    const pendingNodes = new Set<Node>();

    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === "characterData" && m.target) {
          pendingNodes.add(m.target);
        } else if (m.type === "childList") {
          m.addedNodes.forEach((n) => pendingNodes.add(n));
        }
      }
      if (pendingNodes.size > 0 && rafId === null) {
        rafId = window.requestAnimationFrame(() => {
          rafId = null;
          const nodes = Array.from(pendingNodes);
          pendingNodes.clear();
          for (const node of nodes) {
            if (node.isConnected) {
              applyDomTranslations(node, langRef.current);
            }
          }
        });
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    return () => {
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      observer.disconnect();
    };
  }, [lang]);

  const value = useMemo(
    () => ({ lang, setLang, toggleLang, t, tr }),
    [lang, setLang, toggleLang, t, tr]
  );

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}
