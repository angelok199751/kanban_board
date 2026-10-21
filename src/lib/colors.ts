import type { ColorName } from './types';

export const COLORS: Record<ColorName, string> = {
  red: '#f49aaa',
  orange: '#f5b48a',
  yellow: '#f2dc8a',
  green: '#8fe0a8',
  blue: '#8fb8ff',
  purple: '#b9a5ff',
  pink: '#f5a8d8',
  gray: '#9a9db3',
};

export const COLOR_NAMES = Object.keys(COLORS) as ColorName[];
