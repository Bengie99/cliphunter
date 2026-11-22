/**
 * Caption fonts (Google Fonts, free). Loaded once by the composition — in the
 * editor preview and in the render — so both look identical.
 */
import { loadFont as anton } from "@remotion/google-fonts/Anton";
import { loadFont as bangers } from "@remotion/google-fonts/Bangers";
import { loadFont as bebas } from "@remotion/google-fonts/BebasNeue";
import { loadFont as inter } from "@remotion/google-fonts/Inter";
import { loadFont as luckiest } from "@remotion/google-fonts/LuckiestGuy";
import { loadFont as montserrat } from "@remotion/google-fonts/Montserrat";
import { loadFont as notoEmoji } from "@remotion/google-fonts/NotoColorEmoji";
import { loadFont as poppins } from "@remotion/google-fonts/Poppins";
import { loadFont as titan } from "@remotion/google-fonts/TitanOne";
import type { FontId } from "./spec";

const opts = { ignoreTooManyRequestsWarning: true } as const;

export const EMOJI_FAMILY = notoEmoji("normal", { ...opts }).fontFamily;

const FAMILIES: Record<FontId, { family: string; weight: number }> = {
  montserrat: { family: montserrat("normal", { weights: ["800", "900"], subsets: ["latin", "latin-ext"], ...opts }).fontFamily, weight: 900 },
  anton: { family: anton("normal", { weights: ["400"], subsets: ["latin", "latin-ext"], ...opts }).fontFamily, weight: 400 },
  bebas: { family: bebas("normal", { weights: ["400"], subsets: ["latin", "latin-ext"], ...opts }).fontFamily, weight: 400 },
  poppins: { family: poppins("normal", { weights: ["800", "900"], subsets: ["latin", "latin-ext"], ...opts }).fontFamily, weight: 800 },
  bangers: { family: bangers("normal", { weights: ["400"], subsets: ["latin", "latin-ext"], ...opts }).fontFamily, weight: 400 },
  luckiest: { family: luckiest("normal", { weights: ["400"], subsets: ["latin"], ...opts }).fontFamily, weight: 400 },
  titan: { family: titan("normal", { weights: ["400"], subsets: ["latin", "latin-ext"], ...opts }).fontFamily, weight: 400 },
  inter: { family: inter("normal", { weights: ["700", "800"], subsets: ["latin", "latin-ext"], ...opts }).fontFamily, weight: 800 },
};

export function font(id: FontId): { fontFamily: string; fontWeight: number } {
  const f = FAMILIES[id] ?? FAMILIES.montserrat;
  return { fontFamily: `${f.family}, ${EMOJI_FAMILY}, "Arial Black", sans-serif`, fontWeight: f.weight };
}

export const FONT_LABELS: Record<FontId, string> = {
  montserrat: "Montserrat Black",
  anton: "Anton",
  bebas: "Bebas Neue",
  poppins: "Poppins ExtraBold",
  bangers: "Bangers",
  luckiest: "Luckiest Guy",
  titan: "Titan One",
  inter: "Inter",
};
