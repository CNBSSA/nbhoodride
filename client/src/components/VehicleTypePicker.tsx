import { VEHICLE_TYPE_DESCRIPTIONS, VEHICLE_TYPE_LABELS, VEHICLE_TYPES, type VehicleType } from "@shared/vehicleTypes";
import { Car, Users, Accessibility } from "lucide-react";

interface VehicleTypePickerProps {
  value: VehicleType;
  onChange: (type: VehicleType) => void;
  disabled?: boolean;
}

const TYPE_ICONS: Record<VehicleType, typeof Car> = {
  standard: Car,
  xl: Users,
  suv: Car,
  wheelchair: Accessibility,
};

/** Rider selects vehicle class before confirming a ride. */
export function VehicleTypePicker({ value, onChange, disabled }: VehicleTypePickerProps) {
  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-3 space-y-2" data-testid="vehicle-type-picker">
      <p className="text-sm font-medium text-gray-800">Vehicle type</p>
      <div className="grid grid-cols-2 gap-2">
        {VEHICLE_TYPES.map((type) => {
          const Icon = TYPE_ICONS[type];
          const selected = value === type;
          return (
            <button
              key={type}
              type="button"
              disabled={disabled}
              onClick={() => onChange(type)}
              className={`text-left rounded-xl border px-3 py-2 transition-colors ${
                selected
                  ? "border-blue-500 bg-blue-50 ring-1 ring-blue-200"
                  : "border-gray-200 bg-white hover:bg-gray-50"
              }`}
              data-testid={`vehicle-type-${type}`}
            >
              <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-900">
                <Icon className="w-3.5 h-3.5" />
                {VEHICLE_TYPE_LABELS[type]}
              </div>
              <p className="text-[10px] text-muted-foreground mt-0.5 leading-snug">
                {VEHICLE_TYPE_DESCRIPTIONS[type]}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
