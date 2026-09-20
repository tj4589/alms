import { useState, type FormEvent } from 'react';
import { ArrowRight, Check, MessageCircle, Send } from 'lucide-react';
import { apiPost } from '../lib/api';
import './FeedbackPanel.css';

export type FeedbackMode = 'public' | 'authenticated';

const CATEGORIES = [
  'I cannot sign in',
  'I am not a CU student',
  'I have a suggestion',
  'Something is broken',
  'Something felt confusing',
  'Something else',
] as const;

type FeedbackPanelProps = {
  mode: FeedbackMode;
};

function currentPagePath(): string {
  if (typeof window === 'undefined') return '/feedback';
  return window.location.pathname || '/';
}

export default function FeedbackPanel({ mode }: FeedbackPanelProps) {
  const isPublic = mode === 'public';
  const [category, setCategory] = useState('');
  const [message, setMessage] = useState('');
  const [guestName, setGuestName] = useState('');
  const [replyEmail, setReplyEmail] = useState('');
  const [rating, setRating] = useState<number | null>(null);
  const [honeypot, setHoneypot] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const resetForm = () => {
    setCategory('');
    setMessage('');
    setGuestName('');
    setReplyEmail('');
    setRating(null);
    setHoneypot('');
    setError('');
    setSubmitted(false);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanMessage = message.replace(/\r\n?/g, '\n').trim();
    if (!category) {
      setError('Choose the kind of feedback you want to share.');
      return;
    }
    if (cleanMessage.length < 10 || cleanMessage.length > 2000) {
      setError('Your message should be between 10 and 2,000 characters.');
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      const payload: Record<string, unknown> = {
        category,
        message: cleanMessage,
        rating,
        page_path: currentPagePath(),
      };
      if (isPublic) {
        payload.guest_name = guestName.trim() || null;
        payload.reply_email = replyEmail.trim().toLowerCase() || null;
        payload.website = honeypot;
      }
      await apiPost(isPublic ? '/feedback/public' : '/feedback', payload);
      setSubmitted(true);
    } catch (submissionError) {
      // Keep all entered values intact so a visitor can retry after a failed
      // network request or a temporarily unavailable API.
      setError(submissionError instanceof Error ? submissionError.message : 'We could not send that yet. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <section className="feedback-panel feedback-success" aria-live="polite">
        <div className="feedback-success-mark" aria-hidden="true"><Check size={23} strokeWidth={2.4} /></div>
        <p className="feedback-eyebrow">Message received</p>
        <h2>Thank you for noticing.</h2>
        <p>Your note is with the ExamMind team. Small observations help us make the study desk clearer for everyone.</p>
        <button className="feedback-secondary" type="button" onClick={resetForm}>Send another note <ArrowRight size={16} aria-hidden="true" /></button>
      </section>
    );
  }

  return (
    <section className={`feedback-panel${isPublic ? ' is-public' : ' is-authenticated'}`} aria-labelledby="feedback-panel-heading">
      <div className="feedback-panel-heading">
        <span className="feedback-icon" aria-hidden="true"><MessageCircle size={19} /></span>
        <div>
          <p className="feedback-eyebrow">{isPublic ? 'A note is enough' : 'Help shape ExamMind'}</p>
          <h2 id="feedback-panel-heading">{isPublic ? 'Tell us what you noticed.' : 'What could feel clearer?'}</h2>
        </div>
      </div>
      <p className="feedback-panel-intro">
        {isPublic
          ? 'You do not need an ExamMind account to share an idea or report a problem.'
          : 'Your verified ExamMind account is attached automatically. There is no need to repeat your name or email.'}
      </p>

      {error && <div className="feedback-error" role="alert">{error}</div>}

      <form className="feedback-form" onSubmit={(event) => void handleSubmit(event)}>
        <label className="feedback-field" htmlFor="feedback-category">
          <span>What is this about?</span>
          <select id="feedback-category" value={category} onChange={(event) => setCategory(event.target.value)} required>
            <option value="" disabled>Choose a category</option>
            {CATEGORIES.map((item) => <option value={item} key={item}>{item}</option>)}
          </select>
        </label>

        {category === 'I am not a CU student' && (
          <p className="feedback-context-note">Tell us why you would like access. We cannot promise that access will be granted, but your context is useful.</p>
        )}

        <label className="feedback-field" htmlFor="feedback-message">
          <span>Your message</span>
          <textarea id="feedback-message" value={message} onChange={(event) => setMessage(event.target.value)} placeholder="What happened, what were you trying to do, or what would make it better?" minLength={10} maxLength={2000} rows={7} required />
          <small>{message.length.toLocaleString()} / 2,000 characters</small>
        </label>

        {isPublic && (
          <div className="feedback-optional-grid">
            <label className="feedback-field" htmlFor="feedback-name">
              <span>Name <em>Optional</em></span>
              <input id="feedback-name" type="text" value={guestName} onChange={(event) => setGuestName(event.target.value)} placeholder="What should we call you?" maxLength={120} autoComplete="name" />
            </label>
            <label className="feedback-field" htmlFor="feedback-email">
              <span>Reply email <em>Optional</em></span>
              <input id="feedback-email" type="email" value={replyEmail} onChange={(event) => setReplyEmail(event.target.value)} placeholder="you@example.com" maxLength={254} autoComplete="email" />
            </label>
          </div>
        )}

        {isPublic && <p className="feedback-email-note">Your email is optional. Add it only if you would like a response.</p>}

        <fieldset className="feedback-rating">
          <legend>How did this feel? <em>Optional</em></legend>
          <div className="feedback-rating-options">
            {[1, 2, 3, 4, 5].map((value) => (
              <button key={value} type="button" className={rating === value ? 'is-selected' : ''} aria-pressed={rating === value} aria-label={`${value} out of 5`} onClick={() => setRating(rating === value ? null : value)}>{value}</button>
            ))}
          </div>
          <span className="feedback-rating-caption">1 · difficult &nbsp;&nbsp; 5 · excellent</span>
        </fieldset>

        {isPublic && (
          <div className="feedback-honeypot" aria-hidden="true">
            <label htmlFor="feedback-website">Website</label>
            <input id="feedback-website" name="website" value={honeypot} onChange={(event) => setHoneypot(event.target.value)} tabIndex={-1} autoComplete="off" />
          </div>
        )}

        <button className="feedback-submit" type="submit" disabled={submitting}>
          <Send size={16} aria-hidden="true" />
          {submitting ? 'Sending...' : 'Send feedback'}
        </button>
      </form>
    </section>
  );
}
