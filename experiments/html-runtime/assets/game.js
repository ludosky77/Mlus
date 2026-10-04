(() => {
  const frame = document.getElementById('game'), video = document.getElementById('screen'), notice = document.getElementById('notice');
  let role, config, peer, channel, session, held = [], queued = [];
  const emit = packet => { if (window.nativeGame) window.nativeGame.postMessage(JSON.stringify(packet)); };
  const child = (type, extra = {}) => frame.contentWindow.postMessage({ bridge: true, type, ...extra }, '*');
  const sendInput = () => { if (channel?.readyState === 'open') channel.send(JSON.stringify({ type: 'input', keys: held })); };
  function close() { held = []; sendInput(); if (peer) { peer.onicecandidate = peer.onconnectionstatechange = null; peer.close(); } channel?.close(); peer = channel = null; queued = []; child('disconnect'); }
  async function signal(data) {
    if (role === 'host') { child('signal', { data }); return; }
    if (data.type === 'offer') {
      const early = queued.filter(item => item.session === data.session); close(); session = data.session;
      peer = new RTCPeerConnection({ iceServers: config.iceServers });
      peer.onicecandidate = event => { if (event.candidate) emit({ type: 'signal', data: { type: 'candidate', candidate: event.candidate.toJSON(), session } }); };
      peer.ontrack = event => { video.srcObject = event.streams[0] ?? new MediaStream([event.track]); video.hidden = false; notice.hidden = true; video.play().catch(() => {}); };
      peer.onconnectionstatechange = () => emit({ type: 'connection', state: peer.connectionState });
      peer.ondatachannel = event => { channel = event.channel; channel.onopen = () => { emit({ type: 'controls-ready' }); sendInput(); }; channel.onclose = () => emit({ type: 'connection', state: 'disconnected' }); };
      await peer.setRemoteDescription({ type: 'offer', sdp: data.sdp });
      for (const item of early) await peer.addIceCandidate(item.candidate);
      const answer = await peer.createAnswer(); await peer.setLocalDescription(answer);
      emit({ type: 'signal', data: { type: 'answer', sdp: answer.sdp, session } });
    } else if (data.type === 'candidate') {
      if (peer?.remoteDescription && session === data.session) await peer.addIceCandidate(data.candidate);
      else if (queued.length < 100) queued.push(data);
    }
  }
  window.NativeGame = {
    async init(input) {
      try {
        config = input; role = config.role;
        if (role === 'host') {
          const runtime = await fetch('runtime.js').then(response => response.text());
          const policy = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src blob:; connect-src 'none'; form-action 'none'; base-uri 'none'">`;
          frame.hidden = false;
          frame.srcdoc = `<!doctype html>${policy}<script>${runtime.replace(/<\/script/gi, '<\\/script')}</script>${config.html}`;
        }
        emit({ type: 'engine-ready' });
      } catch (error) { emit({ type: 'runtime-error', message: error.message }); }
    },
    async receive(message) {
      try {
        if (message.type === 'signal') await signal(message.data);
        else if (message.type === 'input') { held = message.keys; if (role === 'host') child('local-input', { keys: held }); else sendInput(); }
        else if (message.type === 'release') { held = []; if (role === 'host') child('release'); else sendInput(); }
        else if (message.type === 'disconnect') close();
        else child(message.type, message);
      } catch (error) { emit({ type: 'runtime-error', message: error.message }); }
    }
  };
  addEventListener('message', event => {
    if (event.source !== frame.contentWindow || !event.data?.bridge || role !== 'host') return;
    const packet = event.data;
    if (packet.type === 'runtime-ready') { notice.hidden = true; child('configure', { mapping: { p1: ['KeyW', 'KeyS'], p2: ['ArrowUp', 'ArrowDown'] } }); }
    emit(packet);
  });
  setInterval(sendInput, 50);
  addEventListener('blur', () => { held = []; if (role === 'host') child('release'); else sendInput(); });
})();
