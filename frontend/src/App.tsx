import { Component, lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState, type FocusEvent as ReactFocusEvent, type ReactNode } from 'react';
import { getOfflineScope, setOfflineScope, type PendingUpload } from './offline';
import { BellIcon } from '@phosphor-icons/react/dist/icons/Bell';
import { BooksIcon } from '@phosphor-icons/react/dist/icons/Books';
import { ChatsCircleIcon } from '@phosphor-icons/react/dist/icons/ChatsCircle';
import { DotsThreeIcon } from '@phosphor-icons/react/dist/icons/DotsThree';
import { ExamIcon } from '@phosphor-icons/react/dist/icons/Exam';
import { GaugeIcon } from '@phosphor-icons/react/dist/icons/Gauge';
import { GearSixIcon } from '@phosphor-icons/react/dist/icons/GearSix';
import { ListIcon } from '@phosphor-icons/react/dist/icons/List';
import { MagnifyingGlassIcon } from '@phosphor-icons/react/dist/icons/MagnifyingGlass';
import { SignOutIcon } from '@phosphor-icons/react/dist/icons/SignOut';
import { SquaresFourIcon } from '@phosphor-icons/react/dist/icons/SquaresFour';
import { UploadSimpleIcon } from '@phosphor-icons/react/dist/icons/UploadSimple';
import { UsersThreeIcon } from '@phosphor-icons/react/dist/icons/UsersThree';
import { XIcon } from '@phosphor-icons/react/dist/icons/X';
import type { Icon as PhosphorIcon } from '@phosphor-icons/react';
import './App.css';
import './Navigation.css';
import type {
  ChatMessage,
  GlobalSearchResult,
  SearchActionContext,
  SearchCommunityKind,
  ScreenType,
  LearningSpace,
  LearningSpacesResponse,
  User,
} from './types';

const INITIAL_CHAT: ChatMessage[] = [
  {
    id: 'welcome',
    role: 'assistant',
    content: 'Ask me anything about your uploaded past questions and lecture notes. You can also ask me to explain a topic, find related past questions, or suggest practice.',
  },
];
const AUTH_RESET_KEY = 'exammind-first-upload-auth-reset-v1';
const NAV_COLLAPSE_TIMER_MS = 240;
const Dashboard = lazy(() => import('./screens/Dashboard'));
const Assistant = lazy(() => import('./screens/Assistant'));
const Upload = lazy(() => import('./screens/Upload'));
const Offline = lazy(() => import('./screens/Offline'));
const Collab = lazy(() => import('./screens/Collab'));
const Practice = lazy(() => import('./screens/Practice'));
const Progress = lazy(() => import('./screens/Progress'));
const StudyGroups = lazy(() => import('./screens/StudyGroups'));
const SearchResults = lazy(() => import('./screens/SearchResults'));
const Settings = lazy(() => import('./screens/Settings'));
const Profile = lazy(() => import('./screens/Profile'));
const Workspace = lazy(() => import('./screens/Workspace'));
const Onboarding = lazy(() => import('./screens/Onboarding'));
const LearningSpaces = lazy(() => import('./screens/LearningSpaces'));
const Moderation = lazy(() => import('./screens/Moderation'));
const AdminDashboard = lazy(() => import('./screens/AdminDashboard'));
import Logo from './components/Logo';
import NotificationPanel from './components/NotificationPanel';
import { getToken as readStoredToken, setToken as storeToken, clearToken as clearStoredToken } from './lib/session';
import OfflineStatus from './components/OfflineStatus';
import MaxeTrigger from './components/Maxe/MaxeTrigger';
const MaxeWorkspace = lazy(() => import('./components/Maxe/MaxeWorkspace'));
const Auth = lazy(() => import('./components/Auth').then(({ Auth: AuthScreen }) => ({ default: AuthScreen })));
const Landing = lazy(() => import('./components/Landing'));
const Privacy = lazy(() => import('./components/Privacy'));
const FeedbackPage = lazy(() => import('./components/FeedbackPage'));
const GroupInvite = lazy(() => import('./components/GroupInvite'));
import { apiGet, apiPost } from './lib/api';
import { AUTH_REQUEST_TIMEOUT_MS } from './lib/firebaseAuth';
import { firebaseAuth } from './lib/firebase';
import { signOut as signOutFirebase } from 'firebase/auth';

function RouteLoading() {
  return (
    <div className="account-bootstrap" role="status" aria-live="polite">
      <div className="account-bootstrap-card">
        <div className="account-bootstrap-mark"><Logo size={30} /></div>
        <p className="account-bootstrap-kicker">EXAMMIND / LOADING</p>
        <h1>Opening your study space.</h1>
        <p>We’re loading this part of ExamMind. It should only take a moment.</p>
        <span className="account-bootstrap-loader" aria-hidden="true" />
      </div>
    </div>
  );
}

class LazyRouteBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="account-bootstrap" role="alert">
          <div className="account-bootstrap-card">
            <div className="account-bootstrap-mark"><Logo size={30} /></div>
            <p className="account-bootstrap-kicker">EXAMMIND / LOADING</p>
            <h1>This study space could not open.</h1>
            <p>There was a problem loading this part of ExamMind. Reload to try again.</p>
            <button type="button" className="account-bootstrap-action account-bootstrap-action-primary" onClick={() => window.location.reload()}>Reload</button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

function LazyRoute({ children }: { children: ReactNode }) {
  return (
    <LazyRouteBoundary>
      <Suspense fallback={<RouteLoading />}>
        {children}
      </Suspense>
    </LazyRouteBoundary>
  );
}

type NavigationItem = {
  label: string;
  screen: ScreenType;
  icon: PhosphorIcon;
};

type PublicView = 'landing' | 'auth' | 'privacy' | 'feedback' | 'invite';
type AccountLifecycleRecovery = {
  kind: 'deactivated' | 'pending_deletion' | 'expired';
  deletionDueAt?: string;
  localCleanupPending?: boolean;
};

type LearningSpaceRoute =
  | 'loading'
  | 'first_access'
  | 'space_recovery'
  | 'ksa_onboarding'
  | 'profile_onboarding'
  | 'ready';

function resolveLearningSpaceRoute(
  spaces: LearningSpacesResponse | null,
  profileOnboardingRequired: boolean,
  editingProfile: boolean,
): LearningSpaceRoute {
  if (!spaces) return 'loading';
  if (spaces.memberships.length === 0) return 'first_access';
  // Keep school context server-selected. If it is absent, fail closed rather
  // than exposing a generic picker or choosing from client-visible memberships.
  if (!spaces.active_space) return 'space_recovery';
  if (spaces.active_space.slug === 'ksa' && spaces.active_space.membership?.onboarding_required) {
    return 'ksa_onboarding';
  }
  if (profileOnboardingRequired || editingProfile) return 'profile_onboarding';
  return 'ready';
}

