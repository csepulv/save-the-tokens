/**
 * Correlate network requests with user actions by timestamp proximity.
 * A network request is "triggered by" an action if it started within
 * the window after the action timestamp.
 *
 * Returns { actions, network } with cross-references added:
 * - action.requestIds: array of network entry IDs triggered by this action
 * - networkEntry.actionIndex: 1-based index of the triggering action (or null)
 */
export function correlateActionAndNetworkCalls(actions, networkEntries, windowMs = 2000) {
  // Build action timeline with epoch timestamps
  const actionTimeline = actions.map((action, i) => ({
    index: i + 1,
    timestamp: action.timestamp,
  }));

  // For each network entry, find the most recent action within the window
  const annotatedNetwork = networkEntries.map((entry) => {
    const entryTime = new Date(entry.startedDateTime).getTime();
    let matchedAction = null;

    for (let i = actionTimeline.length - 1; i >= 0; i--) {
      const action = actionTimeline[i];
      if (!action.timestamp) continue;

      const delta = entryTime - action.timestamp;
      if (delta >= 0 && delta <= windowMs) {
        matchedAction = action.index;
        break;
      }
    }

    return { ...entry, actionIndex: matchedAction };
  });

  // Build reverse mapping: action → request IDs
  const annotatedActions = actions.map((action, i) => {
    const actionIndex = i + 1;
    const requestIds = annotatedNetwork
      .filter((e) => e.actionIndex === actionIndex)
      .map((e) => e.id);

    return { ...action, requestIds };
  });

  return { actions: annotatedActions, network: annotatedNetwork };
}
