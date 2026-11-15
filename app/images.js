// Shrinks a photo on the phone before it goes to the family server: a JPEG no longer than
// `max` px on its long edge, re-compressed until the data URL fits `maxChars` (the Worker
// counts the data URL's length; 1.5 MB is its limit, so stay a little under).

export const LIMITS = {
  pantry: { max: 1280, quality: 0.82, maxChars: 1_450_000 },
  // Receipt text is small: keep more pixels than a pantry shelf needs.
  receipt: { max: 1600, quality: 0.88, maxChars: 1_450_000 },
  receiptTotalChars: 4_400_000,
};

export async function resizeImage(file, { max = 1280, quality = 0.82, maxChars = 1_450_000 } = {}) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => reject(new Error('unreadable')); i.src = url; });
    let scale = Math.min(1, max / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
    for (let pass = 0; pass < 4; pass++) {
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; // screenshots with transparency read better on white
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      let q = quality;
      let data = c.toDataURL('image/jpeg', q);
      while (data.length > maxChars && q > 0.5) { q -= 0.08; data = c.toDataURL('image/jpeg', q); }
      if (data.length <= maxChars) return data;
      scale *= 0.8; // still too big: fewer pixels, then try again
    }
    throw new Error('too large');
  } finally {
    URL.revokeObjectURL(url);
  }
}
