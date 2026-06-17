'use client';

import { toast } from 'sonner';

/** Share a profile link via the native share sheet, falling back to the clipboard. */
export function shareLink(url: string) {
  if (typeof navigator !== 'undefined' && navigator.share) {
    void navigator.share({ url }).catch(() => {});
    return;
  }
  navigator.clipboard.writeText(url);
  toast.success('Profile link copied');
}
