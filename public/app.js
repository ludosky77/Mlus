const $ = id => document.getElementById(id);
const state = { socket: null, id: null, room: null, role: null, pending: false, selected: 'demo', games: new Map(), runtime: '', runtimeReady: false, peerStarted: false, peer: null, channel: null, session: null, candidates: [], connected: false, held: new Set(), iceServers: [] };
let toastTimer, reconnectTimer, negotiationTimer;
function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 6000); }
const send = packet => { if (state.socket?.readyState === WebSocket.OPEN) { state.socket.send(JSON.stringify(packet)); return true; } toast('The room server is disconnected. Please wait for it to reconnect.'); return false; };
const runtime = (type, data = {}) => $('game-frame').contentWindow?.postMessage({ bridge: true, type, ...data }, '*');
const icon = name => `<svg class="icon"><use href="#i-${name}"/></svg>`;
const supportedKey = key => /^(Key[A-Z]|Digit[0-9]|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Space|Enter)$/.test(key);
function mapping() { return { p1: [$('p1-up').value, $('p1-down').value], p2: [$('p2-up').value, $('p2-down').value] }; }
function setOnline(online) { $('server-dot').className = `status-dot ${online ? 'online' : 'failed'}`; $('server-status').textContent = online ? 'Room server online' : 'Reconnecting'; $('create-room').disabled = !online || state.pending; $('join-room').disabled = !online || state.pending; }
function setView(room) { $('library-view').hidden = room; $('room-view').hidden = !room; $('library-nav').classList.toggle('active', !room); $('room-nav').classList.toggle('active', room); $('room-nav').disabled = !state.room; $('breadcrumb').textContent = room ? 'Workspace / Your room' : 'Workspace / Game library'; }
function selectGame(id) {
  state.selected = id;
  document.querySelectorAll('.game-card').forEach(card => { card.classList.toggle('selected', card.dataset.game === id); card.setAttribute('aria-pressed', String(card.dataset.game === id)); });
  $('selected-title').textContent = state.games.get(id).title;
  $('selected-subtitle').textContent = 'Two players · Runs on your device';
}
function importedCard(game) {
  const card = document.createElement('button'); card.className = 'game-card'; card.dataset.game = game.id; card.setAttribute('aria-pressed', 'false');
  card.innerHTML = `<div class="game-art import-art">${icon('game')}<span>YOUR OFFLINE GAME</span></div><div class="game-card-body"><div class="game-title-row"><h3></h3><span class="supported-tag">Imported</span></div><p>Canvas streaming · Keyboard controls</p><div class="game-meta"><span>${icon('users')}2 players</span><span>Offline HTML</span><span class="local-label">On device</span></div></div>`;
  card.querySelector('h3').textContent = game.title; card.addEventListener('click', () => selectGame(game.id)); $('games').append(card);
  $('game-count').textContent = state.games.size; $('library-count').textContent = String(state.games.size).padStart(2, '0');
}
let database;
async function openLibrary() {
  if (!('indexedDB' in window)) return;
  database = await new Promise((resolve, reject) => { const req = indexedDB.open('bridge-library', 1); req.onupgradeneeded = () => req.result.createObjectStore('games', { keyPath: 'id' }); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
  const saved = await new Promise((resolve, reject) => { const req = database.transaction('games').objectStore('games').getAll(); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
  for (const game of saved.slice(0, 12)) { state.games.set(game.id, game); importedCard(game); }
}
async function importGame(file) {
  if (!file) return;
  if (!/\.html?$/i.test(file.name)) { toast('This build accepts self-contained HTML games. APK and ROM runtimes are not available yet.'); return; }
  if (file.size > 2 * 1024 * 1024) { toast('Use a self-contained game smaller than 2 MB for this prototype.'); return; }
  if (state.games.size >= 13) { toast('This prototype supports twelve imported games.'); return; }
  const html = await file.text();
  if (!/<canvas[\s>]|createElement\s*\(\s*['"]canvas['"]/i.test(html)) { toast('No canvas found. Select an offline canvas game with keyboard controls.'); return; }
  const title = (html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() || file.name.replace(/\.html?$/i, '')).slice(0, 60);
  const game = { id: crypto.randomUUID(), title, html, kind: 'import' };
  if (database) {
    try { await new Promise((resolve, reject) => { const tx = database.transaction('games', 'readwrite'); tx.objectStore('games').put(game); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); }); }
    catch { toast('Device storage is full. The game has not been imported.'); return; }
  }
  state.games.set(game.id, game); importedCard(game); selectGame(game.id); toast('Imported on this device. Check its keyboard mapping before hosting.');
}
function connectSocket() {
  clearTimeout(reconnectTimer);
  const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/socket`); state.socket = socket;
  socket.addEventListener('open', () => setOnline(true));
  socket.addEventListener('message', async event => {
    let packet; try { packet = JSON.parse(event.data); } catch { return; }
    if (packet.type === 'hello') state.id = packet.id;
    else if (packet.type === 'error') { state.pending = false; setOnline(true); toast(packet.message); }
    else if (packet.type === 'joined') {
      state.pending = false; state.room = packet.room; state.role = packet.role;
      $('messages').replaceChildren(); const empty = document.createElement('p'); empty.className = 'chat-empty'; empty.textContent = 'Say hello. Plan your next win.'; $('messages').append(empty);
      $('room-title').textContent = packet.room.game.title; $('invite-code').textContent = packet.room.code;
      $('room-eyebrow').textContent = `PRIVATE ROOM · YOU ARE PLAYER ${state.role === 'host' ? '1' : '2'}`;
      $('controls-caption').textContent = `YOUR CONTROLS · PLAYER ${state.role === 'host' ? '1' : '2'}`;
      $('keyboard-hint').textContent = state.role === 'host' ? `${state.gameMapping.p1.join(' / ')} to move${packet.room.game.kind === 'demo' ? ' · Space to start' : ''}` : '↑ / ↓ to move · The host starts the game';
      $('connection-note').textContent = state.role === 'host' ? 'Keep this window open. Your friend receives the game screen and sends their controls back.' : 'The game runs on your friend’s device. Your controls travel directly to player two.';
      $('stage-placeholder').hidden = false; $('game-video').hidden = true;
      setView(true); updateRoom(packet.room);
      if (state.role === 'host') loadHostGame();
    } else if (packet.type === 'room') { if (state.room) { state.room = packet.room; updateRoom(packet.room); } }
    else if (packet.type === 'signal') { try { if (state.role === 'host') runtime('signal', { data: packet.data }); else await guestSignal(packet.data); } catch (error) { connectionError(error.message); } }
    else if (packet.type === 'peer-left') { releaseInputs(); closeGuestPeer(); runtime('disconnect'); state.peerStarted = false; state.connected = false; state.session = null; clearTimeout(negotiationTimer); toast('Your friend left. Share the code to invite them again.'); }
    else if (packet.type === 'chat') appendMessage(packet);
    else if (packet.type === 'closed') { resetRoom(); toast(packet.message); }
    else if (packet.type === 'left') resetRoom();
    else if (packet.type === 'pong' && typeof packet.sentAt === 'number') $('room-ping').textContent = `Room ping ${Math.max(0, Date.now() - packet.sentAt)} ms`;
  });
  socket.addEventListener('close', () => { if (socket !== state.socket) return; state.pending = false; const hadRoom = !!state.room; resetRoom(); setOnline(false); if (hadRoom) toast('The server connection was lost. Create or join a new room once it reconnects.'); reconnectTimer = setTimeout(connectSocket, 2000); });
  socket.addEventListener('error', () => {});
}
function updateRoom(room) {
  if (!room) return;
  $('player-count').textContent = `${room.players.length} / 2`;
  $('room-description').textContent = room.players.length < 2 ? 'Waiting for your friend. Share the room code to invite them.' : room.status === 'playing' ? 'Two players. One game. You’re connected.' : room.status === 'paused' ? 'Game paused. Take a moment.' : 'Your friend is here. Get ready to play.';
  $('players').replaceChildren();
  for (const player of room.players) {
    const row = document.createElement('div'); row.className = 'player-row';
    const avatar = document.createElement('span'); avatar.className = 'avatar'; avatar.textContent = player.name.charAt(0).toUpperCase();
    const details = document.createElement('div'); details.className = 'player-details';
    const name = document.createElement('strong'); name.textContent = player.name + (player.id === state.id ? ' · You' : '');
    const role = document.createElement('span'); role.textContent = player.role === 'host' ? 'Player 1 · Host' : 'Player 2 · Guest'; details.append(name, role);
    const dot = document.createElement('span'); dot.className = 'status-dot online'; row.append(avatar, details, dot); $('players').append(row);
  }
  if (room.players.length < 2) { const row = document.createElement('div'); row.className = 'player-row empty'; row.innerHTML = '<span class="avatar">+</span><div class="player-details"><strong>Waiting for a friend</strong><span>Player 2 · Open slot</span></div>'; $('players').append(row); }
  const started = room.status === 'playing';
  $('start-game').hidden = state.role === 'guest';
  $('start-game').disabled = !state.connected || room.players.length !== 2 || (room.game.kind === 'import' && started);
  $('start-game').innerHTML = `${icon(started && room.game.kind === 'demo' ? 'pause' : 'play')}<span>${room.game.kind === 'import' ? started ? 'Session started' : 'Begin session' : started ? 'Pause game' : room.status === 'paused' ? 'Resume game' : 'Start game'}</span>`;
  $('peer-status').textContent = room.players.length < 2 ? 'Waiting for player 2' : state.connected ? 'Direct game connection' : 'Connecting gameplay';
  $('peer-dot').className = `status-dot ${state.connected ? 'online' : ''}`;
  if (room.status === 'paused') releaseInputs();
  if (state.role === 'host' && room.players.length === 2 && state.runtimeReady && !state.peerStarted) startHostConnection();
}
function loadHostGame() {
  const game = state.games.get(state.selected);
  const frame = $('game-frame'); frame.hidden = false;
  const policy = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src blob:; connect-src 'none'; form-action 'none'; base-uri 'none'">`;
  frame.srcdoc = `<!doctype html>${policy}<script>${state.runtime.replace(/<\/script/gi, '<\\/script')}</script>${game.html}`;
}
function startHostConnection() {
  state.peerStarted = true; state.session = crypto.randomUUID();
  runtime('connect', { iceServers: state.iceServers, session: state.session });
  startNegotiationTimeout();
}
function startNegotiationTimeout() { clearTimeout(negotiationTimer); negotiationTimer = setTimeout(() => { if (!state.connected) connectionError('Gameplay could not connect. A TURN relay may be needed for these networks. Leave and rejoin to retry.'); }, 25_000); }
async function guestSignal(data) {
  if (data.type === 'offer') {
    closeGuestPeer(); state.session = data.session; state.candidates = [];
    const peer = new RTCPeerConnection({ iceServers: state.iceServers }); state.peer = peer;
    peer.onicecandidate = event => { if (event.candidate) send({ type: 'signal', data: { type: 'candidate', candidate: event.candidate.toJSON(), session: state.session } }); };
    peer.ontrack = event => { $('game-video').srcObject = event.streams[0] ?? new MediaStream([event.track]); $('game-video').hidden = false; $('stage-placeholder').hidden = true; $('game-video').play().catch(() => toast('Tap the game screen to start playback.')); };
    peer.ondatachannel = event => { state.channel = event.channel; state.channel.onopen = () => { setConnected(true); sendInput(); }; state.channel.onclose = () => setConnected(false); };
    peer.onconnectionstatechange = () => { if (state.peer !== peer) return; if (peer.connectionState === 'connected') setConnected(true); else if (['failed', 'disconnected'].includes(peer.connectionState)) connectionError('Gameplay disconnected. Leave and rejoin the room to reconnect.'); };
    await peer.setRemoteDescription({ type: 'offer', sdp: data.sdp });
    const answer = await peer.createAnswer(); await peer.setLocalDescription(answer);
    send({ type: 'signal', data: { type: 'answer', sdp: answer.sdp, session: state.session } });
    startNegotiationTimeout();
  } else if (data.type === 'candidate') {
    if (data.session !== state.session) return;
    if (state.peer?.remoteDescription) await state.peer.addIceCandidate(data.candidate);
    else state.candidates.push(data.candidate);
  }
}
function setConnected(connected) { state.connected = connected; if (connected) clearTimeout(negotiationTimer); updateRoom(state.room); }
function connectionError(message) { setConnected(false); releaseInputs(); $('peer-status').textContent = 'Gameplay connection unavailable'; $('peer-dot').className = 'status-dot failed'; toast(message); }
function closeGuestPeer() { if (state.peer) { state.peer.onconnectionstatechange = null; state.peer.onicecandidate = null; state.peer.close(); } state.channel?.close(); state.peer = state.channel = null; state.candidates = []; }
function resetRoom() { releaseInputs(); closeGuestPeer(); runtime('disconnect'); clearTimeout(negotiationTimer); $('game-frame').srcdoc = ''; $('game-frame').hidden = true; $('game-video').srcObject = null; $('game-video').hidden = true; state.room = state.role = state.session = null; state.runtimeReady = state.peerStarted = state.connected = false; state.pending = false; $('room-ping').textContent = 'Room ping —'; setView(false); setOnline(state.socket?.readyState === WebSocket.OPEN); }
function appendMessage(packet) {
  $('messages').querySelector('.chat-empty')?.remove();
  const item = document.createElement('div'); item.className = 'chat-message';
  const meta = document.createElement('div'); meta.className = 'message-meta';
  const name = document.createElement('strong'); name.textContent = packet.sender.name;
  const time = document.createElement('span'); time.textContent = new Date(packet.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const text = document.createElement('p'); text.textContent = packet.text; meta.append(name, time); item.append(meta, text); $('messages').append(item);
  while ($('messages').children.length > 100) $('messages').firstChild.remove();
  $('messages').scrollTop = $('messages').scrollHeight;
}
function sendInput() {
  if (!state.room || state.room.status === 'paused') return;
  const keys = [...state.held];
  if (state.role === 'host') runtime('local-input', { keys });
  else if (state.channel?.readyState === 'open') state.channel.send(JSON.stringify({ type: 'input', keys }));
}
function releaseInputs() { state.held.clear(); document.querySelectorAll('.touch-buttons button').forEach(button => button.classList.remove('pressed')); if (state.role === 'host') runtime('release'); else if (state.channel?.readyState === 'open') state.channel.send(JSON.stringify({ type: 'input', keys: [] })); }
async function copy(text, success) { try { if (!navigator.clipboard) throw new Error(); await navigator.clipboard.writeText(text); toast(success); } catch { toast(`Copy this: ${text}`); } }
function togglePlay() {
  if (state.role !== 'host' || !state.connected || state.room.players.length !== 2) return;
  const next = state.room.status === 'playing' ? 'paused' : 'playing';
  if (state.room.game.kind === 'demo') runtime('toggle-play');
  send({ type: 'status', status: next });
}
addEventListener('message', event => {
  if (event.source !== $('game-frame').contentWindow || !state.room || state.role !== 'host' || event.data?.bridge !== true) return;
  const packet = event.data;
  if (packet.type === 'runtime-ready') { state.runtimeReady = true; $('stage-placeholder').hidden = true; runtime('configure', { mapping: state.gameMapping }); updateRoom(state.room); }
  else if (packet.type === 'signal' && packet.data?.session === state.session) send({ type: 'signal', data: packet.data });
  else if (packet.type === 'controls-ready') { setConnected(true); if (state.room.status !== 'playing' && state.room.status !== 'paused') send({ type: 'status', status: 'ready' }); }
  else if (packet.type === 'connection') { if (packet.state === 'connected') setConnected(true); else if (['failed', 'disconnected'].includes(packet.state)) connectionError('Gameplay disconnected. Ask your friend to leave and rejoin.'); }
  else if (packet.type === 'runtime-error') connectionError(String(packet.message).slice(0, 200));
});
$('create-room').addEventListener('click', () => {
  const name = $('player-name').value.trim(); if (!name) { $('player-name').focus(); toast('Enter your name first.'); return; }
  const map = mapping(); if (![...map.p1, ...map.p2].every(supportedKey) || new Set([...map.p1, ...map.p2]).size !== 4) { toast('Use four different keys, such as KeyW, KeyS, ArrowUp, and ArrowDown.'); return; }
  state.gameMapping = map; state.pending = true; setOnline(true);
  send({ type: 'create', name, game: { title: state.games.get(state.selected).title, kind: state.games.get(state.selected).kind } });
  try { localStorage.setItem('bridge-name', name); } catch {}
});
$('join-form').addEventListener('submit', event => { event.preventDefault(); const name = $('player-name').value.trim(); if (!name) { $('player-name').focus(); toast('Enter your name first.'); return; } state.gameMapping = mapping(); state.pending = true; setOnline(true); send({ type: 'join', name, code: $('room-code').value.trim().toUpperCase() }); try { localStorage.setItem('bridge-name', name); } catch {} });
$('leave-room').addEventListener('click', () => { send({ type: 'leave' }); resetRoom(); });
$('library-nav').addEventListener('click', () => { if (state.room) toast('Leave your room to choose another game.'); else setView(false); });
$('room-nav').addEventListener('click', () => { if (state.room) setView(true); });
$('games').querySelector('[data-game="demo"]').addEventListener('click', () => selectGame('demo'));
$('import-button').addEventListener('click', () => $('game-file').click());
$('game-file').addEventListener('change', async () => { await importGame($('game-file').files[0]).catch(error => toast(error.message)); $('game-file').value = ''; });
$('copy-code').addEventListener('click', () => copy(state.room.code, 'Room code copied.'));
$('copy-link').addEventListener('click', () => { const url = new URL(location.href); url.search = ''; url.searchParams.set('room', state.room.code); copy(url.href, 'Invite link copied.'); });
$('chat-form').addEventListener('submit', event => { event.preventDefault(); const text = $('chat-input').value.trim(); if (text && send({ type: 'chat', text })) $('chat-input').value = ''; });
$('fullscreen').addEventListener('click', () => { const operation = document.fullscreenElement ? document.exitFullscreen() : $('game-stage').requestFullscreen?.(); operation?.catch(() => toast('Fullscreen is unavailable in this browser.')); });
$('game-video').addEventListener('click', () => $('game-video').play().catch(() => {}));
$('start-game').addEventListener('click', togglePlay);
for (const [id, direction] of [['move-up', 'up'], ['move-down', 'down']]) {
  const button = $(id);
  button.addEventListener('pointerdown', event => { event.preventDefault(); button.setPointerCapture(event.pointerId); if (!state.room || state.room.status === 'paused') return; state.held.add(direction); button.classList.add('pressed'); sendInput(); });
  const release = () => { state.held.delete(direction); button.classList.remove('pressed'); sendInput(); };
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(type, release);
}
function keyDirection(code) { const keys = state.role === 'host' ? state.gameMapping?.p1 ?? ['KeyW', 'KeyS'] : ['ArrowUp', 'ArrowDown']; return code === keys[0] ? 'up' : code === keys[1] ? 'down' : null; }
addEventListener('keydown', event => { if (!state.room || ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return; if (event.code === 'Space' && state.role === 'host' && state.room.game.kind === 'demo') { event.preventDefault(); if (!event.repeat) togglePlay(); return; } const direction = keyDirection(event.code); if (direction) { event.preventDefault(); state.held.add(direction); sendInput(); } });
addEventListener('keyup', event => { if (!state.room) return; const direction = keyDirection(event.code); if (direction) { state.held.delete(direction); sendInput(); } });
addEventListener('blur', releaseInputs);
document.addEventListener('visibilitychange', () => { if (document.hidden) releaseInputs(); });
setInterval(() => { if (state.role === 'guest' && state.channel?.readyState === 'open') sendInput(); }, 50);
setInterval(() => { if (state.room) send({ type: 'ping', sentAt: Date.now() }); }, 5000);
async function initialize() {
  try {
    const [game, script, config] = await Promise.all([fetch('/games/paddle-duel.html').then(r => r.text()), fetch('/runtime.js').then(r => r.text()), fetch('/config').then(r => r.json())]);
    state.games.set('demo', { id: 'demo', title: 'Paddle Duel', html: game, kind: 'demo' }); state.runtime = script; state.iceServers = config.iceServers;
    try { $('player-name').value = localStorage.getItem('bridge-name') ?? ''; } catch {}
    const invited = new URLSearchParams(location.search).get('room'); if (invited) { $('room-code').value = invited.toUpperCase().slice(0, 6); $('player-name').focus(); }
    await openLibrary().catch(() => toast('Device storage is unavailable. Imports will last for this session.'));
    connectSocket();
  } catch { $('server-status').textContent = 'Could not load'; toast('Could not load the game library. Refresh to retry.'); }
}
initialize();
