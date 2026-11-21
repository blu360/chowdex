/**
 * Phone photos are several MB. Shrink them before they are stored or uploaded: 1280 px on the long
 * edge at JPEG quality 0.82 is usually 150 to 300 KB and still looks good on a phone.
 * Returns the original file if it is not an image, cannot be decoded, or would not get smaller.
 * @param {File|null} file
 * @returns {Promise<File|null>}
 */
export async function shrinkPhoto(file, maxEdge = 1280, quality = 0.82) {
  if (!file || !file.type?.startsWith('image/')) return file;
  try {
    const bitmap = await createImageBitmap(file); // also applies the phone's rotation
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], `${file.name.replace(/\.[^.]+$/, '')}.jpg`, { type: 'image/jpeg' });
  } catch {
    return file;
  }
}
