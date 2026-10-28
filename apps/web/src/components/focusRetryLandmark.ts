export function focusRetryLandmark(source: HTMLElement) {
  const landmark = source.closest<HTMLElement>('main');
  if (!landmark) return;
  landmark.tabIndex = -1;
  landmark.focus({ preventScroll: true });
}
