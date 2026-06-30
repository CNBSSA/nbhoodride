import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import type { InAppNotification } from "@shared/schema";

interface NotificationBellProps {
  className?: string;
  buttonClassName?: string;
  iconClassName?: string;
}

export function NotificationBell({ className, buttonClassName, iconClassName }: NotificationBellProps) {
  const [open, setOpen] = useState(false);

  const { data: unread = { count: 0 } } = useQuery<{ count: number }>({
    queryKey: ["/api/notifications/unread-count"],
    refetchInterval: 30000,
  });

  const { data: notifications = [], isLoading } = useQuery<InAppNotification[]>({
    queryKey: ["/api/notifications"],
    enabled: open,
  });

  const markRead = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("POST", `/api/notifications/${id}/read`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
    },
  });

  const markAllRead = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/notifications/read-all");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
    },
  });

  const handleOpen = (next: boolean) => {
    setOpen(next);
    if (next) {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
    }
  };

  return (
    <Sheet open={open} onOpenChange={handleOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          className={cn("relative", buttonClassName)}
          data-testid="button-notifications"
          aria-label="Notifications"
        >
          <Bell className={cn("w-4 h-4 text-gray-600", iconClassName)} />
          {unread.count > 0 && (
            <span
              className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center"
              data-testid="notification-unread-badge"
            >
              {unread.count > 9 ? "9+" : unread.count}
            </span>
          )}
        </button>
      </SheetTrigger>
      <SheetContent side="right" className={cn("w-full sm:max-w-md", className)}>
        <SheetHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <SheetTitle>Notifications</SheetTitle>
          {unread.count > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => markAllRead.mutate()}
              disabled={markAllRead.isPending}
              data-testid="btn-mark-all-read"
            >
              Mark all read
            </Button>
          )}
        </SheetHeader>
        <div className="space-y-2 overflow-y-auto max-h-[calc(100vh-8rem)]">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : notifications.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8" data-testid="notifications-empty">
              No notifications yet
            </p>
          ) : (
            notifications.map((n) => (
              <button
                key={n.id}
                type="button"
                className={cn(
                  "w-full text-left rounded-lg border p-3 transition-colors",
                  n.readAt ? "bg-muted/30 border-border" : "bg-primary/5 border-primary/20",
                )}
                onClick={() => {
                  if (!n.readAt) markRead.mutate(n.id);
                }}
                data-testid={`notification-item-${n.id}`}
              >
                <p className="text-sm font-medium">{n.title}</p>
                <p className="text-xs text-muted-foreground mt-1">{n.body}</p>
                <p className="text-[10px] text-muted-foreground mt-2">
                  {n.createdAt ? new Date(n.createdAt).toLocaleString() : ""}
                </p>
              </button>
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
