export async function imageFromUrl(value, signal) {
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("invalidImageUrl");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
    throw new Error("invalidImageUrl");
  let response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(30000)]),
      credentials: "omit",
      referrerPolicy: "no-referrer",
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    if (!blob.type.startsWith("image/")) throw new Error("notImageUrl");
    let name = url.pathname.split("/").pop() || "image";
    try { name = decodeURIComponent(name); } catch { /* Keep the encoded filename. */ }
    return new File([blob], name.replace(/[\\/]/g, "_"), { type: blob.type });
  } catch (error) {
    if (signal?.aborted) throw error;
    if (error.message === "notImageUrl") throw error;
    throw new Error("imageUrlFailed");
  }
}
