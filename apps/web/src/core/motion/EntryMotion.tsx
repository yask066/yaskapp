import { cloneElement, useEffect, useRef, useState, type CSSProperties, type ReactElement, type Ref } from 'react';
import { useMotionSettings } from './use-motion-settings';
import { motionTokens } from './motion-tokens';
import { markEntryMotionSeen } from './entry-motion-registry';

type MotionChildProps = {
  className?: string;
  style?: CSSProperties;
  'data-entry-motion'?: 'active' | 'idle';
  ref?: Ref<HTMLElement>;
};

function assignRef(ref: Ref<HTMLElement> | undefined, element: HTMLElement | null) {
  if (typeof ref === 'function') ref(element);
  else if (ref) ref.current = element;
}

export interface EntryMotionProps {
  contextKey: string;
  itemId: string;
  visible: boolean;
  indexInBatch: number;
  children: ReactElement<MotionChildProps>;
}

export function EntryMotion({ contextKey, itemId, visible, indexInBatch, children }: EntryMotionProps) {
  const { entryMotion, reduceMotion } = useMotionSettings();
  const identity = `${contextKey}\u0000${itemId}`;
  const handledIdentity = useRef<string | null>(null);
  const elementRef = useRef<HTMLElement | null>(null);
  const [isEntering, setIsEntering] = useState(false);
  const active = isEntering && handledIdentity.current === identity && entryMotion && !reduceMotion;

  useEffect(() => {
    if (handledIdentity.current === identity) {
      if (!entryMotion || reduceMotion || !visible) setIsEntering(false);
      return;
    }

    setIsEntering(false);
    if (!visible || !entryMotion || reduceMotion) {
      handledIdentity.current = identity;
      markEntryMotionSeen(contextKey, itemId);
      return;
    }

    const settleVisibility = (isIntersecting: boolean) => {
      if (handledIdentity.current === identity) return;
      handledIdentity.current = identity;
      const firstAppearance = markEntryMotionSeen(contextKey, itemId);
      setIsEntering(Boolean(isIntersecting && firstAppearance && entryMotion && !reduceMotion));
    };
    const element = elementRef.current;
    if (!element || typeof IntersectionObserver === 'undefined') {
      settleVisibility(true);
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      const entry = entries[0];
      observer.disconnect();
      settleVisibility(Boolean(entry?.isIntersecting));
    }, { threshold: 0.01 });
    observer.observe(element);
    return () => observer.disconnect();
  }, [contextKey, entryMotion, identity, itemId, reduceMotion, visible]);

  const existingClassName = children.props.className ?? '';
  const delayIndex = indexInBatch >= motionTokens.maxStaggeredItems ? 0 : Math.max(0, indexInBatch);
  const style: CSSProperties = {
    ...children.props.style,
    '--entry-motion-delay': `${delayIndex * motionTokens.staggerMs}ms`,
  } as CSSProperties;
  const childRef = children.props.ref;

  return cloneElement(children, {
    className: `${existingClassName} entry-motion${active ? ' entry-motion--active' : ''}`.trim(),
    style,
    'data-entry-motion': active ? 'active' : 'idle',
    ref: (element: HTMLElement | null) => {
      elementRef.current = element;
      assignRef(childRef, element);
    },
  });
}
