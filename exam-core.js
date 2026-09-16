// A to Z Exam Mocks — Spark-plan image helpers.
// No Firebase Storage, no Firebase Auth, and no Blaze/paid billing required.
// Images are compressed in-browser and stored as small data URLs in Firestore.

const MAX_IMAGE_CHARS = 360000; // roughly <=270 KB decoded image data
const MAX_TOTAL_IMAGE_CHARS = 760000; // conservative total image budget per document

function isDataImage(value) {
  return typeof value === 'string' && /^data:image\//i.test(value);
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not decode image.'));
    img.src = dataUrl;
  });
}

function encodeJpeg(img, width, height, quality) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', quality);
}

async function compressImage(dataUrl, maxChars = MAX_IMAGE_CHARS) {
  if (!isDataImage(dataUrl)) return dataUrl || '';
  const img = await loadImage(dataUrl);
  const originalW = img.naturalWidth || img.width;
  const originalH = img.naturalHeight || img.height;
  const initialScale = Math.min(1, 1800 / Math.max(originalW, originalH));
  let width = originalW * initialScale;
  let height = originalH * initialScale;
  let quality = 0.78;
  let result = encodeJpeg(img, width, height, quality);

  for (let pass = 0; pass < 12 && result.length > maxChars; pass++) {
    if (quality > 0.48) quality -= 0.06;
    else { width *= 0.82; height *= 0.82; quality = 0.68; }
    result = encodeJpeg(img, width, height, quality);
  }

  if (result.length > maxChars) {
    throw new Error('Image is too large for the free Firestore plan. Please use a smaller crop.');
  }
  return result;
}

async function externalize(data) {
  if (!data || typeof data !== 'object') return data;
  const copy = { ...data };

  if (isDataImage(copy.question)) copy.question = await compressImage(copy.question);
  if (isDataImage(copy.solution)) copy.solution = await compressImage(copy.solution);
  if (Array.isArray(copy.questionParts)) copy.questionParts = await Promise.all(copy.questionParts.map(x => compressImage(x)));
  if (Array.isArray(copy.solutionParts)) copy.solutionParts = await Promise.all(copy.solutionParts.map(x => compressImage(x)));

  let imageChars = 0;
  for (const key of ['question', 'solution']) if (isDataImage(copy[key])) imageChars += copy[key].length;
  for (const key of ['questionParts', 'solutionParts']) {
    if (Array.isArray(copy[key])) for (const value of copy[key]) if (isDataImage(value)) imageChars += value.length;
  }
  if (imageChars > MAX_TOTAL_IMAGE_CHARS) {
    throw new Error('Question + solution images are too large for one Firestore document. Reduce the crop size.');
  }

  return copy;
}

window.AtoZCore = { externalize, compressImage, MAX_IMAGE_CHARS, MAX_TOTAL_IMAGE_CHARS };
