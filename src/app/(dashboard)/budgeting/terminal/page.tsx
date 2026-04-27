import React from 'react';
import { CommandBar } from '@/features/terminal/components/CommandBar';
import { PanelGrid } from '@/features/terminal/components/PanelGrid';

// Import Google Font for Terminal UI
import { JetBrains_Mono } from 'next/font/google';

const jetbrainsMono = JetBrains_Mono({ 
  subsets: ['latin'],
  display: 'swap',
});

export default function TerminalPage() {
  return (
    <div className={`flex flex-col h-screen w-full bg-[#050814] overflow-hidden ${jetbrainsMono.className}`}>
      {/* 1. Command Bar (Top) */}
      <CommandBar />

      {/* 2. Multi-pane Workspace (Center) */}
      <PanelGrid />

      {/* 3. Function Bar (Bottom) — legend of typeable verbs in command bar above.
          Stub verbs (ALT/SCN/BRF) hidden post-Turn-38-sub14 audit: they parsed
          correctly but had no real panel content; advertising them as
          "clickable" with cursor-pointer was misleading customers. Keep
          only the verbs that actually do something visible.
       */}
      <div className="flex items-center justify-between px-4 py-2 bg-[#050814] border-t border-gray-800 font-mono text-xs text-gray-500">
        <div className="flex items-center space-x-6">
          <span className="text-gray-600">type in command bar ↑</span>
          <span>HOLD</span>
          <span>GRP</span>
          <span>CO</span>
          <span>IND</span>
          <span>CMP</span>
          <span>AUD</span>
        </div>
        <div className="flex space-x-4">
          <span>[?]</span>
          <span>[theme]</span>
        </div>
      </div>
    </div>
  );
}
