export function normalizeDeepgram(dgResponse, audioStartEpoch) {
  const channel = dgResponse.results.channels[0].alternatives[0];

  const words = channel.words.map((w) => ({
    text: w.punctuated_word || w.word,
    startMs: Math.round(w.start * 1000),
    endMs: Math.round(w.end * 1000),
    confidence: w.confidence,
  }));

  const transcript = channel.transcript;

  const segments = (dgResponse.results.utterances || []).map((u) => ({
    text: u.transcript,
    startMs: Math.round(u.start * 1000),
    endMs: Math.round(u.end * 1000),
  }));

  return { transcript, backend: 'deepgram', audioStartEpoch, words, segments };
}
