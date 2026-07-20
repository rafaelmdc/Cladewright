// The reveal figure for Clade Clash (#36) — the moment the game actually teaches something.
//
// "shares family" used to be 10px of grey monospace on a pill, which is a poor showing for
// the one line that explains WHY an answer was right. Here it's drawn instead: a two-branch
// cladogram joining the specimen to both candidates, with the shared rank named on each join.
//
// The topology is fixed by the round itself. The near candidate shares a MORE RECENT ancestor
// with the specimen than the far one does, so the shape is always ((specimen, near), far):
//
//        ┌───── specimen
//     ┌──┤  ← MRCA(specimen, near)   e.g. "family Canidae"
//     │  └───── near
//  ───┤
//     └──────── far                  joined further back, at MRCA(specimen, far)
//
// Reusing the cladogram is deliberate: the tree is the app's whole identity, and seeing the
// join is what makes a wrong answer memorable rather than just wrong.

import { motion, useReducedMotion } from "framer-motion";

import type { Relatedness } from "../../lib/game/distance";
import type { NameLens } from "../../lib/game/settings";

interface Tip {
  common: string;
  sci: string;
}

/** Name a tip under the active lens — the reveal must not leak the common name in hard mode. */
function nameOf(tip: Tip, lens: NameLens): string {
  return lens === "scientific" ? tip.sci : tip.common || tip.sci;
}

export function RevealClado({
  center,
  near,
  far,
  nearRel,
  farRel,
  youPickedNear,
  lens = "both",
}: {
  center: Tip;
  near: Tip;
  far: Tip;
  nearRel: Relatedness;
  farRel: Relatedness;
  /** Drives the "your pick" marker — null when the round timed out with no pick. */
  youPickedNear: boolean | null;
  lens?: NameLens;
}) {
  const reduce = useReducedMotion();

  // Geometry. Rows are fixed; only the labels change, so the figure never reflows between
  // rounds and the eye can stay in one place. Rank labels are CENTRED ON THEIR BRANCH rather
  // than hung off the join — hanging them there put the rank on top of the leaf's note.
  const Y = { center: 24, near: 62, far: 108 };
  const X = { root: 10, farJoin: 62, nearJoin: 132, tip: 150 };
  const nearMid = (Y.center + Y.near) / 2;

  return (
    <motion.div
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: "easeOut" }}
      className="ink-card w-full max-w-3xl bg-clade-paper px-4 py-3"
    >
      <p className="mb-1 font-mono text-[10px] uppercase tracking-widest text-clade-ink/40">
        why
      </p>
      <div className="overflow-x-auto">
        <svg viewBox="0 0 460 126" className="h-auto w-full min-w-[22rem]" role="img"
             aria-label={`${nameOf(center, lens)} shares ${nearRel.mrcaRank ?? "an ancestor"} with ${nameOf(near, lens)}, and only ${farRel.mrcaRank ?? "a deeper ancestor"} with ${nameOf(far, lens)}.`}>
          {/* branches — drawn as one stroked path so the ink weight stays even */}
          <path
            d={`M${X.root} ${nearMid} H${X.farJoin}
                M${X.farJoin} ${nearMid} V${Y.far}
                M${X.farJoin} ${nearMid} H${X.nearJoin}
                M${X.farJoin} ${Y.far} H${X.tip}
                M${X.nearJoin} ${Y.center} V${Y.near}
                M${X.nearJoin} ${Y.center} H${X.tip}
                M${X.nearJoin} ${Y.near} H${X.tip}`}
            fill="none"
            stroke="currentColor"
            strokeOpacity="0.3"
            strokeWidth="2"
            strokeLinecap="round"
            className="text-clade-ink"
          />

          {/* the join that matters — the shared clade with the NEAR candidate */}
          <circle cx={X.nearJoin} cy={nearMid} r="4.5" className="fill-clade-accent" />
          {nearRel.mrcaRank && (
            <text
              x={(X.farJoin + X.nearJoin) / 2}
              y={nearMid - 8}
              textAnchor="middle"
              className="fill-clade-accent font-hand text-[15px] font-bold"
            >
              {nearRel.mrcaRank}
            </text>
          )}

          {/* the earlier join, where the far candidate splits away */}
          <circle cx={X.farJoin} cy={nearMid} r="3.5" fill="none"
                  stroke="currentColor" strokeOpacity="0.4" strokeWidth="2" className="text-clade-ink" />
          {farRel.mrcaRank && (
            <text x={(X.farJoin + X.tip) / 2} y={Y.far - 7} textAnchor="middle"
                  className="fill-clade-ink/45 font-mono text-[9px] uppercase tracking-widest">
              {farRel.mrcaRank}
            </text>
          )}

          <Leaf x={X.tip} y={Y.center} name={nameOf(center, lens)} note="specimen" accent />
          <Leaf x={X.tip} y={Y.near} name={nameOf(near, lens)}
                note={youPickedNear === true ? "closer · your pick" : "closer"} accent />
          <Leaf x={X.tip} y={Y.far} name={nameOf(far, lens)}
                note={youPickedNear === false ? "further · your pick" : "further"} />
        </svg>
      </div>
    </motion.div>
  );
}

function Leaf({
  x, y, name, note, accent,
}: {
  x: number; y: number; name: string; note: string; accent?: boolean;
}) {
  return (
    <>
      <text x={x + 8} y={y + 3} className="fill-clade-ink font-hand text-[17px] font-bold">
        {name}
      </text>
      <text
        x={x + 8}
        y={y + 15}
        className={`font-mono text-[8.5px] uppercase tracking-widest ${
          accent ? "fill-clade-accent/70" : "fill-clade-ink/40"
        }`}
      >
        {note}
      </text>
    </>
  );
}
