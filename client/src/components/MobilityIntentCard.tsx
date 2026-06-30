import { useState, useRef, useCallback } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Mic, MicOff, Sparkles, Home, RotateCcw, MapPin, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { ParsedMobilityIntent } from "@shared/genui/schema";

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
  const { toast } = useToast();
  const recognitionRef = useRef<{ stop: () => void; start: () => void } | null>(null);

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
      onResolved(data);
    },
    onError: () => {
      toast({ title: "Could not parse intent", variant: "destructive" });
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
    const win = window as unknown as {
      SpeechRecognition?: new () => {
        lang: string;
        interimResults: boolean;
        onstart: (() => void) | null;
        onend: (() => void) | null;
        onerror: (() => void) | null;
        onresult: ((event: { results: { [i: number]: { [j: number]: { transcript: string } } } }) => void) | null;
        start: () => void;
        stop: () => void;
      };
      webkitSpeechRecognition?: new () => {
        lang: string;
        interimResults: boolean;
        onstart: (() => void) | null;
        onend: (() => void) | null;
        onerror: (() => void) | null;
        onresult: ((event: { results: { [i: number]: { [j: number]: { transcript: string } } } }) => void) | null;
        start: () => void;
        stop: () => void;
      };
    };
    const SR = win.SpeechRecognition || win.webkitSpeechRecognition;
    if (!SR) {
      toast({ title: "Voice not supported", description: "Try typing your request instead." });
      return;
    }
    const rec = new SR();
    recognitionRef.current = rec;
    rec.lang = "en-US";
    rec.interimResults = false;
    rec.onstart = () => setListening(true);
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    rec.onresult = (event: { results: { [index: number]: { [index: number]: { transcript: string } } } }) => {
      const text = event.results[0]?.[0]?.transcript ?? "";
      setUtterance(text);
      if (text.trim()) parseIntent.mutate(text.trim());
    };
    rec.start();
  }, [parseIntent, toast]);

  const stopVoice = () => {
    recognitionRef.current?.stop();
    setListening(false);
  };

  return (
    <div className="space-y-3" data-testid="mobility-intent-card">
      <div className="flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-blue-600" />
        <p className="text-sm font-semibold text-gray-900">Where should we take you?</p>
      </div>

      <div className="flex gap-2">
        <Input
          value={utterance}
          onChange={(e) => setUtterance(e.target.value)}
          placeholder='Try "Take me home" or an address'
          disabled={disabled || parseIntent.isPending}
          onKeyDown={(e) => {
            if (e.key === "Enter" && utterance.trim()) parseIntent.mutate(utterance.trim());
          }}
          data-testid="input-mobility-intent"
        />
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
        <Button
          type="button"
          disabled={!utterance.trim() || disabled || parseIntent.isPending}
          onClick={() => parseIntent.mutate(utterance.trim())}
          data-testid="btn-parse-intent"
        >
          Go
        </Button>
      </div>

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
