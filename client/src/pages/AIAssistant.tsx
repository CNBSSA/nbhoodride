import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Send, Plus, Trash2, MessageSquare, Bot, User, Loader2, ArrowLeft, ThumbsUp, ThumbsDown, HelpCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAnalytics } from "@/hooks/useAnalytics";
import type { Conversation, ChatMessage, FaqEntry } from "@shared/schema";

export default function AIAssistant() {
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [streamingContent, setStreamingContent] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [feedbackGiven, setFeedbackGiven] = useState<Record<string, string>>({});
  const [showFaq, setShowFaq] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingFaqMessage = useRef<string | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { trackAiChat, trackFeatureUsed } = useAnalytics();

  const { data: conversations = [], isLoading: loadingConversations } = useQuery<Conversation[]>({
    queryKey: ["/api/ai/conversations"],
  });

  const { data: messages = [], isLoading: loadingMessages } = useQuery<ChatMessage[]>({
    queryKey: ["/api/ai/conversations", activeConversationId, "messages"],
    enabled: !!activeConversationId,
  });

  const { data: faqEntries = [] } = useQuery<FaqEntry[]>({
    queryKey: ["/api/faq"],
  });

  const createConversation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/ai/conversations", { title: "New Chat" });
      return res.json();
    },
    onSuccess: (data: Conversation) => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai/conversations"] });
      setActiveConversationId(data.id);
      trackFeatureUsed("ai_new_conversation");
    },
  });

  const deleteConversation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/ai/conversations/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai/conversations"] });
      setActiveConversationId(null);
    },
  });

  const submitFeedback = useMutation({
    mutationFn: async (data: { messageId: string; conversationId: string; rating: string }) => {
      const res = await apiRequest("POST", "/api/ai/feedback", data);
      return res.json();
    },
    onSuccess: (_, variables) => {
      setFeedbackGiven((prev) => ({ ...prev, [variables.messageId]: variables.rating }));
      toast({
        title: variables.rating === "positive" ? "Thanks for the feedback!" : "We'll improve",
        description: variables.rating === "positive" ? "Glad the response was helpful." : "We'll use this to get better.",
      });
      trackFeatureUsed("ai_feedback", { rating: variables.rating });
    },
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);

  const sendMessageForConversation = useCallback(async (conversationId: string, messageText: string) => {
    const userMessage = messageText.trim();
    if (!userMessage || !conversationId) return;

    setMessage("");
    setIsStreaming(true);
    setStreamingContent("");
    trackAiChat({ action: "send_message" });

    queryClient.setQueryData<ChatMessage[]>(
      ["/api/ai/conversations", conversationId, "messages"],
      (old = []) => [
        ...old,
        { id: "temp-user", conversationId, role: "user", content: userMessage, createdAt: new Date() } as ChatMessage,
      ]
    );

    try {
      const response = await fetch(`/api/ai/conversations/${conversationId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: userMessage }),
        credentials: "include",
      });

      if (!response.ok) throw new Error("Failed to send message");

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let buffer = "";
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6));
            if (event.content) {
              accumulated += event.content;
              setStreamingContent(accumulated);
            }
            if (event.done) {
              setStreamingContent("");
              setIsStreaming(false);
              queryClient.invalidateQueries({ queryKey: ["/api/ai/conversations", conversationId, "messages"] });
            }
          } catch {}
        }
      }
    } catch (error) {
      console.error("Error sending message:", error);
      setIsStreaming(false);
      setStreamingContent("");
      queryClient.invalidateQueries({ queryKey: ["/api/ai/conversations", conversationId, "messages"] });
    }
  }, [queryClient, trackAiChat]);

  useEffect(() => {
    if (activeConversationId) {
      inputRef.current?.focus();
      if (pendingFaqMessage.current) {
        const faqMsg = pendingFaqMessage.current;
        pendingFaqMessage.current = null;
        sendMessageForConversation(activeConversationId, faqMsg);
      }
    }
  }, [activeConversationId, sendMessageForConversation]);

  const sendMessage = async (overrideMessage?: string) => {
    const messageToSend = overrideMessage || message;
    if (!messageToSend.trim() || !activeConversationId || isStreaming) return;
    await sendMessageForConversation(activeConversationId, messageToSend);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleFaqClick = async (question: string) => {
    setShowFaq(false);
    trackFeatureUsed("faq_clicked", { question });
    if (!activeConversationId) {
      try {
        pendingFaqMessage.current = question;
        const res = await apiRequest("POST", "/api/ai/conversations", { title: question.slice(0, 50) });
        const convo = await res.json();
        queryClient.invalidateQueries({ queryKey: ["/api/ai/conversations"] });
        setActiveConversationId(convo.id);
      } catch {
        pendingFaqMessage.current = null;
        toast({ title: "Error", description: "Failed to start conversation. Please try again.", variant: "destructive" });
      }
    } else {
      sendMessage(question);
    }
  };

  if (!activeConversationId) {
    return (
      <div className="flex flex-col h-[calc(100vh-140px)]">
        <div className="p-4 border-b border-border">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Bot className="w-5 h-5 text-primary" />
              <h2 className="text-lg font-semibold" data-testid="text-ai-title">PG Ride Assistant</h2>
            </div>
            <div className="flex items-center gap-2">
              {faqEntries.length > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowFaq(!showFaq)}
                  data-testid="btn-toggle-faq"
                >
                  <HelpCircle className="w-4 h-4 mr-1" />
                  FAQ
                </Button>
              )}
              <Button
                size="sm"
                onClick={() => createConversation.mutate()}
                disabled={createConversation.isPending}
                data-testid="btn-new-chat"
              >
                <Plus className="w-4 h-4 mr-1" />
                New Chat
              </Button>
            </div>
          </div>
          <p className="text-sm text-muted-foreground mt-1">Ask questions about rides, payments, safety, and more</p>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {showFaq && faqEntries.length > 0 && (
            <div className="mb-4" data-testid="faq-section">
              <h3 className="text-sm font-semibold mb-2 text-muted-foreground">Frequently Asked Questions</h3>
              <div className="space-y-2">
                {faqEntries.map((faq) => (
                  <Card
                    key={faq.id}
                    className="cursor-pointer hover:bg-accent/50 transition-colors"
                    onClick={() => handleFaqClick(faq.question)}
                    data-testid={`faq-card-${faq.id}`}
                  >
                    <CardContent className="p-3">
                      <p className="text-sm font-medium">{faq.question}</p>
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{faq.answer}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {loadingConversations ? (
            <div className="flex items-center justify-center py-8" data-testid="loading-conversations">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : conversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center" data-testid="empty-conversations">
              <MessageSquare className="w-12 h-12 text-muted-foreground mb-3" />
              <h3 className="text-base font-medium mb-1">No conversations yet</h3>
              <p className="text-sm text-muted-foreground mb-4">Start a new chat to get help with anything about PG Ride</p>
              <Button onClick={() => createConversation.mutate()} disabled={createConversation.isPending} data-testid="btn-start-first-chat">
                <Plus className="w-4 h-4 mr-1" />
                Start a Chat
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              {conversations.map((convo) => (
                <Card
                  key={convo.id}
                  className="cursor-pointer hover:bg-accent/50 transition-colors"
                  onClick={() => setActiveConversationId(convo.id)}
                  data-testid={`card-conversation-${convo.id}`}
                >
                  <CardContent className="p-3 flex items-center justify-between">
                    <div className="flex items-center gap-3 min-w-0">
                      <MessageSquare className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{convo.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(convo.createdAt!).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="flex-shrink-0 h-8 w-8"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteConversation.mutate(convo.id);
                      }}
                      data-testid={`btn-delete-conversation-${convo.id}`}
                    >
                      <Trash2 className="w-4 h-4 text-muted-foreground" />
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-140px)]">
      <div className="p-3 border-b border-border flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => setActiveConversationId(null)} data-testid="btn-back-to-conversations">
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <Bot className="w-5 h-5 text-primary" />
        <span className="text-sm font-medium" data-testid="text-chat-title">PG Ride Assistant</span>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {loadingMessages ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : messages.length === 0 && !streamingContent ? (
          <div className="flex flex-col items-center justify-center py-8 text-center" data-testid="empty-messages">
            <Bot className="w-10 h-10 text-primary mb-3" />
            <p className="text-sm text-muted-foreground">
              Hi! I'm your PG Ride Assistant. Ask me anything about rides, payments, safety features, or the platform.
            </p>
            {faqEntries.length > 0 && (
              <div className="mt-4 w-full max-w-xs space-y-2">
                <p className="text-xs text-muted-foreground font-medium">Quick questions:</p>
                {faqEntries.slice(0, 3).map((faq) => (
                  <Button
                    key={faq.id}
                    variant="outline"
                    size="sm"
                    className="w-full text-xs text-left justify-start h-auto py-2 whitespace-normal"
                    onClick={() => handleFaqClick(faq.question)}
                    data-testid={`quick-faq-${faq.id}`}
                  >
                    {faq.question}
                  </Button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <>
            {messages.map((msg) => (
              <div key={msg.id}>
                <div
                  className={cn(
                    "flex gap-2",
                    msg.role === "user" ? "justify-end" : "justify-start"
                  )}
                  data-testid={`message-${msg.role}-${msg.id}`}
                >
                  {msg.role === "assistant" && (
                    <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Bot className="w-4 h-4 text-primary" />
                    </div>
                  )}
                  <div
                    className={cn(
                      "max-w-[80%] rounded-2xl px-3 py-2 text-sm",
                      msg.role === "user"
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted"
                    )}
                  >
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                  </div>
                  {msg.role === "user" && (
                    <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center flex-shrink-0 mt-0.5">
                      <User className="w-4 h-4 text-primary-foreground" />
                    </div>
                  )}
                </div>
                {msg.role === "assistant" && msg.id !== "temp-user" && (
                  <div className="flex items-center gap-1 ml-9 mt-1" data-testid={`feedback-buttons-${msg.id}`}>
                    {feedbackGiven[msg.id] ? (
                      <span className="text-xs text-muted-foreground">
                        {feedbackGiven[msg.id] === "positive" ? "👍 Helpful" : "👎 Noted"}
                      </span>
                    ) : (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-xs text-muted-foreground hover:text-green-600"
                          onClick={() =>
                            submitFeedback.mutate({
                              messageId: msg.id,
                              conversationId: activeConversationId!,
                              rating: "positive",
                            })
                          }
                          disabled={submitFeedback.isPending}
                          data-testid={`btn-feedback-positive-${msg.id}`}
                        >
                          <ThumbsUp className="w-3 h-3 mr-1" />
                          Helpful
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-xs text-muted-foreground hover:text-red-600"
                          onClick={() =>
                            submitFeedback.mutate({
                              messageId: msg.id,
                              conversationId: activeConversationId!,
                              rating: "negative",
                            })
                          }
                          disabled={submitFeedback.isPending}
                          data-testid={`btn-feedback-negative-${msg.id}`}
                        >
                          <ThumbsDown className="w-3 h-3 mr-1" />
                          Not helpful
                        </Button>
                      </>
                    )}
                  </div>
                )}
              </div>
            ))}

            {streamingContent && (
              <div className="flex gap-2 justify-start" data-testid="message-streaming">
                <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Bot className="w-4 h-4 text-primary" />
                </div>
                <div className="max-w-[80%] rounded-2xl px-3 py-2 text-sm bg-muted">
                  <p className="whitespace-pre-wrap">{streamingContent}</p>
                </div>
              </div>
            )}

            {isStreaming && !streamingContent && (
              <div className="flex gap-2 justify-start" data-testid="message-thinking">
                <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Bot className="w-4 h-4 text-primary" />
                </div>
                <div className="rounded-2xl px-3 py-2 bg-muted">
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                </div>
              </div>
            )}
          </>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="p-3 border-t border-border">
        <div className="flex gap-2">
          <Input
            ref={inputRef}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask PG Ride Assistant..."
            disabled={isStreaming}
            className="flex-1"
            data-testid="input-chat-message"
          />
          <Button
            size="icon"
            onClick={sendMessage}
            disabled={!message.trim() || isStreaming}
            data-testid="btn-send-message"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
