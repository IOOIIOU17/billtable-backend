// Party passcodes -- Tony's idea: a fun secret phrase, like the password
// to a speakeasy ("pink whale"). The host can change it. Guests must type
// it to join, so knowing an order number alone no longer opens a party.
const ADJECTIVES = [
  'pink', 'golden', 'sleepy', 'dancing', 'spicy', 'tiny', 'giant', 'lucky',
  'velvet', 'neon', 'sunny', 'midnight', 'fizzy', 'crispy', 'jolly', 'silver',
  'wild', 'cozy', 'bouncy', 'secret', 'shiny', 'happy', 'brave', 'sweet',
];
const NOUNS = [
  'whale', 'mango', 'taco', 'panda', 'disco', 'noodle', 'llama', 'cupcake',
  'rocket', 'pickle', 'otter', 'lantern', 'dumpling', 'flamingo', 'pretzel',
  'koala', 'balloon', 'comet', 'waffle', 'tiger', 'donut', 'cactus', 'penguin',
];

function randomPasscode() {
  const a = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const n = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  return `${a} ${n}`;
}

// Case, spacing and punctuation never decide a match: "Pink  Whale!" == "pink whale".
function normalizePasscode(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

module.exports = { randomPasscode, normalizePasscode };
