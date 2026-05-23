export function readTtsConfig() {
  return {
    apiKey: process.env.ELEVENLABS_API_KEY ?? "",
    voiceId: process.env.ELEVENLABS_VOICE_ID ?? "9BWtsMINqrJLrRacOk9x", // Aria
    modelId: process.env.ELEVENLABS_MODEL_ID ?? "eleven_flash_v2_5",
  };
}
