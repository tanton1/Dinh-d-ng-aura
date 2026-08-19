import React from 'react';

export default function DebugInfo({ data }: { data: any }) {
  // if (process.env.NODE_ENV === 'production') return null;
  return (
    <div className="bg-zinc-950 p-4 rounded-xl border border-red-500 mt-8 font-mono text-xs text-red-400 whitespace-pre-wrap overflow-auto max-h-[400px]">
      {JSON.stringify(data, null, 2)}
      {data?.error ? `\nERROR: ${data.error}` : ''}
    </div>
  );
}
