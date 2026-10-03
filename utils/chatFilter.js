// Party chat word filter (Apple Guideline 1.2 asks apps with user-to-user
// chat to filter objectionable material). Masks slurs and strong
// profanity with asterisks; it does not block the message, so normal
// conversation is never lost. Word list written for BillTable -- extend
// it when a report shows something it missed.
const WORDS = [
  'fuck', 'fucking', 'fucker', 'motherfucker', 'shit', 'bullshit', 'bitch',
  'cunt', 'dick', 'cock', 'pussy', 'asshole', 'bastard', 'whore', 'slut',
  'nigger', 'nigga', 'faggot', 'fag', 'retard', 'retarded', 'spic', 'chink',
  'kike', 'wetback', 'tranny', 'dyke', 'twat', 'wanker', 'prick',
];

const PATTERN = new RegExp(`\\b(${WORDS.join('|')})\\b`, 'gi');

function cleanMessage(text) {
  return String(text).replace(PATTERN, (w) => w[0] + '*'.repeat(Math.max(1, w.length - 1)));
}

module.exports = { cleanMessage };
