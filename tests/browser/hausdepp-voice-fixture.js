// Existing gameplay fixtures model tables with voice disabled. Reply using the
// actual control protocol so voice discovery never becomes a fake game move.
const isHausdeppVoice = message => message?.action === 'hausdepp_voice';

function handleDisabledHausdeppVoice(socket, message) {
  if (!isHausdeppVoice(message)) return false;
  const reply = message.operation === 'state'
    ? { ok: true, state: { event: 'state', available: false, room_id: null, members: [], publications: [] } }
    : { ok: false, error_code: 'hausdepp_voice_unavailable' };
  socket.send(JSON.stringify({ hausdepp_voice: { request_id: message.request_id, ...reply } }));
  return true;
}

module.exports = { handleDisabledHausdeppVoice, isHausdeppVoice };
