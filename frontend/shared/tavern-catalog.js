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
},
{
  "id": "cafe-basement",
  "details": false,
  "variants": [
    {
      "id": "cafe-basement",
      "url": "/static/audio/tavern/cafe-basement.mp3?v=ASSET_VERSION",
      "gain": 0.065
    }
  ]
},
{
  "id": "restaurant-room",
  "details": false,
  "variants": [
    {
      "id": "restaurant-room",
      "url": "/static/audio/tavern/restaurant-room.mp3?v=ASSET_VERSION",
      "gain": 0.065
    }
  ]
},
{
  "id": "coffee-shop",
  "details": false,
  "variants": [
    {
      "id": "coffee-shop",
      "url": "/static/audio/tavern/coffee-shop.mp3?v=ASSET_VERSION",
      "gain": 0.065
    }
  ]
},
{
  "id": "crowded-bar",
  "details": false,
  "variants": [
    {
      "id": "crowded-bar",
      "url": "/static/audio/tavern/crowded-bar.mp3?v=ASSET_VERSION",
      "gain": 0.065
    }
  ]
},
{
  "id": "wine-bar",
  "details": false,
  "variants": [
    {
      "id": "wine-bar",
      "url": "/static/audio/tavern/wine-bar.mp3?v=ASSET_VERSION",
      "gain": 0.065
    }
  ]
},
{
  "id": "english-pub",
  "details": false,
  "variants": [
    {
      "id": "english-pub",
      "url": "/static/audio/tavern/english-pub.mp3?v=ASSET_VERSION",
      "gain": 0.065
    }
  ]
}];
