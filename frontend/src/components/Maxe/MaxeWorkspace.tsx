import { useEffect, useMemo, useRef, useState } from 'react';
import { Menu, MessageCircle, Plus, X } from 'lucide-react';
import type { ChatMessage, ScreenType, User } from '../../types';
import Assistant from '../../screens/Assistant';
import MaxeMark from './MaxeMark';

type MaxeWorkspaceProps = {
  go: (screen: ScreenType) => void;
  selectedQuestion?: string;
  notifyUnavailable: (feature: string) => void;
  messages: ChatMessage[];
  onMessagesChange: (updater: (current: ChatMessage[]) => ChatMessage[]) => void;
  onNewThread: () => void;
  onClose: () => void;
  user: User | null;
};

const MAXE_WORKSPACE_STYLES = `
.maxe-workspace-layer{position:fixed;inset:0;z-index:520;color:var(--em-ink,#090a0a);font-family:'Outfit Variable',sans-serif}
.maxe-workspace-scrim{position:absolute;inset:0;width:100%;height:100%;border:0;background:rgba(37,43,36,.26);cursor:default}
.maxe-workspace-dialog{position:absolute;inset:10px;display:grid;grid-template-columns:248px minmax(0,1fr);overflow:hidden;border:1px solid #d7d9cd;border-radius:18px;background:#faf8f3;box-shadow:0 24px 72px rgba(37,43,36,.18);isolation:isolate}
.maxe-workspace-history{display:flex;min-width:0;flex-direction:column;background:#efede5;border-right:1px solid #dadcd0}
.maxe-workspace-brand{display:flex;align-items:center;gap:11px;min-height:72px;padding:0 18px;border-bottom:1px solid #dadcd0}
.maxe-workspace-brand-mark{display:block;width:31px;height:42px;overflow:hidden}
.maxe-workspace-brand-mark .maxe-mark{width:50px;height:67px;transform:translate(-9px,-7px)}
.maxe-workspace-brand strong{font-size:18px;font-weight:650;letter-spacing:-.4px}
.maxe-workspace-new{display:flex;align-items:center;gap:10px;margin:15px 12px 18px;padding:10px 12px;min-height:42px;border:1px solid #d2d5c7;border-radius:10px;background:#faf8f3;color:#30382a;font-size:13px;text-align:left;transition:background-color 150ms ease-out,transform 120ms ease-out}
.maxe-workspace-new:hover{background:#e5ebd8}.maxe-workspace-new:active{transform:scale(.98)}
.maxe-workspace-history-label{padding:0 18px 8px;color:#757a6c;font-size:11px}
.maxe-workspace-thread{display:flex;align-items:flex-start;gap:9px;margin:0 10px;padding:11px 10px;border:0;border-radius:9px;background:#dde5ca;color:#30382a;text-align:left}
.maxe-workspace-thread svg{flex:0 0 auto;margin-top:2px;color:#596a48}
.maxe-workspace-thread span{display:block;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;font-weight:550}
.maxe-workspace-thread small{display:block;margin-top:3px;color:#687062;font-size:10px;font-weight:400}
.maxe-workspace-history-note{margin-top:auto;padding:16px 18px 18px;border-top:1px solid #dadcd0;color:#74796c;font-size:11px;line-height:1.55}
.maxe-workspace-main{display:flex;min-width:0;min-height:0;flex-direction:column}
.maxe-workspace-topbar{display:flex;align-items:center;gap:12px;min-height:72px;padding:0 22px;border-bottom:1px solid #e0e1d7;background:#faf8f3}
.maxe-workspace-menu{display:none}
.maxe-workspace-heading{min-width:0}.maxe-workspace-heading strong{display:block;font-size:15px;font-weight:600;color:#30382a}.maxe-workspace-heading span{display:block;color:#71766a;font-size:11px;margin-top:2px}
.maxe-workspace-close{display:grid;place-items:center;width:38px;height:38px;margin-left:auto;border:0;border-radius:9px;background:transparent;color:#525a4d;transition:background-color 150ms ease-out,transform 120ms ease-out}
.maxe-workspace-close:hover{background:#e9e9df}.maxe-workspace-close:active{transform:scale(.96)}
.maxe-workspace-conversation{min-height:0;flex:1;overflow:auto;background:#faf8f3}
.maxe-workspace-dialog #s-assistant.assistant-page{width:100%;height:100%;max-width:none;margin:0;padding:0;background:#faf8f3}
.maxe-workspace-dialog #s-assistant .assistant-heading,.maxe-workspace-dialog #s-assistant .related-panel{display:none}
.maxe-workspace-dialog #s-assistant .ai-layout{display:block;height:100%}
.maxe-workspace-dialog #s-assistant .ai-panel{height:100%;min-height:0;border:0;border-radius:0;box-shadow:none;background:#faf8f3}
.maxe-workspace-dialog #s-assistant .ai-hd{min-height:54px;padding:0 clamp(20px,4vw,58px);background:#faf8f3}
.maxe-workspace-dialog #s-assistant .ai-hd-title{font-size:13px}.maxe-workspace-dialog #s-assistant .ai-hd-sub{font-size:10px}
.maxe-workspace-dialog #s-assistant .ai-msgs{min-height:0;max-height:none;flex:1;padding:26px clamp(20px,7vw,110px) 18px;background:#faf8f3}
.maxe-workspace-dialog #s-assistant .bubble{max-width:min(720px,86%)}
.maxe-workspace-dialog #s-assistant .assistant-prompts{padding:0 clamp(20px,7vw,110px) 15px;background:#faf8f3}
.maxe-workspace-dialog #s-assistant .ai-foot{position:sticky;bottom:0;padding:15px clamp(20px,7vw,110px) 18px;background:#f0eee7}
.maxe-workspace-dialog :is(button,input):focus-visible{outline:2px solid var(--em-ink,#090a0a);outline-offset:3px}
@media(max-width:760px){.maxe-workspace-dialog{inset:0;grid-template-columns:1fr;border:0;border-radius:0}.maxe-workspace-history{position:absolute;inset:0 auto 0 0;z-index:4;width:min(84vw,300px);box-shadow:12px 0 36px rgba(37,43,36,.16);transform:translateX(-102%);transition:transform 180ms cubic-bezier(.23,1,.32,1)}.maxe-workspace-history.is-open{transform:translateX(0)}.maxe-workspace-menu{display:grid;place-items:center;width:38px;height:38px;border:0;border-radius:9px;background:transparent;color:#525a4d}.maxe-workspace-menu:hover{background:#e9e9df}.maxe-workspace-topbar{min-height:62px;padding:0 13px}.maxe-workspace-dialog #s-assistant .ai-hd{padding:0 15px}.maxe-workspace-dialog #s-assistant .ai-msgs{padding:20px 15px 14px}.maxe-workspace-dialog #s-assistant .assistant-prompts{padding:0 15px 13px;flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none}.maxe-workspace-dialog #s-assistant .assistant-prompts::-webkit-scrollbar{display:none}.maxe-workspace-dialog #s-assistant .assistant-prompts .pill{flex:0 0 auto}.maxe-workspace-dialog #s-assistant .ai-foot{padding:12px 12px calc(12px + env(safe-area-inset-bottom))}.maxe-workspace-dialog #s-assistant .ai-msgs{min-height:0}}
@media(prefers-reduced-motion:reduce){.maxe-workspace-history{transition:none}.maxe-workspace-dialog *{scroll-behavior:auto!important;animation:none!important}}
`;

