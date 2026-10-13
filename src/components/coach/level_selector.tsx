/** Tap selectors for back pain and bowel: numeric behind the scenes, unset saves null. */

export const BACK_LEVELS = [
  { label: 'None', value: 0 },
  { label: 'Mild', value: 3 },
  { label: 'Moderate', value: 6 },
  { label: 'Severe', value: 9 },
];

export const BOWEL_LEVELS = [
  { label: 'Loose', value: 1 },
  { label: 'Normal', value: 2 },
  { label: 'Hard', value: 3 },
  { label: 'None', value: 0 },
];

export function LevelSelector({ options, value, onChange }: { options: { label: string; value: number }[]; value: number | null; onChange: (v: number | null) => void }) {
  return (
    <div className="grid grid-cols-4 gap-1">
      {options.map(o => (
        <button
          key={o.label}
          type="button"
          onClick={() => onChange(value === o.value ? null : o.value)}
          className={`py-2 rounded text-sm transition-colors ${
            value === o.value
              ? 'bg-blue-600 text-white'
              : 'bg-zinc-900 border border-zinc-700 text-gray-400 hover:text-white'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
