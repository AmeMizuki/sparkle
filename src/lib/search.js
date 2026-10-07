function near(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0,
    j = 0,
    differences = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++differences > 1) return false;
    if (a.length <= b.length) j++;
    if (a.length >= b.length) i++;
  }
  return differences + Number(i < a.length || j < b.length) <= 1;
}
export function matchesSearch(image, query) {
  const text = `${image.name} ${image.artist} ${image.date} ${image.source}`
    .normalize("NFKC")
    .toLocaleLowerCase();
  const terms = query
    .normalize("NFKC")
    .toLocaleLowerCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const words = text.split(/[^\p{L}\p{N}-]+/u);
  return terms.every(
    (term) =>
      text.includes(term) ||
      (term.length > 2 && words.some((word) => near(term, word))),
  );
}
