import { CheckCircle, Clock, Car, Navigation, Route, MapPin } from "lucide-react";

type RideStatus = 'pending' | 'accepted' | 'driver_arriving' | 'in_progress' | 'completed';

interface Step {
  key: RideStatus;
  label: string;
  icon: typeof CheckCircle;
}

const steps: Step[] = [
  { key: 'pending', label: 'Requested', icon: Clock },
  { key: 'accepted', label: 'Assigned', icon: Car },
  { key: 'driver_arriving', label: 'Arriving', icon: Navigation },
  { key: 'in_progress', label: 'On Trip', icon: Route },
  { key: 'completed', label: 'Arrived', icon: MapPin },
];

const statusOrder: Record<string, number> = {
  pending: 0,
  accepted: 1,
  driver_arriving: 2,
  in_progress: 3,
  completed: 4,
};

interface RideProgressStepperProps {
  status: string;
  compact?: boolean;
}

export function RideProgressStepper({ status, compact = false }: RideProgressStepperProps) {
  const currentIndex = statusOrder[status] ?? 0;

  if (compact) {
    return (
      <div className="flex items-center gap-0.5 w-full" data-testid="ride-progress-stepper">
        {steps.map((step, i) => {
          const isComplete = i < currentIndex;
          const isCurrent = i === currentIndex;
          return (
            <div key={step.key} className="flex items-center flex-1 last:flex-none">
              <div className="flex flex-col items-center">
                <div
                  className={`w-5 h-5 rounded-full flex items-center justify-center transition-all duration-500 ${
                    isComplete
                      ? 'bg-green-500 text-white'
                      : isCurrent
                        ? 'bg-blue-600 text-white scale-110 ring-2 ring-blue-100'
                        : 'bg-gray-200 text-gray-400'
                  }`}
                >
                  {isComplete ? (
                    <CheckCircle className="w-3 h-3" />
                  ) : (
                    <step.icon className="w-2.5 h-2.5" />
                  )}
                </div>
                <span className={`text-[8px] mt-0.5 font-medium whitespace-nowrap ${
                  isCurrent ? 'text-blue-600' : isComplete ? 'text-green-600' : 'text-gray-400'
                }`}>
                  {step.label}
                </span>
              </div>
              {i < steps.length - 1 && (
                <div className={`flex-1 h-0.5 mx-0.5 mt-[-10px] rounded transition-all duration-700 ${
                  i < currentIndex ? 'bg-green-400' : 'bg-gray-200'
                }`} />
              )}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between w-full px-1" data-testid="ride-progress-stepper">
      {steps.map((step, i) => {
        const isComplete = i < currentIndex;
        const isCurrent = i === currentIndex;
        return (
          <div key={step.key} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center">
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center transition-all duration-500 ${
                  isComplete
                    ? 'bg-green-500 text-white'
                    : isCurrent
                      ? 'bg-blue-600 text-white scale-110 ring-3 ring-blue-100 shadow-lg shadow-blue-200'
                      : 'bg-gray-100 text-gray-400 border border-gray-200'
                }`}
              >
                {isComplete ? (
                  <CheckCircle className="w-3.5 h-3.5" />
                ) : (
                  <step.icon className={`w-3.5 h-3.5 ${isCurrent ? 'animate-pulse' : ''}`} />
                )}
              </div>
              <span className={`text-[9px] mt-0.5 font-semibold whitespace-nowrap ${
                isCurrent ? 'text-blue-600' : isComplete ? 'text-green-600' : 'text-gray-400'
              }`}>
                {step.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className="flex-1 mx-1 mt-[-12px]">
                <div className="h-0.5 rounded-full bg-gray-100 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-700 ease-out ${
                      i < currentIndex
                        ? 'bg-green-400'
                        : i === currentIndex
                          ? 'bg-blue-400 animate-pulse'
                          : ''
                    }`}
                    style={{ width: i < currentIndex ? '100%' : i === currentIndex ? '50%' : '0%' }}
                  />
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
