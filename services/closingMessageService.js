// services/closingMessageService.js
// Generates a personalized closing message based on the customer's chosen
// Theme and Guest Count. No external AI API call — pure template logic,
// so it's instant, free, and fully controllable in tone.

const EVENT_THEMES = new Set([
  'My Party',
  'Birthday',
  'Wedding',
  'Game Day @ Home',
  'Game Day @ Office',
  'Graduation',
  'Other',
]);

const CUISINE_THEMES = new Set(['Thai', 'Sushi', 'Italian', 'Custom']);

function guestPhrase(guestCount) {
  const n = Number(guestCount);
  if (!n || n <= 0) return 'everyone at your table';
  if (n === 1) return 'just you';
  if (n <= 4) return `you and ${n - 1} other${n - 1 === 1 ? '' : 's'}`;
  return `all ${n} of you`;
}

function eventMessage(theme) {
  const templates = {
    Birthday: "We hope this birthday is filled with laughter, smiles, and memories that last. Please wish the birthday person a wonderful day from all of us at BillTable.",
    Wedding: "We hope this wedding day is everything you dreamed of — surrounded by love, family, and the people who matter most. Please pass along our warmest congratulations to the happy couple.",
    'Game Day @ Home': "We hope game day at home is loud, fun, and full of great moments. Cheer your team on like only you can.",
    'Game Day @ Office': "We hope game day brings your team closer together. Cheer loud, enjoy the food, and make it a day the office remembers.",
    Graduation: "We hope graduation day feels as proud and meaningful as every step that led here. Please pass along our congratulations — this one was earned.",
    'My Party': "We hope this party turns out exactly the way you imagined — and maybe even better. Enjoy every moment of it.",
    Other: "We hope this occasion becomes a wonderful memory for everyone who shares it with you.",
  };

  return templates[theme] || templates.Other;
}

function cuisineMessage(theme) {
  const templates = {
    Thai: "We hope these bold Thai flavors make this a meal worth coming back for.",
    Sushi: "We hope this meal turns out to be one of those ones you remember for a long time.",
    Italian: "We hope this Italian spread feels as warm and comforting as a real dinner in Italy.",
    Custom: "We hope this menu is exactly what you had in mind — made just the way you wanted it.",
  };

  return templates[theme] || "We hope this meal turns out to be delicious and worth remembering.";
}

/**
 * Generate the closing message shown on the Confirmation screen.
 * @param {string} theme - one of the ThemeSelector values (event or cuisine)
 * @param {number|string} guestCount - reserved for future use, not used in message text currently
 * @returns {string} closing message
 */
function generateClosingMessage(theme, guestCount) {
  if (!theme) {
    return 'Your table is ready. We hope this meal brings everyone together.';
  }

  if (EVENT_THEMES.has(theme)) {
    return eventMessage(theme);
  }

  if (CUISINE_THEMES.has(theme)) {
    return cuisineMessage(theme);
  }

  // Unknown/custom-typed theme value — generic fallback
  return "We hope this occasion becomes a great memory — for you and everyone who's part of it.";
}

module.exports = { generateClosingMessage };
