/**
 * Removes Markdown syntax for the AVSpeech fallback path. The
 * primary ElevenLabs path receives prose directly from the agent
 * (voice-mode addendum tells it not to emit markdown), but the
 * fallback runs on whatever the agent produced.
 */
export function stripMarkdown(text: string): string {
  return text
    // Fenced code blocks (greedy, includes the fence lines)
    .replace(/```[\s\S]*?```/g, "")
    // Inline code
    .replace(/`([^`]+)`/g, "$1")
    // Bold + italic (** and __ and * and _)
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/(?<!\w)_([^_\n]+)_(?!\w)/g, "$1")
    // Markdown links [text](url) -> "text (url)"
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
    // Heading markers
    .replace(/^#+\s+/gm, "")
    // Bullet markers (-, *, +)
    .replace(/^[\-*+]\s+/gm, "")
    // Numbered list markers
    .replace(/^\d+\.\s+/gm, "")
    // Collapse triple-newlines that the code-block strip left behind
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
