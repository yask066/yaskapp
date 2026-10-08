import { createContext } from 'react';

export type MotionFlags = {
  reactionsMotion: boolean;
  entryMotion: boolean;
};

export type MotionSettings = MotionFlags & {
  reduceMotion: boolean;
};

export const defaultMotionFlags: MotionFlags = {
  reactionsMotion: false,
  entryMotion: false,
};

export const MotionSettingsContext = createContext<MotionSettings>({
  ...defaultMotionFlags,
  reduceMotion: false,
});
