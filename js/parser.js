// Parseur de saisie libre : transforme une phrase ou une liste séparée par
// des virgules en ingrédients individuels. Volontairement simple (regex),
// aucune dépendance IA — voir section "Saisie naturelle" du cahier des
// charges. `parseIngredientInput` reste la seule porte d'entrée utilisée par
// l'UI, ce qui permettra de brancher un LLM plus tard sans toucher au reste
// du code (ex: une V2 pourrait remplacer son corps par un appel API tout en
// gardant la même signature).
import { normalizeIngredient } from './ingredients.js';

const LEADING_FILLERS = [
  "j'ai", 'j’ai', "j'avais", 'il me reste', 'il reste', 'reste de',
  'un reste de', 'des restes de', 'un peu de', "un peu d'", 'quelques',
  'de la', "de l'", 'du', 'des', 'de', "d'", 'un', 'une', 'le', 'la', 'les',
];

// Trié du plus long au plus court pour matcher les expressions composées
// ("un reste de") avant les mots simples ("un").
const LEADING_FILLERS_SORTED = [...LEADING_FILLERS].sort((a, b) => b.length - a.length);

const QUANTITY_RE = /^(\d+(?:[.,]\d+)?)\s*(kg|g|l|cl|ml|c\.à\.s|c\.à\.c|cuillère[s]?|tranche[s]?|pincée[s]?)?\s*/i;

export function stripLeadingFillers(fragment) {
  let text = fragment.trim();
  let changed = true;
  while (changed) {
    changed = false;
    for (const filler of LEADING_FILLERS_SORTED) {
      // Une élision ("d'échalotes") n'a pas d'espace après l'apostrophe,
      // contrairement à un mot plein ("de échalotes" n'existe pas mais "de
      // la crème" oui) : on n'exige un espace que si le filler ne se
      // termine pas déjà par une apostrophe.
      const endsWithApostrophe = /['’]$/.test(filler);
      const boundary = endsWithApostrophe ? '' : '\\s+';
      const re = new RegExp(`^${filler.replace(/'/g, "['’]")}${boundary}`, 'i');
      if (re.test(text)) {
        text = text.replace(re, '').trim();
        changed = true;
        break;
      }
    }
  }
  return text;
}

export function extractQuantity(fragment) {
  const match = fragment.match(QUANTITY_RE);
  if (!match) return { quantity: null, rest: fragment };
  return {
    quantity: match[0].trim(),
    rest: fragment.slice(match[0].length).trim(),
  };
}

/**
 * @param {string} input texte libre saisi par l'utilisateur
 * @returns {{raw: string, normalized: string, quantity: string|null}[]}
 */
export function parseIngredientInput(input) {
  if (!input || !input.trim()) return [];

  let text = input.trim();
  // "et" en fin d'énumération -> virgule, pour permettre un split uniforme
  // ("poulet, riz et crème" -> "poulet, riz, crème").
  text = text.replace(/\s+et\s+/gi, ', ');

  const fragments = text
    .split(/[,;\n]+/)
    .map((f) => f.trim())
    .filter(Boolean);

  const results = [];
  for (const fragment of fragments) {
    const withoutFillers = stripLeadingFillers(fragment);
    if (!withoutFillers) continue;
    const { quantity, rest } = extractQuantity(withoutFillers);
    const ingredientText = stripLeadingFillers(rest) || rest;
    if (!ingredientText) continue;
    const normalized = normalizeIngredient(ingredientText);
    if (!normalized) continue;
    results.push({ raw: fragment, normalized, quantity });
  }
  return results;
}
