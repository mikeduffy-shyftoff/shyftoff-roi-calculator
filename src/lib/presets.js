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

// Default gig pricing tiers — based on PhyNet SOW. Rate auto-selects from
// total weekly productive hours.
export const DEFAULT_GIG_TIERS = [
  { minHours: 0, rate: 31.0, label: "Base (<750 hrs/wk)" },
  { minHours: 750, rate: 30.5, label: "Tier 2 (750+ hrs/wk)" },
  { minHours: 1000, rate: 30.0, label: "Tier 3 (1,000+ hrs/wk)" },
];
