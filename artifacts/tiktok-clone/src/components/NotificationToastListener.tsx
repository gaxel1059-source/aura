import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getGetUnreadNotificationCountQueryKey } from '@workspace/api-client-react';
import { useCall } from '@/contexts/CallContext';
import { useToast } from '@/hooks/use-toast';
import type { NotificationPayload } from '@/hooks/useMessagingWebSocket';

function messageFor(n: NotificationPayload): string {
  const who = `@${n.actor.username}`;
  switch (n.type) {
    case 'like':
      return `${who} le dio like a tu video${n.videoTitle ? `: "${n.videoTitle}"` : ''}`;
    case 'comment':
      return `${who} comentó en tu video${n.videoTitle ? `: "${n.videoTitle}"` : ''}`;
    case 'follow':
      return `${who} empezó a seguirte`;
    case 'friend_request':
      return `${who} te envió una solicitud de amistad`;
    case 'friend_accept':
      return `${who} aceptó tu solicitud de amistad`;
  }
}

/** Pops a toast the instant a like/comment/follow/friend event arrives over the WS. */
export function NotificationToastListener() {
  const { onWsEvent } = useCall();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  useEffect(() => {
    const off = onWsEvent((event) => {
      if (event.type !== 'notification:new') return;
      toast({ description: messageFor(event.payload) });
      queryClient.invalidateQueries({ queryKey: getGetUnreadNotificationCountQueryKey() });
    });
    return off;
  }, [onWsEvent, toast, queryClient]);

  return null;
}
