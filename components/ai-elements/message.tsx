'use client';

import { cn } from '@/lib/utils';
import { cjk } from '@streamdown/cjk';
import { code } from '@streamdown/code';
import { math } from '@streamdown/math';
import { mermaid } from '@streamdown/mermaid';
import { Bot, User } from 'lucide-react';
import type { ComponentProps } from 'react';
import { memo } from 'react';
import { Streamdown } from 'streamdown';

export type MessageResponseProps = ComponentProps<typeof Streamdown>;

export const MessageResponse = memo(
  ({ className, ...props }: MessageResponseProps) => (
    <Streamdown
      className={cn(
        'size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
        className,
      )}
      plugins={{ code, mermaid, math, cjk }}
      {...props}
    />
  ),
  (prevProps, nextProps) => prevProps.children === nextProps.children,
);

MessageResponse.displayName = 'MessageResponse';

export type MessageProps = ComponentProps<'div'> & {
  from: 'user' | 'assistant';
};

export const Message = ({
  from,
  className,
  children,
  ...props
}: MessageProps) => (
  <div
    className={cn(
      'flex gap-3',
      from === 'user' ? 'flex-row-reverse' : 'flex-row',
      className,
    )}
    {...props}
  >
    <div
      className={cn(
        'flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
        from === 'user'
          ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
          : 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100',
      )}
    >
      {from === 'user' ? (
        <User className="h-4 w-4" />
      ) : (
        <Bot className="h-4 w-4" />
      )}
    </div>
    {children}
  </div>
);

export type MessageContentProps = ComponentProps<'div'> & {
  from?: 'user' | 'assistant';
};

export const MessageContent = ({
  from,
  className,
  ...props
}: MessageContentProps) => (
  <div
    className={cn(
      'min-w-0 flex-1 space-y-2',
      from === 'user' ? 'text-right' : 'text-left',
      className,
    )}
    {...props}
  />
);
