import { useEffect, useRef, useState } from 'react';
import type { Project } from '../db/types';
import { useApp } from '../state/app';
import { ProjectDialog } from './ProjectDialog';
import { ImportDialog } from './ImportDialog';
import { VerifyDialog } from './VerifyDialog';
import { fsAccessSupported } from '../backup/autoBackup';
import { isCloudConfigured } from '../cloud/supabase';
import { lock, signOut } from '../cloud/auth';
import { onSyncState, syncNow, type SyncState } from '../cloud/sync';
import { atRiskMessage } from '../storage/durability';
import { tagColor } from '../ui/tagColor';

/** One quiet chip for storage + sync (approved mock B). The explanation lives in a
 * styled popover: instant on hover/focus for desktops, toggled by tap for phones
 * (native `title` tooltips are slow and don't exist on touch). */
function StatusChip() {
  const app = useApp();
  const [sync, setSync] = useState<SyncState | null>(null);
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => (app.cloudActive ? onSyncState(setSync) : undefined), [app.cloudActive]);

  useEffect(() => {
    if (!pinned) return;
    const close = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) {
        setPinned(false);
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [pinned]);

  const storageWord =
    app.persistState === 'protected' ? 'Protected' : app.persistState === 'at-risk' ? 'At risk' : 'Storage';
  const syncWord = !app.cloudActive
    ? null
    : sync?.phase === 'syncing'
      ? 'Syncing…'
      : sync?.phase === 'offline'
        ? 'Offline'
        : sync?.phase === 'error'
          ? 'Sync error'
          : sync && sync.pendingPush > 0
            ? `${sync.pendingPush} pending`
            : 'Synced';
  const healthy =
    app.persistState === 'protected' &&
    (!app.cloudActive || (sync?.phase === 'idle' && sync.pendingPush === 0));
  const atRisk = app.persistState === 'at-risk';
  const storageLine = atRisk
    ? atRiskMessage()
    : 'Persistent storage granted — the browser will not evict your library.';
  const syncLine = !app.cloudActive ? null : (sync?.detail ?? 'End-to-end encrypted sync.');
  const quotaLine =
    app.quota && app.quota.quota > 0 ? `Storage used: ${Math.round(app.quota.ratio * 100)}%` : null;

  return (
    <div
      className="menu-anchor"
      ref={wrapRef}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => {
        if (!pinned) setOpen(false);
      }}
    >
      <button
        type="button"
        className={`storage-status ${healthy ? 'protected' : atRisk || sync?.phase === 'error' ? 'at-risk' : 'unknown'}`}
        aria-expanded={open}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          if (!pinned) setOpen(false);
        }}
        onClick={() => {
          const next = !pinned;
          setPinned(next);
          setOpen(next);
        }}
      >
        <span className="dot" />
        {storageWord}
        {syncWord ? ` · ${syncWord}` : ''}
      </button>
      {open && (
        <div className="status-pop">
          <p className={atRisk ? 'warn' : undefined}>{storageLine}</p>
          {syncLine && <p>{syncLine}</p>}
          {quotaLine && <p>{quotaLine}</p>}
          {app.cloudActive && (
            <button type="button" className="btn" onClick={() => void syncNow()}>
              Sync now
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function TopBar({ onPrint }: { onPrint: () => void }) {
  const app = useApp();
  const [projectDialog, setProjectDialog] = useState<null | { existing: Project | null }>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const switcherRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen && !switcherOpen) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
      if (!switcherRef.current?.contains(e.target as Node)) setSwitcherOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuOpen, switcherOpen]);

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-name">Insightyyy</span>
        <span className="brand-stamp" title="A H.H. Hakami product">
          H.H. HAKAMI
        </span>
      </div>

      <div className="topbar-spacer" />

      <StatusChip />

      {app.view === 'project' && app.activeProject && (
        <div className="menu-anchor" ref={switcherRef}>
          <button type="button" className="proj-pill" onClick={() => setSwitcherOpen((v) => !v)}>
            <span className="dotp" style={{ background: tagColor(app.activeProject.id) }}>
              {app.activeProject.prefix.slice(0, 3)}
            </span>
            <span className="proj-name">{app.activeProject.name}</span>
            <span className="chev">▾</span>
          </button>
          {switcherOpen && (
            <div className="source-history switcher">
              {app.activeProjects.map((p) => (
                <button
                  type="button"
                  key={p.id}
                  onClick={() => {
                    setSwitcherOpen(false);
                    app.openProject(p.id);
                  }}
                >
                  <span className="dotp sm" style={{ background: tagColor(p.id) }}>
                    {p.prefix.slice(0, 3)}
                  </span>
                  {p.name}
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  setSwitcherOpen(false);
                  setProjectDialog({ existing: null });
                }}
              >
                ＋ New project…
              </button>
            </div>
          )}
        </div>
      )}

      {app.view === 'project' && (
        <button type="button" className="iconbtn" title="All projects" onClick={app.goHome}>
          ▦
        </button>
      )}

      <div className="menu-anchor" ref={menuRef}>
        <button
          type="button"
          className="iconbtn"
          onClick={() => setMenuOpen((v) => !v)}
          aria-label="Project menu"
          title="Menu"
        >
          ⋯
        </button>
        {menuOpen && (
          <div className="source-history menu-pop">
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                void app.exportActiveProject();
              }}
              disabled={!app.activeProject}
            >
              Export project (Ctrl+E)
            </button>
            {fsAccessSupported() && (
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  void app.rememberBackupDir();
                }}
              >
                {app.meta?.backup_dir_handle ? 'Change backup folder…' : 'Remember a backup folder…'}
              </button>
            )}
            <button type="button" onClick={() => (setMenuOpen(false), setImportOpen(true))}>
              Import project…
            </button>
            <button
              type="button"
              onClick={() => (setMenuOpen(false), onPrint())}
              disabled={!app.activeProject}
            >
              PDF via print (Ctrl+P)
            </button>
            <button
              type="button"
              onClick={() => (setMenuOpen(false), setVerifyOpen(true))}
              disabled={!app.activeProject}
            >
              Verify Library
            </button>
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                if (app.activeProject) setProjectDialog({ existing: app.activeProject });
              }}
              disabled={!app.activeProject}
            >
              Project settings…
            </button>
            {app.cloudActive && (
              <>
                <div className="muted" style={{ padding: '6px 12px' }}>
                  Account (end-to-end encrypted)
                </div>
                <button
                  type="button"
                  onClick={() => {
                    lock();
                    window.location.reload();
                  }}
                >
                  Lock vault
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void signOut().finally(() => window.location.reload());
                  }}
                >
                  Sign out
                </button>
              </>
            )}
            {!app.cloudActive && isCloudConfigured() && (
              <button
                type="button"
                onClick={() => {
                  localStorage.removeItem('insightyyy.ui.offlineMode');
                  window.location.reload();
                }}
              >
                Sign in / enable sync…
              </button>
            )}
          </div>
        )}
      </div>

      {projectDialog && (
        <ProjectDialog existing={projectDialog.existing} onClose={() => setProjectDialog(null)} />
      )}
      {importOpen && <ImportDialog onClose={() => setImportOpen(false)} />}
      {verifyOpen && <VerifyDialog onClose={() => setVerifyOpen(false)} />}
    </header>
  );
}
