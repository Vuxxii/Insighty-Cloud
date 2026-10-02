import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { db, getMeta } from '../db/db';
import type { Block, Direction, Insight, Meta, Project } from '../db/types';
import { createProject, findProjectsByPrefix, listProjects, renameProject, setArchived } from '../db/projects';
import {
  captureInsight,
  editInsight,
  listInsights,
  listSourceTags,
  purgeInsight,
  restoreInsight,
  softDeleteInsight,
} from '../db/insights';
import { resolveDirection } from '../text/direction';
import { routeQuery } from '../search/parser';
import {
  resolveIdQueryAcross,
  searchText,
  type IdQueryResult,
} from '../search/resolve';
import {
  checkPersistence,
  checkQuota,
  requestPersistence,
  type PersistState,
  type QuotaStatus,
} from '../storage/durability';
import { guardWrite, reportAppError } from '../ui/errorBus';
import { exportProject, markExported, triggerDownload } from '../backup/exporter';
import { chooseBackupDirectory, fsAccessSupported, oneClickExport, recordCaptureAndMaybeBackup } from '../backup/autoBackup';
import { ensureBlock, peekNextRef } from '../cloud/blocks';
import { onSyncState, syncNow } from '../cloud/sync';

export type FeedState =
  | { kind: 'default'; insights: Insight[] }
  | {
      kind: 'ids';
      /** Every match, labelled with its project (prefixes are reusable). */
      items: Array<{ insight: Insight; project: Project }>;
      byProject: Map<string, IdQueryResult>;
      projects: Project[];
      /** True when the query ran across every project, not just the active one. */
      scopeAll: boolean;
    }
  | { kind: 'text'; insights: Insight[]; query: string }
  | { kind: 'incomplete' };

export interface ProjectCard {
  project: Project;
  count: number;
  lastText: string | null;
  lastAt: string | null;
}

export interface LastCapture {
  insightId: string;
  prefixedRef: string;
  until: number;
}

export const QUICK_EDIT_WINDOW_MS = 5 * 60 * 1000;

interface AppState {
  ready: boolean;
  meta: Meta | null;
  activeProjects: Project[];
  archivedProjects: Project[];
  activeProject: Project | null;
  feed: FeedState;
  query: string;
  showDeleted: boolean;
  sourceTags: string[];
  lastCapture: LastCapture | null;
  persistState: PersistState;
  quota: QuotaStatus | null;
  backupStale: boolean;
  isMobile: boolean;
  /** Cloud mode active: signed in + vault unlocked; refs come from reserved blocks. */
  cloudActive: boolean;
  /** The ref number the NEXT capture will take — shown BEFORE submission. */
  nextRef: number | null;
  /** 'home' = projects grid; 'project' = the capture/feed screen. */
  view: 'home' | 'project';
  projectCards: ProjectCard[];
  /** When multi-project results are showing: null = all, else included project ids. */
  projectFilter: Set<string> | null;

  goHome: () => void;
  openProject: (id: string) => void;
  widenScope: () => void;
  setProjectFilter: (f: Set<string> | null) => void;
  setQuery: (q: string) => void;
  clearQuery: () => void;
  setShowDeleted: (v: boolean) => void;
  selectProject: (id: string) => void;
  addProject: (name: string, prefix: string) => Promise<Project>;
  updateProject: (id: string, patch: { name?: string; prefix?: string }) => Promise<void>;
  archiveProject: (id: string, archived: boolean) => Promise<void>;
  capture: (content: Block[], sourceTag: string, dirOverride: Direction | 'auto') => Promise<Insight>;
  saveEdit: (
    id: string,
    patch: Partial<Pick<Insight, 'source_tag' | 'content' | 'direction'>>,
  ) => Promise<void>;
  removeInsight: (id: string) => Promise<void>;
  unremoveInsight: (id: string) => Promise<void>;
  hardPurgeInsight: (id: string) => Promise<void>;
  exportActiveProject: () => Promise<void>;
  rememberBackupDir: () => Promise<boolean>;
  refresh: () => Promise<void>;
  registerCaptureFocus: (fn: (() => void) | null) => void;
  focusCapture: () => void;
}

