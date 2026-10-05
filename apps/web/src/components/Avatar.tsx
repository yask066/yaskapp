import { useState } from 'react';

interface AvatarProps {
  name: string;
  src?: string | null;
  size?: number;
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '?';
}

export function Avatar({ name, src, size = 40 }: AvatarProps) {
  return src
    ? <AvatarImage key={src} name={name} src={src} size={size} />
    : <AvatarFallback name={name} size={size} />;
}

function AvatarImage({ name, src, size }: { name: string; src: string; size: number }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <AvatarFallback name={name} size={size} />;
  return <img className="avatar" src={src} alt={`${name}'s avatar`} style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flex: '0 0 auto' }} onError={() => setFailed(true)} />;
}

function AvatarFallback({ name, size }: { name: string; size: number }) {
  return <span className="avatar avatar--fallback" style={{ width: size, height: size, borderRadius: '50%', flex: '0 0 auto', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }} aria-label={`${name}'s avatar`}>{initials(name)}</span>;
}
