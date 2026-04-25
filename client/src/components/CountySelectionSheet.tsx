import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { MapPin, CheckSquare, Square, X } from "lucide-react";
import { MD_COUNTIES } from "@shared/schema";

interface CountySelectionSheetProps {
  open: boolean;
  defaultCounties: string[];
  onConfirm: (counties: string[]) => void;
  onCancel: () => void;
}

export default function CountySelectionSheet({ open, defaultCounties, onConfirm, onCancel }: CountySelectionSheetProps) {
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    if (open) {
      // Pre-fill with driver's permanent county prefs (or all if empty = all)
      setSelected(defaultCounties.length > 0 ? defaultCounties : [...MD_COUNTIES]);
    }
  }, [open]);

  if (!open) return null;

  const toggle = (county: string) => {
    setSelected(prev =>
      prev.includes(county) ? prev.filter(c => c !== county) : [...prev, county]
    );
  };

  const selectAll = () => setSelected([...MD_COUNTIES]);
  const selectNone = () => setSelected([]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onCancel} />

      {/* Sheet */}
      <div className="relative bg-white rounded-t-2xl w-full max-w-lg max-h-[85vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <MapPin className="w-5 h-5 text-blue-600" />
            <div>
              <h2 className="text-base font-semibold">Today's Service Area</h2>
              <p className="text-xs text-gray-500">Which counties do you want to accept rides in today?</p>
            </div>
          </div>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600 p-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Select All / None */}
        <div className="flex gap-3 px-5 py-3 border-b border-gray-100">
          <button onClick={selectAll} className="text-xs font-medium text-blue-600 hover:text-blue-800 flex items-center gap-1">
            <CheckSquare className="w-3.5 h-3.5" /> All counties
          </button>
          <span className="text-gray-300">|</span>
          <button onClick={selectNone} className="text-xs font-medium text-gray-500 hover:text-gray-700 flex items-center gap-1">
            <Square className="w-3.5 h-3.5" /> None
          </button>
          <span className="ml-auto text-xs text-gray-400">{selected.length} selected</span>
        </div>

        {/* County List */}
        <div className="overflow-y-auto flex-1 px-5 py-2">
          <div className="grid grid-cols-2 gap-1 py-2">
            {MD_COUNTIES.map(county => {
              const isSelected = selected.includes(county);
              return (
                <button
                  key={county}
                  onClick={() => toggle(county)}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium text-left transition-colors ${
                    isSelected
                      ? "bg-blue-50 text-blue-700 border border-blue-200"
                      : "bg-gray-50 text-gray-600 border border-transparent hover:bg-gray-100"
                  }`}
                >
                  {isSelected
                    ? <CheckSquare className="w-4 h-4 shrink-0" />
                    : <Square className="w-4 h-4 shrink-0 text-gray-400" />
                  }
                  <span className="truncate">{county}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-gray-100 flex gap-3">
          <Button variant="outline" className="flex-1" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            className="flex-1 bg-blue-600 hover:bg-blue-700"
            disabled={selected.length === 0}
            onClick={() => onConfirm(selected)}
          >
            Go Online ({selected.length} {selected.length === MD_COUNTIES.length ? "all" : selected.length === 1 ? "county" : "counties"})
          </Button>
        </div>
      </div>
    </div>
  );
}
