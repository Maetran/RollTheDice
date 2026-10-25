// Simulates external browser media only; accounts and gameplay remain real.
async function installMedia(page, language) {
  await page.addInitScript(value => {
    localStorage.setItem('zdwa_language', value);
    const NativeContext = window.AudioContext || window.webkitAudioContext;
    const harness = window.__voiceHarness = { captures: 0, tracks: [], peers: [], playbackBlocked: false, microphoneDenied: false };
    const mediaContext = new NativeContext();
    const audioTrack = () => mediaContext.createMediaStreamDestination().stream.getAudioTracks()[0];
    const nativePlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      if (this.srcObject) return harness.playbackBlocked ? Promise.reject(new DOMException('Blocked', 'NotAllowedError')) : Promise.resolve();
      return nativePlay.call(this);
    };
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => {
      harness.captures++;
      if (harness.microphoneDenied) throw new DOMException('Microphone denied', 'NotAllowedError');
      const track = audioTrack(); harness.tracks.push(track);
      return new MediaStream([track]);
    } });
    window.RTCPeerConnection = class extends EventTarget {
      constructor(configuration) {
        super(); this.configuration = configuration; this.iceGatheringState = 'complete';
        this.connectionState = 'new'; this.signalingState = 'stable'; this.transceivers = [];
        harness.peers.push(this);
      }
      addTransceiver(track, options) {
        const item = { mid: '0', direction: options.direction, sender: { track,
          async replaceTrack(next) { this.track = next; } } };
        this.transceivers.push(item); return item;
      }
      async createOffer() { return { type: 'offer', sdp: 'test-local-offer' }; }
      async createAnswer() { return { type: 'answer', sdp: 'test-local-answer' }; }
      async setLocalDescription(description) {
        this.localDescription = description;
        this.signalingState = description.type === 'offer' ? 'have-local-offer' : 'stable';
      }
      async setRemoteDescription(description) {
        this.remoteDescription = description;
        this.signalingState = description.type === 'offer' ? 'have-remote-offer' : 'stable';
        if (description.type === 'offer') for (const mid of JSON.parse(description.sdp)) {
          const event = new Event('track'); event.track = audioTrack(); event.transceiver = { mid };
          this.dispatchEvent(event);
        }
        if (description.type === 'answer') {
          this.connectionState = 'connected';
          this.dispatchEvent(new Event('connectionstatechange'));
        }
      }
      async getStats() { return new Map(); }
      close() { this.connectionState = 'closed'; this.dispatchEvent(new Event('connectionstatechange')); }
    };
    const NativeWebSocket = window.WebSocket;
    window.WebSocket = class extends NativeWebSocket {
      constructor(url, protocols) {
        super(url, protocols);
        if (/\/ws\/[a-f0-9]{8}$/.test(new URL(url, location.href).pathname)) window.__voiceGameSocket = this;
      }
    };
  }, language);
  await page.route('**/api/releases**', route => route.fulfill({ json: { releases: [], can_prompt: false } }));
  await page.route('**/api/auth/game-guides', route => route.fulfill({ json: { enabled: false, acknowledged: {} } }));
  await page.route('**/api/auth/tours/offer', route => route.fulfill({ json: { show: false, enabled: false, games: {} } }));
  await page.route('**/api/hausdepp/progress-notices', route => route.fulfill({ json: { notices: [], revision: 0 } }));
}

module.exports = { installMedia };