function publicViewFromPath(): PublicView {
  const path = window.location.pathname.replace(/\/+$/, '');
  if (path === '/admin') return 'auth';
  if (path === '/privacy') return 'privacy';
  if (path === '/feedback') return 'feedback';
  if (/^\/groups\/invite\/[A-Za-z0-9_-]+$/.test(path)) return 'invite';
  return 'landing';
}

function adminPathRequested(): boolean {
  return window.location.pathname.replace(/\/+$/, '') === '/admin';
}

function inviteTokenFromPath(): string | null {
  const match = window.location.pathname.match(/^\/groups\/invite\/([A-Za-z0-9_-]+)$/);
  return match?.[1] || null;
}

function sharedThreadIdFromPath(): number | null {
  const params = new URLSearchParams(window.location.search);
  if (params.get('screen') !== 'discussions') return null;
  const value = Number(params.get('thread'));
  return Number.isInteger(value) && value > 0 ? value : null;
}

const NAV_GROUPS: { label: string; items: NavigationItem[] }[] = [
  {
    label: 'Study space',
    items: [
      { label: 'My desk', screen: 'dashboard', icon: SquaresFourIcon },
      { label: 'Add material', screen: 'upload', icon: UploadSimpleIcon },
      { label: 'My Materials', screen: 'offline', icon: BooksIcon },
      { label: 'Practice', screen: 'practice', icon: ExamIcon },
    ],
  },
  {
    label: 'Insights',
    items: [
      { label: 'Progress', screen: 'progress', icon: GaugeIcon },
    ],
  },
  {
    label: 'Study together',
    items: [
      { label: 'Discussions', screen: 'collab', icon: ChatsCircleIcon },
      { label: 'Study Groups', screen: 'groups', icon: UsersThreeIcon },
    ],
  },
  {
    label: 'Stewardship',
    items: [
      { label: 'Admin desk', screen: 'admin', icon: GearSixIcon },
      { label: 'Review contributions', screen: 'moderation', icon: ListIcon },
    ],
  },
];

const MOBILE_NAV_ITEMS: NavigationItem[] = [
  { label: 'Home', screen: 'dashboard', icon: SquaresFourIcon },
  { label: 'Upload', screen: 'upload', icon: UploadSimpleIcon },
  { label: 'Practice', screen: 'practice', icon: ExamIcon },
];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

