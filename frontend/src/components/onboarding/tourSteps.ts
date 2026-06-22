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

/** Hub: what the game is, then a tour of the setup controls on this screen. */
export const HUB_STEPS: TourStep[] = [
  {
    variant: "welcome",
    title: "Welcome to Cladewright",
    body: "It's the tree of life as a game. Name as many living things as you can before the clock runs out — the rarer the branch, the better.",
  },
  {
    variant: "place",
    title: "Place a name",
    body: "In a round, you type a creature's common name (or its scientific one) and it drops onto its branch. Every new species you find is worth a point.",
  },
  {
    variant: "clade",
    title: "Claim whole clades",
    body: "A clade is a branch — an ancestor and everything descended from it. Name the clade (“canids”, “Felidae”) to claim it all at once, then refine it. The tree is unrooted: what matters is who's related, not which way is up.",
  },
  {
    variant: "score",
    title: "How you score",
    body: "Each brand-new placement scores. Naming a species under a clade you already have refines it; naming something already covered scores nothing. Hunt the untouched branches.",
  },
  {
    anchor: "difficulty",
    title: "Common or scientific",
    body: "Play with everyday names, or switch to scientific binomials when you want a real challenge.",
  },
  {
    anchor: "clades",
    title: "Pick your world",
    body: "Choose which group to explore — mammals, birds, fish… or tap several to mix their trees into one round.",
  },
  {
    anchor: "daily",
    title: "Daily & leaderboards",
    body: "Everyone gets the same puzzle once a day — keep a streak alive. Default settings are “ranked” and post to the leaderboards; the rest is below.",
  },
];

/** Time Attack: how to drive the live board. Mostly spotlights the real HUD, with one
 *  illustration for the clade idea (the board itself fills the screen, so it can't be
 *  usefully spotlighted). */
export const GAME_STEPS: TourStep[] = [
  {
    anchor: "search",
    title: "Name an organism",
    body: "Type a creature's name here — common or scientific — and press enter. It lands on its branch of the tree.",
  },
  {
    variant: "clade",
    title: "Claim whole clades",
    body: "Name a clade (“canids”, “Felidae”) to claim its whole branch at once, then refine it species by species. Each new placement scores; repeats don't.",
  },
  {
    anchor: "timer",
    title: "The clock waits for you",
    body: "Your timer doesn't start until you place your first species — so take a beat to read the board. After that, every new find buys you more time.",
  },
  {
    anchor: "tally",
    title: "Your progress",
    body: "How many you've placed and your points, live. Play until the clock runs out, or end the run early any time.",
  },
  {
    anchor: "settings",
    title: "Tune the run",
    body: "Change the timer, tree layout, and species pool here. Default settings are “ranked” and post to the leaderboards; custom runs still count toward your stats.",
  },
];
