// Lightweight rapidfuzz-equivalent: ratio + token-sort-ratio, take max.
// For grocery names this is plenty accurate at threshold 88. If fuzzy quality
// becomes a problem, reach for a real WRatio implementation.

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

export function ratio(a, b) {
  if (!a && !b) return 100;
  if (!a || !b) return 0;
  const maxLen = Math.max(a.length, b.length);
  return Math.round((1 - levenshtein(a, b) / maxLen) * 100);
}

export function tokenSortRatio(a, b) {
  const norm = (s) =>
    s.toLowerCase().split(/\s+/).filter(Boolean).sort().join(" ");
  return ratio(norm(a), norm(b));
}

export function fuzzyScore(a, b) {
  return Math.max(ratio(a, b), tokenSortRatio(a, b));
}

// Returns { key, score } for the best match >= threshold, or null.
export function findBest(query, keys, threshold = 88) {
  const q = query.trim().toLowerCase();
  let best = null;
  for (const k of keys) {
    const score = fuzzyScore(q, String(k).toLowerCase());
    if (score >= threshold && (!best || score > best.score)) {
      best = { key: k, score };
    }
  }
  return best;
}
