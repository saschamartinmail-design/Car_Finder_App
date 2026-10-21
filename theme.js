// Car Finder – Farbschema früh setzen, damit nichts aufblitzt (vor dem CSS-Rendern geladen)
(function () {
  try {
    var t = localStorage.getItem('carfinder.theme');
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  } catch (e) {}
})();
