/**
 * Word lists for the editor: swear words (censored in captions and audio),
 * filler words (auto-cut) and keyword → emoji (auto emojis).
 * Plain data + tiny helpers; relative imports only (bundled by Remotion too).
 */

const norm = (w: string) =>
  w
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9*']/g, "")
    .replace(/'/g, "");

/**
 * Strong profanity and slurs — what YouTube's advertiser guidelines treat as
 * "strong profanity". Mild words (damn, hell, crap) are left alone on purpose.
 * Patterns match the start of the word, so "fucking", "shitty", "bitches" match.
 */
const SWEAR_PATTERNS: RegExp[] = [
  /^(mother|mutha|motha)?f+u+c*k+/,
  /^fck/,
  /^fk(ing|in|ed)?$/,
  /^fuk/,
  /^fukin/,
  /^(bull|horse|dip|holy)?shi+t+/,
  /^sh1t/,
  /^bi+t+ch/,
  /^biatch/,
  /^cunt/,
  /^cock(sucker|suckers)?$/,
  /^dick(head|heads|s)?$/,
  /^puss(y|ies)$/,
  /^(dumb|jack|smart|bad|kick|fat)?ass(hole|holes|wipe)?$/,
  /^arsehole/,
  /^bastard/,
  /^whore/,
  /^slut/,
  /^twat/,
  /^wank/,
  /^prick$/,
  /^goddamn/,
  /^nigg/,
  /^nigga/,
  /^fag/,
  /^retard/,
  /^tranny/,
  /^spic$/,
  /^chink/,
  /^kike/,
];

/** True for strong profanity, whisper's own bleeps ("f***") and the user's extra words. */
export function isSwear(word: string, extra: string[] = []): boolean {
  const w = norm(word);
  if (!w) return false;
  if (/^[a-z]+\*+[a-z*]*$/.test(w)) return true; // f***, s**t
  const plain = w.replace(/\*/g, "");
  if (extra.some((e) => e && plain === norm(e))) return true;
  // "ass" only as a whole word or compound — never "assist", "class", "pass"
  return SWEAR_PATTERNS.some((p) => p.test(plain));
}

/** Hesitation sounds that are safe to cut automatically. */
const FILLERS = new Set(["um", "umm", "ummm", "uh", "uhh", "uhhh", "uhm", "er", "erm", "ah", "ahh", "hmm", "hmmm", "mm", "mmm", "eh"]);
/** Verbal fillers — only cut when the user opts in (they are sometimes real words). */
const SOFT_FILLERS = new Set(["like", "basically", "literally", "actually"]);

export function isFiller(word: string, includeSoft = false): boolean {
  const w = norm(word).replace(/\*/g, "");
  return FILLERS.has(w) || (includeSoft && SOFT_FILLERS.has(w));
}

/** keyword stem -> emoji. Matched against the start of the normalised word. */
const EMOJI: [RegExp, string][] = [
  [/^(lol|lmao|lmfao|haha+|hehe|laugh|funny|hilarious)/, "😂"],
  [/^(dead|die|died|dying|kill|killed|rip)$/, "💀"],
  [/^(fire|lit|insane|crazy|wild)$/, "🔥"],
  [/^(money|cash|dollar|dollars|rich|paid|bucks|million|millions)$/, "💰"],
  [/^(cop|cops|police|polic|sheriff|arrest)/, "🚓"],
  [/^(car|cars|drive|driving|drove)$/, "🚗"],
  [/^(gun|guns|shoot|shot|shots|shooting)$/, "🔫"],
  [/^(bomb|boom|explode|exploded|explosion)$/, "💥"],
  [/^(love|loved|heart)$/, "❤️"],
  [/^(win|won|winner|winning|victory|champion)$/, "🏆"],
  [/^(lost|lose|losing|loser|fail|failed)$/, "😭"],
  [/^(cry|crying|sad)$/, "😢"],
  [/^(angry|mad|rage|furious)$/, "😡"],
  [/^(scared|scary|afraid|terrified|horror)$/, "😱"],
  [/^(wow|whoa|woah|omg)$/, "😳"],
  [/^(idea|genius|brain|brains)$/, "🧠"],
  [/^(eat|eating|food|hungry|pizza|burger)$/, "🍔"],
  [/^(run|running|ran|fast|speed|chase)$/, "💨"],
  [/^(cold|ice|freeze|frozen)$/, "🥶"],
  [/^(hot|heat)$/, "🥵"],
  [/^(king|queen|boss)$/, "👑"],
  [/^(clown|joke|joking)$/, "🤡"],
  [/^(eyes|sus|suspicious)$/, "👀"],
  [/^(phone|phones)$/, "📱"],
  [/^(gaming|gamer|gamers)$/, "🎮"],
  [/^(goat)$/, "🐐"],
  [/^(cap|lie|lying|liar)$/, "🧢"],
  [/^(bruh)$/, "🤦"],
  [/^(plane|fly|flying)$/, "✈️"],
  [/^(jail|prison)$/, "🔒"],
  [/^(heist|rob|robbed|robbery|steal|stole)$/, "🦹"],
];

export function emojiFor(word: string): string | null {
  const w = norm(word).replace(/\*/g, "");
  if (w.length < 2) return null;
  for (const [re, e] of EMOJI) if (re.test(w)) return e;
  return null;
}
