---
name: pack-generator
description: Generate Hot Mic content packs (lyric-friendly word packs, music trivia packs with a source for every question, and visual theme packs), fact-check them, validate them against the schemas and write them into packs/. Use when the user wants new words, trivia or a theme for the game.
---

# Hot Mic pack generator

Builds packs for a Hot Mic host. Packs are plain JSON (a theme is a folder or zip with a `theme.json`); the schemas are in `schemas/` and the same rules check uploads in the game lobby.

## 1. Ask first

Ask, in one short message, for whatever the host has not already said:

- **The theme or topic**, e.g. "90s pop", "Halloween", "country road trip", "Christmas".
- **Which pack types**: words, trivia, a theme (look and sounds), or any mix. A theme can also bundle its own words and questions.
- **How many items**: words (30 to 150 is typical) and trivia questions (a game needs `rounds - 1`, so 10 to 50 is plenty).
- For trivia: the era, genres or artists to lean on, and how hard.

Pick sensible defaults for anything left unsaid, say which, and carry on.

## 2. Words

A word is what players must sing a song containing, within seconds. Good words are:

- **Lyric-friendly**: very common in songs. "fire", "night", "heart", "rain", "dance", "road", "baby" work. "spreadsheet", "mortgage", "sedimentary" do not.
- **Short**: one word, at most 40 characters. No phrases.
- **Varied**: mix nouns, verbs, colors, places, feelings, weather and times of day. Avoid near-duplicates ("love" and "loves").
- **On theme, loosely**: a Halloween pack leans on "ghost", "moon", "midnight", but a few everyday words keep it singable.
- Safe for a mixed group: nothing slurs, nothing graphic.

Optionally tag `difficulty` as `easy`, `medium` or `hard` (hard = few songs use it). Test each word by thinking of two songs that contain it; drop the word if you cannot.

```json
{ "schemaVersion": 1, "type": "words", "name": "90s pop", "words": [{ "text": "fire" }, { "text": "tonight", "difficulty": "easy" }] }
```

## 3. Trivia (a source for every question, a flag on anything unconfirmed)

Each question has 2 to 4 distinct choices, `answer` is the 0-based index of the right one, and `source` is a link a host can open to check it.

```json
{ "question": "Which artist released the 1982 album Thriller?", "choices": ["Prince", "Michael Jackson", "Madonna", "Lionel Richie"], "answer": 1, "source": "https://en.wikipedia.org/wiki/Thriller_(album)" }
```

**Fact-checking is not optional.** Writing questions from memory and attaching plausible links is how wrong answers ship. For every question:

1. Draft it from what you know, preferring facts with one clear answer (a year, an artist, a title). Avoid "first", "biggest", "best" and anything that changes over time unless the question pins a date.
2. Look it up with WebSearch, then open the page with WebFetch and read the line that supports the answer. A search result list alone is not confirmation.
3. Put the page you actually read in `source`. Never invent or guess a URL, and never reuse a link you did not open for this fact.
4. Check that **only one** choice is correct. If another choice is arguably right (a group's members come from several countries), reword the question or drop it.
5. If you cannot confirm it (no page found, pages disagree, the fetch failed), set `"unconfirmed": true` and leave `source` out or keep your best guess. Do not silently keep it as if it were verified, and do not delete it either: the game shows hosts a warning for unconfirmed questions.
6. If the evidence shows the answer is wrong, fix the question and re-check it.

When working through many questions, batch the lookups and keep a note of each question's verdict (confirmed, wrong, ambiguous, unconfirmed) so the final report is accurate.

## 4. Theme packs

A theme is a folder `packs/themes/<name>/` (the folder name is its id) containing `theme.json` plus the files it points to. Hosts can also upload the same folder zipped, with `theme.json` at the top.

```json
{
  "schemaVersion": 1,
  "type": "theme",
  "name": "Halloween",
  "words": [{ "text": "ghost" }],
  "questions": [],
  "style": {
    "colors": { "bg": "#0e0a14", "panel": "#1d1428", "panel2": "#2a1c3a", "text": "#f6efe6", "muted": "#b3a3c7", "primary": "#ff7a1a", "accent": "#7cff6b", "good": "#7cff6b", "bad": "#ff3b5c" },
    "font": "display",
    "background": "background.svg",
    "sounds": { "boo": "sounds/boo.wav", "point": "sounds/point.wav" }
  }
}
```

Rules (all enforced by the checker):

- **Tokens only.** No custom CSS, no scripts. Unknown fields are errors.
- `colors` are `#rrggbb`. Every one is optional; the game's colors fill the gaps. Keys: `bg`, `panel`, `panel2`, `text`, `muted`, `primary`, `accent`, `good`, `bad`. Keep `text` readable on `bg`, `panel` and `panel2` (contrast 4.5:1), and `primary` light enough for the dark button text on it.
- `font` is one of `system`, `serif`, `rounded`, `mono`, `display`, `handwriting` (fonts already on the device; no font files).
- `background` is one image: `.png`, `.jpg`, `.webp` or `.svg`, at most 1 MB. An SVG must contain no scripts. Write a simple SVG by hand when no image is supplied: a gradient, a few shapes, nothing that makes text hard to read.
- `sounds` replace the TV's built-in cues. Cue names: `grab`, `boo`, `point`, `steal`, `round`, `final`. Files are `.wav`, `.mp3` or `.ogg`, at most 300 KB each, and should be short (under 2 s) and not harsh. Sounds are optional; skip them rather than ship bad ones.
- At most 24 files and 4 MB in total. File names use letters, digits, dots, dashes and folders only.
- Bundled `words` and `questions` join the game while the theme is picked, so themed trivia follows the rules in section 3.

`packs/themes/halloween/` is a complete example.

## 5. Validate, then write

Write words and trivia to `packs/<slug>.json` (lowercase, dashes) and a theme to `packs/themes/<slug>/`. Never overwrite an existing pack without asking; pick a new slug.

Then run the checker from the repo root and fix every error it names:

```
pnpm packs:check --require-sources packs/<slug>.json packs/themes/<slug>
```

`--require-sources` fails any trivia question that has neither a `source` nor `"unconfirmed": true`. The checker is the same ruleset the game's lobby upload uses, so a pack that passes here uploads cleanly. For a theme zip, check the zip too: `pnpm packs:check my-theme.zip`.

If the repo's pack tests exist, run `pnpm test` as well.

## 6. Report

End with a short report:

- Which files were written and how many words / questions each has.
- Trivia: how many questions were confirmed with a source, and a list of every `unconfirmed` question (number and text) so the host can check or delete them. Say plainly if some links could not be opened.
- Anything dropped or reworded and why.
- That the checker passed (paste its output line per file).
