const counters = {
  created: 0,
  suppressed: 0,
  read: 0,
  pushSent: 0,
  pushFailed: 0
};

export function incrementNotificationMetric(name: keyof typeof counters) {
  counters[name] += 1;
}

export function getNotificationMetrics() {
  return { ...counters };
}
