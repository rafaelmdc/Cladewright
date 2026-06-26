// Step sets for the per-page help tours (GitHub issue #59). Each page gets its own tour:
// the Hub explains the concept + its setup controls; Time Attack explains how to operate the
// live board. A step is either a "mechanic" step (an animated TourTree illustration) or a
// "spotlight" step (dims the page and rings a real element by its `data-tour` anchor).

import type { TourVariant } from "./TourTree";

export interface TourStep {
  title: string;
  body: string;
  /** Mechanic step: which mini-tree illustration to show. */
  variant?: TourVariant;
  /** Spotlight step: the `data-tour` value of the on-page element to highlight. */
  anchor?: string;
}

// Cladewright is the platform (the tree of life); Time Attack is one game on it, with more to
// come. So the MENU tour stays game-agnostic (what this is + the setup controls on this
// screen), and the gameplay how-to lives with the game it describes.

/** Hub / main menu: what Cladewright is, and the one shared Daily. Setup choices (difficulty,
 *  packs, settings) now live in each game's lobby, so the hub tour stays about the menu itself. */
export const HUB_STEPS: TourStep[] = [
  {
    variant: "welcome",
    title: "Welcome to Cladewright",
    body: "The tree of life, as a game — a growing collection of them. This is the menu: pick a game below, then set up your run (packs, difficulty, settings) on its own screen.",
  },
  {
    anchor: "daily",
    title: "Daily & leaderboards",
    body: "Everyone gets the same puzzle once a day — keep a streak alive. It posts to the leaderboards; default settings are “ranked”.",
  },
];

/** Time Attack: the gameplay guides — how this game is actually played (placing names,
 *  claiming clades, combos, completing clades), then the on-page settings + end controls.
 *  Mechanic steps use the mini-cladogram; the live board fills the screen, so it can't be
 *  usefully spotlighted. */
export const GAME_STEPS: TourStep[] = [
  {
    variant: "welcome",
    title: "Time Attack",
    body: "Name as many living things as you can before the clock runs out — every species and clade you place is worth a point. The timer only starts on your first placement, so take a beat.",
  },
  {
    variant: "place",
    title: "Place a name",
    body: "Type a creature's common name (or its scientific one) and it drops onto its branch. Every new species you find buys you more time.",
  },
  {
    variant: "clade",
    title: "Claim whole clades",
    body: "A clade is a branch — an ancestor and everything descended from it. Name the clade (“canids”, “Felidae”) to claim it all at once, then refine it. The tree is unrooted: what matters is who's related, not which way is up.",
  },
  {
    variant: "score",
    title: "Build a combo",
    body: "Every name you place is a point — and if you keep them coming without pausing, your combo climbs, stacking bonus seconds and bonus points onto each placement. Wrong guesses and repeats don't break the chain; only stopping does. So keep naming.",
  },
  {
    variant: "clade",
    title: "Fill up a clade",
    body: "Name every living species under a branch and you complete that clade — banking a burst of bonus time and bonus points that grow with how big it was. Clearing a whole group out is where the big scores come from.",
  },
  {
    anchor: "settings",
    title: "Tune the run",
    body: "Change the timer, tree layout, and species pool here. Default settings are “ranked” and post to the leaderboards; custom runs still count toward your stats.",
  },
  {
    anchor: "end",
    title: "End early any time",
    body: "Done before the clock is? Tap here to end the run and bank your score — no need to wait out the timer.",
  },
];
