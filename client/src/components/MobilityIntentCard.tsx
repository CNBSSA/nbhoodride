import { useEffect, useState, useRef, useCallback } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Mic, MicOff, Sparkles, Home, RotateCcw, MapPin, Share2, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { ParsedMobilityIntent } from "@shared/genui/schema";

/**
 * Feature-detect SpeechRecognition once at module scope. Returning the
 * constructor (or undefined) lets the component synchronously gate the
 * mic button on supported browsers only — Safari iOS, Firefox, and
 * older Android all return undefined here, and the previous version
 * (which only toasted on click) left the mic button looking functional
 * to ~30% of mobile users who could not actually use it.
 */
function getSpeechRecognition() {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
  return (w.SpeechRecognition || w.webkitSpeechRecognition) as
    | (new () => {
        lang: string;
        interimResults: boolean;
        onstart: (() => void) | null;
        onend: (() => void) | null;
        onerror: ((event: { error?: string }) => void) | null;
        onresult: ((event: { results: { [i: number]: { [j: number]: { transcript: string } } } }) => void) | null;
        start: () => void;
        stop: () => void;
      })
    | undefined;
}

export interface IntentResolution {
  parsed: ParsedMobilityIntent;
  destinationAddress?: string;
  pickup?: { lat: number; lng: number; address: string };
  destination?: { lat: number; lng: number; address: string };
  autonomyLevel: number;
}

interface MobilityIntentCardProps {
  onResolved: (result: IntentResolution) => void;
  onGuardianShare?: (shareUrl: string) => void;
  disabled?: boolean;
}

