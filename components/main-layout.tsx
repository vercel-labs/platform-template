'use client';

import { useState, useCallback } from 'react';
import { MessageCircle, Monitor } from 'lucide-react';
import { Chat } from '@/components/chat/chat';
import { Preview } from '@/components/preview';
import { cn } from '@/lib/utils';
import {
  usePreviewUrl,
  useSetPreviewUrl,
  useShowPreview,
} from '@/lib/store/sandbox-store';
import type { ChatMessage } from '@/lib/types';

type MobileTab = 'chat' | 'preview';

const FAKE_PREVIEW_URL = 'https://example.vercel.app';

/**
 * Dev-only floating button to toggle the preview panel transition.
 * Only renders in development mode.
 */
function DevPreviewToggle() {
  const previewUrl = usePreviewUrl();
  const setPreviewUrl = useSetPreviewUrl();

  const toggle = useCallback(() => {
    setPreviewUrl(previewUrl ? null : FAKE_PREVIEW_URL);
  }, [previewUrl, setPreviewUrl]);

  if (process.env.NODE_ENV !== 'development') return null;

  return (
    <button
      type="button"
      onClick={toggle}
      className="fixed bottom-4 right-4 z-50 rounded-full bg-zinc-900 px-3 py-1.5 font-mono text-xs text-white shadow-lg transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
    >
      {previewUrl ? 'Hide Preview' : 'Show Preview'}
    </button>
  );
}

interface MainLayoutProps {
  initialMessages?: ChatMessage[];
}

export function MainLayout({ initialMessages }: MainLayoutProps) {
  const [mobileTab, setMobileTab] = useState<MobileTab>('chat');
  const showRightPanel = useShowPreview();

  return (
    <div className="flex flex-1 flex-col overflow-hidden lg:flex-row">
      <DevPreviewToggle />

      {/* Mobile Tab Switcher - only show when preview is available */}
      {showRightPanel && (
        <div className="flex shrink-0 border-b border-zinc-200 lg:hidden dark:border-zinc-800">
          <button
            type="button"
            onClick={() => setMobileTab('chat')}
            className={cn(
              'flex flex-1 items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors',
              mobileTab === 'chat'
                ? 'border-b-2 border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-100'
                : 'text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-300',
            )}
          >
            <MessageCircle className="h-4 w-4" />
            Chat
          </button>
          <button
            type="button"
            onClick={() => setMobileTab('preview')}
            className={cn(
              'flex flex-1 items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors',
              mobileTab === 'preview'
                ? 'border-b-2 border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-100'
                : 'text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-300',
            )}
          >
            <Monitor className="h-4 w-4" />
            Preview
          </button>
        </div>
      )}

      {/* Chat Panel - centered when no preview, slides left when preview exists */}
      <div
        className={cn(
          'min-h-0 overflow-hidden transition-all duration-500 ease-in-out',
          // Mobile: show/hide based on tab (only when preview exists)
          showRightPanel && mobileTab !== 'chat' && 'max-lg:hidden',
          // Desktop: animated transition between centered and sidebar
          showRightPanel
            ? 'lg:w-[44rem] lg:flex-none lg:border-r lg:border-zinc-200 lg:dark:border-zinc-800'
            : 'mx-auto w-full max-w-3xl flex-1',
        )}
      >
        <Chat
          className="h-full rounded-none border-0"
          standalone={!showRightPanel}
          initialMessages={initialMessages}
        />
      </div>

      {/* Preview Panel - always rendered, animated in */}
      <div
        className={cn(
          'min-h-0 flex-col overflow-hidden transition-all duration-500 ease-in-out',
          // Mobile: show/hide based on tab
          showRightPanel && mobileTab === 'preview'
            ? 'flex max-lg:flex'
            : 'max-lg:hidden',
          // Desktop: animate from 0 width/opacity to full
          showRightPanel
            ? 'lg:flex lg:flex-1 lg:opacity-100'
            : 'lg:flex lg:w-0 lg:flex-none lg:opacity-0',
        )}
      >
        <Preview className="h-full rounded-none border-0" />
      </div>
    </div>
  );
}
