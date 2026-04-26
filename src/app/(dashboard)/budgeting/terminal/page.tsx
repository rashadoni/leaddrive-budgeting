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

      {/* 3. Function Bar (Bottom) */}
      <div className="flex items-center justify-between px-4 py-2 bg-[#050814] border-t border-gray-800 font-mono text-xs text-gray-500">
        <div className="flex space-x-6">
          <span className="hover:text-white cursor-pointer transition-colors">HOLD</span>
          <span className="hover:text-white cursor-pointer transition-colors">GRP</span>
          <span className="hover:text-white cursor-pointer transition-colors">CO</span>
          <span className="hover:text-white cursor-pointer transition-colors">IND</span>
          <span className="hover:text-[#FFB800] cursor-pointer transition-colors">ALT</span>
          <span className="hover:text-white cursor-pointer transition-colors">SCN</span>
          <span className="hover:text-[#00D4AA] cursor-pointer transition-colors">BRF</span>
        </div>
        <div className="flex space-x-4">
          <span className="hover:text-white cursor-pointer transition-colors">[?]</span>
          <span className="hover:text-white cursor-pointer transition-colors">[theme]</span>
        </div>
      </div>
    </div>
  );
}
