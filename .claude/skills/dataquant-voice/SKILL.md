---
name: dataquant-voice
description: "Tone and voice for everything DataQuant says to a reader — X posts, alert emails, the market pulse, dashboard labels, landing copy. Load before writing or editing any user-facing string in apps/breakout-agent (agent.ts alerts and X posts, server.js tweet composers and pulse, og-card.js, public/*.html). Trigger: /dataquant-voice or any request to write, rewrite, or review outbound messaging."
---

# DataQuant voice

DataQuant is a pre-built breakout screener. It watches every liquid US stock,
grades the base each one is sitting in, and says when a close clears the pivot.
It is not a trading service. It does not tell anyone what to buy, when to buy,
how much, or where to get out. Every sentence we publish should survive that test.

## Who is talking

A quiet, careful person who has read a lot of charts and does not need you to
be impressed. They report what the screen saw today. They are specific, brief,
and a little dry. They never sell.

## Rules

1. **Report, don't recommend.** We say what happened: a close above a pivot, a
   base that graded S, six distribution days. We never say what to do about it.
   No "take", "size", "honor stops", "position", "entry", "buy", "stop loss",
   "risk/reward", "trade".
2. **One idea per post.** A tease is one ticker, one fact, one number. If it
   needs a second line, it is not a tease.
3. **Numbers carry the message.** Prefer "16-week base" to "long base".
   Prefer "closed 2.6% past the pivot" to "strong breakout". Two numbers per
   sentence at most.
4. **Plain words.** No hype adjectives (massive, huge, explosive, fresh, clean,
   strong, actionable). No exclamation marks. No rhetorical questions.
5. **Almost no emoji.** None in body text. At most one, and only as a status
   glyph the reader already knows (⚠ for caution). Never 🚀 🔥 🚨 📈 📞 🔖.
6. **No AI tells.** No "— " em-dash chains, no "Here's why", no "Let's",
   no "In summary", no bulleted lists in a tweet, no colon-led label pairs
   ("Tone: Bullish (+0.82) · Guidance: Raised"). Write a sentence instead:
   "The last call read bullish and guidance went up."
7. **No stacked links or CTAs.** One link, in a reply, phrased as where the
   rest of the information lives. Never "Bookmark this", never "free, no login".
8. **Disclaimer is a sentence, not a badge.** "Screen output for research, not
   advice." once, at the end, when the post contains a price level. Not on
   every line, not in capitals.
9. **Say less.** If a reader would not act differently without a line, cut it.

## Vocabulary

| Say | Not |
|---|---|
| pivot | buy point, entry, breakout price |
| closed above / cleared the pivot | broke out, fired, triggered |
| fail level (7% below the pivot) | stop, stop loss |
| past the pivot / back below it | in profit, underwater, still above entry |
| fell through its fail level | stopped out |
| base, grade S / A+ / A | setup, actionable |
| extension (past the 5% pivot zone) | continuation opportunity |
| the screen | signals, alerts, picks |
| tape is mixed / weak / supportive | risk-on, risk-off (fine as the card label, not in prose) |

## Shapes

**X tease (one a day, after the close).** One tweet. Ticker, what it did, the
one thing that makes the base interesting.

> $MTW closed above its pivot today, $21.34. Grade S base, 16 weeks long.

Reply, no cashtag, one link:

> Why it graded S, and the rest of today's screen: dataquant.ai/$mtw

**Weekly market pulse (Monday, before the open).** One tweet plus the card
image. The text does not repeat the card. One line of reading, two numbers.

> Market health 57 this week, caution. Six distribution days in the last 25
> sessions and under half the market is up on the month.

Reply links to the methodology page, not the gauge, so the card does not
render twice.

**Alert email.** Subject is the fact. Body is a short table of levels, one
paragraph on why the screen flagged it, the earnings read if we have one, the
chart link. No section banners, no "TRADE SETUP".

**Weekly receipts (Saturday).** Every breakout the screen produced, counted
three ways: cleared, still past the pivot, fell through the fail level. Best
and worst by name. Nothing about discipline working.

**Monthly audit.** Same counts over 30 days. Say what exits were assumed in
one clause.

## Checklist before shipping a string

- Would a compliance reader see a recommendation? Rewrite.
- Count emoji. More than one? Cut.
- Count numbers in each sentence. More than two? Split or cut.
- Is there a label:value pair? Turn it into a sentence.
- Does the text repeat what an attached image already shows? Cut the text.
- Does it say "advice" more than once? Cut to one.
