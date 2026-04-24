/**
 * Correlate narration segments with user actions by timestamp.
 * For each segment, find the nearest action within the time window.
 *
 * Returns actions with `narrationText` property added when matched.
 */
export function correlateNarration(actions, narration, windowMs = 2000) {
  if (!narration || !narration.segments || narration.segments.length === 0) {
    return actions;
  }

  const { audioStartEpoch, segments } = narration;

  return actions.map((action) => {
    if (!action.timestamp) return action;

    const matchedSegments = segments.filter((segment) => {
      const segmentWallClock = audioStartEpoch + segment.startMs;
      const delta = Math.abs(segmentWallClock - action.timestamp);
      return delta <= windowMs;
    });

    if (matchedSegments.length === 0) return action;

    const narrationText = matchedSegments.map((s) => s.text).join(' ');
    return { ...action, narrationText };
  });
}
