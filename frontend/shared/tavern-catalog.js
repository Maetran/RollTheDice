// One family per original recording: variants must not make a source more likely.
export const TAVERN_FAMILIES = [{
  id: "cambridge",
  details: true,
  variants: [
    "/static/audio/hausdepp/tavern-room.mp3?v=ASSET_VERSION",
    "/static/audio/hausdepp/tavern-room-02.mp3?v=ASSET_VERSION",
    "/static/audio/hausdepp/tavern-room-03.mp3?v=ASSET_VERSION",
    "/static/audio/hausdepp/tavern-room-04.mp3?v=ASSET_VERSION",
    "/static/audio/hausdepp/tavern-room-05.mp3?v=ASSET_VERSION",
    "/static/audio/hausdepp/tavern-room-06.mp3?v=ASSET_VERSION",
    "/static/audio/hausdepp/tavern-room-07.mp3?v=ASSET_VERSION",
    "/static/audio/hausdepp/tavern-room-08.mp3?v=ASSET_VERSION",
    "/static/audio/hausdepp/tavern-room-09.mp3?v=ASSET_VERSION",
    "/static/audio/hausdepp/tavern-room-10.mp3?v=ASSET_VERSION",
  ].map(url => ({ id: url.slice(url.lastIndexOf("/") + 1).split(".")[0], url, gain: 0.065 })),
}];