const AppContext = createContext<AppState | null>(null);

export function useApp(): AppState {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp outside provider');
  return ctx;
}

const ACTIVE_PROJECT_KEY = 'insightyyy.ui.activeProject'; // UI preference only, never data

export function AppProvider({
  children,
  cloudActive = false,
}: {
  children: ReactNode;
  cloudActive?: boolean;
}) {
  const [ready, setReady] = useState(false);
  const [nextRef, setNextRef] = useState<number | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [activeProjects, setActiveProjects] = useState<Project[]>([]);
  const [archivedProjects, setArchivedProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [feed, setFeed] = useState<FeedState>({ kind: 'default', insights: [] });
  const [query, setQueryState] = useState('');
  const [showDeleted, setShowDeleted] = useState(false);
  const [sourceTags, setSourceTags] = useState<string[]>([]);
  const [lastCapture, setLastCapture] = useState<LastCapture | null>(null);
  const [persistState, setPersistState] = useState<PersistState>('unknown');
  const [quota, setQuota] = useState<QuotaStatus | null>(null);
  const [view, setView] = useState<'home' | 'project'>('home');
  const [projectCards, setProjectCards] = useState<ProjectCard[]>([]);
  const [scopeAll, setScopeAll] = useState(false);
  const [projectFilter, setProjectFilter] = useState<Set<string> | null>(null);
  const captureFocusRef = useRef<(() => void) | null>(null);
  const lastSyncHandled = useRef<string | null>(null);

  // Reactive: a window that mounts hidden/narrow must not lock the app into
  // mobile behaviour (no-autofocus etc.) after it grows.
  const [isMobile, setIsMobile] = useState(
    () =>
      typeof window !== 'undefined' &&
      (window.matchMedia?.('(pointer: coarse)').matches || window.innerWidth < 700),
  );
  useEffect(() => {
    const compute = () =>
      setIsMobile(window.matchMedia?.('(pointer: coarse)').matches || window.innerWidth < 700);
    window.addEventListener('resize', compute);
    compute();
    return () => window.removeEventListener('resize', compute);
  }, []);

  const activeProject = useMemo(
    () =>
      activeProjects.find((p) => p.id === activeProjectId) ??
      archivedProjects.find((p) => p.id === activeProjectId) ??
      null,
    [activeProjects, archivedProjects, activeProjectId],
  );

  const allProjects = useMemo(
    () => [...activeProjects, ...archivedProjects],
    [activeProjects, archivedProjects],
  );

  const refreshProjects = useCallback(async () => {
    const { active, archived } = await listProjects();
    setActiveProjects(active);
    setArchivedProjects(archived);
    return { active, archived };
  }, []);

  const runQuery = useCallback(
    async (raw: string, projectOverride?: Project, scope: boolean = scopeAll) => {
      const project = projectOverride ?? activeProject;
      if (!project) {
        setFeed({ kind: 'default', insights: [] });
        return;
      }
      const route = routeQuery(raw, allProjects.map((p) => p.prefix));
      if (route.type === 'blank') {
        setFeed({ kind: 'default', insights: await listInsights(project.id, { includeDeleted: showDeleted }) });
        return;
      }
      if (route.type === 'prefixed') {
        // Prefixes are reusable: resolve against EVERY matching project; each result
        // wears its project bubble, and single matches still switch context.
        const targets = await findProjectsByPrefix(route.prefix);
        if (targets.length > 0) {
          if (route.idQuery.kind === 'incomplete') {
            setFeed({ kind: 'incomplete' });
            return;
          }
          if (targets.length === 1 && targets[0].id !== project.id) {
            setActiveProjectId(targets[0].id);
            localStorage.setItem(ACTIVE_PROJECT_KEY, targets[0].id);
          }
          const res = await resolveIdQueryAcross(targets, route.idQuery);
          setFeed({ kind: 'ids', ...res, scopeAll: false });
          return;
        }
      }
      if (route.type === 'ids' || route.type === 'prefixed') {
        const idQuery = route.idQuery;
        if (idQuery.kind === 'incomplete') {
          setFeed({ kind: 'incomplete' });
          return;
        }
        // Bare numbers: scoped to the project you're in; the filter row can widen
        // the same query to every project.
        const scopeProjects = scope ? allProjects : [project];
        const res = await resolveIdQueryAcross(scopeProjects, idQuery);
        setFeed({ kind: 'ids', ...res, scopeAll: scope });
        return;
      }
      const matches = await searchText(project.id, route.text);
      setFeed({ kind: 'text', insights: matches, query: route.text });
    },
    [activeProject, allProjects, showDeleted, scopeAll],
  );

  const refresh = useCallback(async () => {
    const { active, archived } = await refreshProjects();
    const projects = [...active, ...archived];
    const current = projects.find((p) => p.id === activeProjectId) ?? active[0] ?? null;
    if (current && current.id !== activeProjectId) setActiveProjectId(current.id);
    if (current) {
      await runQuery(query, current);
      setSourceTags(await listSourceTags(current.id));
    } else {
      setFeed({ kind: 'default', insights: [] });
      setSourceTags([]);
    }
    setMeta(await getMeta());
    setQuota(await checkQuota());
  }, [activeProjectId, query, refreshProjects, runQuery]);

  /** Data for the projects-home grid: per project, count + newest snippet. */
  const loadProjectCards = useCallback(async () => {
    const { active } = await listProjects();
    const cards: ProjectCard[] = [];
    for (const project of active) {
      const rows = await db.insights.where('project_id').equals(project.id).toArray();
      const live = rows.filter((r) => r.deleted_at === null && !r.purged);
      live.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
      const newest = live[0] ?? null;
      const firstText = newest?.content.find((b) => b.type === 'text');
      cards.push({
        project,
        count: live.length,
        lastText: newest
          ? firstText?.type === 'text'
            ? firstText.value.slice(0, 60)
            : newest.content.some((b) => b.type === 'image')
              ? '▦ image capture'
              : '🔗 link capture'
          : null,
        lastAt: newest?.timestamp ?? null,
      });
    }
    setProjectCards(cards);
  }, []);

  const goHome = useCallback(() => {
    setView('home');
    setQueryState('');
    setScopeAll(false);
    setProjectFilter(null);
    void loadProjectCards();
  }, [loadProjectCards]);

  // Cloud sync lands quietly in the background — when a sync completes, the screen
  // must learn about pulled projects/insights on its own (bug fix: projects were
  // invisible on a fresh device until something else forced a redraw).
  useEffect(() => {
    if (!cloudActive) return;
    return onSyncState((s) => {
      if (s.lastSyncAt && s.lastSyncAt !== lastSyncHandled.current) {
        lastSyncHandled.current = s.lastSyncAt;
        void refresh();
        void loadProjectCards();
      }
    });
  }, [cloudActive, refresh, loadProjectCards]);

  // A new query resets the widened scope and project filter.
  useEffect(() => {
    setScopeAll(false);
    setProjectFilter(null);
  }, [query]);

  // Boot
  useEffect(() => {
    (async () => {
      const stored = localStorage.getItem(ACTIVE_PROJECT_KEY);
      if (stored) setActiveProjectId(stored);
      setMeta(await getMeta());
      const { active } = await refreshProjects();
      if (!stored && active[0]) setActiveProjectId(active[0].id);
      setPersistState(await checkPersistence());
      setQuota(await checkQuota());
      await loadProjectCards();
      setReady(true);
    })().catch((err) =>
      reportAppError({
        title: 'Failed to open the library',
        detail: String(err),
        blocking: true,
      }),
    );
  }, [refreshProjects]);

  // Feed follows project/query/showDeleted
  useEffect(() => {
    if (!ready || !activeProject) return;
    void runQuery(query);
    void listSourceTags(activeProject.id).then(setSourceTags);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, activeProjectId, query, showDeleted]);

  // Upcoming ref preview: known BEFORE submission so the user can write it down
  // first. Local mode: current_seq+1. Cloud mode: this device's reserved block.
  const refreshNextRef = useCallback(async () => {
    if (!activeProject) {
      setNextRef(null);
      return;
    }
    if (!cloudActive) {
      setNextRef(activeProject.current_seq + 1);
      return;
    }
    let ref = await peekNextRef(activeProject.id);
    if (ref === null) {
      await ensureBlock(activeProject.id); // no-op offline
      ref = await peekNextRef(activeProject.id);
    }
    setNextRef(ref);
  }, [activeProject, cloudActive]);

  useEffect(() => {
    if (ready) void refreshNextRef();
  }, [ready, refreshNextRef]);

  const setQuery = useCallback((q: string) => setQueryState(q), []);
  const clearQuery = useCallback(() => setQueryState(''), []);

  const selectProject = useCallback((id: string) => {
    setActiveProjectId(id);
    localStorage.setItem(ACTIVE_PROJECT_KEY, id);
    setQueryState('');
    setView('project');
    // The success card belongs to the project it was captured in.
    setLastCapture(null);
  }, []);

  const openProject = selectProject;

  /** Re-run the current ID query across every project. */
  const widenScope = useCallback(() => {
    setScopeAll(true);
    setProjectFilter(null);
    void runQuery(query, undefined, true);
  }, [query, runQuery]);

  const addProject = useCallback(
    async (name: string, prefix: string) => {
      const isFirst = (await db.projects.count()) === 0;
      const project = await guardWrite(() => createProject(name, prefix));
      if (isFirst) {
        // navigator.storage.persist() on FIRST project creation (PRD §2.2).
        setPersistState(await requestPersistence());
      }
      selectProject(project.id);
      if (cloudActive) {
        // Push the project NOW and then reserve its first number block — reserving
        // before the row exists server-side is rejected, so order matters here.
        await syncNow();
        await ensureBlock(project.id);
      }
      await refresh();
      await loadProjectCards();
      return project;
    },
    [refresh, selectProject, cloudActive, loadProjectCards],
  );

  const updateProject = useCallback(
    async (id: string, patch: { name?: string; prefix?: string }) => {
      await guardWrite(() => renameProject(id, patch));
      await refresh();
    },
    [refresh],
  );

  const archiveProject = useCallback(
    async (id: string, archived: boolean) => {
      await guardWrite(() => setArchived(id, archived));
      if (archived && id === activeProjectId) {
        const { active } = await listProjects();
        const next = active.find((p) => p.id !== id);
        setActiveProjectId(next?.id ?? null);
      }
      await refresh();
      await loadProjectCards();
    },
    [activeProjectId, refresh, loadProjectCards],
  );

  const capture = useCallback(
    async (content: Block[], sourceTag: string, dirOverride: Direction | 'auto') => {
      if (!activeProject) throw new Error('No active project.');
      // Block new captures at 95% quota with an explicit error (PRD §2.2).
      const q = await checkQuota();
      if (q?.block) {
        const err = {
          title: 'Storage nearly full — capture blocked',
          detail:
            'Storage is above 95% of the browser quota. Saving now risks a silent partial ' +
            'write. Export a backup and free space before capturing again.',
          blocking: true,
        };
        reportAppError(err);
        throw new Error(err.title);
      }
      const textParts = content
        .filter((b): b is Extract<Block, { type: 'text' }> => b.type === 'text')
        .map((b) => b.value)
        .join('\n');
      const direction = resolveDirection(textParts, dirOverride);
      if (cloudActive && (await peekNextRef(activeProject.id)) === null) {
        // Self-heal before failing: reserve a block on the spot (no-op offline).
        await ensureBlock(activeProject.id);
      }
      const insight = await guardWrite(() =>
        captureInsight(
          { project_id: activeProject.id, source_tag: sourceTag, content, direction },
          undefined,
          { fromBlock: cloudActive },
        ),
      );
      setLastCapture({
        insightId: insight.id,
        prefixedRef: `${activeProject.prefix}-${insight.ref_id}`,
        until: Date.now() + QUICK_EDIT_WINDOW_MS,
      });
      await recordCaptureAndMaybeBackup(activeProject.id);
      if (cloudActive) {
        void syncNow(); // fire-and-forget: capture is already durable locally
        void ensureBlock(activeProject.id);
      }
      // No explicit refreshNextRef here: refresh() changes activeProject
      // (current_seq moved), which re-runs the nextRef effect with FRESH state —
      // an explicit call would race it with a stale closure.
      await refresh();
      return insight;
    },
    [activeProject, refresh, cloudActive],
  );

  const afterMutation = useCallback(() => {
    if (cloudActive) void syncNow();
  }, [cloudActive]);

  const saveEdit = useCallback(
    async (id: string, patch: Partial<Pick<Insight, 'source_tag' | 'content' | 'direction'>>) => {
      await guardWrite(() => editInsight(id, patch));
      await refresh();
      afterMutation();
    },
    [refresh, afterMutation],
  );

  const removeInsight = useCallback(
    async (id: string) => {
      await guardWrite(() => softDeleteInsight(id));
      await refresh();
      afterMutation();
    },
    [refresh, afterMutation],
  );

  const unremoveInsight = useCallback(
    async (id: string) => {
      await guardWrite(() => restoreInsight(id));
      await refresh();
      afterMutation();
    },
    [refresh, afterMutation],
  );

  const hardPurgeInsight = useCallback(
    async (id: string) => {
      await guardWrite(() => purgeInsight(id));
      await refresh();
      afterMutation();
    },
    [refresh, afterMutation],
  );

  const exportActiveProject = useCallback(async () => {
    if (!activeProject) return;
    if (meta?.backup_dir_handle && fsAccessSupported()) {
      await oneClickExport(activeProject.id);
    } else {
      const result = await exportProject(activeProject.id);
      triggerDownload(result);
      await markExported();
    }
    await refresh();
  }, [activeProject, meta, refresh]);

  const rememberBackupDir = useCallback(async () => {
    try {
      const handle = await chooseBackupDirectory();
      await refresh();
      return handle !== null;
    } catch {
      return false; // user cancelled the picker
    }
  }, [refresh]);

  const registerCaptureFocus = useCallback((fn: (() => void) | null) => {
    captureFocusRef.current = fn;
  }, []);

  const focusCapture = useCallback(() => captureFocusRef.current?.(), []);

  // Backup staleness (PRD §2.2): newest insight >7 days newer than last export.
  const backupStale = useMemo(() => {
    if (!meta || feed.kind !== 'default' || feed.insights.length === 0) return false;
    const newest = feed.insights[0]?.timestamp;
    if (!newest) return false;
    if (!meta.last_export_at) return true;
    return (
      new Date(newest).getTime() - new Date(meta.last_export_at).getTime() > 7 * 86_400_000
    );
  }, [meta, feed]);

  const value: AppState = {
    ready,
    meta,
    activeProjects,
    archivedProjects,
    activeProject,
    feed,
    query,
    showDeleted,
    sourceTags,
    lastCapture,
    persistState,
    quota,
    backupStale,
    isMobile,
    cloudActive,
    nextRef,
    view,
    projectCards,
    projectFilter,
    goHome,
    openProject,
    widenScope,
    setProjectFilter,
    setQuery,
    clearQuery,
    setShowDeleted,
    selectProject,
    addProject,
    updateProject,
    archiveProject,
    capture,
    saveEdit,
    removeInsight,
    unremoveInsight,
    hardPurgeInsight,
    exportActiveProject,
    rememberBackupDir,
    refresh,
    registerCaptureFocus,
    focusCapture,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
