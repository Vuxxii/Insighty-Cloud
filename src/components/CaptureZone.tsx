import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '../state/app';
import type { Block, Direction, ImageBlock } from '../db/types';
import { processImage, UnsupportedImageError } from '../images/pipeline';
import { reportAppError } from '../ui/errorBus';
import { parseCaptureText } from '../text/captureParse';
import { SuccessRef } from './SuccessRef';

interface Attachment {
  block: ImageBlock;
  previewUrl: string;
}

interface UrlDraft {
  href: string;
  title: string;
}

/** Custom events used by the document-level paste router (PRD §5.1). */
export const CAPTURE_FILES_EVENT = 'insightyyy:capture-files';
export const CAPTURE_TEXT_EVENT = 'insightyyy:capture-text';
export const CAPTURE_SUBMIT_EVENT = 'insightyyy:capture-submit';

export function CaptureZone() {
  const app = useApp();
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [urls, setUrls] = useState<UrlDraft[]>([]);
  const [source, setSource] = useState('');
  const [pinned, setPinned] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [dirOverride, setDirOverride] = useState<Direction | 'auto'>('auto');
  const [dragover, setDragover] = useState(false);
  const [busy, setBusy] = useState(false);
  // Synchronous re-entrancy guard: `busy` state can't stop a second submit() call in
  // the same tick (state updates are batched), and a double capture burns a ref_id.
  const submittingRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const focusTextarea = useCallback(() => textareaRef.current?.focus(), []);

  useEffect(() => {
    app.registerCaptureFocus(focusTextarea);
    return () => app.registerCaptureFocus(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTextarea]);

  // Desktop default focus is the Capture Zone; NO autofocus on mobile (PRD §5.1).
  useEffect(() => {
    if (!app.isMobile) focusTextarea();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app.ready]);

  const addFiles = useCallback(async (files: File[] | Blob[]) => {
    for (const file of files) {
      try {
        const processed = await processImage(file);
        const block: ImageBlock = { type: 'image', ...processed };
        setAttachments((prev) => [
          ...prev,
          { block, previewUrl: URL.createObjectURL(block.blob) },
        ]);
      } catch (err) {
        reportAppError({
          title: 'Image not added',
          detail:
            err instanceof UnsupportedImageError
              ? err.message
              : `Could not process the image: ${String(err)}`,
          blocking: false,
        });
      }
    }
  }, []);

  // Intake from the global paste router.
  useEffect(() => {
    const onFiles = (e: Event) => {
      void addFiles((e as CustomEvent<File[]>).detail);
    };
    const onText = (e: Event) => {
      const value = (e as CustomEvent<string>).detail;
      setText((prev) => (prev ? `${prev}\n${value}` : value));
      focusTextarea();
    };
    const onSubmit = () => void submit();
    window.addEventListener(CAPTURE_FILES_EVENT, onFiles);
    window.addEventListener(CAPTURE_TEXT_EVENT, onText);
    window.addEventListener(CAPTURE_SUBMIT_EVENT, onSubmit);
    return () => {
      window.removeEventListener(CAPTURE_FILES_EVENT, onFiles);
      window.removeEventListener(CAPTURE_TEXT_EVENT, onText);
      window.removeEventListener(CAPTURE_SUBMIT_EVENT, onSubmit);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addFiles, text, attachments, urls, source, dirOverride, busy, app.activeProject]);

  const setAlt = (index: number, alt: string) => {
    setAttachments((prev) =>
      prev.map((a, i) => (i === index ? { ...a, block: { ...a.block, alt } } : a)),
    );
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => {
      URL.revokeObjectURL(prev[index]?.previewUrl ?? '');
      return prev.filter((_, i) => i !== index);
    });
  };

  const { links: parsedLinks, source: parsedSource } = parseCaptureText(text);
  const linkCount = parsedLinks.length;

  const canSubmit =
    !!app.activeProject &&
    !busy &&
    (text.trim().length > 0 || attachments.length > 0 || urls.some((u) => u.href.trim()));

  async function submit() {
    if (!canSubmit || submittingRef.current) return;
    submittingRef.current = true;
    setBusy(true);
    try {
      const content: Block[] = [];
      const parsed = parseCaptureText(text);
      // An @token overrides the source field, pins it, and persists for future
      // captures — until manual unlock or clearing the field (mirrors the pin toggle).
      const effectiveSource = parsed.source ?? source;
      const effectivePinned = pinned || parsed.source !== undefined;
      if (parsed.source !== undefined) {
        setSource(parsed.source);
        setPinned(true);
      }
      if (parsed.text) content.push({ type: 'text', value: parsed.text });
      for (const link of parsed.links) content.push({ type: 'url', ...link });
      for (const a of attachments) content.push(a.block);
      for (const u of urls) {
        if (u.href.trim()) {
          content.push({
            type: 'url',
            href: u.href.trim(),
            ...(u.title.trim() ? { title: u.title.trim() } : {}),
          });
        }
      }
      if (content.length === 0) {
        // "@token"-only submit: the source was set and pinned above — do not burn a
        // reference number on an empty insight.
        setText('');
        return;
      }
      await app.capture(content, effectiveSource, dirOverride);
      setText('');
      attachments.forEach((a) => URL.revokeObjectURL(a.previewUrl));
      setAttachments([]);
      setUrls([]);
      if (!effectivePinned) setSource('');
      if (!app.isMobile) focusTextarea();
    } catch {
      // guardWrite already surfaced the error visibly; keep the draft intact.
    } finally {
      submittingRef.current = false;
      setBusy(false);
    }
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragover(false);
    const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/') || f.name);
    if (files.length) void addFiles(files);
    const dropped = e.dataTransfer.getData('text/plain');
    if (dropped && files.length === 0) {
      setText((prev) => (prev ? `${prev}\n${dropped}` : dropped));
    }
  };

  if (!app.activeProject) {
    return (
      <div className="capture-zone" style={{ textAlign: 'center', padding: 30 }}>
        <p className="muted">Create a project to start capturing.</p>
      </div>
    );
  }

  // Ctrl+Enter is handled ONCE, by the app-level keydown handler, which dispatches
  // CAPTURE_SUBMIT_EVENT — a local handler here would double-submit.
  return (
    <div>
      <div
        className={`capture-zone${dragover ? ' dragover' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragover(true);
        }}
        onDragLeave={() => setDragover(false)}
        onDrop={onDrop}
      >
        <textarea
          ref={textareaRef}
          dir={dirOverride === 'auto' ? 'auto' : dirOverride}
          placeholder="Paste an image or screenshot (Ctrl+V), drop a file, or type an insight… // url adds a link · @word sets & pins the source"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        {(linkCount > 0 || parsedSource !== undefined) && (
          <div className="muted" aria-live="polite">
            {linkCount > 0 && (
              <>
                🔗 {linkCount} link{linkCount === 1 ? '' : 's'} detected — // lines are saved as
                link blocks{' '}
              </>
            )}
            {parsedSource !== undefined && <>📌 source will be set &amp; pinned: {parsedSource}</>}
          </div>
        )}
        {attachments.length > 0 && (
          <div className="capture-attachments">
            {attachments.map((a, i) => (
              <div className="attachment" key={a.previewUrl}>
                <img src={a.previewUrl} alt={a.block.alt ?? 'attached image'} />
                <button
                  type="button"
                  className="remove"
                  aria-label="Remove image"
                  onClick={() => removeAttachment(i)}
                >
                  ×
                </button>
                <input
                  className="alt-input"
                  placeholder="alt text (searchable)"
                  value={a.block.alt ?? ''}
                  onChange={(e) => setAlt(i, e.target.value)}
                />
              </div>
            ))}
          </div>
        )}
        {urls.map((u, i) => (
          <div className="capture-row" key={i}>
            <input
              className="grow"
              style={{
                background: 'var(--bg-raised)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                padding: '7px 10px',
              }}
              placeholder="https://…"
              value={u.href}
              onChange={(e) =>
                setUrls((prev) => prev.map((x, j) => (j === i ? { ...x, href: e.target.value } : x)))
              }
            />
            <input
              className="grow"
              style={{
                background: 'var(--bg-raised)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                padding: '7px 10px',
              }}
              placeholder="Title (optional — typed by you, never fetched)"
              value={u.title}
              onChange={(e) =>
                setUrls((prev) => prev.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))
              }
            />
            <button
              type="button"
              className="btn btn-ghost"
              aria-label="Remove link"
              onClick={() => setUrls((prev) => prev.filter((_, j) => j !== i))}
            >
              ×
            </button>
          </div>
        ))}
      </div>

      <div className="capture-row">
        <div className="source-input grow">
          <input
            placeholder="Source (e.g. Q3 Report)"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            onFocus={() => setHistoryOpen(false)}
          />
          <button
            type="button"
            className={`pin${pinned ? ' pinned' : ''}`}
            title={pinned ? 'Source pinned — persists across captures' : 'Pin source for subsequent captures'}
            onClick={() => setPinned((v) => !v)}
          >
            {pinned ? '📌' : '📍'}
          </button>
          <button
            type="button"
            className="hist"
            title="Previously used sources"
            onClick={() => setHistoryOpen((v) => !v)}
            disabled={app.sourceTags.length === 0}
          >
            ▾
          </button>
          {historyOpen && app.sourceTags.length > 0 && (
            <div className="source-history" role="listbox">
              {app.sourceTags.map((tag) => (
                <button
                  type="button"
                  key={tag}
                  onClick={() => {
                    setSource(tag);
                    setHistoryOpen(false);
                  }}
                >
                  {tag}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="dir-toggle" title="Text direction">
          {(['auto', 'ltr', 'rtl'] as const).map((d) => (
            <button
              type="button"
              key={d}
              className={dirOverride === d ? 'on' : ''}
              onClick={() => setDirOverride(d)}
            >
              {d.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <div className="capture-row">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          hidden
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            if (files.length) void addFiles(files);
            e.target.value = '';
          }}
        />
        <button type="button" className="btn" onClick={() => fileInputRef.current?.click()}>
          📷 Camera / file
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => setUrls((prev) => [...prev, { href: '', title: '' }])}
        >
          🔗 Add link
        </button>
        <div className="grow" />
        {/* The upcoming ref is known BEFORE submission (local: seq+1; cloud: this
            device's reserved block) so it can be transcribed first. */}
        {app.nextRef !== null && app.activeProject && (
          <span
            className="card-ref"
            title="The reference number the next capture will receive — guaranteed, even offline."
            aria-label="Next reference number"
          >
            Next: {app.activeProject.prefix}-{app.nextRef}
          </span>
        )}
        {app.cloudActive && app.nextRef === null && app.activeProject && (
          <span className="muted" title="Connect once so this device can reserve numbers.">
            No reserved numbers — go online once
          </span>
        )}
        <button
          type="button"
          className="btn btn-primary"
          disabled={!canSubmit}
          onClick={() => void submit()}
          title="Ctrl+Enter"
        >
          {busy ? 'Saving…' : 'Capture'}
        </button>
      </div>

      <SuccessRef />
    </div>
  );
}
