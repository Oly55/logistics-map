/* 물류센터 지도 — 수도권 물류센터 DB / 거래사례 (카카오맵) */
(function () {
  'use strict';

  var CFG = window.MAP_CONFIG || {};
  var PW_KEY = 'lmap_pw_v1';
  var PAGE = 200;

  var REGION_COLORS = ['#2747a8', '#0e8f7b', '#d4682a', '#7a4fb5', '#c8302f', '#1b88ad', '#a26a00', '#7b8494', '#3aa564', '#e5484d'];
  var GRADE_COLORS = { '굿딜': '#1f7a4d', '평범': '#3354c4', '별로': '#c8302f', 'KS captive': '#7b8494', '진행중': '#d4682a', '기타': '#b9c0cc' };
  var AREA_CHIPS = { centers: [0, 5000, 10000, 20000, 30000, 50000], deals: [0, 10000, 20000, 30000] };

  var S = {
    data: null, tab: 'centers', map: null, dots: [], info: null, limit: PAGE,
    sel: { centers: null, deals: null },
    f: {
      centers: { min: 10000, max: null, regions: {}, q: '', sort: 'area', dir: -1 },
      deals: { min: null, max: null, grades: {}, years: {}, types: {}, q: '', sort: 'when', dir: -1 }
    }
  };

  /* ---------------- 유틸 ---------------- */
  function $(id) { return document.getElementById(id); }
  function store(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* 저장 불가 환경 */ } }
  function loadStore(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function num(v) { var n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, '')); return isNaN(n) ? null : n; }
  function fmt(n) { return n == null ? '-' : Math.round(n).toLocaleString('ko-KR'); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function ymd(s) { s = String(s || '').trim(); var m = /^(\d{4})[-.]?(\d{2})[-.]?(\d{2})$/.exec(s); return m ? m[1] + '.' + m[2] + '.' + m[3] : s; }
  function has(s) { s = String(s == null ? '' : s).trim(); return s !== '' && s !== '-' && s !== '0' && s !== '??'; }
  function clean(s) { return has(s) ? String(s).trim() : ''; }
  function stripNo(s) { return String(s || '').replace(/^\d+\./, ''); }
  function index(headers) { var m = {}; headers.forEach(function (h, i) { h = String(h).trim(); if (m[h] === undefined) m[h] = i; }); return m; }
  function g(set, row, name) { var i = set.ix[name]; return i === undefined ? '' : (row.v[i] == null ? '' : String(row.v[i])); }
  function dist(a, b) {
    var R = 6371000, toR = Math.PI / 180;
    var dLat = (b.lat - a.lat) * toR, dLng = (b.lng - a.lng) * toR;
    var x = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.sqrt(x));
  }
  function hasXY(r) { return typeof r.lat === 'number' && typeof r.lng === 'number' && r.lat && r.lng; }

  /* ---------------- 시작 ---------------- */
  function boot() {
    bindStatic();
    if (!CFG.apiUrl) { showGate('config.js에 apiUrl(Apps Script 웹 앱 주소)이 비어 있습니다.'); return; }
    var saved = loadStore(PW_KEY);
    if (saved) unlock(saved, true); else showGate('');
  }

  function bindStatic() {
    $('gateForm').addEventListener('submit', function (e) { e.preventDefault(); unlock($('pw').value, false); });
    $('logout').addEventListener('click', function () { store(PW_KEY, null); location.reload(); });
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (b) {
      b.addEventListener('click', function () { switchTab(b.getAttribute('data-tab')); });
    });
    $('more').addEventListener('click', function () { S.limit += PAGE; renderList(filtered()); });
  }

  function showGate(msg) {
    $('gate').hidden = false;
    $('gateErr').textContent = msg || '';
    setTimeout(function () { try { $('pw').focus(); } catch (e) { /* noop */ } }, 50);
  }

  function unlock(pw, silent) {
    if (!pw) return;
    $('go').disabled = true;
    $('gateErr').textContent = silent ? '' : '불러오는 중…';
    var url = CFG.apiUrl + (CFG.apiUrl.indexOf('?') >= 0 ? '&' : '?') + 'k=' + encodeURIComponent(pw) + '&t=' + Date.now();
    fetch(url, { redirect: 'follow' }).then(function (r) { return r.json(); }).then(function (d) {
      $('go').disabled = false;
      if (!d || !d.ok) {
        if (silent) store(PW_KEY, null);
        showGate((d && d.message) || '데이터를 불러오지 못했습니다.');
        return;
      }
      if (!silent && $('remember').checked) store(PW_KEY, pw);
      $('gate').hidden = true;
      prep(d);
      renderNews(d.news || []);
      S.kakaoKey = CFG.kakaoKey || d.kakaoJsKey || '';
      loadKakao(function () { initMap(); switchTab(S.tab); });
    }).catch(function (err) {
      $('go').disabled = false;
      showGate('서버에 연결하지 못했습니다. (' + (err && err.message ? err.message : err) + ')');
    });
  }

  function loadKakao(cb) {
    if (window.kakao && window.kakao.maps && window.kakao.maps.Map) { cb(); return; }
    if (!S.kakaoKey) { fatal('카카오 JavaScript 키가 없습니다. Apps Script 스크립트 속성 KAKAO_JS_KEY를 확인하세요.'); return; }
    var s = document.createElement('script');
    s.src = 'https://dapi.kakao.com/v2/maps/sdk.js?autoload=false&appkey=' + encodeURIComponent(S.kakaoKey);
    s.onload = function () {
      try { window.kakao.maps.load(cb); } catch (e) { fatal('카카오 지도를 불러오지 못했습니다. JavaScript 키와 사이트 도메인 등록을 확인하세요.'); }
    };
    s.onerror = function () { fatal('카카오 지도 스크립트를 불러오지 못했습니다. JavaScript 키와 사이트 도메인 등록을 확인하세요.'); };
    document.head.appendChild(s);
  }

  function fatal(msg) {
    $('map').innerHTML = '<div style="padding:24px;color:#c62828">' + esc(msg) + '</div>';
  }

  /* ---------------- 데이터 가공 ---------------- */
  function prep(d) {
    var C = d.centers, D = d.deals;
    C.ix = index(C.headers); D.ix = index(D.headers);
    var regions = {};
    C.rows.forEach(function (r) {
      r.kind = 'centers'; r.id = 'c' + r.r;
      r.name = g(C, r, '건물명') || '(이름 없음)';
      r.area = num(g(C, r, '연면적(평)')) || 0;
      r.region = clean(g(C, r, '권역')) || '미상';
      r.owner = clean(g(C, r, '현 소유자'));
      r.demolished = has(g(C, r, '멸실일자'));
      r.done = g(C, r, '준공일');
      r.text = [r.name, r.owner, g(C, r, '매도인(or 시행자)'), g(C, r, '소재지(도로명)'), g(C, r, '소재지(지번)'), g(C, r, '비고'), g(C, r, '시군')].join(' ').toLowerCase();
      regions[r.region] = (regions[r.region] || 0) + 1;
    });
    C.regionList = Object.keys(regions).sort();
    C.regionColor = {};
    C.regionList.forEach(function (k, i) { C.regionColor[k] = REGION_COLORS[i % REGION_COLORS.length]; S.f.centers.regions[k] = true; });

    var types = {}, years = {};
    var typeCol = D.headers[1] !== undefined ? 1 : null;  // 'No' 열 = 구분(VA/Core/NPL…)
    D.rows.forEach(function (r) {
      r.kind = 'deals'; r.id = 'd' + r.r;
      r.name = g(D, r, '프로젝트') || '(이름 없음)';
      r.area = num(g(D, r, '연면적(평)')) || 0;
      r.when = clean(g(D, r, '거래시기'));
      r.year = yearOf(r.when);
      r.type = typeCol !== null ? (clean(r.v[typeCol]) || '기타') : '기타';
      r.price = num(g(D, r, '매매가(억원)'));
      r.text = [r.name, g(D, r, '주소'), g(D, r, '매도자'), g(D, r, '매수자'), g(D, r, '투자자'), g(D, r, '주요 임차인'), g(D, r, '비고')].join(' ').toLowerCase();
      types[r.type] = 1; years[r.year] = 1;
    });
    D.typeList = Object.keys(types).sort(function (a, b) { return a === '기타' ? 1 : b === '기타' ? -1 : a.localeCompare(b); });
    D.yearList = Object.keys(years).sort(function (a, b) { return a === '진행중' ? -1 : b === '진행중' ? 1 : b.localeCompare(a); });
    D.typeList.forEach(function (k) { S.f.deals.types[k] = true; });
    D.yearList.forEach(function (k) { S.f.deals.years[k] = true; });
    (D.grades || Object.keys(GRADE_COLORS)).forEach(function (k) { S.f.deals.grades[k] = true; });

    S.data = d;
    var up = function (s) { return String(s || '').replace(/^Update\s*:\s*/i, ''); };
    S.stampText = { centers: 'DB ' + (up(C.updated) || '-') + ' 기준', deals: '거래사례 ' + (up(D.updated) || '-') + ' 기준' };
    $('stamp').textContent = '불러온 시각 ' + (d.generatedAt || '');
  }

  function yearOf(w) {
    if (!w) return '미상';
    if (w.indexOf('진행') >= 0) return '진행중';
    var m = /^(\d{2})\.\dQ/.exec(w) || /^(\d{2})[.\-년]/.exec(w);
    if (m) return '20' + m[1];
    m = /(20\d{2})/.exec(w);
    return m ? m[1] : '미상';
  }

  /* ---------------- 지도 ---------------- */
  function initMap() {
    if (S.map) return;
    var k = window.kakao.maps;
    S.map = new k.Map($('map'), { center: new k.LatLng(37.33, 127.22), level: 10 });
    S.map.addControl(new k.ZoomControl(), k.ControlPosition.RIGHT);
    k.event.addListener(S.map, 'zoom_changed', function () { hideHover(); resizeDots(); });
    k.event.addListener(S.map, 'click', closeInfo);
  }

  function zoomFactor() {
    var lv = S.map ? S.map.getLevel() : 10;
    return lv >= 12 ? 0.85 : lv <= 6 ? 1.15 : 1;
  }
  // 원 크기: 연면적에 따라 아주 약간만 차이(약 9~15px)
  function baseSize(area) { var t = (Math.sqrt(area || 0) - 30) / 360; return 9 + 6 * Math.max(0, Math.min(1, t)); }
  function dotSize(area) { return baseSize(area) * zoomFactor(); }
  function colorOf(r) {
    if (r.kind === 'centers') return S.data.centers.regionColor[r.region] || '#888';
    return GRADE_COLORS[r.grade] || GRADE_COLORS['기타'];
  }

  function draw() {
    var k = window.kakao.maps;
    S.dots.forEach(function (d) { d.ov.setMap(null); });
    S.dots = [];
    closeInfo();
    var list = filtered();
    var onMap = list.filter(hasXY).sort(function (a, b) { return b.area - a.area; });
    onMap.forEach(function (r, i) {
      var el = document.createElement('div');
      el.className = 'dot' + (S.sel[S.tab] === r ? ' sel' : '');
      var sz = dotSize(r.area);
      el.style.width = el.style.height = sz + 'px';
      el.style.background = colorOf(r);
      el.addEventListener('mouseenter', function () { showHover(r); });
      el.addEventListener('mouseleave', hideHover);
      el.addEventListener('click', function (e) { e.stopPropagation(); select(r, false); });
      var ov = new k.CustomOverlay({ position: new k.LatLng(r.lat, r.lng), content: el, xAnchor: 0.5, yAnchor: 0.5, zIndex: 10 + i, clickable: true });
      ov.setMap(S.map);
      S.dots.push({ ov: ov, el: el, r: r });
    });
    var noXY = list.length - onMap.length;
    var tip = $('maptip');
    tip.style.display = noXY ? 'block' : 'none';
    tip.textContent = noXY ? '좌표가 없는 ' + noXY + '곳은 아래 목록에만 표시됩니다' : '';
    renderCount(list, onMap.length);
    renderKpis(list);
    renderPanel();
    S.limit = PAGE;
    renderList(list);
    if (S.sel[S.tab] && hasXY(S.sel[S.tab]) && list.indexOf(S.sel[S.tab]) >= 0) openInfo(S.sel[S.tab]);
  }

  function resizeDots() {
    S.dots.forEach(function (d) { var sz = dotSize(d.r.area); d.el.style.width = d.el.style.height = sz + 'px'; });
    if (S.info) openInfo(S.info.r);
  }

  // 마우스를 올리면 한 줄 요약(센터명, 준공연월, 면적, 상온/복합/저온, 특이사항)
  function yymm(s) { var d = String(s || '').replace(/[^0-9]/g, ''); return d.length >= 6 ? d.slice(2, 4) + '.' + d.slice(4, 6) : ''; }
  function hoverText(r) {
    var parts;
    if (r.kind === 'centers') {
      var C = S.data.centers;
      parts = [r.name, yymm(r.done) ? yymm(r.done) + '준공' : '', r.area ? (r.area / 10000).toFixed(1) + '만평' : '', clean(g(C, r, '용도')), clean(g(C, r, '비고'))];
    } else {
      var D = S.data.deals;
      parts = [r.name, r.when, r.area ? (r.area / 10000).toFixed(1) + '만평' : '', clean(g(D, r, '상/저온')), has(g(D, r, '매매가(억원)')) ? g(D, r, '매매가(억원)') + '억' : '', clean(g(D, r, '비고'))];
    }
    var t = parts.filter(Boolean).join(', ');
    return t.length > 70 ? t.slice(0, 69) + '…' : t;
  }
  function showHover(r) {
    hideHover();
    if (S.info && S.info.r === r) return;
    var k = window.kakao.maps;
    var wrap = document.createElement('div');
    wrap.className = 'hover-wrap';
    wrap.style.paddingBottom = (dotSize(r.area) / 2 + 6) + 'px';
    var box = document.createElement('div');
    box.className = 'hover';
    box.textContent = hoverText(r);
    wrap.appendChild(box);
    S.hover = new k.CustomOverlay({ position: new k.LatLng(r.lat, r.lng), content: wrap, xAnchor: 0.5, yAnchor: 1, zIndex: 99999 });
    S.hover.setMap(S.map);
    if (wrap.parentElement) wrap.parentElement.style.pointerEvents = 'none';   // 마우스를 가로채 깜빡이지 않도록
  }
  function hideHover() { if (S.hover) { S.hover.setMap(null); S.hover = null; } }

  function select(r, pan) {
    hideHover();
    S.sel[S.tab] = r;
    S.dots.forEach(function (d) { d.el.classList.toggle('sel', d.r === r); });
    if (hasXY(r)) {
      if (pan) S.map.panTo(new window.kakao.maps.LatLng(r.lat, r.lng));
      openInfo(r);
    } else {
      closeInfo();
    }
    renderDetail(r);
    markListRow(r);
  }

  function closeInfo() {
    if (S.info) { S.info.ov.setMap(null); S.info = null; }
  }

  function openInfo(r) {
    closeInfo();
    var k = window.kakao.maps;
    var wrap = document.createElement('div');
    wrap.style.paddingBottom = (dotSize(r.area) / 2 + 10) + 'px';
    wrap.innerHTML = '<div class="ibox">' + infoHtml(r) + '</div>';
    wrap.querySelector('.x').addEventListener('click', function (e) { e.stopPropagation(); closeInfo(); });
    wrap.querySelector('.go').addEventListener('click', function (e) { e.stopPropagation(); $('detail').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    wrap.addEventListener('mousedown', function (e) { e.stopPropagation(); });
    var ov = new k.CustomOverlay({ position: new k.LatLng(r.lat, r.lng), content: wrap, xAnchor: 0.5, yAnchor: 1, zIndex: 100000, clickable: true });
    ov.setMap(S.map);
    S.info = { ov: ov, r: r };
  }

  function row(label, val) { return has(val) ? '<tr><td>' + esc(label) + '</td><td>' + esc(val) + '</td></tr>' : ''; }

  function infoHtml(r) {
    var h = '<button class="x" title="닫기">×</button><h3>' + esc(r.name) + '</h3>';
    if (r.kind === 'centers') {
      var C = S.data.centers;
      h += '<div class="tags"><span class="pill" style="color:' + colorOf(r) + '">' + esc(stripNo(r.region)) + '</span>' + (has(g(C, r, '용도')) ? '<span class="tag">' + esc(g(C, r, '용도')) + '</span>' : '') + (r.demolished ? '<span class="tag">멸실</span>' : '') + '</div><table>';
      h += row('연면적', fmt(r.area) + '평');
      h += row('현 소유자', r.owner);
      h += row('준공', ymd(r.done));
      var price = clean(g(C, r, '거래가격(억원)'));
      if (price) h += row('최근 거래', [clean(g(C, r, '최근 거래시점')), price + '억', clean(g(C, r, '평단가')) && g(C, r, '평단가') !== '0' ? '@' + g(C, r, '평단가') + '만' : '', clean(g(C, r, 'Cap.'))].filter(Boolean).join(' · '));
      h += row('비고', clean(g(C, r, '비고')));
      h += '</table>';
    } else {
      var D = S.data.deals;
      h += '<div class="tags"><span class="pill" style="color:' + colorOf(r) + '">' + esc(r.grade) + '</span><span class="tag">' + esc(r.type) + '</span>' + (has(g(D, r, '거래유형')) ? '<span class="tag">' + esc(g(D, r, '거래유형')) + '</span>' : '') + '</div><table>';
      h += row('거래시기', r.when);
      h += row('연면적', r.area ? fmt(r.area) + '평' : '');
      h += row('매매가', has(g(D, r, '매매가(억원)')) ? g(D, r, '매매가(억원)') + '억' + (has(g(D, r, '평단가(만원)')) ? ' (@' + g(D, r, '평단가(만원)') + '만)' : '') : '');
      h += row('Cap', clean(g(D, r, 'Cap.rate')));
      h += row('매도→매수', [clean(g(D, r, '매도자')), clean(g(D, r, '매수자'))].filter(Boolean).join(' → '));
      h += row('임차인', clean(g(D, r, '주요 임차인')));
      h += '</table>';
    }
    return h + '<button class="go">세부 내용 보기 ↓</button>';
  }

  /* ---------------- 필터 ---------------- */
  // skip: 이 범주 필터는 무시(패널 개수 계산용)
  function passes(r, f, q, skip) {
    if (f.min != null && f.min !== '' && r.area < f.min) return false;
    if (f.max != null && f.max !== '' && r.area > f.max) return false;
    if (q && r.text.indexOf(q) < 0) return false;
    if (r.kind === 'centers') {
      if (r.demolished) return false;
      if (skip !== 'regions' && !f.regions[r.region]) return false;
    } else {
      if (skip !== 'grades' && !f.grades[r.grade]) return false;
      if (skip !== 'years' && !f.years[r.year]) return false;
      if (skip !== 'types' && !f.types[r.type]) return false;
    }
    return true;
  }

  function filtered(skip) {
    if (!S.data) return [];
    var f = S.f[S.tab];
    var q = (f.q || '').trim().toLowerCase();
    return S.data[S.tab].rows.filter(function (r) { return passes(r, f, q, skip); });
  }

  function areaLabel(v) { return !v ? '전체' : (v % 10000 === 0 ? (v / 10000) + '만평↑' : (v / 1000) + '천평↑'); }

  function renderFilters() {
    var f = S.f[S.tab], h = '';
    h += '<div class="fgroup"><span class="flabel">연면적</span><div class="seg" id="areaSeg">';
    AREA_CHIPS[S.tab].forEach(function (v) {
      var on = (f.min || 0) === v && (f.max == null || f.max === '');
      h += '<button class="' + (on ? 'on' : '') + '" data-min="' + v + '">' + areaLabel(v) + '</button>';
    });
    h += '</div><input class="num" id="fmin" type="number" placeholder="최소(평)" value="' + (f.min != null && f.min !== '' ? f.min : '') + '">';
    h += '<span class="muted">~</span><input class="num" id="fmax" type="number" placeholder="최대(평)" value="' + (f.max != null && f.max !== '' ? f.max : '') + '"></div>';
    h += '<div class="fgroup"><input class="search" id="fq" placeholder="' + (S.tab === 'centers' ? '건물명 · 소유자 · 주소 · 비고 검색' : '프로젝트 · 주소 · 매도/매수자 · 임차인 검색') + '" value="' + esc(f.q) + '"></div>';
    h += '<div class="count" id="count"></div>';
    var el = $('filters');
    el.innerHTML = h;

    el.querySelectorAll('[data-min]').forEach(function (b) {
      b.addEventListener('click', function () { f.min = Number(b.getAttribute('data-min')) || null; f.max = null; renderFilters(); draw(); });
    });
    var onNum = function () {
      var a = $('fmin').value, b = $('fmax').value;
      f.min = a === '' ? null : Number(a); f.max = b === '' ? null : Number(b);
      el.querySelectorAll('[data-min]').forEach(function (c) { c.classList.toggle('on', (f.min || 0) === Number(c.getAttribute('data-min')) && f.max == null); });
      draw();
    };
    $('fmin').addEventListener('change', onNum); $('fmax').addEventListener('change', onNum);
    var timer = null;
    $('fq').addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(function () { f.q = $('fq').value; draw(); }, 250); });
  }

  // 지도 오른쪽 패널: 표시 항목(권역/평가/거래시기/구분) + 원 크기 범례
  function renderPanel() {
    var f = S.f[S.tab], h = '';
    var countBy = function (skip, key) {
      var m = {};
      filtered(skip).forEach(function (r) { m[r[key]] = (m[r[key]] || 0) + 1; });
      return m;
    };
    var opts = function (group, keys, colors, counts, label) {
      var s = '';
      keys.forEach(function (k) {
        s += '<button class="opt' + (f[group][k] ? ' on' : '') + '" data-group="' + group + '" data-key="' + esc(k) + '"><span class="ck"></span>' +
          (colors ? '<span class="sw" style="background:' + colors[k] + '"></span>' : '') +
          '<span class="lbl">' + esc(label ? label(k) : k) + '</span><span class="n">' + fmt(counts[k] || 0) + '</span></button>';
      });
      return s;
    };
    var chips = function (group, keys, counts) {
      var s = '<div class="chips">';
      keys.forEach(function (k) { s += '<button class="chip' + (f[group][k] ? ' on' : '') + '" data-group="' + group + '" data-key="' + esc(k) + '">' + esc(k) + (counts[k] ? ' <span class="mono">' + counts[k] + '</span>' : '') + '</button>'; });
      return s + '</div>';
    };
    if (S.tab === 'centers') {
      var C = S.data.centers;
      h += '<div class="p-sec"><p class="p-title">지도에 표시할 권역</p><p class="p-hint">눌러서 켜고 끄기 · Shift+클릭은 그것만</p>' +
        opts('regions', C.regionList, C.regionColor, countBy('regions', 'region'), stripNo) + '</div>';
    } else {
      var D = S.data.deals;
      h += '<div class="p-sec"><p class="p-title">평가</p><p class="p-hint">시트의 셀 색 기준 · Shift+클릭은 그것만</p>' +
        opts('grades', Object.keys(GRADE_COLORS), GRADE_COLORS, countBy('grades', 'grade')) + '</div>';
      h += '<div class="p-sec"><p class="p-title">거래시기</p>' + chips('years', D.yearList, countBy('years', 'year')) + '</div>';
      h += '<div class="p-sec"><p class="p-title">구분</p>' + chips('types', D.typeList, countBy('types', 'type')) + '</div>';
    }
    h += '<div class="p-sec"><p class="p-title">원 크기</p><p class="p-hint">연면적이 클수록 약간 커집니다</p><div class="sizes">';
    [10000, 30000, 100000].forEach(function (a) {
      var s = baseSize(a);
      h += '<div><i style="width:' + s + 'px;height:' + s + 'px"></i>' + fmt(a / 10000) + '만평</div>';
    });
    h += '</div><p class="p-note">멸실된 센터는 표시하지 않습니다. 같은 위치의 작은 원은 큰 원 위에 그려집니다.</p></div>';
    var el = $('panel');
    el.innerHTML = h;
    el.querySelectorAll('[data-group]').forEach(function (b) {
      b.addEventListener('click', function (e) {
        var m = f[b.getAttribute('data-group')], key = b.getAttribute('data-key');
        if (e.shiftKey || e.altKey) {
          var only = Object.keys(m).every(function (x) { return m[x] === (x === key); });
          Object.keys(m).forEach(function (x) { m[x] = only ? true : x === key; });   // 이미 '그것만'이면 전체로
        } else m[key] = !m[key];
        draw();
      });
    });
  }

  function renderCount(list, onMap) {
    var total = S.data[S.tab].rows.filter(function (r) { return !r.demolished; }).length;
    var c = $('count');
    if (c) c.innerHTML = '<b>' + fmt(list.length) + '</b>' + (S.tab === 'centers' ? '곳' : '건') + ' / 전체 ' + fmt(total) + (list.length !== onMap ? ' · 지도 표시 ' + fmt(onMap) : '');
  }

  /* ---------------- 요약(한 줄 요약 + 작은 지표 카드) ---------------- */
  function tile(label, val, unit, sub, cls) {
    return '<div class="kpi"><span class="kpi-label">' + label + '</span><span class="kpi-val' + (cls ? ' ' + cls : '') + '">' + val + (unit ? '<small>' + unit + '</small>' : '') + '</span>' +
      (sub ? '<span class="kpi-sub">' + sub + '</span>' : '') + '</div>';
  }
  function man(n) { return (n / 10000).toFixed(1); }
  function median(a) { if (!a.length) return null; a = a.slice().sort(function (x, y) { return x - y; }); var m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; }
  function delta(n, unit) { return n > 0 ? '<span class="up">+' + fmt(n) + unit + '</span>' : n < 0 ? '<span class="dn">' + fmt(n) + unit + '</span>' : '±0' + unit; }
  function condText() {
    var f = S.f[S.tab], parts = [];
    if (f.min && (f.max == null || f.max === '')) parts.push('연면적 ' + areaLabel(f.min).replace('↑', ' 이상'));
    else if (f.min || f.max) parts.push('연면적 ' + (f.min ? fmt(f.min) : '0') + '~' + (f.max ? fmt(f.max) : '') + '평');
    ['regions', 'grades', 'years', 'types'].forEach(function (k) { if (f[k] && Object.keys(f[k]).some(function (x) { return !f[k][x]; })) parts.push('일부 ' + { regions: '권역', grades: '평가', years: '거래시기', types: '구분' }[k]); });
    if (f.q) parts.push("검색어 '" + esc(f.q) + "'");
    return parts.length ? parts.join(' · ') + ' 조건에서' : '전체 기준으로';
  }
  function qIndex(w) { var m = /^(\d{2})\.(\d)Q/.exec(w || ''); return m ? Number(m[1]) * 4 + Number(m[2]) - 1 : null; }
  function qLabel(i) { return String(Math.floor(i / 4)).padStart(2, '0') + '.' + (i % 4 + 1) + 'Q'; }

  function renderKpis(list) {
    var h = '', take = '';
    if (S.tab === 'centers') {
      var C = S.data.centers;
      var total = C.rows.filter(function (r) { return !r.demolished; }).length;
      var sum = list.reduce(function (a, r) { return a + (r.area || 0); }, 0);
      var areas = list.map(function (r) { return r.area; }).filter(Boolean);
      var big = list.filter(function (r) { return r.area >= 30000; });
      var yr = new Date().getFullYear();
      var recent = list.filter(function (r) { return Number(String(r.done).slice(0, 4)) >= yr - 2; });
      var traded = list.filter(function (r) { return has(g(C, r, '거래가격(억원)')); });
      var pp = traded.map(function (r) { return num(g(C, r, '평단가')); }).filter(function (x) { return x && x > 0; });
      var by = {};
      list.forEach(function (r) { by[r.region] = (by[r.region] || 0) + r.area; });
      var rank = Object.keys(by).sort(function (a, b) { return by[b] - by[a]; });
      var pct = function (k) { return sum ? Math.round(by[k] / sum * 100) : 0; };
      var areaSum = function (arr) { return man(arr.reduce(function (a, r) { return a + r.area; }, 0)); };
      h += tile('표시 센터', fmt(list.length), '곳', '전체 ' + fmt(total) + '곳 중');
      h += tile('연면적 합계', man(sum), '만평', '평균 ' + fmt(areas.length ? sum / areas.length : 0) + '평');
      h += tile('3만평 이상', fmt(big.length), '곳', '연면적 ' + areaSum(big) + '만평');
      h += tile('최근 3년 준공', fmt(recent.length), '곳', (yr - 2) + '~' + yr + ' · ' + areaSum(recent) + '만평');
      h += tile('최대 권역', rank.length ? esc(stripNo(rank[0])) : '-', '', rank.length ? '연면적 비중 ' + pct(rank[0]) + '%' : '', 'txt');
      h += tile('거래가 있는 센터', fmt(traded.length), '곳', '평단가 중앙값 ' + (pp.length ? fmt(median(pp)) + '만원' : '-'));
      take = condText() + ' 센터는 <b>' + fmt(list.length) + '곳</b>, 연면적 <b>' + man(sum) + '만평</b>입니다. ' +
        (rank.length ? '권역별로는 ' + rank.slice(0, 3).map(function (k) { return esc(stripNo(k)) + '(' + pct(k) + '%)'; }).join('·') + ' 순으로 크고, ' : '') +
        '최근 3년 준공은 <b>' + fmt(recent.length) + '곳 · ' + areaSum(recent) + '만평</b>입니다.';
      $('sumNote').textContent = S.stampText ? S.stampText.centers : '';
    } else {
      var D = S.data.deals;
      var done = list.filter(function (r) { return r.year !== '진행중'; });
      var priced = done.filter(function (r) { return r.price; });
      var amt = priced.reduce(function (a, r) { return a + r.price; }, 0);
      var pp2 = done.map(function (r) { return num(g(D, r, '평단가(만원)')); }).filter(function (x) { return x && x > 0; });
      var caps = done.map(function (r) { return num(g(D, r, 'Cap.rate')); }).filter(function (x) { return x && x > 0 && x < 20; });
      var qs = done.map(function (r) { return qIndex(r.when); }).filter(function (x) { return x != null; });
      var last = qs.length ? Math.max.apply(null, qs) : null;
      var inQ = function (lo, hi) { return done.filter(function (r) { var q = qIndex(r.when); return q != null && q >= lo && q <= hi; }); };
      var cur = last != null ? inQ(last - 3, last) : [], prev = last != null ? inQ(last - 7, last - 4) : [];
      var buyers = {};
      priced.forEach(function (r) { var b = clean(g(D, r, '매수자')); if (b) { buyers[b] = buyers[b] || { n: 0, a: 0 }; buyers[b].n++; buyers[b].a += r.price; } });
      var topB = Object.keys(buyers).sort(function (a, b) { return buyers[b].a - buyers[a].a; })[0];
      var money = function (v) { return v >= 10000 ? [(v / 10000).toFixed(2), '조원'] : [fmt(v), '억원']; };
      var m = money(amt);
      h += tile('완료 거래', fmt(done.length), '건', '진행중 ' + fmt(list.length - done.length) + '건');
      h += tile('거래금액 합계', m[0], m[1], '건당 평균 ' + fmt(priced.length ? amt / priced.length : 0) + '억원');
      h += tile('최근 4개 분기', fmt(cur.length), '건', last != null ? '직전 4개 분기 대비 ' + delta(cur.length - prev.length, '건') : '');
      h += tile('평단가 중앙값', pp2.length ? fmt(median(pp2)) : '-', '만원/평', '값이 있는 ' + pp2.length + '건 기준');
      h += tile('Cap 중앙값', caps.length ? median(caps).toFixed(2) : '-', '%', caps.length + '건 기준');
      h += tile('최대 매수자', topB ? esc(topB) : '-', '', topB ? buyers[topB].n + '건 · ' + fmt(buyers[topB].a) + '억원' : '', 'txt');
      take = condText() + ' 완료 거래는 <b>' + fmt(done.length) + '건</b>, 공개된 매매가 합 <b>' + m[0] + m[1] + '</b>이고 진행중 딜은 <b>' + fmt(list.length - done.length) + '건</b>입니다.' +
        (last != null ? ' 최근 4개 분기(' + qLabel(last - 3) + '~' + qLabel(last) + ') 거래는 <b>' + fmt(cur.length) + '건</b>으로 직전 4개 분기 ' + fmt(prev.length) + '건보다 ' + (cur.length > prev.length ? '늘었습니다.' : cur.length < prev.length ? '줄었습니다.' : '같습니다.') : '');
      $('sumNote').textContent = S.stampText ? S.stampText.deals : '';
    }
    $('kpis').innerHTML = h;
    $('take').innerHTML = take;
  }

  /* ---------------- 탭 ---------------- */
  function switchTab(tab) {
    S.tab = tab;
    $('mapLabel').textContent = tab === 'centers' ? '센터 위치' : '거래사례 위치';
    $('mapNote').textContent = tab === 'centers' ? '원 색 = 권역 · 크기 = 연면적 · 기본은 1만평 이상만 표시' : '원 색 = 평가(시트 셀 색) · 크기 = 연면적';
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (b) { b.classList.toggle('on', b.getAttribute('data-tab') === tab); });
    if (!S.data) return;
    renderFilters();
    draw();
    if (S.sel[tab]) renderDetail(S.sel[tab]);
    else $('detail').innerHTML = '<p class="empty">지도에서 원을 클릭하면 세부 내용이 여기에 표시됩니다.</p>';
  }

  /* ---------------- 상세 ---------------- */
  function kv(pairs) {
    var h = '';
    pairs.forEach(function (p) { if (has(p[1])) h += '<div class="k">' + esc(p[0]) + '</div><div class="v">' + esc(p[1]) + '</div>'; });
    return h ? '<div class="kv">' + h + '</div>' : '';
  }
  function dkpis(pairs) {
    var h = '';
    pairs.forEach(function (p) { if (has(p[1])) h += '<div><span>' + esc(p[0]) + '</span><b>' + esc(p[1]) + '</b></div>'; });
    return h ? '<div class="dkpis">' + h + '</div>' : '';
  }
  function card(title, body) { return body ? '<div class="box"><h4>' + esc(title) + '</h4>' + body + '</div>' : ''; }

  function renderDetail(r) {
    var el = $('detail');
    var h = '';
    if (r.kind === 'centers') h = centerDetail(r); else h = dealDetail(r);
    el.innerHTML = h;
    el.querySelectorAll('[data-jump]').forEach(function (b) {
      b.addEventListener('click', function () {
        var p = b.getAttribute('data-jump').split(':');
        var target = S.data[p[0]].rows.filter(function (x) { return x.id === p[1]; })[0];
        if (!target) return;
        if (S.tab !== p[0]) switchTab(p[0]);
        if (filtered().indexOf(target) < 0) { resetFiltersFor(p[0]); renderFilters(); draw(); }
        select(target, true);
        $('map').scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    });
  }

  function resetFiltersFor(tab) {
    var f = S.f[tab];
    f.min = null; f.max = null; f.q = '';
    ['regions', 'grades', 'years', 'types'].forEach(function (k) { if (f[k]) Object.keys(f[k]).forEach(function (x) { f[k][x] = true; }); });
  }

  function used(set, names) { var u = {}; names.forEach(function (n) { u[n] = 1; }); return u; }

  function rest(set, r, usedMap) {
    var pairs = [];
    set.headers.forEach(function (hname, i) {
      if (usedMap[hname]) return;
      var v = r.v[i];
      if (has(v)) pairs.push([hname, v]);
    });
    return kv(pairs);
  }

  function centerDetail(r) {
    var C = S.data.centers;
    var G = function (n) { return g(C, r, n); };
    var U = used(C, ['상태', '건물명', '매도인(or 시행자)', '현 소유자', '연면적(평)', '용도', '거래가격(억원)', '평단가', 'Cap.', '최근 거래시점', '비고', '준공일', '권역', '광역(특별)시·도', '시군', '구읍면', '동리', '본번', '부번', '대지면적(평)', '건축면적(평)', '2만평이상 flag', '연면적(평range)', '건폐율(%)', '용적률(%)', '건축구조', '주용도', '지상층', '지하층', '인허가일', '착공일', '건축연령', '준공연도', '준공분기', '준공월', '멸실일자', '멸실연도', '소재지(지번)', '소재지(도로명)']);
    var h = '<div class="dhead"><h2>' + esc(r.name) + '</h2><span class="pill" style="color:' + colorOf(r) + '">' + esc(stripNo(r.region)) + '</span>' + (has(G('용도')) ? '<span class="tag">' + esc(G('용도')) + '</span>' : '') + '<span class="muted">시트 ' + r.r + '행</span></div>';
    h += dkpis([['연면적', r.area ? fmt(r.area) + '평' : ''], ['준공', ymd(G('준공일'))], ['현 소유자', G('현 소유자')], ['최근 거래가', has(G('거래가격(억원)')) ? G('거래가격(억원)') + '억' : ''], ['평단가', has(G('평단가')) && G('평단가') !== '0' ? G('평단가') + '만' : ''], ['Cap.', G('Cap.')]]);
    h += '<div class="dgrid">';
    h += card('기본 정보', kv([['상태', stripNo(G('상태'))], ['도로명 주소', G('소재지(도로명)')], ['지번 주소', G('소재지(지번)')], ['현 소유자', G('현 소유자')], ['매도인/시행자', G('매도인(or 시행자)')], ['용도', G('용도')], ['비고', G('비고')]]));
    h += card('규모·건축', kv([['연면적', r.area ? fmt(r.area) + '평' : ''], ['대지면적', has(G('대지면적(평)')) ? G('대지면적(평)') + '평' : ''], ['건축면적', has(G('건축면적(평)')) ? G('건축면적(평)') + '평' : ''], ['건폐율', has(G('건폐율(%)')) ? G('건폐율(%)') + '%' : ''], ['용적률', has(G('용적률(%)')) ? G('용적률(%)') + '%' : ''], ['층수', [has(G('지상층')) ? '지상 ' + G('지상층') : '', has(G('지하층')) ? '지하 ' + G('지하층') : ''].filter(Boolean).join(' / ')], ['구조', G('건축구조')], ['주용도', G('주용도')]]));
    h += card('일정', kv([['인허가', ymd(G('인허가일'))], ['착공', ymd(G('착공일'))], ['준공', ymd(G('준공일'))], ['건축연령', G('건축연령')]]));
    h += card('거래 정보', kv([['최근 거래', G('최근 거래시점')], ['거래가격', has(G('거래가격(억원)')) ? G('거래가격(억원)') + '억원' : ''], ['평단가', has(G('평단가')) ? G('평단가') + '만원' : ''], ['Cap.', G('Cap.')]]) || '<p class="placeholder">시트에 거래 정보가 없습니다.</p>');
    var more = rest(C, r, U);
    if (more) h += card('기타 항목', more);
    h += '</div>';

    if (r.kids && r.kids.length) {
      h += '<div class="box mt"><h4>단지 내 동</h4><table class="subtable"><tr><th>건물명</th><th>연면적(평)</th><th>준공일</th><th>지번</th></tr>';
      r.kids.forEach(function (v) {
        var kr = { v: v };
        h += '<tr><td>' + esc(g(C, kr, '건물명')) + '</td><td>' + esc(g(C, kr, '연면적(평)')) + '</td><td>' + esc(ymd(g(C, kr, '준공일'))) + '</td><td>' + esc([g(C, kr, '동리'), g(C, kr, '본번')].join(' ')) + '</td></tr>';
      });
      h += '</table></div>';
    }

    h += related(r, 'deals', '이 위치의 거래사례');
    h += '<div class="box mt"><h4>렌트롤</h4><p class="placeholder">준비 중 — 시트에 렌트롤 탭이 추가되면 임차인·면적·만기 등이 여기에 표시됩니다.</p></div>';
    h += geoNote(r);
    return h;
  }

  function dealDetail(r) {
    var D = S.data.deals;
    var G = function (n) { return g(D, r, n); };
    var U = used(D, ['거래사례 불포함', 'No', '프로젝트', '거래시기', '거래유형', '대지면적(평)', '연면적(평)', '건폐율', '용적률', '사용승인일자', '상/저온', '주소', '매매가(억원)', '평단가(만원)', 'Cap.rate', '매도자', '매수자', '투자자', '주요 임차인', '비고', '인접도로', '태양광']);
    var h = '<div class="dhead"><h2>' + esc(r.name) + '</h2><span class="pill" style="color:' + colorOf(r) + '">' + esc(r.grade) + '</span><span class="tag">' + esc(r.type) + '</span><span class="muted">시트 ' + r.r + '행</span></div>';
    h += dkpis([['거래시기', G('거래시기')], ['매매가', has(G('매매가(억원)')) ? G('매매가(억원)') + '억' : ''], ['평단가', has(G('평단가(만원)')) ? G('평단가(만원)') + '만' : ''], ['Cap.', G('Cap.rate')], ['연면적', r.area ? fmt(r.area) + '평' : ''], ['매수자', G('매수자')]]);
    h += '<div class="dgrid">';
    h += card('거래 개요', kv([['거래시기', G('거래시기')], ['거래유형', G('거래유형')], ['매매가', has(G('매매가(억원)')) ? G('매매가(억원)') + '억원' : ''], ['평단가', has(G('평단가(만원)')) ? G('평단가(만원)') + '만원' : ''], ['Cap.rate', G('Cap.rate')], ['거래사례 불포함', has(G('거래사례 불포함')) ? '예' : '']]));
    h += card('거래 당사자', kv([['매도자', G('매도자')], ['매수자', G('매수자')], ['투자자', G('투자자')]]));
    h += card('자산', kv([['주소', G('주소')], ['연면적', r.area ? fmt(r.area) + '평' : ''], ['대지면적', has(G('대지면적(평)')) ? G('대지면적(평)') + '평' : ''], ['건폐율', G('건폐율')], ['용적률', G('용적률')], ['사용승인', ymd(G('사용승인일자'))], ['상/저온', G('상/저온')], ['인접도로', G('인접도로')], ['태양광', G('태양광')]]));
    h += card('임차·비고', kv([['주요 임차인', G('주요 임차인')], ['비고', G('비고')]]));
    var more = rest(D, r, U);
    if (more) h += card('기타 항목', more);
    h += '</div>';
    h += related(r, 'centers', '이 위치의 DB 센터');
    h += geoNote(r);
    return h;
  }

  function related(r, otherKind, title) {
    if (!hasXY(r)) return '';
    var near = S.data[otherKind].rows.filter(function (x) { return hasXY(x) && !x.demolished && dist(r, x) <= 400; })
      .sort(function (a, b) { return dist(r, a) - dist(r, b); }).slice(0, 8);
    if (!near.length) return '';
    var h = '<div class="box mt"><h4>' + esc(title) + ' (반경 400m)</h4><table class="subtable">';
    near.forEach(function (x) {
      var info = otherKind === 'deals'
        ? [x.when, x.grade, has(g(S.data.deals, x, '매매가(억원)')) ? g(S.data.deals, x, '매매가(억원)') + '억' : '', g(S.data.deals, x, '매수자')].filter(has).join(' · ')
        : [fmt(x.area) + '평', x.owner, ymd(x.done)].filter(has).join(' · ');
      h += '<tr><td><button class="linkbtn" data-jump="' + otherKind + ':' + x.id + '">' + esc(x.name) + '</button></td><td>' + esc(info) + '</td><td class="muted">' + Math.round(dist(r, x)) + 'm</td></tr>';
    });
    return h + '</table></div>';
  }

  function geoNote(r) {
    var src = r.geo === 'manual' ? '직접 입력' : r.geo === 'kakao' ? '카카오 주소검색' : r.geo === 'google' ? '구글 지오코딩' : '';
    return '<p class="geo">' + (hasXY(r) ? '좌표: ' + esc(src) + ' · 위치가 틀리면 시트의 숨김 탭 "_좌표캐시"에서 위도·경도를 고치고 출처를 manual로 적으세요.' : '좌표 없음 — 주소: ' + esc(r.addr || '(없음)') + '. "_좌표캐시" 탭에 위도·경도를 직접 넣으면 지도에 표시됩니다.') + '</p>';
  }

  /* ---------------- 목록 ---------------- */
  var COLS = {
    centers: [
      ['건물명', function (r) { return r.name; }, 'name'],
      ['연면적(평)', function (r) { return fmt(r.area); }, 'area', 'r'],
      ['권역', function (r) { return stripNo(r.region); }, 'region', '', true],
      ['현 소유자', function (r) { return r.owner; }, 'owner'],
      ['준공', function (r) { return ymd(r.done); }, 'done'],
      ['최근 거래', function (r) { var C = S.data.centers; return [clean(g(C, r, '최근 거래시점')), has(g(C, r, '거래가격(억원)')) ? g(C, r, '거래가격(억원)') + '억' : ''].filter(Boolean).join(' '); }, null],
      ['지도', function (r) { return hasXY(r) ? '' : '좌표없음'; }, null, 'dim']
    ],
    deals: [
      ['프로젝트', function (r) { return r.name; }, 'name'],
      ['거래시기', function (r) { return r.when; }, 'when'],
      ['평가', function (r) { return r.grade; }, 'grade', '', true],
      ['구분', function (r) { return r.type; }, 'type'],
      ['연면적(평)', function (r) { return r.area ? fmt(r.area) : ''; }, 'area', 'r'],
      ['매매가(억)', function (r) { return clean(g(S.data.deals, r, '매매가(억원)')); }, 'price', 'r'],
      ['평단가(만)', function (r) { return clean(g(S.data.deals, r, '평단가(만원)')); }, null, 'r'],
      ['Cap', function (r) { return clean(g(S.data.deals, r, 'Cap.rate')); }, null],
      ['매수자', function (r) { return clean(g(S.data.deals, r, '매수자')); }, null],
      ['지도', function (r) { return hasXY(r) ? '' : '좌표없음'; }, null, 'dim']
    ]
  };

  function sortKey(r, key) {
    if (key === 'when') return r.year === '진행중' ? '9999' + r.r : (r.year + (r.when || '')).replace(/[^0-9Q.]/g, '') + String(9999 - r.r);
    var v = r[key];
    return v == null ? '' : v;
  }

  function renderList(list) {
    var f = S.f[S.tab], cols = COLS[S.tab];
    var arr = list.slice().sort(function (a, b) {
      var x = sortKey(a, f.sort), y = sortKey(b, f.sort);
      if (typeof x === 'number' && typeof y === 'number') return (x - y) * f.dir;
      return String(x).localeCompare(String(y), 'ko') * f.dir;
    });
    $('listTitle').textContent = S.tab === 'centers' ? '센터 목록' : '거래사례 목록';
    $('listInfo').textContent = '필터 결과 ' + fmt(arr.length) + (S.tab === 'centers' ? '곳' : '건') + ' · 제목을 누르면 정렬, 행을 누르면 지도에서 위치를 보여줍니다';
    var h = '<thead><tr>';
    cols.forEach(function (c) { h += '<th class="' + (c[3] || '') + '"' + (c[2] ? ' data-sort="' + c[2] + '"' : '') + '>' + esc(c[0]) + (f.sort === c[2] ? (f.dir < 0 ? ' ▼' : ' ▲') : '') + '</th>'; });
    h += '</tr></thead><tbody>';
    arr.slice(0, S.limit).forEach(function (r) {
      h += '<tr data-id="' + r.id + '"' + (S.sel[S.tab] === r ? ' class="sel"' : '') + '>';
      cols.forEach(function (c) { h += '<td class="' + (c[3] || '') + '">' + (c[4] ? '<span class="sw" style="background:' + colorOf(r) + '"></span>' : '') + esc(c[1](r)) + '</td>'; });
      h += '</tr>';
    });
    h += '</tbody>';
    var t = $('table');
    t.innerHTML = h;
    $('more').hidden = arr.length <= S.limit;
    var byId = {};
    arr.forEach(function (r) { byId[r.id] = r; });
    t.querySelectorAll('tbody tr').forEach(function (tr) {
      tr.addEventListener('click', function () {
        select(byId[tr.getAttribute('data-id')], true);
        $('map').scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    });
    t.querySelectorAll('th[data-sort]').forEach(function (th) {
      th.addEventListener('click', function () {
        var k = th.getAttribute('data-sort');
        if (f.sort === k) f.dir = -f.dir; else { f.sort = k; f.dir = (k === 'area' || k === 'price' || k === 'when') ? -1 : 1; }
        renderList(list);
      });
    });
  }

  function markListRow(r) {
    document.querySelectorAll('#table tbody tr').forEach(function (tr) { tr.classList.toggle('sel', tr.getAttribute('data-id') === r.id); });
  }

  /* ---------------- 기사 ---------------- */
  var NEWS_CATS = ['전체', '거래·투자', '개발·인허가', '임대·시장'];
  function renderNews(items, cat) {
    cat = cat || '전체';
    var el = $('news');
    if (!items.length) { el.innerHTML = '<p class="empty">표시할 기사가 없습니다. (구글 뉴스 응답 없음 — 잠시 후 다시 확인)</p>'; return; }
    var list = items.filter(function (n) { return cat === '전체' || n.cat === cat; });
    var cnt = {};
    items.forEach(function (n) { cnt[n.cat] = (cnt[n.cat] || 0) + 1; });
    var h = '<div class="card-head"><div class="seg">';
    NEWS_CATS.forEach(function (c) { h += '<button class="' + (c === cat ? 'on' : '') + '" data-ncat="' + esc(c) + '">' + esc(c) + ' <span class="mono">' + (c === '전체' ? items.length : (cnt[c] || 0)) + '</span></button>'; });
    h += '</div><span class="count">물류센터 매각·매입·개발·임대 키워드</span></div><div class="news-list">';
    list.forEach(function (n) {
      var safe = /^https?:\/\//.test(n.link || '') ? n.link : '#';
      h += '<a class="nitem" href="' + esc(safe) + '" target="_blank" rel="noopener noreferrer"><span class="nd">\'' + esc(n.date) + '</span><span class="nt"><b>' + esc(n.title) + '</b><small>' + esc(n.src) + (cat === '전체' ? '<span class="tag">' + esc(n.cat) + '</span>' : '') + '</small></span></a>';
    });
    el.innerHTML = h + '</div>';
    el.querySelectorAll('[data-ncat]').forEach(function (b) { b.addEventListener('click', function () { renderNews(items, b.getAttribute('data-ncat')); }); });
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
