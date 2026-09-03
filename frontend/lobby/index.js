import { initializeAuthentication } from "./auth-controller.js";
import { initializeGames } from "./games-controller.js";
import { initializeLeaderboard } from "./leaderboard-controller.js";
import { initializeGameSetup } from "./setup.js";
import { initializeAppMode } from "../multigame/app-mode.js";

initializeAppMode({ mode: "zdwa" });
initializeGameSetup();
initializeAuthentication();
initializeGames();
initializeLeaderboard();
