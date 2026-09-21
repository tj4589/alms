import { useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Logo from './Logo';
import MakerTag from './MakerTag';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUpRight, BookOpen, Check, CheckCheck, ChevronDown, FileText, GraduationCap, Layers, Menu, Search, ShieldCheck, Sparkles, Upload, X } from 'lucide-react';
import '@fontsource-variable/outfit';
import './Landing.css';

gsap.registerPlugin(ScrollTrigger, useGSAP);

type LandingProps = { onGetStarted: () => void; onSignIn: () => void; onPrivacy: () => void; onFeedback: () => void; deletionNotice?: string };
type DeviceOrientationWithPermission = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<'granted' | 'denied' | 'default'>;
};
const asset = (name: string) => `/images/landing/${name}.jpg`;
const examples = [
  { label: 'Project management', question: 'What is the critical path method?', answer: 'The critical path is the longest sequence of dependent activities in a project. It determines the earliest possible finish date.', source: 'Project Management Notes', topic: 'Scheduling methods', excerpt: 'Activities on the critical path have zero total float. A delay to any of these activities delays the project completion date.' },
  { label: 'Economics', question: 'Why does opportunity cost matter?', answer: 'Opportunity cost is the value of the next-best alternative you give up when making a choice. It helps you compare how to use scarce resources.', source: 'Introduction to Economics', topic: 'Scarcity and choice', excerpt: 'Because resources are limited, choosing one use means giving up another. The best alternative forgone is the opportunity cost.' },
  { label: 'Biology', question: 'How are mitosis and meiosis different?', answer: 'Mitosis produces two cells with the same chromosome number as the parent. Meiosis produces four cells with half the chromosome number.', source: 'Cell Biology Notes', topic: 'Cell division', excerpt: 'Mitosis involves one division for growth and repair. Meiosis involves two divisions and produces haploid cells for sexual reproduction.' },
];
const scenarios = [
  { title: 'For the “where did I save that?” moments.', body: 'That lecture slide. That past question. That concept you almost remember. Bring them into one searchable study archive.', image: 'reading-room-study', alt: 'Two students studying together with a laptop and open books', link: 'Bring your notes together' },
  { title: 'For the topic that finally clicks.', body: 'Ask a question in your own words. Follow the explanation back to your course material, and keep going until it makes sense.', image: 'campus-study', alt: 'Student wearing earphones and studying at an outdoor campus table', link: 'Find your next lightbulb moment' },
  { title: 'For a little more “I’ve got this.”', body: 'Turn your past questions into focused practice. See which topics need another look before the real exam arrives.', image: 'focused-study', alt: 'University student taking notes in a bright shared study space', link: 'Make room for practice' },
];
const navLinks = [{ href: '#capabilities', label: 'Why ExamMind' }, { href: '#workflow', label: 'How it works' }, { href: '#integrity', label: 'Your sources' }];
const feedbackNavLink = { href: '/feedback', label: 'Feedback' };

function Brand() {
  return <><span className="lp-brand-mark" aria-hidden="true"><Logo size={26} /></span><span>Exam<span className="lp-brand-dot">Mind.</span></span></>;
}

