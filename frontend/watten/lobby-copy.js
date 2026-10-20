// Compact creator copy; keep both supported languages together.
const COPY = {
  de: {
    chat: "Lobbychat",
    intro: "Such dir einen Tisch oder eröffne deine eigene Runde.",
    open: "Spiel erstellen", choose: "Wie spielen wir?", define: "Runde festlegen", defineHelp: "Spieler, Regeln und Mitspieler wählen",
    favourite: "Dein Favorit", favouriteEmpty: "Noch keine Einstellungen gespeichert", favouriteHelp: "Mit deinen gespeicherten Einstellungen weiter",
    setup: "Deine Runde", close: "Schliessen", back: "Zurück", cpuFill: "Freie Plätze mit CPUs auffüllen",
    cpuHelp: "Du sitzt auf Platz 1. Die übrigen Plätze bekommen Computergegner; im Warteraum kannst du sie austauschen.",
    audio: "Audiochat am Tisch", audioHelp: "Alle am Tisch hören einander. Es gibt keinen Teamkanal.",
    password: "Passwort · optional", passwordHelp: "Leer lassen für einen öffentlichen Tisch. Ein Passwort schützt die Runde.",
    savedPassword: "Das gespeicherte Passwort bleibt privat. Gib für diese Runde ein neues ein oder lass den Tisch öffentlich.",
    favoriteSettings: "Als Favorit merken", favoriteSave: "Einstellungen speichern", favoriteDelete: "Löschen", favoriteApplied: "Dein Favorit ist eingestellt.",
    tableName: "Der Tisch bekommt automatisch einen Namen mit deinem Benutzernamen.",
    start: "Spiel starten", copy: "Einladen", leave: "Verlassen", copyLabel: "Einladungslink kopieren", leaveLabel: "Tisch verlassen",
  },
  en: {
    chat: "Lobby chat",
    intro: "Find a table or open a round of your own.",
    open: "Create game", choose: "How shall we play?", define: "Set up a round", defineHelp: "Choose players, rules and company",
    favourite: "Your favorite", favouriteEmpty: "No settings saved yet", favouriteHelp: "Continue with your saved settings",
    setup: "Your round", close: "Close", back: "Back", cpuFill: "Fill empty seats with CPUs",
    cpuHelp: "You take seat 1. Computer players fill the other seats; you can replace them in the waiting room.",
    audio: "Table audio chat", audioHelp: "Everyone at the table can hear each other. There is no team channel.",
    password: "Password · optional", passwordHelp: "Leave empty for a public table. Add a password to protect the round.",
    savedPassword: "Passwords are never saved. Enter a new one for this round or leave the table public.",
    favoriteSettings: "Remember as favorite", favoriteSave: "Save settings", favoriteDelete: "Delete", favoriteApplied: "Your favorite settings are ready.",
    tableName: "Your table automatically gets a name based on your username.",
    start: "Start game", copy: "Invite", leave: "Leave", copyLabel: "Copy invitation link", leaveLabel: "Leave table",
  },
};

export function lobbyText(key, values = {}, language = globalThis.window?.ZDWA_I18N?.getLanguage?.()) {
  return COPY[language === "en" ? "en" : "de"][key].replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ""));
}
