// مولّد أرقام عشوائية حتمي (mulberry32): نفس البذرة = نفس العالم.
// هذا شرط أساسي لعدالة التقييم وقابلية إعادة إنتاج النتائج.
export function createRng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    chance: (p) => next() < p,
    pickWeighted(items, weightOf = (x) => x.weight ?? 1) {
      const total = items.reduce((s, x) => s + weightOf(x), 0);
      if (total <= 0) return null;
      let r = next() * total;
      for (const item of items) {
        r -= weightOf(item);
        if (r < 0) return item;
      }
      return items[items.length - 1];
    },
  };
}
