import { useEffect, useMemo, useState } from 'react';
import { apiGet, apiPost } from '../lib/api';
import type { Course } from '../types';
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

type Props = {
  userName: string;
  onComplete: () => void;
  onLogout: () => void;
  isEditing?: boolean;
};

const LEVELS = ['100 level', '200 level', '300 level', '400 level', '500 level', 'Postgraduate'];

export default function Onboarding({ userName, onComplete, onLogout, isEditing = false }: Props) {
  const [courses, setCourses] = useState<Course[]>([]);
  const [name, setName] = useState(userName);
  const [username, setUsername] = useState('');
  const [department, setDepartment] = useState('');
  const [level, setLevel] = useState('');
  const [courseIds, setCourseIds] = useState<number[]>([]);
  const [interests, setInterests] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      apiGet('/courses').then((data) => { if (!cancelled) setCourses(data as Course[]); }),
      apiGet('/community/profile').then((data) => {
        if (cancelled) return;
        const profile = data as AcademicProfile;
        setName(profile.preferred_name || userName);
        setUsername(profile.username || '');
        setDepartment(profile.department || '');
        setLevel(profile.level || '');
        setCourseIds(profile.courses.map((course) => course.id));
        setInterests(profile.interests.join(', '));
      }).catch(() => undefined),
    ]).catch(() => undefined).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [userName]);

  const selectedLabel = useMemo(() => {
    const labels = courses.filter((course) => courseIds.includes(course.id)).map((course) => course.code);
    return labels.length ? labels.join(', ') : 'No courses selected yet';
  }, [courses, courseIds]);

  const toggleCourse = (courseId: number) => {
    setCourseIds((current) => current.includes(courseId)
      ? current.filter((id) => id !== courseId)
      : [...current, courseId]);
  };

  const save = async (complete: boolean) => {
    if (complete && name.trim().length < 2) {
      setError('Add the name you want classmates to see.');
      return;
    }
    if (username && !/^[a-z0-9_]{3,24}$/.test(username.trim().toLowerCase())) {
      setError('Username must be 3–24 lowercase letters, numbers, or underscores.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await apiPost('/community/onboarding', {
        preferred_name: name.trim(),
        username: username.trim().toLowerCase() || null,
        department: department.trim() || null,
        level: level || null,
        course_ids: courseIds,
        interests: interests.split(',').map((item) => item.trim()).filter(Boolean),
        complete,
      });
      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Your profile could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="onboarding-shell">
      <div className="onboarding-paper">
        <div className="onboarding-kicker">ExamMind / first page</div>
        <div className="onboarding-topline">
          <div className="logo-name onboarding-logo">Exam<span>Mind.</span></div>
          <button type="button" className="onboarding-logout" onClick={onLogout}>Log out</button>
        </div>
        <div className="onboarding-intro">
          <p className="onboarding-label">{isEditing ? 'Academic profile' : 'Make the workspace yours'}</p>
          <h1>{isEditing ? 'Keep your study context current.' : 'Tell us where you’re studying.'}</h1>
          <p>These details help ExamMind put the right groups, discussions, and rooms in front of you. You can edit them later.</p>
        </div>

        {loading ? <p className="onboarding-state">Loading your profile…</p> : (
          <form onSubmit={(event) => { event.preventDefault(); void save(true); }}>
            <div className="onboarding-grid">
              <label>
                <span>Preferred name</span>
                <input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" required />
              </label>
              <label>
                <span>Username <em>optional</em></span>
                <input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="e.g. ada_studies" autoComplete="username" />
              </label>
              <label>
                <span>Department <em>optional</em></span>
                <input value={department} onChange={(event) => setDepartment(event.target.value)} placeholder="e.g. Computer Science" />
              </label>
              <label>
                <span>Level <em>optional</em></span>
                <select value={level} onChange={(event) => setLevel(event.target.value)}>
                  <option value="">Choose later</option>
                  {LEVELS.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </label>
            </div>

            <fieldset className="onboarding-courses">
              <legend>What courses are on your desk?</legend>
              <p>Select at least one if you can — it makes recommendations feel useful from day one.</p>
              <div className="course-options">
                {courses.map((course) => (
                  <label className={`course-option${courseIds.includes(course.id) ? ' is-selected' : ''}`} key={course.id}>
                    <input type="checkbox" checked={courseIds.includes(course.id)} onChange={() => toggleCourse(course.id)} />
                    <span><strong>{course.code}</strong>{course.name && <small>{course.name}</small>}</span>
                  </label>
                ))}
              </div>
              {courses.length === 0 && <p className="onboarding-state">Courses will appear here once the catalogue is available.</p>}
              <div className="selected-courses">{selectedLabel}</div>
            </fieldset>

            <label className="onboarding-wide">
              <span>Interests <em>optional, comma separated</em></span>
              <input value={interests} onChange={(event) => setInterests(event.target.value)} placeholder="group projects, economics, past questions" />
            </label>

            {error && <p className="onboarding-error" role="alert">{error}</p>}
            <div className="onboarding-actions">
              <button type="button" className="onboarding-skip" onClick={() => void save(false)} disabled={saving}>Skip for now</button>
              <button type="submit" className="onboarding-submit" disabled={saving}>{saving ? 'Saving…' : isEditing ? 'Save profile →' : 'Enter my workspace →'}</button>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}
