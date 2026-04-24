import { homedir } from 'os';

const DEFAULT_TRANSCRIPTION_MODE = 'whisper';

const expandHome = (path) => path?.replace(/^~(?=$|\/)/, homedir()) ?? null;

export function getTranscriptionConfig(env = process.env) {
  return {
    transcriptionMode: env.SEKKO_TRANSCRIPTION_MODE || DEFAULT_TRANSCRIPTION_MODE,
    deepgramApiKey: env.DEEPGRAM_API_KEY || null,
    whisperBinary: expandHome(env.SEKKO_WHISPER_CLI),
    whisperModelPath: expandHome(env.SEKKO_WHISPER_MODEL),
  };
}
