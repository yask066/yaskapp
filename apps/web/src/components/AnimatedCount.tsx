import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { motionTokens } from '../core/motion/motion-tokens';
import { useMotionSettings } from '../core/motion/use-motion-settings';

interface AnimatedCountProps {
  value: number;
  enabled: boolean;
  durationMs?: number;
  formatValue?: (value: number) => string;
}

interface PreviousValue {
  value: number;
  id: number;
}

export function AnimatedCount({ value, enabled, durationMs = motionTokens.countDurationMs, formatValue = String }: AnimatedCountProps) {
  const { reduceMotion } = useMotionSettings();
  const [previousValue, setPreviousValue] = useState<PreviousValue | null>(null);
  const lastValue = useRef(value);
  const transitionId = useRef(0);
  const transitionEnabled = enabled && !reduceMotion;
  const duration = Math.max(0, durationMs);

  useLayoutEffect(() => {
    if (lastValue.current !== value) {
      const from = lastValue.current;
      lastValue.current = value;
      if (transitionEnabled) {
        transitionId.current += 1;
        setPreviousValue({ value: from, id: transitionId.current });
      } else {
        setPreviousValue(null);
      }
      return;
    }

    if (!transitionEnabled) setPreviousValue(null);
  }, [transitionEnabled, value]);

  useEffect(() => {
    if (!previousValue) return undefined;
    const id = previousValue.id;
    const timeout = window.setTimeout(() => {
      setPreviousValue((current) => current?.id === id ? null : current);
    }, duration);
    return () => window.clearTimeout(timeout);
  }, [duration, previousValue]);

  const formattedValue = formatValue(value);

  return (
    <span
      className="animated-count"
      data-animated={previousValue ? 'true' : undefined}
      style={{ '--animated-count-duration': `${duration}ms` } as CSSProperties}
    >
      {previousValue ? <span className="animated-count__previous" key={`previous-${previousValue.id}`} aria-hidden="true">{formatValue(previousValue.value)}</span> : null}
      <span className="animated-count__current" key={`current-${value}`}>{formattedValue}</span>
    </span>
  );
}
