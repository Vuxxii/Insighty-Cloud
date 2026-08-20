import { useCallback, useEffect, useRef, useState } from 'react';
import { AppProvider, useApp } from './state/app';
import { TopBar } from './components/TopBar';
import { CommandBar } from './components/CommandBar';
import { Feed } from './components/Feed';
import {
  CaptureZone,
  CAPTURE_FILES_EVENT,
  CAPTURE_SUBMIT_EVENT,
  CAPTURE_TEXT_EVENT,
} from './components/CaptureZone';
import { Banners, ErrorSurface, ShortcutOverlay } from './components/Overlays';
import { listInsights } from './db/insights';
import { printProject } from './pdf/print';
import { consumeShareIntake } from './pwa/shareIntake';
import { AuthPage } from './components/AuthPage';
import { isCloudConfigured } from './cloud/supabase';
import { restoreSession } from './cloud/auth';
import { startSyncLoop, stopSyncLoop } from './cloud/sync';

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return (
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT' ||
    el.isContentEditable
  );
}

function AppShell() {
  const app = useApp();
  const commandBarRef = useRef<HTMLInputElement>(null);
  const printRootRef = useRef<HTMLDivElement>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [printProgress, setPrintProgress] = useState<[number, number] | null>(null);

  const startPrint = useCallback(async () => {
    if (!app.activeProject || !printRootRef.current) return;
    // Soft-deleted and purged insights are excluded from PDF export by default (§3.D).
    const insights = (await listInsights(app.activeProject.id)).sort(
      (a, b) => a.ref_id - b.ref_id,
    );
    setPrintProgress([0, insights.length]);
    try {
      await printProject(app.activeProject, insights, printRootRef.current, (done, total) =>
        setPrintProgress([done, total]),
      );
    } finally {
      setPrintProgress(null);
    }
  }, [app.activeProject]);

  // Global keyboard model (PRD §5.1).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        void app.exportActiveProject();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        void startPrint();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        // The ONLY Ctrl+Enter handler (CaptureZone has none, to prevent double-submit).
        e.preventDefault();
        window.dispatchEvent(new CustomEvent(CAPTURE_SUBMIT_EVENT));
        return;
      }
      if (e.key === 'Escape') {
        app.clearQuery();
        if (commandBarRef.current === document.activeElement) commandBarRef.current?.blur();
        if (!app.isMobile) app.focusCapture();
        return;
      }
      if (isTypingTarget(e.target)) return;
      if (e.key === '/') {
        e.preventDefault();
        commandBarRef.current?.focus();
        commandBarRef.current?.select();
      } else if (e.key === '?') {
        e.preventDefault();
        setShortcutsOpen((v) => !v);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [app, startPrint]);

  // Global paste routing (PRD §5.1): an image paste ALWAYS goes to the Capture Zone,
  // regardless of focus. Plain text goes to the focused input, else the Capture Zone.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const imageFiles: File[] = [];
      for (const item of items) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) imageFiles.push(file);
        }
      }
      if (imageFiles.length > 0) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent(CAPTURE_FILES_EVENT, { detail: imageFiles }));
        if (!app.isMobile) app.focusCapture();
        return;
      }
      if (!isTypingTarget(document.activeElement)) {
        const text = e.clipboardData?.getData('text/plain');
        if (text) {
          e.preventDefault();
          window.dispatchEvent(new CustomEvent(CAPTURE_TEXT_EVENT, { detail: text }));
        }
      }
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [app]);

  // Android share_target intake (PRD §3.A.2): shared screenshots/text land in the
  // Capture Zone with the last-pinned source pre-filled by the zone itself.
  useEffect(() => {
    if (!app.ready) return;
    void consumeShareIntake(
      (files) => window.dispatchEvent(new CustomEvent(CAPTURE_FILES_EVENT, { detail: files })),
      (text) => window.dispatchEvent(new CustomEvent(CAPTURE_TEXT_EVENT, { detail: text })),
    ).then((consumed) => {
      if (consumed && window.location.search.includes('share-target')) {
        history.replaceState(null, '', '/');
      }
    });
  }, [app.ready]);

  return (
    <>
      <div className="app">
        <TopBar onPrint={() => void startPrint()} />
        <ErrorSurface />
        <Banners />
        <div className="app-body">
          <main className="feed-pane">
            <CommandBar ref={commandBarRef} />
            <Feed />
          </main>
          <aside className="capture-pane">
            <CaptureZone />
          </aside>
        </div>
        {shortcutsOpen && <ShortcutOverlay onClose={() => setShortcutsOpen(false)} />}
        {printProgress && printProgress[0] < printProgress[1] && (
          <div className="print-progress">
            Preparing PDF view… {printProgress[0]}/{printProgress[1]}
          </div>
        )}
      </div>
      {/* Print container MUST be a sibling of .app: @media print hides .app entirely,
          and a display:none ancestor would blank every printed page. */}
      <div className="print-root" ref={printRootRef} />
    </>
  );
}

const OFFLINE_PREF_KEY = 'insightyyy.ui.offlineMode'; // UI preference only, never data

type GateState =
  | { kind: 'loading' }
  | { kind: 'auth'; mode?: 'unlock'; lockedEmail?: string }
  | { kind: 'app'; cloudActive: boolean };

/** When Supabase is configured, the credentials page gates the app; the vault key
 * lives only in memory, so a reload lands on the unlock screen. Local-only mode
 * stays available and is exactly the v1 behaviour. */
function AuthGate() {
  const [gate, setGate] = useState<GateState>({ kind: 'loading' });

  useEffect(() => {
    (async () => {
      if (!isCloudConfigured() || localStorage.getItem(OFFLINE_PREF_KEY) === '1') {
        setGate({ kind: 'app', cloudActive: false });
        return;
      }
      const session = await restoreSession().catch(() => null);
      if (session) {
        setGate({ kind: 'auth', mode: 'unlock', lockedEmail: session.email });
      } else {
        setGate({ kind: 'auth' });
      }
    })();
  }, []);

  useEffect(() => {
    if (gate.kind === 'app' && gate.cloudActive) {
      startSyncLoop();
      return () => stopSyncLoop();
    }
  }, [gate]);

  if (gate.kind === 'loading') return null;
  if (gate.kind === 'auth') {
    return (
      <AuthPage
        initialMode={gate.mode}
        lockedEmail={gate.lockedEmail}
        onAuthed={() => setGate({ kind: 'app', cloudActive: true })}
        onUseOffline={() => {
          localStorage.setItem(OFFLINE_PREF_KEY, '1');
          setGate({ kind: 'app', cloudActive: false });
        }}
      />
    );
  }
  return (
    <AppProvider cloudActive={gate.cloudActive}>
      <AppShell />
    </AppProvider>
  );
}

export default function App() {
  return <AuthGate />;
}