export function MobilityIntentCard({ onResolved, onGuardianShare, disabled }: MobilityIntentCardProps) {
  const [utterance, setUtterance] = useState("");
  const [listening, setListening] = useState(false);
  // Pending voice transcript awaiting explicit confirmation. The supervisor
  // review caught that the previous version fired parseIntent.mutate
  // immediately on rec.onresult — voice → server-parsed intent → auto
  // driver pick (autonomy ≥ 2) without ever showing the rider what was
  // heard. A speech transcription error ("airport" → "airbnb") would
  // silently book the wrong destination.
  const [pendingTranscript, setPendingTranscript] = useState<string | null>(null);
  // Cached feature-detect so the mic button can be hidden on unsupported
  // browsers (Safari iOS, Firefox, older Android) instead of looking
  // functional and only failing on click.
  const [voiceSupported, setVoiceSupported] = useState(false);
  const { toast } = useToast();
  const recognitionRef = useRef<{ stop: () => void; start: () => void } | null>(null);

  useEffect(() => {
    setVoiceSupported(typeof getSpeechRecognition() !== "undefined");
  }, []);

  const { data: lastTemplate } = useQuery<{ hasTemplate: boolean; destinationAddress?: string }>({
    queryKey: ["/api/mobility/ride-template/last"],
  });

  const parseIntent = useMutation({
    mutationFn: async (text: string) => {
      const res = await apiRequest("POST", "/api/mobility/intent", { utterance: text });
      return res.json() as Promise<IntentResolution>;
    },
    onSuccess: (data) => {
      if (data.parsed.intentType === "guardian_share") {
        guardianShare.mutate();
        return;
      }
      // Previously a successful parse with intentType="unknown" silently
      // landed the rider in the search panel with no guidance — they'd
      // just see the booking screen and wonder why. Now we surface the
      // failure and prompt with examples that the regex parser actually
      // handles, instead of pretending the input worked.
      if (data.parsed.intentType === "unknown") {
        toast({
          title: "I didn't catch that",
          description: 'Try "take me home" or an address.',
        });
        return;
      }
      onResolved(data);
    },
    onError: (err: any) => {
      // Server can reject for several reasons (length, rate limit, parse
      // failure). Surface the actual message instead of a generic toast
      // so the rider can tell "too long" from "rate limited" from
      // "server down".
      const message = err?.message?.startsWith("400:") ? "Couldn't read that — try a shorter request." :
                      err?.message?.startsWith("429:") ? "Slow down a bit, then try again." :
                      "Could not parse intent — please try again.";
      toast({ title: message, variant: "destructive" });
    },
  });

  const repeatLast = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/mobility/intent", { utterance: "same as last time" });
      return res.json() as Promise<IntentResolution>;
    },
    onSuccess: onResolved,
  });

  const rideHome = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/mobility/intent", { utterance: "take me home" });
      return res.json() as Promise<IntentResolution>;
    },
    onSuccess: onResolved,
  });

  const guardianShare = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/mobility/guardian-links", {
        guardianName: "Family",
      });
      return res.json() as Promise<{ shareUrl: string }>;
    },
    onSuccess: (data) => {
      onGuardianShare?.(data.shareUrl);
      toast({ title: "Tracking link created", description: "Share with your family." });
    },
  });

  const startVoice = useCallback(() => {
    const SR = getSpeechRecognition();
    if (!SR) {
      // This branch is defensive — voiceSupported gating should keep
      // the button hidden on unsupported browsers, so we shouldn't get
      // here. Toast as a fallback for the cases where SR appears between
      // mount and click (rare race; never observed).
      toast({ title: "Voice not supported", description: "Try typing your request instead." });
      return;
    }
    const rec = new SR();
    recognitionRef.current = rec;
    rec.lang = "en-US";
    rec.interimResults = false;
    rec.onstart = () => setListening(true);
    rec.onend = () => setListening(false);
    rec.onerror = (event: { error?: string }) => {
      setListening(false);
      // Distinguish error categories instead of swallowing silently.
      // not-allowed = mic permission denied; no-speech = listened but
      // got nothing; network = STT service unreachable. Riders get a
      // specific reason instead of a stuck-button mystery.
      const code = event?.error ?? "unknown";
      const message =
        code === "not-allowed"
          ? "Microphone permission denied — enable it in your browser settings."
          : code === "no-speech"
          ? "Didn't hear anything — try again."
          : code === "network"
          ? "Voice service unreachable — type your request instead."
          : "Voice input failed — try typing instead.";
      toast({ title: "Voice not available", description: message });
    };
    rec.onresult = (event: { results: { [index: number]: { [index: number]: { transcript: string } } } }) => {
      const text = (event.results[0]?.[0]?.transcript ?? "").trim();
      if (!text) return;
      // Pin the transcript into pendingTranscript and the utterance
      // field. The rider sees what was heard, can edit it inline, and
      // must explicitly tap Confirm before parseIntent.mutate fires.
      // The previous version booked rides off raw STT output with NO
      // confirmation — the supervisor review's highest-severity voice
      // finding.
      setUtterance(text);
      setPendingTranscript(text);
    };
    rec.start();
  }, [toast]);

  const stopVoice = () => {
    recognitionRef.current?.stop();
    setListening(false);
  };

  /** Confirm the pending voice transcript and trigger the actual parse. */
  function confirmVoiceTranscript() {
    if (!pendingTranscript) return;
    const text = utterance.trim() || pendingTranscript;
    setPendingTranscript(null);
    parseIntent.mutate(text);
  }

  /** Dismiss the pending voice transcript without parsing. */
  function dismissVoiceTranscript() {
    setPendingTranscript(null);
    setUtterance("");
  }

  return (
    <div className="space-y-3" data-testid="mobility-intent-card">
      <div className="flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-blue-600" />
        <p className="text-sm font-semibold text-gray-900">Where should we take you?</p>
      </div>

      <div className="flex gap-2">
        <Input
          value={utterance}
          onChange={(e) => {
            setUtterance(e.target.value);
            // Any keystroke after a voice transcript implicitly cancels
            // the pending confirmation — the rider is taking control of
            // the text, so the inline Confirm strip would be misleading.
            if (pendingTranscript) setPendingTranscript(null);
          }}
          placeholder='Try "Take me home" or an address'
          disabled={disabled || parseIntent.isPending}
          maxLength={500}
          onKeyDown={(e) => {
            if (e.key === "Enter" && utterance.trim()) parseIntent.mutate(utterance.trim());
          }}
          data-testid="input-mobility-intent"
        />
        {voiceSupported && (
          <Button
            type="button"
            size="icon"
            variant={listening ? "destructive" : "secondary"}
            onClick={listening ? stopVoice : startVoice}
            disabled={disabled}
            aria-label={listening ? "Stop voice input" : "Voice booking"}
            data-testid="btn-voice-intent"
          >
            {listening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
          </Button>
        )}
        <Button
          type="button"
          disabled={!utterance.trim() || disabled || parseIntent.isPending || !!pendingTranscript}
          onClick={() => parseIntent.mutate(utterance.trim())}
          data-testid="btn-parse-intent"
        >
          Go
        </Button>
      </div>

      {/*
        Voice-transcript confirmation strip. Appears only after a
        successful rec.onresult and stays until the rider taps Confirm or
        Cancel (or types into the input, which implicitly cancels). The
        whole point is that the rider sees the transcribed text BEFORE
        any server roundtrip — preventing the "airport → airbnb" silent
        misbooking the supervisor review flagged as HIGH severity.
      */}
      {pendingTranscript && (
        <div
          className="flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm"
          data-testid="voice-confirm-strip"
          role="status"
        >
          <Mic className="w-4 h-4 text-blue-600 shrink-0" />
          <span className="flex-1 text-blue-900">
            Heard: <span className="font-medium">"{pendingTranscript}"</span>
          </span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={dismissVoiceTranscript}
            aria-label="Cancel voice input"
            data-testid="btn-voice-cancel"
          >
            <X className="w-4 h-4" />
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={confirmVoiceTranscript}
            data-testid="btn-voice-confirm"
          >
            <Check className="w-4 h-4 mr-1" />
            Confirm
          </Button>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="rounded-full"
          disabled={disabled || rideHome.isPending}
          onClick={() => rideHome.mutate()}
          data-testid="intent-ride-home"
        >
          <Home className="w-3.5 h-3.5 mr-1" />
          Home
        </Button>
        {lastTemplate?.hasTemplate && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="rounded-full"
            disabled={disabled || repeatLast.isPending}
            onClick={() => repeatLast.mutate()}
            data-testid="intent-repeat-last"
          >
            <RotateCcw className="w-3.5 h-3.5 mr-1" />
            Same as last time
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="rounded-full"
          disabled={disabled}
          onClick={() => {
            setUtterance("");
            onResolved({
              parsed: { intentType: "book_ride", confidence: 1, label: "Book", utterance: "" },
              autonomyLevel: 1,
            });
          }}
          data-testid="intent-book-ride"
        >
          <MapPin className="w-3.5 h-3.5 mr-1" />
          Enter address
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="rounded-full"
          disabled={disabled || guardianShare.isPending}
          onClick={() => guardianShare.mutate()}
          data-testid="intent-guardian-share"
        >
          <Share2 className="w-3.5 h-3.5 mr-1" />
          Family track
        </Button>
      </div>
    </div>
  );
}
