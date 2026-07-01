import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiRequest } from "@/lib/queryClient";
import { RideQuickMessages } from "@/components/RideQuickMessages";
import { RIDE_CHAT_MAX_LENGTH, type RideMessagePayload } from "@shared/rideChat";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Send } from "lucide-react";

interface RideChatProps {
  rideId: string;
  role: "rider" | "driver";
  /** Append incoming WS messages from parent. */
  incomingMessage?: RideMessagePayload | null;
}

export function RideChat({ rideId, role, incomingMessage }: RideChatProps) {
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: messages = [], isLoading } = useQuery<RideMessagePayload[]>({
    queryKey: ["/api/rides", rideId, "messages"],
    queryFn: async () => {
      const res = await fetch(`/api/rides/${rideId}/messages?limit=50`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load messages");
      return res.json();
    },
    refetchInterval: 15000,
  });

  useEffect(() => {
    if (!incomingMessage || incomingMessage.rideId !== rideId) return;
    queryClient.setQueryData<RideMessagePayload[]>(
      ["/api/rides", rideId, "messages"],
      (prev = []) => {
        if (prev.some((m) => m.id === incomingMessage.id)) return prev;
        return [...prev, incomingMessage];
      },
    );
  }, [incomingMessage, queryClient, rideId]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length]);

  const sendMutation = useMutation({
    mutationFn: async (body: string) => {
      const res = await apiRequest("POST", `/api/rides/${rideId}/messages`, { body });
      return res.json() as Promise<RideMessagePayload>;
    },
    onSuccess: (message) => {
      setDraft("");
      queryClient.setQueryData<RideMessagePayload[]>(
        ["/api/rides", rideId, "messages"],
        (prev = []) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message]),
      );
    },
    onError: (err: Error) => {
      toast({ title: "Could not send", description: err.message, variant: "destructive" });
    },
  });

  const handleSend = () => {
    const text = draft.trim();
    if (!text || sendMutation.isPending) return;
    sendMutation.mutate(text);
  };

  return (
    <div className="space-y-2" data-testid={`ride-chat-${role}`}>
      <p className="text-xs font-medium text-muted-foreground">Ride chat</p>
      <RideQuickMessages rideId={rideId} role={role} />

      <div
        ref={listRef}
        className="max-h-36 overflow-y-auto rounded-lg border bg-muted/30 p-2 space-y-2 text-sm"
        data-testid={`ride-chat-messages-${rideId}`}
      >
        {isLoading && (
          <p className="text-xs text-muted-foreground text-center py-2">
            <Loader2 className="w-3 h-3 animate-spin inline mr-1" />
            Loading…
          </p>
        )}
        {!isLoading && messages.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-2">No messages yet</p>
        )}
        {messages.map((msg) => {
          const mine = msg.senderRole === role;
          return (
            <div
              key={msg.id}
              className={`flex ${mine ? "justify-end" : "justify-start"}`}
              data-testid={`ride-chat-bubble-${msg.id}`}
            >
              <div
                className={`max-w-[85%] rounded-lg px-2.5 py-1.5 text-xs ${
                  mine ? "bg-primary text-primary-foreground" : "bg-card border"
                }`}
              >
                {msg.body}
              </div>
            </div>
          );
        })}
      </div>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          handleSend();
        }}
      >
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value.slice(0, RIDE_CHAT_MAX_LENGTH))}
          placeholder="Type a message…"
          disabled={sendMutation.isPending}
          data-testid={`ride-chat-input-${role}`}
        />
        <Button
          type="submit"
          size="icon"
          disabled={!draft.trim() || sendMutation.isPending}
          data-testid={`ride-chat-send-${role}`}
        >
          <Send className="w-4 h-4" />
        </Button>
      </form>
    </div>
  );
}
