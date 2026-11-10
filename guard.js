// スマホで画面が勝手に拡大・移動・選択されないようにする（ゲームの操作は止めない）
(function () {
  "use strict";
  var inScrollable = function (t) { return t && t.closest && t.closest(".card, .lbox"); };
  var isControl = function (t) { return t && t.closest && t.closest("button, a, input, label, select, textarea"); };

  // iPhoneは「拡大禁止」の指定を無視するので、ピンチ（2本指）の操作そのものを止める
  ["gesturestart", "gesturechange", "gestureend"].forEach(function (n) {
    document.addEventListener(n, function (e) { e.preventDefault(); }, { passive: false });
  });
  document.addEventListener("touchstart", function (e) {
    if (e.touches.length > 1) { e.preventDefault(); return; }
    // 長押しの虫眼鏡・文字選択・ダブルタップ拡大を防ぐ（ボタンは普通に押せる。ゲームの操作は別の仕組みで受け取る）
    if (!isControl(e.target) && !inScrollable(e.target)) e.preventDefault();
  }, { passive: false });
  // スクロール・端のゴムのような引っぱり・引っぱって再読み込み
  document.addEventListener("touchmove", function (e) {
    if (e.touches.length > 1 || !inScrollable(e.target)) e.preventDefault();
  }, { passive: false });
  var lastEnd = 0;
  document.addEventListener("touchend", function (e) {
    var now = Date.now();
    if (now - lastEnd < 350 && !isControl(e.target)) e.preventDefault(); // すばやい2回タップでの拡大
    lastEnd = now;
  }, { passive: false });
  document.addEventListener("dblclick", function (e) { e.preventDefault(); }, { passive: false });
  document.addEventListener("contextmenu", function (e) { e.preventDefault(); }); // 長押しメニュー
  document.addEventListener("selectstart", function (e) { if (!isControl(e.target)) e.preventDefault(); });
  document.addEventListener("dragstart", function (e) { e.preventDefault(); }); // 画像を引っぱって動かす
  // パソコンのCtrl＋ホイール／Ctrl＋キーでの拡大と、スペースや矢印キーでのスクロール
  document.addEventListener("wheel", function (e) { if (e.ctrlKey) e.preventDefault(); }, { passive: false });
  document.addEventListener("keydown", function (e) {
    if ((e.ctrlKey || e.metaKey) && ["+", "-", "=", "0", ";"].indexOf(e.key) >= 0) e.preventDefault();
    if ([" ", "ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"].indexOf(e.key) >= 0 && !isControl(e.target)) e.preventDefault();
  });
  // それでも何かの拍子にずれたら、すぐ元に戻す
  window.addEventListener("scroll", function () { if (window.scrollX || window.scrollY) window.scrollTo(0, 0); });
})();