export default function Landing({ onGetStarted, onSignIn, onPrivacy, onFeedback, deletionNotice }: LandingProps) {
  const root = useRef<HTMLElement>(null);
  const waterCanvas = useRef<HTMLCanvasElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const [activeNav, setActiveNav] = useState<string | null>(null);
  const navPulseTimer = useRef<number | null>(null);
  const [exampleIndex, setExampleIndex] = useState(0);
  const [scenarioIndex, setScenarioIndex] = useState(0);
  const [sourceOpen, setSourceOpen] = useState(false);
  const example = examples[exampleIndex];
  const scenario = scenarios[scenarioIndex];

  useEffect(() => {
    const canvas = waterCanvas.current;
    const stage = canvas?.closest<HTMLElement>('.lp-hero');
    const surface = canvas?.parentElement;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (!canvas || !stage || !surface || reduceMotion.matches) return;

    const context = canvas.getContext('2d');
    if (!context) return;

    type Ripple = { x: number; y: number; radius: number; life: number; force: number };
    const ripples: Ripple[] = [];
    let frame = 0;
    let width = 0;
    let height = 0;
    let lastX = -100;
    let lastY = -100;

    const resize = () => {
      const bounds = surface.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
      width = bounds.width;
      height = bounds.height;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    const addRipple = (x: number, y: number, force = 1) => {
      ripples.push({ x, y, radius: force > 1 ? 7 : 3, life: 1, force });
      if (ripples.length > 8) ripples.shift();
    };

    const pointFromEvent = (event: PointerEvent) => {
      const bounds = canvas.getBoundingClientRect();
      return {
        x: ((event.clientX - bounds.left) / bounds.width) * width,
        y: ((event.clientY - bounds.top) / bounds.height) * height,
      };
    };

    const move = (event: PointerEvent) => {
      const { x, y } = pointFromEvent(event);
      if (Math.hypot(x - lastX, y - lastY) > 52) {
        addRipple(x, y, event.pointerType === 'touch' ? 1.05 : 0.52);
        lastX = x;
        lastY = y;
      }
    };

    const press = (event: PointerEvent) => {
      const { x, y } = pointFromEvent(event);
      addRipple(x, y, 1.65);
    };

    const draw = (time: number) => {
      context.clearRect(0, 0, width, height);

      // Two quiet highlights suggest a surface without turning into stripes.
      context.save();
      context.lineWidth = 1;
      for (let line = 0; line < 2; line += 1) {
        const y = height * (0.36 + line * 0.25);
        context.beginPath();
        for (let x = -20; x <= width + 20; x += 16) {
          const wave = Math.sin(x * 0.012 + time * 0.00035 + line * 1.7) * (4 + line * 0.7);
          if (x === -20) context.moveTo(x, y + wave);
          else context.lineTo(x, y + wave);
        }
        context.strokeStyle = `rgba(190, 132, 88, ${0.018 + line * 0.004})`;
        context.stroke();
      }
      context.restore();

      for (let index = ripples.length - 1; index >= 0; index -= 1) {
        const ripple = ripples[index];
        ripple.radius += 1.2 + ripple.force * 0.5;
        ripple.life -= 0.018 / Math.max(ripple.force, 0.55);
        const fade = Math.max(0, ripple.life);

        context.save();
        context.translate(ripple.x, ripple.y);
        context.scale(1, 0.42);
        context.lineWidth = 1.15 / Math.max(fade, 0.3);
        context.shadowBlur = 5;
        context.shadowColor = `rgba(180, 112, 72, ${fade * 0.08})`;
        for (let ring = 0; ring < 2; ring += 1) {
          const radius = Math.max(1, ripple.radius - ring * 15);
          context.beginPath();
          context.arc(0, 0, radius, 0, Math.PI * 2);
          context.strokeStyle = `rgba(166, 105, 69, ${fade * (0.105 - ring * 0.035) * ripple.force})`;
          context.stroke();
        }
        context.restore();

        if (ripple.life <= 0) ripples.splice(index, 1);
      }

      frame = window.requestAnimationFrame(draw);
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(surface);
    stage.addEventListener('pointermove', move, { passive: true });
    stage.addEventListener('pointerdown', press, { passive: true });
    frame = window.requestAnimationFrame(draw);

    return () => {
      observer.disconnect();
      stage.removeEventListener('pointermove', move);
      stage.removeEventListener('pointerdown', press);
      window.cancelAnimationFrame(frame);
    };
  }, []);

  useGSAP(() => {
    const media = gsap.matchMedia();
    const page = root.current;
    if (!page) return;
    const documentRoot = document.documentElement;
    const hadLandingClass = documentRoot.classList.contains('lp-active');
    const previousRootBackground = documentRoot.style.backgroundColor;
    const previousBodyBackground = document.body.style.backgroundColor;
    const paintPageEdge = (color: string) => {
      documentRoot.style.backgroundColor = color;
      document.body.style.backgroundColor = color;
    };
    documentRoot.classList.add('lp-active');
    paintPageEdge('#f8f5ee');
    const updateNav = () => {
      setIsScrolled(window.scrollY > 48);
    };
    updateNav();
    window.addEventListener('scroll', updateNav, { passive: true });

    media.add('(prefers-reduced-motion: no-preference)', () => {
      // One shared canvas avoids hard seams between chapters. The foreground
      // switches at the luminance crossover, keeping readable contrast even
      // while the background scrubs through its midtones.
      const journey = page.querySelector<HTMLElement>('.lp-journey');
      const palette = ['#f8f5ee', '#eadbca', '#ac8b73', '#6c3e2e', '#282a24', '#191d19'];
      const shade = { value: 0 };
      const paintJourney = () => {
        if (!journey) return;
        const index = Math.min(Math.floor(shade.value), palette.length - 2);
        const color = gsap.utils.interpolate(palette[index], palette[index + 1], shade.value - index);
        const channels = gsap.utils.splitColor(color).slice(0, 3).map(channel => {
          const value = channel / 255;
          return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
        });
        const luminance = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
        const lightText = luminance < 0.179;
        const crossover = luminance > 0.13 && luminance < 0.3;
        const ink = lightText ? (crossover ? '#ffffff' : '#fffdf7') : (crossover ? '#000000' : '#191d19');
        journey.style.setProperty('--journey-bg', color);
        journey.style.setProperty('--journey-ink', ink);
        journey.style.setProperty('--journey-muted', crossover ? ink : lightText ? '#fff5e7' : '#252b24');
        journey.style.setProperty('--journey-accent', crossover ? ink : lightText ? '#e5edc6' : '#502716');
        paintPageEdge(color);
      };
      journey?.classList.add('is-animated');
      paintJourney();
      gsap.to(shade, { value: palette.length - 1, ease: 'none', onUpdate: paintJourney, scrollTrigger: { trigger: '.lp-journey', start: 'top 90%', end: 'bottom bottom', scrub: 0.45 } });
      gsap.fromTo('.lp-hero-collage', { y: 0 }, { y: -36, ease: 'none', scrollTrigger: { trigger: '.lp-hero', start: 'top top', end: 'bottom top', scrub: true } });
      gsap.fromTo('.lp-water-field', { y: -8, scale: 1 }, { y: 46, scale: 1.035, ease: 'none', scrollTrigger: { trigger: '.lp-hero', start: 'top top', end: 'bottom top', scrub: true } });
      gsap.fromTo('.lp-hero-shade', { opacity: 0 }, { opacity: 1, ease: 'none', scrollTrigger: { trigger: '.lp-hero', start: 'top top', end: 'bottom 24%', scrub: 0.35 } });
      gsap.fromTo('.lp-hero-copy, .lp-hero-collage', { opacity: 1 }, { opacity: 0.12, ease: 'none', scrollTrigger: { trigger: '.lp-hero', start: '42% top', end: 'bottom 32%', scrub: 0.3 } });
      gsap.fromTo('.lp-belief span', { opacity: 0.8 }, { opacity: 1, stagger: 0.12, ease: 'none', scrollTrigger: { trigger: '.lp-belief', start: 'top 82%', end: 'bottom 48%', scrub: true } });
      const desktop = gsap.matchMedia();
      desktop.add('(min-width: 901px)', () => {
        gsap.utils.toArray<HTMLElement>('.lp-step').slice(0, -1).forEach((card) => {
          gsap.to(card, { scale: 0.95, transformOrigin: 'center top', ease: 'none', scrollTrigger: { trigger: card, start: 'top 150px', end: 'bottom 140px', scrub: true } });
        });
      });
      // Do not gate this interaction on the hover/pointer media features. Some
      // desktop browsers, especially on touch-capable Windows machines and
      // hosted Chromium environments, report both as false while still
      // dispatching mouse pointer events. Reduced-motion is already handled by
      // the surrounding matchMedia scope; touch pointers are ignored below.
      const stage = page.querySelector<HTMLElement>('.lp-hero');
      const depth = page.querySelector<HTMLElement>('.lp-hero-depth');
      if (stage && depth) {
        const rotateX = gsap.quickTo(depth, 'rotationX', { duration: 0.7, ease: 'power3.out' });
        const rotateY = gsap.quickTo(depth, 'rotationY', { duration: 0.7, ease: 'power3.out' });
        const move = (event: PointerEvent) => {
          if (event.pointerType === 'touch') return;
          const bounds = stage.getBoundingClientRect();
          const px = (event.clientX - bounds.left) / bounds.width - 0.5;
          const py = (event.clientY - bounds.top) / bounds.height - 0.5;
          rotateX(3 - py * 9);
          rotateY(-6 + px * 13);
        };
        const reset = () => {
          rotateX(3);
          rotateY(-6);
        };
        let orientationListening = false;
        let baseBeta: number | null = null;
        let baseGamma: number | null = null;
        const tilt = (event: DeviceOrientationEvent) => {
          if (event.beta === null || event.gamma === null) return;
          if (baseBeta === null || baseGamma === null) {
            baseBeta = event.beta;
            baseGamma = event.gamma;
            return;
          }
          const betaDelta = Math.max(-24, Math.min(24, event.beta - baseBeta));
          const gammaDelta = Math.max(-24, Math.min(24, event.gamma - baseGamma));
          rotateX(3 - betaDelta * 0.28);
          rotateY(-6 + gammaDelta * 0.36);
        };
        let orientationRequestPending = false;
        const enableOrientation = async () => {
          if (orientationListening || orientationRequestPending || !('DeviceOrientationEvent' in window)) return;
          orientationRequestPending = true;
          const orientation = window.DeviceOrientationEvent as DeviceOrientationWithPermission;
          if (typeof orientation.requestPermission === 'function') {
            try {
              const permission = await orientation.requestPermission();
              if (permission !== 'granted') {
                orientationRequestPending = false;
                return;
              }
            } catch {
              orientationRequestPending = false;
              return;
            }
          }
          window.addEventListener('deviceorientation', tilt, { passive: true });
          orientationListening = true;
          orientationRequestPending = false;
        };
        const orientation = window.DeviceOrientationEvent as DeviceOrientationWithPermission | undefined;
        const needsGesture = typeof orientation?.requestPermission === 'function';
        if (needsGesture) stage.addEventListener('pointerdown', enableOrientation, { passive: true });
        else void enableOrientation();
        stage.addEventListener('pointermove', move);
        stage.addEventListener('pointerleave', reset);
        return () => {
          stage.removeEventListener('pointermove', move);
          stage.removeEventListener('pointerleave', reset);
          if (needsGesture) stage.removeEventListener('pointerdown', enableOrientation);
          if (orientationListening) window.removeEventListener('deviceorientation', tilt);
        };
      }
      return () => {
        desktop.revert();
        journey?.classList.remove('is-animated');
        ['--journey-bg', '--journey-ink', '--journey-muted', '--journey-accent'].forEach(property => journey?.style.removeProperty(property));
      };
    });
    return () => {
      media.revert();
      window.removeEventListener('scroll', updateNav);
      if (!hadLandingClass) documentRoot.classList.remove('lp-active');
      documentRoot.style.backgroundColor = previousRootBackground;
      document.body.style.backgroundColor = previousBodyBackground;
    };
  }, { scope: root });

  const start = () => { window.scrollTo({ top: 0, behavior: 'instant' }); onGetStarted(); };
  const signIn = () => { window.scrollTo({ top: 0, behavior: 'instant' }); onSignIn(); };
  const openFeedback = () => { setMenuOpen(false); onFeedback(); };
  const navigateTo = (event: ReactMouseEvent<HTMLAnchorElement>, href: string) => {
    event.preventDefault();
    const target = document.querySelector<HTMLElement>(href);
    if (!target) return;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setMenuOpen(false);
    setActiveNav(href);
    window.history.pushState(null, '', href);
    target.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });

    if (!reducedMotion) {
      let revealed = false;
      let fallback = 0;
      const reveal = () => {
        if (revealed) return;
        revealed = true;
        window.clearTimeout(fallback);
        window.removeEventListener('scrollend', reveal);
        target.querySelector<HTMLElement>('.lp-wrap')?.animate(
          [{ opacity: 0.68, transform: 'translateY(18px)' }, { opacity: 1, transform: 'translateY(0)' }],
          { duration: 560, easing: 'cubic-bezier(.23, 1, .32, 1)' },
        );
      };
      window.addEventListener('scrollend', reveal, { once: true });
      fallback = window.setTimeout(reveal, 900);
    }

    if (navPulseTimer.current) window.clearTimeout(navPulseTimer.current);
    navPulseTimer.current = window.setTimeout(() => setActiveNav(null), reducedMotion ? 250 : 1250);
  };

  return (
    <main className="lp" ref={root} id="home">
      {deletionNotice && <div className="lp-account-notice" role="status">{deletionNotice}</div>}
      <a href="#main-content" className="lp-skip">Skip to content</a>
      <header className={`lp-header${isScrolled ? ' is-scrolled' : ''}${menuOpen ? ' is-menu-open' : ''}`}>
        <nav className="lp-nav lp-wrap" aria-label="Public navigation">
          <a className="lp-brand" href="#home" aria-label="ExamMind home"><Brand /></a>
          <div className="lp-nav-links">{navLinks.map(link => <a key={link.href} href={link.href} className={activeNav === link.href ? 'is-active' : ''} onClick={event => navigateTo(event, link.href)}>{link.label}<svg className="lp-nav-ring" viewBox="0 0 100 44" preserveAspectRatio="none" aria-hidden="true"><ellipse cx="50" cy="22" rx="48" ry="17.5" pathLength="100" strokeDasharray="100" strokeDashoffset="100" /></svg></a>)}<a href={feedbackNavLink.href} onClick={event => { event.preventDefault(); openFeedback(); }}>{feedbackNavLink.label}<svg className="lp-nav-ring" viewBox="0 0 100 44" preserveAspectRatio="none" aria-hidden="true"><ellipse cx="50" cy="22" rx="48" ry="17.5" pathLength="100" strokeDasharray="100" strokeDashoffset="100" /></svg></a></div>
          <div className="lp-nav-actions">
            <button className="lp-login" onClick={signIn}>Log in</button>
            <button className="lp-button lp-button-small" onClick={start}>Get started <ArrowUpRight size={17} /></button>
            <button className="lp-menu-toggle" aria-label={menuOpen ? 'Close menu' : 'Open menu'} aria-expanded={menuOpen} aria-controls="landing-mobile-nav" onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X /> : <Menu />}</button>
          </div>
        </nav>
        <nav id="landing-mobile-nav" className={`lp-mobile-nav${menuOpen ? ' is-open' : ''}`} aria-label="Mobile navigation" aria-hidden={!menuOpen} onKeyDown={event => { if (event.key === 'Escape') { setMenuOpen(false); root.current?.querySelector<HTMLButtonElement>('.lp-menu-toggle')?.focus(); } }}>{navLinks.map(link => <a href={link.href} key={link.href} onClick={event => navigateTo(event, link.href)}>{link.label}<ArrowUpRight size={18} /></a>)}<a href={feedbackNavLink.href} onClick={event => { event.preventDefault(); openFeedback(); }}>{feedbackNavLink.label}<ArrowUpRight size={18} /></a><div className="lp-mobile-cta"><button className="lp-button" onClick={() => { setMenuOpen(false); start(); }}>Get started <ArrowUpRight size={17} /></button><button className="lp-mobile-login" onClick={() => { setMenuOpen(false); signIn(); }}>Log in</button></div></nav>
      </header>

      <section className="lp-hero lp-wrap" id="main-content" aria-labelledby="hero-heading">
        <div className="lp-water-field" aria-hidden="true">
          <canvas ref={waterCanvas} />
        </div>
        <span className="lp-hero-shade" aria-hidden="true" />
        <div className="lp-hero-copy">
          <h1 id="hero-heading">Less cramming.<br /><em>More getting it.</em></h1>
          <p>Your notes have the answers.<br className="lp-desktop-break" /> Let’s help you find them.</p>
          <p className="lp-hero-description">Turn your notes into understanding. Find your study group, work through questions together, and make room for your next “aha” moment.</p>
          <div className="lp-hero-actions"><button className="lp-button" onClick={start}>Start studying free <ArrowUpRight size={20} /></button><a className="lp-link" href="#capabilities">Take a look around <ArrowDown size={17} /></a></div>
          <span className="lp-hero-footnote">Your material. Your pace. Your way forward.</span>
        </div>
        <div className="lp-hero-collage">
          <div className="lp-hero-depth">
          <div className="lp-photo-backing" aria-hidden="true" />
          <figure className="lp-hero-photo"><img src={asset('campus-study')} alt="Student with earphones studying from a notebook and digital device at an outdoor table" width="1200" height="1800" fetchPriority="high" /><figcaption>A little focus. A lot of possibility.</figcaption></figure>
          <div className="lp-note-photo" aria-hidden="true"><img src={asset('lecture-notes')} alt="" width="700" height="1050" /><span>One page at a time.</span></div>
          <div className="lp-hero-answer"><span className="lp-mini-brand"><Sparkles size={15} /> The lightbulb moment</span><p>“Oh, <em>now</em> that makes sense.”</p><div><span className="lp-source-dot" /><span>Answers connected to your notes</span><CheckCheck size={16} /></div></div>
          <svg className="lp-orbit" viewBox="0 0 540 560" fill="none" aria-hidden="true"><path d="M490 30C585 168 510 527 137 520C-41 517 3 335 60 301" stroke="currentColor" strokeWidth="1.4" strokeDasharray="4 7" /><path d="m50 307 12-9-2 15" stroke="currentColor" strokeWidth="1.4" /></svg>
          <img className="lp-hero-folder" src="/images/landing/folder-cutout.png" alt="" width="1280" height="1280" />
          </div>
        </div>
      </section>

      <div className="lp-materials" aria-label="Supported study materials"><div className="lp-wrap lp-material-inner"><span>Good things start with<br /><strong>what you already have.</strong></span><div className="lp-material-track"><span><FileText /> Lecture notes</span><span><Layers /> Past questions</span><span><BookOpen /> Scanned PDFs</span><span><GraduationCap /> Course topics</span></div></div></div>

      <div className="lp-journey">
      <section className="lp-community" id="community" aria-labelledby="community-heading">
        <div className="lp-wrap lp-community-layout">
          <div className="lp-community-copy">
            <h2 id="community-heading">Your people.<br />Your course.<br /><em>Your next breakthrough.</em></h2>
            <p>Find students working through the same topics. Join a study group, open a reading room, and work through the difficult parts together.</p>
            <dl className="lp-community-benefits">
              <div><dt>A group for your course</dt><dd>Find your classmates and keep learning together beyond one session.</dd></div>
              <div><dt>A room for right now</dt><dd>See who’s studying, ask questions, and talk through the answers.</dd></div>
              <div><dt>One question. A shared discovery.</dt><dd>AI answers become study cards everyone in the room can see and discuss.</dd></div>
            </dl>
            <button className="lp-button" onClick={start}>Find your study circle <ArrowUpRight size={20} /></button>
          </div>
          <figure className="lp-room-preview">
            <figcaption>Inside a reading room <span>Illustrative example</span></figcaption>
        <div className="lp-room-cover"><img src={asset('study-together')} alt="University students sharing notes and ideas during a study session" width="1200" height="800" loading="lazy" /></div>
            <div className="lp-room-body">
              <div className="lp-room-heading"><div><h3>Let’s figure this out.</h3><p>Economics · Opportunity cost</p></div><span className="lp-room-people" aria-label="Three example classmates"><i>A</i><i>T</i><i>Z</i></span></div>
              <div className="lp-room-message"><strong>Amara</strong><p>Anyone else stuck on opportunity cost?</p></div>
              <div className="lp-room-message"><strong>Tobi</strong><p>Same. Let’s work through an example together.</p></div>
              <div className="lp-room-study-card"><span><Sparkles size={16} /> Shared AI study card</span><h4>What are you giving up?</h4><p>If you spend an hour revising economics instead of biology, the biology revision is your next-best alternative forgone.</p></div>
              <div className="lp-room-message"><strong>Zainab</strong><p>That makes sense. So it’s the next-best option, not every option?</p></div>
              <div className="lp-room-caption"><BookOpen size={16} /> A question becomes a conversation.</div>
            </div>
          </figure>
        </div>
      </section>
      <section className="lp-features" id="capabilities" aria-labelledby="features-heading">
        <div className="lp-wrap">
          <div className="lp-section-heading"><h2 id="features-heading">All those notes.<br />Finally, <em>connected.</em></h2><p>A study workspace that starts with your course material. Find the missing piece, understand the topic, then put it into practice.</p></div>
          <div className="lp-feature-grid">
            <article className="lp-search-feature">
              <div className="lp-feature-copy"><h3>Ask it your way.</h3><p>You don’t need the exact phrase. Just the question on your mind.</p></div>
              <div className="lp-demo" aria-label="Interactive example of a source-grounded answer">
                <div className="lp-demo-top"><span><span className="lp-source-dot" /> Your study archive</span><small>Illustrative example</small></div>
                <div className="lp-example-picker" role="group" aria-label="Choose a sample subject">{examples.map((item, index) => <button key={item.label} aria-pressed={exampleIndex === index} onClick={() => { setExampleIndex(index); setSourceOpen(false); }}>{item.label}</button>)}</div>
                <div className="lp-demo-question"><Search size={19} /><span>{example.question}</span><ArrowUpRight size={18} /></div>
                <div className="lp-demo-answer" aria-live="polite"><span className="lp-mini-brand"><Sparkles size={16} /> Let’s make it click</span><p>{example.answer}</p><button className="lp-source-toggle" aria-expanded={sourceOpen} aria-controls="sample-source" onClick={() => setSourceOpen(!sourceOpen)}><FileText size={16} /><span>{example.source}</span><ChevronDown size={16} className={sourceOpen ? 'is-open' : ''} /></button>{sourceOpen && <div id="sample-source" className="lp-source-excerpt"><strong>{example.topic}</strong><p>{example.excerpt}</p></div>}</div>
              </div>
              <button className="lp-inline-action" onClick={start}>Find answers in your notes <ArrowUpRight size={19} /></button>
            </article>
            <article className="lp-practice-feature"><div className="lp-feature-copy"><h3>Meet the question<br />before the exam.</h3><p>Build focused practice from the material you’re actually studying.</p></div><div className="lp-practice-paper"><span>Practice, with purpose</span><p>Which activity determines a project’s earliest finish date?</p><div><span>A</span> The shortest activity</div><div className="is-correct"><span>B</span> An activity on the critical path <Check size={18} /></div><small>Example practice question</small><img className="lp-target-illustration" src="/images/landing/target-3d.webp" alt="" width="200" height="200" loading="lazy" /></div><button className="lp-inline-action" onClick={start}>Turn revision into practice <ArrowUpRight size={19} /></button></article>
            <article className="lp-readiness-feature"><div><h3>Know where<br />to go next.</h3><p>Your practice history brings the topics that need another look into focus.</p><button className="lp-inline-action" onClick={start}>Find your focus <ArrowUpRight size={19} /></button></div><div className="lp-topic-list" aria-label="Illustrative topic readiness"><small>A sample revision check-in</small><span><CheckCheck /> Scheduling <b>Looking good</b></span><span><BookOpen /> Risk analysis <b>Revisit</b></span><span><BookOpen /> Resource planning <b>Keep practising</b></span></div></article>
          </div>
        </div>
      </section>

      <section className="lp-workflow" id="workflow" aria-labelledby="workflow-heading"><div className="lp-wrap lp-workflow-layout"><div className="lp-workflow-intro"><h2 id="workflow-heading">From a pile of PDFs<br />to a plan for <em>today.</em></h2><p>No starting from scratch. Bring the material you already use, and give it a new purpose.</p><a className="lp-link" href="#start">Let’s get you started <ArrowUpRight size={20} /></a><div className="lp-workflow-photos"><div className="lp-workflow-photo"><img src={asset('library-session')} alt="Students working among wooden bookshelves in a university library" width="1200" height="800" loading="lazy" /></div><div className="lp-workflow-detail"><img src={asset('lecture-notes')} alt="Handwritten notes alongside course material" width="700" height="1050" loading="lazy" /></div></div></div><div className="lp-steps">
        <article className="lp-step"><span className="lp-step-index">01 <Upload size={25} /></span><h3>Bring your material.</h3><p>Upload your lecture notes, past questions, and scanned PDFs. This is where your study archive begins.</p><div className="lp-file-slip"><FileText size={28} /><span>Lecture notes.pdf<small>Your next starting point</small></span><Check size={18} /></div></article>
        <article className="lp-step"><span className="lp-step-index">02 <Layers size={25} /></span><h3>Find the connections.</h3><p>ExamMind reads and organises your material by course and topic, so you can find the idea without hunting through files.</p><div className="lp-indexed-topics"><span>Course</span><span>Topic</span><span>Session</span><span>Concept</span></div><img className="lp-notebook-illustration" src="/images/landing/notebook-3d.webp" alt="" width="200" height="200" loading="lazy" /></article>
        <article className="lp-step"><span className="lp-step-index">03 <Sparkles size={25} /></span><h3>Make it make sense.</h3><p>Ask a question. Check the source. Try a practice session. Build understanding, one small breakthrough at a time.</p><button className="lp-button" onClick={start}>Find your first answer <ArrowUpRight size={19} /></button></article>
      </div></div></section>

      <section className="lp-integrity" id="integrity" aria-labelledby="integrity-heading"><div className="lp-wrap"><ShieldCheck className="lp-integrity-icon" size={40} strokeWidth={1.3} /><h2 className="lp-belief" id="integrity-heading">{'A good answer should never be a leap of faith.'.split(' ').map((word, index) => <span key={index}>{word} </span>)}</h2><div className="lp-integrity-bottom"><p>ExamMind retrieves relevant material from your uploads before the assistant responds. Follow the sources, check the context, and build your own understanding.</p><span><FileText size={19} /> Your notes stay part of the conversation.</span></div></div></section>

      <section className="lp-life" aria-labelledby="life-heading"><div className="lp-wrap"><h2 id="life-heading">Made for real <span className="lp-inline-photo"><img src={asset('focused-study')} alt="" width="1200" height="800" loading="lazy" /></span><br /><em>student life.</em></h2><div className="lp-scenario"><figure><img src={asset(scenario.image)} alt={scenario.alt} width="1200" height="800" loading="lazy" /></figure><div className="lp-scenario-copy"><div aria-live="polite" aria-atomic="true"><h3>{scenario.title}</h3><p>{scenario.body}</p><button className="lp-inline-action" onClick={start}>{scenario.link}<ArrowUpRight size={20} /></button></div><div className="lp-carousel-controls"><span>{scenarioIndex + 1} / {scenarios.length}</span><button aria-label="Previous study scenario" onClick={() => setScenarioIndex((scenarioIndex + scenarios.length - 1) % scenarios.length)}><ArrowLeft size={20} /></button><button aria-label="Next study scenario" onClick={() => setScenarioIndex((scenarioIndex + 1) % scenarios.length)}><ArrowRight size={20} /></button></div></div></div><div className="lp-student-moments"><figure><img src={asset('campus-friends')} alt="Friends revising together on a sunny university lawn" width="900" height="600" loading="lazy" /><figcaption>Between lectures.</figcaption></figure><p>A library corner.<br />A sunny afternoon.<br /><em>Your kind of study session.</em></p><figure><img src={asset('focused-study')} alt="A student finding a quiet moment to take notes" width="1200" height="800" loading="lazy" /><figcaption>One quiet moment.</figcaption></figure></div></div></section>
      </div>

      <section className="lp-final" id="start"><div className="lp-wrap lp-final-inner"><div><h2>Here’s to your<br />next <em>“I get it.”</em></h2><p>Start with your notes. See where they take you.</p></div><button className="lp-button lp-final-button" onClick={start}>Create your free account <ArrowUpRight size={24} /></button></div></section>
      <footer className="lp-footer"><div className="lp-wrap"><div className="lp-footer-top"><a className="lp-brand" href="#home" aria-label="ExamMind home"><Brand /></a><p>A clearer way to study.<br />Built around your material.</p><div><a href="#capabilities">Why ExamMind</a><a href="#workflow">How it works</a><a href="/privacy" onClick={event => { event.preventDefault(); onPrivacy(); }}>Privacy</a><a href="/feedback" onClick={event => { event.preventDefault(); onFeedback(); }}>Feedback</a><button onClick={signIn}>Student login <ArrowUpRight size={15} /></button></div></div><div className="lp-footer-bottom"><span>© {new Date().getFullYear()} ExamMind</span><p className="lp-tag"><MakerTag /></p><span>Stay curious. Keep going.</span></div></div></footer>
    </main>
  );
}
