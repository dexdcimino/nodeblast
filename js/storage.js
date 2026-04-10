// ══════════════════════════════════════
//  NodeBlast — STORAGE
//  Thumbnail upload / delete / compression
// ══════════════════════════════════════

import { app } from './firebase-config.js';
import {
  getStorage,
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
  deleteObject,
} from "https://www.gstatic.com/firebasejs/11.4.0/firebase-storage.js";

const storage = getStorage(app);

const MAX_W = 800;
const MAX_H = 600;
const JPEG_QUALITY = 0.8;
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

export async function compressImage(file) {
  const img = await loadImage(file);
  let w = img.naturalWidth, h = img.naturalHeight;
  const rW = MAX_W / w, rH = MAX_H / h;
  const r = Math.min(1, rW, rH);
  w = Math.round(w * r); h = Math.round(h * r);

  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error('canvas.toBlob failed')),
      'image/jpeg',
      JPEG_QUALITY,
    );
  });
}

export async function uploadCatalystThumb(userId, catalystId, file) {
  const blob = await compressImage(file);
  if (blob.size > MAX_BYTES) {
    throw new Error('Image too large. Max 5MB.');
  }
  const path = `catalysts/${userId}/${catalystId}/thumb.jpg`;
  const ref = storageRef(storage, path);
  await uploadBytes(ref, blob, { contentType: 'image/jpeg' });
  return await getDownloadURL(ref);
}

export async function deleteCatalystThumb(userId, catalystId) {
  const path = `catalysts/${userId}/${catalystId}/thumb.jpg`;
  try {
    await deleteObject(storageRef(storage, path));
  } catch (err) {
    if (err?.code !== 'storage/object-not-found') {
      console.warn('[storage] deleteCatalystThumb failed:', err);
    }
  }
}
