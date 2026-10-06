export type ContentSkeletonKind = 'poll' | 'user' | 'comment' | 'notification';

interface ContentSkeletonProps {
  kind: ContentSkeletonKind;
  rows: number;
}

function SkeletonLines({ count = 2 }: { count?: number }) {
  return <span className="content-skeleton__lines">
    {Array.from({ length: count }, (_, index) => <span className="content-skeleton__line" key={index} />)}
  </span>;
}

function SkeletonRow({ kind }: { kind: ContentSkeletonKind }) {
  if (kind === 'user') return <div className="content-skeleton__row content-skeleton__row--user" data-skeleton-row><span className="content-skeleton__avatar" /><SkeletonLines count={2} /></div>;
  if (kind === 'notification') return <div className="content-skeleton__row content-skeleton__row--notification" data-skeleton-row><SkeletonLines count={2} /></div>;
  if (kind === 'comment') return <div className="content-skeleton__row content-skeleton__row--comment" data-skeleton-row><span className="content-skeleton__avatar" /><span className="content-skeleton__comment-copy"><SkeletonLines count={1} /><SkeletonLines count={2} /></span></div>;
  return <div className="content-skeleton__row content-skeleton__row--poll" data-skeleton-row>
    <div className="content-skeleton__poll-heading"><span className="content-skeleton__avatar" /><SkeletonLines count={2} /></div>
    <SkeletonLines count={2} />
    <span className="content-skeleton__media" />
    <SkeletonLines count={2} />
  </div>;
}

export function ContentSkeleton({ kind, rows }: ContentSkeletonProps) {
  return <div className={`content-skeleton content-skeleton--${kind}`} aria-hidden="true">
    {Array.from({ length: Math.max(0, rows) }, (_, index) => <SkeletonRow kind={kind} key={index} />)}
  </div>;
}
