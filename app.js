// Car Finder – App-Logik
(function () {
  'use strict';

  // ---------- Schutz gegen Einbetten (Clickjacking) ----------
  // Läuft die App in einem iframe einer fremden Seite, startet sie nicht:
  // kein Speicherzugriff, kein GPS, keine Knöpfe – nur ein Link zum direkten Öffnen.
  var framed = true;
  try { framed = window.top !== window.self; } catch (e) { framed = true; }
  if (framed) {
    document.getElementById('framedNotice').hidden = false;
    document.getElementById('framedOpen').href = location.origin + location.pathname;
    return;
  }

  // ---------- Einstellungen ----------
  var PARK_KEY = 'carfinder.parking.v1';
  var THEME_KEY = 'carfinder.theme';
  var GOOD_ACCURACY = 20;     // m – ab hier wird sofort gespeichert
  var MAX_WAIT_MS = 12000;    // max. Wartezeit auf gutes GPS
  var WALK_M_PER_MIN = 80;    // ca. 4,8 km/h
  var DETOUR = 1.3;           // Luftlinie → realer Fußweg

  // ---------- Speicher (robust gegen blockierten Storage) ----------
  var memory = {};
  var store = {
    get: function (k) {
      var v;
      try { v = localStorage.getItem(k); } catch (e) { return memory[k] || null; }
      if (!v) return null;
      try { return JSON.parse(v); }
      catch (e) { try { localStorage.removeItem(k); } catch (e2) {} return null; }   // unlesbarer Eintrag → entfernen
    },
    remove: function (k) {
      delete memory[k];
      try { localStorage.removeItem(k); } catch (e) {}
    },
    set: function (k, v) {
      memory[k] = v;
      try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; }
    }
  };

  // ---------- Helfer ----------
  var $ = function (id) { return document.getElementById(id); };
  function toast(msg, ms) {
    var t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.remove('show'); }, ms || 3200);
  }
  function haversine(a, b) {
    var R = 6371000, r = Math.PI / 180;
    var dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function fmtDist(m) {
    if (m < 1000) return (m < 50 ? Math.round(m) : Math.round(m / 10) * 10) + ' m';
    return (m / 1000).toLocaleString('de-DE', { maximumFractionDigits: m < 10000 ? 1 : 0 }) + ' km';
  }
  function fmtWalk(m) {
    var min = Math.max(1, Math.round(m * DETOUR / WALK_M_PER_MIN));
    if (min < 60) return '≈ ' + min + ' Min';
    return '≈ ' + Math.floor(min / 60) + ' Std ' + (min % 60) + ' Min';
  }
  function fmtSince(ts) {
    var min = Math.floor((Date.now() - ts) / 60000);
    if (min < 1) return 'Gerade geparkt';
    if (min < 60) return 'Parkt seit ' + min + ' Min';
    var h = Math.floor(min / 60);
    if (h < 24) return 'Parkt seit ' + h + ' Std ' + (min % 60) + ' Min';
    var d = Math.floor(h / 24);
    return 'Parkt seit ' + d + (d === 1 ? ' Tag ' : ' Tagen ') + (h % 24) + ' Std';
  }
  function fmtParkedAt(ts) {
    var d = new Date(ts);
    return 'Geparkt am ' + d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' }) +
      ' um ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) + ' Uhr';
  }
  function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

  // ---------- Theme (Auto / Hell / Dunkel) ----------
  var mq = window.matchMedia('(prefers-color-scheme: dark)');
  var themePref = store.get(THEME_KEY);
  if (themePref !== 'light' && themePref !== 'dark') themePref = 'auto';   // unbekannte Werte ignorieren
  var themeIcons = { auto: '#i-auto', light: '#i-sun', dark: '#i-moon' };
  var themeNames = { auto: 'Automatisch', light: 'Hell', dark: 'Dunkel' };
  function isDark() { return themePref === 'dark' || (themePref === 'auto' && mq.matches); }
  function applyTheme() {
    var root = document.documentElement;
    if (themePref === 'auto') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', themePref);
    document.querySelector('meta[name="theme-color"]').setAttribute('content', isDark() ? '#0E1116' : '#F2F4F3');
    document.querySelectorAll('.theme-btn').forEach(function (b) {
      b.querySelector('use').setAttribute('href', themeIcons[themePref]);
      b.setAttribute('aria-label', 'Farbschema: ' + themeNames[themePref] + ' – tippen zum Wechseln');
    });
    updateMapStyle();
  }
  document.querySelectorAll('.theme-btn').forEach(function (b) {
    b.addEventListener('click', function () {
      themePref = { auto: 'light', light: 'dark', dark: 'auto' }[themePref];
      store.set(THEME_KEY, themePref);
      applyTheme();
      toast('Farbschema: ' + themeNames[themePref], 1500);
    });
  });
  if (mq.addEventListener) mq.addEventListener('change', function () { if (themePref === 'auto') applyTheme(); });

  // ---------- Zustand ----------
  // Der Parkplatz existiert NUR im Browser-Speicher dieses Handys. Es gibt keine
  // Start- oder Beispielposition im Code: Ohne eigenen Eintrag startet die App
  // immer auf dem Parken-Screen. Unbrauchbare Einträge werden verworfen.
  function validParking(p) {
    var num = function (v) { return typeof v === 'number' && isFinite(v); };
    return !!p && typeof p === 'object' &&
      num(p.lat) && p.lat >= -90 && p.lat <= 90 &&
      num(p.lng) && p.lng >= -180 && p.lng <= 180 &&
      !(p.lat === 0 && p.lng === 0) &&
      num(p.acc) && p.acc >= 0 &&
      num(p.ts) && p.ts > 0;   // Uhrzeit bewusst nicht streng prüfen: falsche Handy-Uhr darf keinen Parkplatz löschen
  }
  function loadParking() {
    var p = store.get(PARK_KEY);
    if (p && !validParking(p)) { store.remove(PARK_KEY); return null; }
    return p;
  }
  var parking = loadParking();   // {lat, lng, acc, ts} oder null
  var lastFix = null;                  // {lat, lng, acc, ts}
  var fixListeners = [];
  var watchId = null;

  // ---------- GPS ----------
  function setChip(state, text) { $('gpsChip').setAttribute('data-state', state); $('gpsText').textContent = text; }
  function startWatch() {
    if (!('geolocation' in navigator)) { setChip('err', 'Kein GPS verfügbar'); return; }
    if (watchId !== null) return;
    watchId = navigator.geolocation.watchPosition(onFix, onGeoError,
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
  }
  function stopWatch() { if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; } }
  function onFix(pos) {
    lastFix = { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy, ts: Date.now() };
    var acc = Math.round(lastFix.acc);
    if (acc <= 30) setChip('ok', 'GPS ± ' + acc + ' m');
    else setChip('warn', 'GPS ungenau ± ' + acc + ' m');
    fixListeners.slice().forEach(function (fn) { fn(lastFix); });
    updateUser();
  }
  function onGeoError(err) {
    if (err.code === 1) setChip('err', 'Kein Zugriff');
    else if (err.code === 3) setChip('search', 'GPS sucht …');
    else setChip('err', 'Kein GPS-Signal');
    fixListeners.slice().forEach(function (fn) { fn(null, err); });
  }
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) stopWatch(); else { startWatch(); refreshStats(); }
  });

  // Wartet auf eine möglichst genaue Position
  function getGoodFix() {
    return new Promise(function (resolve, reject) {
      if (lastFix && Date.now() - lastFix.ts < 10000 && lastFix.acc <= GOOD_ACCURACY) return resolve(lastFix);
      var best = null;
      function done(val, err) {
        clearTimeout(timer); fixListeners = fixListeners.filter(function (f) { return f !== listener; });
        if (val) resolve(val); else reject(err);
      }
      function listener(fix, err) {
        if (err && err.code === 1) return done(null, err);
        if (!fix) return;
        if (!best || fix.acc < best.acc) best = fix;
        if (best.acc <= GOOD_ACCURACY) done(best);
      }
      var timer = setTimeout(function () { best ? done(best) : done(null, { code: 3 }); }, MAX_WAIT_MS);
      fixListeners.push(listener);
      stopWatch(); startWatch();   // frischen Fix anfordern
    });
  }

  // ---------- Dauerhafter Speicher ----------
  // Bittet Chrome, die Daten dieser App nicht automatisch aufzuräumen (z. B. bei vollem Speicher).
  function requestPersist() {
    try {
      if (navigator.storage && navigator.storage.persist) {
        navigator.storage.persisted().then(function (already) {
          return already || navigator.storage.persist();
        }).catch(function () {});
      }
    } catch (e) {}
  }

  // ---------- Parken ----------
  var busy = false;
  function park() {
    if (busy) return;
    if (!('geolocation' in navigator)) return toast('Dieses Gerät unterstützt keine Standortabfrage.');
    busy = true;
    var btn = $('parkBtn');
    btn.classList.add('locating'); btn.setAttribute('aria-busy', 'true');
    $('parkLabel').textContent = 'Suche GPS …';
    $('parkHint').textContent = 'Warte auf ein genaues GPS-Signal …';

    getGoodFix().then(function (fix) {
      parking = { lat: fix.lat, lng: fix.lng, acc: fix.acc, ts: Date.now() };
      var persisted = store.set(PARK_KEY, parking);
      requestPersist();
      if (navigator.vibrate) navigator.vibrate(40);
      btn.classList.remove('locating'); btn.classList.add('done');
      $('parkIcon').querySelector('use').setAttribute('href', '#i-check');
      $('parkLabel').textContent = 'Gespeichert';
      $('parkHint').textContent = 'Genauigkeit ± ' + Math.round(fix.acc) + ' m';
      setTimeout(function () {
        resetParkButton(); showScreen('map');
        // Speicher voll oder gesperrt (z. B. Inkognito): ehrlich sagen statt still zu scheitern
        if (!persisted) toast('Achtung: Nur vorübergehend gespeichert. Der Handy-Speicher lässt kein dauerhaftes Speichern zu.', 7000);
      }, 700);
    }).catch(function (err) {
      resetParkButton();
      if (err && err.code === 1) toast('Bitte erlaube den Standortzugriff in den Browser-Einstellungen.', 5000);
      else toast('Kein GPS-Signal gefunden. Bitte nochmal versuchen.');
    }).then(function () { busy = false; });
  }
  function resetParkButton() {
    var btn = $('parkBtn');
    btn.classList.remove('locating', 'done'); btn.removeAttribute('aria-busy');
    $('parkIcon').querySelector('use').setAttribute('href', '#i-car');
    $('parkLabel').textContent = 'Jetzt parken';
    $('parkHint').textContent = 'Ein Tipp speichert deine aktuelle Position';
  }

  // ---------- Karte ----------
  var followUser = true;
  var map = null, tiles = null, carMarker = null, meMarker = null, line = null;
  // ===== Kartenanbieter – NUR HIER ändern =====
  // Aktuell: OpenStreetMap-Standardkarte, kostenlos, ohne API-Key.
  // Wechsel zu einem anderen Anbieter (z. B. mit eigenem Schlüssel): url, attribution
  // und maxZoom anpassen UND den Abschnitt „Wer deine IP-Adresse sieht“ im Info-Dialog.
  // Dunkelmodus: dieselbe Karte, per CSS-Filter abgedunkelt (siehe .map-dark).
  var MAP_TILES = {
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19
  };
  var TILE_FAIL_LIMIT = 3;   // so viele Fehlschläge ohne Erfolg → Hinweis anzeigen

  function ensureMap() {
    if (map || typeof L === 'undefined') return;
    map = L.map('map', { zoomControl: false, attributionControl: false, maxZoom: MAP_TILES.maxZoom });
    L.control.attribution({ position: 'topright', prefix: false }).addTo(map);
    map.on('dragstart', function () { followUser = false; });
    map.on('zoomstart', function () { if (!programmatic) followUser = false; });
    tiles = L.tileLayer(MAP_TILES.url, { maxZoom: MAP_TILES.maxZoom, attribution: MAP_TILES.attribution, referrerPolicy: 'strict-origin-when-cross-origin' }).addTo(map);
    tiles.on('tileerror', onTileError);
    tiles.on('tileload', onTileLoad);
    updateMapStyle();
    updateMapStatus();
  }

  // ---------- Kartenstatus: Hinweis, wenn Kacheln nicht laden ----------
  // Fälle: kein Internet, Kartenserver gesperrt/überlastet, Leaflet nicht geladen.
  // Die Route zu Google Maps hängt nicht an der Karte und funktioniert immer.
  var tileFails = 0, tilesOk = false;
  function onTileError() { tileFails++; updateMapStatus(); }
  function onTileLoad() { tileFails = 0; tilesOk = true; updateMapStatus(); }
  function updateMapStatus() {
    var el = $('mapStatus'), msg = '';
    if (typeof L === 'undefined') msg = 'Karte nicht geladen – Route funktioniert trotzdem';
    else if (navigator.onLine === false) msg = 'Offline – Karte braucht Internet, Route geht trotzdem';
    else if (tileFails >= TILE_FAIL_LIMIT) msg = 'Karte gerade nicht verfügbar – Route funktioniert trotzdem';
    el.textContent = msg;
    el.hidden = !msg;
    if (sheetCollapsed) setSheetY(collapsedOffset());   // Höhe des eingeklappten Panels anpassen
  }
  window.addEventListener('offline', updateMapStatus);
  window.addEventListener('online', function () {
    tileFails = 0; updateMapStatus();
    if (tiles) tiles.redraw();   // fehlgeschlagene Kacheln neu laden
  });
  function updateMapStyle() {
    if (!map) return;
    document.getElementById('map').classList.toggle('map-dark', isDark());
    if (line) line.setStyle({ color: cssVar('--route') });
  }
  var carIcon = function () {
    return L.divIcon({ className: '', iconSize: [52, 60], iconAnchor: [26, 60],
      html: '<div class="car-pin"><div class="bubble"><svg class="i"><use href="#i-car"/></svg></div><div class="tip"></div></div>' });
  };
  var meIcon = function () { return L.divIcon({ className: '', iconSize: [22, 22], iconAnchor: [11, 11], html: '<div class="me"></div>' }); };

  function drawCar() {
    if (!map || !parking) return;
    var ll = [parking.lat, parking.lng];
    if (!carMarker) carMarker = L.marker(ll, { icon: carIcon(), keyboard: false, title: 'Dein Auto' }).addTo(map);
    else carMarker.setLatLng(ll);
  }
  function updateUser() {
    if (map && lastFix) {
      var ll = [lastFix.lat, lastFix.lng];
      if (!meMarker) meMarker = L.marker(ll, { icon: meIcon(), keyboard: false, interactive: false, zIndexOffset: -10 }).addTo(map);
      else meMarker.setLatLng(ll);
      if (parking) {
        var pts = [ll, [parking.lat, parking.lng]];
        if (!line) line = L.polyline(pts, { color: cssVar('--route'), weight: 4, dashArray: '1 10', lineCap: 'round', interactive: false }).addTo(map);
        else line.setLatLngs(pts);
      }
      if (followUser && current === 'map') fitView();
    }
    refreshStats();
  }
  var programmatic = false;
  function fitView() {
    if (!map || !parking) return;
    programmatic = true; setTimeout(function () { programmatic = false; }, 600);
    var car = L.latLng(parking.lat, parking.lng);
    var sheetH = visibleSheetHeight() || 320;
    if (lastFix && haversine(lastFix, parking) < 15000) {
      map.fitBounds(L.latLngBounds([car, [lastFix.lat, lastFix.lng]]), {
        paddingTopLeft: [50, 120], paddingBottomRight: [50, sheetH + 40], maxZoom: 18
      });
    } else {
      map.setView(car, 17);
      map.panBy([0, sheetH / 2 - 40], { animate: false });
    }
  }
  $('fitBtn').addEventListener('click', function () { followUser = true; fitView(); });

  // ---------- Werte im Sheet ----------
  // Google-Maps-Link für die Fußroute.
  // Android: direkt die Google-Maps-App öffnen (intent mit Paketname) – kein Auswahldialog,
  // keine Web-Version. Ist die App nicht installiert, greift automatisch die Web-Adresse.
  var IS_ANDROID = /Android/i.test(navigator.userAgent);
  function routeUrl() {
    if (!parking) return '#';
    var dest = parking.lat.toFixed(6) + ',' + parking.lng.toFixed(6);
    var path = 'www.google.com/maps/dir/?api=1&destination=' + dest + '&travelmode=walking';
    var web = 'https://' + path;
    if (!IS_ANDROID) return web;
    return 'intent://' + path + '#Intent;scheme=https;package=com.google.android.apps.maps;' +
      'S.browser_fallback_url=' + encodeURIComponent(web) + ';end';
  }

  function refreshStats() {
    if (!parking) return;
    $('since').textContent = fmtSince(parking.ts);
    $('parkedAt').textContent = fmtParkedAt(parking.ts);
    $('statAcc').textContent = '± ' + Math.round(parking.acc) + ' m';
    if (lastFix) {
      var d = haversine(lastFix, parking);
      $('statDist').textContent = fmtDist(d);
      if (!$('routePrompt').hidden) $('routePromptInfo').textContent = fmtDist(d) + ' · ' + (d < 15 ? 'Du bist schon da!' : fmtWalk(d) + ' zu Fuß');
      $('statWalk').textContent = d < 15 ? 'Da!' : fmtWalk(d);
    } else {
      $('statDist').textContent = '–'; $('statWalk').textContent = '–';
    }
    var url = routeUrl();
    ['routeBtn', 'routeMini', 'routePromptGo'].forEach(function (id) {
      var a = $(id); if (!a) return;
      a.href = url;
      if (IS_ANDROID) a.removeAttribute('target'); else a.target = '_blank';
    });
  }
  setInterval(refreshStats, 30000);

  // ---------- Ausklappbares Info-Panel ----------
  var SHEET_KEY = 'carfinder.sheetCollapsed';
  var sheet = document.querySelector('.sheet'), sheetHead = $('sheetHead'), sheetBody = $('sheetBody'), sheetHandle = $('sheetHandle');
  var sheetCollapsed = store.get(SHEET_KEY) === true;
  var sheetY = 0;
  function collapsedOffset() {
    var padB = parseFloat(getComputedStyle(sheet).paddingBottom) || 0;
    return Math.max(0, sheet.offsetHeight - (sheetHead.offsetTop + sheetHead.offsetHeight) - padB);
  }
  function setSheetY(y) { sheetY = y; sheet.style.setProperty('--sheet-y', y + 'px'); }
  function visibleSheetHeight() { return sheet.offsetHeight - sheetY; }
  function setSheet(collapsed, refit) {
    sheetCollapsed = collapsed;
    setSheetY(collapsed ? collapsedOffset() : 0);
    sheet.classList.toggle('collapsed', collapsed);
    sheetBody.inert = collapsed;
    $('routeMini').tabIndex = collapsed ? 0 : -1;
    sheetHandle.setAttribute('aria-expanded', String(!collapsed));
    sheetHandle.setAttribute('aria-label', collapsed ? 'Details ausklappen' : 'Details einklappen');
    store.set(SHEET_KEY, collapsed);
    if (refit && followUser) setTimeout(fitView, 420);
  }
  var drag = null;
  function sheetDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    if (e.target.closest('a') ) return;           // Klick auf den Route-Knopf nicht abfangen
    drag = { y0: e.clientY, t0: performance.now(), base: sheetY, max: collapsedOffset(), moved: false, y: sheetY };
    sheet.classList.add('dragging');
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) {}
  }
  function sheetMove(e) {
    if (!drag) return;
    var dy = e.clientY - drag.y0;
    if (Math.abs(dy) > 6) drag.moved = true;
    if (!drag.moved) return;
    drag.y = Math.min(drag.max, Math.max(0, drag.base + dy));
    setSheetY(drag.y);
  }
  function sheetUp(e) {
    if (!drag) return;
    sheet.classList.remove('dragging');
    var d = drag; drag = null;
    if (!d.moved) { setSheet(!sheetCollapsed, true); return; }
    var velocity = (e.clientY - d.y0) / Math.max(1, performance.now() - d.t0);   // px pro ms
    var collapse = Math.abs(velocity) > 0.4 ? velocity > 0 : d.y > d.max / 2;
    setSheet(collapse, true);
  }
  [sheetHandle, sheetHead].forEach(function (el) {
    el.addEventListener('pointerdown', sheetDown);
    el.addEventListener('pointermove', sheetMove);
    el.addEventListener('pointerup', sheetUp);
    el.addEventListener('pointercancel', sheetUp);
  });
  // Tastatur: Enter/Leertaste auf dem Griff
  sheetHandle.addEventListener('click', function (e) { if (e.detail === 0) setSheet(!sheetCollapsed, true); });
  window.addEventListener('resize', function () { if (sheetCollapsed) setSheetY(collapsedOffset()); });

  // ---------- Info-Dialog „Über & Datenschutz“ ----------
  var deleteArmed = null;
  function disarmDelete() {
    clearTimeout(deleteArmed); deleteArmed = null;
    $('deleteParkingLabel').textContent = 'Parkplatz löschen';
  }
  function openInfo() {
    disarmDelete();
    $('deleteParking').hidden = !parking;
    $('infoPrompt').hidden = false;
    var card = $('infoPrompt').querySelector('.info-card');
    card.scrollTop = 0; card.focus();
  }
  function closeInfo() { disarmDelete(); $('infoPrompt').hidden = true; }
  function deleteParking() {
    // Zweistufig: erster Tipp fragt nach, zweiter Tipp löscht
    if (!deleteArmed) {
      $('deleteParkingLabel').textContent = 'Wirklich löschen?';
      deleteArmed = setTimeout(disarmDelete, 4000);
      return;
    }
    disarmDelete();
    parking = null;
    store.remove(PARK_KEY);
    if (map) {
      if (carMarker) { map.removeLayer(carMarker); carMarker = null; }
      if (line) { map.removeLayer(line); line = null; }
    }
    closeInfo();
    showScreen('park');
    toast('Parkplatz gelöscht.');
  }
  document.querySelectorAll('.info-btn').forEach(function (b) { b.addEventListener('click', openInfo); });
  $('infoClose').addEventListener('click', closeInfo);
  $('deleteParking').addEventListener('click', deleteParking);
  $('infoPrompt').addEventListener('click', function (e) { if (e.target === this) closeInfo(); });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (!$('replacePrompt').hidden) closeReplace();
    else if (!$('infoPrompt').hidden) closeInfo();
    else if (!$('routePrompt').hidden) closeRoutePrompt();
  });

  // ---------- Rückfrage „Parkplatz ersetzen?“ (Kurzbefehl/Link) ----------
  function closeReplace() { $('replacePrompt').hidden = true; }
  $('replaceYes').addEventListener('click', function () { closeReplace(); showScreen('park'); park(); });
  $('replaceNo').addEventListener('click', closeReplace);
  $('replacePrompt').addEventListener('click', function (e) { if (e.target === this) closeReplace(); });

  // ---------- Kurzbefehl-Dialog „Zu Fuß zum Auto“ ----------
  function openRoutePrompt() {
    refreshStats();
    var d = $('statDist').textContent, w = $('statWalk').textContent;
    $('routePromptInfo').textContent = (d && d !== '–') ? (d + ' · ' + w) : 'Dein Parkplatz ist gespeichert.';
    $('routePrompt').hidden = false;
  }
  function closeRoutePrompt() { $('routePrompt').hidden = true; }
  $('routePromptClose').addEventListener('click', closeRoutePrompt);
  $('routePromptGo').addEventListener('click', function () { setTimeout(closeRoutePrompt, 300); });
  $('routePrompt').addEventListener('click', function (e) { if (e.target === this) closeRoutePrompt(); });

  // ---------- Navigation zwischen Screens ----------
  var current = null;
  function showScreen(name) {
    current = name;
    $('screen-park').classList.toggle('active', name === 'park');
    $('screen-map').classList.toggle('active', name === 'map');
    $('backToMap').hidden = !(name === 'park' && parking);
    if (name === 'map') {
      followUser = true;
      refreshStats();
      setSheet(sheetCollapsed, false);
      ensureMap();
      if (map) {
        map.invalidateSize();
        drawCar(); updateUser(); fitView();
        setTimeout(function () { map.invalidateSize(); fitView(); }, 380);
      } else {
        refreshStats();
        updateMapStatus();
        toast('Karte konnte nicht geladen werden – Route funktioniert trotzdem.');
      }
    }
  }
  $('parkBtn').addEventListener('click', park);
  $('reparkBtn').addEventListener('click', function () { showScreen('park'); });
  $('backToMap').addEventListener('click', function () { showScreen('map'); });

  // ---------- Start ----------
  applyTheme();
  startWatch();
  if (parking) requestPersist();
  var params = new URLSearchParams(location.search);
  var action = params.get('action');
  if (action) history.replaceState(null, '', location.pathname);
  if (action === 'park') {
    // Schutz: Ein fremder Link mit ?action=park darf einen gespeicherten
    // Parkplatz nicht ungefragt überschreiben. Ohne Parkplatz: sofort speichern.
    if (parking) {
      showScreen('map');
      $('replaceInfo').textContent = 'Aktuell gespeichert: ' + fmtParkedAt(parking.ts).replace('Geparkt am ', '') + '.';
      $('replacePrompt').hidden = false;
      $('replaceNo').focus();
    } else {
      showScreen('park');
      park();
    }
  } else if (action === 'route') {
    // Kurzbefehl „Zu Fuß zum Auto“: direkt die Google-Maps-Fußroute öffnen
    if (parking) {
      showScreen('map');
      openRoutePrompt();
    } else {
      showScreen('park');
      toast('Noch kein Parkplatz gespeichert.', 3500);
    }
  } else {
    showScreen(parking ? 'map' : 'park');
  }

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }
})();
