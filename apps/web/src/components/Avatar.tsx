interface AvatarProps {
  name: string;
  src?: string | null;
  size?: number;
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '?';
}

export function Avatar({ name, src, size = 40 }: AvatarProps) {
  const style = { width: size, height: size };
  if (src) return <img className="avatar" src={src} alt={`${name}'s avatar`} style={style} />;
  return <span className="avatar avatar--fallback" style={{ ...style, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }} aria-label={`${name}'s avatar`}>{initials(name)}</span>;
}
