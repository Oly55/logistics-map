/* 물류센터 지도 — 수도권 물류센터 DB / 거래사례 (카카오맵) */
(function () {
  'use strict';

  var CFG = window.MAP_CONFIG || {};
  var PW_KEY = 'lmap_pw_v1';
  var PAGE = 200;

  var REGION_COLORS = ['#2747a8', '#0e8f7b', '#d4682a', '#7a4fb5', '#c8302f', '#1b88ad', '#a26a00', '#7b8494', '#3aa564', '#e5484d'];
  var GRADE_COLORS = { '굿딜': '#1f7a4d', '평범': '#3354c4', '별로': '#c8302f', 'KS captive': '#7b8494', '진행중': '#d4682a', '기타': '#8a3ffc' };
  var AREA_CHIPS = { centers: [0, 5000, 10000, 20000, 30000, 50000], deals: [0, 10000, 20000, 30000], wh: [0, 1000, 3000, 10000, 30000], pipe: [0, 5000, 10000, 20000, 30000] };
  // 공급 파이프라인 상태(시트 '상태' 값 → 표시 이름). 장기미착공·지연은 기본 숨김(칩을 눌러야 표시)
  var PIPE_STATUS = [
    { k: '공사중', raw: ['공사중'], c: '#d4682a', on: true },
    { k: '준공 임박', raw: ['준공 임박(예상 경과)', '준공 임박'], c: '#c8302f', on: true },
    { k: '최근 준공', raw: ['사용승인'], c: '#1f7a4d', on: true },
    { k: '미착공', raw: ['미착공'], c: '#3354c4', on: true, note: '허가 후 3년 이내' },
    { k: '지연·중단 의심', raw: ['지연·중단 의심'], c: '#a26a00', on: false, note: '예상 준공 시점이 1년 넘게 지남' },
    { k: '장기미착공', raw: ['장기미착공'], c: '#9aa3b2', on: false, note: '허가 후 3년 넘게 미착공' }
  ];
  // 물류센터 DB 지도 ↔ 공급 파이프라인 지도에 서로를 '작은 점'으로 함께 표시(클릭·마우스오버 없음)
  var GHOST_PIPE = ['공사중', '준공 임박', '최근 준공', '미착공'];
  var GHOST_ON = { pipe: true, centers: true };

  var S = {
    data: null, tab: 'centers', map: null, dots: [], info: null, limit: PAGE,
    sel: { centers: null, deals: null, wh: null, pipe: null },
    f: {
      centers: { min: 10000, max: null, regions: {}, lp: false, q: '', sort: 'area', dir: -1 },
      deals: { min: null, max: null, grades: {}, years: {}, types: {}, q: '', sort: 'when', dir: -1 },
      wh: { min: null, max: null, groups: {}, regions: {}, q: '', sort: 'area', dir: -1 },
      pipe: { min: null, max: null, statuses: {}, regions: {}, years: {}, q: '', sort: 'dueSort', dir: 1 }
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
  // 시트의 '소재지(지번)'이 비어 있을 때 광역·시군·구읍면·동리·본번·부번 칸으로 지번 주소를 만든다
  function lotAddr(C, r, lot) {
    var sido = clean(g(C, r, '광역(특별)시·도')), parts = [sido];
    ['시군', '구읍면', '동리'].forEach(function (n) {
      var v = clean(g(C, r, n));
      if (!v || v === '-' || parts.indexOf(v) >= 0) return;
      if (n === '시군' && /광역시|특별시/.test(sido) && /시$/.test(v)) return; // 예: 인천광역시 + '인천시'
      parts.push(v);
    });
    if (parts.length < 2) return '';
    return parts.filter(Boolean).join(' ') + (lot ? ' ' + lot + '번지' : '');
  }
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
    var url = CFG.apiUrl + (CFG.apiUrl.indexOf('?') >= 0 ? '&' : '?') + 'k=' + encodeURIComponent(pw) + '&dev=' + devId() + '&kind=' + encodeURIComponent(devKind()) + '&t=' + Date.now();
    fetch(url, { redirect: 'follow' }).then(function (r) { return r.json(); }).then(function (d) {
      $('go').disabled = false;
      if (!d || !d.ok) {
        if (silent) store(PW_KEY, null);
        showGate((d && d.message) || '데이터를 불러오지 못했습니다.');
        return;
      }
      if (!silent && $('remember').checked) store(PW_KEY, pw);
      $('gate').hidden = true;
      S.pw = pw;
      logAccess();
      prep(d);
      renderNews(d.news || []);
      S.kakaoKey = CFG.kakaoKey || d.kakaoJsKey || '';
      loadKakao(function () { initMap(); switchTab(S.tab); });
    }).catch(function (err) {
      $('go').disabled = false;
      showGate('서버에 연결하지 못했습니다. (' + (err && err.message ? err.message : err) + ')');
    });
  }

  // 접속 기록: 비밀번호가 맞으면 한 번, 기기·브라우저와 대략적 지역(시·도/시군구, 통신사)을 지도 서버로 보냄. IP 자체는 보내지 않음
  function devId() {
    var id = loadStore('lmap_dev');
    if (!id) { id = Math.random().toString(36).slice(2, 10); store('lmap_dev', id); }
    return id;
  }
  function devKind() {
    var ua = navigator.userAgent || '';
    var dev = /iPad|Tablet/.test(ua) ? '태블릿' : /Mobi|Android|iPhone/.test(ua) ? '모바일' : 'PC';
    var os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : '기타';
    var br = /Edg\//.test(ua) ? 'Edge' : /Whale/.test(ua) ? 'Whale' : /SamsungBrowser/.test(ua) ? '삼성 인터넷' : /KAKAOTALK/i.test(ua) ? '카카오톡' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '기타';
    return dev + ' · ' + os + ' · ' + br;
  }
  function logAccess() {
    try {
      var tz = ''; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { }
      var base = CFG.apiUrl + (CFG.apiUrl.indexOf('?') >= 0 ? '&' : '?') + 'log=1&k=' + encodeURIComponent(S.pw || '') + '&dev=' + devId() +
        '&kind=' + encodeURIComponent(devKind()) + '&scr=' + screen.width + 'x' + screen.height + '&tz=' + encodeURIComponent(tz);
      var enc = encodeURIComponent;
      var send = function (g) {
        g = g || {};
        fetch(base + '&country=' + enc(g.country || '') + '&region=' + enc(g.region || '') + '&city=' + enc(g.city || '') + '&isp=' + enc(g.isp || '') + '&t=' + Date.now(), { redirect: 'follow' }).catch(function () { });
      };
      var geo = function (url, pick) {   // 4초 안에 답이 없으면 지역 없이 기록
        return Promise.race([fetch(url).then(function (r) { return r.json(); }).then(pick), new Promise(function (res, rej) { setTimeout(function () { rej(new Error('timeout')); }, 4000); })]);
      };
      geo('https://ipapi.co/json/', function (j) { if (!j || j.error) throw new Error('ipapi'); return { country: j.country_name, region: j.region, city: j.city, isp: j.org }; })
        .catch(function () { return geo('https://ipwho.is/', function (j) { if (!j || j.success === false) throw new Error('ipwho'); return { country: j.country, region: j.region, city: j.city, isp: j.connection && (j.connection.isp || j.connection.org) }; }); })
        .catch(function () { return {}; })
        .then(send);
    } catch (e) { /* 기록 실패는 무시 */ }
  }

  function loadKakao(cb) {
    if (window.kakao && window.kakao.maps && window.kakao.maps.Map) { cb(); return; }
    if (!S.kakaoKey) { fatal('카카오 JavaScript 키가 없습니다. Apps Script 스크립트 속성 KAKAO_JS_KEY를 확인하세요.'); return; }
    var s = document.createElement('script');
    s.src = 'https://dapi.kakao.com/v2/maps/sdk.js?autoload=false&libraries=services&appkey=' + encodeURIComponent(S.kakaoKey);
    s.onload = function () {
      try { window.kakao.maps.load(cb); } catch (e) { fatal('카카오 지도를 불러오지 못했습니다. JavaScript 키와 사이트 도메인 등록을 확인하세요.'); }
    };
    s.onerror = function () { fatal('카카오 지도 스크립트를 불러오지 못했습니다. JavaScript 키와 사이트 도메인 등록을 확인하세요.'); };
    document.head.appendChild(s);
  }

  function fatal(msg) {
    $('map').innerHTML = '<div style="padding:24px;color:#c62828">' + esc(msg) + '</div>';
  }

  /* ---------------- 층별 면적('층별 면적' 탭, 건축물대장PK로 연결) ---------------- */
  // 라지플레이트 기준(대표층, 평) — 패널에서 3·4·5·6천평 중 선택, 브라우저에 기억
  var LP_STEPS = [3000, 4000, 5000, 6000];
  S.lpT = Number(loadStore('lmap_lp')) || 4000;
  if (LP_STEPS.indexOf(S.lpT) < 0) S.lpT = 4000;
  function applyLp() {
    if (!S.data || !S.data.centers) return;
    S.data.centers.rows.forEach(function (r) { r.lp = (r.fls || []).some(function (d) { return d.rep >= S.lpT; }); });
  }
  function setLpT(t) { S.lpT = t; store('lmap_lp', String(t)); applyLp(); }
  function flSet(s) { var m = {}; String(s || '').split(',').forEach(function (x) { x = x.trim(); if (x) m[x] = 1; }); return m; }
  // r.fls = [{ name, rec, rep, temp, cold, part }] (본 동 + 하위 동), r.rep = 가장 큰 대표층 면적, r.lp = 대표층이 기준 이상인 동이 있으면 true(applyLp)
  function joinFloors(F, C, r) {
    r.fls = []; r.rep = 0; r.lp = false;
    if (!F || !F.byPk) return;
    if (!F.ix) F.ix = index(F.headers);
    [r.v].concat(r.kids || []).forEach(function (v, i) {
      var pk = clean(g(C, { v: v }, '건축물대장PK')), rec = pk && F.byPk[pk];
      if (!rec) return;
      var fr = { v: rec }, rp = num(g(F, fr, '대표층 면적(평)')) || 0;
      r.fls.push({ name: clean(g(F, fr, '동명(대장)')) || clean(g(C, { v: v }, '건물명')) || (i ? '하위 동 ' + i : r.name), rec: fr, rep: rp,
        temp: clean(g(F, fr, '상온/저온(대장)')), cold: flSet(g(F, fr, '저온층')), part: flSet(g(F, fr, '일부 저온층')) });
      if (rp > r.rep) r.rep = rp;
    });
    r.lp = r.fls.some(function (d) { return d.rep >= S.lpT; });
  }
  // '층별 면적(평)' 문자열("B1 6,315 / 1F 906* / 2F 3,446") → 위층부터 [{ fl, area, x(대표층 계산 제외) }]
  function parseFloors(s) {
    return String(s || '').split('/').map(function (t) {
      var m = /^\s*(\S+)\s+([\d,.]+)(\*?)\s*$/.exec(t);
      return m ? { fl: m[1], area: num(m[2]) || 0, x: !!m[3] } : null;
    }).filter(Boolean).reverse();
  }
  function floorBox(r) {
    if (!r.fls || !r.fls.length) return '';
    var F = S.data.floors, multi = r.fls.length > 1, asOf = '';
    var h = '<div class="box mt"><h4>층별 면적' + (multi ? ' <span class="muted">· ' + r.fls.length + '개 동</span>' : '') + '</h4><div class="flgrid' + (multi ? '' : ' one') + '">';
    var mx = 1;   // 막대 길이는 단지 전체에서 같은 기준(가장 큰 층)으로
    r.fls.forEach(function (d) { d.fl = parseFloors(g(F, d.rec, '층별 면적(평)')); d.fl.forEach(function (x) { if (x.area > mx) mx = x.area; }); });
    r.fls.forEach(function (d) {
      var G = function (n) { return clean(g(F, d.rec, n)); };
      var fl = d.fl;
      asOf = asOf || G('조회일');
      var lp = d.rep >= S.lpT, tc = /^저온/.test(d.temp) ? 'cold' : /^복합/.test(d.temp) ? 'mix' : 'amb';
      h += '<div class="flcard"><div class="flhead">' + (multi ? '<b>' + esc(d.name) + '</b>' : '') +
        (d.temp ? '<span class="tbadge ' + tc + '" title="건축물대장 층별 용도 기준(괄호는 창고 면적 중 저온 비중)">' + esc(d.temp) + '</span>' : '') +
        (lp ? '<span class="lpbadge">라지플레이트</span>' : '') + '</div>';
      h += '<div class="flstats">' + [
        ['대표층', d.rep ? fmt(d.rep) + '평' : '-'],
        ['최대층', has(G('최대층 면적(평)')) ? G('최대층') + ' ' + G('최대층 면적(평)') + '평' : '-'],
        ['1층', has(G('1층 면적(평)')) ? G('1층 면적(평)') + '평' : '-'],
        ['창고층', has(G('창고층 수')) ? G('창고층 수') + '개' : '-']
      ].map(function (p) { return '<span><em>' + p[0] + '</em>' + esc(p[1]) + '</span>'; }).join('') + '</div>';
      if (fl.length) {
        h += '<div class="flstack">';
        fl.forEach(function (x) {
          var c = d.cold[x.fl] ? 'c' : d.part[x.fl] ? 'p' : '';
          h += '<div class="flrow' + (x.x ? ' x' : '') + (c ? ' ' + c : '') + '" title="' + esc(x.fl + ' ' + fmt(x.area) + '평' + (c === 'c' ? ' · 저온' : c === 'p' ? ' · 일부 저온' : '') + (x.x ? ' (대표층 계산에서 뺀 층)' : '')) + '"><span class="fll">' + esc(x.fl) + '</span><span class="flbar"><i style="width:' + Math.max(1, x.area / mx * 100).toFixed(1) + '%"></i></span><span class="flv">' + fmt(x.area) + '</span><span class="flt">' + (c === 'c' ? '저온' : c === 'p' ? '일부 저온' : '') + '</span></div>';
        });
        h += '</div>';
      }
      h += '</div>';
    });
    h += '</div><p class="fllegend"><span><i class="sq amb"></i>상온</span><span><i class="sq c"></i>저온층(층 면적 절반 이상)</span><span><i class="sq p"></i>일부 저온층</span><span><i class="sq x"></i>대표층 계산에서 뺀 층(램프·사무 등)</span></p>' +
      '<p class="flnote">건축물대장 층별개요 기준' + (asOf ? '(' + esc(ymd(asOf)) + ' 조회)' : '') + ' · 대표층 = 창고층 면적의 중앙값 · 라지플레이트 = 대표층 ' + fmt(S.lpT) + '평 이상(오른쪽 패널에서 변경) · 저온은 층별 용도(냉동·냉장·저온·정온) 기준이라 준공 후 임차인이 설치한 저온 설비는 빠질 수 있음</p></div>';
    return h;
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
      var bon = clean(g(C, r, '본번')), bu = clean(g(C, r, '부번')), dong = clean(g(C, r, '동리')) || clean(g(C, r, '구읍면'));
      var lot = bon && bon !== '0' ? bon + (bu && bu !== '0' ? '-' + bu : '') : '';
      r.jibun = clean(g(C, r, '소재지(지번)')) || lotAddr(C, r, lot);
      r.text = [r.name, r.owner, g(C, r, '매도인(or 시행자)'), g(C, r, '소재지(도로명)'), g(C, r, '소재지(지번)'), g(C, r, '비고'),
        g(C, r, '광역(특별)시·도'), g(C, r, '시군'), g(C, r, '구읍면'), dong, lot, dong && lot ? dong + lot : ''].join(' ').toLowerCase();
      regions[r.region] = (regions[r.region] || 0) + 1;
      joinFloors(d.floors, C, r);
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
    setPeriod(D, S.f.deals.period || '5y');   // 기본: 최근 5개년 + 진행중
    (D.grades || Object.keys(GRADE_COLORS)).forEach(function (k) { S.f.deals.grades[k] = true; });

    S.data = d;
    var up = function (s) { return String(s || '').replace(/^Update\s*:\s*/i, ''); };
    S.stampText = { centers: 'DB ' + (up(C.updated) || '-') + ' 기준', deals: '거래사례 ' + (up(D.updated) || '-') + ' 기준' };
    $('stamp').textContent = '불러온 시각 ' + (d.generatedAt || '');
  }

  // 거래시기 기간: '5y' = 진행중 + 올해 포함 최근 5개 연도, 'all' = 전체
  var RECENT_YEARS = 5;
  function recentFrom() { return new Date().getFullYear() - RECENT_YEARS + 1; }
  function setPeriod(D, p) {
    var f = S.f.deals, from = recentFrom();
    f.period = p;
    D.yearList.forEach(function (k) { f.years[k] = p === 'all' || k === '진행중' || (/^\d{4}$/.test(k) && +k >= from); });
  }
  function periodOf(D) {
    var f = S.f.deals, from = recentFrom();
    var isAll = D.yearList.every(function (k) { return f.years[k]; });
    var is5 = D.yearList.every(function (k) { return !!f.years[k] === (k === '진행중' || (/^\d{4}$/.test(k) && +k >= from)); });
    return isAll ? 'all' : is5 ? '5y' : 'custom';
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
    // 일반 / 위성(스카이뷰 + 도로·지명) 전환 — 마지막 선택을 기억
    function setMapType(t) {
      S.map.setMapTypeId(t === 'sky' ? k.MapTypeId.HYBRID : k.MapTypeId.ROADMAP);
      [].forEach.call($('maptype').querySelectorAll('button'), function (b) { b.classList.toggle('on', b.getAttribute('data-t') === t); });
      store('lmap_type', t === 'sky' ? 'sky' : null);
    }
    [].forEach.call($('maptype').querySelectorAll('button'), function (b) {
      b.addEventListener('click', function () { setMapType(b.getAttribute('data-t')); });
    });
    if (loadStore('lmap_type') === 'sky') setMapType('sky');
    // 전체화면 — 필터·지도·범례 카드를 화면 가득 (Esc 또는 ✕로 닫기)
    var mapCard = document.querySelector('.map-card'), fsb = $('fsbtn');
    function fsOn() { return mapCard.classList.contains('fs'); }
    function setFs(on) {
      var c = S.map.getCenter();
      mapCard.classList.toggle('fs', on);
      document.body.classList.toggle('fs-lock', on);
      fsb.textContent = on ? '✕' : '⛶';
      fsb.title = on ? '전체화면 닫기 (Esc)' : '전체화면';
      fsb.setAttribute('aria-label', fsb.title);
      setTimeout(function () { S.map.relayout(); S.map.setCenter(c); }, 80);
    }
    fsb.addEventListener('click', function () {
      var on = !fsOn();
      try {
        if (on && mapCard.requestFullscreen) mapCard.requestFullscreen().catch(function () {});
        if (!on && document.fullscreenElement) document.exitFullscreen().catch(function () {});
      } catch (e) { }
      setFs(on);
    });
    document.addEventListener('fullscreenchange', function () { if (!document.fullscreenElement && fsOn()) setFs(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && fsOn() && !document.fullscreenElement) setFs(false); });
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
    if (r.kind === 'wh') return S.data.wh.color[r.group] || WH_UNCLS;
    if (r.kind === 'pipe') return S.data.pipe.color[r.status] || '#888';
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
    // 같은 위치(약 35m 안)의 센터는 원 하나로 묶음 — 원 크기·색은 가장 큰 센터 기준
    var byKey = {}, clusters = [];
    S.clusterOf = {};
    onMap.forEach(function (r) {
      var key = Math.round(r.lat * 3000) + '_' + Math.round(r.lng * 2500);
      if (!byKey[key]) { byKey[key] = { rs: [] }; clusters.push(byKey[key]); }
      byKey[key].rs.push(r);
      S.clusterOf[r.id] = byKey[key];
    });
    clusters.forEach(function (cl, i) {
      var r = cl.rs[0];
      cl.rep = r;
      var el = document.createElement('div');
      el.className = 'dot' + (cl.rs.length > 1 ? ' multi' : '') + (cl.rs.indexOf(S.sel[S.tab]) >= 0 ? ' sel' : '');
      if (cl.rs.length > 1) el.setAttribute('data-n', cl.rs.length);
      var sz = dotSize(r.area);
      el.style.width = el.style.height = sz + 'px';
      el.style.background = colorOf(r);
      el.addEventListener('mouseenter', function () { showHover(cl.rs); });
      el.addEventListener('mouseleave', hideHover);
      el.addEventListener('click', function (e) { e.stopPropagation(); if (cl.rs.length > 1) openCluster(cl); else select(r, false); });
      var ov = new k.CustomOverlay({ position: new k.LatLng(r.lat, r.lng), content: el, xAnchor: 0.5, yAnchor: 0.5, zIndex: 10 + i, clickable: true });
      ov.setMap(S.map);
      S.dots.push({ ov: ov, el: el, r: r, rs: cl.rs });
    });
    var noXY = list.length - onMap.length;
    var tip = $('maptip');
    tip.style.display = noXY ? 'block' : 'none';
    tip.textContent = noXY ? '좌표가 없는 ' + noXY + '곳은 아래 목록에만 표시됩니다' : '';
    renderCount(list, onMap.length);
    renderKpis(list);
    renderPanel();
    $('whCharts').hidden = S.tab !== 'wh';
    if (S.tab === 'wh') whCharts();
    S.limit = PAGE;
    renderList(list);
    if (S.sel[S.tab] && hasXY(S.sel[S.tab]) && list.indexOf(S.sel[S.tab]) >= 0) openInfo(S.sel[S.tab]);
    drawGhosts();
    if (S.tab === 'centers' && !S.data.pipe) pipeLoad(true);
  }

  // 다른 지도의 위치를 작은 점으로(가장 아래 층, 클릭·마우스오버 없음)
  function ghostRows(ignoreOn) {
    if (!S.data) return [];
    if (S.tab === 'centers' && S.data.pipe && (ignoreOn || GHOST_ON.pipe)) return S.data.pipe.rows.filter(function (r) { return hasXY(r) && GHOST_PIPE.indexOf(r.status) >= 0; });
    if (S.tab === 'pipe' && S.data.centers && (ignoreOn || GHOST_ON.centers)) return S.data.centers.rows.filter(function (r) { return hasXY(r) && !r.demolished; });
    return [];
  }
  function drawGhosts() {
    var k = window.kakao && window.kakao.maps;
    (S.ghosts || []).forEach(function (o) { o.setMap(null); });
    S.ghosts = [];
    if (!k || !S.map) return;
    ghostRows().forEach(function (r) {
      var el = document.createElement('div');
      el.className = 'ghost ' + (r.kind === 'pipe' ? 'g-pipe' : 'g-center');
      var ov = new k.CustomOverlay({ position: new k.LatLng(r.lat, r.lng), content: el, xAnchor: 0.5, yAnchor: 0.5, zIndex: 1, clickable: false });
      ov.setMap(S.map);
      S.ghosts.push(ov);
    });
  }
  function ghostSec() {
    var isC = S.tab === 'centers', key = isC ? 'pipe' : 'centers', n = ghostRows(true).length;
    var ready = isC ? !!S.data.pipe : !!S.data.centers;
    return '<div class="p-sec"><p class="p-title">' + (isC ? '공급 파이프라인 함께 보기' : '기존 물류센터 함께 보기') + '</p>' +
      '<button class="opt' + (GHOST_ON[key] ? ' on' : '') + '" data-ghost="' + key + '"><span class="ck"></span><span class="sw gsw ' + (isC ? 'g-pipe' : 'g-center') + '"></span>' +
      '<span class="lbl">' + (isC ? '진행 중인 현장' : '물류센터 DB') + '</span><span class="n">' + (ready ? fmt(n) : '…') + '</span></button>' +
      '<p class="p-hint">' + (isC ? '공사중·준공 임박·최근 준공·미착공 위치만 작은 ◆로 표시합니다 (클릭 안 됨)' : '기존 센터 위치만 작은 점으로 표시합니다 (클릭 안 됨)') + '</p>' +
      '<button class="chip golink" data-goto="' + key + '">' + (isC ? '공급 파이프라인 지도로 →' : '물류센터 DB 지도로 →') + '</button></div>';
  }

  function resizeDots() {
    S.dots.forEach(function (d) { var sz = dotSize(d.r.area); d.el.style.width = d.el.style.height = sz + 'px'; });
    if (S.info) { if (S.info.cl && !S.info.r) openCluster(S.info.cl); else openInfo(S.info.r); }
  }

  // 마우스를 올리면 한 줄 요약(센터명, 준공연월, 면적, 상온/복합/저온, 특이사항)
  function yymm(s) { var d = String(s || '').replace(/[^0-9]/g, ''); return d.length >= 6 ? d.slice(2, 4) + '.' + d.slice(4, 6) : ''; }
  function hoverText(r) {
    var parts;
    if (r.kind === 'pipe') {
      parts = [r.name, r.status, r.due ? r.due.replace(/^20/, '') + ' 준공' + (r.status === '최근 준공' ? '' : '예정') : '', r.area ? (r.area / 10000).toFixed(1) + '만평' : '', r.sgg];
    } else if (r.kind === 'wh') {
      parts = [r.name, r.group !== WH_OTHERS ? r.group : '', pyLabel(r.area), r.cold ? '저온 ' + pyLabel(r.cold) : '상온', r.lic ? yymm(r.lic) + ' 등록' : ''];
    } else if (r.kind === 'centers') {
      var C = S.data.centers;
      parts = [r.name, yymm(r.done) ? yymm(r.done) + '준공' : '', r.area ? (r.area / 10000).toFixed(1) + '만평' : '', r.rep ? '대표층 ' + fmt(r.rep) + '평' : '', clean(g(C, r, '용도')), r.owner ? '소유 ' + r.owner : '', clean(g(C, r, '비고'))];
    } else {
      var D = S.data.deals;
      parts = [r.name, r.when, r.area ? (r.area / 10000).toFixed(1) + '만평' : '', clean(g(D, r, '상/저온')), has(g(D, r, '매매가(억원)')) ? g(D, r, '매매가(억원)') + '억' : '', clean(g(D, r, '비고'))];
    }
    var t = parts.filter(Boolean).join(', ');
    return t.length > 90 ? t.slice(0, 89) + '…' : t;
  }
  function showHover(rs) {
    hideHover();
    var r = rs[0];
    var cl0 = S.clusterOf[r.id];
    if (S.info && ((S.info.cl && S.info.cl === cl0) || (S.info.r && S.clusterOf[S.info.r.id] === cl0))) return;   // 이미 박스가 열린 원
    var k = window.kakao.maps;
    var wrap = document.createElement('div');
    wrap.className = 'hover-wrap';
    wrap.style.paddingBottom = (dotSize(r.area) / 2 + 6) + 'px';
    var box = document.createElement('div');
    box.className = 'hover' + (rs.length > 1 ? ' many' : '');
    if (rs.length > 1) {
      var head = document.createElement('div');
      head.className = 'hv-head';
      head.textContent = '같은 위치 ' + rs.length + '곳 · 클릭하면 골라 볼 수 있습니다';
      box.appendChild(head);
    }
    rs.forEach(function (x) {
      var line = document.createElement('div');
      line.className = 'hv-line';
      line.textContent = hoverText(x);
      box.appendChild(line);
    });
    wrap.appendChild(box);
    S.hover = new k.CustomOverlay({ position: new k.LatLng(r.lat, r.lng), content: wrap, xAnchor: 0.5, yAnchor: 1, zIndex: 99999 });
    S.hover.setMap(S.map);
    if (wrap.parentElement) wrap.parentElement.style.pointerEvents = 'none';   // 마우스를 가로채 깜빡이지 않도록
  }
  function hideHover() { if (S.hover) { S.hover.setMap(null); S.hover = null; } }

  function select(r, pan) {
    hideHover();
    S.sel[S.tab] = r;
    S.dots.forEach(function (d) { d.el.classList.toggle('sel', (d.rs || [d.r]).indexOf(r) >= 0); });
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

  // 같은 위치에 여러 곳이 묶인 원을 클릭하면 목록 박스 → 하나를 고르면 그 센터 박스·세부 내용
  function openCluster(cl) {
    hideHover();
    closeInfo();
    var k = window.kakao.maps, rep0 = cl.rep;
    var wrap = document.createElement('div');
    wrap.style.paddingBottom = (dotSize(rep0.area) / 2 + 10) + 'px';
    var h = '<div class="ibox"><button class="x" title="닫기">×</button><h3>같은 위치 ' + cl.rs.length + '곳</h3><div class="cl-list">';
    cl.rs.forEach(function (r, i) {
      h += '<button class="cl-item" data-i="' + i + '"><span class="sw" style="background:' + colorOf(r) + '"></span><span>' + esc(hoverText(r)) + '</span></button>';
    });
    wrap.innerHTML = h + '</div></div>';
    wrap.querySelector('.x').addEventListener('click', function (e) { e.stopPropagation(); closeInfo(); });
    wrap.querySelectorAll('.cl-item').forEach(function (b) {
      b.addEventListener('click', function (e) { e.stopPropagation(); select(cl.rs[Number(b.getAttribute('data-i'))], false); });
    });
    wrap.addEventListener('mousedown', function (e) { e.stopPropagation(); });
    var ov = new k.CustomOverlay({ position: new k.LatLng(rep0.lat, rep0.lng), content: wrap, xAnchor: 0.5, yAnchor: 1, zIndex: 100000, clickable: true });
    ov.setMap(S.map);
    S.info = { ov: ov, r: null, cl: cl };
  }

  function openInfo(r) {
    closeInfo();
    var k = window.kakao.maps;
    var cl = (S.clusterOf || {})[r.id], anchor = cl ? cl.rep : r;
    var wrap = document.createElement('div');
    wrap.style.paddingBottom = (dotSize(anchor.area) / 2 + 10) + 'px';
    wrap.innerHTML = '<div class="ibox">' + infoHtml(r) + '</div>';
    wrap.querySelector('.x').addEventListener('click', function (e) { e.stopPropagation(); closeInfo(); });
    wrap.querySelector('.go').addEventListener('click', function (e) { e.stopPropagation(); $('detail').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    wrap.addEventListener('mousedown', function (e) { e.stopPropagation(); });
    if (cl && cl.rs.length > 1) {   // 묶인 원에서 고른 경우: 목록으로 돌아가기
      var back = document.createElement('button');
      back.className = 'go back';
      back.textContent = '← 같은 위치 ' + cl.rs.length + '곳 목록';
      back.addEventListener('click', function (e) { e.stopPropagation(); openCluster(cl); });
      wrap.querySelector('.ibox').appendChild(back);
    }
    var ov = new k.CustomOverlay({ position: new k.LatLng(anchor.lat, anchor.lng), content: wrap, xAnchor: 0.5, yAnchor: 1, zIndex: 100000, clickable: true });
    ov.setMap(S.map);
    S.info = { ov: ov, r: r };
  }

  function row(label, val) { return has(val) ? '<tr><td>' + esc(label) + '</td><td>' + esc(val) + '</td></tr>' : ''; }

  function infoHtml(r) {
    if (r.kind === 'wh') return whInfo(r);
    if (r.kind === 'pipe') return pipeInfo(r);
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
    if (q && !qMatch(r.text, q)) return false;
    if (r.kind === 'pipe') {
      if (skip !== 'statuses' && !f.statuses[r.status]) return false;
      if (skip !== 'regions' && !f.regions[r.region]) return false;
      if (skip !== 'years' && !f.years[r.dueYear]) return false;
    } else if (r.kind === 'wh') {
      if (skip !== 'groups' && !f.groups[r.group]) return false;
      if (skip !== 'regions' && !f.regions[r.region]) return false;
    } else if (r.kind === 'centers') {
      if (r.demolished) return false;
      if (skip !== 'regions' && !f.regions[r.region]) return false;
      if (skip !== 'lp' && f.lp && !r.lp) return false;
    } else {
      if (skip !== 'grades' && !f.grades[r.grade]) return false;
      if (skip !== 'years' && !f.years[r.year]) return false;
      if (skip !== 'types' && !f.types[r.type]) return false;
    }
    return true;
  }

  // 검색: 띄어쓰기로 나눈 낱말이 모두 들어 있으면 일치('번지'·'산' 앞뒤 공백 무시) — 예: '신동 705', '705-1번지', '화성 신동'
  function qTokens(q) { return String(q || '').toLowerCase().replace(/번지/g, ' ').split(/\s+/).filter(Boolean); }
  function qMatch(text, q) { var ts = qTokens(q); for (var i = 0; i < ts.length; i++) if (text.indexOf(ts[i]) < 0) return false; return true; }

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
    h += '<div class="fgroup"><input class="search" id="fq" placeholder="' + (S.tab === 'centers' ? '건물명 · 소유자 · 주소 · 비고 검색' : S.tab === 'wh' ? '사업장명 · 업체 · 주소 검색' : S.tab === 'pipe' ? '건물명 · 주소 · 시군구 · 메모 검색' : '프로젝트 · 주소 · 매도/매수자 · 임차인 검색') + '" value="' + esc(f.q) + '"><button class="sgo" id="fgo" type="button" title="검색어 위치로 지도 이동 (Enter)">이동</button></div>';
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
    $('fq').addEventListener('input', function () { clearTimeout(timer); if (!$('fq').value.trim()) clearSearchPin(); timer = setTimeout(function () { f.q = $('fq').value; draw(); }, 250); });
    $('fq').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); clearTimeout(timer); searchGo(); } });
    $('fgo').addEventListener('click', function () { clearTimeout(timer); searchGo(); });
  }

  // 검색한 곳으로 지도 이동: 맞는 원이 있으면 그 원들로, 없으면 주소(지번·도로명)나 장소 이름으로 위치를 찾아 이동
  function searchGo() {
    var q = ($('fq').value || '').trim(), k = window.kakao && window.kakao.maps;
    clearSearchPin();
    if (!q || !k || !S.map) return;
    var f = S.f[S.tab];
    if (f.q !== q) { f.q = q; draw(); }
    var hits = filtered().filter(hasXY), note = '';
    if (!hits.length && ((f.min != null && f.min !== '') || (f.max != null && f.max !== ''))) {
      // 연면적 조건 때문에 숨은 곳이 있으면 그 위치로 이동하고 알려 줌
      var f2 = Object.assign({}, f, { min: null, max: null }), lq = q.toLowerCase();
      hits = S.data[S.tab].rows.filter(function (r) { return hasXY(r) && passes(r, f2, lq); });
      if (hits.length) note = ' — 연면적 조건에 걸려 숨겨진 곳입니다(연면적 \'전체\'를 누르면 보입니다)';
    }
    if (hits.length) {
      if (hits.length === 1) { S.map.setLevel(Math.min(S.map.getLevel(), 5)); S.map.setCenter(new k.LatLng(hits[0].lat, hits[0].lng)); }
      else {
        var b = new k.LatLngBounds();
        hits.forEach(function (r) { b.extend(new k.LatLng(r.lat, r.lng)); });
        S.map.setBounds(b, 40, 40, 40, 40);
      }
      searchMsg(fmt(hits.length) + (S.tab === 'deals' || S.tab === 'pipe' ? '건' : '곳') + '으로 이동했습니다' + note);
      return;
    }
    if (!k.services) { searchMsg('맞는 항목이 없습니다'); return; }
    var addr = q.replace(/번지/g, '').trim();
    var go = function (lat, lng, label) {
      S.map.setLevel(4); S.map.setCenter(new k.LatLng(lat, lng));
      var el = document.createElement('div');
      el.className = 'spin';
      el.innerHTML = '<span>' + esc(label) + '</span>';
      S.searchPin = new k.CustomOverlay({ position: new k.LatLng(lat, lng), content: el, xAnchor: 0.5, yAnchor: 1, zIndex: 99999, clickable: false });
      S.searchPin.setMap(S.map);
      searchMsg('맞는 ' + (S.tab === 'deals' || S.tab === 'pipe' ? '항목은' : '센터는') + ' 없고, 검색한 위치로 이동했습니다');
    };
    var gc = new k.services.Geocoder(), OK = k.services.Status.OK;
    // 주소처럼 보이면(동·리·로·길 + 숫자) 장소 검색으로 엉뚱한 곳에 가지 않도록, 번지를 못 찾으면 동·리 중심으로 이동
    var looksAddr = /\d/.test(addr) && /(동|리|읍|면|로|길|가)(\s|\d|$)/.test(addr);
    var places = function () {
      new k.services.Places().keywordSearch(q, function (res2, st2) {
        if (st2 === OK && res2.length) { var p = res2[0]; go(+p.y, +p.x, p.place_name || q); return; }
        searchMsg('맞는 항목도, 찾을 수 있는 주소·장소도 없습니다');
      });
    };
    gc.addressSearch(addr, function (res, st) {
      if (st === OK && res.length) { var a = res[0]; go(+a.y, +a.x, a.address_name || addr); return; }
      if (!looksAddr) { places(); return; }
      var area = addr.replace(/\s*산?\s*\d+(-\d+)?\s*$/, '').trim();
      if (!area || area === addr) { places(); return; }
      gc.addressSearch(area, function (res3, st3) {
        if (st3 === OK && res3.length) { var a3 = res3[0]; go(+a3.y, +a3.x, (a3.address_name || area) + ' (번지를 찾지 못해 동·리 중심)'); return; }
        searchMsg('맞는 항목도, 찾을 수 있는 주소도 없습니다');
      });
    });
  }
  function clearSearchPin() { if (S.searchPin) { S.searchPin.setMap(null); S.searchPin = null; } }
  function searchMsg(t) {
    var el = $('smsg');
    if (!el) { el = document.createElement('div'); el.id = 'smsg'; el.className = 'smsg'; document.querySelector('.mapwrap').appendChild(el); }
    el.textContent = t; el.style.display = 'block';
    clearTimeout(S.smsgT); S.smsgT = setTimeout(function () { el.style.display = 'none'; }, 5000);
  }

  // 지도 오른쪽 패널: 표시 항목(권역/평가/거래시기/구분) + 원 크기 범례
  function renderPanel() {
    if (S.tab === 'wh') return whPanel();
    var f = S.f[S.tab], h = '';
    var P = S.data.pipe;
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
    if (S.tab === 'pipe') {
      var stC = countBy('statuses', 'status'), stA = {};
      filtered('statuses').forEach(function (r) { stA[r.status] = (stA[r.status] || 0) + r.area; });
      h += '<div class="p-sec"><p class="p-title">상태</p><p class="p-hint">눌러서 켜고 끄기 · Shift+클릭은 그것만<br>지연·장기미착공은 기본 숨김</p>';
      PIPE_STATUS.forEach(function (s) {
        h += '<button class="opt' + (f.statuses[s.k] ? ' on' : '') + '" data-group="statuses" data-key="' + esc(s.k) + '" title="' + esc(s.note || '') + '"><span class="ck"></span><span class="sw" style="background:' + s.c + '"></span>' +
          '<span class="lbl">' + esc(s.k) + '</span><span class="n">' + fmt(stC[s.k] || 0) + '</span></button>';
      });
      h += '<div class="chips" style="margin-top:6px"><button class="chip" data-pdef="1">기본(진행 중심)</button><button class="chip" data-pall="1">전체 상태</button></div></div>';
      h += '<div class="p-sec"><p class="p-title">권역</p>' + chips('regions', P.regionList, countBy('regions', 'region')) + '</div>';
      h += '<div class="p-sec"><p class="p-title">예상 준공 연도</p>' + chips('years', P.yearList, countBy('years', 'dueYear')) + '</div>';
    } else if (S.tab === 'centers') {
      var C = S.data.centers;
      h += '<div class="p-sec"><p class="p-title">지도에 표시할 권역</p><p class="p-hint">눌러서 켜고 끄기 · Shift+클릭은 그것만</p>' +
        opts('regions', C.regionList, C.regionColor, countBy('regions', 'region'), stripNo) + '</div>';
      if (S.data.floors) {
        var nLp = filtered('lp').filter(function (r) { return r.lp; }).length;
        h += '<div class="p-sec"><p class="p-title">라지플레이트</p><p class="p-hint">기준(대표층 면적)</p><div class="seg period lpstep" role="group" aria-label="라지플레이트 기준">' +
          LP_STEPS.map(function (t) { return '<button type="button" data-lpt="' + t + '" class="' + (S.lpT === t ? 'on' : '') + '">' + (t / 1000) + '천평</button>'; }).join('') + '</div>' +
          '<div class="seg period" role="group" aria-label="라지플레이트 필터">' +
          '<button type="button" data-lp="0" class="' + (f.lp ? '' : 'on') + '">전체</button>' +
          '<button type="button" data-lp="1" class="' + (f.lp ? 'on' : '') + '">라지플레이트만 (' + fmt(nLp) + ')</button></div>' +
          '<p class="p-hint">대표층이 ' + fmt(S.lpT) + '평 이상인 동이 있는 센터 · 건축물대장 층별개요 기준</p></div>';
      }
    } else {
      var D = S.data.deals;
      h += '<div class="p-sec"><p class="p-title">평가</p><p class="p-hint">시트의 셀 색 기준 · Shift+클릭은 그것만</p>' +
        opts('grades', Object.keys(GRADE_COLORS), GRADE_COLORS, countBy('grades', 'grade')) + '</div>';
      var per = periodOf(D);
      h += '<div class="p-sec"><p class="p-title">거래시기</p><div class="seg period" role="group" aria-label="기간">' +
        '<button type="button" data-period="5y" class="' + (per === '5y' ? 'on' : '') + '">최근 5개년 (' + recentFrom() + '~)</button>' +
        '<button type="button" data-period="all" class="' + (per === 'all' ? 'on' : '') + '">전체</button></div>' +
        chips('years', D.yearList, countBy('years', 'year')) + '</div>';
      h += '<div class="p-sec"><p class="p-title">구분</p>' + chips('types', D.typeList, countBy('types', 'type')) + '</div>';
    }
    if (S.tab === 'centers' || S.tab === 'pipe') h += ghostSec();
    h += '<div class="p-sec"><p class="p-title">원 크기</p><p class="p-hint">연면적이 클수록 약간 커집니다</p><div class="sizes">';
    [10000, 30000, 100000].forEach(function (a) {
      var s = baseSize(a);
      h += '<div><i style="width:' + s + 'px;height:' + s + 'px"></i>' + fmt(a / 10000) + '만평</div>';
    });
    h += '</div><p class="p-note">' + (S.tab === 'pipe' ? '건축HUB 인허가(창고시설 신축·개축·재축) 기준 · 예상준공은 착공일 + 규모별 표준 공기로 추정합니다.' : '멸실된 센터는 표시하지 않습니다.') + ' 같은 위치의 작은 원은 큰 원 위에 그려집니다.</p></div>';
    var el = $('panel');
    el.innerHTML = h;
    el.querySelectorAll('[data-ghost]').forEach(function (b) {
      b.addEventListener('click', function () { var key = b.getAttribute('data-ghost'); GHOST_ON[key] = !GHOST_ON[key]; drawGhosts(); renderPanel(); });
    });
    el.querySelectorAll('[data-goto]').forEach(function (b) {
      b.addEventListener('click', function () { switchTab(b.getAttribute('data-goto')); });
    });
    el.querySelectorAll('[data-pdef],[data-pall]').forEach(function (b) {
      b.addEventListener('click', function () { var all = b.hasAttribute('data-pall'); PIPE_STATUS.forEach(function (s) { f.statuses[s.k] = all || s.on; }); draw(); });
    });
    el.querySelectorAll('[data-period]').forEach(function (b) {
      b.addEventListener('click', function () { setPeriod(S.data.deals, b.getAttribute('data-period')); draw(); });
    });
    el.querySelectorAll('[data-lpt]').forEach(function (b) {
      b.addEventListener('click', function () { setLpT(Number(b.getAttribute('data-lpt'))); draw(); if (S.sel.centers) renderDetail(S.sel.centers); });
    });
    el.querySelectorAll('[data-lp]').forEach(function (b) {
      b.addEventListener('click', function () { S.f.centers.lp = b.getAttribute('data-lp') === '1'; draw(); });
    });
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
    if (c) c.innerHTML = '<b>' + fmt(list.length) + '</b>' + (S.tab === 'deals' || S.tab === 'pipe' ? '건' : '곳') + ' / 전체 ' + fmt(total) + (list.length !== onMap ? ' · 지도 표시 ' + fmt(onMap) : '');
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
    ['regions', 'grades', 'years', 'types'].forEach(function (k) { if (f[k] && Object.keys(f[k]).some(function (x) { return !f[k][x]; })) parts.push('일부 ' + { regions: '권역', grades: '평가', years: S.tab === 'pipe' ? '준공연도' : '거래시기', types: '구분' }[k]); });
    if (f.statuses) {
      var dflt = PIPE_STATUS.every(function (s) { return !!f.statuses[s.k] === s.on; });
      var allOn = PIPE_STATUS.every(function (s) { return f.statuses[s.k]; });
      if (allOn) parts.push('전체 상태'); else if (!dflt) parts.push('일부 상태');
    }
    if (f.lp) parts.push('라지플레이트(대표층 ' + fmt(S.lpT) + '평↑)');
    if (f.q) parts.push("검색어 '" + esc(f.q) + "'");
    return parts.length ? parts.join(' · ') + ' 조건에서' : '전체 기준으로';
  }
  function qIndex(w) { var m = /^(\d{2})\.(\d)Q/.exec(w || ''); return m ? Number(m[1]) * 4 + Number(m[2]) - 1 : null; }
  function qLabel(i) { return String(Math.floor(i / 4)).padStart(2, '0') + '.' + (i % 4 + 1) + 'Q'; }

  function renderKpis(list) {
    if (S.tab === 'wh') return whKpis(list);
    if (S.tab === 'pipe') return pipeKpis(list);
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

  /* ---------------- 물류창고업 등록 DB ---------------- */
  // 업체 색: 전체 등록면적 상위 8곳은 고정 색(필터를 바꿔도 색 유지), 나머지 주요업체는 회색, 미분류는 연회색
  var WH_PAL = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
  var WH_OTHERS = '그 외(미분류)', WH_MINOR = '#8a92a3', WH_UNCLS = '#c9ced6';
  var WH_REGIONS = ['수도권', '충청권', '동남권', '대경권', '호남권', '강원권', '제주권', '미상'];

  function whPrep(d) {
    var names = d.groups.map(function (g) { return g.name; });
    var rows = d.rows.map(function (a, i) {
      var g = names[a[2]] || WH_OTHERS;
      return { kind: 'wh', id: 'w' + i, lat: a[0], lng: a[1], group: g, name: a[3] || '(이름 없음)', addr: a[4] || '', sido: a[5] || '미상',
        gen: a[6] || 0, cold: a[7] || 0, yard: a[8] || 0, lic: a[9] || '', area: (a[6] || 0) + (a[7] || 0),
        region: (d.regionOf || {})[a[5]] || '미상', text: [a[3], g, a[4], a[5]].join(' ').toLowerCase() };
    });
    var tot = {};
    rows.forEach(function (r) { tot[r.group] = (tot[r.group] || 0) + r.area; });
    var order = names.filter(function (n) { return n !== WH_OTHERS && tot[n]; }).sort(function (a, b) { return tot[b] - tot[a]; });
    var color = {};
    order.forEach(function (n, i) { color[n] = i < WH_PAL.length ? WH_PAL[i] : WH_MINOR; });
    color[WH_OTHERS] = WH_UNCLS;
    var W = { rows: rows, order: order.concat([WH_OTHERS]), color: color, asOf: d.asOf || '', core: {} };
    d.groups.forEach(function (g) { W.core[g.name] = g.core; });
    var f = S.f.wh;
    W.order.forEach(function (n) { f.groups[n] = true; });
    WH_REGIONS.forEach(function (n) { f.regions[n] = true; });
    S.data.wh = W;
  }

  function whLoad() {
    if (S.whLoading) return;
    S.whLoading = true;
    $('take').textContent = '물류창고업 등록 DB를 불러오는 중… (처음 한 번은 10~20초 걸릴 수 있습니다)';
    $('kpis').innerHTML = '';
    var url = CFG.apiUrl + (CFG.apiUrl.indexOf('?') >= 0 ? '&' : '?') + 'set=wh&k=' + encodeURIComponent(S.pw || '') + '&t=' + Date.now();
    fetch(url, { redirect: 'follow' }).then(function (r) { return r.json(); }).then(function (d) {
      S.whLoading = false;
      if (!d || !d.ok) { $('take').textContent = '물류창고업 등록 DB를 불러오지 못했습니다. ' + ((d && d.message) || ''); return; }
      whPrep(d);
      if (S.tab === 'wh') switchTab('wh');
    }).catch(function (err) {
      S.whLoading = false;
      $('take').textContent = '물류창고업 등록 DB를 불러오지 못했습니다. (' + (err && err.message ? err.message : err) + ')';
    });
  }

  function pyLabel(a) { return a >= 10000 ? (a / 10000).toFixed(1) + '만평' : fmt(a) + '평'; }

  function whOn() { var f = S.f.wh; return S.data.wh.order.filter(function (n) { return f.groups[n]; }); }
  function whSolo(name) {
    var m = S.f.wh.groups, keys = Object.keys(m);
    var only = keys.every(function (x) { return m[x] === (x === name); });
    keys.forEach(function (x) { m[x] = only ? true : x === name; });   // 이미 그 업체만 보고 있으면 전체로
    draw();
  }

  function whKpis(list) {
    var W = S.data.wh, h = '';
    var all = W.rows.length;
    var sum = 0, gen = 0, cold = 0, cap = 0, by = {};
    list.forEach(function (r) { sum += r.area; gen += r.gen; cold += r.cold; if (r.region === '수도권') cap += r.area; by[r.group] = (by[r.group] || 0) + r.area; });
    var rank = Object.keys(by).filter(function (n) { return n !== WH_OTHERS; }).sort(function (a, b) { return by[b] - by[a]; });
    var cut = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
    var recent = list.filter(function (r) { return r.lic >= cut; });
    var pct = function (v) { return sum ? Math.round(v / sum * 1000) / 10 : 0; };
    h += tile('등록 센터', fmt(list.length), '곳', '영업중 전체 ' + fmt(all) + '곳 중');
    h += tile('등록면적 합계', man(sum), '만평', '상온 ' + man(gen) + ' · 저온 ' + man(cold) + '만평');
    h += tile('수도권 비중', pct(cap), '%', '수도권 ' + man(cap) + '만평');
    h += tile('1위 업체', rank.length ? esc(rank[0]) : '-', '', rank.length ? pyLabel(by[rank[0]]) + ' · 점유율 ' + pct(by[rank[0]]) + '%' : '', 'txt');
    h += tile('저온 비중', pct(cold), '%', '저온 ' + man(cold) + '만평');
    h += tile('최근 12개월 신규', fmt(recent.length), '곳', pyLabel(recent.reduce(function (a, r) { return a + r.area; }, 0)) + ' 신규 등록');
    $('kpis').innerHTML = h;
    var on = whOn();
    var cond = on.length === 1 ? "'" + esc(on[0]) + "' " : (on.length < W.order.length ? '선택한 ' + on.length + '개 업체의 ' : '');
    var base = condText();
    $('take').innerHTML = base + ' ' + cond + '물류창고업 등록 센터는 <b>' + fmt(list.length) + '곳</b>, 등록면적 <b>' + man(sum) + '만평</b>입니다. ' +
      (on.length > 1 && rank.length ? '업체별로는 ' + rank.slice(0, 3).map(function (n) { return esc(n) + '(' + pct(by[n]) + '%)'; }).join('·') + ' 순이고, ' : '') +
      '수도권 비중은 <b>' + pct(cap) + '%</b>입니다. <span class="muted">(등록면적 기준 — 자가물류 등 미등록 센터는 빠짐)</span>';
    $('sumNote').textContent = '물류창고업 등록 DB ' + (W.asOf || '') + ' 수집 기준';
  }

  function whPanel() {
    var W = S.data.wh, f = S.f.wh, h = '';
    var cnt = {}, area = {};
    filtered('groups').forEach(function (r) { cnt[r.group] = (cnt[r.group] || 0) + 1; area[r.group] = (area[r.group] || 0) + r.area; });
    var rc = {};
    filtered('regions').forEach(function (r) { rc[r.region] = (rc[r.region] || 0) + 1; });
    h += '<div class="p-sec"><p class="p-title">업체</p><p class="p-hint">이름을 누르면 그 업체만 · 다시 누르면 전체 · □는 켜고 끄기</p>' +
      '<div class="chips" style="margin-bottom:6px"><button class="chip" data-wh="all">전체</button><button class="chip" data-wh="named">미분류 숨기기</button></div>';
    W.order.forEach(function (n) {
      h += '<button class="opt' + (f.groups[n] ? ' on' : '') + '" data-whg="' + esc(n) + '"><span class="ck" data-ck="1"></span><span class="sw" style="background:' + W.color[n] + '"></span>' +
        '<span class="lbl">' + esc(n) + '</span><span class="n">' + fmt(cnt[n] || 0) + '</span></button>';
    });
    h += '</div><div class="p-sec"><p class="p-title">권역</p><div class="chips">';
    WH_REGIONS.forEach(function (k) { if (rc[k] || !f.regions[k]) h += '<button class="chip' + (f.regions[k] ? ' on' : '') + '" data-whr="' + k + '">' + k + ' <span class="mono">' + (rc[k] || 0) + '</span></button>'; });
    h += '</div></div><div class="p-sec"><p class="p-title">지도 범위</p><div class="chips"><button class="chip" data-view="cap">수도권</button><button class="chip" data-view="kr">전국</button></div>' +
      '<p class="p-note">영업중·등록면적이 있는 건만 표시합니다. 중복 등록 의심 건은 1건만 남겼습니다.</p></div>';
    var el = $('panel');
    el.innerHTML = h;
    el.querySelectorAll('[data-period]').forEach(function (b) {
      b.addEventListener('click', function () { setPeriod(S.data.deals, b.getAttribute('data-period')); draw(); });
    });
    el.querySelectorAll('[data-whg]').forEach(function (b) {
      b.addEventListener('click', function (e) {
        var n = b.getAttribute('data-whg');
        if (e.target.getAttribute('data-ck') || e.shiftKey) { f.groups[n] = !f.groups[n]; draw(); } else whSolo(n);
      });
    });
    el.querySelectorAll('[data-wh]').forEach(function (b) {
      b.addEventListener('click', function () {
        var v = b.getAttribute('data-wh');
        W.order.forEach(function (n) { f.groups[n] = v === 'all' ? true : n !== WH_OTHERS; });
        draw();
      });
    });
    el.querySelectorAll('[data-whr]').forEach(function (b) {
      b.addEventListener('click', function (e) {
        var k = b.getAttribute('data-whr'), m = f.regions;
        if (e.shiftKey) { var only = Object.keys(m).every(function (x) { return m[x] === (x === k); }); Object.keys(m).forEach(function (x) { m[x] = only ? true : x === k; }); }
        else m[k] = !m[k];
        draw();
      });
    });
    el.querySelectorAll('[data-view]').forEach(function (b) {
      b.addEventListener('click', function () {
        var k = window.kakao.maps;
        if (b.getAttribute('data-view') === 'kr') { S.map.setLevel(13); S.map.setCenter(new k.LatLng(36.3, 127.8)); }
        else { S.map.setLevel(10); S.map.setCenter(new k.LatLng(37.33, 127.22)); }
      });
    });
  }

  // 차트·표: 업체 필터는 빼고(다른 필터만 적용) 전체 업체를 보여 주고, 선택된 업체를 강조
  function whCharts() {
    var W = S.data.wh, f = S.f.wh, base = filtered('groups');
    var agg = {}, total = { cnt: 0, area: 0, gen: 0, cold: 0, yard: 0, cap: 0, nCnt: 0, nArea: 0, reg: {} };
    var cut = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
    W.order.forEach(function (n) { agg[n] = { cnt: 0, area: 0, gen: 0, cold: 0, yard: 0, cap: 0, nCnt: 0, nArea: 0, reg: {} }; });
    base.forEach(function (r) {
      [agg[r.group], total].forEach(function (a) {
        a.cnt++; a.area += r.area; a.gen += r.gen; a.cold += r.cold; a.yard += r.yard;
        if (r.region === '수도권') a.cap += r.area;
        if (r.lic >= cut) { a.nCnt++; a.nArea += r.area; }
        a.reg[r.region] = (a.reg[r.region] || 0) + r.area;
      });
    });
    var named = W.order.filter(function (n) { return n !== WH_OTHERS && agg[n].cnt; }).sort(function (a, b) { return agg[b].area - agg[a].area; });
    var dim = function (n) { return f.groups[n] ? '' : ' dim'; };
    var pct = function (v) { return total.area ? (v / total.area * 100).toFixed(1) : '0.0'; };

    // 1) 업체별 등록면적 막대(가로)
    var bars = named.slice(0, 15), maxA = Math.max.apply(null, bars.map(function (n) { return agg[n].area; }).concat([1]));
    var boxW = $('whCharts').clientWidth || ($('kpis').clientWidth || 1000);
    var rowH = 24, labW = 118, valW = 124, W0 = Math.max(380, Math.round(boxW >= 1000 ? boxW * 0.6 - 48 : boxW - 36)), plotW = W0 - labW - valW, H0 = bars.length * rowH + 6;
    var svg = '<svg class="whbar" width="' + W0 + '" height="' + H0 + '" viewBox="0 0 ' + W0 + ' ' + H0 + '" role="img" aria-label="업체별 등록면적 막대그래프">';
    bars.forEach(function (n, i) {
      var a = agg[n], y = i * rowH + 4, w = Math.max(2, a.area / maxA * plotW);
      svg += '<g class="bar' + dim(n) + '" data-solo="' + esc(n) + '"><title>' + esc(n) + ' · ' + fmt(a.area) + '평 (' + a.cnt + '곳) · 상온 ' + fmt(a.gen) + ' / 저온 ' + fmt(a.cold) + '</title>' +
        '<rect class="hit" x="0" y="' + (y - 2) + '" width="' + W0 + '" height="' + rowH + '"></rect>' +
        '<text class="lab" x="' + (labW - 8) + '" y="' + (y + 13) + '" text-anchor="end">' + esc(n) + '</text>' +
        '<rect x="' + labW + '" y="' + (y + 2) + '" width="' + w + '" height="14" rx="3" fill="' + W.color[n] + '"></rect>' +
        '<text class="val" x="' + (labW + w + 6) + '" y="' + (y + 13) + '">' + man(a.area) + '만평 · ' + pct(a.area) + '%</text></g>';
    });
    svg += '</svg>';

    // 2) 업체별 비중 도넛(상위 8 + 기타 주요업체 + 미분류)
    var top = named.slice(0, 8), restA = named.slice(8).reduce(function (s, n) { return s + agg[n].area; }, 0);
    var parts = top.map(function (n) { return { n: n, v: agg[n].area, c: W.color[n] }; });
    if (restA) parts.push({ n: '기타 주요업체', v: restA, c: WH_MINOR });
    if (agg[WH_OTHERS].area) parts.push({ n: WH_OTHERS, v: agg[WH_OTHERS].area, c: WH_UNCLS });
    var cx = 110, cy = 110, R = 100, r0 = 62, ang = -Math.PI / 2, tot = parts.reduce(function (s, p) { return s + p.v; }, 0) || 1;
    var pie = '<svg class="whpie" viewBox="0 0 220 220" role="img" aria-label="업체별 비중 원그래프">';
    parts.forEach(function (p) {
      var a1 = ang, a2 = ang + p.v / tot * Math.PI * 2; ang = a2;
      if (a2 - a1 >= Math.PI * 2 - 1e-6) a2 -= 1e-4;
      var large = a2 - a1 > Math.PI ? 1 : 0;
      var P = function (rr, t) { return (cx + rr * Math.cos(t)).toFixed(2) + ' ' + (cy + rr * Math.sin(t)).toFixed(2); };
      pie += '<path class="seg' + (p.n === '기타 주요업체' ? '' : dim(p.n)) + '"' + (W.color[p.n] ? ' data-solo="' + esc(p.n) + '"' : '') + ' d="M' + P(R, a1) + ' A' + R + ' ' + R + ' 0 ' + large + ' 1 ' + P(R, a2) + ' L' + P(r0, a2) + ' A' + r0 + ' ' + r0 + ' 0 ' + large + ' 0 ' + P(r0, a1) + ' Z" fill="' + p.c + '"><title>' + esc(p.n) + ' ' + (p.v / tot * 100).toFixed(1) + '% · ' + man(p.v) + '만평</title></path>';
    });
    pie += '<text class="pie-num" x="' + cx + '" y="' + (cy - 2) + '" text-anchor="middle">' + man(total.area) + '</text><text class="pie-unit" x="' + cx + '" y="' + (cy + 16) + '" text-anchor="middle">만평 · ' + fmt(total.cnt) + '곳</text></svg>';
    var lg = '<div class="pie-legend">';
    parts.forEach(function (p) { lg += '<div class="li' + (p.n === '기타 주요업체' ? '' : dim(p.n)) + '"' + (W.color[p.n] ? ' data-solo="' + esc(p.n) + '"' : '') + '><i style="background:' + p.c + '"></i><span>' + esc(p.n) + '</span><b>' + (p.v / tot * 100).toFixed(1) + '%</b></div>'; });
    lg += '</div>';

    // 3) 업체별 현황 표
    var t = '<table class="subtable whtab"><thead><tr><th>업체(그룹)</th><th class="r">등록건수</th><th class="r">합계(평)</th><th class="r">상온(평)</th><th class="r">저온(평)</th><th class="r">보관장소(평)</th><th class="r">점유율</th><th class="r">수도권 비중</th><th class="r">최근12개월 신규</th></tr></thead><tbody>';
    named.concat(agg[WH_OTHERS].cnt ? [WH_OTHERS] : []).forEach(function (n) {
      var a = agg[n];
      t += '<tr class="' + dim(n) + '" data-solo="' + esc(n) + '"><td><span class="sw" style="background:' + W.color[n] + '"></span>' + esc(n) + '</td><td class="r">' + fmt(a.cnt) + '</td><td class="r">' + fmt(a.area) + '</td><td class="r">' + fmt(a.gen) + '</td><td class="r">' + fmt(a.cold) + '</td><td class="r">' + fmt(a.yard) + '</td><td class="r">' + pct(a.area) + '%</td><td class="r">' + (a.area ? (a.cap / a.area * 100).toFixed(1) : '0.0') + '%</td><td class="r">' + a.nCnt + '곳 · ' + fmt(a.nArea) + '평</td></tr>';
    });
    t += '<tr class="sum"><td>합계</td><td class="r">' + fmt(total.cnt) + '</td><td class="r">' + fmt(total.area) + '</td><td class="r">' + fmt(total.gen) + '</td><td class="r">' + fmt(total.cold) + '</td><td class="r">' + fmt(total.yard) + '</td><td class="r">100%</td><td class="r">' + (total.area ? (total.cap / total.area * 100).toFixed(1) : '0.0') + '%</td><td class="r">' + total.nCnt + '곳 · ' + fmt(total.nArea) + '평</td></tr></tbody></table>';

    // 4) 업체 × 권역 등록면적 표
    var t2 = '<table class="subtable whtab"><thead><tr><th>업체(그룹)</th>' + WH_REGIONS.filter(function (k) { return total.reg[k]; }).map(function (k) { return '<th class="r">' + k + '</th>'; }).join('') + '</tr></thead><tbody>';
    var regs = WH_REGIONS.filter(function (k) { return total.reg[k]; });
    named.concat(agg[WH_OTHERS].cnt ? [WH_OTHERS] : []).forEach(function (n) {
      t2 += '<tr class="' + dim(n) + '" data-solo="' + esc(n) + '"><td><span class="sw" style="background:' + W.color[n] + '"></span>' + esc(n) + '</td>' + regs.map(function (k) { return '<td class="r">' + (agg[n].reg[k] ? fmt(agg[n].reg[k]) : '–') + '</td>'; }).join('') + '</tr>';
    });
    t2 += '<tr class="sum"><td>합계</td>' + regs.map(function (k) { return '<td class="r">' + fmt(total.reg[k]) + '</td>'; }).join('') + '</tr></tbody></table>';

    var el = $('whCharts');
    el.innerHTML = '<div class="sec-label"><h2>업체별 등록면적</h2><span>막대·원·표를 누르면 그 업체만 지도에 표시 · 업체 필터를 뺀 나머지 조건 기준</span></div>' +
      '<div class="whgrid"><section class="card whcard"><div class="card-head"><b>업체별 등록면적</b><span class="count">상위 15개 업체 · 미분류 제외</span></div><div class="whbody">' + svg + '</div></section>' +
      '<section class="card whcard"><div class="card-head"><b>업체별 비중</b><span class="count">등록면적 기준</span></div><div class="whbody pie-wrap">' + pie + lg + '</div></section></div>' +
      '<section class="card whcard mt"><div class="card-head"><b>업체별 현황</b><span class="count">단위: 평 · 신규 = 인허가일 최근 12개월</span></div><div class="tablewrap">' + t + '</div></section>' +
      '<section class="card whcard mt"><div class="card-head"><b>업체 × 권역 등록면적</b><span class="count">단위: 평</span></div><div class="tablewrap">' + t2 + '</div></section>';
    el.querySelectorAll('[data-solo]').forEach(function (b) {
      b.addEventListener('click', function () { whSolo(b.getAttribute('data-solo')); $('map').scrollIntoView({ behavior: 'smooth', block: 'center' }); });
    });
  }

  function whInfo(r) {
    var h = '<button class="x" title="닫기">×</button><h3>' + esc(r.name) + '</h3>';
    h += '<div class="tags"><span class="pill" style="color:' + (r.group === WH_OTHERS ? '#6b7280' : colorOf(r)) + '">' + esc(r.group === WH_OTHERS ? '미분류' : r.group) + '</span><span class="tag">' + esc(r.sido) + '</span>' + (r.cold ? '<span class="tag">저온 포함</span>' : '') + '</div><table>';
    h += row('등록면적', fmt(r.area) + '평');
    h += row('상온/저온', fmt(r.gen) + ' / ' + fmt(r.cold) + '평');
    h += row('보관장소', r.yard ? fmt(r.yard) + '평' : '');
    h += row('인허가일', r.lic);
    h += row('주소', r.addr);
    return h + '</table><button class="go">세부 내용 보기 ↓</button>';
  }

  function whDetail(r) {
    var h = '<div class="dhead"><h2>' + esc(r.name) + '</h2><span class="pill" style="color:' + (r.group === WH_OTHERS ? '#6b7280' : colorOf(r)) + '">' + esc(r.group === WH_OTHERS ? '미분류' : r.group) + '</span><span class="tag">' + esc(r.region) + '</span></div>';
    h += dkpis([['등록면적', fmt(r.area) + '평'], ['상온', fmt(r.gen) + '평'], ['저온', fmt(r.cold) + '평'], ['보관장소', r.yard ? fmt(r.yard) + '평' : ''], ['인허가일', r.lic]]);
    h += '<div class="dgrid">';
    h += card('기본 정보', kv([['업체(그룹)', r.group], ['사업장명', r.name], ['주소', r.addr], ['시도', r.sido], ['권역', r.region], ['인허가일', r.lic]]));
    h += card('등록면적', kv([['상온(일반창고)', fmt(r.gen) + '평'], ['저온(냉동·냉장)', fmt(r.cold) + '평'], ['보관장소', fmt(r.yard) + '평 (합계 제외)'], ['합계', fmt(r.area) + '평 (' + fmt(r.area * 3.305785) + '㎡)']]));
    h += '</div>';
    h += related(r, 'centers', '이 위치의 수도권 물류센터 DB');
    h += '<p class="geo">좌표: 행안부 원자료(중부원점 TM → 위경도 변환). 물류창고업 등록 기준이라 실제 센터 연면적과 다를 수 있습니다.</p>';
    return h;
  }

  /* ---------------- 공급 파이프라인 ---------------- */
  function pipeStatus(raw) {
    raw = String(raw || '').trim();
    for (var i = 0; i < PIPE_STATUS.length; i++) if (PIPE_STATUS[i].raw.indexOf(raw) >= 0 || PIPE_STATUS[i].k === raw) return i;
    return -1;
  }

  function pipePrep(d) {
    var P = d.pipe;
    P.ix = index(P.headers);
    var regions = {}, years = {};
    P.color = {};
    PIPE_STATUS.forEach(function (s) { P.color[s.k] = s.c; });
    P.rows.forEach(function (r) {
      r.kind = 'pipe'; r.id = 'p' + r.r;
      var addr = g(P, r, '소재지(지번)');
      r.name = clean(g(P, r, '건물명')) || (addr.split(' ').slice(-2).join(' ').replace(/번지/g, '') + ' 창고');
      r.area = num(g(P, r, '연면적(평)')) || 0;
      var si = pipeStatus(g(P, r, '상태'));
      r.statusIx = si < 0 ? 99 : si;
      r.status = si < 0 ? (clean(g(P, r, '상태')) || '미상') : PIPE_STATUS[si].k;
      if (si < 0 && !P.color[r.status]) P.color[r.status] = '#888';
      r.region = clean(g(P, r, '권역')) || '미상';
      r.sgg = clean(g(P, r, '시군구'));
      var done = String(g(P, r, '사용승인일')).replace(/[^0-9]/g, '');
      r.due = r.status === '최근 준공' && done.length >= 6 ? done.slice(0, 4) + '.' + done.slice(4, 6) : clean(g(P, r, '예상준공'));
      r.dueSort = r.due || '9999.99';
      r.dueYear = /^\d{4}/.test(r.due) ? r.due.slice(0, 4) : '미정';
      r.permit = String(g(P, r, '허가일')).replace(/[^0-9]/g, '');
      r.start = String(g(P, r, '실착공일')).replace(/[^0-9]/g, '');
      r.text = [r.name, addr, r.sgg, g(P, r, '광역(특별)시·도'), g(P, r, '메모'), r.status].join(' ').toLowerCase();
      regions[r.region] = 1; years[r.dueYear] = 1;
    });
    P.regionList = Object.keys(regions).sort();
    P.yearList = Object.keys(years).sort(function (a, b) { return a === '미정' ? 1 : b === '미정' ? -1 : a.localeCompare(b); });
    var f = S.f.pipe;
    PIPE_STATUS.forEach(function (s) { f.statuses[s.k] = s.on; });
    Object.keys(P.color).forEach(function (k) { if (f.statuses[k] === undefined) f.statuses[k] = true; });
    P.regionList.forEach(function (k) { f.regions[k] = true; });
    P.yearList.forEach(function (k) { f.years[k] = true; });
    P.generatedAt = d.generatedAt || '';
    S.data.pipe = P;
  }

  function pipeLoad(silent) {
    if (!silent) { $('take').textContent = '공급 파이프라인을 불러오는 중…'; $('kpis').innerHTML = ''; }
    if (S.pipeLoading) return;
    S.pipeLoading = true;
    var url = CFG.apiUrl + (CFG.apiUrl.indexOf('?') >= 0 ? '&' : '?') + 'set=pipe&k=' + encodeURIComponent(S.pw || '') + '&t=' + Date.now();
    fetch(url, { redirect: 'follow' }).then(function (r) { return r.json(); }).then(function (d) {
      S.pipeLoading = false;
      if (!d || !d.ok || !d.pipe) { if (S.tab === 'pipe') $('take').textContent = '공급 파이프라인을 불러오지 못했습니다. ' + ((d && d.message) || '(서버에 파이프라인 기능이 아직 배포되지 않았을 수 있습니다)'); return; }
      pipePrep(d);
      if (S.tab === 'pipe') switchTab('pipe');
      else if (S.tab === 'centers') { drawGhosts(); renderPanel(); }
    }).catch(function (err) {
      S.pipeLoading = false;
      if (S.tab === 'pipe') $('take').textContent = '공급 파이프라인을 불러오지 못했습니다. (' + (err && err.message ? err.message : err) + ')';
    });
  }

  function pipeKpis(list) {
    var P = S.data.pipe, f = S.f.pipe, h = '';
    var sumA = function (arr) { return arr.reduce(function (a, r) { return a + (r.area || 0); }, 0); };
    var by = function (k) { return list.filter(function (r) { return r.status === k; }); };
    var yr = String(new Date().getFullYear()), ny = String(+yr + 1);
    var building = list.filter(function (r) { return r.status !== '최근 준공'; });
    var dueThis = building.filter(function (r) { return r.dueYear === yr; }), dueNext = building.filter(function (r) { return r.dueYear === ny; });
    var con = by('공사중'), soon = by('준공 임박'), wait = by('미착공'), done = by('최근 준공');
    var sum = sumA(list);
    h += tile('표시 건수', fmt(list.length), '건', '전체 ' + fmt(P.rows.length) + '건 중');
    h += tile('연면적 합계', man(sum), '만평', '평균 ' + fmt(list.length ? sum / list.length : 0) + '평');
    h += tile('공사중', fmt(con.length + soon.length), '건', man(sumA(con) + sumA(soon)) + '만평 · 준공 임박 ' + soon.length + '건');
    h += tile(yr.slice(2) + '년 예상준공', man(sumA(dueThis)), '만평', dueThis.length + '건 (미준공)');
    h += tile(ny.slice(2) + '년 예상준공', man(sumA(dueNext)), '만평', dueNext.length + '건');
    h += tile('미착공(3년 이내)', fmt(wait.length), '건', man(sumA(wait)) + '만평');
    $('kpis').innerHTML = h;
    var hidden = P.rows.filter(function (r) { return !f.statuses[r.status]; });
    $('take').innerHTML = condText() + ' 공급 파이프라인은 <b>' + fmt(list.length) + '건 · ' + man(sum) + '만평</b>입니다. 공사중 <b>' + fmt(con.length + soon.length) + '건 · ' + man(sumA(con) + sumA(soon)) + '만평</b>' +
      (soon.length ? '(준공 임박 ' + soon.length + '건 포함)' : '') + ', 미착공 ' + fmt(wait.length) + '건 · ' + man(sumA(wait)) + '만평' + (done.length ? ', 최근 준공 ' + done.length + '건' : '') + '입니다.' +
      (hidden.length ? ' <span class="muted">숨긴 상태 ' + fmt(hidden.length) + '건(' + man(sumA(hidden)) + '만평)은 오른쪽 상태에서 켤 수 있습니다.</span>' : '');
    $('sumNote').textContent = '공급 파이프라인 · 건축HUB 인허가 기준(매월 갱신)';
  }

  function pipeInfo(r) {
    var P = S.data.pipe, G = function (n) { return g(P, r, n); };
    var h = '<button class="x" title="닫기">×</button><h3>' + esc(r.name) + '</h3>';
    h += '<div class="tags"><span class="pill" style="color:' + colorOf(r) + '">' + esc(r.status) + '</span>' + (has(G('건축구분')) ? '<span class="tag">' + esc(G('건축구분')) + '</span>' : '') + '<span class="tag">' + esc(stripNo(r.region)) + '</span></div><table>';
    h += row('연면적', r.area ? fmt(r.area) + '평' : '');
    h += row('허가', ymd(G('허가일')));
    h += row('착공', ymd(G('실착공일')) || (has(G('착공예정일')) ? ymd(G('착공예정일')) + ' (예정)' : ''));
    h += row(r.status === '최근 준공' ? '사용승인' : '예상준공', r.status === '최근 준공' ? ymd(G('사용승인일')) : r.due);
    h += row('메모', clean(G('메모')));
    return h + '</table><button class="go">세부 내용 보기 ↓</button>';
  }

  function pipeDetail(r) {
    var P = S.data.pipe, G = function (n) { return g(P, r, n); };
    var U = used(P, ['단계', '상태', '건물명', '소재지(지번)', '권역', '광역(특별)시·도', '시군구', '연면적(평)', '연면적(㎡)', '건축구분', '허가일', '착공예정일', '실착공일', '경과(개월)', '예상공기(개월)', '예상준공', '예상준공분기', '사용승인일', '인허가PK', '메모']);
    var h = '<div class="dhead"><h2>' + esc(r.name) + '</h2><span class="pill" style="color:' + colorOf(r) + '">' + esc(r.status) + '</span><span class="tag">' + esc(stripNo(r.region)) + '</span><span class="muted">시트 ' + r.r + '행</span></div>';
    h += dkpis([['연면적', r.area ? fmt(r.area) + '평' : ''], ['상태', r.status], ['허가', ymd(G('허가일'))], ['착공', ymd(G('실착공일'))], [r.status === '최근 준공' ? '사용승인' : '예상준공', r.status === '최근 준공' ? ymd(G('사용승인일')) : r.due]]);
    h += '<div class="dgrid">';
    h += card('기본 정보', kv([['단계', G('단계')], ['상태(시트)', G('상태')], ['지번 주소', G('소재지(지번)')], ['광역시·도', G('광역(특별)시·도')], ['시군구', G('시군구')], ['권역', stripNo(G('권역'))], ['건축구분', G('건축구분')], ['메모', G('메모')]]));
    h += card('규모', kv([['연면적', r.area ? fmt(r.area) + '평' : ''], ['연면적(㎡)', has(G('연면적(㎡)')) ? G('연면적(㎡)') + '㎡' : '']]));
    h += card('일정', kv([['허가일', ymd(G('허가일'))], ['착공예정일', ymd(G('착공예정일'))], ['실착공일', ymd(G('실착공일'))], ['경과', has(G('경과(개월)')) ? G('경과(개월)') + '개월(착공 기준)' : ''], ['예상공기', has(G('예상공기(개월)')) ? G('예상공기(개월)') + '개월' : ''], ['예상준공', [G('예상준공'), G('예상준공분기')].filter(has).join(' · ')], ['사용승인일', ymd(G('사용승인일'))], ['인허가PK', G('인허가PK')]]));
    var more = rest(P, r, U);
    if (more) h += card('기타 항목', more);
    h += '</div>';
    h += related(r, 'centers', '이 위치의 수도권 물류센터 DB');
    h += related(r, 'deals', '이 위치의 거래사례');
    h += geoNote(r);
    return h;
  }

  /* ---------------- 탭 ---------------- */
  function switchTab(tab) {
    S.tab = tab;
    clearSearchPin();
    $('mapLabel').textContent = tab === 'centers' ? '센터 위치' : tab === 'wh' ? '물류창고업 등록 센터 위치' : tab === 'pipe' ? '공급 파이프라인 위치' : '거래사례 위치';
    $('mapNote').textContent = tab === 'centers' ? '원 색 = 권역 · 크기 = 연면적 · 기본은 1만평 이상만 표시' : tab === 'wh' ? '원 색 = 업체(등록면적 상위 8곳) · 회색 = 그 외 · 연회색 = 미분류' : tab === 'pipe' ? '원 색 = 상태 · 크기 = 연면적 · 지연·장기미착공은 기본 숨김' : '원 색 = 평가(시트 셀 색) · 크기 = 연면적';
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (b) { b.classList.toggle('on', b.getAttribute('data-tab') === tab); });
    if (!S.data) return;
    if (tab === 'wh' && !S.data.wh) { $('whCharts').hidden = true; whLoad(); return; }
    if (tab === 'pipe' && !S.data.pipe) { $('whCharts').hidden = true; pipeLoad(); return; }
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
    if (r.kind === 'centers') h = centerDetail(r); else if (r.kind === 'wh') h = whDetail(r); else if (r.kind === 'pipe') h = pipeDetail(r); else h = dealDetail(r);
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
    ['regions', 'grades', 'years', 'types', 'groups', 'statuses'].forEach(function (k) { if (f[k]) Object.keys(f[k]).forEach(function (x) { f[k][x] = true; }); });
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
    h += card('기본 정보', kv([['상태', stripNo(G('상태'))], ['도로명 주소', G('소재지(도로명)')], ['지번 주소', r.jibun], ['현 소유자', G('현 소유자')], ['매도인/시행자', G('매도인(or 시행자)')], ['용도', G('용도')], ['비고', G('비고')]]));
    h += card('규모·건축', kv([['연면적', r.area ? fmt(r.area) + '평' : ''], ['대지면적', has(G('대지면적(평)')) ? G('대지면적(평)') + '평' : ''], ['건축면적', has(G('건축면적(평)')) ? G('건축면적(평)') + '평' : ''], ['건폐율', has(G('건폐율(%)')) ? G('건폐율(%)') + '%' : ''], ['용적률', has(G('용적률(%)')) ? G('용적률(%)') + '%' : ''], ['층수', [has(G('지상층')) ? '지상 ' + G('지상층') : '', has(G('지하층')) ? '지하 ' + G('지하층') : ''].filter(Boolean).join(' / ')], ['구조', G('건축구조')], ['주용도', G('주용도')]]));
    h += card('일정', kv([['인허가', ymd(G('인허가일'))], ['착공', ymd(G('착공일'))], ['준공', ymd(G('준공일'))], ['건축연령', G('건축연령')]]));
    h += card('거래 정보', kv([['최근 거래', G('최근 거래시점')], ['거래가격', has(G('거래가격(억원)')) ? G('거래가격(억원)') + '억원' : ''], ['평단가', has(G('평단가')) ? G('평단가') + '만원' : ''], ['Cap.', G('Cap.')]]) || '<p class="placeholder">시트에 거래 정보가 없습니다.</p>');
    var more = rest(C, r, U);
    if (more) h += card('기타 항목', more);
    h += '</div>';

    h += floorBox(r);
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
      ['대표층(평)', function (r) { return r.rep ? fmt(r.rep) + (r.lp ? ' LP' : '') : ''; }, 'rep', 'r'],
      ['권역', function (r) { return stripNo(r.region); }, 'region', '', true],
      ['현 소유자', function (r) { return r.owner; }, 'owner'],
      ['준공', function (r) { return ymd(r.done); }, 'done'],
      ['최근 거래', function (r) { var C = S.data.centers; return [clean(g(C, r, '최근 거래시점')), has(g(C, r, '거래가격(억원)')) ? g(C, r, '거래가격(억원)') + '억' : ''].filter(Boolean).join(' '); }, null],
      ['지도', function (r) { return hasXY(r) ? '' : '좌표없음'; }, null, 'dim']
    ],
    pipe: [
      ['건물명', function (r) { return r.name; }, 'name'],
      ['상태', function (r) { return r.status; }, 'statusIx', '', true],
      ['연면적(평)', function (r) { return r.area ? fmt(r.area) : ''; }, 'area', 'r'],
      ['시군구', function (r) { return r.sgg; }, 'sgg'],
      ['허가', function (r) { return ymd(g(S.data.pipe, r, '허가일')); }, 'permit'],
      ['착공', function (r) { return ymd(g(S.data.pipe, r, '실착공일')); }, 'start'],
      ['예상준공', function (r) { return r.due; }, 'dueSort'],
      ['지도', function (r) { return hasXY(r) ? '' : '좌표없음'; }, null, 'dim']
    ],
    wh: [
      ['사업장명', function (r) { return r.name; }, 'name'],
      ['업체(그룹)', function (r) { return r.group; }, 'group', '', true],
      ['시도', function (r) { return r.sido; }, 'sido'],
      ['등록면적(평)', function (r) { return fmt(r.area); }, 'area', 'r'],
      ['상온(평)', function (r) { return fmt(r.gen); }, 'gen', 'r'],
      ['저온(평)', function (r) { return r.cold ? fmt(r.cold) : ''; }, 'cold', 'r'],
      ['인허가일', function (r) { return r.lic; }, 'lic'],
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
    $('listTitle').textContent = S.tab === 'centers' ? '센터 목록' : S.tab === 'wh' ? '물류창고업 등록 센터 목록' : S.tab === 'pipe' ? '공급 파이프라인 목록' : '거래사례 목록';
    $('listInfo').textContent = '필터 결과 ' + fmt(arr.length) + (S.tab === 'deals' ? '건' : '곳') + ' · 제목을 누르면 정렬, 행을 누르면 지도에서 위치를 보여줍니다';
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
        if (f.sort === k) f.dir = -f.dir; else { f.sort = k; f.dir = (k === 'area' || k === 'price' || k === 'when' || k === 'rep') ? -1 : 1; }
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
