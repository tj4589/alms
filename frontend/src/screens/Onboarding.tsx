import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, Check, CircleUserRound, Compass, LoaderCircle, RotateCw, Sparkles, UsersRound } from 'lucide-react';
import { apiGet, apiPost, apiPut } from '../lib/api';
import type { Course } from '../types';
import Logo from '../components/Logo';
import './Onboarding.css';

type AcademicProfile = {
  preferred_name: string | null;
  username: string | null;
  department: string | null;
  level: string | null;
  semester: string | null;
  interests: string[];
  courses: Course[];
};

type AcademicOption = { value: string; label: string };
type AcademicOptions = { departments: AcademicOption[]; levels: AcademicOption[] };

type Props = {
  userName: string;
  onComplete: () => void;
  onCancel?: () => void;
  onLogout: () => void;
  isEditing?: boolean;
};

type Step = 0 | 1 | 2;
type CourseState = 'loading' | 'ready' | 'empty' | 'error';

const FALLBACK_LEVELS: AcademicOption[] = [
  { value: '100', label: '100 level' },
  { value: '200', label: '200 level' },
  { value: '300', label: '300 level' },
  { value: '400', label: '400 level' },
  { value: '500', label: '500 level' },
  { value: 'postgraduate', label: 'Postgraduate' },
];

function normaliseUsername(value: string): string {
  return value.toLowerCase().replace(/^@+/, '').replace(/[^a-z0-9_]/g, '').slice(0, 24);
}

