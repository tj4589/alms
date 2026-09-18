import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BookmarkSimpleIcon } from '@phosphor-icons/react/dist/icons/BookmarkSimple';
import { DownloadSimpleIcon } from '@phosphor-icons/react/dist/icons/DownloadSimple';
import { CloudArrowDownIcon } from '@phosphor-icons/react/dist/icons/CloudArrowDown';
import { saveItem, savedItemId, type SavedItem } from '../offline';
import './SaveButton.css';

type SaveTarget = {
  itemType: SavedItem['itemType'];
  refId: string | number;
  title: string;
  meta: string;
  /** Only passed when there is a real file behind the item. */
  download?: () => Promise<string>;
  /**
   * The readable content to keep for offline use. Returning null means there
   * is nothing worth caching, and the item is bookmarked without claiming to
   * be available offline -- better than storing nothing and calling it saved.
   */
  snapshot?: () => Promise<unknown | null>;
};

type SaveButtonProps = {
  target: SaveTarget;
  /** A quieter variant for sitting inside a dense list row. */
  compact?: boolean;
  onSaved?: (item: SavedItem) => void;
};

export default function SaveButton({ target, compact = false, onSaved }: SaveButtonProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string>('');
  const [done, setDone] = useState('');
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuId = useId();

  // The menu is rendered into document.body and positioned from the trigger.
  //
  // It has to leave the page to work at all: App.css:472 runs a fadeUp entrance
  // on every direct child of .page with fill-mode "both", so each one keeps a
  // filled `transform: translateY(0)` forever. A transform -- even an identity
  // one -- makes that element the containing block for fixed descendants and
  // gives it its own stacking context, so a menu left inside the page was
  // positioned against the wrong origin and painted underneath the page text.
  useLayoutEffect(() => {
    const menu = menuRef.current;
    const trigger = triggerRef.current;
    if (!open || !menu || !trigger) return;
    const place = () => {
      const anchor = trigger.getBoundingClientRect();
      const box = menu.getBoundingClientRect();
      const margin = 8;
      const widest = document.documentElement.clientWidth - box.width - margin;
      // Flip above the trigger when there is no room beneath it.
      const below = anchor.bottom + 6;
      const fits = below + box.height <= document.documentElement.clientHeight - margin;
      menu.style.left = `${Math.max(margin, Math.min(anchor.left, widest))}px`;
      menu.style.top = `${fits ? below : Math.max(margin, anchor.top - box.height - 6)}px`;
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open]);

  const close = useCallback((returnFocus = true) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  // Esc closes from anywhere in the menu, and a click outside dismisses it.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopPropagation(); close(); }
    };
    const onClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (wrapRef.current?.contains(target)) return;
      // The menu is portalled out of the wrapper, so it is "outside" by DOM
      // containment and would otherwise dismiss itself on its own clicks.
      if (menuRef.current?.contains(target)) return;
      close(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open, close]);

  // The confirmation is a message, not a state change, so it clears itself.
  useEffect(() => {
    if (!done) return;
    const timer = window.setTimeout(() => setDone(''), 4000);
    return () => window.clearTimeout(timer);
  }, [done]);

  const store = useCallback(async (offline: boolean) => {
    setBusy(offline ? 'offline' : 'bookmark');
    try {
      let snapshot: unknown | null = null;
      if (offline && target.snapshot) snapshot = await target.snapshot();
      const item: SavedItem = {
        id: savedItemId(target.itemType, target.refId),
        itemType: target.itemType,
        refId: target.refId,
        title: target.title,
        meta: target.meta,
        savedAt: new Date().toISOString(),
        cachedOffline: offline && snapshot !== null,
        ...(snapshot !== null ? { snapshot } : {}),
      };
      await saveItem(item);
      onSaved?.(item);
      // Say what actually happened: asking for offline and getting a bookmark
      // is a different outcome, and pretending otherwise is a lie the student
      // only discovers when the connection drops.
      setDone(item.cachedOffline ? 'Saved for offline' : offline ? 'Saved to Materials (nothing to cache)' : 'Saved to Materials');
      close();
    } catch {
      setDone('Could not save. Your browser may be blocking storage.');
      close();
    } finally {
      setBusy('');
    }
  }, [target, onSaved, close]);

  const runDownload = useCallback(async () => {
    if (!target.download) return;
    setBusy('download');
    try {
      const filename = await target.download();
      setDone(`Saved ${filename}`);
      close();
    } catch (error) {
      setDone(error instanceof Error ? error.message : 'That file could not be downloaded.');
      close();
    } finally {
      setBusy('');
    }
  }, [target, close]);

  return (
    <div className={`sv-wrap${compact ? ' is-compact' : ''}`} ref={wrapRef}>
      <button
        type="button"
        className="sv-trigger"
        ref={triggerRef}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((current) => !current)}
      >
        <BookmarkSimpleIcon size={16} weight="regular" aria-hidden="true" />
        <span className="sv-trigger-label">Save</span>
      </button>

      {open && createPortal(
        <div className="sv-menu" id={menuId} ref={menuRef} role="menu" aria-label={`Save ${target.title}`}>
          {target.download && (
            <button type="button" role="menuitem" className="sv-item" onClick={() => void runDownload()} disabled={!!busy}>
              <DownloadSimpleIcon size={16} aria-hidden="true" />
              <span>
                <strong>{busy === 'download' ? 'Preparing...' : 'Download'}</strong>
                <small>Keep the original file</small>
              </span>
            </button>
          )}
          <button type="button" role="menuitem" className="sv-item" onClick={() => void store(true)} disabled={!!busy}>
            <CloudArrowDownIcon size={16} aria-hidden="true" />
            <span>
              <strong>{busy === 'offline' ? 'Saving...' : 'Save for offline'}</strong>
              <small>Opens without a connection</small>
            </span>
          </button>
          <button type="button" role="menuitem" className="sv-item" onClick={() => void store(false)} disabled={!!busy}>
            <BookmarkSimpleIcon size={16} aria-hidden="true" />
            <span>
              <strong>{busy === 'bookmark' ? 'Saving...' : 'Save to Materials'}</strong>
              <small>Find it in your library</small>
            </span>
          </button>
        </div>,
        document.body,
      )}

      {done && <span className="sv-done" role="status">{done}</span>}
    </div>
  );
}
