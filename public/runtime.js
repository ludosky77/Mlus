// Executed inside the imported game's opaque-origin iframe. No network SDK is
// added to the game itself: canvas capture and synthetic keyboard events bridge it.
(() => {
  let peer = null, channel = null, stream = null, session = null;
  let mapping = { p1: ['KeyW', 'KeyS'], p2: ['ArrowUp', 'ArrowDown'] };
  let pendingCandidates = [], localHeld = new Set(), remoteHeld = new Set(), remoteAt = 0;
  const emit = (type, data = {}) => parent.postMessage({ bridge: true, type, ...data }, '*');
  const keyInfo = code => {
    if (/^Key[A-Z]$/.test(code)) return { key: code.slice(3).toLowerCase(), keyCode: code.charCodeAt(3) };
    if (/^Digit[0-9]$/.test(code)) return { key: code.slice(5), keyCode: code.charCodeAt(5) };
    return { key: code === 'Space' ? ' ' : code, keyCode: { ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, Space: 32, Enter: 13 }[code] ?? 0 };
  };
  const dispatch = (code, down) => document.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, ...keyInfo(code), bubbles: true, cancelable: true }));
  function apply(held, keys, codes) {
    const wanted = new Set((Array.isArray(keys) ? keys : []).filter(k => k === 'up' || k === 'down').map(k => codes[k === 'up' ? 0 : 1]));
    for (const code of held) if (!wanted.has(code)) { dispatch(code, false); held.delete(code); }
    for (const code of wanted) if (!held.has(code)) { dispatch(code, true); held.add(code); }
  }
  function release() { apply(localHeld, [], mapping.p1); apply(remoteHeld, [], mapping.p2); }
  function closePeer() {
    release();
    if (peer) { peer.onconnectionstatechange = null; peer.onicecandidate = null; peer.close(); }
    channel?.close(); stream?.getTracks().forEach(track => track.stop());
    peer = channel = stream = null; pendingCandidates = [];
  }
  async function connect(config, nextSession) {
    closePeer(); session = nextSession;
    const canvas = document.querySelector('canvas');
    if (!canvas || typeof canvas.captureStream !== 'function') throw new Error('This game needs a canvas that supports screen streaming.');
    const pc = new RTCPeerConnection({ iceServers: config }); peer = pc;
    stream = canvas.captureStream(30);
    for (const track of stream.getTracks()) pc.addTrack(track, stream);
    channel = pc.createDataChannel('controls', { ordered: false, maxRetransmits: 0 });
    channel.onopen = () => emit('controls-ready');
    channel.onclose = release;
    channel.onmessage = event => {
      if (event.data.length > 200) return;
      try { const input = JSON.parse(event.data); if (input.type === 'input') { remoteAt = Date.now(); apply(remoteHeld, input.keys, mapping.p2); } } catch {}
    };
    pc.onicecandidate = event => { if (event.candidate) emit('signal', { data: { type: 'candidate', candidate: event.candidate.toJSON(), session } }); };
    pc.onconnectionstatechange = () => { if (peer === pc) emit('connection', { state: pc.connectionState }); };
    const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
    emit('signal', { data: { type: 'offer', sdp: offer.sdp, session } });
  }
  addEventListener('message', async event => {
    if (event.source !== parent || event.data?.bridge !== true) return;
    const message = event.data;
    try {
      if (message.type === 'configure') mapping = message.mapping;
      else if (message.type === 'connect') await connect(message.iceServers, message.session);
      else if (message.type === 'signal' && message.data?.session === session && peer) {
        if (message.data.type === 'answer') {
          await peer.setRemoteDescription({ type: 'answer', sdp: message.data.sdp });
          for (const candidate of pendingCandidates) await peer.addIceCandidate(candidate);
          pendingCandidates = [];
        } else if (message.data.type === 'candidate') {
          if (peer.remoteDescription) await peer.addIceCandidate(message.data.candidate);
          else pendingCandidates.push(message.data.candidate);
        }
      } else if (message.type === 'local-input') apply(localHeld, message.keys, mapping.p1);
      else if (message.type === 'toggle-play') { dispatch('Space', true); dispatch('Space', false); }
      else if (message.type === 'release') release();
      else if (message.type === 'disconnect') { closePeer(); if (typeof window.pauseGame === 'function') window.pauseGame(); }
    } catch (error) { emit('runtime-error', { message: error.message }); }
  });
  setInterval(() => { if (remoteHeld.size && Date.now() - remoteAt > 500) apply(remoteHeld, [], mapping.p2); }, 100);
  addEventListener('blur', () => apply(localHeld, [], mapping.p1));
  addEventListener('load', () => {
    const canvas = document.querySelector('canvas');
    if (!canvas) emit('runtime-error', { message: 'No canvas found. Import a self-contained canvas game.' });
    else emit('runtime-ready', { width: canvas.width, height: canvas.height });
  });
})();
