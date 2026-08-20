/** Reads the share_target payload the service worker stashed (PRD §3.A.2) and
 * hands it to the Capture Zone. Returns true if anything was consumed. */
export async function consumeShareIntake(
  onFiles: (files: File[]) => void,
  onText: (text: string) => void,
): Promise<boolean> {
  if (!('caches' in window)) return false;
  try {
    const cache = await caches.open('insightyyy-share-intake');
    const requests = await cache.keys();
    if (requests.length === 0) return false;
    const files: File[] = [];
    let text = '';
    for (const request of requests) {
      const response = await cache.match(request);
      if (!response) continue;
      const path = new URL(request.url).pathname;
      if (path.startsWith('/__share__/file-')) {
        const blob = await response.blob();
        files.push(new File([blob], 'shared-image', { type: blob.type }));
      } else if (path.startsWith('/__share__/text-')) {
        text += (text ? '\n' : '') + (await response.text());
      }
      await cache.delete(request);
    }
    if (files.length) onFiles(files);
    if (text) onText(text);
    return files.length > 0 || text.length > 0;
  } catch {
    return false;
  }
}
