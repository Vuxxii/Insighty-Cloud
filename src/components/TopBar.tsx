import { useEffect, useRef, useState } from 'react';
import type { Project } from '../db/types';
import { useApp } from '../state/app';
import { StorageStatus } from './StorageStatus';
import { SyncStatus } from './SyncStatus';
import { ProjectDialog } from './ProjectDialog';
import { ImportDialog } from './ImportDialog';
import { VerifyDialog } from './VerifyDialog';
import { fsAccessSupported } from '../backup/autoBackup';
import { isCloudConfigured } from '../cloud/supabase';
import { lock, signOut } from '../cloud/auth';

export function TopBar({ onPrint }: { onPrint: () => void }) {
  const app = useApp();
  const [projectDialog, setProjectDialog] = useState<null | { existing: Project | null }>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuOpen]);

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-name">Insightyyy</span>
        <span className="brand-stamp" title="Maker's mark">
          HAKAMI
        </span>
        <StorageStatus />
        {app.cloudActive && <SyncStatus onAccountClick={() => setMenuOpen(true)} />}
      </div>

      <div className="topbar-spacer" />

      <div className="project-select">
        <select
          value={app.activeProject?.id ?? ''}
          onChange={(e) => {
            if (e.target.value === '__new__') setProjectDialog({ existing: null });
            else app.selectProject(e.target.value);
          }}
          aria-label="Active project"
        >
          {app.activeProjects.length === 0 && <option value="">No projects</option>}
          {app.activeProjects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.prefix})
            </option>
          ))}
          {app.activeProject?.archived_at && (
            <option value={app.activeProject.id}>
              {app.activeProject.name} ({app.activeProject.prefix}) — archived
            </option>
          )}
          <option value="__new__">＋ New project…</option>
        </select>

        <div style={{ position: 'relative' }} ref={menuRef}>
          <button type="button" className="btn" onClick={() => setMenuOpen((v) => !v)} aria-label="Project menu">
            ⋯
          </button>
          {menuOpen && (
            <div
              className="source-history"
              style={{ right: 0, left: 'auto', minWidth: 260, top: 'calc(100% + 6px)' }}
            >
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
                  {app.meta?.backup_dir_handle
                    ? 'Change backup folder…'
                    : 'Remember a backup folder…'}
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
              {app.archivedProjects.length > 0 && (
                <>
                  <div className="muted" style={{ padding: '6px 12px' }}>
                    Archived (still resolvable via prefix)
                  </div>
                  {app.archivedProjects.map((p) => (
                    <button
                      type="button"
                      key={p.id}
                      onClick={() => {
                        setMenuOpen(false);
                        setProjectDialog({ existing: p });
                      }}
                    >
                      {p.name} ({p.prefix})
                    </button>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {projectDialog && (
        <ProjectDialog existing={projectDialog.existing} onClose={() => setProjectDialog(null)} />
      )}
      {importOpen && <ImportDialog onClose={() => setImportOpen(false)} />}
      {verifyOpen && <VerifyDialog onClose={() => setVerifyOpen(false)} />}
    </header>
  );
}