export default function App() {
  const [token, setToken] = useState(() => {
    if (!localStorage.getItem(AUTH_RESET_KEY)) {
      clearStoredToken();
      localStorage.setItem(AUTH_RESET_KEY, 'true');
      return null;
    }
    return readStoredToken();
  });
  const [publicView, setPublicView] = useState<PublicView>(publicViewFromPath);
  const [authInitialMode, setAuthInitialMode] = useState<'login' | 'register'>('register');
  const [user, setUser] = useState<User | null>(null);
  const [learningSpaces, setLearningSpaces] = useState<LearningSpacesResponse | null>(null);
  const [learningSpacesLoading, setLearningSpacesLoading] = useState(() => Boolean(readStoredToken()));
  const [learningSpacesError, setLearningSpacesError] = useState('');
  const [onboardingSpace, setOnboardingSpace] = useState<LearningSpace | null>(null);
  const [userHydrating, setUserHydrating] = useState(() => Boolean(readStoredToken()));
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [editingProfile, setEditingProfile] = useState(false);
  const [onboardingReturnScreen, setOnboardingReturnScreen] = useState<ScreenType>('dashboard');
  const [profileNudgeVisible, setProfileNudgeVisible] = useState(false);
  const [deletionNotice, setDeletionNotice] = useState('');
  const [deletionRecoveryPending, setDeletionRecoveryPending] = useState(false);
  const [deletionFirebaseDeleted, setDeletionFirebaseDeleted] = useState(false);
  const [accountLifecycleRecovery, setAccountLifecycleRecovery] = useState<AccountLifecycleRecovery | null>(null);
  const [activeScreen, setActiveScreen] = useState<ScreenType>(() => adminPathRequested() ? 'admin' : sharedThreadIdFromPath() ? 'collab' : 'dashboard');
  const [profileUsername, setProfileUsername] = useState<string | null>(null);
  const [workspaceTarget, setWorkspaceTarget] = useState<{ kind: 'lecture_note' | 'past_question'; id: number } | null>(null);
  const [queuedUpload, setQueuedUpload] = useState<PendingUpload | null>(null);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [navExpanded, setNavExpanded] = useState(false);
  const [navWindowFocused, setNavWindowFocused] = useState(true);
  const [selectedQuestion, setSelectedQuestion] = useState('');
  const [toast, setToast] = useState('');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(INITIAL_CHAT);
  const [maxeOpen, setMaxeOpen] = useState(false);
  const [practiceInitialTopic, setPracticeInitialTopic] = useState('');
  const [practiceContext, setPracticeContext] = useState<SearchActionContext | null>(null);
  const [communityContext, setCommunityContext] = useState<(SearchActionContext & { action: 'discussion' | 'study_group' | 'reading_room' }) | null>(null);
  const [communityTarget, setCommunityTarget] = useState<{ kind: 'study_group' | 'reading_room'; id: number } | null>(null);
  const [settingsFocus, setSettingsFocus] = useState<'feedback' | null>(null);

  const verifiedSpace = learningSpaces?.active_space;
  const verifiedSpaceId = verifiedSpace?.id ?? null;
  const privateScope = token && user && verifiedSpace?.membership?.status === 'active'
    ? `${user.id}:${verifiedSpace.id}` : null;
  useLayoutEffect(() => {
    setOfflineScope(user?.id ?? null, privateScope ? verifiedSpaceId : null);
    // Private in-memory context must never follow an identity/space switch.
    setChatMessages(INITIAL_CHAT);
    setSelectedQuestion('');
    setWorkspaceTarget(null);
    setQueuedUpload(null);
    setPracticeContext(null);
    setPracticeInitialTopic('');
    setCommunityContext(null);
    setCommunityTarget(null);
    setSettingsFocus(null);
    setSearchQuery('');
    setSubmittedResult(null);
    setMaxeOpen(false);
    setNotificationsOpen(false);
  }, [privateScope, user?.id, verifiedSpaceId]);

  const updatePrivateMessages = (updater: (current: ChatMessage[]) => ChatMessage[]) => {
    if (privateScope && getOfflineScope() === privateScope) setChatMessages(updater);
  };

  const refreshLearningSpaces = useCallback(async (): Promise<LearningSpacesResponse | null> => {
    setLearningSpacesLoading(true);
    setLearningSpacesError('');
    try {
      const data = await apiGet('/learning-spaces') as LearningSpacesResponse;
      setLearningSpaces(data);
      return data;
    } catch {
      setLearningSpaces(null);
      setLearningSpacesError('We could not load your learning spaces. Try again to continue.');
      return null;
    } finally {
      setLearningSpacesLoading(false);
    }
  }, []);

  useEffect(() => {
    const syncPublicPath = () => setPublicView(publicViewFromPath());
    window.addEventListener('popstate', syncPublicPath);
    return () => window.removeEventListener('popstate', syncPublicPath);
  }, []);

  const [searchQuery, setSearchQuery] = useState('');
  // State for the full Search Results screen (set on Enter).
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [submittedResult, setSubmittedResult] = useState<GlobalSearchResult | null>(null);
  const [submittedLoading, setSubmittedLoading] = useState(false);
  const [submittedError, setSubmittedError] = useState('');
  const searchBoxRef = useRef<HTMLDivElement>(null);
  const navCollapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navPointerInside = useRef(false);
  const navFocusInside = useRef(false);
  const mobileMenuButtonRef = useRef<HTMLButtonElement>(null);
  const mobileMenuCloseRef = useRef<HTMLButtonElement>(null);
  const maxeTriggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!sidebarOpen) return;
    mobileMenuCloseRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Tab') {
        const controls = document.querySelectorAll<HTMLButtonElement>('#mobile-nav-sheet button:not([disabled])');
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
        return;
      }
      if (event.key !== 'Escape') return;
      setSidebarOpen(false);
      mobileMenuButtonRef.current?.focus();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [sidebarOpen]);

  const expandNav = () => {
    if (navCollapseTimer.current) clearTimeout(navCollapseTimer.current);
    setNavExpanded(true);
  };

  const scheduleNavCollapse = () => {
    if (navCollapseTimer.current) clearTimeout(navCollapseTimer.current);
    navCollapseTimer.current = setTimeout(() => {
      navCollapseTimer.current = null;
      if (!navPointerInside.current && !navFocusInside.current) setNavExpanded(false);
    }, NAV_COLLAPSE_TIMER_MS);
  };

  const handleNavPointerEnter = () => {
    navPointerInside.current = true;
    expandNav();
  };

  const handleNavPointerLeave = () => {
    navPointerInside.current = false;
    scheduleNavCollapse();
  };

  const handleNavFocus = () => {
    navFocusInside.current = true;
    expandNav();
  };

  const handleNavBlur = (event: ReactFocusEvent<HTMLElement>) => {
    const nextTarget = event.relatedTarget as Node | null;
    if (!nextTarget || !event.currentTarget.contains(nextTarget)) {
      navFocusInside.current = false;
      scheduleNavCollapse();
    }
  };

  useEffect(() => {
    const resetNavigationOnWindowBlur = () => {
      navPointerInside.current = false;
      navFocusInside.current = false;
      if (navCollapseTimer.current) clearTimeout(navCollapseTimer.current);
      navCollapseTimer.current = null;
      setNavExpanded(false);
      setNavWindowFocused(false);
    };
    const restoreNavigationOnWindowFocus = () => setNavWindowFocused(true);
    window.addEventListener('blur', resetNavigationOnWindowBlur);
    window.addEventListener('focus', restoreNavigationOnWindowFocus);
    return () => {
      window.removeEventListener('blur', resetNavigationOnWindowBlur);
      window.removeEventListener('focus', restoreNavigationOnWindowFocus);
      if (navCollapseTimer.current) clearTimeout(navCollapseTimer.current);
    };
  }, []);

  // Hydrate user info from a stored token on first load
  useEffect(() => {
    if (!token) {
      setUserHydrating(false);
      return;
    }

    let cancelled = false;
    setUserHydrating(true);

    apiGet('/auth/me', { timeoutMs: AUTH_REQUEST_TIMEOUT_MS })
      .then((data) => {
        if (cancelled) return;
        setUser(data as User);
        setUserHydrating(false);
      })
      .catch(() => {
        if (cancelled) return;
        // Token is expired or invalid — force back to login
        clearStoredToken();
        setUser(null);
        setToken(null);
        setUserHydrating(false);
      });

    return () => { cancelled = true; };
  }, [token]);

  useEffect(() => {
    if (!token) return;
    apiGet('/community/profile')
      .then((data) => {
        const profile = data as { onboarding_required?: boolean; onboarding_state?: string };
        const identityIncomplete = !user?.username || (user.name || '').trim().length < 2;
        const required = Boolean(profile.onboarding_required)
          || (profile.onboarding_state === 'completed' && identityIncomplete);
        setNeedsOnboarding(required);
        if (profile.onboarding_state === 'skipped') {
          const dismissed = localStorage.getItem('exammind-profile-nudge-dismissed') === 'true';
          setProfileNudgeVisible(!dismissed);
        } else {
          setProfileNudgeVisible(false);
        }
      })
      .catch(() => setNeedsOnboarding(false));
  }, [token, user]);

  useEffect(() => {
    if (!token || !user) {
      setLearningSpaces(null);
      setLearningSpacesLoading(false);
      setLearningSpacesError('');
      return;
    }
    void refreshLearningSpaces();
  }, [refreshLearningSpaces, token, user]);

  useEffect(() => {
    const active = learningSpaces?.active_space;
    if (active?.slug !== 'ksa' || !active.membership?.onboarding_required || editingProfile) return;
    setOnboardingSpace(active);
    setNeedsOnboarding(true);
  }, [editingProfile, learningSpaces]);

  const handleLogin = async (jwt: string, authenticatedUser?: User) => {
    setAccountLifecycleRecovery(null);
    storeToken(jwt);
    setToken(jwt);
    setUserHydrating(true);
    setLearningSpaces(null);
    setLearningSpacesLoading(true);
    setLearningSpacesError('');
    if (authenticatedUser) setUser(authenticatedUser);
    setActiveScreen(adminPathRequested() ? 'admin' : sharedThreadIdFromPath() ? 'collab' : 'dashboard');
    if (inviteTokenFromPath()) setPublicView('invite');

    try {
      const data = await apiGet('/auth/me', { timeoutMs: AUTH_REQUEST_TIMEOUT_MS }) as User;
      setUser(data);
    } catch {
      // The session response already includes a verified user. Keep that
      // identity during a short /me network failure instead of rendering a
      // fake account; only legacy callers without a user response fail closed.
      if (!authenticatedUser) {
        clearStoredToken();
        setToken(null);
        setUser(null);
        setUserHydrating(false);
        throw new Error('ExamMind could not load your account. Please try again.');
      }
    }
    setUserHydrating(false);
  };

  const handleLogout = () => {
    setChatMessages(INITIAL_CHAT);
    if (firebaseAuth) void signOutFirebase(firebaseAuth).catch(() => undefined);
    clearStoredToken();
    setToken(null);
    setUser(null);
    setLearningSpaces(null);
    setLearningSpacesError('');
    setLearningSpacesLoading(false);
    setOnboardingSpace(null);
    setUserHydrating(false);
    setNeedsOnboarding(false);
    setEditingProfile(false);
    setProfileNudgeVisible(false);
    setDeletionRecoveryPending(false);
    setDeletionFirebaseDeleted(false);
    setAccountLifecycleRecovery(null);
    setDeletionNotice('');
    setActiveScreen('dashboard');
    setPublicView('landing');
    setSidebarOpen(false);
    setMaxeOpen(false);
  };

  const handleAccountDeleted = (message: string) => {
    if (firebaseAuth) void signOutFirebase(firebaseAuth).catch(() => undefined);
    clearStoredToken();
    setToken(null);
    setUser(null);
    setLearningSpaces(null);
    setOnboardingSpace(null);
    setUserHydrating(false);
    setNeedsOnboarding(false);
    setEditingProfile(false);
    setProfileNudgeVisible(false);
    setDeletionRecoveryPending(false);
    setDeletionFirebaseDeleted(false);
    setAccountLifecycleRecovery(null);
    setDeletionNotice(message);
    setPublicView('landing');
    setActiveScreen('dashboard');
  };

  const handleAccountDeletionPending = (message: string, firebaseDeleted: boolean) => {
    // Neon has already been removed. Keep Firebase signed in when its delete
    // step failed so Auth can reauthenticate and retry without workspace access.
    clearStoredToken();
    setToken(null);
    setUser(null);
    setLearningSpaces(null);
    setOnboardingSpace(null);
    setUserHydrating(false);
    setNeedsOnboarding(false);
    setEditingProfile(false);
    setProfileNudgeVisible(false);
    setDeletionRecoveryPending(true);
    setDeletionFirebaseDeleted(firebaseDeleted);
    setAccountLifecycleRecovery(null);
    setDeletionNotice(message);
    setAuthInitialMode('login');
    setPublicView('auth');
    setActiveScreen('dashboard');
  };

  const dismissAccountDeletionRecovery = () => {
    if (firebaseAuth) void signOutFirebase(firebaseAuth).catch(() => undefined);
    clearStoredToken();
    setToken(null);
    setUser(null);
    setLearningSpaces(null);
    setOnboardingSpace(null);
    setUserHydrating(false);
    setNeedsOnboarding(false);
    setEditingProfile(false);
    setProfileNudgeVisible(false);
    setDeletionRecoveryPending(false);
    setDeletionFirebaseDeleted(false);
    setAccountLifecycleRecovery(null);
    setDeletionNotice('');
    setAuthInitialMode('login');
    setPublicView('auth');
  };

  const handleAccountLifecycleState = (kind: AccountLifecycleRecovery['kind'], deletionDueAt?: string) => {
    clearStoredToken();
    setToken(null);
    setUser(null);
    setLearningSpaces(null);
    setOnboardingSpace(null);
    setUserHydrating(false);
    setNeedsOnboarding(false);
    setEditingProfile(false);
    setProfileNudgeVisible(false);
    setAccountLifecycleRecovery({ kind, deletionDueAt });
    setDeletionRecoveryPending(false);
    setDeletionFirebaseDeleted(false);
    setAuthInitialMode('login');
    setPublicView('auth');
    setActiveScreen('dashboard');
  };

  const handleAccountLifecycleCleanupPending = (kind: 'deactivated' | 'pending_deletion', deletionDueAt?: string) => {
    if (firebaseAuth) void signOutFirebase(firebaseAuth).catch(() => undefined);
    clearStoredToken();
    setToken(null);
    setUser(null);
    setUserHydrating(false);
    setNeedsOnboarding(false);
    setEditingProfile(false);
    setProfileNudgeVisible(false);
    setDeletionRecoveryPending(false);
    setDeletionFirebaseDeleted(false);
    setDeletionNotice('');
    setAccountLifecycleRecovery({ kind, deletionDueAt, localCleanupPending: true });
    setAuthInitialMode('login');
    setPublicView('auth');
    setActiveScreen('dashboard');
  };

  const handleAccountLifecycleCleanupComplete = (kind: 'deactivated' | 'pending_deletion', deletionDueAt?: string) => {
    if (kind === 'deactivated') {
      handleAccountDeactivated('Your account has been deactivated. Offline device data was removed.');
    } else if (deletionDueAt) {
      handleAccountDeletionScheduled(deletionDueAt);
    }
  };

  const handleAccountDeactivated = (message: string) => {
    if (firebaseAuth) void signOutFirebase(firebaseAuth).catch(() => undefined);
    clearStoredToken();
    setToken(null);
    setUser(null);
    setUserHydrating(false);
    setAccountLifecycleRecovery(null);
    setDeletionNotice(message);
    setPublicView('landing');
    setActiveScreen('dashboard');
  };

  const handleAccountDeletionScheduled = (dueAt: string) => {
    if (firebaseAuth) void signOutFirebase(firebaseAuth).catch(() => undefined);
    clearStoredToken();
    setToken(null);
    setUser(null);
    setUserHydrating(false);
    setAccountLifecycleRecovery(null);
    setDeletionNotice(`Your account is scheduled for deletion on ${new Date(dueAt).toLocaleDateString()}. You can cancel it by signing in before then.`);
    setPublicView('landing');
    setActiveScreen('dashboard');
  };

  const handleRestartOnboarding = async () => {
    try {
      await apiPost('/auth/account/restart-onboarding', {});
      setOnboardingReturnScreen('settings');
      setNeedsOnboarding(true);
      setEditingProfile(false);
      setActiveScreen('onboarding');
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Onboarding could not be restarted.');
      window.setTimeout(() => setToast(''), 3600);
    }
  };

  const handleOnboardingComplete = async () => {
    const wasEditing = editingProfile;
    const wasEditingKsaPreferences = wasEditing && onboardingSpace?.slug === 'ksa';
    const refreshed = await refreshLearningSpaces();
    if (!refreshed) return;
    const active = refreshed.active_space;
    if (active?.slug === 'ksa' && active.membership?.onboarding_required) {
      setOnboardingSpace(active);
      setNeedsOnboarding(true);
      return;
    }
    setOnboardingSpace(null);
    setNeedsOnboarding(false);
    setEditingProfile(false);
    setActiveScreen(onboardingReturnScreen);
    setProfileNudgeVisible(false);
    if (wasEditing) {
      setToast(wasEditingKsaPreferences ? 'KSA learning preferences saved.' : 'Academic profile saved.');
      window.setTimeout(() => setToast(''), 3600);
    }
  };

  const navigatePublic = (path: string, view: PublicView) => {
    window.history.pushState({}, '', path);
    setPublicView(view);
    window.scrollTo({ top: 0, behavior: 'auto' });
  };

  const openPrivacy = () => navigatePublic('/privacy', 'privacy');
  const openFeedback = () => navigatePublic('/feedback', 'feedback');
  const returnToLanding = () => navigatePublic('/', 'landing');
  const openAuth = (mode: 'login' | 'register') => {
    setAuthInitialMode(mode);
    const sharedThreadId = sharedThreadIdFromPath();
    navigatePublic(sharedThreadId ? `/?screen=discussions&thread=${sharedThreadId}` : '/', 'auth');
  };

  const clearSharedThreadUrl = () => {
    const params = new URLSearchParams(window.location.search);
    params.delete('screen');
    params.delete('thread');
    const query = params.toString();
    window.history.replaceState({}, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`);
  };

  // A second argument names which profile or community result to open.
  const go = (screen: ScreenType, arg?: string | number | null) => {
    setProfileUsername(screen === 'profile' && typeof arg === 'string' ? arg : null);
    if (screen !== 'settings') setSettingsFocus(null);
    if (screen === 'assistant') {
      setSidebarOpen(false);
      setMaxeOpen(true);
      return;
    }
    setActiveScreen(screen);
    setSidebarOpen(false);
    setToast('');
    if (screen === 'admin') window.history.pushState({}, '', '/admin');
    else if (window.location.pathname.replace(/\/+$/, '') === '/admin') window.history.pushState({}, '', '/');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const closeMaxe = useCallback(() => {
    setMaxeOpen(false);
    setSelectedQuestion('');
    window.requestAnimationFrame(() => maxeTriggerRef.current?.focus());
  }, []);

  const notifyUnavailable = (feature: string) => {
    setToast(`${feature} is not available yet.`);
    window.setTimeout(() => setToast(''), 3600);
  };

  const askQuestion = (questionText: string) => {
    setSelectedQuestion(questionText);
    go('assistant');
  };

  const handleGoToPractice = (topic: string, context?: SearchActionContext) => {
    setPracticeInitialTopic(topic);
    setPracticeContext(context || { query: topic, topic });
    go('practice');
  };

  const focusGlobalSearch = () => {
    setSidebarOpen(false);
    window.requestAnimationFrame(() => {
      searchBoxRef.current?.querySelector<HTMLInputElement>('input')?.focus();
    });
  };

  const askAIFromSearch = (question: string) => {
    askQuestion(question);
  };

  const handleCommunityAction = (action: 'discussion' | 'study_group' | 'reading_room', context: SearchActionContext) => {
    setCommunityContext({ ...context, action });
    go(action === 'discussion' ? 'collab' : 'groups');
  };

  const openCommunityResult = (kind: SearchCommunityKind, id: number) => {
    setCommunityContext(null);
    if (kind === 'discussion') {
      window.history.pushState({}, '', `/?screen=discussions&thread=${id}`);
      go('collab');
      return;
    }
    setCommunityTarget({ kind, id });
    go('groups');
  };

  const openAdminFeedback = () => {
    setSettingsFocus('feedback');
    go('settings');
  };

  const openSearchResults = async (rawQuery: string) => {
    const query = rawQuery.trim();
    if (!query) return;

    go('search');
    setSearchQuery(query);
    setSubmittedQuery(query);
    setSubmittedResult(null);
    setSubmittedError('');
    setSubmittedLoading(true);

    try {
      const data = await apiGet(`/search?q=${encodeURIComponent(query)}`, { timeoutMs: 10_000 }) as GlobalSearchResult;
      setSubmittedResult(data);
    } catch (failure) {
      setSubmittedResult(null);
      setSubmittedError(failure instanceof Error ? failure.message : 'Search is temporarily unavailable. Please try again.');
    } finally {
      setSubmittedLoading(false);
    }
  };

  const handleGlobalSearchEnter = async () => {
    await openSearchResults(searchQuery);
  };

  if (publicView === 'privacy') {
    return (
      <LazyRoute>
        <Privacy
          onBackToHome={returnToLanding}
          onGetStarted={() => openAuth('register')}
          onSignIn={() => openAuth('login')}
        />
      </LazyRoute>
    );
  }

  if (publicView === 'feedback') {
    return (
      <LazyRoute>
        <FeedbackPage
          onBackToHome={returnToLanding}
          onGetStarted={() => openAuth('register')}
          onSignIn={() => openAuth('login')}
        />
      </LazyRoute>
    );
  }

  if (publicView === 'invite' && inviteTokenFromPath()) {
    return (
      <LazyRoute>
        <GroupInvite
          token={inviteTokenFromPath()!}
          authenticated={Boolean(token)}
          onBack={returnToLanding}
          onSignIn={() => openAuth('login')}
          onOpenGroups={() => { setPublicView('landing'); go('groups'); }}
        />
      </LazyRoute>
    );
  }

  if (!token) {
    if (publicView === 'landing') {
      return (
        <LazyRoute>
          <Landing
            onGetStarted={() => openAuth('register')}
            onSignIn={() => openAuth('login')}
            onPrivacy={openPrivacy}
            onFeedback={openFeedback}
            deletionNotice={deletionNotice}
          />
        </LazyRoute>
      );
    }

    return (
      <LazyRoute>
        <Auth
          key={authInitialMode}
          onLogin={handleLogin}
          initialMode={authInitialMode}
          onBackToLanding={returnToLanding}
          onPublicFeedback={openFeedback}
          deletionRecoveryPending={deletionRecoveryPending}
          deletionFirebaseDeleted={deletionFirebaseDeleted}
          deletionMessage={deletionNotice}
          accountLifecycleRecovery={accountLifecycleRecovery}
          onDeletionRecoveryComplete={handleAccountDeleted}
          onDeletionRecoveryPending={handleAccountDeletionPending}
          onAccountLifecycleState={handleAccountLifecycleState}
          onAccountLifecycleCleanupComplete={handleAccountLifecycleCleanupComplete}
          onAccountRecoverySignOut={handleLogout}
          onDismissDeletionRecovery={dismissAccountDeletionRecovery}
        />
      </LazyRoute>
    );
  }

  if (userHydrating || !user) {
    return (
      <div className="account-bootstrap" role="status" aria-live="polite">
        <div className="account-bootstrap-card">
          <div className="account-bootstrap-mark"><Logo size={30} /></div>
          <p className="account-bootstrap-kicker">EXAMMIND / YOUR WORKSPACE</p>
          <h1>Loading your desk.</h1>
          <p>We’re bringing your profile and study space back. This should only take a moment.</p>
          <span className="account-bootstrap-loader" aria-hidden="true" />
        </div>
      </div>
    );
  }

  const learningSpaceRoute = resolveLearningSpaceRoute(learningSpaces, needsOnboarding, editingProfile);
  if (learningSpacesError) {
    return (
      <div className="account-bootstrap" role="alert">
        <div className="account-bootstrap-card">
          <div className="account-bootstrap-mark"><Logo size={30} /></div>
          <p className="account-bootstrap-kicker">EXAMMIND / LEARNING SPACE</p>
          <h1>We hit a small pause.</h1>
          <p>{learningSpacesError}</p>
          <div className="account-bootstrap-actions">
            <button type="button" className="account-bootstrap-action account-bootstrap-action-primary" onClick={() => void refreshLearningSpaces()}>Try again</button>
            <button type="button" className="account-bootstrap-action" onClick={handleLogout}>Sign out</button>
          </div>
        </div>
      </div>
    );
  }

  if (learningSpacesLoading || learningSpaceRoute === 'loading') {
    return (
      <div className="account-bootstrap" role="status" aria-live="polite">
        <div className="account-bootstrap-card">
          <div className="account-bootstrap-mark"><Logo size={30} /></div>
          <p className="account-bootstrap-kicker">EXAMMIND / LEARNING SPACE</p>
          <h1>Preparing your setup.</h1>
          <p>We’re checking which learning space should guide your onboarding.</p>
          <span className="account-bootstrap-loader" aria-hidden="true" />
        </div>
      </div>
    );
  }

  if (learningSpaceRoute === 'first_access') {
    return (
      <LazyRoute>
        <LearningSpaces
          spaces={learningSpaces}
          entryMode="first_access"
          onOpenFeedback={openFeedback}
          onRefresh={refreshLearningSpaces}
          onLogout={handleLogout}
          onKsaVerified={(onboardingRequired, space) => {
            setOnboardingSpace(space);
            setNeedsOnboarding(onboardingRequired);
            if (onboardingRequired) setActiveScreen('onboarding');
          }}
        />
      </LazyRoute>
    );
  }

  if (learningSpaceRoute === 'space_recovery') {
    const hasMultipleMemberships = (learningSpaces?.memberships.length || 0) > 1;
    return (
      <div className="account-bootstrap" role="alert">
        <div className="account-bootstrap-card">
          <div className="account-bootstrap-mark"><Logo size={30} /></div>
          <p className="account-bootstrap-kicker">EXAMMIND / LEARNING SPACE</p>
          <h1>We couldn’t reopen your study space.</h1>
          <p>{hasMultipleMemberships
            ? 'Your account has multiple verified learning-space memberships, but no authorized active context is available. We will not show a space picker or choose a space for you.'
            : 'Your account has one verified learning-space membership, but its active context is unavailable. We will not choose another space for you.'}</p>
          {hasMultipleMemberships && <p>Re-enter through your learning-space-specific ExamMind entry link, or contact support to restore the authorized context. Your memberships and materials remain intact.</p>}
          <div className="account-bootstrap-actions">
            <button type="button" className="account-bootstrap-action account-bootstrap-action-primary" onClick={() => void refreshLearningSpaces()}>Try again</button>
            {hasMultipleMemberships && <button type="button" className="account-bootstrap-action" onClick={openFeedback}>Contact support</button>}
            <button type="button" className="account-bootstrap-action" onClick={handleLogout}>Sign out</button>
          </div>
        </div>
      </div>
    );
  }

  if (learningSpaceRoute === 'ksa_onboarding' || learningSpaceRoute === 'profile_onboarding') {
    return (
      <LazyRoute>
        <Onboarding
          userName={user.name}
          learningSpace={onboardingSpace}
          isEditing={editingProfile}
          onComplete={handleOnboardingComplete}
          onCancel={() => { setEditingProfile(false); setActiveScreen(onboardingReturnScreen); }}
          onLogout={handleLogout}
        />
      </LazyRoute>
    );
  }

  const userInitials = user ? initials(user.name) : '?';
  const discussionContext =
    communityContext?.action === 'discussion'
      ? (communityContext as SearchActionContext & { action: 'discussion' })
      : null;
  const groupContext =
    communityContext && communityContext.action !== 'discussion'
      ? (communityContext as SearchActionContext & { action: 'study_group' | 'reading_room' })
      : null;
  const isMobileMoreActive = !MOBILE_NAV_ITEMS.some((item) => item.screen === activeScreen);
  const activeSpaceRole = learningSpaces?.active_space?.membership?.role;
  const hasAdminPortalAccess = user?.admin_portal_access === true;
  const canModerate = hasAdminPortalAccess || ['owner', 'admin', 'moderator'].includes(activeSpaceRole || '');
  const visibleNavGroups = NAV_GROUPS
    .map(group => ({ ...group, items: group.items.filter(item => (item.screen !== 'moderation' || canModerate) && (item.screen !== 'admin' || hasAdminPortalAccess)) }))
    .filter(group => group.items.length > 0);

  // Keep the authenticated rail compact so the active workspace owns the
  // screen. Navigation.css expands it on hover/focus for quick wayfinding.
  const compactSidebar = true;

  return (
    <div key={privateScope} className={`shell workspace-shell${compactSidebar ? ' is-compact-nav' : ''}${navExpanded ? ' is-nav-expanded' : ''}${navWindowFocused ? '' : ' nav-window-blurred'}`}>
      <aside className="sidebar" id="sidebar" aria-label="Primary navigation" onPointerEnter={handleNavPointerEnter} onPointerLeave={handleNavPointerLeave} onFocusCapture={handleNavFocus} onBlurCapture={handleNavBlur}>
        <div className="logo" aria-label="ExamMind">
          <div className="logo-mark"><Logo size={24} /></div>
          <div className="logo-name">Exam<span>Mind.</span></div>
        </div>
        <nav className="nav">
          {visibleNavGroups.map((group) => (
            <div className="nav-group" role="group" aria-label={group.label} key={group.label}>
              <div className="nav-section">{group.label}</div>
              {group.items.map((item) => {
                const Icon = item.icon;
                const isActive = activeScreen === item.screen;
                return (
                  <button
                    type="button"
                    className={`ni rail-button ${isActive ? 'on' : ''}`}
                    onClick={() => go(item.screen)}
                    aria-current={isActive ? 'page' : undefined}
                    aria-label={item.label}
                    title={item.label}
                    key={item.screen}
                  >
                    <span className="rail-item-surface" aria-hidden="true">
                      <Icon className="ni-ico" weight="regular" />
                      <span className="rail-item-label">{item.label}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="user-row">
          <button
            type="button"
            className="user-btn rail-button"
            onClick={() => go('profile')}
            aria-label={`Open your profile, ${user?.name ?? 'Student'}`}
            title="Profile"
          >
            <span className="rail-item-surface rail-account-surface" aria-hidden="true">
              <span className="ava">{userInitials}</span>
              <span className="rail-account-copy">
                <span className="rail-item-label">{user?.name ?? 'Account'}</span>
                <span className="rail-account-meta">{user?.username ? `@${user.username}` : 'Student account'}</span>
              </span>
            </span>
          </button>
          <button
            type="button"
            className={`settings-btn rail-button ${activeScreen === 'settings' || activeScreen === 'profile' ? 'on' : ''}`}
            onClick={() => go('settings')}
            aria-label="Settings"
            title="Settings"
            aria-current={activeScreen === 'settings' ? 'page' : undefined}
          >
            <span className="rail-item-surface" aria-hidden="true">
              <GearSixIcon className="rail-control-icon" weight="regular" />
              <span className="rail-item-label">Settings</span>
            </span>
          </button>
          <span className="rail-account-divider" aria-hidden="true" />
          <button
            type="button"
            className="logout-btn rail-button"
            onClick={handleLogout}
            aria-label="Log out"
            title="Log out"
          >
            <span className="rail-item-surface" aria-hidden="true">
              <SignOutIcon className="rail-control-icon" weight="regular" />
              <span className="rail-item-label">Log out</span>
            </span>
          </button>
        </div>
      </aside>

      {sidebarOpen && (
        <button
          type="button"
          className="sidebar-scrim"
          aria-label="Close mobile navigation"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <main className="main">
        <header className="topbar">
          <button
            type="button"
            className="mob-menu"
            ref={mobileMenuButtonRef}
            onClick={() => setSidebarOpen(!sidebarOpen)}
            aria-label={sidebarOpen ? 'Close navigation' : 'Open navigation'}
            aria-controls="mobile-nav-sheet"
            aria-expanded={sidebarOpen}
          >
            {sidebarOpen ? <XIcon aria-hidden="true" weight="regular" /> : <ListIcon aria-hidden="true" weight="regular" />}
          </button>
          <div className="workspace-location"><span>Your workspace</span><span aria-hidden="true">/</span><strong>{visibleNavGroups.flatMap(group => group.items).find(item => item.screen === activeScreen)?.label || (activeScreen === 'settings' ? 'Settings' : activeScreen === 'profile' ? (profileUsername ? `@${profileUsername}` : 'Profile') : activeScreen === 'workspace' ? 'Study desk' : activeScreen === 'search' ? 'Search' : 'Library')}</strong></div>
          <div className="search global-search" ref={searchBoxRef}>
            <MagnifyingGlassIcon className="search-ico" aria-hidden="true" weight="regular" />
            <input
              type="text"
              aria-label="Search ExamMind"
              placeholder="Find a note, topic, or study group…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => setSidebarOpen(false)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleGlobalSearchEnter();
                }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  setSearchQuery('');
                  scheduleNavCollapse();
                }
              }}
            />
          </div>
          <div className="tb-right">
            <OfflineStatus />
            <button type="button" className="ico-btn" aria-label="Open settings" title="Settings" onClick={() => go('settings')}><GearSixIcon aria-hidden="true" weight="regular" /></button>
            <span className="notif-anchor">
              <button
                type="button"
                className="ico-btn"
                data-notification-trigger="true"
                aria-label="Open notifications"
                aria-haspopup="dialog"
                aria-expanded={notificationsOpen}
                title="Notifications"
                onClick={() => setNotificationsOpen((open) => !open)}
              >
                <BellIcon aria-hidden="true" weight="regular" />
              </button>
              <NotificationPanel
                open={notificationsOpen}
                onClose={() => setNotificationsOpen(false)}
                go={go}
              />
            </span>
            <button type="button" className="topbar-avatar" aria-label="Open your profile" onClick={() => go('profile')}>{userInitials}</button>
          </div>
        </header>

        {toast && <div className="app-toast" role="status">{toast}</div>}

        <LazyRoute>
        {activeScreen === 'dashboard' && (
          <Dashboard
            go={go}
            user={user}
            learningSpace={learningSpaces?.active_space || null}
            onOpenWorkspace={() => go('workspace')}
            onOpenSearch={(query) => { void openSearchResults(query); }}
          />
        )}
        {activeScreen === 'assistant' && <Assistant go={go} selectedQuestion={selectedQuestion} messages={chatMessages} onMessagesChange={updatePrivateMessages} user={user} onOpenSearch={focusGlobalSearch} />}
        {activeScreen === 'upload' && <Upload go={go} user={user} archiveName={verifiedSpace?.slug === 'ksa' ? 'KSA' : verifiedSpace?.slug === 'cu' ? 'CU' : verifiedSpace?.name || 'your learning space'} queuedUpload={queuedUpload} onQueuedUploadStored={() => setQueuedUpload(null)} />}
        {activeScreen === 'offline' && (
          <Offline
            go={go}
             onOpenSearch={(query) => { void openSearchResults(query); }}
            onOpenConversation={(saved) => { setChatMessages(saved); setMaxeOpen(true); }}
            onOpenResource={(kind, id) => { setWorkspaceTarget({ kind, id }); go('workspace'); }}
            onReviewUpload={upload => { setQueuedUpload(upload); go('upload'); }}
          />
        )}
        {activeScreen === 'collab' && <Collab go={go} user={user} initialContext={discussionContext} initialThreadId={sharedThreadIdFromPath()} onClearSharedThread={clearSharedThreadUrl} />}
        {activeScreen === 'practice' && <Practice initialTopic={practiceInitialTopic} initialContext={practiceContext} />}
        {activeScreen === 'progress' && <Progress go={go} userId={user?.id ?? null} onPracticeTopic={topic => handleGoToPractice(topic, { query: topic, topic })} />}
        {activeScreen === 'groups' && <StudyGroups go={go} notifyUnavailable={notifyUnavailable} user={user} initialContext={groupContext} initialGroupId={communityTarget?.kind === 'study_group' ? communityTarget.id : null} initialSessionId={communityTarget?.kind === 'reading_room' ? communityTarget.id : null} onCommunityTargetHandled={() => setCommunityTarget(null)} />}
        {profileNudgeVisible && <div className="profile-nudge" role="status"><span><strong>Your desk can know you better.</strong><small>Add your department, level or courses for more useful recommendations.</small></span><button type="button" onClick={() => { setOnboardingReturnScreen('dashboard'); setEditingProfile(true); setProfileNudgeVisible(false); setActiveScreen('onboarding'); }}>Finish profile</button><button type="button" className="profile-nudge-dismiss" aria-label="Dismiss profile reminder" onClick={() => { localStorage.setItem('exammind-profile-nudge-dismissed', 'true'); setProfileNudgeVisible(false); }}>×</button></div>}
        {activeScreen === 'settings' && <Settings go={go} user={user} focusFeedback={settingsFocus === 'feedback'} profileEditLabel={verifiedSpace?.slug === 'ksa' ? 'Edit KSA learning preferences →' : undefined} onEditProfile={() => { setOnboardingSpace(verifiedSpace?.slug === 'ksa' ? verifiedSpace : null); setOnboardingReturnScreen('settings'); setEditingProfile(true); setActiveScreen('onboarding'); }} onAccountDeactivated={handleAccountDeactivated} onAccountDeletionScheduled={handleAccountDeletionScheduled} onAccountLifecycleCleanupPending={handleAccountLifecycleCleanupPending} onRestartOnboarding={() => void handleRestartOnboarding()} />}
        {activeScreen === 'profile' && <Profile go={go} user={user} username={profileUsername} learningSpaceSlug={verifiedSpace?.slug} />}
        {activeScreen === 'workspace' && <Workspace go={go} initialResource={workspaceTarget} notifyUnavailable={notifyUnavailable} messages={chatMessages} onMessagesChange={updatePrivateMessages} onNewThread={() => { setChatMessages(INITIAL_CHAT); setSelectedQuestion(''); }} user={user} />}
        {activeScreen === 'moderation' && canModerate && <Moderation go={go} isGlobalAdmin={hasAdminPortalAccess} />}
        {activeScreen === 'admin' && hasAdminPortalAccess && <AdminDashboard go={go} user={user} onOpenFeedback={openAdminFeedback} />}
        {activeScreen === 'admin' && !hasAdminPortalAccess && (
          <div className="account-bootstrap" role="alert">
            <div className="account-bootstrap-card">
              <div className="account-bootstrap-mark"><Logo size={30} /></div>
              <p className="account-bootstrap-kicker">EXAMMIND / ADMIN DESK</p>
              <h1>Admin access is not available.</h1>
              <p>This account is signed in, but it is not registered for the global admin portal. KSA membership does not grant global admin access.</p>
              <div className="account-bootstrap-actions">
                <button type="button" className="account-bootstrap-action account-bootstrap-action-primary" onClick={() => go('dashboard')}>Return to my desk</button>
              </div>
            </div>
          </div>
        )}
        {activeScreen === 'search' && (
          <SearchResults
            query={submittedQuery}
            result={submittedResult}
            loading={submittedLoading}
            error={submittedError}
            onRetry={() => { void openSearchResults(submittedQuery); }}
            onAskAI={askAIFromSearch}
            onUpload={() => go('upload')}
            onOpenResource={(kind, id) => { setWorkspaceTarget({ kind, id }); go('workspace'); }}
            onPractice={(topic, context) => { handleGoToPractice(topic, context); }}
            onCommunityAction={handleCommunityAction}
            onOpenCommunity={openCommunityResult}
            go={go}
          />
        )}
        </LazyRoute>
      </main>

      <MaxeTrigger ref={maxeTriggerRef} open={maxeOpen} onOpen={() => { setSidebarOpen(false); setMaxeOpen(true); }} />
      {maxeOpen && (
        <LazyRoute>
          <MaxeWorkspace
            go={go}
            selectedQuestion={selectedQuestion}
            messages={chatMessages}
            onMessagesChange={updatePrivateMessages}
            onNewThread={() => { setChatMessages(INITIAL_CHAT); setSelectedQuestion(''); }}
            onClose={closeMaxe}
            user={user}
          />
        </LazyRoute>
      )}

      {sidebarOpen && (
        <section
          className="mobile-nav-sheet"
          id="mobile-nav-sheet"
          role="dialog"
          aria-modal="true"
          aria-label="All ExamMind destinations"
        >
          <header className="mobile-nav-sheet-head">
            <div>
              <span className="mobile-nav-sheet-mark">E</span>
              <strong>Navigate</strong>
            </div>
            <button
              type="button"
              ref={mobileMenuCloseRef}
              onClick={() => {
                setSidebarOpen(false);
                mobileMenuButtonRef.current?.focus();
              }}
              aria-label="Close navigation"
            >
              <XIcon aria-hidden="true" weight="regular" />
            </button>
          </header>
          <div className="mobile-nav-sheet-groups">
            {visibleNavGroups.map((group) => (
              <div className="mobile-nav-sheet-group" key={`mobile-${group.label}`}>
                <p>{group.label}</p>
                <div>
                  {group.items.map((item) => {
                    const Icon = item.icon;
                    const isActive = activeScreen === item.screen;
                    return (
                      <button
                        type="button"
                        className={isActive ? 'is-active' : ''}
                        onClick={() => go(item.screen)}
                        aria-current={isActive ? 'page' : undefined}
                        key={`mobile-sheet-${item.screen}`}
                      >
                        <Icon aria-hidden="true" weight={isActive ? 'regular' : 'light'} />
                        <span>{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          <footer className="mobile-nav-sheet-account">
            <span className="ava">{userInitials}</span>
            <span><strong>{user?.name ?? 'Student'}</strong><small>{user?.username ? `@${user.username}` : 'Account'}</small></span>
            <div className="mobile-nav-sheet-account-actions">
              <button
                type="button"
                className={activeScreen === 'settings' ? 'is-active' : ''}
                onClick={() => go('settings')}
                aria-current={activeScreen === 'settings' ? 'page' : undefined}
              >
                <GearSixIcon aria-hidden="true" weight={activeScreen === 'settings' ? 'regular' : 'light'} /> Settings
              </button>
              <button type="button" onClick={handleLogout}><SignOutIcon aria-hidden="true" weight="light" /> Log out</button>
            </div>
          </footer>
        </section>
      )}

      <nav className="mob-nav" aria-label="Mobile navigation">
        <div className="mob-tabs">
          {MOBILE_NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeScreen === item.screen;
            return (
              <button
                type="button"
                className={`mob-tab ${isActive ? 'on' : ''}`}
                onClick={() => go(item.screen)}
                aria-current={isActive ? 'page' : undefined}
                key={item.screen}
              >
                <Icon className="mob-tab-ico" aria-hidden="true" weight={isActive ? 'regular' : 'light'} />
                <span>{item.label}</span>
              </button>
            );
          })}
          <button
            type="button"
            className={`mob-tab ${isMobileMoreActive || sidebarOpen ? 'on' : ''}`}
            onClick={() => setSidebarOpen(true)}
            aria-label="Open all navigation"
            aria-expanded={sidebarOpen}
            aria-controls="mobile-nav-sheet"
          >
            <DotsThreeIcon className="mob-tab-ico" aria-hidden="true" weight={isMobileMoreActive || sidebarOpen ? 'regular' : 'light'} />
            <span>More</span>
          </button>
        </div>
      </nav>
    </div>
  );
}
