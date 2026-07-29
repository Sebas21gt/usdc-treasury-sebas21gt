interface InventoryCardProps {
  name: string;
  subtitle: string;
  badgeLabel: string;
  icon: React.ReactNode;
  balance: number;
  isLoading: boolean;
  min: number;
  target: number;
  max: number;
  // Solid, dark "highlighted" treatment (used for Stellar). When false, the
  // light/white card is used and the accent* props control its colors.
  highlighted?: boolean;
  accentIconBg?: string;
  accentIconColor?: string;
  accentBadgeBg?: string;
  accentBadgeText?: string;
  accentBadgeBorder?: string;
  accentBar?: string;
}

export function InventoryCard({
  name,
  subtitle,
  badgeLabel,
  icon,
  balance,
  isLoading,
  min,
  target,
  max,
  highlighted = false,
  accentIconBg = "bg-gray-50",
  accentIconColor = "text-gray-600",
  accentBadgeBg = "bg-gray-50",
  accentBadgeText = "text-gray-700",
  accentBadgeBorder = "border-gray-100",
  accentBar = "bg-gray-400",
}: InventoryCardProps) {
  const progressPct = Math.min((balance / max) * 100, 100);

  if (highlighted) {
    return (
      <div className="bg-pollar-blue rounded-2xl p-6 shadow-md shadow-pollar-blue-dark/20 text-white relative overflow-hidden">
        <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -mr-10 -mt-10 blur-2xl"></div>

        <div className="flex justify-between items-start mb-6 relative z-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center backdrop-blur-sm text-white">
              {icon}
            </div>
            <div>
              <h3 className="font-semibold text-white">{name}</h3>
              <p className="text-xs text-blue-100">{subtitle}</p>
            </div>
          </div>
          <span className="px-2.5 py-1 bg-white/20 text-white text-xs font-semibold rounded-full backdrop-blur-sm">
            {badgeLabel}
          </span>
        </div>

        <div className="mb-4 relative z-10">
          <span className="text-3xl font-bold tracking-tight">{isLoading ? '--' : balance.toLocaleString()}</span>
          <span className="text-blue-100 font-medium ml-2">USDC</span>
        </div>

        <div className="space-y-2 relative z-10">
          <div className="flex justify-between text-xs font-medium text-blue-100">
            <span>Min: {min}</span>
            <span className="text-white">Target: {target}</span>
            <span>Max: {max}</span>
          </div>
          <div className="w-full bg-black/20 rounded-full h-1.5 overflow-hidden">
            <div className="bg-white h-full rounded-full transition-all duration-500" style={{ width: `${progressPct}%` }}></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex justify-between items-start mb-6">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-full ${accentIconBg} flex items-center justify-center ${accentIconColor}`}>
            {icon}
          </div>
          <div>
            <h3 className="font-semibold text-gray-900">{name}</h3>
            <p className="text-xs text-gray-500">{subtitle}</p>
          </div>
        </div>
        <span className={`px-2.5 py-1 ${accentBadgeBg} ${accentBadgeText} text-xs font-semibold rounded-full border ${accentBadgeBorder}`}>
          {badgeLabel}
        </span>
      </div>

      <div className="mb-4">
        <span className="text-3xl font-bold text-gray-900 tracking-tight">{isLoading ? '--' : balance.toLocaleString()}</span>
        <span className="text-gray-500 font-medium ml-2">USDC</span>
      </div>

      <div className="space-y-2">
        <div className="flex justify-between text-xs font-medium text-gray-500">
          <span>Min: {min}</span>
          <span className="text-gray-900">Target: {target}</span>
          <span>Max: {max}</span>
        </div>
        <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
          <div className={`${accentBar} h-full rounded-full transition-all duration-500`} style={{ width: `${progressPct}%` }}></div>
        </div>
      </div>
    </div>
  );
}
