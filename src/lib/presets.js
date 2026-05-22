// AI cost-stack presets surfaced as tier buttons in the AI calculator. Each
// preset is one production-ready vendor combination with realistic per-minute
// pricing for SIP, STT, LLM, TTS, orchestration, compliance, and a failure
// retry buffer.
export const TIER_PRESETS = {
  lean: {
    label: "Lean Stack",
    range: "$0.06 – $0.10",
    color: "#22c55e",
    desc: "Telnyx + Deepgram + GPT-4o-mini + OpenAI TTS. Self-hosted orchestration.",
    vendors: "Telnyx · Deepgram · GPT-4o-mini · OpenAI TTS · Pipecat",
    costs: {
      aiSIP: 0.002,
      aiSTT: 0.007,
      aiLLM: 0.002,
      aiTTS: 0.008,
      aiOrchestration: 0.04,
      aiCompliance: 0.001,
      aiFailureBuffer: 3,
    },
  },
  standard: {
    label: "Standard Production",
    range: "$0.10 – $0.18",
    color: "#f59e0b",
    desc: "Retell/Deepgram platform + GPT-4o + Cartesia. Mid-market default.",
    vendors: "Twilio · Deepgram · GPT-4o · Cartesia · Retell",
    costs: {
      aiSIP: 0.005,
      aiSTT: 0.008,
      aiLLM: 0.005,
      aiTTS: 0.015,
      aiOrchestration: 0.105,
      aiCompliance: 0.002,
      aiFailureBuffer: 5,
    },
  },
  premium: {
    label: "Premium Quality",
    range: "$0.18 – $0.35",
    color: "#ef4444",
    desc: "Vapi + GPT-4o + ElevenLabs HD voice. Brand-sensitive deployments.",
    vendors: "Twilio · Azure STT · GPT-4o · ElevenLabs v2 · Vapi",
    costs: {
      aiSIP: 0.009,
      aiSTT: 0.015,
      aiLLM: 0.008,
      aiTTS: 0.06,
      aiOrchestration: 0.15,
      aiCompliance: 0.003,
      aiFailureBuffer: 8,
    },
  },
};

// ShyftOff rate: flat $35/hr loaded, regardless of AI tier or volume.
// The lib's tier-selection mechanism is kept for backward compatibility
// but only one entry is needed at this rate. To restore tiered pricing
// later, just add more {minHours, rate, label} entries; lib selects the
// highest minHours-threshold the weekly hours qualify for.
export const DEFAULT_GIG_TIERS = [
  { minHours: 0, rate: 35.0, label: "ShyftOff Standard" },
];