function normaliseLevel(value: string | null): string {
  const text = (value || '').trim().toLowerCase();
  const match = text.match(/^(100|200|300|400|500)/);
  return match?.[1] || (text === 'postgraduate' ? 'postgraduate' : '');
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export default function Onboarding({ userName, onComplete, onCancel, onLogout, isEditing = false }: Props) {
  const [step, setStep] = useState<Step>(isEditing ? 1 : 0);
  const [courses, setCourses] = useState<Course[]>([]);
  const [options, setOptions] = useState<AcademicOptions>({ departments: [], levels: FALLBACK_LEVELS });
  const [name, setName] = useState(userName);
  const [username, setUsername] = useState('');
  const [department, setDepartment] = useState('');
  const [level, setLevel] = useState('');
  const [courseIds, setCourseIds] = useState<number[]>([]);
  const [courseSearch, setCourseSearch] = useState('');
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileError, setProfileError] = useState('');
  const [coursesState, setCoursesState] = useState<CourseState>('loading');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const firstFieldRef = useRef<HTMLInputElement | null>(null);

  const loadCourses = useCallback(async () => {
    setCoursesState('loading');
    try {
      const data = await apiGet('/courses');
      const nextCourses = data as Course[];
      setCourses(nextCourses);
      setCoursesState(nextCourses.length ? 'ready' : 'empty');
    } catch {
      setCoursesState('error');
    }
  }, []);

  const loadProfile = useCallback(async () => {
    setProfileLoading(true);
    setProfileError('');
    try {
      const [profileData, optionsData] = await Promise.all([
        apiGet('/community/profile'),
        apiGet('/community/academic-options'),
      ]);
      const profile = profileData as AcademicProfile;
      const academicOptions = optionsData as AcademicOptions;
      setName(profile.preferred_name || userName);
      setUsername(normaliseUsername(profile.username || ''));
      const departmentOption = academicOptions.departments.find((item) => item.value === profile.department);
      setDepartment(departmentOption?.label || profile.department || '');
      setLevel(normaliseLevel(profile.level));
      setCourseIds((profile.courses || []).map((course) => course.id));
      setOptions({
        departments: academicOptions.departments || [],
        levels: academicOptions.levels?.length ? academicOptions.levels : FALLBACK_LEVELS,
      });
    } catch (loadError) {
      setProfileError(errorText(loadError, 'We could not load your setup yet.'));
    } finally {
      setProfileLoading(false);
    }
  }, [userName]);

  useEffect(() => {
    void Promise.all([loadProfile(), loadCourses()]);
  }, [loadCourses, loadProfile]);

  useEffect(() => {
    if (step === 0 || profileLoading || profileError) return;
    const frame = window.requestAnimationFrame(() => firstFieldRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [profileError, profileLoading, step]);

  const visibleCourses = useMemo(() => {
    const query = courseSearch.trim().toLowerCase();
    const departmentQuery = department.trim().toLowerCase();
    const levelQuery = level.replace(/\D/g, '');
    const recommended = courses.filter((course) => {
      const courseDepartment = (course.department || '').toLowerCase();
      const departmentMatches = !departmentQuery || !courseDepartment || courseDepartment.includes(departmentQuery);
      const levelMatches = !levelQuery || !course.level || course.level.includes(levelQuery);
      return departmentMatches && levelMatches;
    });
    const source = recommended.length ? recommended : courses;
    return source.filter((course) => !query || `${course.code} ${course.name}`.toLowerCase().includes(query)).slice(0, 18);
  }, [courseSearch, courses, department, level]);

  const toggleCourse = (courseId: number) => {
    setCourseIds((current) => current.includes(courseId)
      ? current.filter((id) => id !== courseId)
      : [...current, courseId]);
  };

  const validateIdentity = () => {
    if (name.trim().length < 2) {
      setError('Add the name you want your classmates to see.');
      firstFieldRef.current?.focus();
      return false;
    }
    if (!/^[a-z0-9_]{3,24}$/.test(username.trim().toLowerCase())) {
      setError('Choose a username with 3-24 lowercase letters, numbers, or underscores.');
      document.getElementById('onboarding-username')?.focus();
      return false;
    }
    setError('');
    return true;
  };

  const goNext = () => {
    if (step === 1 && !validateIdentity()) return;
    setError('');
    setStep((current) => Math.min(2, current + 1) as Step);
  };

  const goBack = () => {
    setError('');
    setStep((current) => Math.max(isEditing ? 1 : 0, current - 1) as Step);
  };

  const saveProfile = async () => {
    if (!validateIdentity()) {
      setStep(1);
      return;
    }
    setSaving(true);
    setError('');
    const payload = {
      preferred_name: name.trim(),
      username: username.trim().toLowerCase(),
      department: department.trim() || null,
      level: level || null,
      course_ids: courseIds,
      ...(isEditing ? {} : { complete: true }),
    };
    try {
      if (isEditing) await apiPut('/community/profile', payload);
      else await apiPost('/community/onboarding', payload);
      onComplete();
    } catch (saveError) {
      const message = errorText(saveError, 'Your profile could not be saved.');
      if (message.toLowerCase().includes('username')) {
        setStep(1);
        document.getElementById('onboarding-username')?.focus();
      }
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  const skipOnboarding = async () => {
    if (isEditing) {
      onCancel?.();
      return;
    }
    setSaving(true);
    setError('');
    try {
      await apiPost('/community/onboarding/skip', {});
      onComplete();
    } catch (skipError) {
      setError(errorText(skipError, 'We could not save that choice. Please try again.'));
    } finally {
      setSaving(false);
    }
  };

  const submitStep = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (step === 1) goNext();
    else void saveProfile();
  };

  const retryProfile = () => {
    void loadProfile();
    void loadCourses();
  };

  return (
    <main className="onboarding-shell">
      <div className="onboarding-frame">
        <header className="onboarding-topline">
          <div className="onboarding-brand" aria-label="ExamMind"><Logo size={28} /><span>Exam<span>Mind.</span></span></div>
          <div className="onboarding-top-actions">{step > 0 && <span className="onboarding-time">A quick two-step setup</span>}<button type="button" className="onboarding-logout" onClick={onLogout}>Log out</button></div>
        </header>

        <div className="onboarding-layout">
          <aside className="onboarding-side" aria-label="ExamMind welcome">
            <div className="onboarding-side-art" aria-hidden="true"><div className="onboarding-art-note"><BookOpen size={18} /><span>your desk</span><strong>ready when you are</strong></div><div className="onboarding-art-line onboarding-art-line-one" /><div className="onboarding-art-line onboarding-art-line-two" /><div className="onboarding-art-dot"><Sparkles size={16} /></div></div>
            <div className="onboarding-side-copy"><p>Less cramming.</p><p><em>More “getting it.”</em></p><span>Make a study desk that knows what matters to you, then keep moving.</span></div>
            <div className="onboarding-side-points"><span><CircleUserRound size={16} /> Your name, your way</span><span><UsersRound size={16} /> Better study circles</span><span><Sparkles size={16} /> More useful next steps</span></div>
          </aside>

          <section className="onboarding-main" aria-labelledby="onboarding-title">
            {step > 0 && <div className="onboarding-progress" aria-label={`Onboarding step ${step} of 2`}><div className="onboarding-progress-meta"><span>{isEditing ? 'Academic profile' : 'Make the desk yours'}</span><strong>{step} of 2</strong></div><div className="onboarding-progress-track"><span style={{ width: `${step * 50}%` }} /></div></div>}

            {profileLoading ? (
              <div className="onboarding-status" role="status"><LoaderCircle size={20} className="onboarding-spin" /><h1 id="onboarding-title">Bringing your desk into focus.</h1><p>One moment while we load the details from your sign-in.</p></div>
            ) : profileError ? (
              <div className="onboarding-status onboarding-status-error" role="alert"><div className="onboarding-step-icon"><RotateCw size={22} /></div><h1 id="onboarding-title">We hit a small pause.</h1><p>{profileError}</p><button type="button" className="onboarding-submit" onClick={retryProfile}><RotateCw size={16} /> Try again</button></div>
            ) : step === 0 ? (
              <div className="onboarding-step onboarding-welcome"><div className="onboarding-step-icon" aria-hidden="true"><Sparkles size={24} /></div><span className="onboarding-step-label">Your first page</span><h1 id="onboarding-title">Welcome to ExamMind.</h1><p className="onboarding-welcome-line">Less cramming. <em>More “getting it.”</em></p><p className="onboarding-lede">A few details help us make your workspace feel like yours. You can skip this and come back whenever you are ready.</p><div className="onboarding-promises" aria-label="What setup includes"><span><CircleUserRound size={17} /> Name and username</span><span><BookOpen size={17} /> Your study context</span><span><Compass size={17} /> Useful recommendations</span></div><div className="onboarding-welcome-actions"><button type="button" className="onboarding-submit" onClick={() => setStep(1)}>Let’s make it yours <ArrowRight size={17} aria-hidden="true" /></button><button type="button" className="onboarding-skip" onClick={() => void skipOnboarding()} disabled={saving}>{saving ? 'Saving…' : 'Skip for now'}</button></div></div>
            ) : (
              <form className="onboarding-step" onSubmit={submitStep}>
                {step === 1 && <><span className="onboarding-step-label">Step one · identity</span><h1 id="onboarding-title">What should we call you?</h1><p className="onboarding-lede">Use your full name or a preferred name. Your classmates will see this in discussions and study groups.</p><label className="onboarding-field onboarding-field-large" htmlFor="onboarding-name"><span>Name you want to use</span><input ref={firstFieldRef} id="onboarding-name" value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" required minLength={2} maxLength={120} aria-invalid={Boolean(error && name.trim().length < 2)} /><small>{name ? 'You can change this any time.' : 'We prefilled this from your sign-in.'}</small></label><label className="onboarding-field onboarding-handle-field" htmlFor="onboarding-username"><span>Username <em>Required</em></span><div className="onboarding-input-prefix"><b>@</b><input id="onboarding-username" value={username} onChange={(event) => setUsername(normaliseUsername(event.target.value))} autoComplete="username" required minLength={3} maxLength={24} placeholder="your_study_handle" aria-describedby="onboarding-username-help" /></div><small id="onboarding-username-help">3–24 lowercase letters, numbers, or underscores. It helps classmates recognise you.</small></label><div className="onboarding-hint"><Check size={16} aria-hidden="true" /><span>Your name and handle are separate, so you can choose how you show up.</span></div></>}

                {step === 2 && <><span className="onboarding-step-label">Step two · personalise</span><h1 id="onboarding-title">Give your desk some context.</h1><p className="onboarding-lede">These details help ExamMind recommend useful materials, discussions and study groups. You can skip them now and edit them later.</p><div className="onboarding-context-grid"><label className="onboarding-field" htmlFor="onboarding-department"><span>Department <em>Optional</em></span><input ref={firstFieldRef} id="onboarding-department" list="onboarding-departments" value={department} onChange={(event) => setDepartment(event.target.value)} placeholder="Search your department" /><datalist id="onboarding-departments">{options.departments.map((item) => <option key={item.value} value={item.label} />)}</datalist></label><label className="onboarding-field" htmlFor="onboarding-level"><span>Level <em>Optional</em></span><select id="onboarding-level" value={level} onChange={(event) => setLevel(event.target.value)}><option value="">Choose later</option>{options.levels.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label></div><div className="onboarding-why"><Compass size={19} aria-hidden="true" /><div><strong>Why this helps</strong><p>When your semester changes, update these details and the workspace can tune what it puts in front of you. Nothing here blocks your desk.</p></div></div><fieldset className="onboarding-section"><legend>Courses on your desk <em>Optional · encouraged</em></legend><p className="onboarding-section-note">Pick what you are studying now. This is how recommendations become less random.</p>{coursesState === 'loading' && <p className="onboarding-loading"><LoaderCircle size={15} className="onboarding-spin" /> Loading the course catalogue…</p>}{coursesState === 'error' && <div className="onboarding-course-message onboarding-course-message-error"><p>We could not reach the course catalogue right now. You can add courses later.</p><button type="button" className="onboarding-inline-button" onClick={() => void loadCourses()}><RotateCw size={14} /> Retry</button></div>}{coursesState === 'empty' && <p className="onboarding-empty">Course selection is not available yet. You can add courses later.</p>}{coursesState === 'ready' && <><label className="onboarding-course-search" htmlFor="onboarding-course-search"><span className="sr-only">Search courses</span><input id="onboarding-course-search" value={courseSearch} onChange={(event) => setCourseSearch(event.target.value)} placeholder="Search by code or course name" /></label><div className="course-options">{visibleCourses.map((course) => <label className={`course-option${courseIds.includes(course.id) ? ' is-selected' : ''}`} key={course.id}><input type="checkbox" checked={courseIds.includes(course.id)} onChange={() => toggleCourse(course.id)} /><span><strong>{course.code}</strong><small>{course.name}</small></span>{courseIds.includes(course.id) && <Check size={15} aria-hidden="true" />}</label>)}</div>{courseIds.length > 0 && <div className="selected-course-chips" aria-label="Selected courses">{courses.filter((course) => courseIds.includes(course.id)).map((course) => <span key={course.id}>{course.code}<button type="button" onClick={() => toggleCourse(course.id)} aria-label={`Remove ${course.code}`}>×</button></span>)}</div>}</>}</fieldset></>}

                {error && <p className="onboarding-error" role="alert">{error}</p>}<div className="onboarding-actions"><button type="button" className="onboarding-back" onClick={isEditing && step === 1 ? onCancel : goBack} disabled={saving}>{isEditing && step === 1 ? 'Cancel' : <><ArrowLeft size={16} aria-hidden="true" /> Back</>}</button><div className="onboarding-action-group">{!isEditing && <button type="button" className="onboarding-skip" onClick={() => void skipOnboarding()} disabled={saving}>Skip for now</button>}<button type="submit" className="onboarding-submit" disabled={saving}>{saving ? <><LoaderCircle size={17} className="onboarding-spin" /> Saving…</> : step === 1 ? <>Next <ArrowRight size={17} aria-hidden="true" /></> : <>{isEditing ? 'Save changes' : 'Open my desk'} <ArrowRight size={17} aria-hidden="true" /></>}</button></div></div>
              </form>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
