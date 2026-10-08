import { useContext } from 'react';
import { MotionSettingsContext, type MotionSettings } from './motion-settings-context';

export function useMotionSettings(): MotionSettings {
  return useContext(MotionSettingsContext);
}
