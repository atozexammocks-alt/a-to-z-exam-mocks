// Shared A to Z Exam Mocks core helpers.
// Keeps Firestore documents small by moving data-URL images to Firebase Storage.
import { getApp } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js';
import { getAuth, signInAnonymously } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
import { getStorage, ref, uploadString, getDownloadURL } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js';

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
function isDataImage(value) { return typeof value === 'string' && /^data:image\//i.test(value); }
async function uploadDataUrl(dataUrl, folder = 'question-images') {
  if (!isDataImage(dataUrl)) return dataUrl || '';
  const base64 = dataUrl.split(',')[1] || '';
  const bytes = Math.ceil((base64.length * 3) / 4);
  if (bytes > MAX_IMAGE_BYTES) throw new Error(`Image is larger than ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`);
  const storage = getStorage(getApp());
  const id = `${Date.now()}-${crypto.randomUUID()}.png`;
  const storageRef = ref(storage, `${folder}/${id}`);
  await uploadString(storageRef, dataUrl, 'data_url', { contentType: 'image/png', cacheControl: 'public,max-age=31536000,immutable' });
  return getDownloadURL(storageRef);
}
async function externalize(data) {
  if (!data || typeof data !== 'object') return data;
  const copy = { ...data };
  if (isDataImage(copy.question)) copy.question = await uploadDataUrl(copy.question, 'question-images');
  if (isDataImage(copy.solution)) copy.solution = await uploadDataUrl(copy.solution, 'solution-images');
  if (Array.isArray(copy.questionParts)) copy.questionParts = await Promise.all(copy.questionParts.map(x => uploadDataUrl(x, 'question-images')));
  if (Array.isArray(copy.solutionParts)) copy.solutionParts = await Promise.all(copy.solutionParts.map(x => uploadDataUrl(x, 'solution-images')));
  return copy;
}
async function ensureAnonymousAuth() {
  try { const auth = getAuth(getApp()); if (!auth.currentUser) await signInAnonymously(auth); window.atozFirebaseUser = auth.currentUser; }
  catch (e) { console.warn('Anonymous Firebase Auth unavailable:', e.message); }
}
window.AtoZCore = { uploadDataUrl, externalize };
ensureAnonymousAuth();
