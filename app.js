/* ─────────────────────────────────────────────────────────
   까미 · 부이 합동 비서실 — app
   저장: localStorage (기본) / Firebase Realtime Database REST (선택)
   ───────────────────────────────────────────────────────── */
(() => {
  'use strict';

  const ROOMS = [
    { id: 'meeting', name: '대회의실', icon: '🏢' },
    { id: 'work',    name: '작업실',   icon: '💻' },
    { id: 'notion',  name: '노션 데스크', icon: '📓' },
    { id: 'lounge',  name: '라운지',   icon: '☕' },
  ];
  const ROOM_LABEL = Object.fromEntries(ROOMS.map(r => [r.id, `${r.icon} ${r.name}`]));

  const PEOPLE = {
    minu:  { name: '민우 님',    short: '민우', role: '대표 · 총괄',        order: 0 },
    karmi: { name: '까미(피클)', short: '까미', role: '결정사항 실행 · 총괄', order: 1 },
    bui:   { name: '부이',       short: '부이', role: '의견 취합 · 리서치',  order: 2 },
  };

  const DEFAULT_BUBBLE = {
    minu: '총괄 지시 중',
    karmi: '결정안 정리 중',
    bui: '대안 3개 조사 중',
  };

  const STATUSES = ['의논중', '진행중', '완료'];
  const ST_CLASS = { '의논중': 's-talk', '진행중': 's-doing', '완료': 's-done' };

  const K_FB = 'yeonOffice.fbUrl';
  const K_MSG = 'yeonOffice.messages';
  const K_TASK = 'yeonOffice.tasks';
  const K_CHAR = 'yeonOffice.chars';
  const K_UI = 'yeonOffice.ui';
  const POLL_MS = 3000;

  /* ── 상태 ───────────────────────────────────────────── */
  const state = {
    messages: [],
    tasks: [],
    chars: { minu: 'meeting', karmi: 'work', bui: 'notion' },
    author: 'minu',
    room: 'meeting',
    filter: 'all',
    fbUrl: '',
    sync: 'local',          // local | pending | connected | error
    pollTimer: null,
    syncNote: '',
  };

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const el = {
    feed: $('#feed'),
    feedCount: $('#feedCount'),
    feedFilter: $('#feedFilter'),
    boardList: $('#boardList'),
    boardProgress: $('#boardProgress'),
    map: $('#officeMap'),
    charLayer: $('#charLayer'),
    roomChips: $('#roomChips'),
    authorPicker: $('#authorPicker'),
    roomSelect: $('#roomSelect'),
    input: $('#msgInput'),
    composer: $('#composer'),
    composerHint: $('#composerHint'),
    syncBadge: $('#syncBadge'),
    syncLabel: $('#syncLabel'),
    footSync: $('#footSync'),
    mapSub: $('#mapSub'),
    navMeta: $('#navMeta'),
    toast: $('#toast'),
    modal: $('#dbModal'),
    dbForm: $('#dbForm'),
    dbUrl: $('#dbUrl'),
    dbStatus: $('#dbStatus'),
  };

  const chars = Object.fromEntries(
    $$('.char').map(node => [node.dataset.char, {
      node,
      bubble: node.querySelector('[data-bubble]'),
      base: DEFAULT_BUBBLE[node.dataset.char],
      timer: null,
      lastRoom: null,
    }])
  );

  /* ── 유틸 ───────────────────────────────────────────── */
  const pad = (n) => String(n).padStart(2, '0');
  const uid = (p) => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fmtText(s) {
    return escapeHtml(s).replace(/@(까미|부이|민우)(\(피클\))?/g, (m, who) =>
      `<span class="mention" data-who="${who}">${m}</span>`);
  }

  function fmtTime(ts) {
    const d = new Date(ts);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function fmtDay(ts) {
    const d = new Date(ts);
    const now = new Date();
    const same = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    if (same(d, now)) return '오늘';
    const y = new Date(now); y.setDate(now.getDate() - 1);
    if (same(d, y)) return '어제';
    return `${d.getMonth() + 1}월 ${d.getDate()}일`;
  }

  function load(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* 저장 불가 환경 */ }
  }

  let toastTimer = null;
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove('is-on'), 2600);
  }

  /* ── 시드 데이터 ────────────────────────────────────── */
  function seedMessages() {
    const now = Date.now();
    const m = (mins, author, room, text) => ({
      id: `seed-${mins}-${author}`, author, room, text, ts: now - mins * 60000,
    });
    return [
      m(186, 'minu',  'meeting', '까미야, 부이랑 합동으로 비서실 하나 만들어줘. 노션 의논방 결론부터 정리하고.'),
      m(181, 'karmi', 'notion',  '네. 노션 ‘피클·부이 앱 의논방’ 결정사항부터 정리했습니다.\n실무 실행·일정 관리·최종 결정안 도출은 까미, 다양한 아이디어·보조 시각·추가 대안 취합은 부이입니다.'),
      m(174, 'bui',   'meeting', '확인했습니다. 6개 안건 각각에 제 의견을 붙여서 올리겠습니다.'),
      m(158, 'bui',   'work',    '실행 범위부터 보면, 조회·비교·리서치는 제가, 예약·구매·전화 대행은 까미가 맡는 쪽이 충돌이 적습니다.'),
      m(151, 'karmi', 'work',    '동의합니다. 결제·전화처럼 되돌리기 어려운 건은 민우 님 승인 뒤에만 진행하는 조건으로 가겠습니다.'),
      m(139, 'minu',  'meeting', '좋아. 보안·개인정보는 무조건 비노출 원칙 지켜줘.'),
      m(132, 'karmi', 'work',    '보안·개인정보 항목은 완료 처리했습니다. 비밀번호·카드번호는 입력 카드로만 다루고 대화창에는 남기지 않습니다.'),
      m(96,  'bui',   'notion',  '비용·사용량 의견: 무료 구간 안에서 3초 폴링이면 체감 지연이 없고 크레딧 소모도 없습니다.'),
      m(88,  'bui',   'notion',  '속도·안정성은 인증이 걸린 사이트에서 끊기는 비율이 관건입니다. 실패 시 재시도 로그를 남기는 안을 제안합니다.'),
      m(41,  'karmi', 'work',    '@민우 님 비서실 페이지 배포 준비됐습니다. 깃허브 페이지를 켜면 바로 접속됩니다.'),
      m(12,  'minu',  'meeting', '확인. 링크 오면 바로 열어볼게.'),
    ];
  }

  function seedTasks() {
    return [
      { id: 't1', title: '실행 범위', owner: 'bui', status: '의논중',
        desc: '웹 조회·예약·구매·전화 대행 등 실제 손발이 되어 처리할 수 있는 작업 범위' },
      { id: 't2', title: '서비스 연동', owner: 'karmi', status: '진행중',
        desc: '캘린더·노션·깃허브·메일 등 외부 계정 연결 및 활용 수준' },
      { id: 't3', title: '기억과 맞춤화', owner: 'bui', status: '의논중',
        desc: '이전 대화·선호·말투·출력 규칙을 얼마나 일관되게 유지하는지' },
      { id: 't4', title: '속도·안정성', owner: 'karmi', status: '진행중',
        desc: '복잡한 요청이나 사이트 인증이 걸렸을 때 끝까지 마무리하는 비율' },
      { id: 't5', title: '비용·사용량', owner: 'bui', status: '의논중',
        desc: '무료·유료 구간 기준과 크레딧 소모 효율' },
      { id: 't6', title: '보안·개인정보', owner: 'karmi', status: '완료',
        desc: '비밀번호·결제 정보 입력 방식과 민감정보 비노출 원칙' },
      { id: 't7', title: '결정 · 실무 실행', owner: 'karmi', status: '완료',
        desc: '실무 실행·일정 관리·데이터 정리 및 최종 결정안 도출 담당' },
      { id: 't8', title: '결정 · 의견 취합', owner: 'bui', status: '완료',
        desc: '다양한 아이디어·보조 시각·추가 대안 의견 취합 담당' },
      { id: 't9', title: '비서실 페이지 배포', owner: 'karmi', status: '진행중',
        desc: '까미·부이 합동 비서실 웹페이지 제작과 GitHub Pages 공개' },
    ];
  }

  /* ── 초기화 ─────────────────────────────────────────── */
  let booted = false;
  function init() {
    if (booted) return;
    booted = true;
    Object.values(chars).forEach(c => c.bubble.classList.add('is-on'));
    state.fbUrl = localStorage.getItem(K_FB) || '';

    const savedMsgs = load(K_MSG, null);
    const savedTasks = load(K_TASK, null);
    state.messages = Array.isArray(savedMsgs) && savedMsgs.length ? savedMsgs : seedMessages();
    state.tasks = Array.isArray(savedTasks) && savedTasks.length ? savedTasks : seedTasks();

    const savedChars = load(K_CHAR, null);
    if (savedChars && typeof savedChars === 'object') Object.assign(state.chars, savedChars);

    const ui = load(K_UI, null);
    if (ui) {
      if (PEOPLE[ui.author]) state.author = ui.author;
      if (ROOM_LABEL[ui.room]) state.room = ui.room;
    }

    state.messages.sort((a, b) => a.ts - b.ts);
    save(K_MSG, state.messages);
    save(K_TASK, state.tasks);

    // 각 캐릭터를 마지막 발언 구역에 배치 (없으면 기본값)
    Object.keys(PEOPLE).forEach((who) => {
      const last = [...state.messages].reverse().find(m => m.author === who);
      if (last && ROOM_LABEL[last.room]) state.chars[who] = last.room;
    });

    renderAll();
    bindEvents();
    updateSyncBadge();

    if (state.fbUrl) {
      el.dbUrl.value = state.fbUrl;
      connectDb(state.fbUrl, { silent: true });
    }

    requestAnimationFrame(() => {
      layoutChars(true);
      scrollFeedToBottom(true);
    });
    window.addEventListener('load', () => layoutChars(true));
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => layoutChars(true));
    }
  }

  /* ── 렌더 ───────────────────────────────────────────── */
  function renderAll() {
    renderFeed();
    renderBoard();
    renderMap();
    renderFilters();
    renderMeta();
  }

  function renderMeta() {
    const decisions = state.tasks.filter(t => t.title.startsWith('결정')).length;
    const agenda = state.tasks.length - decisions;
    el.navMeta.textContent = `안건 ${agenda} · 결정 ${decisions}`;
  }

  function renderFilters() {
    const items = [{ id: 'all', label: '전체' }, ...ROOMS.map(r => ({ id: r.id, label: `${r.icon} ${r.name}` }))];
    el.feedFilter.innerHTML = items.map(it => {
      const n = it.id === 'all'
        ? state.messages.length
        : state.messages.filter(m => m.room === it.id).length;
      return `<button class="chip${state.filter === it.id ? ' is-active' : ''}" data-filter="${it.id}" type="button">
        ${it.label}<span style="opacity:.55;font-weight:700">${n}</span></button>`;
    }).join('');
  }

  function renderFeed() {
    const list = state.filter === 'all'
      ? state.messages
      : state.messages.filter(m => m.room === state.filter);

    el.feedCount.textContent = state.messages.length;

    if (!list.length) {
      el.feed.innerHTML = `<div class="empty-feed">이 구역에는 아직 대화가 없습니다.<br>아래 입력창에서 첫 말을 남겨보세요.</div>`;
      return;
    }

    let html = '';
    let day = '';
    list.forEach(m => {
      const d = fmtDay(m.ts);
      if (d !== day) { html += `<div class="day-sep">${d}</div>`; day = d; }
      const p = PEOPLE[m.author] || PEOPLE.minu;
      const av = `<div class="msg-av a-${m.author}" aria-hidden="true">
        <svg viewBox="0 0 100 104"><use href="#art-${m.author}"/></svg></div>`;
      html += `<div class="msg a-${m.author}${m.author === 'minu' ? ' is-mine' : ''}" data-id="${m.id}">
        ${av}
        <div class="msg-body">
          <div class="msg-meta">
            <b>${p.name}</b>
            <span class="room-tag">${ROOM_LABEL[m.room] || m.room}</span>
            <time datetime="${new Date(m.ts).toISOString()}">${fmtTime(m.ts)}</time>
          </div>
          <div class="msg-text">${fmtText(m.text)}</div>
        </div>
      </div>`;
    });
    el.feed.innerHTML = html;
  }

  function renderBoard() {
    const done = state.tasks.filter(t => t.status === '완료').length;
    el.boardProgress.textContent = `완료 ${done} / ${state.tasks.length}`;
    el.boardList.innerHTML = state.tasks.map((t, i) => {
      const owner = PEOPLE[t.owner] ? PEOPLE[t.owner].short : t.owner;
      return `<article class="task${t.status === '완료' ? ' is-done' : ''}" data-id="${t.id}">
        <div class="task-top">
          <span class="task-num">${String(i + 1).padStart(2, '0')}</span>
          <h3 title="${escapeHtml(t.title)}">${escapeHtml(t.title)}</h3>
        </div>
        <p>${escapeHtml(t.desc || '')}</p>
        <div class="task-foot">
          <span class="task-owner o-${t.owner}">${escapeHtml(owner)}</span>
          <button class="status-btn ${ST_CLASS[t.status] || 's-talk'}" data-status="${t.id}" type="button"
            title="눌러서 의논중 → 진행중 → 완료 순환">${t.status}</button>
        </div>
      </article>`;
    }).join('');
  }

  function renderMap() {
    const active = state.room;
    $$('.room').forEach(roomEl => {
      const id = roomEl.dataset.room;
      const occupants = Object.keys(PEOPLE).filter(who => state.chars[who] === id)
        .sort((a, b) => PEOPLE[a].order - PEOPLE[b].order);
      roomEl.classList.toggle('is-active', id === active);
      roomEl.querySelector('[data-count]').textContent = occupants.length;
      roomEl.querySelector('[data-occ]').innerHTML = occupants
        .map(who => `<span class="occ-dot" style="background:${
          who === 'karmi' ? '#7C4DFF' : who === 'bui' ? '#12A9A0' : '#D98B33'}"></span>`).join('');
    });

    $$('.room-chips .chip').forEach(c => c.classList.toggle('is-active', c.dataset.room === active));
    el.roomSelect.value = active;

    const working = Object.values(state.chars).filter(r => r !== 'lounge').length;
    el.mapSub.textContent = `지금 ${working}명 근무 중`;

    layoutChars();
  }

  /* ── 캐릭터 위치 ────────────────────────────────────── */
  let layoutRaf = 0;
  function layoutChars(instant) {
    cancelAnimationFrame(layoutRaf);
    layoutRaf = requestAnimationFrame(() => placeChars(instant));
  }

  function placeChars(instant) {
    if (!el.map || !el.map.getBoundingClientRect().width) return;
    const mapRect = el.map.getBoundingClientRect();

    const groups = {};
    Object.keys(PEOPLE).forEach(who => {
      (groups[state.chars[who]] ||= []).push(who);
    });

    Object.entries(groups).forEach(([roomId, people]) => {
      const roomEl = el.map.querySelector(`.room[data-room="${roomId}"]`);
      if (!roomEl) return;
      const r = roomEl.getBoundingClientRect();
      const w = roomEl.clientWidth;
      const h = roomEl.clientHeight;
      people.sort((a, b) => PEOPLE[a].order - PEOPLE[b].order);

      people.forEach((who, i) => {
        const node = chars[who].node;
        const cw = node.offsetWidth || 60;
        const ch = node.offsetHeight || 62;
        const fx = (i + 1) / (people.length + 1);
        const x = (r.left - mapRect.left) + w * fx - cw / 2;
        const y = (r.top - mapRect.top) + h - 20 - ch;

        if (instant) node.style.transition = 'none';
        node.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
        if (instant) {
          void node.offsetWidth; // 강제 리플로우로 transition 억제
          node.style.transition = '';
        }

        if (chars[who].lastRoom && chars[who].lastRoom !== roomId) {
          node.classList.remove('is-walking');
          void node.offsetWidth;
          node.classList.add('is-walking');
          setTimeout(() => node.classList.remove('is-walking'), 980);
        }
        chars[who].lastRoom = roomId;
      });
    });
  }

  function moveChar(who, roomId) {
    if (!PEOPLE[who] || !ROOM_LABEL[roomId]) return;
    const before = state.chars[who];
    state.chars[who] = roomId;
    save(K_CHAR, state.chars);
    if (before !== roomId) layoutChars();
    renderMap();
  }

  function flashBubble(who, text) {
    const c = chars[who];
    if (!c) return;
    clearTimeout(c.timer);
    c.bubble.textContent = text.length > 26 ? `${text.slice(0, 25)}…` : text;
    c.bubble.classList.add('is-on');
    c.timer = setTimeout(() => {
      c.bubble.textContent = c.base;
    }, 6000);
  }

  /* ── 피드 스크롤 ────────────────────────────────────── */
  function nearBottom() {
    const f = el.feed;
    return f.scrollHeight - f.scrollTop - f.clientHeight < 140;
  }
  function scrollFeedToBottom(force) {
    if (force || nearBottom()) {
      requestAnimationFrame(() => { el.feed.scrollTop = el.feed.scrollHeight; });
    }
  }

  /* ── 메시지 전송 ────────────────────────────────────── */
  function setAuthor(who) {
    if (!PEOPLE[who]) return;
    state.author = who;
    save(K_UI, { author: state.author, room: state.room });
    $$('#authorPicker .author-chip').forEach(b => b.classList.toggle('is-active', b.dataset.author === who));
    moveChar(who, state.room);
  }

  function setRoom(roomId, opts = {}) {
    if (!ROOM_LABEL[roomId]) return;
    state.room = roomId;
    save(K_UI, { author: state.author, room: state.room });
    renderMap();
    if (opts.moveChar !== false) moveChar(state.author, roomId);
  }

  function sendMessage() {
    const text = el.input.value.trim();
    if (!text) { el.input.focus(); return; }

    const msg = { id: uid('m'), author: state.author, room: state.room, text, ts: Date.now() };
    state.messages.push(msg);
    state.messages.sort((a, b) => a.ts - b.ts);
    save(K_MSG, state.messages);

    renderFeed();
    renderFilters();
    scrollFeedToBottom(true);
    moveChar(msg.author, msg.room);
    flashBubble(msg.author, text);
    if (state.filter !== 'all' && state.filter !== msg.room) {
      state.filter = 'all';
      renderFilters();
      renderFeed();
    }

    el.input.value = '';
    autoGrow();
    el.input.focus();

    pushMessage(msg);
  }

  async function pushMessage(msg) {
    if (!state.fbUrl) return;
    try {
      await fbPut(`messages/${msg.id}`, msg);
      state.sync = 'connected';
      state.syncNote = '';
      updateSyncBadge();
    } catch (e) {
      markSyncError(e);
    }
  }

  async function toggleTask(id) {
    const t = state.tasks.find(x => x.id === id);
    if (!t) return;
    const i = STATUSES.indexOf(t.status);
    t.status = STATUSES[(i + 1) % STATUSES.length];
    save(K_TASK, state.tasks);
    renderBoard();
    renderMeta();
    toast(`‘${t.title}’ → ${t.status}`);

    if (!state.fbUrl) return;
    try {
      await fbPut(`tasks/${t.id}`, t);
      state.sync = 'connected';
      updateSyncBadge();
    } catch (e) { markSyncError(e); }
  }

  /* ── Firebase Realtime Database (REST) ──────────────── */
  function normalizeUrl(raw) {
    let u = String(raw || '').trim();
    if (!u) return '';
    u = u.replace(/\.json(\?.*)?$/i, '').replace(/\/(messages|tasks)(\/[^/]*)?$/i, '').replace(/\/+$/, '');
    // Firebase 콘솔에서 복사한 주소에 붙는 경로·앵커 정리
    u = u.replace(/#.*$/, '');
    if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
    return u;
  }

  function isFirebaseUrl(u) {
    return /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.(firebasedatabase\.app|firebaseio\.com)$/i.test(u);
  }

  async function fbGet(path) {
    const url = `${state.fbUrl}/${path}.json?ts=${Date.now()}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async function fbPut(path, value) {
    const res = await fetch(`${state.fbUrl}/${path}.json`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(value),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json().catch(() => null);
  }

  function markSyncError(err) {
    state.sync = 'error';
    state.syncNote = err && err.message ? err.message : '동기화 실패';
    updateSyncBadge();
  }

  function updateSyncBadge() {
    const b = el.syncBadge;
    b.classList.remove('is-local', 'is-connected', 'is-error');
    let label = '로컬 모드';
    if (state.sync === 'connected') label = 'Firebase 실시간 동기화';
    else if (state.sync === 'pending') label = '연결 확인 중…';
    else if (state.sync === 'error') label = '동기화 오류 · 로컬 저장';

    b.classList.add(
      state.sync === 'connected' ? 'is-connected'
      : state.sync === 'error' ? 'is-error'
      : 'is-local'
    );
    el.syncLabel.textContent = label;

    el.composerHint.textContent = state.sync === 'connected'
      ? `Firebase 실시간 동기화 · 3초마다 자동 반영${state.syncNote ? ` · ${state.syncNote}` : ''}`
      : state.sync === 'error'
        ? `Firebase 연결 실패(${state.syncNote}) · 이 브라우저에 저장 중`
        : '로컬 모드 · 이 브라우저에만 저장됩니다';

    el.footSync.textContent = state.sync === 'connected'
      ? 'Firebase 실시간 동기화'
      : state.sync === 'error' ? '로컬 저장 (동기화 오류)' : '로컬 저장소';
  }

  function toList(data) {
    if (!data) return [];
    if (Array.isArray(data)) return data.filter(Boolean);
    return Object.values(data).filter(v => v && typeof v === 'object');
  }

  function mergeById(local, remote) {
    const map = new Map();
    local.forEach(x => x && x.id && map.set(x.id, x));
    remote.forEach(x => {
      if (!x || !x.id) return;
      map.set(x.id, { ...(map.get(x.id) || {}), ...x });
    });
    return Array.from(map.values());
  }

  async function connectDb(rawUrl, opts = {}) {
    const url = normalizeUrl(rawUrl);
    if (!url) { toast('주소를 입력해 주세요'); return false; }
    if (!/^https:\/\//.test(url)) { setDbStatus('https:// 로 시작하는 주소를 넣어 주세요', 'err'); return false; }
    if (!isFirebaseUrl(url)) {
      setDbStatus('Firebase Realtime Database 주소 형식이 아닙니다 (예: https://xxx-default-rtdb.asia-southeast1.firebasedatabase.app)', 'err');
      return false;
    }

    state.sync = 'pending';
    updateSyncBadge();
    setDbStatus('연결 확인 중…', '');

    const prev = state.fbUrl;
    state.fbUrl = url;
    try {
      const [m, t] = await Promise.all([fbGet('messages'), fbGet('tasks')]);
      const remoteMsgs = toList(m);
      const remoteTasks = toList(t);

      // 서버가 비어 있으면 지금 화면의 시드를 올린다
      if (!remoteMsgs.length) await Promise.all(state.messages.map(msg => fbPut(`messages/${msg.id}`, msg)));
      if (!remoteTasks.length) await Promise.all(state.tasks.map(task => fbPut(`tasks/${task.id}`, task)));

      state.messages = mergeById(state.messages, remoteMsgs);
      state.tasks = mergeById(state.tasks, remoteTasks);
      state.messages.sort((a, b) => a.ts - b.ts);
      save(K_MSG, state.messages);
      save(K_TASK, state.tasks);
      localStorage.setItem(K_FB, url);

      state.sync = 'connected';
      state.syncNote = '';
      updateSyncBadge();
      renderAll();
      scrollFeedToBottom(true);
      setDbStatus(`연결됨 · 대화 ${state.messages.length}개 · 안건 ${state.tasks.length}개`, 'ok');
      startPolling();
      if (!opts.silent) {
        toast('실시간 DB에 연결했습니다');
        if (el.modal.open) el.modal.close();
      }
      return true;
    } catch (err) {
      state.fbUrl = prev || '';
      const msg = err && err.message ? err.message : String(err);
      state.sync = prev ? 'error' : 'local';
      state.syncNote = /401|403/.test(msg) ? '권한 거부(규칙 확인)' : msg;
      updateSyncBadge();
      setDbStatus(
        /401|403/.test(msg)
          ? '권한 거부 — Firebase 콘솔 → Realtime Database → 규칙에서 .read/.write 를 확인하세요'
          : /Failed to fetch|NetworkError/i.test(msg)
            ? '접속 실패 — 주소와 네트워크를 확인하세요'
            : `연결 실패 (${msg})`,
        'err'
      );
      return false;
    }
  }

  function disconnectDb(opts = {}) {
    stopPolling();
    localStorage.removeItem(K_FB);
    state.fbUrl = '';
    state.sync = 'local';
    state.syncNote = '';
    updateSyncBadge();
    setDbStatus('현재: 로컬 모드 (이 브라우저에만 저장)', '');
    if (!opts.silent) toast('로컬 모드로 전환했습니다');
  }

  function startPolling() {
    stopPolling();
    state.pollTimer = setInterval(pullRemote, POLL_MS);
  }
  function stopPolling() {
    if (state.pollTimer) clearInterval(state.pollTimer);
    state.pollTimer = null;
  }

  let pulling = false;
  async function pullRemote() {
    if (!state.fbUrl || pulling) return;
    pulling = true;
    try {
      const [m, t] = await Promise.all([fbGet('messages'), fbGet('tasks')]);
      const remoteMsgs = toList(m);
      const remoteTasks = toList(t);

      const beforeMsg = state.messages.length;
      const beforeSig = state.messages.map(x => x.id).join(',') + '|' + state.tasks.map(x => x.status).join(',');

      state.messages = mergeById(state.messages, remoteMsgs);
      state.tasks = mergeById(state.tasks, remoteTasks);
      state.messages.sort((a, b) => a.ts - b.ts);

      const afterSig = state.messages.map(x => x.id).join(',') + '|' + state.tasks.map(x => x.status).join(',');

      if (state.sync !== 'connected') { state.sync = 'connected'; state.syncNote = ''; updateSyncBadge(); }
      if (beforeSig !== afterSig) {
        save(K_MSG, state.messages);
        save(K_TASK, state.tasks);
        renderAll();
        scrollFeedToBottom(false);
        if (state.messages.length > beforeMsg) {
          const last = state.messages[state.messages.length - 1];
          flashBubble(last.author, last.text);
        }
      }
    } catch (err) {
      markSyncError(err);
    } finally {
      pulling = false;
    }
  }

  function setDbStatus(text, kind) {
    el.dbStatus.textContent = text;
    el.dbStatus.classList.remove('is-ok', 'is-err');
    if (kind === 'ok') el.dbStatus.classList.add('is-ok');
    if (kind === 'err') el.dbStatus.classList.add('is-err');
  }

  /* ── 이벤트 ─────────────────────────────────────────── */
  function bindEvents() {
    // 방 칩 / 방 카드
    el.roomChips.addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      setRoom(chip.dataset.room);
    });

    el.map.addEventListener('click', (e) => {
      const room = e.target.closest('.room');
      if (!room) return;
      setRoom(room.dataset.room);
    });
    el.map.addEventListener('keydown', (e) => {
      const room = e.target.closest('.room');
      if (!room) return;
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setRoom(room.dataset.room); }
    });

    // 발신자 선택
    el.authorPicker.addEventListener('click', (e) => {
      const btn = e.target.closest('.author-chip');
      if (btn) setAuthor(btn.dataset.author);
    });

    // 구역 select
    el.roomSelect.addEventListener('change', () => setRoom(el.roomSelect.value));

    // 필터
    el.feedFilter.addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      state.filter = chip.dataset.filter;
      renderFilters();
      renderFeed();
      scrollFeedToBottom(true);
    });

    // 멘션 퀵버튼
    $$('.mentions .mention-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const who = btn.dataset.mention;
        const cur = el.input.value;
        el.input.value = `${cur}${cur && !cur.endsWith(' ') ? ' ' : ''}@${who} `;
        el.input.focus();
        autoGrow();
      });
    });

    // 전송
    el.composer.addEventListener('submit', (e) => { e.preventDefault(); sendMessage(); });
    el.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        sendMessage();
      }
    });
    el.input.addEventListener('input', autoGrow);

    // 보드 상태 토글
    el.boardList.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-status]');
      if (btn) toggleTask(btn.dataset.status);
    });

    // 섹션 내비
    $$('.nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        $$('.nav-btn').forEach(b => b.classList.toggle('is-active', b === btn));
        const target = document.getElementById(btn.dataset.target);
        if (target) {
          const top = target.getBoundingClientRect().top + window.scrollY - 78;
          window.scrollTo({ top, behavior: 'smooth' });
          target.style.transition = 'box-shadow .3s ease';
          target.style.boxShadow = '0 0 0 3px rgba(224,163,74,.35), 0 14px 34px -18px rgba(94,58,32,.38)';
          setTimeout(() => { target.style.boxShadow = ''; }, 900);
        }
      });
    });

    // 모달
    $('#openDb').addEventListener('click', () => {
      el.dbUrl.value = state.fbUrl || '';
      setDbStatus(
        state.sync === 'connected' ? '연결됨 — 3초 폴링으로 동기화 중'
        : state.sync === 'error' ? `마지막 오류: ${state.syncNote}` : '현재: 로컬 모드',
        state.sync === 'connected' ? 'ok' : state.sync === 'error' ? 'err' : ''
      );
      if (typeof el.modal.showModal === 'function') el.modal.showModal();
      else el.modal.setAttribute('open', '');
      setTimeout(() => el.dbUrl.focus(), 60);
    });

    el.dbForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const action = (e.submitter && e.submitter.value) || 'connect';
      if (action === 'close') { el.modal.close(); return; }
      if (action === 'disconnect') { disconnectDb(); el.modal.close(); return; }
      const btn = $('#dbConnect');
      btn.disabled = true;
      btn.textContent = '연결 중…';
      const ok = await connectDb(el.dbUrl.value);
      btn.disabled = false;
      btn.textContent = '연결하고 동기화';
      if (ok) el.modal.close();
    });

    // 리사이즈
    let rt = 0;
    window.addEventListener('resize', () => {
      clearTimeout(rt);
      rt = setTimeout(() => layoutChars(true), 120);
    });
    window.addEventListener('orientationchange', () => setTimeout(() => layoutChars(true), 260));

  }

  function autoGrow() {
    const t = el.input;
    t.style.height = 'auto';
    t.style.height = `${Math.min(t.scrollHeight, 132)}px`;
  }

  /* ── 시작 ───────────────────────────────────────────── */
  document.addEventListener('DOMContentLoaded', init);
  if (document.readyState !== 'loading') init();
})();
