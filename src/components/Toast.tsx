import React from 'react';
import { ToastMessage } from '../types';

interface ToastProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

export const ToastContainer: React.FC<ToastProps> = ({ toasts, onDismiss }) => {
  return (
    <div
      className="fixed bottom-6 right-6 z-50 flex flex-col gap-2.5 max-w-sm pointer-events-none"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          onClick={() => onDismiss(t.id)}
          className={`pointer-events-auto px-4 py-3 rounded-2xl text-sm flex items-center gap-2.5 shadow-2xl backdrop-blur-xl border transition-all cursor-pointer anim-fade-up ${
            t.type === 'ok'
              ? 'bg-[#14141e]/95 text-[#34d399] border-[#34d399]/40'
              : t.type === 'err'
              ? 'bg-[#14141e]/95 text-[#fb7185] border-[#fb7185]/40'
              : 'bg-[#14141e]/95 text-[#f4f4f6] border-white/10'
          }`}
        >
          <span className="text-[var(--accent)] font-bold">✦</span>
          <span className="flex-1 font-medium">{t.text}</span>
        </div>
      ))}
    </div>
  );
};
