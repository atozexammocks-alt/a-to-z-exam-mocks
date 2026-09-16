// Shared A to Z Exam Mocks core helpers.
// Moves data-URL images to Firebase Storage so Firestore documents stay small.
import { getApp } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js';
import { getAuth, signInAnonymously } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
import { getStorage, ref, uploadString, getDownloadURL } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js';

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
let authReady;
function isDataImage(value) { return typeof value === 'string' && /^data:image\//i.test(value); }
function mimeFromDataUrl(dataUrl) { const m = String(dataUrl).match(/^data:(image\/[a-z0-9.+-]+);base64,/i); return m ? m[1].toLowerCase() : 'image/jpeg'; }
async function ensureAnonymousAuth() {
  const auth = getAuth(getApp());
  if (!auth.currentUser) await signInAnonymously(auth);
  window.atozFirebaseUser = auth.currentUser;
  return auth.currentUser;
}
authReady = ensureAnonymousAuth().catch(e => { console.error(e); throw new Error('Firebase Anonymous Authentication is not enabled. Enable Authentication → Sign-in method → Anonymous in Firebase Console.'); });
async function uploadDataUrl(dataUrl, folder = 'question-images') {
  if (!isDataImage(dataUrl)) return dataUrl || '';
  await authReady;
  const base64 = dataUrl.split(',')[1] || '';
  const bytes = Math.floor(base64.length * 3 / 4);
  if (bytes > MAX_IMAGE_BYTES) throw new Error(`Image is larger than ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`);
  const storage = getStorage(getApp());
  const mime = mimeFromDataUrl(dataUrl);
  const ext = mime.split('/')[1].replace('jpeg','jpg');
  const id = `${Date.now()}-${crypto.randomUUID()}.${ext}`;
  const storageRef = ref(storage, `${folder}/${id}`);
  await uploadString(storageRef, dataUrl, 'data_url', { contentType: mime, cacheControl: 'public,max-age=31536000,immutable' });
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
window.AtoZCore = { uploadDataUrl, externalize, authReady };
