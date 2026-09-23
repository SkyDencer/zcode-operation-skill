/**
 * Synonym map builder.
 *
 * Builds a synonym map from three sources:
 * 1. Curated synonyms (data/synonyms-curated.json)
 * 2. Co-occurring keywords extracted from skill manifests
 * 3. Abbreviation pairs inferred from skill name patterns
 *
 * The result is a Map where each key is a query token and its value is an
 * array of expanded synonym tokens.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { tokenize } from '../../scorer.mjs';

/**
 * Build a synonym map from the corpus and curated list.
 *
 * @param {Array<{name:string, description:string, keywords:string[]}>} skills
 * @returns {Map<string, string[]>}
 */
export function buildSynonymMap(skills) {
  const synonymMap = new Map();

  // ── Source 1: curated synonyms ─────────────────────────────────────────────
  const curatedPath = resolve('data/synonyms-curated.json');
  if (existsSync(curatedPath)) {
    try {
      const raw = readFileSync(curatedPath, 'utf-8');
      const data = JSON.parse(raw);
      if (data.synonyms && typeof data.synonyms === 'object') {
        for (const [key, variants] of Object.entries(data.synonyms)) {
          if (!Array.isArray(variants)) continue;
          const keyTokens = tokenize(key);
          const variantTokens = variants.flatMap((v) => tokenize(v));
          for (const kt of keyTokens) {
            const existing = synonymMap.get(kt);
            synonymMap.set(kt, existing
              ? [...new Set([...existing, ...variantTokens])]
              : variantTokens
            );
          }
          // Also map each variant back to key tokens (bidirectional)
          for (const vt of variantTokens) {
            const existing = synonymMap.get(vt);
            synonymMap.set(vt, existing
              ? [...new Set([...existing, ...keyTokens])]
              : keyTokens
            );
          }
        }
      }
    } catch {
      // Malformed curated file — skip
    }
  }

  // ── Source 2: co-occurring keywords ────────────────────────────────────────
  // Build a term → skills map from all skill text content
  const termToDocs = new Map();
  for (const skill of skills) {
    const text = `${skill.name} ${skill.description} ${skill.keywords.join(' ')}`;
    const tokens = tokenize(text);
    const uniqueTokens = [...new Set(tokens)];
    for (const token of uniqueTokens) {
      const existing = termToDocs.get(token) || [];
      existing.push(skill.name);
      termToDocs.set(token, existing);
    }
  }

  // For each term, find co-occurring terms (appearing in same skill)
  const cooccurCount = new Map();
  for (const [term, docIds] of termToDocs) {
    const coTerms = new Set();
    for (const docId of docIds) {
      for (const [otherTerm, otherDocs] of termToDocs) {
        if (otherTerm === term) continue;
        if (otherDocs.includes(docId)) {
          coTerms.add(otherTerm);
        }
      }
    }
    for (const coTerm of coTerms) {
      const weight = docIds.filter((d) => termToDocs.get(coTerm)?.includes(d)).length;
      const key = `${term}::${coTerm}`;
      cooccurCount.set(key, (cooccurCount.get(key) || 0) + weight);
    }
  }

  // Add co-occurring terms as synonyms if they appear together in ≥2 skills
  for (const [key, weight] of cooccurCount) {
    if (weight < 2) continue;
    const [term, coTerm] = key.split('::');
    const existing = synonymMap.get(term);
    const currentSet = existing ? new Set(existing) : new Set();
    // Avoid adding terms that are already explicitly in the synonym list
    if (!currentSet.has(coTerm)) {
      currentSet.add(coTerm);
      synonymMap.set(term, [...currentSet]);
    }
  }

  // ── Source 3: abbreviation pairs from skill names ─────────────────────────
  // Look for patterns like "nextjs" → "next", "reactjs" → "react", etc.
  const abbrPatterns = [
    [/nextjs/i, ['next', 'nextjs']],
    [/reactjs/i, ['react', 'reactjs']],
    [/graphql/i, ['graphql', 'graph query']],
    [/websocket/i, ['websocket', 'web socket']],
    [/openid/i, ['openid', 'oidc']],
    [/jwt/i, ['jwt', 'json web token']],
    [/ssa/i, ['ssa', 'server side authentication']],
    [/spa/i, ['spa', 'single page application']],
    [/cli/i, ['cli', 'command line interface']],
    [/api/i, ['api', 'application programming interface']],
    [/ui/i, ['ui', 'user interface']],
    [/css/i, ['css', 'cascading style sheets']],
    [/html/i, ['html', 'hypertext markup language']],
    [/json/i, ['json', 'javascript object notation']],
    [/ts/i, ['ts', 'typescript']],
    [/ci/i, ['ci', 'continuous integration']],
    [/cd/i, ['cd', 'continuous deployment']],
  ];

  for (const [regex, variants] of abbrPatterns) {
    const match = regex.exec(variants[0]);
    if (match) {
      const token = variants[0];
      const existing = synonymMap.get(token);
      const otherVariants = variants.slice(1).flatMap((v) => tokenize(v));
      if (otherVariants.length > 0) {
        const currentSet = existing ? new Set(existing) : new Set();
        for (const v of otherVariants) {
          if (!currentSet.has(v)) currentSet.add(v);
        }
        synonymMap.set(token, [...currentSet]);
      }
    }
  }

  return synonymMap;
}
