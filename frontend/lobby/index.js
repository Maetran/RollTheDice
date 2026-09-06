import { initializeAuthentication } from "./auth-controller.js";
import { initializeGames } from "./games-controller.js";
import { initializeLeaderboard } from "./leaderboard-controller.js";
import { initializeGameSetup } from "./setup.js";
import { mountLobbyChat } from "../shared/lobby-chat.js";
import { initializeReleaseNotes } from "../shared/release-notes.js";

initializeGameSetup();
initializeAuthentication();
initializeGames();
initializeLeaderboard();
mountLobbyChat(document.getElementById("lobbyChatMount"), { context: "zdwa" });
initializeReleaseNotes({ context: "zdwa" });