function threadTitle(messages: ChatMessage[]) {
  const lastQuestion = [...messages].reverse().find(message => message.role === 'user')?.content.trim();
  if (!lastQuestion) return 'New study thread';
  return lastQuestion.length > 42 ? `${lastQuestion.slice(0, 42).trim()}…` : lastQuestion;
}

export default function MaxeWorkspace({
  go,
  selectedQuestion,
  notifyUnavailable,
  messages,
  onMessagesChange,
  onNewThread,
  onClose,
  user,
}: MaxeWorkspaceProps) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const title = useMemo(() => threadTitle(messages), [messages]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusTimer = window.setTimeout(() => {
      document.querySelector<HTMLInputElement>('.maxe-workspace-dialog .ai-inp')?.focus();
    }, 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const controls = [...document.querySelectorAll<HTMLElement>('.maxe-workspace-dialog button:not([disabled]), .maxe-workspace-dialog input:not([disabled]), .maxe-workspace-dialog [tabindex]:not([tabindex="-1"])')];
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  const navigate = (screen: ScreenType) => {
    onClose();
    go(screen);
  };

  return (
    <div className="maxe-workspace-layer">
      <style>{MAXE_WORKSPACE_STYLES}</style>
      <button type="button" className="maxe-workspace-scrim" aria-label="Close Maxe" onClick={onClose} />
      <section className="maxe-workspace-dialog" role="dialog" aria-modal="true" aria-labelledby="maxe-workspace-title">
        <aside className={`maxe-workspace-history${historyOpen ? ' is-open' : ''}`} aria-label="Maxe thread history">
          <div className="maxe-workspace-brand">
            <span className="maxe-workspace-brand-mark" aria-hidden="true"><MaxeMark /></span>
            <strong>Maxe</strong>
          </div>
          <button type="button" className="maxe-workspace-new" onClick={() => { onNewThread(); setHistoryOpen(false); }}>
            <Plus size={17} aria-hidden="true" /> New conversation
          </button>
          <div className="maxe-workspace-history-label">This session</div>
          <button type="button" className="maxe-workspace-thread" aria-current="page" onClick={() => setHistoryOpen(false)}>
            <MessageCircle size={16} aria-hidden="true" />
            <span>{title}<small>{messages.length > 1 ? `${messages.length - 1} message${messages.length === 2 ? '' : 's'}` : 'Ready when you are'}</small></span>
          </button>
          <p className="maxe-workspace-history-note">Your current conversation stays here while you move around ExamMind.</p>
        </aside>

        <main className="maxe-workspace-main">
          <header className="maxe-workspace-topbar">
            <button type="button" className="maxe-workspace-menu" onClick={() => setHistoryOpen(value => !value)} aria-label="Toggle thread history" aria-expanded={historyOpen}>
              <Menu size={20} aria-hidden="true" />
            </button>
            <div className="maxe-workspace-heading">
              <strong id="maxe-workspace-title">Ask Maxe</strong>
              <span>Your notes and questions, in one conversation</span>
            </div>
            <button ref={closeRef} type="button" className="maxe-workspace-close" onClick={onClose} aria-label="Close Maxe">
              <X size={20} aria-hidden="true" />
            </button>
          </header>
          <div className="maxe-workspace-conversation" role="log" aria-label="Conversation with Maxe" aria-live="polite">
            <Assistant
              go={navigate}
              selectedQuestion={selectedQuestion}
              notifyUnavailable={notifyUnavailable}
              messages={messages}
              onMessagesChange={onMessagesChange}
              user={user}
            />
          </div>
        </main>
      </section>
    </div>
  );
}
