// Animated mini-cladogram for the onboarding tour's "mechanic" slides. A single small fixed
// tree, drawn with theme-aware CSS-var colors, that re-decorates per `variant` to illustrate
// one idea at a time: placing a name, what a clade is, and how scoring works. Deliberately
// schematic — it teaches the shape of the game, it isn't the real renderer.

import { motion } from "framer-motion";

export type TourVariant = "welcome" | "place" | "clade" | "score";

// Hand-placed so it reads cleanly at this size. Rectangular cladogram: each edge is an elbow
// (vertical at the parent's x, then horizontal to the child).
const N: Record<string, [number, number]> = {
  R: [22, 78],
  A: [82, 42],
  B: [82, 116],
  C: [128, 100],
  t1: [182, 24],
  t2: [182, 60],
  t3: [182, 86],
  t4: [182, 114],
  t5: [182, 146],
};
const EDGES: [string, string][] = [
  ["R", "A"],
  ["R", "B"],
  ["A", "t1"],
  ["A", "t2"],
  ["B", "C"],
  ["B", "t5"],
  ["C", "t3"],
  ["C", "t4"],
];
const TIPS = ["t1", "t2", "t3", "t4", "t5"];

const ink = "rgb(var(--clade-ink))";
const accent = "rgb(var(--clade-accent))";

const edgeId = (p: string, c: string) => `${p}-${c}`;
function edgePath(p: string, c: string): string {
  const [px, py] = N[p];
  const [, cy] = N[c];
  const [cx] = N[c];
  return `M ${px} ${py} V ${cy} H ${cx}`;
}

/** Which edges/tips light up (accent) for each variant. */
function highlight(variant: TourVariant): { edges: Set<string>; tips: Set<string> } {
  switch (variant) {
    case "place":
      return { edges: new Set([edgeId("A", "t2")]), tips: new Set(["t2"]) };
    case "clade":
      // The clade descending from A: its stem (R-A), inner edges, and its two tips.
      return {
        edges: new Set([edgeId("R", "A"), edgeId("A", "t1"), edgeId("A", "t2")]),
        tips: new Set(["t1", "t2"]),
      };
    case "score":
      return { edges: new Set(), tips: new Set(["t1", "t3"]) };
    default:
      return { edges: new Set(), tips: new Set() };
  }
}

// Per-tip score badges for the scoring slide.
const SCORE_BADGES: Record<string, { text: string; good: boolean }> = {
  t1: { text: "+1", good: true },
  t3: { text: "+1", good: true },
  t4: { text: "0", good: false },
};

export function TourTree({ variant }: { variant: TourVariant }) {
  const hl = highlight(variant);
  const drawing = variant === "welcome";

  return (
    <svg
      viewBox="0 0 210 168"
      className="h-44 w-full"
      role="img"
      aria-hidden="true"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {EDGES.map(([p, c]) => {
        const id = edgeId(p, c);
        const on = hl.edges.has(id);
        return (
          <motion.path
            key={id}
            d={edgePath(p, c)}
            stroke={on ? accent : ink}
            strokeOpacity={on ? 1 : drawing ? 1 : 0.32}
            strokeWidth={on ? 2.4 : 1.6}
            initial={drawing ? { pathLength: 0 } : false}
            animate={drawing ? { pathLength: 1 } : { strokeOpacity: on ? 1 : 0.32 }}
            transition={
              drawing
                ? { duration: 0.9, delay: EDGES.findIndex(([a, b]) => edgeId(a, b) === id) * 0.08 }
                : { duration: 0.4 }
            }
          />
        );
      })}

      {/* Clade halo: a soft rounded field hugging the highlighted clade. */}
      {variant === "clade" && (
        <motion.rect
          x={70}
          y={12}
          width={128}
          height={66}
          rx={14}
          fill={accent}
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.1 }}
          transition={{ duration: 0.5 }}
        />
      )}

      {TIPS.map((t, i) => {
        const [x, y] = N[t];
        const on = hl.tips.has(t);
        const badge = variant === "score" ? SCORE_BADGES[t] : undefined;
        return (
          <g key={t}>
            <motion.circle
              cx={x}
              cy={y}
              r={on ? 5 : 3.4}
              fill={on ? accent : "rgb(var(--clade-paper))"}
              stroke={on ? accent : ink}
              strokeOpacity={on ? 1 : 0.4}
              strokeWidth={1.6}
              initial={drawing ? { scale: 0, opacity: 0 } : false}
              animate={
                variant === "place" && on
                  ? { scale: [1, 1.5, 1], opacity: 1 }
                  : { scale: 1, opacity: 1 }
              }
              transition={
                drawing
                  ? { delay: 0.7 + i * 0.08, type: "spring", stiffness: 300 }
                  : variant === "place" && on
                    ? { duration: 1.1, repeat: Infinity, repeatDelay: 0.4 }
                    : { duration: 0.3 }
              }
            />
            {badge && (
              <motion.text
                x={x + 12}
                y={y + 3.5}
                fontSize={11}
                fontFamily='"Space Mono", monospace'
                fill={badge.good ? accent : ink}
                fillOpacity={badge.good ? 1 : 0.35}
                initial={{ opacity: 0, x: x + 4 }}
                animate={{ opacity: 1, x: x + 12 }}
                transition={{ delay: 0.2 + i * 0.12 }}
              >
                {badge.text}
              </motion.text>
            )}
          </g>
        );
      })}

      {/* "Place a name" cue: a little tag flying into the highlighted tip. */}
      {variant === "place" && (
        <motion.g
          initial={{ opacity: 0, x: -16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5 }}
        >
          <rect x={92} y={50} width={64} height={20} rx={6} fill="rgb(var(--clade-paper))" stroke={accent} strokeWidth={1.4} />
          <text x={124} y={64} textAnchor="middle" fontSize={10} fontFamily='"Space Mono", monospace' fill={accent}>
            red fox
          </text>
        </motion.g>
      )}
    </svg>
  );
}
