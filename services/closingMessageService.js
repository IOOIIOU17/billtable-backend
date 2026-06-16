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
    Birthday: "Here's to the theme you picked — we hope this birthday is full of laughter and smiles. Don't forget to wish the birthday person well for us!",
    Wedding: "Here's to the theme you picked — we hope this wedding is filled with love and joy, surrounded by close friends and family. Please send our congratulations to the happy couple!",
    'Game Day @ Home': "Here's to the theme you picked — we hope game day at home is full of fun and loud cheering. Root for your team like you mean it!",
    'Game Day @ Office': "Here's to the theme you picked — we hope game day brings the office closer together. Cheer loud and enjoy it as a team!",
    Graduation: "Here's to the theme you picked — we hope graduation day feels as proud as all the hard work that led here. Please pass along our congratulations to the graduate!",
    'My Party': "Here's to the theme you picked — we hope this party turns out exactly the way you imagined. Have an amazing time!",
    Other: "Here's to the theme you picked — we hope it becomes a great memory for everyone who's there.",
  };

  return templates[theme] || templates.Other;
}

function cuisineMessage(theme) {
  const templates = {
    Thai: "Here's to the theme you picked — we hope these bold Thai flavors make this meal one you'll want again.",
    Sushi: "Here's to the theme you picked — we hope this turns out to be a meal worth remembering.",
    Italian: "Here's to the theme you picked — we hope this Italian meal feels as warm as sitting down for dinner in Italy.",
    Custom: "Here's to the theme you picked — we hope this custom menu is exactly what you were going for.",
  };

  return templates[theme] || "Here's to the theme you picked — we hope it turns out to be a delicious, memorable meal.";
}

/**
 * Generate the closing message shown on the Confirmation screen.
 * @param {string} theme - one of the ThemeSelector values (event or cuisine)
 * @param {number|string} guestCount - reserved for future use, not used in message text currently
 * @returns {string} closing message
 */
function generateClosingMessage(theme, guestCount) {
  if (!theme) {
    return 'Your table is ready — we hope it turns out to be a great meal.';
  }

  if (EVENT_THEMES.has(theme)) {
    return eventMessage(theme);
  }

  if (CUISINE_THEMES.has(theme)) {
    return cuisineMessage(theme);
  }

  // Unknown/custom-typed theme value — generic fallback
  return "Here's to the theme you picked — we hope it becomes a great memory for this occasion.";
}

module.exports = { generateClosingMessage };
