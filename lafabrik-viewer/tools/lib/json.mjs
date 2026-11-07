// JSON lisible : les tableaux courts de nombres restent sur une ligne ([x, y, z]).
export function prettyJson(obj) {
  return JSON.stringify(obj, null, 2).replace(/\[\s+([-\d.,\s]+?)\s+\]/g, (_, inner) => `[${inner.split(/,\s*/).join(', ')}]`) + '\n';
}
