// 更新のお知らせ（開いたときに一度だけ）。仕様変更があれば announce-data.json の先頭に追加する。
(function () {
  "use strict";
  var store = {
    get: function (k, d) { try { var v = localStorage.getItem("bikerun:" + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem("bikerun:" + k, JSON.stringify(v)); } catch (e) { /* 保存できない環境では無視 */ } }
  };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };

  function show(e) {
    var html = '<div class="lbox" role="dialog" aria-modal="true" aria-label="お知らせ"><div class="shead">' +
      "<h3>" + esc(e.title || "お知らせ") + '</h3><button type="button" data-an="close" aria-label="閉じる">✕</button></div>' +
      (e.body || []).map(function (t) { return "<p>" + esc(t) + "</p>"; }).join("") +
      '<label><input type="checkbox" id="an-dontshow"> 今後表示しない</label>' +
      '<button class="btn" type="button" data-an="close">閉じる</button></div>';
    var d = document.createElement("div");
    d.id = "announce"; d.innerHTML = html;
    document.body.appendChild(d);
    d.addEventListener("click", function (ev) {
      if (ev.target.closest('[data-an="close"]')) {
        if (d.querySelector("#an-dontshow").checked) store.set("announceSeen", e.id);
        d.remove();
      }
    });
  }

  function checkAndShow() {
    fetch("announce-data.json", { cache: "no-store" }).then(function (r) { return r.json(); }).then(function (list) {
      var e = Array.isArray(list) ? list[0] : null; if (!e) return;
      if (store.get("announceSeen", null) !== e.id) show(e);
    }).catch(function () { /* オフライン等は無視 */ });
  }
  window.TTAnnounce = { checkAndShow: checkAndShow };
})();
