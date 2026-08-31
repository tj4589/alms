import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

type WorkbenchSectionProps = {
  id: string;
  index: string;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
};

export function WorkbenchSection({
  id,
  index,
  title,
  description,
  action,
  className = '',
  children,
}: WorkbenchSectionProps) {
  return (
    <section className={`wb-section ${className}`.trim()} aria-labelledby={`${id}-title`}>
      <header className="wb-section-head">
        <div className="wb-section-heading">
          <span className="wb-section-index" aria-hidden="true">{index}</span>
          <div>
            <h2 id={`${id}-title`}>{title}</h2>
            {description && <p>{description}</p>}
          </div>
        </div>
        {action && <div className="wb-section-action">{action}</div>}
      </header>
      <div className="wb-section-body">{children}</div>
    </section>
  );
}

type WorkbenchEmptyProps = {
  icon: LucideIcon;
  title: string;
  body: string;
  action?: ReactNode;
};

export function WorkbenchEmpty({ icon: Icon, title, body, action }: WorkbenchEmptyProps) {
  return (
    <div className="wb-empty">
      <Icon aria-hidden="true" />
      <div>
        <strong>{title}</strong>
        <p>{body}</p>
      </div>
      {action && <div className="wb-empty-action">{action}</div>}
    </div>
  );
}
