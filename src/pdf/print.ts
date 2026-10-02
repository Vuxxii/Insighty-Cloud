// Vite `?inline` turns the font into a base64 data URI baked into the bundle, so the
// print stylesheet embeds the Arabic-capable font with no network dependency (PRD §3.C).
import notoNaskhArabic from '@fontsource/noto-naskh-arabic/files/noto-naskh-arabic-arabic-400-normal.woff2?inline';
import type { Insight, Project } from '../db/types';

export const PRINT_CHUNK_SIZE = 50;

// rAF for smooth chunking while visible, raced against a timeout so the build
// still completes in a hidden/background tab where rAF never fires.
const raf: (cb: () => void) => void = (cb) => {
  let called = false;
  const once = () => {
    if (called) return;
    called = true;
    cb();
  };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(once);
  setTimeout(once, 40);
};

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  // User content goes through textContent ONLY — never innerHTML (invariant 6).
  if (text !== undefined) node.textContent = text;
  return node;
}

export function ensurePrintFontStyle(): void {
  if (document.getElementById('print-font-style')) return;
  const style = document.createElement('style');
  style.id = 'print-font-style';
  style.textContent = `@font-face {
  font-family: 'Noto Naskh Arabic';
  src: url(${JSON.stringify(String(notoNaskhArabic))}) format('woff2');
  font-weight: 400;
  font-style: normal;
}`;
  document.head.appendChild(style);
}

function renderPrintItem(project: Project, insight: Insight, objectUrls: string[]): HTMLElement {
  const item = el('div', 'print-item');
  item.dir = insight.direction; // stored direction drives print layout (PRD §3.A.1)
  item.appendChild(el('h2', undefined, `${project.prefix}-${insight.ref_id}`));
  if (insight.source_tag) {
    item.appendChild(el('p', 'print-source', insight.source_tag));
  }
  for (const block of insight.content) {
    switch (block.type) {
      case 'text': {
        const p = el('p', 'text-block', block.value);
        p.style.whiteSpace = 'pre-wrap';
        item.appendChild(p);
        break;
      }
      case 'image': {
        const img = document.createElement('img');
        const url = URL.createObjectURL(block.blob);
        objectUrls.push(url);
        img.src = url;
        img.alt = block.alt ?? '';
        item.appendChild(img);
        break;
      }
      case 'url': {
        const p = el('p', 'text-block');
        p.appendChild(el('span', undefined, block.title ? `${block.title} — ` : ''));
        p.appendChild(el('span', undefined, block.href));
        item.appendChild(p);
        break;
      }
      default:
        item.appendChild(
          el('div', 'unknown-block', `[Unsupported content block: ${String((block as { type?: string }).type)}]`),
        );
    }
  }
  return item;
}

export interface PrintHandle {
  cleanup: () => void;
}

/**
 * Build the print DOM progressively in chunks per animation frame (PRD §3.C) —
 * chunking refers to DOM construction, not multiple print jobs.
 */
export function buildPrintDom(
  project: Project,
  insights: Insight[],
  container: HTMLElement,
  onProgress: (done: number, total: number) => void,
): Promise<PrintHandle> {
  ensurePrintFontStyle();
  container.replaceChildren();
  const objectUrls: string[] = [];
  // Trademark (approved): faint watermark + footer, repeating on every page via
  // print-time position:fixed.
  const wm = el('div', 'print-wm');
  wm.appendChild(el('span', undefined, 'Insightyyy'));
  container.appendChild(wm);
  container.appendChild(el('div', 'print-foot', 'INSIGHTYYY · A H.H. HAKAMI PRODUCT'));
  const header = el('div', 'print-item');
  header.appendChild(el('h2', undefined, `${project.name} (${project.prefix})`));
  header.appendChild(
    el('p', 'print-source', `Insightyyy export — ${insights.length} insights`),
  );
  container.appendChild(header);

  return new Promise((resolve) => {
    let index = 0;
    const step = () => {
      const end = Math.min(index + PRINT_CHUNK_SIZE, insights.length);
      for (; index < end; index++) {
        container.appendChild(renderPrintItem(project, insights[index], objectUrls));
      }
      onProgress(index, insights.length);
      if (index < insights.length) raf(step);
      else {
        resolve({
          cleanup: () => {
            for (const url of objectUrls) URL.revokeObjectURL(url);
            container.replaceChildren();
          },
        });
      }
    };
    raf(step);
  });
}

/** "Save as PDF" defaults its filename to document.title — stamp it with the project
 * name plus date, hour and minute for the duration of the print dialog. */
export function printTitle(projectName: string, date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${projectName} ${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}-${p(date.getMinutes())}`;
}

/** The print snapshot captures whatever is decoded at that instant — an image still
 * loading prints as a blank gap. Wait for every image (bounded, so a broken blob can
 * never hang the export). */
async function waitForImages(container: HTMLElement, timeoutMs = 15_000): Promise<void> {
  const images = Array.from(container.querySelectorAll('img'));
  await Promise.race([
    Promise.all(images.map((img) => img.decode().catch(() => undefined))),
    new Promise((r) => setTimeout(r, timeoutMs)),
  ]);
}

/** Full flow: chunked DOM build → wait for images to decode → window.print() →
 * cleanup after the dialog closes. */
export async function printProject(
  project: Project,
  insights: Insight[],
  container: HTMLElement,
  onProgress: (done: number, total: number) => void,
): Promise<void> {
  const handle = await buildPrintDom(project, insights, container, onProgress);
  await waitForImages(container);
  const originalTitle = document.title;
  const done = () => {
    window.removeEventListener('afterprint', done);
    document.title = originalTitle;
    handle.cleanup();
  };
  window.addEventListener('afterprint', done);
  document.title = printTitle(project.name);
  // One frame for final layout before opening the dialog.
  await new Promise<void>((r) => raf(() => r()));
  window.print();
}
