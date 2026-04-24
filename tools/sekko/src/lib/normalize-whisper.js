const SPECIAL_TOKEN_THRESHOLD = 50257;

export function normalizeWhisper(whisperJson, audioStartEpoch) {
  const words = whisperJson.transcription.flatMap((segment) =>
    segment.tokens
      .filter((t) => t.id < SPECIAL_TOKEN_THRESHOLD)
      .map((t) => ({
        text: t.text.trim(),
        startMs: t.offsets.from,
        endMs: t.offsets.to,
        confidence: t.p,
      }))
      .filter((w) => w.text.length > 0)
  );

  const segments = whisperJson.transcription.map((s) => ({
    text: s.text.trim(),
    startMs: s.offsets.from,
    endMs: s.offsets.to,
  }));

  const transcript = segments.map((s) => s.text).join(' ');

  return { transcript, backend: 'whisper.cpp', audioStartEpoch, words, segments };
}
